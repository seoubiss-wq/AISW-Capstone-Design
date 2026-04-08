const test = require("node:test");
const assert = require("node:assert/strict");

const {
  canAutoLinkGoogleAccount,
  GOOGLE_AUTH_PROVIDER,
  LOCAL_AUTH_PROVIDER,
  normalizeAuthProvider,
} = require("../scripts/shared/authProvider");

test("normalizeAuthProvider defaults unknown values to local", () => {
  assert.equal(normalizeAuthProvider(""), LOCAL_AUTH_PROVIDER);
  assert.equal(normalizeAuthProvider("email"), LOCAL_AUTH_PROVIDER);
});

test("normalizeAuthProvider preserves google provider", () => {
  assert.equal(normalizeAuthProvider("google"), GOOGLE_AUTH_PROVIDER);
  assert.equal(normalizeAuthProvider("GOOGLE"), GOOGLE_AUTH_PROVIDER);
});

test("canAutoLinkGoogleAccount only allows existing google accounts", () => {
  assert.equal(canAutoLinkGoogleAccount({ authProvider: GOOGLE_AUTH_PROVIDER }), true);
  assert.equal(canAutoLinkGoogleAccount({ authProvider: LOCAL_AUTH_PROVIDER }), false);
  assert.equal(canAutoLinkGoogleAccount({}), false);
});
