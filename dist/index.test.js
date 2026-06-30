import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { EditNoteSchema, formatToolError } from './tool-schemas.js';
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