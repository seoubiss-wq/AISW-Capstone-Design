import { expect, test } from "vitest";
import {
  buildSupabaseGoogleRedirectUrl,
  isSupabaseGoogleSession,
  stripSupabaseAuthParams,
} from "./supabase";

test("recognizes google Supabase sessions", () => {
  expect(
    isSupabaseGoogleSession({
      access_token: "token",
      user: {
        app_metadata: {
          provider: "google",
        },
      },
    }),
  ).toBe(true);

  expect(
    isSupabaseGoogleSession({
      access_token: "token",
      user: {
        app_metadata: {
          provider: "kakao",
          providers: ["kakao"],
        },
      },
    }),
  ).toBe(false);
});

test("builds the Google OAuth redirect url from the current location", () => {
  expect(
    buildSupabaseGoogleRedirectUrl({
      origin: "https://tastepick.onrender.com",
      pathname: "/auth",
    }),
  ).toBe("https://tastepick.onrender.com/auth");
});

test("strips Supabase auth callback params from the returned url", () => {
  expect(
    stripSupabaseAuthParams(
      "https://tastepick.onrender.com/?code=abc&state=xyz#access_token=token&type=recovery",
    ),
  ).toBe("/");
});
