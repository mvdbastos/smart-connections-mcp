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
  private filePath: string;
  private queue: string[] = [];

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  record(tool: string, argsSummary: Record<string, unknown>): void {
    this.queue.push(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        tool,
        args: argsSummary,
      })
    );
  }

  pendingCount(): number {
    return this.queue.length;
  }

  async flush(): Promise<void> {
    const lines = this.drain();
    if (!lines) {
      return;
    }

    try {
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.promises.appendFile(this.filePath, lines, 'utf-8');
    } catch (error) {
      console.error('Usage log flush failed:', error);
    }
  }

  flushSync(): void {
    const lines = this.drain();
    if (!lines) {
      return;
    }

    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.appendFileSync(this.filePath, lines, 'utf-8');
    } catch (error) {
      console.error('Usage log flush failed:', error);
    }
  }

  private drain(): string | null {
    if (this.queue.length === 0) {
      return null;
    }

    return `${this.queue.splice(0).join('\n')}\n`;
  }
}
