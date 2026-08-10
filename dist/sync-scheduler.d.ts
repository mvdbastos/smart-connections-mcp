/**
 * Idle-debounced auto commit/push scheduler.
 *
 * Every successful note write marks paths dirty and (re)starts a commit
 * timer. When the vault has been idle for the commit window, dirty paths are
 * committed; a push timer then fires after a further idle window.
 */
import type { GitCommitResult, GitPushResult } from './types.js';
import type { SyncJournal } from './sync-journal.js';
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
    quarantinedPaths: string[];
    quarantineSurvivedRestart: boolean;
}
export interface SyncSchedulerOptions {
    commitIdleMs?: number;
    pushIdleMs?: number;
    maxDeferMs?: number;
    onIdleFlush?: () => void;
    journal?: SyncJournal;
}
export declare class SyncScheduler {
    private gitOps;
    private commitIdleMs;
    private pushIdleMs;
    private maxDeferMs;
    private onIdleFlush?;
    private dirtyPaths;
    private commitTimer;
    private pushTimer;
    private commitDeadline;
    private pushDeadline;
    private commitRetried;
    private lastCommitError?;
    private pushState?;
    private journal?;
    private quarantined;
    private previouslyQuarantined;
    constructor(gitOps: SyncGitOps, options?: SyncSchedulerOptions);
    markDirty(notePath: string, deferHintSeconds?: number): void;
    getStatus(): SyncStatus;
    /** A manual commit tool ran: pending changes are committed externally. */
    notifyManualCommit(): void;
    /** A manual push/sync tool ran: nothing left to push. */
    notifyManualPush(): void;
    /** Best-effort synchronous flush for process shutdown. */
    flushSync(): void;
    private scheduleCommit;
    private startPushTimer;
    private fireCommit;
    /**
     * A batch commit failure does not say which path caused it -- commitPaths
     * fails as a unit. Rather than blame the whole batch, retry each path alone:
     * the ones that can commit do, and only the ones that genuinely cannot are
     * quarantined. Bounded -- N git calls, once, on a repeated failure.
     */
    private isolateAndQuarantine;
    private firePush;
    private cancelCommitTimer;
    private cancelPushTimer;
    private unrefTimer;
    /** Write the complete current state. Fail-soft inside SyncJournal. */
    private persist;
    /**
     * Restore state left by a session that died before flushing.
     *
     * Quarantined paths are put back into the dirty set rather than left
     * quarantined: a restart may well have cleared the cause, such as a stale
     * index.lock. They are remembered so that failing *again* marks them as
     * having survived a restart, which is what escalates to the report hint.
     */
    private recoverFromJournal;
}
//# sourceMappingURL=sync-scheduler.d.ts.map