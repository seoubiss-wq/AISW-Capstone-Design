import { request } from "../lib/api";

export function sessionBootstrapQueryOptions() {
  return {
    queryKey: ["session-bootstrap"],
    enabled: true,
    retry: false,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const sessionPayload = await request("/auth/session", { method: "GET" });
      if (!sessionPayload?.authenticated) {
        return { authenticated: false };
      }

      const [preferencePayload, favoritesPayload, historyPayload, visitPayload] =
        await Promise.all([
          request("/user/preferences", { method: "GET" }),
          request("/user/favorites", { method: "GET" }),
          request("/user/history", { method: "GET" }),
          request("/user/visits", { method: "GET" }),
        ]);

      return {
        authenticated: true,
        profile: { user: sessionPayload.user || null },
        preferencePayload,
        favoritesPayload,
        historyPayload,
        visitPayload,
      };
    },
  };
}
