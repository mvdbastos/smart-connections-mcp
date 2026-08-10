/**
 * Git Manager for Smart Connections MCP
 * Handles all git operations (commit, fetch, pull, status)
 */
import type { GitCommitResult, GitPushResult, GitSyncResult, GitStatus } from './types.js';
interface GitManagerOptions {
    commandTimeoutMs?: number;
    gitExecutable?: string;
    gitArgsPrefix?: string[];
}
export declare class GitManager {
    private static readonly DEFAULT_COMMAND_TIMEOUT_MS;
    private vaultPath;
    private commandTimeoutMs;
    private gitExecutable;
    private gitArgsPrefix;
    constructor(vaultPath: string, options?: GitManagerOptions);
    /**
     * Check if git is available on the system
     */
    isGitAvailable(): boolean;
    /**
     * Check if the vault directory is a git repository
     */
    isGitRepository(): boolean;
    /**
     * Get current git branch name
     */
    getBranch(): string;
    /**
     * Get git config user.name and user.email
     */
    getGitConfig(): {
        name: string;
        email: string;
    };
    /**
     * Commit all uncommitted changes
     */
    commitAll(message: string, authorName?: string, authorEmail?: string): GitCommitResult;
    /**
     * Paths git can actually act on: present on disk, or tracked in the index so
     * a deletion can be staged. A path that is neither was created and deleted
     * before it was ever committed -- there is nothing to commit for it, and
     * passing it to `git add` aborts the entire batch on an unmatched pathspec.
     */
    private committablePaths;
    /**
     * Commit specific files
     */
    commitSpecific(filePaths: string[], message: string, authorName?: string, authorEmail?: string): GitCommitResult;
    /**
     * Push committed notes to the configured remote, falling back to local-only when remote push is unavailable.
     */
    push(): GitPushResult;
    /**
     * Sync notes: fetch and pull from remote, then push local commits.
     */
    syncNotes(): GitSyncResult;
    /**
     * Get current git status
     */
    getStatus(): GitStatus;
    private git;
    private getGitEnv;
    private getUnavailableResult;
    private getUnavailableSyncResult;
    private getUnavailablePushResult;
    private getCommitArgs;
    private getStagedFiles;
    private toRelativePath;
    private samePath;
    private getAheadBehind;
    private getBehindRemote;
    private getRemoteCommits;
    private getUpstreamRef;
    private getConflicts;
    private formatError;
}
export {};
//# sourceMappingURL=git-manager.d.ts.map