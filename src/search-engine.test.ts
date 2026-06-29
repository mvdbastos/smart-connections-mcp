import { describe, it, expect } from 'vitest';
import { SearchEngine } from './search-engine.js';
import type { SmartSource } from './types.js';

function source(notePath: string, vec: number[], blocks: SmartSource['blocks'] = {}): SmartSource {
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
    const sources = new Map<string, SmartSource>([
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
    const engine = new SearchEngine(loader as never);
    engine.setEmbedder(embedder as never);

    const results = await engine.searchByQuery('meaningful concept', 2, 0.5);

    expect(results.map((result) => result.path)).toEqual(['close.md']);
  });

  it('falls back to keyword search when no embedder is available', async () => {
    const sources = new Map<string, SmartSource>([
      ['match.md', source('match.md', [0])],
      ['miss.md', source('miss.md', [0])],
    ]);
    const loader = {
      getEmbeddingModelKey: () => 'model',
      getSources: () => sources,
      readNoteContent: (notePath: string) => (notePath === 'match.md' ? 'alpha alpha' : 'beta'),
    };
    const engine = new SearchEngine(loader as never);

    const results = await engine.searchByQuery('alpha', 10, 0.1);

    expect(results).toHaveLength(1);
    expect(results[0].path).toBe('match.md');
  });
});
