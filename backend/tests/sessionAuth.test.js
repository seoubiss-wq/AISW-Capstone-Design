const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SESSION_COOKIE_NAME,
  buildSessionCookieOptions,
  hashSessionToken,
  normalizeStoredSessionToken,
  readSessionToken,
} = require("../scripts/shared/sessionAuth");

test("normalizes raw session tokens to sha256 hashes", () => {
  const token = "plain-session-token";
  const expected = hashSessionToken(token);

  assert.equal(normalizeStoredSessionToken(token), expected);
  assert.equal(normalizeStoredSessionToken(expected), expected);
});

test("prefers the httpOnly session cookie over bearer headers", () => {
  const token = readSessionToken({
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=cookie-token`,
      authorization: "Bearer bearer-token",
    },
  });

  assert.equal(token, "cookie-token");
});

test("marks cookies secure only for https requests", () => {
  assert.equal(
    buildSessionCookieOptions(
      { headers: { "x-forwarded-proto": "https" } },
      { publicOrigin: "" },
    ).secure,
    true,
  );

  assert.equal(
    buildSessionCookieOptions(
      { headers: { "x-forwarded-proto": "http" } },
      { publicOrigin: "" },
    ).secure,
    false,
  );
});
