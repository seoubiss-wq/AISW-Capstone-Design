const test = require("node:test");
const assert = require("node:assert/strict");

const {
  canAutoLinkGoogleAccount,
  GOOGLE_AUTH_PROVIDER,
  hasAuthProvider,
  LOCAL_AUTH_PROVIDER,
  mergeAuthProvider,
  normalizeAuthProvider,
  parseAuthProviders,
} = require("../scripts/shared/authProvider");

test("normalizeAuthProvider defaults unknown values to local", () => {
  assert.equal(normalizeAuthProvider(""), LOCAL_AUTH_PROVIDER);
  assert.equal(normalizeAuthProvider("email"), LOCAL_AUTH_PROVIDER);
});

test("normalizeAuthProvider preserves google provider", () => {
  assert.equal(normalizeAuthProvider("google"), GOOGLE_AUTH_PROVIDER);
  assert.equal(normalizeAuthProvider("GOOGLE"), GOOGLE_AUTH_PROVIDER);
});

test("normalizeAuthProvider preserves merged providers in canonical order", () => {
  assert.equal(normalizeAuthProvider("google,local"), "local,google");
  assert.equal(mergeAuthProvider("local", GOOGLE_AUTH_PROVIDER), "local,google");
  assert.deepEqual(parseAuthProviders("local,google"), [LOCAL_AUTH_PROVIDER, GOOGLE_AUTH_PROVIDER]);
});

test("hasAuthProvider reads merged auth providers", () => {
  assert.equal(hasAuthProvider({ authProvider: "local,google" }, LOCAL_AUTH_PROVIDER), true);
  assert.equal(hasAuthProvider({ authProvider: "local,google" }, GOOGLE_AUTH_PROVIDER), true);
});

test("canAutoLinkGoogleAccount only allows existing google accounts", () => {
  assert.equal(canAutoLinkGoogleAccount({ authProvider: GOOGLE_AUTH_PROVIDER }), true);
  assert.equal(canAutoLinkGoogleAccount({ authProvider: "local,google" }), true);
  assert.equal(canAutoLinkGoogleAccount({ authProvider: LOCAL_AUTH_PROVIDER }), false);
  assert.equal(canAutoLinkGoogleAccount({}), false);
});
