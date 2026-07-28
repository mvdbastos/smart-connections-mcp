# Two-Tier Memory: Obsidian Vault as System of Record

**Date:** 2026-07-28
**Status:** Design approved, ready for implementation planning
**Branch:** `refactor/organize-resources-prompts` (PR #3)

## Problem

PR #3 split the MCP surface into 4 read-only resources and 5 parameterized prompts. All five existing prompts are *user-initiated* — someone runs `capture_memory` when they already know they want a note written. Nothing tells the agent when to decide on its own that something is worth remembering, so the highest-value signal in a session (the user pushing back on a proposed solution) evaporates when the conversation ends.

An earlier draft added an `init` prompt to fix that, but introduced a worse problem: **two memory stores with no relationship between them.**

Claude Code already writes memories to `.claude/projects/<slug>/memory/` — per-project, invisible to Obsidian, not git-tracked in the vault, recalled through `MEMORY.md` and per-file `description` frontmatter. The proposed `init` rules deliberately mirrored that convention (`**Why:**` / `**How to apply:**`, dedupe-before-write, absolute dates, `[[wikilinks]]`). A preference caught after `init` ran would land in both stores as two independent copies, drifting apart from the moment they were written.

The stores also differ in kind. Native memory is fast to recall but unbrowsable and project-scoped. Vault memory is semantically searchable, readable in Obsidian, and auto-committed and pushed by `SyncScheduler`. Neither is redundant; they serve different halves of the job.

## Goal

One store of truth, two access paths. The vault holds what a memory *says*; the native side holds just enough to know a memory *exists and is relevant*. Existing native memories migrate to the vault gradually as they are used, with a sweep available for the backlog.

## Decisions

1. **Vault is the system of record.** Full memory text lives in `Memory/` inside the Obsidian vault (`C:\obsidian\mb-kb`).
2. **Native side keeps a stub, not nothing.** The `.md` file survives with `name` + `description` + a `vault_note` pointer; only the body moves. The `description` field is what drives native recall, so deleting the file would break relevance matching and force an MCP round-trip on every recall.
3. **Readable folder and file names in the vault, machine slug in frontmatter.** Structure mirrors Claude's 1:1; only the display strings differ. `project_slug` is the authoritative key, so folders can be renamed freely.
4. **Migration is lazy plus sweepable.** The on-access rule ships inside `init`; a separate `migrate` prompt drains the backlog for the current project.
5. **New memories are born migrated.** With `init` active, a fresh capture writes the vault note and the native stub in the same turn. No drift window.

## Architecture

**Vault = system of record.** Full memory text. Semantically searchable via MCP, browsable in Obsidian, git-tracked, auto-committed and pushed by `SyncScheduler`.

**Native = recall index.** Stub carrying `name` + `description` + `vault_note`. Native answers *"is there something relevant here?"*; vault answers *"what does it say?"*

### Write paths

1. **Capture** (new memory, `init` active) — trigger fires → dedupe search in vault → full note via `note_workflow` → stub via the agent's Write tool → index lines appended.
2. **Lazy migrate** — agent uses a native memory whose frontmatter has no `vault_note` → body moves to the vault, file rewritten as a stub.
3. **Bulk migrate** — the `migrate` prompt sweeps the current project's memory directory, looping path 2.

### Read path

`MEMORY.md` line or stub `description` surfaces → `get_note_content` on `vault_note` → full text.

### Invariants

- **`vault_note` presence is the migrated flag.** No separate bookkeeping, no state file, no scan required to know what is done.
- **Native `MEMORY.md` needs no edits during migration.** Its line points at a file that still exists. This falls out of choosing stub-over-delete and removes an entire class of index-desync bugs.
- **Graceful degradation.** If the vault or MCP server is unreachable, the stub `description` plus the `MEMORY.md` hook still summarize the memory. The agent reports that full content is unavailable rather than acting on a partial.

### Why `disable` is now honest

`disable` cannot stop Claude Code's built-in memory writing — nothing in an MCP server can; that behavior lives in the harness. Under this design that limitation stops being a hole: memories written while `disable` is active land natively as normal full files with no `vault_note`, which makes them migration backlog. The lazy rule or `migrate` collects them later. The system self-heals rather than losing data.

## Vault layout

```
Memory/
  MEMORY.md                    <- project index
  obsidian/
    MEMORY.md                  <- per-project memory index
    Never Write To Curated Notes Unprompted.md
  pro-wms/
    MEMORY.md
    No Commit Trailers.md
    Clean-VM Test Environment.md
  Personal/
    MEMORY.md
    Obsidian Vault mb-kb.md
```

Folder name defaults to the cwd basename (`obsidian`, `pro-wms`). The agent may substitute something clearer — `Personal` for the home-directory project — and records the mapping in `Memory/MEMORY.md`. Folders can be renamed at any time because `project_slug` in each note's frontmatter is the real key.

Both `Memory/MEMORY.md` and `Memory/<project>/MEMORY.md` reuse Claude's exact index format: a `# Memory Index` heading followed by `- [Title](file.md) — hook` lines.

## Formats

### Vault note

The vault's existing convention (`title` / `date` / `topic` / `tags`) plus three fields:

```markdown
---
title: "No commit trailers"
date: "2026-07-27"
topic: "git workflow"
type: feedback
project_slug: c--dev-00-ProWMS-pro-wms
native_file: feedback_no_commit_trailers.md
tags: ["memory", "agent-captured", "git"]
---

Do not add `Co-Authored-By: Claude ...` or `Claude-Session: ...` lines to any
git commit message in this repo.

**Why:** ...
**How to apply:** ...

Related: [[Pro WMS Build Deploy Roadmap]]
```

`type` carries Claude's own taxonomy: `user`, `feedback`, `project`, `reference`, plus `preference`, `constraint`, and `decision` for autonomously captured material. Migrated notes keep whatever `metadata.type` the native file already had; the three additional values apply to fresh captures.

`project_slug` and `native_file` together reconstruct the native path exactly — `.claude/projects/<project_slug>/memory/<native_file>` — which is what makes the vault folder name free to change.

`date` is the original memory's `modified` timestamp when migrating, and today's date when capturing fresh. **Migration preserves history; it does not stamp today.**

### Native stub

Preserves `name`, `description`, `originSessionId`, and `modified` byte-for-byte. Adds two fields and replaces the body:

```markdown
---
name: feedback-no-commit-trailers
description: "This repo's AGENTS.md forbids Co-Authored-By and Claude-Session trailers on commits"
metadata:
  node_type: memory
  type: feedback
  originSessionId: af0c4ad5-dd48-4a33-b7ae-507231676945
  modified: 2026-07-27T12:06:15.005Z
  vault_note: "Memory/pro-wms/No Commit Trailers.md"
  migrated: 2026-07-28
---

Full content lives in the Obsidian vault at `Memory/pro-wms/No Commit Trailers.md`.
Read it with `get_note_content` before acting on this memory.
```

## Components

### `PromptContext` extension

```ts
export interface PromptContext {
  search: (query: string, limit: number, threshold: number) => Promise<SearchResult[]>;
  listByPrefix?: (prefix: string) => Promise<string[]>;
}
```

Optional, so the existing `{ search: mockSearch }` literals in `prompts.test.ts` still typecheck and a missing helper degrades exactly like a failing search — emit the plain body, never throw. Semantic search cannot filter by folder, which is why prompts need it to enumerate `Memory/`.

`src/index.ts` supplies it from the loader's key set, the same iteration `SearchEngine` already performs:

```ts
listByPrefix: async (prefix: string) =>
  Array.from(loader.getSources().keys())
    .filter((notePath) => notePath.startsWith(prefix))
    .sort(),
```

**Caveat, load-bearing:** `loader.getSources()` holds only *indexed* notes, so a freshly written `Memory/` note may not appear until reindex. `listByPrefix` is therefore a hint for display and dedupe only. The authoritative migrated-check is always `vault_note` in the native file's frontmatter, never the vault listing.

### Prompt: `init`

Argument: `project` (optional string, readable folder name; default derived by the agent from the cwd basename).

Pre-fetch: `listByPrefix('Memory/')`, so the agent opens the session seeing every memory already captured across all projects. Fail-soft on absent helper, rejection, or empty result.

Body sections:

1. **Two-tier model** — vault is the record, native is the index. Two sentences.
2. **Capture triggers** — user corrects or rejects a proposed approach (`preference`); user states a durable rule, "we always X" / "never Y here" (`preference`); a non-obvious environmental or policy constraint surfaces (`constraint`); a decision is made whose rationale won't be obvious later (`decision`); a root cause that took real work to find (`reference`).
3. **Disagreement detection.** Explicit signals: *"no"*, *"don't"*, *"instead"*, *"I'd rather"*, *"we don't do that here"*. Implicit signals: the user reverts or rewrites a change just made; the user supplies their own version of code just written; the user re-asks a question already answered. Then the classifying test — *is this about this instance (transient, skip) or about how things should be done generally (durable, capture as `preference`)?* Ask one clarifying question only when genuinely ambiguous **and** the answer would change future behavior.
4. **Do-not-capture guards** — one-off instructions scoped to the current task; anything derivable from the repo, git history, or existing docs; restatements of an existing memory (edit that note instead); secrets, credentials, PII. Capture at a task boundary, never mid-step.
5. **Capture procedure** — dedupe search → vault note → native stub → both index files.
6. **Lazy migration rule** — on using a native memory with no `vault_note`, migrate it before acting on it.
7. **Templates** — vault note and native stub, verbatim as above.
8. **Etiquette** — capture silently, one line of acknowledgment at most, never interrupt the task. Names `disable` as the off switch.

### Prompt: `migrate`

Argument: `project` (optional string).

Pre-fetch: `listByPrefix('Memory/<project>/')` as an already-done hint.

Lists the unmigrated files before writing anything. Invoking the prompt is the confirmation, so there is no second gate.

Per-file procedure:

1. Read the native file. If `metadata.vault_note` is present, skip.
2. Parse `name`, `description`, `metadata.type`, `originSessionId`, `modified`, and the body.
3. Derive the title from the `MEMORY.md` link text when one exists (already human-written), otherwise kebab-to-Title-Case on `name`.
4. Resolve the project folder via `project_slug` in `Memory/MEMORY.md`; create the entry from the cwd basename if absent, creating `Memory/MEMORY.md` itself with a `# Memory Index` heading if the file does not yet exist.
5. Dedupe — `search_notes` on title plus description at threshold ~0.6. If an existing vault note already covers it, edit that note rather than creating a second.
6. `note_workflow action: 'create'` at `Memory/<Project>/<Title>.md`. Body verbatim; `date` set from the original `modified`.
7. Rewrite the native file as a stub via the Write tool.
8. Append a line to `Memory/<Project>/MEMORY.md`. Use `action: 'create'` when the index does not exist yet (seeding it with the `# Memory Index` heading), and `action: 'edit', mode: 'append'` thereafter — `edit` against a missing note fails, so the existence check is required, not optional.
9. Leave native `MEMORY.md` untouched.

**Ordering is a correctness requirement: vault note before stub.** A crash between steps 6 and 7 leaves the native file fully intact with no `vault_note`, so re-running is safe and step 5's dedupe catches the orphaned vault note. Migration is idempotent and crash-safe in that direction only — the reverse order loses data.

Pass `defer_hint_seconds: 120` on every write but the last, so five memories produce one commit instead of five.

### Prompt: `disable`

No arguments, no pre-fetch, pure instruction text. Suspends capture and lazy migration for the remainder of the conversation. States explicitly that read tools remain fully available, that it cannot stop Claude Code's built-in memory writing (those land as backlog and are collected later), and that running `init` again re-enables.

Referencing `note_workflow` by name keeps the existing "every prompt mentions `note_workflow`" test invariant intact without contorting the wording — it is precisely the thing being suspended.

## Error handling

| Condition | Behavior |
|---|---|
| `listByPrefix` absent, rejects, or returns empty | Emit the plain prompt body. Never throw out of `GetPrompt`. |
| Vault or MCP server unreachable at recall | Stub `description` and `MEMORY.md` hook still summarize. Agent reports full content unavailable; does not act on a partial. |
| Crash mid-migration | Native file intact without `vault_note`. Re-run is safe; step 5 dedupe absorbs the orphan. |
| Vault note already exists for a memory | Step 5 dedupe edits it instead of creating a duplicate. |
| Project has no `Memory/MEMORY.md` entry | Create one from the cwd basename during step 4. |
| Fresh `Memory/` note missing from `listByPrefix` | Expected — index lag. `vault_note` frontmatter is authoritative. |

## Testing

`src/prompts.test.ts` grows from 5 prompts to 8. Both existing `testArgs` maps must be extended with `init`, `migrate`, and `disable`, or the "mentions `note_workflow`" and "no deprecated git tools" loops throw on the new entries. Once extended, both invariants cover the new prompts for free.

Per-prompt coverage:

- **`init`** — default project derivation; a custom `project` substitutes throughout; disagreement trigger phrases present; both templates present; lazy-migration rule present; fail-soft across all three helper states (absent, rejecting, empty).
- **`migrate`** — all nine steps present; the vault-before-stub ordering stated; the `vault_note` skip rule present; the dedupe step present.
- **`disable`** — declares an empty `arguments` array; states writes are off; states reads are preserved; carries the native-limitation sentence; names `init`; spies confirm neither `search` nor `listByPrefix` is called.

`src/resources.ts` — `memory-guide://index` lists all three prompts, so the reference docs cannot drift from the prompt list again (the exact failure PR #3 was written to fix).

End-to-end: run `migrate` in `C--obsidian`, which has zero memories and exercises the clean no-op path, then in `pro-wms`, which has five real memories.

## Implementation blocker

The existing native memory `obsidian-vault-mb-kb.md` reads: *"Never write/edit files in `C:\obsidian\mb-kb` unprompted — propose the note or edit first and wait for the user's yes"* (recorded 2026-07-08). That forbids exactly what `init` does.

It must be rewritten during implementation: autonomous writes permitted under `Memory/**`, while the hand-curated root notes still require asking first. This preserves the original intent — don't touch the curated KB — while unblocking the new system. It also makes a good first migration to dogfood the procedure.

## Files

- `src/prompts.ts` — `PromptContext` extension, three new prompts
- `src/index.ts` — `listByPrefix` in the `GetPrompt` context literal
- `src/prompts.test.ts` — prompt count, both `testArgs` maps, new cases
- `src/resources.ts` — `memory-guide://index` prompt list
- `README.md`, `CHANGELOG.md` — additive documentation

`ListPrompts` and `GetPrompt` handlers need no change; they iterate `MEMORY_PROMPT_BY_NAME` generically, so the new prompts register automatically.

## Out of scope

- Persisting `disable` across sessions. `GetPrompt` stays side-effect-free; the behavior lives in context, so context is what turns it off.
- Any server-side migration tool. The server cannot write to `.claude/projects/**`; the stub write is inherently the agent's.
- Migrating other projects' memories from this session. Native memory is project-scoped — each project migrates when opened.
