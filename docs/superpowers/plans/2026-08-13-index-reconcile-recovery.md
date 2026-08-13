# Index Reconcile Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-way `>50%` reconcile guard with an exactly-100%-missing check, and surface a refusal where an agent can act on it instead of only on stderr.

**Architecture:** `SmartConnectionsLoader` records an `IndexHealth` snapshot when it reconciles, exposed via `getIndexHealth()`. A new `index-health-hints.ts` module turns that snapshot into agent-facing text, mirroring the existing `sync-hints.ts` pattern. `index.ts` reads the snapshot and attaches it to `get_stats` (always) and `search_notes` (only when refused). A shared `issue-tracker.ts` constant stops the tracker slug being duplicated across two hint modules.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, Node 22.

**Spec:** `docs/superpowers/specs/2026-08-13-index-reconcile-recovery-design.md`

**Branch:** `fix/index-reconcile-recovery` (already created, spec already committed at `16ac6f1`)

## Global Constraints

- **Never run `npm run build` on this branch. Never stage `dist/`.** Typecheck with `npx tsc --noEmit` instead. `dist/` is tracked and is rebuilt once at integration time.
- **Stage explicitly** — `git add src/ docs/ CHANGELOG.md` or exact paths. Never `git add -A`.
- **Commit messages use a heredoc** — `git commit -F - <<'EOF' … EOF`. Never a PowerShell here-string (`@'…'@`); it is invalid in Git Bash and leaks a literal `@` into the subject.
- **Every commit carries both trailers, verbatim:**
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01K4mPAWNTYd7DgX5zMuGLe6
  ```
- **The repository is public.** No agent-facing string that rides along in a routine response may contain vault note paths, note titles, or vault contents. Counts, error text, tool versions, and OS are fine. The existing `reports a count and never the paths` test in `src/sync-hints.test.ts` guarantees this for sync and must not be weakened.
- **Agent-facing copy uses exactly two terms:** the notes and their index are **"the vault"**; the software serving them is **"the vault server"**. Never "Smart Connections", never "smart-connections-mcp", never "this MCP server" in prose.
- **`ISSUE_TRACKER`'s value `'mvdbastos/smart-connections-mcp'` is a literal `gh issue list -R <slug>` argument.** Its *value* never changes. Only its *location* moves, in Task 1.
- **ESM import specifiers end in `.js`** even for TypeScript sources — `from './issue-tracker.js'`, matching every existing import in `src/`.
- Run a single test file with `npx vitest run src/<file>.test.ts`. Run everything with `npm test`. If a `.claude/worktrees/` directory exists, append `--exclude '.claude/**' --exclude 'node_modules/**'` or the run collects other branches' test files and inflates the count.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/issue-tracker.ts` | **New.** Single source of truth for the tracker slug. One line, no imports. |
| `src/smart-connections-loader.ts` | Owns the index and its health. Detects staleness, decides whether to reconcile, records the outcome. Knows nothing about how the outcome is presented. |
| `src/index-health-hints.ts` | **New.** Turns an `IndexHealth` into agent-facing text. Pure functions, no I/O, no loader dependency beyond the type. |
| `src/index.ts` | Wiring only. Reads the snapshot, calls the builders, attaches results to two tool responses. |
| `src/tool-definitions.ts`, `src/resources.ts`, `src/prompts.ts` | Copy changes only. |

The split matters because `src/index.ts` has top-level side effects — it constructs the MCP server and connects a stdio transport at import time — so no test can import it. Anything that needs direct test coverage lives outside it. This is why `sync-hints.ts` exists and why `index-health-hints.ts` follows it.

---

## Task 1: Shared issue-tracker constant

**Files:**
- Create: `src/issue-tracker.ts`
- Modify: `src/sync-hints.ts:9` (remove local const, import instead), `src/sync-hints.ts:46` (copy change)
- Test: `src/sync-hints.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export const ISSUE_TRACKER: string` from `src/issue-tracker.ts`, value `'mvdbastos/smart-connections-mcp'`. Task 3 imports it.

- [ ] **Step 1: Write the failing test**

Add to the end of the existing `describe('sync escalation hints', …)` block in `src/sync-hints.test.ts`, before its closing `});`:

```ts
  it('calls the software the vault server, not a package name', () => {
    const hint = buildReportHint('fatal: unable to write', ['A.md']);

    expect(hint).toContain('the vault server');
    expect(hint).not.toMatch(/a bug in smart-connections-mcp/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sync-hints.test.ts`

Expected: FAIL — `expected '…likely a bug in smart-connections-mcp.…' to contain 'the vault server'`.

- [ ] **Step 3: Create the shared constant**

Create `src/issue-tracker.ts`:

```ts
/**
 * The public GitHub repository backing this server.
 *
 * This is a literal argument to `gh issue list -R <slug>`, not prose. Hint
 * text refers to the software as "the vault server"; this value is the only
 * place the package name is correct.
 */
export const ISSUE_TRACKER = 'mvdbastos/smart-connections-mcp';
```

- [ ] **Step 4: Import it in sync-hints.ts and reword the report hint**

In `src/sync-hints.ts`, delete line 9:

```ts
const ISSUE_TRACKER = 'mvdbastos/smart-connections-mcp';
```

and replace it with an import placed directly below the file's opening doc comment:

```ts
import { ISSUE_TRACKER } from './issue-tracker.js';
```

Then change line 46 from:

```ts
    'This failure survived a restart and is likely a bug in smart-connections-mcp.',
```

to:

```ts
    'This failure survived a restart and is likely a bug in the vault server.',
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/sync-hints.test.ts`

Expected: PASS, 5 tests. The four pre-existing tests must still pass unchanged — in particular `tells the agent to search before opening a duplicate`, which asserts the slug still appears in the `gh issue list` command.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`

Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/issue-tracker.ts src/sync-hints.ts src/sync-hints.test.ts
git commit -F - <<'EOF'
refactor: extract ISSUE_TRACKER to a shared module

The index health hints need the same slug. Extracting it keeps one
definition rather than two that can drift.

Also renames the software in the report hint from "smart-connections-mcp"
to "the vault server". The package name stays in ISSUE_TRACKER, where it
is a literal `gh issue list -R` argument rather than prose.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K4mPAWNTYd7DgX5zMuGLe6
EOF
```

---

## Task 2: Replace the reconcile guard and record index health

**Files:**
- Modify: `src/smart-connections-loader.ts:255-297` (doc comment + `reconcileWithFilesystem`), plus the class field block at `:9-18`
- Test: `src/smart-connections-loader.test.ts` — flip the test at `:170`, add new coverage to the `describe('index/filesystem reconciliation', …)` block

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface IndexHealth { indexed: number; missing: number; dropped: number; refused: boolean; missingSample: string[] }`
  - `SmartConnectionsLoader.getIndexHealth(): IndexHealth`
  - `reconcileWithFilesystem(): number` — signature unchanged.

  Tasks 3 and 4 both depend on these exact names.

### Background the implementer needs

The current guard refuses when `missing.length > this.sources.size / 2`. It is a one-way trap: staleness only increases, and the entries that would bring the ratio back under the threshold are exactly the ones it refuses to drop. The only call site is `initialize()` at `src/smart-connections-loader.ts:36`, so every restart re-runs the same check and reaches the same refusal.

Do **not** add a vault-exists or non-empty-directory check. `initialize()` throws at `:25`, `:45`, and `:59` before reconcile runs at `:36`, so `<vault>/.smart-env/multi/` provably exists by then — such a check can never be false and would be dead code. Spec §2.1 has the full reasoning.

- [ ] **Step 1: Write the failing tests**

In `src/smart-connections-loader.test.ts`, replace the entire existing test at lines 170-180:

```ts
  it('keeps the index intact when more than half the files are missing', async () => {
    const vault = createVaultWithStaleSources(['A.md', 'B.md', 'C.md', 'D.md'], ['A.md']);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      expect(loader.getSources().size).toBe(4);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });
```

with this — the old assertion encodes the defect, so it is re-pointed at the fixed behaviour rather than deleted:

```ts
  it('reconciles even when most files are missing', async () => {
    const vault = createVaultWithStaleSources(['A.md', 'B.md', 'C.md', 'D.md'], ['A.md']);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      expect(loader.getSources().size).toBe(1);
      expect(loader.getSources().has('A.md')).toBe(true);
      expect(loader.getIndexHealth().dropped).toBe(3);
      expect(loader.getIndexHealth().refused).toBe(false);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });
```

Then append these tests inside the same `describe('index/filesystem reconciliation', …)` block, before its closing `});`:

```ts
  it('refuses when every indexed note is missing', async () => {
    const indexed = ['A.md', 'B.md', 'C.md', 'D.md', 'E.md', 'F.md'];
    const vault = createVaultWithStaleSources(indexed, []);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      expect(loader.getSources().size).toBe(6);

      const health = loader.getIndexHealth();
      expect(health.refused).toBe(true);
      expect(health.dropped).toBe(0);
      expect(health.indexed).toBe(6);
      expect(health.missing).toBe(6);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('reconciles when every note is missing but the index is tiny', async () => {
    const vault = createVaultWithStaleSources(['A.md', 'B.md', 'C.md', 'D.md'], []);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      expect(loader.getSources().size).toBe(0);
      expect(loader.getIndexHealth().refused).toBe(false);
      expect(loader.getIndexHealth().dropped).toBe(4);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('caps the missing sample at ten paths', async () => {
    const indexed = Array.from({ length: 12 }, (_, i) => `Note${i}.md`);
    const vault = createVaultWithStaleSources(indexed, []);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      const health = loader.getIndexHealth();
      expect(health.missing).toBe(12);
      expect(health.missingSample).toHaveLength(10);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });

  it('exposes a readable health snapshot before initialize runs', () => {
    const loader = new SmartConnectionsLoader('/nonexistent');

    expect(loader.getIndexHealth()).toEqual({
      indexed: 0,
      missing: 0,
      dropped: 0,
      refused: false,
      missingSample: [],
    });
  });

  it('getIndexHealth returns a copy that cannot mutate loader state', async () => {
    const indexed = ['A.md', 'B.md', 'C.md', 'D.md', 'E.md', 'F.md'];
    const vault = createVaultWithStaleSources(indexed, []);
    try {
      const loader = new SmartConnectionsLoader(vault);
      await loader.initialize();

      const health = loader.getIndexHealth();
      health.missingSample.push('injected.md');
      health.refused = false;

      expect(loader.getIndexHealth().missingSample).not.toContain('injected.md');
      expect(loader.getIndexHealth().refused).toBe(true);
    } finally {
      fs.rmSync(vault, { recursive: true, force: true });
    }
  });
```

Note on the fixtures: `createVaultWithStaleSources` (defined at `:53`) already writes `.smart-env/` inside the vault, so passing `[]` as `onDisk` produces a vault that exists and is non-empty but holds none of the indexed notes. That is exactly the 100%-missing condition, and it confirms why a non-empty-directory check would be useless here.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/smart-connections-loader.test.ts`

Expected: FAIL. `reconciles even when most files are missing` fails with `expected 4 to be 1` (the old guard still refuses), and every test calling `getIndexHealth` fails with `loader.getIndexHealth is not a function`.

- [ ] **Step 3: Add the interface, constants, and field**

In `src/smart-connections-loader.ts`, add these two constants directly below the imports (after the `import type { SmartSource, SmartEnvConfig } from './types.js';` line):

```ts
/** How many missing paths to keep for diagnosis. Bounded so a large drift does not flood a response. */
const MISSING_SAMPLE_LIMIT = 10;

/** Below this many entries, "all of them are gone" is unremarkable rather than a signal. */
const FULL_MISS_FLOOR = 5;

/**
 * Outcome of the last reconcile pass, so callers can surface it long after
 * initialize() returned.
 */
export interface IndexHealth {
  /** Entries in the index at reconcile time. */
  indexed: number;
  /** Entries with no file on disk. */
  missing: number;
  /** Entries actually removed. Zero when refused. */
  dropped: number;
  /** True when the guard declined to reconcile. */
  refused: boolean;
  /** First MISSING_SAMPLE_LIMIT missing paths, for diagnosis. */
  missingSample: string[];
}
```

Then add the field to the class, directly after the existing `private sources: Map<string, SmartSource> = new Map();` at `:13`:

```ts
  private indexHealth: IndexHealth = {
    indexed: 0,
    missing: 0,
    dropped: 0,
    refused: false,
    missingSample: [],
  };
```

- [ ] **Step 4: Replace the doc comment and method body**

In `src/smart-connections-loader.ts`, replace the doc comment and method spanning lines 255-297 — everything from `  /**` above `Drop indexed entries with no file behind them.` through the closing `}` of `reconcileWithFilesystem` — with:

```ts
  /**
   * Drop indexed entries with no file behind them.
   *
   * Two-phase on purpose: the missing set is collected first, then checked
   * before anything is deleted. The check is exactly-100%-missing rather than
   * a ratio. A ratio is a one-way trap -- staleness only ever increases, so
   * the entries that would bring the ratio back under threshold are the ones
   * the guard refuses to drop, and the only call site is initialize().
   *
   * There is deliberately no vault-exists or non-empty check here. initialize()
   * throws at :25, :45, and :59 before this runs, so <vault>/.smart-env/multi/
   * provably exists by now; such a check could never be false.
   *
   * This mutates the in-memory Map only. The .ajson files are never rewritten,
   * so a wrong decision here costs one process lifetime and no more.
   */
  reconcileWithFilesystem(): number {
    const missing: string[] = [];

    for (const notePath of this.sources.keys()) {
      if (!fs.existsSync(path.join(this.vaultPath, notePath))) {
        missing.push(notePath);
      }
    }

    const indexed = this.sources.size;
    const missingSample = missing.slice(0, MISSING_SAMPLE_LIMIT);

    if (missing.length === 0) {
      this.indexHealth = { indexed, missing: 0, dropped: 0, refused: false, missingSample: [] };
      return 0;
    }

    // Every indexed note absent means .smart-env describes a different folder
    // than the one it sits in -- a copied or restored env directory, or notes
    // moved wholesale. Ordinary staleness never reaches 100%: something always
    // survives.
    if (missing.length === indexed && indexed >= FULL_MISS_FLOOR) {
      this.indexHealth = { indexed, missing: missing.length, dropped: 0, refused: true, missingSample };
      console.error(
        `Refusing to reconcile: all ${indexed} indexed notes are missing from ${this.vaultPath}. ` +
          'The index describes a different folder than the one it sits in. Index left intact.'
      );
      return 0;
    }

    for (const notePath of missing) {
      this.sources.delete(notePath);
    }

    this.indexHealth = {
      indexed,
      missing: missing.length,
      dropped: missing.length,
      refused: false,
      missingSample,
    };

    console.error(
      `Dropped ${missing.length} stale index entries with no file on disk: ${missingSample.join(', ')}` +
        (missing.length > missingSample.length ? `, and ${missing.length - missingSample.length} more` : '')
    );

    return missing.length;
  }

  /**
   * Snapshot of the last reconcile pass. Returns a copy so callers cannot
   * mutate loader state through it.
   */
  getIndexHealth(): IndexHealth {
    return { ...this.indexHealth, missingSample: [...this.indexHealth.missingSample] };
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/smart-connections-loader.test.ts`

Expected: PASS, all tests in the file. `still reconciles when just under half are missing` (at `:182`) must pass unchanged — it is the regression anchor for the ordinary path.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test`

Expected: PASS. No test outside `smart-connections-loader.test.ts` should change behaviour.

Run: `npx tsc --noEmit`

Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/smart-connections-loader.ts src/smart-connections-loader.test.ts
git commit -F - <<'EOF'
fix: reconcile the index unless every entry is missing (#13)

The >50% guard was a one-way trap. Staleness only ever increases, and the
entries that would bring the ratio back under threshold are exactly the
ones the guard refused to drop. With initialize() as the only call site,
every restart reached the same refusal. A vault at 34 missing of 66 could
never recover.

Refuses now only when all indexed notes are missing and there are at least
five of them, which means .smart-env describes a different folder than the
one it sits in rather than ordinary staleness.

Records an IndexHealth snapshot so a refusal can be surfaced to an agent
later instead of only reaching stderr.

The test asserting the index stays intact above 50% asserted the defect. It
is renamed and re-pointed at the fixed behaviour, not loosened.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K4mPAWNTYd7DgX5zMuGLe6
EOF
```

---

## Task 3: Index health hint builders

**Files:**
- Create: `src/index-health-hints.ts`, `src/index-health-hints.test.ts`

**Interfaces:**
- Consumes: `IndexHealth` from `./smart-connections-loader.js` (Task 2), `ISSUE_TRACKER` from `./issue-tracker.js` (Task 1).
- Produces:
  - `buildIndexRefusalHint(vaultPath: string, health: IndexHealth): string`
  - `buildSearchIndexWarning(health: IndexHealth): Record<string, unknown> | undefined`

  Task 4 imports both.

- [ ] **Step 1: Write the failing tests**

Create `src/index-health-hints.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildIndexRefusalHint, buildSearchIndexWarning } from './index-health-hints.js';
import type { IndexHealth } from './smart-connections-loader.js';

function refusedHealth(overrides: Partial<IndexHealth> = {}): IndexHealth {
  return {
    indexed: 66,
    missing: 66,
    dropped: 0,
    refused: true,
    missingSample: ['Memory/memory/Foo.md', 'Memory/hermes-agent/Bar.md'],
    ...overrides,
  };
}

describe('index refusal hint', () => {
  it('names the vault path and both counts', () => {
    const hint = buildIndexRefusalHint('/vault', refusedHealth());

    expect(hint).toContain('/vault');
    expect(hint).toContain('66');
  });

  it('includes the sampled paths so the user can eyeball them', () => {
    const hint = buildIndexRefusalHint('/vault', refusedHealth());

    expect(hint).toContain('Memory/memory/Foo.md');
    expect(hint).toContain('Memory/hermes-agent/Bar.md');
  });

  it('forbids destructive recovery', () => {
    const hint = buildIndexRefusalHint('/vault', refusedHealth());

    expect(hint).toMatch(/Do NOT delete \.smart-env/);
    expect(hint).not.toMatch(/rm -rf/);
    expect(hint).not.toMatch(/reset --hard/);
  });

  it('presents both options and defers the choice to the user', () => {
    const hint = buildIndexRefusalHint('/vault', refusedHealth());

    expect(hint).toContain('Ask the user');
    expect(hint).toContain('Do not choose for them');
    expect(hint).toContain('Investigate the vault directly');
    expect(hint).toContain('mvdbastos/smart-connections-mcp');
  });

  it('calls the software the vault server', () => {
    const hint = buildIndexRefusalHint('/vault', refusedHealth());

    expect(hint).toContain('the vault server');
    expect(hint).not.toContain('Smart Connections');
  });
});

describe('search index warning', () => {
  it('is undefined when the index reconciled', () => {
    expect(buildSearchIndexWarning(refusedHealth({ refused: false }))).toBeUndefined();
  });

  it('reports counts when refused', () => {
    const warning = buildSearchIndexWarning(refusedHealth());

    expect(warning).toMatchObject({
      state: 'reconcile_refused',
      indexed: 66,
      missing: 66,
    });
  });

  it('never carries note paths', () => {
    const health = refusedHealth();
    const serialized = JSON.stringify(buildSearchIndexWarning(health));

    for (const notePath of health.missingSample) {
      expect(serialized).not.toContain(notePath);
    }
  });
});
```

The last test is the important one. This warning rides along in every search response while the index is unreconciled, and the repository is public — vault note paths carry client names, project names, and personal note titles. The full sample belongs only in `get_stats`, which an agent fetches deliberately. This mirrors the existing `reports a count and never the paths` guarantee in `src/sync-hints.test.ts`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/index-health-hints.test.ts`

Expected: FAIL — `Failed to resolve import "./index-health-hints.js"`.

- [ ] **Step 3: Write the module**

Create `src/index-health-hints.ts`:

```ts
/**
 * Escalation hints for an index the server declined to reconcile.
 *
 * The refusal used to reach stderr only, where the MCP client logs it and no
 * agent ever sees it. These builders carry it into get_stats and search_notes
 * instead, following the sync-hints precedent.
 */

import { ISSUE_TRACKER } from './issue-tracker.js';
import type { IndexHealth } from './smart-connections-loader.js';

/**
 * Deliberately asks rather than acts. A refused reconcile means the index
 * describes a different folder than the one it sits in, and nothing inside the
 * process can tell whether the notes moved or the configured path is wrong.
 * Both remedies belong to the user, so the hint presents them and stops.
 *
 * Bounded the same way buildRemediationHint is: read-only investigation, an
 * explicit prohibition on destructive recovery, and no mandate to improvise.
 */
export function buildIndexRefusalHint(vaultPath: string, health: IndexHealth): string {
  const sample = health.missingSample.map(
    (notePath, i) => `${i === 0 ? '  sample:  ' : '           '}${notePath}`
  );

  return [
    `The vault index at ${vaultPath} lists ${health.indexed} notes, and none of them exist on disk.`,
    'The index was left intact.',
    '',
    `  indexed: ${health.indexed} | missing: ${health.missing}`,
    ...sample,
    '',
    'This means .smart-env describes a different folder than the one it sits in —',
    'usually a copied or restored .smart-env, or notes moved wholesale. It is not',
    'ordinary staleness.',
    '',
    'Until this is resolved, reads may return these paths even though no file backs them.',
    '',
    'Do NOT delete .smart-env or hand-edit the .ajson files. Those embeddings are',
    'expensive to rebuild, and the vault server never rewrites them itself — a',
    'restart reloads whatever is on disk.',
    '',
    'Ask the user which they want. Do not choose for them:',
    '  1. Investigate the vault directly — compare the sampled paths above against',
    `     what is actually under ${vaultPath} and report what differs.`,
    `  2. Open an issue at ${ISSUE_TRACKER}, if those paths look like they should exist.`,
  ].join('\n');
}

/**
 * Rides along in every search response while the index is unreconciled, so it
 * carries counts only. Vault note paths carry client names, project names, and
 * personal note titles, and the tracker repository is public. The full sample
 * lives in get_stats, which an agent fetches deliberately.
 */
export function buildSearchIndexWarning(health: IndexHealth): Record<string, unknown> | undefined {
  if (!health.refused) {
    return undefined;
  }

  return {
    state: 'reconcile_refused',
    indexed: health.indexed,
    missing: health.missing,
    note: 'Results may include paths with no file behind them. Call get_stats for the full diagnosis.',
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/index-health-hints.test.ts`

Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`

Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/index-health-hints.ts src/index-health-hints.test.ts
git commit -F - <<'EOF'
feat: agent-facing hints for a refused index reconcile

A refusal previously reached stderr only, where the MCP client logs it and
no agent ever sees it. These builders turn the health snapshot into text
that can ride along in a tool response.

The hint asks rather than acts: it presents investigating the vault and
opening an issue as a choice for the user, and forbids deleting .smart-env
or hand-editing .ajson. The compact search warning carries counts only,
never note paths, because it appears in every search response and the
tracker repository is public.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K4mPAWNTYd7DgX5zMuGLe6
EOF
```

---

## Task 4: Surface index health in get_stats and search_notes

**Files:**
- Modify: `src/index.ts` — import block (~`:35-40`), `case 'search_notes'` (`:450-464`), `case 'get_stats'` (`:651-673`)

**Interfaces:**
- Consumes: `loader.getIndexHealth()` (Task 2), `buildIndexRefusalHint` / `buildSearchIndexWarning` (Task 3).
- Produces: nothing later tasks depend on.

### Response shape note the implementer must not get wrong

`searchEngine.searchByQuery()` returns a bare `SimilarNote[]`, and `search_notes` currently serialises that array directly. Attaching a sibling key requires wrapping it in an object. **Wrap only when refused**, so the normal response shape is unchanged and no existing consumer breaks. An agent that sees the wrapped shape is by definition in the anomalous case where it should look closer.

`get_stats` already returns an object, so its `index` key is a plain addition.

`IndexHealth` is camelCase in TypeScript; response payloads in this server are snake_case (`quarantined_paths`, `defer_hint_seconds`). The mapping happens here, at the call site.

There is no automated test for this task — `src/index.ts` constructs the MCP server and connects a stdio transport at import time, so no test can import it. That constraint is why Tasks 2 and 3 carry the logic and its coverage. This task is wiring only; verify it with the typecheck and the full suite.

- [ ] **Step 1: Add the import**

In `src/index.ts`, add to the existing import block (alongside the other local imports around lines 35-40):

```ts
import { buildIndexRefusalHint, buildSearchIndexWarning } from './index-health-hints.js';
```

- [ ] **Step 2: Wire search_notes**

Replace `src/index.ts:450-464` — the whole `case 'search_notes': { … }` block — with:

```ts
      case 'search_notes': {
        const { query, limit, threshold, include_content, content_max_chars } = SearchNotesSchema.parse(args);
        const results = await searchEngine.searchByQuery(query, limit, threshold, {
          includeContent: include_content,
          contentMaxChars: content_max_chars,
        });

        // Only wrap when the index is unreconciled: the bare-array shape is the
        // documented contract, and an agent seeing the wrapper is already in the
        // case that warrants a closer look. Attached regardless of result count --
        // an empty result set from a phantom-laden index is itself misleading.
        const indexWarning = buildSearchIndexWarning(loader.getIndexHealth());
        const payload = indexWarning ? { results, index_warning: indexWarning } : results;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(payload, null, 2),
            },
          ],
        };
      }
```

- [ ] **Step 3: Wire get_stats**

In `src/index.ts`, inside `case 'get_stats'`, replace the `combinedStats` declaration:

```ts
        const combinedStats = {
          ...stats,
          git: gitStatus,
          sync: syncScheduler.getStatus(),
        };
```

with:

```ts
        const indexHealth = loader.getIndexHealth();
        const combinedStats = {
          ...stats,
          git: gitStatus,
          sync: syncScheduler.getStatus(),
          index: {
            indexed: indexHealth.indexed,
            missing: indexHealth.missing,
            dropped: indexHealth.dropped,
            refused: indexHealth.refused,
            missing_sample: indexHealth.missingSample,
            ...(indexHealth.refused
              ? { hint: buildIndexRefusalHint(VAULT_ROOT, indexHealth) }
              : {}),
          },
        };
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`

Expected: no output, exit 0. If it reports `Cannot find name 'VAULT_ROOT'`, confirm the constant's actual name near the top of `src/index.ts` and use that — it is the same value passed to `new SmartConnectionsLoader(...)` at `:57`.

- [ ] **Step 5: Run the full suite**

Run: `npm test`

Expected: PASS, unchanged count from Task 3.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts
git commit -F - <<'EOF'
feat: surface index health in get_stats and search_notes

get_stats gains an index block carrying the reconcile counts, plus the full
hint when a reconcile was refused. search_notes gains a compact warning,
only when refused, so a phantom-laden result set announces itself at the
moment it could mislead.

search_notes returns a bare array today, so the warning requires wrapping
it. The wrap happens only in the refused case, leaving the normal response
shape untouched.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K4mPAWNTYd7DgX5zMuGLe6
EOF
```

---

## Task 5: Agent-facing naming sweep

**Files:**
- Modify: `src/tool-definitions.ts:199`, `src/resources.ts:221`, `src/prompts.ts:269`
- Test: `src/index.test.ts` (new anti-drift describe block)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

`src/sync-hints.ts:46` was already reworded in Task 1. `ISSUE_TRACKER`'s value must not change.

- [ ] **Step 1: Write the failing test**

Append to `src/index.test.ts`:

```ts
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
```

Add `MEMORY_RESOURCES` to the imports at the top of `src/index.test.ts`:

```ts
import { MEMORY_RESOURCES } from './resources.js';
```

The assertion is derived from the real registries rather than a hand-copied list, following the `advertised schema parity` test already in this file, so a newly added tool or resource cannot quietly reintroduce the old name.

Prompt bodies are built at call time from a context object rather than being static strings, so they are not statically scannable — `prompts.ts:269` is covered by the edit in Step 3 and the existing `src/prompts.test.ts` suite.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/index.test.ts`

Expected: FAIL, both new tests — the `get_stats` description and the embeddings resource still say "Smart Connections".

- [ ] **Step 3: Apply the three copy changes**

`src/tool-definitions.ts:199` — change:

```ts
    description: 'Get statistics about the Smart Connections knowledge base (total notes, blocks, embedding model, etc.).',
```

to:

```ts
    description: 'Get statistics about the vault (total notes, blocks, embedding model, etc.).',
```

`src/resources.ts:221` — change:

```
Smart Connections uses **TaylorAI/bge-micro-v2** (384-dimensional, ~27MB).
```

to:

```
The vault index uses **TaylorAI/bge-micro-v2** (384-dimensional, ~27MB).
```

`src/prompts.ts:269` — change:

```
That behavior lives in the harness, not in this MCP server.
```

to:

```
That behavior lives in the harness, not in the vault server.
```

This sentence sits mid-paragraph inside a template literal; change only that clause and leave the surrounding text and escaping untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/index.test.ts src/resources.test.ts src/prompts.test.ts src/sync-hints.test.ts`

Expected: PASS across all four files.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/tool-definitions.ts src/resources.ts src/prompts.ts src/index.test.ts
git commit -F - <<'EOF'
refactor: standardise agent-facing copy on "the vault"

Three different things were called a repo or named after the package in
text handed to an agent: the vault (itself a git repo), the issue tracker,
and the user's own project. Agent-facing copy now uses exactly two terms --
"the vault" for the notes and their index, "the vault server" for the
software.

Adds an anti-drift test derived from the tool and resource registries, so a
newly added tool or resource cannot quietly reintroduce the old name.

ISSUE_TRACKER keeps the package name: it is a literal `gh issue list -R`
argument, not prose.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K4mPAWNTYd7DgX5zMuGLe6
EOF
```

---

## Task 6: Changelog and final verification

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Add the changelog entry**

In `CHANGELOG.md`, insert a new section immediately after the `# Changelog` heading on line 1 and before the existing `## prompt-scope-and-arg-errors` heading. New entries go at the top under a `## <feature-or-branch-name>` heading; there are no dated headings in this file.

```markdown
## index-reconcile-recovery

### Fixed
- The index no longer refuses to reconcile forever once more than half its entries go stale. The old `>50%` guard was a one-way trap: staleness only increases, and the entries that would bring the ratio back under threshold were exactly the ones it refused to drop, so every restart reached the same refusal (#13). Reconcile now refuses only when every indexed note is missing and there are at least five of them, which indicates `.smart-env` describes a different folder than the one it sits in. A vault already stuck in the old state recovers on its first start after this change, with no migration step.

### Added
- `index` block in `get_stats` reporting how many entries were indexed, missing, and dropped at startup, with a sample of missing paths. A refused reconcile also carries a hint asking the user whether to investigate the vault directly or open an issue.
- `index_warning` on `search_notes` responses while the index is unreconciled, so results that may contain paths with no file behind them announce it. Present only in that state; it carries counts, never note paths.

### Changed
- `search_notes` wraps its results as `{ results, index_warning }` while the index is unreconciled. The normal response shape is unchanged.
- Text handed to an agent now calls the notes and their index "the vault", and the software "the vault server", replacing "Smart Connections", "smart-connections-mcp", and "this MCP server".
```

- [ ] **Step 2: Run the full suite**

Run: `npm test`

Expected: PASS. Record the actual test count reported.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`

Expected: no output, exit 0.

- [ ] **Step 4: Confirm dist/ was never touched**

Run: `git status --short`

Expected: no `dist/` paths listed, staged or unstaged. If any appear, `npm run build` was run by mistake — discard them with `git checkout -- dist/` before committing.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md
git commit -F - <<'EOF'
docs: changelog for index reconcile recovery

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01K4mPAWNTYd7DgX5zMuGLe6
EOF
```

- [ ] **Step 6: Report**

State the final test count, the typecheck result, and the output of `git log --oneline main..HEAD`. Do not push and do not open a PR — that decision is the maintainer's.

---

## Verification summary

| Spec section | Covered by |
|---|---|
| §3.1 guard | Task 2 |
| §3.2 `IndexHealth` + `getIndexHealth()` | Task 2 |
| §3.3 `get_stats` / `search_notes` surfacing | Task 4 |
| §3.4 hint builders | Task 3 |
| §3.5 naming + shared `ISSUE_TRACKER` | Tasks 1 and 5 |
| §4.1 flipped existing test | Task 2, Step 1 |
| §4.2 loader coverage | Task 2, Step 1 |
| §4.3 hint coverage | Task 3, Step 1 |
| §4.4 anti-drift | Task 5, Step 1 |
| §6 changelog | Task 6 |
