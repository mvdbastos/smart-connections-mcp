import { z } from 'zod';

export interface SearchResult {
  path: string;
  score: number;
}

export interface PromptContext {
  search: (query: string, limit: number, threshold: number) => Promise<SearchResult[]>;
  /**
   * Optional. Lists vault-relative note paths beginning with `prefix`.
   * Every returned path is verified to exist on disk, so results no longer
   * include notes that were moved or deleted. Freshly written notes may
   * still lag until reindex, so the listing can be incomplete — and
   * `metadata.vault_note` remains the only authoritative migration check.
   */
  listByPrefix?: (prefix: string) => Promise<string[]>;
}

export interface MemoryPromptArgument {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  description: string;
}

export interface MemoryPrompt {
  name: string;
  description: string;
  arguments: MemoryPromptArgument[];
  build: (args: Record<string, unknown>, ctx: PromptContext) => Promise<string>;
}

/** The only native memory location these prompts ever operate on. */
const NATIVE_MEMORY_ROOT = '.claude/projects/<slug>/memory/';

/** Exclusion guard for prompts that instruct native-memory writes. */
const SCOPE_GUARD = `**Scope is exact.** "Native memory" in this prompt means \`${NATIVE_MEMORY_ROOT}\` and nothing else. Never scan, read, or rewrite \`/memories/\` or any other assistant-level memory store under this instruction.`;

// Zod schemas for argument validation
const CaptureMemoryArgsSchema = z.object({
  topic: z.string().min(1, 'topic required'),
  tags: z.string().optional(),
});

const ProjectResearchArgsSchema = z.object({
  topic: z.string().min(1, 'topic required'),
});

const CleanupStaleArgsSchema = z.object({
  query: z.string().min(1, 'query required'),
});

const DailyNoteArgsSchema = z.object({
  heading: z.string().optional(),
});

const ReviewBeforeWriteArgsSchema = z.object({
  note_path: z.string().min(1, 'note_path required'),
});

const InitArgsSchema = z.object({
  project: z.string().optional(),
});

const MigrateArgsSchema = z.object({
  project: z.string().optional(),
});

function formatSearchHits(hits: SearchResult[]): string {
  if (hits.length === 0) return '';
  return hits.map((hit) => `- ${hit.path} (${hit.score.toFixed(2)})`).join('\n');
}

export const MEMORY_PROMPTS: MemoryPrompt[] = [
  {
    name: 'capture_memory',
    description: 'Create and persist a new memory note in the vault.',
    arguments: [
      { name: 'topic', type: 'string', required: true, description: 'Topic or title for the memory' },
      { name: 'tags', type: 'string', required: false, description: 'Comma-separated tags (e.g., "research, active")' },
    ],
    build: async (args, ctx) => {
      const parsed = CaptureMemoryArgsSchema.parse(args);
      const { topic, tags } = parsed;

      // Pre-fetch to avoid duplicates
      let dedupHits = '';
      try {
        const hits = await ctx.search(topic, 3, 0.6);
        if (hits.length > 0) {
          dedupHits = `\n\n**Existing notes on this topic:**\n${formatSearchHits(hits)}\n\nReview these before proceeding to avoid duplication.`;
        }
      } catch {
        // Fail soft; continue with plain instructions
      }

      const tagsBlock = tags ? `\n  tags: [${tags.split(',').map((t) => `'${t.trim()}'`).join(', ')}]` : '';

      return `Capture a new memory note on "${topic}".${dedupHits}

1. If a matching note exists, consider editing it instead (see review_before_write prompt).
2. Create a new note via note_workflow:
   - note_path: Vault-relative path (e.g., "Research/Topic.md")
   - content: Markdown content with clear sections
   - frontmatter: { tags: ['${topic}']${tagsBlock ? tagsBlock : ''} }
3. Example call:
   \`\`\`
   note_workflow
     action: 'create'
     note_path: 'Research/${topic}.md'
     content: '# ${topic}\\n\\n...'
     frontmatter: { tags: ['${topic}'] }
   \`\`\`
4. The note will auto-commit in 30s and auto-push in 2min.`;
    },
  },
  {
    name: 'project_research',
    description: 'Build context by searching and reading existing notes on a topic.',
    arguments: [{ name: 'topic', type: 'string', required: true, description: 'Topic to research' }],
    build: async (args, ctx) => {
      const parsed = ProjectResearchArgsSchema.parse(args);
      const { topic } = parsed;

      let seedNotes = '';
      try {
        const hits = await ctx.search(topic, 5, 0.4);
        if (hits.length > 0) {
          seedNotes = `\n\n**Seed notes (existing research):**\n${formatSearchHits(hits)}`;
        }
      } catch {
        // Fail soft
      }

      return `Research "${topic}" to build context before answering.${seedNotes}

**Steps:**
1. Use get_note_content to read the highest-scoring notes above.
2. Use get_similar_notes on the best seed to expand your context.
3. Identify gaps or contradictions in the existing notes.
4. Add new findings via note_workflow:
   \`\`\`
   note_workflow
     action: 'create'  # or 'edit' to update a seed note
     note_path: 'Research/${topic}-findings.md'
     content: '# Findings for ${topic}\\n\\n...'
   \`\`\`

Let the auto-sync handle commit and push.`;
    },
  },
  {
    name: 'cleanup_stale',
    description: 'Identify and safely remove obsolete or stale notes.',
    arguments: [{ name: 'query', type: 'string', required: true, description: 'Search query for stale material (e.g., "deprecated", "old draft")' }],
    build: async (args, ctx) => {
      const parsed = CleanupStaleArgsSchema.parse(args);
      const { query } = parsed;

      let candidates = '';
      try {
        const hits = await ctx.search(query, 8, 0.35);
        if (hits.length > 0) {
          candidates = `\n\n**Candidates for removal:**\n${formatSearchHits(hits)}`;
        }
      } catch {
        // Fail soft
      }

      return `Clean up stale or obsolete notes matching "${query}".${candidates}

**Steps:**
1. Use get_note_content to review each candidate above.
2. Confirm deletion is safe (e.g., content is obsolete, better info exists elsewhere).
3. Delete via note_workflow:
   \`\`\`
   note_workflow
     action: 'delete'
     note_path: 'Path/To/Stale/Note.md'
   \`\`\`
4. Repeat for other candidates.
5. Auto-sync will commit and push deletions.`;
    },
  },
  {
    name: 'daily_note',
    description: 'Append a dated section to a daily note.',
    arguments: [{ name: 'heading', type: 'string', required: false, description: "Optional heading for the new section (default: today's date)" }],
    build: async (args, ctx) => {
      const parsed = DailyNoteArgsSchema.parse(args);
      const { heading } = parsed;

      const today = new Date().toISOString().split('T')[0];
      const sectionHeading = heading || today;

      return `Append a new section to your daily note.

1. Get the current daily note:
   \`\`\`
   get_note_content note_path: 'Daily/Daily.md'  # adjust path as needed
   \`\`\`
2. Append a new section via note_workflow:
   \`\`\`
   note_workflow
     action: 'edit'
     note_path: 'Daily/Daily.md'
     mode: 'append-section'
     heading: '${sectionHeading}'
     content: 'Your content here...'
   \`\`\`
3. Auto-sync handles commit and push.`;
    },
  },
  {
    name: 'review_before_write',
    description: 'Read a note before editing to ensure safe changes.',
    arguments: [{ name: 'note_path', type: 'string', required: true, description: 'Path to the note to review' }],
    build: async (args, ctx) => {
      const parsed = ReviewBeforeWriteArgsSchema.parse(args);
      const { note_path } = parsed;

      return `Review a note before making changes.

**Steps:**
1. Read the current content:
   \`\`\`
   get_note_content note_path: '${note_path}'
   \`\`\`
2. Decide on the edit mode:
   - \`overwrite\`: Replace entire note
   - \`append\`: Add text at the end
   - \`append-section\`: Add a new headed section
   - \`replace\`: Find and replace text (supports regex)
   - \`insert-after-heading\`: Insert text after a specific heading

3. Make the edit via note_workflow:
   \`\`\`
   note_workflow
     action: 'edit'
     note_path: '${note_path}'
     mode: 'append'  # or other mode
     content: 'New content...'
     # dry_run: true  # preview the change first
   \`\`\`

Auto-sync will commit and push your changes.`;
    },
  },
  {
    name: 'disable',
    description: 'Suspend autonomous memory capture and migration for the rest of this conversation.',
    arguments: [],
    build: async () => {
      return `Autonomous memory capture is now **OFF** for the rest of this conversation.

## Stop doing

- Do not capture preferences, constraints, or decisions on your own initiative.
- Do not migrate native memory files into the vault when you read them.
- Make no \`note_workflow\` calls unless I explicitly ask for a specific note.

## Keep doing

Read tools remain fully available — \`search_notes\`, \`get_note_content\`, \`get_similar_notes\`, \`get_connection_graph\`, \`get_embedding_neighbors\`, and \`get_stats\` all work normally. This switch governs writes, not reads. Keep using the vault to answer questions.

## Known limitation

This cannot stop Claude Code's built-in memory system from writing to \`${NATIVE_MEMORY_ROOT}\`. That behavior lives in the harness, not in the vault server. Memories written while capture is off land there as ordinary full files with no \`vault_note\` field, which makes them migration backlog — the \`migrate\` prompt or the on-access rule will collect them later. Nothing is lost.

Run the \`init\` prompt again to re-enable autonomous capture.`;
    },
  },
  {
    name: 'init',
    description: 'Load standing rules for capturing durable memory into the vault, with the native side reduced to recall stubs.',
    arguments: [
      {
        name: 'project',
        type: 'string',
        required: false,
        description: 'Vault folder name for this project (default: derived from the working directory basename)',
      },
    ],
    build: async (args, ctx) => {
      const parsed = InitArgsSchema.parse(args);
      const project = parsed.project ?? '<project>';
      const memoryRoot = `Memory/${project}`;
      const today = new Date().toISOString().split('T')[0];

      const projectNote = parsed.project
        ? ''
        : `\n\n**First, resolve \`<project>\`.** Take the basename of your working directory — for \`C:\\obsidian\` that is \`obsidian\`, for \`c:\\dev\\00-ProWMS\\pro-wms\` that is \`pro-wms\`. Substitute it for \`<project>\` everywhere below. If \`Memory/MEMORY.md\` already maps your project slug to a different folder name, use that name instead.`;

      let existing = '';
      try {
        if (ctx.listByPrefix) {
          const paths = await ctx.listByPrefix('Memory/');
          if (paths.length > 0) {
            existing = `\n\n**Memories already in the vault:**\n${paths.map((notePath) => `- ${notePath}`).join('\n')}\n\nCheck these before capturing anything new. This listing lags behind recent writes, so treat it as a hint only.`;
          }
        }
      } catch {
        // Fail soft; continue with plain instructions
      }

      return `Autonomous memory capture is now **ACTIVE**.

You keep memory in two tiers. The **Obsidian vault is the system of record** — it holds the full text of every memory. Your native memory directory (\`${NATIVE_MEMORY_ROOT}\`) holds only a **stub**: name, description, and a \`vault_note\` pointer. Native answers "is there something relevant here?"; the vault answers "what does it say?"

${SCOPE_GUARD}${projectNote}${existing}

## When to capture

- **\`preference\`** — I correct or reject an approach you proposed, or state a standing rule ("we always X", "never Y here").
- **\`constraint\`** — a non-obvious environmental or policy limit surfaces (access, tooling, deadlines, org rules).
- **\`decision\`** — a choice is made whose rationale will not be obvious from the code later.
- **\`reference\`** — a root cause or mechanism that took real work to find.

## Detecting disagreement

The highest-value trigger and the easiest to miss.

**Explicit signals:** "no", "don't", "instead", "I'd rather", "we don't do that here", "that's wrong".

**Implicit signals:** I revert or rewrite a change you just made; I hand you my own version of code you just wrote; I re-ask a question you already answered.

**Then apply the classifying test** — is the disagreement about *this instance*, or about *how things should be done generally*?

- This instance only: transient. Do not capture.
- General: durable. Capture as \`preference\`, recording my reasoning under **Why:** and the behavioral change under **How to apply:**.

Ask one clarifying question only when the answer is genuinely ambiguous **and** would change your future behavior. Otherwise infer and capture silently.

## When not to capture

- One-off instructions scoped to the current task.
- Anything derivable from the repo, git history, or existing docs.
- A restatement of an existing memory — edit that note instead.
- Secrets, credentials, tokens, or personal data.

Capture at a task boundary, never mid-step.

## How to capture

1. **Dedupe.** \`search_notes\` for the topic at \`threshold: 0.6\`. If an existing memory covers it, edit that note instead of creating a second.
2. **Write the vault note** with \`note_workflow action: 'create'\` at \`${memoryRoot}/<Title>.md\`, using the template below.
3. **Write the native stub** with your own Write tool at \`.claude/projects/<slug>/memory/<name>.md\`, using the stub template below.
4. **Append to the vault index** \`${memoryRoot}/MEMORY.md\` — \`note_workflow action: 'create'\` seeded with a \`# Memory Index\` heading if that file does not exist yet, otherwise \`action: 'edit', mode: 'append'\`. An \`edit\` against a missing note fails, so check first.
5. **Append to your native \`MEMORY.md\`** in the usual \`- [Title](file.md) — hook\` format.
6. **Ensure the root index has an entry.** If \`Memory/MEMORY.md\` has no line for this project, append one — \`note_workflow action: 'create'\` seeded with a \`# Memory Index\` heading if the file doesn't exist yet, otherwise \`action: 'edit', mode: 'append'\`.

Order matters: vault note before stub. A stub is a pointer; writing one before its target exists creates a dangling reference. If the stub write fails after the vault note lands, re-run step 3 — the vault note is already correct.

## Migrating on access

Whenever you use a native memory whose frontmatter has **no \`vault_note\` field**, migrate it before acting on it — move its body to the vault, rewrite the file as a stub, add a line to the vault index. Leave your native \`MEMORY.md\` untouched; its link still resolves. Run the \`migrate\` prompt to sweep the whole backlog at once.

## Vault note template

\`\`\`markdown
---
title: "No commit trailers"
date: "${today}"
topic: "git workflow"
type: preference
project_slug: c--dev-00-ProWMS-pro-wms
native_file: feedback_no_commit_trailers.md
tags: ["memory", "agent-captured", "git"]
---

One or two sentences stating the rule.

**Why:** the reasoning I gave, and when I gave it.

**How to apply:** what you do differently next time.

Related: [[Another Memory Note]]
\`\`\`

Use absolute dates, never "yesterday" or "last week". \`project_slug\` plus \`native_file\` reconstruct the native path exactly, so the vault folder can be renamed freely.

## Native stub template

\`\`\`markdown
---
name: feedback-no-commit-trailers
description: "One line — this is what makes the memory findable later. Keep it specific."
metadata:
  node_type: memory
  type: preference
  originSessionId: <existing or current session id>
  modified: <ISO timestamp — preserved byte-for-byte when migrating, current time when capturing fresh>
  vault_note: "${memoryRoot}/No Commit Trailers.md"
  migrated: "${today}"
---

Full content lives in the Obsidian vault at \`${memoryRoot}/No Commit Trailers.md\`.
Read it with \`get_note_content\` before acting on this memory.
\`\`\`

\`migrated\` is an informational timestamp only — \`vault_note\` presence is still the sole thing that gates migration behavior anywhere in this system.

## Etiquette

Capture silently — one short line of acknowledgment at most, and never interrupt what you are doing. Batch captures with \`defer_hint_seconds: 120\` on every write but the last, so a run of them produces one commit.

Run the \`disable\` prompt to switch this off for the rest of the conversation.`;
    },
  },
  {
    name: 'migrate',
    description: `Sweep this project's native memory files (${NATIVE_MEMORY_ROOT}) into the vault, leaving recall stubs behind.`,
    arguments: [
      {
        name: 'project',
        type: 'string',
        required: false,
        description: 'Vault folder name for this project (default: derived from the working directory basename)',
      },
    ],
    build: async (args, ctx) => {
      const parsed = MigrateArgsSchema.parse(args);
      const project = parsed.project ?? '<project>';
      const memoryRoot = `Memory/${project}`;
      const today = new Date().toISOString().split('T')[0];

      const projectNote = parsed.project
        ? ''
        : `\n\n**First, resolve \`<project>\`.** Take the basename of your working directory — for \`C:\\obsidian\` that is \`obsidian\`, for \`c:\\dev\\00-ProWMS\\pro-wms\` that is \`pro-wms\`. Substitute it for \`<project>\` everywhere below. If \`Memory/MEMORY.md\` already maps your project slug to a different folder name, use that name instead.`;

      let alreadyThere = '';
      try {
        if (ctx.listByPrefix) {
          const listPrefix = parsed.project ? `${memoryRoot}/` : 'Memory/';
          const paths = await ctx.listByPrefix(listPrefix);
          if (paths.length > 0) {
            alreadyThere = `\n\n**Already in the vault for this project:**\n${paths.map((notePath) => `- ${notePath}`).join('\n')}\n\nThis listing lags behind recent writes, so treat it as a hint only.`;
          }
        }
      } catch {
        // Fail soft; continue with plain instructions
      }

      return `Sweep your native memory directory (\`${NATIVE_MEMORY_ROOT}\`) and move every unmigrated memory into the Obsidian vault. The vault becomes the full record; each native file is reduced to a stub that still drives recall.

${SCOPE_GUARD}${projectNote}${alreadyThere}

## Find the backlog

List every \`.md\` file in \`${NATIVE_MEMORY_ROOT}\` except \`MEMORY.md\`, and read each one's frontmatter. **A file with a \`vault_note\` field under \`metadata\` is already migrated — skip it.** That field is the only authoritative marker; never infer migration state from the vault listing, which lags until notes are indexed.

Report the files you are about to migrate before writing anything. You do not need to wait for confirmation — invoking this prompt is the confirmation.

## Migrate each file

1. **Read** the native file. Skip it if \`metadata.vault_note\` already exists.
2. **Parse** \`name\`, \`description\`, \`metadata.type\`, \`metadata.originSessionId\`, \`metadata.modified\`, and the body.
3. **Derive the title.** Use the link text from your native \`MEMORY.md\` when the file has an entry there — it is already human-written. Otherwise convert \`name\` from kebab-case to Title Case.
4. **Resolve the project folder.** Look up the project slug in \`Memory/MEMORY.md\`. If there is no entry, add one using your working directory basename. If \`Memory/MEMORY.md\` itself does not exist, create it with \`note_workflow action: 'create'\` and a \`# Memory Index\` heading.
5. **Dedupe.** \`search_notes\` on the title plus description at \`threshold: 0.6\`. If a vault note already covers this memory, edit that note rather than creating a second one.
6. **Write the vault note** with \`note_workflow action: 'create'\` at \`${memoryRoot}/<Title>.md\`. Copy the body verbatim. Set \`date\` from the original \`metadata.modified\` — preserve the memory's history, do not stamp today.
7. **Rewrite the native file as a stub** with your own Write tool. Preserve \`name\`, \`description\`, \`originSessionId\`, and \`modified\` exactly as they were, add \`vault_note\` and \`migrated\`, and replace the body with a pointer.
8. **Append to \`${memoryRoot}/MEMORY.md\`** in \`- [Title](file.md) — hook\` format. Use \`note_workflow action: 'create'\` seeded with a \`# Memory Index\` heading if the index does not exist yet, and \`action: 'edit', mode: 'append'\` thereafter. An \`edit\` against a missing note fails, so check first.
9. **Leave your native \`MEMORY.md\` alone.** Its link still points at a file that exists.

## Ordering is a correctness requirement

Always write the vault note (step 6) **before rewriting the stub** (step 7). If anything fails between them, the native file still holds the full body and has no \`vault_note\`, so re-running this prompt is safe and step 5 absorbs the orphaned vault note. The reverse order loses data permanently.

## Batching

Pass \`defer_hint_seconds: 120\` on every \`note_workflow\` write except the last. Five memories should produce one commit, not five.

## Vault note template

\`\`\`markdown
---
title: "No commit trailers"
date: "2026-07-27"
topic: "git workflow"
type: feedback
project_slug: c--dev-00-ProWMS-pro-wms
native_file: feedback_no_commit_trailers.md
tags: ["memory", "agent-captured", "git"]
---

The original body, copied verbatim.

**Why:** ...

**How to apply:** ...
\`\`\`

Keep whatever \`metadata.type\` the native file already had. \`date\` comes from \`metadata.modified\`, not from today.

## Native stub template

\`\`\`markdown
---
name: feedback-no-commit-trailers
description: "Unchanged — copy the original description exactly."
metadata:
  node_type: memory
  type: feedback
  originSessionId: af0c4ad5-dd48-4a33-b7ae-507231676945
  modified: 2026-07-27T12:06:15.005Z
  vault_note: "${memoryRoot}/No Commit Trailers.md"
  migrated: "${today}"
---

Full content lives in the Obsidian vault at \`${memoryRoot}/No Commit Trailers.md\`.
Read it with \`get_note_content\` before acting on this memory.
\`\`\`

\`migrated\` is an informational timestamp only — \`vault_note\` presence is still the sole thing that gates migration behavior anywhere in this system.

## When done

Report how many memories moved and how many were skipped as already migrated.`;
    },
  },
];

export const MEMORY_PROMPT_BY_NAME = new Map(MEMORY_PROMPTS.map((item) => [item.name, item]));
