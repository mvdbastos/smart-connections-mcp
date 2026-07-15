/**
 * Opt-in usage log for deprecated tools.
 *
 * Entries are queued in memory (no I/O on the tool-call hot path) and only
 * written to disk when flush() is invoked from the sync scheduler's idle
 * window, or flushSync() at shutdown.
 */
import * as fs from 'fs';
import * as path from 'path';
export class UsageLog {
    filePath;
    queue = [];
    constructor(filePath) {
        this.filePath = filePath;
    }
    record(tool, argsSummary) {
        this.queue.push(JSON.stringify({
            timestamp: new Date().toISOString(),
            tool,
            args: argsSummary,
        }));
    }
    pendingCount() {
        return this.queue.length;
    }
    async flush() {
        const lines = this.drain();
        if (!lines) {
            return;
        }
        try {
            await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
            await fs.promises.appendFile(this.filePath, lines, 'utf-8');
        }
        catch (error) {
            console.error('Usage log flush failed:', error);
        }
    }
    flushSync() {
        const lines = this.drain();
        if (!lines) {
            return;
        }
        try {
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
            fs.appendFileSync(this.filePath, lines, 'utf-8');
        }
        catch (error) {
            console.error('Usage log flush failed:', error);
        }
    }
    drain() {
        if (this.queue.length === 0) {
            return null;
        }
        return `${this.queue.splice(0).join('\n')}\n`;
    }
}
//# sourceMappingURL=tool-usage-log.js.map