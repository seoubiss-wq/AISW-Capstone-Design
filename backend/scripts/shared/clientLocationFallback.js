const geoip = require("geoip-lite");

function normalizeIpAddress(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  const first = String(raw || "")
    .split(",")[0]
    .trim()
    .replace(/^\[(.*)\]$/, "$1");

  if (!first) return "";
  if (first.startsWith("::ffff:")) {
    return first.slice(7);
  }

  return first;
}

function isPrivateOrLocalIpAddress(ip) {
  const normalized = normalizeIpAddress(ip).toLowerCase();
  if (!normalized) return true;
  if (normalized === "::1" || normalized === "localhost") return true;
  if (normalized.startsWith("127.")) return true;
  if (normalized.startsWith("10.")) return true;
  if (normalized.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe80:")) return true;
  return false;
}

function readClientIp(req) {
  return normalizeIpAddress(
    req?.headers?.["x-forwarded-for"] ||
      req?.ip ||
      req?.socket?.remoteAddress ||
      req?.connection?.remoteAddress,
  );
}

function resolveApproximateLocationFromRequest(req, lookup = geoip.lookup) {
  const clientIp = readClientIp(req);
  if (!clientIp || isPrivateOrLocalIpAddress(clientIp)) {
    return null;
  }

  const candidate = typeof lookup === "function" ? lookup(clientIp) : null;
  const lat = Number(candidate?.ll?.[0]);
  const lng = Number(candidate?.ll?.[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    source: "ip_geolocation",
    location: { lat, lng },
    accuracyMeters: 15000,
  };
}

module.exports = {
  isPrivateOrLocalIpAddress,
  normalizeIpAddress,
  readClientIp,
  resolveApproximateLocationFromRequest,
};
