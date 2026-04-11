const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_NEARBY_RADIUS_KM,
  MAX_NEARBY_RADIUS_METERS,
  buildNearbyRadiusMeters,
  compareRankedPlaces,
  resolveNearbySearchMaxDistanceKm,
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

test("assigns a default distance cap for nearby requests with origin coordinates", () => {
  assert.equal(
    resolveNearbySearchMaxDistanceKm({
      hasOriginLocation: true,
      nearbyRequested: true,
      requestedMaxDistanceKm: null,
      originAccuracyMeters: null,
    }),
    DEFAULT_NEARBY_RADIUS_KM,
  );

  assert.equal(
    resolveNearbySearchMaxDistanceKm({
      hasOriginLocation: true,
      nearbyRequested: true,
      requestedMaxDistanceKm: 20,
      originAccuracyMeters: 15000,
    }),
    15,
  );
});

test("does not force a nearby cap when the origin coordinates are unavailable", () => {
  assert.equal(
    resolveNearbySearchMaxDistanceKm({
      hasOriginLocation: false,
      nearbyRequested: true,
      requestedMaxDistanceKm: null,
      originAccuracyMeters: null,
    }),
    null,
  );
});

test("sorts nearby recommendations by distance before preference score", () => {
  const result = compareRankedPlaces(
    { distanceKm: 0.7, preferenceScore: 4, queryIndex: 1 },
    { distanceKm: 6.2, preferenceScore: 12, queryIndex: 0 },
    { nearbyRequested: true },
  );

  assert.equal(result < 0, true);
});
