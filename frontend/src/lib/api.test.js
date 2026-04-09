import { expect, test } from "vitest";
import { resolveApiBaseUrl, resolveApiUrl } from "./api";

test("resolveApiBaseUrl defaults to same-origin in dev so Vite proxy can handle API traffic", () => {
  expect(resolveApiBaseUrl({ PROD: false })).toBe("");
  expect(resolveApiUrl("/auth/me", { PROD: false })).toBe("/auth/me");
});

test("resolveApiBaseUrl keeps custom dev API base in split dev mode", () => {
  const env = {
    PROD: false,
    REACT_APP_API_BASE_URL: "http://192.168.35.169:5500/",
  };

  expect(resolveApiBaseUrl(env)).toBe("http://192.168.35.169:5500");
});

test("resolveApiBaseUrl drops localhost API base in dev so browsers only need the Vite port", () => {
  const env = {
    PROD: false,
    REACT_APP_API_BASE_URL: "http://localhost:5500",
  };

  expect(resolveApiBaseUrl(env)).toBe("");
  expect(resolveApiUrl("/recommend", env)).toBe("/recommend");
});

test("resolveApiBaseUrl drops localhost API base in production builds", () => {
  const env = {
    PROD: true,
    REACT_APP_API_BASE_URL: "http://localhost:5500",
  };

  expect(resolveApiBaseUrl(env)).toBe("");
  expect(resolveApiUrl("/recommend", env)).toBe("/recommend");
});

test("resolveApiBaseUrl forces same-origin when auth-dev build flag is enabled", () => {
  const env = {
    PROD: true,
    REACT_APP_API_BASE_URL: "https://old-tunnel.example.com",
    REACT_APP_FORCE_SAME_ORIGIN: "true",
  };

  expect(resolveApiBaseUrl(env)).toBe("");
  expect(resolveApiUrl("/auth/oauth/google", env)).toBe("/auth/oauth/google");
});

test("resolveApiBaseUrl preserves non-local production API origins", () => {
  const env = {
    PROD: true,
    REACT_APP_API_BASE_URL: "https://api.tastepicknow.com",
  };

  expect(resolveApiBaseUrl(env)).toBe("https://api.tastepicknow.com");
  expect(resolveApiUrl("/place-details/test", env)).toBe("https://api.tastepicknow.com/place-details/test");
});
