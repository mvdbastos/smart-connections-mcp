/**
 * Git Manager for Smart Connections MCP
 * Handles all git operations (commit, fetch, pull, status)
 */
import type { GitCommitResult, GitSyncResult, GitStatus } from './types.js';
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
     * Commit specific files
     */
    commitSpecific(filePaths: string[], message: string, authorName?: string, authorEmail?: string): GitCommitResult;
    /**
     * Sync notes: fetch and pull from remote
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
    private getCommitArgs;
    private getStagedFiles;
    private toRelativePath;
    private getAheadBehind;
    private getBehindRemote;
    private getRemoteCommits;
    private getConflicts;
    private formatError;
}
export {};
//# sourceMappingURL=git-manager.d.ts.map