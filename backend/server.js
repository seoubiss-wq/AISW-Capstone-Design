const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const { Pool } = require("pg");
const { GoogleGenAI } = require("@google/genai");
const {
  buildPersonalizationText,
  getEffectiveRecommendationPreferences,
} = require("./scripts/shared/recommendationPreferences");
const {
  buildNearbyRadiusMeters,
  shouldUseNearbyCandidateSearch,
} = require("./scripts/shared/placesSearchStrategy");
const {
  parseOpenNowOnly,
  readPlaceOpenNow,
} = require("./scripts/shared/openStatus");
const { buildDbSslConfig } = require("./scripts/shared/dbConfig");
const { runNonCriticalOperation } = require("./scripts/shared/nonCriticalOperation");
const {
  clearSessionCookie,
  normalizeStoredSessionToken,
  readSessionToken,
  setSessionCookie,
} = require("./scripts/shared/sessionAuth");
const {
  buildSupabaseAuthConfig,
  fetchSupabaseUserProfile,
  resolveSupabaseAuthConfigForAccessToken,
} = require("./scripts/shared/supabaseAuth");
const {
  canAutoLinkGoogleAccount,
  GOOGLE_AUTH_PROVIDER,
  hasAuthProvider,
  LOCAL_AUTH_PROVIDER,
  mergeAuthProvider,
  normalizeAuthProvider,
} = require("./scripts/shared/authProvider");
const {
  buildAllowedCorsOrigins,
  resolveCorsOrigin,
} = require("./scripts/shared/corsConfig");
const {
  resolveApproximateLocationFromRequest,
} = require("./scripts/shared/clientLocationFallback");
const {
  parseBypassCache,
  shouldBypassRecommendationCache,
} = require("./scripts/shared/recommendationCache");

const app = express();
app.set("trust proxy", true);

const IS_PRODUCTION = process.env.NODE_ENV === "production";

function readScopedEnv(baseName) {
  const scopedValue = IS_PRODUCTION
    ? process.env[`PROD_${baseName}`]
    : process.env[`DEV_${baseName}`];
  return String(scopedValue || "").trim();
}

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY?.trim();
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY?.trim();
const DATABASE_URL = readScopedEnv("DATABASE_URL");
const SUPABASE_URL = readScopedEnv("SUPABASE_URL");
const SUPABASE_PUBLISHABLE_KEY = readScopedEnv("SUPABASE_PUBLISHABLE_KEY");
const DEV_SUPABASE_URL = String(process.env.DEV_SUPABASE_URL || "").trim();
const DEV_SUPABASE_PUBLISHABLE_KEY = String(process.env.DEV_SUPABASE_PUBLISHABLE_KEY || "").trim();
const PROD_SUPABASE_URL = String(process.env.PROD_SUPABASE_URL || "").trim();
const PROD_SUPABASE_PUBLISHABLE_KEY = String(process.env.PROD_SUPABASE_PUBLISHABLE_KEY || "").trim();
const API_PUBLIC_ORIGIN = String(process.env.API_PUBLIC_ORIGIN || "").replace(/\/$/, "");
const PORT = Number(process.env.PORT || 5500);
const FRONTEND_BUILD_DIR = path.join(__dirname, "..", "frontend", "build");
const FRONTEND_INDEX_FILE = path.join(FRONTEND_BUILD_DIR, "index.html");
const HAS_FRONTEND_BUILD = fs.existsSync(FRONTEND_INDEX_FILE);

if (!DATABASE_URL) {
  throw new Error("DEV_DATABASE_URL 또는 PROD_DATABASE_URL이 필요합니다.");
}

const ALLOWED_CORS_ORIGINS = buildAllowedCorsOrigins({
  apiPublicOrigin: API_PUBLIC_ORIGIN,
  extraOrigins: process.env.CORS_ALLOWED_ORIGINS,
});

const SUPABASE_AUTH_CONFIGS = [
  buildSupabaseAuthConfig({
    label: IS_PRODUCTION ? "runtime-prod" : "runtime-dev",
    supabaseUrl: SUPABASE_URL,
    supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
  }),
  buildSupabaseAuthConfig({
    label: "dev",
    supabaseUrl: DEV_SUPABASE_URL,
    supabasePublishableKey: DEV_SUPABASE_PUBLISHABLE_KEY,
  }),
  buildSupabaseAuthConfig({
    label: "prod",
    supabaseUrl: PROD_SUPABASE_URL,
    supabasePublishableKey: PROD_SUPABASE_PUBLISHABLE_KEY,
  }),
].filter((config, index, configs) => {
  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    return false;
  }

  return configs.findIndex(
    (candidate) =>
      candidate.supabaseUrl === config.supabaseUrl &&
      candidate.supabasePublishableKey === config.supabasePublishableKey,
  ) === index;
});

function resolveSupabaseAuthConfig(accessToken) {
  const authConfig = resolveSupabaseAuthConfigForAccessToken(accessToken, SUPABASE_AUTH_CONFIGS);
  if (authConfig) {
    return authConfig;
  }

  return {
    label: IS_PRODUCTION ? "runtime-prod" : "runtime-dev",
    supabaseUrl: SUPABASE_URL,
    supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
  };
}

app.use(cors({
  credentials: true,
  origin(origin, callback) {
    return callback(null, resolveCorsOrigin(origin, ALLOWED_CORS_ORIGINS));
  },
}));
app.use(express.json());

function asyncHandler(handler) {
  return function wrappedAsyncHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

const RESPONSE_CACHE_VERSION = 8;
const cache = {};

const PASSWORD_ITERATIONS = 120000;
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const MAX_HISTORY = 25;
const MAX_FAVORITES = 50;
const MAX_PREFERENCE_SHEETS = 10;
const MAX_SESSIONS_PER_USER = 10;

const RECOMMEND_JSON_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Restaurant name.",
          },
          reason: {
            type: "string",
            description: "Short Korean reason.",
          },
          imageQuery: {
            type: "string",
            description: "English image query such as korean bbq.",
          },
          websiteUrl: {
            type: "string",
            description: "Official website URL. Use empty string if unknown.",
          },
        },
        required: ["name", "reason", "imageQuery"],
      },
    },
  },
  required: ["items"],
};

const FOOD_PLACE_TYPES = new Set([
  "restaurant",
  "food",
  "cafe",
  "bakery",
  "bar",
  "meal_takeaway",
  "night_club",
]);

const dbPool = new Pool({
  connectionString: DATABASE_URL,
  ssl: buildDbSslConfig({ connectionString: DATABASE_URL }),
  max: 5,
});

let authProviderSchemaReadyPromise = null;

dbPool.on("error", (error) => {
  console.error("Postgres pool error:", error);
});

function defaultPreferences() {
  return {
    favoriteCuisine: "",
    mood: "",
    budget: "",
    maxDistanceKm: "",
    avoidIngredients: "",
  };
}

function defaultSheetName(index = 1) {
  return index <= 1 ? "기본 설정" : `설정 ${index}`;
}

function defaultPreferenceSheet(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: String(overrides.id || crypto.randomUUID()),
    name: String(overrides.name || defaultSheetName()).trim().slice(0, 40) || defaultSheetName(),
    preferences: normalizePreferences(overrides.preferences || overrides),
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
  };
}

function normalizePreferenceSheet(raw, fallbackName = defaultSheetName()) {
  return defaultPreferenceSheet({
    ...raw,
    name: String(raw?.name || fallbackName).trim().slice(0, 40) || fallbackName,
    preferences: normalizePreferences(raw?.preferences || raw || {}),
  });
}

function getActivePreferenceSheet(user) {
  const sheets = Array.isArray(user.preferenceSheets) ? user.preferenceSheets : [];
  return (
    sheets.find((sheet) => sheet.id === user.activePreferenceSheetId) ||
    sheets[0] ||
    defaultPreferenceSheet()
  );
}

function ensureUserDataShape(user) {
  user.authProvider = normalizeAuthProvider(user.authProvider);
  const legacyPreferences =
    user.preferences && typeof user.preferences === "object"
      ? normalizePreferences(user.preferences)
      : defaultPreferences();
  if (!Array.isArray(user.preferenceSheets) || user.preferenceSheets.length === 0) {
    user.preferenceSheets = [defaultPreferenceSheet({ preferences: legacyPreferences })];
  } else {
    user.preferenceSheets = user.preferenceSheets
      .slice(0, MAX_PREFERENCE_SHEETS)
      .map((sheet, index) =>
        normalizePreferenceSheet(sheet, defaultSheetName(index + 1)),
      );
  }
  if (
    !user.activePreferenceSheetId ||
    !user.preferenceSheets.some((sheet) => sheet.id === user.activePreferenceSheetId)
  ) {
    user.activePreferenceSheetId = user.preferenceSheets[0].id;
  }
  user.preferences = getActivePreferenceSheet(user).preferences;
  if (!Array.isArray(user.history)) {
    user.history = [];
  }
  if (!Array.isArray(user.visitHistory)) {
    user.visitHistory = [];
  } else {
    user.visitHistory = user.visitHistory
      .map((entry) => sanitizeVisitEntry(entry))
      .filter(Boolean)
      .slice(-MAX_HISTORY);
  }
  if (!Array.isArray(user.favorites)) {
    user.favorites = [];
  }
  if (!Array.isArray(user.sessions)) {
    user.sessions = [];
  }
  user.sessions = user.sessions
    .map((session) => ({
      token: normalizeStoredSessionToken(session?.token),
      expiresAt: Number(session?.expiresAt || 0),
    }))
    .filter((session) => session.token && session.expiresAt > Date.now())
    .slice(-MAX_SESSIONS_PER_USER);
  return user;
}

function normalizeIsoString(value, fallback = new Date().toISOString()) {
  if (!value) return fallback;
  const next = new Date(value);
  return Number.isNaN(next.getTime()) ? fallback : next.toISOString();
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function mapFavoriteRowToFavorite(row) {
  return sanitizeFavorite({
    id: row.id,
    name: row.name,
    reason: row.reason,
    address: row.address,
    imageUrl: row.image_url,
    placeId: row.place_id,
    location:
      row.location_lat == null || row.location_lng == null
        ? null
        : { lat: Number(row.location_lat), lng: Number(row.location_lng) },
    category: row.category,
    rating: row.rating,
    keywords: parseJsonArray(row.keywords),
    featureTags: parseJsonArray(row.feature_tags),
    links: parseJsonObject(row.links),
    distanceKm: row.distance_km,
    travelDuration: row.travel_duration,
    routeSummary: row.route_summary,
    source: row.source,
    savedAt: normalizeIsoString(row.created_at),
  });
}

function mapVisitRowToVisit(row) {
  return sanitizeVisitEntry({
    id: row.id,
    query: row.query,
    personalizationApplied: row.personalization_applied,
    name: row.name,
    reason: row.reason,
    address: row.address,
    imageUrl: row.image_url,
    placeId: row.place_id,
    location:
      row.location_lat == null || row.location_lng == null
        ? null
        : { lat: Number(row.location_lat), lng: Number(row.location_lng) },
    category: row.category,
    rating: row.rating,
    keywords: parseJsonArray(row.keywords),
    featureTags: parseJsonArray(row.feature_tags),
    links: parseJsonObject(row.links),
    distanceKm: row.distance_km,
    travelDuration: row.travel_duration,
    routeSummary: row.route_summary,
    source: row.source,
    createdAt: normalizeIsoString(row.created_at),
  });
}

function mapUserGraphFromDb(
  userRow,
  sheetRows = [],
  historyRows = [],
  visitRows = [],
  favoriteRows = [],
  sessionRows = [],
) {
  const preferenceSheets = sheetRows.map((sheet, index) =>
    normalizePreferenceSheet(
      {
        id: sheet.id,
        name: sheet.name,
        preferences: {
          favoriteCuisine: sheet.favorite_cuisine,
          mood: sheet.mood,
          budget: sheet.budget,
          maxDistanceKm:
            sheet.max_distance_km == null ? "" : String(parseNullableNumber(sheet.max_distance_km)),
          avoidIngredients: sheet.avoid_ingredients,
        },
        createdAt: normalizeIsoString(sheet.created_at),
        updatedAt: normalizeIsoString(sheet.updated_at),
      },
      defaultSheetName(index + 1),
    ),
  );

  const activeSheet = sheetRows.find((sheet) => sheet.is_active) || sheetRows[0];

  return ensureUserDataShape({
    id: userRow.id,
    name: userRow.name,
    email: userRow.email,
    authProvider: userRow.auth_provider,
    passwordHash: userRow.password_hash,
    createdAt: normalizeIsoString(userRow.created_at),
    updatedAt: normalizeIsoString(userRow.updated_at),
    preferences:
      preferenceSheets.find((sheet) => sheet.id === activeSheet?.id)?.preferences || defaultPreferences(),
    preferenceSheets,
    activePreferenceSheetId: activeSheet?.id || preferenceSheets[0]?.id || null,
    history: historyRows.map((row) => ({
      id: row.id,
      query: row.query,
      personalizationApplied: row.personalization_applied,
      createdAt: normalizeIsoString(row.created_at),
    })),
    visitHistory: visitRows.map(mapVisitRowToVisit).filter(Boolean),
    favorites: favoriteRows.map(mapFavoriteRowToFavorite).filter(Boolean),
    sessions: sessionRows.map((row) => ({
      token: String(row.token || "").trim(),
      expiresAt: new Date(row.expires_at).getTime(),
    })),
  });
}

async function withDbClient(run) {
  if (!dbPool) {
    throw new Error("DEV_DATABASE_URL 또는 PROD_DATABASE_URL이 설정되지 않았습니다.");
  }
  const client = await dbPool.connect();
  try {
    return await run(client);
  } finally {
    client.release();
  }
}

async function ensureAuthProviderSchema() {
  if (!authProviderSchemaReadyPromise) {
    authProviderSchemaReadyPromise = withDbClient(async (client) => {
      await client.query(
        `alter table public.app_users
           add column if not exists auth_provider text not null default 'local'`,
      );
    }).catch((error) => {
      authProviderSchemaReadyPromise = null;
      throw error;
    });
  }

  return authProviderSchemaReadyPromise;
}

async function loadDbUserGraphById(userId) {
  await ensureAuthProviderSchema();
  const userResult = await dbPool.query(
    `select id, email, name, auth_provider, password_hash, created_at, updated_at
       from public.app_users
      where id = $1
      limit 1`,
    [userId],
  );
  if (!userResult.rowCount) return null;

  const [sheetResult, historyResult, visitResult, favoriteResult, sessionResult] = await Promise.all([
    dbPool.query(
      `select id, user_id, name, favorite_cuisine, mood, budget, max_distance_km, avoid_ingredients,
              is_active, created_at, updated_at
         from public.preference_sheets
        where user_id = $1
        order by created_at asc, id asc`,
      [userId],
    ),
    dbPool.query(
      `select id, user_id, query, personalization_applied, created_at
         from public.search_history
        where user_id = $1
        order by created_at asc, id asc`,
      [userId],
    ),
    dbPool.query(
      `select id, user_id, query, personalization_applied, name, reason, address, image_url, place_id,
              category, rating, keywords, feature_tags, links, distance_km, travel_duration,
              route_summary, source, location_lat, location_lng, created_at
         from public.visit_history
        where user_id = $1
        order by created_at asc, id asc`,
      [userId],
    ),
    dbPool.query(
      `select id, user_id, place_id, name, reason, address, image_url, category, rating, keywords,
              feature_tags, links, distance_km, travel_duration, route_summary, source, location_lat,
              location_lng, created_at, updated_at
         from public.favorite_restaurants
        where user_id = $1
        order by created_at asc, id asc`,
      [userId],
    ),
    dbPool.query(
      `select id, user_id, token, expires_at, created_at
         from public.user_sessions
        where user_id = $1
          and expires_at > timezone('utc', now())
        order by created_at asc, id asc`,
      [userId],
    ),
  ]);

  return mapUserGraphFromDb(
    userResult.rows[0],
    sheetResult.rows,
    historyResult.rows,
    visitResult.rows,
    favoriteResult.rows,
    sessionResult.rows,
  );
}

async function getUserByEmail(email) {
  const result = await dbPool.query(
    `select id
       from public.app_users
      where email = $1
      limit 1`,
    [email],
  );
  return result.rowCount ? loadDbUserGraphById(result.rows[0].id) : null;
}

async function getUserByLoginIdentifier(rawIdentifier) {
  const identifier = normalizeEmail(rawIdentifier);
  if (!identifier) return null;

  if (identifier.includes("@")) {
    return getUserByEmail(identifier);
  }

  const result = await dbPool.query(
    `select id
       from public.app_users
      where split_part(email, '@', 1) = $1
      limit 1`,
    [identifier],
  );
  return result.rowCount ? loadDbUserGraphById(result.rows[0].id) : null;
}

async function createUserRecord({ id, name, email, passwordHash, createdAt, authProvider }) {
  await ensureAuthProviderSchema();
  const newUser = ensureUserDataShape({
    id,
    name,
    email,
    authProvider,
    passwordHash,
    createdAt: createdAt || new Date().toISOString(),
  });

  await withDbClient(async (client) => {
    await client.query("begin");
    try {
      await client.query(
        `insert into public.app_users (
           id, email, name, auth_provider, password_hash, created_at, updated_at
         ) values ($1, $2, $3, $4, $5, $6, $6)`,
        [
          newUser.id,
          newUser.email,
          newUser.name,
          newUser.authProvider,
          newUser.passwordHash,
          normalizeIsoString(newUser.createdAt),
        ],
      );

      for (const [index, sheet] of newUser.preferenceSheets.entries()) {
        await client.query(
          `insert into public.preference_sheets (
             id, user_id, name, favorite_cuisine, mood, budget, max_distance_km,
             avoid_ingredients, is_active, created_at, updated_at
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            sheet.id,
            newUser.id,
            sheet.name,
            sheet.preferences.favoriteCuisine,
            sheet.preferences.mood,
            sheet.preferences.budget,
            parseMaxDistanceKm(sheet.preferences.maxDistanceKm),
            sheet.preferences.avoidIngredients,
            sheet.id === newUser.activePreferenceSheetId || (!newUser.activePreferenceSheetId && index === 0),
            normalizeIsoString(sheet.createdAt),
            normalizeIsoString(sheet.updatedAt),
          ],
        );
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });

  return loadDbUserGraphById(newUser.id);
}

async function persistUserGraph(user) {
  const safe = ensureUserDataShape({ ...user });

  await withDbClient(async (client) => {
    await client.query("begin");
    try {
      await client.query(
        `update public.app_users
            set email = $2,
                name = $3,
                password_hash = $4,
                created_at = $5,
                updated_at = timezone('utc', now())
          where id = $1`,
        [safe.id, safe.email, safe.name, safe.passwordHash, normalizeIsoString(safe.createdAt)],
      );

      await client.query("delete from public.user_sessions where user_id = $1", [safe.id]);
      await client.query("delete from public.search_history where user_id = $1", [safe.id]);
      await client.query("delete from public.visit_history where user_id = $1", [safe.id]);
      await client.query("delete from public.favorite_restaurants where user_id = $1", [safe.id]);
      await client.query("delete from public.preference_sheets where user_id = $1", [safe.id]);

      for (const sheet of safe.preferenceSheets) {
        await client.query(
          `insert into public.preference_sheets (
             id, user_id, name, favorite_cuisine, mood, budget, max_distance_km,
             avoid_ingredients, is_active, created_at, updated_at
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            sheet.id,
            safe.id,
            sheet.name,
            sheet.preferences.favoriteCuisine,
            sheet.preferences.mood,
            sheet.preferences.budget,
            parseMaxDistanceKm(sheet.preferences.maxDistanceKm),
            sheet.preferences.avoidIngredients,
            sheet.id === safe.activePreferenceSheetId,
            normalizeIsoString(sheet.createdAt),
            normalizeIsoString(sheet.updatedAt),
          ],
        );
      }

      for (const historyEntry of safe.history) {
        await client.query(
          `insert into public.search_history (id, user_id, query, personalization_applied, created_at)
           values ($1, $2, $3, $4, $5)`,
          [
            historyEntry.id,
            safe.id,
            historyEntry.query,
            historyEntry.personalizationApplied || "",
            normalizeIsoString(historyEntry.createdAt),
          ],
        );
      }

      for (const visitEntry of safe.visitHistory || []) {
        const normalizedVisit = sanitizeVisitEntry(visitEntry);
        if (!normalizedVisit) continue;

        await client.query(
          `insert into public.visit_history (
             id, user_id, query, personalization_applied, name, reason, address, image_url, place_id,
             category, rating, keywords, feature_tags, links, distance_km, travel_duration, route_summary,
             source, location_lat, location_lng, created_at
           ) values (
             $1, $2, $3, $4, $5, $6, $7, $8, $9,
             $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15, $16, $17,
             $18, $19, $20, $21
           )`,
          [
            normalizedVisit.id,
            safe.id,
            normalizedVisit.query,
            normalizedVisit.personalizationApplied || "",
            normalizedVisit.name,
            normalizedVisit.reason,
            normalizedVisit.address,
            normalizedVisit.imageUrl,
            normalizedVisit.placeId,
            normalizedVisit.category,
            normalizedVisit.rating,
            JSON.stringify(normalizedVisit.keywords || []),
            JSON.stringify(normalizedVisit.featureTags || []),
            JSON.stringify(normalizedVisit.links || {}),
            normalizedVisit.distanceKm,
            normalizedVisit.travelDuration,
            normalizedVisit.routeSummary,
            normalizedVisit.source,
            normalizedVisit.location?.lat ?? null,
            normalizedVisit.location?.lng ?? null,
            normalizeIsoString(normalizedVisit.createdAt),
          ],
        );
      }

      for (const favorite of safe.favorites) {
        const normalizedFavorite = sanitizeFavorite(favorite);
        await client.query(
          `insert into public.favorite_restaurants (
             id, user_id, place_id, name, reason, address, image_url, category, rating, keywords,
             feature_tags, links, distance_km, travel_duration, route_summary, source, location_lat,
             location_lng, created_at, updated_at
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14, $15, $16, $17, $18, $19, $20)`,
          [
            normalizedFavorite.id,
            safe.id,
            normalizedFavorite.placeId,
            normalizedFavorite.name,
            normalizedFavorite.reason,
            normalizedFavorite.address,
            normalizedFavorite.imageUrl,
            normalizedFavorite.category,
            normalizedFavorite.rating,
            JSON.stringify(normalizedFavorite.keywords || []),
            JSON.stringify(normalizedFavorite.featureTags || []),
            JSON.stringify(normalizedFavorite.links || {}),
            normalizedFavorite.distanceKm,
            normalizedFavorite.travelDuration,
            normalizedFavorite.routeSummary,
            normalizedFavorite.source,
            normalizedFavorite.location?.lat ?? null,
            normalizedFavorite.location?.lng ?? null,
            normalizeIsoString(normalizedFavorite.savedAt),
            normalizeIsoString(normalizedFavorite.savedAt),
          ],
        );
      }

      for (const session of safe.sessions) {
        await client.query(
          `insert into public.user_sessions (id, user_id, token, expires_at, created_at)
           values ($1, $2, $3, $4, $5)`,
          [
            crypto.randomUUID(),
            safe.id,
            normalizeStoredSessionToken(session.token),
            normalizeIsoString(session.expiresAt),
            normalizeIsoString(Date.now()),
          ],
        );
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });

  return loadDbUserGraphById(safe.id);
}

async function updateUserById(userId, updater) {
  const current = await getUserById(userId);
  if (!current) return null;
  const nextUser = updater(ensureUserDataShape({ ...current }));
  return persistUserGraph(nextUser);
}

async function getUserById(userId) {
  return loadDbUserGraphById(userId);
}

async function getUserBySessionToken(token) {
  const rawToken = String(token || "").trim();
  if (!rawToken) return null;

  const normalizedToken = normalizeStoredSessionToken(rawToken);
  await dbPool.query("delete from public.user_sessions where expires_at <= timezone('utc', now())");
  const result = await dbPool.query(
    `select id, user_id, token
       from public.user_sessions
      where token = any($1::text[])
        and expires_at > timezone('utc', now())
      limit 1`,
    [[...new Set([normalizedToken, rawToken])]],
  );
  if (!result.rowCount) return null;

  const matchedSession = result.rows[0];
  if (matchedSession.token !== normalizedToken) {
    await dbPool.query(
      `update public.user_sessions
          set token = $2
        where id = $1`,
      [matchedSession.id, normalizedToken],
    );
  }

  return loadDbUserGraphById(matchedSession.user_id);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto
    .pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 64, "sha512")
    .toString("hex");
  return `${salt}:${hash}`;
}

function createUnusablePasswordHash() {
  return hashPassword(crypto.randomBytes(48).toString("hex"));
}

function verifyPassword(password, storedHash) {
  const [salt, originalHash] = String(storedHash || "").split(":");
  if (!salt || !originalHash) return false;
  const nextHash = crypto
    .pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 64, "sha512")
    .toString("hex");
  const left = Buffer.from(originalHash, "hex");
  const right = Buffer.from(nextHash, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizePreferences(raw) {
  const base = defaultPreferences();
  const next = {
    favoriteCuisine: String(raw?.favoriteCuisine || "").trim().slice(0, 50),
    mood: String(raw?.mood || "").trim().slice(0, 50),
    budget: String(raw?.budget || "").trim().slice(0, 30),
    maxDistanceKm: String(raw?.maxDistanceKm || "").trim().slice(0, 10),
    avoidIngredients: String(raw?.avoidIngredients || "").trim().slice(0, 120),
  };
  return { ...base, ...next };
}

function parseMaxDistanceKm(raw) {
  const normalized = String(raw || "")
    .trim()
    .replace(/,/g, ".");
  if (!normalized) return null;
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(value, 100);
}

function parseCoordinate(value) {
  const next = Number(value);
  if (!Number.isFinite(next)) return null;
  if (next < -180 || next > 180) return null;
  return next;
}

function parseCurrentLocation(raw) {
  if (!raw || typeof raw !== "object") return null;
  const lat = parseCoordinate(raw.lat);
  const lng = parseCoordinate(raw.lng);
  if (lat == null || lng == null) return null;
  if (lat < -90 || lat > 90) return null;
  return { lat, lng };
}

function parseNullableNumber(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function sanitizeFavorite(raw) {
  const name = String(raw?.name || "").trim().slice(0, 120);
  if (!name) return null;

  return {
    id: raw?.id ? String(raw.id) : crypto.randomUUID(),
    name,
    reason: String(raw?.reason || "").trim().slice(0, 300),
    address: String(raw?.address || "").trim().slice(0, 240),
    imageUrl: String(raw?.imageUrl || "").trim(),
    placeId: String(raw?.placeId || "").trim().slice(0, 120),
    location: parseCurrentLocation(raw?.location),
    category: String(raw?.category || "").trim().slice(0, 60),
    rating: parseNullableNumber(raw?.rating),
    keywords: Array.isArray(raw?.keywords)
      ? raw.keywords.map((entry) => String(entry || "").trim()).filter(Boolean).slice(0, 10)
      : [],
    featureTags: Array.isArray(raw?.featureTags)
      ? raw.featureTags.map((entry) => String(entry || "").trim()).filter(Boolean).slice(0, 10)
      : [],
    distanceKm: parseNullableNumber(raw?.distanceKm),
    travelDuration: String(raw?.travelDuration || "").trim().slice(0, 80),
    routeSummary: String(raw?.routeSummary || "").trim().slice(0, 180),
    source: String(raw?.source || "").trim().slice(0, 40),
    links: raw?.links && typeof raw.links === "object" ? raw.links : {},
    savedAt: raw?.savedAt || new Date().toISOString(),
  };
}

function sanitizeVisitEntry(raw) {
  const normalizedFavorite = sanitizeFavorite({
    ...raw,
    name: raw?.name || raw?.query || "",
    savedAt: raw?.createdAt || new Date().toISOString(),
  });
  if (!normalizedFavorite) return null;

  const query = String(raw?.query || normalizedFavorite.name).trim().slice(0, 300);
  if (!query) return null;

  return {
    id: raw?.id ? String(raw.id) : crypto.randomUUID(),
    query,
    personalizationApplied: String(raw?.personalizationApplied || "").trim().slice(0, 300),
    name: normalizedFavorite.name,
    reason: normalizedFavorite.reason,
    address: normalizedFavorite.address,
    imageUrl: normalizedFavorite.imageUrl,
    placeId: normalizedFavorite.placeId,
    location: normalizedFavorite.location,
    category: normalizedFavorite.category,
    rating: normalizedFavorite.rating,
    keywords: normalizedFavorite.keywords,
    featureTags: normalizedFavorite.featureTags,
    links: normalizedFavorite.links,
    distanceKm: normalizedFavorite.distanceKm,
    travelDuration: normalizedFavorite.travelDuration,
    routeSummary: normalizedFavorite.routeSummary,
    source: String(raw?.source || normalizedFavorite.source || "").trim().slice(0, 40),
    createdAt: normalizeIsoString(raw?.createdAt),
  };
}

function sanitizeUser(user) {
  const safe = ensureUserDataShape({ ...user });
  return {
    id: safe.id,
    name: safe.name,
    email: safe.email,
    createdAt: safe.createdAt,
    preferences: safe.preferences,
    activePreferenceSheetId: safe.activePreferenceSheetId,
    preferenceSheetCount: safe.preferenceSheets.length,
    historyCount: safe.history.length,
    visitHistoryCount: safe.visitHistory.length,
    favoritesCount: safe.favorites.length,
  };
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  await updateUserById(userId, (current) => ({
    ...current,
    sessions: [...(current.sessions || []), { token: normalizeStoredSessionToken(token), expiresAt }]
      .slice(-MAX_SESSIONS_PER_USER),
  }));
  return token;
}

async function requireAuth(req, res, next) {
  const token = readSessionToken(req);
  if (!token) {
    return res.status(401).json({ error: "로그인이 필요합니다." });
  }

  try {
    const matchedUser = await getUserBySessionToken(token);
    if (!matchedUser) {
      clearSessionCookie(res, req, { publicOrigin: API_PUBLIC_ORIGIN });
      return res.status(401).json({ error: "로그인 세션이 만료되었습니다. 다시 로그인해 주세요." });
    }

    req.authToken = token;
    req.authTokenHash = normalizeStoredSessionToken(token);
    req.user = sanitizeUser(matchedUser);
    next();
  } catch (error) {
    next(error);
  }
}

async function optionalAuth(req, res, next) {
  const token = readSessionToken(req);
  if (!token) {
    req.authToken = null;
    req.authTokenHash = null;
    req.user = null;
    return next();
  }

  try {
    const matchedUser = await getUserBySessionToken(token);
    if (!matchedUser) {
      clearSessionCookie(res, req, { publicOrigin: API_PUBLIC_ORIGIN });
    }
    req.authToken = matchedUser ? token : null;
    req.authTokenHash = matchedUser ? normalizeStoredSessionToken(token) : null;
    req.user = matchedUser ? sanitizeUser(matchedUser) : null;
    next();
  } catch (error) {
    next(error);
  }
}

let ai;
function getAI() {
  if (!ai && API_KEY?.trim()) {
    ai = new GoogleGenAI({ apiKey: API_KEY.trim() });
  }
  return ai;
}

function describeEmptyResponse(response) {
  const block = response.promptFeedback?.blockReason;
  if (block) {
    return `요청이 차단되었습니다. (${block})`;
  }
  const c0 = response.candidates?.[0];
  if (c0?.finishReason && c0.finishReason !== "STOP") {
    return `응답이 정상 종료되지 않았습니다. (finishReason: ${c0.finishReason})`;
  }
  return "";
}

function getResponseText(response) {
  const sdk = (response.text ?? "").trim();
  if (sdk) return sdk;
  const parts = response.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p) => (typeof p?.text === "string" ? p.text : ""))
    .join("")
    .trim();
}

function sanitizeImageSearchQuery(raw) {
  const s = String(raw || "korean food")
    .trim()
    .replace(/["'<>{}[\]]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 120);
  return s || "korean food";
}

function toHttpsImageUrl(u) {
  if (typeof u !== "string" || !u.trim()) return null;
  const t = u.trim();
  if (!/^https?:\/\//i.test(t)) return null;
  return t.replace(/^http:\/\//i, "https://");
}

async function fetchUnsplashImage(query) {
  if (!UNSPLASH_ACCESS_KEY) return null;
  try {
    const url = `https://api.unsplash.com/search/photos?per_page=1&orientation=landscape&query=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const hit = data.results?.[0]?.urls;
    return (
      toHttpsImageUrl(hit?.regular) ||
      toHttpsImageUrl(hit?.small) ||
      toHttpsImageUrl(hit?.full) ||
      null
    );
  } catch {
    return null;
  }
}

const FALLBACK_FOOD_IMAGES = [
  "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Korean.food-Bibimbap-01.jpg/800px-Korean.food-Bibimbap-01.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Good_Food_Display_-_NCI_Visuals_Online.jpg/800px-Good_Food_Display_-_NCI_Visuals_Online.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/thumb/7/72/Sushi_Roll.jpg/800px-Sushi_Roll.jpg",
];

function picsumFallbackUrl(index) {
  const seeds = ["bibimbap", "kbbq", "kfood"];
  return `https://picsum.photos/seed/${seeds[index % seeds.length]}-${index}/800/500`;
}

async function fetchCommonsImage(searchPhrase) {
  const tries = [
    searchPhrase,
    `${searchPhrase} food`,
    "Korean cuisine",
    "bibimbap",
  ];
  const headers = {
    "User-Agent": "CapstoneRestaurantRecommend/1.0 (educational; Node.js)",
  };

  for (const phrase of tries) {
    const q = encodeURIComponent(phrase.trim());
    const apiUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${q}&gsrnamespace=6&gsrlimit=1&prop=imageinfo&iiprop=url|thumburl&iiurlwidth=800`;
    try {
      const res = await fetch(apiUrl, { headers });
      if (!res.ok) continue;
      const data = await res.json();
      const pages = data.query?.pages;
      if (!pages || !Object.keys(pages).length) continue;
      const first = Object.values(pages).find((p) => p && !p.missing);
      if (!first) continue;
      const ii = first.imageinfo?.[0];
      const out =
        toHttpsImageUrl(ii?.thumburl) || toHttpsImageUrl(ii?.url) || null;
      if (out) return out;
    } catch {
      continue;
    }
  }
  return null;
}

async function resolveImageUrl(imageQuery, index) {
  const base = sanitizeImageSearchQuery(imageQuery);
  const q = /korea|korean|food/i.test(base) ? base : `${base} korean`;

  try {
    const fromUnsplash = await fetchUnsplashImage(q);
    if (fromUnsplash) return fromUnsplash;

    const fromCommons = await fetchCommonsImage(q);
    if (fromCommons) return fromCommons;

    return FALLBACK_FOOD_IMAGES[index % FALLBACK_FOOD_IMAGES.length];
  } catch (error) {
    console.warn("resolveImageUrl failed, using fallback:", error?.message || error);
    return picsumFallbackUrl(index);
  }
}

function ensureImageUrl(url, index) {
  const u = toHttpsImageUrl(url) || url;
  if (typeof u === "string" && /^https:\/\//i.test(u.trim())) {
    return u.trim();
  }
  return (
    FALLBACK_FOOD_IMAGES[index % FALLBACK_FOOD_IMAGES.length] ||
    picsumFallbackUrl(index)
  );
}

function nameForMapLinks(name) {
  return String(name || "")
    .replace(/\s*[,|]\s*(Republic\s+of\s+Korea|South\s+Korea|Korea)\s*$/i, "")
    .replace(/\s*\(\s*(Korea|South\s+Korea)\s*\)\s*$/i, "")
    .trim()
    .replace(/\s+/g, " ");
}

function buildPlaceLinks(name, options = {}) {
  const queryParts = [];
  const normalizedName = nameForMapLinks(name);
  const normalizedAddress =
    typeof options.address === "string" ? options.address.trim() : "";

  if (normalizedName) queryParts.push(normalizedName);
  if (normalizedAddress) queryParts.push(normalizedAddress);

  const encoded = encodeURIComponent(queryParts.join(" ").trim() || normalizedName || "留쏆쭛");
  const kakaoEncoded = encodeURIComponent(normalizedAddress || normalizedName || "留쏆쭛");
  return {
    naverMapUrl: `https://map.naver.com/v5/search/${encoded}`,
    kakaoMapUrl: `https://map.kakao.com/link/search/${kakaoEncoded}`,
    googleMapUrl: `https://www.google.com/maps/search/?api=1&query=${encoded}`,
  };
}

function buildGoogleMapUrl(name, options = {}) {
  const params = new URLSearchParams({ api: "1" });
  const queryParts = [];
  const normalizedName = nameForMapLinks(name);

  if (normalizedName) queryParts.push(normalizedName);
  if (typeof options.address === "string" && options.address.trim()) {
    queryParts.push(options.address.trim());
  }
  if (
    typeof options.lat === "number" &&
    typeof options.lng === "number"
  ) {
    queryParts.push(`${options.lat},${options.lng}`);
  }

  params.set("query", queryParts.join(" ") || normalizedName || "restaurant");

  if (typeof options.placeId === "string" && options.placeId.trim()) {
    params.set("query_place_id", options.placeId.trim());
  }

  return `https://www.google.com/maps/search/?${params.toString()}`;
}

function mapPriceLevelLabel(level) {
  if (level === 0 || level === "PRICE_LEVEL_FREE") return "무료";
  if (level === 1 || level === "PRICE_LEVEL_INEXPENSIVE") return "저가";
  if (level === 2 || level === "PRICE_LEVEL_MODERATE") return "중간";
  if (level === 3 || level === "PRICE_LEVEL_EXPENSIVE") return "고가";
  if (level === 4 || level === "PRICE_LEVEL_VERY_EXPENSIVE") return "매우 고가";
  return "";
}

function mapPriceLevelValue(level) {
  if (Number.isInteger(level)) return level;
  if (level === "무료") return 0;
  if (level === "저가") return 1;
  if (level === "중간") return 2;
  if (level === "고가") return 3;
  if (level === "매우 고가") return 4;
  return null;
}

function truthyLabel(target, key, label, output) {
  if (target?.[key]) output.push(label);
}

function normalizeLegacyPlaceDetails(place) {
  const services = [];
  const amenities = [];

  truthyLabel(place, "dine_in", "매장 식사", services);
  truthyLabel(place, "takeout", "포장", services);
  truthyLabel(place, "delivery", "배달", services);
  truthyLabel(place, "reservable", "예약 가능", services);
  truthyLabel(place, "serves_breakfast", "아침 식사", services);
  truthyLabel(place, "serves_brunch", "브런치", services);
  truthyLabel(place, "serves_lunch", "점심 식사", services);
  truthyLabel(place, "serves_dinner", "저녁 식사", services);
  truthyLabel(place, "serves_beer", "맥주", services);
  truthyLabel(place, "serves_wine", "와인", services);
  truthyLabel(place, "serves_vegetarian_food", "채식 메뉴", services);

  truthyLabel(place, "wheelchair_accessible_entrance", "휠체어 출입 가능", amenities);

  const currentHours = Array.isArray(place.current_opening_hours?.weekday_text)
    ? place.current_opening_hours.weekday_text.filter(Boolean)
    : [];
  const regularHours = Array.isArray(place.opening_hours?.weekday_text)
    ? place.opening_hours.weekday_text.filter(Boolean)
    : [];
  const reviews = Array.isArray(place.reviews)
    ? place.reviews
        .map((review, index) => ({
          id: `${place.place_id || "place"}-review-${index}`,
          authorName: String(review.author_name || "").trim() || "Google 사용자",
          rating: parseNullableNumber(review.rating),
          text: String(review.text || "").trim(),
          relativeTimeDescription: String(review.relative_time_description || "").trim(),
          publishTime: String(review.time || "").trim(),
          language: String(review.language || "").trim(),
          authorUrl: normalizeHttpUrl(review.author_url),
          profilePhotoUrl: normalizeHttpUrl(review.profile_photo_url),
        }))
        .filter((review) => review.text || review.rating != null)
    : [];

  return {
    placeId: String(place.place_id || "").trim(),
    name: String(place.name || "").trim(),
    address: String(place.formatted_address || "").trim(),
    googleMapsUri: normalizeHttpUrl(place.url) || "",
    websiteUri: normalizeHttpUrl(place.website) || "",
    nationalPhoneNumber: String(place.formatted_phone_number || "").trim(),
    internationalPhoneNumber: String(place.international_phone_number || "").trim(),
    rating: parseNullableNumber(place.rating),
    userRatingCount: parseNullableNumber(place.user_ratings_total),
    priceLevel: mapPriceLevelLabel(place.price_level),
    businessStatus: String(place.business_status || "").trim(),
    openNow:
      typeof place.current_opening_hours?.open_now === "boolean"
        ? place.current_opening_hours.open_now
        : typeof place.opening_hours?.open_now === "boolean"
          ? place.opening_hours.open_now
          : null,
    currentHours,
    regularHours,
    summary: String(place.editorial_summary?.overview || "").trim(),
    services,
    amenities,
    reviews,
  };
}

function normalizeCachedReview(raw, index, placeId) {
  return {
    id: String(raw?.id || `${placeId || "place"}-review-${index}`),
    authorName: String(raw?.authorName || raw?.author_name || "").trim() || "Google 사용자",
    rating: parseNullableNumber(raw?.rating),
    text: String(raw?.text || "").trim(),
    relativeTimeDescription: String(
      raw?.relativeTimeDescription || raw?.relative_time_description || "",
    ).trim(),
    publishTime: String(raw?.publishTime || raw?.publish_time || "").trim(),
    language: String(raw?.language || "").trim(),
    authorUrl: normalizeHttpUrl(raw?.authorUrl || raw?.author_url) || "",
    profilePhotoUrl: normalizeHttpUrl(raw?.profilePhotoUrl || raw?.profile_photo_url) || "",
  };
}

function mapCachedPlaceDetailsRow(row) {
  const amenityGroups = parseJsonObject(row.amenities);
  return {
    placeId: String(row.place_id || "").trim(),
    name: String(row.name || "").trim(),
    address: String(row.formatted_address || "").trim(),
    googleMapsUri: normalizeHttpUrl(row.google_maps_url) || "",
    websiteUri: normalizeHttpUrl(row.website) || "",
    nationalPhoneNumber: String(row.formatted_phone_number || "").trim(),
    internationalPhoneNumber: String(row.international_phone_number || "").trim(),
    rating: parseNullableNumber(row.rating),
    userRatingCount: parseNullableNumber(row.user_rating_count),
    priceLevel: mapPriceLevelLabel(row.price_level),
    businessStatus: String(row.business_status || "").trim(),
    openNow: null,
    currentHours: parseJsonArray(row.current_opening_hours).filter(Boolean),
    regularHours: parseJsonArray(row.regular_opening_hours).filter(Boolean),
    summary: String(row.editorial_summary || "").trim(),
    services: parseJsonArray(amenityGroups.services).filter(Boolean),
    amenities: parseJsonArray(amenityGroups.amenities).filter(Boolean),
    reviews: parseJsonArray(row.reviews)
      .map((review, index) => normalizeCachedReview(review, index, row.place_id))
      .filter((review) => review.text || review.rating != null),
  };
}

async function getCachedPlaceDetails(placeId) {
  const result = await dbPool.query(
    `select place_id, name, formatted_address, formatted_phone_number, international_phone_number,
            website, google_maps_url, price_level, rating, user_rating_count, editorial_summary,
            business_status, regular_opening_hours, current_opening_hours, reviews, amenities
       from public.place_details_cache
      where place_id = $1
      limit 1`,
    [placeId],
  );
  return result.rowCount ? mapCachedPlaceDetailsRow(result.rows[0]) : null;
}

async function savePlaceDetailsCache(place) {
  if (!place?.placeId) return;
  await dbPool.query(
    `insert into public.place_details_cache (
       place_id, name, formatted_address, formatted_phone_number, international_phone_number,
       website, google_maps_url, price_level, rating, user_rating_count, editorial_summary,
       business_status, regular_opening_hours, current_opening_hours, reviews, amenities,
       raw_payload, fetched_at, updated_at
     ) values (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10, $11,
       $12, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb,
       $17::jsonb, timezone('utc', now()), timezone('utc', now())
     )
     on conflict (place_id) do update
       set name = excluded.name,
           formatted_address = excluded.formatted_address,
           formatted_phone_number = excluded.formatted_phone_number,
           international_phone_number = excluded.international_phone_number,
           website = excluded.website,
           google_maps_url = excluded.google_maps_url,
           price_level = excluded.price_level,
           rating = excluded.rating,
           user_rating_count = excluded.user_rating_count,
           editorial_summary = excluded.editorial_summary,
           business_status = excluded.business_status,
           regular_opening_hours = excluded.regular_opening_hours,
           current_opening_hours = excluded.current_opening_hours,
           reviews = excluded.reviews,
           amenities = excluded.amenities,
           raw_payload = excluded.raw_payload,
           fetched_at = timezone('utc', now()),
           updated_at = timezone('utc', now())`,
    [
      place.placeId,
      place.name || "",
      place.address || "",
      place.nationalPhoneNumber || "",
      place.internationalPhoneNumber || "",
      place.websiteUri || "",
      place.googleMapsUri || "",
      mapPriceLevelValue(place.priceLevel),
      place.rating,
      place.userRatingCount,
      place.summary || "",
      place.businessStatus || "",
      JSON.stringify(place.regularHours || []),
      JSON.stringify(place.currentHours || []),
      JSON.stringify(place.reviews || []),
      JSON.stringify({
        services: place.services || [],
        amenities: place.amenities || [],
      }),
      JSON.stringify(place),
    ],
  );
}

async function fetchGooglePlaceDetails(placeId) {
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error("GOOGLE_MAPS_API_KEY is not configured.");
  }

  const cached = await runNonCriticalOperation(
    () => getCachedPlaceDetails(placeId),
    {
      fallbackValue: null,
      onError(error) {
        console.warn(`[place-details-cache] read failed for ${placeId}: ${error.message}`);
      },
    },
  );
  if (cached) {
    return cached;
  }

  const fields = [
    "place_id",
    "name",
    "formatted_address",
    "formatted_phone_number",
    "international_phone_number",
    "website",
    "url",
    "current_opening_hours",
    "opening_hours",
    "price_level",
    "rating",
    "user_ratings_total",
    "editorial_summary",
    "reviews",
    "delivery",
    "dine_in",
    "takeout",
    "reservable",
    "serves_beer",
    "serves_breakfast",
    "serves_brunch",
    "serves_dinner",
    "serves_lunch",
    "serves_vegetarian_food",
    "serves_wine",
    "wheelchair_accessible_entrance",
    "business_status",
  ];
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("language", "ko");
  url.searchParams.set("region", "kr");
  url.searchParams.set("reviews_no_translations", "true");
  url.searchParams.set("fields", fields.join(","));
  url.searchParams.set("key", GOOGLE_MAPS_API_KEY);

  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error_message || "Google Place Details request failed.");
    error.statusCode = response.status;
    throw error;
  }

  const status = String(payload?.status || "").trim();
  if (status && status !== "OK") {
    const error = new Error(payload?.error_message || `Google Place Details error: ${status}`);
    error.statusCode = status === "NOT_FOUND" ? 404 : 502;
    throw error;
  }

  const normalized = normalizeLegacyPlaceDetails(payload?.result || {});
  await runNonCriticalOperation(
    () => savePlaceDetailsCache(normalized),
    {
      fallbackValue: null,
      onError(error) {
        console.warn(`[place-details-cache] write failed for ${placeId}: ${error.message}`);
      },
    },
  );
  return normalized;
}

function normalizeHttpUrl(maybe) {
  if (typeof maybe !== "string") return null;
  const s = maybe.trim();
  if (!/^https?:\/\//i.test(s)) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

function parseItemsFromText(text) {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    if (Array.isArray(parsed?.items) && parsed.items.length >= 1) {
      return parsed.items.slice(0, 3);
    }
  } catch {
    return null;
  }
  return null;
}

function isFoodPlace(place) {
  return (place.types || []).some((t) => FOOD_PLACE_TYPES.has(t));
}

async function placesTextSearch(query) {
  const baseParams = {
    query,
    language: "ko",
    region: "kr",
    key: GOOGLE_MAPS_API_KEY,
  };

  const trySearch = async (extra) => {
    const params = new URLSearchParams({ ...baseParams, ...extra });
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`;
    const res = await fetch(url);
    return res.json();
  };

  let data = await trySearch({ type: "restaurant" });
  if (data.status === "ZERO_RESULTS") {
    data = await trySearch({});
  }

  if (data.status === "REQUEST_DENIED" || data.status === "INVALID_REQUEST") {
    throw new Error(
      `Google Places error: ${data.status}${data.error_message ? ` - ${data.error_message}` : ""}`,
    );
  }

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(
      `Google Places error: ${data.status}${data.error_message ? ` - ${data.error_message}` : ""}`,
    );
  }

  return Array.isArray(data.results) ? data.results : [];
}

async function placesNearbySearch(query, originLocation, radiusMeters) {
  const baseParams = {
    location: `${originLocation.lat},${originLocation.lng}`,
    radius: String(radiusMeters),
    language: "ko",
    region: "kr",
    key: GOOGLE_MAPS_API_KEY,
  };

  const trySearch = async (extra) => {
    const params = new URLSearchParams({ ...baseParams, ...extra });
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params}`;
    const res = await fetch(url);
    return res.json();
  };

  let data = await trySearch({ keyword: query, type: "restaurant" });
  if (data.status === "ZERO_RESULTS") {
    data = await trySearch({ keyword: query });
  }

  if (data.status === "REQUEST_DENIED" || data.status === "INVALID_REQUEST") {
    throw new Error(
      `Google Places Nearby error: ${data.status}${data.error_message ? ` - ${data.error_message}` : ""}`,
    );
  }

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(
      `Google Places Nearby error: ${data.status}${data.error_message ? ` - ${data.error_message}` : ""}`,
    );
  }

  return Array.isArray(data.results) ? data.results : [];
}

async function geocodeSearchCenter(query) {
  const params = new URLSearchParams({
    address: query,
    language: "ko",
    region: "kr",
    key: GOOGLE_MAPS_API_KEY,
  });
  const url = `https://maps.googleapis.com/maps/api/geocode/json?${params}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.status === "REQUEST_DENIED" || data.status === "INVALID_REQUEST") {
    throw new Error(
      `Google Geocoding error: ${data.status}${data.error_message ? ` - ${data.error_message}` : ""}`,
    );
  }

  if (data.status !== "OK") {
    return null;
  }

  const location = data.results?.[0]?.geometry?.location;
  if (
    typeof location?.lat !== "number" ||
    typeof location?.lng !== "number"
  ) {
    return null;
  }

  return { lat: location.lat, lng: location.lng };
}

function haversineDistanceKm(from, to) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) *
      Math.cos(toRad(to.lat)) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function tokenizePreferenceText(value) {
  return [...new Set(
    String(value || "")
      .toLowerCase()
      .split(/[,\n/|]+/)
      .flatMap((part) => part.split(/\s+/))
      .map((part) => part.trim())
      .filter((part) => part.length >= 2),
  )].slice(0, 8);
}

function normalizeSearchableText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function buildBudgetQueryHint(budget) {
  const normalized = String(budget || "").trim();
  if (!normalized) return "";
  if (normalized === "저가") return "가성비";
  if (normalized === "중간") return "적당한 가격";
  if (normalized === "고가") return "고급";
  return normalized;
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function buildPlacesSearchQueries(input, preferences = defaultPreferences()) {
  const baseQuery = String(input || "").trim();
  const cuisine = String(preferences.favoriteCuisine || "").trim();
  const mood = String(preferences.mood || "").trim();
  const budgetHint = buildBudgetQueryHint(preferences.budget);

  return uniqueStrings([
    [baseQuery, cuisine, mood, budgetHint].filter(Boolean).join(" "),
    [baseQuery, cuisine, budgetHint].filter(Boolean).join(" "),
    [baseQuery, mood].filter(Boolean).join(" "),
    baseQuery,
  ]).slice(0, 4);
}

async function fetchCandidatePlaces(input, preferences = defaultPreferences(), options = {}) {
  const queries = buildPlacesSearchQueries(input, preferences);
  const maxDistanceKm = Number.isFinite(options.maxDistanceKm) ? options.maxDistanceKm : null;
  const useNearbySearch = shouldUseNearbyCandidateSearch(options.originLocation, maxDistanceKm);
  const nearbyRadiusMeters = useNearbySearch ? buildNearbyRadiusMeters(maxDistanceKm) : null;
  const resultSets = await Promise.all(
    queries.map((query) =>
      useNearbySearch
        ? placesNearbySearch(query, options.originLocation, nearbyRadiusMeters)
        : placesTextSearch(query),
    ),
  );
  const merged = new Map();

  resultSets.forEach((results, queryIndex) => {
    results
      .filter(isFoodPlace)
      .forEach((place, resultIndex) => {
        const key =
          place.place_id ||
          `${nameForMapLinks(place.name)}|${String(place.formatted_address || "").trim()}`;
        const existing = merged.get(key);
        const next = {
          place,
          queryIndex,
          resultIndex,
          matchedQuery: queries[queryIndex] || String(input || "").trim(),
        };

        if (
          !existing ||
          queryIndex < existing.queryIndex ||
          (queryIndex === existing.queryIndex && resultIndex < existing.resultIndex)
        ) {
          merged.set(key, next);
        }
      });
  });

  return {
    queries,
    candidates: Array.from(merged.values()),
  };
}

function scoreBudgetMatch(place, budget) {
  const normalized = String(budget || "").trim();
  const priceLevel = Number(place?.price_level);
  if (!normalized || !Number.isFinite(priceLevel)) return 0;
  if (normalized === "저가") {
    if (priceLevel <= 1) return 5;
    if (priceLevel >= 3) return -4;
    return 1;
  }
  if (normalized === "중간") {
    if (priceLevel === 2) return 5;
    if (priceLevel === 1 || priceLevel === 3) return 2;
    return -1;
  }
  if (normalized === "고가") {
    if (priceLevel >= 3) return 5;
    if (priceLevel <= 1) return -4;
    return 1;
  }
  return 0;
}

function scorePlaceForPreferences(place, preferences, context = {}) {
  const searchableText = normalizeSearchableText([
    place.name,
    place.formatted_address,
    ...(Array.isArray(place.types) ? place.types : []),
  ].join(" "));
  const cuisineTokens = tokenizePreferenceText(preferences.favoriteCuisine);
  const moodTokens = tokenizePreferenceText(preferences.mood);
  const avoidTokens = tokenizePreferenceText(preferences.avoidIngredients);

  let score = 0;
  const signals = [];

  if (context.queryIndex === 0 && context.queryCount > 1) {
    score += 8;
    signals.push("시트 조건 검색 반영");
  } else if (typeof context.queryIndex === "number") {
    score += Math.max(0, 4 - context.queryIndex);
  }

  const cuisineMatches = cuisineTokens.filter((token) => searchableText.includes(token)).length;
  if (cuisineMatches > 0) {
    score += cuisineMatches * 10;
    signals.push("선호 음식 반영");
  }

  const moodMatches = moodTokens.filter((token) => searchableText.includes(token)).length;
  if (moodMatches > 0) {
    score += moodMatches * 6;
    signals.push("분위기 반영");
  }

  const budgetScore = scoreBudgetMatch(place, preferences.budget);
  if (budgetScore !== 0) {
    score += budgetScore;
    if (budgetScore > 0) {
      signals.push("예산 반영");
    }
  }

  const avoidMatches = avoidTokens.filter((token) => searchableText.includes(token)).length;
  if (avoidMatches > 0) {
    score -= avoidMatches * 12;
    signals.push("기피 재료 주의");
  }

  if (typeof place.rating === "number") {
    score += place.rating * 1.2;
  }
  if (typeof place.user_ratings_total === "number" && place.user_ratings_total > 0) {
    score += Math.min(4, Math.log10(place.user_ratings_total + 1) * 1.5);
  }
  if (context.distanceKm != null) {
    score -= Math.min(context.distanceKm, 20) * 0.35;
  }

  return {
    score,
    signals: uniqueStrings(signals),
  };
}

function buildDirectionsUrl(origin, destination) {
  const originText = `${origin.lat},${origin.lng}`;
  const destinationText = `${destination.lat},${destination.lng}`;
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originText)}&destination=${encodeURIComponent(destinationText)}&travelmode=driving`;
}

function buildFutureDepartureTime(minutesAhead = 2) {
  return new Date(Date.now() + minutesAhead * 60 * 1000).toISOString();
}

async function fetchDistanceMatrix(origin, places) {
  if (!origin || !places.length || !GOOGLE_MAPS_API_KEY) {
    return new Map();
  }

  const validPlaces = [];
  for (const place of places) {
    const location = place.geometry?.location;
    if (
      typeof location?.lat === "number" &&
      typeof location?.lng === "number"
    ) {
      validPlaces.push({
        key: place.place_id || `${validPlaces.length}`,
        destination: `${location.lat},${location.lng}`,
      });
    }
  }

  if (!validPlaces.length) return new Map();

  const matrix = new Map();
  const MAX_DESTINATIONS_PER_REQUEST = 100;

  for (let start = 0; start < validPlaces.length; start += MAX_DESTINATIONS_PER_REQUEST) {
    const batch = validPlaces.slice(start, start + MAX_DESTINATIONS_PER_REQUEST);
    const body = {
      origins: [
        {
          waypoint: {
            location: {
              latLng: {
                latitude: origin.lat,
                longitude: origin.lng,
              },
            },
          },
        },
      ],
      destinations: batch.map((entry) => {
        const [lat, lng] = entry.destination.split(",").map(Number);
        return {
          waypoint: {
            location: {
              latLng: {
                latitude: lat,
                longitude: lng,
              },
            },
          },
        };
      }),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE_OPTIMAL",
      departureTime: buildFutureDepartureTime(),
      languageCode: "ko-KR",
      regionCode: "KR",
      units: "METRIC",
    };
    const res = await fetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask":
          "originIndex,destinationIndex,distanceMeters,duration,status,condition,localizedValues",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!res.ok) {
      const firstError = Array.isArray(data) ? data[0]?.error || data[0] : null;
      const errorMessage =
        firstError?.message || data?.error?.message || data?.message || `HTTP ${res.status}`;
      throw new Error(`Google Compute Route Matrix error: ${errorMessage}`);
    }

    if (!Array.isArray(data)) continue;

    data.forEach((element) => {
      const destinationIndex = Number(element?.destinationIndex);
      if (!Number.isInteger(destinationIndex) || destinationIndex < 0 || destinationIndex >= batch.length) {
        return;
      }
      if (element?.condition && element.condition !== "ROUTE_EXISTS") {
        return;
      }
      if (Number(element?.status?.code || 0) !== 0) {
        return;
      }

      const entry = batch[destinationIndex];
      if (!entry) return;

      const distanceMeters =
        typeof element.distanceMeters === "number" ? element.distanceMeters : null;
      const localizedValues = element.localizedValues || {};
      const localizedDistance = String(localizedValues.distance?.text || "").trim();
      const localizedDuration = String(localizedValues.duration?.text || "").trim();

      matrix.set(entry.key, {
        distanceKm: distanceMeters != null ? distanceMeters / 1000 : null,
        distanceText: localizedDistance,
        durationText: localizedDuration,
      });
    });
  }

  return matrix;
}

async function fetchDirectionsSummary(origin, place) {
  if (!origin || !GOOGLE_MAPS_API_KEY) return null;
  const location = place.geometry?.location;
  if (
    typeof location?.lat !== "number" ||
    typeof location?.lng !== "number"
  ) {
    return null;
  }

  const params = new URLSearchParams({
    origin: `${origin.lat},${origin.lng}`,
    destination: `${location.lat},${location.lng}`,
    mode: "driving",
    language: "ko",
    region: "kr",
    departure_time: "now",
    key: GOOGLE_MAPS_API_KEY,
  });
  const url = `https://maps.googleapis.com/maps/api/directions/json?${params}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.status !== "OK") return null;

  const route = data.routes?.[0];
  const leg = route?.legs?.[0];
  if (!route || !leg) return null;

  return {
    summary: route.summary || "",
    durationText: leg.duration_in_traffic?.text || leg.duration?.text || "",
  };
}

async function resolveOriginLocation(currentLocation, req) {
  if (currentLocation) {
    return {
      source: "browser_geolocation",
      location: currentLocation,
      accuracyMeters: null,
    };
  }

  return resolveApproximateLocationFromRequest(req);
}

async function buildRecommendationsFromPlaces(
  input,
  preferences = defaultPreferences(),
  options = {},
) {
  const baseQuery = `${input}`.trim();
  const maxDistanceKm = parseMaxDistanceKm(preferences.maxDistanceKm);
  const openNowOnly = Boolean(options.openNowOnly);
  const origin = options.origin || null;
  const { queries, candidates } = await fetchCandidatePlaces(baseQuery, preferences, {
    originLocation: origin?.location || null,
    maxDistanceKm,
  });
  const searchCenter = maxDistanceKm && !origin?.location ? await geocodeSearchCenter(baseQuery) : null;
  const candidatePlaces = candidates.map((entry) => entry.place);
  const matrix = origin?.location
    ? await fetchDistanceMatrix(origin.location, candidatePlaces)
    : new Map();

  const distanceFilteredCandidates = candidates
    .map(({ place, queryIndex, matchedQuery }, index) => {
      const location = place.geometry?.location;
      const matrixEntry = matrix.get(place.place_id || `${index}`) || null;
      const fallbackDistanceKm =
        origin?.location &&
        typeof location?.lat === "number" &&
        typeof location?.lng === "number"
          ? haversineDistanceKm(origin.location, {
              lat: location.lat,
              lng: location.lng,
            })
          : searchCenter &&
              typeof location?.lat === "number" &&
              typeof location?.lng === "number"
            ? haversineDistanceKm(searchCenter, {
                lat: location.lat,
                lng: location.lng,
              })
            : null;

      const distanceKm = matrixEntry?.distanceKm ?? fallbackDistanceKm;

      return {
        place,
        distanceKm,
        distanceText: matrixEntry?.distanceText || "",
        durationText: matrixEntry?.durationText || "",
        queryIndex,
        matchedQuery,
      };
    })
    .filter(({ distanceKm }) => (maxDistanceKm ? distanceKm != null && distanceKm <= maxDistanceKm : true));

  const candidatesForScoring = openNowOnly
    ? (
        await Promise.all(
          distanceFilteredCandidates.map(async (candidate) => {
            const placeId = String(candidate.place?.place_id || "").trim();
            if (!placeId) return null;

            try {
              const details = await fetchGooglePlaceDetails(placeId);
              if (!details?.openNow) {
                return null;
              }

              return {
                ...candidate,
                placeDetails: details,
              };
            } catch (error) {
              console.warn(
                `Failed to fetch place details for ${placeId}:`,
                error?.message || error,
              );
              return null;
            }
          }),
        )
      ).filter(Boolean)
    : distanceFilteredCandidates;

  const food = candidatesForScoring
    .map(({ place, distanceKm, distanceText, durationText, queryIndex, matchedQuery, placeDetails }) => {
      const preferenceScore = scorePlaceForPreferences(place, preferences, {
        distanceKm,
        queryIndex,
        queryCount: queries.length,
      });

      return {
        place,
        distanceKm,
        distanceText,
        durationText,
        queryIndex,
        matchedQuery,
        placeDetails,
        preferenceScore: preferenceScore.score,
        preferenceSignals: preferenceScore.signals,
      };
    })
    .sort((left, right) => {
      if (right.preferenceScore !== left.preferenceScore) {
        return right.preferenceScore - left.preferenceScore;
      }
      if (left.distanceKm == null && right.distanceKm == null) return 0;
      if (left.distanceKm == null) return 1;
      if (right.distanceKm == null) return -1;
      if (left.distanceKm !== right.distanceKm) {
        return left.distanceKm - right.distanceKm;
      }
      return left.queryIndex - right.queryIndex;
    })
    .slice(0, 3);

  if (!food.length) {
    return {
      items: [],
      origin: origin || null,
    };
  }

  const [directionsList, placeDetailsList] = await Promise.all([
    Promise.all(
      food.map(({ place }) =>
        origin?.location ? fetchDirectionsSummary(origin.location, place) : null,
      ),
    ),
    Promise.all(
      food.map(async ({ place, placeDetails }) => {
        if (placeDetails) {
          return placeDetails;
        }

        const placeId = String(place.place_id || "").trim();
        if (!placeId) return null;

        try {
          return await fetchGooglePlaceDetails(placeId);
        } catch (error) {
          console.warn(
            `Failed to fetch place details for ${placeId}:`,
            error?.message || error,
          );
          return null;
        }
      }),
    ),
  ]);

  const items = food.map(
    (
      {
        place,
        distanceKm,
        distanceText,
        durationText,
        matchedQuery,
        preferenceSignals,
        placeDetails: preloadedPlaceDetails,
      },
      index,
    ) => {
      const name = String(place.name || "").trim() || `추천 ${index + 1}`;
      const placeId = place.place_id;
      const photoRef = place.photos?.[0]?.photo_reference;
      const directions = directionsList[index];
      const placeDetails = placeDetailsList[index] || preloadedPlaceDetails || null;
      const openNow = placeDetails?.openNow ?? readPlaceOpenNow(place);
      const businessStatus = String(
        placeDetails?.businessStatus || place.business_status || "",
      ).trim();

      const parts = [];
      if (preferenceSignals.length) {
        parts.push(preferenceSignals.join(", "));
      }
      if (distanceText) {
        parts.push(`현재 위치 기준 ${distanceText}`);
      } else if (distanceKm != null) {
        parts.push(`현재 위치 기준 ${distanceKm.toFixed(1)}km`);
      }
      if (durationText || directions?.durationText) {
        parts.push(`예상 시간 ${directions?.durationText || durationText}`);
      }
      if (directions?.summary) {
        parts.push(`경로 요약 ${directions.summary}`);
      }
      if (
        matchedQuery &&
        normalizeSearchableText(matchedQuery) !== normalizeSearchableText(baseQuery)
      ) {
        parts.push(`조건 검색 ${matchedQuery}`);
      }
      const reason = parts.join(" | ") || "Google Places result";

      let imageUrl;
      if (photoRef) {
        imageUrl = `/place-photo?ref=${encodeURIComponent(photoRef)}`;
      } else {
        imageUrl = ensureImageUrl(null, index);
      }

      const maps = buildPlaceLinks(name, {
        address: place.formatted_address,
      });
      const googleMapUrl = buildGoogleMapUrl(name, {
        placeId,
        address: place.formatted_address,
        lat:
          typeof place.geometry?.location?.lat === "number"
            ? place.geometry.location.lat
            : null,
        lng:
          typeof place.geometry?.location?.lng === "number"
            ? place.geometry.location.lng
            : null,
      });
      const googleDirectionsUrl =
        origin?.location &&
        place.geometry?.location &&
        typeof place.geometry.location.lat === "number" &&
        typeof place.geometry.location.lng === "number"
          ? buildDirectionsUrl(origin.location, {
              lat: place.geometry.location.lat,
              lng: place.geometry.location.lng,
              placeId,
            })
          : null;

      return {
        id: crypto.randomUUID(),
        name,
        placeId,
        reason,
        address: place.formatted_address || "",
        imageUrl,
        source: "google_places",
        location:
          typeof place.geometry?.location?.lat === "number" &&
          typeof place.geometry?.location?.lng === "number"
            ? {
                lat: place.geometry.location.lat,
                lng: place.geometry.location.lng,
              }
            : null,
        links: {
          naverMap: maps.naverMapUrl,
          kakaoMap: maps.kakaoMapUrl,
          googleMap: googleMapUrl,
          ...(googleDirectionsUrl ? { googleDirections: googleDirectionsUrl } : {}),
        },
        distanceKm,
        travelDuration: directions?.durationText || durationText || "",
        routeSummary: directions?.summary || "",
        openNow,
        businessStatus,
        originSource: origin?.source || "",
      };
    },
  );

  return {
    items,
    origin: origin || null,
  };
}

async function generateRecommendationRaw(input) {
  const contents = `역할: 사용자의 조건에 맞는 맛집을 추천하는 도우미입니다.

규칙:
- 실제 존재하는 가게 이름 위주로 추천하세요.
- 조건이 모호하면 안전한 범용 추천을 하세요.
- reason은 짧고 자연스러운 한국어로 작성하세요.
- 출력은 JSON만 반환하세요.

조건: ${input}`;

  const client = getAI();
  const jsonConfig = {
    responseMimeType: "application/json",
    responseJsonSchema: RECOMMEND_JSON_SCHEMA,
    thinkingConfig: { thinkingBudget: 0 },
  };

  try {
    return await client.models.generateContent({
      model: MODEL,
      contents,
      config: jsonConfig,
    });
  } catch (error) {
    console.warn("JSON schema request failed, retrying:", error?.message || error);
  }

  try {
    return await client.models.generateContent({
      model: MODEL,
      contents,
      config: { thinkingConfig: { thinkingBudget: 0 } },
    });
  } catch {
    return client.models.generateContent({ model: MODEL, contents });
  }
}

async function buildRecommendationsGemini(input) {
  const response = await generateRecommendationRaw(input);
  const text = getResponseText(response);
  let items = null;

  if (text) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed?.items)) {
        items = parsed.items.slice(0, 3);
      }
    } catch {
      items = parseItemsFromText(text);
    }
  }

  if (!items?.length) {
    const detail = describeEmptyResponse(response);
    throw new Error(detail || "추천 결과를 만들지 못했습니다.");
  }

  return Promise.all(
    items.map(async (row, index) => {
      const name = String(row.name || "").trim() || `추천 ${index + 1}`;
      const websiteUrl = normalizeHttpUrl(row.websiteUrl);
      const maps = buildPlaceLinks(name, {
        address: row.address,
      });
      const imageUrl = ensureImageUrl(
        await resolveImageUrl(row.imageQuery, index),
        index,
      );
      return {
        id: crypto.randomUUID(),
        name,
        placeId: "",
        reason: String(row.reason || "").trim(),
        imageUrl,
        source: "gemini",
        links: {
          naverMap: maps.naverMapUrl,
          kakaoMap: maps.kakaoMapUrl,
          googleMap: maps.googleMapUrl,
          ...(websiteUrl ? { website: websiteUrl } : {}),
        },
      };
    }),
  );
}

app.post("/auth/register", asyncHandler(async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");

  if (name.length < 2) {
    return res.status(400).json({ error: "이름은 2자 이상 입력해 주세요." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "올바른 이메일 형식을 입력해 주세요." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "비밀번호는 6자 이상이어야 합니다." });
  }

  const existingUser = await getUserByEmail(email);
  if (existingUser) {
    return res.status(409).json({ error: "이미 가입한 이메일입니다." });
  }

  const user = await createUserRecord({
    id: crypto.randomUUID(),
    name,
    email,
    authProvider: LOCAL_AUTH_PROVIDER,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  });

  const token = await createSession(user.id);
  setSessionCookie(res, req, token, {
    publicOrigin: API_PUBLIC_ORIGIN,
    maxAgeMs: TOKEN_TTL_MS,
  });
  return res.status(201).json({
    user: sanitizeUser(user),
  });
}));

app.post("/auth/login", asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  const user = await getUserByLoginIdentifier(email);

  if (user && !hasAuthProvider(user, LOCAL_AUTH_PROVIDER)) {
    return res.status(403).json({
      error: "Google 계정으로 가입한 이메일입니다. Google로 로그인해 주세요.",
      code: "LOCAL_PASSWORD_LOGIN_UNAVAILABLE",
    });
  }

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." });
  }

  const token = await createSession(user.id);
  setSessionCookie(res, req, token, {
    publicOrigin: API_PUBLIC_ORIGIN,
    maxAgeMs: TOKEN_TTL_MS,
  });
  return res.json({
    user: sanitizeUser(ensureUserDataShape(user)),
  });
}));

app.get("/auth/config", (req, res) => {
  return res.json({
    supabaseUrl: SUPABASE_URL,
    supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
  });
});

app.post("/auth/oauth/google", async (req, res) => {
  try {
    const accessToken = String(req.body?.accessToken || "").trim();
    if (!accessToken) {
      return res.status(400).json({ error: "Google OAuth access token is required." });
    }

    const supabaseAuthConfig = resolveSupabaseAuthConfig(accessToken);
    const googleProfile = await fetchSupabaseUserProfile({
      accessToken,
      supabaseUrl: supabaseAuthConfig.supabaseUrl,
      supabasePublishableKey: supabaseAuthConfig.supabasePublishableKey,
    });

    let user = await getUserByEmail(googleProfile.email);
    if (!user) {
      user = await createUserRecord({
        id: crypto.randomUUID(),
        name: googleProfile.name,
        email: googleProfile.email,
        authProvider: GOOGLE_AUTH_PROVIDER,
        passwordHash: createUnusablePasswordHash(),
        createdAt: new Date().toISOString(),
      });
    } else {
      const nextName = String(user.name || "").trim() || googleProfile.name || user.name;
      const nextAuthProvider = hasAuthProvider(user, GOOGLE_AUTH_PROVIDER)
        ? user.authProvider
        : mergeAuthProvider(user.authProvider, GOOGLE_AUTH_PROVIDER);

      if (nextName !== user.name || nextAuthProvider !== user.authProvider) {
        user = await updateUserById(user.id, (current) => ({
          ...current,
          authProvider: nextAuthProvider,
          name: nextName,
        }));
      }
    }

    const token = await createSession(user.id);
    setSessionCookie(res, req, token, {
      publicOrigin: API_PUBLIC_ORIGIN,
      maxAgeMs: TOKEN_TTL_MS,
    });
    return res.json({
      user: sanitizeUser(ensureUserDataShape(user)),
    });
  } catch (error) {
    console.error(error);
    const status = Number.isInteger(error?.status) ? error.status : 500;
    const message = error?.message || "Google OAuth login failed.";
    return res.status(status).json({ error: message });
  }
});

app.post("/auth/oauth/google/merge", async (req, res) => {
  try {
    const accessToken = String(req.body?.accessToken || "").trim();
    const password = String(req.body?.password || "");

    if (!accessToken) {
      return res.status(400).json({ error: "Google OAuth access token is required." });
    }
    if (!password) {
      return res.status(400).json({ error: "기존 비밀번호를 입력해 주세요." });
    }

    const supabaseAuthConfig = resolveSupabaseAuthConfig(accessToken);
    const googleProfile = await fetchSupabaseUserProfile({
      accessToken,
      supabaseUrl: supabaseAuthConfig.supabaseUrl,
      supabasePublishableKey: supabaseAuthConfig.supabasePublishableKey,
    });

    let user = await getUserByEmail(googleProfile.email);
    if (!user) {
      return res.status(404).json({
        error: "기존 계정을 찾지 못했습니다. 먼저 이메일과 비밀번호로 가입해 주세요.",
      });
    }

    if (!hasAuthProvider(user, LOCAL_AUTH_PROVIDER)) {
      return res.status(409).json({
        error: "이미 Google 계정으로 연결된 이메일입니다. Google로 바로 로그인해 주세요.",
        code: "GOOGLE_ACCOUNT_ALREADY_LINKED",
      });
    }

    if (!verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: "기존 비밀번호가 올바르지 않습니다." });
    }

    if (!canAutoLinkGoogleAccount(user) || !String(user.name || "").trim()) {
      user = await updateUserById(user.id, (current) => ({
        ...current,
        authProvider: mergeAuthProvider(current.authProvider, GOOGLE_AUTH_PROVIDER),
        name: String(current.name || "").trim() || googleProfile.name || current.name,
      }));
    }

    const token = await createSession(user.id);
    setSessionCookie(res, req, token, {
      publicOrigin: API_PUBLIC_ORIGIN,
      maxAgeMs: TOKEN_TTL_MS,
    });
    return res.json({
      merged: true,
      user: sanitizeUser(ensureUserDataShape(user)),
    });
  } catch (error) {
    console.error(error);
    const status = Number.isInteger(error?.status) ? error.status : 500;
    const message = error?.message || "Google 계정 통합에 실패했습니다.";
    return res.status(status).json({ error: message });
  }
});

app.post("/auth/logout", requireAuth, asyncHandler(async (req, res) => {
  await updateUserById(req.user.id, (current) => ({
    ...current,
    sessions: (current.sessions || []).filter((session) => session.token !== req.authTokenHash),
  }));
  clearSessionCookie(res, req, { publicOrigin: API_PUBLIC_ORIGIN });
  return res.json({ ok: true });
}));

app.get("/auth/session", optionalAuth, (req, res) => {
  if (!req.user) {
    return res.json({ authenticated: false });
  }

  return res.json({
    authenticated: true,
    user: req.user,
  });
});

app.get("/auth/me", requireAuth, (req, res) => {
  return res.json({ user: req.user });
});

app.get("/user/preferences", requireAuth, asyncHandler(async (req, res) => {
  const user = await getUserById(req.user.id);
  return res.json({
    preferences: user.preferences,
    sheets: user.preferenceSheets,
    activeSheetId: user.activePreferenceSheetId,
  });
}));

app.put("/user/preferences", requireAuth, asyncHandler(async (req, res) => {
  const targetSheetId =
    typeof req.body?.sheetId === "string" && req.body.sheetId.trim()
      ? req.body.sheetId.trim()
      : req.user.activePreferenceSheetId;
  const preferences = normalizePreferences(req.body?.preferences || req.body || {});
  const nextSheetName =
    typeof req.body?.name === "string" && req.body.name.trim()
      ? req.body.name.trim().slice(0, 40)
      : null;

  const user = await updateUserById(req.user.id, (current) => {
    const sheets = current.preferenceSheets.map((sheet) =>
      sheet.id === targetSheetId
        ? {
            ...sheet,
            name: nextSheetName || sheet.name,
            preferences,
            updatedAt: new Date().toISOString(),
          }
        : sheet,
    );
    return {
      ...current,
      preferenceSheets: sheets,
      activePreferenceSheetId: sheets.some((sheet) => sheet.id === targetSheetId)
        ? targetSheetId
        : current.activePreferenceSheetId,
    };
  });

  return res.json({
    preferences: user.preferences,
    sheets: user.preferenceSheets,
    activeSheetId: user.activePreferenceSheetId,
    user: sanitizeUser(user),
  });
}));

app.post("/user/preferences/sheets", requireAuth, asyncHandler(async (req, res) => {
  const currentUser = await getUserById(req.user.id);
  const name =
    String(req.body?.name || "").trim().slice(0, 40) ||
    defaultSheetName((currentUser?.preferenceSheets?.length || 0) + 1);
  const preferences = normalizePreferences(req.body?.preferences || {});
  const newSheet = defaultPreferenceSheet({ name, preferences });

  try {
    const user = await updateUserById(req.user.id, (current) => {
      if (current.preferenceSheets.length >= MAX_PREFERENCE_SHEETS) {
        throw new Error(`개인화 설정 시트는 최대 ${MAX_PREFERENCE_SHEETS}개까지 추가할 수 있습니다.`);
      }
      return {
        ...current,
        preferenceSheets: [...current.preferenceSheets, newSheet],
        activePreferenceSheetId: newSheet.id,
      };
    });

    return res.status(201).json({
      preferences: user.preferences,
      sheets: user.preferenceSheets,
      activeSheetId: user.activePreferenceSheetId,
      user: sanitizeUser(user),
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || "개인화 설정 시트 생성에 실패했습니다." });
  }
}));

app.put("/user/preferences/active", requireAuth, asyncHandler(async (req, res) => {
  const sheetId = String(req.body?.sheetId || "").trim();
  const user = await updateUserById(req.user.id, (current) => {
    if (!current.preferenceSheets.some((sheet) => sheet.id === sheetId)) {
      return current;
    }
    return {
      ...current,
      activePreferenceSheetId: sheetId,
    };
  });

  return res.json({
    preferences: user.preferences,
    sheets: user.preferenceSheets,
    activeSheetId: user.activePreferenceSheetId,
    user: sanitizeUser(user),
  });
}));

app.delete("/user/preferences/:sheetId", requireAuth, asyncHandler(async (req, res) => {
  const sheetId = String(req.params.sheetId || "").trim();
  try {
    const user = await updateUserById(req.user.id, (current) => {
      if (current.preferenceSheets.length <= 1) {
        throw new Error("마지막 개인화 설정 시트는 삭제할 수 없습니다.");
      }
      const remaining = current.preferenceSheets.filter((sheet) => sheet.id !== sheetId);
      return {
        ...current,
        preferenceSheets: remaining,
        activePreferenceSheetId:
          current.activePreferenceSheetId === sheetId
            ? remaining[0].id
            : current.activePreferenceSheetId,
      };
    });

    return res.json({
      preferences: user.preferences,
      sheets: user.preferenceSheets,
      activeSheetId: user.activePreferenceSheetId,
      user: sanitizeUser(user),
    });
  } catch (error) {
    return res.status(400).json({ error: error.message || "개인화 설정 시트 삭제에 실패했습니다." });
  }
}));

app.get("/user/history", requireAuth, asyncHandler(async (req, res) => {
  const user = await getUserById(req.user.id);
  return res.json({ history: [...user.history].reverse() });
}));

app.get("/user/visits", requireAuth, asyncHandler(async (req, res) => {
  const user = await getUserById(req.user.id);
  return res.json({ visits: [...(user.visitHistory || [])].reverse() });
}));

app.post("/user/visits", requireAuth, asyncHandler(async (req, res) => {
  const visit = sanitizeVisitEntry(req.body);
  if (!visit) {
    return res.status(400).json({ error: "저장할 방문 기록 정보가 올바르지 않습니다." });
  }

  const user = await updateUserById(req.user.id, (current) => ({
    ...current,
    visitHistory: [...(current.visitHistory || []), visit].slice(-MAX_HISTORY),
  }));

  return res.status(201).json({
    visit,
    visits: [...(user.visitHistory || [])].reverse(),
    user: sanitizeUser(user),
  });
}));

app.delete("/user/history", requireAuth, asyncHandler(async (req, res) => {
  const user = await updateUserById(req.user.id, (current) => ({
    ...current,
    history: [],
  }));

  if (!user) {
    return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
  }

  return res.json({ history: [], user: sanitizeUser(user) });
}));

app.delete("/user/history/:id", requireAuth, asyncHandler(async (req, res) => {
  const targetId = String(req.params.id || "").trim();
  if (!targetId) {
    return res.status(400).json({ error: "삭제할 방문 기록 ID가 필요합니다." });
  }

  const user = await updateUserById(req.user.id, (current) => ({
    ...current,
    history: current.history.filter((entry) => String(entry.id) !== targetId),
  }));

  if (!user) {
    return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
  }

  return res.json({ history: [...user.history].reverse(), user: sanitizeUser(user) });
}));

app.delete("/user/visits", requireAuth, asyncHandler(async (req, res) => {
  const user = await updateUserById(req.user.id, (current) => ({
    ...current,
    visitHistory: [],
  }));

  if (!user) {
    return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
  }

  return res.json({ visits: [], user: sanitizeUser(user) });
}));

app.delete("/user/visits/:id", requireAuth, asyncHandler(async (req, res) => {
  const targetId = String(req.params.id || "").trim();
  if (!targetId) {
    return res.status(400).json({ error: "삭제할 방문 기록 ID가 필요합니다." });
  }

  const user = await updateUserById(req.user.id, (current) => ({
    ...current,
    visitHistory: (current.visitHistory || []).filter((entry) => String(entry.id) !== targetId),
  }));

  if (!user) {
    return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
  }

  return res.json({ visits: [...(user.visitHistory || [])].reverse(), user: sanitizeUser(user) });
}));

app.get("/user/favorites", requireAuth, asyncHandler(async (req, res) => {
  const user = await getUserById(req.user.id);
  return res.json({ favorites: [...user.favorites].reverse() });
}));

app.get("/place-details/:placeId", asyncHandler(async (req, res) => {
  const placeId = String(req.params.placeId || "").trim();
  if (!placeId) {
    return res.status(400).json({ error: "placeId가 필요합니다." });
  }

  try {
    const place = await fetchGooglePlaceDetails(placeId);
    return res.json({ place });
  } catch (error) {
    const statusCode =
      Number.isInteger(error?.statusCode) && error.statusCode >= 400
        ? error.statusCode
        : 500;
    return res.status(statusCode).json({
      error: error?.message || "식당 상세정보를 불러오지 못했습니다.",
    });
  }
}));

app.post("/user/favorites", requireAuth, asyncHandler(async (req, res) => {
  const favorite = sanitizeFavorite(req.body);
  if (!favorite) {
    return res.status(400).json({ error: "즐겨찾기 항목이 올바르지 않습니다." });
  }

  const user = await updateUserById(req.user.id, (current) => {
    const rest = current.favorites.filter(
      (entry) => entry.name.toLowerCase() !== favorite.name.toLowerCase(),
    );
    const next = [...rest, favorite];
    return {
      ...current,
      favorites: next.slice(-MAX_FAVORITES),
    };
  });

  return res.status(201).json({
    favorite,
    favorites: [...user.favorites].reverse(),
    user: sanitizeUser(user),
  });
}));

app.delete("/user/favorites/:favoriteId", requireAuth, asyncHandler(async (req, res) => {
  const favoriteId = String(req.params.favoriteId || "");
  const user = await updateUserById(req.user.id, (current) => ({
    ...current,
    favorites: current.favorites.filter((entry) => entry.id !== favoriteId),
  }));
  return res.json({ favorites: [...user.favorites].reverse(), user: sanitizeUser(user) });
}));

app.get("/place-photo", async (req, res) => {
  const ref = typeof req.query.ref === "string" ? req.query.ref : "";
  if (!ref || !GOOGLE_MAPS_API_KEY) {
    return res.status(400).send("Missing photo ref or GOOGLE_MAPS_API_KEY");
  }
  try {
    const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${encodeURIComponent(ref)}&key=${GOOGLE_MAPS_API_KEY}`;
    const response = await fetch(url, { redirect: "manual" });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      return res.redirect(302, location);
    }
    if (response.ok) {
      const contentType = response.headers.get("content-type") || "image/jpeg";
      res.setHeader("Content-Type", contentType);
      const buffer = Buffer.from(await response.arrayBuffer());
      return res.send(buffer);
    }
    return res.status(502).send("Google Place Photo error");
  } catch (error) {
    console.error(error);
    return res.status(500).send("Photo proxy error");
  }
});

app.post("/recommend", optionalAuth, async (req, res) => {
  const raw = req.body?.input;
  const input = typeof raw === "string" ? raw.trim() : "";
  const currentLocation = parseCurrentLocation(req.body?.currentLocation);
  const openNowOnly = parseOpenNowOnly(req.body?.openNowOnly);
  const requestBypassCache = parseBypassCache(req.body?.bypassCache);

  if (!input) {
    return res.status(400).json({
      items: null,
      error: "추천 조건을 입력해 주세요.",
    });
  }

  if (!GOOGLE_MAPS_API_KEY && !API_KEY?.trim()) {
    return res.status(500).json({
      items: null,
      error:
        "backend/.env 에 GOOGLE_MAPS_API_KEY 또는 GEMINI_API_KEY를 설정해 주세요.",
    });
  }

  const preferences = getEffectiveRecommendationPreferences(
    normalizePreferences(req.user?.preferences || defaultPreferences()),
    { hasCurrentLocation: Boolean(currentLocation) },
  );
  const origin = await resolveOriginLocation(currentLocation, req);
  const personalizationText = buildPersonalizationText(preferences);
  const appliedPreferenceText = [personalizationText, openNowOnly ? "영업 중만 보기" : ""]
    .filter(Boolean)
    .join(", ");
  const finalInput = personalizationText
    ? `${input}. 개인화 조건: ${personalizationText}`
    : input;

  const locationKey = origin?.location
    ? `${origin.source}:${origin.location.lat.toFixed(2)},${origin.location.lng.toFixed(2)}`
    : "no-location";
  const shouldBypassCache = shouldBypassRecommendationCache({
    input,
    requestBypassCache,
    user: req.user,
  });
  const cacheKey = shouldBypassCache
    ? null
    : `${RESPONSE_CACHE_VERSION}|${finalInput}|${locationKey}|open-now:${openNowOnly ? "1" : "0"}`;
  if (cacheKey && cache[cacheKey]) {
    const cached = cache[cacheKey];
    const cachedPayload = Array.isArray(cached)
      ? {
          items: cached,
          originLocation: null,
          originSource: "",
          originAccuracyMeters: null,
        }
      : {
          items: cached.items || [],
          originLocation: cached.originLocation || null,
          originSource: cached.originSource || "",
          originAccuracyMeters: cached.originAccuracyMeters ?? null,
        };
    return res.json({
      items: cachedPayload.items,
      personalizationApplied: appliedPreferenceText,
      originLocation: cachedPayload.originLocation,
      originSource: cachedPayload.originSource,
      originAccuracyMeters: cachedPayload.originAccuracyMeters,
    });
  }

  try {
    const recommendationPayload = GOOGLE_MAPS_API_KEY
      ? await buildRecommendationsFromPlaces(input, preferences, {
          origin,
          openNowOnly,
        })
      : {
          items: await buildRecommendationsGemini(finalInput),
          origin,
        };
    const items = recommendationPayload.items || [];
    const responseOrigin = recommendationPayload.origin || null;

    if (cacheKey) {
      cache[cacheKey] = {
        items,
        originLocation: responseOrigin?.location || null,
        originSource: responseOrigin?.source || "",
        originAccuracyMeters: responseOrigin?.accuracyMeters ?? null,
      };
    }

    if (req.user?.id) {
      await updateUserById(req.user.id, (current) => ({
        ...current,
        history: [
          ...current.history,
          {
            id: crypto.randomUUID(),
            query: input,
            personalizationApplied: appliedPreferenceText,
            createdAt: new Date().toISOString(),
          },
        ].slice(-MAX_HISTORY),
      }));
    }

    return res.json({
      items,
      personalizationApplied: appliedPreferenceText,
      originLocation: responseOrigin?.location || null,
      originSource: responseOrigin?.source || "",
      originAccuracyMeters: responseOrigin?.accuracyMeters ?? null,
    });
  } catch (error) {
    console.error(error);
    const msg = error?.message || String(error);
    return res.status(500).json({ items: null, error: msg });
  }
});

if (HAS_FRONTEND_BUILD) {
  app.use(express.static(FRONTEND_BUILD_DIR, { index: false }));

  app.use((req, res, next) => {
    if (req.method !== "GET") {
      return next();
    }

    const apiPrefixes = ["/auth", "/user", "/place-details", "/place-photo", "/recommend"];
    if (
      apiPrefixes.some(
        (prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`),
      )
    ) {
      return next();
    }

    return res.sendFile(FRONTEND_INDEX_FILE);
  });
}

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) {
    return next(error);
  }
  const statusCode =
    Number.isInteger(error?.statusCode) && error.statusCode >= 400 ? error.statusCode : 500;
  return res.status(statusCode).json({
    error: error?.message || "서버 오류가 발생했습니다.",
  });
});

app.listen(PORT, () => {
  console.log(`Server http://localhost:${PORT} (model: ${MODEL})`);
  if (GOOGLE_MAPS_API_KEY) {
    console.log("Recommendation source: Google Places");
  } else {
    console.log("Recommendation source: Gemini fallback");
  }
  console.log("User store: Supabase Postgres");
  console.log(
    `Public image origin: ${API_PUBLIC_ORIGIN || `(same-origin relative path, frontend build: ${HAS_FRONTEND_BUILD ? "enabled" : "missing"})`}`,
  );
});
