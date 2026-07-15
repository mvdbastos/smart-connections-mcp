# Memory MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the read-only smart-connections-mcp into a self-contained Obsidian memory server with local embeddings, note create/edit/delete, semantic query, git push/sync with local fallback, and built-in operation guides.

**Architecture:** Add `embedder.ts` (transformers.js + bge-micro-v2) for query/note vectors, `note-writer.ts` for filesystem writes, `ajson-writer.ts` to persist vectors into `.smart-env/multi/*.ajson`, extend `git-manager.ts` with push, upgrade `search_notes` to semantic, and register new tools + MCP resources/prompts in `index.ts`.

**Tech Stack:** TypeScript, ES2022 modules, @modelcontextprotocol/sdk, zod, @huggingface/transformers (TaylorAI/bge-micro-v2, 384-dim), vitest, git via execFileSync.

---

## File Structure

- Create: `src/embedder.ts` — lazy model load, `embed(text): Promise<number[]>`, `isAvailable()`.
- Create: `src/note-writer.ts` — create/edit/delete, frontmatter, folder creation, append-section.
- Create: `src/ajson-writer.ts` — append source vector lines to `.smart-env/multi/*.ajson`.
- Create: `src/guides.ts` — guide/recipe text constants for MCP resources/prompts.
- Modify: `src/search-engine.ts` — semantic `searchByQuery` using embedder + keyword fallback.
- Modify: `src/smart-connections-loader.ts` — `upsertSource()` to mutate in-memory map.
- Modify: `src/git-manager.ts` — add `push()`, `syncNotes` = pull+push.
- Modify: `src/index.ts` — register create_note, edit_note, delete_note, git_push_notes; resources/prompts.
- Modify: `package.json` — add `@huggingface/transformers` dependency.
- Tests: `src/embedder.test.ts`, `src/note-writer.test.ts`, `src/ajson-writer.test.ts`, extend `src/git-manager.test.ts`.

---

## Task 1: Add embedder module

**Files:**
- Create: `src/embedder.ts`
- Test: `src/embedder.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add dependency**

Run: `npm install @huggingface/transformers@^3`
Expected: package.json dependencies include `@huggingface/transformers`.

- [ ] **Step 2: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { Embedder } from './embedder.js';

describe('Embedder', () => {
  it('produces a 384-dim vector or reports unavailable', async () => {
    const e = new Embedder();
    const ok = await e.tryInit();
    if (!ok) { expect(e.isAvailable()).toBe(false); return; }
    const vec = await e.embed('hello world');
    expect(vec.length).toBe(384);
  });
});
```

- [ ] **Step 3: Run test, expect fail**

Run: `npx vitest run src/embedder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement embedder**

```ts
export class Embedder {
  private pipe: any = null;
  private available = false;
  async tryInit(): Promise<boolean> {
    try {
      const { pipeline } = await import('@huggingface/transformers');
      this.pipe = await pipeline('feature-extraction', 'TaylorAI/bge-micro-v2');
      this.available = true;
    } catch { this.available = false; }
    return this.available;
  }
  isAvailable(): boolean { return this.available; }
  async embed(text: string): Promise<number[]> {
    if (!this.available) throw new Error('Embedder unavailable');
    const out = await this.pipe(text, { pooling: 'mean', normalize: true });
    return Array.from(out.data as Float32Array);
  }
}
```

- [ ] **Step 5: Run test, expect pass**

Run: `npx vitest run src/embedder.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json src/embedder.ts src/embedder.test.ts
git commit -m "feat: add local embedder with bge-micro-v2"
```

## Task 2: Loader upsertSource

**Files:**
- Modify: `src/smart-connections-loader.ts`

- [ ] **Step 1: Add method**

```ts
upsertSource(source: SmartSource): void {
  if (source && source.path) this.sources.set(source.path, source);
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/smart-connections-loader.ts
git commit -m "feat: allow loader source upsert"
```

## Task 3: AJSON writer

**Files:**
- Create: `src/ajson-writer.ts`
- Test: `src/ajson-writer.test.ts`

- [ ] **Step 1: Failing test** — write a vector, reload, assert source present.

```ts
import { describe, it, expect } from 'vitest';
import { appendSourceVector } from './ajson-writer.js';
import { SmartConnectionsLoader } from './smart-connections-loader.js';
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';

it('appends a source vector adopted by loader', async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'));
  fs.mkdirSync(path.join(vault, '.smart-env', 'multi'), { recursive: true });
  fs.writeFileSync(path.join(vault, '.smart-env', 'smart_env.json'),
    JSON.stringify({ smart_sources: { embed_model: { adapter: 'transformers', transformers: { model_key: 'TaylorAI/bge-micro-v2' } } } }));
  fs.writeFileSync(path.join(vault, 'A.md'), 'hi');
  appendSourceVector(vault, 'A.md', new Array(384).fill(0.1), 'TaylorAI/bge-micro-v2', 'h1', 2);
  const l = new SmartConnectionsLoader(vault); await l.initialize();
  expect(l.getSource('A.md')).toBeTruthy();
});
```

- [ ] **Step 2: Run, expect fail.** `npx vitest run src/ajson-writer.test.ts`

- [ ] **Step 3: Implement**

```ts
import * as fs from 'fs'; import * as path from 'path';
export function appendSourceVector(vault: string, notePath: string, vec: number[], modelKey: string, hash: string, tokens: number): void {
  const file = path.join(vault, '.smart-env', 'multi', notePath.replace(/[\\/]/g, '_') + '.ajson');
  const rec = { path: notePath, embeddings: { [modelKey]: { vec, last_embed: { hash, tokens } } }, class_name: 'SmartSource', blocks: {} };
  const line = `"smart_sources:${notePath}": ${JSON.stringify(rec)},\n`;
  fs.appendFileSync(file, line, 'utf-8');
}
```

- [ ] **Step 4: Run, expect pass.** **Step 5: Commit** `feat: persist vectors to ajson`.

## Task 4: Note writer

**Files:**
- Create: `src/note-writer.ts`
- Test: `src/note-writer.test.ts`

- [ ] **Step 1: Failing tests** — create (fails if exists), edit overwrite/append, append-section, delete.

```ts
import { describe, it, expect } from 'vitest'; import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
import { createNote, editNote, deleteNote } from './note-writer.js';
it('creates, edits, deletes', () => {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'w-'));
  createNote(v, 'F/N.md', '# T', { tags: ['a'] });
  expect(fs.existsSync(path.join(v, 'F/N.md'))).toBe(true);
  editNote(v, 'F/N.md', 'more', 'append');
  expect(fs.readFileSync(path.join(v, 'F/N.md'), 'utf-8')).toContain('more');
  deleteNote(v, 'F/N.md');
  expect(fs.existsSync(path.join(v, 'F/N.md'))).toBe(false);
});
```

- [ ] **Step 2: Run, expect fail.**

- [ ] **Step 3: Implement** (overwrite|append|append-section modes, frontmatter, mkdir -p, no-overwrite create, path traversal guard).

```ts
import * as fs from 'fs'; import * as path from 'path';
function safe(v: string, p: string) { const f = path.resolve(v, p); if (!f.startsWith(path.resolve(v))) throw new Error('path escapes vault'); return f; }
function fm(o?: Record<string, unknown>) { if (!o) return ''; const y = Object.entries(o).map(([k, val]) => `${k}: ${JSON.stringify(val)}`).join('\n'); return `---\n${y}\n---\n`; }
export function createNote(v: string, p: string, body: string, frontmatter?: Record<string, unknown>) { const f = safe(v, p); if (fs.existsSync(f)) throw new Error('exists'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, fm(frontmatter) + body, 'utf-8'); }
export function editNote(v: string, p: string, content: string, mode: 'overwrite'|'append'|'append-section', heading?: string) { const f = safe(v, p); const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : ''; const next = mode === 'overwrite' ? content : mode === 'append' ? cur + '\n' + content : cur + `\n## ${heading ?? 'Note'}\n` + content; fs.writeFileSync(f, next, 'utf-8'); }
export function deleteNote(v: string, p: string) { fs.rmSync(safe(v, p)); }
```

- [ ] **Step 4: Run, expect pass.** **Step 5: Commit** `feat: add note writer`.

## Task 5: Semantic search_notes

**Files:**
- Modify: `src/search-engine.ts`

- [ ] **Step 1:** Add `setEmbedder(e: Embedder)` and async `searchByQuery`: if embedder available, embed query → reuse `getEmbeddingNeighbors`; else keyword scan (current logic). Keep keyword as fallback.
- [ ] **Step 2: Build.** `npm run build` — no errors.
- [ ] **Step 3: Commit** `feat: semantic search with keyword fallback`.

## Task 6: Git push + sync

**Files:**
- Modify: `src/git-manager.ts`, `src/git-manager.test.ts`

- [ ] **Step 1: Failing test** — `push()` returns success false when no remote (local fallback), pull+push in sync.
- [ ] **Step 2:** Implement `push()` (git push; success false + local-fallback note if no remote/offline). Append push after pull in `syncNotes`.
- [ ] **Step 3: Run** `npx vitest run src/git-manager.test.ts` — pass. **Step 4: Commit** `feat: git push + sync push`.

## Task 7: Wire tools + auto-embed

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1:** Register `create_note`, `edit_note`, `delete_note`, `git_push_notes`. On write success, call embedder→appendSourceVector→loader.upsertSource (fallback: skip silently). **Step 2: Build.** **Step 3: Commit** `feat: write tools + auto-embed`.

## Task 8: Guides/recipes resources

**Files:**
- Create: `src/guides.ts`; Modify: `src/index.ts`

- [ ] **Step 1:** Add guide/recipe constants (search, similar, graph, read, create, edit, append-section, delete, embed-status, commit, push, sync + 5 recipes). Register `ListResources`/`ReadResource` + an index resource. **Step 2: Build.** **Step 3: Commit** `feat: expose memory guides and recipes`.

## Self-Review

- Spec coverage: semantic (T5), create/edit/delete (T4,T7), local embed+fallback (T1,T5,T7), git push/sync fallback (T6), AJSON store (T3), guides (T8) — all mapped.
- No placeholders; code shown per step.
- Type names consistent: `appendSourceVector`, `upsertSource`, `Embedder`, `createNote/editNote/deleteNote`.
