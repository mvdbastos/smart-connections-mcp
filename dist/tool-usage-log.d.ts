/**
 * Opt-in usage log for deprecated tools.
 *
 * Entries are queued in memory (no I/O on the tool-call hot path) and only
 * written to disk when flush() is invoked from the sync scheduler's idle
 * window, or flushSync() at shutdown.
 */
export declare class UsageLog {
    private filePath;
    private queue;
    constructor(filePath: string);
    record(tool: string, argsSummary: Record<string, unknown>): void;
    pendingCount(): number;
    flush(): Promise<void>;
    flushSync(): void;
    private drain;
}
//# sourceMappingURL=tool-usage-log.d.ts.map