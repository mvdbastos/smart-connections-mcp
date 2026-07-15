import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { EditNoteSchema, NoteWorkflowSchema, formatToolError } from './tool-schemas.js';
describe('edit_note schema', () => {
    it('rejects replace mode without find and accepts valid replace', () => {
        expect(() => EditNoteSchema.parse({
            note_path: 'Note.md',
            content: 'replacement',
            mode: 'replace',
        })).toThrow(z.ZodError);
        expect(EditNoteSchema.parse({
            note_path: 'Note.md',
            content: 'replacement',
            mode: 'replace',
            find: 'target',
        })).toMatchObject({ mode: 'replace', find: 'target' });
    });
});
describe('note_workflow schema', () => {
    it('requires content for create and edit but not delete', () => {
        expect(() => NoteWorkflowSchema.parse({ action: 'create', note_path: 'A.md' })).toThrow(z.ZodError);
        expect(() => NoteWorkflowSchema.parse({ action: 'edit', note_path: 'A.md' })).toThrow(z.ZodError);
        expect(NoteWorkflowSchema.parse({ action: 'delete', note_path: 'A.md' })).toMatchObject({
            action: 'delete',
        });
    });
    it('enforces edit-mode invariants', () => {
        expect(() => NoteWorkflowSchema.parse({ action: 'edit', note_path: 'A.md', content: 'x', mode: 'replace' })).toThrow(z.ZodError);
        expect(() => NoteWorkflowSchema.parse({ action: 'edit', note_path: 'A.md', content: 'x', mode: 'insert-after-heading' })).toThrow(z.ZodError);
        expect(NoteWorkflowSchema.parse({
            action: 'edit',
            note_path: 'A.md',
            content: 'x',
            mode: 'replace',
            find: 'old',
        })).toMatchObject({ mode: 'replace', find: 'old' });
    });
    it('defaults mode to append and caps defer_hint_seconds at 1800', () => {
        const parsed = NoteWorkflowSchema.parse({ action: 'edit', note_path: 'A.md', content: 'x' });
        expect(parsed.mode).toBe('append');
        expect(() => NoteWorkflowSchema.parse({ action: 'edit', note_path: 'A.md', content: 'x', defer_hint_seconds: 1801 })).toThrow(z.ZodError);
        expect(NoteWorkflowSchema.parse({ action: 'edit', note_path: 'A.md', content: 'x', defer_hint_seconds: 1800 })).toMatchObject({ defer_hint_seconds: 1800 });
    });
});
describe('formatToolError', () => {
    it('names the tool and bad field for zod errors', () => {
        const schema = z.object({ count: z.number() });
        const parsed = schema.safeParse({ count: 'nope' });
        if (parsed.success) {
            throw new Error('expected sample schema to fail');
        }
        const message = formatToolError('edit_note', parsed.error);
        expect(message).toContain('edit_note');
        expect(message).toContain('count');
        expect(message).toContain('expected number');
        expect(message).toContain('received string');
    });
});
//# sourceMappingURL=index.test.js.map