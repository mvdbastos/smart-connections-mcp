# Design: Workflow & Sync Optimization for smart-connections-mcp

Date: 2026-07-14
Status: Approved

## Problem

The server exposes 15 flat tools. Every vault workflow — even "add a line to a note and save it" — requires the model to chain 3–5 separate tool calls (`get_note_content` → `edit_note` → `git_commit_notes_specific` → `git_push_notes`), each a full model round trip. Steps get skipped (commits forgotten), latency and tokens are wasted, and the workflow knowledge lives in MCP Resources/Prompts (`guides.ts`) that most clients never surface to the model.

## Goals

1. **Skill discovery**: make the persistence/workflow model visible to the model on every call, via self-describing tool responses — not Resources/Prompts.
2. **CRUD in a single prompt**: one composite tool executes write + embed + (deferred) commit/push server-side in one call.
3. **Direct search → edit → sync**: search results can carry content inline; git sync becomes automatic and idle-triggered instead of a manual step.

## Non-goals

- Removing any existing tool (deprecated tools stay fully functional).
- Folding search/discovery into the workflow tool (it accepts a resolved `note_path` only; auto-selecting a note to edit from a query is too risky).
- Changing the Smart Connections data format, embedding model, or GitManager internals.

## Architecture

```
index.ts (tool handlers)
 ├─ note_workflow (NEW)                        — single-call create/edit/delete + deferred sync
 ├─ search_notes / get_similar_notes (ENHANCED) — optional include_content param
 ├─ get_stats (ENHANCED)                        — adds `sync` status block
 ├─ create_note / edit_note / delete_note       (DEPRECATED, fully functional)
 └─ git_commit_notes* / git_push_notes / git_sync_notes (DEPRECATED, fully functional)
        │
        ▼
 sync-scheduler.ts (NEW) — one global instance, all write paths feed it
        │
        ▼
 GitManager (unchanged)

 tool-usage-log.ts (NEW) — opt-in via CLI flag --log-usage
```

Configuration:

| Setting | Mechanism | Default |
|---|---|---|
| Commit idle window | `SYNC_COMMIT_IDLE_MS` env var | 30000 (30s) |
| Push idle window | `SYNC_PUSH_IDLE_MS` env var | 120000 (2min) |
| Usage logging | `--log-usage[=<path>]` CLI flag | off; path defaults to `<smart-connections-mcp>/logs/mcp-tool-usage.log` |

## Component: `note_workflow` tool

One tool, one call, full trace back. Discovery stays outside it: search first, pass a resolved `note_path` (fuzzy resolution via `resolveNotePath` still applies).

### Input

```jsonc
{
  "action": "create" | "edit" | "delete",     // required
  "note_path": "Folder/Note.md",              // required
  "content": "...",                            // required for create/edit
  "frontmatter": { },                          // create only, optional
  "mode": "overwrite|append|append-section|replace|insert-after-heading",  // edit only, default append
  "heading": "...",                            // edit-mode extras, same semantics as edit_note
  "find": "...",
  "regex": false,
  "count": 1,
  "dry_run": false,                            // edit only: preview diff, nothing written or scheduled
  "defer_hint_seconds": 120                    // optional: "more writes coming, hold the commit"
}
```

Validation mirrors `EditNoteSchema` (replace requires `find`; insert-after-heading requires `heading`) plus per-action requirements (create/edit require `content`).

### Behavior per call

1. Execute the write, reusing existing `note-writer.ts` functions (`createNote`/`editNote`/`deleteNote`) — no logic duplication.
2. Re-embed the note via existing `embedUpdatedNote`; non-fatal on failure.
3. Mark path dirty in the sync scheduler; reset/extend the commit timer.
4. Return immediately — git happens later, in the idle window.

### Response

```jsonc
{
  "action": "edit",
  "note_path": "Folder/Note.md",
  "written": true,
  "diff": "...",                     // when changed
  "embedding": { "embedded": true },
  "sync": {
    "state": "commit_scheduled",     // commit_scheduled | commit_deferred | idle
    "commit_in_seconds": 30,
    "pending_paths": ["Folder/Note.md", "Other.md"],
    "push_after_commit_seconds": 120
  },
  "next_steps": "Changes auto-commit after 30s idle and auto-push 2min later. Pass defer_hint_seconds if more edits are coming. No git tool calls needed."
}
```

The `sync` block + `next_steps` string is the self-describing discovery mechanism: every response teaches the model the persistence model, so it stops making redundant git tool calls. This is the chosen discovery approach because MCP Resources/Prompts are not reliably surfaced to models by most clients; only tool descriptions and tool responses are guaranteed to reach the model's context.

Deletes go through the same deferred commit (recoverable from disk state for the idle window, from git history after commit). No server-side confirmation; the calling LLM is responsible for confirming destructive actions with the human.

## Component: sync scheduler

Global instance at the write layer. Any successful write through ANY tool (workflow or deprecated direct tools) marks the vault dirty and feeds the same timers, so persistence behavior is consistent regardless of tool path.

### State machine

`idle` → (write) → `commit_pending` → (commit-idle elapses) → auto-commit fires → `push_pending` → (push-idle elapses) → auto-push fires → `idle`

- New write during `commit_pending`: reset commit timer.
- New write during `push_pending`: back to `commit_pending`; push timer restarts after the next commit.
- `defer_hint_seconds`: commit timer becomes `max(remaining, hint)`, capped at 30 minutes so a bad hint cannot park changes indefinitely.
- Manual `git_commit_notes`/`git_commit_notes_specific`: flush immediately, cancel commit timer, start push timer (usage still logged as deprecated-tool call).
- Manual `git_push_notes`/`git_sync_notes`: push immediately, cancel push timer.

Auto-commits use `GitManager.commitSpecific` with the tracked dirty paths and an auto-generated message (existing message-generation logic).

### Failure handling

- **Auto-commit fails** (git lock, empty diff, …): retry once on the next timer cycle. State and last error are exposed in `get_stats.sync` and in every `note_workflow` response's `sync` block, so the model can report "written but not yet committed: <error>".
- **Auto-push fails** (no remote, offline): same as today's `git_push_notes` local fallback — changes stay committed locally, `sync.push_state: "local_fallback"`, no retry storm; the next successful commit re-arms one push attempt.
- **Process shutdown** (`SIGINT`/`SIGTERM`/stdin close): `flushSync()` runs commit synchronously, push best-effort with a short timeout, then flushes the usage-log queue. Notes are already on disk regardless — worst case on a hard kill is "written but uncommitted", never data loss.
- **Scheduler failures never fail the write call**: `note_workflow` returns `written: true` with a `sync.error` field rather than an error response.

## Component: tool usage log

Purpose: evaluate empirically whether the deprecated granular tools are still needed once `note_workflow` exists. Calls that happen *despite* the `[DEPRECATED]` description warning indicate a real gap in `note_workflow`.

- **Opt-in** via `--log-usage` CLI flag. When the flag is absent, no logging code path runs at all.
- When enabled, each deprecated-tool call pushes `{ timestamp, tool, argsSummary }` to an **in-memory queue** — no I/O on the hot path, so logging never competes with note writes.
- The queue is physically flushed (async JSONL append) piggybacking on the commit-idle timer firing — the same idle window as auto-commit — and in `flushSync()` on shutdown.
- Default log file: `<smart-connections-mcp>/logs/mcp-tool-usage.log` — **outside the vault**, so vault git never sees it. Overridable: `--log-usage=<path>`.

## Deprecation approach

- `create_note`, `edit_note`, `delete_note`, `git_commit_notes`, `git_commit_notes_specific`, `git_push_notes`, `git_sync_notes` get their tool descriptions prefixed with `[DEPRECATED — prefer note_workflow]` so the model self-steers away from them.
- All remain fully functional; their writes feed the same sync scheduler.
- Removal decision is deferred until usage-log data shows they are unnecessary.

## Search enhancements

`search_notes` and `get_similar_notes` gain two optional parameters:

```jsonc
{
  "include_content": true,      // NEW, default false
  "content_max_chars": 2000     // NEW, default 2000, per note
}
```

When `include_content: true`, each result gains a `content` field, truncated at `content_max_chars` with `truncated: true` when cut. This collapses `search_notes` → `get_note_content` → edit into `search_notes` → `note_workflow`. Defaults stay off so pure-discovery searches don't balloon token usage.

## `get_stats` enhancement

Adds a `sync` block alongside the existing git status: scheduler state, pending dirty paths, seconds until next commit/push, last auto-commit/push result and error (if any).

## Testing

Vitest is already configured; new coverage follows the existing test style:

- `sync-scheduler.test.ts` — fake timers: debounce/reset behavior, defer-hint extension and 30-minute cap, push-after-commit sequencing, manual-flush cancellation, failure retry, shutdown flush. GitManager mocked.
- `tool-usage-log.test.ts` — disabled by default (no I/O), queue-then-flush on idle, flush on shutdown, custom path.
- `note_workflow` handler tests (existing `index.test.ts` pattern) — each action delegates to the existing note-writer functions, `dry_run` writes and schedules nothing, response includes the `sync` block and `next_steps`.
- Existing tests for note-writer, git-manager, and loader stay untouched (no behavior change in those layers).

## Decisions log

| Decision | Choice |
|---|---|
| Discovery approach | Self-describing tool responses (`sync` block + `next_steps`), not Resources/Prompts |
| CRUD shape | One generic `note_workflow` tool |
| Search integration | Workflow tool takes resolved `note_path` only; search gains `include_content` |
| Tool scope | Deprecate granular tools (keep functional), log usage to evaluate removal |
| Sync default | Always-on deferred commit/push, debounced on idle (30s commit / 2min push) |
| Defer signal | `defer_hint_seconds` param on `note_workflow` |
| Scheduler scope | Global — all write tools feed the same scheduler |
| Usage log | Opt-in `--log-usage` CLI flag; in-memory queue flushed on idle; stored outside the vault |
