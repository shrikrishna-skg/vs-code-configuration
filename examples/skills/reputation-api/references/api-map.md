# Backend/API entrypoints and checks

Snapshot verified from source on 2026-10-08. Paths in the backend sections are relative to that repo; frontend paths are relative to its separate repo.

## Stack and conventions

`pom.xml` specifies Spring Boot 3.5.3 and Java 21. `src/main/java/com/java_hotel/AuthApplication.java` is the application entrypoint. Packages are organized by feature, commonly controller/service/repository/model or entity:

- `auth/`: authentication, properties, subscription access, invitations, configuration. Inspect `auth/config/SecurityConfig.java`, `auth/service/CurrentUserResolver.java`, and `CurrentPropertyService.java` for the affected route.
- `hotelreviews/`: review data and reply consistency/safety handling.
- `replygenerator/`: reply generation and image extraction; controller + service + colocated tests demonstrate selected-property scope.
- `operationalinsights/`: asynchronous operational analysis, evidence/incident guards, insights chat.
- `reports/`: report generation and artifacts; nested `delivery/`, `file/`, and `schedule/` handle their respective contracts and jobs.
- `zembra/`, `shoutabout/`: external integrations; use their existing clients/services rather than bypassing established handling.
- `clientapi/`: external client API authentication and key management.
- `common/`: shared circuit breaker, usage, normalization, and review-sync primitives.

Read `docs/SECURITY.md` before tenant-owned mutations. Its convention puts an ownership check in method security before entering mutation bodies, with service protection when callable outside controllers. Preserve the existing route's principal and current-property resolution rather than trusting client-supplied ownership identifiers.

`replygenerator/controller/ReplyGeneratorController.java` is an example that resolves the user, checks subscription access, and obtains the strictly selected property before invoking `ReplyGeneratorService`.

The frontend facade is `src/api/base44Client.js` and the adapter is `src/api/backendAuth2Client.js` in the frontend repo. Follow its existing authentication, error normalization, and property-scope handling when adding a caller. Some controllers return maps; inspect actual payloads/tests rather than assuming an automatically available OpenAPI contract (`pom.xml` documents a prior springdoc rollback).

## Database changes

Flyway migrations are under `src/main/resources/db/migration/`. Inspect the current filenames before choosing the next version. `docs/MIGRATION_PATTERNS.md` requires append-only applied migrations and audit paths for destructive cleanup, including pre/post row-count evidence. Local schema bootstrap also exists as `src/main/resources/schema-local.sql`; do not assume it represents production migration history.

## Verification commands

From the backend repo:

| Need | Command |
| --- | --- |
| Compile production code | `./mvnw compile -DskipTests` |
| Focused regression class | `./mvnw -Dtest=ReplyGeneratorControllerPropertyScopeTest test` (choose the affected existing/new class) |
| Full configured test suite | `./mvnw test` |

Tests live under `src/test/java/com/java_hotel/`. `ReplyGeneratorControllerPropertyScopeTest` demonstrates Mockito unit testing and strict property selection. `reports/controller/ReportControllerIntegrationTest` demonstrates MockMvc, the `test` Spring profile, and transactional integration checks. The project has Testcontainers PostgreSQL dependencies; inspect the chosen test's setup before deciding whether Docker/database availability is required. Do not silently skip failed integration tests and report the suite as passing.

The backend README supplies compile/test commands. Recheck current launch profiles and example variable names before starting a service; do not source or display a private `.env` just to discover configuration. For cross-stack contract changes, also run the relevant frontend adapter test from its own repo, for example `npm run test:unit -- src/api/backendAuth2Client.test.js`.
