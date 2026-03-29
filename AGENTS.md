# AGENTS.md

## Scope rules
- Frontend tasks must not modify `backend/**` unless explicitly requested.
- Backend tasks must not modify `frontend/**` unless explicitly requested.
- Do not edit database schema for UI-only tasks.

## Validation
- Run `npm run lint` before finishing.
- Run `npm test` for files touched by the change.

## PR expectations
- Keep each thread scoped to one user-visible outcome.
- If the task requires touching shared auth/config files, stop and explain why.
