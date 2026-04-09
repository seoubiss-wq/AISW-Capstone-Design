# Cache Policy

## Supabase auth config

### Authority

- The backend `GET /auth/config` response is the authoritative source for Supabase auth config.
- The frontend bundled values in `frontend/src/lib/supabase.js` are fallback-only values for initial boot and temporary backend fetch failures.

### Read path

1. `hydrateSupabaseAuthConfig()` requests `GET /auth/config`.
2. If the backend returns a valid `supabaseUrl` and `supabasePublishableKey`, the frontend adopts that config and caches the successful hydration result.
3. If the backend request fails, or returns an incomplete config payload, the frontend temporarily falls back to the bundled config already loaded in the app.
4. Fallback results are not cached as authoritative hydration results. The next call must retry the backend.

### Cache rules

- Cache successful backend hydration.
- Do not cache failed backend hydration.
- Do not cache incomplete backend hydration payloads.
- Reset the Supabase client instance when the effective auth config changes.

### Why this policy exists

- Production bundles are static. Once shipped, the values embedded by Vite do not change until the frontend is rebuilt.
- Backend runtime config can change without a frontend rebuild.
- If the first backend fetch fails and the app permanently trusts the bundled fallback, the tab can stay pinned to stale config for the rest of the session.
- Retrying after failure gives the app a chance to self-heal when the backend recovers.

### Operational guidance

- If a cache-related issue only appears after deploy, check whether the frontend is still using bundled fallback values because `/auth/config` failed once.
- If backend config changed and the tab did not pick it up, verify whether a successful hydration was ever cached in that session.
- When debugging, decide first whether the bug is:
  - a stale successful cache issue
  - a fallback-after-failure issue
  - a backend payload integrity issue

### Decision rule

- If backend and frontend config disagree, trust the backend.
- If backend hydration never succeeded in the current tab, treat the frontend config as temporary fallback, not source of truth.
- If backend hydration succeeded, treat that cached result as the active source of truth until the page reloads or config changes.

### Relevant files

- `frontend/src/lib/supabase.js`
- `frontend/src/lib/supabase.test.js`
- `backend/server.js`
