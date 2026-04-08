import { request } from "../lib/api";

export function sessionBootstrapQueryOptions() {
  return {
    queryKey: ["session-bootstrap"],
    enabled: true,
    retry: false,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      try {
        const profile = await request("/auth/me", { method: "GET" });
        const [preferencePayload, favoritesPayload, historyPayload, visitPayload] =
          await Promise.all([
            request("/user/preferences", { method: "GET" }),
            request("/user/favorites", { method: "GET" }),
            request("/user/history", { method: "GET" }),
            request("/user/visits", { method: "GET" }),
          ]);

        return {
          authenticated: true,
          profile,
          preferencePayload,
          favoritesPayload,
          historyPayload,
          visitPayload,
        };
      } catch (error) {
        if (error?.status === 401) {
          return { authenticated: false };
        }
        throw error;
      }
    },
  };
}
