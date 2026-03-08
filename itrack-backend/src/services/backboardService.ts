import { settings } from "../config/settings.js";
import {
  PersistentProfileSchema,
  ObservationCountsSchema,
  StoredProfileSchema,
} from "../models/schemas.js";
import type { StoredProfile, SkipEvent } from "../models/schemas.js";

// ---- Exported interfaces ----

export interface WeightedSignal {
  label: string;
  strength: number; // 0.0 – 1.0
}

export interface GeminiSignals {
  product_name: string;
  product_category: string;
  style_signals: WeightedSignal[];
  color_signals: WeightedSignal[];
  estimated_price_min: number; // -1 = unknown
  estimated_price_max: number; // -1 = unknown
  brand_guess: string;
  brand_strength: number; // 0.0 – 1.0
}

export interface SessionDwell {
  product_name: string;
  style_signals: string[];
  color_signals: string[];
  brand?: string;
  timestamp: string;
}

export interface SessionState {
  started_at: string;
  last_active_at: string;
  recent_dwells: SessionDwell[];
  session_rejections: string[];
  dwell_count: number;
}

// ---- Constants ----

const POSITIVE_INCREMENT = 0.3;
const SKIP_INCREMENT = 0.15;
const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours
const SESSION_MAX_DWELLS = 20;
const BACKBOARD_TIMEOUT_MS = 5000;
const BACKBOARD_NETWORK_ERROR_CODES = new Set(["ENOTFOUND", "ECONNREFUSED", "ECONNRESET"]);

// ---- In-memory state ----

const storedProfileCache = new Map<string, StoredProfile>();
const sessionCache = new Map<string, SessionState>();
const dwellCounts = new Map<string, number>();

// ---- Helpers ----

const authHeaders = (): HeadersInit => ({
  Authorization: `Bearer ${settings.BACKBOARD_API_KEY}`,
  "Content-Type": "application/json",
});

const sanitizeUserId = (userId: string): string =>
  userId.length <= 6 ? userId : `${userId.slice(0, 3)}***${userId.slice(-2)}`;

const errorToLogMeta = (error: unknown): Record<string, unknown> => {
  if (error instanceof Error) {
    const cause = error as Error & { cause?: { code?: unknown } };
    return {
      name: error.name,
      message: error.message,
      code: typeof cause.cause?.code === "string" ? cause.cause.code : undefined,
    };
  }
  return { error: String(error) };
};

const toTopSignals = (signals: Record<string, number>, limit: number): Array<{ label: string; score: number }> =>
  Object.entries(signals)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([label, score]) => ({ label, score: Number(score.toFixed(3)) }));

const computeProfileConfidence = (profile: StoredProfile): number => {
  const styleScores = Object.values(profile.persistent.preferred_styles);
  if (styleScores.length === 0) return 0.1;
  const top3 = [...styleScores].sort((a, b) => b - a).slice(0, 3);
  return top3.reduce((sum, v) => sum + v, 0) / top3.length;
};

const summarizeProfile = (profile: StoredProfile): Record<string, unknown> => ({
  style_count: Object.keys(profile.persistent.preferred_styles).length,
  color_count: Object.keys(profile.persistent.preferred_colors).length,
  brand_count: Object.keys(profile.persistent.preferred_brands).length,
  rejected_style_count: Object.keys(profile.persistent.rejected_styles).length,
  rejected_brand_count: Object.keys(profile.persistent.rejected_brands).length,
  top_styles: toTopSignals(profile.persistent.preferred_styles, 3),
  top_colors: toTopSignals(profile.persistent.preferred_colors, 3),
  top_brands: toTopSignals(profile.persistent.preferred_brands, 3),
  price: {
    min: Number(profile.persistent.price_min.toFixed(2)),
    max: Number(profile.persistent.price_max.toFixed(2)),
    confidence: Number(profile.persistent.price_confidence.toFixed(3)),
    count: profile.observations.price_count,
  },
  profile_confidence: Number(computeProfileConfidence(profile).toFixed(3)),
});

const logBackboardInfo = (message: string, meta?: Record<string, unknown>): void => {
  if (!settings.DEBUG) return;
  if (meta) {
    console.info(`[Backboard] ${message}`, meta);
    return;
  }
  console.info(`[Backboard] ${message}`);
};

const logBackboardWarn = (message: string, meta?: Record<string, unknown>): void => {
  if (meta) {
    console.warn(`[Backboard] ${message}`, meta);
    return;
  }
  console.warn(`[Backboard] ${message}`);
};

// Bayesian running average: dampens new signals as observations accumulate
const updateConfidence = (
  existingScore: number,
  newStrength: number,
  nObs: number,
): number => (existingScore * nObs + newStrength) / (nObs + 1);

const makeDefaultProfile = (): StoredProfile => ({
  persistent: PersistentProfileSchema.parse({
    preferred_styles: { minimalist: 0.5, streetwear: 0.3 },
    preferred_colors: { black: 0.5, white: 0.3 },
  }),
  observations: ObservationCountsSchema.parse({}),
});

// ---- Session management ----

export const getOrInitSession = (userId: string): SessionState => {
  const existing = sessionCache.get(userId);
  const now = new Date().toISOString();
  const safeUserId = sanitizeUserId(userId);

  if (existing) {
    const lastActive = new Date(existing.last_active_at).getTime();
    if (Date.now() - lastActive < SESSION_TIMEOUT_MS) {
      existing.last_active_at = now;
      logBackboardInfo("Session hit", {
        user_id: safeUserId,
        session_dwell_count: existing.dwell_count,
        recent_dwells: existing.recent_dwells.length,
        session_rejections: existing.session_rejections.length,
      });
      return existing;
    }
    logBackboardInfo("Session expired; creating fresh session", {
      user_id: safeUserId,
      previous_dwell_count: existing.dwell_count,
      previous_recent_dwells: existing.recent_dwells.length,
      previous_rejections: existing.session_rejections.length,
    });
  }

  const fresh: SessionState = {
    started_at: now,
    last_active_at: now,
    recent_dwells: [],
    session_rejections: [],
    dwell_count: 0,
  };
  sessionCache.set(userId, fresh);
  logBackboardInfo("Session initialized", {
    user_id: safeUserId,
    started_at: fresh.started_at,
  });
  return fresh;
};

export const getSession = (userId: string): SessionState => getOrInitSession(userId);

// ---- Backboard fetch / store ----

const migrateOldProfile = (old: Record<string, unknown>): StoredProfile => {
  const styles: Record<string, number> = {};
  const colors: Record<string, number> = {};
  const brands: Record<string, number> = {};

  if (Array.isArray(old.preferred_styles)) {
    for (const s of old.preferred_styles as string[]) {
      if (s) styles[s] = 0.5;
    }
  }
  if (Array.isArray(old.preferred_colors)) {
    for (const c of old.preferred_colors as string[]) {
      if (c) colors[c] = 0.5;
    }
  }
  if (Array.isArray(old.preferred_brands)) {
    for (const b of old.preferred_brands as string[]) {
      if (b) brands[b] = 0.5;
    }
  }

  return {
    persistent: PersistentProfileSchema.parse({
      preferred_styles: styles,
      preferred_colors: colors,
      preferred_brands: brands,
    }),
    observations: ObservationCountsSchema.parse({}),
  };
};

export const getStoredProfile = async (userId: string): Promise<StoredProfile> => {
  const safeUserId = sanitizeUserId(userId);
  const cached = storedProfileCache.get(userId);
  if (cached) {
    logBackboardInfo("Profile cache hit", {
      user_id: safeUserId,
      cache_size: storedProfileCache.size,
      summary: summarizeProfile(cached),
    });
    return cached;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BACKBOARD_TIMEOUT_MS);
  const startedAt = Date.now();
  const endpoint = `${settings.BACKBOARD_BASE_URL}/memory/itrack:profile:${userId}`;

  logBackboardInfo("Profile cache miss; fetching from Backboard", {
    user_id: safeUserId,
    endpoint,
    timeout_ms: BACKBOARD_TIMEOUT_MS,
  });

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: authHeaders(),
      signal: controller.signal,
    });

    logBackboardInfo("Backboard profile response received", {
      user_id: safeUserId,
      status: response.status,
      ok: response.ok,
      duration_ms: Date.now() - startedAt,
    });

    if (response.status === 200) {
      const data: unknown = await response.json();
      const raw =
        typeof data === "object" && data !== null && "value" in data
          ? (data as { value: unknown }).value
          : data;

      const parsed = StoredProfileSchema.safeParse(raw);
      if (parsed.success) {
        storedProfileCache.set(userId, parsed.data);
        logBackboardInfo("Loaded profile from Backboard (stored format)", {
          user_id: safeUserId,
          summary: summarizeProfile(parsed.data),
        });
        return parsed.data;
      }

      const maybeOld = raw as Record<string, unknown> | null;
      if (maybeOld && Array.isArray(maybeOld.preferred_styles)) {
        const migrated = migrateOldProfile(maybeOld);
        storedProfileCache.set(userId, migrated);
        logBackboardInfo("Loaded profile from Backboard (legacy migrated format)", {
          user_id: safeUserId,
          summary: summarizeProfile(migrated),
        });
        return migrated;
      }

      logBackboardWarn("Backboard profile payload format unrecognized; using defaults", {
        user_id: safeUserId,
      });
    } else {
      logBackboardWarn("Backboard profile fetch returned non-200 status", {
        user_id: safeUserId,
        status: response.status,
      });
    }
  } catch (error) {
    logBackboardWarn("Backboard profile fetch failed; using defaults", {
      user_id: safeUserId,
      duration_ms: Date.now() - startedAt,
      ...errorToLogMeta(error),
    });
  } finally {
    clearTimeout(timeout);
  }

  const empty = makeDefaultProfile();
  storedProfileCache.set(userId, empty);
  logBackboardInfo("Using default in-memory profile", {
    user_id: safeUserId,
    summary: summarizeProfile(empty),
  });
  return empty;
};

// Legacy alias used by other modules that imported getProfile
export const getProfile = getStoredProfile;

const persistProfile = async (userId: string, profile: StoredProfile): Promise<void> => {
  storedProfileCache.set(userId, profile);

  const safeUserId = sanitizeUserId(userId);
  const endpoint = `${settings.BACKBOARD_BASE_URL}/memory/itrack:profile:${userId}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BACKBOARD_TIMEOUT_MS);
  const startedAt = Date.now();

  logBackboardInfo("Persisting profile to Backboard", {
    user_id: safeUserId,
    endpoint,
    timeout_ms: BACKBOARD_TIMEOUT_MS,
    summary: summarizeProfile(profile),
  });

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(profile),
      signal: controller.signal,
    });

    const durationMs = Date.now() - startedAt;
    if (!response.ok) {
      let bodyText = "";
      try {
        bodyText = await response.text();
      } catch {
        bodyText = "";
      }

      logBackboardWarn("Backboard profile persist returned non-2xx status", {
        user_id: safeUserId,
        status: response.status,
        duration_ms: durationMs,
        body_preview: bodyText.slice(0, 500),
      });
    } else {
      logBackboardInfo("Backboard profile persisted", {
        user_id: safeUserId,
        status: response.status,
        duration_ms: durationMs,
      });
    }
  } catch (error) {
    const isNetworkError =
      error instanceof TypeError &&
      typeof (error as { cause?: { code?: unknown } }).cause?.code === "string" &&
      BACKBOARD_NETWORK_ERROR_CODES.has((error as { cause: { code: string } }).cause.code);

    if (isNetworkError) {
      const code = (error as { cause: { code: string } }).cause.code;
      logBackboardWarn("Cannot reach Backboard; profile saved in-memory only", {
        user_id: safeUserId,
        code,
        duration_ms: Date.now() - startedAt,
      });
    } else {
      logBackboardWarn("persistProfile write failed", {
        user_id: safeUserId,
        duration_ms: Date.now() - startedAt,
        ...errorToLogMeta(error),
      });
    }
  } finally {
    clearTimeout(timeout);
  }
};

// ---- Confidence-weighted profile update from dwell ----

export const updateProfile = async (
  userId: string,
  signals: GeminiSignals,
): Promise<StoredProfile> => {
  const safeUserId = sanitizeUserId(userId);
  const startedAt = Date.now();
  logBackboardInfo("updateProfile start", {
    user_id: safeUserId,
    product_name: signals.product_name,
    product_category: signals.product_category,
    style_signal_count: signals.style_signals.length,
    color_signal_count: signals.color_signals.length,
    brand_guess: signals.brand_guess,
    brand_strength: Number(signals.brand_strength.toFixed(3)),
    estimated_price_min: signals.estimated_price_min,
    estimated_price_max: signals.estimated_price_max,
  });

  const current = await getStoredProfile(userId);
  const p = current.persistent;
  const obs = current.observations;

  // Styles
  const updatedStyles = { ...p.preferred_styles };
  const stylesObs = { ...obs.styles };
  for (const { label, strength } of signals.style_signals) {
    if (!label || label.toLowerCase() === "unknown") continue;
    const n = stylesObs[label] ?? 0;
    updatedStyles[label] = updateConfidence(
      updatedStyles[label] ?? 0,
      strength * POSITIVE_INCREMENT,
      n,
    );
    stylesObs[label] = n + 1;
  }

  // Colors
  const updatedColors = { ...p.preferred_colors };
  const colorsObs = { ...obs.colors };
  for (const { label, strength } of signals.color_signals) {
    if (!label || label.toLowerCase() === "unknown") continue;
    const n = colorsObs[label] ?? 0;
    updatedColors[label] = updateConfidence(
      updatedColors[label] ?? 0,
      strength * POSITIVE_INCREMENT,
      n,
    );
    colorsObs[label] = n + 1;
  }

  // Brand
  const updatedBrands = { ...p.preferred_brands };
  const brandsObs = { ...obs.brands };
  if (signals.brand_guess && signals.brand_guess.toLowerCase() !== "unknown") {
    const brand = signals.brand_guess;
    const n = brandsObs[brand] ?? 0;
    updatedBrands[brand] = updateConfidence(
      updatedBrands[brand] ?? 0,
      signals.brand_strength * POSITIVE_INCREMENT,
      n,
    );
    brandsObs[brand] = n + 1;
  }

  // Price range (running average)
  let { price_min, price_max, price_confidence } = p;
  const priceCount = obs.price_count;
  if (signals.estimated_price_min >= 0 && signals.estimated_price_max >= 0) {
    price_min = (price_min * priceCount + signals.estimated_price_min) / (priceCount + 1);
    price_max = (price_max * priceCount + signals.estimated_price_max) / (priceCount + 1);
    price_confidence = updateConfidence(price_confidence, 0.8, priceCount);
  }

  const merged: StoredProfile = {
    persistent: {
      ...p,
      preferred_styles: updatedStyles,
      preferred_colors: updatedColors,
      preferred_brands: updatedBrands,
      price_min,
      price_max,
      price_confidence,
    },
    observations: {
      ...obs,
      styles: stylesObs,
      colors: colorsObs,
      brands: brandsObs,
      price_count: signals.estimated_price_min >= 0 ? priceCount + 1 : priceCount,
    },
  };

  await persistProfile(userId, merged);

  // Record in session
  const session = getOrInitSession(userId);
  session.dwell_count += 1;
  session.recent_dwells.push({
    product_name: signals.product_name,
    style_signals: signals.style_signals.map((s) => s.label),
    color_signals: signals.color_signals.map((c) => c.label),
    brand: signals.brand_guess !== "unknown" ? signals.brand_guess : undefined,
    timestamp: new Date().toISOString(),
  });
  if (session.recent_dwells.length > SESSION_MAX_DWELLS) {
    session.recent_dwells.splice(0, session.recent_dwells.length - SESSION_MAX_DWELLS);
  }
  const nextDwellCount = (dwellCounts.get(userId) ?? 0) + 1;
  dwellCounts.set(userId, nextDwellCount);

  logBackboardInfo("updateProfile complete", {
    user_id: safeUserId,
    duration_ms: Date.now() - startedAt,
    session_dwell_count: session.dwell_count,
    total_dwell_count: nextDwellCount,
    applied_styles: signals.style_signals.slice(0, 5).map((s) => ({
      label: s.label,
      strength: Number(s.strength.toFixed(3)),
    })),
    applied_colors: signals.color_signals.slice(0, 5).map((c) => ({
      label: c.label,
      strength: Number(c.strength.toFixed(3)),
    })),
    summary: summarizeProfile(merged),
  });

  return merged;
};

// ---- Skip signal recording ----

export const recordSkip = async (userId: string, event: SkipEvent): Promise<void> => {
  const safeUserId = sanitizeUserId(userId);
  const startedAt = Date.now();
  logBackboardInfo("recordSkip start", {
    user_id: safeUserId,
    product_name: event.product_name,
    viewport_time_ms: event.viewport_time_ms,
    style_signal_count: event.style_signals.length,
    brand: event.brand,
  });

  const current = await getStoredProfile(userId);
  const p = current.persistent;
  const obs = current.observations;

  const updatedRejStyles = { ...p.rejected_styles };
  const rejStylesObs = { ...obs.rejected_styles };
  for (const label of event.style_signals) {
    if (!label || label.toLowerCase() === "unknown") continue;
    const n = rejStylesObs[label] ?? 0;
    updatedRejStyles[label] = updateConfidence(updatedRejStyles[label] ?? 0, SKIP_INCREMENT, n);
    rejStylesObs[label] = n + 1;
  }

  const updatedRejBrands = { ...p.rejected_brands };
  const rejBrandsObs = { ...obs.rejected_brands };
  if (event.brand && event.brand.toLowerCase() !== "unknown") {
    const n = rejBrandsObs[event.brand] ?? 0;
    updatedRejBrands[event.brand] = updateConfidence(
      updatedRejBrands[event.brand] ?? 0,
      SKIP_INCREMENT,
      n,
    );
    rejBrandsObs[event.brand] = n + 1;
  }

  const merged: StoredProfile = {
    persistent: { ...p, rejected_styles: updatedRejStyles, rejected_brands: updatedRejBrands },
    observations: { ...obs, rejected_styles: rejStylesObs, rejected_brands: rejBrandsObs },
  };

  await persistProfile(userId, merged);

  // Add to session rejections for query exclusion within this session
  const session = getOrInitSession(userId);
  for (const label of event.style_signals) {
    if (!session.session_rejections.includes(label)) {
      session.session_rejections.push(label);
    }
  }

  logBackboardInfo("recordSkip complete", {
    user_id: safeUserId,
    duration_ms: Date.now() - startedAt,
    session_rejections: session.session_rejections.slice(0, 10),
    summary: summarizeProfile(merged),
  });
};

// ---- Profile utilities ----

export const getProfileConfidence = computeProfileConfidence;

export const getDwellCount = (userId: string): number => dwellCounts.get(userId) ?? 0;

export const clearProfile = (userId: string): void => {
  storedProfileCache.delete(userId);
  sessionCache.delete(userId);
  dwellCounts.delete(userId);
};
