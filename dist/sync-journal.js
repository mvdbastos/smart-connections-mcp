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
import * as fs from 'fs';
import * as path from 'path';
function emptyState() {
    return { pending: [], quarantined: [] };
}
export class SyncJournal {
    journalPath;
    constructor(journalPath) {
        this.journalPath = journalPath;
    }
    read() {
        try {
            if (!fs.existsSync(this.journalPath)) {
                return emptyState();
            }
            const raw = JSON.parse(fs.readFileSync(this.journalPath, 'utf-8'));
            if (typeof raw !== 'object' || raw === null) {
                return emptyState();
            }
            const record = raw;
            const pending = Array.isArray(record.pending)
                ? record.pending.filter((value) => typeof value === 'string')
                : [];
            const quarantined = Array.isArray(record.quarantined)
                ? record.quarantined
                    .filter((value) => typeof value === 'object' && value !== null && typeof value.path === 'string')
                    .map((value) => ({
                    path: String(value.path),
                    error: typeof value.error === 'string' ? value.error : 'unknown error',
                    since: typeof value.since === 'string' ? value.since : new Date().toISOString(),
                    survivedRestart: value.survivedRestart === true,
                }))
                : [];
            return { pending, quarantined };
        }
        catch {
            // A truncated or malformed journal is not worth failing startup over.
            return emptyState();
        }
    }
    /** Always writes the complete current state. There is no partial update. */
    write(state) {
        try {
            if (state.pending.length === 0 && state.quarantined.length === 0) {
                if (fs.existsSync(this.journalPath)) {
                    fs.rmSync(this.journalPath);
                }
                return;
            }
            fs.mkdirSync(path.dirname(this.journalPath), { recursive: true });
            fs.writeFileSync(this.journalPath, JSON.stringify({
                version: 1,
                updatedAt: new Date().toISOString(),
                pending: state.pending,
                quarantined: state.quarantined,
            }, null, 2), 'utf-8');
        }
        catch (error) {
            console.error(`Sync journal write failed (continuing without durability): ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
//# sourceMappingURL=sync-journal.js.map