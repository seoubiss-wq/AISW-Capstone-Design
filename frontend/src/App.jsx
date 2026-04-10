import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  AuthScreen,
  Footer,
  RecommendationEmptyState,
  RecommendationLoadingGrid,
  RecommendationMapStatusCard,
  ResultCard,
  SavedCard,
  TopNav,
} from "./app/components";
import {
  AUTH_SESSION_MARKER,
  DEFAULT_PREFERENCES,
  DEFAULT_ROUTE_UI,
  DEMO_ITEMS,
  DEMO_MENUS,
  DIETARY_OPTIONS,
  FOLLOW_UP_CHIPS,
  POPULAR_TAGS,
  ROUTE_MODE_OPTIONS,
  buildAppHistoryState,
  buildDetailConvenienceTags,
  buildGeolocationErrorMessage,
  buildMessage,
  buildPreferredExternalMapLinks,
  buildRecommendationAssistantText,
  buildRecommendationDecisionBrief,
  buildRecommendationRequestBody,
  canUseMaxDistancePreference,
  enrichItem,
  formatDate,
  formatDetailReview,
  formatPlaceDetailsPhone,
  formatPlaceDetailsWebsite,
  formatRelativeDate,
  getAppHistorySnapshot,
  getRecommendationFeedbackState,
  getSpeechRecognitionCtor,
  getVisitBucket,
  inferDetailAudienceTags,
  inferDetailMoodTags,
  isAppHistoryState,
  isMobileDeviceEnvironment,
  isNearbyRecommendationSeed,
  normalizePreferences,
  persistDarkMode,
  persistLargeText,
  readStoredDarkMode,
  readStoredLargeText,
  shouldUseOriginLocationAsCurrentLocation,
  shouldRetryGeolocationRequest,
  shouldWaitForLocationBeforeRecommendation,
  splitTokens,
} from "./app/appSupport";
import { request } from "./lib/api";
import {
  buildSupabaseGoogleRedirectUrl,
  clearSupabaseBridgeSession,
  getSupabaseClient,
  hasSupabaseAuthConfig,
  hydrateSupabaseAuthConfig,
  isSupabaseGoogleSession,
  stripSupabaseAuthParams,
} from "./lib/supabase";
import { sessionBootstrapQueryOptions } from "./queries/session";

const GoogleRouteMap = lazy(() => import("./GoogleRouteMap"));
const MapDirectionsPage = lazy(() => import("./MapDirectionsPage"));

export {
  buildGeolocationErrorMessage,
  buildRecommendationAssistantText,
  buildRecommendationDecisionBrief,
  buildRecommendationRequestBody,
  canUseMaxDistancePreference,
  getRecommendationFeedbackState,
  getRecommendationOpenStatusLabel,
  isNearbyRecommendationSeed,
  shouldRetryGeolocationRequest,
  shouldUseOriginLocationAsCurrentLocation,
  shouldWaitForLocationBeforeRecommendation,
} from "./app/appSupport";

const GEOLOCATION_REQUEST_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 300000,
};

const GEOLOCATION_RETRY_OPTIONS = {
  enableHighAccuracy: false,
  timeout: 15000,
  maximumAge: 600000,
};

function readSecureContext() {
  if (typeof window === "undefined") return true;
  return window.isSecureContext !== false;
}

function readCurrentPosition(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

function MapPreviewFallback() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-surface-container-lowest">
      <p className="text-sm font-semibold text-on-surface-variant">
        지도를 불러오는 중입니다.
      </p>
    </div>
  );
}

function MapPageFallback({ isMobileDevice }) {
  return (
    <main
      className={`page-fade mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-screen-2xl flex-col px-4 pb-16 pt-20 md:px-8 ${
        isMobileDevice ? "pb-32" : ""
      }`}
    >
      <div className="flex flex-1 items-center justify-center rounded-[2rem] bg-surface-container-lowest">
        <p className="text-base font-semibold text-on-surface-variant">
          지도 화면을 불러오는 중입니다.
        </p>
      </div>
    </main>
  );
}

export default function App() {
  const [token, setToken] = useState("");
  const [booting, setBooting] = useState(true);
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
  const [pendingGoogleLink, setPendingGoogleLink] = useState(null);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeView, setActiveView] = useState("home");
  const [openNowOnly, setOpenNowOnly] = useState(false);
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
  const oauthExchangeTokenRef = useRef("");
  const exchangeGoogleOAuthSessionRef = useRef(null);
  const placeDetailsCacheRef = useRef({});
  const chatScrollContainerRef = useRef(null);
  const chatScrollAnchorRef = useRef(null);
  const voiceRecognitionRef = useRef(null);
  const voiceStopRequestedRef = useRef(false);
  const voiceErrorRef = useRef("");
  const historyReadyRef = useRef(false);
  const syncingFromHistoryRef = useRef(false);
  const historySnapshotRef = useRef("");
  const initialHistoryStateRef = useRef(buildAppHistoryState({ activeView: "home", selectedItemId: "", detailItem: null }));
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
  const sessionQuery = useQuery(sessionBootstrapQueryOptions());

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

  const applyHistoryState = useCallback((state) => {
    const nextView = state?.activeView || "home";
    const nextSelectedItemId = state?.selectedItemId || "";
    const nextDetailItem =
      nextView === "detail" || nextView === "reviews" ? state?.detailItem || null : null;

    syncingFromHistoryRef.current = true;
    setSelectedItemId(nextSelectedItemId);
    setDetailItem(nextDetailItem);
    setActiveView(nextView);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const initialState = isAppHistoryState(window.history.state)
      ? window.history.state
      : initialHistoryStateRef.current;

    historySnapshotRef.current = getAppHistorySnapshot(initialState);
    window.history.replaceState(initialState, "");
    historyReadyRef.current = true;

    const handlePopState = (event) => {
      if (!isAppHistoryState(event.state)) return;
      historySnapshotRef.current = getAppHistorySnapshot(event.state);
      applyHistoryState(event.state);
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [applyHistoryState]);

  useEffect(() => {
    if (typeof window === "undefined" || !historyReadyRef.current) return;

    const nextState = buildAppHistoryState({ activeView, selectedItemId, detailItem });
    const nextSnapshot = getAppHistorySnapshot(nextState);
    if (nextSnapshot === historySnapshotRef.current) {
      syncingFromHistoryRef.current = false;
      return;
    }

    if (syncingFromHistoryRef.current) {
      syncingFromHistoryRef.current = false;
      historySnapshotRef.current = nextSnapshot;
      return;
    }

    window.history.pushState(nextState, "");
    historySnapshotRef.current = nextSnapshot;
  }, [activeView, detailItem, selectedItemId]);

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
  const aiAssistantWrapperClassName = isMobileDevice
    ? "flex w-full max-w-full flex-col items-center gap-3"
    : "flex max-w-[90%] gap-4";
  const aiAssistantAvatarClassName = isMobileDevice
    ? "flex h-14 w-14 items-center justify-center self-center rounded-full bg-primary text-white shadow-lg shadow-primary/20"
    : "flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary shadow-lg shadow-primary/20";
  const aiAssistantContentClassName = isMobileDevice ? "flex w-full flex-col gap-6" : "flex flex-col gap-6";
  const aiAssistantBubbleClassName = isMobileDevice
    ? "chat-bubble-ai w-full max-w-none rounded-bl-[2rem] rounded-br-[2rem] rounded-tr-[2rem] border border-outline-variant/20 px-4 py-5 shadow-sm"
    : "chat-bubble-ai rounded-bl-[2rem] rounded-br-[2rem] rounded-tr-[2rem] border border-outline-variant/20 px-8 py-6 shadow-sm";
  const aiAssistantTextClassName = isMobileDevice
    ? "mb-4 text-base font-semibold leading-relaxed text-on-surface"
    : "mb-4 text-lg font-semibold leading-relaxed text-on-surface";
  const aiRecommendationGridClassName = isMobileDevice
    ? "mt-6 grid grid-cols-1 gap-5"
    : "mt-6 grid grid-cols-1 gap-6 md:grid-cols-2";
  const aiRecommendationCardClassName = isMobileDevice
    ? "w-full overflow-hidden rounded-[1.35rem] border border-outline-variant/10 bg-white text-left shadow-md transition-shadow"
    : "overflow-hidden rounded-xl border border-outline-variant/10 bg-white text-left shadow-sm transition-shadow hover:shadow-md";
  const aiRecommendationImageClassName = isMobileDevice ? "h-64 w-full overflow-hidden" : "h-40 w-full overflow-hidden";
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
  const aiRecommendationBriefClassName = isMobileDevice
    ? "mb-3 text-sm font-black tracking-[0.01em] text-primary"
    : "mb-3 text-xs font-black tracking-[0.01em] text-primary";
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
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationStatus("현재 브라우저에서 위치 정보를 지원하지 않습니다.");
      return Promise.resolve(null);
    }

    if (currentLocation) {
      return Promise.resolve(currentLocation);
    }

    const secureContext = readSecureContext();
    if (!secureContext) {
      setLocationStatus(buildGeolocationErrorMessage(null, { secureContext }));
      return Promise.resolve(null);
    }

    if (locationRequestPromiseRef.current) {
      return locationRequestPromiseRef.current;
    }

    locationRequestPromiseRef.current = (async () => {
      const applyResolvedPosition = (position) => {
        const next = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setCurrentLocation(next);
        setLocationStatus(`위치 확인 완료 · ${next.lat.toFixed(4)}, ${next.lng.toFixed(4)}`);
        return next;
      };

      try {
        setLocationStatus("현재 위치를 확인하는 중입니다...");
        const position = await readCurrentPosition(GEOLOCATION_REQUEST_OPTIONS);
        return applyResolvedPosition(position);
      } catch (error) {
        if (shouldRetryGeolocationRequest(error)) {
          try {
            setLocationStatus("위치 확인이 지연되어 정확도를 낮춰 다시 시도하는 중입니다...");
            const retryPosition = await readCurrentPosition(GEOLOCATION_RETRY_OPTIONS);
            return applyResolvedPosition(retryPosition);
          } catch (retryError) {
            setLocationStatus(buildGeolocationErrorMessage(retryError, { secureContext }));
            return null;
          }
        }

        setLocationStatus(buildGeolocationErrorMessage(error, { secureContext }));
        return null;
      } finally {
        locationRequestPromiseRef.current = null;
      }
    })();

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
    setBooting(sessionQuery.isPending);
  }, [sessionQuery.isPending]);

  useEffect(() => {
    if (!sessionQuery.data) {
      return;
    }

    if (!sessionQuery.data.authenticated) {
      clearSession();
      setBooting(false);
      return;
    }

    setToken(AUTH_SESSION_MARKER);
    setUser(sessionQuery.data.profile.user || null);
    setFavorites(sessionQuery.data.favoritesPayload.favorites || []);
    setHistory(sessionQuery.data.historyPayload.history || []);
    setVisitHistory(sessionQuery.data.visitPayload.visits || []);
    applyPreferencePayload(sessionQuery.data.preferencePayload);
  }, [sessionQuery.data]);

  useEffect(() => {
    if (!sessionQuery.error) {
      return;
    }

    setBooting(false);
    if (token || user) {
      clearSession();
    }
    if (sessionQuery.error?.status === 401) {
      setMessage(buildMessage("error", "로그인 세션이 만료되었습니다. 다시 로그인해 주세요."));
      return;
    }
    setMessage(
      buildMessage(
        "error",
        sessionQuery.error?.status === 401
          ? "로그인 세션이 만료되었습니다. 다시 로그인해 주세요."
          : sessionQuery.error.message,
      ),
    );
  }, [sessionQuery.error, token, user]);

  useEffect(() => {
    if (sessionQuery.data?.authenticated) {
      return;
    }
    let ignore = false;

    const bootstrapGoogleLogin = async () => {
      try {
        await hydrateSupabaseAuthConfig();
        if (ignore || !hasSupabaseAuthConfig()) {
          return;
        }

        const supabase = getSupabaseClient();
        if (!supabase) return;

        const { data, error } = await supabase.auth.getSession();
        if (ignore || error || !isSupabaseGoogleSession(data?.session)) {
          if (!ignore && error) {
            setMessage(buildMessage("error", error.message));
          }
          return;
        }

        if (oauthExchangeTokenRef.current === data.session.access_token) {
          return;
        }

        await exchangeGoogleOAuthSessionRef.current?.(data.session);
      } catch (error) {
        if (!ignore) {
          setMessage(buildMessage("error", error.message));
        }
      }
    };

    bootstrapGoogleLogin();

    return () => {
      ignore = true;
    };
  }, [sessionQuery.data?.authenticated]);

  function clearSession() {
    oauthExchangeTokenRef.current = "";
    setToken("");
    setUser(null);
    setPendingGoogleLink(null);
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

  function handleModeChange(nextMode) {
    setPendingGoogleLink(null);
    setMode(nextMode);
  }

  async function finalizeAuthenticatedSession(responseUser, successMessage) {
    setPendingGoogleLink(null);
    setToken(AUTH_SESSION_MARKER);
    await sessionQuery.refetch();
    setUser(responseUser || null);
    setActiveView("home");
    setMode("login");
    setAuthForm({ name: "", email: "", password: "" });
    setMessage(buildMessage("ok", successMessage));
  }

  async function exchangeGoogleOAuthSession(session) {
    if (!session?.access_token) {
      throw new Error("Google 로그인 세션을 확인하지 못했습니다.");
    }

    oauthExchangeTokenRef.current = session.access_token;
    setAuthLoading(true);
    setMessage(null);

    try {
      const response = await request("/auth/oauth/google", {
        method: "POST",
        body: JSON.stringify({ accessToken: session.access_token }),
      });

      await clearSupabaseBridgeSession(getSupabaseClient());

      if (typeof window !== "undefined") {
        const nextUrl = stripSupabaseAuthParams(window.location.href);
        window.history.replaceState(window.history.state, "", nextUrl);
      }

      await finalizeAuthenticatedSession(response.user || null, "Google 계정으로 로그인했습니다.");
      return;
    } catch (error) {
      oauthExchangeTokenRef.current = "";
      await clearSupabaseBridgeSession(getSupabaseClient());
      if (typeof window !== "undefined") {
        const nextUrl = stripSupabaseAuthParams(window.location.href);
        window.history.replaceState(window.history.state, "", nextUrl);
      }
      if (error?.status === 409) {
        const nextEmail = String(session.user?.email || "").trim();
        setPendingGoogleLink({
          accessToken: session.access_token,
          email: nextEmail,
        });
        setActiveView("auth");
        setMode("login");
        setAuthForm({ name: "", email: nextEmail, password: "" });
        setMessage(
          buildMessage(
            "neutral",
            "기존 이메일/비밀번호 계정이 있어요. 비밀번호를 한 번 입력하면 Google 로그인과 통합됩니다.",
          ),
        );
        return;
      }
      throw error;
    } finally {
      setAuthLoading(false);
    }
  }
  exchangeGoogleOAuthSessionRef.current = exchangeGoogleOAuthSession;

  async function handleSocialLogin(provider) {
    if (provider !== "google") {
      setMessage(buildMessage("neutral", "해당 소셜 로그인은 아직 준비 중입니다."));
      return;
    }

    await hydrateSupabaseAuthConfig();
    if (!hasSupabaseAuthConfig()) {
      setMessage(buildMessage("error", "Supabase Google 로그인 설정이 아직 연결되지 않았습니다."));
      return;
    }

    setAuthLoading(true);
    setMessage(null);

    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: buildSupabaseGoogleRedirectUrl(),
        },
      });

      if (error) {
        throw error;
      }

      if (!data?.url) {
        throw new Error("Google 로그인 화면을 열지 못했습니다.");
      }
    } catch (error) {
      handleRequestError(error);
      setAuthLoading(false);
    }
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setAuthLoading(true);
    setMessage(null);

    try {
      if (mode === "register" && (!agreements.terms || !agreements.privacy)) {
        throw new Error("필수 약관 동의 후 회원가입을 진행해 주세요.");
      }

      const isGoogleLinkMerge = mode === "login" && Boolean(pendingGoogleLink?.accessToken);
      const path = isGoogleLinkMerge
        ? "/auth/oauth/google/merge"
        : mode === "login"
          ? "/auth/login"
          : "/auth/register";
      const payload = isGoogleLinkMerge
        ? {
            accessToken: pendingGoogleLink.accessToken,
            password: authForm.password,
          }
        : mode === "login"
          ? { email: authForm.email, password: authForm.password }
          : authForm;

      const response = await request(path, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      await finalizeAuthenticatedSession(
        response.user || null,
        isGoogleLinkMerge
          ? "Google 계정과 기존 계정을 통합했습니다."
          : mode === "login"
            ? "로그인되었습니다."
            : "회원가입이 완료되었습니다.",
      );
      return;
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
    const { skipChat = false, openNowOnlyOverride } = options;
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
          body: JSON.stringify(
            buildRecommendationRequestBody({
              input: trimmed,
              currentLocation: resolvedCurrentLocation,
              targetView,
              openNowOnly:
                typeof openNowOnlyOverride === "boolean"
                  ? openNowOnlyOverride
                  : openNowOnly,
            }),
          ),
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

  const homePreviewItems = recommendItems.slice(0, isMobileDevice ? 2 : 3);
  const homeLocationReady = maxDistanceEnabled;
  const homeLocationBadgeClassName = homeLocationReady
    ? "bg-[#e7f6ec] text-[#1f6a3a]"
    : "bg-primary-container/30 text-primary";

  function handleHomeNearbyStart() {
    setOpenNowOnly(false);
    runRecommendation("내 주변 맛집 추천", "recommend", {
      skipChat: true,
      openNowOnlyOverride: false,
    });
  }

  function handleHomeAiStart() {
    setOpenNowOnly(false);
    setActiveView("ai");
  }

  function handleHomeOpenNowStart() {
    setOpenNowOnly(true);
    runRecommendation("내 주변 맛집 추천", "ai", {
      openNowOnlyOverride: true,
    });
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
        onChangeMode={handleModeChange}
        onSocialLogin={handleSocialLogin}
        onSubmit={handleAuthSubmit}
        onToggleAgreement={handleToggleAgreement}
        pendingGoogleLink={pendingGoogleLink}
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
          <section className="mb-10 rounded-[2rem] bg-surface-container-low px-6 py-8 shadow-sm md:px-8 md:py-10">
            <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div className="max-w-3xl">
                <span
                  className={`inline-flex rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.18em] ${homeLocationBadgeClassName}`}
                >
                  {homeLocationReady ? "위치 확인됨" : "위치 필요"}
                </span>
                <h1 className="mt-4 font-headline text-4xl font-black leading-tight tracking-tight text-on-surface md:text-6xl">
                  지금 어디서 먹을까?
                </h1>
                <p className="mt-4 text-lg font-medium leading-relaxed text-on-surface-variant md:text-2xl">
                  {homeLocationReady
                    ? "현재 위치와 취향을 반영해 바로 갈 만한 식당을 추천해드려요."
                    : "위치를 허용하면 내 주변 기준으로 더 정확하게 추천해드려요."}
                </p>
                <p className="mt-3 text-sm font-semibold text-on-surface-variant md:text-base">
                  {locationStatus}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  className="rounded-full bg-white px-5 py-3 text-sm font-black text-primary shadow-sm"
                  type="button"
                  onClick={() => requestCurrentLocation()}
                >
                  {homeLocationReady ? "위치 새로고침" : "위치 허용"}
                </button>
                <button
                  className="rounded-full bg-primary px-5 py-3 text-sm font-black text-white shadow-sm"
                  type="button"
                  onClick={handleHomeAiStart}
                >
                  AI 채팅 열기
                </button>
              </div>
            </div>
          </section>

          <section className="mb-12">
            <div className="mb-5">
              <h2 className="font-headline text-3xl font-black text-on-surface md:text-4xl">
                빠르게 시작하기
              </h2>
              <p className="mt-2 text-lg font-medium text-on-surface-variant">
                지금 가장 자주 쓰는 시작 경로만 앞에 두었습니다.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
              <section className="rounded-[1.75rem] bg-white p-6 shadow-sm ring-1 ring-black/5">
                <span className="inline-flex rounded-2xl bg-primary-container/20 p-3 text-primary">
                  <span className="material-symbols-outlined filled-icon text-3xl">near_me</span>
                </span>
                <h3 className="mt-5 text-2xl font-black text-on-surface">내 주변 맛집 추천</h3>
                <p className="mt-3 text-base font-medium leading-relaxed text-on-surface-variant">
                  현재 위치와 이동 거리 기준으로 바로 갈 만한 곳을 추천합니다.
                </p>
                <button
                  className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-black text-white"
                  type="button"
                  onClick={handleHomeNearbyStart}
                >
                  바로 추천받기 <span className="material-symbols-outlined text-lg">arrow_forward</span>
                </button>
              </section>

              <section className="rounded-[1.75rem] bg-white p-6 shadow-sm ring-1 ring-black/5">
                <span className="inline-flex rounded-2xl bg-primary-container/20 p-3 text-primary">
                  <span className="material-symbols-outlined filled-icon text-3xl">smart_toy</span>
                </span>
                <h3 className="mt-5 text-2xl font-black text-on-surface">AI로 조건 말하기</h3>
                <p className="mt-3 text-base font-medium leading-relaxed text-on-surface-variant">
                  음식, 분위기, 예산을 자연어로 말하면 조건을 바로 조합해 줍니다.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-black text-white"
                    type="button"
                    onClick={handleHomeAiStart}
                  >
                    채팅으로 시작 <span className="material-symbols-outlined text-lg">chat</span>
                  </button>
                  <button
                    className="inline-flex items-center gap-2 rounded-full bg-secondary-container px-5 py-3 text-sm font-black text-on-secondary-container"
                    type="button"
                    onClick={() => startVoiceSearch("ai")}
                  >
                    {voiceListening ? "듣는 중..." : "음성으로 시작"}
                    <span className="material-symbols-outlined text-lg">
                      {voiceListening ? "graphic_eq" : "mic"}
                    </span>
                  </button>
                </div>
              </section>

              <section className="rounded-[1.75rem] bg-white p-6 shadow-sm ring-1 ring-black/5">
                <span className="inline-flex rounded-2xl bg-primary-container/20 p-3 text-primary">
                  <span className="material-symbols-outlined filled-icon text-3xl">schedule</span>
                </span>
                <h3 className="mt-5 text-2xl font-black text-on-surface">영업 중인 곳만</h3>
                <p className="mt-3 text-base font-medium leading-relaxed text-on-surface-variant">
                  지금 실제로 열려 있는 곳만 먼저 추려서 빠르게 확인합니다.
                </p>
                <button
                  className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-black text-white"
                  type="button"
                  onClick={handleHomeOpenNowStart}
                >
                  영업 중만 보기 <span className="material-symbols-outlined text-lg">restaurant</span>
                </button>
              </section>
            </div>
          </section>

          <section className="mb-12">
            <div className="mb-4">
              <h2 className="font-headline text-3xl font-black text-on-surface md:text-4xl">
                이런 상황인가요?
              </h2>
              <p className="mt-2 text-lg font-medium text-on-surface-variant">
                자주 찾는 상황을 눌러 바로 추천을 시작하세요.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {[
                { label: "혼밥", prompt: "혼밥하기 좋은 맛집 추천" },
                { label: "데이트", prompt: "데이트하기 좋은 맛집 추천" },
                { label: "조용한 곳", prompt: "조용한 식당 추천" },
                { label: "가성비", prompt: "가성비 좋은 맛집 추천" },
                { label: "가까운 곳", prompt: "내 주변 가까운 맛집 추천" },
                { label: "영업 중", prompt: "내 주변 맛집 추천", openNowOnly: true },
              ].map((chip) => (
                <button
                  key={chip.label}
                  className="rounded-full border border-outline-variant/20 bg-white px-5 py-3 text-sm font-black text-on-surface-variant shadow-sm transition-colors hover:bg-primary hover:text-white"
                  type="button"
                  onClick={() => {
                    if (chip.openNowOnly) {
                      handleHomeOpenNowStart();
                      return;
                    }
                    setOpenNowOnly(false);
                    runRecommendation(chip.prompt, "ai", { openNowOnlyOverride: false });
                  }}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </section>

          <section className="mb-12">
            <div className="mb-6 flex items-end justify-between">
              <div>
                <h2 className="font-headline text-3xl font-black text-on-surface md:text-4xl">
                  지금 갈 만한 곳
                </h2>
                <p className="mt-2 text-lg font-medium text-on-surface-variant">
                  현재 위치와 취향을 반영해 바로 결정할 수 있는 추천만 먼저 보여드립니다.
                </p>
              </div>
              <button
                className="hidden items-center gap-2 text-lg font-extrabold text-primary md:flex"
                type="button"
                onClick={() => setActiveView("recommend")}
              >
                추천 탭 열기 <span className="material-symbols-outlined">chevron_right</span>
              </button>
            </div>

            {recommendItems.length ? (
              <div className={`grid grid-cols-1 gap-8 ${isMobileDevice ? "" : "md:grid-cols-3"}`}>
                {homePreviewItems.map((item) => (
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
              <RecommendationLoadingGrid columns={isMobileDevice ? 2 : 3} />
            ) : recommendationFeedbackState === "empty" ? (
              <RecommendationEmptyState
                description="거리와 취향 조건을 조금 바꿔 다시 추천을 받아보세요."
                title="조건에 맞는 추천 식당이 아직 없습니다."
              />
            ) : (
              <div className="rounded-[1.75rem] bg-surface-container-low p-6 shadow-sm">
                <p className="text-base font-semibold text-on-surface-variant">
                  아직 추천을 시작하지 않았습니다. 빠른 시작 카드나 상황형 칩으로 바로 시작해 보세요.
                </p>
              </div>
            )}
          </section>

          {recentQuestions.length ? (
            <section className="pb-4">
              <div className="mb-4 flex items-end justify-between">
                <div>
                  <h2 className="font-headline text-3xl font-black text-on-surface md:text-4xl">
                    최근 질문 이어서
                  </h2>
                  <p className="mt-2 text-lg font-medium text-on-surface-variant">
                    최근에 찾던 조건을 다시 불러와 빠르게 이어갈 수 있습니다.
                  </p>
                </div>
                <button
                  className="hidden items-center gap-2 text-lg font-extrabold text-primary md:flex"
                  type="button"
                  onClick={() => setActiveView("ai")}
                >
                  AI 탭 열기 <span className="material-symbols-outlined">chevron_right</span>
                </button>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {recentQuestions.map((entry) => (
                  <button
                    key={`home-recent-${entry.id}`}
                    className="rounded-[1.4rem] bg-white p-5 text-left shadow-sm ring-1 ring-black/5 transition-colors hover:bg-primary hover:text-white"
                    type="button"
                    onClick={() => {
                      setOpenNowOnly(false);
                      runRecommendation(entry.query, "ai", { openNowOnlyOverride: false });
                    }}
                  >
                    <p className="text-base font-black">{entry.query}</p>
                    <span className="mt-3 block text-sm font-semibold opacity-80">
                      {formatRelativeDate(entry.createdAt, "recently")}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
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
                      <div className={aiAssistantContentClassName}>
                        <div className={aiAssistantBubbleClassName}>
                          <p className={aiAssistantTextClassName}>{entry.text}</p>
                          {entry.items?.length ? (
                            <div className={aiRecommendationGridClassName}>
                              {entry.items.map((item) => {
                                const decisionBrief = buildRecommendationDecisionBrief(item);

                                return (
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
                                      {decisionBrief ? (
                                        <p className={aiRecommendationBriefClassName}>{decisionBrief}</p>
                                      ) : null}
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
                                );
                              })}
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
              <div className="mb-3 flex items-center justify-between rounded-[1.2rem] border border-outline-variant/20 bg-surface-container-low px-4 py-3">
                <div>
                  <p className="text-sm font-black text-on-surface">영업 중만 보기</p>
                  <p className="text-xs text-on-surface-variant">
                    AI 채팅 추천에서 현재 영업 중인 곳만 우선 보여줍니다.
                  </p>
                </div>
                <button
                  aria-pressed={openNowOnly}
                  className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                    openNowOnly ? "bg-primary" : "bg-outline-variant/40"
                  }`}
                  type="button"
                  onClick={() => setOpenNowOnly((current) => !current)}
                >
                  <span
                    className={`inline-block h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${
                      openNowOnly ? "translate-x-7" : "translate-x-1"
                    }`}
                  />
                  <span className="sr-only">영업 중만 보기 토글</span>
                </button>
              </div>
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
                <Suspense fallback={<MapPreviewFallback />}>
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
                </Suspense>
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
        <Suspense fallback={<MapPageFallback isMobileDevice={isMobileDevice} />}>
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
        </Suspense>
      ) : null}

      {false ? (
        <main className="page-fade h-[calc(100vh-5rem)] w-full pt-20">
          <div className="route-canvas route-canvas--fullscreen relative h-full overflow-hidden">
            {mapSelectedItem ? (
              <Suspense fallback={null}>
                <GoogleRouteMap
                  currentLocation={currentLocation}
                  item={mapSelectedItem}
                  items={mapItems}
                  onSelectItem={(itemId) => selectMapItem(itemId, "map")}
                  selectionSource={mapSelectionSource}
                  routeMode={routeMode}
                  onRouteInfoChange={setRouteUi}
                />
              </Suspense>
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
