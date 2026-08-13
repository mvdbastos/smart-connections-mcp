# Changelog

## index-reconcile-recovery

### Fixed
- The index no longer refuses to reconcile forever once more than half its entries go stale. The old `>50%` guard was a one-way trap: staleness only increases, and the entries that would bring the ratio back under threshold were exactly the ones it refused to drop, so every restart reached the same refusal (#13). Reconcile now refuses only when every indexed note is missing and there are at least five of them, which indicates `.smart-env` describes a different folder than the one it sits in. A vault already stuck in the old state recovers on its first start after this change, with no migration step.

### Added
- `index` block in `get_stats` reporting how many entries were indexed, missing, and dropped at startup, with a sample of missing paths. A refused reconcile also carries a hint asking the user whether to investigate the vault directly or open an issue.
- `index_warning` on `search_notes` responses while the index is unreconciled, so results that may contain paths with no file behind them announce it. Present only in that state; it carries counts, never note paths.

### Changed
- `search_notes` wraps its results as `{ results, index_warning }` while the index is unreconciled. The normal response shape is unchanged.
- Text handed to an agent now calls the notes and their index "the vault", and the software "the vault server", replacing "Smart Connections", "smart-connections-mcp", and "this MCP server".

## prompt-scope-and-arg-errors

### Changed
- **Breaking:** `note_workflow` and `edit_note` now reject unknown parameters instead of silently discarding them. A call carrying a stray or misspelled key now fails with an error naming that key. Previously the key was dropped and the call proceeded, which on a write tool could mean content written in the wrong mode or to the wrong place.

### Fixed
- Argument errors no longer fabricate a "received" value for missing-field errors (#6).
- The `migrate` prompt now names `.claude/projects/<slug>/memory/` in its opening instruction and its description, and both `init` and `migrate` now explicitly exclude `/memories/` and other assistant-level memory stores (#10).

## index-filesystem-integrity

### Breaking
- `note_workflow action=edit` no longer creates a note that does not exist — this includes `mode=overwrite`. Use `action=create`. Previously a missing file was treated as empty, so the edit silently created the file and its parent directories.
- Edits and deletes no longer resolve a bare note name by basename. `note_path` must be an exact path, a path without the `.md` suffix, or a case-insensitive match. The error lists the candidates it declined. Reads are unaffected.

### Fixed
- Deleting a note now removes it from the in-memory index, so a later edit of the same path cannot resurrect it (#7).
- Index entries whose file is missing are dropped at startup, so `listByPrefix` and search no longer surface notes that were moved or deleted (#4).
- `create_note` and `note_workflow action=create` now append `.md` when the caller omits it, instead of silently writing a file Obsidian's indexer never sees (#11).

## sync-durability

### Fixed
- A note created and deleted within the same commit window no longer blocks every later auto-commit. Previously the unmatched pathspec aborted the whole batch and the path was never cleared, so no note auto-committed again until restart (#5).
- Pending commits now survive an unexpected process death. The dirty set is journalled to `<vault>/.git/smart-connections-mcp/pending.json` and recovered at startup (#8).

### Added
- Paths that repeatedly fail to commit are quarantined individually rather than blocking the pipeline, and reported in the `sync` block as `quarantined_paths`.
- `remediation` and `report` hints in the `sync` block guiding recovery from a blocked commit.

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
