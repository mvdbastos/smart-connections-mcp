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
