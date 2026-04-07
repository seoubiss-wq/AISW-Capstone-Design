const MAX_NEARBY_RADIUS_METERS = 50000;

function shouldUseNearbyCandidateSearch(originLocation, maxDistanceKm) {
  return (
    Number.isFinite(originLocation?.lat) &&
    Number.isFinite(originLocation?.lng) &&
    Number.isFinite(maxDistanceKm) &&
    maxDistanceKm > 0
  );
}

function buildNearbyRadiusMeters(maxDistanceKm) {
  if (!Number.isFinite(maxDistanceKm) || maxDistanceKm <= 0) {
    return null;
  }

  return Math.max(1, Math.min(Math.round(maxDistanceKm * 1000), MAX_NEARBY_RADIUS_METERS));
}

module.exports = {
  MAX_NEARBY_RADIUS_METERS,
  buildNearbyRadiusMeters,
  shouldUseNearbyCandidateSearch,
};
