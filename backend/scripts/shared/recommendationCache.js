const NEARBY_RECOMMENDATION_SEED = "\uB0B4 \uC8FC\uBCC0 \uB9DB\uC9D1 \uCD94\uCC9C";
const NEARBY_LOCATION_PATTERN = /(내\s*)?(주변|근처|인근|가까운|nearby|near me)/i;
const NEARBY_FOOD_PATTERN = /(맛집|식당|음식점|밥집|restaurant|food)/i;

function parseBypassCache(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return false;
}

function isNearbyRecommendationSeed(input) {
  const normalized = String(input || "").trim();
  if (!normalized) return false;
  if (normalized === NEARBY_RECOMMENDATION_SEED) return true;

  return NEARBY_LOCATION_PATTERN.test(normalized) && NEARBY_FOOD_PATTERN.test(normalized);
}

function shouldBypassRecommendationCache({ input, requestBypassCache = false, user } = {}) {
  if (requestBypassCache || isNearbyRecommendationSeed(input)) {
    return true;
  }

  return (
    Number(user?.preferenceSheetCount || 0) > 1 &&
    Boolean(user?.activePreferenceSheetId)
  );
}

module.exports = {
  NEARBY_RECOMMENDATION_SEED,
  parseBypassCache,
  isNearbyRecommendationSeed,
  shouldBypassRecommendationCache,
};
