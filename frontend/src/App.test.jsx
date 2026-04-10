import { afterEach, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import App, {
  buildGeolocationErrorMessage,
  buildRecommendationRequestBody,
  buildRecommendationAssistantText,
  buildRecommendationDecisionBrief,
  canUseMaxDistancePreference,
  getRecommendationFeedbackState,
  getRecommendationOpenStatusLabel,
  isNearbyRecommendationSeed,
  shouldRetryGeolocationRequest,
  shouldWaitForLocationBeforeRecommendation,
  shouldUseOriginLocationAsCurrentLocation,
} from "./App";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders TastePick brand on the home screen without auto-fetching nearby results", async () => {
  const fetchMock = vi.fn().mockImplementation(async (input) => {
    const url = String(input || "");

    if (
      url.includes("/auth/me") ||
      url.includes("/user/preferences") ||
      url.includes("/user/favorites") ||
      url.includes("/user/history") ||
      url.includes("/user/visits")
    ) {
      return {
        ok: false,
        status: 401,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ error: "로그인이 필요합니다." }),
      };
    }

    return {
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        items: [],
        personalizationApplied: "",
      }),
    };
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
  screen.getByText("내 주변 맛집 추천");
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(fetchMock.mock.calls.some(([input]) => String(input || "").includes("/recommend"))).toBe(false);
});

test("builds a trust-focused decision brief for recommendation cards", () => {
  expect(
    buildRecommendationDecisionBrief({
      distanceKm: 1.8,
      travelDuration: "11분",
      openNow: true,
    }),
  ).toBe("1.8km · 11분 · 영업 중");

  expect(
    getRecommendationOpenStatusLabel({
      businessStatus: "CLOSED_TEMPORARILY",
    }),
  ).toBe("임시 휴업");
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

test("requires a resolved current location before enabling max distance", () => {
  expect(canUseMaxDistancePreference(null)).toBe(false);
  expect(canUseMaxDistancePreference({ lat: 37.5665, lng: 126.978 })).toBe(true);
});

test("waits for location resolution whenever coordinates are missing", () => {
  expect(shouldWaitForLocationBeforeRecommendation(null)).toBe(true);
  expect(
    shouldWaitForLocationBeforeRecommendation({ lat: 37.5665, lng: 126.978 }),
  ).toBe(false);
});

test("retries geolocation only for retryable browser errors", () => {
  expect(shouldRetryGeolocationRequest({ code: 2 })).toBe(true);
  expect(shouldRetryGeolocationRequest({ code: 3 })).toBe(true);
  expect(shouldRetryGeolocationRequest({ code: 1 })).toBe(false);
});

test("builds location failure messages that distinguish timeout from permission errors", () => {
  expect(buildGeolocationErrorMessage({ code: 1 })).toContain("권한");
  expect(buildGeolocationErrorMessage({ code: 3 })).toContain("시간");
  expect(buildGeolocationErrorMessage(null, { secureContext: false })).toContain("HTTPS");
});

test("adds the open-now filter only for AI recommendations", () => {
  expect(
    buildRecommendationRequestBody({
      input: "강남 맛집 추천",
      currentLocation: { lat: 37.5665, lng: 126.978 },
      targetView: "ai",
      openNowOnly: true,
    }),
  ).toEqual({
    input: "강남 맛집 추천",
    currentLocation: { lat: 37.5665, lng: 126.978 },
    openNowOnly: true,
  });

  expect(
    buildRecommendationRequestBody({
      input: "강남 맛집 추천",
      currentLocation: { lat: 37.5665, lng: 126.978 },
      targetView: "recommend",
      openNowOnly: true,
    }),
  ).toEqual({
    input: "강남 맛집 추천",
    currentLocation: { lat: 37.5665, lng: 126.978 },
  });
});

test("adds the bypass-cache flag for nearby recommendation requests", () => {
  expect(
    buildRecommendationRequestBody({
      input: "\uB0B4 \uC8FC\uBCC0 \uB9DB\uC9D1 \uCD94\uCC9C",
      currentLocation: { lat: 37.5665, lng: 126.978 },
      targetView: "recommend",
    }),
  ).toEqual({
    input: "\uB0B4 \uC8FC\uBCC0 \uB9DB\uC9D1 \uCD94\uCC9C",
    currentLocation: { lat: 37.5665, lng: 126.978 },
    bypassCache: true,
  });
});
