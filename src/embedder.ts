// TaylorAI/bge-micro-v2's tokenizer_config.json ships model_max_length as the
// HF placeholder (~1e15), so the pipeline's own `truncation: true` is a no-op.
// The underlying BERT model still hard-caps at 512 position embeddings, so
// anything longer crashes onnxruntime instead of truncating. We truncate to
// token ids ourselves and decode back to text; 500 (not 512) leaves headroom
// for the [CLS]/[SEP] tokens the pipeline's own re-tokenization adds back.
const MAX_EMBED_TOKENS = 500;

interface Tokenizer {
  (text: string, options: { truncation: boolean; max_length: number }): {
    input_ids: { data: Iterable<number | bigint> };
  };
  decode(ids: number[], options: { skip_special_tokens: boolean }): string;
}

type EmbedPipeline = ((
  text: string,
  options: { pooling: 'mean'; normalize: boolean }
) => Promise<{ data: Float32Array | number[] }>) & { tokenizer: Tokenizer };

export class Embedder {
  private pipe: EmbedPipeline | null = null;
  private available = false;

  async tryInit(): Promise<boolean> {
    if (this.available) {
      return true;
    }

    try {
      const { pipeline } = await import('@huggingface/transformers');
      this.pipe = (await pipeline('feature-extraction', 'TaylorAI/bge-micro-v2')) as unknown as EmbedPipeline;
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

    const truncated = this.truncateToTokenLimit(text);
    const out = await this.pipe(truncated, { pooling: 'mean', normalize: true });
    return Array.from(out.data);
  }

  private truncateToTokenLimit(text: string): string {
    const tokenizer = this.pipe!.tokenizer;
    const encoded = tokenizer(text, { truncation: true, max_length: MAX_EMBED_TOKENS });
    const ids = Array.from(encoded.input_ids.data, Number);
    return tokenizer.decode(ids, { skip_special_tokens: true });
  }
}
