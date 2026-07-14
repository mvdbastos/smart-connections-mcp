# Workflow & Sync Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `note_workflow` composite tool, an idle-debounced auto commit/push scheduler, opt-in deprecated-tool usage logging, and `include_content` search results to the smart-connections-mcp server.

**Architecture:** A global `SyncScheduler` sits at the write layer: every successful note write (via `note_workflow` or the deprecated direct tools) marks paths dirty and debounces an auto-commit (30s idle) followed by an auto-push (2min idle). `note_workflow` wraps the existing `note-writer.ts` functions plus embedding refresh in one call and returns a self-describing `sync` block. A `UsageLog` (opt-in `--log-usage` CLI flag) queues deprecated-tool calls in memory and flushes to disk only during the scheduler's idle window.

**Tech Stack:** TypeScript (ESM, NodeNext — all relative imports need the `.js` suffix), Node 18+, `@modelcontextprotocol/sdk`, zod v3, vitest 2 (fake timers via `vi.useFakeTimers()`).

**Spec:** `docs/superpowers/specs/2026-07-14-mcp-workflow-sync-design.md`

## Global Constraints

- Env vars: `SYNC_COMMIT_IDLE_MS` (default `30000`), `SYNC_PUSH_IDLE_MS` (default `120000`).
- Defer hint cap: 30 minutes (`1800` seconds max in the schema; `1_800_000` ms in the scheduler).
- CLI flag: `--log-usage` (default path `<package-root>/logs/mcp-tool-usage.log`) or `--log-usage=<path>`. When absent, no logging code runs.
- Deprecated tool description prefix, verbatim: `[DEPRECATED — prefer note_workflow] `.
- Deprecated tools (7): `create_note`, `edit_note`, `delete_note`, `git_commit_notes`, `git_commit_notes_specific`, `git_push_notes`, `git_sync_notes`. All stay fully functional.
- Scheduler failures must never fail a write call: writes return `written: true` plus sync status, never an error, when only the scheduler misbehaves.
- `include_content` defaults to `false`; `content_max_chars` defaults to `2000`.
- Existing tests must keep passing (`npm test`); `npm run build` must pass after every task.
- Commit after every task (this repo's branch is `git-integration`).

---

### Task 1: SyncScheduler debounce core

**Files:**
- Create: `src/sync-scheduler.ts`
- Test: `src/sync-scheduler.test.ts`

**Interfaces:**
- Consumes: `GitCommitResult`, `GitPushResult` from `src/types.ts` (already exist).
- Produces (later tasks rely on these exact names):
  - `interface SyncGitOps { commitPaths(paths: string[], message: string): GitCommitResult; push(): GitPushResult }`
  - `class SyncScheduler { constructor(gitOps: SyncGitOps, options?: SyncSchedulerOptions); markDirty(notePath: string, deferHintSeconds?: number): void; getStatus(): SyncStatus }`
  - `interface SyncStatus { state: 'idle' | 'commit_pending' | 'push_pending'; pendingPaths: string[]; commitInSeconds: number | null; pushInSeconds: number | null; lastCommitError?: string; pushState?: 'pushed' | 'local_fallback' }`
  - `interface SyncSchedulerOptions { commitIdleMs?: number; pushIdleMs?: number; maxDeferMs?: number; onIdleFlush?: () => void }`

- [ ] **Step 1: Write the failing tests**

Create `src/sync-scheduler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncScheduler } from './sync-scheduler.js';
import type { SyncGitOps } from './sync-scheduler.js';

interface FakeGitOps extends SyncGitOps {
  commits: string[][];
  pushes: number;
}

function makeGitOps(): FakeGitOps {
  const fake: FakeGitOps = {
    commits: [],
    pushes: 0,
    commitPaths(paths, message) {
      fake.commits.push([...paths]);
      return { success: true, commitHash: 'abc123', filesChanged: paths, message };
    },
    push() {
      fake.pushes += 1;
      return { success: true, branch: 'main', localFallback: false };
    },
  };
  return fake;
}

describe('SyncScheduler debounce core', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('commits dirty paths after the commit idle window', () => {
    const gitOps = makeGitOps();
    const scheduler = new SyncScheduler(gitOps);

    scheduler.markDirty('A.md');
    vi.advanceTimersByTime(29_999);
    expect(gitOps.commits).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(gitOps.commits).toEqual([['A.md']]);
  });

  it('resets the commit timer on each new write and batches paths', () => {
    const gitOps = makeGitOps();
    const scheduler = new SyncScheduler(gitOps);

    scheduler.markDirty('A.md');
    vi.advanceTimersByTime(20_000);
    scheduler.markDirty('B.md');
    vi.advanceTimersByTime(20_000);
    expect(gitOps.commits).toHaveLength(0);

    vi.advanceTimersByTime(10_000);
    expect(gitOps.commits).toEqual([['A.md', 'B.md']]);
  });

  it('pushes after the push idle window following an auto-commit', () => {
    const gitOps = makeGitOps();
    const scheduler = new SyncScheduler(gitOps);

    scheduler.markDirty('A.md');
    vi.advanceTimersByTime(30_000);
    expect(gitOps.commits).toHaveLength(1);
    expect(gitOps.pushes).toBe(0);

    vi.advanceTimersByTime(119_999);
    expect(gitOps.pushes).toBe(0);

    vi.advanceTimersByTime(1);
    expect(gitOps.pushes).toBe(1);
  });

  it('cancels a pending push when a new write arrives, then recommits and pushes once', () => {
    const gitOps = makeGitOps();
    const scheduler = new SyncScheduler(gitOps);

    scheduler.markDirty('A.md');
    vi.advanceTimersByTime(30_000);
    scheduler.markDirty('B.md');
    vi.advanceTimersByTime(30_000);
    expect(gitOps.commits).toEqual([['A.md'], ['B.md']]);
    expect(gitOps.pushes).toBe(0);

    vi.advanceTimersByTime(120_000);
    expect(gitOps.pushes).toBe(1);
  });

  it('reports state transitions in getStatus', () => {
    const gitOps = makeGitOps();
    const scheduler = new SyncScheduler(gitOps);

    expect(scheduler.getStatus().state).toBe('idle');

    scheduler.markDirty('A.md');
    const pending = scheduler.getStatus();
    expect(pending.state).toBe('commit_pending');
    expect(pending.pendingPaths).toEqual(['A.md']);
    expect(pending.commitInSeconds).toBeGreaterThan(0);
    expect(pending.commitInSeconds).toBeLessThanOrEqual(30);

    vi.advanceTimersByTime(30_000);
    const pushing = scheduler.getStatus();
    expect(pushing.state).toBe('push_pending');
    expect(pushing.pendingPaths).toEqual([]);
    expect(pushing.pushInSeconds).toBeGreaterThan(0);

    vi.advanceTimersByTime(120_000);
    expect(scheduler.getStatus().state).toBe('idle');
    expect(scheduler.getStatus().pushState).toBe('pushed');
  });

  it('respects custom idle windows', () => {
    const gitOps = makeGitOps();
    const scheduler = new SyncScheduler(gitOps, { commitIdleMs: 1_000, pushIdleMs: 2_000 });

    scheduler.markDirty('A.md');
    vi.advanceTimersByTime(1_000);
    expect(gitOps.commits).toHaveLength(1);
    vi.advanceTimersByTime(2_000);
    expect(gitOps.pushes).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- sync-scheduler`
Expected: FAIL — cannot resolve `./sync-scheduler.js`.

- [ ] **Step 3: Write the implementation**

Create `src/sync-scheduler.ts`:

```typescript
/**
 * Idle-debounced auto commit/push scheduler.
 *
 * Every successful note write marks paths dirty and (re)starts a commit
 * timer. When the vault has been idle for the commit window, dirty paths are
 * committed; a push timer then fires after a further idle window.
 */

import type { GitCommitResult, GitPushResult } from './types.js';

export interface SyncGitOps {
  commitPaths(paths: string[], message: string): GitCommitResult;
  push(): GitPushResult;
}

export type SyncState = 'idle' | 'commit_pending' | 'push_pending';

export interface SyncStatus {
  state: SyncState;
  pendingPaths: string[];
  commitInSeconds: number | null;
  pushInSeconds: number | null;
  lastCommitError?: string;
  pushState?: 'pushed' | 'local_fallback';
}

export interface SyncSchedulerOptions {
  commitIdleMs?: number;
  pushIdleMs?: number;
  maxDeferMs?: number;
  onIdleFlush?: () => void;
}

const DEFAULT_COMMIT_IDLE_MS = 30_000;
const DEFAULT_PUSH_IDLE_MS = 120_000;
const DEFAULT_MAX_DEFER_MS = 30 * 60_000;

export class SyncScheduler {
  private gitOps: SyncGitOps;
  private commitIdleMs: number;
  private pushIdleMs: number;
  private maxDeferMs: number;
  private onIdleFlush?: () => void;

  private dirtyPaths = new Set<string>();
  private commitTimer: NodeJS.Timeout | null = null;
  private pushTimer: NodeJS.Timeout | null = null;
  private commitDeadline = 0;
  private pushDeadline = 0;
  private commitRetried = false;
  private lastCommitError?: string;
  private pushState?: 'pushed' | 'local_fallback';

  constructor(gitOps: SyncGitOps, options: SyncSchedulerOptions = {}) {
    this.gitOps = gitOps;
    this.commitIdleMs = options.commitIdleMs ?? DEFAULT_COMMIT_IDLE_MS;
    this.pushIdleMs = options.pushIdleMs ?? DEFAULT_PUSH_IDLE_MS;
    this.maxDeferMs = options.maxDeferMs ?? DEFAULT_MAX_DEFER_MS;
    this.onIdleFlush = options.onIdleFlush;
  }

  markDirty(notePath: string, deferHintSeconds?: number): void {
    this.dirtyPaths.add(notePath);
    this.cancelPushTimer();
    this.commitRetried = false;

    let delay = this.commitIdleMs;
    if (deferHintSeconds !== undefined) {
      const hintMs = Math.min(deferHintSeconds * 1000, this.maxDeferMs);
      const remaining = this.commitTimer ? Math.max(this.commitDeadline - Date.now(), 0) : 0;
      delay = Math.max(this.commitIdleMs, hintMs, remaining);
    }

    this.scheduleCommit(delay);
  }

  getStatus(): SyncStatus {
    const now = Date.now();
    const state: SyncState = this.commitTimer || this.dirtyPaths.size > 0
      ? 'commit_pending'
      : this.pushTimer
        ? 'push_pending'
        : 'idle';

    return {
      state,
      pendingPaths: Array.from(this.dirtyPaths),
      commitInSeconds: this.commitTimer ? Math.ceil(Math.max(this.commitDeadline - now, 0) / 1000) : null,
      pushInSeconds: this.pushTimer ? Math.ceil(Math.max(this.pushDeadline - now, 0) / 1000) : null,
      lastCommitError: this.lastCommitError,
      pushState: this.pushState,
    };
  }

  private scheduleCommit(delayMs: number): void {
    this.cancelCommitTimer();
    this.commitDeadline = Date.now() + delayMs;
    this.commitTimer = setTimeout(() => this.fireCommit(), delayMs);
    this.unrefTimer(this.commitTimer);
  }

  private startPushTimer(): void {
    this.cancelPushTimer();
    this.pushDeadline = Date.now() + this.pushIdleMs;
    this.pushTimer = setTimeout(() => this.firePush(), this.pushIdleMs);
    this.unrefTimer(this.pushTimer);
  }

  private fireCommit(): void {
    this.commitTimer = null;
    const paths = Array.from(this.dirtyPaths);
    const head = paths.slice(0, 3).join(', ');
    const suffix = paths.length > 3 ? ` (+${paths.length - 3} more)` : '';
    const message = `Auto-commit: ${head}${suffix}`;

    let result: GitCommitResult;
    try {
      result = this.gitOps.commitPaths(paths, message);
    } catch (error) {
      result = {
        success: false,
        filesChanged: [],
        message,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      this.onIdleFlush?.();
    } catch {
      // Usage-log flushing must never break the sync path.
    }

    if (result.success) {
      this.dirtyPaths.clear();
      this.commitRetried = false;
      this.lastCommitError = undefined;
      this.startPushTimer();
    } else if (result.error === 'No changes to commit') {
      this.dirtyPaths.clear();
      this.commitRetried = false;
      this.lastCommitError = undefined;
    } else {
      this.lastCommitError = result.error;
      if (!this.commitRetried) {
        this.commitRetried = true;
        this.scheduleCommit(this.commitIdleMs);
      }
    }
  }

  private firePush(): void {
    this.pushTimer = null;
    try {
      const result = this.gitOps.push();
      this.pushState = result.success ? 'pushed' : 'local_fallback';
    } catch {
      this.pushState = 'local_fallback';
    }
  }

  private cancelCommitTimer(): void {
    if (this.commitTimer) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
  }

  private cancelPushTimer(): void {
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
  }

  private unrefTimer(timer: NodeJS.Timeout): void {
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- sync-scheduler`
Expected: PASS (6 tests).

- [ ] **Step 5: Build and run the full suite**

Run: `npm run build && npm test`
Expected: build clean, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/sync-scheduler.ts src/sync-scheduler.test.ts
git commit -m "feat(sync): add idle-debounced commit/push scheduler core"
```

---

### Task 2: SyncScheduler defer hints, manual notifications, failure retry, shutdown flush

**Files:**
- Modify: `src/sync-scheduler.ts` (add methods to the class from Task 1)
- Test: `src/sync-scheduler.test.ts` (append new describe block)

**Interfaces:**
- Consumes: everything Task 1 produced.
- Produces (Task 6/7 rely on these exact names):
  - `SyncScheduler.notifyManualCommit(): void` — call after a manual git commit tool succeeds.
  - `SyncScheduler.notifyManualPush(): void` — call after a manual push/sync tool succeeds.
  - `SyncScheduler.flushSync(): void` — synchronous best-effort commit + push for shutdown.

- [ ] **Step 1: Write the failing tests**

Append to `src/sync-scheduler.test.ts` (reuse the existing `makeGitOps` helper and fake-timer hooks):

```typescript
describe('SyncScheduler defer hints, manual flush, failures, shutdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('extends the commit window with defer_hint_seconds', () => {
    const gitOps = makeGitOps();
    const scheduler = new SyncScheduler(gitOps);

    scheduler.markDirty('A.md', 300);
    vi.advanceTimersByTime(299_999);
    expect(gitOps.commits).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(gitOps.commits).toHaveLength(1);
  });

  it('caps defer hints at maxDeferMs', () => {
    const gitOps = makeGitOps();
    const scheduler = new SyncScheduler(gitOps, { maxDeferMs: 60_000 });

    scheduler.markDirty('A.md', 999_999);
    vi.advanceTimersByTime(60_000);
    expect(gitOps.commits).toHaveLength(1);
  });

  it('never shrinks the remaining window when a smaller hint arrives', () => {
    const gitOps = makeGitOps();
    const scheduler = new SyncScheduler(gitOps);

    scheduler.markDirty('A.md', 300);
    vi.advanceTimersByTime(10_000);
    scheduler.markDirty('B.md', 60);

    vi.advanceTimersByTime(289_999);
    expect(gitOps.commits).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(gitOps.commits).toEqual([['A.md', 'B.md']]);
  });

  it('resets to the default window on a plain write after a hint', () => {
    const gitOps = makeGitOps();
    const scheduler = new SyncScheduler(gitOps);

    scheduler.markDirty('A.md', 600);
    scheduler.markDirty('B.md');

    vi.advanceTimersByTime(30_000);
    expect(gitOps.commits).toEqual([['A.md', 'B.md']]);
  });

  it('notifyManualCommit cancels the auto-commit and arms the push timer', () => {
    const gitOps = makeGitOps();
    const scheduler = new SyncScheduler(gitOps);

    scheduler.markDirty('A.md');
    scheduler.notifyManualCommit();

    vi.advanceTimersByTime(30_000);
    expect(gitOps.commits).toHaveLength(0);

    vi.advanceTimersByTime(90_000);
    expect(gitOps.pushes).toBe(1);
    expect(scheduler.getStatus().state).toBe('idle');
  });

  it('notifyManualPush cancels the pending push', () => {
    const gitOps = makeGitOps();
    const scheduler = new SyncScheduler(gitOps);

    scheduler.markDirty('A.md');
    vi.advanceTimersByTime(30_000);
    scheduler.notifyManualPush();

    vi.advanceTimersByTime(300_000);
    expect(gitOps.pushes).toBe(0);
    expect(scheduler.getStatus().state).toBe('idle');
  });

  it('retries a failed commit once, then waits for the next write', () => {
    const gitOps = makeGitOps();
    let failures = 0;
    gitOps.commitPaths = (paths, message) => {
      failures += 1;
      return { success: false, filesChanged: [], message, error: 'index.lock exists' };
    };
    const scheduler = new SyncScheduler(gitOps);

    scheduler.markDirty('A.md');
    vi.advanceTimersByTime(30_000);
    expect(failures).toBe(1);

    vi.advanceTimersByTime(30_000);
    expect(failures).toBe(2);

    vi.advanceTimersByTime(300_000);
    expect(failures).toBe(2);

    const status = scheduler.getStatus();
    expect(status.state).toBe('commit_pending');
    expect(status.pendingPaths).toEqual(['A.md']);
    expect(status.lastCommitError).toBe('index.lock exists');

    scheduler.markDirty('B.md');
    vi.advanceTimersByTime(30_000);
    expect(failures).toBe(3);
  });

  it('treats "No changes to commit" as clean', () => {
    const gitOps = makeGitOps();
    gitOps.commitPaths = (paths, message) => ({
      success: false,
      filesChanged: [],
      message,
      error: 'No changes to commit',
    });
    const scheduler = new SyncScheduler(gitOps);

    scheduler.markDirty('A.md');
    vi.advanceTimersByTime(30_000);

    expect(scheduler.getStatus().state).toBe('idle');
    expect(scheduler.getStatus().lastCommitError).toBeUndefined();
  });

  it('records local_fallback when push fails without retrying', () => {
    const gitOps = makeGitOps();
    gitOps.push = () => ({ success: false, branch: 'main', localFallback: true, error: 'no remote' });
    const scheduler = new SyncScheduler(gitOps);

    scheduler.markDirty('A.md');
    vi.advanceTimersByTime(150_000);

    expect(scheduler.getStatus().pushState).toBe('local_fallback');
    expect(scheduler.getStatus().state).toBe('idle');
  });

  it('flushSync commits and pushes immediately and calls onIdleFlush', () => {
    const gitOps = makeGitOps();
    const onIdleFlush = vi.fn();
    const scheduler = new SyncScheduler(gitOps, { onIdleFlush });

    scheduler.markDirty('A.md');
    scheduler.flushSync();

    expect(gitOps.commits).toEqual([['A.md']]);
    expect(gitOps.pushes).toBe(1);
    expect(onIdleFlush).toHaveBeenCalled();
    expect(scheduler.getStatus().state).toBe('idle');
  });

  it('flushSync with nothing pending does nothing', () => {
    const gitOps = makeGitOps();
    const scheduler = new SyncScheduler(gitOps);

    scheduler.flushSync();

    expect(gitOps.commits).toHaveLength(0);
    expect(gitOps.pushes).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test -- sync-scheduler`
Expected: FAIL — `notifyManualCommit is not a function`, etc. (Task 1 tests still pass; the defer-hint tests may pass already since Task 1 implemented the hint math — that's fine.)

- [ ] **Step 3: Add the missing methods**

Add to the `SyncScheduler` class in `src/sync-scheduler.ts`:

```typescript
  /** A manual commit tool ran: pending changes are committed externally. */
  notifyManualCommit(): void {
    this.cancelCommitTimer();
    this.dirtyPaths.clear();
    this.commitRetried = false;
    this.lastCommitError = undefined;
    this.startPushTimer();
  }

  /** A manual push/sync tool ran: nothing left to push. */
  notifyManualPush(): void {
    this.cancelPushTimer();
    this.pushState = 'pushed';
  }

  /** Best-effort synchronous flush for process shutdown. */
  flushSync(): void {
    this.cancelCommitTimer();
    const hadDirty = this.dirtyPaths.size > 0;
    if (hadDirty) {
      this.fireCommit();
    }

    if (this.pushTimer) {
      this.cancelPushTimer();
      this.firePush();
    }

    if (!hadDirty) {
      try {
        this.onIdleFlush?.();
      } catch {
        // Usage-log flushing must never break shutdown.
      }
    }
  }
```

Note: `fireCommit()` already calls `onIdleFlush` and starts the push timer on success, which `flushSync` then cancels and fires immediately — this is why `flushSync` checks `pushTimer` *after* the commit.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- sync-scheduler`
Expected: PASS (all scheduler tests).

- [ ] **Step 5: Build and full suite**

Run: `npm run build && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/sync-scheduler.ts src/sync-scheduler.test.ts
git commit -m "feat(sync): defer hints, manual-flush notifications, retry, shutdown flush"
```

---

### Task 3: UsageLog (opt-in deprecated-tool usage logging)

**Files:**
- Create: `src/tool-usage-log.ts`
- Test: `src/tool-usage-log.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (Task 7 relies on these exact names):
  - `class UsageLog { constructor(filePath: string); record(tool: string, argsSummary: Record<string, unknown>): void; flush(): Promise<void>; flushSync(): void; pendingCount(): number }`

- [ ] **Step 1: Write the failing tests**

Create `src/tool-usage-log.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UsageLog } from './tool-usage-log.js';

function tempLogPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-'));
  return path.join(dir, 'logs', 'mcp-tool-usage.log');
}

describe('UsageLog', () => {
  it('record queues in memory without touching disk', () => {
    const logPath = tempLogPath();
    const log = new UsageLog(logPath);

    log.record('edit_note', { note_path: 'A.md', mode: 'append' });

    expect(log.pendingCount()).toBe(1);
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it('flush appends JSONL entries and empties the queue', async () => {
    const logPath = tempLogPath();
    const log = new UsageLog(logPath);

    log.record('edit_note', { note_path: 'A.md' });
    log.record('git_push_notes', {});
    await log.flush();

    expect(log.pendingCount()).toBe(0);
    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first.tool).toBe('edit_note');
    expect(first.args).toEqual({ note_path: 'A.md' });
    expect(typeof first.timestamp).toBe('string');
  });

  it('flush with an empty queue creates no file', async () => {
    const logPath = tempLogPath();
    const log = new UsageLog(logPath);

    await log.flush();

    expect(fs.existsSync(logPath)).toBe(false);
  });

  it('flushSync writes synchronously', () => {
    const logPath = tempLogPath();
    const log = new UsageLog(logPath);

    log.record('delete_note', { note_path: 'B.md' });
    log.flushSync();

    expect(fs.readFileSync(logPath, 'utf-8')).toContain('delete_note');
    expect(log.pendingCount()).toBe(0);
  });

  it('appends across multiple flushes', async () => {
    const logPath = tempLogPath();
    const log = new UsageLog(logPath);

    log.record('create_note', { note_path: 'C.md' });
    await log.flush();
    log.record('create_note', { note_path: 'D.md' });
    await log.flush();

    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tool-usage-log`
Expected: FAIL — cannot resolve `./tool-usage-log.js`.

- [ ] **Step 3: Write the implementation**

Create `src/tool-usage-log.ts`:

```typescript
/**
 * Opt-in usage log for deprecated tools.
 *
 * Entries are queued in memory (no I/O on the tool-call hot path) and only
 * written to disk when flush() is invoked from the sync scheduler's idle
 * window, or flushSync() at shutdown.
 */

import * as fs from 'fs';
import * as path from 'path';

export class UsageLog {
  private filePath: string;
  private queue: string[] = [];

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  record(tool: string, argsSummary: Record<string, unknown>): void {
    this.queue.push(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        tool,
        args: argsSummary,
      })
    );
  }

  pendingCount(): number {
    return this.queue.length;
  }

  async flush(): Promise<void> {
    const lines = this.drain();
    if (!lines) {
      return;
    }

    try {
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.promises.appendFile(this.filePath, lines, 'utf-8');
    } catch (error) {
      console.error('Usage log flush failed:', error);
    }
  }

  flushSync(): void {
    const lines = this.drain();
    if (!lines) {
      return;
    }

    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.appendFileSync(this.filePath, lines, 'utf-8');
    } catch (error) {
      console.error('Usage log flush failed:', error);
    }
  }

  private drain(): string | null {
    if (this.queue.length === 0) {
      return null;
    }

    return `${this.queue.splice(0).join('\n')}\n`;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tool-usage-log`
Expected: PASS (5 tests).

- [ ] **Step 5: Build and full suite**

Run: `npm run build && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/tool-usage-log.ts src/tool-usage-log.test.ts
git commit -m "feat(log): add opt-in in-memory usage log with idle flush"
```

---

### Task 4: NoteWorkflowSchema

**Files:**
- Modify: `src/tool-schemas.ts`
- Test: `src/index.test.ts` (append a describe block — this file already tests `tool-schemas.ts`)

**Interfaces:**
- Consumes: zod (already imported in `tool-schemas.ts`).
- Produces (Task 6 relies on this exact name): `NoteWorkflowSchema` exported from `src/tool-schemas.ts`. Parsed type has fields `action` (`'create' | 'edit' | 'delete'`), `note_path`, `content?`, `frontmatter?`, `mode` (defaults `'append'`), `heading?`, `find?`, `regex?`, `count?`, `dry_run?`, `defer_hint_seconds?`.

- [ ] **Step 1: Write the failing tests**

Append to `src/index.test.ts`:

```typescript
import { NoteWorkflowSchema } from './tool-schemas.js';

describe('note_workflow schema', () => {
  it('requires content for create and edit but not delete', () => {
    expect(() => NoteWorkflowSchema.parse({ action: 'create', note_path: 'A.md' })).toThrow(z.ZodError);
    expect(() => NoteWorkflowSchema.parse({ action: 'edit', note_path: 'A.md' })).toThrow(z.ZodError);
    expect(NoteWorkflowSchema.parse({ action: 'delete', note_path: 'A.md' })).toMatchObject({
      action: 'delete',
    });
  });

  it('enforces edit-mode invariants', () => {
    expect(() =>
      NoteWorkflowSchema.parse({ action: 'edit', note_path: 'A.md', content: 'x', mode: 'replace' })
    ).toThrow(z.ZodError);

    expect(() =>
      NoteWorkflowSchema.parse({ action: 'edit', note_path: 'A.md', content: 'x', mode: 'insert-after-heading' })
    ).toThrow(z.ZodError);

    expect(
      NoteWorkflowSchema.parse({
        action: 'edit',
        note_path: 'A.md',
        content: 'x',
        mode: 'replace',
        find: 'old',
      })
    ).toMatchObject({ mode: 'replace', find: 'old' });
  });

  it('defaults mode to append and caps defer_hint_seconds at 1800', () => {
    const parsed = NoteWorkflowSchema.parse({ action: 'edit', note_path: 'A.md', content: 'x' });
    expect(parsed.mode).toBe('append');

    expect(() =>
      NoteWorkflowSchema.parse({ action: 'edit', note_path: 'A.md', content: 'x', defer_hint_seconds: 1801 })
    ).toThrow(z.ZodError);

    expect(
      NoteWorkflowSchema.parse({ action: 'edit', note_path: 'A.md', content: 'x', defer_hint_seconds: 1800 })
    ).toMatchObject({ defer_hint_seconds: 1800 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- index`
Expected: FAIL — `NoteWorkflowSchema` is not exported.

- [ ] **Step 3: Write the schema**

Add to `src/tool-schemas.ts` (after `EditNoteSchema`):

```typescript
export const NoteWorkflowSchema = z
  .object({
    action: z.enum(['create', 'edit', 'delete']).describe('Workflow action'),
    note_path: z.string().describe('Path to the note, relative to the vault'),
    content: z.string().optional().describe('Markdown content; required for create and edit'),
    frontmatter: z.record(z.unknown()).optional().describe('Optional frontmatter fields (create only)'),
    mode: z
      .enum(['overwrite', 'append', 'append-section', 'replace', 'insert-after-heading'])
      .default('append')
      .describe('Edit mode (edit action only)'),
    heading: z.string().optional().describe('Heading for append-section or insert-after-heading mode'),
    find: z.string().optional().describe('Text or regex pattern to find in replace mode'),
    regex: z.boolean().optional().describe('Treat find as a regular expression in replace mode'),
    count: z.number().int().positive().optional().describe('Maximum number of replacements'),
    dry_run: z.boolean().optional().describe('Preview the edit diff without writing (edit action only)'),
    defer_hint_seconds: z
      .number()
      .int()
      .positive()
      .max(1800)
      .optional()
      .describe('Hold auto-commit for at least this many seconds because more writes are coming'),
  })
  .superRefine((value, ctx) => {
    if ((value.action === 'create' || value.action === 'edit') && value.content === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: `${value.action} requires content`,
      });
    }

    if (value.action === 'edit' && value.mode === 'replace' && !value.find) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['find'],
        message: 'replace mode requires find',
      });
    }

    if (value.action === 'edit' && value.mode === 'insert-after-heading' && !value.heading) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['heading'],
        message: 'insert-after-heading mode requires heading',
      });
    }
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- index`
Expected: PASS.

- [ ] **Step 5: Build and full suite**

Run: `npm run build && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/tool-schemas.ts src/index.test.ts
git commit -m "feat(schema): add NoteWorkflowSchema with per-action validation"
```

---

### Task 5: `include_content` in search results

**Files:**
- Modify: `src/types.ts` (extend `SimilarNote`)
- Modify: `src/search-engine.ts` (options on `getSimilarNotes` and `searchByQuery`)
- Test: `src/search-engine.test.ts` (append describe block)

**Interfaces:**
- Consumes: `SmartConnectionsLoader.readNoteContent(path)` (exists).
- Produces (Task 6/7 rely on these exact signatures):
  - `interface SearchContentOptions { includeContent?: boolean; contentMaxChars?: number }`  exported from `src/search-engine.ts`.
  - `SearchEngine.getSimilarNotes(notePath, threshold?, limit?, contentOptions?: SearchContentOptions): SimilarNote[]`
  - `SearchEngine.searchByQuery(queryText, limit?, threshold?, contentOptions?: SearchContentOptions): Promise<SimilarNote[]>`
  - `SimilarNote` gains optional `content?: string; truncated?: boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `src/search-engine.test.ts`:

```typescript
describe('SearchEngine include_content', () => {
  it('attaches note content when includeContent is true', async () => {
    const sources = new Map<string, SmartSource>([
      ['match.md', source('match.md', [0])],
    ]);
    const loader = {
      getEmbeddingModelKey: () => 'model',
      getSources: () => sources,
      readNoteContent: () => 'alpha body text',
    };
    const engine = new SearchEngine(loader as never);

    const results = await engine.searchByQuery('alpha', 10, 0.1, { includeContent: true });

    expect(results[0].content).toBe('alpha body text');
    expect(results[0].truncated).toBe(false);
  });

  it('truncates content at contentMaxChars and flags it', async () => {
    const sources = new Map<string, SmartSource>([
      ['match.md', source('match.md', [0])],
    ]);
    const loader = {
      getEmbeddingModelKey: () => 'model',
      getSources: () => sources,
      readNoteContent: () => `alpha ${'x'.repeat(5000)}`,
    };
    const engine = new SearchEngine(loader as never);

    const results = await engine.searchByQuery('alpha', 10, 0.1, {
      includeContent: true,
      contentMaxChars: 100,
    });

    expect(results[0].content).toHaveLength(100);
    expect(results[0].truncated).toBe(true);
  });

  it('omits content by default', async () => {
    const sources = new Map<string, SmartSource>([
      ['match.md', source('match.md', [0])],
    ]);
    const loader = {
      getEmbeddingModelKey: () => 'model',
      getSources: () => sources,
      readNoteContent: () => 'alpha',
    };
    const engine = new SearchEngine(loader as never);

    const results = await engine.searchByQuery('alpha', 10, 0.1);

    expect(results[0].content).toBeUndefined();
  });

  it('skips content for notes that cannot be read', async () => {
    const sources = new Map<string, SmartSource>([
      ['match.md', source('match.md', [0])],
    ]);
    // Keyword scoring reads each note once (call 1); content attachment
    // reads again (call 2) — make only the second read fail.
    let calls = 0;
    const loader = {
      getEmbeddingModelKey: () => 'model',
      getSources: () => sources,
      readNoteContent: () => {
        calls += 1;
        if (calls > 1) {
          throw new Error('unreadable');
        }
        return 'alpha';
      },
    };
    const engine = new SearchEngine(loader as never);

    const results = await engine.searchByQuery('alpha', 10, 0.1, { includeContent: true });

    expect(results[0].path).toBe('match.md');
    expect(results[0].content).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- search-engine`
Expected: FAIL — extra argument not accepted / `content` undefined.

- [ ] **Step 3: Implement**

In `src/types.ts`, extend `SimilarNote`:

```typescript
export interface SimilarNote {
  path: string;
  similarity: number;
  blocks?: string[];
  matchedContent?: string;
  content?: string;
  truncated?: boolean;
}
```

In `src/search-engine.ts`, add the options type and a private helper, and thread it through the two public methods:

```typescript
export interface SearchContentOptions {
  includeContent?: boolean;
  contentMaxChars?: number;
}
```

```typescript
  private attachContent(results: SimilarNote[], options?: SearchContentOptions): SimilarNote[] {
    if (!options?.includeContent) {
      return results;
    }

    const maxChars = options.contentMaxChars ?? 2000;

    return results.map((result) => {
      try {
        const full = this.loader.readNoteContent(result.path);
        const truncated = full.length > maxChars;
        return {
          ...result,
          content: truncated ? full.slice(0, maxChars) : full,
          truncated,
        };
      } catch {
        return result;
      }
    });
  }
```

Change the `getSimilarNotes` signature and final return:

```typescript
  getSimilarNotes(
    notePath: string,
    threshold: number = 0.5,
    limit: number = 10,
    contentOptions?: SearchContentOptions
  ): SimilarNote[] {
```

and replace its final `return neighbors.map(...)` with:

```typescript
    const results = neighbors.map(neighbor => ({
      path: neighbor.id,
      similarity: neighbor.similarity,
      blocks: neighbor.metadata.blocks
    }));

    return this.attachContent(results, contentOptions);
```

Change `searchByQuery` the same way:

```typescript
  async searchByQuery(
    queryText: string,
    limit: number = 10,
    threshold: number = 0.5,
    contentOptions?: SearchContentOptions
  ): Promise<SimilarNote[]> {
    const keywordResults = (): SimilarNote[] => this.keywordSearch(queryText, limit, threshold);

    if (this.embedder?.isAvailable()) {
      try {
        const embeddingVector = await this.embedder.embed(queryText);
        const semanticResults = this.getEmbeddingNeighbors(embeddingVector, limit, threshold);
        if (semanticResults.length > 0) {
          return this.attachContent(this.mergeResults(semanticResults, keywordResults(), limit), contentOptions);
        }
      } catch {
        // Fall back to keyword search if local embedding fails at query time.
      }
    }

    return this.attachContent(keywordResults(), contentOptions);
  }
```

Note: `getConnectionGraph` calls `getSimilarNotes(currentPath, threshold, maxPerLevel)` with three args — no change needed there.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- search-engine`
Expected: PASS (existing 5 + new 4).

- [ ] **Step 5: Build and full suite**

Run: `npm run build && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/search-engine.ts src/search-engine.test.ts
git commit -m "feat(search): optional inline note content in search results"
```

---

### Task 6: Wire `note_workflow` and the scheduler into index.ts

**Files:**
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `SyncScheduler`/`SyncGitOps`/`SyncStatus` (Tasks 1–2), `NoteWorkflowSchema` (Task 4), `SearchContentOptions` (Task 5), existing `createNote`/`editNote`/`deleteNote`, `embedUpdatedNote`, `gitManager`, `loader`.
- Produces: the `note_workflow` MCP tool; every write path feeds the scheduler; git tools notify it. Task 7 builds on the same instances (`syncScheduler` const name matters).

`src/index.ts` has no unit tests today (it boots a server at import time); verification for this task is compile + full suite + grep checks. The scheduler and schema behavior are already unit-tested.

- [ ] **Step 1: Imports and scheduler instantiation**

Add imports at the top of `src/index.ts`:

```typescript
import { SyncScheduler } from './sync-scheduler.js';
import type { SyncStatus } from './sync-scheduler.js';
import { EditNoteSchema, NoteWorkflowSchema, formatToolError } from './tool-schemas.js';
```

(The `EditNoteSchema, formatToolError` import line already exists — extend it with `NoteWorkflowSchema`.)

After the `const gitManager = new GitManager(VAULT_ROOT);` line, add:

```typescript
const COMMIT_IDLE_MS = parseInt(process.env.SYNC_COMMIT_IDLE_MS ?? '30000', 10);
const PUSH_IDLE_MS = parseInt(process.env.SYNC_PUSH_IDLE_MS ?? '120000', 10);

const syncScheduler = new SyncScheduler(
  {
    commitPaths: (paths, message) =>
      gitManager.commitSpecific(paths.map((notePath) => path.join(VAULT_ROOT, notePath)), message),
    push: () => gitManager.push(),
  },
  {
    commitIdleMs: COMMIT_IDLE_MS,
    pushIdleMs: PUSH_IDLE_MS,
  }
);

function buildSyncBlock(status: SyncStatus, deferred: boolean): Record<string, unknown> {
  const state = status.state === 'commit_pending'
    ? (deferred ? 'commit_deferred' : 'commit_scheduled')
    : status.state;

  return {
    state,
    commit_in_seconds: status.commitInSeconds,
    pending_paths: status.pendingPaths,
    push_after_commit_seconds: Math.round(PUSH_IDLE_MS / 1000),
    ...(status.lastCommitError ? { error: status.lastCommitError } : {}),
    ...(status.pushState ? { push_state: status.pushState } : {}),
  };
}

const NEXT_STEPS_TEXT = `Changes auto-commit after ${Math.round(COMMIT_IDLE_MS / 1000)}s idle and auto-push ${Math.round(PUSH_IDLE_MS / 1000)}s later. Pass defer_hint_seconds if more edits are coming. No git tool calls needed.`;
```

- [ ] **Step 2: Add the `note_workflow` tool definition**

Add as the FIRST entry of the `tools: Tool[]` array (models scan the list top-down):

```typescript
  {
    name: 'note_workflow',
    description:
      'Create, edit, or delete a vault note in a single call. Writes immediately, refreshes the note embedding, and auto-commits (30s idle) then auto-pushes (2min idle) in the background — no separate git tool calls needed. Preferred over create_note/edit_note/delete_note and the git_* tools.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'edit', 'delete'],
          description: 'Workflow action',
        },
        note_path: { type: 'string', description: 'Path to the note, relative to vault root' },
        content: { type: 'string', description: 'Markdown content; required for create and edit' },
        frontmatter: { type: 'object', description: 'Optional frontmatter fields (create only)' },
        mode: {
          type: 'string',
          enum: ['overwrite', 'append', 'append-section', 'replace', 'insert-after-heading'],
          default: 'append',
          description: 'Edit mode (edit action only). replace requires find; insert-after-heading requires heading.',
        },
        heading: { type: 'string', description: 'Heading for append-section or insert-after-heading mode' },
        find: { type: 'string', description: 'Literal text or regex pattern to find in replace mode' },
        regex: { type: 'boolean', description: 'Treat find as a regular expression in replace mode' },
        count: { type: 'number', description: 'Maximum number of replacements in replace mode', minimum: 1 },
        dry_run: { type: 'boolean', description: 'Preview the edit diff without writing (edit action only)' },
        defer_hint_seconds: {
          type: 'number',
          minimum: 1,
          maximum: 1800,
          description: 'Hold auto-commit for at least this many seconds because more writes are coming',
        },
      },
      required: ['action', 'note_path'],
    },
  },
```

- [ ] **Step 3: Add the `note_workflow` handler**

Add as the first `case` in the `CallToolRequestSchema` handler's `switch`:

```typescript
      case 'note_workflow': {
        const params = NoteWorkflowSchema.parse(args);

        let targetPath = params.note_path;
        if (params.action !== 'create') {
          try {
            targetPath = loader.resolveNotePath(params.note_path);
          } catch {
            // Not indexed yet (e.g. brand-new file): fall back to the literal path.
          }
        }

        let payload: Record<string, unknown>;
        let wroteChanges = false;

        if (params.action === 'create') {
          createNote(VAULT_ROOT, targetPath, params.content ?? '', params.frontmatter);
          const embedding = await embedUpdatedNote(targetPath);
          payload = { action: 'create', note_path: targetPath, written: true, embedding };
          wroteChanges = true;
        } else if (params.action === 'edit') {
          const editResult = editNote(VAULT_ROOT, targetPath, {
            mode: params.mode,
            content: params.content,
            heading: params.heading,
            find: params.find,
            regex: params.regex,
            count: params.count,
            dryRun: params.dry_run,
          });
          wroteChanges = editResult.written && editResult.changed;
          const embedding = wroteChanges ? await embedUpdatedNote(targetPath) : undefined;
          payload = { action: 'edit', ...editResult, ...(embedding ? { embedding } : {}) };
        } else {
          deleteNote(VAULT_ROOT, targetPath);
          payload = { action: 'delete', note_path: targetPath, written: true };
          wroteChanges = true;
        }

        if (wroteChanges) {
          try {
            syncScheduler.markDirty(targetPath, params.defer_hint_seconds);
          } catch (error) {
            payload.sync_error = error instanceof Error ? error.message : String(error);
          }
        }

        payload.sync = buildSyncBlock(syncScheduler.getStatus(), params.defer_hint_seconds !== undefined);
        payload.next_steps = NEXT_STEPS_TEXT;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(payload, null, 2),
            },
          ],
        };
      }
```

- [ ] **Step 4: Feed the scheduler from the deprecated write tools**

In the existing `create_note` case, after `const embedding = await embedUpdatedNote(note_path);` add:

```typescript
        syncScheduler.markDirty(note_path);
```

In the existing `edit_note` case, after the `const embedding = ...` line add:

```typescript
        if (editResult.written && editResult.changed) {
          syncScheduler.markDirty(note_path);
        }
```

In the existing `delete_note` case, after `deleteNote(VAULT_ROOT, note_path);` add:

```typescript
        syncScheduler.markDirty(note_path);
```

- [ ] **Step 5: Notify the scheduler from the git tools**

In `git_commit_notes` and `git_commit_notes_specific`, immediately after the `const result: GitCommitResult = ...` line, add:

```typescript
        if (result.success) {
          syncScheduler.notifyManualCommit();
        }
```

In `git_push_notes`, after `const result = gitManager.push();` add:

```typescript
        if (result.success) {
          syncScheduler.notifyManualPush();
        }
```

In `git_sync_notes`, after `const result: GitSyncResult = gitManager.syncNotes();` add:

```typescript
        if (result.success) {
          syncScheduler.notifyManualPush();
        }
```

- [ ] **Step 6: Verify**

Run: `npm run build && npm test`
Expected: clean build, all tests pass.

Run: `grep -n "note_workflow" dist/index.js | head -5`
Expected: at least the tool name and case label appear.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts
git commit -m "feat(mcp): add note_workflow tool and wire sync scheduler into all write paths"
```

---

### Task 7: Usage-log wiring, CLI flag, deprecation prefixes, get_stats sync block, shutdown flush, search params

**Files:**
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `UsageLog` (Task 3), `syncScheduler` (Task 6), `SearchContentOptions` (Task 5).
- Produces: final tool surface — deprecated descriptions prefixed, `--log-usage` flag honored, `get_stats.sync`, shutdown flush, `include_content`/`content_max_chars` on the two search tools.

- [ ] **Step 1: CLI flag parsing and UsageLog instantiation**

Add imports:

```typescript
import { fileURLToPath } from 'url';
import { UsageLog } from './tool-usage-log.js';
```

After the `syncScheduler` construction (from Task 6), add — and pass the flush hook into the scheduler options by **editing the Task 6 construction** to include `onIdleFlush`:

```typescript
function parseUsageLogPath(argv: string[]): string | null {
  for (const arg of argv) {
    if (arg === '--log-usage') {
      return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'logs', 'mcp-tool-usage.log');
    }
    if (arg.startsWith('--log-usage=')) {
      return arg.slice('--log-usage='.length);
    }
  }
  return null;
}

const usageLogPath = parseUsageLogPath(process.argv.slice(2));
const usageLog = usageLogPath ? new UsageLog(usageLogPath) : null;

if (usageLog) {
  console.error(`Deprecated-tool usage logging enabled: ${usageLogPath}`);
}
```

Because `usageLog` must exist before the scheduler references it, place the `parseUsageLogPath` function and the `usageLog` const ABOVE the `syncScheduler` construction, then change the scheduler options to:

```typescript
  {
    commitIdleMs: COMMIT_IDLE_MS,
    pushIdleMs: PUSH_IDLE_MS,
    onIdleFlush: () => {
      void usageLog?.flush();
    },
  }
```

- [ ] **Step 2: Record deprecated-tool usage**

Add above the `CallToolRequestSchema` handler:

```typescript
const DEPRECATED_TOOLS = new Set([
  'create_note',
  'edit_note',
  'delete_note',
  'git_commit_notes',
  'git_commit_notes_specific',
  'git_push_notes',
  'git_sync_notes',
]);

function summarizeArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object') {
    return {};
  }

  const source = args as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const key of ['note_path', 'note_paths', 'mode', 'message']) {
    if (key in source) {
      summary[key] = source[key];
    }
  }

  return summary;
}
```

Inside the `CallToolRequestSchema` handler, right after `const { name, arguments: args } = request.params;`, add:

```typescript
  if (usageLog && DEPRECATED_TOOLS.has(name)) {
    usageLog.record(name, summarizeArgs(args));
  }
```

(Note: `summarizeArgs` intentionally never captures `content` — no note text ends up in the log.)

- [ ] **Step 3: Deprecation prefixes**

Prefix the `description` of each of the 7 tools in the `tools` array with the verbatim string `[DEPRECATED — prefer note_workflow] `. Example for `create_note`:

```typescript
    description: '[DEPRECATED — prefer note_workflow] Create a new markdown note in the vault and update its local embedding when available.',
```

Apply the same prefix to: `edit_note`, `delete_note`, `git_commit_notes`, `git_commit_notes_specific`, `git_push_notes`, `git_sync_notes`.

- [ ] **Step 4: `get_stats` sync block**

In the `get_stats` case, change the `combinedStats` construction to:

```typescript
        const combinedStats = {
          ...stats,
          git: gitStatus,
          sync: syncScheduler.getStatus(),
        };
```

- [ ] **Step 5: Search tool `include_content` params**

Update the two zod schemas near the top of `src/index.ts`:

```typescript
const GetSimilarNotesSchema = z.object({
  note_path: z.string().describe('Path to the note (e.g., "Note.md" or "Folder/Note.md")'),
  threshold: z.number().min(0).max(1).default(0.5).describe('Similarity threshold (0-1)'),
  limit: z.number().int().positive().default(10).describe('Maximum number of results'),
  include_content: z.boolean().default(false).describe('Include note content inline in each result'),
  content_max_chars: z.number().int().positive().default(2000).describe('Max content characters per note'),
});

const SearchNotesSchema = z.object({
  query: z.string().describe('Search query text'),
  limit: z.number().int().positive().default(10).describe('Maximum number of results'),
  threshold: z.number().min(0).max(1).default(0.5).describe('Similarity threshold (0-1)'),
  include_content: z.boolean().default(false).describe('Include note content inline in each result'),
  content_max_chars: z.number().int().positive().default(2000).describe('Max content characters per note'),
});
```

Update the two handlers:

```typescript
      case 'get_similar_notes': {
        const { note_path, threshold, limit, include_content, content_max_chars } = GetSimilarNotesSchema.parse(args);
        const results = searchEngine.getSimilarNotes(note_path, threshold, limit, {
          includeContent: include_content,
          contentMaxChars: content_max_chars,
        });
```

```typescript
      case 'search_notes': {
        const { query, limit, threshold, include_content, content_max_chars } = SearchNotesSchema.parse(args);
        const results = await searchEngine.searchByQuery(query, limit, threshold, {
          includeContent: include_content,
          contentMaxChars: content_max_chars,
        });
```

Add the matching properties to both tool definitions in the `tools` array (`search_notes` and `get_similar_notes`):

```typescript
        include_content: {
          type: 'boolean',
          description: 'Include note content inline in each result (default false). Skips the need for a follow-up get_note_content call before editing.',
          default: false,
        },
        content_max_chars: {
          type: 'number',
          description: 'Max content characters per note when include_content is true, default 2000',
          minimum: 1,
          default: 2000,
        },
```

- [ ] **Step 6: Shutdown flush**

Add just before the `// Start the server` section at the bottom of `src/index.ts`:

```typescript
// Flush pending commits/pushes and queued usage-log entries on shutdown.
let shutdownRan = false;
function shutdown(): void {
  if (shutdownRan) {
    return;
  }
  shutdownRan = true;

  try {
    syncScheduler.flushSync();
  } catch (error) {
    console.error('Sync flush on shutdown failed:', error);
  }

  try {
    usageLog?.flushSync();
  } catch (error) {
    console.error('Usage log flush on shutdown failed:', error);
  }
}

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});
process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});
process.stdin.on('close', () => {
  shutdown();
});
```

- [ ] **Step 7: Verify**

Run: `npm run build && npm test`
Expected: clean.

Run: `grep -c "DEPRECATED — prefer note_workflow" src/index.ts`
Expected: `7`

Run: `grep -n "log-usage\|include_content\|sync: syncScheduler" src/index.ts | head -10`
Expected: hits for all three.

- [ ] **Step 8: Commit**

```bash
git add src/index.ts
git commit -m "feat(mcp): usage logging, deprecation prefixes, sync status, include_content, shutdown flush"
```

---

### Task 8: Documentation and final verification

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: README — document `note_workflow`, auto-sync, `--log-usage`, `include_content`**

In `README.md`:

1. In the **Available Tools** section, add `note_workflow` as tool #1 (renumber or just insert above `get_similar_notes`) with its parameter table (action, note_path, content, frontmatter, mode, heading, find, regex, count, dry_run, defer_hint_seconds) and a note: writes auto-commit after 30s idle (`SYNC_COMMIT_IDLE_MS`) and auto-push 2min after commit (`SYNC_PUSH_IDLE_MS`); manual git tools flush immediately.
2. Mark the 7 deprecated tools' sections with `> **Deprecated** — prefer `note_workflow`.`
3. Replace the `edit_note` "Read → preview → write → commit recipe" with a `note_workflow` recipe: search (optionally `include_content: true`) → `note_workflow` with `dry_run: true` → `note_workflow` for real → done (auto-commit/push handles persistence).
4. Document `include_content`/`content_max_chars` under `search_notes` and `get_similar_notes`.
5. Add a **Usage logging** subsection under Development: `node dist/index.js --log-usage` (default `logs/mcp-tool-usage.log` next to the package, outside the vault) or `--log-usage=<path>`; JSONL entries `{timestamp, tool, args}`; queued in memory and flushed during idle windows.

- [ ] **Step 2: CHANGELOG entry**

Add at the top of `CHANGELOG.md`:

```markdown
## workflow-sync

### Added
- `note_workflow` tool: create/edit/delete a note in a single call with embedding refresh and deferred auto-commit/push.
- `SyncScheduler`: idle-debounced auto-commit (30s, `SYNC_COMMIT_IDLE_MS`) and auto-push (2min, `SYNC_PUSH_IDLE_MS`) fed by every write tool; `defer_hint_seconds` extends the window (capped at 30min); manual git tools flush immediately; best-effort flush on shutdown.
- Opt-in deprecated-tool usage logging via `--log-usage[=<path>]`, queued in memory and flushed during idle windows to `logs/mcp-tool-usage.log` outside the vault.
- `include_content`/`content_max_chars` on `search_notes` and `get_similar_notes`.
- `sync` status block in `get_stats`.

### Changed
- Deprecated (still functional): `create_note`, `edit_note`, `delete_note`, `git_commit_notes`, `git_commit_notes_specific`, `git_push_notes`, `git_sync_notes`.
```

- [ ] **Step 3: Final verification**

Run: `npm run build && npm test`
Expected: clean build; all tests pass (existing 13+ plus ~25 new).

Optional smoke test (requires a vault): `npx -y @modelcontextprotocol/inspector -e SMART_VAULT_PATH="<vault>" node dist/index.js` — confirm `note_workflow` appears first in the tool list and an edit returns a `sync` block.

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document note_workflow, auto-sync scheduler, usage logging, include_content"
```
