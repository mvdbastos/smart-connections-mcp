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
