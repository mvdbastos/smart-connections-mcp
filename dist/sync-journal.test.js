import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SyncJournal } from './sync-journal.js';
function tempJournal() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-'));
    return { dir, file: path.join(dir, 'nested', 'pending.json') };
}
describe('SyncJournal', () => {
    it('round-trips pending paths and quarantine entries', () => {
        const { dir, file } = tempJournal();
        try {
            const journal = new SyncJournal(file);
            journal.write({
                pending: ['A.md', 'B.md'],
                quarantined: [
                    { path: 'Ghost.md', error: 'boom', since: '2026-08-07T10:00:00.000Z', survivedRestart: false },
                ],
            });
            const read = new SyncJournal(file).read();
            expect(read.pending).toEqual(['A.md', 'B.md']);
            expect(read.quarantined).toHaveLength(1);
            expect(read.quarantined[0].path).toBe('Ghost.md');
            expect(read.quarantined[0].survivedRestart).toBe(false);
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    it('creates parent directories on write', () => {
        const { dir, file } = tempJournal();
        try {
            new SyncJournal(file).write({ pending: ['A.md'], quarantined: [] });
            expect(fs.existsSync(file)).toBe(true);
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    it('returns empty state when the file is absent', () => {
        const { dir, file } = tempJournal();
        try {
            expect(new SyncJournal(file).read()).toEqual({ pending: [], quarantined: [] });
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    it('returns empty state for a truncated or malformed file', () => {
        const { dir, file } = tempJournal();
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, '{"pending": ["A.md"');
            expect(new SyncJournal(file).read()).toEqual({ pending: [], quarantined: [] });
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    it('deletes the file when both lists are empty', () => {
        const { dir, file } = tempJournal();
        try {
            const journal = new SyncJournal(file);
            journal.write({ pending: ['A.md'], quarantined: [] });
            expect(fs.existsSync(file)).toBe(true);
            journal.write({ pending: [], quarantined: [] });
            expect(fs.existsSync(file)).toBe(false);
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    it('does not throw when the path is unwritable', () => {
        const journal = new SyncJournal(path.join(os.tmpdir(), 'journal-nul\u0000bad', 'pending.json'));
        expect(() => journal.write({ pending: ['A.md'], quarantined: [] })).not.toThrow();
    });
});
//# sourceMappingURL=sync-journal.test.js.map