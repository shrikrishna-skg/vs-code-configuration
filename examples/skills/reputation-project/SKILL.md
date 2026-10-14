---
name: reputation-project
description: Orient and plan changes in the Reputation Systems frontend and Java backend, especially cross-stack features, repo selection, and worktree handoffs. Use when working in this product; unrelated projects should use their own conventions.
---

Use the current checkout as the source of truth. Locate the frontend by `package.json` plus `src/App.jsx`, and the backend by `pom.xml` plus `src/main/java/com/java_hotel`; the workspace may contain either repo or both. Run `git rev-parse --show-toplevel` in the repo being changed. The usual umbrella workspace contains **two independent Git repositories**, not one root repo. Do not redirect worktree edits to an original absolute path.

Read [project-map.md](references/project-map.md) for verified entrypoints and command locations. Recheck manifests and nearby code before using this snapshot as an implementation guide.

For a cross-stack task, define the request/response contract and acceptance criteria first. Hand workers the owning repo, file boundaries, relevant tests, and the contract. Shared-directory subagents need disjoint write ownership; parallel implementation of overlapping files belongs in separate worktrees. A simple fix can be implemented directly.

Preserve existing project and user changes. Verify in each repo that changed. Report tests actually run and limitations; a frontend build alone does not prove the backend or browser flow works. Use the `reputation-ui` or `reputation-api` skill when the corresponding implementation needs its detailed conventions.
