/**
 * Idle-debounced auto commit/push scheduler.
 *
 * Every successful note write marks paths dirty and (re)starts a commit
 * timer. When the vault has been idle for the commit window, dirty paths are
 * committed; a push timer then fires after a further idle window.
 */

import type { GitCommitResult, GitPushResult } from './types.js';
import type { SyncJournal, QuarantineEntry } from './sync-journal.js';

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
  journal?: SyncJournal;
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
  private journal?: SyncJournal;
  private quarantined = new Map<string, QuarantineEntry>();
  private previouslyQuarantined = new Set<string>();

  constructor(gitOps: SyncGitOps, options: SyncSchedulerOptions = {}) {
    this.gitOps = gitOps;
    this.commitIdleMs = options.commitIdleMs ?? DEFAULT_COMMIT_IDLE_MS;
    this.pushIdleMs = options.pushIdleMs ?? DEFAULT_PUSH_IDLE_MS;
    this.maxDeferMs = options.maxDeferMs ?? DEFAULT_MAX_DEFER_MS;
    this.onIdleFlush = options.onIdleFlush;
    this.journal = options.journal;
    this.recoverFromJournal();
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
    this.persist();
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

  /** A manual commit tool ran: pending changes are committed externally. */
  notifyManualCommit(): void {
    this.cancelCommitTimer();
    this.dirtyPaths.clear();
    this.commitRetried = false;
    this.lastCommitError = undefined;
    this.startPushTimer();
    this.persist();
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
      this.persist();
    } else if (result.error === 'No changes to commit') {
      this.dirtyPaths.clear();
      this.commitRetried = false;
      this.lastCommitError = undefined;
      this.persist();
    } else {
      this.lastCommitError = result.error;
      if (!this.commitRetried) {
        this.commitRetried = true;
        this.scheduleCommit(this.commitIdleMs);
      }
      this.persist();
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
}
