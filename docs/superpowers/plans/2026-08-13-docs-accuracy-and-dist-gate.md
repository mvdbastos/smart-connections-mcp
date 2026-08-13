# Documentation Accuracy and a `dist/` Freshness Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct agent-facing documentation that names fields the code does not return, correct three comments the code contradicts, and add a CI step that fails when the committed `dist/` is stale.

**Architecture:** Six tasks, each touching one file group. No code behavior changes — only comments, agent-facing prose, one CI step, and two tests. The final task rebuilds `dist/`, which the new CI gate then verifies on this PR's own run. A seventh task posts follow-up comments on two closed GitHub issues; it touches no files.

**Tech Stack:** TypeScript (ES2022, ESM), vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-13-docs-accuracy-and-dist-gate-design.md`

## Global Constraints

- Branch is `docs/accuracy-and-dist-gate`. Do not switch branches.
- Remote is named **`gh`**, not `origin`.
- **Never run `npm run build` or stage `dist/` except in Task 6.** `dist/` is tracked compiled output; rebuilding mid-branch creates unmergeable conflicts. Typecheck with `npx tsc --noEmit` instead.
- **Stage explicitly** — `git add <exact paths>`. Never `git add -A`.
- **Commit with a heredoc**, never a PowerShell here-string (invalid in Git Bash, corrupts the message):
  ```bash
  git commit -F - <<'EOF'
  subject line

  body

  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01RsJrgJJ3QpQJCLrgMgZzW8
  EOF
  ```
- Every commit carries both trailers above, verbatim.
- ESM import specifiers end in `.js` even for `.ts` sources.
- **This repository is public.** No agent-facing string may contain vault note paths, note titles, or vault contents. Counts, error text, versions, and OS are fine.
- Agent-facing copy uses exactly two terms: **"the vault"** (the notes and their index) and **"the vault server"** (the software). Never "Smart Connections", "smart-connections-mcp", or "this MCP server" in prose.
- `src/resources.ts` and `src/prompts.ts` bodies are template literals: backticks inside them are escaped as `` \` ``. Preserve that escaping exactly.
- Baseline before any task: **213 tests passing across 14 files.** This plan adds 2, ending at 215.

---

### Task 1: CI `dist/` freshness gate

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks. Task 6 depends on this gate existing only in the sense that Task 6's rebuild is what makes the gate pass.

The `Build` step already runs `npm run build`. This new step asserts that build produced nothing the committed tree lacks. It goes **last** so that test failures — the more informative signal — surface before a dist-drift failure.

- [ ] **Step 1: Read the current workflow**

Run: `cat .github/workflows/ci.yml`

Expected: a single `test` job ending with a `Test` step that runs `npm test`.

- [ ] **Step 2: Append the gate step**

Add to the end of `.github/workflows/ci.yml`, at the same indentation as the existing `- name: Test` step (6 spaces before `-`):

```yaml

      - name: Verify dist/ is current
        run: git diff --exit-code -- dist/
```

The complete file after this change:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - name: Typecheck
        run: npx tsc --noEmit

      - name: Build
        run: npm run build

      - name: Test
        run: npm test

      - name: Verify dist/ is current
        run: git diff --exit-code -- dist/
```

- [ ] **Step 3: Verify the YAML has no tabs**

Run: `grep -q "$(printf '\t')" .github/workflows/ci.yml && echo "TABS FOUND - FIX" || echo "no tabs, ok"`

Expected: `no tabs, ok`

(`grep -P` is not available in this environment's Git Bash — use the `printf` form above.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -F - <<'EOF'
ci: fail the build when committed dist/ is stale

dist/ is tracked compiled output rebuilt by hand as a branch's final step.
Forgetting that rebuild ships a server whose behaviour does not match its
source, and nothing caught it. The Build step already runs npm run build;
this asserts it produced nothing the committed tree lacks.

Placed last so test failures surface before a dist-drift failure.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RsJrgJJ3QpQJCLrgMgZzW8
EOF
```

---

### Task 2: Correct the `reconcileWithFilesystem` comment

**Files:**
- Modify: `src/smart-connections-loader.ts:291-306`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. Comment-only; no symbol changes.

Two defects in one doc comment. It cites `:25, :45, :59` for `initialize()`'s throws, which are really at lines 56, 76, and 90 — the citation drifted when code was added above them. And it states "The .ajson files are never rewritten" as a property of the whole server, which Task 3 shows is false (`src/ajson-writer.ts:43` appends to them).

The fix names the *conditions* rather than line numbers, so it cannot drift again, and scopes the `.ajson` claim to this function.

- [ ] **Step 1: Confirm the real throw locations**

Run: `grep -n "throw new Error" src/smart-connections-loader.ts | head -3`

Expected — three lines, in `initialize()`:
```
56:      throw new Error(`Smart Connections directory not found at: ${this.smartEnvPath}`);
76:      throw new Error(`Configuration file not found at: ${configPath}`);
90:      throw new Error(`Multi directory not found at: ${multiPath}`);
```

These are the missing-`.smart-env`, missing-`smart_env.json`, and missing-`multi/` conditions referenced below. (The error string on line 56 says "Smart Connections" but it is a runtime error message, not agent-facing prose, and is out of scope for this plan.)

- [ ] **Step 2: Replace the comment**

Find this exact block at `src/smart-connections-loader.ts:291-306`:

```ts
  /**
   * Drop indexed entries with no file behind them.
   *
   * Two-phase on purpose: the missing set is collected first, then checked
   * before anything is deleted. The check is exactly-100%-missing rather than
   * a ratio. A ratio is a one-way trap -- staleness only ever increases, so
   * the entries that would bring the ratio back under threshold are the ones
   * the guard refuses to drop, and the only call site is initialize().
   *
   * There is deliberately no vault-exists or non-empty check here. initialize()
   * throws at :25, :45, and :59 before this runs, so <vault>/.smart-env/multi/
   * provably exists by now; such a check could never be false.
   *
   * This mutates the in-memory Map only. The .ajson files are never rewritten,
   * so a wrong decision here costs one process lifetime and no more.
   */
```

Replace with:

```ts
  /**
   * Drop indexed entries with no file behind them.
   *
   * Two-phase on purpose: the missing set is collected first, then checked
   * before anything is deleted. The check is exactly-100%-missing rather than
   * a ratio. A ratio is a one-way trap -- staleness only ever increases, so
   * the entries that would bring the ratio back under threshold are the ones
   * the guard refuses to drop, and the only call site is initialize().
   *
   * There is deliberately no vault-exists or non-empty check here. initialize()
   * throws on a missing .smart-env, a missing smart_env.json, or a missing
   * multi/ before this runs, so <vault>/.smart-env/multi/ provably exists by
   * now; such a check could never be false.
   *
   * This function never writes to .ajson -- it mutates the in-memory Map only,
   * so a wrong decision here costs one process lifetime and no more.
   */
```

- [ ] **Step 3: Verify no line numbers remain in the comment**

Run: `sed -n '291,307p' src/smart-connections-loader.ts | grep -n ":25\|:45\|:59" && echo "STALE CITATION REMAINS" || echo "clean"`

Expected: `clean`

- [ ] **Step 4: Typecheck and run the covering suite**

Run: `npx tsc --noEmit && npx vitest run src/smart-connections-loader.test.ts`

Expected: typecheck silent (exit 0), all loader tests pass. Comment-only changes cannot alter behaviour; this confirms nothing was corrupted while editing.

- [ ] **Step 5: Commit**

```bash
git add src/smart-connections-loader.ts
git commit -F - <<'EOF'
docs: correct stale citations in the reconcile comment

The comment cited initialize()'s throws at :25, :45 and :59; they are at 56,
76 and 90 after code was added above them. Naming the conditions instead of
the lines means the comment cannot drift again.

Also scoped the .ajson claim: "the .ajson files are never rewritten" is only
true of this function. The server appends to them on every write.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RsJrgJJ3QpQJCLrgMgZzW8
EOF
```

---

### Task 3: Correct the false `.ajson` claim in the refusal hint

**Files:**
- Modify: `src/index-health-hints.ts:39-41`
- Test: `src/index-health-hints.test.ts`

**Interfaces:**
- Consumes: `buildIndexRefusalHint(vaultPath: string, health: IndexHealth): string` — already exists, signature unchanged.
- Produces: nothing new. Text content only.

The hint tells the user the vault server "never rewrites them itself". That is false: `src/ajson-writer.ts:43` calls `fs.appendFileSync` on every `note_workflow` write.

The prohibition it supports — do not delete `.smart-env`, do not hand-edit `.ajson` — is correct, and for a *stronger* reason than the one given: the server only ever appends new vectors and never regenerates deleted ones, so anything removed is gone until the note is re-embedded.

**Two existing assertions constrain the rewrite and must both still pass:**
- `src/index-health-hints.test.ts:34` — `expect(hint).toMatch(/Do NOT delete \.smart-env/)`
- `src/index-health-hints.test.ts:51` — `expect(hint).toContain('the vault server')`

The sentence being rewritten is the only place `the vault server` appears in the hint, so the replacement **must retain that exact phrase**.

- [ ] **Step 1: Confirm the server really does append**

Run: `grep -n "appendFileSync" src/ajson-writer.ts`

Expected: `43:  fs.appendFileSync(file, line, 'utf-8');`

This is the evidence the current wording is wrong. Do not skip it.

- [ ] **Step 2: Write the failing test**

Add to `src/index-health-hints.test.ts`, inside the existing `describe('index refusal hint', ...)` block, after the `forbids destructive recovery` test (which ends at line 37):

```ts
  it('gives the append-only reason rather than claiming the server never writes', () => {
    const hint = buildIndexRefusalHint('/vault', refusedHealth());

    expect(hint).toMatch(/only ever appends/);
    expect(hint).not.toMatch(/never rewrites them itself/);
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/index-health-hints.test.ts`

Expected: FAIL — 1 failed, 9 passed (the file has 9 existing tests). The failure is on `expect(hint).toMatch(/only ever appends/)`, because the hint still carries the old wording.

- [ ] **Step 4: Fix the hint text**

In `src/index-health-hints.ts`, find these three array entries at lines 39-41:

```ts
    'Do NOT delete .smart-env or hand-edit the .ajson files. Those embeddings are',
    'expensive to rebuild, and the vault server never rewrites them itself — a',
    'restart reloads whatever is on disk.',
```

Replace with these four:

```ts
    'Do NOT delete .smart-env or hand-edit the .ajson files. Those embeddings are',
    'expensive to rebuild, and the vault server only ever appends new vectors — it',
    'never regenerates deleted ones, so anything removed is gone until the note is',
    're-embedded.',
```

Note this keeps `the vault server` (required by the assertion at `:51`) and does not touch the `Do NOT delete .smart-env` sentence (required by the assertion at `:34`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/index-health-hints.test.ts`

Expected: PASS — 10 passed, 0 failed.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`

Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/index-health-hints.ts src/index-health-hints.test.ts
git commit -F - <<'EOF'
fix: correct the .ajson claim in the index refusal hint

The hint told the user the vault server "never rewrites them itself".
ajson-writer.ts appends to those files on every note_workflow write, so that
was simply wrong.

The prohibition stands, now with the accurate and stronger reason: the server
only appends new vectors and never regenerates deleted ones, so anything
removed is gone until the note is re-embedded.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RsJrgJJ3QpQJCLrgMgZzW8
EOF
```

---

### Task 4: Correct the documented tool contract

**Files:**
- Modify: `src/resources.ts` — `search_notes` section (lines 99-108), `get_stats` section (lines 148-156), and the search-fallback line (line 241)
- Test: `src/index.test.ts`

**Interfaces:**
- Consumes: `MEMORY_RESOURCES: MemoryResource[]` from `src/resources.ts`, where `MemoryResource` has a `.text` field holding the rendered body. Already imported in `src/index.test.ts`.
- Produces: nothing consumed by later tasks.

Three defects, all in the `tools` and `embeddings` resource bodies:

1. `get_stats` is documented as returning `total_notes`, `total_vectors`, `embedder_ready`, `sync`. The handler (`src/index.ts:670-684`) returns `totalNotes`, `totalBlocks`, `embeddingDimension`, `modelKey`, `git`, `sync`, `index`. Only `sync` is correct; `total_vectors` and `embedder_ready` exist nowhere in `src/`.
2. Line 241 instructs agents to check `get_stats` → `embedder_ready`, which can never succeed.
3. `search_notes` has no Returns block, so the `index_warning` wrap added in PR #14 is undocumented.

**On defect 2:** there is no field to repoint at. `Embedder.isAvailable()` exists (`src/embedder.ts:42`) but `getStats()` never surfaces it, and `embeddingDimension` is not a substitute — it derives from vectors already on disk, so it stays non-zero when the model fails to load in a previously-embedded vault, reporting "ready" in exactly the failure case that section is about. The sentence is therefore removed, not repointed. Surfacing the real signal is deliberately out of scope (see spec §3 D5).

These bodies are template literals. Backticks are escaped as `` \` `` — preserve that exactly.

**Line numbers below are as of plan-writing and shift as you edit.** Steps 3, 4 and 5 each edit a different region of the same file, and Step 4 edits *above* the others — after it lands, the `get_stats` block and the search-fallback line both move down by 4 lines. **Match on the exact quoted text, never on the line number.** The quoted before-text in each step is authoritative.

- [ ] **Step 1: Write the failing test**

Add to the end of `src/index.test.ts`, after the closing `});` of the existing `describe('agent-facing naming', ...)` block:

```ts

describe('documented tool contract', () => {
  it('never names a get_stats response field that does not exist', () => {
    const text = MEMORY_RESOURCES.map((resource) => resource.text).join('\n');

    expect(text).not.toMatch(/total_vectors/);
    expect(text).not.toMatch(/embedder_ready/);
    expect(text).not.toMatch(/total_notes/);
  });
});
```

This scans the live registry rather than a hand-copied list, so resources added later are covered automatically — the same anti-drift pattern as the `agent-facing naming` block above it. Note `total_notes` and `totalNotes` are distinct strings; the assertion rejects only the snake_case form, which is the one that does not exist.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/index.test.ts`

Expected: FAIL on `expect(text).not.toMatch(/total_vectors/)` — the string is still present at `src/resources.ts:154`.

- [ ] **Step 3: Replace the `get_stats` Returns block**

In `src/resources.ts`, find lines 148-156:

```
## get_stats

Server health and sync state.

**Returns:**
- \`total_notes\`: Notes in vault
- \`total_vectors\`: Embedded notes
- \`embedder_ready\`: Embedding model loaded
- \`sync\`: Commit/push state, pending paths, errors
```

Replace with:

```
## get_stats

Server health and sync state.

**Returns:**
- \`totalNotes\`: Notes currently in the index
- \`totalBlocks\`: Indexed blocks across those notes
- \`embeddingDimension\`: Vector length of the active model
- \`modelKey\`: Active embedding model
- \`git\`: Repository status, or null when git is unavailable
- \`sync\`: Commit/push state, pending paths, errors
- \`index\`: Startup reconcile counts — \`indexed\`, \`missing\`, \`dropped\`, \`refused\`, \`missing_sample\`, and \`hint\` when refused

\`index.indexed\` is a startup snapshot; \`totalNotes\` is read live. After a reconcile drops entries the two differ by design: \`indexed\` - \`dropped\` = \`totalNotes\`.
```

- [ ] **Step 4: Add the `search_notes` Returns block**

In `src/resources.ts`, find lines 99-108:

```
## search_notes

Semantic search with keyword fallback. Returns top-k matching notes.

**Parameters:**
- \`query\`: Natural-language search string
- \`limit\`: Max results (default 10)
- \`threshold\`: Similarity threshold 0–1 (default 0.5)
- \`include_content\`: Embed note text in results (default false)
- \`content_max_chars\`: Max characters per note (default 2000)
```

Replace with (same content, plus a Returns block at the end):

```
## search_notes

Semantic search with keyword fallback. Returns top-k matching notes.

**Parameters:**
- \`query\`: Natural-language search string
- \`limit\`: Max results (default 10)
- \`threshold\`: Similarity threshold 0–1 (default 0.5)
- \`include_content\`: Embed note text in results (default false)
- \`content_max_chars\`: Max characters per note (default 2000)

**Returns:** an array of matching notes.

While the index is unreconciled the response is wrapped as \`{ results, index_warning }\` instead. \`index_warning\` carries counts explaining that some results may have no file behind them — call \`get_stats\` for the full diagnosis. The wrap is absent in normal operation.
```

- [ ] **Step 5: Fix the search-fallback line**

In `src/resources.ts`, find line 241:

```
Check \`get_stats\` → \`embedder_ready\` to verify model status.
```

Replace with:

```
The fallback is automatic — no configuration or restart is needed. \`get_stats\` does not currently report model status.
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/index.test.ts`

Expected: PASS — the `documented tool contract` test now passes along with everything else in the file.

- [ ] **Step 7: Verify the phantom field names are gone from the whole source tree**

Run: `grep -rn "total_vectors\|embedder_ready" src/ --include="*.ts" | grep -v "\.test\.ts" && echo "STILL PRESENT IN SOURCE" || echo "gone from non-test source"`

Expected: `gone from non-test source`

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`

Expected: no output, exit 0. A broken template literal (an unescaped backtick) would surface here.

- [ ] **Step 9: Commit**

```bash
git add src/resources.ts src/index.test.ts
git commit -F - <<'EOF'
docs: document the tool contract get_stats actually returns

The tools resource named total_notes, total_vectors and embedder_ready. The
handler returns totalNotes, totalBlocks, embeddingDimension, modelKey, git,
sync and index -- only sync was correct, and the last two documented fields
exist nowhere in src/. One resource also told agents to check
get_stats -> embedder_ready to verify model status, which could never
succeed.

That sentence is removed rather than repointed: Embedder.isAvailable() is
never surfaced by getStats(), and embeddingDimension is not a substitute
because it derives from vectors already on disk, so it stays non-zero in
exactly the model-failed case the section describes.

Also documents search_notes' return value, including the index_warning wrap
added for #13, and records that index.indexed is a startup snapshot while
totalNotes is live.

The new test scans the live MEMORY_RESOURCES registry so a field name that
does not exist cannot be documented again.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RsJrgJJ3QpQJCLrgMgZzW8
EOF
```

---

### Task 5: Changelog

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

`CHANGELOG.md` has no dated headings. Entries are grouped under `## <feature-or-branch-name>` with `### Added/Changed/Fixed/Breaking` subsections, newest first.

- [ ] **Step 1: Insert the new section**

In `CHANGELOG.md`, insert immediately after the `# Changelog` heading and its blank line, and immediately **before** `## index-reconcile-recovery`:

```markdown
## docs-and-ci-accuracy

### Fixed
- `get_stats` documentation named three fields the tool does not return — `total_notes`, `total_vectors`, and `embedder_ready`. The latter two exist nowhere in the source, and one resource instructed agents to check `embedder_ready` to verify model status, an instruction that could never succeed. The documented contract now matches what the handler emits.
- The index refusal hint claimed the vault server "never rewrites" the `.ajson` files; it appends to them on every write. The prohibition on deleting or hand-editing them stands, now with the accurate reason: the server only appends new vectors and never regenerates deleted ones.
- Stale line-number citations in the `reconcileWithFilesystem` comment, replaced with the conditions they referred to so they cannot drift again.

### Added
- CI step failing the build when the committed `dist/` does not match what `src/` produces. `dist/` is tracked and rebuilt by hand, so a forgotten rebuild previously shipped a server whose behaviour did not match its source.
- `search_notes` documentation now describes its return value, including the `index_warning` wrap.

```

- [ ] **Step 2: Verify placement**

Run: `head -14 CHANGELOG.md`

Expected: `# Changelog`, blank line, `## docs-and-ci-accuracy`, then `### Fixed` and its bullets. `## index-reconcile-recovery` must appear *after* this new section.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -F - <<'EOF'
docs: changelog for documentation accuracy and the dist/ gate

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RsJrgJJ3QpQJCLrgMgZzW8
EOF
```

---

### Task 6: Rebuild `dist/`

**Files:**
- Modify: `dist/` (generated)

**Interfaces:**
- Consumes: the source changes from Tasks 2, 3, and 4.
- Produces: a `dist/` matching `src/`, which the Task 1 gate verifies.

**This is the only task permitted to run `npm run build` or stage `dist/`.** Do not run it earlier. Task 3 changed a string literal in `src/index-health-hints.ts` and Task 4 changed template-literal bodies in `src/resources.ts`, so `dist/` is genuinely stale and CI would fail without this.

- [ ] **Step 1: Confirm the working tree is clean**

Run: `git status --short`

Expected: no output. All prior tasks committed. If anything is uncommitted, stop and resolve it before building.

- [ ] **Step 2: Build**

Run: `npm run build`

Expected: no output, exit 0. (`tsc` is silent on success.)

- [ ] **Step 3: Confirm `dist/` actually changed**

Run: `git status --short dist/`

Expected: modified entries including `dist/index-health-hints.js` and `dist/resources.js`. If `dist/` is unchanged, something in Tasks 3-4 did not land — stop and investigate rather than committing an empty change.

- [ ] **Step 4: Run the full suite and typecheck**

Run: `npx tsc --noEmit && npm test`

Expected: typecheck silent; **215 tests passing across 14 files** (213 baseline + 1 from Task 3 + 1 from Task 4).

- [ ] **Step 5: Verify the gate would now pass**

Run: `git add dist/ && git diff --cached --quiet -- dist/ && echo "no change staged" || echo "dist/ staged, gate will pass after commit"`

Expected: `dist/ staged, gate will pass after commit`

- [ ] **Step 6: Commit**

```bash
git add dist/
git commit -F - <<'EOF'
build: rebuild dist/ for the documentation accuracy changes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RsJrgJJ3QpQJCLrgMgZzW8
EOF
```

- [ ] **Step 7: Final verification that the gate is satisfied**

Run: `npm run build && git diff --exit-code -- dist/ && echo "GATE PASSES"`

Expected: `GATE PASSES`. This runs exactly what CI will run.

---

### Task 7: Post follow-up comments on issues #4 and #7

**Files:** none — this task touches no files and makes no commits.

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

Both issues are closed and were fixed by PR #12. PR #12 filtered phantom paths at *read* time; the stale entries stayed in the index because `reconcileWithFilesystem` was refusing to drop them under the `>50%` guard described in #13. PR #14 fixed that guard, so a stuck vault should now self-heal on first start. Whether it actually did is unverified — these comments ask.

The #14 fix is already merged to `main`, so the behaviour being asked about is live now. **This task does not depend on the current branch merging** and may run at any point.

Post the text **verbatim** as approved in spec §5. Do not add vault paths, note titles, or vault contents — this repository is public.

- [ ] **Step 1: Confirm both issues are closed and unedited since**

Run: `gh issue view 4 --json number,state,title --jq '"#\(.number) \(.state)"' && gh issue view 7 --json number,state,title --jq '"#\(.number) \(.state)"'`

Expected:
```
#4 CLOSED
#7 CLOSED
```

- [ ] **Step 2: Comment on issue #4**

```bash
gh issue comment 4 -F - <<'EOF'
**Follow-up: this should now self-heal — can you confirm?**

This was fixed in #12 by filtering `listByPrefix` against the filesystem, which stopped phantom paths from reaching the `init` listing. But the stale entries themselves stayed in the index, because `reconcileWithFilesystem` was refusing to drop them — the `>50%` guard described in #13. With 28 of your entries phantom, that guard was likely tripped in exactly the vault this issue came from.

#14 fixed the guard. The stale entries should now actually be dropped on startup rather than filtered at read time.

To confirm, run `get_stats` and look at the new `index` block:

- On the first start after updating, `dropped` should be non-zero.
- On every start after that, `missing` should be 0.
- The `Memory/memory/` paths should be gone from the index entirely — not just absent from the `init` listing.

Please report the counts here. **Counts only — no note paths, note titles, or vault contents; this repository is public.**

If `missing` stays non-zero across restarts, say so and this gets reopened.
EOF
```

- [ ] **Step 3: Comment on issue #7**

```bash
gh issue comment 7 -F - <<'EOF'
**Follow-up: this should now self-heal — can you confirm?**

This was fixed in #12 by making `resolveNotePath` verify the file exists rather than trusting the index key. That closed the silent-create, but it left the stale keys in place — `reconcileWithFilesystem` was refusing to drop them under the `>50%` guard described in #13.

#14 fixed the guard, so the stale keys that made this reachable should now be dropped on startup.

To confirm, run `get_stats` and look at the new `index` block:

- On the first start after updating, `dropped` should be non-zero.
- On every start after that, `missing` should be 0.

Then try a `note_workflow` `edit` against a path you know is stale. It should error rather than silently creating a file — and after the reconcile, that path should no longer be in the index at all.

Please report the counts and the error here. **Counts only — no note paths, note titles, or vault contents; this repository is public.**

If `missing` stays non-zero across restarts, or the edit still creates a file, say so and this gets reopened.
EOF
```

- [ ] **Step 4: Verify both comments posted**

Run: `gh issue view 4 --json comments --jq '.comments[-1].body' | head -3 && echo "---" && gh issue view 7 --json comments --jq '.comments[-1].body' | head -3`

Expected: each begins with `**Follow-up: this should now self-heal — can you confirm?**`

---

## Completion

After Task 6, use **superpowers:finishing-a-development-branch** to land the branch. Task 7 is independent of that and can run before or after.

Expected final state:
- 7 commits on `docs/accuracy-and-dist-gate` (spec commit `6371387` plus six from Tasks 1-6).
- 215 tests passing across 14 files.
- `npx tsc --noEmit` silent.
- `git diff --exit-code -- dist/` clean after a fresh `npm run build`.
- CI green on the PR, including the new `Verify dist/ is current` step.
