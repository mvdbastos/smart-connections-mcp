export class Embedder {
    pipe = null;
    available = false;
    async tryInit() {
        if (this.available) {
            return true;
        }
        try {
            const { pipeline } = await import('@huggingface/transformers');
            this.pipe = await pipeline('feature-extraction', 'TaylorAI/bge-micro-v2');
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
        const out = await this.pipe(text, { pooling: 'mean', normalize: true });
        return Array.from(out.data);
    }
}
//# sourceMappingURL=embedder.js.map