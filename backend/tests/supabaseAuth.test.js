const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSupabaseAuthConfig,
  fetchSupabaseUserProfile,
  getSupabaseProjectRefFromAccessToken,
  hasGoogleProvider,
  pickSupabaseDisplayName,
  resolveSupabaseAuthConfigForAccessToken,
} = require("../scripts/shared/supabaseAuth");

function buildAccessToken(payload) {
  const base64Url = (value) =>
    Buffer.from(JSON.stringify(value))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

  return `${base64Url({ alg: "HS256", typ: "JWT" })}.${base64Url(payload)}.signature`;
}

test("detects google providers from Supabase user payloads", () => {
  assert.equal(
    hasGoogleProvider({
      app_metadata: {
        provider: "google",
      },
    }),
    true,
  );

  assert.equal(
    hasGoogleProvider({
      app_metadata: {
        providers: ["email", "google"],
      },
    }),
    true,
  );

  assert.equal(
    hasGoogleProvider({
      identities: [{ provider: "google" }],
    }),
    true,
  );

  assert.equal(
    hasGoogleProvider({
      app_metadata: {
        provider: "email",
      },
    }),
    false,
  );
});

test("picks a reasonable display name from Supabase metadata", () => {
  assert.equal(
    pickSupabaseDisplayName({
      user_metadata: {
        full_name: "Taste Pick",
      },
    }),
    "Taste Pick",
  );

  assert.equal(
    pickSupabaseDisplayName({
      email: "tastepick@example.com",
    }),
    "tastepick",
  );
});

test("fetches and validates the google Supabase profile", async () => {
  const profile = await fetchSupabaseUserProfile({
    accessToken: "access-token",
    supabaseUrl: "https://example.supabase.co",
    supabasePublishableKey: "publishable-key",
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://example.supabase.co/auth/v1/user");
      assert.equal(options.headers.Authorization, "Bearer access-token");
      assert.equal(options.headers.apikey, "publishable-key");

      return {
        ok: true,
        json: async () => ({
          email: "google-user@example.com",
          app_metadata: {
            provider: "google",
            providers: ["google"],
          },
          user_metadata: {
            full_name: "Google User",
          },
        }),
      };
    },
  });

  assert.deepEqual(profile, {
    email: "google-user@example.com",
    name: "Google User",
    user: {
      email: "google-user@example.com",
      app_metadata: {
        provider: "google",
        providers: ["google"],
      },
      user_metadata: {
        full_name: "Google User",
      },
    },
  });
});

test("extracts the issuing Supabase project ref from the access token", () => {
  const accessToken = buildAccessToken({
    iss: "https://dev-project-ref.supabase.co/auth/v1",
    sub: "user-1",
  });

  assert.equal(getSupabaseProjectRefFromAccessToken(accessToken), "dev-project-ref");
});

test("picks the matching Supabase auth config for the token issuer", () => {
  const accessToken = buildAccessToken({
    iss: "https://prod-project-ref.supabase.co/auth/v1",
    sub: "user-2",
  });
  const authConfig = resolveSupabaseAuthConfigForAccessToken(accessToken, [
    buildSupabaseAuthConfig({
      label: "dev",
      supabaseUrl: "https://dev-project-ref.supabase.co",
      supabasePublishableKey: "dev-key",
    }),
    buildSupabaseAuthConfig({
      label: "prod",
      supabaseUrl: "https://prod-project-ref.supabase.co",
      supabasePublishableKey: "prod-key",
    }),
  ]);

  assert.deepEqual(authConfig, {
    label: "prod",
    projectRef: "prod-project-ref",
    supabaseUrl: "https://prod-project-ref.supabase.co",
    supabasePublishableKey: "prod-key",
  });
});

test("falls back to the first valid auth config when the token issuer is unavailable", () => {
  const authConfig = resolveSupabaseAuthConfigForAccessToken("not-a-jwt", [
    buildSupabaseAuthConfig({
      label: "runtime-dev",
      supabaseUrl: "https://dev-project-ref.supabase.co",
      supabasePublishableKey: "dev-key",
    }),
    buildSupabaseAuthConfig({
      label: "prod",
      supabaseUrl: "https://prod-project-ref.supabase.co",
      supabasePublishableKey: "prod-key",
    }),
  ]);

  assert.deepEqual(authConfig, {
    label: "runtime-dev",
    projectRef: "dev-project-ref",
    supabaseUrl: "https://dev-project-ref.supabase.co",
    supabasePublishableKey: "dev-key",
  });
});
