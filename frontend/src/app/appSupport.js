import { resolveApiUrl } from "../lib/api";

const AUTH_SESSION_MARKER = "session";
const THEME_STORAGE_KEY = "tastepick.theme.mode";
const LARGE_TEXT_STORAGE_KEY = "tastepick.accessibility.largeText";

const DEFAULT_PREFERENCES = {
  favoriteCuisine: "",
  mood: "",
  budget: "",
  maxDistanceKm: "",
  avoidIngredients: "",
};

const ROUTE_MODE_OPTIONS = [
  { id: "DRIVING", label: "자동차" },
  { id: "WALKING", label: "도보" },
  { id: "TRANSIT", label: "대중교통" },
];

const DEFAULT_ROUTE_UI = {
  mode: "DRIVING",
  status: "idle",
  distanceText: "",
  durationText: "",
  summary: "",
  steps: [],
  message: "현재 위치를 허용하면 웹 안에서 경로를 표시합니다.",
};

const NAV_ITEMS = [
  { id: "home", label: "홈" },
  { id: "ai", label: "AI 채팅" },
  { id: "recommend", label: "추천 맛집" },
  { id: "map", label: "지도" },
  { id: "mypage", label: "마이페이지" },
];

const NAV_ITEM_ICONS = {
  home: "home",
  ai: "auto_awesome",
  recommend: "restaurant",
  map: "map",
  mypage: "person",
};
const NEARBY_LOCATION_PATTERN = /(내\s*)?(주변|근처|인근|가까운|nearby|near me)/i;
const NEARBY_FOOD_PATTERN = /(맛집|식당|음식점|밥집|restaurant|food)/i;

function shouldUseOriginLocationAsCurrentLocation(currentLocation, payload) {
  if (currentLocation) return false;
  if (payload?.originSource !== "browser_geolocation") return false;

  return (
    Number.isFinite(payload?.originLocation?.lat) &&
    Number.isFinite(payload?.originLocation?.lng)
  );
}

function isNearbyRecommendationSeed(queryText) {
  const normalized = String(queryText || "").trim();
  if (!normalized) return false;
  if (normalized === "내 주변 맛집 추천") return true;

  return NEARBY_LOCATION_PATTERN.test(normalized) && NEARBY_FOOD_PATTERN.test(normalized);
}

function canUseMaxDistancePreference(currentLocation) {
  return Number.isFinite(currentLocation?.lat) && Number.isFinite(currentLocation?.lng);
}

function shouldWaitForLocationBeforeRecommendation(currentLocation) {
  return !canUseMaxDistancePreference(currentLocation);
}

function shouldRetryGeolocationRequest(error) {
  const errorCode = Number(error?.code);
  return errorCode === 2 || errorCode === 3;
}

function buildGeolocationErrorMessage(error, { secureContext = true } = {}) {
  if (!secureContext) {
    return "보안 연결(HTTPS) 환경에서만 현재 위치를 확인할 수 있습니다.";
  }

  switch (Number(error?.code)) {
    case 1:
      return "위치 권한이 거부되어 현재 위치를 확인하지 못했습니다. 브라우저 위치 권한을 허용한 뒤 다시 시도해 주세요.";
    case 2:
      return "기기에서 현재 위치를 확인하지 못했습니다. GPS 또는 네트워크 상태를 확인한 뒤 다시 시도해 주세요.";
    case 3:
      return "위치 확인 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.";
    default:
      return "현재 위치를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
}

function buildRecommendationRequestBody({
  input,
  currentLocation,
  targetView = "ai",
  openNowOnly = false,
}) {
  return {
    input,
    ...(currentLocation ? { currentLocation } : {}),
    ...(isNearbyRecommendationSeed(input) ? { bypassCache: true } : {}),
    ...(targetView === "ai" && openNowOnly ? { openNowOnly: true } : {}),
  };
}

function isMobileDeviceEnvironment() {
  if (typeof navigator === "undefined") return false;
  if (typeof navigator.userAgentData?.mobile === "boolean") {
    return navigator.userAgentData.mobile;
  }

  const userAgent = String(navigator.userAgent || "");
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(userAgent)) {
    return true;
  }

  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

function buildRecommendationAssistantText({ personalizationApplied, query, resultCount }) {
  if (resultCount > 0) {
    return personalizationApplied
      ? `${personalizationApplied} 조건을 반영해 추천했어요.`
      : `${query} 조건에 맞는 곳을 골랐어요.`;
  }

  return personalizationApplied
    ? `${personalizationApplied} 조건을 반영했지만 맞는 식당을 찾지 못했어요. 조건을 조금 완화해 보세요.`
    : `${query} 조건에 맞는 식당을 찾지 못했어요. 다른 조건으로 다시 시도해 보세요.`;
}

function getRecommendationFeedbackState({ loading, hasRecommendationResponse, resultCount }) {
  if (resultCount > 0) return "results";
  if (loading) return "loading";
  if (hasRecommendationResponse) return "empty";
  return "idle";
}

function getRecommendationOpenStatusLabel(item = {}) {
  if (item?.openNow === true) return "영업 중";
  if (item?.openNow === false) return "영업 종료";

  const businessStatus = String(item?.businessStatus || "").trim().toUpperCase();
  if (businessStatus === "CLOSED_TEMPORARILY") return "임시 휴업";
  if (businessStatus === "CLOSED_PERMANENTLY") return "영업 종료";

  return "영업 정보 확인 필요";
}

function buildRecommendationDecisionBrief(item = {}) {
  const parts = [];

  if (item?.distanceKm != null) {
    parts.push(`${item.distanceKm.toFixed(1)}km`);
  } else if (typeof item?.locationText === "string" && item.locationText.trim()) {
    parts.push(item.locationText.trim());
  }

  if (typeof item?.travelDuration === "string" && item.travelDuration.trim()) {
    parts.push(item.travelDuration.trim());
  }

  parts.push(getRecommendationOpenStatusLabel(item));
  return [...new Set(parts.filter(Boolean))].join(" · ");
}

function buildAppHistoryState({ activeView, selectedItemId, detailItem }) {
  const shouldPersistSelectedItem = ["map", "detail", "reviews"].includes(activeView);
  return {
    __tastepickHistory: true,
    activeView,
    selectedItemId: shouldPersistSelectedItem ? selectedItemId || "" : "",
    detailItem:
      activeView === "detail" || activeView === "reviews"
        ? detailItem || null
        : null,
  };
}

function isAppHistoryState(state) {
  return Boolean(state?.__tastepickHistory && typeof state.activeView === "string");
}

function getAppHistorySnapshot(state) {
  return JSON.stringify({
    activeView: state?.activeView || "home",
    selectedItemId: state?.selectedItemId || "",
    detailItemId: state?.detailItem?.id || "",
    detailItemPlaceId: state?.detailItem?.placeId || "",
  });
}
const DIETARY_OPTIONS = ["땅콩 알레르기", "저염식", "유제품 제한", "밀가루 제한"];
const FOLLOW_UP_CHIPS = ["더 가까운 곳", "주차 가능한 곳", "조용한 곳"];
const POPULAR_TAGS = ["#한정식", "#조용한식당", "#건강식", "#강남맛집", "#발렛파킹"];

const DEMO_ITEMS = [
  {
    id: "demo-1",
    name: "은화정 본점",
    reason: "정갈한 한상차림과 프라이빗한 룸 구성이 있어 조용한 식사를 원할 때 잘 맞습니다.",
    imageUrl:
      "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=80",
    category: "한식",
    rating: 4.8,
    locationText: "강남구 · 1.2km 거리",
    featureTags: ["AI 추천", "한식"],
    keywords: ["건강한 식당", "프라이빗 룸"],
    distanceKm: 1.2,
    travelDuration: "12분",
    routeSummary: "강남역에서 직진 후 우회전, 도보 12분",
    openNow: true,
    businessStatus: "OPERATIONAL",
    links: {
      googleMap: "https://www.google.com/maps/search/?api=1&query=%EC%9D%80%ED%99%94%EC%A0%95%20%EA%B0%95%EB%82%A8",
      googleDirections:
        "https://www.google.com/maps/dir/?api=1&destination=%EC%9D%80%ED%99%94%EC%A0%95%20%EA%B0%95%EB%82%A8",
    },
    phoneLabel: "전화하기",
  },
  {
    id: "demo-2",
    name: "더 파스타 베네",
    reason: "부드러운 크림 소스와 차분한 조명, 대화하기 편한 좌석 구성이 돋보이는 이탈리안 공간입니다.",
    imageUrl:
      "https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=1200&q=80",
    category: "양식",
    rating: 4.6,
    locationText: "서초구 · 0.8km 거리",
    featureTags: ["인기 메뉴", "양식"],
    keywords: ["데이트", "조용한 좌석"],
    distanceKm: 0.8,
    travelDuration: "10분",
    routeSummary: "서초대로를 따라 직진하면 바로 도착합니다.",
    openNow: true,
    businessStatus: "OPERATIONAL",
    links: {
      googleMap: "https://www.google.com/maps/search/?api=1&query=%EB%8D%94%20%ED%8C%8C%EC%8A%A4%ED%83%80%20%EB%B2%A0%EB%84%A4",
      googleDirections:
        "https://www.google.com/maps/dir/?api=1&destination=%EB%8D%94%20%ED%8C%8C%EC%8A%A4%ED%83%80%20%EB%B2%A0%EB%84%A4",
    },
    phoneLabel: "전화하기",
  },
  {
    id: "demo-3",
    name: "스시 유유",
    reason: "조용한 바 좌석과 담백한 구성으로 혼자 또는 둘이 편하게 식사하기 좋은 스시 코스입니다.",
    imageUrl:
      "https://images.unsplash.com/photo-1579871494447-9811cf80d66c?auto=format&fit=crop&w=1200&q=80",
    category: "일식",
    rating: 4.9,
    locationText: "송파구 · 2.1km 거리",
    featureTags: ["프리미엄", "일식"],
    keywords: ["혼밥", "코스"],
    distanceKm: 2.1,
    travelDuration: "18분",
    routeSummary: "대로변을 따라 이동 후 골목 안쪽으로 들어오면 바로 보입니다.",
    openNow: false,
    businessStatus: "OPERATIONAL",
    links: {
      googleMap: "https://www.google.com/maps/search/?api=1&query=%EC%8A%A4%EC%8B%9C%20%EC%9C%A0%EC%9C%A0",
      googleDirections:
        "https://www.google.com/maps/dir/?api=1&destination=%EC%8A%A4%EC%8B%9C%20%EC%9C%A0%EC%9C%A0",
    },
    phoneLabel: "전화하기",
  },
];

function resolveMediaUrl(url) {
  return resolveApiUrl(url);
}

function readStoredDarkMode() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === "dark";
  } catch {
    return false;
  }
}

function persistDarkMode(enabled) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, enabled ? "dark" : "light");
  } catch {}
}

function readStoredLargeText() {
  try {
    return localStorage.getItem(LARGE_TEXT_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistLargeText(enabled) {
  try {
    localStorage.setItem(LARGE_TEXT_STORAGE_KEY, enabled ? "true" : "false");
  } catch {}
}

function buildMessage(type, text) {
  return text ? { type, text } : null;
}

function getSpeechRecognitionCtor() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function normalizePreferences(preferences) {
  return { ...DEFAULT_PREFERENCES, ...(preferences || {}) };
}

function splitTokens(value) {
  return [...new Set(
    String(value || "")
      .split(/[,\n/|]+/)
      .flatMap((chunk) => chunk.split(/\s{2,}|\s*,\s*|,\s*/))
      .map((token) => token.trim())
      .filter(Boolean),
  )];
}

function formatDate(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString("ko-KR", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatRelativeDate(value, fallback) {
  if (!value) return fallback || "";
  const now = Date.now();
  const time = new Date(value).getTime();
  const diffHours = Math.max(1, Math.round((now - time) / (1000 * 60 * 60)));
  if (diffHours < 24) return `${diffHours} hours ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  return `${diffDays} days ago`;
}

function getVisitBucket(value, index) {
  if (!value) return index === 0 ? "오늘" : index === 1 ? "어제" : "지난 주";
  const visit = new Date(value);
  const now = new Date();
  const diffDays = Math.floor((now - visit) / (1000 * 60 * 60 * 24));
  if (diffDays < 1) return "오늘";
  if (diffDays < 2) return "어제";
  return "지난 주";
}

function enrichItem(raw, index) {
  const fallback = DEMO_ITEMS[index % DEMO_ITEMS.length];
  const hasRawItem = Boolean(raw && Object.keys(raw).length);
  return {
    ...fallback,
    ...raw,
    id: raw?.id || `${fallback.id}-${index}`,
    imageUrl: resolveMediaUrl(raw?.imageUrl || fallback.imageUrl),
    reason: raw?.reason || fallback.reason,
    address: raw?.address || "",
    category: raw?.category || fallback.category,
    rating: Number(raw?.rating || fallback.rating),
    featureTags: raw?.featureTags || fallback.featureTags,
    keywords: raw?.keywords || fallback.keywords,
    locationText:
      raw?.distanceKm != null
        ? `${raw.distanceKm.toFixed(1)}km 거리`
        : raw?.locationText || (hasRawItem ? "" : fallback.locationText),
    distanceKm: raw?.distanceKm ?? (hasRawItem ? null : fallback.distanceKm),
    travelDuration:
      typeof raw?.travelDuration === "string"
        ? raw.travelDuration
        : hasRawItem
          ? ""
          : fallback.travelDuration,
    routeSummary:
      typeof raw?.routeSummary === "string"
        ? raw.routeSummary
        : hasRawItem
          ? ""
          : fallback.routeSummary,
    openNow:
      typeof raw?.openNow === "boolean"
        ? raw.openNow
        : hasRawItem
          ? null
          : fallback.openNow ?? null,
    businessStatus:
      typeof raw?.businessStatus === "string"
        ? raw.businessStatus
        : hasRawItem
          ? ""
          : fallback.businessStatus || "",
    links: raw?.links && typeof raw.links === "object" ? raw.links : fallback.links,
    phoneLabel: raw?.phoneLabel || fallback.phoneLabel,
  };
}

function buildPreferredExternalMapLinks(item) {
  const query = [item?.name, item?.address].filter(Boolean).join(" ").trim();
  const encodedQuery = encodeURIComponent(query || item?.name || "");
  const encodedAddress = encodeURIComponent(item?.address || item?.name || "");

  return {
    naver: encodedQuery ? `https://map.naver.com/p/search/${encodedQuery}` : "",
    // TODO: Kakao place_url / place id를 확보하면 검색 링크 대신 정확한 상세 페이지 링크로 교체한다.
    kakao:
      item?.links?.kakaoMap ||
      (encodedAddress ? `https://map.kakao.com/link/search/${encodedAddress}` : ""),
    google:
      item?.links?.googleMap ||
      (encodedQuery ? `https://www.google.com/maps/search/?api=1&query=${encodedQuery}` : ""),
  };
}

function formatPlaceDetailsPhone(place) {
  return place?.nationalPhoneNumber || place?.internationalPhoneNumber || "";
}

function formatPlaceDetailsWebsite(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

function formatDetailReview(review) {
  if (!review) return null;
  return {
    id: review.id || `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    author: review.authorName || review.author || "Google 사용자",
    daysAgo:
      review.relativeTimeDescription ||
      formatDate(review.publishTime) ||
      review.daysAgo ||
      "",
    rating: Number(review.rating || 0) || 0,
    text: review.text || "",
    tags: Array.isArray(review.tags) ? review.tags.filter(Boolean) : [],
  };
}

export {
  AUTH_SESSION_MARKER,
  DEFAULT_PREFERENCES,
  ROUTE_MODE_OPTIONS,
  DEFAULT_ROUTE_UI,
  DIETARY_OPTIONS,
  FOLLOW_UP_CHIPS,
  POPULAR_TAGS,
  DEMO_ITEMS,
  shouldUseOriginLocationAsCurrentLocation,
  isNearbyRecommendationSeed,
  canUseMaxDistancePreference,
  shouldWaitForLocationBeforeRecommendation,
  shouldRetryGeolocationRequest,
  buildGeolocationErrorMessage,
  buildRecommendationRequestBody,
  isMobileDeviceEnvironment,
  buildRecommendationAssistantText,
  getRecommendationFeedbackState,
  getRecommendationOpenStatusLabel,
  buildRecommendationDecisionBrief,
  buildAppHistoryState,
  isAppHistoryState,
  getAppHistorySnapshot,
  resolveMediaUrl,
  readStoredDarkMode,
  persistDarkMode,
  readStoredLargeText,
  persistLargeText,
  buildMessage,
  getSpeechRecognitionCtor,
  normalizePreferences,
  splitTokens,
  formatDate,
  formatRelativeDate,
  getVisitBucket,
  enrichItem,
  buildPreferredExternalMapLinks,
  formatPlaceDetailsPhone,
  formatPlaceDetailsWebsite,
  formatDetailReview,
  NAV_ITEMS,
  NAV_ITEM_ICONS,
};
