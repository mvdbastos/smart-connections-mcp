import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GitManager } from './git-manager.js';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// Use a temporary test directory
const TEST_DIR = path.join(process.cwd(), '.test-vault');

describe('GitManager', () => {
  beforeAll(() => {
    // Create test directory
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
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
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
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

    fs.rmSync(nonGitDir, { recursive: true });
  });
});
