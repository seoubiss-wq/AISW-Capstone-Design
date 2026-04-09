require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { buildDbSslConfig } = require("./shared/dbConfig");
const { normalizeStoredSessionToken } = require("./shared/sessionAuth");

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const DATABASE_URL = String(
  (IS_PRODUCTION ? process.env.PROD_DATABASE_URL : process.env.DEV_DATABASE_URL) || "",
).trim();
const USERS_FILE = path.join(__dirname, "..", "data", "users.json");

if (!DATABASE_URL) {
  console.error("DEV_DATABASE_URL or PROD_DATABASE_URL is required.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: buildDbSslConfig({ connectionString: DATABASE_URL }),
  max: 3,
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

function normalizePreferences(raw) {
  const base = defaultPreferences();
  return {
    ...base,
    favoriteCuisine: String(raw?.favoriteCuisine || "").trim().slice(0, 50),
    mood: String(raw?.mood || "").trim().slice(0, 50),
    budget: String(raw?.budget || "").trim().slice(0, 30),
    maxDistanceKm: String(raw?.maxDistanceKm || "").trim().slice(0, 10),
    avoidIngredients: String(raw?.avoidIngredients || "").trim().slice(0, 120),
  };
}

function defaultSheetName(index = 1) {
  return index <= 1 ? "기본 설정" : `설정 ${index}`;
}

function defaultPreferenceSheet(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: String(overrides.id || cryptoRandomUuid()),
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

function parseNullableNumber(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function parseMaxDistanceKm(raw) {
  const normalized = String(raw || "").trim().replace(/,/g, ".");
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

function normalizeIsoString(value, fallback = new Date().toISOString()) {
  if (!value) return fallback;
  const next = new Date(value);
  return Number.isNaN(next.getTime()) ? fallback : next.toISOString();
}

function sanitizeFavorite(raw) {
  const name = String(raw?.name || "").trim().slice(0, 120);
  if (!name) return null;
  return {
    id: raw?.id ? String(raw.id) : cryptoRandomUuid(),
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
    links: raw?.links && typeof raw.links === "object" ? raw.links : {},
    distanceKm: parseNullableNumber(raw?.distanceKm),
    travelDuration: String(raw?.travelDuration || "").trim().slice(0, 80),
    routeSummary: String(raw?.routeSummary || "").trim().slice(0, 180),
    source: String(raw?.source || "").trim().slice(0, 40),
    savedAt: raw?.savedAt || new Date().toISOString(),
  };
}

function ensureUserDataShape(user) {
  const legacyPreferences =
    user.preferences && typeof user.preferences === "object"
      ? normalizePreferences(user.preferences)
      : defaultPreferences();

  if (!Array.isArray(user.preferenceSheets) || user.preferenceSheets.length === 0) {
    user.preferenceSheets = [defaultPreferenceSheet({ preferences: legacyPreferences })];
  } else {
    user.preferenceSheets = user.preferenceSheets
      .slice(0, 10)
      .map((sheet, index) => normalizePreferenceSheet(sheet, defaultSheetName(index + 1)));
  }

  if (
    !user.activePreferenceSheetId ||
    !user.preferenceSheets.some((sheet) => sheet.id === user.activePreferenceSheetId)
  ) {
    user.activePreferenceSheetId = user.preferenceSheets[0].id;
  }

  user.preferences =
    user.preferenceSheets.find((sheet) => sheet.id === user.activePreferenceSheetId)?.preferences ||
    defaultPreferences();

  if (!Array.isArray(user.history)) user.history = [];
  if (!Array.isArray(user.favorites)) user.favorites = [];
  if (!Array.isArray(user.sessions)) user.sessions = [];

  user.sessions = user.sessions
    .map((session) => ({
      token: normalizeStoredSessionToken(session?.token),
      expiresAt: Number(session?.expiresAt || 0),
    }))
    .filter((session) => session.token && Number.isFinite(session.expiresAt));

  return user;
}

function cryptoRandomUuid() {
  return require("crypto").randomUUID();
}

async function resolveTargetUserId(client, user) {
  const byEmail = await client.query(`select id from public.app_users where email = $1 limit 1`, [
    user.email,
  ]);
  if (byEmail.rowCount) {
    return byEmail.rows[0].id;
  }
  return user.id;
}

async function migrateUser(client, rawUser) {
  const user = ensureUserDataShape({
    ...rawUser,
    email: String(rawUser.email || "").trim().toLowerCase(),
    name: String(rawUser.name || "").trim() || "사용자",
    passwordHash: String(rawUser.passwordHash || "").trim(),
    createdAt: normalizeIsoString(rawUser.createdAt),
  });

  const userId = await resolveTargetUserId(client, user);

  await client.query(
    `insert into public.app_users (id, email, name, password_hash, created_at, updated_at)
     values ($1, $2, $3, $4, $5, timezone('utc', now()))
     on conflict (id) do update
       set email = excluded.email,
           name = excluded.name,
           password_hash = excluded.password_hash,
           created_at = excluded.created_at,
           updated_at = timezone('utc', now())`,
    [userId, user.email, user.name, user.passwordHash, normalizeIsoString(user.createdAt)],
  );

  if (userId !== user.id) {
    await client.query(
      `update public.app_users
          set email = $2,
              name = $3,
              password_hash = $4,
              created_at = $5,
              updated_at = timezone('utc', now())
        where id = $1`,
      [userId, user.email, user.name, user.passwordHash, normalizeIsoString(user.createdAt)],
    );
  }

  await client.query("delete from public.user_sessions where user_id = $1", [userId]);
  await client.query("delete from public.search_history where user_id = $1", [userId]);
  await client.query("delete from public.favorite_restaurants where user_id = $1", [userId]);
  await client.query("delete from public.preference_sheets where user_id = $1", [userId]);

  for (const sheet of user.preferenceSheets) {
    await client.query(
      `insert into public.preference_sheets (
         id, user_id, name, favorite_cuisine, mood, budget, max_distance_km,
         avoid_ingredients, is_active, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        sheet.id,
        userId,
        sheet.name,
        sheet.preferences.favoriteCuisine,
        sheet.preferences.mood,
        sheet.preferences.budget,
        parseMaxDistanceKm(sheet.preferences.maxDistanceKm),
        sheet.preferences.avoidIngredients,
        sheet.id === user.activePreferenceSheetId,
        normalizeIsoString(sheet.createdAt),
        normalizeIsoString(sheet.updatedAt),
      ],
    );
  }

  for (const historyEntry of user.history) {
    await client.query(
      `insert into public.search_history (id, user_id, query, personalization_applied, created_at)
       values ($1, $2, $3, $4, $5)`,
      [
        historyEntry.id || cryptoRandomUuid(),
        userId,
        String(historyEntry.query || "").trim().slice(0, 300),
        String(historyEntry.personalizationApplied || "").trim(),
        normalizeIsoString(historyEntry.createdAt),
      ],
    );
  }

  for (const rawFavorite of user.favorites) {
    const favorite = sanitizeFavorite(rawFavorite);
    if (!favorite) continue;
    await client.query(
      `insert into public.favorite_restaurants (
         id, user_id, place_id, name, reason, address, image_url, category, rating,
         keywords, feature_tags, links, distance_km, travel_duration, route_summary,
         source, location_lat, location_lng, created_at, updated_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9,
         $10::jsonb, $11::jsonb, $12::jsonb, $13, $14, $15,
         $16, $17, $18, $19, $20
       )`,
      [
        favorite.id,
        userId,
        favorite.placeId,
        favorite.name,
        favorite.reason,
        favorite.address,
        favorite.imageUrl,
        favorite.category,
        favorite.rating,
        JSON.stringify(favorite.keywords || []),
        JSON.stringify(favorite.featureTags || []),
        JSON.stringify(favorite.links || {}),
        favorite.distanceKm,
        favorite.travelDuration,
        favorite.routeSummary,
        favorite.source,
        favorite.location?.lat ?? null,
        favorite.location?.lng ?? null,
        normalizeIsoString(favorite.savedAt),
        normalizeIsoString(favorite.savedAt),
      ],
    );
  }

  for (const session of user.sessions) {
    if (!session.token || !Number.isFinite(session.expiresAt)) continue;
    await client.query(
      `insert into public.user_sessions (id, user_id, token, expires_at, created_at)
       values ($1, $2, $3, $4, timezone('utc', now()))`,
      [cryptoRandomUuid(), userId, normalizeStoredSessionToken(session.token), normalizeIsoString(session.expiresAt)],
    );
  }

  return {
    userId,
    email: user.email,
    sheets: user.preferenceSheets.length,
    history: user.history.length,
    favorites: user.favorites.length,
    sessions: user.sessions.length,
  };
}

async function main() {
  const raw = fs.readFileSync(USERS_FILE, "utf8");
  const users = JSON.parse(raw);
  if (!Array.isArray(users)) {
    throw new Error("users.json is not an array.");
  }

  const results = [];
  for (const rawUser of users) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await migrateUser(client, rawUser);
      await client.query("commit");
      results.push(result);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  const summary = await pool.query(
    `select
       (select count(*)::int from public.app_users) as users,
       (select count(*)::int from public.preference_sheets) as sheets,
       (select count(*)::int from public.search_history) as history,
       (select count(*)::int from public.favorite_restaurants) as favorites,
       (select count(*)::int from public.user_sessions) as sessions`,
  );

  console.log(
    JSON.stringify(
      {
        migratedUsers: results.length,
        sample: results.slice(0, 3),
        totals: summary.rows[0],
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
