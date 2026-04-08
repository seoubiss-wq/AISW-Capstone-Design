import { useEffect, useMemo, useState } from "react";
import GoogleRouteMap from "./GoogleRouteMap";

function getRouteModeLabel(routeModeOptions, routeMode) {
  return routeModeOptions.find((option) => option.id === routeMode)?.label || routeMode;
}

function getStatusTone(status) {
  if (status === "ready") {
    return {
      chip: "bg-emerald-100 text-emerald-700",
      panel: "from-emerald-100/80 to-transparent",
      title: "경로 확인 완료",
    };
  }

  if (status === "loading") {
    return {
      chip: "bg-amber-100 text-amber-700",
      panel: "from-amber-100/80 to-transparent",
      title: "경로 계산 중",
    };
  }

  if (status === "fallback") {
    return {
      chip: "bg-sky-100 text-sky-700",
      panel: "from-sky-100/80 to-transparent",
      title: "대체 안내",
    };
  }

  if (status === "error") {
    return {
      chip: "bg-rose-100 text-rose-700",
      panel: "from-rose-100/80 to-transparent",
      title: "경로 오류",
    };
  }

  return {
    chip: "bg-stone-200 text-stone-700",
    panel: "from-stone-200/80 to-transparent",
    title: "길 안내 대기",
  };
}

function getStepVisual(step) {
  if (step.transitLineLabel) {
    return {
      icon: "directions_bus",
      accent: "bg-[#a7edff] text-[#004854]",
    };
  }

  if (/(도보|walk|걸어|보행)/i.test(step.instruction || "")) {
    return {
      icon: "directions_walk",
      accent: "bg-[#ffdbd0] text-[#5d4037]",
    };
  }

  return {
    icon: "near_me",
    accent: "bg-[#ffdcc5] text-[#713700]",
  };
}

function LargeMetaCard({ icon, label, value, tone = "secondary" }) {
  const toneClass =
    tone === "primary"
      ? "bg-primary-container text-on-primary-container"
      : "bg-secondary-container text-on-secondary-container";

  return (
    <div className="flex items-start gap-4 rounded-[1.7rem] bg-surface-container-low px-5 py-5">
      <div className={`mt-0.5 flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${toneClass}`}>
        <span className="material-symbols-outlined filled-icon text-[1.7rem]">{icon}</span>
      </div>
      <div className="min-w-0">
        <p className="text-sm font-black tracking-[0.08em] text-on-surface-variant">{label}</p>
        <p className="mt-2 text-[1.08rem] font-semibold leading-relaxed text-on-surface">{value}</p>
      </div>
    </div>
  );
}

function RouteStepCard({ step, index }) {
  const visual = getStepVisual(step);

  return (
    <article className="rounded-[1.65rem] border border-outline-variant/20 bg-surface-container-lowest px-5 py-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-[1.1rem] ${visual.accent}`}>
          <span className="material-symbols-outlined text-[1.7rem]">{visual.icon}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-black tracking-[0.08em] text-on-surface-variant">
                {index + 1}단계
              </p>
              <p className="mt-2 text-[1.1rem] font-semibold leading-relaxed text-on-surface">
                {step.instruction}
              </p>
            </div>
            {step.distanceText || step.durationText ? (
              <div className="flex shrink-0 flex-col items-end gap-2">
                {step.distanceText ? (
                  <span className="rounded-full bg-white px-3 py-1.5 text-sm font-black text-on-surface-variant shadow-sm">
                    {step.distanceText}
                  </span>
                ) : null}
                {step.durationText ? (
                  <span className="rounded-full bg-white px-3 py-1.5 text-sm font-black text-on-surface-variant shadow-sm">
                    {step.durationText}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          {step.transitLineLabel || step.transitHeadsign ? (
            <div className="mt-4 inline-flex max-w-full rounded-full bg-primary-container px-4 py-2 text-sm font-black text-on-primary-container">
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
            <div className="mt-4 rounded-[1.1rem] bg-white px-4 py-3.5 text-base font-bold leading-relaxed text-on-surface-variant shadow-sm">
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
        </div>
      </div>
    </article>
  );
}

export default function MapDirectionsPage({
  mapSelectedItem,
  mapItems,
  currentLocation,
  isMobileDevice = false,
  mapSelectionSource,
  routeMode,
  routeModeOptions,
  routeSteps,
  routeUi,
  routeDistanceLabel,
  routeDurationLabel,
  routeSummaryLabel,
  locationStatus,
  onBack,
  autoOpenDirectionsSignal,
  onSelectItem,
  onRouteInfoChange,
  onRouteModeChange,
  onRefreshLocation,
  onOpenExternal,
  onOpenItem,
  onStartDirections,
  onRetry,
}) {
  const [directionsOpen, setDirectionsOpen] = useState(false);
  const [mobilePanelCollapsed, setMobilePanelCollapsed] = useState(false);
  const [lastAutoOpenSignal, setLastAutoOpenSignal] = useState(0);

  useEffect(() => {
    setDirectionsOpen(false);
    setMobilePanelCollapsed(false);
  }, [mapSelectedItem?.id]);

  useEffect(() => {
    setMobilePanelCollapsed(false);
  }, [directionsOpen]);

  useEffect(() => {
    if (!autoOpenDirectionsSignal || !mapSelectedItem) {
      return;
    }
    if (autoOpenDirectionsSignal === lastAutoOpenSignal) {
      return;
    }
    setLastAutoOpenSignal(autoOpenDirectionsSignal);
    setDirectionsOpen(true);
    onStartDirections?.(mapSelectedItem);
  }, [autoOpenDirectionsSignal, lastAutoOpenSignal, mapSelectedItem, onStartDirections]);

  const activeRouteModeLabel = getRouteModeLabel(routeModeOptions, routeMode);
  const steps = routeSteps?.length ? routeSteps : routeUi?.steps || [];
  const otherPicks = useMemo(() => mapItems.slice(0, 8), [mapItems]);
  const statusTone = getStatusTone(routeUi?.status);
  const emptyMainClassName = isMobileDevice
    ? "page-fade min-h-[calc(100vh-4rem)] w-full pb-24 pt-16"
    : "page-fade h-[calc(100vh-5rem)] w-full pt-20";
  const mainClassName = isMobileDevice
    ? "page-fade min-h-[calc(100vh-4rem)] w-full pb-24 pt-16"
    : "page-fade h-[calc(100vh-5rem)] w-full pt-20";
  const backButtonClassName = isMobileDevice
    ? "absolute left-4 top-4 z-30 flex items-center gap-2 rounded-full bg-white/92 px-4 py-2.5 text-sm font-black text-primary shadow-lg ring-1 ring-black/5 backdrop-blur"
    : "absolute left-6 top-6 z-30 flex items-center gap-2 rounded-full bg-white/92 px-5 py-3 text-base font-black text-primary shadow-lg ring-1 ring-black/5 backdrop-blur";
  const emptyBackButtonClassName = isMobileDevice
    ? "absolute left-4 top-4 z-20 flex items-center gap-2 rounded-full bg-white/92 px-4 py-2.5 text-sm font-black text-primary shadow-lg ring-1 ring-black/5 backdrop-blur"
    : "absolute left-6 top-6 z-20 flex items-center gap-2 rounded-full bg-white/92 px-5 py-3 text-base font-black text-primary shadow-lg ring-1 ring-black/5 backdrop-blur";
  const emptyOverlayClassName = isMobileDevice
    ? "absolute inset-0 z-10 flex items-center justify-center p-4"
    : "absolute inset-0 z-10 flex items-center justify-center p-6";
  const emptyCardClassName = isMobileDevice
    ? "w-full max-w-2xl rounded-[1.75rem] bg-white/96 p-6 text-center shadow-[0_24px_64px_rgba(0,0,0,0.12)] ring-1 ring-black/5 backdrop-blur"
    : "w-full max-w-2xl rounded-[2.2rem] bg-white/96 p-10 text-center shadow-[0_24px_64px_rgba(0,0,0,0.12)] ring-1 ring-black/5 backdrop-blur";
  const emptyTitleClassName = isMobileDevice
    ? "mt-4 font-headline text-3xl font-black leading-tight text-on-surface"
    : "mt-4 font-headline text-5xl font-black leading-tight text-on-surface";
  const emptyBodyClassName = isMobileDevice
    ? "mt-5 text-base font-medium leading-relaxed text-on-surface-variant"
    : "mt-5 text-xl font-medium leading-relaxed text-on-surface-variant";
  const emptyActionsClassName = isMobileDevice
    ? "mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center"
    : "mt-8 flex justify-center gap-3";
  const mobilePanelTransformClassName =
    isMobileDevice && mobilePanelCollapsed ? "translate-y-[calc(100%-5.25rem)]" : "translate-y-0";
  const leftPanelClassName = isMobileDevice
    ? `route-panel-scroll absolute inset-x-3 bottom-3 top-auto z-20 max-h-[58vh] overflow-y-auto rounded-[1.75rem] bg-white/95 p-4 shadow-[0_30px_70px_rgba(0,0,0,0.16)] ring-1 ring-black/5 backdrop-blur transition-transform duration-300 ease-out ${mobilePanelTransformClassName}`
    : "route-panel-scroll absolute bottom-4 left-4 top-20 z-20 w-[480px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-[2.2rem] bg-white/95 p-6 shadow-[0_30px_70px_rgba(0,0,0,0.16)] ring-1 ring-black/5 backdrop-blur xl:w-[540px]";
  const rightPanelClassName = isMobileDevice
    ? `route-panel-scroll absolute inset-x-3 bottom-3 top-auto z-20 max-h-[62vh] overflow-y-auto rounded-[1.75rem] bg-white/95 p-4 shadow-[0_30px_70px_rgba(0,0,0,0.16)] ring-1 ring-black/5 backdrop-blur transition-transform duration-300 ease-out ${mobilePanelTransformClassName}`
    : "route-panel-scroll absolute bottom-4 right-4 top-20 z-20 w-[470px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-[2.2rem] bg-white/95 p-6 shadow-[0_30px_70px_rgba(0,0,0,0.16)] ring-1 ring-black/5 backdrop-blur xl:w-[530px]";
  const heroImageClassName = isMobileDevice ? "relative h-52" : "relative h-64";
  const restaurantTitleClassName = isMobileDevice
    ? "mt-3 font-headline text-[2rem] font-black leading-tight text-on-surface"
    : "mt-3 font-headline text-[2.6rem] font-black leading-tight text-on-surface";
  const actionGridClassName = isMobileDevice ? "grid grid-cols-1 gap-4 sm:grid-cols-2" : "grid grid-cols-2 gap-4";
  const routeTitleClassName = isMobileDevice
    ? "mt-2 font-headline text-[2rem] font-black leading-none text-on-surface"
    : "mt-2 font-headline text-[2.45rem] font-black leading-none text-on-surface";
  const routeMetricGridClassName = isMobileDevice
    ? "mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2"
    : "mt-5 grid grid-cols-2 gap-4";

  if (!mapSelectedItem) {
    return (
      <main className={emptyMainClassName}>
        <div className="route-canvas route-canvas--fullscreen relative h-full overflow-hidden bg-surface-container-low">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,146,56,0.16),_transparent_45%),linear-gradient(180deg,_rgba(252,249,248,0.98),_rgba(252,249,248,0.94))]" />
          <button
            className={emptyBackButtonClassName}
            type="button"
            onClick={onBack}
          >
            <span className="material-symbols-outlined text-[1.5rem]">arrow_back</span>
            추천 목록으로
          </button>

          <div className={emptyOverlayClassName}>
            <div className={emptyCardClassName}>
              <p className="text-base font-black tracking-[0.18em] text-primary">Map directions</p>
              <h1 className={emptyTitleClassName}>
                주변 맛집을 불러오는 중입니다
              </h1>
              <p className={emptyBodyClassName}>
                지도에 표시할 식당이 아직 없습니다. 현재 위치 기준 추천을 다시 받아오면
                실제 식당과 길안내를 바로 확인할 수 있습니다.
              </p>
              <div className={emptyActionsClassName}>
                <button
                  className="rounded-[1.35rem] bg-primary px-6 py-5 text-lg font-black text-white shadow-[0_18px_40px_rgba(148,74,0,0.22)]"
                  type="button"
                  onClick={onRetry}
                >
                  주변 맛집 다시 찾기
                </button>
                <button
                  className="rounded-[1.35rem] bg-secondary-container px-6 py-5 text-lg font-black text-on-secondary-container"
                  type="button"
                  onClick={onBack}
                >
                  추천 화면으로
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={mainClassName}>
      <div className="route-canvas route-canvas--fullscreen relative h-full overflow-hidden bg-surface">
        <GoogleRouteMap
          currentLocation={currentLocation}
          item={mapSelectedItem}
          items={mapItems}
          onRouteInfoChange={onRouteInfoChange}
          onSelectItem={(itemId) => onSelectItem(itemId, "map")}
          routeMode={routeMode}
          selectionSource={mapSelectionSource}
        />

        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,146,56,0.18),_transparent_42%),radial-gradient(circle_at_top_right,_rgba(52,189,215,0.14),_transparent_28%)]" />
        {!isMobileDevice && !directionsOpen ? (
          <div className="pointer-events-none absolute inset-y-0 left-0 w-[42rem] max-w-full bg-gradient-to-r from-[#fcf9f8]/96 via-[#fcf9f8]/86 to-transparent" />
        ) : null}
        {!isMobileDevice && directionsOpen ? (
          <div className="pointer-events-none absolute inset-y-0 right-0 w-[36rem] max-w-full bg-gradient-to-l from-[#fcf9f8]/96 via-[#fcf9f8]/86 to-transparent" />
        ) : null}

        <button
          className={backButtonClassName}
          type="button"
          onClick={onBack}
        >
          <span className="material-symbols-outlined text-[1.5rem]">arrow_back</span>
          추천 목록으로
        </button>

        {!directionsOpen ? (
          <section className={leftPanelClassName}>
            {isMobileDevice ? (
              <button
                aria-expanded={!mobilePanelCollapsed}
                className="mb-4 flex w-full items-center justify-center gap-3 rounded-[1.15rem] bg-white/90 px-4 py-3 text-sm font-black text-on-surface-variant shadow-sm ring-1 ring-black/5 backdrop-blur"
                type="button"
                onClick={() => setMobilePanelCollapsed((current) => !current)}
              >
                <span className="h-1.5 w-12 rounded-full bg-on-surface-variant/25" />
                <span>{mobilePanelCollapsed ? "카드 올리기" : "아래로 내려 지도 보기"}</span>
                <span
                  className={`material-symbols-outlined text-[1.3rem] transition-transform ${
                    mobilePanelCollapsed ? "rotate-180" : ""
                  }`}
                >
                  expand_more
                </span>
              </button>
            ) : null}
            <div className="overflow-hidden rounded-[1.8rem] bg-surface-container-low shadow-sm">
              {mapSelectedItem.imageUrl ? (
                <div className={heroImageClassName}>
                  <img
                    alt={mapSelectedItem.name}
                    className="h-full w-full object-cover"
                    src={mapSelectedItem.imageUrl}
                  />
                  <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/45 to-transparent" />
                  {Number.isFinite(mapSelectedItem.rating) ? (
                    <div className="absolute right-4 top-4 flex items-center gap-1.5 rounded-full bg-white/92 px-4 py-2.5 text-base font-black text-on-surface shadow-sm backdrop-blur">
                      <span className="material-symbols-outlined filled-icon text-[1.35rem] text-primary">star</span>
                      <span>{Number(mapSelectedItem.rating).toFixed(1)}</span>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="h-56 bg-[linear-gradient(135deg,#ffdcc5_0%,#fed3c7_48%,#a7edff_100%)]" />
              )}
            </div>

            <div className="mt-6">
              <p className="text-sm font-black tracking-[0.08em] text-on-surface-variant">Restaurant</p>
              <h1 className={restaurantTitleClassName}>
                {mapSelectedItem.name}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-base font-semibold text-on-surface-variant">
                {mapSelectedItem.category ? (
                  <span className="rounded-full bg-surface-container-low px-4 py-2">
                    {mapSelectedItem.category}
                  </span>
                ) : null}
                {mapSelectedItem.locationText ? (
                  <span className="rounded-full bg-surface-container-low px-4 py-2">
                    {mapSelectedItem.locationText}
                  </span>
                ) : null}
              </div>
              {mapSelectedItem.reason ? (
                <p className="mt-5 rounded-[1.6rem] bg-surface-container-low px-5 py-5 text-[1.08rem] font-medium leading-relaxed text-on-surface-variant">
                  {mapSelectedItem.reason}
                </p>
              ) : null}
            </div>

            <div className="mt-6 space-y-4">
              <LargeMetaCard
                icon="location_on"
                label="주소"
                value={mapSelectedItem.address || "주소 정보가 아직 없습니다."}
                tone="secondary"
              />
              <LargeMetaCard
                icon="my_location"
                label="현재 위치"
                value={
                  currentLocation
                    ? `${currentLocation.lat.toFixed(4)}, ${currentLocation.lng.toFixed(4)}`
                    : locationStatus || "현재 위치를 아직 확인하지 못했습니다."
                }
                tone="primary"
              />
            </div>

            {mapSelectedItem.keywords?.length ? (
              <div className="mt-6 rounded-[1.6rem] bg-surface-container-low px-5 py-5">
                <p className="text-sm font-black tracking-[0.08em] text-on-surface-variant">Highlights</p>
                <div className="mt-4 flex flex-wrap gap-3">
                  {mapSelectedItem.keywords.slice(0, 6).map((keyword) => (
                    <span
                      key={keyword}
                      className="rounded-full bg-white px-4 py-2 text-sm font-black text-on-surface-variant shadow-sm"
                    >
                      {keyword}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {otherPicks.length ? (
              <div className="mt-6 rounded-[1.7rem] bg-surface-container-low p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-black tracking-[0.08em] text-on-surface-variant">Other picks</p>
                    <p className="mt-1 text-base font-semibold text-on-surface">
                      다른 추천 식당도 바로 바꿔볼 수 있습니다.
                    </p>
                  </div>
                  <span className="rounded-full bg-white px-4 py-2 text-sm font-black text-on-surface-variant shadow-sm">
                    {otherPicks.length}곳
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-3.5">
                  {otherPicks.map((item) => {
                    const isActive = item.id === mapSelectedItem.id;

                    return (
                      <button
                        key={item.id}
                        className={`rounded-full border px-5 py-3 text-base font-bold transition ${
                          isActive
                            ? "border-primary bg-primary text-white"
                            : "border-outline-variant bg-white text-on-surface"
                        }`}
                        type="button"
                        onClick={() => onSelectItem(item.id, "panel")}
                      >
                        {item.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="mt-7 flex flex-col gap-4">
              <button
                className="flex h-[4.7rem] items-center justify-center gap-3 rounded-[1.6rem] bg-gradient-to-br from-primary to-primary-container px-6 text-[1.15rem] font-black text-white shadow-[0_18px_40px_rgba(148,74,0,0.22)] transition hover:brightness-105"
                type="button"
                onClick={() => {
                  setDirectionsOpen(true);
                  onStartDirections?.(mapSelectedItem);
                }}
              >
                <span className="material-symbols-outlined filled-icon text-[1.75rem]">near_me</span>
                길 안내 시작
              </button>
              <div className={actionGridClassName}>
                <button
                  className="flex h-16 items-center justify-center gap-2 rounded-[1.35rem] bg-secondary-container px-4 text-base font-black text-on-secondary-container"
                  type="button"
                  onClick={() => onOpenItem(mapSelectedItem, "detail")}
                >
                  <span className="material-symbols-outlined text-[1.45rem]">restaurant_menu</span>
                  식당 상세정보
                </button>
                <button
                  className="flex h-16 items-center justify-center gap-2 rounded-[1.35rem] bg-surface-container-low px-4 text-base font-black text-on-surface"
                  type="button"
                  onClick={() =>
                    onOpenExternal(
                      mapSelectedItem.links?.googleMap || mapSelectedItem.links?.googleDirections,
                    )
                  }
                >
                  <span className="material-symbols-outlined text-[1.45rem]">map</span>
                  지도 크게 보기
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {directionsOpen ? (
          <aside className={rightPanelClassName}>
            {isMobileDevice ? (
              <button
                aria-expanded={!mobilePanelCollapsed}
                className="mb-4 flex w-full items-center justify-center gap-3 rounded-[1.15rem] bg-white/90 px-4 py-3 text-sm font-black text-on-surface-variant shadow-sm ring-1 ring-black/5 backdrop-blur"
                type="button"
                onClick={() => setMobilePanelCollapsed((current) => !current)}
              >
                <span className="h-1.5 w-12 rounded-full bg-on-surface-variant/25" />
                <span>{mobilePanelCollapsed ? "카드 올리기" : "아래로 내려 지도 보기"}</span>
                <span
                  className={`material-symbols-outlined text-[1.3rem] transition-transform ${
                    mobilePanelCollapsed ? "rotate-180" : ""
                  }`}
                >
                  expand_more
                </span>
              </button>
            ) : null}
            <div className={`rounded-[1.9rem] bg-gradient-to-br ${statusTone.panel} p-6`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black tracking-[0.08em] text-on-surface-variant">Route</p>
                  <h2 className={routeTitleClassName}>
                    {routeDurationLabel || "시간 계산 중"}
                  </h2>
                  <p className="mt-3 text-lg font-semibold text-on-surface-variant">
                    {routeDistanceLabel || "거리 확인 중"} · {activeRouteModeLabel}
                  </p>
                </div>
                <button
                  aria-label="길안내 패널 닫기"
                  className="rounded-full bg-white/80 p-3 text-on-surface shadow-sm"
                  type="button"
                  onClick={() => setDirectionsOpen(false)}
                >
                  <span className="material-symbols-outlined text-[1.5rem]">close</span>
                </button>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-4 py-2 text-sm font-black ${statusTone.chip}`}>
                  {statusTone.title}
                </span>
                {routeUi?.message ? (
                  <span className="text-sm font-semibold text-on-surface-variant">
                    {routeUi.message}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              {routeModeOptions.map((option) => {
                const active = option.id === routeMode;

                return (
                  <button
                    key={option.id}
                    className={`rounded-full px-5 py-3 text-base font-black transition ${
                      active
                        ? "bg-primary text-white shadow-sm"
                        : "bg-surface-container-low text-on-surface hover:bg-surface-container"
                    }`}
                    type="button"
                    onClick={() => onRouteModeChange(option.id)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 rounded-[1.7rem] bg-surface-container-low p-5">
              <p className="text-sm font-black tracking-[0.08em] text-on-surface-variant">Route summary</p>
              <p className="mt-3 text-[1.08rem] font-medium leading-relaxed text-on-surface">
                {routeSummaryLabel || "경로를 계산하면 이곳에 핵심 요약이 표시됩니다."}
              </p>
            </div>

            <div className={routeMetricGridClassName}>
              <div className="rounded-[1.7rem] bg-surface-container-low px-5 py-5">
                <p className="text-sm font-black tracking-[0.08em] text-on-surface-variant">총 거리</p>
                <p className="mt-3 text-[1.8rem] font-black text-on-surface">
                  {routeDistanceLabel || "확인 중"}
                </p>
              </div>
              <div className="rounded-[1.7rem] bg-surface-container-low px-5 py-5">
                <p className="text-sm font-black tracking-[0.08em] text-on-surface-variant">예상 시간</p>
                <p className="mt-3 text-[1.8rem] font-black text-on-surface">
                  {routeDurationLabel || "확인 중"}
                </p>
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-black tracking-[0.08em] text-on-surface-variant">Step by step</p>
                  <p className="mt-1 text-base font-semibold text-on-surface">
                    실제 경로 단계별 안내
                  </p>
                </div>
                {steps.length ? (
                  <span className="rounded-full bg-surface-container-low px-4 py-2 text-sm font-black text-on-surface-variant">
                    {steps.length} steps
                  </span>
                ) : null}
              </div>

              {steps.length ? (
                <div className="mt-4 space-y-4">
                  {steps.map((step, index) => (
                    <RouteStepCard
                      key={step.id || `${step.instruction}-${index}`}
                      index={index}
                      step={step}
                    />
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-[1.6rem] bg-surface-container-low px-5 py-5 text-[1.08rem] font-medium leading-relaxed text-on-surface-variant">
                  {routeUi?.status === "loading"
                    ? "경로 단계 정보를 불러오는 중입니다."
                    : routeUi?.message || "현재 경로 단계 정보가 없습니다."}
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-col gap-4">
              <button
                className="flex h-16 items-center justify-center gap-2 rounded-[1.45rem] bg-primary px-5 text-base font-black text-white"
                type="button"
                onClick={() =>
                  onOpenExternal(
                    mapSelectedItem.links?.googleDirections || mapSelectedItem.links?.googleMap,
                  )
                }
              >
                <span className="material-symbols-outlined text-[1.45rem]">open_in_new</span>
                구글 길찾기 열기
              </button>
              <button
                className="flex h-16 items-center justify-center gap-2 rounded-[1.45rem] bg-secondary-container px-5 text-base font-black text-on-secondary-container"
                type="button"
                onClick={onRefreshLocation}
              >
                <span className="material-symbols-outlined text-[1.45rem]">my_location</span>
                현재 위치 새로고침
              </button>
            </div>
          </aside>
        ) : null}
      </div>
    </main>
  );
}
