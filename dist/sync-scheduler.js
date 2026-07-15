/**
 * Idle-debounced auto commit/push scheduler.
 *
 * Every successful note write marks paths dirty and (re)starts a commit
 * timer. When the vault has been idle for the commit window, dirty paths are
 * committed; a push timer then fires after a further idle window.
 */
const DEFAULT_COMMIT_IDLE_MS = 30_000;
const DEFAULT_PUSH_IDLE_MS = 120_000;
const DEFAULT_MAX_DEFER_MS = 30 * 60_000;
export class SyncScheduler {
    gitOps;
    commitIdleMs;
    pushIdleMs;
    maxDeferMs;
    onIdleFlush;
    dirtyPaths = new Set();
    commitTimer = null;
    pushTimer = null;
    commitDeadline = 0;
    pushDeadline = 0;
    commitRetried = false;
    lastCommitError;
    pushState;
    constructor(gitOps, options = {}) {
        this.gitOps = gitOps;
        this.commitIdleMs = options.commitIdleMs ?? DEFAULT_COMMIT_IDLE_MS;
        this.pushIdleMs = options.pushIdleMs ?? DEFAULT_PUSH_IDLE_MS;
        this.maxDeferMs = options.maxDeferMs ?? DEFAULT_MAX_DEFER_MS;
        this.onIdleFlush = options.onIdleFlush;
    }
    markDirty(notePath, deferHintSeconds) {
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
    getStatus() {
        const now = Date.now();
        const state = this.commitTimer || this.dirtyPaths.size > 0
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
    notifyManualCommit() {
        this.cancelCommitTimer();
        this.dirtyPaths.clear();
        this.commitRetried = false;
        this.lastCommitError = undefined;
        this.startPushTimer();
    }
    /** A manual push/sync tool ran: nothing left to push. */
    notifyManualPush() {
        this.cancelPushTimer();
        this.pushState = 'pushed';
    }
    /** Best-effort synchronous flush for process shutdown. */
    flushSync() {
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
            }
            catch {
                // Usage-log flushing must never break shutdown.
            }
        }
    }
    scheduleCommit(delayMs) {
        this.cancelCommitTimer();
        this.commitDeadline = Date.now() + delayMs;
        this.commitTimer = setTimeout(() => this.fireCommit(), delayMs);
        this.unrefTimer(this.commitTimer);
    }
    startPushTimer() {
        this.cancelPushTimer();
        this.pushDeadline = Date.now() + this.pushIdleMs;
        this.pushTimer = setTimeout(() => this.firePush(), this.pushIdleMs);
        this.unrefTimer(this.pushTimer);
    }
    fireCommit() {
        this.commitTimer = null;
        const paths = Array.from(this.dirtyPaths);
        const head = paths.slice(0, 3).join(', ');
        const suffix = paths.length > 3 ? ` (+${paths.length - 3} more)` : '';
        const message = `Auto-commit: ${head}${suffix}`;
        let result;
        try {
            result = this.gitOps.commitPaths(paths, message);
        }
        catch (error) {
            result = {
                success: false,
                filesChanged: [],
                message,
                error: error instanceof Error ? error.message : String(error),
            };
        }
        try {
            this.onIdleFlush?.();
        }
        catch {
            // Usage-log flushing must never break the sync path.
        }
        if (result.success) {
            this.dirtyPaths.clear();
            this.commitRetried = false;
            this.lastCommitError = undefined;
            this.startPushTimer();
        }
        else if (result.error === 'No changes to commit') {
            this.dirtyPaths.clear();
            this.commitRetried = false;
            this.lastCommitError = undefined;
        }
        else {
            this.lastCommitError = result.error;
            if (!this.commitRetried) {
                this.commitRetried = true;
                this.scheduleCommit(this.commitIdleMs);
            }
        }
    }
    firePush() {
        this.pushTimer = null;
        try {
            const result = this.gitOps.push();
            this.pushState = result.success ? 'pushed' : 'local_fallback';
        }
        catch {
            this.pushState = 'local_fallback';
        }
    }
    cancelCommitTimer() {
        if (this.commitTimer) {
            clearTimeout(this.commitTimer);
            this.commitTimer = null;
        }
    }
    cancelPushTimer() {
        if (this.pushTimer) {
            clearTimeout(this.pushTimer);
            this.pushTimer = null;
        }
    }
    unrefTimer(timer) {
        if (typeof timer.unref === 'function') {
            timer.unref();
        }
    }
}
//# sourceMappingURL=sync-scheduler.js.map