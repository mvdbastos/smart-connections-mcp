import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SmartConnectionsLoader } from './smart-connections-loader.js';
import type { SmartSource } from './types.js';

function source(notePath: string): SmartSource {
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

function createVaultWithSources(notePaths: string[]): string {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-'));
  fs.mkdirSync(path.join(vault, '.smart-env', 'multi'), { recursive: true });
  fs.writeFileSync(
    path.join(vault, '.smart-env', 'smart_env.json'),
    JSON.stringify({
      smart_sources: {
        embed_model: {
          adapter: 'transformers',
          transformers: { model_key: 'model' },
        },
      },
    })
  );

  const lines = notePaths.map((notePath) => {
    fs.mkdirSync(path.dirname(path.join(vault, notePath)), { recursive: true });
    fs.writeFileSync(path.join(vault, notePath), `# ${notePath}`);
    return `${JSON.stringify(`smart_sources:${notePath}`)}: ${JSON.stringify(source(notePath))},`;
  });
  fs.writeFileSync(path.join(vault, '.smart-env', 'multi', 'sources.ajson'), `${lines.join('\n')}\n`);

  return vault;
}

/**
 * Builds a vault whose index lists `indexed` but whose disk holds only `onDisk`.
 * Used to simulate notes moved or deleted outside this server.
 */
function createVaultWithStaleSources(indexed: string[], onDisk: string[]): string {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'loader-stale-'));
  fs.mkdirSync(path.join(vault, '.smart-env', 'multi'), { recursive: true });
  fs.writeFileSync(
    path.join(vault, '.smart-env', 'smart_env.json'),
    JSON.stringify({
      smart_sources: {
        embed_model: {
          adapter: 'transformers',
          transformers: { model_key: 'model' },
        },
      },
    })
  );

  for (const notePath of onDisk) {
    fs.mkdirSync(path.dirname(path.join(vault, notePath)), { recursive: true });
    fs.writeFileSync(path.join(vault, notePath), `# ${notePath}`);
  }

  const lines = indexed.map(
    (notePath) => `${JSON.stringify(`smart_sources:${notePath}`)}: ${JSON.stringify(source(notePath))},`
  );
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
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('throws an ambiguous error when basename matches multiple notes', async () => {
    const vault = createVaultWithSources(['A/Dupe.md', 'B/Dupe.md']);

    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      expect(() => loader.resolveNotePath('dupe')).toThrow(/ambiguous/i);
    } finally {
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
    } finally {
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
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });
});

describe('index/filesystem reconciliation', () => {
  it('removeSource drops a key and reports whether it was present', async () => {
    const vault = createVaultWithSources(['A.md', 'B.md']);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      expect(loader.removeSource('A.md')).toBe(true);
      expect(loader.getSources().has('A.md')).toBe(false);
      expect(loader.removeSource('A.md')).toBe(false);
      expect(loader.getSources().has('B.md')).toBe(true);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('drops indexed entries whose file is missing', async () => {
    const vault = createVaultWithStaleSources(['A.md', 'gone/B.md', 'C.md'], ['A.md', 'C.md']);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      expect(loader.getSources().has('gone/B.md')).toBe(false);
      expect(loader.getSources().has('A.md')).toBe(true);
      expect(loader.getSources().has('C.md')).toBe(true);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('reconciles even when most files are missing', async () => {
    const vault = createVaultWithStaleSources(['A.md', 'B.md', 'C.md', 'D.md'], ['A.md']);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      expect(loader.getSources().size).toBe(1);
      expect(loader.getSources().has('A.md')).toBe(true);
      expect(loader.getIndexHealth().dropped).toBe(3);
      expect(loader.getIndexHealth().refused).toBe(false);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('still reconciles when just under half are missing', async () => {
    const vault = createVaultWithStaleSources(['A.md', 'B.md', 'C.md', 'D.md'], ['A.md', 'B.md', 'C.md']);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      expect(loader.getSources().size).toBe(3);
      expect(loader.getSources().has('D.md')).toBe(false);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('refuses when every indexed note is missing', async () => {
    const indexed = ['A.md', 'B.md', 'C.md', 'D.md', 'E.md', 'F.md'];
    const vault = createVaultWithStaleSources(indexed, []);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      expect(loader.getSources().size).toBe(6);

      const health = loader.getIndexHealth();
      expect(health.refused).toBe(true);
      expect(health.dropped).toBe(0);
      expect(health.indexed).toBe(6);
      expect(health.missing).toBe(6);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('reconciles when every note is missing but the index is tiny', async () => {
    const vault = createVaultWithStaleSources(['A.md', 'B.md', 'C.md', 'D.md'], []);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      expect(loader.getSources().size).toBe(0);
      expect(loader.getIndexHealth().refused).toBe(false);
      expect(loader.getIndexHealth().dropped).toBe(4);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('caps the missing sample at ten paths', async () => {
    const indexed = Array.from({ length: 12 }, (_, i) => `Note${i}.md`);
    const vault = createVaultWithStaleSources(indexed, []);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      const health = loader.getIndexHealth();
      expect(health.missing).toBe(12);
      expect(health.missingSample).toHaveLength(10);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('refuses exactly at the floor: five indexed, all missing', async () => {
    const vault = createVaultWithStaleSources(['A.md', 'B.md', 'C.md', 'D.md', 'E.md'], []);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      expect(loader.getSources().size).toBe(5);
      expect(loader.getIndexHealth().refused).toBe(true);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('reconciles at the reported ratio from issue #13', async () => {
    const indexed = Array.from({ length: 66 }, (_, i) => `Note${i}.md`);
    const onDisk = indexed.slice(0, 32);
    const vault = createVaultWithStaleSources(indexed, onDisk);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      expect(loader.getSources().size).toBe(32);
      expect(loader.getIndexHealth().dropped).toBe(34);
      expect(loader.getIndexHealth().refused).toBe(false);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('exposes a readable health snapshot before initialize runs', () => {
    const loader = new SmartConnectionsLoader('/nonexistent');

    expect(loader.getIndexHealth()).toEqual({
      indexed: 0,
      missing: 0,
      dropped: 0,
      refused: false,
      missingSample: [],
    });
  });

  it('getIndexHealth returns a copy that cannot mutate loader state', async () => {
    const indexed = ['A.md', 'B.md', 'C.md', 'D.md', 'E.md', 'F.md'];
    const vault = createVaultWithStaleSources(indexed, []);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      const health = loader.getIndexHealth();
      health.missingSample.push('injected.md');
      health.refused = false;

      expect(loader.getIndexHealth().missingSample).not.toContain('injected.md');
      expect(loader.getIndexHealth().refused).toBe(true);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });
});

describe('write-mode path resolution', () => {
  it('resolves a basename in read mode but refuses it in write mode', async () => {
    const vault = createVaultWithSources(['Archive/2019/Foo.md']);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      expect(loader.resolveNotePath('Foo')).toBe('Archive/2019/Foo.md');
      expect(() => loader.resolveNotePath('Foo', 'write')).toThrow(/not found/i);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('names the declined basename candidates in the write-mode error', async () => {
    const vault = createVaultWithSources(['Archive/2019/Foo.md']);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      expect(() => loader.resolveNotePath('Foo', 'write')).toThrow(/Archive\/2019\/Foo\.md/);
      expect(() => loader.resolveNotePath('Foo', 'write')).toThrow(/action=create/);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('accepts exact, .md-append and case-insensitive matches in write mode', async () => {
    const vault = createVaultWithSources(['Notes/Alpha.md']);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      expect(loader.resolveNotePath('Notes/Alpha.md', 'write')).toBe('Notes/Alpha.md');
      expect(loader.resolveNotePath('Notes/Alpha', 'write')).toBe('Notes/Alpha.md');
      expect(loader.resolveNotePath('notes/alpha.md', 'write')).toBe('Notes/Alpha.md');
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('refuses an indexed key whose file is missing', async () => {
    const vault = createVaultWithStaleSources(['A.md', 'B.md', 'C.md'], ['A.md', 'B.md']);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();
      // Re-add the stale key to simulate drift appearing after startup.
      loader.upsertSource(source('C.md'));

      expect(() => loader.resolveNotePath('C.md', 'write')).toThrow(/not found/i);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });
});
