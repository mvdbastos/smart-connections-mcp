import { z, ZodError, ZodIssueCode } from 'zod';
const editNoteShape = {
    note_path: z.string().describe('Path to the note, relative to the vault'),
    content: z.string().describe('Replacement text in replace mode; the note body or fragment to write in every other mode'),
    mode: z
        .enum(['overwrite', 'append', 'append-section', 'replace', 'insert-after-heading'])
        .default('append')
        .describe('Edit mode'),
    heading: z.string().optional().describe('Heading used for append-section or insert-after-heading mode'),
    find: z.string().optional().describe('Text or regex pattern to find in replace mode'),
    regex: z.boolean().optional().describe('Treat find as a regular expression in replace mode'),
    count: z.number().int().positive().optional().describe('Maximum number of replacements'),
    dry_run: z.boolean().optional().describe('Preview diff and hashes without writing'),
};
export const EditNoteSchema = z
    .object(editNoteShape)
    .strict()
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
const noteWorkflowShape = {
    action: z.enum(['create', 'edit', 'delete']).describe('Workflow action'),
    note_path: z.string().describe('Path to the note, relative to the vault'),
    content: z
        .string()
        .optional()
        .describe('Note content; required for create and edit. In edit mode=replace, the replacement text; otherwise the body or fragment to write'),
    frontmatter: z.record(z.unknown()).optional().describe('Optional frontmatter fields (create only)'),
    mode: z
        .enum(['overwrite', 'append', 'append-section', 'replace', 'insert-after-heading'])
        .default('append')
        .describe('Edit mode (edit action only)'),
    heading: z.string().optional().describe('Heading for append-section or insert-after-heading mode'),
    find: z.string().optional().describe('Text or regex pattern to find in replace mode'),
    regex: z.boolean().optional().describe('Treat find as a regular expression in replace mode'),
    count: z.number().int().positive().optional().describe('Maximum number of replacements'),
    dry_run: z.boolean().optional().describe('Preview the edit diff without writing (edit action only)'),
    defer_hint_seconds: z
        .number()
        .int()
        .positive()
        .max(1800)
        .optional()
        .describe('Hold auto-commit for at least this many seconds because more writes are coming'),
};
export const NoteWorkflowSchema = z
    .object(noteWorkflowShape)
    .strict()
    .superRefine((value, ctx) => {
    if ((value.action === 'create' || value.action === 'edit') && value.content === undefined) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['content'],
            message: `${value.action} requires content`,
        });
    }
    if (value.action === 'edit' && value.mode === 'replace' && !value.find) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['find'],
            message: 'replace mode requires find',
        });
    }
    if (value.action === 'edit' && value.mode === 'insert-after-heading' && !value.heading) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['heading'],
            message: 'insert-after-heading mode requires heading',
        });
    }
});
/**
 * Valid parameter names per tool, derived from the Zod shapes so the list can
 * never drift from what the schema actually accepts.
 */
export const TOOL_KEYS = {
    note_workflow: Object.keys(noteWorkflowShape),
    edit_note: Object.keys(editNoteShape),
};
/**
 * Parameter names callers reach for out of habit, mapped to the real ones.
 * Sourced from Claude Code's own Edit and Write tool signatures.
 */
const PARAM_ALIASES = {
    new_string: 'content',
    old_string: 'find',
    file_path: 'note_path',
    path: 'note_path',
};
export function formatToolError(toolName, error) {
    if (error instanceof ZodError) {
        if (error.issues.length === 0) {
            return `${toolName}: validation failed`;
        }
        const issue = error.issues[0];
        const validKeys = TOOL_KEYS[toolName];
        if (issue.code === ZodIssueCode.unrecognized_keys) {
            const unknown = issue.keys[0];
            const alias = PARAM_ALIASES[unknown];
            if (alias && validKeys?.includes(alias)) {
                return `${toolName}: unknown parameter "${unknown}" (did you mean "${alias}"?)`;
            }
            const validList = validKeys ? ` (valid: ${validKeys.join(', ')})` : '';
            return `${toolName}: unknown parameter "${unknown}"${validList}`;
        }
        const field = issue.path.length ? issue.path.join('.') : 'arguments';
        if (issue.code === ZodIssueCode.custom) {
            return `${toolName}: invalid "${field}" (${issue.message})`;
        }
        const expected = 'expected' in issue ? String(issue.expected) : issue.message ?? 'valid value';
        const received = 'received' in issue ? String(issue.received) : 'invalid value';
        return `${toolName}: invalid "${field}" (expected ${expected}, received ${received})`;
    }
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=tool-schemas.js.map