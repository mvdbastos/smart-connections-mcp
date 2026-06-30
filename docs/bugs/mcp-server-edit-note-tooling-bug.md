# MCP Server: Edit/Read Tooling Bug Report

Date: 2026-06-30

Summary
- While attempting an automated edit workflow, the agent was unable to reliably read and update a note because of a combination of misleading tool behavior, strict path resolution, and limited edit primitives on the MCP server.

Reproduction (short)
- Requestor asked the agent to read a note and insert PowerShell commands per instruction line.
- The agent repeatedly used `get_similar_notes` instead of `get_note_content`, then produced an edited note locally but could not commit it through the MCP because of API/schema mismatches.

Root Cause Analysis
- `get_similar_notes` returns only metadata about *other* notes (paths, similarity, headings) and never the body text. It is a related-notes query, not a content fetch. See the registered tool `get_similar_notes` and its implementation in the server and search engine.
- There is an available `get_note_content` tool that returns actual content, but the agent did not call it. This was a selection error exacerbated by ambiguous mental model and overlapping parameter names (`note_path`).
- Path resolution is strict: callers must provide the exact relative path (including extension and exact casing as indexed). A missing `.md` or slightly different title leads to `Note not found` instead of offering suggestions or a tolerant lookup.
- `edit_note` supports only `overwrite`, `append`, and `append-section`. There is no fine-grained replace/insert-after-heading primitive or a dry-run preview/diff. That forces agents to read content, build a full replacement, and call `edit_note` with `overwrite` — a brittle workflow for line-level updates.
- Schema validation errors and zod parse failures are not surfaced with helpful guidance (tool name + expected params vs received). This made the initial calls confusing.

Evidence (files)
- Tool registration and descriptions: [src/index.ts](src/index.ts)
- `getSimilarNotes` implementation and `getNoteWithContext`: [src/search-engine.ts](src/search-engine.ts)
- `editNote` primitives: [src/note-writer.ts](src/note-writer.ts)

Impact
- Automated agents cannot reliably read-then-edit notes in a single interaction without fragile, exact paths and complete overwrite operations.
- Human operators may be misled by similarity tools when they need content; this increases time-to-resolution and causes errors.

Proposed Design Changes (prioritized)
1. Path-resolution tolerant lookup: when exact match fails, try common variations (append `.md`, case-insensitive basename match) and return best-candidate suggestions if multiple matches exist. Fail with helpful candidates rather than `Note not found`.
2. Add `replace` and `insert-after-heading` edit modes to `edit_note` (or a small DSL for localized edits). Also return a `dry_run` option that returns a unified diff instead of writing.
3. Improve tool descriptions and rename or augment `get_similar_notes` output to make it explicit it returns other-note metadata (e.g., include `note: "related-notes"` in the response). Add examples to the tool docs.
4. Surface `edit_note`/write tools alongside read tools in the same capability set so read→edit→commit flows can complete in one session (no missing tools in attachments).
5. Wrap schema parse failures to include: tool name, which param failed, expected type, and the received value.

Recommended Next Steps
- Implement path tolerant lookup in the loader and add unit tests in `note-writer.test.ts` and `search-engine.test.ts`.
- Add `replace`/`insert-after-heading` to `note-writer.ts` and expose via `edit_note`; include `dry_run` behavior and tests.
- Update `README`/guides with examples for agent authors: explicit read→edit→commit sequences using `get_note_content`, `edit_note` (dry_run first), then `git_commit_notes_specific`.
- Run integration test where an agent: fetches note content, performs line-level edits via `dry_run`, then writes and commits.

Author: Automated investigation by tooling + developer assistant
