import type { FastifyPluginAsync } from "fastify";

import { settings } from "../config/settings.js";
import { DwellEventSchema, SkipEventSchema } from "../models/schemas.js";
import type { ProductCandidate } from "../models/schemas.js";
import * as backboardService from "../services/backboardService.js";
import * as cloudinaryService from "../services/cloudinaryService.js";
import * as geminiService from "../services/geminiService.js";
import * as sourcingService from "../services/sourcingService.js";

const dwellRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/", async (request, reply) => {
    const event = DwellEventSchema.parse(request.body);

    fastify.log.info(
      `[Pipeline] Received dwell: user=${event.user_id} duration=${event.dwell_duration_ms}`,
    );

    fastify.log.info("[Pipeline] Fetching current profile + session for Cat2 input");
    const currentProfile = await backboardService.getStoredProfile(event.user_id);
    const currentSession = backboardService.getSession(event.user_id);
    const preGeminiQuery = sourcingService.composeQueryFromProfile(currentProfile, currentSession);
    fastify.log.info(
      {
        userId: event.user_id,
        preGeminiQuery,
        topStyles: Object.entries(currentProfile.persistent.preferred_styles)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 3),
        sessionDwellCount: currentSession.dwell_count,
        sessionRejections: currentSession.session_rejections,
      },
      "[Pipeline] Cat2 pre-Gemini query context",
    );

    fastify.log.info("[Pipeline] Running Cat1, Cat2, and Gemini concurrently");
    const cat1Task = sourcingService.sourceCat1(event.screenshot_b64, event.screenshot_url);
    const cat2Task = sourcingService.sourceCat2(currentProfile, currentSession).catch(
      (error: unknown) => {
        fastify.log.warn({ err: error }, "[Pipeline] Cat2 sourcing failed, using empty picks");
        return [] as ProductCandidate[];
      },
    );
    const geminiTask =
      settings.PRODUCT_SOURCING_MODE === "hardcoded"
        ? Promise.resolve()
        : geminiService
            .identifyAndUpdate(event.screenshot_b64, event.user_id, event.page_url, event.page_title)
            .catch((error: unknown) => {
              fastify.log.warn({ err: error }, "[Pipeline] Gemini identify/update failed");
            });

    let cat1Product: ProductCandidate | null;
    let cat2Picks: ProductCandidate[];

    try {
      [cat1Product, cat2Picks] = await Promise.all([cat1Task, cat2Task, geminiTask]).then(
        ([cat1, cat2, _gemini]) => [cat1, cat2],
      );
    } catch (error) {
      fastify.log.error({ err: error }, "[Pipeline] Cat1 sourcing failed");
      return reply.code(502).send({ message: "Cat1 sourcing failed" });
    }

    fastify.log.info("[Pipeline] Transforming product images in parallel");
    // Deduplicate taste_picks against products already shown this session
    const session = backboardService.getSession(event.user_id);
    cat2Picks = cat2Picks.filter((p) => !session.seen_product_names.has(p.name));
    const allProducts = [...(cat1Product ? [cat1Product] : []), ...cat2Picks];
    // Record all returned products as seen
    for (const p of allProducts) session.seen_product_names.add(p.name);
    const urls = await Promise.all(
      allProducts.map((product) => cloudinaryService.transformProductImage(product.image_url)),
    );
    allProducts.forEach((product, index) => {
      product.image_url = urls[index];
    });

    fastify.log.info("[Pipeline] Re-fetching profile after Gemini update");
    const updatedProfile = await backboardService.getStoredProfile(event.user_id);
    const updatedSession = backboardService.getSession(event.user_id);
    const postGeminiQuery = sourcingService.composeQueryFromProfile(updatedProfile, updatedSession);
    fastify.log.info({ userId: event.user_id, postGeminiQuery }, "[Pipeline] Cat2 post-Gemini query context");

    const persistent = updatedProfile.persistent;
    const topStyles = Object.entries(persistent.preferred_styles)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([label, score]) => ({ label, score }));
    const topColors = Object.entries(persistent.preferred_colors)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([label, score]) => ({ label, score }));
    const rejectedStyles = Object.entries(persistent.rejected_styles)
      .filter(([, score]) => score > 0.3)
      .map(([label]) => label);
    const priceRange =
      persistent.price_confidence > 0.3
        ? `$${Math.round(persistent.price_min)}-${Math.round(persistent.price_max)}`
        : "building...";

    return {
      current_product: cat1Product,
      taste_picks: cat2Picks,
      profile_snapshot: {
        top_styles: topStyles,
        top_colors: topColors,
        rejected_styles: rejectedStyles,
        price_range: priceRange,
        dwell_count: backboardService.getDwellCount(event.user_id),
        session_dwell_count: updatedSession.dwell_count,
        profile_confidence: backboardService.getProfileConfidence(updatedProfile),
      },
    };
  });

  // Record a skip event (product viewed < SKIP_THRESHOLD_MS in panel)
  fastify.post("/skip", async (request, reply) => {
    const event = SkipEventSchema.parse(request.body);

    fastify.log.info(
      `[Skip] user=${event.user_id} product="${event.product_name}" viewport_ms=${event.viewport_time_ms}`,
    );

    try {
      await backboardService.recordSkip(event.user_id, event);
    } catch (error) {
      fastify.log.warn({ err: error }, "[Skip] recordSkip failed");
      return reply.code(500).send({ message: "Skip recording failed" });
    }

    return { ok: true };
  });
};

export default dwellRoutes;
