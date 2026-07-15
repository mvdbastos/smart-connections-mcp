# MCP Edit/Read Improvements — Design Spec

Date: 2026-06-30
Status: Approved (design)
Related bug: [docs/bugs/mcp-server-edit-note-tooling-bug.md](../../bugs/mcp-server-edit-note-tooling-bug.md)

## Problem

Automated agents cannot reliably complete a read→edit→commit flow against the
Smart Connections MCP server. Three concrete gaps, all confirmed in source:

1. **Strict path resolution.** `loader.getSource()` and `loader.readNoteContent()`
   do exact-key/exact-path lookups. A missing `.md` or a title-only path returns
   `Note not found` with no recovery hint.
   - Evidence: `getSource` ([src/smart-connections-loader.ts](../../../src/smart-connections-loader.ts)) is a plain `Map.get`; `readNoteContent` joins the path and `fs.existsSync` fails hard.
2. **No localized edit primitive.** `editNote` supports only `overwrite | append |
   append-section`. Line-level or targeted edits require a full overwrite, which
   forces the agent to reconstruct the whole file (error-prone).
   - Evidence: `editNote` ([src/note-writer.ts](../../../src/note-writer.ts)).
3. **No preview / unhelpful errors.** Writes are immediate (no dry-run/diff), and
   zod validation failures don't name the tool or the offending field.

This spec covers the **Moderate** scope approved during brainstorming.

## Goals

- Tolerant note-path resolution shared by read and similarity paths.
- New `replace` and `insert-after-heading` edit modes.
- A `dry_run` option returning a unified diff without writing.
- Clearer schema/validation errors (tool name + field + expected/received).

## Non-Goals (YAGNI)

- A full structured edit DSL or multi-operation transactions.
- Client-side helper libraries.
- Reworking embeddings or git flows beyond what edits require.

## Design

### 1. Path resolution

Add `resolveNotePath(notePath: string): string` to `SmartConnectionsLoader`.

Algorithm (first match wins):
1. Exact key in `this.sources`.
2. `notePath + '.md'` if not already ending in `.md`.
3. Case-insensitive match on the full relative path.
4. Case-insensitive match on basename (filename without folders).

Resolution rules:
- Return the **canonical** stored path on success.
- If step 4 yields **multiple** candidates, throw:
  `Ambiguous note "<input>". Candidates: a.md, b.md` (cap list at ~10).
- If nothing matches, throw:
  `Note not found: "<input>". Did you mean: <closest matches>?`

Wire-up:
- `getSource()` resolves first, then `Map.get`.
- `readNoteContent()` resolves first, then reads the canonical path.
- `getSimilarNotes()` / `getNoteWithContext()` benefit automatically.

Note: resolution operates over indexed sources. Reads of files that exist on disk
but aren't indexed keep current behavior (exact path), so we don't silently miss.

### 2. Edit primitives

Refactor `editNote` to an options object (keep a thin back-compat wrapper so
existing positional call sites and tests pass):

```ts
export interface EditOptions {
  content?: string;          // body for append/overwrite/append-section/insert-after-heading
  mode: 'overwrite' | 'append' | 'append-section'
      | 'replace' | 'insert-after-heading';
  heading?: string;          // append-section + insert-after-heading
  find?: string;             // replace mode (required)
  regex?: boolean;           // treat find as a regex (default false)
  count?: number;            // max replacements (default: all)
  dryRun?: boolean;          // compute result, do not write
}

export interface EditResult {
  path: string;
  mode: string;
  changed: boolean;          // did content actually differ
  written: boolean;          // false when dryRun
  diff?: string;             // unified diff (always for dryRun, optional otherwise)
  previousHash: string;      // sha256 of prior content
  newHash: string;           // sha256 of resulting content
}
```

Mode semantics:
- `replace`: literal substring (or regex when `regex: true`) replacement of `find`
  with `content`. Error if `find` missing or (literal) not present.
- `insert-after-heading`: locate the line matching `heading` (markdown `#`+),
  insert `content` after that heading's block start. Error if heading not found.
- Existing three modes unchanged.

`dryRun: true` computes `next`, returns the diff + hashes, and does **not** write.

### 3. MCP surface (`src/index.ts`)

Extend `EditNoteSchema`:
- `mode` enum adds `'replace'`, `'insert-after-heading'`.
- Add optional `find`, `regex`, `count`, `dry_run`.
- Cross-field validation via `superRefine`: `replace` requires `find`;
  `insert-after-heading` requires `heading`.

`edit_note` handler maps args → `EditOptions`, calls `editNote`, and only runs
`embedUpdatedNote` when `written && changed`. Returns `EditResult` as JSON.

### 4. Error formatting

Add `formatToolError(toolName, error)` that, for `ZodError`, produces:
`edit_note: invalid "find" (expected string, received undefined)`.
Used in the `CallToolRequestSchema` catch path.

## Data flow

```
agent → edit_note(dry_run) → editNote() → EditResult{diff} → agent reviews
agent → edit_note(write)   → editNote() → write file → embedUpdatedNote → result
agent → git_commit_notes_specific([path]) → commit
```

## Error handling

- Resolution failures: actionable messages with candidates.
- `replace` with no match / missing `find`: explicit error, no write.
- `insert-after-heading` missing heading: explicit error, no write.
- Vault-escape guard (`safe()`) retained for all modes.

## Testing

- `note-writer.test.ts`: replace (literal), replace (regex + count),
  insert-after-heading, dry_run returns diff and leaves file untouched,
  replace-not-found throws.
- Loader/search test: `resolveNotePath` for exact, missing-`.md`,
  case-insensitive, ambiguous (throws), not-found (throws with suggestions).
- `index.ts` schema: `superRefine` rejects `replace` without `find`.
- Run: `npm test`.

## Rollout

- Update tool descriptions + `README` with a read→dry_run→write→commit example.
- Backward compatible: positional `editNote` wrapper + additive schema fields.
