const GUIDE_PREFIX = 'memory-guide://';
function guide(slug, name, description, text) {
    return {
        uri: `${GUIDE_PREFIX}${slug}`,
        name,
        description,
        text,
    };
}
export const MEMORY_GUIDES = [
    guide('index', 'Memory MCP Guide Index', 'Index of memory server operations and recipes.', `# Memory MCP Guides

Use these guides before operating the memory vault:
- search: semantic note discovery
- similar: find related notes from a seed note
- graph: explore multi-hop note relationships
- read: inspect note contents
- create/edit/append-section/delete: maintain notes safely
- embed-status: understand embedding availability
- commit/push/sync: persist and share changes

Recipes cover capture, daily notes, project research, cleanup, and sync workflows.`),
    guide('search', 'Search notes', 'How to search notes semantically with keyword fallback.', `Use search_notes with a concise natural-language query. Lower threshold for broad discovery; raise it for precise semantic matches. If local embeddings are unavailable, search_notes falls back to keyword matching.`),
    guide('similar', 'Find similar notes', 'How to use get_similar_notes.', `Use get_similar_notes when you already know a seed note. Start with threshold 0.5 and limit 10. Increase threshold to reduce noise.`),
    guide('graph', 'Explore the graph', 'How to use get_connection_graph.', `Use get_connection_graph to expand related notes by depth. Keep depth low (1-2) and max_per_level modest to avoid noisy graphs.`),
    guide('read', 'Read notes', 'How to use get_note_content.', `Use get_note_content before editing. Pass include_blocks only when you need specific sections; otherwise read the full note for context.`),
    guide('create', 'Create notes', 'How to use create_note.', `Use create_note for new markdown files. Provide a vault-relative note_path, markdown content, and optional frontmatter. The server refuses to overwrite existing notes and attempts to embed the new note.`),
    guide('edit', 'Edit notes', 'How to use edit_note.', `Use edit_note with mode overwrite or append. Read the note first, then write the smallest safe change. The server attempts to refresh the note vector after editing.`),
    guide('append-section', 'Append sections', 'How to append a headed section.', `Use edit_note with mode append-section and heading. This appends a level-two heading followed by content, useful for dated updates or new observations.`),
    guide('delete', 'Delete notes', 'How to use delete_note.', `Use delete_note only after confirming the note path. Prefer committing before destructive cleanup so recovery is available from git history.`),
    guide('embed-status', 'Embedding status', 'How local embeddings behave.', `The server lazily initializes TaylorAI/bge-micro-v2 via transformers.js. If the model cannot load, writes still succeed and semantic query falls back to keyword search.`),
    guide('commit', 'Commit notes', 'How to commit vault changes.', `Use git_commit_notes for all changes or git_commit_notes_specific for selected note paths. Prefer clear commit messages describing the knowledge update.`),
    guide('push', 'Push notes', 'How to push vault changes.', `Use git_push_notes after committing. If no remote or network is available, the result reports localFallback=true and leaves changes committed locally.`),
    guide('sync', 'Sync notes', 'How to sync vault changes.', `Use git_sync_notes to fetch, pull, then push. Resolve reported conflicts manually before retrying.`),
    guide('recipe-capture-memory', 'Recipe: capture memory', 'Create and persist a new memory note.', `1. search_notes to avoid duplicates.\n2. create_note with frontmatter tags.\n3. git_commit_notes_specific for the new note.\n4. git_push_notes.`),
    guide('recipe-daily-note', 'Recipe: daily note update', 'Append a dated daily note section.', `1. get_note_content for the daily note.\n2. edit_note mode append-section with a descriptive heading.\n3. git_commit_notes_specific.\n4. git_push_notes.`),
    guide('recipe-project-research', 'Recipe: project research', 'Build context before answering.', `1. search_notes for the topic.\n2. get_similar_notes on the best seed.\n3. get_note_content for cited notes.\n4. create_note or edit_note with new findings.`),
    guide('recipe-cleanup', 'Recipe: cleanup stale notes', 'Safely remove obsolete notes.', `1. search_notes for stale material.\n2. get_note_content to verify.\n3. git_commit_notes before destructive work.\n4. delete_note.\n5. git_commit_notes and git_push_notes.`),
    guide('recipe-sync-before-work', 'Recipe: sync before work', 'Start from current remote state.', `1. git_sync_notes.\n2. If conflicts appear, stop and resolve them.\n3. Proceed with read/search/write tools.\n4. Commit and push when done.`),
];
export const MEMORY_GUIDE_BY_URI = new Map(MEMORY_GUIDES.map((item) => [item.uri, item]));
export const MEMORY_PROMPTS = MEMORY_GUIDES.filter((guideItem) => guideItem.uri !== `${GUIDE_PREFIX}index`).map((guideItem) => ({
    name: guideItem.uri.slice(GUIDE_PREFIX.length),
    description: guideItem.description,
    text: guideItem.text,
}));
//# sourceMappingURL=guides.js.map