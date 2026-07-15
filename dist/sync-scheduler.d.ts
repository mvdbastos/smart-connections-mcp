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
    private firePush;
    private cancelCommitTimer;
    private cancelPushTimer;
    private unrefTimer;
}
//# sourceMappingURL=sync-scheduler.d.ts.map