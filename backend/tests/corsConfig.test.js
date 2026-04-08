const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEV_CORS_ORIGINS,
  buildAllowedCorsOrigins,
  resolveCorsOrigin,
} = require("../scripts/shared/corsConfig");

test("buildAllowedCorsOrigins merges dev, public, and extra origins", () => {
  const allowedOrigins = buildAllowedCorsOrigins({
    devOrigins: DEV_CORS_ORIGINS,
    apiPublicOrigin: "https://tastepick.onrender.com/",
    extraOrigins: "https://a.example.com, https://b.example.com/",
  });

  assert.equal(allowedOrigins.has("http://localhost:3000"), true);
  assert.equal(allowedOrigins.has("https://tastepick.onrender.com"), true);
  assert.equal(allowedOrigins.has("https://a.example.com"), true);
  assert.equal(allowedOrigins.has("https://b.example.com"), true);
});

test("resolveCorsOrigin reflects allowed origins instead of wildcard booleans", () => {
  const allowedOrigins = buildAllowedCorsOrigins({
    devOrigins: ["http://localhost:3000"],
  });

  assert.equal(resolveCorsOrigin("http://localhost:3000", allowedOrigins), "http://localhost:3000");
  assert.equal(resolveCorsOrigin("http://localhost:9999", allowedOrigins), false);
  assert.equal(resolveCorsOrigin(undefined, allowedOrigins), true);
});
