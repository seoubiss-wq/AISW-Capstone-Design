const test = require("node:test");
const assert = require("node:assert/strict");

const {
  fetchSupabaseUserProfile,
  hasGoogleProvider,
  pickSupabaseDisplayName,
} = require("../scripts/shared/supabaseAuth");

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
