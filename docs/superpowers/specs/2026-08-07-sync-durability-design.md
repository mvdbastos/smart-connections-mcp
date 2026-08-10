# Sync Durability — Design

**Date:** 2026-08-07
**Issues:** [#5](https://github.com/mvdbastos/smart-connections-mcp/issues/5), [#8](https://github.com/mvdbastos/smart-connections-mcp/issues/8)
**Status:** Approved

## Goal

One bad path must never block the commit pipeline, pending commits must survive an unexpected process death, and a failure the server cannot fix itself must escalate to someone who can.

## Background

This is Group C of three. The six open issues decompose into:

| Group | Issues | Subsystem |
|---|---|---|
| A | #6, #10 | Prompt text and argument validation |
| B | #4, #7 | Index/filesystem desync — phantom paths, silent note fabrication |
| **C (this spec)** | #5, #8 | Sync durability |

All three run as concurrent branches merged at the end — see [Parallel execution](#parallel-execution).

## Root cause

### #5 — why the failure is permanent, not transient

A note created and deleted inside the same commit window was never committed and no longer exists on disk. `commitSpecific` (`git-manager.ts:145`) runs:

```ts
this.git(['add', '--', ...relativePaths]);
```

which fails with `pathspec '<path>' did not match any files` — and that failure aborts the **entire batch**, not just the offending path.

`fireCommit`'s else-branch (`sync-scheduler.ts:180-186`) then sets `lastCommitError` and retries at most once, but **never clears `dirtyPaths`**:

```ts
} else {
  this.lastCommitError = result.error;
  if (!this.commitRetried) {
    this.commitRetried = true;
    this.scheduleCommit(this.commitIdleMs);
  }
}
```

The phantom path stays in the set for the process lifetime. Because `markDirty` resets `commitRetried = false` (`:65`), every subsequent write schedules a commit that re-includes the phantom and fails identically. **After a single delete, no note auto-commits again until the server restarts.**

### #8 — the loss window

All scheduler state is in-heap (`dirtyPaths`, `commitTimer`, `pushTimer`). Both timers are `unref()`'d (`:213-217`), so neither keeps the process alive. `flushSync` (`:111`) is the only durability path and runs solely from `SIGINT`/`SIGTERM`/`stdin close`.

A `SIGKILL`, a crash, or power loss discards `dirtyPaths` entirely. The files are on disk but were never committed, and nothing ever retries them — vault changes accumulate uncommitted until someone happens to run a full `git_commit_notes`.

## Design

### 1. Pathspec pre-filter (`git-manager.ts`)

`commitSpecific` partitions paths before invoking git. A path is **committable** if it exists on disk **or** is tracked in the git index — established with a single `git ls-files -- <paths>` call. Anything that is neither was created and deleted before ever being committed, so there is genuinely nothing to commit and it is dropped from the batch.

If the committable set is empty, return the existing `No changes to commit` error, which `fireCommit` (`:176-179`) already handles by clearing state.

`git add <pathspec>` has staged deletions of tracked files since Git 2.0, so filtering unmatched pathspecs is the entire fix — no `-A` is required.

### 2. Quarantine with per-path isolation (`sync-scheduler.ts`)

A batch commit failure does not reveal which path caused it — `commitPaths` fails as a unit. Blaming the whole batch would punish innocent paths, which matters more now that quarantine drives agent-visible escalation.

On the **second consecutive failure**, the scheduler runs a per-path pass: each path is committed individually. Paths that succeed commit normally; paths that still fail are quarantined individually and removed from `dirtyPaths`.

The pass is bounded — N git invocations, once, only on a repeated failure.

`SyncStatus` gains two fields — the second exists because `buildSyncBlock` receives only the status object and must be able to decide rung 3 from it alone:

```ts
quarantinedPaths: string[];
quarantineSurvivedRestart: boolean;
```

Quarantined paths never re-enter `dirtyPaths` on their own, so one bad path can no longer block the pipeline. That is the actual defect in #5.

### 3. Journal (`src/sync-journal.ts`, new)

```ts
export interface QuarantineEntry {
  path: string;
  error: string;
  since: string;          // ISO 8601
  survivedRestart: boolean;
}

export interface JournalState {
  pending: string[];
  quarantined: QuarantineEntry[];
}

export class SyncJournal {
  constructor(journalPath: string);
  write(state: JournalState): void;   // always the complete current state
  read(): JournalState;               // empty state if absent or malformed
}
```

The journal is **always rewritten with the complete current state** — there is no partial update and no separate `clear()`. Clearing `dirtyPaths` after a successful commit writes a journal whose `pending` is empty but whose `quarantined` is preserved; quarantine must outlive a successful commit of unrelated paths, which a `clear()` verb would have made ambiguous. When both arrays are empty the file is deleted.

Located at `<vault>/.git/smart-connections-mcp/pending.json`:

```json
{
  "version": 1,
  "updatedAt": "2026-08-07T10:41:03.221Z",
  "pending": ["Memory/smart-connections-mcp/Sync.md"],
  "quarantined": [
    {
      "path": "Memory/ghost.md",
      "error": "pathspec 'Memory/ghost.md' did not match any files",
      "since": "2026-08-07T10:12:00.000Z"
    }
  ]
}
```

`.git/` is chosen because it is guaranteed never committed, guaranteed to exist exactly when it matters — if there is no `.git`, `GitManager` is already unavailable and sync is moot — and nothing else writes there. Written on every `markDirty`; debouncing would reintroduce the very loss window being closed.

**All journal I/O is fail-soft.** A journal error must never break a note write. Every call is wrapped, logged to stderr, and ignored.

### 4. Recovery

Recovery lives inside `SyncScheduler`, which owns `dirtyPaths`. The journal is injected through `SyncSchedulerOptions`, so existing tests that construct a scheduler without one keep working unchanged.

On startup:

- `pending` entries return to `dirtyPaths`, and the ordinary commit timer starts.
- `quarantined` entries **also** return to `dirtyPaths` — a restart may have cleared the cause, such as a stale lock — but each is remembered as having been quarantined in a previous session.
- If such a path is quarantined again this session, its entry is written back with `survivedRestart: true`, and `SyncStatus.quarantineSurvivedRestart` becomes true. That drives rung 3 (below).

This retroactively justifies `unref()` (`:213-217`). Today an unref'd timer that never fires means its state is lost; with the journal it means the state is recoverable, so the timers stay unref'd.

### 5. Escalation ladder

The server cannot clear an `index.lock` or repair a failing hook. The agent can. Escalation is surfaced through the sync block, following the existing `NEXT_STEPS_TEXT` precedent (`index.ts:124`).

| Rung | Trigger | Behavior |
|---|---|---|
| 0 | First failure | One retry after the idle window *(exists today)* |
| 1 | Second failure | Per-path isolation, quarantine, `quarantined_paths` in the sync block |
| 2 | Any path quarantined | `remediation` hint |
| 3 | A quarantined path is in `survivedRestart` | `report` hint |

**Rung 2 — `remediation`.** Bounded by design: named causes with exact commands, and an explicit prohibition on destructive recovery. An open mandate to "fix git" in the repository holding the user's notes risks an agent reaching for `git reset --hard` or `git checkout -- .` and destroying uncommitted vault edits.

```
Auto-commit is blocked in <VAULT_ROOT>.
Error: <exact git error>

Diagnose:  git -C <VAULT_ROOT> status

Likely causes:
  1. stale lock     -> remove <VAULT_ROOT>/.git/index.lock if no git process is running
  2. failing hook   -> git -C <VAULT_ROOT> commit  to see hook output
  3. detached HEAD  -> git -C <VAULT_ROOT> switch main

Do NOT run reset --hard, checkout -- ., or clean — uncommitted vault edits would be lost.
If none of these apply, stop and report rather than improvising.

Then call git_commit_notes to resume.
```

`VAULT_ROOT` is interpolated, never referred to generically. This is the direct lesson of issue #10 in Group A: a path-free instruction is what led an agent to act on the wrong location.

**Rung 3 — `report`.** Only fires once a failure has survived a restart, which is a high enough bar to justify touching a public tracker — a five-minute stale lock never reaches it.

```
This failure survived a restart and is likely a bug in smart-connections-mcp.

Search existing issues first:
  gh issue list -R mvdbastos/smart-connections-mcp --search "<error text>"

Update the matching issue if one exists; otherwise open a new one.

Include: the git error text, git --version, your OS, and the NUMBER of quarantined paths.
Do NOT include note paths, note titles, or vault contents — this repository is public.
```

**The redaction rule is load-bearing.** `github.com/mvdbastos/smart-connections-mcp` is public, and `buildSyncBlock` already emits raw `pending_paths` (`index.ts:117`). Vault note paths carry client names, project names, and personal note titles. They are appropriate for the local MCP client and inappropriate for an issue tracker. The hint therefore requests a **count**, never the paths.

The issue-tracker slug is a module const, not derived at runtime — it is this software's own tracker.

### 6. Status surface

`buildSyncBlock` (`index.ts:109-122`) gains three conditional fields, matching the existing style of spreading optional keys:

```ts
...(status.quarantinedPaths.length ? { quarantined_paths: status.quarantinedPaths } : {}),
...(remediation ? { remediation } : {}),
...(report ? { report } : {}),
```

## Error handling

- Journal I/O failure — caught, logged to stderr, ignored. Never breaks a note write.
- Missing `.git/` — `GitManager` is already unavailable in that case; the journal is not constructed and sync is a no-op.
- Per-path isolation pass failure — each path's error is captured into its `QuarantineEntry`; a failure in one path does not stop the pass.
- Concurrent servers over one vault — the journal is last-writer-wins. Two servers on the same vault already conflict at the git level; this does not make it worse and is not addressed here.

## Testing

**Poison regression** (`src/sync-scheduler.test.ts`):

- Create + delete inside one commit window, then write a second note — **the second note commits.** This is #5's exact failure and currently would not.
- The phantom path does not persist in `dirtyPaths` across subsequent commits.

**Pre-filter** (`src/git-manager.test.ts`):

- A tracked-and-deleted path stages its deletion.
- An untracked-and-missing path is dropped from the batch.
- A batch where every path is dropped returns `No changes to commit`.
- A mixed batch commits the real paths and ignores the phantom.

**Journal** (`src/sync-journal.test.ts`):

- Rewritten on every `markDirty`; `pending` empties on successful commit and on `notifyManualCommit`, while `quarantined` survives both.
- The file is deleted when `pending` and `quarantined` are both empty.
- A write failure does not throw out of `markDirty`.
- A malformed or truncated journal file reads as empty rather than throwing.

**Recovery** (`src/sync-scheduler.test.ts`):

- **Crash simulation:** construct a second scheduler over the same journal file — it recovers pending paths and schedules a commit.
- Recovered quarantined paths are retried, not left quarantined.
- A recovered quarantined path that fails again is marked `survivedRestart`.

**Quarantine** (`src/sync-scheduler.test.ts`):

- After two consecutive failures, the per-path pass runs.
- Paths that succeed in the pass commit; only genuinely failing paths are quarantined.
- Quarantined paths appear in `getStatus().quarantinedPaths`.
- Subsequent writes still commit while a path is quarantined.

**Hints** (`src/index.test.ts`):

- `remediation` appears only when something is quarantined, and contains the literal `VAULT_ROOT`.
- `report` appears only when a quarantined path survived a restart.
- `report` text contains no path from `quarantinedPaths`.

## Parallel execution

Groups A, B, and C run as three concurrent branches off `main`, merged only at the end.

**`dist/` is compiled output and is tracked in git (75 files).** Three branches each rebuilding it would conflict across all of them on every merge after the first, and such a conflict has no meaningful resolution — the only correct answer is to rebuild, never to merge hunks.

Therefore, on this branch:

- **Do not run `npm run build`. Do not stage `dist/`.** Commit steps stage `src/`, `docs/`, and `CHANGELOG.md` explicitly — never `git add -A`.
- `dist/` is knowingly left stale for the life of this branch. Tests run from `src/` via Vitest, so this does not affect verification.
- After all three branches merge, a single integration commit runs `npm run build` and stages `dist/` alone.

`src/index.ts` is touched by all three groups in disjoint regions — A: `inputSchema` ~233/~445; B: `listByPrefix` ~600, handlers ~664/~692; C: sync wiring ~96 and `buildSyncBlock` ~109-124. Group C shares no other file with A or B.

## Files

| File | Change |
|---|---|
| `src/sync-journal.ts` | **New** — journal read/write/clear, fail-soft |
| `src/sync-journal.test.ts` | **New** — persistence, corruption tolerance, fail-soft |
| `src/sync-scheduler.ts` | Journal wiring, recovery, per-path isolation, quarantine, `quarantinedPaths` |
| `src/sync-scheduler.test.ts` | Poison regression, recovery, quarantine |
| `src/git-manager.ts` | `commitSpecific` pathspec pre-filter |
| `src/git-manager.test.ts` | Partition tests |
| `src/index.ts` | Construct and inject journal; `quarantined_paths`, `remediation`, `report` in `buildSyncBlock` |
| `CHANGELOG.md` | Entry |
| `dist/` | **Not touched on this branch** — rebuilt once at integration |

## Risks

- **`.git/` squatting.** Writing tool state into `.git/` is an established pattern but not a git-sanctioned API. `git gc` will not touch it, and a fresh clone will not carry it — which is correct, since pending state is machine-local.
- **The journal records intent, not content.** It stores which paths were dirty, never their contents. This loses nothing: files are written to the vault before `markDirty` is ever called.
- **Rung 3 lets an agent write to a public tracker.** The redaction rule is the only thing keeping vault note titles out of it. If that instruction is ever weakened or dropped, the leak is silent and public.

## Out of scope

- Multi-server coordination over one vault. Already conflicts at the git level; the journal does not make it worse and does not fix it.
- Pushing recovered commits automatically at startup. Recovery restores pending state and lets the ordinary commit-then-push timers run.
- Changing the `unref()` behavior of the timers. The journal makes the existing behavior safe rather than requiring it to change.
- Groups A (#6, #10) and B (#4, #7) — separate specs.
