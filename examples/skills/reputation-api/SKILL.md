---
name: reputation-api
description: Implement and verify Reputation Systems Spring Boot endpoints, services, persistence, and frontend API contracts, including tenant/property scope and Flyway migrations. Use for backend or cross-stack API changes, not frontend-only styling.
---

Locate the active backend checkout by `pom.xml` and `src/main/java/com/java_hotel`. Use that repo's Maven wrapper and Java version, including in worktrees. Read [api-map.md](references/api-map.md) for the verified package map and checks.

Trace the affected endpoint through controller, authorization/property resolution, service, repository/entity, and its frontend adapter caller before changing the contract. Preserve existing status/error behavior unless the task explicitly changes it. Add focused regression coverage for the changed behavior; for tenant-owned data, cover the relevant allowed and cross-tenant/property cases.

Read `docs/SECURITY.md` for tenant mutations and `docs/MIGRATION_PATTERNS.md` when schema/data changes are involved. Applied Flyway migrations are append-only; create the next migration following the actual current sequence rather than using a fixed version number.

Use mocked or isolated test dependencies for verification. Report external database, Docker, or credential prerequisites that prevent a check. Do not substitute production calls for missing test infrastructure or claim that compilation verifies runtime integration.
