/**
 * Loader for Smart Connections data from .smart-env directory
 */
import type { SmartSource, SmartEnvConfig } from './types.js';
/**
 * Outcome of the last reconcile pass, so callers can surface it long after
 * initialize() returned.
 */
export interface IndexHealth {
    /** Entries in the index at reconcile time. */
    indexed: number;
    /** Entries with no file on disk. */
    missing: number;
    /** Entries actually removed. Zero when refused. */
    dropped: number;
    /** True when the guard declined to reconcile. */
    refused: boolean;
    /** First MISSING_SAMPLE_LIMIT missing paths, for diagnosis. */
    missingSample: string[];
}
export declare class SmartConnectionsLoader {
    private vaultPath;
    private smartEnvPath;
    private config;
    private sources;
    private indexHealth;
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
     * before anything is deleted. The check is exactly-100%-missing rather than
     * a ratio. A ratio is a one-way trap -- staleness only ever increases, so
     * the entries that would bring the ratio back under threshold are the ones
     * the guard refuses to drop, and the only call site is initialize().
     *
     * There is deliberately no vault-exists or non-empty check here. initialize()
     * throws at :25, :45, and :59 before this runs, so <vault>/.smart-env/multi/
     * provably exists by now; such a check could never be false.
     *
     * This mutates the in-memory Map only. The .ajson files are never rewritten,
     * so a wrong decision here costs one process lifetime and no more.
     */
    reconcileWithFilesystem(): number;
    /**
     * Snapshot of the last reconcile pass. Returns a copy so callers cannot
     * mutate loader state through it.
     */
    getIndexHealth(): IndexHealth;
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