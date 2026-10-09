# Long-run plan validator pilot

A standard-library-only Node CLI that checks a JSON long-running task plan before a lead dispatches work.

## Usage

```sh
node scripts/validate-long-run-plan.mjs examples/long-run-plan/valid.json   # prints "valid: ...", exit 0
node scripts/validate-long-run-plan.mjs examples/long-run-plan/invalid.json # lists all 8 errors, exit 1
node scripts/test-validate-long-run-plan.mjs                                # focused test
```

Exit codes: `0` valid, `1` invalid, unreadable or malformed JSON, `2` wrong argument count.
All validation errors are printed together on stderr, one `- ` line each.

## Plan shape

```json
{
  "objective": "non-empty string",
  "requirements": [{ "id": "R1", "text": "optional description" }],
  "tasks": [
    { "id": "T1", "state": "active", "writer": true, "owner": "worker",
      "exclusiveScopes": ["path/or/subsystem"], "requirements": ["R1"] }
  ]
}
```

## Invariants

- `objective` is a non-empty string.

- `requirements` is a non-empty array with unique, non-empty `id` values.

- `tasks` is an array; each task has a unique, non-empty `id`.

- `state` is one of `queued`, `active`, `waiting`, `completed`, `failed`, `cancelled`.

- At most 20 tasks are `active` plus `queued`, and at most 8 are `active`.

- `writer`, when present, is a boolean. Writer tasks need a non-empty `owner` and a non-empty `exclusiveScopes` array of strings.

- No two `active` or `waiting` writers may list the same scope. Finished writers release their scopes.

- Every entry in a task's optional `requirements` array names an existing requirement ID.

## Limitations

- Scope conflicts use exact string match; `scripts/` and `scripts/a.mjs` do not conflict.

- Unknown fields are ignored, and requirement `text` is not required.

- Non-writer tasks need no owner, and tasks need not reference any requirement.

- It validates one file at a time and does not check state transitions between plan revisions.
