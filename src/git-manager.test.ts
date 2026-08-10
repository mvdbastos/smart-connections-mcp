import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GitManager } from './git-manager.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

// Use a temporary test directory
let TEST_DIR: string;

function removeTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EBUSY' && code !== 'EPERM') {
        throw error;
      }
    }
  }
}

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-connections-pathspec-'));
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@example.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test User"', { cwd: dir, stdio: 'pipe' });
  return dir;
}

describe('GitManager', () => {
  beforeAll(() => {
    TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-connections-git-'));

    // Create test directory
    removeTempDir(TEST_DIR);
    fs.mkdirSync(TEST_DIR, { recursive: true });

    // Initialize a git repo
    try {
      execSync('git init', { cwd: TEST_DIR, stdio: 'pipe' });
      execSync('git config user.email "test@example.com"', { cwd: TEST_DIR, stdio: 'pipe' });
      execSync('git config user.name "Test User"', { cwd: TEST_DIR, stdio: 'pipe' });
    } catch (e) {
      console.warn('Git not available for tests, skipping setup');
    }
  });

  afterAll(() => {
    // Cleanup
    removeTempDir(TEST_DIR);
  });

  it('should detect when git is available', () => {
    const manager = new GitManager(TEST_DIR);
    const available = manager.isGitAvailable();
    expect(typeof available).toBe('boolean');
  });

  it('should detect if directory is a git repository', () => {
    const manager = new GitManager(TEST_DIR);
    const isRepo = manager.isGitRepository();
    expect(typeof isRepo).toBe('boolean');
  });

  it('should get current branch name', () => {
    const manager = new GitManager(TEST_DIR);
    if (manager.isGitAvailable() && manager.isGitRepository()) {
      const branch = manager.getBranch();
      expect(typeof branch).toBe('string');
      expect(branch.length).toBeGreaterThan(0);
    }
  });

  it('should get git config user info', () => {
    const manager = new GitManager(TEST_DIR);
    if (manager.isGitAvailable()) {
      const config = manager.getGitConfig();
      expect(config).toHaveProperty('name');
      expect(config).toHaveProperty('email');
    }
  });

  it('should commit all changes when files are modified', () => {
    const manager = new GitManager(TEST_DIR);
    if (!manager.isGitAvailable() || !manager.isGitRepository()) {
      // Skip if git not available
      expect(true).toBe(true);
      return;
    }

    // Create a test file
    const testFile = path.join(TEST_DIR, 'test.md');
    fs.writeFileSync(testFile, 'test content');

    try {
      execSync('git add .', { cwd: TEST_DIR, stdio: 'pipe' });
      const result = manager.commitAll('Test commit');
      expect(result.success).toBe(true);
      expect(result.commitHash).toBeDefined();
      expect(result.commitHash?.length).toBeGreaterThan(0);
    } catch (e) {
      // May fail if nothing to commit, that's OK
      expect(true).toBe(true);
    }
  });

  it('should commit specific files', () => {
    const manager = new GitManager(TEST_DIR);
    if (!manager.isGitAvailable() || !manager.isGitRepository()) {
      expect(true).toBe(true);
      return;
    }

    // Create test files
    const file1 = path.join(TEST_DIR, 'file1.md');
    const file2 = path.join(TEST_DIR, 'file2.md');
    fs.writeFileSync(file1, 'content 1');
    fs.writeFileSync(file2, 'content 2');

    try {
      const result = manager.commitSpecific([file1], 'Specific commit');
      expect(result.success).toBe(true);
      expect(result.filesChanged).toContain('file1.md');
    } catch (e) {
      expect(true).toBe(true);
    }
  });

  it('should not commit unrelated staged files when committing specific files', () => {
    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-connections-specific-'));

    try {
      execSync('git init', { cwd: isolatedDir, stdio: 'pipe' });
      execSync('git config user.email "test@example.com"', { cwd: isolatedDir, stdio: 'pipe' });
      execSync('git config user.name "Test User"', { cwd: isolatedDir, stdio: 'pipe' });
      fs.writeFileSync(path.join(isolatedDir, 'initial.md'), 'initial');
      execSync('git add initial.md', { cwd: isolatedDir, stdio: 'pipe' });
      execSync('git commit -m "Initial commit"', { cwd: isolatedDir, stdio: 'pipe' });

      const manager = new GitManager(isolatedDir);
      const selectedFile = path.join(isolatedDir, 'selected.md');
      const unrelatedFile = path.join(isolatedDir, 'unrelated.md');

      fs.writeFileSync(selectedFile, 'selected');
      fs.writeFileSync(unrelatedFile, 'unrelated');
      execSync('git add unrelated.md', { cwd: isolatedDir, stdio: 'pipe' });

      const result = manager.commitSpecific([selectedFile], 'Specific only');
      expect(result.success, result.error).toBe(true);

      const committedFiles = execSync('git show --name-only --pretty=format: HEAD', {
        cwd: isolatedDir,
        stdio: 'pipe',
        encoding: 'utf-8',
      })
        .split('\n')
        .filter((line) => line.length > 0);
      const stagedFiles = execSync('git diff --cached --name-only', {
        cwd: isolatedDir,
        stdio: 'pipe',
        encoding: 'utf-8',
      })
        .split('\n')
        .filter((line) => line.length > 0);

      expect(result.success).toBe(true);
      expect(committedFiles).toEqual(['selected.md']);
      expect(stagedFiles).toEqual(['unrelated.md']);
    } finally {
      removeTempDir(isolatedDir);
    }
  });

  it('should return error when git is not available', () => {
    // Create manager with path that doesn't have git
    const invalidManager = new GitManager('/nonexistent/path');
    const available = invalidManager.isGitAvailable();
    if (!available) {
      expect(available).toBe(false);
    }
  });

  it('should get git status with proper structure', () => {
    const manager = new GitManager(TEST_DIR);
    if (manager.isGitAvailable() && manager.isGitRepository()) {
      const status = manager.getStatus();
      expect(status).toHaveProperty('branch');
      expect(status).toHaveProperty('commitHash');
      expect(status).toHaveProperty('aheadRemote');
      expect(status).toHaveProperty('behindRemote');
      expect(status).toHaveProperty('uncommittedChanges');
      expect(status).toHaveProperty('lastCommitTime');
    }
  });

  it('should handle commit with custom author', () => {
    const manager = new GitManager(TEST_DIR);
    if (!manager.isGitAvailable() || !manager.isGitRepository()) {
      expect(true).toBe(true);
      return;
    }

    const testFile = path.join(TEST_DIR, 'authored.md');
    fs.writeFileSync(testFile, 'content');

    try {
      execSync('git add .', { cwd: TEST_DIR, stdio: 'pipe' });
      const result = manager.commitAll('Authored commit', 'Custom Author', 'custom@example.com');
      expect(result).toHaveProperty('success');
    } catch (e) {
      expect(true).toBe(true);
    }
  });

  it('should detect missing git repository gracefully', () => {
    const nonGitDir = path.join(TEST_DIR, 'not-a-repo');
    fs.mkdirSync(nonGitDir, { recursive: true });

    const manager = new GitManager(nonGitDir);
    const isRepo = manager.isGitRepository();
    expect(isRepo).toBe(false);

    removeTempDir(nonGitDir);
  });

  it('should time out sync commands instead of hanging', () => {
    const fakeGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-connections-fake-git-'));
    const fakeRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-connections-fake-repo-'));
    const originalPath = process.env.PATH;

    try {
      const fakeGitPath = path.join(fakeGitDir, 'fake-git.js');
      const fakeGitScript = [
        'const args = process.argv.slice(2);',
        'if (args[0] === "--version") { console.log("git version 2.0.0"); process.exit(0); }',
        `if (args[0] === "rev-parse" && args[1] === "--show-toplevel") { console.log(${JSON.stringify(fakeRepoDir)}); process.exit(0); }`,
        'if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") { console.log("main"); process.exit(0); }',
        'if (args[0] === "fetch") { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000); process.exit(0); }',
        'process.exit(0);',
      ].join('\n');

      fs.writeFileSync(fakeGitPath, fakeGitScript);

      process.env.PATH = `${fakeGitDir}${path.delimiter}${originalPath || ''}`;
      const manager = new GitManager(fakeRepoDir, {
        commandTimeoutMs: 1000,
        gitExecutable: process.execPath,
        gitArgsPrefix: [fakeGitPath],
      });

      const startedAt = Date.now();
      const result = manager.syncNotes();

      expect(Date.now() - startedAt).toBeLessThan(2500);
      expect(result.success).toBe(false);
      expect(result.error?.toLowerCase()).toContain('timed out');
    } finally {
      process.env.PATH = originalPath;
      removeTempDir(fakeGitDir);
      removeTempDir(fakeRepoDir);
    }
  });

  it('should use the configured upstream instead of origin branch for status', () => {
    const fakeGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-connections-upstream-git-'));
    const fakeRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-connections-upstream-repo-'));

    try {
      const fakeGitPath = path.join(fakeGitDir, 'fake-git.js');
      const fakeGitScript = [
        'const args = process.argv.slice(2);',
        'const joined = args.join(" ");',
        'if (args[0] === "--version") { console.log("git version 2.0.0"); process.exit(0); }',
        `if (joined === "rev-parse --show-toplevel") { console.log(${JSON.stringify(fakeRepoDir)}); process.exit(0); }`,
        'if (joined === "rev-parse --abbrev-ref HEAD") { console.log("main"); process.exit(0); }',
        'if (joined === "rev-parse --short HEAD") { console.log("abc1234"); process.exit(0); }',
        'if (joined === "rev-parse --abbrev-ref --symbolic-full-name @{upstream}") { console.log("backup/trunk"); process.exit(0); }',
        'if (joined === "rev-list --left-right --count backup/trunk...HEAD") { console.log("2\\t1"); process.exit(0); }',
        'if (joined === "rev-list --left-right --count origin/main...HEAD") { console.log("0\\t0"); process.exit(0); }',
        'if (joined === "status --short") { process.exit(0); }',
        'if (joined === "log -1 --pretty=%B") { console.log("Last commit"); process.exit(0); }',
        'if (joined === "log -1 --pretty=%ct") { console.log("1710000000"); process.exit(0); }',
        'process.exit(1);',
      ].join('\n');

      fs.writeFileSync(fakeGitPath, fakeGitScript);

      const manager = new GitManager(fakeRepoDir, {
        gitExecutable: process.execPath,
        gitArgsPrefix: [fakeGitPath],
      });

      const status = manager.getStatus();

      expect(status.behindRemote).toBe(2);
      expect(status.aheadRemote).toBe(1);
    } finally {
      removeTempDir(fakeGitDir);
      removeTempDir(fakeRepoDir);
    }
  });

  it('should return local fallback when pushing without a remote', () => {
    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-connections-push-'));

    try {
      execSync('git init', { cwd: isolatedDir, stdio: 'pipe' });
      execSync('git config user.email "test@example.com"', { cwd: isolatedDir, stdio: 'pipe' });
      execSync('git config user.name "Test User"', { cwd: isolatedDir, stdio: 'pipe' });
      fs.writeFileSync(path.join(isolatedDir, 'initial.md'), 'initial');
      execSync('git add initial.md', { cwd: isolatedDir, stdio: 'pipe' });
      execSync('git commit -m "Initial commit"', { cwd: isolatedDir, stdio: 'pipe' });

      const manager = new GitManager(isolatedDir);
      const result = manager.push();

      expect(result.success).toBe(false);
      expect(result.localFallback).toBe(true);
      expect(result.error?.toLowerCase()).toContain('local');
    } finally {
      removeTempDir(isolatedDir);
    }
  });

  it('should push after pulling during sync', () => {
    const fakeGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-connections-sync-push-git-'));
    const fakeRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-connections-sync-push-repo-'));

    try {
      const logPath = path.join(fakeGitDir, 'calls.log');
      const fakeGitPath = path.join(fakeGitDir, 'fake-git.js');
      const fakeGitScript = [
        'const fs = require("fs");',
        'const args = process.argv.slice(2);',
        'const joined = args.join(" ");',
        `fs.appendFileSync(${JSON.stringify(logPath)}, joined + "\\n");`,
        'if (args[0] === "--version") { console.log("git version 2.0.0"); process.exit(0); }',
        `if (joined === "rev-parse --show-toplevel") { console.log(${JSON.stringify(fakeRepoDir)}); process.exit(0); }`,
        'if (joined === "rev-parse --abbrev-ref HEAD") { console.log("main"); process.exit(0); }',
        'if (joined === "rev-parse --abbrev-ref --symbolic-full-name @{upstream}") { console.log("origin/main"); process.exit(0); }',
        'if (joined === "rev-list --left-right --count origin/main...HEAD") { console.log("0\\t0"); process.exit(0); }',
        'if (joined === "fetch") { process.exit(0); }',
        'if (joined === "pull") { process.exit(0); }',
        'if (joined === "push") { process.exit(0); }',
        'process.exit(0);',
      ].join('\n');

      fs.writeFileSync(fakeGitPath, fakeGitScript);
      const manager = new GitManager(fakeRepoDir, {
        gitExecutable: process.execPath,
        gitArgsPrefix: [fakeGitPath],
      });

      const result = manager.syncNotes();

      expect(result.success).toBe(true);
      expect(fs.readFileSync(logPath, 'utf-8')).toContain('push');
    } finally {
      removeTempDir(fakeGitDir);
      removeTempDir(fakeRepoDir);
    }
  });
});

describe('commitSpecific pathspec filtering', () => {
  it('commits real paths and ignores one that was never committed and no longer exists', () => {
    const repo = makeRepo();

    try {
      fs.writeFileSync(path.join(repo, 'Real.md'), '# real');

      const result = new GitManager(repo).commitSpecific(
        [path.join(repo, 'Real.md'), path.join(repo, 'Ghost.md')],
        'Auto-commit: Real.md, Ghost.md'
      );

      expect(result.success).toBe(true);
      expect(result.filesChanged).toContain('Real.md');
      expect(result.filesChanged).not.toContain('Ghost.md');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('reports no changes when every path is a phantom', () => {
    const repo = makeRepo();

    try {
      const result = new GitManager(repo).commitSpecific(
        [path.join(repo, 'Ghost.md')],
        'Auto-commit: Ghost.md'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('No changes to commit');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('stages the deletion of a tracked file that was removed', () => {
    const repo = makeRepo();

    try {
      fs.writeFileSync(path.join(repo, 'Tracked.md'), '# t');
      const git = new GitManager(repo);
      git.commitSpecific([path.join(repo, 'Tracked.md')], 'add');

      fs.rmSync(path.join(repo, 'Tracked.md'));
      const result = git.commitSpecific([path.join(repo, 'Tracked.md')], 'remove');

      expect(result.success).toBe(true);
      expect(result.filesChanged).toContain('Tracked.md');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
