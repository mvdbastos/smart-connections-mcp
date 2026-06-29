# Memory MCP — Design Spec

Date: 2026-06-29
Status: Approved
Topic: Turn smart-connections-mcp into a self-contained Obsidian "memory" MCP server

## Goal

Evolve the read-only Smart Connections MCP server into an optimized memory layer
that exposes a small, predictable set of functions for:

- Semantic search over Obsidian notes
- Create / edit notes (auto-embed so new notes are immediately searchable)
- Save / sync via git, with fallback to local-only save
- Operating fully without Obsidian running

## Decisions (approved)

- **Embeddings for new/edited notes**: compute locally with fallback to keyword (option C).
- **Writes**: smart create/edit/delete, auto folders, frontmatter, append-section, auto-embed on write (option B).
- **Git**: explicit only — writes touch disk; commit/push via dedicated tools; add `push`; local-only fallback.
- **Embedding storage**: write into Smart Connections `.smart-env/multi/*.ajson` (single source of truth) with hash check.
- **Docs**: expose guides + recipes for ALL memory operations via MCP resources/prompts.

## Architecture

Existing modules kept: `index.ts`, `search-engine.ts`, `smart-connections-loader.ts`,
`embedding-utils.ts`, `git-manager.ts`, `types.ts`.

New modules:
- `embedder.ts` — lazy-loads `@huggingface/transformers` + `TaylorAI/bge-micro-v2` (384-dim, matches stored vectors). Embeds query text and new/edited note text. Fallback: model unavailable → keyword search.
- `note-writer.ts` — create/edit/delete, folder creation, frontmatter handling, overwrite/append/append-section.
- `ajson-writer.ts` — appends `"smart_sources:<path>": {...}` lines into the per-note `.smart-env/multi/*.ajson` with `last_embed.hash`, so Obsidian adopts vectors and avoids re-embedding.

Modified:
- `search-engine.ts` — `searchByQuery` becomes true semantic (embed query, cosine vs sources; keyword fallback).
- `git-manager.ts` — add `push`; `syncNotes` = pull+push; local-only fallback when no remote.

## Tools

Existing (kept): get_similar_notes, get_connection_graph, search_notes (upgraded),
get_embedding_neighbors, get_note_content, get_stats, git_commit_notes,
git_commit_notes_specific, git_sync_notes (now pull+push).

New: create_note, edit_note (overwrite|append|append-section), delete_note, git_push_notes.

Auto-embed runs on every successful write; failure degrades to keyword, never blocks the write.

## Guides & recipes (MCP resources/prompts)

Per-operation guides: search, similar-notes, connection-graph, read, create, edit,
append-section, delete, embed-status, commit, push, sync (params, when-to-use, gotchas).

Optimized recipes:
- Recall: search_notes → get_note_content
- Capture: create_note → git_commit → git_push (local fallback)
- Refine: search → edit_note(append-section) → commit
- Explore: get_similar_notes → get_connection_graph
- Prune: delete_note → commit

One index resource lists all guides/recipes.

## Resilience

- No Obsidian dependency (stays true).
- Embed fail → keyword; git/no-remote → local save; writes never blocked.

## Testing

- Embedder: dim=384, fallback path. Writer: create/edit/append/delete, frontmatter, folders.
- AJSON: appended line round-trips through loader. Git: commit/push/sync + local fallback.
