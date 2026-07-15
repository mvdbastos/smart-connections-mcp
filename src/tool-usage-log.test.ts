import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UsageLog } from './tool-usage-log.js';

function tempLogPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-'));
  return path.join(dir, 'logs', 'mcp-tool-usage.log');
}

describe('UsageLog', () => {
  it('record queues in memory without touching disk', () => {
    const logPath = tempLogPath();
    const log = new UsageLog(logPath);

    log.record('edit_note', { note_path: 'A.md', mode: 'append' });

    expect(log.pendingCount()).toBe(1);
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it('flush appends JSONL entries and empties the queue', async () => {
    const logPath = tempLogPath();
    const log = new UsageLog(logPath);

    log.record('edit_note', { note_path: 'A.md' });
    log.record('git_push_notes', {});
    await log.flush();

    expect(log.pendingCount()).toBe(0);
    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first.tool).toBe('edit_note');
    expect(first.args).toEqual({ note_path: 'A.md' });
    expect(typeof first.timestamp).toBe('string');
  });

  it('flush with an empty queue creates no file', async () => {
    const logPath = tempLogPath();
    const log = new UsageLog(logPath);

    await log.flush();

    expect(fs.existsSync(logPath)).toBe(false);
  });

  it('flushSync writes synchronously', () => {
    const logPath = tempLogPath();
    const log = new UsageLog(logPath);

    log.record('delete_note', { note_path: 'B.md' });
    log.flushSync();

    expect(fs.readFileSync(logPath, 'utf-8')).toContain('delete_note');
    expect(log.pendingCount()).toBe(0);
  });

  it('appends across multiple flushes', async () => {
    const logPath = tempLogPath();
    const log = new UsageLog(logPath);

    log.record('create_note', { note_path: 'C.md' });
    await log.flush();
    log.record('create_note', { note_path: 'D.md' });
    await log.flush();

    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
  });
});
