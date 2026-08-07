# Prompt Scope & Argument Error Clarity — Design

**Date:** 2026-08-07
**Issues:** [#10](https://github.com/mvdbastos/smart-connections-mcp/issues/10), [#6](https://github.com/mvdbastos/smart-connections-mcp/issues/6)
**Status:** Approved

## Goal

Stop the `migrate` prompt from being readable as "sweep any memory store you have", and make a wrong parameter name report what was actually wrong.

## Background

This is Group A of three. The six open issues decompose into:

| Group | Issues | Subsystem |
|---|---|---|
| **A (this spec)** | #6, #10 | Prompt text and argument validation |
| B | #4, #7 | Index/filesystem desync — phantom paths, silent note fabrication |
| C | #5, #8 | Sync durability — stale pathspec poisoning, non-persistent commit state |

Groups B and C get their own spec, plan, and branch. All three are implemented **in parallel** and merged together at the end — see [Parallel execution](#parallel-execution).

### What #10 actually is

`migrate`'s opening instruction reads "Sweep your native memory directory and move every unmigrated memory into the Obsidian vault" with no path. The exact path appears two paragraphs later under `## Find the backlog`. An agent acting on the headline has nothing to disambiguate "native memory directory" from any other memory store its runtime exposes. In the reported incident it resolved to an assistant-level `/memories/` store and migrated files that were never in scope.

`init` does not have this defect — it names the path in the same sentence (`prompts.ts:302`). The two prompts were written as independent prose and `migrate` lost the path. **#10 is a copy-drift bug**, and that framing drives the design.

### The server cannot enforce this

`note_workflow` writes exclusively through `safe(vault, notePath)` in `note-writer.ts` and physically cannot escape the vault root. The out-of-scope files in the incident were written by the agent's own Write tool, following prompt instructions. There is no code lever available. Issue #10's suggestion 3 — a `scope` parameter on `note_workflow` — would be a no-op against the real failure and is dropped.

### What #6 actually is

Two independent defects compound:

1. `formatToolError` (`tool-schemas.ts:84-98`) has no branch for `ZodIssueCode.custom`. Custom issues carry no `expected` or `received`, so the fallbacks produce `expected <the message itself>, received invalid value` — reading as "the value you supplied was rejected" when the field was in fact absent.
2. Neither schema is `.strict()`, so an unknown key is silently discarded and never appears in the error.

Together: passing `new_string` instead of `content` yields `note_workflow: invalid "content" (expected edit requires content, received invalid value)`, which names only the required parameter and never the rejected one.

## Design

### Component 1 — Prompt scope hardening

**File:** `src/prompts.ts`

Two module-level constants become the single source of truth:

```ts
/** The only native memory location these prompts ever operate on. */
const NATIVE_MEMORY_ROOT = '.claude/projects/<slug>/memory/';

/** Exclusion guard for prompts that instruct native-memory writes. */
const SCOPE_GUARD = `**Scope is exact.** "Native memory" in this prompt means \`${NATIVE_MEMORY_ROOT}\` and nothing else. Never scan, read, or rewrite \`/memories/\` or any other assistant-level memory store under this instruction.`;
```

Four application sites:

| Site | Change |
|---|---|
| `migrate.description` (`:404`) | Gains the literal path. This is what `ListPrompts` returns before any argument exists — the earliest point the ambiguity can be resolved. |
| `migrate` headline (`:436`) | Path folded into the first sentence; `SCOPE_GUARD` appended immediately after. |
| `init` (`:302`) | Swap the inline literal for `${NATIVE_MEMORY_ROOT}`; append `SCOPE_GUARD`. Needed because `init`'s on-access rule (`:348`) instructs native-memory rewrites. |
| `disable` (`:262`) | Swap the literal for the const only. No guard — it instructs stopping, not sweeping. |

The native root stays hardcoded rather than parameterized. A `native_root` argument was considered and rejected: it adds an argument, a Zod field, and tests to two prompts, and a wrong value still misdirects the sweep. The exclusion is what closes the incident.

### Component 2 — Argument error clarity

**Files:** `src/tool-schemas.ts`, `src/index.ts`

Object shapes are named so the key list is derivable rather than restated:

```ts
const noteWorkflowShape = { action: …, note_path: …, /* … */ };
export const NoteWorkflowSchema = z.object(noteWorkflowShape).strict().superRefine(…);

const editNoteShape = { note_path: …, content: …, /* … */ };
export const EditNoteSchema = z.object(editNoteShape).strict().superRefine(…);

export const TOOL_KEYS: Record<string, string[]> = {
  note_workflow: Object.keys(noteWorkflowShape),
  edit_note: Object.keys(editNoteShape),
};

const PARAM_ALIASES: Record<string, string> = {
  new_string: 'content',   // Claude Code Edit tool
  old_string: 'find',      // Claude Code Edit tool
  file_path: 'note_path',  // Claude Code Edit/Write tools
  path: 'note_path',
};
```

The `…` elisions above stand for the existing field definitions and refinements, carried over unchanged. Naming the shapes is the only structural change; no field is added, removed, or retyped.

`.strict()` must be applied to the `ZodObject` **before** `.superRefine()` — the returned `ZodEffects` wrapper has no `.strict()` method. Zod emits `unrecognized_keys` during the object pass, ahead of refinements, so it lands at `issues[0]` and determines the message.

`PARAM_ALIASES` is global, but a hint is only emitted when the alias **target is a valid key for the tool that failed** — that is, when `TOOL_KEYS[toolName]` includes it. Otherwise the message falls back to the valid-key list. Without this condition, a tool whose shape lacks `note_path` could be told to rename `file_path` to a parameter it does not accept.

`formatToolError` keeps its `(toolName, error)` signature. It is called from a single catch-all (`index.ts:976`) that knows only the tool name and never which schema failed, so the valid-key list is looked up internally via `TOOL_KEYS[toolName]`; tools absent from the map simply omit that clause.

New behavior by issue code:

| Issue code | Output |
|---|---|
| `unrecognized_keys` | `note_workflow: unknown parameter "new_string" (did you mean "content"?)` — with no alias match, falls back to `(valid: action, note_path, content, …)` |
| `custom` | `note_workflow: invalid "content" (edit requires content)` — prints `issue.message` verbatim, no fabricated expected/received |
| all others | Unchanged `expected X, received Y` format, which is correct for those codes |

`index.ts` adds `additionalProperties: false` to the `note_workflow` (`:233`) and `edit_note` (`:445`) `inputSchema` blocks, so the advertised wire contract matches the new enforcement rather than rejecting keys it never declared forbidden.

### The through-line: derive, don't restate

Both components address one bug class — a fact written down twice, then one copy drifting. #10 is `init` keeping the path while `migrate` lost it. A hardcoded valid-key list would be a third copy of the parameter list. So every fact has exactly one home:

- Native memory path → one const, interpolated everywhere
- Valid keys → `Object.keys(shape)`
- Advertised JSON Schema → hand-written and **independent of Zod**; both copies currently agree (`note_workflow` 11 keys, `edit_note` 8) but nothing tests that, so a parity test is added

## Error handling

No new runtime failure modes. Both components are validation and static text.

`.strict()` converts a previously-silent discard into a returned error. That error follows the existing path: `formatToolError` at `index.ts:976`, returned as tool content with `isError` semantics unchanged. Callers already handle a rejected `note_workflow` call.

`SCOPE_GUARD` is a static string with no context calls, preserving the side-effect-free `GetPrompt` invariant.

## Testing

**Prompt invariants** (`src/prompts.test.ts`):

- Registry-derived: for every prompt in `MEMORY_PROMPTS`, if the rendered text matches `/native memory/i`, it must contain `NATIVE_MEMORY_ROOT`. Auto-covers any prompt added later. The invariant is deliberately slightly over-strict: a future prompt that mentions native memory only in passing would still be required to name the path. That is the intended trade — the phrase is what misled the agent.
- `init` and `migrate` each render `SCOPE_GUARD`.
- `migrate.description` contains `NATIVE_MEMORY_ROOT`.
- Existing fail-soft and side-effect-free assertions stay green.

**Argument errors** (`src/index.test.ts`):

- `new_string` on an `edit` action → message names `new_string` and suggests `content`.
- Unknown key with no alias → message names the key and lists valid keys.
- Missing `content` on `edit` → `invalid "content" (edit requires content)`, with no `received invalid value`.
- `invalid_type` → unchanged output; regression guard on the existing test at `index.test.ts:69`.
- Every alias target in `PARAM_ALIASES` is a valid key of at least one tool in `TOOL_KEYS` (catches an alias left pointing at a renamed or removed parameter).
- An alias whose target is not valid for the failing tool produces the valid-key fallback, not a misleading suggestion.

**Schema parity** (`src/index.test.ts`):

- Advertised `inputSchema.properties` keys equal `TOOL_KEYS[tool]` for `note_workflow` and `edit_note`.
- Both advertised schemas carry `additionalProperties: false`.

All 143 existing tests must stay green. `.strict()` is not expected to disturb them — `index.test.ts` passes only known keys.

## Parallel execution

Groups A, B, and C run as three concurrent branches off `main`, merged only at the end. The subsystems barely overlap in source:

| File | A | B | C | Merge risk |
|---|---|---|---|---|
| `src/index.ts` | `inputSchema` ~233, ~445 | `listByPrefix` ~600, handler ~664 | sync wiring ~96, `delete_note` ~832 | Low — disjoint regions |
| `src/prompts.ts`, `src/tool-schemas.ts` | ✓ | — | — | None |
| `src/smart-connections-loader.ts`, `src/note-writer.ts` | — | ✓ | — | None |
| `src/sync-scheduler.ts`, `src/git-manager.ts` | — | — | ✓ | None |
| `CHANGELOG.md` | ✓ | ✓ | ✓ | Small, predictable |
| `dist/**` (75 tracked files) | ✓ | ✓ | ✓ | **Guaranteed, unmergeable** |

**`dist/` is compiled output and is tracked in git.** Three branches each rebuilding it would conflict across ~75 generated files on every merge after the first, and such a conflict has no meaningful resolution — the only correct answer is to rebuild, never to merge hunks.

Therefore, on this branch:

- **Do not run `npm run build`. Do not stage `dist/`.** Commit steps stage `src/`, `docs/`, `README.md`, and `CHANGELOG.md` explicitly — never `git add -A`.
- `dist/` is knowingly left stale for the life of this branch. Tests run from `src/` via Vitest, so this does not affect verification.
- After all three branches merge, a single integration commit runs `npm run build` and stages `dist/` alone.

## Files

| File | Change |
|---|---|
| `src/prompts.ts` | Add two consts; apply at four sites |
| `src/prompts.test.ts` | Registry-derived invariant + guard assertions |
| `src/tool-schemas.ts` | Named shapes, `.strict()`, `TOOL_KEYS`, `PARAM_ALIASES`, `formatToolError` rewrite |
| `src/index.ts` | `additionalProperties: false` on two `inputSchema` blocks |
| `src/index.test.ts` | Error-branch and schema-parity tests |
| `README.md` | Document that unknown parameters are now rejected |
| `CHANGELOG.md` | Entry for the behavior change |
| `dist/` | **Not touched on this branch** — rebuilt once at integration |

## Risks

- **`.strict()` is a behavior change on a live tool.** A call that previously succeeded while carrying a stray key now fails. This is the intent — a silently dropped key on a write tool can mean data written wrong — but it warrants a CHANGELOG entry rather than a silent ship.
- **`dist/` is deliberately stale on this branch**, and the integration rebuild is the only thing that corrects it. The previous branch shipped a stale `dist/` through five commits before the final review caught it — the difference here is that staleness is intentional and has a named owner (the integration step), not an oversight. If the integration rebuild is skipped, the merged `main` ships source fixes with none of them compiled.

## Out of scope

- Issue #10 suggestion 2 (`metadata.vault_note` as the sole migration gate) is **already implemented** at `prompts.ts:440` and `:446`. No change.
- Issue #10 suggestion 3 (`scope` parameter on `note_workflow`) is dropped — a no-op against the real failure, per "The server cannot enforce this" above.
- Issue #10 suggestion 4 (confirmation gate before native-memory writes) is declined in favor of the hard exclusion, which does not cost a turn on every `migrate` run.
- Groups B (#4, #7) and C (#5, #8) — separate specs.
