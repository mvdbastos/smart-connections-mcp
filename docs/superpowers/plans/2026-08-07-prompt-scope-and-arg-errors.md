# Prompt Scope & Argument Error Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `migrate` prompt name the exact directory it sweeps, and make a wrong parameter name report what was actually wrong.

**Architecture:** Two independent components in one branch. Component 1 extracts the native memory path and a scope guard into module constants in `src/prompts.ts`, then interpolates them everywhere the path is mentioned — killing the copy-drift that caused #10. Component 2 names the Zod object shapes in `src/tool-schemas.ts` so valid keys derive from `Object.keys()`, adds `.strict()`, and rewrites `formatToolError` to branch on issue code.

**Tech Stack:** TypeScript (ESM, NodeNext), Zod 3.25, Vitest, MCP SDK.

**Spec:** `docs/superpowers/specs/2026-08-07-prompt-scope-and-arg-errors-design.md`

## Global Constraints

- **Branch:** `fix/prompt-scope-and-arg-errors`. Already exists and already contains the spec commits. Do not create it.
- **NEVER run `npm run build`. NEVER stage `dist/`.** `dist/` is tracked (75 files) and all three parallel branches compile into it. A single integration commit rebuilds it after all three merge. Stage explicitly: `git add src/ docs/ README.md CHANGELOG.md`. **Never `git add -A`.**
- **Never use `git commit -m` with PowerShell here-strings.** Use `git commit -F -` with a heredoc.
- Commit messages end with these two trailers:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01K4mPAWNTYd7DgX5zMuGLe6
  ```
- Run tests with `npx vitest run <path>` for a single file, `npx vitest run` for all.
- The full suite is 143 tests before this plan and must stay green.
- The native memory path literal is exactly `.claude/projects/<slug>/memory/` — with the literal angle brackets around `slug`, not a substitution.
- Tests import from `./tool-schemas.js` / `./prompts.js` (`.js` extension, NodeNext resolution) even though the sources are `.ts`.

---

### Task 1: Prompt scope constants

**Files:**
- Modify: `src/prompts.ts`
- Test: `src/prompts.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: module-private `NATIVE_MEMORY_ROOT: string` and `SCOPE_GUARD: string` in `src/prompts.ts`. Not exported — tests assert against the literal path string, so the invariant test fails if the const is ever changed to something wrong.

- [ ] **Step 1: Hoist the shared test args to describe scope**

In `src/prompts.test.ts`, the `testArgs` object currently lives inside the `'all prompts should mention note_workflow in their content'` test (around line 44). Move it so later tests can use it. Directly after the `describe('prompts', () => {` line, insert:

```ts
  const testArgs: Record<string, Record<string, unknown>> = {
    capture_memory: { topic: 'test' },
    project_research: { topic: 'test' },
    cleanup_stale: { query: 'test' },
    daily_note: {},
    review_before_write: { note_path: 'test.md' },
    disable: {},
    init: {},
    migrate: {},
  };

  const emptyContext: PromptContext = { search: async () => [] as SearchResult[] };
```

Then delete the now-duplicated `const testArgs ... };` block and the `mockSearch`/`context` lines from inside that test, and change its body to use `emptyContext`:

```ts
  it('all prompts should mention note_workflow in their content', async () => {
    for (const prompt of MEMORY_PROMPTS) {
      const args = testArgs[prompt.name] || {};
      const text = await prompt.build(args, emptyContext);
      expect(text).toMatch(/note_workflow/i);
    }
  });
```

- [ ] **Step 2: Run the suite to confirm the refactor is neutral**

Run: `npx vitest run src/prompts.test.ts`
Expected: PASS, same number of tests as before.

- [ ] **Step 3: Write the failing invariant test**

Append inside `describe('prompts', ...)` in `src/prompts.test.ts`:

```ts
  const NATIVE_MEMORY_PATH_LITERAL = '.claude/projects/<slug>/memory/';

  it('every prompt that mentions native memory names the exact path', async () => {
    for (const prompt of MEMORY_PROMPTS) {
      const text = await prompt.build(testArgs[prompt.name] ?? {}, emptyContext);
      if (/native memory/i.test(text)) {
        expect(
          text,
          `prompt "${prompt.name}" mentions native memory without naming ${NATIVE_MEMORY_PATH_LITERAL}`
        ).toContain(NATIVE_MEMORY_PATH_LITERAL);
      }
    }
  });

  it('init and migrate both carry the scope guard', async () => {
    for (const name of ['init', 'migrate']) {
      const prompt = MEMORY_PROMPT_BY_NAME.get(name);
      expect(prompt, `prompt "${name}" is missing`).toBeDefined();
      const text = await prompt!.build(testArgs[name] ?? {}, emptyContext);
      expect(text, `prompt "${name}" is missing the scope guard`).toContain('**Scope is exact.**');
      expect(text).toContain('/memories/');
    }
  });

  it('migrate description names the native memory path', () => {
    const migrate = MEMORY_PROMPT_BY_NAME.get('migrate');
    expect(migrate).toBeDefined();
    expect(migrate!.description).toContain(NATIVE_MEMORY_PATH_LITERAL);
  });
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/prompts.test.ts`
Expected: FAIL. The invariant test fails on `migrate` (its body says "native memory directory" with no path). The scope-guard test fails on both `init` and `migrate`. The description test fails.

- [ ] **Step 5: Add the constants**

In `src/prompts.ts`, directly after the `MemoryPrompt` interface closing brace (currently line 31) and before the `// Zod schemas for argument validation` comment, insert:

```ts
/** The only native memory location these prompts ever operate on. */
const NATIVE_MEMORY_ROOT = '.claude/projects/<slug>/memory/';

/** Exclusion guard for prompts that instruct native-memory writes. */
const SCOPE_GUARD = `**Scope is exact.** "Native memory" in this prompt means \`${NATIVE_MEMORY_ROOT}\` and nothing else. Never scan, read, or rewrite \`/memories/\` or any other assistant-level memory store under this instruction.`;
```

- [ ] **Step 6: Apply to the `init` prompt**

In `src/prompts.ts`, replace this line (currently line 302):

```ts
You keep memory in two tiers. The **Obsidian vault is the system of record** — it holds the full text of every memory. Your native memory directory (\`.claude/projects/<slug>/memory/\`) holds only a **stub**: name, description, and a \`vault_note\` pointer. Native answers "is there something relevant here?"; the vault answers "what does it say?"${projectNote}${existing}
```

with:

```ts
You keep memory in two tiers. The **Obsidian vault is the system of record** — it holds the full text of every memory. Your native memory directory (\`${NATIVE_MEMORY_ROOT}\`) holds only a **stub**: name, description, and a \`vault_note\` pointer. Native answers "is there something relevant here?"; the vault answers "what does it say?"

${SCOPE_GUARD}${projectNote}${existing}
```

- [ ] **Step 7: Apply to the `migrate` description**

Replace (currently line 404):

```ts
    description: 'Sweep this project\'s native memory files into the vault, leaving recall stubs behind.',
```

with:

```ts
    description: `Sweep this project's native memory files (${NATIVE_MEMORY_ROOT}) into the vault, leaving recall stubs behind.`,
```

- [ ] **Step 8: Apply to the `migrate` body**

Replace (currently line 436):

```ts
      return `Sweep your native memory directory and move every unmigrated memory into the Obsidian vault. The vault becomes the full record; each native file is reduced to a stub that still drives recall.${projectNote}${alreadyThere}
```

with:

```ts
      return `Sweep your native memory directory (\`${NATIVE_MEMORY_ROOT}\`) and move every unmigrated memory into the Obsidian vault. The vault becomes the full record; each native file is reduced to a stub that still drives recall.

${SCOPE_GUARD}${projectNote}${alreadyThere}
```

Then replace the hardcoded path further down (currently line 440):

```ts
List every \`.md\` file in \`.claude/projects/<slug>/memory/\` except \`MEMORY.md\`, and read each one's frontmatter.
```

with:

```ts
List every \`.md\` file in \`${NATIVE_MEMORY_ROOT}\` except \`MEMORY.md\`, and read each one's frontmatter.
```

- [ ] **Step 9: Apply to the `disable` prompt**

Replace the path in the `## Known limitation` paragraph (currently line 262):

```ts
This cannot stop Claude Code's built-in memory system from writing to \`.claude/projects/<slug>/memory/\`.
```

with:

```ts
This cannot stop Claude Code's built-in memory system from writing to \`${NATIVE_MEMORY_ROOT}\`.
```

Leave the rest of that paragraph unchanged. `disable` gets no `SCOPE_GUARD` — it instructs stopping, not sweeping.

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npx vitest run src/prompts.test.ts`
Expected: PASS, all tests including the three new ones.

- [ ] **Step 11: Run the full suite**

Run: `npx vitest run`
Expected: PASS. No test outside `prompts.test.ts` should change.

- [ ] **Step 12: Commit**

```bash
git add src/prompts.ts src/prompts.test.ts
git commit -F - <<'EOF'
fix: name the native memory path in every prompt that references it

The migrate prompt instructed sweeping "your native memory directory"
with no path; the exact location appeared two paragraphs later. An agent
acting on the headline had nothing to disambiguate it from any other
memory store its runtime exposes, and in one reported case resolved it to
an assistant-level /memories/ store.

init did not have this defect -- it already named the path in the same
sentence. The two prompts were written as independent prose and migrate
lost the path, so the fix is to give the fact one home: a
NATIVE_MEMORY_ROOT const interpolated everywhere, plus a SCOPE_GUARD
block on the two prompts that instruct writes.

A registry-derived test now fails if any prompt mentions native memory
without naming the path, which covers prompts added later.

Closes #10

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K4mPAWNTYd7DgX5zMuGLe6
EOF
```

---

### Task 2: Strict schemas and argument error clarity

**Files:**
- Modify: `src/tool-schemas.ts`
- Test: `src/index.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `export const TOOL_KEYS: Record<string, string[]>` — keyed by tool name (`'note_workflow'`, `'edit_note'`), value is that tool's valid parameter names derived from the Zod shape.
  - `formatToolError(toolName: string, error: unknown): string` — signature unchanged; behavior extended. Task 3 imports `TOOL_KEYS`.

- [ ] **Step 1: Write the failing tests**

Append to `src/index.test.ts`:

```ts
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
```

Update the import at the top of `src/index.test.ts` from:

```ts
import { EditNoteSchema, NoteWorkflowSchema, formatToolError } from './tool-schemas.js';
```

to:

```ts
import { EditNoteSchema, NoteWorkflowSchema, TOOL_KEYS, formatToolError } from './tool-schemas.js';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/index.test.ts`
Expected: FAIL. `TOOL_KEYS` does not exist (TypeScript error), and the unknown-parameter cases currently parse successfully because the schemas are not strict.

- [ ] **Step 3: Rewrite `src/tool-schemas.ts`**

Replace the entire file with:

```ts
import { z, ZodError, ZodIssueCode } from 'zod';

const editNoteShape = {
  note_path: z.string().describe('Path to the note, relative to the vault'),
  content: z.string().describe('Markdown content to write, append, insert, or use as replacement'),
  mode: z
    .enum(['overwrite', 'append', 'append-section', 'replace', 'insert-after-heading'])
    .default('append')
    .describe('Edit mode'),
  heading: z.string().optional().describe('Heading used for append-section or insert-after-heading mode'),
  find: z.string().optional().describe('Text or regex pattern to find in replace mode'),
  regex: z.boolean().optional().describe('Treat find as a regular expression in replace mode'),
  count: z.number().int().positive().optional().describe('Maximum number of replacements'),
  dry_run: z.boolean().optional().describe('Preview diff and hashes without writing'),
};

export const EditNoteSchema = z
  .object(editNoteShape)
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === 'replace' && !value.find) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['find'],
        message: 'replace mode requires find',
      });
    }

    if (value.mode === 'insert-after-heading' && !value.heading) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['heading'],
        message: 'insert-after-heading mode requires heading',
      });
    }
  });

const noteWorkflowShape = {
  action: z.enum(['create', 'edit', 'delete']).describe('Workflow action'),
  note_path: z.string().describe('Path to the note, relative to the vault'),
  content: z.string().optional().describe('Markdown content; required for create and edit'),
  frontmatter: z.record(z.unknown()).optional().describe('Optional frontmatter fields (create only)'),
  mode: z
    .enum(['overwrite', 'append', 'append-section', 'replace', 'insert-after-heading'])
    .default('append')
    .describe('Edit mode (edit action only)'),
  heading: z.string().optional().describe('Heading for append-section or insert-after-heading mode'),
  find: z.string().optional().describe('Text or regex pattern to find in replace mode'),
  regex: z.boolean().optional().describe('Treat find as a regular expression in replace mode'),
  count: z.number().int().positive().optional().describe('Maximum number of replacements'),
  dry_run: z.boolean().optional().describe('Preview the edit diff without writing (edit action only)'),
  defer_hint_seconds: z
    .number()
    .int()
    .positive()
    .max(1800)
    .optional()
    .describe('Hold auto-commit for at least this many seconds because more writes are coming'),
};

export const NoteWorkflowSchema = z
  .object(noteWorkflowShape)
  .strict()
  .superRefine((value, ctx) => {
    if ((value.action === 'create' || value.action === 'edit') && value.content === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: `${value.action} requires content`,
      });
    }

    if (value.action === 'edit' && value.mode === 'replace' && !value.find) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['find'],
        message: 'replace mode requires find',
      });
    }

    if (value.action === 'edit' && value.mode === 'insert-after-heading' && !value.heading) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['heading'],
        message: 'insert-after-heading mode requires heading',
      });
    }
  });

/**
 * Valid parameter names per tool, derived from the Zod shapes so the list can
 * never drift from what the schema actually accepts.
 */
export const TOOL_KEYS: Record<string, string[]> = {
  note_workflow: Object.keys(noteWorkflowShape),
  edit_note: Object.keys(editNoteShape),
};

/**
 * Parameter names callers reach for out of habit, mapped to the real ones.
 * Sourced from Claude Code's own Edit and Write tool signatures.
 */
const PARAM_ALIASES: Record<string, string> = {
  new_string: 'content',
  old_string: 'find',
  file_path: 'note_path',
  path: 'note_path',
};

export function formatToolError(toolName: string, error: unknown): string {
  if (error instanceof ZodError) {
    if (error.issues.length === 0) {
      return `${toolName}: validation failed`;
    }

    const issue = error.issues[0];
    const validKeys = TOOL_KEYS[toolName];

    if (issue.code === ZodIssueCode.unrecognized_keys) {
      const unknown = issue.keys[0];
      const alias = PARAM_ALIASES[unknown];

      if (alias && validKeys?.includes(alias)) {
        return `${toolName}: unknown parameter "${unknown}" (did you mean "${alias}"?)`;
      }

      const validList = validKeys ? ` (valid: ${validKeys.join(', ')})` : '';
      return `${toolName}: unknown parameter "${unknown}"${validList}`;
    }

    const field = issue.path.length ? issue.path.join('.') : 'arguments';

    if (issue.code === ZodIssueCode.custom) {
      return `${toolName}: invalid "${field}" (${issue.message})`;
    }

    const expected = 'expected' in issue ? String(issue.expected) : issue.message ?? 'valid value';
    const received = 'received' in issue ? String(issue.received) : 'invalid value';

    return `${toolName}: invalid "${field}" (expected ${expected}, received ${received})`;
  }

  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/index.test.ts`
Expected: PASS, including the pre-existing `formatToolError` test at the top of that describe block (the `invalid_type` path is unchanged).

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS. If any test fails because it passed an extra key to one of these two schemas, that test was relying on silent key-dropping — fix the test to pass only valid keys.

- [ ] **Step 6: Commit**

```bash
git add src/tool-schemas.ts src/index.test.ts
git commit -F - <<'EOF'
fix: name unknown parameters instead of blaming the missing one

Two defects compounded. formatToolError had no branch for Zod custom
issues, which carry no expected/received, so the fallbacks produced
"expected <the message itself>, received invalid value" -- reading as if
the supplied value was rejected when the field was in fact absent. And
neither schema was strict, so an unknown key was silently discarded and
never appeared in the error at all.

Passing new_string instead of content therefore reported only that
content was required, never mentioning new_string.

Shapes are now named so valid keys derive from Object.keys() rather than
being restated, both schemas are strict, and formatToolError branches on
issue code. An alias table maps the Claude Code Edit/Write parameter
names callers reach for out of habit, but only suggests a target that is
actually valid for the failing tool.

Closes #6

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K4mPAWNTYd7DgX5zMuGLe6
EOF
```

---

### Task 3: Extract tool definitions and assert schema parity

**Files:**
- Create: `src/tool-definitions.ts`
- Modify: `src/index.ts`
- Test: `src/index.test.ts`

**Interfaces:**
- Consumes: `TOOL_KEYS` from Task 2.
- Produces: `export const tools: Tool[]` in `src/tool-definitions.ts`.

**Why this task exists.** The spec calls for a test asserting the advertised `inputSchema` matches the Zod shape. That test cannot be written today: the `tools` array is module-local to `src/index.ts`, and importing `src/index.ts` from a test would execute its top-level side effects — it constructs the MCP server and connects a stdio transport (`src/index.ts:126-143`). Extracting the array to its own module is the smallest change that makes the advertised schema testable, and it also trims ~310 lines from a ~1000-line file.

**Merge note.** This is the only structural change across all three branches. Branch A should merge to `main` before B and C for this reason.

- [ ] **Step 1: Create the new module**

Create `src/tool-definitions.ts`. Cut the entire `const tools: Tool[] = [ ... ];` array from `src/index.ts` (currently starting at line 228) and paste it into the new file, changing `const` to `export const`:

```ts
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const tools: Tool[] = [
  // ... the complete array, moved verbatim from src/index.ts ...
];
```

Move the array **verbatim** — do not reformat, reorder, or reword any tool description. The only edits to its contents happen in Step 3.

- [ ] **Step 2: Import it back into `src/index.ts`**

Add to the imports in `src/index.ts`:

```ts
import { tools } from './tool-definitions.js';
```

Remove the now-unused `Tool` type import from `src/index.ts` if nothing else there uses it. Leave every `ListToolsRequestSchema` handler reference to `tools` untouched.

- [ ] **Step 3: Add `additionalProperties: false` to both schemas**

In `src/tool-definitions.ts`, in the `note_workflow` entry, change the close of its `inputSchema` from:

```ts
      required: ['action', 'note_path'],
    },
```

to:

```ts
      required: ['action', 'note_path'],
      additionalProperties: false,
    },
```

Make the identical change to the `edit_note` entry, whose `inputSchema` currently ends:

```ts
      required: ['note_path', 'content'],
    },
```

- [ ] **Step 4: Write the parity test**

Append to `src/index.test.ts`:

```ts
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
```

Add to the imports at the top of `src/index.test.ts`:

```ts
import { tools } from './tool-definitions.js';
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/index.test.ts`
Expected: PASS. The parity assertion should pass immediately — the two lists already agree (`note_workflow` 11 keys, `edit_note` 8). If it fails, the move in Step 1 dropped or altered a property; fix the move, not the test.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. This is the check that the extraction did not break imports — remember that `npm run build` is forbidden on this branch.

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/tool-definitions.ts src/index.ts src/index.test.ts
git commit -F - <<'EOF'
refactor: extract tool definitions and assert schema parity

The advertised JSON Schema for each tool is hand-written and entirely
independent of the Zod schema that actually validates the arguments. Two
hand-maintained copies of the same parameter list, with nothing testing
that they agree.

They did agree, by care rather than by construction. Now a test enforces
it -- which required moving the tools array out of index.ts, since
importing index.ts from a test would construct the MCP server and connect
a stdio transport. The move also trims roughly 310 lines from a
1000-line file.

Both write tools now advertise additionalProperties: false, so the wire
contract matches the strict validation added in the previous commit
rather than rejecting keys it never declared forbidden.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K4mPAWNTYd7DgX5zMuGLe6
EOF
```

---

### Task 4: Document the behavior change

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: the behavior established in Tasks 2 and 3.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Read the existing CHANGELOG format**

Run: `head -40 CHANGELOG.md`
Match the heading style, date format, and section names already in use. Do not invent a new format.

- [ ] **Step 2: Add the CHANGELOG entry**

Add a new entry at the top of the version list, following the format observed in Step 1. Content to convey:

- **Changed (breaking):** `note_workflow` and `edit_note` now reject unknown parameters instead of silently discarding them. A call carrying a stray or misspelled key now fails with an error naming that key. Previously the key was dropped and the call proceeded, which on a write tool could mean content written in the wrong mode or to the wrong place.
- **Fixed:** argument errors no longer fabricate a "received" value for missing-field errors (#6).
- **Fixed:** the `migrate` prompt now names `.claude/projects/<slug>/memory/` in its opening instruction and its description, and both `init` and `migrate` now explicitly exclude `/memories/` and other assistant-level memory stores (#10).

- [ ] **Step 3: Update the README**

Find the section documenting `note_workflow` parameters. Add a sentence stating that unknown parameters are rejected, and that the error names the offending key and suggests the correct one where a common alias is recognised. If the README has no such section, add the note to the `note_workflow` tool description wherever it is documented. Do not restructure the README.

- [ ] **Step 4: Verify nothing else changed**

Run: `git status --short`
Expected: only `CHANGELOG.md` and `README.md` modified. **`dist/` must not appear.** If it does, you ran a build — `git checkout -- dist/` and do not run `npm run build` again.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md README.md
git commit -F - <<'EOF'
docs: record the strict-argument behavior change

Rejecting unknown parameters is a behavior change on a live tool: a call
that previously succeeded while carrying a stray key now fails. That is
the intent -- a silently dropped key on a write tool can mean data
written wrong -- but it warrants an explicit changelog entry rather than
a silent ship.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K4mPAWNTYd7DgX5zMuGLe6
EOF
```

---

## Done criteria

- [ ] `npx vitest run` passes; total is 143 + 12 new tests (3 in Task 1, 5 in Task 2, 4 in Task 3).
- [ ] `npx tsc --noEmit` reports no errors.
- [ ] `git status --short` is clean and `dist/` was never staged.
- [ ] `git log --oneline main..HEAD` shows the two spec commits plus four implementation commits.
