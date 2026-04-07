const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPersonalizationText,
  getEffectiveRecommendationPreferences,
} = require("../scripts/shared/recommendationPreferences");

test("removes max distance when current location is unavailable", () => {
  const effective = getEffectiveRecommendationPreferences(
    {
      favoriteCuisine: "한식",
      maxDistanceKm: "10",
    },
    { hasCurrentLocation: false },
  );

  assert.equal(effective.favoriteCuisine, "한식");
  assert.equal(effective.maxDistanceKm, "");
});

test("keeps max distance when current location is available", () => {
  const effective = getEffectiveRecommendationPreferences(
    {
      favoriteCuisine: "한식",
      maxDistanceKm: "10",
    },
    { hasCurrentLocation: true },
  );

  assert.equal(effective.maxDistanceKm, "10");
});

test("builds personalization text without max distance when it is disabled", () => {
  const text = buildPersonalizationText({
    favoriteCuisine: "한식",
    maxDistanceKm: "",
    mood: "조용한",
    budget: "",
    avoidIngredients: "",
  });

  assert.equal(text, "선호 음식: 한식, 선호 분위기: 조용한");
});
