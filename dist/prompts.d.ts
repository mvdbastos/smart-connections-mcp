export interface SearchResult {
    path: string;
    score: number;
}
export interface PromptContext {
    search: (query: string, limit: number, threshold: number) => Promise<SearchResult[]>;
    /**
     * Optional. Lists vault-relative note paths beginning with `prefix`.
     * Every returned path is verified to exist on disk, so results no longer
     * include notes that were moved or deleted. Freshly written notes may
     * still lag until reindex, so the listing can be incomplete — and
     * `metadata.vault_note` remains the only authoritative migration check.
     */
    listByPrefix?: (prefix: string) => Promise<string[]>;
}
export interface MemoryPromptArgument {
    name: string;
    type: 'string' | 'number' | 'boolean';
    required: boolean;
    description: string;
}
export interface MemoryPrompt {
    name: string;
    description: string;
    arguments: MemoryPromptArgument[];
    build: (args: Record<string, unknown>, ctx: PromptContext) => Promise<string>;
}
export declare const MEMORY_PROMPTS: MemoryPrompt[];
export declare const MEMORY_PROMPT_BY_NAME: Map<string, MemoryPrompt>;
//# sourceMappingURL=prompts.d.ts.map