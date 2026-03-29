import { useEffect, useRef, useState } from "react";
import { ensureGoogleMapsLoaded } from "./googleMapsLoader";

const GOOGLE_MAPS_API_KEY = import.meta.env.REACT_APP_GOOGLE_MAPS_API_KEY?.trim();
const GOOGLE_MAP_ID =
  import.meta.env.REACT_APP_GOOGLE_MAPS_MAP_ID?.trim() || "DEMO_MAP_ID";

function parseDestination(item) {
  const fallbackLabel = item?.name || "restaurant";
  const result = { label: fallbackLabel, position: null };

  if (Number.isFinite(item?.location?.lat) && Number.isFinite(item?.location?.lng)) {
    result.position = {
      lat: Number(item.location.lat),
      lng: Number(item.location.lng),
    };
  }

  try {
    const url = item?.links?.googleMap ? new URL(item.links.googleMap) : null;
    const query = url?.searchParams.get("query") || fallbackLabel;
    result.label = query;

    const coords = query.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
    if (!result.position && coords) {
      result.position = {
        lat: Number(coords[1]),
        lng: Number(coords[2]),
      };
    }
  } catch {
    result.label = fallbackLabel;
  }

  return result;
}

function buildDestinationEntries(items) {
  return items
    .map((entry) => {
      const destination = parseDestination(entry);
      return {
        item: entry,
        label: destination.label,
        position: destination.position,
      };
    })
    .filter((entry) => entry.position || entry.label);
}

function fitBounds(map, maps, points) {
  const bounds = new maps.LatLngBounds();
  points.forEach((point) => bounds.extend(point));
  map.fitBounds(bounds, 96);
}

function readAdvancedMarkerAvailability(map) {
  const capabilities = map.getMapCapabilities?.();
  if (!capabilities || typeof capabilities.isAdvancedMarkersAvailable !== "boolean") {
    return null;
  }

  return capabilities.isAdvancedMarkersAvailable;
}

function normalizeTravelMode(mode, maps) {
  if (mode === "WALKING") return maps.TravelMode.WALKING;
  if (mode === "TRANSIT") return maps.TravelMode.TRANSIT;
  return maps.TravelMode.DRIVING;
}

function getRouteModeLabel(mode) {
  if (mode === "WALKING") return "도보";
  if (mode === "TRANSIT") return "대중교통";
  return "자동차";
}

function buildIdleRouteInfo(routeMode, item) {
  return {
    mode: routeMode,
    status: "idle",
    distanceText:
      item?.distanceKm != null ? `${Number(item.distanceKm).toFixed(1)}km` : "",
    durationText: item?.travelDuration || "",
    summary: item?.routeSummary || "",
    steps: [],
    message: "현재 위치를 허용하면 웹 안에서 경로를 표시합니다.",
  };
}

function stripInstructionMarkup(text) {
  if (!text) return "";
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function formatTransitTime(value) {
  if (!value) return "";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function buildRouteSummary(route, routeMode, fallbackItem) {
  const firstLeg = route?.legs?.[0];

  if (routeMode === "TRANSIT") {
    const segmentSummary = firstLeg?.stepsOverview?.multiModalSegments
      ?.map((segment) => stripInstructionMarkup(segment.instructions))
      .filter(Boolean)
      .slice(0, 2)
      .join(" · ");

    if (segmentSummary) {
      return segmentSummary;
    }
  }

  const stepSummary = firstLeg?.steps
    ?.map((step) => stripInstructionMarkup(step.instructions))
    .filter(Boolean)
    .slice(0, 2)
    .join(" · ");

  if (stepSummary) {
    return stepSummary;
  }

  if (Array.isArray(route?.warnings) && route.warnings.length) {
    return route.warnings.join(" · ");
  }

  return fallbackItem?.routeSummary || "웹 안 길찾기 경로를 표시 중입니다.";
}

function buildRouteSteps(route) {
  const firstLeg = route?.legs?.[0];

  const routeSteps = (firstLeg?.steps || [])
    .map((step, index) => {
      const instruction = stripInstructionMarkup(step.instructions);
      const transitDetails = step.transitDetails;
      const transitLine = transitDetails?.transitLine;
      const transitLineLabel =
        transitLine?.shortName || transitDetails?.tripShortText || transitLine?.name || "";
      const departureStopName = transitDetails?.departureStop?.name || "";
      const arrivalStopName = transitDetails?.arrivalStop?.name || "";

      if (!instruction) {
        return null;
      }

      return {
        id: `${index}-${instruction}`,
        instruction,
        distanceText: step.localizedValues?.distance || "",
        durationText: step.localizedValues?.duration || "",
        transitLineLabel,
        transitHeadsign: transitDetails?.headsign || "",
        departureStopName,
        arrivalStopName,
        departureTimeText: formatTransitTime(transitDetails?.departureTime),
        arrivalTimeText: formatTransitTime(transitDetails?.arrivalTime),
        stopCountText: Number.isFinite(transitDetails?.stopCount)
          ? `${transitDetails.stopCount}개 정류장 이동`
          : "",
      };
    })
    .filter(Boolean);

  if (routeSteps.length) {
    return routeSteps;
  }

  return (firstLeg?.stepsOverview?.multiModalSegments || [])
    .map((segment, index) => {
      const instruction = stripInstructionMarkup(segment.instructions);

      if (!instruction) {
        return null;
      }

      return {
        id: `segment-${index}-${instruction}`,
        instruction,
        distanceText: "",
        durationText: "",
      };
    })
    .filter(Boolean);
}

export default function GoogleRouteMap({
  item,
  items = [],
  currentLocation,
  onSelectItem,
  selectionSource = "panel",
  routeMode = "DRIVING",
  onRouteInfoChange,
}) {
  const containerRef = useRef(null);
  const initialItemRef = useRef(item);
  const initialLocationRef = useRef(currentLocation);
  const viewportInitializedRef = useRef(false);
  const routeRequestIdRef = useRef(0);
  const onSelectItemRef = useRef(onSelectItem);
  const onRouteInfoChangeRef = useRef(onRouteInfoChange);
  const mapRef = useRef(null);
  const mapsRef = useRef(null);
  const routeClassRef = useRef(null);
  const markerClassesRef = useRef(null);
  const routeInfoSignatureRef = useRef("");
  const capabilitiesListenerRef = useRef(null);
  const markerListenersRef = useRef([]);
  const markersRef = useRef([]);
  const polylinesRef = useRef([]);
  const [error, setError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [advancedMarkersAvailable, setAdvancedMarkersAvailable] = useState(null);

  useEffect(() => {
    onSelectItemRef.current = onSelectItem;
  }, [onSelectItem]);

  useEffect(() => {
    onRouteInfoChangeRef.current = onRouteInfoChange;
  }, [onRouteInfoChange]);

  function emitRouteInfo(nextInfo) {
    const signature = JSON.stringify([
      nextInfo?.mode || "",
      nextInfo?.status || "",
      nextInfo?.distanceText || "",
      nextInfo?.durationText || "",
      nextInfo?.summary || "",
      nextInfo?.message || "",
      nextInfo?.steps || [],
    ]);

    if (routeInfoSignatureRef.current === signature) {
      return;
    }

    routeInfoSignatureRef.current = signature;
    onRouteInfoChangeRef.current?.(nextInfo);
  }

  useEffect(() => {
    let cancelled = false;

    async function initMap() {
      const initialItem = initialItemRef.current;
      const initialLocation = initialLocationRef.current;

      if (!containerRef.current || mapRef.current || !initialItem) return;
      if (!GOOGLE_MAPS_API_KEY) {
        setError("프론트 Google Maps API 키가 없어 실제 지도를 표시할 수 없습니다.");
        return;
      }

      try {
        setError("");
        const maps = await ensureGoogleMapsLoaded(GOOGLE_MAPS_API_KEY);
        const { Map } = await maps.importLibrary("maps");
        const routesLibrary = await maps.importLibrary("routes");
        const markerClasses = await maps.importLibrary("marker");

        if (cancelled) return;

        const destination = parseDestination(initialItem);
        const center =
          destination.position || initialLocation || { lat: 37.5665, lng: 126.978 };

        const map = new Map(containerRef.current, {
          center,
          zoom: destination.position ? 15 : 13,
          mapId: GOOGLE_MAP_ID,
          disableDefaultUI: true,
          zoomControl: true,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
        });

        mapRef.current = map;
        mapsRef.current = maps;
        routeClassRef.current = routesLibrary.Route;
        markerClassesRef.current = markerClasses;
        setAdvancedMarkersAvailable(readAdvancedMarkerAvailability(map));

        capabilitiesListenerRef.current = map.addListener?.(
          "mapcapabilities_changed",
          () => {
            setAdvancedMarkersAvailable(readAdvancedMarkerAvailability(map));
          },
        );

        setMapReady(true);
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError.message || "Google Maps JavaScript API를 불러오지 못했습니다.");
        }
      }
    }

    initMap();

    return () => {
      cancelled = true;
      capabilitiesListenerRef.current?.remove?.();
      capabilitiesListenerRef.current = null;
      markerListenersRef.current.forEach((listener) => listener?.remove?.());
      markerListenersRef.current = [];
      markersRef.current.forEach((marker) => {
        marker.map = null;
      });
      markersRef.current = [];
      polylinesRef.current.forEach((polyline) => polyline.setMap(null));
      polylinesRef.current = [];
      viewportInitializedRef.current = false;
      routeInfoSignatureRef.current = "";
      mapRef.current = null;
      mapsRef.current = null;
      routeClassRef.current = null;
      markerClassesRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    if (
      !mapReady ||
      !mapRef.current ||
      !mapsRef.current ||
      !routeClassRef.current ||
      !markerClassesRef.current ||
      !item
    ) {
      return;
    }

    const map = mapRef.current;
    const maps = mapsRef.current;
    const Route = routeClassRef.current;
    const { AdvancedMarkerElement, PinElement } = markerClassesRef.current;
    const routeRequestId = ++routeRequestIdRef.current;

    markerListenersRef.current.forEach((listener) => listener?.remove?.());
    markerListenersRef.current = [];
    markersRef.current.forEach((marker) => {
      marker.map = null;
    });
    markersRef.current = [];
    polylinesRef.current.forEach((polyline) => polyline.setMap(null));
    polylinesRef.current = [];

    const destinationEntries = buildDestinationEntries(items);
    const selectedDestination =
      destinationEntries.find((entry) => entry.item.id === item.id) ||
      destinationEntries[0] || {
        item,
        ...parseDestination(item),
      };

    const center =
      selectedDestination.position || currentLocation || { lat: 37.5665, lng: 126.978 };

    if (advancedMarkersAvailable === false) {
      setError("현재 지도 ID에서 고급 마커를 사용할 수 없습니다. 지도 ID를 확인해 주세요.");
      emitRouteInfo({
        mode: routeMode,
        status: "error",
        distanceText: "",
        durationText: "",
        summary: "",
        steps: [],
        message: "고급 마커를 사용할 수 없어 웹 안 길찾기를 표시하지 못했습니다.",
      });
      return;
    }

    if (advancedMarkersAvailable === true) {
      destinationEntries.forEach((entry) => {
        const isSelected = entry.item.id === item.id;
        const pin = new PinElement({
          background: isSelected ? "#944a00" : "#fff8f1",
          borderColor: isSelected ? "#944a00" : "#d9a066",
          glyphColor: isSelected ? "#ffffff" : "#944a00",
          scale: isSelected ? 1.18 : 1,
        });

        const marker = new AdvancedMarkerElement({
          map,
          position: entry.position || center,
          title: entry.item.name,
          content: pin,
          gmpClickable: true,
          zIndex: isSelected ? 200 : 100,
        });

        const selectEntry = () => {
          onSelectItemRef.current?.(entry.item.id);
        };

        if (typeof marker.addEventListener === "function") {
          marker.addEventListener("gmp-click", selectEntry);
          markerListenersRef.current.push({
            remove: () => marker.removeEventListener("gmp-click", selectEntry),
          });
        }

        markersRef.current.push(marker);
      });

      if (currentLocation) {
        const currentPin = new PinElement({
          background: "#1d4ed8",
          borderColor: "#1e40af",
          glyphColor: "#ffffff",
          scale: 1,
        });

        markersRef.current.push(
          new AdvancedMarkerElement({
            map,
            position: currentLocation,
            title: "현재 위치",
            content: currentPin,
            zIndex: 300,
          }),
        );
      }
    }

    const boundPoints = destinationEntries
      .map((entry) => entry.position)
      .filter(Boolean);

    if (currentLocation) {
      boundPoints.push(currentLocation);
    }

    if (!currentLocation) {
      emitRouteInfo(buildIdleRouteInfo(routeMode, selectedDestination.item));

      if (!viewportInitializedRef.current && boundPoints.length > 1) {
        fitBounds(map, maps, boundPoints);
        viewportInitializedRef.current = true;
      } else if (selectedDestination.position && selectionSource === "panel") {
        map.panTo(selectedDestination.position);
        if (!viewportInitializedRef.current) {
          map.setZoom(15);
          viewportInitializedRef.current = true;
        }
      }

      setError("");
      return;
    }

    const preserveViewport = viewportInitializedRef.current;
    emitRouteInfo({
      mode: routeMode,
      status: "loading",
      distanceText: "",
      durationText: "",
      summary: "",
      steps: [],
      message: "경로를 계산하는 중입니다.",
    });

    const request = {
      origin: currentLocation,
      destination: selectedDestination.position || selectedDestination.label,
      travelMode: normalizeTravelMode(routeMode, maps),
      fields: ["path", "viewport", "localizedValues", "warnings", "legs"],
      ...(routeMode === "TRANSIT" ? { departureTime: new Date() } : {}),
    };

    Route.computeRoutes(request)
      .then(({ routes }) => {
        if (routeRequestId !== routeRequestIdRef.current) return;

        const route = routes?.[0];
        if (!route) {
          throw new Error("No route returned.");
        }

        const polylines = route.createPolylines({
          polylineOptions: {
            strokeColor: "#944a00",
            strokeOpacity: 0.95,
            strokeWeight: 6,
          },
        });
        polylines.forEach((polyline) => polyline.setMap(map));
        polylinesRef.current = polylines;

        if (!preserveViewport && route.viewport) {
          map.fitBounds(route.viewport, 96);
          viewportInitializedRef.current = true;
        } else if (selectionSource === "panel" && selectedDestination.position) {
          map.panTo(selectedDestination.position);
        }

        setError("");
        emitRouteInfo({
          mode: routeMode,
          status: "ready",
          distanceText:
            route.localizedValues?.distance || route.legs?.[0]?.localizedValues?.distance || "",
          durationText:
            route.localizedValues?.duration || route.legs?.[0]?.localizedValues?.duration || "",
          summary: buildRouteSummary(route, routeMode, selectedDestination.item),
          steps: buildRouteSteps(route),
          message: "웹 안 길찾기 경로를 표시 중입니다.",
        });
      })
      .catch((nextError) => {
        if (routeRequestId !== routeRequestIdRef.current) return;

        if (selectionSource === "panel" && selectedDestination.position) {
          map.panTo(selectedDestination.position);
        } else if (!preserveViewport && boundPoints.length > 1) {
          fitBounds(map, maps, boundPoints);
          viewportInitializedRef.current = true;
        } else if (!preserveViewport && selectedDestination.position) {
          map.panTo(selectedDestination.position);
          viewportInitializedRef.current = true;
        }

        setError("");
        const fallbackMessage =
          `${getRouteModeLabel(routeMode)} 경로를 찾지 못해 지도와 마커만 표시 중입니다.`;
        emitRouteInfo({
          mode: routeMode,
          status: "fallback",
          distanceText:
            selectedDestination.item.distanceKm != null
              ? `${Number(selectedDestination.item.distanceKm).toFixed(1)}km`
              : "",
          durationText: "",
          summary: fallbackMessage,
          steps: [],
          message: nextError?.message || fallbackMessage,
        });
      });
  }, [
    advancedMarkersAvailable,
    currentLocation,
    item,
    items,
    mapReady,
    routeMode,
    selectionSource,
  ]);

  return (
    <>
      <div className="route-canvas__map-root" ref={containerRef} />
      {error ? (
        <div className="absolute inset-x-8 bottom-8 z-20 rounded-[1rem] bg-error-container px-4 py-3 text-sm font-semibold text-on-error-container shadow-lg">
          {error}
        </div>
      ) : null}
    </>
  );
}
