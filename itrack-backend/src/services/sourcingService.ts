import { settings } from "../config/settings.js";
import type { ProductCandidate, StoredProfile } from "../models/schemas.js";
import type { SessionState } from "../services/backboardService.js";
import { getProfileConfidence } from "../services/backboardService.js";
import { uploadScreenshotForLens } from "./cloudinaryService.js";
import { getJson } from "serpapi";

// Only allow links to known ecommerce/retail domains. Falls back to "#" for
// anything that looks like a content site (Reddit, Pinterest, YouTube, etc.).
const ECOMMERCE_DOMAINS = [
  "amazon.",
  "ebay.",
  "etsy.",
  "walmart.",
  "target.",
  "bestbuy.",
  "shopify.",
  "myshopify.",
  "nike.",
  "adidas.",
  "zara.",
  "hm.",
  "uniqlo.",
  "nordstrom.",
  "macys.",
  "gap.",
  "asos.",
  "farfetch.",
  "net-a-porter.",
  "ssense.",
  "lululemon.",
  "patagonia.",
  "drmartens.",
  "vans.",
  "converse.",
  "newbalance.",
  "reebok.",
  "puma.",
  "underarmour.",
  "levi.",
  "forever21.",
  "urbanoutfitters.",
  "anthropologie.",
  "freepeople.",
  "revolve.",
  "zaful.",
  "shein.",
  "shop.",
];

const toEcommerceUrl = (url: unknown): string => {
  if (typeof url !== "string" || !url.startsWith("http")) return "#";
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return ECOMMERCE_DOMAINS.some((domain) => hostname.includes(domain)) ? url : "#";
  } catch {
    return "#";
  }
};

type CatalogEntry = {
  name: string;
  price: string;
  image_url: string;
  buy_url: string;
  tags: string[];
};

const HARDCODED_CATALOG: CatalogEntry[] = [
  {
    name: "Nike Air Force 1 '07",
    price: "$115",
    image_url:
      "https://images.unsplash.com/photo-1608231387042-66d1773070a5?q=80&w=1074&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
    buy_url: "https://www.nike.com/t/air-force-1-07-mens-shoes-jBrhbr",
    tags: ["sneakers", "minimalist", "white", "streetwear", "nike"],
  },
  {
    name: "Lululemon Everywhere Belt Bag",
    price: "$38",
    image_url: 
      "https://images.lululemon.com/is/image/lululemon/LU9B78S_0001_1",
    buy_url: "https://shop.lululemon.com/p/bags/Everywhere-Belt-Bag/_/prod8900747",
    tags: ["bag", "accessories", "black", "minimalist", "lululemon"],
  },
  {
    name: "Adidas Samba OG",
    price: "$100",
    image_url:
      "https://assets.adidas.com/images/h_840,f_auto,q_auto,fl_lossy,c_fill,g_auto/3bbecbdf584e40398446a8bf0117cf62_9366/Samba_OG_Shoes_White_B75806_01_standard.jpg",
    buy_url: "https://www.adidas.com/us/samba-og-shoes/B75806.html",
    tags: ["sneakers", "white", "minimalist", "adidas", "retro"],
  },
  {
    name: "Patagonia Better Sweater Fleece",
    price: "$139",
    image_url:
      "https://www.patagonia.ca/dw/image/v2/BDJB_PRD/on/demandware.static/-/Sites-patagonia-master/default/dw3e340922/images/hi-res/25882_GRBN.jpg?sw=512&sh=512&sfrm=png&q=95&bgcolor=f3f4ef",
    buy_url: "https://www.patagonia.com/product/mens-better-sweater-fleece-jacket/25528.html",
    tags: ["fleece", "earth tones", "minimalist", "patagonia", "outdoor"],
  },
  {
    name: "Dr. Martens 1460 Boots",
    price: "$170",
    image_url: 
      "https://i1.adis.ws/i/drmartens/11822006.80.jpg",
    buy_url: "https://www.drmartens.com/us/en/1460-smooth-leather-lace-up-boots-black/p/11822006",
    tags: ["boots", "black", "streetwear", "dr martens", "chunky"],
  },
];

// Blend persistent confidence scores with session signals.
// Session signals get sessionWeight multiplier since they reflect current intent.
const blendSignals = (
  persistent: Record<string, number>,
  sessionLabels: string[],
  sessionWeight: number = 2.0,
): Array<{ label: string; score: number }> => {
  const scores = new Map<string, number>(Object.entries(persistent));

  if (sessionLabels.length > 0) {
    const sessionTotal = sessionLabels.length;
    const sessionCount = new Map<string, number>();
    for (const label of sessionLabels) {
      sessionCount.set(label, (sessionCount.get(label) ?? 0) + 1);
    }
    for (const [label, count] of sessionCount.entries()) {
      const boost = (count / sessionTotal) * sessionWeight;
      scores.set(label, (scores.get(label) ?? 0) + boost);
    }
  }

  return Array.from(scores.entries())
    .map(([label, score]) => ({ label, score }))
    .sort((a, b) => b.score - a.score);
};

export const composeQueryFromProfile = (
  profile: StoredProfile,
  session: SessionState,
): string => {
  const recentDwells = session.recent_dwells.slice(-5);
  const sessionStyles = recentDwells.flatMap((d) => d.style_signals);
  const sessionColors = recentDwells.flatMap((d) => d.color_signals);

  const blendedStyles = blendSignals(profile.persistent.preferred_styles, sessionStyles);
  const blendedColors = blendSignals(profile.persistent.preferred_colors, sessionColors);

  const topStyle = blendedStyles[0]?.label;
  const topColor = blendedColors[0]?.label;

  // Top brand from persistent only (session doesn't override brand preference)
  const topBrand = Object.entries(profile.persistent.preferred_brands).sort(
    ([, a], [, b]) => b - a,
  )[0]?.[0];

  // Price range only when we have reasonable confidence
  const priceRange =
    profile.persistent.price_confidence > 0.3
      ? `$${Math.round(profile.persistent.price_min)}-${Math.round(profile.persistent.price_max)}`
      : "";

  // Exclusion operators (-label) for styles/brands above the rejection threshold
  const REJECT_THRESHOLD = 0.4;
  const rejectedStyles = Object.entries(profile.persistent.rejected_styles)
    .filter(([, score]) => score > REJECT_THRESHOLD)
    .map(([label]) => `-${label}`);

  const rejectedBrands = Object.entries(profile.persistent.rejected_brands)
    .filter(([, score]) => score > REJECT_THRESHOLD)
    .map(([label]) => `-${label}`);

  const sessionRejections = session.session_rejections.map((r) => `-${r}`);

  const positives = [topStyle, topColor, topBrand, priceRange].filter(
    (p): p is string => Boolean(p && p.toLowerCase() !== "unknown"),
  );
  const exclusions = [...new Set([...rejectedStyles, ...rejectedBrands, ...sessionRejections])];

  return [...positives, ...exclusions].join(" ");
};

// Simple scoring for hardcoded catalog (no weights needed)
interface SimpleSignals {
  style_signals?: string[];
  color_signals?: string[];
  brand_guess?: string;
  product_category?: string;
}

export const scoreCandidate = (
  candidate: { tags?: string[] },
  signals: SimpleSignals,
): number => {
  let score = 0;
  const tags = new Set((candidate.tags ?? []).map((tag) => tag.toLowerCase()));

  for (const signal of [...(signals.style_signals ?? []), ...(signals.color_signals ?? [])]) {
    if (tags.has(signal.toLowerCase())) score += 1;
  }

  const brand = signals.brand_guess?.toLowerCase();
  if (brand && tags.has(brand)) score += 3;

  const category = signals.product_category?.toLowerCase();
  if (category && [...tags].some((tag) => tag.includes(category))) score += 2;

  return score;
};

const profileToSimpleSignals = (profile: StoredProfile): SimpleSignals => ({
  style_signals: Object.keys(profile.persistent.preferred_styles).slice(0, 5),
  color_signals: Object.keys(profile.persistent.preferred_colors).slice(0, 5),
  brand_guess: Object.entries(profile.persistent.preferred_brands).sort(
    ([, a], [, b]) => b - a,
  )[0]?.[0],
});

const toProduct = (
  candidate: CatalogEntry,
  source: ProductCandidate["source"],
  confidence?: number,
): ProductCandidate => {
  // Infer brand from tags (first tag that starts with an uppercase letter)
  const brand = candidate.tags.find((tag) => /^[A-Z]/.test(tag));
  const style_signals = candidate.tags.filter((t) => t !== brand);
  return {
    name: candidate.name,
    price: candidate.price,
    image_url: candidate.image_url,
    buy_url: candidate.buy_url,
    source,
    confidence,
    style_signals,
    brand,
  };
};

export const sourceCat1 = async (
  screenshotB64: string,
  screenshotUrl?: string,
): Promise<ProductCandidate | null> => {
  if (settings.PRODUCT_SOURCING_MODE === "hardcoded") {
    console.info("[Sourcing][Cat1] Hardcoded mode enabled; no catalog fallback");
    return null;
  }

  let fallbackReason = "unknown";

  try {
    const providedUrl = screenshotUrl?.trim();
    const lensImageUrl = providedUrl ? providedUrl : await uploadScreenshotForLens(screenshotB64);
    if (providedUrl) {
      console.info("[Sourcing][Cat1] Using frontend-provided screenshot_url for Lens");
    }
    if (!lensImageUrl) {
      fallbackReason = settings.CLOUDINARY_ENABLED
        ? "cloudinary_upload_failed"
        : "cloudinary_disabled_no_public_image_url";
      console.warn(
        `[Sourcing][Cat1] Cannot run SerpAPI Lens without public image URL (reason=${fallbackReason}); falling back`,
      );
      throw new Error("Missing public image URL for SerpAPI Lens");
    }

    const data = (await getJson({
      engine: "google_lens",
      api_key: settings.SERPAPI_KEY,
      url: lensImageUrl,
      timeout: 30000,
    })) as { visual_matches?: Array<Record<string, unknown>>; error?: string };

    if (data.error) {
      fallbackReason = "serpapi_error_response";
      console.warn(`[Sourcing][Cat1] SerpAPI Lens returned error: ${data.error}; falling back`);
    } else {
      const top = data.visual_matches?.[0];
      if (top) {
        console.info("[Sourcing][Cat1] Live Lens hit from SerpAPI visual_matches[0]");
        return {
          name: typeof top.title === "string" ? top.title : "Unknown Product",
          price:
            typeof top.price === "object" &&
            top.price !== null &&
            "value" in top.price &&
            typeof (top.price as { value: unknown }).value === "string"
              ? (top.price as { value: string }).value
              : "See site",
          image_url: typeof top.thumbnail === "string" ? top.thumbnail : "",
          buy_url: toEcommerceUrl(top.link),
          source: "serpapi_lens",
        };
      }

      fallbackReason = "serpapi_ok_no_visual_match";
      console.warn("[Sourcing][Cat1] SerpAPI responded but no visual match found; falling back");
    }
  } catch (error) {
    const isTimeout = error instanceof Error && error.constructor.name === "RequestTimeoutError";
    if (fallbackReason === "unknown") {
      fallbackReason = isTimeout ? "serpapi_timeout" : "serpapi_request_error";
    }
    if (isTimeout) {
      console.warn("[Sourcing][Cat1] SerpAPI Lens timed out after 30s; falling back");
    } else {
      console.warn("[Sourcing][Cat1] SerpAPI Lens request errored; falling back", error);
    }
  }

  console.warn(`[Sourcing][Cat1] No result available (reason=${fallbackReason}); returning null`);
  return null;
};

export const sourceCat2 = async (
  profile: StoredProfile,
  session: SessionState,
): Promise<ProductCandidate[]> => {
  const query = composeQueryFromProfile(profile, session);
  const baseConfidence = getProfileConfidence(profile);
  const signals = profileToSimpleSignals(profile);
  const topStyles = signals.style_signals ?? [];
  const topBrand = signals.brand_guess;

  if (settings.PRODUCT_SOURCING_MODE === "hardcoded") {
    console.info("[Sourcing][Cat2] Hardcoded mode enabled; no catalog fallback picks");
    return [];
  }

  if (!query) {
    console.warn("[Sourcing][Cat2] Empty query from profile; returning empty picks");
    return [];
  }

  console.info(`[Sourcing][Cat2] Live shopping query: ${query}`);

  let fallbackReason = "unknown";

  try {
    const data = (await getJson({
      engine: "google_shopping",
      q: query,
      api_key: settings.SERPAPI_KEY,
      timeout: 30000,
    })) as { shopping_results?: Array<Record<string, unknown>>; error?: string };

    if (data.error) {
      fallbackReason = "serpapi_error_response";
      console.warn(`[Sourcing][Cat2] SerpAPI Shopping returned error: ${data.error}; falling back`);
    } else {
      const picks = (data.shopping_results ?? []).slice(0, 5).map((item, i) => ({
        name: typeof item.title === "string" ? item.title : "Unknown Product",
        price: typeof item.price === "string" ? item.price : "See site",
        image_url: typeof item.thumbnail === "string" ? item.thumbnail : "",
        buy_url: toEcommerceUrl(
          typeof item.product_link === "string" ? item.product_link : item.link,
        ),
        source: "serpapi_shopping" as const,
        confidence: baseConfidence * (1 - 0.05 * i),
        style_signals: topStyles,
        brand: topBrand,
      }));

      if (picks.length > 0) {
        console.info(`[Sourcing][Cat2] Live shopping hits: ${picks.length}`);
        return picks;
      }

      fallbackReason = "serpapi_ok_no_shopping_results";
      console.warn("[Sourcing][Cat2] SerpAPI responded but no shopping results found; falling back");
    }
  } catch (error) {
    const isTimeout = error instanceof Error && error.constructor.name === "RequestTimeoutError";
    fallbackReason = isTimeout ? "serpapi_timeout" : "serpapi_request_error";
    if (isTimeout) {
      console.warn("[Sourcing][Cat2] SerpAPI Shopping timed out after 30s; falling back");
    } else {
      console.warn("[Sourcing][Cat2] SerpAPI Shopping request errored; falling back", error);
    }
  }

  console.warn(`[Sourcing][Cat2] No results available (reason=${fallbackReason}); returning empty picks`);
  return [];
};
