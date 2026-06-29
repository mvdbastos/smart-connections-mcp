import { describe, it, expect } from 'vitest';
import { appendSourceVector } from './ajson-writer.js';
import { SmartConnectionsLoader } from './smart-connections-loader.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('appendSourceVector', () => {
  it('appends a source vector adopted by loader', async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'));

    try {
      fs.mkdirSync(path.join(vault, '.smart-env', 'multi'), { recursive: true });
      fs.writeFileSync(
        path.join(vault, '.smart-env', 'smart_env.json'),
        JSON.stringify({
          smart_sources: {
            embed_model: {
              adapter: 'transformers',
              transformers: { model_key: 'TaylorAI/bge-micro-v2' },
            },
          },
        })
      );
      fs.writeFileSync(path.join(vault, 'A.md'), 'hi');

      appendSourceVector(vault, 'A.md', new Array(384).fill(0.1), 'TaylorAI/bge-micro-v2', 'h1', 2);

      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      expect(loader.getSource('A.md')).toBeTruthy();
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });
});
