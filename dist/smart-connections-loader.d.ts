/**
 * Loader for Smart Connections data from .smart-env directory
 */
import type { SmartSource, SmartEnvConfig } from './types.js';
export declare class SmartConnectionsLoader {
    private vaultPath;
    private smartEnvPath;
    private config;
    private sources;
    constructor(vaultPath: string);
    /**
     * Initialize and load all Smart Connections data
     */
    initialize(): Promise<void>;
    /**
     * Load smart_env.json configuration
     */
    private loadConfig;
    /**
     * Load all .ajson files from the multi directory
     */
    private loadSources;
    /**
     * Get all sources
     */
    getSources(): Map<string, SmartSource>;
    /**
     * Get a specific source by path
     */
    getSource(notePath: string): SmartSource | undefined;
    /**
     * Resolve a caller-provided note path to the canonical indexed source path.
     */
    resolveNotePath(notePath: string): string;
    private closestSourcePaths;
    private levenshtein;
    /**
     * Add or replace a source in the in-memory source map.
     */
    upsertSource(source: SmartSource): void;
    /**
     * Get configuration
     */
    getConfig(): SmartEnvConfig | null;
    /**
     * Get the embedding model key from config
     */
    getEmbeddingModelKey(): string;
    /**
     * Get vault path
     */
    getVaultPath(): string;
    /**
     * Read the actual markdown content of a note
     */
    readNoteContent(notePath: string): string;
    /**
     * Extract content for specific blocks/sections
     */
    extractBlockContent(notePath: string, blockHeading: string): string;
}
//# sourceMappingURL=smart-connections-loader.d.ts.map