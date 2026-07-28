# Two-Tier Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three MCP prompts (`init`, `migrate`, `disable`) that make the Obsidian vault the system of record for agent memory, reducing Claude Code's native memory files to recall stubs.

**Architecture:** All behavior ships as prompt text — the MCP server cannot write to `.claude/projects/**`, so the agent performs both halves of every write (vault via `note_workflow`, stub via its own Write tool). The server contributes one read-only helper, `PromptContext.listByPrefix`, so prompts can pre-fetch what already exists under `Memory/`. `ListPrompts` and `GetPrompt` handlers need no change; they iterate `MEMORY_PROMPT_BY_NAME` generically.

**Tech Stack:** TypeScript (ESM, `tsc`), Vitest, Zod for argument validation, `@modelcontextprotocol/sdk`.

**Spec:** `docs/superpowers/specs/2026-07-28-two-tier-memory-design.md`

**Repo/branch:** `C:\obsidian\smart-connections-mcp`, branch `refactor/organize-resources-prompts` (PR #3 open).

## Global Constraints

- Vault path is `C:\obsidian\mb-kb`. Native memory lives at `.claude/projects/<slug>/memory/`.
- `vault_note` under `metadata` in a native file is the **only** authoritative migrated-flag. Never infer migration state from the vault listing.
- Migration order is a correctness requirement: **vault note before native stub.** The reverse loses data.
- Native stubs preserve `name`, `description`, `originSessionId`, and `modified` byte-for-byte.
- Vault note `date` = the original memory's `modified` when migrating; today's date when capturing fresh.
- Native `MEMORY.md` is never edited during migration — its link still resolves to an existing file.
- Index files use Claude's exact format: `# Memory Index` heading, then `- [Title](file.md) — hook` lines.
- `note_workflow action: 'edit'` against a missing note fails. Always `action: 'create'` first when seeding an index.
- Every prompt body must contain the string `note_workflow` and must not contain `git_commit_notes`, `git_push_notes`, or `git_sync_notes` — two existing test invariants enforce this across all prompts.
- Pre-fetch is always fail-soft: helper absent, rejecting, or empty all produce the plain body. Never throw out of `build`.
- Run tests with `npm test`. Single file: `npx vitest run src/prompts.test.ts`. Single case: `npx vitest run src/prompts.test.ts -t "<name>"`.

---

### Task 1: `disable` prompt

Simplest prompt, no context dependencies, pure instruction text. Establishes the pattern and proves the two global test invariants still hold when the prompt count changes.

**Files:**
- Modify: `src/prompts.ts` (append to `MEMORY_PROMPTS`)
- Test: `src/prompts.test.ts` (update count at line 6, both `testArgs` maps, add describe block)

**Interfaces:**
- Consumes: `MemoryPrompt`, `MEMORY_PROMPTS`, `MEMORY_PROMPT_BY_NAME` from `src/prompts.ts` (all existing).
- Produces: a prompt named `disable` with `arguments: []` and `build(args, ctx) => Promise<string>` that reads neither `ctx.search` nor `ctx.listByPrefix`.

- [ ] **Step 1: Update the prompt-count test and both testArgs maps**

In `src/prompts.test.ts`, change line 6-8:

```ts
  it('should have 6 prompts', () => {
    expect(MEMORY_PROMPTS).toHaveLength(6);
  });
```

Then add `disable: {},` to **both** `testArgs` maps — the one at line ~45 inside `all prompts should mention note_workflow in their content`, and the one at line ~65 inside `should not reference deprecated git tools`. Both maps must end up as:

```ts
    const testArgs: Record<string, Record<string, unknown>> = {
      capture_memory: { topic: 'test' },
      project_research: { topic: 'test' },
      cleanup_stale: { query: 'test' },
      daily_note: {},
      review_before_write: { note_path: 'test.md' },
      disable: {},
    };
```

- [ ] **Step 2: Write the failing describe block**

Append inside the outer `describe('prompts', ...)` in `src/prompts.test.ts`, immediately before the `describe('argument validation', ...)` block:

```ts
  describe('disable prompt', () => {
    const prompt = MEMORY_PROMPT_BY_NAME.get('disable')!;

    it('should declare no arguments', () => {
      expect(prompt.arguments).toEqual([]);
    });

    it('should state that capture is off', async () => {
      const context: PromptContext = { search: async () => [] };
      const text = await prompt.build({}, context);
      expect(text).toMatch(/OFF|off/);
      expect(text).toMatch(/do not capture/i);
    });

    it('should preserve read tools explicitly', async () => {
      const context: PromptContext = { search: async () => [] };
      const text = await prompt.build({}, context);
      expect(text).toMatch(/search_notes/);
      expect(text).toMatch(/get_note_content/);
      expect(text).toMatch(/writes, not reads/i);
    });

    it('should disclose that native memory writing continues', async () => {
      const context: PromptContext = { search: async () => [] };
      const text = await prompt.build({}, context);
      expect(text).toMatch(/harness/i);
      expect(text).toMatch(/backlog/i);
    });

    it('should name init as the re-enable path', async () => {
      const context: PromptContext = { search: async () => [] };
      const text = await prompt.build({}, context);
      expect(text).toMatch(/\binit\b/);
    });

    it('should call neither search nor listByPrefix', async () => {
      let searchCalled = false;
      let listCalled = false;
      const context: PromptContext = {
        search: async () => {
          searchCalled = true;
          return [];
        },
      };
      (context as { listByPrefix?: unknown }).listByPrefix = async () => {
        listCalled = true;
        return [];
      };
      await prompt.build({}, context);
      expect(searchCalled).toBe(false);
      expect(listCalled).toBe(false);
    });
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/prompts.test.ts`
Expected: FAIL. `MEMORY_PROMPT_BY_NAME.get('disable')` is `undefined`, so every case in the new block throws `Cannot read properties of undefined (reading 'arguments')`, and `should have 6 prompts` fails with `expected 5 to have a length of 6`.

- [ ] **Step 4: Implement the prompt**

In `src/prompts.ts`, append this object to the `MEMORY_PROMPTS` array, after the `review_before_write` entry:

```ts
  {
    name: 'disable',
    description: 'Suspend autonomous memory capture and migration for the rest of this conversation.',
    arguments: [],
    build: async () => {
      return `Autonomous memory capture is now **OFF** for the rest of this conversation.

## Stop doing

- Do not capture preferences, constraints, or decisions on your own initiative.
- Do not migrate native memory files into the vault when you read them.
- Make no \`note_workflow\` calls unless I explicitly ask for a specific note.

## Keep doing

Read tools remain fully available — \`search_notes\`, \`get_note_content\`, \`get_similar_notes\`, \`get_connection_graph\`, \`get_embedding_neighbors\`, and \`get_stats\` all work normally. This switch governs writes, not reads. Keep using the vault to answer questions.

## Known limitation

This cannot stop Claude Code's built-in memory system from writing to \`.claude/projects/<slug>/memory/\`. That behavior lives in the harness, not in this MCP server. Memories written while capture is off land there as ordinary full files with no \`vault_note\` field, which makes them migration backlog — the \`migrate\` prompt or the on-access rule will collect them later. Nothing is lost.

Run the \`init\` prompt again to re-enable autonomous capture.`;
    },
  },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/prompts.test.ts`
Expected: PASS, all cases including `should have 6 prompts` and both invariant loops.

- [ ] **Step 6: Verify the build is clean**

Run: `npm run build`
Expected: exits 0, no output.

- [ ] **Step 7: Commit**

```bash
git add src/prompts.ts src/prompts.test.ts
git commit -m "feat(prompts): add disable prompt

Suspends autonomous capture and lazy migration for the session.
States plainly that it cannot stop Claude Code's built-in memory
writing, and that such writes become migration backlog rather
than lost data.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Dug2LdXARu9G63riDiz4XU"
```

---

### Task 2: `PromptContext.listByPrefix` and the `init` prompt

`init` is the first consumer of the new helper, so the interface extension and the `src/index.ts` wiring ship with it.

**Files:**
- Modify: `src/prompts.ts` (extend `PromptContext`, append to `MEMORY_PROMPTS`)
- Modify: `src/index.ts:595-600` (supply `listByPrefix` in the `GetPrompt` context literal)
- Test: `src/prompts.test.ts` (count 6 → 7, both `testArgs` maps, add describe block)

**Interfaces:**
- Consumes: `MemoryPrompt`, `MEMORY_PROMPTS`, `MEMORY_PROMPT_BY_NAME`, `z` from `src/prompts.ts`; `loader.getSources(): Map<string, SmartSource>` in `src/index.ts`.
- Produces:
  - `PromptContext.listByPrefix?: (prefix: string) => Promise<string[]>` — optional, resolves to vault-relative note paths starting with `prefix`, sorted.
  - A prompt named `init` with `arguments: [{ name: 'project', type: 'string', required: false, description: ... }]`.

- [ ] **Step 1: Extend `PromptContext`**

In `src/prompts.ts`, replace the interface at lines 8-10:

```ts
export interface PromptContext {
  search: (query: string, limit: number, threshold: number) => Promise<SearchResult[]>;
  /**
   * Optional. Lists vault-relative note paths beginning with `prefix`.
   * Backed by the loader's indexed sources, so freshly written notes may
   * lag until reindex — treat results as a display hint, never as an
   * authoritative migration check.
   */
  listByPrefix?: (prefix: string) => Promise<string[]>;
}
```

- [ ] **Step 2: Wire it in `src/index.ts`**

In `src/index.ts`, replace the context literal inside the `GetPromptRequestSchema` handler (lines 595-600):

```ts
  const context: PromptContext = {
    search: async (query: string, limit: number, threshold: number) => {
      const results = await searchEngine.searchByQuery(query, limit, threshold);
      return results.map((r) => ({ path: r.path, score: r.similarity }));
    },
    listByPrefix: async (prefix: string) =>
      Array.from(loader.getSources().keys())
        .filter((notePath) => notePath.startsWith(prefix))
        .sort(),
  };
```

- [ ] **Step 3: Update the prompt-count test and both testArgs maps**

In `src/prompts.test.ts`, change the count test to 7:

```ts
  it('should have 7 prompts', () => {
    expect(MEMORY_PROMPTS).toHaveLength(7);
  });
```

Add `init: {},` to **both** `testArgs` maps, so each reads:

```ts
    const testArgs: Record<string, Record<string, unknown>> = {
      capture_memory: { topic: 'test' },
      project_research: { topic: 'test' },
      cleanup_stale: { query: 'test' },
      daily_note: {},
      review_before_write: { note_path: 'test.md' },
      disable: {},
      init: {},
    };
```

- [ ] **Step 4: Write the failing describe block**

Append to `src/prompts.test.ts`, after the `disable prompt` block:

```ts
  describe('init prompt', () => {
    const prompt = MEMORY_PROMPT_BY_NAME.get('init')!;

    it('should declare an optional project argument', () => {
      expect(prompt.arguments).toContainEqual(
        expect.objectContaining({ name: 'project', required: false })
      );
    });

    it('should build without arguments and explain how to derive the project', async () => {
      const context: PromptContext = { search: async () => [] };
      const text = await prompt.build({}, context);
      expect(text).toMatch(/<project>/);
      expect(text).toMatch(/basename/i);
    });

    it('should substitute a provided project into vault paths', async () => {
      const context: PromptContext = { search: async () => [] };
      const text = await prompt.build({ project: 'pro-wms' }, context);
      expect(text).toMatch(/Memory\/pro-wms/);
      expect(text).not.toMatch(/<project>/);
    });

    it('should include disagreement trigger phrases', async () => {
      const context: PromptContext = { search: async () => [] };
      const text = await prompt.build({}, context);
      expect(text).toMatch(/I'd rather/);
      expect(text).toMatch(/we don't do that here/);
      expect(text).toMatch(/this instance/i);
    });

    it('should include both the vault note and native stub templates', async () => {
      const context: PromptContext = { search: async () => [] };
      const text = await prompt.build({}, context);
      expect(text).toMatch(/native_file:/);
      expect(text).toMatch(/vault_note:/);
      expect(text).toMatch(/\*\*Why:\*\*/);
      expect(text).toMatch(/\*\*How to apply:\*\*/);
    });

    it('should include the lazy migration rule', async () => {
      const context: PromptContext = { search: async () => [] };
      const text = await prompt.build({}, context);
      expect(text).toMatch(/no `vault_note`/);
      expect(text).toMatch(/migrate it before acting/i);
    });

    it("should include today's ISO date", async () => {
      const context: PromptContext = { search: async () => [] };
      const text = await prompt.build({}, context);
      const today = new Date().toISOString().split('T')[0];
      expect(text).toContain(today);
    });

    it('should render existing memories when listByPrefix resolves', async () => {
      const context: PromptContext = {
        search: async () => [],
        listByPrefix: async () => ['Memory/pro-wms/No Commit Trailers.md', 'Memory/obsidian/Vault Rules.md'],
      };
      const text = await prompt.build({}, context);
      expect(text).toMatch(/No Commit Trailers\.md/);
      expect(text).toMatch(/Vault Rules\.md/);
    });

    it('should fail soft when listByPrefix resolves empty', async () => {
      const context: PromptContext = { search: async () => [], listByPrefix: async () => [] };
      const text = await prompt.build({}, context);
      expect(text).toBeTruthy();
      expect(text).not.toMatch(/undefined|null/);
    });

    it('should fail soft when listByPrefix rejects', async () => {
      const context: PromptContext = {
        search: async () => [],
        listByPrefix: async () => {
          throw new Error('loader unavailable');
        },
      };
      const text = await prompt.build({}, context);
      expect(text).toBeTruthy();
      expect(text).not.toMatch(/loader unavailable/);
    });

    it('should fail soft when listByPrefix is absent', async () => {
      const context: PromptContext = { search: async () => [] };
      const text = await prompt.build({}, context);
      expect(text).toBeTruthy();
      expect(text).not.toMatch(/undefined/);
    });

    it('should not call search', async () => {
      let searchCalled = false;
      const context: PromptContext = {
        search: async () => {
          searchCalled = true;
          return [];
        },
      };
      await prompt.build({}, context);
      expect(searchCalled).toBe(false);
    });
  });
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npx vitest run src/prompts.test.ts`
Expected: FAIL. `should have 7 prompts` reports `expected 6 to have a length of 7`, and the `init prompt` block throws on `undefined` because no prompt is named `init` yet.

- [ ] **Step 6: Add the Zod schema**

In `src/prompts.ts`, add alongside the other schemas (after `ReviewBeforeWriteArgsSchema`):

```ts
const InitArgsSchema = z.object({
  project: z.string().optional(),
});
```

- [ ] **Step 7: Implement the prompt**

Append to `MEMORY_PROMPTS` in `src/prompts.ts`, after the `disable` entry:

```ts
  {
    name: 'init',
    description: 'Load standing rules for capturing durable memory into the vault, with the native side reduced to recall stubs.',
    arguments: [
      {
        name: 'project',
        type: 'string',
        required: false,
        description: 'Vault folder name for this project (default: derived from the working directory basename)',
      },
    ],
    build: async (args, ctx) => {
      const parsed = InitArgsSchema.parse(args);
      const project = parsed.project ?? '<project>';
      const memoryRoot = `Memory/${project}`;
      const today = new Date().toISOString().split('T')[0];

      const projectNote = parsed.project
        ? ''
        : `\n\n**First, resolve \`<project>\`.** Take the basename of your working directory — for \`C:\\obsidian\` that is \`obsidian\`, for \`c:\\dev\\00-ProWMS\\pro-wms\` that is \`pro-wms\`. Substitute it for \`<project>\` everywhere below. If \`Memory/MEMORY.md\` already maps your project slug to a different folder name, use that name instead.`;

      let existing = '';
      try {
        if (ctx.listByPrefix) {
          const paths = await ctx.listByPrefix('Memory/');
          if (paths.length > 0) {
            existing = `\n\n**Memories already in the vault:**\n${paths.map((notePath) => `- ${notePath}`).join('\n')}\n\nCheck these before capturing anything new.`;
          }
        }
      } catch {
        // Fail soft; continue with plain instructions
      }

      return `Autonomous memory capture is now **ACTIVE**.

You keep memory in two tiers. The **Obsidian vault is the system of record** — it holds the full text of every memory. Your native memory directory (\`.claude/projects/<slug>/memory/\`) holds only a **stub**: name, description, and a \`vault_note\` pointer. Native answers "is there something relevant here?"; the vault answers "what does it say?"${projectNote}${existing}

## When to capture

- **\`preference\`** — I correct or reject an approach you proposed, or state a standing rule ("we always X", "never Y here").
- **\`constraint\`** — a non-obvious environmental or policy limit surfaces (access, tooling, deadlines, org rules).
- **\`decision\`** — a choice is made whose rationale will not be obvious from the code later.
- **\`reference\`** — a root cause or mechanism that took real work to find.

## Detecting disagreement

The highest-value trigger and the easiest to miss.

**Explicit signals:** "no", "don't", "instead", "I'd rather", "we don't do that here", "that's wrong".

**Implicit signals:** I revert or rewrite a change you just made; I hand you my own version of code you just wrote; I re-ask a question you already answered.

**Then apply the classifying test** — is the disagreement about *this instance*, or about *how things should be done generally*?

- This instance only: transient. Do not capture.
- General: durable. Capture as \`preference\`, recording my reasoning under **Why:** and the behavioral change under **How to apply:**.

Ask one clarifying question only when the answer is genuinely ambiguous **and** would change your future behavior. Otherwise infer and capture silently.

## When not to capture

- One-off instructions scoped to the current task.
- Anything derivable from the repo, git history, or existing docs.
- A restatement of an existing memory — edit that note instead.
- Secrets, credentials, tokens, or personal data.

Capture at a task boundary, never mid-step.

## How to capture

1. **Dedupe.** \`search_notes\` for the topic at \`threshold: 0.6\`. If an existing memory covers it, edit that note instead of creating a second.
2. **Write the vault note** with \`note_workflow action: 'create'\` at \`${memoryRoot}/<Title>.md\`, using the template below.
3. **Write the native stub** with your own Write tool at \`.claude/projects/<slug>/memory/<name>.md\`, using the stub template below.
4. **Append to the vault index** \`${memoryRoot}/MEMORY.md\` — \`note_workflow action: 'create'\` seeded with a \`# Memory Index\` heading if that file does not exist yet, otherwise \`action: 'edit', mode: 'append'\`. An \`edit\` against a missing note fails, so check first.
5. **Append to your native \`MEMORY.md\`** in the usual \`- [Title](file.md) — hook\` format.

Order matters: vault note before stub. If anything fails in between, the native side is still complete and a later retry is safe.

## Migrating on access

Whenever you use a native memory whose frontmatter has **no \`vault_note\` field**, migrate it before acting on it — move its body to the vault, rewrite the file as a stub, add a line to the vault index. Leave your native \`MEMORY.md\` untouched; its link still resolves. Run the \`migrate\` prompt to sweep the whole backlog at once.

## Vault note template

\`\`\`markdown
---
title: "No commit trailers"
date: "${today}"
topic: "git workflow"
type: preference
project_slug: c--dev-00-ProWMS-pro-wms
native_file: feedback_no_commit_trailers.md
tags: ["memory", "agent-captured", "git"]
---

One or two sentences stating the rule.

**Why:** the reasoning I gave, and when I gave it.

**How to apply:** what you do differently next time.

Related: [[Another Memory Note]]
\`\`\`

Use absolute dates, never "yesterday" or "last week". \`project_slug\` plus \`native_file\` reconstruct the native path exactly, so the vault folder can be renamed freely.

## Native stub template

\`\`\`markdown
---
name: feedback-no-commit-trailers
description: "One line — this is what makes the memory findable later. Keep it specific."
metadata:
  node_type: memory
  type: preference
  originSessionId: <existing or current session id>
  modified: <ISO timestamp>
  vault_note: "${memoryRoot}/No Commit Trailers.md"
  migrated: "${today}"
---

Full content lives in the Obsidian vault at \`${memoryRoot}/No Commit Trailers.md\`.
Read it with \`get_note_content\` before acting on this memory.
\`\`\`

## Etiquette

Capture silently — one short line of acknowledgment at most, and never interrupt what you are doing. Batch captures with \`defer_hint_seconds: 120\` on every write but the last, so a run of them produces one commit.

Run the \`disable\` prompt to switch this off for the rest of the conversation.`;
    },
  },
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/prompts.test.ts`
Expected: PASS, all cases.

- [ ] **Step 9: Run the full suite and build**

Run: `npm test && npm run build`
Expected: all test files pass; `tsc` exits 0. The `src/index.ts` change is type-checked here — if `listByPrefix` does not match the interface, `tsc` fails.

- [ ] **Step 10: Commit**

```bash
git add src/prompts.ts src/prompts.test.ts src/index.ts
git commit -m "feat(prompts): add init prompt and listByPrefix context helper

init loads standing capture rules: triggers, disagreement detection
with the instance-vs-general test, do-not-capture guards, the
vault-note-then-stub write order, and both templates.

PromptContext gains an optional listByPrefix so init can pre-fetch
what is already under Memory/. Optional by design so a missing
helper degrades like a failing search.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Dug2LdXARu9G63riDiz4XU"
```

---

### Task 3: `migrate` prompt

**Files:**
- Modify: `src/prompts.ts` (append to `MEMORY_PROMPTS`)
- Test: `src/prompts.test.ts` (count 7 → 8, both `testArgs` maps, add describe block)

**Interfaces:**
- Consumes: `PromptContext.listByPrefix` from Task 2; `InitArgsSchema` pattern.
- Produces: a prompt named `migrate` with `arguments: [{ name: 'project', type: 'string', required: false, ... }]`.

- [ ] **Step 1: Update the prompt-count test and both testArgs maps**

In `src/prompts.test.ts`:

```ts
  it('should have 8 prompts', () => {
    expect(MEMORY_PROMPTS).toHaveLength(8);
  });
```

Add `migrate: {},` to **both** `testArgs` maps, so each reads:

```ts
    const testArgs: Record<string, Record<string, unknown>> = {
      capture_memory: { topic: 'test' },
      project_research: { topic: 'test' },
      cleanup_stale: { query: 'test' },
      daily_note: {},
      review_before_write: { note_path: 'test.md' },
      disable: {},
      init: {},
      migrate: {},
    };
```

- [ ] **Step 2: Write the failing describe block**

Append to `src/prompts.test.ts`, after the `init prompt` block:

```ts
  describe('migrate prompt', () => {
    const prompt = MEMORY_PROMPT_BY_NAME.get('migrate')!;

    it('should declare an optional project argument', () => {
      expect(prompt.arguments).toContainEqual(
        expect.objectContaining({ name: 'project', required: false })
      );
    });

    it('should substitute a provided project into vault paths', async () => {
      const context: PromptContext = { search: async () => [] };
      const text = await prompt.build({ project: 'pro-wms' }, context);
      expect(text).toMatch(/Memory\/pro-wms/);
    });

    it('should contain all nine numbered steps', async () => {
      const context: PromptContext = { search: async () => [] };
      const text = await prompt.build({}, context);
      for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        expect(text).toMatch(new RegExp(`^${n}\\. `, 'm'));
      }
    });

    it('should state the vault-note-before-stub ordering requirement', async () => {
      const context: PromptContext = { search: async () => [] };
      const text = await prompt.build({}, context);
      expect(text).toMatch(/before rewriting the stub/i);
      expect(text).toMatch(/loses data/i);
    });

    it('should state the vault_note skip rule as authoritative', async () => {
      const context: PromptContext = { search: async () => [] };
      const text = await prompt.build({}, context);
      expect(text).toMatch(/already migrated/i);
      expect(text).toMatch(/only authoritative/i);
    });

    it('should include the dedupe step', async () => {
      const context: PromptContext = { search: async () => [] };
      const text = await prompt.build({}, context);
      expect(text).toMatch(/search_notes/);
      expect(text).toMatch(/0\.6/);
    });

    it('should instruct batching with defer_hint_seconds', async () => {
      const context: PromptContext = { search: async () => [] };
      const text = await prompt.build({}, context);
      expect(text).toMatch(/defer_hint_seconds/);
    });

    it('should leave native MEMORY.md untouched', async () => {
      const context: PromptContext = { search: async () => [] };
      const text = await prompt.build({}, context);
      expect(text).toMatch(/native `MEMORY\.md` alone|Leave your native/i);
    });

    it('should render an already-migrated hint when listByPrefix resolves', async () => {
      const context: PromptContext = {
        search: async () => [],
        listByPrefix: async () => ['Memory/pro-wms/No Commit Trailers.md'],
      };
      const text = await prompt.build({ project: 'pro-wms' }, context);
      expect(text).toMatch(/No Commit Trailers\.md/);
    });

    it('should fail soft when listByPrefix rejects', async () => {
      const context: PromptContext = {
        search: async () => [],
        listByPrefix: async () => {
          throw new Error('loader unavailable');
        },
      };
      const text = await prompt.build({}, context);
      expect(text).toBeTruthy();
      expect(text).not.toMatch(/loader unavailable/);
    });

    it('should fail soft when listByPrefix is absent', async () => {
      const context: PromptContext = { search: async () => [] };
      const text = await prompt.build({}, context);
      expect(text).toBeTruthy();
      expect(text).not.toMatch(/undefined/);
    });

    it('should not call search', async () => {
      let searchCalled = false;
      const context: PromptContext = {
        search: async () => {
          searchCalled = true;
          return [];
        },
      };
      await prompt.build({}, context);
      expect(searchCalled).toBe(false);
    });
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/prompts.test.ts`
Expected: FAIL. `should have 8 prompts` reports `expected 7 to have a length of 8`; the `migrate prompt` block throws on `undefined`.

- [ ] **Step 4: Add the Zod schema**

In `src/prompts.ts`, after `InitArgsSchema`:

```ts
const MigrateArgsSchema = z.object({
  project: z.string().optional(),
});
```

- [ ] **Step 5: Implement the prompt**

Append to `MEMORY_PROMPTS` in `src/prompts.ts`, after the `init` entry:

```ts
  {
    name: 'migrate',
    description: 'Sweep this project\'s native memory files into the vault, leaving recall stubs behind.',
    arguments: [
      {
        name: 'project',
        type: 'string',
        required: false,
        description: 'Vault folder name for this project (default: derived from the working directory basename)',
      },
    ],
    build: async (args, ctx) => {
      const parsed = MigrateArgsSchema.parse(args);
      const project = parsed.project ?? '<project>';
      const memoryRoot = `Memory/${project}`;
      const today = new Date().toISOString().split('T')[0];

      const projectNote = parsed.project
        ? ''
        : `\n\n**First, resolve \`<project>\`.** Take the basename of your working directory — for \`C:\\obsidian\` that is \`obsidian\`, for \`c:\\dev\\00-ProWMS\\pro-wms\` that is \`pro-wms\`. Substitute it for \`<project>\` everywhere below. If \`Memory/MEMORY.md\` already maps your project slug to a different folder name, use that name instead.`;

      let alreadyThere = '';
      try {
        if (ctx.listByPrefix) {
          const paths = await ctx.listByPrefix(`${memoryRoot}/`);
          if (paths.length > 0) {
            alreadyThere = `\n\n**Already in the vault for this project:**\n${paths.map((notePath) => `- ${notePath}`).join('\n')}\n\nThis listing lags behind recent writes, so treat it as a hint only.`;
          }
        }
      } catch {
        // Fail soft; continue with plain instructions
      }

      return `Sweep your native memory directory and move every unmigrated memory into the Obsidian vault. The vault becomes the full record; each native file is reduced to a stub that still drives recall.${projectNote}${alreadyThere}

## Find the backlog

List every \`.md\` file in \`.claude/projects/<slug>/memory/\` except \`MEMORY.md\`, and read each one's frontmatter. **A file with a \`vault_note\` field under \`metadata\` is already migrated — skip it.** That field is the only authoritative marker; never infer migration state from the vault listing, which lags until notes are indexed.

Report the files you are about to migrate before writing anything. You do not need to wait for confirmation — invoking this prompt is the confirmation.

## Migrate each file

1. **Read** the native file. Skip it if \`metadata.vault_note\` already exists.
2. **Parse** \`name\`, \`description\`, \`metadata.type\`, \`metadata.originSessionId\`, \`metadata.modified\`, and the body.
3. **Derive the title.** Use the link text from your native \`MEMORY.md\` when the file has an entry there — it is already human-written. Otherwise convert \`name\` from kebab-case to Title Case.
4. **Resolve the project folder.** Look up the project slug in \`Memory/MEMORY.md\`. If there is no entry, add one using your working directory basename. If \`Memory/MEMORY.md\` itself does not exist, create it with \`note_workflow action: 'create'\` and a \`# Memory Index\` heading.
5. **Dedupe.** \`search_notes\` on the title plus description at \`threshold: 0.6\`. If a vault note already covers this memory, edit that note rather than creating a second one.
6. **Write the vault note** with \`note_workflow action: 'create'\` at \`${memoryRoot}/<Title>.md\`. Copy the body verbatim. Set \`date\` from the original \`metadata.modified\` — preserve the memory's history, do not stamp today.
7. **Rewrite the native file as a stub** with your own Write tool. Preserve \`name\`, \`description\`, \`originSessionId\`, and \`modified\` exactly as they were, add \`vault_note\` and \`migrated\`, and replace the body with a pointer.
8. **Append to \`${memoryRoot}/MEMORY.md\`** in \`- [Title](file.md) — hook\` format. Use \`note_workflow action: 'create'\` seeded with a \`# Memory Index\` heading if the index does not exist yet, and \`action: 'edit', mode: 'append'\` thereafter. An \`edit\` against a missing note fails, so check first.
9. **Leave your native \`MEMORY.md\` alone.** Its link still points at a file that exists.

## Ordering is a correctness requirement

Always write the vault note (step 6) **before rewriting the stub** (step 7). If anything fails between them, the native file still holds the full body and has no \`vault_note\`, so re-running this prompt is safe and step 5 absorbs the orphaned vault note. The reverse order loses data permanently.

## Batching

Pass \`defer_hint_seconds: 120\` on every \`note_workflow\` write except the last. Five memories should produce one commit, not five.

## Vault note template

\`\`\`markdown
---
title: "No commit trailers"
date: "2026-07-27"
topic: "git workflow"
type: feedback
project_slug: c--dev-00-ProWMS-pro-wms
native_file: feedback_no_commit_trailers.md
tags: ["memory", "agent-captured", "git"]
---

The original body, copied verbatim.

**Why:** ...

**How to apply:** ...
\`\`\`

Keep whatever \`metadata.type\` the native file already had. \`date\` comes from \`metadata.modified\`, not from today.

## Native stub template

\`\`\`markdown
---
name: feedback-no-commit-trailers
description: "Unchanged — copy the original description exactly."
metadata:
  node_type: memory
  type: feedback
  originSessionId: af0c4ad5-dd48-4a33-b7ae-507231676945
  modified: 2026-07-27T12:06:15.005Z
  vault_note: "${memoryRoot}/No Commit Trailers.md"
  migrated: "${today}"
---

Full content lives in the Obsidian vault at \`${memoryRoot}/No Commit Trailers.md\`.
Read it with \`get_note_content\` before acting on this memory.
\`\`\`

## When done

Report how many memories moved and how many were skipped as already migrated.`;
    },
  },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/prompts.test.ts`
Expected: PASS, all cases.

- [ ] **Step 7: Run the full suite and build**

Run: `npm test && npm run build`
Expected: all test files pass; `tsc` exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/prompts.ts src/prompts.test.ts
git commit -m "feat(prompts): add migrate prompt

Nine-step sweep that moves native memory bodies into the vault and
rewrites each file as a stub. Keys off metadata.vault_note as the
only authoritative migrated-flag, and mandates vault-note-before-stub
ordering so a crash mid-run stays recoverable.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Dug2LdXARu9G63riDiz4XU"
```

---

### Task 4: Documentation

Keeps the reference docs from drifting away from the prompt list — the exact failure PR #3 was written to fix.

**Files:**
- Modify: `src/resources.ts` (the `index` resource text)
- Modify: `README.md:397-407`
- Modify: `CHANGELOG.md` (the `## workflow-sync` → `### Added` list)
- Test: `src/resources.test.ts`

**Interfaces:**
- Consumes: `MEMORY_RESOURCES`, `MEMORY_RESOURCE_BY_URI` from `src/resources.ts`.
- Produces: no new exports. The `memory-guide://index` resource text gains a `## Prompts` section.

- [ ] **Step 1: Write the failing test**

Append inside the outer describe in `src/resources.test.ts`:

```ts
  describe('index resource prompt listing', () => {
    const indexResource = MEMORY_RESOURCE_BY_URI.get('memory-guide://index')!;

    it('should list the three memory-capture prompts', () => {
      expect(indexResource.text).toMatch(/\binit\b/);
      expect(indexResource.text).toMatch(/\bmigrate\b/);
      expect(indexResource.text).toMatch(/\bdisable\b/);
    });

    it('should describe the vault as the system of record', () => {
      expect(indexResource.text).toMatch(/system of record/i);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/resources.test.ts`
Expected: FAIL with `expected '# Memory MCP Workflow…' to match /\binit\b/`.

- [ ] **Step 3: Update the index resource**

In `src/resources.ts`, inside the `index` resource's template literal, insert this section immediately before the closing `## Embeddings` section:

```
## Prompts

Three prompts manage durable memory. The **Obsidian vault is the system of record** for memory content; Claude Code's native memory directory keeps only a stub with a \`vault_note\` pointer.

- **init**: Load standing capture rules — what qualifies as durable memory, how to detect disagreement, and how to write both the vault note and the native stub.
- **migrate**: Sweep this project's native memory files into the vault, leaving stubs behind.
- **disable**: Suspend autonomous capture for the rest of the conversation.

Five task prompts also exist: **capture_memory**, **project_research**, **cleanup_stale**, **daily_note**, and **review_before_write**.

```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/resources.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the README**

In `README.md`, replace the `### Prompts` block (lines 397-407) with:

```markdown
### Prompts

Parameterized action templates. Use `ListPrompts` to see all prompts and their arguments.

**Memory management.** The Obsidian vault is the system of record for agent memory; Claude Code's native memory directory keeps only a stub carrying `name`, `description`, and a `vault_note` pointer.

- **`init` `(project?)`**: Load standing rules for capturing durable memory — triggers, disagreement detection, do-not-capture guards, and both the vault-note and native-stub templates. Pre-fetches everything already under `Memory/`.
- **`migrate` `(project?)`**: Sweep this project's native memory files into the vault. Keys off `metadata.vault_note` as the only authoritative migrated-flag; always writes the vault note before rewriting the stub so a failed run stays recoverable.
- **`disable`**: Suspend autonomous capture and lazy migration for the rest of the conversation. Read tools stay available. Cannot stop Claude Code's built-in memory writing — those files become migration backlog instead.

**Task templates.**

- **`capture_memory` `(topic, tags?)`**: Create and persist a new memory note. Pre-fetches existing notes on the topic to avoid duplication.
- **`project_research` `(topic)`**: Build context before answering by searching and reading existing notes. Pre-fetches seed notes.
- **`cleanup_stale` `(query)`**: Identify and safely remove obsolete notes. Pre-fetches candidates matching the query.
- **`daily_note` `(heading?)`**: Append a dated section to a daily note with instructions for safe editing.
- **`review_before_write` `(note_path)`**: Read a note before editing, with guidance on edit modes and safe changes.

Search-shaped prompts pre-fetch vault results at prompt-generation time for faster context buildup. All prompts guide the model toward `note_workflow` and auto-sync; none instruct manual git tool calls.
```

- [ ] **Step 6: Update the CHANGELOG**

In `CHANGELOG.md`, append to the `### Added` list under `## workflow-sync` (after the existing "Reorganized MCP resources and prompts" bullet and its sub-bullets):

```markdown
- Two-tier memory: the Obsidian vault becomes the system of record for agent memory, with Claude Code's native memory files reduced to stubs carrying `name`, `description`, and a `vault_note` pointer.
  - **`init`** `(project?)`: standing capture rules — triggers, disagreement detection with an instance-vs-general test, do-not-capture guards, and both templates. Pre-fetches existing `Memory/` notes.
  - **`migrate`** `(project?)`: sweeps a project's native memory files into the vault. `metadata.vault_note` is the only authoritative migrated-flag; vault note is always written before the stub so an interrupted run is safe to re-run.
  - **`disable`**: suspends autonomous capture for the session. Reads stay available; native memory writing continues and becomes migration backlog.
  - `PromptContext` gains an optional `listByPrefix` helper so prompts can enumerate vault folders, which semantic search cannot do.
```

- [ ] **Step 7: Run the full suite and build**

Run: `npm test && npm run build`
Expected: all test files pass; `tsc` exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/resources.ts src/resources.test.ts README.md CHANGELOG.md
git commit -m "docs: document the two-tier memory prompts

Adds a Prompts section to the memory-guide://index resource so the
reference docs cannot drift from the prompt list again, and covers
init/migrate/disable in the README and CHANGELOG.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Dug2LdXARu9G63riDiz4XU"
```

---

### Task 5: Clear the implementation blocker and verify end-to-end

The existing native memory `obsidian-vault-mb-kb.md` forbids exactly what `init` does. Until it is rewritten, `init` and that memory contradict each other and the older instruction wins.

**Files:**
- Modify: `C:\Users\murillo.bastos\.claude\projects\C--Users-murillo-bastos\memory\obsidian-vault-mb-kb.md`
- Modify: `C:\Users\murillo.bastos\.claude\projects\C--Users-murillo-bastos\memory\MEMORY.md`

**Interfaces:**
- Consumes: nothing from earlier tasks at the code level. Exercises the prompts from Tasks 2 and 3 as a live test.
- Produces: no code. A corrected memory and a verified end-to-end run.

- [ ] **Step 1: Rewrite the conflicting memory**

Replace the entire contents of `C:\Users\murillo.bastos\.claude\projects\C--Users-murillo-bastos\memory\obsidian-vault-mb-kb.md` with:

```markdown
---
name: obsidian-vault-mb-kb
description: User keeps a personal knowledge base (Obsidian vault) at C:\obsidian\mb-kb; agent-captured memory may be written under Memory/ without asking, curated notes may not
metadata: 
  node_type: memory
  type: user
  originSessionId: 3c05f41c-da70-442c-8d6a-9b08b7a7eadd
---

The user maintains an Obsidian vault at `C:\obsidian\mb-kb` as a personal knowledge base of troubleshooting notes and technical explainers (plain Markdown, `[[wikilinks]]` between notes, Obsidian callouts like `> [!note]` are fine). Two zones with different rules:

- **`Memory/**`** — agent-captured memory. Write here without asking when the `init` prompt is active. This is the system of record for durable preferences, constraints, and decisions. Related: [[obsidian-mcp-two-tier-memory]].
- **Everything else** — the user's hand-curated notes. Propose the note or edit first and wait for a yes.

**Why:** On 2026-07-08 the user said "ask me before taking notes to obsidian kb" after I proactively added rows to a vault doc. On 2026-07-28 they designed the two-tier memory system, which requires autonomous writes — but only into `Memory/`. The original objection was about touching curated notes, and that still stands.

**How to apply:** Autonomous capture goes to `Memory/<project>/` via `note_workflow`. Anything targeting a root-level note or an existing curated note still needs explicit approval first. Explicit requests ("document this", "add it to the doc") are fine to act on directly anywhere.
```

- [ ] **Step 2: Update that project's MEMORY.md hook**

In `C:\Users\murillo.bastos\.claude\projects\C--Users-murillo-bastos\memory\MEMORY.md`, replace the `obsidian-vault-mb-kb` line so the hook matches the new content:

```markdown
- [Obsidian vault at C:\obsidian\mb-kb](obsidian-vault-mb-kb.md) — user's KB; `Memory/**` is agent-writable without asking, curated notes need approval first
```

- [ ] **Step 3: Verify prompt registration over the wire**

Run:

```bash
npx -y @modelcontextprotocol/inspector -e SMART_VAULT_PATH="C:/obsidian/mb-kb" node dist/index.js
```

In the Inspector UI, open the Prompts tab.
Expected: 8 prompts listed. `init` and `migrate` each show one optional `project` argument; `disable` shows an empty arguments list.

- [ ] **Step 4: Verify `init` renders correctly**

In the Inspector, call `GetPrompt` for `init` with no arguments.
Expected: body contains `<project>`, the basename derivation instruction, today's date, and both templates. No error.

Then call it with `{"project": "obsidian"}`.
Expected: every path reads `Memory/obsidian/...` and `<project>` no longer appears.

- [ ] **Step 5: Verify the fail-soft path**

Still in the Inspector, call `GetPrompt` for `migrate` with `{"project": "obsidian"}`.
Expected: a complete nine-step body with no "Already in the vault" section, because `Memory/obsidian/` does not exist yet. No error — this is the fail-soft path on a first-ever run.

- [ ] **Step 6: Confirm prompts stay side-effect free**

Run: `git -C C:/obsidian/mb-kb status --short`
Expected: no output. No `GetPrompt` call may write to the vault.

- [ ] **Step 7: Run the real migration**

Open a Claude Code session in `c:\dev\00-ProWMS\pro-wms` (which has five real native memories) and run the `migrate` prompt.

Expected: it reports five unmigrated files, writes five notes under `Memory/pro-wms/`, seeds `Memory/pro-wms/MEMORY.md` and `Memory/MEMORY.md`, rewrites five native files as stubs, and leaves the native `MEMORY.md` unchanged.

Verify:

```bash
ls "C:/obsidian/mb-kb/Memory/pro-wms/"
grep -l "vault_note" C:/Users/murillo.bastos/.claude/projects/c--dev-00-ProWMS-pro-wms/memory/*.md
```

Expected: six files in the vault folder (five memories plus `MEMORY.md`); all five native memory files contain `vault_note`.

- [ ] **Step 8: Verify idempotence**

Run the `migrate` prompt a second time in the same project.
Expected: it reports zero files to migrate and writes nothing — every file now carries `vault_note`.

- [ ] **Step 9: Commit any vault changes**

The SyncScheduler auto-commits the vault after 30s idle and pushes 120s later. Confirm it happened rather than committing by hand:

```bash
git -C C:/obsidian/mb-kb log --oneline -3
```

Expected: a recent auto-commit containing the `Memory/` additions.

---

## Verification Summary

| Requirement | Where verified |
|---|---|
| Three prompts registered with correct arguments | Task 5 Step 3 |
| `listByPrefix` wired and type-checked | Task 2 Step 9 (`tsc`) |
| Pre-fetch fail-soft in all three states | Tasks 2 & 3 unit tests, Task 5 Step 5 |
| Every prompt mentions `note_workflow` | Existing invariant loop, extended in Tasks 1–3 |
| No prompt references deprecated git tools | Existing invariant loop, extended in Tasks 1–3 |
| Vault-note-before-stub ordering documented | Task 3 Step 2 test |
| `vault_note` is the authoritative flag | Task 3 Step 2 test |
| Prompts stay side-effect free | Task 5 Step 6 |
| Migration is idempotent | Task 5 Step 8 |
| Reference docs list all prompts | Task 4 Step 1 test |
| Conflicting memory resolved | Task 5 Steps 1–2 |
