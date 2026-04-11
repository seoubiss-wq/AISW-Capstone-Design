# TastePick Local Development

이 저장소의 인증 테스트와 모바일 테스트는 아래 두 경로로 고정한다.

## 표준 실행 모드

### 1. split dev
- 명령: `npm start`
- 용도: 일반 프런트 개발
- 접속:
  - 프런트 `http://localhost:3000`
  - 백엔드 `http://localhost:5500`
- 특징:
  - Vite HMR이 가장 빠르다
  - Google OAuth 같은 쿠키 기반 인증 재현성은 낮다

### 2. same-origin auth-dev
- 명령: `npm run dev:same-origin`
- 용도: 인증, 쿠키, 모바일 재현의 기본 경로
- 접속:
  - 앱 `http://localhost:5500`
- 특징:
  - 프런트 build를 백엔드가 직접 서빙한다
  - API와 프런트가 같은 origin을 사용한다
  - Google 로그인과 세션 테스트는 이 모드가 기본이다

### 3. mobile-lan
- 명령:
  - `npm run dev:mobile`
  - `npm run mobile:url`
- 용도: 같은 와이파이 휴대폰 확인
- 접속:
  - `npm run mobile:url`에 출력된 `http://<LAN_IP>:5500`
- 특징:
  - same-origin auth-dev와 같은 구조다
  - 모바일 Google 로그인도 이 경로를 기본으로 본다

## 권장 순서

### 일반 UI 수정
1. `npm start`
2. `http://localhost:3000`

### 로그인, 쿠키, 추천 API 확인
1. `npm run dev:same-origin`
2. `http://localhost:5500`

### 휴대폰 테스트
1. `npm run dev:mobile`
2. `npm run mobile:url`
3. 같은 와이파이 휴대폰에서 출력된 `http://<LAN_IP>:5500` 접속

## 환경 변수

### 프런트
- `REACT_APP_API_BASE_URL`
  - split dev에서만 사용
  - 비워 두면 개발 모드 기본값은 `http://localhost:5500`
- `REACT_APP_FORCE_SAME_ORIGIN`
  - 직접 넣지 않는다
  - `npm run build:same-origin` / `npm run dev:same-origin` 스크립트가 자동 설정한다
- `REACT_APP_SUPABASE_URL`
- `REACT_APP_SUPABASE_PUBLISHABLE_KEY`

### 백엔드
- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `GOOGLE_MAPS_API_KEY`
- `GEMINI_API_KEY`
- `AI_SERVER_URL`
  - 선택 사항
  - 예시: `http://127.0.0.1:8001`
  - 설정하면 `/recommend`가 AI 검색 서버를 먼저 사용하고, 실패 시 기존 추천 경로로 fallback한다
- `AI_SERVER_TIMEOUT_MS`
  - 선택 사항
  - 기본값은 백엔드 코드 기준 `8000ms`

## AI 검색 서버

- 선택 실행 경로다. 백엔드만으로도 기존 추천은 동작한다.
- AI 검색 품질을 쓰려면 `ai_server`를 별도 프로세스로 띄우고 백엔드에 `AI_SERVER_URL`을 연결한다.

### 최소 실행 순서
1. `cd ai_server`
2. `python -m venv .venv`
3. `.venv\Scripts\activate`
4. `pip install -r requirements.txt`
5. `copy .env.example .env`
6. `python app.py`

기본 주소는 `http://127.0.0.1:8001` 이다.
벡터 컬럼과 인덱스는 `supabase/migrations/20260410_add_ai_restaurant_search.sql` 또는 `ai_server/sql/001_pgvector_setup.sql` 로 준비한다.
관리자 임베딩 엔드포인트 `/ai/admin/embed` 는 `AI_ADMIN_TOKEN` 을 설정해야만 활성화된다.

## 문제 해결

### Google 로그인이 로컬에서 안 됨
- `npm start`가 아니라 `npm run dev:same-origin`으로 실행
- 접속 주소도 `http://localhost:5500` 사용

### 휴대폰에서 인증이 꼬임
- `3000`/`5500` split-origin 조합 대신 `http://<LAN_IP>:5500` 한 주소만 사용
- 같은 와이파이에 붙어 있는지 확인

### `Failed to fetch`
- 프런트가 죽은 tunnel URL을 env에 들고 있지 않은지 확인
- 우선 same-origin 모드에서 재현되는지 먼저 확인

### 추천은 되는데 로그인만 불안정함
- split dev 문제일 가능성이 높다
- same-origin auth-dev에서 먼저 확인
