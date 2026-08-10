/**
 * Durable record of which vault paths are waiting to be committed.
 *
 * The scheduler holds its dirty set in memory behind unref'd timers, so a
 * SIGKILL, crash, or power loss would otherwise discard it: the files are
 * written to the vault but never committed, and nothing retries them. This
 * journal is what makes that state recoverable.
 *
 * Every filesystem call here is fail-soft. A journal error must never break a
 * note write -- losing durability is bad, losing the write is worse.
 */
export interface QuarantineEntry {
    path: string;
    error: string;
    /** ISO 8601 timestamp of when this path was first quarantined. */
    since: string;
    /** True once this path has been quarantined in more than one session. */
    survivedRestart: boolean;
}
export interface JournalState {
    pending: string[];
    quarantined: QuarantineEntry[];
}
export declare class SyncJournal {
    private journalPath;
    constructor(journalPath: string);
    read(): JournalState;
    /** Always writes the complete current state. There is no partial update. */
    write(state: JournalState): void;
}
//# sourceMappingURL=sync-journal.d.ts.map