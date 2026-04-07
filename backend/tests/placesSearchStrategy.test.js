const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_NEARBY_RADIUS_METERS,
  buildNearbyRadiusMeters,
  shouldUseNearbyCandidateSearch,
} = require("../scripts/shared/placesSearchStrategy");

test("uses nearby candidate search only when both location and max distance are available", () => {
  assert.equal(shouldUseNearbyCandidateSearch(null, 10), false);
  assert.equal(shouldUseNearbyCandidateSearch({ lat: 37.5, lng: 127.0 }, null), false);
  assert.equal(shouldUseNearbyCandidateSearch({ lat: 37.5, lng: 127.0 }, 10), true);
});

test("clamps nearby radius to the Google Places limit", () => {
  assert.equal(buildNearbyRadiusMeters(10), 10000);
  assert.equal(buildNearbyRadiusMeters(0), null);
  assert.equal(buildNearbyRadiusMeters(80), MAX_NEARBY_RADIUS_METERS);
});
