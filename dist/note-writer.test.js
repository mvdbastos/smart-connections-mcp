import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createNote, editNote, deleteNote } from './note-writer.js';
describe('note writer', () => {
    it('creates, edits, and deletes a note', () => {
        const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'w-'));
        try {
            createNote(vault, 'F/N.md', '# T', { tags: ['a'] });
            const noteFile = path.join(vault, 'F', 'N.md');
            expect(fs.existsSync(noteFile)).toBe(true);
            expect(fs.readFileSync(noteFile, 'utf-8')).toContain('tags: ["a"]');
            editNote(vault, 'F/N.md', 'more', 'append');
            expect(fs.readFileSync(noteFile, 'utf-8')).toContain('more');
            editNote(vault, 'F/N.md', 'section body', 'append-section', 'Memory');
            const afterSection = fs.readFileSync(noteFile, 'utf-8');
            expect(afterSection).toContain('## Memory');
            expect(afterSection).toContain('section body');
            editNote(vault, 'F/N.md', 'replacement', 'overwrite');
            expect(fs.readFileSync(noteFile, 'utf-8')).toBe('replacement');
            deleteNote(vault, 'F/N.md');
            expect(fs.existsSync(noteFile)).toBe(false);
        }
        finally {
            fs.rmSync(vault, { recursive: true, force: true });
        }
    });
    it('refuses to create over an existing note or escape the vault', () => {
        const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'w-'));
        try {
            createNote(vault, 'A.md', 'one');
            expect(() => createNote(vault, 'A.md', 'two')).toThrow(/exists/i);
            expect(() => createNote(vault, '../outside.md', 'nope')).toThrow(/escapes vault/i);
        }
        finally {
            fs.rmSync(vault, { recursive: true, force: true });
        }
    });
});
//# sourceMappingURL=note-writer.test.js.map