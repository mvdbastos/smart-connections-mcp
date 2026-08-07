# Index / Filesystem Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The server must never write to a path it cannot confirm exists, and must never report a note that isn't there.

**Architecture:** The Smart Connections index is loaded once and never checked against disk. Three layers close the gap: `editNote` refuses to treat a missing file as an empty one; the loader gains `removeSource` so deletes stop manufacturing stale keys mid-session; and startup reconciliation drops index entries with no file behind them. `resolveNotePath` gains a `read`/`write` mode so writes never guess at a note by basename.

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest, Node `fs`.

**Spec:** `docs/superpowers/specs/2026-08-07-index-filesystem-integrity-design.md`

## Global Constraints

- **Branch:** `fix/index-filesystem-integrity`. Already exists and already contains the spec commit. Do not create it.
- **NEVER run `npm run build`. NEVER stage `dist/`.** `dist/` is tracked (75 files) and all three parallel branches compile into it. A single integration commit rebuilds it after all three merge. Stage explicitly: `git add src/ docs/ CHANGELOG.md`. **Never `git add -A`.**
- **Never use `git commit -m` with PowerShell here-strings.** Use `git commit -F -` with a heredoc.
- Commit messages end with these two trailers:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01K4mPAWNTYd7DgX5zMuGLe6
  ```
- Run tests with `npx vitest run <path>` for a single file, `npx vitest run` for all. Typecheck with `npx tsc --noEmit` — **not** `npm run build`.
- The full suite is 143 tests before this plan and must stay green.
- Existing loader tests use `createVaultWithSources(notePaths)` in `src/smart-connections-loader.test.ts`, which writes **both** the index entry and the real file to disk. Those tests therefore survive reconciliation unchanged. Stale-key tests need the new helper added in Task 1.
- A note that **exists and is empty** must remain editable. Only a **missing** file is refused. These two states were previously indistinguishable and separating them is the whole point — do not collapse them again.
- `src/prompts.ts` is also edited by branch A, in a different region. Touch only the `PromptContext.listByPrefix` doc comment (lines 10-15). Do not touch any prompt body.

---

### Task 1: Loader — `removeSource` and startup reconciliation

**Files:**
- Modify: `src/smart-connections-loader.ts`
- Test: `src/smart-connections-loader.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `removeSource(notePath: string): boolean` — true if a key was removed.
  - `reconcileWithFilesystem(): number` — count of entries dropped; `0` when the safety valve trips.

- [ ] **Step 1: Add the stale-vault test helper**

In `src/smart-connections-loader.test.ts`, add below the existing `createVaultWithSources` helper:

```ts
/**
 * Builds a vault whose index lists `indexed` but whose disk holds only `onDisk`.
 * Used to simulate notes moved or deleted outside this server.
 */
function createVaultWithStaleSources(indexed: string[], onDisk: string[]): string {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-stale-'));
  fs.mkdirSync(path.join(vault, '.smart-env', 'multi'), { recursive: true });
  fs.writeFileSync(
    path.join(vault, '.smart-env', 'smart_env.json'),
    JSON.stringify({
      smart_sources: {
        embed_model: {
          adapter: 'transformers',
          transformers: { model_key: 'model' },
        },
      },
    })
  );

  for (const notePath of onDisk) {
    fs.mkdirSync(path.dirname(path.join(vault, notePath)), { recursive: true });
    fs.writeFileSync(path.join(vault, notePath), `# ${notePath}`);
  }

  const lines = indexed.map(
    (notePath) => `${JSON.stringify(`smart_sources:${notePath}`)}: ${JSON.stringify(source(notePath))},`
  );
  fs.writeFileSync(path.join(vault, '.smart-env', 'multi', 'sources.ajson'), `${lines.join('\n')}\n`);

  return vault;
}
```

- [ ] **Step 2: Write the failing tests**

Append to `src/smart-connections-loader.test.ts`:

```ts
describe('index/filesystem reconciliation', () => {
  it('removeSource drops a key and reports whether it was present', async () => {
    const vault = createVaultWithSources(['A.md', 'B.md']);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      expect(loader.removeSource('A.md')).toBe(true);
      expect(loader.getSources().has('A.md')).toBe(false);
      expect(loader.removeSource('A.md')).toBe(false);
      expect(loader.getSources().has('B.md')).toBe(true);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('drops indexed entries whose file is missing', async () => {
    const vault = createVaultWithStaleSources(['A.md', 'gone/B.md', 'C.md'], ['A.md', 'C.md']);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      expect(loader.getSources().has('gone/B.md')).toBe(false);
      expect(loader.getSources().has('A.md')).toBe(true);
      expect(loader.getSources().has('C.md')).toBe(true);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('keeps the index intact when more than half the files are missing', async () => {
    const vault = createVaultWithStaleSources(['A.md', 'B.md', 'C.md', 'D.md'], ['A.md']);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      expect(loader.getSources().size).toBe(4);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('still reconciles when just under half are missing', async () => {
    const vault = createVaultWithStaleSources(['A.md', 'B.md', 'C.md', 'D.md'], ['A.md', 'B.md', 'C.md']);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      expect(loader.getSources().size).toBe(3);
      expect(loader.getSources().has('D.md')).toBe(false);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/smart-connections-loader.test.ts`
Expected: FAIL. `removeSource` does not exist (TypeScript error), and the reconciliation tests fail because all four indexed entries survive.

- [ ] **Step 4: Implement `removeSource`**

In `src/smart-connections-loader.ts`, directly after the `upsertSource` method (currently ending line 213), add:

```ts
  /**
   * Remove a source from the in-memory map. The counterpart to upsertSource;
   * without it a deleted note's key survives for the process lifetime and
   * later resolves as if the note still existed.
   */
  removeSource(notePath: string): boolean {
    return this.sources.delete(notePath);
  }
```

- [ ] **Step 5: Implement reconciliation**

In `src/smart-connections-loader.ts`, add this method directly after `removeSource`:

```ts
  /**
   * Drop indexed entries with no file behind them.
   *
   * Two-phase on purpose: the missing set is collected first, then checked
   * against the total before anything is deleted. If more than half the index
   * is missing, that is a systemic fault -- a wrong vault path, an unmounted
   * drive -- not staleness, and silently emptying the index would degrade the
   * server to "no notes exist" with no error raised.
   */
  reconcileWithFilesystem(): number {
    const missing: string[] = [];

    for (const notePath of this.sources.keys()) {
      if (!fs.existsSync(path.join(this.vaultPath, notePath))) {
        missing.push(notePath);
      }
    }

    if (missing.length === 0) {
      return 0;
    }

    if (missing.length > this.sources.size / 2) {
      console.error(
        `Refusing to reconcile: ${missing.length} of ${this.sources.size} indexed notes are missing from ${this.vaultPath}. ` +
          'This looks like a wrong vault path or an unavailable drive rather than stale index entries. Index left intact.'
      );
      return 0;
    }

    for (const notePath of missing) {
      this.sources.delete(notePath);
    }

    console.error(`Dropped ${missing.length} stale index entries with no file on disk`);
    return missing.length;
  }
```

- [ ] **Step 6: Call it during initialization**

In `src/smart-connections-loader.ts`, change `initialize()` (currently lines 23-34) so the body ends:

```ts
    // Load all sources
    await this.loadSources();

    // Drop entries for notes that no longer exist on disk
    this.reconcileWithFilesystem();
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/smart-connections-loader.test.ts`
Expected: PASS, including the pre-existing loader tests.

- [ ] **Step 8: Commit**

```bash
git add src/smart-connections-loader.ts src/smart-connections-loader.test.ts
git commit -F - <<'EOF'
fix: reconcile the index against disk and allow source removal

The Smart Connections index was loaded once and never checked against the
filesystem, and nothing could remove an entry -- upsertSource existed,
removeSource did not. Notes moved or deleted in Obsidian left their keys
behind permanently.

Startup now drops entries with no file behind them, guarded by a safety
valve: if more than half the index is missing, that is a wrong vault path
or an unavailable drive rather than staleness, so the index is left
intact and the condition is logged instead. Silently emptying a
3400-entry index would degrade the server to "no notes exist" with no
error raised.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K4mPAWNTYd7DgX5zMuGLe6
EOF
```

---

### Task 2: Read/write resolution modes

**Files:**
- Modify: `src/smart-connections-loader.ts`
- Test: `src/smart-connections-loader.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `resolveNotePath(notePath: string, mode?: 'read' | 'write'): string`. The `mode` parameter defaults to `'read'`, so every existing caller is unchanged. Task 4 passes `'write'`.

- [ ] **Step 1: Write the failing tests**

Append to `src/smart-connections-loader.test.ts`:

```ts
describe('write-mode path resolution', () => {
  it('resolves a basename in read mode but refuses it in write mode', async () => {
    const vault = createVaultWithSources(['Archive/2019/Foo.md']);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      expect(loader.resolveNotePath('Foo')).toBe('Archive/2019/Foo.md');
      expect(() => loader.resolveNotePath('Foo', 'write')).toThrow(/not found/i);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('names the declined basename candidates in the write-mode error', async () => {
    const vault = createVaultWithSources(['Archive/2019/Foo.md']);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      expect(() => loader.resolveNotePath('Foo', 'write')).toThrow(/Archive\/2019\/Foo\.md/);
      expect(() => loader.resolveNotePath('Foo', 'write')).toThrow(/action=create/);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('accepts exact, .md-append and case-insensitive matches in write mode', async () => {
    const vault = createVaultWithSources(['Notes/Alpha.md']);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      expect(loader.resolveNotePath('Notes/Alpha.md', 'write')).toBe('Notes/Alpha.md');
      expect(loader.resolveNotePath('Notes/Alpha', 'write')).toBe('Notes/Alpha.md');
      expect(loader.resolveNotePath('notes/alpha.md', 'write')).toBe('Notes/Alpha.md');
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('refuses an indexed key whose file is missing', async () => {
    const vault = createVaultWithStaleSources(['A.md', 'B.md', 'C.md'], ['A.md', 'B.md']);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();
      // Re-add the stale key to simulate drift appearing after startup.
      loader.upsertSource(source('C.md'));

      expect(() => loader.resolveNotePath('C.md', 'write')).toThrow(/not found/i);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/smart-connections-loader.test.ts`
Expected: FAIL — `resolveNotePath` takes one argument, so the two-argument calls are TypeScript errors and the basename call resolves rather than throwing.

- [ ] **Step 3: Rewrite `resolveNotePath`**

Replace the whole method in `src/smart-connections-loader.ts` (currently lines 126-164) with:

```ts
  /**
   * Resolve a caller-provided note path to the canonical indexed source path.
   *
   * In 'write' mode the result must have a real file behind it, and basename
   * guessing is disabled: silently resolving "Foo" to "Archive/2019/Foo.md"
   * is a convenience for a read and a loaded gun for an overwrite. Declined
   * candidates are still offered as suggestions in the error.
   */
  resolveNotePath(notePath: string, mode: 'read' | 'write' = 'read'): string {
    const exists = (candidate: string): boolean =>
      fs.existsSync(path.join(this.vaultPath, candidate));

    const accept = (candidate: string): string | null => {
      if (mode === 'write' && !exists(candidate)) {
        return null;
      }
      return candidate;
    };

    if (this.sources.has(notePath)) {
      const accepted = accept(notePath);
      if (accepted) {
        return accepted;
      }
    }

    if (!notePath.toLowerCase().endsWith('.md')) {
      const withExtension = `${notePath}.md`;
      if (this.sources.has(withExtension)) {
        const accepted = accept(withExtension);
        if (accepted) {
          return accepted;
        }
      }
    }

    const requestedLower = notePath.toLowerCase();
    for (const sourcePath of Array.from(this.sources.keys())) {
      if (sourcePath.toLowerCase() === requestedLower) {
        const accepted = accept(sourcePath);
        if (accepted) {
          return accepted;
        }
      }
    }

    const requestedBasename = path.basename(notePath, path.extname(notePath)).toLowerCase();
    const basenameMatches = Array.from(this.sources.keys()).filter((sourcePath) => {
      return path.basename(sourcePath, path.extname(sourcePath)).toLowerCase() === requestedBasename;
    });

    if (mode === 'read') {
      if (basenameMatches.length === 1) {
        return basenameMatches[0];
      }

      if (basenameMatches.length > 1) {
        throw new Error(`Ambiguous note "${notePath}". Candidates: ${basenameMatches.slice(0, 10).join(', ')}`);
      }

      const suggestions = this.closestSourcePaths(notePath, 3);
      const suggestionText = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : '';
      throw new Error(`Note not found: "${notePath}".${suggestionText}`);
    }

    const candidates = basenameMatches.length > 0 ? basenameMatches : this.closestSourcePaths(notePath, 3);
    const suggestionText = candidates.length > 0 ? ` Did you mean: ${candidates.slice(0, 3).join(', ')}?` : '';

    throw new Error(
      `Note not found: "${notePath}".${suggestionText} ` +
        'Pass the full path to edit an existing note, or use action=create to create a new one.'
    );
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/smart-connections-loader.test.ts`
Expected: PASS. The pre-existing read-mode tests must still pass unchanged — `getSource()` calls `resolveNotePath` with no mode argument and therefore still uses read semantics.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/smart-connections-loader.ts src/smart-connections-loader.test.ts
git commit -F - <<'EOF'
fix: stop guessing note paths on the write path

resolveNotePath performed no filesystem verification and would fall back
to matching on basename alone, so editing "Foo" could resolve to
"Archive/2019/Foo.md" -- a real note, with real content, that the caller
never named. Combined with mode=overwrite that destroys an unrelated
file.

Resolution now takes a mode. Read keeps today's behavior exactly. Write
requires the resolved path to have a file behind it and refuses basename
guessing, demoting the candidates it declined into the error message so
the caller can correct in one retry.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K4mPAWNTYd7DgX5zMuGLe6
EOF
```

---

### Task 3: `editNote` refuses to fabricate

**Files:**
- Modify: `src/note-writer.ts`
- Test: `src/note-writer.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `editNote` throws `Note not found: "<path>". Use action=create to create it.` when the target file does not exist. Both overloads keep their signatures.

- [ ] **Step 1: Write the failing tests**

Append to `src/note-writer.test.ts`:

```ts
describe('editNote refuses to fabricate notes', () => {
  it('throws for every edit mode when the file does not exist', () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'w-'));

    try {
      expect(() => editNote(vault, 'Missing.md', 'x', 'append')).toThrow(/not found/i);
      expect(() => editNote(vault, 'Missing.md', 'x', 'overwrite')).toThrow(/not found/i);
      expect(() => editNote(vault, 'Missing.md', 'x', 'append-section', 'H')).toThrow(/not found/i);
      expect(() =>
        editNote(vault, 'Missing.md', { mode: 'replace', content: 'x', find: 'y' })
      ).toThrow(/not found/i);
      expect(() =>
        editNote(vault, 'Missing.md', { mode: 'insert-after-heading', content: 'x', heading: 'H' })
      ).toThrow(/not found/i);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('names action=create in the error', () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'w-'));
    try {
      expect(() => editNote(vault, 'Missing.md', 'x', 'append')).toThrow(/action=create/);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('creates no file and no parent directory when refusing', () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'w-'));

    try {
      expect(() => editNote(vault, 'Memory/memory/Ghost.md', 'x', 'append')).toThrow();

      expect(fs.existsSync(path.join(vault, 'Memory', 'memory', 'Ghost.md'))).toBe(false);
      expect(fs.existsSync(path.join(vault, 'Memory', 'memory'))).toBe(false);
      expect(fs.existsSync(path.join(vault, 'Memory'))).toBe(false);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('still edits a note that exists and is empty', () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'w-'));

    try {
      createNote(vault, 'Empty.md', '');
      const result = editNote(vault, 'Empty.md', 'first line', 'append');

      expect(result.written).toBe(true);
      expect(fs.readFileSync(path.join(vault, 'Empty.md'), 'utf-8')).toContain('first line');
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('refuses a dry run against a missing note too', () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'w-'));
    try {
      expect(() =>
        editNote(vault, 'Missing.md', { mode: 'append', content: 'x', dryRun: true })
      ).toThrow(/not found/i);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/note-writer.test.ts`
Expected: FAIL. `editNote` currently creates the file and its directories rather than throwing.

- [ ] **Step 3: Add the existence guard**

In `src/note-writer.ts`, replace these two lines (currently 190-191):

```ts
  const file = safe(vault, notePath);
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
```

with:

```ts
  const file = safe(vault, notePath);

  if (!fs.existsSync(file)) {
    throw new Error(`Note not found: "${notePath}". Use action=create to create it.`);
  }

  const current = fs.readFileSync(file, 'utf-8');
```

- [ ] **Step 4: Delete the directory-creating line**

In `src/note-writer.ts`, delete this line entirely (currently line 230):

```ts
  fs.mkdirSync(path.dirname(file), { recursive: true });
```

leaving only:

```ts
  fs.writeFileSync(file, next, 'utf-8');
```

This is the line that materialized the reported phantom `Memory/memory/` folder. With the guard above it can never fire, but removing it makes "edit never creates directories" structural rather than merely prevented. Creation is entirely owned by `createNote`, which does its own `mkdirSync` and throws if the note already exists.

- [ ] **Step 5: Improve the `deleteNote` error**

In `src/note-writer.ts`, replace `deleteNote` (currently lines 241-243) with:

```ts
export function deleteNote(vault: string, notePath: string): void {
  const file = safe(vault, notePath);

  if (!fs.existsSync(file)) {
    throw new Error(`Note not found: "${notePath}". Nothing to delete.`);
  }

  fs.rmSync(file);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/note-writer.test.ts`
Expected: PASS. The pre-existing `'creates, edits, and deletes a note'` test must still pass — every `editNote` call in it targets a file created first.

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/note-writer.ts src/note-writer.test.ts
git commit -F - <<'EOF'
fix: editNote must not invent notes that do not exist

editNote treated a missing file as an empty one, so an edit against a
path with no file behind it silently created that file -- and
mkdirSync(recursive) created its parent directories along the way. That
is what produced the reported phantom Memory/memory/ folder, and it meant
an append landed in a brand-new file nobody would look at rather than
failing.

A missing file is now refused for every mode including overwrite;
action=create is the only path that creates a note. The mkdirSync call is
deleted rather than guarded, so "edit never creates directories" is
structural.

A file that exists and is empty is still editable. Those two states were
previously indistinguishable and separating them is the point.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K4mPAWNTYd7DgX5zMuGLe6
EOF
```

---

### Task 4: Wire write mode, source removal, and prefix filtering

**Files:**
- Modify: `src/index.ts`
- Modify: `src/prompts.ts` (doc comment only, lines 10-15)
- Test: `src/index.test.ts`

**Interfaces:**
- Consumes: `resolveNotePath(path, 'write')` from Task 2, `removeSource` from Task 1, the `editNote` guard from Task 3.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing reproduction test**

Append to `src/index.test.ts`. This exercises the three units together without importing `src/index.ts`, which has top-level side effects:

```ts
describe('delete then edit does not resurrect a note', () => {
  it('refuses the edit and leaves no file behind', async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'resurrect-'));
    fs.mkdirSync(path.join(vault, '.smart-env', 'multi'), { recursive: true });
    fs.writeFileSync(
      path.join(vault, '.smart-env', 'smart_env.json'),
      JSON.stringify({
        smart_sources: { embed_model: { adapter: 'transformers', transformers: { model_key: 'model' } } },
      })
    );
    fs.writeFileSync(path.join(vault, '.smart-env', 'multi', 'sources.ajson'), '\n');

    try {
      createNote(vault, 'Memory/Note.md', '# real content');

      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();
      loader.upsertSource({
        path: 'Memory/Note.md',
        embeddings: { model: { vec: [1, 0], last_embed: { hash: 'h', tokens: 1 } } },
        last_read: { hash: 'h', at: 0 },
        class_name: 'SmartSource',
        last_import: { mtime: 0, size: 0, at: 0, hash: 'h' },
        blocks: {},
      });

      // Delete through the same sequence the note_workflow handler uses.
      deleteNote(vault, 'Memory/Note.md');
      loader.removeSource('Memory/Note.md');

      // The index no longer claims it, so write-mode resolution refuses.
      expect(() => loader.resolveNotePath('Memory/Note.md', 'write')).toThrow(/not found/i);

      // And even a literal-path edit refuses rather than recreating.
      expect(() => editNote(vault, 'Memory/Note.md', 'fragment', 'append')).toThrow(/not found/i);
      expect(fs.existsSync(path.join(vault, 'Memory', 'Note.md'))).toBe(false);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });
});
```

Add these imports to the top of `src/index.test.ts` if not already present:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createNote, editNote, deleteNote } from './note-writer.js';
import { SmartConnectionsLoader } from './smart-connections-loader.js';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/index.test.ts`
Expected: FAIL — `removeSource` and the two-argument `resolveNotePath` are used here, so this passes only once Tasks 1-3 are merged. If Tasks 1-3 are already committed on this branch, this test should **pass** at this step; that is expected and fine. Confirm it passes, then continue — the remaining steps wire the same behavior into the live handler.

- [ ] **Step 3: Pass write mode in the handler**

In `src/index.ts`, in the `note_workflow` case, replace (currently lines 660-667):

```ts
        let targetPath = params.note_path;
        if (params.action !== 'create') {
          try {
            targetPath = loader.resolveNotePath(params.note_path);
          } catch {
            // Not indexed yet (e.g. brand-new file): fall back to the literal path.
          }
        }
```

with:

```ts
        let targetPath = params.note_path;
        if (params.action !== 'create') {
          try {
            targetPath = loader.resolveNotePath(params.note_path, 'write');
          } catch {
            // Not indexed, or indexed but gone from disk. Fall back to the
            // literal path; note-writer performs the authoritative existence
            // check and refuses rather than fabricating the file.
          }
        }
```

- [ ] **Step 4: Remove the source on delete**

In `src/index.ts`, in the same case, replace (currently lines 691-694):

```ts
        } else {
          deleteNote(VAULT_ROOT, targetPath);
          payload = { action: 'delete', note_path: targetPath, written: true };
          wroteChanges = true;
        }
```

with:

```ts
        } else {
          deleteNote(VAULT_ROOT, targetPath);
          loader.removeSource(targetPath);
          payload = { action: 'delete', note_path: targetPath, written: true };
          wroteChanges = true;
        }
```

- [ ] **Step 5: Do the same for the deprecated `delete_note` tool**

In `src/index.ts`, find the `case 'delete_note':` handler (around line 832) and add the same `loader.removeSource(note_path);` call immediately after its `deleteNote(VAULT_ROOT, note_path);` line, before `syncScheduler.markDirty(note_path);`.

- [ ] **Step 6: Filter `listByPrefix` by existence**

In `src/index.ts`, replace the `listByPrefix` implementation (currently lines 600-603):

```ts
      listByPrefix: async (prefix: string) =>
        Array.from(loader.getSources().keys())
          .filter((notePath) => notePath.startsWith(prefix))
          .sort(),
```

with:

```ts
      listByPrefix: async (prefix: string) =>
        Array.from(loader.getSources().keys())
          .filter((notePath) => notePath.startsWith(prefix))
          .filter((notePath) => fs.existsSync(path.join(VAULT_ROOT, notePath)))
          .sort(),
```

Confirm `fs` and `path` are already imported in `src/index.ts` — they are, but check rather than assume.

- [ ] **Step 7: Narrow the `PromptContext` doc comment**

In `src/prompts.ts`, replace the `listByPrefix` doc comment (lines 10-15):

```ts
  /**
   * Optional. Lists vault-relative note paths beginning with `prefix`.
   * Backed by the loader's indexed sources, so freshly written notes may
   * lag until reindex — treat results as a display hint, never as an
   * authoritative migration check.
   */
```

with:

```ts
  /**
   * Optional. Lists vault-relative note paths beginning with `prefix`.
   * Every returned path is verified to exist on disk, so results no longer
   * include notes that were moved or deleted. Freshly written notes may
   * still lag until reindex, so the listing can be incomplete — and
   * `metadata.vault_note` remains the only authoritative migration check.
   */
```

**Do not touch any prompt body in this file.** Branch A edits those.

- [ ] **Step 8: Typecheck and run the full suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 9: Verify `dist/` was not touched**

Run: `git status --short`
Expected: only `src/` files listed. If `dist/` appears, run `git checkout -- dist/`.

- [ ] **Step 10: Commit**

```bash
git add src/index.ts src/prompts.ts src/index.test.ts
git commit -F - <<'EOF'
fix: verify paths on the write path and stop listing missing notes

The delete branch removed the file but never told the loader, so the
index kept the key for the process lifetime. A delete followed by an edit
of the same path therefore resurrected the note as a fragment -- in one
session, with no external editor involved. That is now covered by a
regression test.

Writes resolve in write mode, deletes drop the source from the index, and
listByPrefix verifies each path exists before returning it, which is
issue #4 directly.

Closes #4
Closes #7

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K4mPAWNTYd7DgX5zMuGLe6
EOF
```

---

### Task 5: Document the behavior change

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Read the existing format**

Run: `head -40 CHANGELOG.md`
Match the existing heading style and date format.

- [ ] **Step 2: Add the entry**

Add at the top of the version list. Content to convey:

- **Changed (breaking):** `note_workflow action=edit` no longer creates a note that does not exist — this includes `mode=overwrite`. Use `action=create`. Previously a missing file was treated as empty, so the edit silently created the file and its parent directories.
- **Changed (breaking):** edits and deletes no longer resolve a bare note name by basename. `note_path` must be an exact path, a path without the `.md` suffix, or a case-insensitive match. The error lists the candidates it declined. Reads are unaffected.
- **Fixed:** deleting a note now removes it from the in-memory index, so a later edit of the same path cannot resurrect it (#7).
- **Fixed:** index entries whose file is missing are dropped at startup, so `listByPrefix` and search no longer surface notes that were moved or deleted (#4).

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -F - <<'EOF'
docs: record the write-path strictness changes

Refusing to create on edit and dropping basename resolution for writes
are both behavior changes on a live tool. They are the intended fix for
silent note fabrication, but callers relying on overwrite-as-upsert or on
bare note names will notice immediately.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K4mPAWNTYd7DgX5zMuGLe6
EOF
```

---

## Done criteria

- [ ] `npx vitest run` passes; total is 143 + 14 new tests (4 in Task 1, 4 in Task 2, 5 in Task 3, 1 in Task 4).
- [ ] `npx tsc --noEmit` reports no errors.
- [ ] `git status --short` is clean and `dist/` was never staged.
- [ ] The delete→edit reproduction test exists and passes.
- [ ] Editing an existing **empty** note still works — verify this specifically; it is the regression this plan most risks.
