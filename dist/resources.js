const RESOURCE_PREFIX = 'memory-guide://';
function resource(slug, name, description, text) {
    return {
        uri: `${RESOURCE_PREFIX}${slug}`,
        name,
        description,
        text,
    };
}
// Idle timing constants (must match index.ts configuration)
const COMMIT_IDLE_SECONDS = 30;
const PUSH_IDLE_SECONDS = 120;
export const MEMORY_RESOURCES = [
    resource('index', 'Memory MCP Workflow Guide', 'Overview of the note workflow and available operations.', `# Memory MCP Workflow

Write notes using **note_workflow** — a single call that creates, edits, or deletes and auto-commits (30s idle) then auto-pushes (2min idle).

## Operations

- **note_workflow**: Create/edit/delete with embedding refresh and scheduled sync. Preferred over all legacy write/git tools.
- **search_notes**: Semantic search with keyword fallback. Pass \`include_content\` to embed note text inline.
- **get_similar_notes**: Find notes semantically related to a seed. Supports \`include_content\`.
- **get_connection_graph**: Expand multi-hop relationships by depth.
- **get_embedding_neighbors**: Find notes near a custom embedding vector.
- **get_note_content**: Read a note's full text and blocks.
- **get_stats**: Server health, embedding status, sync state.

See **tools** resource for parameter details.

## Workflow

Sync happens automatically:
1. **Commit** within ${COMMIT_IDLE_SECONDS}s of the last write.
2. **Push** within ${PUSH_IDLE_SECONDS}s of the commit.
3. Use \`defer_hint_seconds\` to extend the window if more writes are coming (max 30min).

No git tool calls needed. See **sync** resource for details.

## Prompts

Memory-management prompts. The **Obsidian vault is the system of record** for memory content; Claude Code's native memory directory keeps only a stub with a \`vault_note\` pointer.

- **init**: Load standing capture rules — what qualifies as durable memory, how to detect disagreement, and how to write both the vault note and the native stub.
- **migrate**: Sweep this project's native memory files into the vault, leaving stubs behind.
- **disable**: Suspend autonomous capture for the rest of the conversation.

Task prompts also exist: **capture_memory**, **project_research**, **cleanup_stale**, **daily_note**, and **review_before_write**.

## Embeddings

Notes are embedded on create/edit for semantic search. See **embeddings** resource.`),
    resource('tools', 'Tool Reference', 'Parameters and usage for all available tools.', `# Tool Reference

## note_workflow ⭐ (Preferred)

Single call to create, edit, or delete a note with embedding refresh and auto-commit/push.

**Parameters:**
- \`action\`: 'create' | 'edit' | 'delete'
- \`note_path\`: Vault-relative path (e.g., "Folder/Note.md")
- \`content\`: Markdown text (required for create/edit)
- \`frontmatter\`: Object of frontmatter fields (create only)
- \`mode\`: 'overwrite' | 'append' | 'append-section' | 'replace' | 'insert-after-heading' (edit only)
- \`heading\`: Required for append-section or insert-after-heading mode
- \`find\`: Regex or literal string (replace mode only)
- \`regex\`: true to treat \`find\` as regex (replace mode only)
- \`count\`: Max replacements (replace mode only)
- \`dry_run\`: Preview changes without writing (edit only)
- \`defer_hint_seconds\`: Hold auto-commit if more writes are coming (1–1800 seconds)

**Example:**
\`\`\`
action: 'create'
note_path: 'Research/Topic.md'
content: '# Research notes...'
frontmatter: { tags: ['research', 'active'] }
defer_hint_seconds: 60  // More writes coming; wait up to 60s
\`\`\`

## search_notes

Semantic search with keyword fallback. Returns top-k matching notes.

**Parameters:**
- \`query\`: Natural-language search string
- \`limit\`: Max results (default 10)
- \`threshold\`: Similarity threshold 0–1 (default 0.5)
- \`include_content\`: Embed note text in results (default false)
- \`content_max_chars\`: Max characters per note (default 2000)

## get_similar_notes

Find notes semantically similar to a reference note.

**Parameters:**
- \`note_path\`: Seed note path
- \`limit\`: Max results (default 10)
- \`threshold\`: Similarity 0–1 (default 0.5)
- \`include_content\`: Embed text in results (default false)
- \`content_max_chars\`: Max chars per note (default 2000)

## get_connection_graph

Expand relationships by depth (multi-hop discovery).

**Parameters:**
- \`note_path\`: Starting note
- \`depth\`: Hops (default 2)
- \`threshold\`: Similarity 0–1 (default 0.6)
- \`max_per_level\`: Connections per level (default 5)

## get_embedding_neighbors

Find notes near a custom embedding vector.

**Parameters:**
- \`embedding_vector\`: Dense vector (float array)
- \`k\`: Number of neighbors (default 10)
- \`threshold\`: Similarity 0–1 (default 0.5)

## get_note_content

Read a note's full text and optionally extract sections.

**Parameters:**
- \`note_path\`: Note path
- \`include_blocks\`: Optional list of heading names to extract

## get_stats

Server health and sync state.

**Returns:**
- \`total_notes\`: Notes in vault
- \`total_vectors\`: Embedded notes
- \`embedder_ready\`: Embedding model loaded
- \`sync\`: Commit/push state, pending paths, errors

---

## Deprecated (Do Not Use)

These tools are replaced by **note_workflow** and **auto-commit/push**:
- \`create_note\` → use \`note_workflow action: 'create'\`
- \`edit_note\` → use \`note_workflow action: 'edit'\`
- \`delete_note\` → use \`note_workflow action: 'delete'\`
- \`git_commit_notes\` → auto-commit via SyncScheduler
- \`git_commit_notes_specific\` → auto-commit via SyncScheduler
- \`git_push_notes\` → auto-push via SyncScheduler
- \`git_sync_notes\` → use \`get_stats\` to monitor sync state`),
    resource('sync', 'Auto-Commit and Auto-Push', 'How idle-debounced synchronization works.', `# Sync Scheduler

Every write via **note_workflow** triggers automatic commit and push on an idle schedule.

## Timeline

1. **Write** via \`note_workflow\` → clears idle timer.
2. **${COMMIT_IDLE_SECONDS}s idle** → auto-commit of all pending changes.
3. **${PUSH_IDLE_SECONDS}s after commit** → auto-push to remote.
4. **Shutdown** → best-effort flush of pending changes.

## defer_hint_seconds

Pass \`defer_hint_seconds\` when more writes are coming. The scheduler extends the idle window.

**Example:** Writing 5 notes in sequence:
\`\`\`
note_workflow action: 'create', defer_hint_seconds: 60  // More writes coming
note_workflow action: 'create', defer_hint_seconds: 60
note_workflow action: 'create', defer_hint_seconds: 60
note_workflow action: 'create', defer_hint_seconds: 60
note_workflow action: 'create'  // Last write; auto-commit in 30s
\`\`\`

Capped at 30 minutes max.

## Manual Git Tools

Direct calls to \`git_commit_notes\` or \`git_push_notes\` immediately flush the scheduler, forcing synchronous git operations.

## Monitoring Sync State

Call \`get_stats\` to see:
- \`commit_in_seconds\`: Seconds until auto-commit
- \`push_after_commit_seconds\`: Delay from commit to push
- \`pending_paths\`: Files staged for commit
- \`error\`: Last commit/push failure if any`),
    resource('embeddings', 'Embedding and Search Behavior', 'How note embeddings work and fallback behavior.', `# Embeddings

## Model

Smart Connections uses **TaylorAI/bge-micro-v2** (384-dimensional, ~27MB).

- **Lazy init**: Loaded on first search or write; does not block server startup.
- **Cached**: Stays in memory for subsequent operations.

## Embedding Refresh

Every write via **note_workflow** refreshes the note's embedding:
- \`action: 'create'\` → embeds the new note
- \`action: 'edit'\` → re-embeds the updated note
- \`action: 'delete'\` → removes the embedding

Embeddings are stored in the vault at \`.smart-env/multi/*.ajson\`.

## Search Fallback

If the embedding model fails to load (memory, architecture, or dependency issues):
- **Writes still succeed** — notes are created/edited/deleted normally.
- **Search falls back to keywords** — \`search_notes\` matches on title and body text only (no semantic similarity).

Check \`get_stats\` → \`embedder_ready\` to verify model status.

## Performance

- Embedding a note: ~50–100ms (first load: +3–5s for model init).
- Search over N notes: O(N) dot-product (semantic) or O(N) string search (keyword fallback).
- Typical vault (500 notes): <100ms search.`),
];
export const MEMORY_RESOURCE_BY_URI = new Map(MEMORY_RESOURCES.map((item) => [item.uri, item]));
//# sourceMappingURL=resources.js.map