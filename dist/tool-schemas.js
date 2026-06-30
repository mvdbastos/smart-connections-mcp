import { z, ZodError } from 'zod';
export const EditNoteSchema = z
    .object({
    note_path: z.string().describe('Path to the note, relative to the vault'),
    content: z.string().describe('Markdown content to write, append, insert, or use as replacement'),
    mode: z
        .enum(['overwrite', 'append', 'append-section', 'replace', 'insert-after-heading'])
        .default('append')
        .describe('Edit mode'),
    heading: z.string().optional().describe('Heading used for append-section or insert-after-heading mode'),
    find: z.string().optional().describe('Text or regex pattern to find in replace mode'),
    regex: z.boolean().optional().describe('Treat find as a regular expression in replace mode'),
    count: z.number().int().positive().optional().describe('Maximum number of replacements'),
    dry_run: z.boolean().optional().describe('Preview diff and hashes without writing'),
})
    .superRefine((value, ctx) => {
    if (value.mode === 'replace' && !value.find) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['find'],
            message: 'replace mode requires find',
        });
    }
    if (value.mode === 'insert-after-heading' && !value.heading) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['heading'],
            message: 'insert-after-heading mode requires heading',
        });
    }
});
export function formatToolError(toolName, error) {
    if (error instanceof ZodError) {
        const issue = error.issues[0];
        const field = issue?.path.length ? issue.path.join('.') : 'arguments';
        const expected = 'expected' in issue ? String(issue.expected) : issue?.message ?? 'valid value';
        const received = 'received' in issue ? String(issue.received) : 'invalid value';
        return `${toolName}: invalid "${field}" (expected ${expected}, received ${received})`;
    }
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=tool-schemas.js.map