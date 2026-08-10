# Changelog

## index-filesystem-integrity

### Breaking
- `note_workflow action=edit` no longer creates a note that does not exist — this includes `mode=overwrite`. Use `action=create`. Previously a missing file was treated as empty, so the edit silently created the file and its parent directories.
- Edits and deletes no longer resolve a bare note name by basename. `note_path` must be an exact path, a path without the `.md` suffix, or a case-insensitive match. The error lists the candidates it declined. Reads are unaffected.

### Fixed
- Deleting a note now removes it from the in-memory index, so a later edit of the same path cannot resurrect it (#7).
- Index entries whose file is missing are dropped at startup, so `listByPrefix` and search no longer surface notes that were moved or deleted (#4).
- `create_note` and `note_workflow action=create` now append `.md` when the caller omits it, instead of silently writing a file Obsidian's indexer never sees (#11).

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
