const NEARBY_RECOMMENDATION_SEED = "\uB0B4 \uC8FC\uBCC0 \uB9DB\uC9D1 \uCD94\uCC9C";

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
  return String(input || "").trim() === NEARBY_RECOMMENDATION_SEED;
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
