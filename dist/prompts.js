import { z } from 'zod';
// Zod schemas for argument validation
const CaptureMemoryArgsSchema = z.object({
    topic: z.string().min(1, 'topic required'),
    tags: z.string().optional(),
});
const ProjectResearchArgsSchema = z.object({
    topic: z.string().min(1, 'topic required'),
});
const CleanupStaleArgsSchema = z.object({
    query: z.string().min(1, 'query required'),
});
const DailyNoteArgsSchema = z.object({
    heading: z.string().optional(),
});
const ReviewBeforeWriteArgsSchema = z.object({
    note_path: z.string().min(1, 'note_path required'),
});
function formatSearchHits(hits) {
    if (hits.length === 0)
        return '';
    return hits.map((hit) => `- ${hit.path} (${hit.score.toFixed(2)})`).join('\n');
}
export const MEMORY_PROMPTS = [
    {
        name: 'capture_memory',
        description: 'Create and persist a new memory note in the vault.',
        arguments: [
            { name: 'topic', type: 'string', required: true, description: 'Topic or title for the memory' },
            { name: 'tags', type: 'string', required: false, description: 'Comma-separated tags (e.g., "research, active")' },
        ],
        build: async (args, ctx) => {
            const parsed = CaptureMemoryArgsSchema.parse(args);
            const { topic, tags } = parsed;
            // Pre-fetch to avoid duplicates
            let dedupHits = '';
            try {
                const hits = await ctx.search(topic, 3, 0.6);
                if (hits.length > 0) {
                    dedupHits = `\n\n**Existing notes on this topic:**\n${formatSearchHits(hits)}\n\nReview these before proceeding to avoid duplication.`;
                }
            }
            catch {
                // Fail soft; continue with plain instructions
            }
            const tagsBlock = tags ? `\n  tags: [${tags.split(',').map((t) => `'${t.trim()}'`).join(', ')}]` : '';
            return `Capture a new memory note on "${topic}".${dedupHits}

1. If a matching note exists, consider editing it instead (see review_before_write prompt).
2. Create a new note via note_workflow:
   - note_path: Vault-relative path (e.g., "Research/Topic.md")
   - content: Markdown content with clear sections
   - frontmatter: { tags: ['${topic}']${tagsBlock ? tagsBlock : ''} }
3. Example call:
   \`\`\`
   note_workflow
     action: 'create'
     note_path: 'Research/${topic}.md'
     content: '# ${topic}\\n\\n...'
     frontmatter: { tags: ['${topic}'] }
   \`\`\`
4. The note will auto-commit in 30s and auto-push in 2min.`;
        },
    },
    {
        name: 'project_research',
        description: 'Build context by searching and reading existing notes on a topic.',
        arguments: [{ name: 'topic', type: 'string', required: true, description: 'Topic to research' }],
        build: async (args, ctx) => {
            const parsed = ProjectResearchArgsSchema.parse(args);
            const { topic } = parsed;
            let seedNotes = '';
            try {
                const hits = await ctx.search(topic, 5, 0.4);
                if (hits.length > 0) {
                    seedNotes = `\n\n**Seed notes (existing research):**\n${formatSearchHits(hits)}`;
                }
            }
            catch {
                // Fail soft
            }
            return `Research "${topic}" to build context before answering.${seedNotes}

**Steps:**
1. Use get_note_content to read the highest-scoring notes above.
2. Use get_similar_notes on the best seed to expand your context.
3. Identify gaps or contradictions in the existing notes.
4. Add new findings via note_workflow:
   \`\`\`
   note_workflow
     action: 'create'  # or 'edit' to update a seed note
     note_path: 'Research/${topic}-findings.md'
     content: '# Findings for ${topic}\\n\\n...'
   \`\`\`

Let the auto-sync handle commit and push.`;
        },
    },
    {
        name: 'cleanup_stale',
        description: 'Identify and safely remove obsolete or stale notes.',
        arguments: [{ name: 'query', type: 'string', required: true, description: 'Search query for stale material (e.g., "deprecated", "old draft")' }],
        build: async (args, ctx) => {
            const parsed = CleanupStaleArgsSchema.parse(args);
            const { query } = parsed;
            let candidates = '';
            try {
                const hits = await ctx.search(query, 8, 0.35);
                if (hits.length > 0) {
                    candidates = `\n\n**Candidates for removal:**\n${formatSearchHits(hits)}`;
                }
            }
            catch {
                // Fail soft
            }
            return `Clean up stale or obsolete notes matching "${query}".${candidates}

**Steps:**
1. Use get_note_content to review each candidate above.
2. Confirm deletion is safe (e.g., content is obsolete, better info exists elsewhere).
3. Delete via note_workflow:
   \`\`\`
   note_workflow
     action: 'delete'
     note_path: 'Path/To/Stale/Note.md'
   \`\`\`
4. Repeat for other candidates.
5. Auto-sync will commit and push deletions.`;
        },
    },
    {
        name: 'daily_note',
        description: 'Append a dated section to a daily note.',
        arguments: [{ name: 'heading', type: 'string', required: false, description: "Optional heading for the new section (default: today's date)" }],
        build: async (args, ctx) => {
            const parsed = DailyNoteArgsSchema.parse(args);
            const { heading } = parsed;
            const today = new Date().toISOString().split('T')[0];
            const sectionHeading = heading || today;
            return `Append a new section to your daily note.

1. Get the current daily note:
   \`\`\`
   get_note_content note_path: 'Daily/Daily.md'  # adjust path as needed
   \`\`\`
2. Append a new section via note_workflow:
   \`\`\`
   note_workflow
     action: 'edit'
     note_path: 'Daily/Daily.md'
     mode: 'append-section'
     heading: '${sectionHeading}'
     content: 'Your content here...'
   \`\`\`
3. Auto-sync handles commit and push.`;
        },
    },
    {
        name: 'review_before_write',
        description: 'Read a note before editing to ensure safe changes.',
        arguments: [{ name: 'note_path', type: 'string', required: true, description: 'Path to the note to review' }],
        build: async (args, ctx) => {
            const parsed = ReviewBeforeWriteArgsSchema.parse(args);
            const { note_path } = parsed;
            return `Review a note before making changes.

**Steps:**
1. Read the current content:
   \`\`\`
   get_note_content note_path: '${note_path}'
   \`\`\`
2. Decide on the edit mode:
   - \`overwrite\`: Replace entire note
   - \`append\`: Add text at the end
   - \`append-section\`: Add a new headed section
   - \`replace\`: Find and replace text (supports regex)
   - \`insert-after-heading\`: Insert text after a specific heading

3. Make the edit via note_workflow:
   \`\`\`
   note_workflow
     action: 'edit'
     note_path: '${note_path}'
     mode: 'append'  # or other mode
     content: 'New content...'
     # dry_run: true  # preview the change first
   \`\`\`

Auto-sync will commit and push your changes.`;
        },
    },
];
export const MEMORY_PROMPT_BY_NAME = new Map(MEMORY_PROMPTS.map((item) => [item.name, item]));
//# sourceMappingURL=prompts.js.map