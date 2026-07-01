import { describe, it, expect } from 'vitest';
import { SearchEngine } from './search-engine.js';
function source(notePath, vec, blocks = {}) {
    return {
        path: notePath,
        embeddings: {
            model: {
                vec,
                last_embed: { hash: 'h', tokens: 1 },
            },
        },
        last_read: { hash: 'h', at: 0 },
        class_name: 'SmartSource',
        last_import: { mtime: 0, size: 0, at: 0, hash: 'h' },
        blocks,
    };
}
describe('SearchEngine searchByQuery', () => {
    it('uses an available embedder for semantic search', async () => {
        const sources = new Map([
            ['close.md', source('close.md', [1, 0])],
            ['far.md', source('far.md', [0, 1])],
        ]);
        const loader = {
            getEmbeddingModelKey: () => 'model',
            getSources: () => sources,
            readNoteContent: () => '',
        };
        const embedder = {
            isAvailable: () => true,
            embed: async () => [1, 0],
        };
        const engine = new SearchEngine(loader);
        engine.setEmbedder(embedder);
        const results = await engine.searchByQuery('meaningful concept', 2, 0.5);
        expect(results.map((result) => result.path)).toEqual(['close.md']);
    });
    it('falls back to keyword search when no embedder is available', async () => {
        const sources = new Map([
            ['match.md', source('match.md', [0])],
            ['miss.md', source('miss.md', [0])],
        ]);
        const loader = {
            getEmbeddingModelKey: () => 'model',
            getSources: () => sources,
            readNoteContent: (notePath) => (notePath === 'match.md' ? 'alpha alpha' : 'beta'),
        };
        const engine = new SearchEngine(loader);
        const results = await engine.searchByQuery('alpha', 10, 0.1);
        expect(results).toHaveLength(1);
        expect(results[0].path).toBe('match.md');
    });
    it('returns a keyword match at the default threshold', async () => {
        const sources = new Map([
            ['match.md', source('match.md', [0])],
            ['miss.md', source('miss.md', [0])],
        ]);
        const loader = {
            getEmbeddingModelKey: () => 'model',
            getSources: () => sources,
            readNoteContent: (notePath) => (notePath === 'match.md' ? 'alpha' : 'beta'),
        };
        const engine = new SearchEngine(loader);
        const results = await engine.searchByQuery('alpha');
        expect(results.map((result) => result.path)).toEqual(['match.md']);
    });
    it('falls back to keyword search when semantic search finds no results', async () => {
        const sources = new Map([
            ['match.md', source('match.md', [0, 1])],
            ['miss.md', source('miss.md', [0, 1])],
        ]);
        const loader = {
            getEmbeddingModelKey: () => 'model',
            getSources: () => sources,
            readNoteContent: (notePath) => (notePath === 'match.md' ? 'alpha' : 'beta'),
        };
        const embedder = {
            isAvailable: () => true,
            embed: async () => [1, 0],
        };
        const engine = new SearchEngine(loader);
        engine.setEmbedder(embedder);
        const results = await engine.searchByQuery('alpha');
        expect(results.map((result) => result.path)).toEqual(['match.md']);
    });
    it('matches query tokens against note path and content instead of requiring one exact phrase', async () => {
        const sources = new Map([
            ['Docker Desktop WSL2 Logon Failure Fix.md', source('Docker Desktop WSL2 Logon Failure Fix.md', [0])],
            ['Other.md', source('Other.md', [0])],
        ]);
        const loader = {
            getEmbeddingModelKey: () => 'model',
            getSources: () => sources,
            readNoteContent: (notePath) => notePath === 'Docker Desktop WSL2 Logon Failure Fix.md'
                ? '# Docker Desktop WSL2 Logon Failure - Troubleshooting & Fix\nbody'
                : 'unrelated content',
        };
        const engine = new SearchEngine(loader);
        const results = await engine.searchByQuery('Docker Desktop WSL2 Logon Failure Fix');
        expect(results.map((result) => result.path)).toEqual(['Docker Desktop WSL2 Logon Failure Fix.md']);
    });
});
//# sourceMappingURL=search-engine.test.js.map