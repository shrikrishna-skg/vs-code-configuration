# Reputation Systems project map

Verified from the local source on 2026-10-08. Paths below are relative to the detected umbrella workspace; when a worktree contains only one repo, omit `frontend/` or `backend/` as appropriate.

## Repository boundaries

- `frontend/`: its own Git repo, React 18 with JavaScript/JSX, Vite 8, Tailwind, Radix, TanStack Query, React Router.
- `backend/`: its own Git repo, Spring Boot 3.5.3, Java 21, Maven wrapper, JPA, PostgreSQL/Flyway.
- `mockups/`: design references. A mockup is reference material, not the running app's implementation.
- The umbrella directory is not itself a Git repo. Resolve branch, status, commits, and worktrees separately for each owned repo.

## Entry points

| Area | Start here |
| --- | --- |
| Frontend mount and global styles | `frontend/src/main.jsx`, `frontend/src/styles/ms-tokens.css`, `ms-base.css`, `ms-motion.css`, `responsive-app.css` |
| App providers, authentication, routing | `frontend/src/App.jsx`, `frontend/src/pages.config.js`, `frontend/src/lib/AuthContext.jsx` |
| Shell/sidebar/header | `frontend/src/Layout.jsx`, `Layout.css`, `frontend/src/components/shell/` |
| Backend API adapter | `frontend/src/api/base44Client.js`, `backendAuth2Client.js` |
| Shared current-property data | `frontend/src/hooks/useCurrentProperty.js`, `frontend/src/lib/query-client.js` |
| Backend application | `backend/src/main/java/com/java_hotel/AuthApplication.java` |
| Request authorization | `backend/src/main/java/com/java_hotel/auth/config/SecurityConfig.java`, `auth/service/CurrentUserResolver.java`, `CurrentPropertyService.java` |
| Backend tests | `backend/src/test/java/com/java_hotel/` mirrors feature packages |
| Database migrations | `backend/src/main/resources/db/migration/`, `backend/docs/MIGRATION_PATTERNS.md` |

## Commands and operational traps

Run frontend commands from its repo: `npm run test:unit`, `npm run lint`, `npm run typecheck`, `npm run build`; browser specs use `npm run test:e2e`. Run backend commands from its repo: `./mvnw compile -DskipTests`, `./mvnw test`.

Frontend `npm run build` also invokes a Node chat-contract prebuild test and the bundle budget checker. Type checking uses `jsconfig.json` with `checkJs: false` and excludes API/lib/tests; a passing typecheck is limited evidence.

Frontend `dev:api` currently references `../Reputation-systems-backend`, which is not this umbrella's `backend/`. Do not use that script blindly. Locate the actual backend repo and inspect its current launch configuration.

Vite's dev proxy resolves `VITE_API_PROXY_TARGET`, then `VITE_BASE44_BACKEND_URL`, then the production API default. Confirm the target before any browser operation that writes data. Use a local/test target or existing mocks for verification. Starting a frontend does not start a local backend.

No project-local `AGENTS.md` was present during inspection. Recheck for applicable instructions in the active checkout. Read environment variable names from examples/configuration; do not print environment values or copy private credentials into handoffs.
