# Sync Durability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One bad path must never block the commit pipeline, pending commits must survive an unexpected process death, and a failure the server cannot fix itself must escalate to someone who can.

**Architecture:** Four layers. `GitManager.commitSpecific` filters pathspecs git cannot act on, so one phantom path stops aborting the batch. `SyncScheduler` gains a per-path isolation pass on repeated failure, quarantining only genuinely bad paths. A new `SyncJournal` persists the dirty set to `<vault>/.git/smart-connections-mcp/pending.json` on every `markDirty`, recovered at construction. Quarantine surfaces through the sync block as escalating hints.

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest with fake timers, Node `fs`, git CLI via `execFileSync`.

**Spec:** `docs/superpowers/specs/2026-08-07-sync-durability-design.md`

## Global Constraints

- **Branch:** `fix/sync-durability`. Already exists and already contains the spec commit. Do not create it.
- **NEVER run `npm run build`. NEVER stage `dist/`.** `dist/` is tracked (75 files) and all three parallel branches compile into it. A single integration commit rebuilds it after all three merge. Stage explicitly: `git add src/ docs/ CHANGELOG.md`. **Never `git add -A`.**
- **Never use `git commit -m` with PowerShell here-strings.** Use `git commit -F -` with a heredoc.
- Commit messages end with these two trailers:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01K4mPAWNTYd7DgX5zMuGLe6
  ```
- Run tests with `npx vitest run <path>`, all with `npx vitest run`. Typecheck with `npx tsc --noEmit` — **not** `npm run build`.
- The full suite is 143 tests before this plan and must stay green.
- `GitManager`'s repo root member is `this.vaultPath` (`src/git-manager.ts:20`). There is no `repoRoot`.
- Existing scheduler tests use `vi.useFakeTimers()` and a `makeGitOps()` fake (`src/sync-scheduler.test.ts:10-24`). Follow that pattern; do not invoke real git in scheduler tests.
- **All journal I/O is fail-soft.** A journal error must never propagate out of `markDirty`. Every filesystem call in `SyncJournal` is wrapped.
- **The redaction rule in the rung-3 hint is load-bearing.** The repository is public and vault note paths carry client names, project names, and personal note titles. The hint asks for a **count**, never the paths. Do not soften this.

---

### Task 1: Pathspec pre-filter in `GitManager`

**Files:**
- Modify: `src/git-manager.ts`
- Test: `src/git-manager.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `commitSpecific` behavior change only — no new exported symbol. A batch containing paths git cannot act on now commits the rest instead of failing wholesale.

- [ ] **Step 1: Confirm the path separator convention**

Run: `npx vitest run src/git-manager.test.ts`

Then read `toRelativePath` in `src/git-manager.ts` and confirm whether it emits forward slashes. `git ls-files` always emits forward slashes, and the new filter compares the two. If `toRelativePath` emits backslashes on Windows, normalize inside `committablePaths` with `.split(path.sep).join('/')` before comparing. Note which applies before writing Step 3.

- [ ] **Step 2: Write the failing test**

Append to `src/git-manager.test.ts`, following the repo-fixture pattern already used in that file:

```ts
describe('commitSpecific pathspec filtering', () => {
  it('commits real paths and ignores one that was never committed and no longer exists', () => {
    const repo = makeRepo();

    try {
      fs.writeFileSync(path.join(repo, 'Real.md'), '# real');

      const result = new GitManager(repo).commitSpecific(
        [path.join(repo, 'Real.md'), path.join(repo, 'Ghost.md')],
        'Auto-commit: Real.md, Ghost.md'
      );

      expect(result.success).toBe(true);
      expect(result.filesChanged).toContain('Real.md');
      expect(result.filesChanged).not.toContain('Ghost.md');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('reports no changes when every path is a phantom', () => {
    const repo = makeRepo();

    try {
      const result = new GitManager(repo).commitSpecific(
        [path.join(repo, 'Ghost.md')],
        'Auto-commit: Ghost.md'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('No changes to commit');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('stages the deletion of a tracked file that was removed', () => {
    const repo = makeRepo();

    try {
      fs.writeFileSync(path.join(repo, 'Tracked.md'), '# t');
      const git = new GitManager(repo);
      git.commitSpecific([path.join(repo, 'Tracked.md')], 'add');

      fs.rmSync(path.join(repo, 'Tracked.md'));
      const result = git.commitSpecific([path.join(repo, 'Tracked.md')], 'remove');

      expect(result.success).toBe(true);
      expect(result.filesChanged).toContain('Tracked.md');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
```

If `src/git-manager.test.ts` has no `makeRepo()` helper, add one that creates a temp dir, runs `git init`, and sets `user.name` / `user.email` locally — match whatever fixture style the file already uses.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/git-manager.test.ts`
Expected: FAIL on the first two cases — `git add -- Ghost.md` throws `pathspec 'Ghost.md' did not match any files`, so `commitSpecific` returns that error instead of committing `Real.md`.

- [ ] **Step 4: Add the filter helper**

In `src/git-manager.ts`, add this private method directly above `commitSpecific`:

```ts
  /**
   * Paths git can actually act on: present on disk, or tracked in the index so
   * a deletion can be staged. A path that is neither was created and deleted
   * before it was ever committed -- there is nothing to commit for it, and
   * passing it to `git add` aborts the entire batch on an unmatched pathspec.
   */
  private committablePaths(relativePaths: string[]): string[] {
    if (relativePaths.length === 0) {
      return [];
    }

    let tracked = new Set<string>();
    try {
      const listed = this.git(['ls-files', '--', ...relativePaths]);
      tracked = new Set(
        listed
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
      );
    } catch {
      // If ls-files fails, fall back to on-disk existence alone.
    }

    return relativePaths.filter(
      (relativePath) =>
        tracked.has(relativePath) || fs.existsSync(path.join(this.vaultPath, relativePath))
    );
  }
```

If Step 1 found that `toRelativePath` emits backslashes, normalize before the `tracked.has` comparison.

- [ ] **Step 5: Use it in `commitSpecific`**

In `src/git-manager.ts`, replace the body of the `try` block in `commitSpecific` (currently lines 143-165) so it reads:

```ts
    try {
      const relativePaths = filePaths.map((filePath) => this.toRelativePath(filePath));
      const committable = this.committablePaths(relativePaths);

      if (committable.length === 0) {
        return {
          success: false,
          filesChanged: [],
          message,
          error: 'No changes to commit',
        };
      }

      this.git(['add', '--', ...committable]);
      const filesChanged = this.getStagedFiles().filter((file) => committable.includes(file));

      if (filesChanged.length === 0) {
        return {
          success: false,
          filesChanged: [],
          message,
          error: 'No changes to commit',
        };
      }

      this.git([...this.getCommitArgs(message, authorName, authorEmail), '--only', '--', ...committable]);
      const commitHash = this.git(['rev-parse', '--short', 'HEAD']).trim();

      return {
        success: true,
        commitHash,
        filesChanged,
        message,
      };
    } catch (e) {
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/git-manager.test.ts`
Expected: PASS, including all pre-existing git-manager tests.

- [ ] **Step 7: Commit**

```bash
git add src/git-manager.ts src/git-manager.test.ts
git commit -F - <<'EOF'
fix: one unmatched pathspec no longer aborts the whole commit

A note created and deleted inside the same commit window was never
committed and no longer exists, so `git add -- <paths>` failed with
"pathspec did not match any files" -- and that failure aborted the entire
batch, not just the offending path.

commitSpecific now filters to paths git can act on: present on disk, or
tracked in the index so a deletion can be staged. Anything that is
neither has nothing to commit and is dropped. A batch of only such paths
returns the existing "No changes to commit".

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K4mPAWNTYd7DgX5zMuGLe6
EOF
```

---

### Task 2: The journal module

**Files:**
- Create: `src/sync-journal.ts`
- Create: `src/sync-journal.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface QuarantineEntry { path: string; error: string; since: string; survivedRestart: boolean; }`
  - `export interface JournalState { pending: string[]; quarantined: QuarantineEntry[]; }`
  - `export class SyncJournal { constructor(journalPath: string); read(): JournalState; write(state: JournalState): void; }`

  Task 3 imports all three.

- [ ] **Step 1: Write the failing tests**

Create `src/sync-journal.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SyncJournal } from './sync-journal.js';

function tempJournal(): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-'));
  return { dir, file: path.join(dir, 'nested', 'pending.json') };
}

describe('SyncJournal', () => {
  it('round-trips pending paths and quarantine entries', () => {
    const { dir, file } = tempJournal();

    try {
      const journal = new SyncJournal(file);
      journal.write({
        pending: ['A.md', 'B.md'],
        quarantined: [
          { path: 'Ghost.md', error: 'boom', since: '2026-08-07T10:00:00.000Z', survivedRestart: false },
        ],
      });

      const read = new SyncJournal(file).read();

      expect(read.pending).toEqual(['A.md', 'B.md']);
      expect(read.quarantined).toHaveLength(1);
      expect(read.quarantined[0].path).toBe('Ghost.md');
      expect(read.quarantined[0].survivedRestart).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates parent directories on write', () => {
    const { dir, file } = tempJournal();

    try {
      new SyncJournal(file).write({ pending: ['A.md'], quarantined: [] });
      expect(fs.existsSync(file)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns empty state when the file is absent', () => {
    const { dir, file } = tempJournal();

    try {
      expect(new SyncJournal(file).read()).toEqual({ pending: [], quarantined: [] });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns empty state for a truncated or malformed file', () => {
    const { dir, file } = tempJournal();

    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '{"pending": ["A.md"');

      expect(new SyncJournal(file).read()).toEqual({ pending: [], quarantined: [] });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('deletes the file when both lists are empty', () => {
    const { dir, file } = tempJournal();

    try {
      const journal = new SyncJournal(file);
      journal.write({ pending: ['A.md'], quarantined: [] });
      expect(fs.existsSync(file)).toBe(true);

      journal.write({ pending: [], quarantined: [] });
      expect(fs.existsSync(file)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not throw when the path is unwritable', () => {
    const journal = new SyncJournal(path.join(os.tmpdir(), 'journal-nul\u0000bad', 'pending.json'));

    expect(() => journal.write({ pending: ['A.md'], quarantined: [] })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sync-journal.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Create the module**

Create `src/sync-journal.ts`:

```ts
/**
 * Durable record of which vault paths are waiting to be committed.
 *
 * The scheduler holds its dirty set in memory behind unref'd timers, so a
 * SIGKILL, crash, or power loss would otherwise discard it: the files are
 * written to the vault but never committed, and nothing retries them. This
 * journal is what makes that state recoverable.
 *
 * Every filesystem call here is fail-soft. A journal error must never break a
 * note write -- losing durability is bad, losing the write is worse.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface QuarantineEntry {
  path: string;
  error: string;
  /** ISO 8601 timestamp of when this path was first quarantined. */
  since: string;
  /** True once this path has been quarantined in more than one session. */
  survivedRestart: boolean;
}

export interface JournalState {
  pending: string[];
  quarantined: QuarantineEntry[];
}

function emptyState(): JournalState {
  return { pending: [], quarantined: [] };
}

export class SyncJournal {
  private journalPath: string;

  constructor(journalPath: string) {
    this.journalPath = journalPath;
  }

  read(): JournalState {
    try {
      if (!fs.existsSync(this.journalPath)) {
        return emptyState();
      }

      const raw: unknown = JSON.parse(fs.readFileSync(this.journalPath, 'utf-8'));
      if (typeof raw !== 'object' || raw === null) {
        return emptyState();
      }

      const record = raw as Record<string, unknown>;
      const pending = Array.isArray(record.pending)
        ? record.pending.filter((value): value is string => typeof value === 'string')
        : [];

      const quarantined = Array.isArray(record.quarantined)
        ? record.quarantined
            .filter(
              (value): value is Record<string, unknown> =>
                typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).path === 'string'
            )
            .map((value) => ({
              path: String(value.path),
              error: typeof value.error === 'string' ? value.error : 'unknown error',
              since: typeof value.since === 'string' ? value.since : new Date().toISOString(),
              survivedRestart: value.survivedRestart === true,
            }))
        : [];

      return { pending, quarantined };
    } catch {
      // A truncated or malformed journal is not worth failing startup over.
      return emptyState();
    }
  }

  /** Always writes the complete current state. There is no partial update. */
  write(state: JournalState): void {
    try {
      if (state.pending.length === 0 && state.quarantined.length === 0) {
        if (fs.existsSync(this.journalPath)) {
          fs.rmSync(this.journalPath);
        }
        return;
      }

      fs.mkdirSync(path.dirname(this.journalPath), { recursive: true });
      fs.writeFileSync(
        this.journalPath,
        JSON.stringify(
          {
            version: 1,
            updatedAt: new Date().toISOString(),
            pending: state.pending,
            quarantined: state.quarantined,
          },
          null,
          2
        ),
        'utf-8'
      );
    } catch (error) {
      console.error(
        `Sync journal write failed (continuing without durability): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/sync-journal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sync-journal.ts src/sync-journal.test.ts
git commit -F - <<'EOF'
feat: add a durable journal for pending commits

Scheduler state lived entirely in memory behind unref'd timers, so a
SIGKILL, crash, or power loss discarded the dirty set: files were written
to the vault but never committed, and nothing retried them. flushSync
only runs on SIGINT, SIGTERM, or stdin close.

The journal always writes complete state -- there is no partial update
and no clear() verb, because quarantine must outlive a successful commit
of unrelated paths and a clear() would have made that ambiguous. All I/O
is fail-soft: a journal error must never break a note write.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K4mPAWNTYd7DgX5zMuGLe6
EOF
```

---

### Task 3: Wire the journal into the scheduler

**Files:**
- Modify: `src/sync-scheduler.ts`
- Test: `src/sync-scheduler.test.ts`

**Interfaces:**
- Consumes: `SyncJournal`, `JournalState`, `QuarantineEntry` from Task 2.
- Produces: `SyncSchedulerOptions.journal?: SyncJournal`. Existing callers that pass no journal are unchanged and perform no I/O.

- [ ] **Step 1: Write the failing tests**

Append to `src/sync-scheduler.test.ts`:

```ts
describe('SyncScheduler journal persistence', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('records dirty paths and clears them after a successful commit', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-'));
    const file = path.join(dir, 'pending.json');

    try {
      const journal = new SyncJournal(file);
      const scheduler = new SyncScheduler(makeGitOps(), { journal });

      scheduler.markDirty('A.md');
      expect(new SyncJournal(file).read().pending).toEqual(['A.md']);

      vi.advanceTimersByTime(30_000);
      expect(new SyncJournal(file).read().pending).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('recovers pending paths from an interrupted session and commits them', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-'));
    const file = path.join(dir, 'pending.json');

    try {
      const killed = new SyncScheduler(makeGitOps(), { journal: new SyncJournal(file) });
      killed.markDirty('Survivor.md');
      // Process dies here: no flushSync, no commit.

      const gitOps = makeGitOps();
      new SyncScheduler(gitOps, { journal: new SyncJournal(file) });

      vi.advanceTimersByTime(30_000);
      expect(gitOps.commits).toEqual([['Survivor.md']]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('works with no journal configured', () => {
    const gitOps = makeGitOps();
    const scheduler = new SyncScheduler(gitOps);

    scheduler.markDirty('A.md');
    vi.advanceTimersByTime(30_000);

    expect(gitOps.commits).toEqual([['A.md']]);
  });
});
```

Add these imports to the top of `src/sync-scheduler.test.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SyncJournal } from './sync-journal.js';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sync-scheduler.test.ts`
Expected: FAIL — `SyncSchedulerOptions` has no `journal` property.

- [ ] **Step 3: Add the option, fields, and recovery**

In `src/sync-scheduler.ts`, add the import:

```ts
import type { SyncJournal, QuarantineEntry } from './sync-journal.js';
```

Add to `SyncSchedulerOptions`:

```ts
  journal?: SyncJournal;
```

Add to the class fields, after `private pushState?: ...` (currently line 52):

```ts
  private journal?: SyncJournal;
  private quarantined = new Map<string, QuarantineEntry>();
  private previouslyQuarantined = new Set<string>();
```

At the end of the constructor body, after `this.onIdleFlush = options.onIdleFlush;`:

```ts
    this.journal = options.journal;
    this.recoverFromJournal();
```

Add these two private methods at the end of the class, before the closing brace:

```ts
  /** Write the complete current state. Fail-soft inside SyncJournal. */
  private persist(): void {
    this.journal?.write({
      pending: Array.from(this.dirtyPaths),
      quarantined: Array.from(this.quarantined.values()),
    });
  }

  /**
   * Restore state left by a session that died before flushing.
   *
   * Quarantined paths are put back into the dirty set rather than left
   * quarantined: a restart may well have cleared the cause, such as a stale
   * index.lock. They are remembered so that failing *again* marks them as
   * having survived a restart, which is what escalates to the report hint.
   */
  private recoverFromJournal(): void {
    if (!this.journal) {
      return;
    }

    const state = this.journal.read();
    if (state.pending.length === 0 && state.quarantined.length === 0) {
      return;
    }

    for (const notePath of state.pending) {
      this.dirtyPaths.add(notePath);
    }

    for (const entry of state.quarantined) {
      this.previouslyQuarantined.add(entry.path);
      this.dirtyPaths.add(entry.path);
    }

    console.error(
      `Recovered ${this.dirtyPaths.size} pending path(s) from an interrupted session`
    );
    this.scheduleCommit(this.commitIdleMs);
  }
```

- [ ] **Step 4: Persist at every state transition**

In `src/sync-scheduler.ts`, add `this.persist();` as the last statement of:

- `markDirty` — after `this.scheduleCommit(delay);`
- `notifyManualCommit` — after `this.startPushTimer();`

And inside `fireCommit`, add `this.persist();` at the end of each of the three branches (`result.success`, `'No changes to commit'`, and the else branch).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/sync-scheduler.test.ts`
Expected: PASS, including all pre-existing scheduler tests — they construct `new SyncScheduler(gitOps)` with no journal, so `persist()` and `recoverFromJournal()` are no-ops for them.

- [ ] **Step 6: Commit**

```bash
git add src/sync-scheduler.ts src/sync-scheduler.test.ts
git commit -F - <<'EOF'
feat: persist and recover the scheduler's pending set

The dirty set is now written to the journal on every state transition and
restored when a scheduler is constructed, so a session killed before
flushSync no longer strands uncommitted vault changes.

This also retroactively justifies the unref'd timers: previously a timer
that never fired meant its state was lost, and now it means the state is
recoverable, so the timers stay unref'd.

Recovered quarantine entries go back into the dirty set rather than
staying quarantined, since a restart may have cleared the cause. They are
remembered so that failing again marks them as having survived a restart.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K4mPAWNTYd7DgX5zMuGLe6
EOF
```

---

### Task 4: Per-path isolation and quarantine

**Files:**
- Modify: `src/sync-scheduler.ts`
- Test: `src/sync-scheduler.test.ts`

**Interfaces:**
- Consumes: `persist()` and the quarantine fields from Task 3.
- Produces: `SyncStatus.quarantinedPaths: string[]` and `SyncStatus.quarantineSurvivedRestart: boolean`. Task 5 reads both.

- [ ] **Step 1: Write the failing tests**

Append to `src/sync-scheduler.test.ts`:

```ts
describe('SyncScheduler quarantine', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function failingFor(badPath: string) {
    const commits: string[][] = [];
    const ops: SyncGitOps = {
      commitPaths(paths, message) {
        commits.push([...paths]);
        if (paths.includes(badPath)) {
          return { success: false, filesChanged: [], message, error: `cannot commit ${badPath}` };
        }
        return { success: true, commitHash: 'abc', filesChanged: paths, message };
      },
      push: () => ({ success: true, branch: 'main', localFallback: false }),
    };
    return { ops, commits };
  }

  it('quarantines only the failing path and commits the rest', () => {
    const { ops } = failingFor('Bad.md');
    const scheduler = new SyncScheduler(ops);

    scheduler.markDirty('Good.md');
    scheduler.markDirty('Bad.md');

    vi.advanceTimersByTime(30_000); // first failure -> one retry scheduled
    vi.advanceTimersByTime(30_000); // second failure -> isolation pass

    const status = scheduler.getStatus();
    expect(status.quarantinedPaths).toEqual(['Bad.md']);
    expect(status.pendingPaths).not.toContain('Bad.md');
  });

  it('keeps committing new writes while a path is quarantined', () => {
    const { ops, commits } = failingFor('Bad.md');
    const scheduler = new SyncScheduler(ops);

    scheduler.markDirty('Bad.md');
    vi.advanceTimersByTime(30_000);
    vi.advanceTimersByTime(30_000);

    commits.length = 0;
    scheduler.markDirty('Later.md');
    vi.advanceTimersByTime(30_000);

    expect(commits).toEqual([['Later.md']]);
  });

  it('marks a quarantined path that survived a restart', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-q-'));
    const file = path.join(dir, 'pending.json');

    try {
      const first = failingFor('Bad.md');
      const one = new SyncScheduler(first.ops, { journal: new SyncJournal(file) });
      one.markDirty('Bad.md');
      vi.advanceTimersByTime(30_000);
      vi.advanceTimersByTime(30_000);
      expect(one.getStatus().quarantineSurvivedRestart).toBe(false);

      const second = failingFor('Bad.md');
      const two = new SyncScheduler(second.ops, { journal: new SyncJournal(file) });
      vi.advanceTimersByTime(30_000);
      vi.advanceTimersByTime(30_000);

      expect(two.getStatus().quarantinedPaths).toEqual(['Bad.md']);
      expect(two.getStatus().quarantineSurvivedRestart).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sync-scheduler.test.ts`
Expected: FAIL — `quarantinedPaths` is not on `SyncStatus`.

- [ ] **Step 3: Extend `SyncStatus`**

In `src/sync-scheduler.ts`, add to the `SyncStatus` interface:

```ts
  quarantinedPaths: string[];
  quarantineSurvivedRestart: boolean;
```

- [ ] **Step 4: Report them from `getStatus`**

In `getStatus()`, add to the returned object:

```ts
      quarantinedPaths: Array.from(this.quarantined.keys()),
      quarantineSurvivedRestart: Array.from(this.quarantined.values()).some(
        (entry) => entry.survivedRestart
      ),
```

- [ ] **Step 5: Add the isolation pass**

In `src/sync-scheduler.ts`, add this private method after `fireCommit`:

```ts
  /**
   * A batch commit failure does not say which path caused it -- commitPaths
   * fails as a unit. Rather than blame the whole batch, retry each path alone:
   * the ones that can commit do, and only the ones that genuinely cannot are
   * quarantined. Bounded -- N git calls, once, on a repeated failure.
   */
  private isolateAndQuarantine(paths: string[], batchError: string): void {
    let anyCommitted = false;

    for (const notePath of paths) {
      let ok = false;
      let error = batchError;

      try {
        const single = this.gitOps.commitPaths([notePath], `Auto-commit: ${notePath}`);
        ok = single.success || single.error === 'No changes to commit';
        if (!ok) {
          error = single.error ?? batchError;
        }
      } catch (thrown) {
        error = thrown instanceof Error ? thrown.message : String(thrown);
      }

      this.dirtyPaths.delete(notePath);

      if (ok) {
        anyCommitted = true;
        this.quarantined.delete(notePath);
      } else {
        this.quarantined.set(notePath, {
          path: notePath,
          error,
          since: this.quarantined.get(notePath)?.since ?? new Date().toISOString(),
          survivedRestart: this.previouslyQuarantined.has(notePath),
        });
      }
    }

    this.commitRetried = false;

    if (anyCommitted) {
      this.startPushTimer();
    }
  }
```

- [ ] **Step 6: Call it on the second failure**

In `fireCommit`, replace the final `else` branch (currently lines 180-186) with:

```ts
    } else {
      this.lastCommitError = result.error;

      if (!this.commitRetried) {
        this.commitRetried = true;
        this.scheduleCommit(this.commitIdleMs);
      } else {
        this.isolateAndQuarantine(paths, result.error ?? 'unknown error');
      }

      this.persist();
    }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/sync-scheduler.test.ts`
Expected: PASS. Pre-existing tests that assert on `getStatus()` may need the two new fields added to their expected objects — if a test uses `toEqual` on the whole status, update it; do not weaken it to `toMatchObject`.

- [ ] **Step 8: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/sync-scheduler.ts src/sync-scheduler.test.ts
git commit -F - <<'EOF'
fix: quarantine only the paths that genuinely cannot commit

fireCommit never cleared dirtyPaths on a hard failure, so a path git
could not act on stayed in the set for the process lifetime -- and since
markDirty resets commitRetried, every subsequent write scheduled a commit
that re-included it and failed identically. After a single delete, no
note auto-committed again until restart.

A batch failure does not reveal which path caused it, so on the second
consecutive failure each path is now retried alone. Those that can commit
do; only those that cannot are quarantined and removed from the dirty
set. One bad path can no longer block the pipeline, and quarantine never
punishes innocent paths.

Closes #5

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K4mPAWNTYd7DgX5zMuGLe6
EOF
```

---

### Task 5: Construct the journal and surface the escalation hints

**Files:**
- Modify: `src/index.ts`
- Test: `src/index.test.ts`

**Interfaces:**
- Consumes: `SyncJournal` from Task 2, `SyncStatus.quarantinedPaths` / `quarantineSurvivedRestart` from Task 4.
- Produces: exported `buildRemediationHint` and `buildReportHint` so they are testable without importing `src/index.ts`, which has top-level side effects. **Put both in a new `src/sync-hints.ts`** rather than exporting from `index.ts`.

- [ ] **Step 1: Write the failing tests**

Create `src/sync-hints.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildRemediationHint, buildReportHint } from './sync-hints.js';

describe('sync escalation hints', () => {
  it('names the vault path and the error in the remediation hint', () => {
    const hint = buildRemediationHint('C:/obsidian/mb-kb', "cannot lock ref 'HEAD'");

    expect(hint).toContain('C:/obsidian/mb-kb');
    expect(hint).toContain("cannot lock ref 'HEAD'");
    expect(hint).toContain('git_commit_notes');
  });

  it('forbids destructive recovery in the remediation hint', () => {
    const hint = buildRemediationHint('C:/obsidian/mb-kb', 'boom');

    expect(hint).toContain('reset --hard');
    expect(hint).toMatch(/do not/i);
  });

  it('reports a count and never the paths', () => {
    const hint = buildReportHint('boom', ['Memory/pro-wms/Secret Client.md', 'Memory/private.md']);

    expect(hint).toContain('2');
    expect(hint).not.toContain('Secret Client');
    expect(hint).not.toContain('Memory/private.md');
    expect(hint).not.toContain('Memory/pro-wms');
  });

  it('tells the agent to search before opening a duplicate', () => {
    const hint = buildReportHint('boom', ['A.md']);

    expect(hint).toContain('gh issue list');
    expect(hint).toContain('mvdbastos/smart-connections-mcp');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/sync-hints.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Create the hints module**

Create `src/sync-hints.ts`:

```ts
/**
 * Escalation hints for sync failures the server cannot fix itself.
 *
 * The server cannot clear a stale index.lock or repair a failing hook; the
 * agent reading these hints can. Both are surfaced through the sync block,
 * following the NEXT_STEPS_TEXT precedent.
 */

const ISSUE_TRACKER = 'mvdbastos/smart-connections-mcp';

/**
 * Deliberately bounded: named causes with exact commands, and an explicit
 * prohibition on destructive recovery. An open mandate to "fix git" in the
 * repository holding the user's notes invites an agent to reach for
 * `reset --hard` and destroy uncommitted vault edits.
 */
export function buildRemediationHint(vaultRoot: string, error: string): string {
  return [
    `Auto-commit is blocked in ${vaultRoot}.`,
    `Error: ${error}`,
    '',
    `Diagnose:  git -C ${vaultRoot} status`,
    '',
    'Likely causes:',
    `  1. stale lock     -> remove ${vaultRoot}/.git/index.lock if no git process is running`,
    `  2. failing hook   -> git -C ${vaultRoot} commit  to see hook output`,
    `  3. detached HEAD  -> git -C ${vaultRoot} switch main`,
    '',
    'Do NOT run reset --hard, checkout -- ., or clean — uncommitted vault edits would be lost.',
    'If none of these apply, stop and report rather than improvising.',
    '',
    'Then call git_commit_notes to resume.',
  ].join('\n');
}

/**
 * Only reachable once a failure has survived a restart, which is a high
 * enough bar to justify touching a public tracker.
 *
 * Takes the quarantined paths solely to count them. They are never included:
 * the repository is public and vault note paths carry client names, project
 * names, and personal note titles.
 */
export function buildReportHint(error: string, quarantinedPaths: string[]): string {
  return [
    'This failure survived a restart and is likely a bug in smart-connections-mcp.',
    '',
    'Search existing issues first:',
    `  gh issue list -R ${ISSUE_TRACKER} --search "${error.replace(/"/g, "'")}"`,
    '',
    'Update the matching issue if one exists; otherwise open a new one.',
    '',
    `Include: the git error text, git --version, your OS, and the number of quarantined paths (${quarantinedPaths.length}).`,
    'Do NOT include note paths, note titles, or vault contents — this repository is public.',
  ].join('\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/sync-hints.test.ts`
Expected: PASS.

- [ ] **Step 5: Construct the journal in `src/index.ts`**

Find where `syncScheduler` is constructed (around line 96, where `commitPaths` and `push` are wired). Add the import:

```ts
import { SyncJournal } from './sync-journal.js';
import { buildRemediationHint, buildReportHint } from './sync-hints.js';
```

Then pass a journal in the options object of the `new SyncScheduler(...)` call:

```ts
  journal: new SyncJournal(path.join(VAULT_ROOT, '.git', 'smart-connections-mcp', 'pending.json')),
```

- [ ] **Step 6: Surface the hints in `buildSyncBlock`**

In `src/index.ts`, replace `buildSyncBlock` (currently lines 109-122) with:

```ts
function buildSyncBlock(status: SyncStatus, deferred: boolean): Record<string, unknown> {
  const state = status.state === 'commit_pending'
    ? (deferred ? 'commit_deferred' : 'commit_scheduled')
    : status.state;

  const quarantined = status.quarantinedPaths.length > 0;
  const remediation = quarantined
    ? buildRemediationHint(VAULT_ROOT, status.lastCommitError ?? 'unknown error')
    : undefined;
  const report = quarantined && status.quarantineSurvivedRestart
    ? buildReportHint(status.lastCommitError ?? 'unknown error', status.quarantinedPaths)
    : undefined;

  return {
    state,
    commit_in_seconds: status.commitInSeconds,
    pending_paths: status.pendingPaths,
    push_after_commit_seconds: Math.round(PUSH_IDLE_MS / 1000),
    ...(status.lastCommitError ? { error: status.lastCommitError } : {}),
    ...(status.pushState ? { push_state: status.pushState } : {}),
    ...(quarantined ? { quarantined_paths: status.quarantinedPaths } : {}),
    ...(remediation ? { remediation } : {}),
    ...(report ? { report } : {}),
  };
}
```

- [ ] **Step 7: Typecheck and run the full suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Verify `dist/` was not touched**

Run: `git status --short`
Expected: only `src/` files. If `dist/` appears, run `git checkout -- dist/`.

- [ ] **Step 9: Commit**

```bash
git add src/sync-hints.ts src/sync-hints.test.ts src/index.ts
git commit -F - <<'EOF'
feat: escalate sync failures the server cannot fix itself

The server cannot clear a stale index.lock or repair a failing hook, but
the agent reading the sync block can. Quarantine now surfaces a bounded
remediation hint naming the vault path and the exact error, with specific
commands and an explicit prohibition on destructive recovery -- an open
mandate to "fix git" in the repository holding the user's notes invites
reset --hard.

Once a failure has survived a restart it is a durable bug rather than a
transient lock, and a second hint points at the issue tracker. That hint
carries a count of quarantined paths and never the paths themselves: the
repository is public and vault note paths carry client names, project
names, and personal note titles.

The vault path is interpolated into the remediation hint rather than
referred to generically, which is the direct lesson of issue #10.

Closes #8

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K4mPAWNTYd7DgX5zMuGLe6
EOF
```

---

### Task 6: Document the behavior change

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Read the existing format**

Run: `head -40 CHANGELOG.md`

- [ ] **Step 2: Add the entry**

Add at the top of the version list. Content to convey:

- **Fixed:** a note created and deleted within the same commit window no longer blocks every later auto-commit. Previously the unmatched pathspec aborted the whole batch and the path was never cleared, so no note auto-committed again until restart (#5).
- **Fixed:** pending commits now survive an unexpected process death. The dirty set is journalled to `<vault>/.git/smart-connections-mcp/pending.json` and recovered at startup (#8).
- **Added:** paths that repeatedly fail to commit are quarantined individually rather than blocking the pipeline, and reported in the `sync` block as `quarantined_paths`.
- **Added:** `remediation` and `report` hints in the `sync` block guiding recovery from a blocked commit.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -F - <<'EOF'
docs: record the sync durability changes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K4mPAWNTYd7DgX5zMuGLe6
EOF
```

---

## Done criteria

- [ ] `npx vitest run` passes; total is 143 + 19 new tests.
- [ ] `npx tsc --noEmit` reports no errors.
- [ ] `git status --short` is clean and `dist/` was never staged.
- [ ] The `buildReportHint` test asserting no path leaks into the hint passes — this is the one that keeps vault note titles out of a public tracker.
- [ ] Creating and deleting a note in one window, then writing another note, results in the second note committing.
