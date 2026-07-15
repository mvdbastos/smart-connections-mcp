import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SmartConnectionsLoader } from './smart-connections-loader.js';
function source(notePath) {
    return {
        path: notePath,
        embeddings: {
            model: {
                vec: [1, 0],
                last_embed: { hash: 'h', tokens: 1 },
            },
        },
        last_read: { hash: 'h', at: 0 },
        class_name: 'SmartSource',
        last_import: { mtime: 0, size: 0, at: 0, hash: 'h' },
        blocks: {},
    };
}
function createVaultWithSources(notePaths) {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-'));
    fs.mkdirSync(path.join(vault, '.smart-env', 'multi'), { recursive: true });
    fs.writeFileSync(path.join(vault, '.smart-env', 'smart_env.json'), JSON.stringify({
        smart_sources: {
            embed_model: {
                adapter: 'transformers',
                transformers: { model_key: 'model' },
            },
        },
    }));
    const lines = notePaths.map((notePath) => {
        fs.mkdirSync(path.dirname(path.join(vault, notePath)), { recursive: true });
        fs.writeFileSync(path.join(vault, notePath), `# ${notePath}`);
        return `${JSON.stringify(`smart_sources:${notePath}`)}: ${JSON.stringify(source(notePath))},`;
    });
    fs.writeFileSync(path.join(vault, '.smart-env', 'multi', 'sources.ajson'), `${lines.join('\n')}\n`);
    return vault;
}
describe('SmartConnectionsLoader resolveNotePath', () => {
    it('returns canonical paths for exact, missing extension, case-insensitive path, and basename matches', async () => {
        const vault = createVaultWithSources(['Note.md', 'Folder/Cased Note.md', 'Deep/Title.md']);
        try {
            const loader = new SmartConnectionsLoader(vault);
            await loader.initialize();
            expect(loader.resolveNotePath('Note.md')).toBe('Note.md');
            expect(loader.resolveNotePath('Note')).toBe('Note.md');
            expect(loader.resolveNotePath('folder/cased note.md')).toBe('Folder/Cased Note.md');
            expect(loader.resolveNotePath('title')).toBe('Deep/Title.md');
        }
        finally {
            fs.rmSync(vault, { recursive: true, force: true });
        }
    });
    it('throws an ambiguous error when basename matches multiple notes', async () => {
        const vault = createVaultWithSources(['A/Dupe.md', 'B/Dupe.md']);
        try {
            const loader = new SmartConnectionsLoader(vault);
            await loader.initialize();
            expect(() => loader.resolveNotePath('dupe')).toThrow(/ambiguous/i);
        }
        finally {
            fs.rmSync(vault, { recursive: true, force: true });
        }
    });
    it('throws a not-found error with a closest suggestion', async () => {
        const vault = createVaultWithSources(['Project Plan.md']);
        try {
            const loader = new SmartConnectionsLoader(vault);
            await loader.initialize();
            expect(() => loader.resolveNotePath('Project Pla')).toThrow(/not found/i);
            expect(() => loader.resolveNotePath('Project Pla')).toThrow(/Project Plan\.md/);
        }
        finally {
            fs.rmSync(vault, { recursive: true, force: true });
        }
    });
    it('readNoteContent falls back to exact disk paths for unindexed files', async () => {
        const vault = createVaultWithSources(['Indexed.md']);
        fs.writeFileSync(path.join(vault, 'Unindexed.md'), 'unindexed body');
        try {
            const loader = new SmartConnectionsLoader(vault);
            await loader.initialize();
            expect(loader.readNoteContent('Unindexed.md')).toBe('unindexed body');
        }
        finally {
            fs.rmSync(vault, { recursive: true, force: true });
        }
    });
});
//# sourceMappingURL=smart-connections-loader.test.js.map