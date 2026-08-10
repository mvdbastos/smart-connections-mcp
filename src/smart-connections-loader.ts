/**
 * Loader for Smart Connections data from .smart-env directory
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SmartSource, SmartEnvConfig } from './types.js';

export class SmartConnectionsLoader {
  private vaultPath: string;
  private smartEnvPath: string;
  private config: SmartEnvConfig | null = null;
  private sources: Map<string, SmartSource> = new Map();

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
    this.smartEnvPath = path.join(vaultPath, '.smart-env');
  }

  /**
   * Initialize and load all Smart Connections data
   */
  async initialize(): Promise<void> {
    // Check if .smart-env exists
    if (!fs.existsSync(this.smartEnvPath)) {
      throw new Error(`Smart Connections directory not found at: ${this.smartEnvPath}`);
    }

    // Load configuration
    await this.loadConfig();

    // Load all sources
    await this.loadSources();

    // Drop entries for notes that no longer exist on disk
    this.reconcileWithFilesystem();
  }

  /**
   * Load smart_env.json configuration
   */
  private async loadConfig(): Promise<void> {
    const configPath = path.join(this.smartEnvPath, 'smart_env.json');

    if (!fs.existsSync(configPath)) {
      throw new Error(`Configuration file not found at: ${configPath}`);
    }

    const configData = fs.readFileSync(configPath, 'utf-8');
    this.config = JSON.parse(configData);
  }

  /**
   * Load all .ajson files from the multi directory
   */
  private async loadSources(): Promise<void> {
    const multiPath = path.join(this.smartEnvPath, 'multi');

    if (!fs.existsSync(multiPath)) {
      throw new Error(`Multi directory not found at: ${multiPath}`);
    }

    const files = fs.readdirSync(multiPath);
    const ajsonFiles = files.filter(f => f.endsWith('.ajson'));

    console.error(`Loading ${ajsonFiles.length} source files...`);

    for (const file of ajsonFiles) {
      try {
        const filePath = path.join(multiPath, file);
        const content = fs.readFileSync(filePath, 'utf-8');

        // Parse the AJSON format (JSONL - one JSON object per line)
        // Each line is a single object like: "key": {...}
        const lines = content.trim().split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            // Each line is formatted as: "key1": {...}, "key2": {...}, "key3": {...},
            // Remove trailing comma and wrap with curly braces to make valid JSON
            const cleanedLine = line.replace(/,\s*$/, '');
            const obj = JSON.parse(`{${cleanedLine}}`);

            // Process all key-value pairs in the object
            for (const key of Object.keys(obj)) {
              // Only process smart_sources entries (not smart_blocks)
              if (key.startsWith('smart_sources:')) {
                const sourceData: SmartSource = obj[key];
                // Skip entries with null/undefined paths
                if (sourceData && sourceData.path) {
                  this.sources.set(sourceData.path, sourceData);
                }
              }
            }
          } catch (parseError) {
            // Skip lines that can't be parsed
            console.error(`Parse error in ${file}:`, parseError);
          }
        }
      } catch (error) {
        console.error(`Error loading ${file}:`, error);
      }
    }

    console.error(`Loaded ${this.sources.size} sources successfully`);
  }

  /**
   * Get all sources
   */
  getSources(): Map<string, SmartSource> {
    return this.sources;
  }

  /**
   * Get a specific source by path
   */
  getSource(notePath: string): SmartSource | undefined {
    try {
      const resolvedPath = this.resolveNotePath(notePath);
      return this.sources.get(resolvedPath);
    } catch {
      return undefined;
    }
  }

  /**
   * Resolve a caller-provided note path to the canonical indexed source path.
   *
   * In 'write' mode the result must have a real file behind it, and basename
   * guessing is disabled: silently resolving "Foo" to "Archive/2019/Foo.md"
   * is a convenience for a read and a loaded gun for an overwrite. Declined
   * candidates are still offered as suggestions in the error.
   */
  resolveNotePath(notePath: string, mode: 'read' | 'write' = 'read'): string {
    const exists = (candidate: string): boolean =>
      fs.existsSync(path.join(this.vaultPath, candidate));

    const accept = (candidate: string): string | null => {
      if (mode === 'write' && !exists(candidate)) {
        return null;
      }
      return candidate;
    };

    if (this.sources.has(notePath)) {
      const accepted = accept(notePath);
      if (accepted) {
        return accepted;
      }
    }

    if (!notePath.toLowerCase().endsWith('.md')) {
      const withExtension = `${notePath}.md`;
      if (this.sources.has(withExtension)) {
        const accepted = accept(withExtension);
        if (accepted) {
          return accepted;
        }
      }
    }

    const requestedLower = notePath.toLowerCase();
    for (const sourcePath of Array.from(this.sources.keys())) {
      if (sourcePath.toLowerCase() === requestedLower) {
        const accepted = accept(sourcePath);
        if (accepted) {
          return accepted;
        }
      }
    }

    const requestedBasename = path.basename(notePath, path.extname(notePath)).toLowerCase();
    const basenameMatches = Array.from(this.sources.keys()).filter((sourcePath) => {
      return path.basename(sourcePath, path.extname(sourcePath)).toLowerCase() === requestedBasename;
    });

    if (mode === 'read') {
      if (basenameMatches.length === 1) {
        return basenameMatches[0];
      }

      if (basenameMatches.length > 1) {
        throw new Error(`Ambiguous note "${notePath}". Candidates: ${basenameMatches.slice(0, 10).join(', ')}`);
      }

      const suggestions = this.closestSourcePaths(notePath, 3);
      const suggestionText = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : '';
      throw new Error(`Note not found: "${notePath}".${suggestionText}`);
    }

    const candidates = basenameMatches.length > 0 ? basenameMatches : this.closestSourcePaths(notePath, 3);
    const suggestionText = candidates.length > 0 ? ` Did you mean: ${candidates.slice(0, 3).join(', ')}?` : '';

    throw new Error(
      `Note not found: "${notePath}".${suggestionText} ` +
        'Pass the full path to edit an existing note, or use action=create to create a new one.'
    );
  }

  private closestSourcePaths(notePath: string, limit: number): string[] {
    const normalizedInput = notePath.toLowerCase();

    return Array.from(this.sources.keys())
      .map((sourcePath) => ({
        sourcePath,
        distance: this.levenshtein(normalizedInput, sourcePath.toLowerCase()),
      }))
      .sort((a, b) => a.distance - b.distance || a.sourcePath.localeCompare(b.sourcePath))
      .slice(0, limit)
      .map(({ sourcePath }) => sourcePath);
  }

  private levenshtein(left: string, right: string): number {
    const rows = left.length + 1;
    const columns = right.length + 1;
    const distances = Array.from({ length: rows }, () => new Array<number>(columns).fill(0));

    for (let row = 0; row < rows; row += 1) {
      distances[row][0] = row;
    }

    for (let column = 0; column < columns; column += 1) {
      distances[0][column] = column;
    }

    for (let row = 1; row < rows; row += 1) {
      for (let column = 1; column < columns; column += 1) {
        const cost = left[row - 1] === right[column - 1] ? 0 : 1;
        distances[row][column] = Math.min(
          distances[row - 1][column] + 1,
          distances[row][column - 1] + 1,
          distances[row - 1][column - 1] + cost
        );
      }
    }

    return distances[left.length][right.length];
  }

  /**
   * Add or replace a source in the in-memory source map.
   */
  upsertSource(source: SmartSource): void {
    if (source && source.path) {
      this.sources.set(source.path, source);
    }
  }

  /**
   * Remove a source from the in-memory map. The counterpart to upsertSource;
   * without it a deleted note's key survives for the process lifetime and
   * later resolves as if the note still existed.
   */
  removeSource(notePath: string): boolean {
    return this.sources.delete(notePath);
  }

  /**
   * Drop indexed entries with no file behind them.
   *
   * Two-phase on purpose: the missing set is collected first, then checked
   * against the total before anything is deleted. If more than half the index
   * is missing, that is a systemic fault -- a wrong vault path, an unmounted
   * drive -- not staleness, and silently emptying the index would degrade the
   * server to "no notes exist" with no error raised.
   */
  reconcileWithFilesystem(): number {
    const missing: string[] = [];

    for (const notePath of this.sources.keys()) {
      if (!fs.existsSync(path.join(this.vaultPath, notePath))) {
        missing.push(notePath);
      }
    }

    if (missing.length === 0) {
      return 0;
    }

    if (missing.length > this.sources.size / 2) {
      console.error(
        `Refusing to reconcile: ${missing.length} of ${this.sources.size} indexed notes are missing from ${this.vaultPath}. ` +
          'This looks like a wrong vault path or an unavailable drive rather than stale index entries. Index left intact.'
      );
      return 0;
    }

    for (const notePath of missing) {
      this.sources.delete(notePath);
    }

    console.error(`Dropped ${missing.length} stale index entries with no file on disk`);
    return missing.length;
  }

  /**
   * Get configuration
   */
  getConfig(): SmartEnvConfig | null {
    return this.config;
  }

  /**
   * Get the embedding model key from config
   */
  getEmbeddingModelKey(): string {
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }

    // Extract the model key from the embed_model configuration
    const embedModel = this.config.smart_sources.embed_model;
    const adapter = embedModel.adapter;

    // The actual model key is nested in the adapter configuration
    // e.g., embed_model.transformers.model_key = "TaylorAI/bge-micro-v2"
    if (adapter && embedModel[adapter] && typeof embedModel[adapter] === 'object') {
      const adapterConfig = embedModel[adapter] as any;
      if (adapterConfig.model_key) {
        return adapterConfig.model_key;
      }
    }

    // Fallback: find first object key that's not 'adapter'
    const modelKeys = Object.keys(embedModel).filter(k => k !== 'adapter' && typeof embedModel[k] === 'object');

    if (modelKeys.length === 0) {
      throw new Error('No embedding model found in configuration');
    }

    return modelKeys[0];
  }

  /**
   * Get vault path
   */
  getVaultPath(): string {
    return this.vaultPath;
  }

  /**
   * Read the actual markdown content of a note
   */
  readNoteContent(notePath: string): string {
    let resolvedPath = notePath;

    try {
      resolvedPath = this.resolveNotePath(notePath);
    } catch (error) {
      const exactPath = path.join(this.vaultPath, notePath);
      if (fs.existsSync(exactPath)) {
        return fs.readFileSync(exactPath, 'utf-8');
      }

      throw error;
    }

    const fullPath = path.join(this.vaultPath, resolvedPath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`Note not found at: ${fullPath}`);
    }

    return fs.readFileSync(fullPath, 'utf-8');
  }

  /**
   * Extract content for specific blocks/sections
   */
  extractBlockContent(notePath: string, blockHeading: string): string {
    const content = this.readNoteContent(notePath);
    const source = this.getSource(notePath);

    if (!source || !source.blocks[blockHeading]) {
      return '';
    }

    const [startLine, endLine] = source.blocks[blockHeading];
    const lines = content.split('\n');

    return lines.slice(startLine - 1, endLine).join('\n');
  }
}
