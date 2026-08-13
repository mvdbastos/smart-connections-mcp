export const tools = [
    {
        name: 'note_workflow',
        description: 'Create, edit, or delete a vault note in a single call. Writes immediately, refreshes the note embedding, and auto-commits (30s idle) then auto-pushes (2min idle) in the background — no separate git tool calls needed. Preferred over create_note/edit_note/delete_note and the git_* tools.',
        inputSchema: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['create', 'edit', 'delete'],
                    description: 'Workflow action',
                },
                note_path: { type: 'string', description: 'Path to the note, relative to vault root' },
                content: { type: 'string', description: 'Markdown content; required for create and edit' },
                frontmatter: { type: 'object', description: 'Optional frontmatter fields (create only)' },
                mode: {
                    type: 'string',
                    enum: ['overwrite', 'append', 'append-section', 'replace', 'insert-after-heading'],
                    default: 'append',
                    description: 'Edit mode (edit action only). replace requires find; insert-after-heading requires heading.',
                },
                heading: { type: 'string', description: 'Heading for append-section or insert-after-heading mode' },
                find: { type: 'string', description: 'Literal text or regex pattern to find in replace mode' },
                regex: { type: 'boolean', description: 'Treat find as a regular expression in replace mode' },
                count: { type: 'number', description: 'Maximum number of replacements in replace mode', minimum: 1 },
                dry_run: { type: 'boolean', description: 'Preview the edit diff without writing (edit action only)' },
                defer_hint_seconds: {
                    type: 'number',
                    minimum: 1,
                    maximum: 1800,
                    description: 'Hold auto-commit for at least this many seconds because more writes are coming',
                },
            },
            required: ['action', 'note_path'],
            additionalProperties: false,
        },
    },
    {
        name: 'get_similar_notes',
        description: 'Find notes semantically similar to a given note using embeddings. Returns paths, similarity scores, and available blocks.',
        inputSchema: {
            type: 'object',
            properties: {
                note_path: {
                    type: 'string',
                    description: 'Path to the note (e.g., "Note.md" or "Folder/Note.md")',
                },
                threshold: {
                    type: 'number',
                    description: 'Similarity threshold (0-1), default 0.5',
                    minimum: 0,
                    maximum: 1,
                    default: 0.5,
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of results, default 10',
                    minimum: 1,
                    default: 10,
                },
                include_content: {
                    type: 'boolean',
                    description: 'Include note content inline in each result (default false). Skips the need for a follow-up get_note_content call before editing.',
                    default: false,
                },
                content_max_chars: {
                    type: 'number',
                    description: 'Max content characters per note when include_content is true, default 2000',
                    minimum: 1,
                    default: 2000,
                },
            },
            required: ['note_path'],
        },
    },
    {
        name: 'get_connection_graph',
        description: 'Build a multi-level connection graph starting from a note, showing how notes are semantically connected.',
        inputSchema: {
            type: 'object',
            properties: {
                note_path: {
                    type: 'string',
                    description: 'Path to the note to start from',
                },
                depth: {
                    type: 'number',
                    description: 'Depth of the connection graph (levels), default 2',
                    minimum: 1,
                    default: 2,
                },
                threshold: {
                    type: 'number',
                    description: 'Similarity threshold (0-1), default 0.6',
                    minimum: 0,
                    maximum: 1,
                    default: 0.6,
                },
                max_per_level: {
                    type: 'number',
                    description: 'Max connections per level, default 5',
                    minimum: 1,
                    default: 5,
                },
            },
            required: ['note_path'],
        },
    },
    {
        name: 'search_notes',
        description: 'Search for notes using a text query. Returns notes ranked by relevance with similarity scores.',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query text',
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of results, default 10',
                    minimum: 1,
                    default: 10,
                },
                threshold: {
                    type: 'number',
                    description: 'Similarity threshold (0-1), default 0.5',
                    minimum: 0,
                    maximum: 1,
                    default: 0.5,
                },
                include_content: {
                    type: 'boolean',
                    description: 'Include note content inline in each result (default false). Skips the need for a follow-up get_note_content call before editing.',
                    default: false,
                },
                content_max_chars: {
                    type: 'number',
                    description: 'Max content characters per note when include_content is true, default 2000',
                    minimum: 1,
                    default: 2000,
                },
            },
            required: ['query'],
        },
    },
    {
        name: 'get_embedding_neighbors',
        description: 'Find nearest neighbors for a given embedding vector. Useful for custom similarity searches.',
        inputSchema: {
            type: 'object',
            properties: {
                embedding_vector: {
                    type: 'array',
                    items: { type: 'number' },
                    description: '384-dimensional embedding vector',
                },
                k: {
                    type: 'number',
                    description: 'Number of neighbors to return, default 10',
                    minimum: 1,
                    default: 10,
                },
                threshold: {
                    type: 'number',
                    description: 'Similarity threshold (0-1), default 0.5',
                    minimum: 0,
                    maximum: 1,
                    default: 0.5,
                },
            },
            required: ['embedding_vector'],
        },
    },
    {
        name: 'get_note_content',
        description: 'Retrieve the full content of a note, optionally with specific blocks/sections extracted.',
        inputSchema: {
            type: 'object',
            properties: {
                note_path: {
                    type: 'string',
                    description: 'Path to the note',
                },
                include_blocks: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Specific block headings to include (optional)',
                },
            },
            required: ['note_path'],
        },
    },
    {
        name: 'get_stats',
        description: 'Get statistics about the vault (total notes, blocks, embedding model, etc.).',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'create_note',
        description: '[DEPRECATED — prefer note_workflow] Create a new markdown note in the vault and update its local embedding when available.',
        inputSchema: {
            type: 'object',
            properties: {
                note_path: { type: 'string', description: 'Path for the new note, relative to vault root' },
                content: { type: 'string', description: 'Markdown content to write' },
                frontmatter: { type: 'object', description: 'Optional frontmatter fields' },
            },
            required: ['note_path', 'content'],
        },
    },
    {
        name: 'edit_note',
        description: '[DEPRECATED — prefer note_workflow] Edit a markdown note using overwrite, append, append-section, replace, or insert-after-heading mode. Supports dry_run previews with a unified diff before writing.',
        inputSchema: {
            type: 'object',
            properties: {
                note_path: { type: 'string', description: 'Path to the note, relative to vault root' },
                content: { type: 'string', description: 'Markdown content to write, append, insert, or use as replacement text' },
                mode: {
                    type: 'string',
                    enum: ['overwrite', 'append', 'append-section', 'replace', 'insert-after-heading'],
                    default: 'append',
                    description: 'Edit mode. replace requires find; insert-after-heading requires heading.',
                },
                heading: { type: 'string', description: 'Heading to add in append-section mode or locate in insert-after-heading mode' },
                find: { type: 'string', description: 'Literal text or regex pattern to find in replace mode' },
                regex: { type: 'boolean', description: 'Treat find as a regular expression in replace mode' },
                count: { type: 'number', description: 'Maximum number of replacements in replace mode', minimum: 1 },
                dry_run: { type: 'boolean', description: 'Return diff and hashes without writing the file' },
            },
            required: ['note_path', 'content'],
            additionalProperties: false,
        },
    },
    {
        name: 'delete_note',
        description: '[DEPRECATED — prefer note_workflow] Delete a markdown note from the vault.',
        inputSchema: {
            type: 'object',
            properties: {
                note_path: { type: 'string', description: 'Path to the note, relative to vault root' },
            },
            required: ['note_path'],
        },
    },
    {
        name: 'git_commit_notes',
        description: '[DEPRECATED — prefer note_workflow] Commit all uncommitted changes to git with an auto-generated or custom message.',
        inputSchema: {
            type: 'object',
            properties: {
                message: {
                    type: 'string',
                    description: 'Commit message; auto-generated if omitted (e.g., "Updated: note1.md, note2.md")',
                },
                author_name: {
                    type: 'string',
                    description: 'Git author name; uses git config user.name if omitted',
                },
                author_email: {
                    type: 'string',
                    description: 'Git author email; uses git config user.email if omitted',
                },
            },
        },
    },
    {
        name: 'git_commit_notes_specific',
        description: '[DEPRECATED — prefer note_workflow] Commit specific note files to git.',
        inputSchema: {
            type: 'object',
            properties: {
                note_paths: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Paths to notes to commit (relative to vault root, e.g., ["Note.md", "Folder/Note.md"])',
                },
                message: {
                    type: 'string',
                    description: 'Commit message; auto-generated if omitted',
                },
                author_name: {
                    type: 'string',
                    description: 'Git author name; uses git config user.name if omitted',
                },
                author_email: {
                    type: 'string',
                    description: 'Git author email; uses git config user.email if omitted',
                },
            },
            required: ['note_paths'],
        },
    },
    {
        name: 'git_push_notes',
        description: '[DEPRECATED — prefer note_workflow] Push committed note changes to the configured git remote, with a local fallback when remote push is unavailable.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'git_sync_notes',
        description: '[DEPRECATED — prefer note_workflow] Sync notes by fetching, pulling, then pushing changes. Detects and reports merge conflicts.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
];
//# sourceMappingURL=tool-definitions.js.map