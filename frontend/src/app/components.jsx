import { NAV_ITEMS, NAV_ITEM_ICONS, buildRecommendationDecisionBrief } from "./appSupport";

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
  const decisionBrief = buildRecommendationDecisionBrief(item);

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
        {decisionBrief ? (
          <p className="mb-3 text-sm font-black tracking-[0.01em] text-primary">{decisionBrief}</p>
        ) : null}
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
  pendingGoogleLink,
  agreements,
  onChangeForm,
  onToggleAgreement,
  onSubmit,
  onChangeMode,
  onSocialLogin,
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
                  readOnly={Boolean(isLogin && pendingGoogleLink?.email)}
                  onChange={(event) => onChangeForm("email", event.target.value)}
                />
              </label>
              {isLogin && pendingGoogleLink?.email ? (
                <div className="rounded-[1rem] bg-secondary-container/50 px-5 py-4 text-sm font-semibold leading-relaxed text-on-secondary-container">
                  기존 이메일/비밀번호 계정이 있습니다.
                  <br />
                  <span className="font-black">{pendingGoogleLink.email}</span> 의 비밀번호를 입력하면 Google 계정과 안전하게 통합합니다.
                </div>
              ) : null}
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
                  ].map(([label, className]) => {
                    const provider = className.includes("#03c75a")
                      ? "naver"
                      : className.includes("#fee500")
                        ? "kakao"
                        : "google";

                    return (
                      <button
                        key={provider}
                        className={`w-full rounded-[1.25rem] px-5 py-4 text-lg font-black ${className}`}
                        disabled={authLoading || booting}
                        type="button"
                        onClick={() => onSocialLogin(provider)}
                      >
                        {label}
                      </button>
                    );
                  })}
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

export {
  AuthScreen,
  Footer,
  RecommendationEmptyState,
  RecommendationLoadingGrid,
  RecommendationMapStatusCard,
  ResultCard,
  SavedCard,
  TopNav,
};
