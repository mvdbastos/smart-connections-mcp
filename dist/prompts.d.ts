export interface SearchResult {
    path: string;
    score: number;
}
export interface PromptContext {
    search: (query: string, limit: number, threshold: number) => Promise<SearchResult[]>;
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