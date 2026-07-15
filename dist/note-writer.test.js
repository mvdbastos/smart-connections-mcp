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
    it('replaces literal content and reports hashes', () => {
        const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'w-'));
        try {
            createNote(vault, 'R.md', 'alpha beta beta');
            const result = editNote(vault, 'R.md', {
                mode: 'replace',
                find: 'beta',
                content: 'gamma',
                count: 1,
            });
            expect(fs.readFileSync(path.join(vault, 'R.md'), 'utf-8')).toBe('alpha gamma beta');
            expect(result.changed).toBe(true);
            expect(result.written).toBe(true);
            expect(result.previousHash).not.toBe(result.newHash);
        }
        finally {
            fs.rmSync(vault, { recursive: true, force: true });
        }
    });
    it('limits regex replacements by count', () => {
        const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'w-'));
        try {
            createNote(vault, 'Regex.md', 'item-1 item-2 item-3');
            editNote(vault, 'Regex.md', {
                mode: 'replace',
                find: 'item-\\d',
                regex: true,
                count: 2,
                content: 'done',
            });
            expect(fs.readFileSync(path.join(vault, 'Regex.md'), 'utf-8')).toBe('done done item-3');
        }
        finally {
            fs.rmSync(vault, { recursive: true, force: true });
        }
    });
    it('inserts content immediately after a markdown heading line', () => {
        const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'w-'));
        try {
            createNote(vault, 'Heading.md', '# Title\n\n## Target\nold\n\n## Next\nend');
            editNote(vault, 'Heading.md', {
                mode: 'insert-after-heading',
                heading: 'Target',
                content: 'inserted',
            });
            expect(fs.readFileSync(path.join(vault, 'Heading.md'), 'utf-8')).toBe('# Title\n\n## Target\ninserted\nold\n\n## Next\nend');
        }
        finally {
            fs.rmSync(vault, { recursive: true, force: true });
        }
    });
    it('returns a dry-run diff without writing the file', () => {
        const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'w-'));
        try {
            createNote(vault, 'Dry.md', 'before');
            const result = editNote(vault, 'Dry.md', {
                mode: 'overwrite',
                content: 'after',
                dryRun: true,
            });
            expect(result.diff).toContain('-before');
            expect(result.diff).toContain('+after');
            expect(result.written).toBe(false);
            expect(fs.readFileSync(path.join(vault, 'Dry.md'), 'utf-8')).toBe('before');
        }
        finally {
            fs.rmSync(vault, { recursive: true, force: true });
        }
    });
    it('throws when replace is missing find or finds no matches', () => {
        const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'w-'));
        try {
            createNote(vault, 'Missing.md', 'body');
            expect(() => editNote(vault, 'Missing.md', { mode: 'replace', content: 'x' })).toThrow(/find/i);
            expect(() => editNote(vault, 'Missing.md', { mode: 'replace', find: 'absent', content: 'x' })).toThrow(/not found|no match/i);
        }
        finally {
            fs.rmSync(vault, { recursive: true, force: true });
        }
    });
});
//# sourceMappingURL=note-writer.test.js.map