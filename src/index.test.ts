import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EditNoteSchema, NoteWorkflowSchema, TOOL_KEYS, formatToolError } from './tool-schemas.js';
import { tools } from './tool-definitions.js';
import { createNote, editNote, deleteNote } from './note-writer.js';
import { SmartConnectionsLoader } from './smart-connections-loader.js';
import { MEMORY_RESOURCES } from './resources.js';

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

describe('delete then edit does not resurrect a note', () => {
  it('refuses the edit and leaves no file behind', async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'resurrect-'));
    fs.mkdirSync(path.join(vault, '.smart-env', 'multi'), { recursive: true });
    fs.writeFileSync(
      path.join(vault, '.smart-env', 'smart_env.json'),
      JSON.stringify({
        smart_sources: { embed_model: { adapter: 'transformers', transformers: { model_key: 'model' } } },
      })
    );
    fs.writeFileSync(path.join(vault, '.smart-env', 'multi', 'sources.ajson'), '\n');

    try {
      createNote(vault, 'Memory/Note.md', '# real content');

      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();
      loader.upsertSource({
        path: 'Memory/Note.md',
        embeddings: { model: { vec: [1, 0], last_embed: { hash: 'h', tokens: 1 } } },
        last_read: { hash: 'h', at: 0 },
        class_name: 'SmartSource',
        last_import: { mtime: 0, size: 0, at: 0, hash: 'h' },
        blocks: {},
      });

      // Delete through the same sequence the note_workflow handler uses.
      deleteNote(vault, 'Memory/Note.md');
      loader.removeSource('Memory/Note.md');

      // The index no longer claims it, so write-mode resolution refuses.
      expect(() => loader.resolveNotePath('Memory/Note.md', 'write')).toThrow(/not found/i);

      // And even a literal-path edit refuses rather than recreating.
      expect(() => editNote(vault, 'Memory/Note.md', 'fragment', 'append')).toThrow(/not found/i);
      expect(fs.existsSync(path.join(vault, 'Memory', 'Note.md'))).toBe(false);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });
});

describe('a literal correct path wins over a stale basename match', () => {
  it('edits the real un-indexed file rather than the stale indexed one', async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'basename-race-'));
    fs.mkdirSync(path.join(vault, '.smart-env', 'multi'), { recursive: true });
    fs.writeFileSync(
      path.join(vault, '.smart-env', 'smart_env.json'),
      JSON.stringify({
        smart_sources: { embed_model: { adapter: 'transformers', transformers: { model_key: 'model' } } },
      })
    );
    fs.writeFileSync(path.join(vault, '.smart-env', 'multi', 'sources.ajson'), '\n');

    try {
      // The real note, at its correct current path, not yet reindexed.
      createNote(vault, 'Memory/Honcho Memory Stack.md', '# real content');

      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();
      // A stale index entry sharing the same basename, at a wrong path with no file behind it.
      loader.upsertSource({
        path: 'Memory/memory/Honcho Memory Stack.md',
        embeddings: { model: { vec: [1, 0], last_embed: { hash: 'h', tokens: 1 } } },
        last_read: { hash: 'h', at: 0 },
        class_name: 'SmartSource',
        last_import: { mtime: 0, size: 0, at: 0, hash: 'h' },
        blocks: {},
      });

      // Same sequence the note_workflow handler uses: try write-mode resolution,
      // fall back to the literal path on failure, let note-writer's own
      // existence check be authoritative.
      let targetPath = 'Memory/Honcho Memory Stack.md';
      try {
        targetPath = loader.resolveNotePath('Memory/Honcho Memory Stack.md', 'write');
      } catch {
        // Falls through to the literal path — expected, since the exact
        // path is not indexed yet.
      }

      const result = editNote(vault, targetPath, 'appended', 'append');

      expect(result.written).toBe(true);
      expect(fs.readFileSync(path.join(vault, 'Memory', 'Honcho Memory Stack.md'), 'utf-8')).toContain(
        'appended'
      );
      expect(fs.existsSync(path.join(vault, 'Memory', 'memory', 'Honcho Memory Stack.md'))).toBe(false);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });
});

describe('agent-facing naming', () => {
  it('never calls the vault or the server by a legacy name in tool descriptions', () => {
    const text = tools.map((tool) => `${tool.name} ${tool.description}`).join('\n');

    expect(text).not.toMatch(/Smart Connections/);
    expect(text).not.toMatch(/smart-connections-mcp/);
  });

  it('never calls the vault or the server by a legacy name in resource content', () => {
    const text = MEMORY_RESOURCES.map((resource) => resource.text).join('\n');

    expect(text).not.toMatch(/Smart Connections/);
    expect(text).not.toMatch(/smart-connections-mcp/);
  });
});

describe('documented tool contract', () => {
  it('never names a get_stats response field that does not exist', () => {
    const text = MEMORY_RESOURCES.map((resource) => resource.text).join('\n');

    expect(text).not.toMatch(/total_vectors/);
    expect(text).not.toMatch(/embedder_ready/);
    expect(text).not.toMatch(/total_notes/);
  });

  it('documents every field get_stats actually returns', () => {
    const text = MEMORY_RESOURCES.map((resource) => resource.text).join('\n');

    for (const field of [
      'totalNotes',
      'totalBlocks',
      'embeddingDimension',
      'modelKey',
      'git',
      'sync',
      'index',
    ]) {
      expect(text).toContain(field);
    }
  });
});
