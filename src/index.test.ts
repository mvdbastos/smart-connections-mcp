import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { EditNoteSchema, NoteWorkflowSchema, TOOL_KEYS, formatToolError } from './tool-schemas.js';
import { tools } from './tool-definitions.js';

describe('edit_note schema', () => {
  it('rejects replace mode without find and accepts valid replace', () => {
    expect(() =>
      EditNoteSchema.parse({
        note_path: 'Note.md',
        content: 'replacement',
        mode: 'replace',
      })
    ).toThrow(z.ZodError);

    expect(
      EditNoteSchema.parse({
        note_path: 'Note.md',
        content: 'replacement',
        mode: 'replace',
        find: 'target',
      })
    ).toMatchObject({ mode: 'replace', find: 'target' });
  });
});

describe('note_workflow schema', () => {
  it('requires content for create and edit but not delete', () => {
    expect(() => NoteWorkflowSchema.parse({ action: 'create', note_path: 'A.md' })).toThrow(z.ZodError);
    expect(() => NoteWorkflowSchema.parse({ action: 'edit', note_path: 'A.md' })).toThrow(z.ZodError);
    expect(NoteWorkflowSchema.parse({ action: 'delete', note_path: 'A.md' })).toMatchObject({
      action: 'delete',
    });
  });

  it('enforces edit-mode invariants', () => {
    expect(() =>
      NoteWorkflowSchema.parse({ action: 'edit', note_path: 'A.md', content: 'x', mode: 'replace' })
    ).toThrow(z.ZodError);

    expect(() =>
      NoteWorkflowSchema.parse({ action: 'edit', note_path: 'A.md', content: 'x', mode: 'insert-after-heading' })
    ).toThrow(z.ZodError);

    expect(
      NoteWorkflowSchema.parse({
        action: 'edit',
        note_path: 'A.md',
        content: 'x',
        mode: 'replace',
        find: 'old',
      })
    ).toMatchObject({ mode: 'replace', find: 'old' });
  });

  it('defaults mode to append and caps defer_hint_seconds at 1800', () => {
    const parsed = NoteWorkflowSchema.parse({ action: 'edit', note_path: 'A.md', content: 'x' });
    expect(parsed.mode).toBe('append');

    expect(() =>
      NoteWorkflowSchema.parse({ action: 'edit', note_path: 'A.md', content: 'x', defer_hint_seconds: 1801 })
    ).toThrow(z.ZodError);

    expect(
      NoteWorkflowSchema.parse({ action: 'edit', note_path: 'A.md', content: 'x', defer_hint_seconds: 1800 })
    ).toMatchObject({ defer_hint_seconds: 1800 });
  });
});

describe('formatToolError', () => {
  it('names the tool and bad field for zod errors', () => {
    const schema = z.object({ count: z.number() });
    const parsed = schema.safeParse({ count: 'nope' });

    if (parsed.success) {
      throw new Error('expected sample schema to fail');
    }

    const message = formatToolError('edit_note', parsed.error);

    expect(message).toContain('edit_note');
    expect(message).toContain('count');
    expect(message).toContain('expected number');
    expect(message).toContain('received string');
  });
});

describe('formatToolError argument clarity', () => {
  it('names an unknown parameter and suggests the right one', () => {
    const parsed = NoteWorkflowSchema.safeParse({
      action: 'edit',
      note_path: 'a.md',
      new_string: 'hello',
    });
    if (parsed.success) {
      throw new Error('expected parse to fail');
    }

    const message = formatToolError('note_workflow', parsed.error);

    expect(message).toContain('new_string');
    expect(message).toContain('content');
    expect(message).not.toContain('received invalid value');
  });

  it('lists valid keys for an unknown parameter with no alias', () => {
    const parsed = NoteWorkflowSchema.safeParse({
      action: 'edit',
      note_path: 'a.md',
      content: 'hi',
      wibble: 1,
    });
    if (parsed.success) {
      throw new Error('expected parse to fail');
    }

    const message = formatToolError('note_workflow', parsed.error);

    expect(message).toContain('wibble');
    expect(message).toContain('note_path');
    expect(message).toContain('defer_hint_seconds');
  });

  it('reports a missing required field without fabricating a received value', () => {
    const parsed = NoteWorkflowSchema.safeParse({ action: 'edit', note_path: 'a.md' });
    if (parsed.success) {
      throw new Error('expected parse to fail');
    }

    const message = formatToolError('note_workflow', parsed.error);

    expect(message).toContain('edit requires content');
    expect(message).not.toContain('received');
    expect(message).not.toContain('expected edit requires content');
  });

  it('every alias target is a valid key of at least one tool', () => {
    const allKeys = new Set(Object.values(TOOL_KEYS).flat());
    for (const target of ['content', 'find', 'note_path']) {
      expect(allKeys.has(target), `alias target "${target}" is not a valid key`).toBe(true);
    }
  });

  it('does not suggest an alias whose target is invalid for that tool', () => {
    const parsed = EditNoteSchema.safeParse({
      note_path: 'a.md',
      content: 'hi',
      defer_hint_seconds: 5,
    });
    if (parsed.success) {
      throw new Error('expected parse to fail');
    }

    const message = formatToolError('edit_note', parsed.error);

    expect(message).toContain('defer_hint_seconds');
    expect(message).not.toContain('did you mean');
  });
});

describe('advertised schema parity', () => {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  for (const toolName of ['note_workflow', 'edit_note']) {
    it(`${toolName} advertises exactly the keys its Zod schema accepts`, () => {
      const tool = byName.get(toolName);
      expect(tool, `tool "${toolName}" is not registered`).toBeDefined();

      const advertised = Object.keys(tool!.inputSchema.properties as Record<string, unknown>).sort();
      const actual = [...TOOL_KEYS[toolName]].sort();

      expect(advertised).toEqual(actual);
    });

    it(`${toolName} advertises additionalProperties: false`, () => {
      const tool = byName.get(toolName);
      expect(tool).toBeDefined();
      expect((tool!.inputSchema as Record<string, unknown>).additionalProperties).toBe(false);
    });
  }
});
