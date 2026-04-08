import { expect, test, vi } from "vitest";
import { sessionBootstrapQueryOptions } from "./session";
import * as apiModule from "../lib/api";

test("returns unauthenticated without requesting protected session resources on 401 profile", async () => {
  const requestSpy = vi.spyOn(apiModule, "request");
  requestSpy.mockRejectedValueOnce(Object.assign(new Error("Unauthorized"), { status: 401 }));

  const result = await sessionBootstrapQueryOptions().queryFn();

  expect(result).toEqual({ authenticated: false });
  expect(requestSpy).toHaveBeenCalledTimes(1);
  expect(requestSpy).toHaveBeenCalledWith("/auth/me", { method: "GET" });
});

test("loads the remaining session resources after profile authentication succeeds", async () => {
  const requestSpy = vi.spyOn(apiModule, "request");
  requestSpy
    .mockResolvedValueOnce({ user: { id: "user-1" } })
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
  expect(requestSpy).toHaveBeenNthCalledWith(1, "/auth/me", { method: "GET" });
  expect(requestSpy).toHaveBeenCalledTimes(5);
});
