# Index / Filesystem Integrity — Design

**Date:** 2026-08-07
**Issues:** [#7](https://github.com/mvdbastos/smart-connections-mcp/issues/7), [#4](https://github.com/mvdbastos/smart-connections-mcp/issues/4)
**Status:** Approved

## Goal

The server must never write to a path it cannot confirm exists, and must never report a note that isn't there.

## Background

This is Group B of three. The six open issues decompose into:

| Group | Issues | Subsystem |
|---|---|---|
| A | #6, #10 | Prompt text and argument validation |
| **B (this spec)** | #4, #7 | Index/filesystem desync — phantom paths, silent note fabrication |
| C | #5, #8 | Sync durability — stale pathspec poisoning, non-persistent commit state |

All three run as concurrent branches merged at the end — see [Parallel execution](#parallel-execution).

## Root cause

The Smart Connections index (`.smart-env/multi/*.ajson`) is loaded once at startup and **never reconciled against the filesystem**. Stale keys enter from two directions:

- **External.** A note moved or deleted in Obsidian leaves its old key in the index.
- **Self-inflicted.** The `note_workflow` delete branch (`index.ts:692`) calls `deleteNote` and never informs the loader. `upsertSource` exists (`smart-connections-loader.ts:209`); there is no `removeSource`. Nothing ever removes a key.

`resolveNotePath` (`smart-connections-loader.ts:129`) then returns a stale key as authoritative — it performs zero filesystem verification. `editNote` (`note-writer.ts:191`) treats a missing file as an empty one:

```ts
const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
```

so the write proceeds, and `fs.mkdirSync(path.dirname(file), { recursive: true })` at `:230` materializes the parent directories. This is the line that fabricated the reported `Memory/memory/` folder.

### Reproduction without an external editor

Because the server manufactures its own stale keys, #7 reproduces in one session:

```
note_workflow action=delete note_path=X   → file removed, index key X remains
note_workflow action=edit   note_path=X   → resolveNotePath(X) returns X
                                          → editNote finds no file, current = ''
                                          → mkdirSync + writeFileSync
                                          → X resurrected containing only the appended fragment
```

A delete followed by an edit of the same path recreates the note as a fragment. This is the primary regression test.

### The basename hazard

`resolveNotePath`'s basename fallback (`:148-155`) matches `Foo` against `Archive/2019/Foo.md`. For a read this is a convenience. For a write it is worse than the phantom-path case — the resolved file **exists and has content**, so `mode=overwrite` destroys a real note the caller never named.

## Design

### 1. Resolution mode on `resolveNotePath`

Signature becomes `resolveNotePath(notePath: string, mode: 'read' | 'write' = 'read'): string`. The default preserves every existing read caller unchanged.

| Strategy | `read` | `write` |
|---|---|---|
| Exact key match | ✓ | ✓ |
| `.md` extension append | ✓ | ✓ |
| Case-insensitive full-path match | ✓ | ✓ |
| Basename guess | ✓ | ✗ — demoted to a *suggestion* in the error message |
| Must exist on disk | ✗ | ✓ |

**`write` mode applies to both `edit` and `delete`** — every non-`create` action in the `note_workflow` handler (`index.ts:661-667`). A delete of a stale path therefore fails at resolution with a useful message instead of reaching `fs.rmSync` and throwing a bare `ENOENT`.

Write-mode failure names the basename candidates it declined to use:

```
Note not found: "Foo". Did you mean: Archive/2019/Foo.md?
Pass the full path to edit it, or use action=create to create a new note.
```

### 2. `editNote` refuses to fabricate

The existence ternary at `note-writer.ts:191` becomes a guard, and the `mkdirSync` at `:230` is **deleted outright**:

```ts
const file = safe(vault, notePath);
if (!fs.existsSync(file)) {
  throw new Error(`Note not found: "${notePath}". Use action=create to create it.`);
}
const current = fs.readFileSync(file, 'utf-8');
```

This applies to **every** mode including `overwrite`. `action=create` is the only path that creates a note.

Deleting `mkdirSync` is safe: `createNote` (`note-writer.ts:157-166`) throws `Note already exists` and performs its own `mkdirSync`, so creation is entirely owned by `createNote`. Removing the call makes "edit never creates directories" a structural property rather than something the guard merely prevents.

The two states are now distinguished. **A file that exists and is empty is still editable** — only a *missing* file is refused.

### 3. `deleteNote` reports missing files properly

`fs.rmSync(safe(vault, notePath))` (`:242`) throws a bare `ENOENT` naming an absolute temp path. Wrap it to name the vault-relative note path.

### 4. `loader.removeSource(notePath)`

The missing counterpart to `upsertSource`:

```ts
removeSource(notePath: string): boolean {
  return this.sources.delete(notePath);
}
```

Called from the `note_workflow` delete branch after `deleteNote` succeeds.

### 5. `loader.reconcileWithFilesystem()`

Runs inside `initialize()` after `loadSources()`. Drops keys with no file behind them and returns the count.

The vault currently indexes ~3,442 entries, so this is ~3.4k `existsSync` calls — tens of milliseconds at startup.

### 6. `listByPrefix` filters by existence

`index.ts:600-603` gains an existence filter. Given components 1–5 this is redundant, but this function **is** issue #4, and the redundancy sits exactly where the user-visible harm occurred.

The `PromptContext.listByPrefix` doc comment (`prompts.ts:10-15`) currently warns that results are "a display hint, never an authoritative migration check". That caveat narrows to reflect the new guarantee — but **`metadata.vault_note` remains the sole authoritative migration gate**, which is a separate rule and does not change.

## Error handling

One non-obvious failure mode: reconciliation itself.

If `VAULT_ROOT` is misconfigured or the drive is unmounted, every `existsSync` returns false and reconciliation would **silently empty a 3,442-entry index**, degrading the server to "no notes exist" with no error raised.

**Safety valve:** reconciliation is two-phase. It first collects the set of keys with no file behind them, then compares that set against the total. If it exceeds **50% of loaded entries**, nothing is dropped — the index is kept intact, a loud message goes to stderr, and startup continues. Mass simultaneous disappearance is never legitimate staleness. Below the threshold, the collected set is deleted and the count returned.

All other new failures are thrown errors on the existing `note_workflow` path, surfaced through `formatToolError` (`index.ts:976`) with `isError` semantics unchanged.

## Testing

**Reproduction** (`src/index.test.ts`):

- Delete-then-edit no longer resurrects the note. Asserts **no file and no parent directory** created.

**`editNote`** (`src/note-writer.test.ts`):

- Throws for `append`, `append-section`, `replace`, `insert-after-heading`, and `overwrite` on a missing file.
- **Still edits an existing empty file.** This is the regression that must not happen — empty-existing and missing were previously indistinguishable, and the fix must separate them rather than reject both.
- No directory is created on the refusal path.

**Resolution** (`src/smart-connections-loader.test.ts`):

- Write mode rejects a basename-only path; read mode still accepts it.
- Write mode rejects an indexed key whose file is missing.
- Write-mode error text names the basename candidates.
- Exact, `.md`-append, and case-insensitive matches work in both modes.

**Loader state** (`src/smart-connections-loader.test.ts`):

- `removeSource` returns `true` when present, `false` when absent.
- `reconcileWithFilesystem` drops missing entries, keeps present ones, returns the count.
- **Safety valve:** a vault where every file is missing keeps the index intact and logs; a vault where just under half are missing still drops them.
- Write-mode resolution applies to `delete`: deleting a stale path fails at resolution, not with `ENOENT`.

**Listing** (`src/index.test.ts`):

- `listByPrefix` excludes paths with no file behind them.

## Parallel execution

Groups A, B, and C run as three concurrent branches off `main`, merged only at the end.

**`dist/` is compiled output and is tracked in git (75 files).** Three branches each rebuilding it would conflict across all of them on every merge after the first, and such a conflict has no meaningful resolution — the only correct answer is to rebuild, never to merge hunks.

Therefore, on this branch:

- **Do not run `npm run build`. Do not stage `dist/`.** Commit steps stage `src/`, `docs/`, and `CHANGELOG.md` explicitly — never `git add -A`.
- `dist/` is knowingly left stale for the life of this branch. Tests run from `src/` via Vitest, so this does not affect verification.
- After all three branches merge, a single integration commit runs `npm run build` and stages `dist/` alone.

**Overlap with Group A:** `src/prompts.ts` is touched by both — Group A edits the prompt bodies (`:262` onward), Group B edits the `PromptContext` interface doc comment (`:10-15`). Disjoint regions, so git should auto-merge, but this is the one real source overlap between the two branches.

`src/index.ts` is touched by all three groups in disjoint regions (A: `inputSchema` ~233/~445; B: `listByPrefix` ~600, handler ~664/~692; C: sync wiring ~96, `delete_note` ~832).

## Files

| File | Change |
|---|---|
| `src/smart-connections-loader.ts` | Resolution mode, `removeSource`, `reconcileWithFilesystem` + safety valve |
| `src/smart-connections-loader.test.ts` | Resolution, removal, reconciliation tests |
| `src/note-writer.ts` | `editNote` existence guard, delete `mkdirSync`, `deleteNote` message |
| `src/note-writer.test.ts` | Fabrication-refusal and empty-file regression tests |
| `src/index.ts` | Write-mode resolution, `removeSource` call, `listByPrefix` filter |
| `src/index.test.ts` | Delete→edit reproduction, `listByPrefix` filtering |
| `src/prompts.ts` | Narrow the `listByPrefix` doc caveat |
| `CHANGELOG.md` | Behavior change entry |
| `dist/` | **Not touched on this branch** — rebuilt once at integration |

## Risks

- **`editNote` no longer creates.** Any caller using `mode=overwrite` as an upsert breaks. This is the intended fix, and it is the most disruptive single change across all three groups.
- **Basename writes stop working.** `note_workflow action=edit note_path=Foo` now fails where it previously resolved. The error names the candidates, so the correction is one retry — but it will be noticed in normal use.
- **Reconciliation trusts `VAULT_ROOT`.** The >50% safety valve is the only thing standing between a misconfigured path and an emptied index. If that threshold is ever removed, the failure is silent and total.

## Out of scope

- Watching the filesystem for changes, or re-reading `.ajson` files mid-session. Reconciliation runs once at startup; mid-session accuracy comes from `upsertSource`/`removeSource` on the write path.
- Re-embedding or repairing the `.ajson` files themselves. Stale entries are dropped from the in-memory map only; the on-disk index is left for Smart Connections to regenerate.
- Groups A (#6, #10) and C (#5, #8) — separate specs.
