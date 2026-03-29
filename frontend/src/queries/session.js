import { request } from "../lib/api";

export function sessionBootstrapQueryOptions(token) {
  return {
    queryKey: ["session-bootstrap", token],
    enabled: Boolean(token),
    retry: false,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const [profile, preferencePayload, favoritesPayload, historyPayload, visitPayload] =
        await Promise.all([
          request("/auth/me", { method: "GET" }, token),
          request("/user/preferences", { method: "GET" }, token),
          request("/user/favorites", { method: "GET" }, token),
          request("/user/history", { method: "GET" }, token),
          request("/user/visits", { method: "GET" }, token),
        ]);

      return {
        profile,
        preferencePayload,
        favoritesPayload,
        historyPayload,
        visitPayload,
      };
    },
  };
}
