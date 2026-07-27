// TaylorAI/bge-micro-v2's tokenizer_config.json ships model_max_length as the
// HF placeholder (~1e15), so the pipeline's own `truncation: true` is a no-op.
// The underlying BERT model still hard-caps at 512 position embeddings, so
// anything longer crashes onnxruntime instead of truncating. We truncate to
// token ids ourselves and decode back to text; 500 (not 512) leaves headroom
// for the [CLS]/[SEP] tokens the pipeline's own re-tokenization adds back.
const MAX_EMBED_TOKENS = 500;
export class Embedder {
    pipe = null;
    available = false;
    async tryInit() {
        if (this.available) {
            return true;
        }
        try {
            const { pipeline } = await import('@huggingface/transformers');
            this.pipe = (await pipeline('feature-extraction', 'TaylorAI/bge-micro-v2'));
            this.available = true;
        }
        catch {
            this.pipe = null;
            this.available = false;
        }
        return this.available;
    }
    isAvailable() {
        return this.available;
    }
    async embed(text) {
        if (!this.available || !this.pipe) {
            throw new Error('Embedder unavailable');
        }
        const truncated = this.truncateToTokenLimit(text);
        const out = await this.pipe(truncated, { pooling: 'mean', normalize: true });
        return Array.from(out.data);
    }
    truncateToTokenLimit(text) {
        const tokenizer = this.pipe.tokenizer;
        const encoded = tokenizer(text, { truncation: true, max_length: MAX_EMBED_TOKENS });
        const ids = Array.from(encoded.input_ids.data, Number);
        return tokenizer.decode(ids, { skip_special_tokens: true });
    }
}
//# sourceMappingURL=embedder.js.map