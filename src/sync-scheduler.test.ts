import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncScheduler } from './sync-scheduler.js';
import type { SyncGitOps } from './sync-scheduler.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SyncJournal } from './sync-journal.js';

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
