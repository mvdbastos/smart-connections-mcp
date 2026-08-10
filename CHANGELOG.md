# Changelog

## prompt-scope-and-arg-errors

### Changed
- **Breaking:** `note_workflow` and `edit_note` now reject unknown parameters instead of silently discarding them. A call carrying a stray or misspelled key now fails with an error naming that key. Previously the key was dropped and the call proceeded, which on a write tool could mean content written in the wrong mode or to the wrong place.

### Fixed
- Argument errors no longer fabricate a "received" value for missing-field errors (#6).
- The `migrate` prompt now names `.claude/projects/<slug>/memory/` in its opening instruction and its description, and both `init` and `migrate` now explicitly exclude `/memories/` and other assistant-level memory stores (#10).

## workflow-sync

### Added
- `note_workflow` tool: create/edit/delete a note in a single call with embedding refresh and deferred auto-commit/push.
- `SyncScheduler`: idle-debounced auto-commit (30s, `SYNC_COMMIT_IDLE_MS`) and auto-push (2min, `SYNC_PUSH_IDLE_MS`) fed by every write tool; `defer_hint_seconds` extends the window (capped at 30min); manual git tools flush immediately; best-effort flush on shutdown.
- Opt-in deprecated-tool usage logging via `--log-usage[=<path>]`, queued in memory and flushed during idle windows to `logs/mcp-tool-usage.log` outside the vault.
- `include_content`/`content_max_chars` on `search_notes` and `get_similar_notes`.
- `sync` status block in `get_stats`.
- Reorganized MCP resources and prompts:
  - **Resources** (read-only reference docs): `memory-guide://index`, `memory-guide://tools` (tool map + deprecations), `memory-guide://sync` (idle-debounce timing), `memory-guide://embeddings` (model behavior).
  - **Prompts** (parameterized action templates): `capture_memory`, `project_research`, `cleanup_stale`, `daily_note`, `review_before_write`. Search-shaped prompts (`capture_memory`, `project_research`, `cleanup_stale`) pre-fetch vault results and embed them in the message for faster context buildup.
- Two-tier memory: the Obsidian vault becomes the system of record for agent memory, with Claude Code's native memory files reduced to stubs carrying `name`, `description`, and a `vault_note` pointer.
  - **`init`** `(project?)`: standing capture rules — triggers, disagreement detection with an instance-vs-general test, do-not-capture guards, and both templates. Pre-fetches existing `Memory/` notes.
  - **`migrate`** `(project?)`: sweeps a project's native memory files into the vault. `metadata.vault_note` is the only authoritative migrated-flag; vault note is always written before the stub so an interrupted run is safe to re-run.
  - **`disable`**: suspends autonomous capture for the session. Reads stay available; native memory writing continues and becomes migration backlog.
  - `PromptContext` gains an optional `listByPrefix` helper so prompts can enumerate vault folders, which semantic search cannot do.

### Changed
- Deprecated (still functional): `create_note`, `edit_note`, `delete_note`, `git_commit_notes`, `git_commit_notes_specific`, `git_push_notes`, `git_sync_notes`.

### Breaking
- Deleted old resource URIs and prompt names. Clients must update to the new resource/prompt names:
  - Old: `memory-guide://search`, `memory-guide://similar`, `memory-guide://graph`, `memory-guide://read`, `memory-guide://create`, `memory-guide://edit`, `memory-guide://append-section`, `memory-guide://delete`, `memory-guide://embed-status`, `memory-guide://commit`, `memory-guide://push`, `memory-guide://sync`, `memory-guide://recipe-*`.
  - New: Four resources (`index`, `tools`, `sync`, `embeddings`) + five prompts (with arguments).
  - Prompts now declare `arguments` in `ListPrompts` output; `GetPrompt` accepts `arguments` parameter for prompt-specific configuration.

## git-integration

### Added
- Added Vitest with `test` and `test:watch` scripts for TDD workflow.
- Added git result and status types: `GitCommitResult`, `GitSyncResult`, and `GitStatus`.
- Added `GitManager` to handle git availability checks, repository detection, commits, sync, and status reporting.
- Added MCP git tools:
  - `git_commit_notes`
  - `git_commit_notes_specific`
  - `git_sync_notes`
- Added git status data to `get_stats`.
- Added startup logging for registered MCP tools.

### Changed
- Renamed git-focused MCP tools to use the `git_` prefix.
- Bounded git command execution time and disabled interactive git prompts so MCP requests fail fast instead of timing out in the client.
- Resolved upstream tracking from `@{upstream}` with fallback to `origin/<branch>` for ahead/behind and remote commit calculations.
- Restricted specific-file commits to the requested paths only, preserving unrelated staged files.
- Normalized repository path comparison for Windows path variants.

### Tests
- Added GitManager coverage for:
  - git availability and repository detection
  - branch and git config lookup
  - commit-all and commit-specific flows
  - custom author commits
  - git status structure
  - missing repository handling
  - sync timeout handling
  - non-`origin` upstream handling
  - protection against committing unrelated staged files

### Verification
- `npm test` passes with 13 tests.
- `npm run build` passes.
