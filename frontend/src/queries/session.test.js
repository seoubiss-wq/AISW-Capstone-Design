import { afterEach, expect, test, vi } from "vitest";
import { sessionBootstrapQueryOptions } from "./session";
import * as apiModule from "../lib/api";

afterEach(() => {
  vi.restoreAllMocks();
});

test("returns unauthenticated without requesting protected session resources when no session exists", async () => {
  const requestSpy = vi.spyOn(apiModule, "request");
  requestSpy.mockResolvedValueOnce({ authenticated: false });

  const result = await sessionBootstrapQueryOptions().queryFn();

  expect(result).toEqual({ authenticated: false });
  expect(requestSpy).toHaveBeenCalledTimes(1);
  expect(requestSpy).toHaveBeenCalledWith("/auth/session", { method: "GET" });
});

test("loads the remaining session resources after profile authentication succeeds", async () => {
  const requestSpy = vi.spyOn(apiModule, "request");
  requestSpy
    .mockResolvedValueOnce({ authenticated: true, user: { id: "user-1" } })
    .mockResolvedValueOnce({ preferences: {} })
    .mockResolvedValueOnce({ favorites: [] })
    .mockResolvedValueOnce({ history: [] })
    .mockResolvedValueOnce({ visits: [] });

  const result = await sessionBootstrapQueryOptions().queryFn();

  expect(result).toEqual({
    authenticated: true,
    profile: { user: { id: "user-1" } },
    preferencePayload: { preferences: {} },
    favoritesPayload: { favorites: [] },
    historyPayload: { history: [] },
    visitPayload: { visits: [] },
  });
  expect(requestSpy).toHaveBeenNthCalledWith(1, "/auth/session", { method: "GET" });
  expect(requestSpy).toHaveBeenCalledTimes(5);
});
