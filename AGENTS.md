# AGENTS.md

## General

- 코드를 수정하기 전에 허락을 받아. 구체적인 명령이나 요청일 때는 바로 수정해.
- 마지막에 배포할 거냐고 물어봐.

## gstack

- 웹 브라우징이 필요할 때는 항상 gstack의 `/browse` 스킬을 사용해.
- `mcp__claude-in-chrome__*` 도구는 절대 사용하지 마.

사용 가능한 gstack 스킬:
- `/office-hours`
- `/plan-ceo-review`
- `/plan-eng-review`
- `/plan-design-review`
- `/design-consultation`
- `/design-shotgun`
- `/design-html`
- `/review`
- `/ship`
- `/land-and-deploy`
- `/canary`
- `/benchmark`
- `/browse`
- `/connect-chrome`
- `/qa`
- `/qa-only`
- `/design-review`
- `/setup-browser-cookies`
- `/setup-deploy`
- `/retro`
- `/investigate`
- `/document-release`
- `/codex`
- `/cso`
- `/autoplan`
- `/plan-devex-review`
- `/devex-review`
- `/careful`
- `/freeze`
- `/guard`
- `/unfreeze`
- `/gstack-upgrade`
- `/learn`

## Security Operations

- 비밀값은 코드나 설정 파일에 직접 적지 말고 환경변수로 우선 관리한다.
- `.env`, `.env.local`, API 키, 세션 토큰, MCP 자격증명은 Git에 커밋하지 않는다.
- 비밀값을 채팅, 이슈, 로그, 스크린샷에 직접 붙여넣지 않는다.
- 로컬 전역 민감 파일 예시:
  - `$CODEX_HOME/auth.json`
  - `$CODEX_HOME/config.toml`
  - `$HOME/.claude/...`
- 민감 파일은 최소 권한 원칙으로 관리한다. 기본적으로 현재 사용자, `Administrators`, `SYSTEM`만 접근 가능하게 유지한다.
- 민감 파일과 로그 파일은 OneDrive, Dropbox, NAS, Git 저장소 같은 자동 동기화/백업 범위에서 제외한다.
- 새 MCP 서버나 CLI를 추가할 때는 `bearer_token_env_var` 또는 env 기반 헤더 지원 여부를 먼저 확인한다.
- 앱이나 도구가 평문 토큰 파일을 쓰는 경우, 저장 포맷을 바꾸기 어렵더라도 파일 권한 최소화와 백업 제외를 먼저 적용한다.
- 토큰이나 키 노출이 의심되면 즉시 재로그인하거나 키를 재발급하고, 기존 토큰은 폐기한다.
- 운영 중에는 주기적으로 로그와 설정 파일에 민감 정보가 남지 않았는지 점검한다.
