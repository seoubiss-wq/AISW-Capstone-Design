const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isPrivateOrLocalIpAddress,
  normalizeIpAddress,
  readClientIp,
  resolveApproximateLocationFromRequest,
} = require("../scripts/shared/clientLocationFallback");

test("normalizeIpAddress keeps the first forwarded address and strips ipv4-mapped prefixes", () => {
  assert.equal(normalizeIpAddress("::ffff:203.0.113.9"), "203.0.113.9");
  assert.equal(normalizeIpAddress("203.0.113.9, 70.41.3.18"), "203.0.113.9");
});

test("isPrivateOrLocalIpAddress detects loopback and RFC1918 ranges", () => {
  assert.equal(isPrivateOrLocalIpAddress("127.0.0.1"), true);
  assert.equal(isPrivateOrLocalIpAddress("10.0.0.8"), true);
  assert.equal(isPrivateOrLocalIpAddress("192.168.0.12"), true);
  assert.equal(isPrivateOrLocalIpAddress("172.20.14.2"), true);
  assert.equal(isPrivateOrLocalIpAddress("203.0.113.9"), false);
});

test("readClientIp prefers forwarded headers", () => {
  const req = {
    headers: { "x-forwarded-for": "203.0.113.9, 70.41.3.18" },
    ip: "198.51.100.1",
  };

  assert.equal(readClientIp(req), "203.0.113.9");
});

test("resolveApproximateLocationFromRequest ignores local addresses", () => {
  const req = { ip: "127.0.0.1" };

  assert.equal(
    resolveApproximateLocationFromRequest(req, () => ({ ll: [37.5665, 126.978] })),
    null,
  );
});

test("resolveApproximateLocationFromRequest returns an approximate origin for public addresses", () => {
  const req = { headers: { "x-forwarded-for": "203.0.113.9" } };

  assert.deepEqual(
    resolveApproximateLocationFromRequest(req, () => ({ ll: [37.5665, 126.978] })),
    {
      source: "ip_geolocation",
      location: { lat: 37.5665, lng: 126.978 },
      accuracyMeters: 15000,
    },
  );
});
