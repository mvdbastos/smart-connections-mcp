export class Embedder {
  private pipe: ((text: string, options: { pooling: 'mean'; normalize: boolean }) => Promise<{ data: Float32Array | number[] }>) | null = null;
  private available = false;

  async tryInit(): Promise<boolean> {
    if (this.available) {
      return true;
    }

    try {
      const { pipeline } = await import('@huggingface/transformers');
      this.pipe = await pipeline('feature-extraction', 'TaylorAI/bge-micro-v2');
      this.available = true;
    } catch {
      this.pipe = null;
      this.available = false;
    }

    return this.available;
  }

  isAvailable(): boolean {
    return this.available;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.available || !this.pipe) {
      throw new Error('Embedder unavailable');
    }

    const out = await this.pipe(text, { pooling: 'mean', normalize: true });
    return Array.from(out.data);
  }
}
