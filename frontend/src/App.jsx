import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import GoogleRouteMap from "./GoogleRouteMap";
import MapDirectionsPage from "./MapDirectionsPage";
import { sessionBootstrapQueryOptions } from "./queries/session";

function resolveApiBaseUrl() {
  const envApiBaseUrl = String(import.meta.env.REACT_APP_API_BASE_URL || "").trim().replace(/\/$/, "");

  if (!import.meta.env.PROD) {
    return envApiBaseUrl || "http://localhost:5500";
  }

  if (!envApiBaseUrl) {
    return "";
  }

  try {
    const parsed = new URL(envApiBaseUrl);
    if (["localhost", "127.0.0.1"].includes(parsed.hostname)) {
      return "";
    }
  } catch {}

  return envApiBaseUrl;
}

const API_BASE_URL = resolveApiBaseUrl();

const AUTH_STORAGE_KEY = "tastepick.auth.token";
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

export function shouldUseOriginLocationAsCurrentLocation(currentLocation, payload) {
  if (currentLocation) return false;
  if (payload?.originSource !== "browser_geolocation") return false;

  return (
    Number.isFinite(payload?.originLocation?.lat) &&
    Number.isFinite(payload?.originLocation?.lng)
  );
}

export function isNearbyRecommendationSeed(queryText) {
  return String(queryText || "").trim() === "내 주변 맛집 추천";
}

export function canUseMaxDistancePreference(currentLocation) {
  return Number.isFinite(currentLocation?.lat) && Number.isFinite(currentLocation?.lng);
}

export function shouldWaitForLocationBeforeRecommendation(currentLocation) {
  return !canUseMaxDistancePreference(currentLocation);
}

export function isMobileDeviceEnvironment() {
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

export function buildRecommendationAssistantText({ personalizationApplied, query, resultCount }) {
  if (resultCount > 0) {
    return personalizationApplied
      ? `${personalizationApplied} 조건을 반영해 추천했어요.`
      : `${query} 조건에 맞는 곳을 골랐어요.`;
  }

  return personalizationApplied
    ? `${personalizationApplied} 조건을 반영했지만 맞는 식당을 찾지 못했어요. 조건을 조금 완화해 보세요.`
    : `${query} 조건에 맞는 식당을 찾지 못했어요. 다른 조건으로 다시 시도해 보세요.`;
}

export function getRecommendationFeedbackState({ loading, hasRecommendationResponse, resultCount }) {
  if (resultCount > 0) return "results";
  if (loading) return "loading";
  if (hasRecommendationResponse) return "empty";
  return "idle";
}

export function buildAiQuickAccessItems(history = [], popularTags = []) {
  const recentItems = history
    .slice(0, 3)
    .map((entry, index) => {
      const query = String(entry?.query || "").trim();
      if (!query) return null;

      return {
        id: `recent-${entry?.id || index}`,
        kind: "recent",
        title: query,
        query,
        meta: formatRelativeDate(entry?.createdAt, "recently"),
      };
    })
    .filter(Boolean);

  const tagItems = popularTags
    .map((tag) => {
      const title = String(tag || "").trim();
      if (!title) return null;

      return {
        id: `tag-${title}`,
        kind: "tag",
        title,
        query: title.replace(/^#/, ""),
        meta: "popular tag",
      };
    })
    .filter(Boolean);

  return [...recentItems, ...tagItems];
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
    links: {
      googleMap: "https://www.google.com/maps/search/?api=1&query=%EC%8A%A4%EC%8B%9C%20%EC%9C%A0%EC%9C%A0",
      googleDirections:
        "https://www.google.com/maps/dir/?api=1&destination=%EC%8A%A4%EC%8B%9C%20%EC%9C%A0%EC%9C%A0",
    },
    phoneLabel: "전화하기",
  },
];

const DEMO_MENUS = [
  {
    id: "menu-1",
    name: "슬로우 브레이즈 양갈비",
    price: "$34",
    description: "부드럽게 익힌 메인 디시와 허브 소스의 조합",
    imageUrl:
      "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "menu-2",
    name: "자연산 농어 스테이크",
    price: "$28",
    description: "레몬 버터와 제철 채소를 곁들인 가벼운 생선 요리",
    imageUrl:
      "https://images.unsplash.com/photo-1559847844-5315695dadae?auto=format&fit=crop&w=1200&q=80",
  },
];

const DEMO_REVIEWS = [
  {
    id: "review-1",
    author: "Eleanor Rigby",
    daysAgo: "2일 전 방문",
    rating: 5,
    text: "직원 응대가 차분했고 좌석 간격이 넓어서 부모님과 식사하기 편했습니다. 음식도 과하지 않고 정갈했습니다.",
    tags: ["조용한 분위기", "접근성 편함"],
  },
  {
    id: "review-2",
    author: "Arthur Miller",
    daysAgo: "5일 전 방문",
    rating: 5,
    text: "대화에 집중하기 좋은 공간이었고, 향이 강하지 않아 누구와 가도 무난했습니다.",
    tags: ["프라이빗 좌석", "발렛 가능"],
  },
  {
    id: "review-3",
    author: "김지연",
    daysAgo: "1주 전 방문",
    rating: 4,
    text: "분위기가 차분하고 음식 설명도 친절했습니다. 한식 중심 추천을 원할 때 만족도가 높을 것 같습니다.",
    tags: ["가족 식사", "친절한 서비스"],
  },
];

void DEMO_REVIEWS;

function readStoredToken() {
  try {
    return localStorage.getItem(AUTH_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function persistToken(token) {
  try {
    if (token) localStorage.setItem(AUTH_STORAGE_KEY, token);
    else localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {}
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

async function readJson(response) {
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : {};
  if (!response.ok) {
    const error = new Error(payload.error || "요청을 처리하지 못했습니다.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function request(path, options = {}, authToken = "") {
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  return readJson(response);
}

function enrichItem(raw, index) {
  const fallback = DEMO_ITEMS[index % DEMO_ITEMS.length];
  const hasRawItem = Boolean(raw && Object.keys(raw).length);
  return {
    ...fallback,
    ...raw,
    id: raw?.id || `${fallback.id}-${index}`,
    imageUrl: raw?.imageUrl || fallback.imageUrl,
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
    links: raw?.links && typeof raw.links === "object" ? raw.links : fallback.links,
    phoneLabel: raw?.phoneLabel || fallback.phoneLabel,
  };
}

function legacyBuildExternalMapLinks(item) {
  const query = [item?.name, item?.address].filter(Boolean).join(" ").trim();
  const encodedQuery = encodeURIComponent(query || item?.name || "");
  const encodedName = encodeURIComponent(item?.name || "식당");
  const hasCoordinates =
    Number.isFinite(item?.location?.lat) && Number.isFinite(item?.location?.lng);

  return {
    naver: encodedQuery ? `https://map.naver.com/p/search/${encodedQuery}` : "",
    kakao: hasCoordinates
      ? `https://map.kakao.com/link/map/${encodedName},${item.location.lat},${item.location.lng}`
      : encodedQuery
        ? `https://map.kakao.com/link/search/${encodedQuery}`
        : "",
    google:
      item?.links?.googleMap ||
      (encodedQuery ? `https://www.google.com/maps/search/?api=1&query=${encodedQuery}` : ""),
  };
}

void legacyBuildExternalMapLinks;

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

function uniqueCompact(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function buildDetailConvenienceTags(placeDetails) {
  return uniqueCompact([...(placeDetails?.services || []), ...(placeDetails?.amenities || [])]).slice(0, 10);
}

function inferDetailMoodTags(placeDetails, item) {
  const sourceText = [
    placeDetails?.summary,
    item?.reason,
    ...(item?.keywords || []),
    ...(placeDetails?.reviews || []).map((review) => review.text),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const tags = [];
  if (/조용|quiet|차분|잔잔/.test(sourceText)) tags.push("조용한");
  if (/아늑|cozy|포근|편안/.test(sourceText)) tags.push("아늑한");
  if (/활기|lively|라이브|music|스포츠/.test(sourceText)) tags.push("활기찬");
  if (/고급|premium|elegant|fine|격식/.test(sourceText)) tags.push("격식 있는");
  if (/야외|테라스|outdoor|뷰|개방/.test(sourceText)) tags.push("개방감 있는");
  if (!tags.length && placeDetails?.services?.includes("와인")) tags.push("격식 있는");
  if (!tags.length && placeDetails?.services?.includes("맥주")) tags.push("캐주얼한");
  if (!tags.length && item?.keywords?.length) tags.push(...item.keywords.slice(0, 2));
  return uniqueCompact(tags).slice(0, 4);
}

function inferDetailAudienceTags(placeDetails, item) {
  const sourceText = [
    placeDetails?.summary,
    item?.reason,
    ...(item?.keywords || []),
    ...(placeDetails?.reviews || []).map((review) => review.text),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const tags = [];
  if (/가족|아이|children|kid|유아/.test(sourceText)) tags.push("가족 방문");
  if (/데이트|date|romantic|커플/.test(sourceText)) tags.push("데이트");
  if (/모임|friends|group|회식|단체/.test(sourceText)) tags.push("모임");
  if (/혼밥|solo|alone|single/.test(sourceText)) tags.push("혼밥");
  if (/관광|tourist|여행/.test(sourceText)) tags.push("관광객");
  if (!tags.length && placeDetails?.services?.includes("예약 가능")) tags.push("모임");
  if (!tags.length && item?.keywords?.some((tag) => /조용|차분/.test(tag))) tags.push("대화 중심 방문");
  return uniqueCompact(tags).slice(0, 4);
}

function TopNav({ activeView, onNavigate, isMobileDevice }) {
  const activeNavItem = NAV_ITEMS.find((item) => item.id === activeView) || NAV_ITEMS[0];
  const headerClassName = isMobileDevice
    ? "top-nav-shell fixed top-0 z-50 flex h-16 w-full items-center justify-between bg-surface px-4 shadow-sm"
    : "top-nav-shell fixed top-0 z-50 flex h-20 w-full items-center justify-between bg-surface px-6 shadow-sm md:px-8";
  const brandClassName = isMobileDevice
    ? "font-headline text-xl font-black tracking-tight text-[#944a00]"
    : "font-headline text-2xl font-black tracking-tight text-[#944a00]";

  return (
    <>
      <header className={headerClassName}>
        <div className="flex items-center gap-3">
          <button
            className={brandClassName}
            type="button"
            onClick={() => onNavigate("home")}
          >
            TastePick
          </button>
          {isMobileDevice ? (
            <span className="rounded-full bg-surface-container-low px-3 py-1 text-xs font-black text-on-surface-variant">
              {activeNavItem.label}
            </span>
          ) : null}
        </div>

        <nav className={isMobileDevice ? "hidden" : "flex items-center gap-8"}>
          {NAV_ITEMS.map((item) => {
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                className={`font-headline text-lg ${
                  active
                    ? "border-b-4 border-[#944a00] pb-2 font-extrabold text-[#944a00]"
                    : "font-semibold text-[#1b1c1c] transition-colors duration-300 hover:text-[#944a00]"
                }`}
                type="button"
                onClick={() => onNavigate(item.id)}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className={isMobileDevice ? "flex items-center gap-1" : "flex items-center gap-2"}>
          <button
            aria-label="notifications"
            className={`top-nav-icon rounded-full p-2 text-primary transition-colors duration-300 hover:bg-surface-container-low ${
              isMobileDevice ? "hidden" : "inline-flex"
            }`}
            type="button"
          >
            <span className="material-symbols-outlined">notifications</span>
          </button>
          <button
            aria-label="profile"
            className="top-nav-icon rounded-full p-2 text-primary transition-colors duration-300 hover:bg-surface-container-low"
            type="button"
            onClick={() => onNavigate("mypage")}
          >
            <span className="material-symbols-outlined filled-icon">account_circle</span>
          </button>
        </div>
      </header>

      {isMobileDevice ? (
        <nav className="mobile-bottom-nav">
          {NAV_ITEMS.map((item) => {
            const active = activeView === item.id;

            return (
              <button
                key={`mobile-nav-${item.id}`}
                className={`mobile-bottom-nav__button ${active ? "mobile-bottom-nav__button--active" : ""}`}
                type="button"
                onClick={() => onNavigate(item.id)}
              >
                <span className="material-symbols-outlined filled-icon mobile-bottom-nav__icon">
                  {NAV_ITEM_ICONS[item.id]}
                </span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      ) : null}
    </>
  );
}

function Footer({ isMobileDevice }) {
  return (
    <footer
      className={`footer-shell border-t border-outline-variant/20 bg-surface px-6 text-sm text-on-surface-variant md:px-8 ${
        isMobileDevice ? "pb-28 pt-8 md:py-8" : "py-8"
      }`}
    >
      <div className="mx-auto flex max-w-screen-2xl flex-col items-center justify-between gap-4 md:flex-row">
        <div className="text-2xl font-black text-[#944a00]">TastePick</div>
        <div className="flex flex-wrap justify-center gap-6 font-medium">
          <span>접근성 지원</span>
          <span>개인정보 처리방침</span>
          <span>이용약관</span>
          <span>고객센터</span>
        </div>
        <div>© 2024 TastePick. 모든 권리 보유.</div>
      </div>
    </footer>
  );
}

function ResultCard({ item, saved, onToggleFavorite, onOpen, onOpenMap, badgeLabel }) {
  function openDetail() {
    onOpen(item);
  }

  function handleCardKeyDown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openDetail();
  }

  return (
    <article
      aria-label={`${item.name} 상세정보 보기`}
      className="cursor-pointer overflow-hidden rounded-[2rem] bg-surface-container-lowest transition-all duration-300 hover:shadow-xl"
      role="button"
      tabIndex={0}
      onClick={openDetail}
      onKeyDown={handleCardKeyDown}
    >
      <div className="relative h-64 overflow-hidden">
        <img
          alt={item.name}
          className="h-full w-full object-cover transition-transform duration-700 hover:scale-105"
          src={item.imageUrl}
        />
        <button
          aria-label={saved ? "저장 제거" : "저장"}
          className="absolute left-4 top-4 rounded-full bg-white/90 p-2 shadow-sm backdrop-blur-md"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite(item);
          }}
        >
          <span className={`material-symbols-outlined ${saved ? "filled-icon text-red-500" : "text-[#944a00]"}`}>
            favorite
          </span>
        </button>
      </div>
      <div className="p-8">
        <div className="mb-4 flex flex-wrap gap-2">
          {(badgeLabel ? [badgeLabel] : item.featureTags).map((tag) => (
            <span
              key={tag}
              className="rounded-lg bg-secondary-container px-3 py-1 text-xs font-black uppercase tracking-wider text-on-secondary-container"
            >
              {tag}
            </span>
          ))}
        </div>
        <h3 className="mb-2 font-headline text-2xl font-black text-on-surface">{item.name}</h3>
        <p className="min-h-[52px] font-medium leading-relaxed text-on-surface-variant">{item.reason}</p>
        {item.address ? (
          <p className="mt-3 text-sm font-semibold leading-relaxed text-on-surface">
            {item.address}
          </p>
        ) : null}
        <div className="mt-6 flex items-center justify-between border-t border-outline-variant/20 pt-4">
          <div className="flex items-center gap-2 text-sm font-bold text-on-surface-variant">
            <span className="material-symbols-outlined text-sm">location_on</span>
            <span>{item.locationText}</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              className="font-black text-primary"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenMap(item);
              }}
            >
              지도
            </button>
            <button
              className="flex items-center gap-1 font-black text-primary"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openDetail();
              }}
            >
              상세정보 <span className="material-symbols-outlined text-sm">arrow_forward</span>
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function SavedCard({ item, onOpenMap, onRemove }) {
  return (
    <article className="overflow-hidden rounded-[2rem] bg-surface-container-lowest shadow-sm">
      <div className="relative h-60 overflow-hidden">
        <img alt={item.name} className="h-full w-full object-cover" src={item.imageUrl} />
        <button
          aria-label="저장한 맛집 삭제"
          className="absolute right-4 top-4 rounded-full bg-white p-2 shadow"
          type="button"
          onClick={() => onRemove(item)}
        >
          <span className="material-symbols-outlined filled-icon text-red-500">favorite</span>
        </button>
      </div>
      <div className="p-6">
        <div className="mb-4 flex gap-2">
          {item.keywords.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="rounded-lg bg-surface-container px-3 py-1 text-xs font-black text-on-surface-variant"
            >
              {tag}
            </span>
          ))}
        </div>
        <h3 className="mb-2 font-headline text-2xl font-black">{item.name}</h3>
        <p className="text-base font-medium text-on-surface-variant">{item.reason}</p>
        <div className="mt-6 grid grid-cols-3 gap-4">
          <button
            className="rounded-[1.25rem] bg-primary px-4 py-5 font-extrabold text-white"
            type="button"
            onClick={() => onOpenMap(item)}
          >
            길찾기
          </button>
          <a
            className="rounded-[1.25rem] bg-secondary-container px-4 py-5 text-center font-extrabold text-on-secondary-container"
            href={item.links.googleMap}
            rel="noreferrer"
            target="_blank"
          >
            전화하기
          </a>
          <button
            className="rounded-[1.25rem] bg-error-container px-4 py-5 text-center font-extrabold text-on-error-container"
            type="button"
            onClick={() => onRemove(item)}
          >
            삭제
          </button>
        </div>
      </div>
    </article>
  );
}

function RecommendationLoadingGrid({ columns = 3 }) {
  const cardCount = columns === 2 ? 2 : 3;
  const gridClassName = columns === 2 ? "md:grid-cols-2" : "md:grid-cols-3";

  return (
    <div aria-hidden="true" className={`grid grid-cols-1 gap-8 ${gridClassName}`}>
      {Array.from({ length: cardCount }).map((_, index) => (
        <div
          key={`recommendation-loading-${index}`}
          className="overflow-hidden rounded-[2rem] border border-outline-variant/20 bg-surface-container-lowest p-6"
        >
          <div className="animate-pulse space-y-5">
            <div className="h-48 rounded-[1.5rem] bg-surface-container" />
            <div className="space-y-3">
              <div className="h-5 w-2/3 rounded-full bg-surface-container" />
              <div className="h-4 w-full rounded-full bg-surface-container" />
              <div className="h-4 w-5/6 rounded-full bg-surface-container" />
            </div>
            <div className="flex gap-3">
              <div className="h-9 w-24 rounded-full bg-surface-container" />
              <div className="h-9 w-24 rounded-full bg-surface-container" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function RecommendationEmptyState({ title, description }) {
  return (
    <div className="rounded-[2rem] bg-surface-container-low p-8 text-center">
      <p className="text-2xl font-black text-on-surface">{title}</p>
      <p className="mt-3 text-lg font-medium text-on-surface-variant">{description}</p>
    </div>
  );
}

function RecommendationMapStatusCard({ loading }) {
  return (
    <div className="absolute right-8 top-8 z-20 w-[360px] max-w-[calc(100vw-4rem)] rounded-[1.5rem] bg-white p-6 shadow-lg">
      {loading ? (
        <div aria-hidden="true" className="animate-pulse space-y-4">
          <div className="h-4 w-24 rounded-full bg-surface-container" />
          <div className="h-8 w-48 rounded-full bg-surface-container" />
          <div className="h-4 w-full rounded-full bg-surface-container" />
          <div className="h-4 w-5/6 rounded-full bg-surface-container" />
        </div>
      ) : (
        <>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-on-surface-variant">
            주변 맛집 추천
          </p>
          <p className="mt-3 text-2xl font-black text-on-surface">조건에 맞는 추천 결과가 없습니다.</p>
          <p className="mt-4 text-base font-medium leading-relaxed text-on-surface-variant">
            거리나 취향 조건을 조금 완화한 뒤 다시 시도해 보세요.
          </p>
        </>
      )}
    </div>
  );
}

function AuthScreen({
  mode,
  booting,
  authLoading,
  authForm,
  agreements,
  onChangeForm,
  onToggleAgreement,
  onSubmit,
  onChangeMode,
  message,
}) {
  const isLogin = mode === "login";

  return (
    <div className="app-root flex min-h-screen flex-col">
      <main className="mx-auto flex min-h-screen w-full max-w-screen-2xl flex-1 items-center justify-center px-6 py-10 md:px-12">
        <div className="grid w-full items-stretch gap-8 md:grid-cols-[1.05fr_0.95fr]">
          <section className={`${isLogin ? "order-1" : "order-2 md:order-1"} flex flex-col justify-center`}>
            <div className="mb-6 text-[3.5rem] font-black leading-none tracking-tight text-[#944a00] md:text-[4.75rem]">
              TastePick
            </div>
            <p className="mb-3 text-4xl font-black leading-tight text-on-surface md:text-5xl">
              {isLogin ? (
                <>
                  모두를 위한
                  <br />
                  <span className="text-primary">편안한 식사 서비스</span>
                </>
              ) : (
                <>
                  반가워요!
                  <br />
                  건강한 식사의 시작
                </>
              )}
            </p>
            <p className="mb-8 max-w-xl text-xl font-medium leading-relaxed text-on-surface-variant">
              {isLogin
                ? "현재 위치와 취향을 함께 읽어 누구와 가도 편한 맛집을 찾아드립니다."
                : "TastePick은 모두의 입맛과 건강을 생각하는 따뜻한 AI 맞춤 식사 큐레이션 서비스입니다."}
            </p>
            <div className="overflow-hidden rounded-[2rem] bg-surface-container-low shadow-[0_24px_60px_rgba(148,74,0,0.12)]">
              <img
                alt="TastePick"
                className="h-[420px] w-full object-cover"
                src={
                  isLogin
                    ? "https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=1200&q=80"
                    : "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1200&q=80"
                }
              />
            </div>
          </section>
          <section className={`${isLogin ? "order-2" : "order-1 md:order-2"} glass-panel rounded-[2.25rem] px-8 py-10 soft-shadow md:px-10`}>
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h1 className="font-headline text-4xl font-black text-on-surface">
                  TastePick {isLogin ? "로그인" : "회원가입"}
                </h1>
                <p className="mt-2 text-lg font-medium text-on-surface-variant">
                  {isLogin ? "아이디와 비밀번호를 입력해 주세요." : "정확한 정보를 입력해 주세요."}
                </p>
              </div>
              {isLogin ? null : (
                <button
                  className="flex items-center gap-1 font-semibold text-on-surface-variant"
                  type="button"
                  onClick={() => onChangeMode("login")}
                >
                  <span className="material-symbols-outlined text-base">arrow_back</span>
                  뒤로 가기
                </button>
              )}
            </div>

            {message ? (
              <div
                className={`mb-6 rounded-[1.25rem] px-4 py-3 text-sm font-semibold ${
                  message.type === "error"
                    ? "bg-error-container text-on-error-container"
                    : "bg-secondary-container text-on-secondary-container"
                }`}
              >
                {message.text}
              </div>
            ) : null}

            <form className="space-y-5" onSubmit={onSubmit}>
              {isLogin ? null : (
                <label className="block">
                  <span className="mb-2 block text-lg font-bold text-on-surface">성함</span>
                  <input
                    className="w-full rounded-[1rem] border-none bg-surface-container-high px-5 py-4 text-lg font-medium text-on-surface focus:ring-2 focus:ring-primary/20"
                    placeholder="성함을 입력해 주세요"
                    value={authForm.name}
                    onChange={(event) => onChangeForm("name", event.target.value)}
                  />
                </label>
              )}
              <label className="block">
                <span className="mb-2 block text-lg font-bold text-on-surface">
                  {isLogin ? "아이디 또는 이메일" : "이메일 주소"}
                </span>
                <input
                  className="w-full rounded-[1rem] border-none bg-surface-container-high px-5 py-4 text-lg font-medium text-on-surface focus:ring-2 focus:ring-primary/20"
                  placeholder={isLogin ? "아이디를 입력해 주세요" : "email@example.com"}
                  type="email"
                  value={authForm.email}
                  onChange={(event) => onChangeForm("email", event.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-lg font-bold text-on-surface">비밀번호</span>
                <input
                  className="w-full rounded-[1rem] border-none bg-surface-container-high px-5 py-4 text-lg font-medium text-on-surface focus:ring-2 focus:ring-primary/20"
                  placeholder={isLogin ? "비밀번호를 입력해 주세요" : "비밀번호를 설정해 주세요"}
                  type="password"
                  value={authForm.password}
                  onChange={(event) => onChangeForm("password", event.target.value)}
                />
              </label>

              {isLogin ? (
                <div className="flex items-center justify-between pt-1 text-base font-semibold text-on-surface-variant">
                  <label className="flex items-center gap-2">
                    <input
                      checked={agreements.remember}
                      type="checkbox"
                      onChange={() => onToggleAgreement("remember")}
                    />
                    아이디 저장
                  </label>
                  <button className="text-primary" type="button">
                    비밀번호 찾기
                  </button>
                </div>
              ) : (
                <div className="space-y-3 pt-2 text-base font-semibold text-on-surface-variant">
                  <label className="flex items-center gap-3">
                    <input
                      checked={agreements.terms}
                      type="checkbox"
                      onChange={() => onToggleAgreement("terms")}
                    />
                    이용약관에 동의합니다 (필수)
                  </label>
                  <label className="flex items-center gap-3">
                    <input
                      checked={agreements.privacy}
                      type="checkbox"
                      onChange={() => onToggleAgreement("privacy")}
                    />
                    개인정보 처리방침에 동의합니다 (필수)
                  </label>
                </div>
              )}

              <button
                className="w-full rounded-[1.25rem] bg-gradient-to-r from-primary to-primary-container px-5 py-4 text-center text-2xl font-black text-white shadow-[0_18px_32px_rgba(148,74,0,0.18)]"
                disabled={authLoading || booting}
                type="submit"
              >
                {booting ? "불러오는 중..." : authLoading ? "처리 중..." : isLogin ? "로그인하기" : "계정 만들기"}
              </button>
            </form>

            {isLogin ? (
              <>
                <div className="my-7 text-center text-base font-semibold text-on-surface-variant">
                  또는 간편하게 로그인
                </div>
                <div className="space-y-4">
                  {[
                    ["카카오 로그인", "bg-[#fee500] text-black"],
                    ["구글로 로그인", "bg-white text-on-surface border border-outline-variant/30"],
                    ["네이버 로그인", "bg-[#03c75a] text-white"],
                  ].map(([label, className]) => (
                    <button
                      key={label}
                      className={`w-full rounded-[1.25rem] px-5 py-4 text-lg font-black ${className}`}
                      type="button"
                      onClick={() => onChangeMode("register")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            <div className="mt-8 text-center text-lg font-semibold text-on-surface-variant">
              {isLogin ? "아직 회원이 아니신가요?" : "이미 계정이 있으신가요?"}{" "}
              <button className="font-black text-primary" type="button" onClick={() => onChangeMode(isLogin ? "register" : "login")}>
                {isLogin ? "회원가입 하기" : "로그인하기"}
              </button>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(readStoredToken);
  const [booting, setBooting] = useState(Boolean(readStoredToken()));
  const [mode, setMode] = useState("login");
  const isMobileDevice = useMemo(() => isMobileDeviceEnvironment(), []);
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [agreements, setAgreements] = useState({
    terms: false,
    privacy: false,
    remember: false,
  });
  const [user, setUser] = useState(null);
  const [message, setMessage] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeView, setActiveView] = useState("home");
  const [query, setQuery] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [items, setItems] = useState([]);
  const [hasRecommendationResponse, setHasRecommendationResponse] = useState(false);
  const [favorites, setFavorites] = useState([]);
  const [history, setHistory] = useState([]);
  const [visitHistory, setVisitHistory] = useState([]);
  const [preferenceSheets, setPreferenceSheets] = useState([]);
  const [activeSheetId, setActiveSheetId] = useState("");
  const [sheetName, setSheetName] = useState("기본 설정");
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [detailItem, setDetailItem] = useState(null);
  const [placeDetails, setPlaceDetails] = useState(null);
  const [placeDetailsLoading, setPlaceDetailsLoading] = useState(false);
  const [placeDetailsError, setPlaceDetailsError] = useState("");
  const [mapSelectionSource, setMapSelectionSource] = useState("panel");
  const [routeMode, setRouteMode] = useState("DRIVING");
  const [routeUi, setRouteUi] = useState(DEFAULT_ROUTE_UI);
  const [mapDirectionsOpenSignal, setMapDirectionsOpenSignal] = useState(0);
  const [currentLocation, setCurrentLocation] = useState(null);
  const homeNearbyRequestedRef = useRef(false);
  const mapLocationRequestedRef = useRef(false);
  const mapNearbyRequestedRef = useRef(false);
  const recommendNearbyRequestedRef = useRef(false);
  const locationRequestPromiseRef = useRef(null);
  const runRecommendationRef = useRef(null);
  const latestRecommendationRequestIdRef = useRef(0);
  const placeDetailsCacheRef = useRef({});
  const chatScrollContainerRef = useRef(null);
  const chatScrollAnchorRef = useRef(null);
  const voiceRecognitionRef = useRef(null);
  const voiceStopRequestedRef = useRef(false);
  const voiceErrorRef = useRef("");
  const [locationStatus, setLocationStatus] = useState("현재 위치를 아직 불러오지 않았습니다.");
  const [accessibility, setAccessibility] = useState({
    largeText: readStoredLargeText(),
    highContrast: false,
    audioGuide: false,
    darkMode: readStoredDarkMode(),
  });
  const [chatMessages, setChatMessages] = useState([]);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState("");
  const sessionQuery = useQuery(sessionBootstrapQueryOptions(token));

  useEffect(() => {
    document.body.classList.toggle("theme-dark", accessibility.darkMode);
    persistDarkMode(accessibility.darkMode);

    return () => {
      document.body.classList.remove("theme-dark");
    };
  }, [accessibility.darkMode]);

  useEffect(() => {
    document.body.classList.toggle("theme-large-text", accessibility.largeText);
    persistLargeText(accessibility.largeText);

    return () => {
      document.body.classList.remove("theme-large-text");
    };
  }, [accessibility.largeText]);

  useEffect(() => {
    document.body.classList.toggle("mobile-device", isMobileDevice);

    return () => {
      document.body.classList.remove("mobile-device");
    };
  }, [isMobileDevice]);

  useEffect(() => {
    return () => {
      try {
        voiceRecognitionRef.current?.abort();
      } catch {}
      voiceRecognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (activeView !== "ai") return undefined;
    if (!chatScrollContainerRef.current) return undefined;

    const frameId = window.requestAnimationFrame(() => {
      chatScrollAnchorRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activeView, chatMessages.length, loading]);

  const navView = useMemo(() => {
    if (["detail", "reviews"].includes(activeView)) return "recommend";
    if (["saved", "visits"].includes(activeView)) return "mypage";
    return activeView;
  }, [activeView]);

  const activeSheet = useMemo(
    () => preferenceSheets.find((sheet) => sheet.id === activeSheetId) || null,
    [activeSheetId, preferenceSheets],
  );

  const displayItems = useMemo(
    () => (items.length ? items.map((item, index) => enrichItem(item, index)) : DEMO_ITEMS),
    [items],
  );

  const savedItems = useMemo(
    () =>
      favorites.length
        ? favorites.map((favorite, index) => enrichItem(favorite, index))
        : [],
    [favorites],
  );

  const selectedItem = useMemo(() => {
    if ((activeView === "detail" || activeView === "reviews") && detailItem) {
      return detailItem;
    }
    return displayItems.find((item) => item.id === selectedItemId) || displayItems[0];
  }, [activeView, detailItem, displayItems, selectedItemId]);
  const detailViewItem = detailItem || selectedItem || null;
  const recommendItems = useMemo(
    // TODO: 추천 로직이 고도화되면 추천 화면은 이 seed 결과 대신 전용 랭킹 결과를 사용한다.
    () => (items.length ? displayItems : []),
    [displayItems, items.length],
  );
  const detailMapLinks = useMemo(
    () => buildPreferredExternalMapLinks(detailViewItem),
    [detailViewItem],
  );
  const mapItems = useMemo(() => (items.length ? displayItems : []), [displayItems, items.length]);
  const mapSelectedItem = useMemo(
    () => mapItems.find((item) => item.id === selectedItemId) || mapItems[0] || null,
    [mapItems, selectedItemId],
  );
  const recommendationFeedbackState = getRecommendationFeedbackState({
    loading,
    hasRecommendationResponse,
    resultCount: items.length,
  });
  const maxDistanceEnabled = canUseMaxDistancePreference(currentLocation);
  const activeRouteModeLabel = useMemo(
    () => ROUTE_MODE_OPTIONS.find((option) => option.id === routeMode)?.label || "길찾기",
    [routeMode],
  );
  const routeBaseItem = items.length ? mapSelectedItem || selectedItem : null;
  const routeDistanceLabel =
    routeUi.distanceText ||
    (routeUi.status === "idle" && routeBaseItem ? `${routeBaseItem.distanceKm?.toFixed(1)} km` : "");
  const routeDurationLabel =
    routeUi.durationText ||
    (routeUi.status === "idle"
      ? routeBaseItem?.travelDuration || "경로 계산 대기"
      : routeUi.status === "fallback"
        ? "경로 확인 불가"
        : "경로 계산 대기");
  const routeSummaryLabel =
    routeUi.summary ||
    routeUi.message ||
    (routeUi.status === "idle" ? routeBaseItem?.routeSummary : "") ||
    "선택한 식당 기준으로 경로를 안내합니다.";

  const routeSteps = Array.isArray(routeUi.steps) ? routeUi.steps : [];
  const routePreviewSteps = routeSteps.slice(0, 3);
  const detailDirectionsUrl =
    detailViewItem?.links?.googleDirections ||
    placeDetails?.googleMapsUri ||
    detailMapLinks.google ||
    "";
  const detailPhone = formatPlaceDetailsPhone(placeDetails);
  const detailWebsiteLabel = formatPlaceDetailsWebsite(placeDetails?.websiteUri);
  const detailConvenienceTags = useMemo(
    () => buildDetailConvenienceTags(placeDetails),
    [placeDetails],
  );
  const detailMoodTags = useMemo(
    () => inferDetailMoodTags(placeDetails, detailViewItem),
    [placeDetails, detailViewItem],
  );
  const detailAudienceTags = useMemo(
    () => inferDetailAudienceTags(placeDetails, detailViewItem),
    [placeDetails, detailViewItem],
  );
  const detailReviews = useMemo(
    () =>
      placeDetails?.reviews?.length
        ? placeDetails.reviews.map(formatDetailReview).filter(Boolean)
        : [],
    [placeDetails],
  );
  const shouldUseDemoVisits = false;
  const recentQuestions = history.slice(0, 3);
  const hasAiQuickAccess = recentQuestions.length > 0 || POPULAR_TAGS.length > 0;
  const favoriteNames = new Set(favorites.map((item) => item.name.toLowerCase()));
  const homeVoiceCardBody = voiceListening
    ? voiceDraft || "원하는 메뉴, 분위기, 위치를 말씀해 주세요."
    : "말로 원하는 분위기와 메뉴를 알려주면 바로 추천을 시작합니다.";
  const homeVoiceCardCta = voiceListening ? "듣는 중..." : "음성 검색 시작";
  const chatInputPlaceholder = voiceListening
    ? voiceDraft || "말씀을 듣고 있습니다..."
    : "메시지를 입력하세요...";
  const homeMainClassName = isMobileDevice
    ? "page-fade mx-auto max-w-screen-2xl px-4 pb-32 pt-20 md:px-12 md:pb-28 md:pt-24"
    : "page-fade mx-auto max-w-screen-2xl px-6 pb-28 pt-24 md:px-12";
  const aiMainClassName = isMobileDevice
    ? "page-fade mx-auto mt-20 flex min-h-[calc(100vh-4rem)] max-w-screen-2xl flex-col gap-4 px-4 pb-32"
    : "page-fade mx-auto mt-24 flex h-[calc(100vh-100px)] max-w-screen-2xl gap-8 px-6 pb-10 md:px-8";
  const aiChatSectionClassName = isMobileDevice
    ? "flex min-h-[70vh] flex-1 flex-col overflow-hidden rounded-[1.5rem] border border-outline-variant/10 bg-surface-container-lowest shadow-sm"
    : "flex flex-1 flex-col overflow-hidden rounded-xl border border-outline-variant/10 bg-surface-container-lowest shadow-sm";
  const aiChatScrollClassName = isMobileDevice ? "flex-1 overflow-y-auto p-5" : "flex-1 overflow-y-auto p-8";
  const aiUserMessageWrapperClassName = isMobileDevice
    ? "ml-auto flex max-w-full flex-col items-end gap-2"
    : "ml-auto flex max-w-[85%] flex-col items-end gap-2";
  const aiUserBubbleClassName = isMobileDevice
    ? "rounded-bl-[2rem] rounded-tl-[2rem] rounded-tr-[2rem] bg-primary-container px-5 py-4 text-on-primary-container shadow-sm"
    : "rounded-bl-[2rem] rounded-tl-[2rem] rounded-tr-[2rem] bg-primary-container px-8 py-5 text-on-primary-container shadow-sm";
  const aiUserTextClassName = isMobileDevice ? "text-base font-bold leading-relaxed" : "text-lg font-bold leading-relaxed";
  const aiAssistantWrapperClassName = isMobileDevice ? "flex max-w-full gap-3" : "flex max-w-[90%] gap-4";
  const aiAssistantAvatarClassName = isMobileDevice
    ? "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary shadow-lg shadow-primary/20"
    : "flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary shadow-lg shadow-primary/20";
  const aiAssistantBubbleClassName = isMobileDevice
    ? "chat-bubble-ai rounded-bl-[2rem] rounded-br-[2rem] rounded-tr-[2rem] border border-outline-variant/20 px-5 py-5 shadow-sm"
    : "chat-bubble-ai rounded-bl-[2rem] rounded-br-[2rem] rounded-tr-[2rem] border border-outline-variant/20 px-8 py-6 shadow-sm";
  const aiAssistantTextClassName = isMobileDevice
    ? "mb-4 text-base font-semibold leading-relaxed text-on-surface"
    : "mb-4 text-lg font-semibold leading-relaxed text-on-surface";
  const aiRecommendationGridClassName = isMobileDevice
    ? "mt-6 grid grid-cols-1 gap-5"
    : "mt-6 grid grid-cols-1 gap-6 md:grid-cols-2";
  const aiRecommendationCardClassName = isMobileDevice
    ? "overflow-hidden rounded-[1.35rem] border border-outline-variant/10 bg-white text-left shadow-md transition-shadow"
    : "overflow-hidden rounded-xl border border-outline-variant/10 bg-white text-left shadow-sm transition-shadow hover:shadow-md";
  const aiRecommendationImageClassName = isMobileDevice ? "h-52 w-full overflow-hidden" : "h-40 w-full overflow-hidden";
  const aiRecommendationBodyClassName = isMobileDevice ? "p-6" : "p-5";
  const aiRecommendationHeaderClassName = isMobileDevice
    ? "mb-3 flex flex-col gap-2"
    : "mb-2 flex items-start justify-between";
  const aiRecommendationTitleClassName = isMobileDevice
    ? "font-headline text-2xl font-black text-on-surface"
    : "font-headline text-xl font-black text-on-surface";
  const aiRecommendationMetaClassName = isMobileDevice
    ? "text-sm font-black text-on-surface-variant"
    : "text-xs font-black text-on-surface-variant";
  const aiRecommendationReasonClassName = isMobileDevice
    ? "mb-4 text-base font-medium leading-relaxed text-stone-700"
    : "mb-4 text-sm font-medium leading-relaxed text-stone-700";
  const aiRecommendationTagsClassName = isMobileDevice ? "flex flex-wrap gap-2.5" : "flex gap-2";
  const aiRecommendationTagClassName = isMobileDevice
    ? "rounded bg-surface-container px-3 py-1.5 text-xs font-black uppercase text-stone-700"
    : "rounded bg-surface-container px-2 py-1 text-[10px] font-black uppercase text-stone-700";
  const aiInputContainerClassName = isMobileDevice
    ? "border-t border-outline-variant/10 bg-surface-container-low p-4"
    : "border-t border-outline-variant/10 bg-surface-container-low p-6";
  const aiInputRowClassName = isMobileDevice ? "mx-auto flex max-w-4xl items-center gap-3" : "mx-auto flex max-w-4xl items-center gap-4";
  const aiInputClassName = isMobileDevice
    ? "w-full rounded-xl border-none bg-surface-container-highest px-5 py-4 pr-14 text-base font-semibold placeholder:text-stone-400 focus:ring-2 focus:ring-primary/20"
    : "w-full rounded-xl border-none bg-surface-container-highest px-6 py-5 pr-14 text-lg font-semibold placeholder:text-stone-400 focus:ring-2 focus:ring-primary/20";
  const aiMicButtonClassName = isMobileDevice
    ? "flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-primary/20"
    : "flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-primary/20";
  const recommendMainClassName = isMobileDevice
    ? "page-fade mx-auto max-w-screen-2xl px-4 pb-32 pt-24 md:px-12 md:pb-24 md:pt-28"
    : "page-fade mx-auto max-w-screen-2xl px-6 pb-24 pt-28 md:px-12";
  const detailMainClassName = isMobileDevice
    ? "page-fade mx-auto max-w-screen-2xl px-4 pb-32 pt-20 md:px-12 md:pb-24 md:pt-24"
    : "page-fade mx-auto max-w-screen-2xl px-6 pb-24 pt-24 md:px-12";
  const reviewsMainClassName = isMobileDevice
    ? "page-fade mx-auto max-w-screen-xl px-4 pb-32 pt-20 md:px-12 md:pb-24 md:pt-24"
    : "page-fade mx-auto max-w-screen-xl px-6 pb-24 pt-24 md:px-12";
  const myPageMainClassName = isMobileDevice
    ? "page-fade mx-auto max-w-screen-xl px-4 pb-32 pt-20 md:px-12 md:pb-24 md:pt-24"
    : "page-fade mx-auto max-w-screen-xl px-6 pb-24 pt-24 md:px-12";
  const savedMainClassName = isMobileDevice
    ? "page-fade mx-auto max-w-screen-xl px-4 pb-32 pt-20 md:px-12 md:pb-24 md:pt-24"
    : "page-fade mx-auto max-w-screen-xl px-6 pb-24 pt-24 md:px-12";
  const visitsMainClassName = isMobileDevice
    ? "page-fade mx-auto max-w-4xl px-4 pb-32 pt-20 md:px-12 md:pb-24 md:pt-24"
    : "page-fade mx-auto max-w-4xl px-6 pb-24 pt-24 md:px-12";
  const dietaryTokens = splitTokens(preferences.avoidIngredients);
  const visitEntries = useMemo(() => {
    const source = visitHistory.length
      ? visitHistory.map((entry, index) => ({
          ...enrichItem(entry, index),
          id: entry.id || `visit-${index}`,
          query: entry.query,
          name: entry.name || entry.query,
          createdAt: entry.createdAt,
          bucket: getVisitBucket(entry.createdAt, index),
        }))
      : shouldUseDemoVisits
        ? [
          {
            ...DEMO_ITEMS[0],
            id: "visit-demo-1",
            query: "종로 설렁탕",
            createdAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
            bucket: "오늘",
          },
          {
            ...DEMO_ITEMS[1],
            id: "visit-demo-2",
            query: "산촌 보리밥",
            createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
            bucket: "어제",
          },
          {
            ...DEMO_ITEMS[2],
            id: "visit-demo-3",
            query: "햇살 가득 베이커리",
            createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
            bucket: "지난 주",
          },
          ]
        : [];

    return source.reduce((groups, entry) => {
      const key = entry.bucket;
      groups[key] = groups[key] || [];
      groups[key].push(entry);
      return groups;
    }, {});
  }, [visitHistory, shouldUseDemoVisits]);
  const flatVisitEntries = useMemo(() => Object.values(visitEntries).flat(), [visitEntries]);

  const requestCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationStatus("현재 브라우저에서 위치 정보를 지원하지 않습니다.");
      return Promise.resolve(null);
    }

    if (currentLocation) {
      return Promise.resolve(currentLocation);
    }

    if (locationRequestPromiseRef.current) {
      return locationRequestPromiseRef.current;
    }

    setLocationStatus("현재 위치를 확인하는 중입니다...");
    locationRequestPromiseRef.current = new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const next = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          setCurrentLocation(next);
          setLocationStatus(`위치 확인 완료 · ${next.lat.toFixed(4)}, ${next.lng.toFixed(4)}`);
          locationRequestPromiseRef.current = null;
          resolve(next);
        },
        () => {
          setLocationStatus(
            "위치 권한이 없어 현재 위치를 확인하지 못했습니다. 브라우저 위치 권한을 허용해 주세요.",
          );
          locationRequestPromiseRef.current = null;
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 },
      );
    });

    return locationRequestPromiseRef.current;
  }, [currentLocation]);

  useEffect(() => {
    if (!activeSheet) return;
    setSheetName(activeSheet.name || "기본 설정");
    setPreferences(normalizePreferences(activeSheet.preferences));
  }, [activeSheet]);

  useEffect(() => {
    if (!selectedItem && displayItems[0]) {
      setSelectedItemId(displayItems[0].id);
      setMapSelectionSource("panel");
    }
  }, [displayItems, selectedItem]);

  useEffect(() => {
    if (!message) return undefined;
    const timeoutMs = message.type === "error" ? 5000 : 2800;
    const timeoutId = window.setTimeout(() => {
      setMessage(null);
    }, timeoutMs);

    return () => window.clearTimeout(timeoutId);
  }, [message]);

  useEffect(() => {
    runRecommendationRef.current = runRecommendation;
  });

  useEffect(() => {
    if (booting || activeView !== "home") {
      homeNearbyRequestedRef.current = false;
      return;
    }

    const nextSeedQuery = query || "내 주변 맛집 추천";
    if (!currentLocation && isNearbyRecommendationSeed(nextSeedQuery)) {
      return;
    }

    if (items.length || loading || homeNearbyRequestedRef.current) {
      return;
    }

    // TODO: 추천 랭킹 로직이 준비되면 홈 화면도 이 주변 추천 seed 대신 전용 추천 결과를 사용한다.
    homeNearbyRequestedRef.current = true;
    runRecommendationRef.current?.(nextSeedQuery, "home", { skipChat: true });
  }, [activeView, booting, currentLocation, items.length, loading, query]);

  useEffect(() => {
    if (booting || activeView !== "map" || currentLocation || mapLocationRequestedRef.current) {
      return;
    }

    mapLocationRequestedRef.current = true;
    requestCurrentLocation();
  }, [activeView, booting, currentLocation, requestCurrentLocation]);

  useEffect(() => {
    if (booting || activeView !== "map") {
      mapNearbyRequestedRef.current = false;
      return;
    }

    const nextSeedQuery = query || "내 주변 맛집 추천";
    if (!currentLocation && isNearbyRecommendationSeed(nextSeedQuery)) {
      return;
    }

    if (items.length || loading || mapNearbyRequestedRef.current) {
      return;
    }

    mapNearbyRequestedRef.current = true;
    runRecommendationRef.current?.(nextSeedQuery, "map", { skipChat: true });
  }, [activeView, booting, currentLocation, items.length, loading, query]);

  useEffect(() => {
    if (booting || activeView !== "recommend") {
      recommendNearbyRequestedRef.current = false;
      return;
    }

    const nextSeedQuery = query || "내 주변 맛집 추천";
    if (!currentLocation && isNearbyRecommendationSeed(nextSeedQuery)) {
      return;
    }

    if (items.length || loading || recommendNearbyRequestedRef.current) {
      return;
    }

    // TODO: 추천 랭킹 로직이 준비되면 이 주변 추천 seed 호출 대신 해당 결과를 바로 연결한다.
    recommendNearbyRequestedRef.current = true;
    runRecommendationRef.current?.(nextSeedQuery, "recommend", {
      skipChat: true,
    });
  }, [activeView, booting, currentLocation, items.length, loading, query]);

  useEffect(() => {
    const shouldLoad = ["detail", "reviews"].includes(activeView);
    const placeId = detailViewItem?.placeId;

    if (!shouldLoad) {
      return;
    }

    if (!placeId) {
      setPlaceDetails(null);
      setPlaceDetailsError("");
      setPlaceDetailsLoading(false);
      return;
    }

    const cached = placeDetailsCacheRef.current[placeId];
    if (cached) {
      setPlaceDetails(cached);
      setPlaceDetailsError("");
      setPlaceDetailsLoading(false);
      return;
    }

    let ignore = false;
    setPlaceDetails(null);
    setPlaceDetailsLoading(true);
    setPlaceDetailsError("");

    request(`/place-details/${encodeURIComponent(placeId)}`, { method: "GET" }, token)
      .then((payload) => {
        if (ignore) return;
        placeDetailsCacheRef.current[placeId] = payload.place || null;
        setPlaceDetails(payload.place || null);
      })
      .catch((error) => {
        if (ignore) return;
        setPlaceDetails(null);
        setPlaceDetailsError(error.message || "식당 상세정보를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!ignore) setPlaceDetailsLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [activeView, detailViewItem?.placeId, token]);

  useEffect(() => {
    if (!token) {
      setBooting(false);
      return;
    }

    setBooting(sessionQuery.isPending);
  }, [token, sessionQuery.isPending]);

  useEffect(() => {
    if (!token || !sessionQuery.data) {
      return;
    }

    setUser(sessionQuery.data.profile.user || null);
    setFavorites(sessionQuery.data.favoritesPayload.favorites || []);
    setHistory(sessionQuery.data.historyPayload.history || []);
    setVisitHistory(sessionQuery.data.visitPayload.visits || []);
    applyPreferencePayload(sessionQuery.data.preferencePayload);
  }, [token, sessionQuery.data]);

  useEffect(() => {
    if (!token || !sessionQuery.error) {
      return;
    }

    clearSession();
    setBooting(false);
    if (sessionQuery.error?.status === 401) {
      setMessage(buildMessage("error", "濡쒓렇???몄뀡??留뚮즺?섏뿀?듬땲?? ?ㅼ떆 濡쒓렇?명빐 二쇱꽭??"));
      return;
    }
    setMessage(
      buildMessage(
        "error",
        sessionQuery.error?.status === 401
          ? "濡쒓렇???몄뀡??留뚮즺?섏뿀?듬땲?? ?ㅼ떆 濡쒓렇?명빐 二쇱꽭??"
          : sessionQuery.error.message,
      ),
    );
  }, [token, sessionQuery.error]);

  /* useEffect(() => {
    if (!token) {
      setBooting(false);
      return;
    }
    return;
    let ignore = false;

    const loadSession = async () => {
      try {
        const [profile, preferencePayload, favoritesPayload, historyPayload, visitPayload] =
          await Promise.all([
            request("/auth/me", { method: "GET" }, token),
            request("/user/preferences", { method: "GET" }, token),
            request("/user/favorites", { method: "GET" }, token),
            request("/user/history", { method: "GET" }, token),
            request("/user/visits", { method: "GET" }, token),
          ]);

        if (ignore) return;

        setUser(profile.user || null);
        setFavorites(favoritesPayload.favorites || []);
        setHistory(historyPayload.history || []);
        setVisitHistory(visitPayload.visits || []);
        applyPreferencePayload(preferencePayload);
      } catch (error) {
        if (ignore) return;
        clearSession();
        setMessage(
          buildMessage(
            "error",
            error?.status === 401
              ? "로그인 세션이 만료되었습니다. 다시 로그인해 주세요."
              : error.message,
          ),
        );
      } finally {
        if (!ignore) setBooting(false);
      }
    };

    loadSession();
    return () => {
      ignore = true;
    };
  }, [token]); */

  function clearSession() {
    persistToken("");
    setToken("");
    setUser(null);
    setItems([]);
    setHasRecommendationResponse(false);
    setFavorites([]);
    setHistory([]);
    setVisitHistory([]);
    setPreferenceSheets([]);
    setActiveSheetId("");
    setPreferences(DEFAULT_PREFERENCES);
    setSheetName("기본 설정");
    setSelectedItemId("");
    setDetailItem(null);
    setPlaceDetails(null);
    setPlaceDetailsError("");
    setPlaceDetailsLoading(false);
    setMapSelectionSource("panel");
    setRouteMode("DRIVING");
    setRouteUi(DEFAULT_ROUTE_UI);
    setCurrentLocation(null);
    homeNearbyRequestedRef.current = false;
    mapLocationRequestedRef.current = false;
    mapNearbyRequestedRef.current = false;
    recommendNearbyRequestedRef.current = false;
    placeDetailsCacheRef.current = {};
    setLocationStatus("현재 위치를 아직 불러오지 않았습니다.");
    setActiveView("home");
    setChatInput("");
    setQuery("");
    setChatMessages([]);
  }

  function handleRequestError(error) {
    if (error?.status === 401) {
      clearSession();
      setMessage(buildMessage("error", "로그인 세션이 만료되었습니다. 다시 로그인해 주세요."));
      return;
    }

    setMessage(buildMessage("error", error.message));
  }

  function applyPreferencePayload(payload) {
    const sheets = Array.isArray(payload?.sheets) ? payload.sheets : [];
    const nextActiveSheetId = payload?.activeSheetId || sheets[0]?.id || "";
    setPreferenceSheets(sheets);
    setActiveSheetId(nextActiveSheetId);
    setSheetName(sheets.find((sheet) => sheet.id === nextActiveSheetId)?.name || "기본 설정");
    setPreferences(
      normalizePreferences(
        sheets.find((sheet) => sheet.id === nextActiveSheetId)?.preferences ||
          payload?.preferences,
      ),
    );
  }

  function handleFormChange(key, value) {
    setAuthForm((current) => ({ ...current, [key]: value }));
  }

  function handleToggleAgreement(key) {
    setAgreements((current) => ({ ...current, [key]: !current[key] }));
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setAuthLoading(true);
    setMessage(null);

    try {
      if (mode === "register" && (!agreements.terms || !agreements.privacy)) {
        throw new Error("필수 약관 동의 후 회원가입을 진행해 주세요.");
      }

      const path = mode === "login" ? "/auth/login" : "/auth/register";
      const payload =
        mode === "login"
          ? { email: authForm.email, password: authForm.password }
          : authForm;

      const response = await request(path, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      persistToken(response.token);
      setToken(response.token);
      setUser(response.user || null);
      setActiveView("home");
      setMode("login");
      setAuthForm({ name: "", email: "", password: "" });
      setMessage(buildMessage("ok", mode === "login" ? "로그인되었습니다." : "회원가입이 완료되었습니다."));
    } catch (error) {
      handleRequestError(error);
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await request("/auth/logout", { method: "POST" }, token);
    } catch {}
    clearSession();
    setMessage(buildMessage("neutral", "로그아웃되었습니다."));
  }

  async function handleSavePreferences() {
    if (!activeSheetId) return;
    setSavingPreferences(true);
    setMessage(null);

    try {
      const payload = await request(
        "/user/preferences",
        {
          method: "PUT",
          body: JSON.stringify({
            sheetId: activeSheetId,
            name: sheetName,
            preferences,
          }),
        },
        token,
      );
      applyPreferencePayload(payload);
      setUser(payload.user || user);
      setMessage(buildMessage("ok", "모든 변경사항을 저장했습니다."));
    } catch (error) {
      handleRequestError(error);
    } finally {
      setSavingPreferences(false);
    }
  }

  async function handleCreateSheet() {
    try {
      const payload = await request(
        "/user/preferences/sheets",
        {
          method: "POST",
          body: JSON.stringify({
            name: `설정 ${preferenceSheets.length + 1}`,
            preferences: DEFAULT_PREFERENCES,
          }),
        },
        token,
      );
      applyPreferencePayload(payload);
      setUser(payload.user || user);
      setMessage(buildMessage("ok", "새 개인화 시트를 만들었습니다."));
    } catch (error) {
      handleRequestError(error);
    }
  }

  async function handleSelectSheet(sheetId) {
    try {
      const payload = await request(
        "/user/preferences/active",
        {
          method: "PUT",
          body: JSON.stringify({ sheetId }),
        },
        token,
      );
      applyPreferencePayload(payload);
      setUser(payload.user || user);
    } catch (error) {
      handleRequestError(error);
    }
  }

  async function handleDeleteSheet() {
    if (!activeSheetId) return;
    try {
      const payload = await request(
        `/user/preferences/${activeSheetId}`,
        { method: "DELETE" },
        token,
      );
      applyPreferencePayload(payload);
      setUser(payload.user || user);
      setMessage(buildMessage("neutral", "현재 시트를 삭제했습니다."));
    } catch (error) {
      handleRequestError(error);
    }
  }

  function updatePreferenceField(key, value) {
    setPreferences((current) => ({ ...current, [key]: value }));
  }

  function toggleDietaryChip(value) {
    const next = new Set(splitTokens(preferences.avoidIngredients));
    if (next.has(value)) next.delete(value);
    else next.add(value);
    updatePreferenceField("avoidIngredients", [...next].join(", "));
  }

  function stopVoiceSearch() {
    if (!voiceRecognitionRef.current) {
      return;
    }

    voiceStopRequestedRef.current = true;

    try {
      voiceRecognitionRef.current.stop();
    } catch {
      voiceRecognitionRef.current = null;
      setVoiceListening(false);
      setVoiceDraft("");
    }
  }

  function startVoiceSearch(targetView = "ai") {
    if (loading) {
      return;
    }

    if (voiceListening) {
      stopVoiceSearch();
      return;
    }

    const SpeechRecognition = getSpeechRecognitionCtor();
    if (!SpeechRecognition) {
      if (targetView === "ai") {
        setActiveView("ai");
      }
      setMessage(
        buildMessage(
          "error",
          "이 브라우저에서는 음성 입력을 사용할 수 없습니다. Chrome 또는 Edge에서 다시 시도해 주세요.",
        ),
      );
      return;
    }

    let latestTranscript = "";
    let finalTranscript = "";

    const recognition = new SpeechRecognition();
    voiceRecognitionRef.current = recognition;
    voiceStopRequestedRef.current = false;
    voiceErrorRef.current = "";
    setVoiceDraft("");

    recognition.lang = "ko-KR";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setVoiceListening(true);
      if (targetView === "ai") {
        setActiveView("ai");
        setChatInput("");
      }
      setMessage(buildMessage("neutral", "원하는 메뉴, 분위기, 위치를 말씀해 주세요."));
    };

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || "")
        .join("")
        .trim();

      if (!transcript) {
        return;
      }

      latestTranscript = transcript;
      setVoiceDraft(transcript);

      if (targetView === "ai") {
        setChatInput(transcript);
      }

      const lastResult = event.results[event.results.length - 1];
      if (lastResult?.isFinal) {
        finalTranscript = transcript;
      }
    };

    recognition.onerror = (event) => {
      voiceErrorRef.current = event.error || "error";

      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setMessage(
          buildMessage("error", "마이크 권한이 필요합니다. 브라우저에서 마이크 접근을 허용해 주세요."),
        );
        return;
      }

      if (event.error === "audio-capture") {
        setMessage(buildMessage("error", "마이크를 찾지 못했습니다. 연결 상태를 확인해 주세요."));
      }
    };

    recognition.onend = () => {
      const trimmed = (finalTranscript || latestTranscript).trim();
      const stopRequested = voiceStopRequestedRef.current;
      const errorCode = voiceErrorRef.current;

      voiceRecognitionRef.current = null;
      voiceStopRequestedRef.current = false;
      voiceErrorRef.current = "";
      setVoiceListening(false);
      setVoiceDraft("");

      if (trimmed) {
        setQuery(trimmed);
        if (targetView === "ai") {
          setChatInput(trimmed);
        }
        runRecommendation(trimmed, targetView, targetView === "ai" ? {} : { skipChat: true });
        return;
      }

      if (stopRequested || errorCode === "aborted") {
        setMessage(buildMessage("neutral", "음성 입력을 중지했습니다."));
        return;
      }

      if (errorCode === "no-speech") {
        setMessage(buildMessage("error", "음성을 인식하지 못했습니다. 다시 시도해 주세요."));
        return;
      }

      if (
        errorCode &&
        errorCode !== "not-allowed" &&
        errorCode !== "service-not-allowed" &&
        errorCode !== "audio-capture"
      ) {
        setMessage(buildMessage("error", "음성 입력을 처리하지 못했습니다. 다시 시도해 주세요."));
        return;
      }

      if (!errorCode) {
        setMessage(buildMessage("error", "음성을 인식하지 못했습니다. 다시 시도해 주세요."));
      }
    };

    try {
      recognition.start();
    } catch {
      voiceRecognitionRef.current = null;
      setVoiceListening(false);
      setVoiceDraft("");
      setMessage(buildMessage("error", "음성 입력을 시작하지 못했습니다. 다시 시도해 주세요."));
    }
  }

  function selectMapItem(itemId, source = "panel") {
    if (selectedItemId === itemId && mapSelectionSource === source) {
      return;
    }

    setSelectedItemId(itemId);
    setMapSelectionSource(source);
    setRouteUi((current) => ({
      ...current,
      mode: routeMode,
      status: currentLocation ? "loading" : "idle",
      steps: [],
      message: currentLocation
        ? "경로를 계산하는 중입니다."
        : "현재 위치를 허용하면 웹 안에서 경로를 표시합니다.",
    }));
  }

  async function runRecommendation(nextQuery, targetView = "ai", options = {}) {
    const { skipChat = false } = options;
    if (false && !token) {
      setMode("login");
      setMessage(buildMessage("error", "로그인 후 추천을 받아보세요."));
      return;
    }
    const trimmed = String(nextQuery || chatInput || query).trim();
    if (!trimmed) {
      setMessage(buildMessage("error", "검색어나 질문을 입력해 주세요."));
      return;
    }

    setLoading(true);
    setMessage(null);
    setQuery(trimmed);
    setChatInput("");
    const requestId = latestRecommendationRequestIdRef.current + 1;
    latestRecommendationRequestIdRef.current = requestId;

    const userMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: trimmed,
      createdAt: new Date().toISOString(),
    };

    try {
      let resolvedCurrentLocation = currentLocation;

      if (shouldWaitForLocationBeforeRecommendation(resolvedCurrentLocation)) {
        resolvedCurrentLocation = await requestCurrentLocation();
      }

      if (!resolvedCurrentLocation && isNearbyRecommendationSeed(trimmed)) {
        setMessage(buildMessage("error", "현재 위치 권한을 허용한 뒤 내 주변 맛집 추천을 사용할 수 있어요."));
        return;
      }

      const payload = await request(
        "/recommend",
        {
          method: "POST",
          body: JSON.stringify({
            input: trimmed,
            ...(resolvedCurrentLocation ? { currentLocation: resolvedCurrentLocation } : {}),
          }),
        },
        token,
      );

      if (shouldUseOriginLocationAsCurrentLocation(resolvedCurrentLocation, payload)) {
        setCurrentLocation({
          lat: payload.originLocation.lat,
          lng: payload.originLocation.lng,
        });
      } else if (
        !resolvedCurrentLocation &&
        payload.originSource &&
        payload.originSource !== "browser_geolocation"
      ) {
        setLocationStatus("현재 위치를 정확히 표시하려면 브라우저 위치 권한을 허용해 주세요.");
      }

      const nextItems = Array.isArray(payload.items) ? payload.items : [];
      const enriched = nextItems.map((item, index) => enrichItem(item, index));
      setItems(nextItems);
      setHasRecommendationResponse(true);
      if (enriched[0]) selectMapItem(enriched[0].id, "panel");
      if (latestRecommendationRequestIdRef.current === requestId) {
        setActiveView(targetView);
      }

      if (!skipChat) {
        const assistantMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          text: buildRecommendationAssistantText({
            personalizationApplied: payload.personalizationApplied,
            query: trimmed,
            resultCount: enriched.length,
          }),
          items: enriched.slice(0, 2),
          chips: enriched.length ? FOLLOW_UP_CHIPS : [],
          createdAt: new Date().toISOString(),
        };
        setChatMessages((current) => [...current, userMessage, assistantMessage]);
      }

      if (token) {
        const historyPayload = await request("/user/history", { method: "GET" }, token);
        setHistory(historyPayload.history || []);
      }
    } catch (error) {
      handleRequestError(error);
    } finally {
      setLoading(false);
    }
  }

  async function toggleFavorite(item) {
    if (!token) {
      openLoginScreen("즐겨찾기는 로그인 후 이용할 수 있습니다.");
      return;
    }
    const saved = favorites.find(
      (favorite) => favorite.name.toLowerCase() === item.name.toLowerCase(),
    );

    try {
      const payload = saved
        ? await request(`/user/favorites/${saved.id}`, { method: "DELETE" }, token)
        : await request(
            "/user/favorites",
            {
              method: "POST",
              body: JSON.stringify({
                name: item.name,
                reason: item.reason,
                address: item.address,
                imageUrl: item.imageUrl,
                placeId: item.placeId,
                location: item.location,
                category: item.category,
                rating: item.rating,
                keywords: item.keywords,
                featureTags: item.featureTags,
                distanceKm: item.distanceKm,
                travelDuration: item.travelDuration,
                routeSummary: item.routeSummary,
                source: item.source,
                links: item.links,
              }),
            },
            token,
          );

      setFavorites(payload.favorites || []);
      setUser(payload.user || user);
      setMessage(buildMessage("ok", saved ? "즐겨찾기에서 제거했습니다." : "즐겨찾기에 저장했습니다."));
    } catch (error) {
      handleRequestError(error);
    }
  }

  async function removeFavorite(id) {
    if (!token) {
      openLoginScreen("저장한 맛집은 로그인 후 관리할 수 있습니다.");
      return;
    }
    try {
      const payload = await request(`/user/favorites/${id}`, { method: "DELETE" }, token);
      setFavorites(payload.favorites || []);
      setUser(payload.user || user);
      setMessage(buildMessage("neutral", "저장한 맛집을 삭제했습니다."));
    } catch (error) {
      handleRequestError(error);
    }
  }

  async function removeHistoryEntry(id) {
    if (!token) {
      openLoginScreen("최근 방문 기록은 로그인 후 관리할 수 있습니다.");
      return;
    }
    try {
      const payload = await request(`/user/visits/${id}`, { method: "DELETE" }, token);
      setVisitHistory(payload.visits || []);
      setUser(payload.user || user);
      setMessage(buildMessage("neutral", "최근 방문 기록을 삭제했습니다."));
    } catch (error) {
      handleRequestError(error);
    }
  }

  async function clearHistoryEntries() {
    if (!token) {
      openLoginScreen("최근 방문 기록은 로그인 후 관리할 수 있습니다.");
      return;
    }
    if (!visitHistory.length) return;
    if (!window.confirm("전체 방문 기록을 삭제할까요?")) return;

    try {
      const payload = await request("/user/visits", { method: "DELETE" }, token);
      setVisitHistory(payload.visits || []);
      setUser(payload.user || user);
      setMessage(buildMessage("neutral", "전체 방문 기록을 삭제했습니다."));
    } catch (error) {
      handleRequestError(error);
    }
  }

  async function handleStartDirections(item) {
    if (!token || !item) {
      return;
    }

    try {
      const payload = await request(
        "/user/visits",
        {
          method: "POST",
          body: JSON.stringify({
            query: item.name,
            personalizationApplied: item.reason || "",
            name: item.name,
            reason: item.reason,
            address: item.address,
            imageUrl: item.imageUrl,
            placeId: item.placeId,
            location: item.location,
            category: item.category,
            rating: item.rating,
            keywords: item.keywords,
            featureTags: item.featureTags,
            links: item.links,
            distanceKm: item.distanceKm,
            travelDuration: item.travelDuration,
            routeSummary: item.routeSummary,
            source: "directions_start",
          }),
        },
        token,
      );
      setVisitHistory(payload.visits || []);
      setUser(payload.user || user);
    } catch (error) {
      handleRequestError(error);
    }
  }

  function openLoginScreen(messageText = "로그인 후 이용할 수 있습니다.") {
    setMode("login");
    setActiveView("auth");
    setMessage(buildMessage("error", messageText));
  }

  function handleNavigate(nextView) {
    if (!user && ["mypage", "saved", "visits"].includes(nextView)) {
      openLoginScreen("마이페이지는 로그인 후 이용할 수 있습니다.");
      return;
    }
    setActiveView(nextView);
  }

  function openItem(item, target = "detail") {
    if (target === "detail" || target === "reviews") {
      setDetailItem(item);
      if (item?.placeId && placeDetailsCacheRef.current[item.placeId]) {
        setPlaceDetails(placeDetailsCacheRef.current[item.placeId]);
        setPlaceDetailsError("");
        setPlaceDetailsLoading(false);
      } else {
        setPlaceDetails(null);
        setPlaceDetailsError("");
      }
    }
    selectMapItem(item.id, "panel");
    setActiveView(target);
  }

  function openMapDirections(item) {
    if (!item) return;
    selectMapItem(item.id, "panel");
    setMapDirectionsOpenSignal(Date.now());
    setActiveView("map");
  }

  function openExternal(url) {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  if (!user && activeView === "auth") {
    return (
      <AuthScreen
        agreements={agreements}
        authForm={authForm}
        authLoading={authLoading}
        booting={booting}
        message={message}
        mode={mode}
        onChangeForm={handleFormChange}
        onChangeMode={setMode}
        onSubmit={handleAuthSubmit}
        onToggleAgreement={handleToggleAgreement}
      />
    );
  }

  return (
    <div className="app-root">
      <TopNav activeView={navView} isMobileDevice={isMobileDevice} onNavigate={handleNavigate} />

      {message ? (
        <div className="fixed left-1/2 top-24 z-50 w-[min(92vw,720px)] -translate-x-1/2 rounded-[1.25rem] bg-surface-container-low px-5 py-4 text-base font-semibold text-on-surface shadow-[0_18px_38px_rgba(148,74,0,0.12)]">
          {message.text}
        </div>
      ) : null}

      {activeView === "home" ? (
        <main className={homeMainClassName}>
          <section className="max-w-4xl py-12 md:py-20">
            <h1 className="font-headline text-4xl font-black leading-tight tracking-tight text-on-surface md:text-6xl">
              반가워요!
              <br />
              오늘은 어떤 <span className="text-primary">맛있는 이야기</span>를 나눠볼까요?
            </h1>
            <p className="mt-6 text-xl font-medium leading-relaxed text-on-surface-variant md:text-2xl">
              당신의 취향과 가장 잘 맞는 인공지능이 최적의 미식 경험을 추천해 드립니다.
            </p>
          </section>

          <section className="mb-20 grid grid-cols-1 gap-6 md:grid-cols-2">
            <button
              className="group relative flex min-h-[320px] flex-col justify-between overflow-hidden rounded-[2rem] bg-primary p-10 text-left text-white"
              type="button"
              onClick={() => setActiveView("ai")}
            >
              <div className="absolute right-0 top-0 p-8 opacity-20">
                <span className="material-symbols-outlined text-[120px]">chat_bubble</span>
              </div>
              <div>
                <span className="mb-6 inline-flex rounded-2xl bg-white/20 p-3">
                  <span className="material-symbols-outlined filled-icon text-3xl">smart_toy</span>
                </span>
                <h2 className="mb-2 text-3xl font-extrabold">대화로 찾기</h2>
                <p className="text-lg font-medium">
                  “오늘 점심으로 먹기 좋은 따뜻한 국물 요리 알려줘”
                </p>
              </div>
              <div className="flex items-center text-xl font-extrabold transition-transform group-hover:translate-x-2">
                채팅 시작하기 <span className="material-symbols-outlined ml-2">arrow_forward</span>
              </div>
            </button>

            <button
              className="group relative flex min-h-[320px] flex-col justify-between overflow-hidden rounded-[2rem] bg-surface-container-highest p-10 text-left"
              type="button"
              onClick={() => startVoiceSearch("recommend")}
            >
              <div className="absolute right-0 top-0 p-8 opacity-10">
                <span className="material-symbols-outlined text-[120px] text-primary">
                  {voiceListening ? "graphic_eq" : "mic"}
                </span>
              </div>
              <div>
                <span className="mb-6 inline-flex rounded-2xl bg-primary-container/20 p-3">
                  <span className="material-symbols-outlined filled-icon text-3xl text-primary">
                    {voiceListening ? "graphic_eq" : "mic"}
                  </span>
                </span>
                <h2 className="mb-2 text-3xl font-extrabold text-on-surface">목소리로 찾기</h2>
                <p className="text-lg font-medium text-on-surface-variant">{homeVoiceCardBody}</p>
              </div>
              <div className="flex items-center text-xl font-extrabold text-primary transition-transform group-hover:translate-x-2">
                {homeVoiceCardCta}{" "}
                <span className="material-symbols-outlined ml-2">
                  {voiceListening ? "graphic_eq" : "arrow_forward"}
                </span>
              </div>
            </button>
          </section>

          <section>
            <div className="mb-10 flex items-end justify-between">
              <div>
                <h2 className="font-headline text-3xl font-black text-on-surface md:text-4xl">
                  오늘의 추천 맛집
                </h2>
                <p className="mt-2 text-lg font-medium text-on-surface-variant">
                  현재 위치와 선호도를 분석한 취향 기반 추천입니다.
                </p>
              </div>
              <button
                className="hidden items-center gap-2 text-lg font-extrabold text-primary md:flex"
                type="button"
                onClick={() => setActiveView("recommend")}
              >
                전체 보기 <span className="material-symbols-outlined">chevron_right</span>
              </button>
            </div>

            {recommendItems.length ? (
              <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
                {recommendItems.slice(0, 3).map((item) => (
                  <ResultCard
                    key={item.id}
                    badgeLabel={item.featureTags[0]}
                    item={item}
                    onOpen={openItem}
                    onOpenMap={(target) => openItem(target, "map")}
                    onToggleFavorite={toggleFavorite}
                    saved={favoriteNames.has(item.name.toLowerCase())}
                  />
                ))}
              </div>
            ) : recommendationFeedbackState === "loading" ? (
              <RecommendationLoadingGrid columns={3} />
            ) : recommendationFeedbackState === "empty" ? (
              <RecommendationEmptyState
                description="거리나 취향 조건을 조금 바꿔 다시 추천을 받아보세요."
                title="조건에 맞는 추천 식당이 아직 없습니다."
              />
            ) : null}
          </section>

        </main>
      ) : null}

      {activeView === "ai" ? (
        <main className={aiMainClassName}>
          {isMobileDevice && hasAiQuickAccess ? (
            <section className="rounded-[1.5rem] bg-surface-container-low p-4 shadow-sm">
              {recentQuestions.length ? (
                <div>
                  <h3 className="text-xs font-black uppercase tracking-[0.18em] text-primary">최근 질문</h3>
                  <div className="mobile-ai-quick-access mt-3 flex gap-3 overflow-x-auto pb-1">
                    {recentQuestions.map((entry) => (
                      <button
                        key={`mobile-recent-${entry.id}`}
                        className="min-w-[14rem] rounded-[1.15rem] bg-surface-container-lowest p-4 text-left shadow-sm"
                        type="button"
                        onClick={() => runRecommendation(entry.query, "ai")}
                      >
                        <p className="text-sm font-semibold text-on-surface">{entry.query}</p>
                        <span className="mt-2 block text-xs text-on-surface-variant">
                          {formatRelativeDate(entry.createdAt, "recently")}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className={recentQuestions.length ? "mt-4" : ""}>
                <h3 className="text-xs font-black uppercase tracking-[0.18em] text-primary">인기 태그</h3>
                <div className="mt-3 flex flex-wrap gap-2.5">
                  {POPULAR_TAGS.map((tag) => (
                    <button
                      key={`mobile-tag-${tag}`}
                      className="rounded-full border border-outline-variant/20 bg-surface-container-lowest px-4 py-2 text-sm font-bold text-on-surface-variant"
                      type="button"
                      onClick={() => runRecommendation(tag.replace("#", ""), "ai")}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          ) : null}
          {!isMobileDevice && hasAiQuickAccess ? (
            <aside className="flex h-full min-h-0 w-80 shrink-0 flex-col gap-8">
              <section className="flex min-h-0 flex-1 flex-col rounded-xl bg-surface-container-low p-6">
                <div className="ai-quick-access-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
                  {recentQuestions.length ? (
                    <div className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-4">
                      <h3 className="mb-3 text-sm font-black uppercase tracking-[0.2em] text-primary">최근 질문</h3>
                      <div className="flex flex-col gap-3">
                        {recentQuestions.map((entry) => (
                          <button
                            key={entry.id}
                            className="rounded-lg bg-surface-container-low p-3 text-left transition-colors hover:bg-orange-50"
                            type="button"
                            onClick={() => runRecommendation(entry.query, "ai")}
                          >
                            <p className="text-sm font-semibold text-on-surface">{entry.query}</p>
                            <span className="text-xs text-stone-500">
                              {formatRelativeDate(entry.createdAt, "recently")}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-4">
                    <h3 className="mb-3 text-sm font-black uppercase tracking-[0.2em] text-primary">인기 태그</h3>
                    <div className="flex flex-wrap gap-2">
                      {POPULAR_TAGS.map((tag) => (
                        <button
                          key={tag}
                          className="rounded-full border border-outline-variant/20 bg-surface-container-low px-4 py-2 text-sm font-bold text-on-surface-variant"
                          type="button"
                          onClick={() => runRecommendation(tag.replace("#", ""), "ai")}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                  {false && [].map((item) => (
                    <button
                      key={item.id}
                      className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-4 text-left transition-colors hover:bg-orange-50"
                      type="button"
                      onClick={() => runRecommendation(item.query, "ai")}
                    >
                      <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em] text-primary">
                        {item.kind === "recent" ? "최근 질문" : "인기 태그"}
                      </span>
                      <p className="mt-3 text-sm font-semibold text-on-surface">{item.title}</p>
                      <span className="mt-2 block text-xs text-stone-500">{item.meta}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-4 rounded-xl border border-primary/10 bg-primary/5 p-4">
                  <p className="mb-1 text-xs font-black uppercase tracking-wider text-primary">TastePick Premium</p>
                  <p className="text-sm font-medium text-on-surface-variant">
                    개인 맞춤 AI 분석과 시트별 추천을 한 번에 관리하세요.
                  </p>
                </div>
              </section>
              {false ? (
                <section className="rounded-xl bg-surface-container-low p-6">
                  <h2 className="mb-4 text-lg font-bold text-on-surface-variant">최근 질문</h2>
                  <div className="flex flex-col gap-3">
                    {recentQuestions.map((entry) => (
                      <button
                        key={entry.id}
                        className="rounded-lg bg-surface-container-lowest p-3 text-left transition-colors hover:bg-orange-50"
                        type="button"
                        onClick={() => runRecommendation(entry.query, "ai")}
                      >
                        <p className="text-sm font-semibold text-on-surface">{entry.query}</p>
                        <span className="text-xs text-stone-500">
                          {formatRelativeDate(entry.createdAt, "recently")}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
              <section className="hidden">
                <h2 className="mb-4 text-lg font-bold text-on-surface-variant">인기 태그</h2>
                <div className="flex min-h-0 flex-1 flex-wrap content-start gap-2 overflow-y-auto pr-1">
                  {POPULAR_TAGS.map((tag) => (
                    <button
                      key={tag}
                      className="rounded-full border border-outline-variant/20 bg-surface-container-lowest px-4 py-2 text-sm font-bold text-on-surface-variant"
                      type="button"
                      onClick={() => runRecommendation(tag.replace("#", ""), "ai")}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                <div className="mt-4 shrink-0 rounded-xl border border-primary/10 bg-primary/5 p-4">
                  <p className="mb-1 text-xs font-black uppercase tracking-wider text-primary">TastePick Premium</p>
                  <p className="text-sm font-medium text-on-surface-variant">
                    개인 맞춤 AI 분석과 시트별 추천을 한 번에 관리하세요.
                  </p>
                </div>
              </section>
            </aside>
          ) : null}

          <section className={aiChatSectionClassName}>
            <div className={aiChatScrollClassName} ref={chatScrollContainerRef}>
              <div className="flex flex-col gap-10">
                {chatMessages.map((entry) =>
                  entry.role === "user" ? (
                    <div className={aiUserMessageWrapperClassName} key={entry.id}>
                      <div className={aiUserBubbleClassName}>
                        <p className={aiUserTextClassName}>{entry.text}</p>
                      </div>
                      <span className="mr-2 text-xs font-medium text-stone-400">
                        {formatDate(entry.createdAt)}
                      </span>
                      {false ? (
                        <div>
                          <p className="mb-3 text-sm font-black uppercase tracking-wide text-primary">편의 시설</p>
                          <div className="flex flex-wrap gap-2">
                            {detailConvenienceTags.map((tag) => (
                              <span key={tag} className="rounded-full bg-white px-4 py-2 text-sm font-black text-on-surface">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {false ? (
                        <div>
                          <p className="mb-3 text-sm font-black uppercase tracking-wide text-primary">분위기</p>
                          <div className="flex flex-wrap gap-2">
                            {detailMoodTags.map((tag) => (
                              <span key={tag} className="rounded-full bg-secondary-container px-4 py-2 text-sm font-black text-on-secondary-container">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {false ? (
                        <div>
                          <p className="mb-3 text-sm font-black uppercase tracking-wide text-primary">주요 방문자</p>
                          <div className="flex flex-wrap gap-2">
                            {detailAudienceTags.map((tag) => (
                              <span key={tag} className="rounded-full bg-tertiary-container px-4 py-2 text-sm font-black text-on-tertiary-container">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {false ? (
                        <div>
                          <p className="mb-3 text-sm font-black uppercase tracking-wide text-primary">편의 시설</p>
                          <div className="flex flex-wrap gap-2">
                            {detailConvenienceTags.map((tag) => (
                              <span key={tag} className="rounded-full bg-white px-4 py-2 text-sm font-black text-on-surface">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {false ? (
                        <div>
                          <p className="mb-3 text-sm font-black uppercase tracking-wide text-primary">분위기</p>
                          <div className="flex flex-wrap gap-2">
                            {detailMoodTags.map((tag) => (
                              <span key={tag} className="rounded-full bg-secondary-container px-4 py-2 text-sm font-black text-on-secondary-container">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {false ? (
                        <div>
                          <p className="mb-3 text-sm font-black uppercase tracking-wide text-primary">주요 방문자</p>
                          <div className="flex flex-wrap gap-2">
                            {detailAudienceTags.map((tag) => (
                              <span key={tag} className="rounded-full bg-tertiary-container px-4 py-2 text-sm font-black text-on-tertiary-container">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className={aiAssistantWrapperClassName} key={entry.id}>
                      <div className={aiAssistantAvatarClassName}>
                        <span className="material-symbols-outlined filled-icon text-white">smart_toy</span>
                      </div>
                      <div className="flex flex-col gap-6">
                        <div className={aiAssistantBubbleClassName}>
                          <p className={aiAssistantTextClassName}>{entry.text}</p>
                          {entry.items?.length ? (
                            <div className={aiRecommendationGridClassName}>
                              {entry.items.map((item) => (
                                <button
                                  key={item.id}
                                  className={aiRecommendationCardClassName}
                                  type="button"
                                  onClick={() => openItem(item, "detail")}
                                >
                                  <div className={aiRecommendationImageClassName}>
                                    <img alt={item.name} className="h-full w-full object-cover" src={item.imageUrl} />
                                  </div>
                                  <div className={aiRecommendationBodyClassName}>
                                    <div className={aiRecommendationHeaderClassName}>
                                      <h3 className={aiRecommendationTitleClassName}>{item.name}</h3>
                                      <span className={aiRecommendationMetaClassName}>
                                        {item.address || item.locationText}
                                      </span>
                                    </div>
                                    <p className={aiRecommendationReasonClassName}>{item.reason}</p>
                                    <div className={aiRecommendationTagsClassName}>
                                      {item.keywords.slice(0, 2).map((tag) => (
                                        <span
                                          key={tag}
                                          className={aiRecommendationTagClassName}
                                        >
                                          {tag}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        {entry.chips?.length ? (
                          <div className="flex flex-wrap gap-3">
                            {entry.chips.map((chip) => (
                              <button
                                key={chip}
                                className="flex items-center gap-2 rounded-full bg-secondary-container px-6 py-3 text-sm font-black text-on-secondary-container transition-all hover:bg-primary-container hover:text-on-primary-container"
                                disabled={loading}
                                type="button"
                                onClick={() => runRecommendation(`${query || selectedItem?.name || ""} ${chip}`, "ai")}
                              >
                                <span className="material-symbols-outlined text-lg">
                                  {chip.includes("주차") ? "local_parking" : chip.includes("조용") ? "volume_off" : "near_me"}
                                </span>
                                {chip}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        <span className="ml-2 text-xs font-medium text-stone-400">{formatDate(entry.createdAt)}</span>
                      </div>
                    </div>
                  ),
                )}
                <div ref={chatScrollAnchorRef} />
              </div>
            </div>

            <div className={aiInputContainerClassName}>
              <div className={aiInputRowClassName}>
                <div className="relative flex-1">
                  <input
                    className={aiInputClassName}
                    placeholder={chatInputPlaceholder}
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") runRecommendation(chatInput, "ai");
                    }}
                  />
                  <button
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-primary transition-transform hover:scale-110"
                    disabled={loading}
                    type="button"
                    onClick={() => runRecommendation(chatInput, "ai")}
                  >
                    <span className="material-symbols-outlined filled-icon text-2xl">
                      {loading ? "progress_activity" : "send"}
                    </span>
                  </button>
                </div>
                <button
                  className={aiMicButtonClassName}
                  disabled={loading}
                  type="button"
                  onClick={() => startVoiceSearch("ai")}
                >
                  <span className="material-symbols-outlined filled-icon">
                    {voiceListening ? "graphic_eq" : "mic"}
                  </span>
                </button>
              </div>
            </div>
          </section>
        </main>
      ) : null}

      {activeView === "recommend" ? (
        <main className={recommendMainClassName}>
          <section className="mb-12">
            <h1 className="font-headline text-4xl font-black text-on-surface md:text-6xl">오늘의 추천 맛집</h1>
            <p className="mt-4 text-xl font-medium text-on-surface-variant">
              당신의 취향과 위치를 분석하여 엄선한 오늘의 특별한 식당 리스트입니다.
            </p>
          </section>

          <div className="mb-10 flex flex-wrap gap-3">
            {[
              ["추천 변경", query || "강남 조용한 식당"],
              ["가성비", `${query || "강남 맛집"} 가성비`],
              ["건강한", `${query || "강남 맛집"} 건강식`],
            ].map(([label, prompt]) => (
              <button
                key={label}
                className={`rounded-full px-6 py-3 text-sm font-black ${
                  label === "추천 변경"
                    ? "bg-primary text-white"
                    : "bg-secondary-container text-on-secondary-container"
                }`}
                type="button"
                onClick={() => runRecommendation(prompt, "recommend")}
              >
                {label}
              </button>
            ))}
          </div>
          {recommendItems.length ? (
            <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
              {recommendItems.slice(0, 2).map((item) => (
                <ResultCard
                  key={item.id}
                  item={item}
                  onOpen={openItem}
                  onOpenMap={(target) => openItem(target, "map")}
                  onToggleFavorite={toggleFavorite}
                  saved={favoriteNames.has(item.name.toLowerCase())}
                />
              ))}
            </div>
          ) : recommendationFeedbackState === "loading" ? (
            <RecommendationLoadingGrid columns={2} />
          ) : recommendationFeedbackState === "empty" ? (
            <RecommendationEmptyState
              description="거리나 취향 조건을 조금 바꿔 다시 추천을 받아보세요."
              title="조건에 맞는 추천 식당이 아직 없습니다."
            />
          ) : null}

          <section className="mt-16 rounded-[2rem] bg-surface-container-low p-8">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h3 className="text-3xl font-black text-on-surface">주변 추천 지도</h3>
                <p className="mt-2 text-lg font-medium text-on-surface-variant">
                  현재 위치를 중심으로 가까운 추천 식당을 빠르게 확인하세요.
                </p>
              </div>
              <button className="font-extrabold text-primary" type="button" onClick={() => setActiveView("map")}>
                현재 지도 보기
              </button>
            </div>
            <div className="route-canvas relative h-72 overflow-hidden rounded-[1.75rem]" style={{ minHeight: "18rem" }}>
              {mapSelectedItem ? (
                <>
                  <GoogleRouteMap
                    currentLocation={currentLocation}
                    item={mapSelectedItem}
                    items={mapItems}
                    routeMode={routeMode}
                    selectionSource={mapSelectionSource}
                    onSelectItem={(itemId) => selectMapItem(itemId, "map")}
                  />
                  <div className="route-canvas__veil" />
                  <div className="pointer-events-none absolute inset-x-5 bottom-5 z-10 flex items-end justify-between gap-4">
                    <div className="rounded-[1.25rem] bg-white/88 px-4 py-3 shadow-lg backdrop-blur-md">
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-primary">Map Preview</p>
                      <p className="mt-1 text-sm font-semibold text-on-surface">
                        {mapSelectedItem.name} 위치와 주변 추천 식당을 실제 지도에서 보여주고 있습니다.
                      </p>
                    </div>
                    <button
                      className="pointer-events-auto rounded-full bg-primary px-5 py-3 text-sm font-black text-white shadow-lg shadow-primary/25"
                      type="button"
                      onClick={() => setActiveView("map")}
                    >
                      전체 지도 열기
                    </button>
                  </div>
                </>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-surface-container-lowest">
                  <p className="text-sm font-semibold text-on-surface-variant">
                    추천 결과가 생기면 이곳에 실제 지도가 표시됩니다.
                  </p>
                </div>
              )}
            </div>
          </section>
        </main>
      ) : null}

      {activeView === "detail" && detailViewItem ? (
        <main className={detailMainClassName}>
          <button
            className="mb-6 flex items-center gap-2 text-lg font-bold text-on-surface-variant"
            type="button"
            onClick={() => setActiveView("recommend")}
          >
            <span className="material-symbols-outlined">arrow_back</span>
            추천 목록으로 돌아가기
          </button>

          <section className="overflow-hidden rounded-[2rem] bg-surface-container-lowest shadow-sm">
            <div className="relative h-[420px] overflow-hidden">
              <img alt={detailViewItem.name} className="h-full w-full object-cover" src={detailViewItem.imageUrl} />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 flex flex-wrap items-end justify-between gap-6 p-8 text-white">
                <div>
                  <div className="mb-4 flex gap-2">
                    <span className="rounded-lg bg-primary-container/80 px-3 py-1 text-xs font-black uppercase text-on-primary-container">
                      AI 추천
                    </span>
                    <span className="rounded-lg bg-white/15 px-3 py-1 text-xs font-black uppercase">
                      {detailViewItem.category}
                    </span>
                  </div>
                  <h1 className="font-headline text-4xl font-black md:text-6xl">{detailViewItem.name}</h1>
                  <p className="mt-3 text-xl font-medium text-white/90">
                    {selectedItem.locationText} · 별점 {selectedItem.rating.toFixed(1)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    className="rounded-full bg-primary px-6 py-3 font-black text-white"
                    type="button"
                    onClick={() => openMapDirections(detailViewItem)}
                  >
                    길찾기
                  </button>
                  <button
                    className="rounded-full bg-white/90 px-6 py-3 font-black text-primary"
                    type="button"
                    onClick={() => setActiveView("reviews")}
                  >
                    리뷰 보기
                  </button>
                </div>
              </div>
            </div>

            <div className="grid gap-8 px-6 py-8 md:grid-cols-[1.3fr_0.7fr] md:px-8">
              <div>
                <h2 className="mb-6 font-headline text-3xl font-black">TastePick AI 추천 이유</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-[1.5rem] border border-outline-variant/30 bg-surface-container-low p-6">
                    <p className="mb-3 text-sm font-black uppercase tracking-wide text-tertiary">추천 이유</p>
                    <p className="text-lg font-semibold leading-relaxed text-on-surface">{selectedItem.reason}</p>
                  </div>
                  <div className="rounded-[1.5rem] border border-outline-variant/30 bg-surface-container-low p-6">
                    <p className="mb-3 text-sm font-black uppercase tracking-wide text-primary">이동 정보</p>
                    <p className="text-lg font-semibold leading-relaxed text-on-surface">
                      {selectedItem.distanceKm?.toFixed(1)}km · {selectedItem.travelDuration}
                    </p>
                    <p className="mt-2 text-base font-medium text-on-surface-variant">
                      {selectedItem.routeSummary}
                    </p>
                  </div>
                </div>

                <section className="mt-12 rounded-[1.75rem] bg-surface-container-low p-6">
                  <div className="mb-5 flex items-center justify-between gap-4">
                    <div>
                      <h3 className="font-headline text-3xl font-black">Google 장소 정보</h3>
                      <p className="mt-2 text-base font-medium text-on-surface-variant">
                        실제 영업 정보, 연락처, 서비스 옵션, 방문자 리뷰를 표시합니다.
                      </p>
                    </div>
                    {placeDetails?.priceLevel ? (
                      <div className="rounded-[1rem] bg-primary-container px-4 py-3 text-right text-on-primary-container">
                        <p className="text-xs font-black uppercase tracking-[0.18em]">가격대</p>
                        <p className="mt-1 text-base font-black">{placeDetails.priceLevel}</p>
                      </div>
                    ) : null}
                  </div>

                  {placeDetailsLoading ? (
                    <div className="rounded-[1.25rem] bg-white px-5 py-4 text-base font-semibold text-on-surface-variant">
                      구글 장소 정보를 불러오는 중입니다.
                    </div>
                  ) : placeDetailsError ? (
                    <div className="rounded-[1.25rem] bg-error-container px-5 py-4 text-base font-semibold text-on-error-container">
                      {placeDetailsError}
                    </div>
                  ) : placeDetails ? (
                    <div className="space-y-5">
                      {placeDetails.summary ? (
                        <div className="rounded-[1.25rem] bg-white p-5">
                          <p className="mb-2 text-sm font-black uppercase tracking-wide text-primary">요약</p>
                          <p className="text-lg font-semibold leading-relaxed text-on-surface">{placeDetails.summary}</p>
                        </div>
                      ) : null}

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-[1.25rem] bg-white p-5">
                          <p className="mb-2 text-sm font-black uppercase tracking-wide text-primary">영업 상태</p>
                          <p className="text-lg font-semibold text-on-surface">
                            {placeDetails.openNow == null
                              ? "영업 정보 없음"
                              : placeDetails.openNow
                                ? "현재 영업 중"
                                : "현재 영업 종료"}
                          </p>
                          {placeDetails.currentHours?.length ? (
                            <ul className="mt-3 space-y-2 text-sm font-medium text-on-surface-variant">
                              {placeDetails.currentHours.map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                            </ul>
                          ) : null}
                        </div>

                        {false ? (
                        <div className="rounded-[1.25rem] bg-white p-5">
                          <p className="mb-2 text-sm font-black uppercase tracking-wide text-primary">연락 및 링크</p>
                          <div className="space-y-3 text-base font-semibold text-on-surface">
                            {detailPhone ? <p>{detailPhone}</p> : <p>전화번호 정보 없음</p>}
                            {placeDetails.websiteUri ? (
                              <a
                                className="block text-primary underline decoration-primary/30 underline-offset-4"
                                href={placeDetails.websiteUri}
                                rel="noreferrer"
                                target="_blank"
                              >
                                {detailWebsiteLabel || placeDetails.websiteUri}
                              </a>
                            ) : (
                              <p className="text-on-surface-variant">웹사이트 정보 없음</p>
                            )}
                          </div>
                        </div>
                        ) : null}
                      </div>

                      {placeDetails.services?.length ? (
                        <div>
                          <p className="mb-3 text-sm font-black uppercase tracking-wide text-primary">서비스</p>
                          <div className="flex flex-wrap gap-2">
                            {placeDetails.services.map((tag) => (
                              <span key={tag} className="rounded-full bg-white px-4 py-2 text-sm font-black text-on-surface">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {placeDetails.amenities?.length ? (
                        <div>
                          <p className="mb-3 text-sm font-black uppercase tracking-wide text-primary">편의 정보</p>
                          <div className="flex flex-wrap gap-2">
                            {placeDetails.amenities.map((tag) => (
                              <span key={tag} className="rounded-full bg-secondary-container px-4 py-2 text-sm font-black text-on-secondary-container">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="rounded-[1.25rem] bg-white px-5 py-4 text-base font-semibold text-on-surface-variant">
                      이 식당에 대한 추가 장소 정보가 아직 없습니다.
                    </div>
                  )}
                </section>

                <section className="mt-12">
                  <div className="mb-6 flex items-center justify-between">
                    <h3 className="font-headline text-3xl font-black">시그니처 메뉴</h3>
                    <button className="font-bold text-primary" type="button">
                      전체 메뉴 보기
                    </button>
                  </div>
                  <div className="grid gap-6 md:grid-cols-2">
                    {DEMO_MENUS.map((menu) => (
                      <article key={menu.id} className="overflow-hidden rounded-[1.75rem] bg-surface-container-low">
                        <img alt={menu.name} className="h-52 w-full object-cover" src={menu.imageUrl} />
                        <div className="p-5">
                          <div className="mb-2 flex items-center justify-between">
                            <h4 className="text-xl font-black">{menu.name}</h4>
                            <span className="font-black text-primary">{menu.price}</span>
                          </div>
                          <p className="text-base font-medium text-on-surface-variant">{menu.description}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
                <section className="mt-12 rounded-[1.75rem] bg-surface-container-low p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="font-headline text-3xl font-black">방문객 리뷰</h3>
                    <button className="font-bold text-primary" type="button" onClick={() => setActiveView("reviews")}>
                      전체 리뷰 보기
                    </button>
                  </div>
                  <div className="space-y-4">
                    {detailReviews.slice(0, 2).map((review) => (
                      <article key={review.id} className="rounded-[1.25rem] bg-white p-5">
                        <div className="mb-2 flex items-center justify-between">
                          <div>
                            <p className="font-bold">{review.author}</p>
                            <p className="text-sm text-on-surface-variant">{review.daysAgo}</p>
                          </div>
                          <div className="text-primary">
                            {"★".repeat(review.rating)}
                          </div>
                        </div>
                        <p className="font-medium leading-relaxed text-on-surface-variant">{review.text}</p>
                      </article>
                    ))}
                  </div>
                </section>
              </div>

              <aside className="rounded-[1.75rem] bg-surface-container-low p-6">
                <div className="rounded-[1.5rem] bg-white p-5">
                  <img
                    alt={selectedItem.name}
                    className="mb-4 h-48 w-full rounded-[1.25rem] object-cover"
                    src={selectedItem.imageUrl}
                  />
                  <div className="space-y-5">
                    <div>
                      <p className="mb-1 text-sm font-black uppercase text-primary">주소</p>
                      <p className="font-semibold text-on-surface">
                        {placeDetails?.address || selectedItem.address || selectedItem.locationText}
                      </p>
                    </div>
                    {detailPhone ? (
                      <div>
                        <p className="mb-1 text-sm font-black uppercase text-primary">전화</p>
                        <p className="font-semibold text-on-surface">{detailPhone}</p>
                      </div>
                    ) : null}
                    {placeDetails?.websiteUri ? (
                      <div>
                        <p className="mb-1 text-sm font-black uppercase text-primary">웹사이트</p>
                        <a
                          className="font-semibold text-primary underline decoration-primary/30 underline-offset-4"
                          href={placeDetails.websiteUri}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {detailWebsiteLabel || placeDetails.websiteUri}
                        </a>
                      </div>
                    ) : null}
                    <div>
                      <p className="mb-1 text-sm font-black uppercase text-primary">이동 예상</p>
                      <p className="font-semibold text-on-surface">{selectedItem.travelDuration}</p>
                    </div>
                    <div>
                      <p className="mb-1 text-sm font-black uppercase text-primary">추천 키워드</p>
                      <div className="flex flex-wrap gap-2">
                        {selectedItem.keywords.map((tag) => (
                          <span key={tag} className="rounded-full bg-secondary-container px-3 py-1 text-sm font-bold text-on-secondary-container">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      className="w-full rounded-[1.25rem] bg-primary px-5 py-4 text-xl font-black text-white"
                      type="button"
                      onClick={() => openExternal(detailDirectionsUrl)}
                    >
                      예약하기
                    </button>
                    <div className="border-t border-outline-variant/20 pt-5">
                      <p className="mb-3 text-sm font-black uppercase text-primary">지도 링크</p>
                      <div className="grid gap-3">
                        {detailMapLinks.naver ? (
                          <a
                            className="rounded-[1rem] bg-surface-container-low px-4 py-3 text-center text-base font-black text-on-surface"
                            href={detailMapLinks.naver}
                            rel="noreferrer"
                            target="_blank"
                          >
                            네이버지도에서 보기
                          </a>
                        ) : null}
                        {detailMapLinks.kakao ? (
                          <a
                            className="rounded-[1rem] bg-surface-container-low px-4 py-3 text-center text-base font-black text-on-surface"
                            href={detailMapLinks.kakao}
                            rel="noreferrer"
                            target="_blank"
                          >
                            카카오맵에서 보기
                          </a>
                        ) : null}
                        {detailMapLinks.google ? (
                          <a
                            className="rounded-[1rem] bg-surface-container-low px-4 py-3 text-center text-base font-black text-on-surface"
                            href={detailMapLinks.google}
                            rel="noreferrer"
                            target="_blank"
                          >
                            구글 맵스에서 보기
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </section>
        </main>
      ) : null}

      {activeView === "reviews" && selectedItem ? (
        <main className={reviewsMainClassName}>
          <button
            className="mb-6 flex items-center gap-2 text-lg font-bold text-on-surface-variant"
            type="button"
            onClick={() => setActiveView("detail")}
          >
            <span className="material-symbols-outlined">arrow_back</span>
            상세 화면으로 돌아가기
          </button>

          <div className="mb-10 rounded-[2rem] bg-white p-8 shadow-sm">
            <div className="grid gap-6 md:grid-cols-[1fr_0.45fr]">
              <div>
                <h1 className="mb-3 font-headline text-4xl font-black text-on-surface">전체 리뷰</h1>
                <p className="text-lg font-medium text-on-surface-variant">
                  {selectedItem.name}에 대한 실제 후기와 추천 태그를 정리했습니다.
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {selectedItem.keywords.map((tag) => (
                    <span key={tag} className="rounded-full bg-secondary-container px-3 py-1 text-sm font-bold text-on-secondary-container">
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="rounded-[1.5rem] bg-surface-container-low p-6 text-center">
                <p className="text-5xl font-black text-primary">
                  {(placeDetails?.rating || selectedItem.rating).toFixed(1)}
                </p>
                <p className="mt-2 text-lg font-semibold text-on-surface">
                  {(placeDetails?.userRatingCount || detailReviews.length || 0).toLocaleString("ko-KR")}개의 리뷰
                </p>
                <p className="mt-1 text-base text-on-surface-variant">Google Places 기준 평점입니다.</p>
              </div>
            </div>
          </div>

          <div className="mb-8">
            <input
              className="w-full rounded-full border border-outline-variant/30 bg-white px-6 py-4 text-lg font-medium shadow-sm focus:border-primary focus:ring-0"
              placeholder="리뷰 내용을 검색해보세요..."
              type="search"
            />
          </div>

          <div className="mb-8 flex flex-wrap gap-3">
            {["서비스", "분위기", "접근성", "조용한 분위기"].map((filter) => (
              <button
                key={filter}
                className={`rounded-full px-5 py-2 text-sm font-black ${
                  filter === "서비스"
                    ? "bg-primary text-white"
                    : "bg-white text-on-surface-variant shadow-sm"
                }`}
                type="button"
              >
                {filter}
              </button>
            ))}
          </div>

          <div className="space-y-6">
            {detailReviews.map((review) => (
              <article key={review.id} className="rounded-[2rem] bg-white p-6 shadow-sm">
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <p className="text-xl font-black text-on-surface">{review.author}</p>
                    <p className="text-sm font-medium text-on-surface-variant">{review.daysAgo}</p>
                  </div>
                  <div className="font-black text-primary">{"★".repeat(review.rating)}</div>
                </div>
                <p className="text-lg font-medium leading-relaxed text-on-surface-variant">{review.text}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {review.tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-surface-container-low px-3 py-1 text-sm font-bold text-on-surface-variant">
                      {tag}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </main>
      ) : null}

      {activeView === "map" ? (
        <MapDirectionsPage
          currentLocation={currentLocation}
          isMobileDevice={isMobileDevice}
          locationStatus={locationStatus}
          mapItems={mapItems}
          mapSelectedItem={mapSelectedItem}
          mapSelectionSource={mapSelectionSource}
          onBack={() => setActiveView("recommend")}
          onOpenExternal={openExternal}
          onOpenItem={openItem}
          onRefreshLocation={requestCurrentLocation}
          onRetry={() => runRecommendation(query || "내 주변 맛집 추천", "map", { skipChat: true })}
          onRouteInfoChange={setRouteUi}
          onRouteModeChange={(mode) => {
            setRouteMode(mode);
            setRouteUi((current) => ({
              ...current,
              mode,
              status: currentLocation ? "loading" : "idle",
              steps: [],
              message: currentLocation
                ? "경로를 다시 계산하는 중입니다."
                : "현재 위치를 허용하면 웹 안에서 경로를 표시합니다.",
            }));
          }}
          autoOpenDirectionsSignal={mapDirectionsOpenSignal}
          onSelectItem={selectMapItem}
          onStartDirections={handleStartDirections}
          routeDistanceLabel={routeDistanceLabel}
          routeDurationLabel={routeDurationLabel}
          routeMode={routeMode}
          routeModeOptions={ROUTE_MODE_OPTIONS}
          routeSteps={routeSteps}
          routeSummaryLabel={routeSummaryLabel}
          routeUi={routeUi}
        />
      ) : null}

      {false ? (
        <main className="page-fade h-[calc(100vh-5rem)] w-full pt-20">
          <div className="route-canvas route-canvas--fullscreen relative h-full overflow-hidden">
            {mapSelectedItem ? (
              <GoogleRouteMap
                currentLocation={currentLocation}
                item={mapSelectedItem}
                items={mapItems}
                onSelectItem={(itemId) => selectMapItem(itemId, "map")}
                selectionSource={mapSelectionSource}
                routeMode={routeMode}
                onRouteInfoChange={setRouteUi}
              />
            ) : null}
            <div className="route-canvas__veil" />
            <button
              className="absolute left-8 top-8 z-20 flex items-center gap-2 text-lg font-bold text-primary"
              type="button"
              onClick={() => setActiveView("recommend")}
            >
              <span className="material-symbols-outlined">arrow_back</span>
              목록으로 돌아가기
            </button>
            <div className="hidden">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white">
                  <span className="material-symbols-outlined">turn_right</span>
                </div>
                <div>
                  <p className="text-sm font-black text-on-surface-variant">다음 안내</p>
                  <p className="text-3xl font-black text-on-surface">300m 후 우회전</p>
                </div>
              </div>
              <div className="mt-4 h-2 rounded-full bg-surface-container-high">
                <div className="h-full w-2/3 rounded-full bg-primary" />
              </div>
            </div>

            {mapSelectedItem ? (
            <div className="hidden absolute right-8 top-8 z-20 w-[360px] max-w-[calc(100vw-4rem)] rounded-[1.5rem] bg-white p-6 shadow-lg">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-black uppercase tracking-[0.18em] text-on-surface-variant">
                    {activeRouteModeLabel}
                  </p>
                  <p className="mt-2 text-2xl font-black text-on-surface">
                    {routeDurationLabel}
                  </p>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white">
                  <span className="material-symbols-outlined">route</span>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {ROUTE_MODE_OPTIONS.map((option) => {
                  const isActive = routeMode === option.id;
                  return (
                    <button
                      key={option.id}
                      className={`rounded-full px-4 py-2 text-sm font-black transition ${
                        isActive
                          ? "bg-primary text-white"
                          : "bg-surface-container-low text-on-surface"
                      }`}
                      type="button"
                      onClick={() => {
                        setRouteMode(option.id);
                        setRouteUi((current) => ({
                          ...current,
                          mode: option.id,
                          status: currentLocation ? "loading" : "idle",
                          steps: [],
                          message: currentLocation
                            ? "경로를 다시 계산하는 중입니다."
                            : "현재 위치를 허용하면 웹 안에서 경로를 표시합니다.",
                        }));
                      }}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <div className="mt-5 rounded-[1.25rem] bg-surface-container-low p-4">
                <p className="text-sm font-black text-on-surface-variant">
                  {routeUi.distanceText
                    ? `${routeUi.distanceText} · ${routeUi.durationText || "예상 시간 없음"}`
                    : routeUi.status === "loading"
                      ? "경로를 계산하는 중입니다."
                      : "웹 안 길찾기 상태"}
                </p>
                <p className="mt-2 text-base font-medium leading-relaxed text-on-surface">
                  {routeSummaryLabel}
                </p>
                {routePreviewSteps.length ? (
                  <div className="mt-4 space-y-3">
                    {routePreviewSteps.map((step, index) => (
                      <div
                        key={`preview-${step.id || `${step.instruction}-${index}`}`}
                        className="rounded-[1rem] border border-white/80 bg-white/90 px-4 py-4 shadow-sm"
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-black text-white">
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold leading-relaxed text-on-surface">
                              {step.instruction}
                            </p>
                            {step.transitLineLabel || step.transitHeadsign ? (
                              <div className="mt-2 inline-flex max-w-full rounded-full bg-primary-container px-3 py-1 text-[11px] font-black text-on-primary-container">
                                <span className="truncate">
                                  {[
                                    step.transitLineLabel ? `노선 ${step.transitLineLabel}` : "",
                                    step.transitHeadsign ? `${step.transitHeadsign} 방면` : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                              </div>
                            ) : null}
                            {step.departureStopName || step.arrivalStopName || step.stopCountText ? (
                              <div className="mt-2 rounded-[0.9rem] bg-surface-container-low px-3 py-2 text-xs font-bold leading-relaxed text-on-surface-variant">
                                {[
                                  step.departureStopName
                                    ? `${step.departureStopName}${step.departureTimeText ? ` 승차 ${step.departureTimeText}` : " 승차"}`
                                    : "",
                                  step.arrivalStopName
                                    ? `${step.arrivalStopName}${step.arrivalTimeText ? ` 하차 ${step.arrivalTimeText}` : " 하차"}`
                                    : "",
                                  step.stopCountText || "",
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </div>
                            ) : null}
                            {step.distanceText || step.durationText ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {step.distanceText ? (
                                  <span className="rounded-full bg-surface-container-high px-2.5 py-1 text-[11px] font-black text-on-surface-variant">
                                    {step.distanceText}
                                  </span>
                                ) : null}
                                {step.durationText ? (
                                  <span className="rounded-full bg-surface-container-high px-2.5 py-1 text-[11px] font-black text-on-surface-variant">
                                    {step.durationText}
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {false && routePreviewSteps.length ? (
                  <div className="mt-4 space-y-2">
                    {routePreviewSteps.map((step, index) => (
                      <div
                        key={step.id || `${step.instruction}-${index}`}
                        className="rounded-[1rem] bg-white/80 px-3 py-3"
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-black text-white">
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold leading-relaxed text-on-surface">
                              {step.instruction}
                            </p>
                            {false ? (
                              <p className="mt-1 text-xs font-black text-primary">
                                {[
                                  step.transitLineLabel ? `노선 ${step.transitLineLabel}` : "",
                                  step.transitHeadsign ? `${step.transitHeadsign} 방면` : "",
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            ) : null}
                            {false ? (
                              <p className="mt-1 text-xs font-bold text-on-surface-variant">
                                {[
                                  step.departureStopName
                                    ? `${step.departureStopName}${step.departureTimeText ? ` 승차 ${step.departureTimeText}` : " 승차"}`
                                    : "",
                                  step.arrivalStopName
                                    ? `${step.arrivalStopName}${step.arrivalTimeText ? ` 하차 ${step.arrivalTimeText}` : " 하차"}`
                                    : "",
                                  step.stopCountText || "",
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            ) : null}
                            {step.transitLineLabel || step.transitHeadsign ? (
                              <p className="mt-2 text-xs font-black text-primary">
                                {[
                                  step.transitLineLabel ? `노선 ${step.transitLineLabel}` : "",
                                  step.transitHeadsign ? `${step.transitHeadsign} 방면` : "",
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            ) : null}
                            {step.departureStopName || step.arrivalStopName || step.stopCountText ? (
                              <p className="mt-2 text-xs font-bold text-on-surface-variant">
                                {[
                                  step.departureStopName
                                    ? `${step.departureStopName}${step.departureTimeText ? ` 승차 ${step.departureTimeText}` : " 승차"}`
                                    : "",
                                  step.arrivalStopName
                                    ? `${step.arrivalStopName}${step.arrivalTimeText ? ` 하차 ${step.arrivalTimeText}` : " 하차"}`
                                    : "",
                                  step.stopCountText || "",
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            ) : null}
                            {step.transitLineLabel || step.transitHeadsign ? (
                              <div className="mt-2 inline-flex max-w-full rounded-full bg-primary-container px-3 py-1 text-xs font-black text-on-primary-container">
                                <span className="truncate">
                                  {[
                                    step.transitLineLabel ? `노선 ${step.transitLineLabel}` : "",
                                    step.transitHeadsign ? `${step.transitHeadsign} 방면` : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                              </div>
                            ) : null}
                            {step.departureStopName || step.arrivalStopName || step.stopCountText ? (
                              <div className="mt-2 rounded-[1rem] bg-white px-3 py-2 text-xs font-bold leading-relaxed text-on-surface-variant shadow-sm">
                                {[
                                  step.departureStopName
                                    ? `${step.departureStopName}${step.departureTimeText ? ` 승차 ${step.departureTimeText}` : " 승차"}`
                                    : "",
                                  step.arrivalStopName
                                    ? `${step.arrivalStopName}${step.arrivalTimeText ? ` 하차 ${step.arrivalTimeText}` : " 하차"}`
                                    : "",
                                  step.stopCountText || "",
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </div>
                            ) : null}
                            {step.transitLineLabel || step.transitHeadsign ? (
                              <div className="mt-2 inline-flex max-w-full rounded-full bg-primary-container px-3 py-1 text-xs font-black text-on-primary-container">
                                <span className="truncate">
                                  {[
                                    step.transitLineLabel ? `노선 ${step.transitLineLabel}` : "",
                                    step.transitHeadsign ? `${step.transitHeadsign} 방면` : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                              </div>
                            ) : null}
                            {step.departureStopName || step.arrivalStopName || step.stopCountText ? (
                              <div className="mt-2 rounded-[1rem] bg-white px-3 py-2 text-xs font-bold leading-relaxed text-on-surface-variant shadow-sm">
                                {[
                                  step.departureStopName
                                    ? `${step.departureStopName}${step.departureTimeText ? ` 승차 ${step.departureTimeText}` : " 승차"}`
                                    : "",
                                  step.arrivalStopName
                                    ? `${step.arrivalStopName}${step.arrivalTimeText ? ` 하차 ${step.arrivalTimeText}` : " 하차"}`
                                    : "",
                                  step.stopCountText || "",
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </div>
                            ) : null}
                            {step.transitLineLabel || step.transitHeadsign ? (
                              <div className="mt-2 inline-flex max-w-full rounded-full bg-primary-container px-3 py-1 text-xs font-black text-on-primary-container">
                                <span className="truncate">
                                  {[
                                    step.transitLineLabel ? `노선 ${step.transitLineLabel}` : "",
                                    step.transitHeadsign ? `${step.transitHeadsign} 방면` : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                              </div>
                            ) : null}
                            {step.departureStopName || step.arrivalStopName || step.stopCountText ? (
                              <div className="mt-2 rounded-[1rem] bg-white px-3 py-2 text-xs font-bold leading-relaxed text-on-surface-variant shadow-sm">
                                {[
                                  step.departureStopName
                                    ? `${step.departureStopName}${step.departureTimeText ? ` 승차 ${step.departureTimeText}` : " 승차"}`
                                    : "",
                                  step.arrivalStopName
                                    ? `${step.arrivalStopName}${step.arrivalTimeText ? ` 하차 ${step.arrivalTimeText}` : " 하차"}`
                                    : "",
                                  step.stopCountText || "",
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </div>
                            ) : null}
                            {step.distanceText || step.durationText ? (
                              <p className="mt-1 text-xs font-bold text-on-surface-variant">
                                {[step.distanceText, step.durationText].filter(Boolean).join(" · ")}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            ) : recommendationFeedbackState === "loading" || recommendationFeedbackState === "empty" ? (
            <RecommendationMapStatusCard loading={recommendationFeedbackState === "loading"} />
            ) : null}

            {mapSelectedItem ? (
            <div className="route-panel-scroll absolute bottom-4 left-4 top-20 z-20 w-[400px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-[1.75rem] bg-white p-5 shadow-2xl ring-1 ring-black/5">
              <div className="hidden overflow-hidden rounded-[1.75rem] bg-white shadow-sm">
                <img alt={mapSelectedItem.name} className="h-64 w-full object-cover" src={mapSelectedItem.imageUrl} />
              </div>
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-on-surface-variant">
                  Directions
                </p>
                <h1 className="mt-3 text-[1.75rem] font-black leading-tight text-on-surface">
                  {mapSelectedItem.name}
                </h1>
                <p className="mt-2 text-sm font-semibold text-on-surface-variant">
                  {mapSelectedItem.category} · {activeRouteModeLabel} 경로
                </p>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {ROUTE_MODE_OPTIONS.map((option) => {
                  const isActive = routeMode === option.id;
                  return (
                    <button
                      key={`panel-route-${option.id}`}
                      className={`rounded-full px-4 py-2 text-sm font-black transition ${
                        isActive
                          ? "bg-primary text-white"
                          : "bg-surface-container-low text-on-surface"
                      }`}
                      type="button"
                      onClick={() => {
                        setRouteMode(option.id);
                        setRouteUi((current) => ({
                          ...current,
                          mode: option.id,
                          status: currentLocation ? "loading" : "idle",
                          steps: [],
                          message: currentLocation
                            ? "경로를 다시 계산하는 중입니다."
                            : "현재 위치를 허용하면 지도 위에 경로를 표시합니다.",
                        }));
                      }}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-[1.25rem] bg-surface-container-low p-4">
                  <p className="text-sm font-black uppercase text-on-surface-variant">남은 거리</p>
                  <p className="mt-2 text-[1.7rem] font-black text-on-surface">
                    {routeDistanceLabel || "거리 계산 대기"}
                  </p>
                </div>
                <div className="rounded-[1.25rem] bg-surface-container-low p-4">
                  <p className="text-sm font-black uppercase text-on-surface-variant">예상 시간</p>
                  <p className="mt-2 text-[1.7rem] font-black text-on-surface">{routeDurationLabel}</p>
                </div>
              </div>

              <div className="mt-5 rounded-[1.25rem] bg-surface-container-low p-4">
                <p className="text-sm font-black uppercase text-on-surface-variant">경로 안내</p>
                <p className="mt-3 text-base font-medium leading-relaxed text-on-surface">
                  {routeSummaryLabel}
                </p>
              </div>

              <div className="mt-5 rounded-[1.25rem] bg-surface-container-low p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-on-surface-variant">Step by step</p>
                  {routeSteps.length ? (
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-on-surface-variant shadow-sm">
                      {routeSteps.length} steps
                    </span>
                  ) : null}
                </div>
                {routeSteps.length ? (
                  <div className="mt-4 space-y-3">
                    {routeSteps.map((step, index) => (
                      <div
                        key={`detail-${step.id || `${step.instruction}-${index}`}`}
                        className="rounded-[1.25rem] border border-transparent bg-surface-container-low px-4 py-4 shadow-sm"
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-black text-white">
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold leading-relaxed text-on-surface">
                              {step.instruction}
                            </p>
                            {step.transitLineLabel || step.transitHeadsign ? (
                              <div className="mt-2 inline-flex max-w-full rounded-full bg-primary-container px-3 py-1 text-xs font-black text-on-primary-container">
                                <span className="truncate">
                                  {[
                                    step.transitLineLabel ? `노선 ${step.transitLineLabel}` : "",
                                    step.transitHeadsign ? `${step.transitHeadsign} 방면` : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                              </div>
                            ) : null}
                            {step.departureStopName || step.arrivalStopName || step.stopCountText ? (
                              <div className="mt-2 rounded-[1rem] bg-white px-3 py-2 text-xs font-bold leading-relaxed text-on-surface-variant shadow-sm">
                                {[
                                  step.departureStopName
                                    ? `${step.departureStopName}${step.departureTimeText ? ` 승차 ${step.departureTimeText}` : " 승차"}`
                                    : "",
                                  step.arrivalStopName
                                    ? `${step.arrivalStopName}${step.arrivalTimeText ? ` 하차 ${step.arrivalTimeText}` : " 하차"}`
                                    : "",
                                  step.stopCountText || "",
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </div>
                            ) : null}
                            {step.distanceText || step.durationText ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {step.distanceText ? (
                                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-on-surface-variant shadow-sm">
                                    {step.distanceText}
                                  </span>
                                ) : null}
                                {step.durationText ? (
                                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-on-surface-variant shadow-sm">
                                    {step.durationText}
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {false && routeSteps.length ? (
                  <div className="mt-4 space-y-3">
                    {routeSteps.map((step, index) => (
                      <div
                        key={step.id || `${step.instruction}-${index}`}
                        className="rounded-[1.25rem] bg-surface-container-low px-4 py-4"
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-black text-white">
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold leading-relaxed text-on-surface">
                              {step.instruction}
                            </p>
                            {step.distanceText || step.durationText ? (
                              <p className="mt-2 text-xs font-bold text-on-surface-variant">
                                {[step.distanceText, step.durationText].filter(Boolean).join(" · ")}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-base font-medium leading-relaxed text-on-surface">
                    {routeSummaryLabel}
                  </p>
                )}
              </div>

              <div className="mt-8 rounded-[1.5rem] bg-white p-5 shadow-sm">
                <p className="text-sm font-black uppercase text-on-surface-variant">Other picks</p>
                <div className="mt-4 flex flex-wrap gap-3">
                  {mapItems.map((mapItem) => {
                    const isActive = mapItem.id === mapSelectedItem.id;
                    return (
                      <button
                        key={mapItem.id}
                        className={`rounded-full border px-4 py-2 text-sm font-bold transition ${
                          isActive
                            ? "border-primary bg-primary text-white"
                            : "border-outline-variant bg-surface-container-low text-on-surface"
                        }`}
                        type="button"
                        onClick={() => selectMapItem(mapItem.id, "panel")}
                      >
                        {mapItem.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-8 space-y-5">
                <div className="flex gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary-container text-primary">
                    <span className="material-symbols-outlined filled-icon">location_on</span>
                  </div>
                  <div>
                    <p className="font-black text-on-surface">현재 위치</p>
                    <p className="text-lg font-medium text-on-surface-variant">
                      {currentLocation
                        ? `${currentLocation.lat.toFixed(4)}, ${currentLocation.lng.toFixed(4)}`
                        : "현재 위치 미설정"}
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-container text-on-primary-container">
                    <span className="material-symbols-outlined filled-icon">restaurant</span>
                  </div>
                  <div>
                    <p className="font-black text-on-surface">목적지</p>
                    <p className="text-lg font-medium text-on-surface-variant">{mapSelectedItem.name}</p>
                  </div>
                </div>
                <button
                  className="rounded-[1.25rem] bg-primary px-5 py-4 text-lg font-black text-white"
                  type="button"
                  onClick={() => openExternal(mapSelectedItem.links.googleDirections || mapSelectedItem.links.googleMap)}
                >
                  구글 길찾기 열기
                </button>
                <button
                  className="rounded-[1.25rem] bg-secondary-container px-5 py-4 text-lg font-black text-on-secondary-container"
                  type="button"
                  onClick={requestCurrentLocation}
                >
                  현재 위치 새로고침
                </button>
                <p className="text-base font-medium text-on-surface-variant">{locationStatus}</p>
              </div>
            </div>
            ) : (
            <div className="absolute bottom-8 left-8 top-28 z-20 flex w-[360px] max-w-[calc(100vw-4rem)] items-center">
              <div className="rounded-[1.75rem] bg-white p-8 shadow-sm">
                <p className="text-2xl font-black text-on-surface">주변 맛집을 찾고 있습니다.</p>
                <p className="mt-3 text-base font-medium leading-relaxed text-on-surface-variant">
                  지도 기록이 없어도 현재 위치 기준 추천을 자동으로 불러옵니다.
                </p>
                <button
                  className="mt-6 rounded-[1.25rem] bg-primary px-5 py-4 text-lg font-black text-white"
                  type="button"
                  onClick={() => runRecommendation(query || "내 주변 맛집 추천", "map", { skipChat: true })}
                >
                  주변 맛집 다시 찾기
                </button>
              </div>
            </div>
            )}
          </div>
        </main>
      ) : null}

      {activeView === "mypage" ? (
        <main className={myPageMainClassName}>
          <section className="mb-14 flex flex-col items-center gap-10 md:flex-row">
            <div className="relative">
              <div className="h-32 w-32 overflow-hidden rounded-full border-4 border-primary-container bg-white p-1 shadow-lg md:h-40 md:w-40">
                <img
                  alt={user.name}
                  className="h-full w-full rounded-full object-cover"
                  src="https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=900&q=80"
                />
              </div>
              <button className="absolute bottom-2 right-2 rounded-full bg-primary p-2 text-white shadow-md" type="button">
                <span className="material-symbols-outlined text-xl">edit</span>
              </button>
            </div>
            <div className="text-center md:text-left">
              <h1 className="mypage-greeting-title font-headline text-4xl font-black tracking-tight text-on-surface md:text-5xl">
                안녕하세요, {user.name}님!
              </h1>
              <p className="mypage-greeting-subtitle mt-2 text-xl font-semibold text-on-surface-variant">
                오늘 당신의 입맛을 사로잡을 맛집을 찾아볼까요?
              </p>
            </div>
          </section>
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            <div className="flex flex-col gap-8 lg:col-span-5">
              <section className="rounded-xl bg-surface-container-low p-10">
                <div className="mb-8 flex items-center gap-3">
                  <span className="material-symbols-outlined filled-icon text-3xl text-primary">visibility</span>
                  <h2 className="text-2xl font-extrabold text-on-surface">보기 편한 설정</h2>
                </div>
                {[
                  ["largeText", "큰 글자", "제목과 설명을 읽기 쉽게 만듭니다"],
                  ["highContrast", "고대비", "색상 차이를 더 분명하게 만들어 가독성을 높입니다"],
                  ["audioGuide", "음성 안내", "식당 상세 정보를 음성으로 읽어 줍니다"],
                  ["darkMode", "다크 모드", "어두운 배경으로 눈부심을 줄이고 밤에도 편하게 볼 수 있습니다."],
                ].map(([key, title, copy]) => (
                  <button
                    key={key}
                    className="mb-4 flex w-full items-center justify-between rounded-xl bg-white p-4 text-left"
                    type="button"
                    onClick={() =>
                      setAccessibility((current) => ({
                        ...current,
                        [key]: !current[key],
                      }))
                    }
                  >
                    <div className="min-w-0 flex-1">
                      <h3 className="text-xl font-bold text-on-surface">{title}</h3>
                      <p className="text-base text-on-surface-variant">{copy}</p>
                    </div>
                    <div
                      className={`relative flex h-8 w-14 items-center rounded-full p-1 ${
                        accessibility[key] ? "justify-end bg-primary" : "bg-surface-container-highest"
                      }`}
                    >
                      <div className="h-6 w-6 rounded-full bg-white shadow-sm" />
                    </div>
                  </button>
                ))}
              </section>

              <section className="rounded-xl bg-secondary-container/30 p-10">
                <div className="mb-8 flex items-center gap-3">
                  <span className="material-symbols-outlined filled-icon text-3xl text-secondary">medical_services</span>
                  <h2 className="text-2xl font-extrabold text-on-secondary-container">식단 요구사항</h2>
                </div>
                <div className="flex flex-wrap gap-4">
                  {DIETARY_OPTIONS.map((option) => {
                    const selected = dietaryTokens.includes(option);
                    return (
                      <button
                        key={option}
                        className={`rounded-full px-6 py-3 text-lg font-bold ${
                          selected
                            ? "bg-primary text-white"
                            : "bg-white text-secondary shadow-sm"
                        }`}
                        type="button"
                        onClick={() => toggleDietaryChip(option)}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>

            <div className="flex flex-col gap-8 lg:col-span-7">
              <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                <section className="rounded-xl bg-surface-container-low p-8">
                  <div className="mb-6 flex items-center justify-between">
                    <h2 className="text-xl font-extrabold text-on-surface">저장됨</h2>
                    <button className="font-bold text-primary" type="button" onClick={() => setActiveView("saved")}>
                      전체보기
                    </button>
                  </div>
                  <div className="space-y-4">
                    {(savedItems.length ? savedItems.slice(0, 2) : []).map((item) => (
                      <button
                        key={item.id}
                        className="flex w-full items-center gap-4 rounded-lg bg-white p-3 text-left shadow-sm"
                        type="button"
                        onClick={() => openItem(item, "saved")}
                      >
                        <img alt={item.name} className="h-16 w-16 rounded-lg object-cover" src={item.imageUrl} />
                        <div>
                          <h4 className="text-lg font-bold text-on-surface">{item.name}</h4>
                          <p className="text-base text-on-surface-variant">{item.locationText}</p>
                        </div>
                      </button>
                    ))}
                    {!savedItems.length ? (
                      <div className="rounded-lg bg-white p-5 text-base font-medium text-on-surface-variant">
                        저장한 맛집이 아직 없습니다.
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className="rounded-xl bg-surface-container-low p-8">
                  <div className="mb-6 flex items-center justify-between">
                    <h2 className="text-xl font-extrabold text-on-surface">최근 방문</h2>
                    <button className="font-bold text-primary" type="button" onClick={() => setActiveView("visits")}>
                      기록
                    </button>
                  </div>
                  <div className="space-y-4">
                    {flatVisitEntries
                      .slice(0, 2)
                      .map((entry) => (
                        <button
                          key={entry.id}
                          className="flex w-full items-center gap-4 rounded-lg bg-white p-3 text-left shadow-sm"
                          type="button"
                          onClick={() => runRecommendation(entry.query, "recommend")}
                        >
                          <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-surface-container-high text-primary">
                            <span className="material-symbols-outlined filled-icon">restaurant</span>
                          </div>
                          <div>
                            <h4 className="text-lg font-bold text-on-surface">{entry.query}</h4>
                            <p className="text-base text-on-surface-variant">{formatDate(entry.createdAt)}</p>
                          </div>
                        </button>
                      ))}
                    {!flatVisitEntries.length ? (
                      <div className="rounded-lg bg-white p-5 text-base font-medium text-on-surface-variant">
                        최근 방문 기록이 아직 없습니다.
                      </div>
                    ) : null}
                  </div>
                </section>
              </div>

              <section className="rounded-xl bg-surface-container-low p-8">
                <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-extrabold text-on-surface">개인화 시트 관리</h2>
                    <p className="mt-2 text-base font-medium text-on-surface-variant">
                      시트별 취향과 거리 제한을 저장해 탭 전환 없이 바로 추천에 반영합니다.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="min-w-[12rem]">
                      <span className="mb-2 block text-sm font-black uppercase text-on-surface-variant">활성 시트</span>
                      <select
                        className="w-full rounded-[1rem] border-none bg-white px-4 py-3 font-semibold text-on-surface focus:ring-2 focus:ring-primary/20"
                        value={activeSheetId}
                        onChange={(event) => handleSelectSheet(event.target.value)}
                      >
                        {preferenceSheets.map((sheet) => (
                          <option key={sheet.id} value={sheet.id}>
                            {sheet.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className="rounded-xl bg-secondary-container px-5 py-3 font-black text-on-secondary-container" type="button" onClick={handleCreateSheet}>
                      + 시트
                    </button>
                    <button className="rounded-xl bg-error-container px-5 py-3 font-black text-on-error-container" type="button" onClick={handleDeleteSheet}>
                      - 시트
                    </button>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-black uppercase text-on-surface-variant">시트 이름</span>
                    <input
                      className="w-full rounded-[1rem] border-none bg-white px-4 py-4 font-semibold text-on-surface focus:ring-2 focus:ring-primary/20"
                      value={sheetName}
                      onChange={(event) => setSheetName(event.target.value)}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-black uppercase text-on-surface-variant">선호 음식</span>
                    <input
                      className="w-full rounded-[1rem] border-none bg-white px-4 py-4 font-semibold text-on-surface focus:ring-2 focus:ring-primary/20"
                      value={preferences.favoriteCuisine}
                      onChange={(event) => updatePreferenceField("favoriteCuisine", event.target.value)}
                      placeholder="예: 한식, 일식, 국밥"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-black uppercase text-on-surface-variant">분위기</span>
                    <input
                      className="w-full rounded-[1rem] border-none bg-white px-4 py-4 font-semibold text-on-surface focus:ring-2 focus:ring-primary/20"
                      value={preferences.mood}
                      onChange={(event) => updatePreferenceField("mood", event.target.value)}
                      placeholder="예: 조용한, 혼밥, 부모님과"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-black uppercase text-on-surface-variant">예산</span>
                    <select
                      className="w-full rounded-[1rem] border-none bg-white px-4 py-4 font-semibold text-on-surface focus:ring-2 focus:ring-primary/20"
                      value={preferences.budget}
                      onChange={(event) => updatePreferenceField("budget", event.target.value)}
                    >
                      <option value="">선택 안 함</option>
                      <option value="저가">저가</option>
                      <option value="중간">중간</option>
                      <option value="고가">고가</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-black uppercase text-on-surface-variant">최대 이동거리(km)</span>
                    <input
                      className={`w-full rounded-[1rem] border-none px-4 py-4 font-semibold text-on-surface focus:ring-2 focus:ring-primary/20 ${
                        maxDistanceEnabled
                          ? "bg-white"
                          : "cursor-not-allowed bg-surface-container text-on-surface-variant"
                      }`}
                      disabled={!maxDistanceEnabled}
                      value={preferences.maxDistanceKm}
                      onChange={(event) => updatePreferenceField("maxDistanceKm", event.target.value)}
                      placeholder={maxDistanceEnabled ? "예: 3" : "위치 권한 허용 후 사용 가능"}
                    />
                    {!maxDistanceEnabled ? (
                      <p className="mt-2 text-sm font-medium text-on-surface-variant">
                        현재 위치 접근을 허용해야 최대 이동 거리를 추천 조건에 반영할 수 있습니다.
                      </p>
                    ) : null}
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-black uppercase text-on-surface-variant">피하고 싶은 재료</span>
                    <input
                      className="w-full rounded-[1rem] border-none bg-white px-4 py-4 font-semibold text-on-surface focus:ring-2 focus:ring-primary/20"
                      value={preferences.avoidIngredients}
                      onChange={(event) => updatePreferenceField("avoidIngredients", event.target.value)}
                      placeholder="예: 고수, 땅콩"
                    />
                  </label>
                </div>
                <div className="mt-6 flex flex-wrap gap-4">
                  <button
                    className="rounded-[1.25rem] bg-primary px-6 py-4 text-lg font-black text-white"
                    disabled={savingPreferences}
                    type="button"
                    onClick={handleSavePreferences}
                  >
                    {savingPreferences ? "저장 중..." : "모든 변경사항 저장"}
                  </button>
                  <button
                    className="rounded-[1.25rem] bg-surface-container-high px-6 py-4 text-lg font-black text-on-surface"
                    type="button"
                    onClick={handleLogout}
                  >
                    로그아웃
                  </button>
                </div>
              </section>
            </div>
          </div>
        </main>
      ) : null}

      {activeView === "saved" ? (
        <main className={savedMainClassName}>
          <button
            className="mb-8 flex items-center gap-2 rounded-full bg-surface-container-low px-6 py-3 text-lg font-bold text-on-surface-variant"
            type="button"
            onClick={() => setActiveView("mypage")}
          >
            <span className="material-symbols-outlined">arrow_back</span>
            내 정보로 돌아가기
          </button>
          <h1 className="font-headline text-4xl font-black text-primary md:text-6xl">저장한 맛집 전체보기</h1>
          <p className="mt-3 text-xl font-medium text-on-surface-variant">정성을 다해 고른 식당들입니다.</p>
          {!savedItems.length ? (
            <div className="mt-12 rounded-[1.75rem] bg-white p-10 text-center shadow-sm">
              <p className="text-2xl font-black text-on-surface">저장한 맛집이 없습니다.</p>
              <p className="mt-3 text-lg font-medium text-on-surface-variant">
                추천 화면에서 마음에 드는 식당을 저장해 보세요.
              </p>
            </div>
          ) : (
            <div className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-3">
              {savedItems.map((item) => (
                <SavedCard
                  key={item.id}
                  item={item}
                  onOpenMap={(target) => openItem(target, "map")}
                  onRemove={() => {
                    const realFavorite = favorites.find(
                      (entry) => entry.name.toLowerCase() === item.name.toLowerCase(),
                    );
                    if (realFavorite) removeFavorite(realFavorite.id);
                  }}
                />
              ))}
            </div>
          )}
        </main>
      ) : null}

      {activeView === "visits" ? (
        <main className={visitsMainClassName}>
          <button
            className="mb-8 flex items-center gap-2 rounded-full bg-surface-container-low px-6 py-3 text-lg font-bold text-on-surface-variant"
            type="button"
            onClick={() => setActiveView("mypage")}
          >
            <span className="material-symbols-outlined">arrow_back</span>
            마이페이지로 돌아가기
          </button>
          <h1 className="font-headline text-4xl font-black text-on-surface md:text-6xl">최근 방문 기록</h1>
          <p className="mt-3 text-xl font-medium text-on-surface-variant">최근에 다녀온 맛집들입니다.</p>
          {visitHistory.length ? (
            <div className="mt-6 flex justify-end">
              <button
                className="rounded-[1.25rem] bg-error-container px-5 py-4 text-base font-black text-on-error-container"
                type="button"
                onClick={clearHistoryEntries}
              >
                전체 기록 삭제
              </button>
            </div>
          ) : null}
          {!flatVisitEntries.length ? (
            <div className="mt-12 rounded-[1.75rem] bg-white p-10 text-center shadow-sm">
              <p className="text-2xl font-black text-on-surface">최근 방문 기록이 없습니다.</p>
              <p className="mt-3 text-lg font-medium text-on-surface-variant">
                추천을 받아보고 마음에 드는 식당을 다시 확인해보세요.
              </p>
            </div>
          ) : (
          <div className="mt-12 space-y-14">
            {Object.entries(visitEntries).map(([bucket, entries]) => (
              <section key={bucket}>
                <div className="mb-6 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-container text-on-primary-container">
                    <span className="material-symbols-outlined filled-icon">schedule</span>
                  </div>
                  <h2 className="text-3xl font-black text-on-surface">{bucket}</h2>
                </div>
                <div className="space-y-8 border-l border-outline-variant/40 pl-8">
                  {entries.map((entry) => (
                    <article key={entry.id} className="overflow-hidden rounded-[1.75rem] bg-white shadow-sm">
                      <div className="grid md:grid-cols-[0.38fr_0.62fr]">
                        <img alt={entry.name} className="h-full min-h-[240px] w-full object-cover" src={entry.imageUrl} />
                        <div className="p-6">
                          <div className="mb-3 flex items-start justify-between gap-4">
                            <div>
                              <h3 className="font-headline text-4xl font-black text-on-surface">{entry.query}</h3>
                              <p className="mt-2 text-lg font-medium text-on-surface-variant">{entry.name}</p>
                            </div>
                            <div className="flex items-start gap-3">
                              <p className="text-right text-lg font-bold text-on-surface-variant">
                                {formatDate(entry.createdAt)}
                              </p>
                              {visitHistory.length ? (
                                <button
                                  aria-label="방문 기록 삭제"
                                  className="flex h-10 w-10 items-center justify-center rounded-full bg-error-container text-2xl font-black leading-none text-on-error-container"
                                  type="button"
                                  onClick={() => removeHistoryEntry(entry.id)}
                                >
                                  -
                                </button>
                              ) : null}
                            </div>
                          </div>
                          <div className="mb-6 flex flex-wrap gap-2">
                            {entry.keywords.slice(0, 3).map((tag) => (
                              <span key={tag} className="rounded-full bg-secondary-container px-3 py-1 text-sm font-bold text-on-secondary-container">
                                #{tag}
                              </span>
                            ))}
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <button
                              className="rounded-[1.25rem] bg-primary px-4 py-4 text-xl font-black text-white"
                              type="button"
                              onClick={() => runRecommendation(entry.query, "recommend")}
                            >
                              다시 검색하기
                            </button>
                            <button
                              className="rounded-[1.25rem] bg-surface-container-high px-4 py-4 text-xl font-black text-on-surface"
                              type="button"
                              onClick={() => openItem(entry, "map")}
                            >
                              길찾기
                            </button>
                          </div>
                          {false ? (
                            <button
                              className="mt-4 rounded-[1.25rem] bg-error-container px-4 py-4 text-base font-black text-on-error-container"
                              type="button"
                              onClick={() => removeHistoryEntry(entry.id)}
                            >
                              기록 삭제
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
          )}
        </main>
      ) : null}

      {activeView === "map" ? null : <Footer isMobileDevice={isMobileDevice} />}
    </div>
  );
}
