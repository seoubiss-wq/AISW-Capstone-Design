const test = require("node:test");
const assert = require("node:assert/strict");

const {
  NEARBY_RECOMMENDATION_SEED,
  parseBypassCache,
  isNearbyRecommendationSeed,
  shouldBypassRecommendationCache,
} = require("../scripts/shared/recommendationCache");

test("parses bypass-cache flags from booleans and strings", () => {
  assert.equal(parseBypassCache(true), true);
  assert.equal(parseBypassCache("true"), true);
  assert.equal(parseBypassCache(false), false);
  assert.equal(parseBypassCache("false"), false);
  assert.equal(parseBypassCache("unexpected"), false);
});

test("recognizes the nearby recommendation seed query", () => {
  assert.equal(isNearbyRecommendationSeed(NEARBY_RECOMMENDATION_SEED), true);
  assert.equal(isNearbyRecommendationSeed("\uB0B4 \uC8FC\uBCC0 \uAC00\uAE4C\uC6B4 \uB9DB\uC9D1 \uCD94\uCC9C"), true);
  assert.equal(isNearbyRecommendationSeed("\uADFC\uCC98 \uB9DB\uC9D1 \uCC3E\uC544\uB2EC\uB77C"), true);
  assert.equal(isNearbyRecommendationSeed("\uAC15\uB0A8 \uB9DB\uC9D1 \uCD94\uCC9C"), false);
});

test("bypasses the recommendation cache for nearby queries and explicit requests", () => {
  assert.equal(
    shouldBypassRecommendationCache({
      input: NEARBY_RECOMMENDATION_SEED,
      user: null,
    }),
    true,
  );

  assert.equal(
    shouldBypassRecommendationCache({
      input: "\uAC15\uB0A8 \uB9DB\uC9D1 \uCD94\uCC9C",
      requestBypassCache: true,
      user: null,
    }),
    true,
  );
});

test("still bypasses the recommendation cache for multi-sheet personalization", () => {
  assert.equal(
    shouldBypassRecommendationCache({
      input: "\uAC15\uB0A8 \uB9DB\uC9D1 \uCD94\uCC9C",
      user: {
        preferenceSheetCount: 2,
        activePreferenceSheetId: "sheet-1",
      },
    }),
    true,
  );

  assert.equal(
    shouldBypassRecommendationCache({
      input: "\uAC15\uB0A8 \uB9DB\uC9D1 \uCD94\uCC9C",
      user: {
        preferenceSheetCount: 1,
        activePreferenceSheetId: "",
      },
    }),
    false,
  );
});
