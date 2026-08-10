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
     *
     * In 'write' mode the result must have a real file behind it, and basename
     * guessing is disabled: silently resolving "Foo" to "Archive/2019/Foo.md"
     * is a convenience for a read and a loaded gun for an overwrite. Declined
     * candidates are still offered as suggestions in the error.
     */
    resolveNotePath(notePath: string, mode?: 'read' | 'write'): string;
    private closestSourcePaths;
    private levenshtein;
    /**
     * Add or replace a source in the in-memory source map.
     */
    upsertSource(source: SmartSource): void;
    /**
     * Remove a source from the in-memory map. The counterpart to upsertSource;
     * without it a deleted note's key survives for the process lifetime and
     * later resolves as if the note still existed.
     */
    removeSource(notePath: string): boolean;
    /**
     * Drop indexed entries with no file behind them.
     *
     * Two-phase on purpose: the missing set is collected first, then checked
     * against the total before anything is deleted. If more than half the index
     * is missing, that is a systemic fault -- a wrong vault path, an unmounted
     * drive -- not staleness, and silently emptying the index would degrade the
     * server to "no notes exist" with no error raised.
     */
    reconcileWithFilesystem(): number;
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