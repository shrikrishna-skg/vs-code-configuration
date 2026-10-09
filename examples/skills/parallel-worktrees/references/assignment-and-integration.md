# Worktree assignment and integration record

Create a task-local record, not a new permanent process file for every small fix. Replace the example descriptions with the current task. Never include credentials, `.env` contents, private logs, or unrelated source.

## Before launch

- [ ] Define the requested behavior and observable acceptance criteria.
- [ ] Inspect actual repo root, current revision, and dirty status without changing them.
- [ ] Select an explicit base that contains required dependencies. An Agent Manager default may differ from the current branch.
- [ ] Split only independent streams. Assign one writer for shared contracts, generated schemas, lockfiles, or central routing.
- [ ] Give a dependent worker the agreed interface first; wait for a prerequisite when its behavior cannot yet be specified.
- [ ] Verify the returned worktree belongs to the intended repository and runs in its isolated checkout.

## Assignment template

| Field | Required content |
|---|---|
| Stream | Short identifier and outcome |
| Repository / directory | Verified absolute Git root / returned worktree path |
| Base | Recorded branch/ref and resolved commit |
| Owner / model | Existing agent role and available model |
| Owned files | Specific files/directories; shared files assigned to one stream |
| Dependencies | Contract, prerequisite, or explicitly independent |
| Acceptance | Observable behavior, including key error state |
| Checks | Repository-supported commands and browser scenario if applicable |
| Deliverable | Diff/patch, command outcomes, evidence locations, limitations |

Example split: frontend implements a UI against an agreed response contract; backend implements the agreed endpoint; a read-only reviewer checks authentication/error paths. If the contract is undecided, establish it before launching both writers. Each repository has its own Git history, so deliver and integrate each diff within that repository.

## Integration gate

- [ ] Confirm each worker's repository/base and inspect all changed files, including generated and untracked files.
- [ ] Review scope and acceptance evidence; investigate missing or failing checks rather than labeling them passed.
- [ ] Review overlap, schema/API compatibility, and migrations. Confirm request/response and error contracts across the two repositories.
- [ ] Prepare the combined result in an integration worktree or other task-authorized location, preserving the user's current checkout.
- [ ] Run relevant checks and end-to-end behavior on the combined result with the same configuration used in the evidence.
- [ ] Record unresolved limitations and the exact integration action that remains. No automatic merge/push/deploy.

## Setup and cleanup

Inspect the selected repository's Agent Manager setup behavior before launch. Dependency installs, environment-file copying, databases, ports, and external caches can create side effects; use only what the task needs and keep secrets local. Do not enable new setup scripts or copy secrets as part of routine orchestration. When cleanup is authorized, preserve required uncommitted and ignored work first. Closing a checkout may leave external resources behind; remove only resources this task created and no longer needs.
