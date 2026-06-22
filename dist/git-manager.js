/**
 * Git Manager for Smart Connections MCP
 * Handles all git operations (commit, fetch, pull, status)
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
export class GitManager {
    vaultPath;
    constructor(vaultPath) {
        this.vaultPath = vaultPath;
    }
    /**
     * Check if git is available on the system
     */
    isGitAvailable() {
        try {
            execFileSync('git', ['--version'], { stdio: 'pipe' });
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Check if the vault directory is a git repository
     */
    isGitRepository() {
        try {
            if (!fs.existsSync(this.vaultPath)) {
                return false;
            }
            const topLevel = this.git(['rev-parse', '--show-toplevel']).trim();
            return path.resolve(topLevel) === path.resolve(this.vaultPath);
        }
        catch {
            return false;
        }
    }
    /**
     * Get current git branch name
     */
    getBranch() {
        try {
            return this.git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
        }
        catch (e) {
            try {
                return this.git(['symbolic-ref', '--short', 'HEAD']).trim();
            }
            catch {
                throw new Error(`Failed to get git branch: ${this.formatError(e)}`);
            }
        }
    }
    /**
     * Get git config user.name and user.email
     */
    getGitConfig() {
        try {
            const name = this.git(['config', 'user.name']).trim();
            const email = this.git(['config', 'user.email']).trim();
            return { name, email };
        }
        catch (e) {
            throw new Error(`Failed to get git config: ${this.formatError(e)}`);
        }
    }
    /**
     * Commit all uncommitted changes
     */
    commitAll(message, authorName, authorEmail) {
        const unavailable = this.getUnavailableResult();
        if (unavailable) {
            return unavailable;
        }
        try {
            this.git(['add', '.']);
            const filesChanged = this.getStagedFiles();
            if (filesChanged.length === 0) {
                return {
                    success: false,
                    filesChanged: [],
                    message,
                    error: 'No changes to commit',
                };
            }
            this.git(this.getCommitArgs(message, authorName, authorEmail));
            const commitHash = this.git(['rev-parse', '--short', 'HEAD']).trim();
            return {
                success: true,
                commitHash,
                filesChanged,
                message,
            };
        }
        catch (e) {
            return {
                success: false,
                filesChanged: [],
                message,
                error: this.formatError(e),
            };
        }
    }
    /**
     * Commit specific files
     */
    commitSpecific(filePaths, message, authorName, authorEmail) {
        const unavailable = this.getUnavailableResult();
        if (unavailable) {
            return unavailable;
        }
        try {
            const relativePaths = filePaths.map((filePath) => this.toRelativePath(filePath));
            this.git(['add', '--', ...relativePaths]);
            const filesChanged = this.getStagedFiles().filter((file) => relativePaths.includes(file));
            if (filesChanged.length === 0) {
                return {
                    success: false,
                    filesChanged: [],
                    message,
                    error: 'No changes to commit',
                };
            }
            this.git(this.getCommitArgs(message, authorName, authorEmail));
            const commitHash = this.git(['rev-parse', '--short', 'HEAD']).trim();
            return {
                success: true,
                commitHash,
                filesChanged,
                message,
            };
        }
        catch (e) {
            return {
                success: false,
                filesChanged: [],
                message,
                error: this.formatError(e),
            };
        }
    }
    /**
     * Sync notes: fetch and pull from remote
     */
    syncNotes() {
        const unavailable = this.getUnavailableSyncResult();
        if (unavailable) {
            return unavailable;
        }
        try {
            const branch = this.getBranch();
            this.git(['fetch']);
            const commitsBehind = this.getBehindRemote(branch);
            const commits = this.getRemoteCommits(branch, commitsBehind);
            try {
                this.git(['pull']);
            }
            catch (e) {
                const conflicts = this.getConflicts();
                return {
                    success: false,
                    branch,
                    commitsBehind,
                    commits,
                    conflicts,
                    error: conflicts.length > 0 ? `Merge conflicts detected in: ${conflicts.join(', ')}` : this.formatError(e),
                };
            }
            return {
                success: true,
                branch,
                commitsBehind,
                commits,
            };
        }
        catch (e) {
            return {
                success: false,
                branch: '',
                commitsBehind: 0,
                commits: [],
                error: this.formatError(e),
            };
        }
    }
    /**
     * Get current git status
     */
    getStatus() {
        const defaultStatus = {
            branch: 'unknown',
            commitHash: '',
            aheadRemote: 0,
            behindRemote: 0,
            uncommittedChanges: 0,
            lastCommitTime: 0,
            lastCommitMessage: '',
            gitAvailable: this.isGitAvailable(),
            isRepository: this.isGitRepository(),
        };
        if (!defaultStatus.gitAvailable || !defaultStatus.isRepository) {
            return defaultStatus;
        }
        try {
            const branch = this.getBranch();
            const commitHash = this.git(['rev-parse', '--short', 'HEAD']).trim();
            const { aheadRemote, behindRemote } = this.getAheadBehind(branch);
            const uncommittedChanges = this.git(['status', '--short'])
                .split('\n')
                .filter((line) => line.length > 0).length;
            const lastCommitMessage = this.git(['log', '-1', '--pretty=%B']).trim();
            const lastCommitTimestamp = this.git(['log', '-1', '--pretty=%ct']).trim();
            return {
                branch,
                commitHash,
                aheadRemote,
                behindRemote,
                uncommittedChanges,
                lastCommitTime: parseInt(lastCommitTimestamp, 10) * 1000,
                lastCommitMessage,
                gitAvailable: true,
                isRepository: true,
            };
        }
        catch {
            return defaultStatus;
        }
    }
    git(args) {
        return execFileSync('git', args, {
            cwd: this.vaultPath,
            stdio: 'pipe',
            encoding: 'utf-8',
        });
    }
    getUnavailableResult() {
        if (!this.isGitAvailable()) {
            return {
                success: false,
                filesChanged: [],
                message: '',
                error: 'Git is not available on this system',
            };
        }
        if (!this.isGitRepository()) {
            return {
                success: false,
                filesChanged: [],
                message: '',
                error: 'Directory is not a git repository',
            };
        }
        return null;
    }
    getUnavailableSyncResult() {
        if (!this.isGitAvailable()) {
            return {
                success: false,
                branch: '',
                commitsBehind: 0,
                commits: [],
                error: 'Git is not available on this system',
            };
        }
        if (!this.isGitRepository()) {
            return {
                success: false,
                branch: '',
                commitsBehind: 0,
                commits: [],
                error: 'Directory is not a git repository',
            };
        }
        return null;
    }
    getCommitArgs(message, authorName, authorEmail) {
        const args = ['commit', '-m', message];
        if (authorName && authorEmail) {
            args.push('--author', `${authorName} <${authorEmail}>`);
        }
        return args;
    }
    getStagedFiles() {
        return this.git(['diff', '--cached', '--name-only'])
            .split('\n')
            .map((file) => file.trim())
            .filter((file) => file.length > 0);
    }
    toRelativePath(filePath) {
        const relativePath = path.isAbsolute(filePath) ? path.relative(this.vaultPath, filePath) : filePath;
        return relativePath.replace(/\\/g, '/');
    }
    getAheadBehind(branch) {
        try {
            const output = this.git(['rev-list', '--left-right', '--count', `origin/${branch}...HEAD`])
                .trim()
                .split(/\s+/);
            return {
                behindRemote: parseInt(output[0] || '0', 10),
                aheadRemote: parseInt(output[1] || '0', 10),
            };
        }
        catch {
            return {
                aheadRemote: 0,
                behindRemote: 0,
            };
        }
    }
    getBehindRemote(branch) {
        return this.getAheadBehind(branch).behindRemote;
    }
    getRemoteCommits(branch, limit) {
        if (limit <= 0) {
            return [];
        }
        try {
            return this.git(['log', `HEAD..origin/${branch}`, '--pretty=%h%x09%s%x09%ct'])
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line.length > 0)
                .map((line) => {
                const [hash, message, timestamp] = line.split('\t');
                return {
                    hash,
                    message,
                    timestamp: parseInt(timestamp, 10) * 1000,
                };
            });
        }
        catch {
            return [];
        }
    }
    getConflicts() {
        try {
            return this.git(['diff', '--name-only', '--diff-filter=U'])
                .split('\n')
                .map((file) => file.trim())
                .filter((file) => file.length > 0);
        }
        catch {
            return [];
        }
    }
    formatError(error) {
        if (error instanceof Error) {
            const maybeError = error;
            const stderr = maybeError.stderr?.toString().trim();
            return stderr || error.message;
        }
        return String(error);
    }
}
//# sourceMappingURL=git-manager.js.map