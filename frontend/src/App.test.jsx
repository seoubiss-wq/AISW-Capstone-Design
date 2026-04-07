import { afterEach, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import App, {
  buildRecommendationAssistantText,
  getRecommendationFeedbackState,
  isNearbyRecommendationSeed,
  shouldUseOriginLocationAsCurrentLocation,
} from "./App";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders TastePick brand on the home screen without auto-fetching nearby results", () => {
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
  expect(fetchMock).not.toHaveBeenCalled();
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

test("recognizes the default nearby recommendation seed query", () => {
  expect(isNearbyRecommendationSeed("내 주변 맛집 추천")).toBe(true);
  expect(isNearbyRecommendationSeed("강남 맛집 추천")).toBe(false);
});

test("builds an empty-result assistant message when no restaurants are found", () => {
  expect(
    buildRecommendationAssistantText({
      personalizationApplied: "최대 이동 거리: 10km",
      query: "강남 맛집 추천",
      resultCount: 0,
    }),
  ).toContain("맞는 식당을 찾지 못했어요");

  expect(
    buildRecommendationAssistantText({
      personalizationApplied: "",
      query: "강남 맛집 추천",
      resultCount: 2,
    }),
  ).toContain("조건에 맞는 곳을 골랐어요");
});

test("waits for the recommendation response before showing empty-state copy", () => {
  expect(
    getRecommendationFeedbackState({
      loading: false,
      hasRecommendationResponse: false,
      resultCount: 0,
    }),
  ).toBe("idle");

  expect(
    getRecommendationFeedbackState({
      loading: true,
      hasRecommendationResponse: false,
      resultCount: 0,
    }),
  ).toBe("loading");

  expect(
    getRecommendationFeedbackState({
      loading: false,
      hasRecommendationResponse: true,
      resultCount: 0,
    }),
  ).toBe("empty");
});
