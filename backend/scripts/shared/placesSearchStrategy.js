const MAX_NEARBY_RADIUS_METERS = 50000;
const DEFAULT_NEARBY_RADIUS_KM = 5;
const MAX_APPROXIMATE_NEARBY_RADIUS_KM = 15;

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

function resolveNearbySearchMaxDistanceKm({
  hasOriginLocation = false,
  nearbyRequested = false,
  requestedMaxDistanceKm = null,
  originAccuracyMeters = null,
} = {}) {
  const requested =
    Number.isFinite(requestedMaxDistanceKm) && requestedMaxDistanceKm > 0
      ? requestedMaxDistanceKm
      : null;
  if (!nearbyRequested) {
    return requested;
  }
  if (!hasOriginLocation) {
    return requested;
  }

  const nearbyCapKm = Number.isFinite(originAccuracyMeters) && originAccuracyMeters > 0
    ? Math.min(
        MAX_APPROXIMATE_NEARBY_RADIUS_KM,
        Math.max(DEFAULT_NEARBY_RADIUS_KM, Math.ceil(originAccuracyMeters / 1000)),
      )
    : DEFAULT_NEARBY_RADIUS_KM;

  return requested != null ? Math.min(requested, nearbyCapKm) : nearbyCapKm;
}

function compareRankedPlaces(left, right, { nearbyRequested = false } = {}) {
  if (nearbyRequested) {
    if (left.distanceKm == null && right.distanceKm != null) {
      return 1;
    }
    if (left.distanceKm != null && right.distanceKm == null) {
      return -1;
    }
    if (
      left.distanceKm != null &&
      right.distanceKm != null &&
      left.distanceKm !== right.distanceKm
    ) {
      return left.distanceKm - right.distanceKm;
    }
  }

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
}

module.exports = {
  DEFAULT_NEARBY_RADIUS_KM,
  MAX_APPROXIMATE_NEARBY_RADIUS_KM,
  MAX_NEARBY_RADIUS_METERS,
  buildNearbyRadiusMeters,
  compareRankedPlaces,
  resolveNearbySearchMaxDistanceKm,
  shouldUseNearbyCandidateSearch,
};
