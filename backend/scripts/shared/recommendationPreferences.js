function getEffectiveRecommendationPreferences(preferences, options = {}) {
  const hasCurrentLocation = Boolean(options.hasCurrentLocation);
  const next = {
    favoriteCuisine: String(preferences?.favoriteCuisine || "").trim(),
    mood: String(preferences?.mood || "").trim(),
    budget: String(preferences?.budget || "").trim(),
    maxDistanceKm: String(preferences?.maxDistanceKm || "").trim(),
    avoidIngredients: String(preferences?.avoidIngredients || "").trim(),
  };

  if (!hasCurrentLocation) {
    next.maxDistanceKm = "";
  }

  return next;
}

function buildPersonalizationText(preferences) {
  const lines = [];

  if (preferences.favoriteCuisine) {
    lines.push(`선호 음식: ${preferences.favoriteCuisine}`);
  }
  if (preferences.mood) {
    lines.push(`선호 분위기: ${preferences.mood}`);
  }
  if (preferences.budget) {
    lines.push(`예산: ${preferences.budget}`);
  }
  if (preferences.maxDistanceKm) {
    lines.push(`최대 이동 거리: ${preferences.maxDistanceKm}km`);
  }
  if (preferences.avoidIngredients) {
    lines.push(`피하고 싶은 재료: ${preferences.avoidIngredients}`);
  }

  return lines.join(", ");
}

module.exports = {
  buildPersonalizationText,
  getEffectiveRecommendationPreferences,
};
