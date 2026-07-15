import { describe, it, expect } from 'vitest';
import { Embedder } from './embedder.js';

describe('Embedder', () => {
  it('produces a 384-dim vector or reports unavailable', async () => {
    const e = new Embedder();
    const ok = await e.tryInit();
    if (!ok) {
      expect(e.isAvailable()).toBe(false);
      return;
    }

    const vec = await e.embed('hello world');
    expect(vec.length).toBe(384);
  }, 30_000);
});
