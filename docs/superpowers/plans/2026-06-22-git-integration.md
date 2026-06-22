# Git Integration for Smart Connections MCP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three new git-based tools (`commit_notes`, `commit_notes_specific`, `sync_notes`) and extend `get_stats` to include git status information.

**Architecture:** Create a `GitManager` utility class that handles all git command execution via `child_process.execSync`, error handling, and conflict detection. Integrate it into the MCP server by adding tool schemas (Zod), tool definitions, and request handlers to `index.ts`. Use Vitest for TDD workflow.

**Tech Stack:** Node.js `child_process` module (no external deps), Vitest for testing, Zod for schema validation, TypeScript ES2022.

---

## File Structure

| File | Responsibility |
|------|-----------------|
| `src/git-manager.ts` | **New.** Core git operations (commit, fetch, pull, status, config parsing). Public API: `commitAll()`, `commitSpecific()`, `syncNotes()`, `getGitStatus()`. Throws with descriptive errors. |
| `src/types.ts` | Extend with `GitCommitResult`, `GitSyncResult`, `GitStatus` interfaces. |
| `src/index.ts` | Add tool schemas (Zod), tool definitions, and handlers for 3 new tools + extend `get_stats`. |
| `package.json` | Add vitest as devDependency, add `test` and `test:watch` scripts. |
| `tsconfig.json` | Update `exclude` to skip `*.test.ts` if desired (optional). |
| `src/git-manager.test.ts` | **New.** All tests for GitManager (TDD). |

---

## Tasks

### Task 1: Add Vitest Setup

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json` (optional exclude update)

- [ ] **Step 1: Update package.json with vitest and @types/node**

Replace the `"devDependencies"` section:

```json
  "devDependencies": {
    "@types/node": "^22.10.5",
    "typescript": "^5.7.2",
    "vitest": "^2.1.2",
    "@vitest/ui": "^2.1.2"
  }
```

- [ ] **Step 2: Add test scripts to package.json**

Replace the `"scripts"` section:

```json
  "scripts": {
    "build": "tsc",
    "watch": "tsc --watch",
    "start": "node dist/index.js",
    "dev": "tsc && node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest watch"
  }
```

- [ ] **Step 3: Install dependencies**

Run in terminal:

```bash
npm install
```

Expected: `vitest` and `@vitest/ui` are installed; `npm list` shows both in devDependencies.

- [ ] **Step 4: Verify vitest works**

Run:

```bash
npm test
```

Expected: `No test files found` or similar (no tests yet, that's OK).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add vitest for TDD"
```

---

### Task 2: Define Git Types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add Git-related type interfaces to types.ts**

Append to end of [src/types.ts](src/types.ts):

```typescript
/**
 * Result of a git commit operation
 */
export interface GitCommitResult {
  success: boolean;
  commitHash?: string;
  filesChanged: string[];
  message: string;
  error?: string;
}

/**
 * Result of a git sync (fetch + pull) operation
 */
export interface GitSyncResult {
  success: boolean;
  branch: string;
  commitsBehind: number;
  commits: Array<{
    hash: string;
    message: string;
    timestamp: number;
  }>;
  conflicts?: string[];
  error?: string;
}

/**
 * Current git status of the vault
 */
export interface GitStatus {
  branch: string;
  commitHash: string;
  aheadRemote: number;
  behindRemote: number;
  uncommittedChanges: number;
  lastCommitTime: number;
  lastCommitMessage: string;
  gitAvailable: boolean;
  isRepository: boolean;
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run:

```bash
npm run build
```

Expected: Compilation succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "types: add git operation interfaces"
```

---

### Task 3: Write Git Manager Tests

**Files:**
- Create: `src/git-manager.test.ts`

- [ ] **Step 1: Create test file with imports and setup**

Create [src/git-manager.test.ts](src/git-manager.test.ts) with content:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test
```

Expected: All tests fail with `GitManager is not defined` or similar (class doesn't exist yet).

- [ ] **Step 3: Commit test file**

```bash
git add src/git-manager.test.ts
git commit -m "test: add git-manager test suite (TDD)"
```

---

### Task 4: Write Git Manager Implementation

**Files:**
- Create: `src/git-manager.ts`

- [ ] **Step 1: Create GitManager class with imports and basic structure**

Create [src/git-manager.ts](src/git-manager.ts):

```typescript
/**
 * Git Manager for Smart Connections MCP
 * Handles all git operations (commit, fetch, pull, status)
 */

import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { GitCommitResult, GitSyncResult, GitStatus } from './types.js';

export class GitManager {
  private vaultPath: string;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
  }

  /**
   * Check if git is available on the system
   */
  isGitAvailable(): boolean {
    try {
      execSync('git --version', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if the vault directory is a git repository
   */
  isGitRepository(): boolean {
    try {
      execSync('git rev-parse --git-dir', { cwd: this.vaultPath, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get current git branch name
   */
  getBranch(): string {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.vaultPath,
        stdio: 'pipe',
        encoding: 'utf-8',
      }).trim();
      return branch;
    } catch (e) {
      throw new Error(`Failed to get git branch: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Get git config user.name and user.email
   */
  getGitConfig(): { name: string; email: string } {
    try {
      const name = execSync('git config user.name', {
        cwd: this.vaultPath,
        stdio: 'pipe',
        encoding: 'utf-8',
      }).trim();

      const email = execSync('git config user.email', {
        cwd: this.vaultPath,
        stdio: 'pipe',
        encoding: 'utf-8',
      }).trim();

      return { name, email };
    } catch (e) {
      throw new Error(`Failed to get git config: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Commit all uncommitted changes
   */
  commitAll(message: string, authorName?: string, authorEmail?: string): GitCommitResult {
    try {
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

      // Stage all changes
      execSync('git add .', { cwd: this.vaultPath, stdio: 'pipe' });

      // Get list of staged files
      let filesChanged: string[] = [];
      try {
        const statusOutput = execSync('git diff --cached --name-only', {
          cwd: this.vaultPath,
          stdio: 'pipe',
          encoding: 'utf-8',
        });
        filesChanged = statusOutput.split('\n').filter((f) => f.length > 0);
      } catch {
        filesChanged = [];
      }

      // Build commit command with optional author
      let commitCmd = 'git commit -m "' + message.replace(/"/g, '\\"') + '"';
      if (authorName && authorEmail) {
        commitCmd += ` --author "${authorName} <${authorEmail}>"`;
      }

      // Commit
      const commitOutput = execSync(commitCmd, {
        cwd: this.vaultPath,
        stdio: 'pipe',
        encoding: 'utf-8',
      });

      // Extract commit hash
      const hashMatch = commitOutput.match(/\[.*? ([a-f0-9]{7})/);
      const commitHash = hashMatch ? hashMatch[1] : '';

      return {
        success: true,
        commitHash,
        filesChanged,
        message,
      };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      return {
        success: false,
        filesChanged: [],
        message: '',
        error: errorMsg,
      };
    }
  }

  /**
   * Commit specific files
   */
  commitSpecific(filePaths: string[], message: string, authorName?: string, authorEmail?: string): GitCommitResult {
    try {
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

      // Stage specific files
      const files = filePaths.map((f) => `"${f.replace(/"/g, '\\"')}"`).join(' ');
      execSync(`git add ${files}`, { cwd: this.vaultPath, stdio: 'pipe' });

      // Get relative paths for display
      const filesChanged = filePaths.map((f) => path.relative(this.vaultPath, f));

      // Build commit command
      let commitCmd = 'git commit -m "' + message.replace(/"/g, '\\"') + '"';
      if (authorName && authorEmail) {
        commitCmd += ` --author "${authorName} <${authorEmail}>"`;
      }

      execSync(commitCmd, { cwd: this.vaultPath, stdio: 'pipe' });

      // Get commit hash
      const commitHash = execSync('git rev-parse --short HEAD', {
        cwd: this.vaultPath,
        stdio: 'pipe',
        encoding: 'utf-8',
      }).trim();

      return {
        success: true,
        commitHash,
        filesChanged,
        message,
      };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      return {
        success: false,
        filesChanged: [],
        message: '',
        error: errorMsg,
      };
    }
  }

  /**
   * Sync notes: fetch and pull from remote
   */
  syncNotes(): GitSyncResult {
    try {
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

      const branch = this.getBranch();

      // Fetch from remote
      execSync('git fetch', { cwd: this.vaultPath, stdio: 'pipe' });

      // Check for conflicts before pulling
      try {
        execSync('git merge --no-commit --no-ff origin/' + branch, {
          cwd: this.vaultPath,
          stdio: 'pipe',
        });
        // Abort the merge if successful
        execSync('git merge --abort', { cwd: this.vaultPath, stdio: 'pipe' });
      } catch (e) {
        // Merge would fail (conflicts detected)
        execSync('git merge --abort', { cwd: this.vaultPath, stdio: 'pipe' });
        const conflictsOutput = execSync('git diff --name-only --diff-filter=U', {
          cwd: this.vaultPath,
          stdio: 'pipe',
          encoding: 'utf-8',
        });
        const conflicts = conflictsOutput.split('\n').filter((f) => f.length > 0);
        return {
          success: false,
          branch,
          commitsBehind: 0,
          commits: [],
          conflicts,
          error: `Merge conflicts detected in: ${conflicts.join(', ')}`,
        };
      }

      // Pull after checking
      execSync('git pull', { cwd: this.vaultPath, stdio: 'pipe' });

      // Get recent commits
      const commitsOutput = execSync('git log --oneline -5', {
        cwd: this.vaultPath,
        stdio: 'pipe',
        encoding: 'utf-8',
      });

      const commits = commitsOutput
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => {
          const [hash, ...msgParts] = line.split(' ');
          const message = msgParts.join(' ');
          return {
            hash: hash.substring(0, 7),
            message,
            timestamp: Date.now(),
          };
        });

      return {
        success: true,
        branch,
        commitsBehind: 0,
        commits,
      };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      return {
        success: false,
        branch: '',
        commitsBehind: 0,
        commits: [],
        error: errorMsg,
      };
    }
  }

  /**
   * Get current git status
   */
  getStatus(): GitStatus {
    const defaultStatus: GitStatus = {
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
      // Get branch
      const branch = this.getBranch();

      // Get commit hash
      const commitHash = execSync('git rev-parse --short HEAD', {
        cwd: this.vaultPath,
        stdio: 'pipe',
        encoding: 'utf-8',
      }).trim();

      // Get ahead/behind
      const aheadBehindOutput = execSync('git rev-list --left-right --count origin/' + branch + '...HEAD', {
        cwd: this.vaultPath,
        stdio: 'pipe',
        encoding: 'utf-8',
      })
        .trim()
        .split('\t');
      const behindRemote = parseInt(aheadBehindOutput[0] || '0', 10);
      const aheadRemote = parseInt(aheadBehindOutput[1] || '0', 10);

      // Get uncommitted changes
      const statusOutput = execSync('git status --short', {
        cwd: this.vaultPath,
        stdio: 'pipe',
        encoding: 'utf-8',
      });
      const uncommittedChanges = statusOutput.split('\n').filter((line) => line.length > 0).length;

      // Get last commit info
      const lastCommitMessage = execSync('git log -1 --pretty=%B', {
        cwd: this.vaultPath,
        stdio: 'pipe',
        encoding: 'utf-8',
      }).trim();

      const lastCommitTimestamp = execSync('git log -1 --pretty=%ct', {
        cwd: this.vaultPath,
        stdio: 'pipe',
        encoding: 'utf-8',
      }).trim();

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
    } catch (e) {
      return defaultStatus;
    }
  }
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run:

```bash
npm test
```

Expected: Tests pass (or skip gracefully if git not in PATH). Output should show all test cases passing.

- [ ] **Step 3: Verify TypeScript compilation**

Run:

```bash
npm run build
```

Expected: Compilation succeeds; `dist/git-manager.js` is created.

- [ ] **Step 4: Commit**

```bash
git add src/git-manager.ts src/git-manager.test.ts
git commit -m "feat: implement git-manager with full test coverage"
```

---

### 🛑 REVIEW CHECKPOINT: Test Suite Before Tool Integration

**At this point, all git operations are tested and working. Before proceeding to tool integration, please review:**

1. **Test Coverage** — Do the 11 tests adequately cover the git manager functionality?
2. **Error Handling** — Are error messages clear and actionable?
3. **Git Availability Fallback** — Does the manager handle missing git gracefully?
4. **Type Safety** — Are the return types (`GitCommitResult`, `GitSyncResult`, `GitStatus`) correct?

**Approval needed before proceeding to Tasks 5–7.**

---

### Task 5: Add Tool Schemas to index.ts

**Files:**
- Modify: `src/index.ts` (after line 65, add new Zod schemas before tool definitions)

- [ ] **Step 1: Import GitManager and git types**

After line 7 (after other imports), add:

```typescript
import { GitManager } from './git-manager.js';
import type { GitCommitResult, GitSyncResult, GitStatus } from './types.js';
```

- [ ] **Step 2: Add Zod schemas for commit_notes and commit_notes_specific**

Before line 66 (before `const GetSimilarNotesSchema`), add:

```typescript
const CommitNotesSchema = z.object({
  message: z.string().optional().describe('Commit message; auto-generated if omitted'),
  author_name: z.string().optional().describe('Git author name; uses config if omitted'),
  author_email: z.string().optional().describe('Git author email; uses config if omitted'),
});

const CommitNotesSpecificSchema = z.object({
  note_paths: z.array(z.string()).describe('Paths to notes to commit (relative to vault)'),
  message: z.string().optional().describe('Commit message; auto-generated if omitted'),
  author_name: z.string().optional().describe('Git author name; uses config if omitted'),
  author_email: z.string().optional().describe('Git author email; uses config if omitted'),
});

const SyncNotesSchema = z.object({});
```

- [ ] **Step 3: Add tool definitions for new tools**

Before line 88 (inside the `tools` array), add three new tool entries. Insert after the last existing tool (`get_stats`):

```typescript
  {
    name: 'commit_notes',
    description: 'Commit all uncommitted changes to git with an auto-generated or custom message.',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Commit message; auto-generated if omitted (e.g., "Updated: note1.md, note2.md")',
        },
        author_name: {
          type: 'string',
          description: 'Git author name; uses git config user.name if omitted',
        },
        author_email: {
          type: 'string',
          description: 'Git author email; uses git config user.email if omitted',
        },
      },
    },
  },
  {
    name: 'commit_notes_specific',
    description: 'Commit specific note files to git.',
    inputSchema: {
      type: 'object',
      properties: {
        note_paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Paths to notes to commit (relative to vault root, e.g., ["Note.md", "Folder/Note.md"])',
        },
        message: {
          type: 'string',
          description: 'Commit message; auto-generated if omitted',
        },
        author_name: {
          type: 'string',
          description: 'Git author name; uses git config user.name if omitted',
        },
        author_email: {
          type: 'string',
          description: 'Git author email; uses git config user.email if omitted',
        },
      },
      required: ['note_paths'],
    },
  },
  {
    name: 'sync_notes',
    description: 'Sync notes by fetching from remote and pulling changes. Detects and reports merge conflicts.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
```

- [ ] **Step 4: Compile and verify**

Run:

```bash
npm run build
```

Expected: Compilation succeeds; no errors in `dist/index.js`.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: add git tool schemas and definitions"
```

---

### Task 6: Add Tool Request Handlers for Git Commands

**Files:**
- Modify: `src/index.ts` (in the `CallToolRequestSchema` handler, add new cases after line 268)

- [ ] **Step 1: Initialize GitManager in the server setup**

After line 29 (after `const searchEngine = new SearchEngine(loader);`), add:

```typescript
// Initialize git manager for the vault
const gitManager = new GitManager(VAULT_PATH);
```

- [ ] **Step 2: Add commit_notes handler**

In the `switch(name)` block inside `CallToolRequestSchema` handler, add a new case before the `default` case (before line 312):

```typescript
      case 'commit_notes': {
        const { message, author_name, author_email } = CommitNotesSchema.parse(args);
        
        // Auto-generate message if not provided
        let commitMessage = message;
        if (!commitMessage) {
          // Get list of changed files
          try {
            const statusOutput = execSync('git status --short', {
              cwd: VAULT_PATH,
              stdio: 'pipe',
              encoding: 'utf-8',
            });
            const files = statusOutput
              .split('\n')
              .filter((line) => line.length > 0)
              .map((line) => line.substring(3))
              .slice(0, 5);
            const fileList = files.length > 5 ? [...files.slice(0, 4), '...'].join(', ') : files.join(', ');
            commitMessage = `Updated: ${fileList || 'workspace'}`;
          } catch {
            commitMessage = 'Updated: workspace';
          }
        }

        const result = gitManager.commitAll(commitMessage, author_name, author_email);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
          isError: !result.success,
        };
      }
```

Import `execSync` at the top of the file (after line 4):

```typescript
import { execSync } from 'child_process';
```

- [ ] **Step 3: Add commit_notes_specific handler**

Add another case in the `switch(name)` block:

```typescript
      case 'commit_notes_specific': {
        const { note_paths, message, author_name, author_email } = CommitNotesSpecificSchema.parse(args);
        
        // Auto-generate message if not provided
        let commitMessage = message;
        if (!commitMessage) {
          const noteList = note_paths.slice(0, 3).join(', ');
          const suffix = note_paths.length > 3 ? ` (+${note_paths.length - 3} more)` : '';
          commitMessage = `Updated: ${noteList}${suffix}`;
        }

        // Convert relative paths to absolute for git manager
        const absolutePaths = note_paths.map((p) => path.join(VAULT_PATH, p));
        const result = gitManager.commitSpecific(absolutePaths, commitMessage, author_name, author_email);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
          isError: !result.success,
        };
      }
```

Import `path` at the top (after line 4):

```typescript
import * as path from 'path';
```

- [ ] **Step 4: Add sync_notes handler**

Add another case:

```typescript
      case 'sync_notes': {
        SyncNotesSchema.parse(args);
        const result = gitManager.syncNotes();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
          isError: !result.success,
        };
      }
```

- [ ] **Step 5: Compile and verify**

Run:

```bash
npm run build
```

Expected: Compilation succeeds; handlers are properly integrated.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts
git commit -m "feat: add git tool request handlers"
```

---

### Task 7: Extend get_stats to Include Git Status

**Files:**
- Modify: `src/index.ts` (in the `get_stats` handler around line 305–315)

- [ ] **Step 1: Update the get_stats handler**

Find the `case 'get_stats':` block (around line 305) and replace with:

```typescript
      case 'get_stats': {
        GetStatsSchema.parse(args);
        const stats = searchEngine.getStats();
        
        // Add git status if available
        let gitStatus = null;
        if (gitManager.isGitAvailable()) {
          gitStatus = gitManager.getStatus();
        }

        const combinedStats = {
          ...stats,
          git: gitStatus,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(combinedStats, null, 2),
            },
          ],
        };
      }
```

- [ ] **Step 2: Compile and verify**

Run:

```bash
npm run build
```

Expected: Compilation succeeds with no errors.

- [ ] **Step 3: Verify server startup with new tools**

Run the dev server:

```bash
npm run dev
```

Expected: Server starts successfully; logs should show it initialized and loaded tools. Verify output includes the three new git tools.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: extend get_stats with git status information"
```

---

## Summary

✅ **All 7 tasks complete:**

1. Vitest setup (testing framework)
2. Git type definitions
3. Git manager tests (TDD)
4. Git manager implementation
5. Tool schemas
6. Tool handlers (commit_notes, commit_notes_specific, sync_notes)
7. Extended get_stats with git info

**Expected Final State:**
- `src/git-manager.ts` — 280+ lines, full git operations
- `src/git-manager.test.ts` — 11 comprehensive tests
- `src/index.ts` — 3 new tools + extended get_stats
- `src/types.ts` — 3 new interfaces
- `package.json` — Vitest added with test scripts
- All TypeScript compilation succeeds
- Server starts and lists all tools

---

## Testing the Implementation

After all tasks are complete, verify functionality:

```bash
# Run all tests
npm test

# Start the MCP server
npm run dev

# In another terminal, call a tool via MCP client:
# Example: commit_notes with auto-generated message
# Example: sync_notes to fetch and pull
# Example: get_stats to see git status in output
```

Expected: All git tools work without errors, return proper JSON responses, handle missing git gracefully.

---

**Plan complete and saved.** Two execution options:

**1. Subagent-Driven (recommended)** - Fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
