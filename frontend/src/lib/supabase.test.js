import { expect, test, vi } from "vitest";
import {
  buildSupabaseStoragePrefix,
  clearSupabaseAuthStorage,
  getSupabaseAuthConfig,
  getSupabaseBridgeStorage,
  hasSupabaseAuthConfig,
  hydrateSupabaseAuthConfig,
} from "./supabase";

function createMockStorage(initialEntries) {
  const map = new Map(initialEntries);

  return {
    get length() {
      return map.size;
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

test("buildSupabaseStoragePrefix derives the Supabase project ref", () => {
  expect(buildSupabaseStoragePrefix("https://tastepick.supabase.co")).toBe("sb-tastepick-auth-token");
});

test("clearSupabaseAuthStorage removes persisted Supabase auth artifacts", () => {
  const storage = createMockStorage([
    ["sb-tastepick-auth-token", "session"],
    ["sb-tastepick-auth-token-code-verifier", "verifier"],
    ["other-key", "keep-me"],
  ]);

  clearSupabaseAuthStorage([storage], "https://tastepick.supabase.co");

  expect(storage.getItem("sb-tastepick-auth-token")).toBeNull();
  expect(storage.getItem("sb-tastepick-auth-token-code-verifier")).toBeNull();
  expect(storage.getItem("other-key")).toBe("keep-me");
});

test("getSupabaseBridgeStorage prefers sessionStorage for ephemeral OAuth bridging", () => {
  expect(getSupabaseBridgeStorage()).toBe(window.sessionStorage);
});

test("getSupabaseAuthConfig uses DEV scoped env values in local builds", () => {
  const config = getSupabaseAuthConfig();
  expect(config).toEqual({
    url: expect.any(String),
    publishableKey: expect.any(String),
  });
});

test("hydrateSupabaseAuthConfig adopts the backend auth configuration", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      supabaseUrl: "https://prod-project-ref.supabase.co",
      supabasePublishableKey: "prod-publishable-key",
    }),
  });

  const config = await hydrateSupabaseAuthConfig(fetchMock);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(config).toEqual({
    url: "https://prod-project-ref.supabase.co",
    publishableKey: "prod-publishable-key",
  });
  expect(getSupabaseAuthConfig()).toEqual(config);
  expect(hasSupabaseAuthConfig()).toBe(true);
});
