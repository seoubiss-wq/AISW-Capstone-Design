import { afterEach, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import App, { shouldUseOriginLocationAsCurrentLocation } from "./App";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders TastePick brand on the auth screen", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => ({
      items: [],
      personalizationApplied: "",
    }),
  });
  vi.stubGlobal("fetch", fetchMock);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
  expect(screen.getAllByText(/TastePick/i).length).toBeGreaterThan(0);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
});

test("does not promote IP fallback coordinates to the current location", () => {
  expect(
    shouldUseOriginLocationAsCurrentLocation(null, {
      originSource: "google_geolocation_ip",
      originLocation: { lat: 40.0, lng: -83.0 },
    }),
  ).toBe(false);

  expect(
    shouldUseOriginLocationAsCurrentLocation(null, {
      originSource: "browser_geolocation",
      originLocation: { lat: 37.5665, lng: 126.978 },
    }),
  ).toBe(true);
});
