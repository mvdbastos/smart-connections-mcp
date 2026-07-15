# Implementation Plan — MCP Edit/Read Improvements

Date: 2026-06-30
Spec: [docs/superpowers/specs/2026-06-30-mcp-edit-read-improvements-design.md](../specs/2026-06-30-mcp-edit-read-improvements-design.md)
Approach: Moderate (approved). Test-first where practical.

## Conventions

- Run tests with `npm test` (vitest) after each task.
- Keep changes additive and backward compatible.
- One logical change per commit.

---

## Task 1 — Tolerant path resolution (loader)

Files: `src/smart-connections-loader.ts`, new tests in `src/smart-connections-loader.test.ts`

Steps:
1. Add `resolveNotePath(notePath: string): string` implementing the 4-step
   algorithm from the spec (exact → `+.md` → ci full path → ci basename).
2. Multiple basename matches → throw ambiguous error listing candidates (≤10).
3. No match → throw not-found error with closest suggestions.
4. Update `getSource()` and `readNoteContent()` to resolve first, operate on the
   canonical path. Preserve current behavior for unindexed-but-existing files in
   `readNoteContent` (fall back to exact path read).

Tests:
- exact match returns canonical path
- `"Note"` resolves to `"Note.md"`
- case-insensitive folder/path + basename matches
- ambiguous basename throws `/ambiguous/i`
- unknown throws `/not found/i` and includes a suggestion

Done when: new tests pass; existing tests unaffected.

---

## Task 2 — Edit primitives (`replace`, `insert-after-heading`, `dry_run`)

Files: `src/note-writer.ts`, `src/note-writer.test.ts`

Steps:
1. Introduce `EditOptions` / `EditResult` interfaces (per spec).
2. Refactor `editNote` to accept `EditOptions`; add a positional back-compat
   overload/wrapper `editNote(vault, notePath, content, mode, heading)` that
   delegates, so current call sites/tests keep working.
3. Implement `replace` (literal default; `regex` flag; optional `count`).
   - missing `find` → throw; literal not found → throw.
4. Implement `insert-after-heading` (match markdown heading line; insert after).
   - heading not found → throw.
5. Add sha256 `previousHash`/`newHash`, compute unified `diff`.
6. `dryRun`: compute result, set `written: false`, do not write file.
7. Keep `safe()` vault-escape guard for every path.

Tests (write first, then implement):
- literal replace updates target only
- regex replace with `count` limits replacements
- insert-after-heading places content under the heading
- dry_run returns non-empty `diff`, `written: false`, file unchanged on disk
- replace with missing `find` / no match throws

Done when: all note-writer tests pass.

---

## Task 3 — MCP schema + handler (`edit_note`)

Files: `src/index.ts`

Steps:
1. Extend `EditNoteSchema`: `mode` enum adds `replace`, `insert-after-heading`;
   add optional `find`, `regex`, `count`, `dry_run`.
2. `superRefine`: `replace` requires `find`; `insert-after-heading` requires
   `heading`.
3. Update the `edit_note` case to build `EditOptions`, call `editNote`, and run
   `embedUpdatedNote` only when `written && changed`. Return `EditResult`.
4. Update the `edit_note` tool registration `description` + JSON inputSchema to
   document new fields.

Tests:
- schema unit test: `replace` without `find` fails parse; valid `replace` passes.

Done when: build (`npm run build`) succeeds; schema test passes.

---

## Task 4 — Error formatting

Files: `src/index.ts`

Steps:
1. Add `formatToolError(toolName, error)` mapping `ZodError` issues to a concise
   string (tool + field + expected/received).
2. Use it in the `CallToolRequestSchema` catch block.

Tests:
- unit test on `formatToolError` with a sample `ZodError`.

Done when: returned error text names the tool and the bad field.

---

## Task 5 — Docs

Files: `README.md`, tool descriptions (already in Task 3), guides if relevant

Steps:
1. Add an agent-facing example: `get_note_content` → `edit_note` with
   `dry_run: true` → review diff → `edit_note` write → `git_commit_notes_specific`.
2. Note tolerant path resolution (you may omit `.md`).

Done when: README shows the read→preview→write→commit recipe.

---

## Task 6 — Integration verification

Steps:
1. Build: `npm run build`.
2. Full suite: `npm test`.
3. Manual smoke via MCP Inspector against a scratch vault:
   - resolve a title without `.md`
   - `replace` a line with `dry_run` then write
   - commit the specific note
4. Confirm no regressions in existing tests.

Done when: build + all tests green; smoke flow completes end-to-end.

---

## Commit sequence

1. `feat(loader): tolerant note-path resolution`
2. `feat(note-writer): replace/insert-after-heading + dry-run diff`
3. `feat(mcp): expose new edit modes and dry_run; clearer tool errors`
4. `docs: read→preview→write→commit recipe`

## Risks / mitigations

- **Back-compat for `editNote`** → keep positional wrapper; run existing tests.
- **Ambiguous resolution surprising callers** → prefer exact/`.md` before fuzzy;
  only basename step can be ambiguous, and it throws rather than guessing.
- **Regex misuse** → `regex` defaults off; invalid pattern surfaces a clear error.
