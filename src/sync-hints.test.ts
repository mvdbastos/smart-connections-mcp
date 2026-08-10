import { describe, it, expect } from 'vitest';
import { buildRemediationHint, buildReportHint } from './sync-hints.js';

describe('sync escalation hints', () => {
  it('names the vault path and the error in the remediation hint', () => {
    const hint = buildRemediationHint('C:/obsidian/mb-kb', "cannot lock ref 'HEAD'");

    expect(hint).toContain('C:/obsidian/mb-kb');
    expect(hint).toContain("cannot lock ref 'HEAD'");
    expect(hint).toContain('git_commit_notes');
  });

  it('forbids destructive recovery in the remediation hint', () => {
    const hint = buildRemediationHint('C:/obsidian/mb-kb', 'boom');

    expect(hint).toContain('reset --hard');
    expect(hint).toMatch(/do not/i);
  });

  it('reports a count and never the paths', () => {
    const hint = buildReportHint('boom', ['Memory/pro-wms/Secret Client.md', 'Memory/private.md']);

    expect(hint).toContain('2');
    expect(hint).not.toContain('Secret Client');
    expect(hint).not.toContain('Memory/private.md');
    expect(hint).not.toContain('Memory/pro-wms');
  });

  it('tells the agent to search before opening a duplicate', () => {
    const hint = buildReportHint('boom', ['A.md']);

    expect(hint).toContain('gh issue list');
    expect(hint).toContain('mvdbastos/smart-connections-mcp');
  });
});
