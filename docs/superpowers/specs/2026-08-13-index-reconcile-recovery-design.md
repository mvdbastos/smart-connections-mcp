# Index Reconcile Recovery — Design

**Issue:** [#13](https://github.com/mvdbastos/smart-connections-mcp/issues/13) — `reconcileWithFilesystem()` refuses permanently once staleness crosses 50%.

**Date:** 2026-08-13

**Status:** Approved

---

## 1. Problem

`reconcileWithFilesystem()` drops index entries whose file no longer exists on disk. It is guarded by a ratio:

```ts
if (missing.length > this.sources.size / 2) {
  console.error(
    `Refusing to reconcile: ${missing.length} of ${this.sources.size} indexed notes are missing from ${this.vaultPath}. ` +
      'This looks like a wrong vault path or an unavailable drive rather than stale index entries. Index left intact.'
  );
  return 0;
}
```

The guard is a **one-way trap**. Staleness only ever increases, so once the ratio is crossed it can never un-cross itself: the entries that would bring the ratio back down are exactly the ones the guard refuses to drop. The only call site is `initialize()` (`smart-connections-loader.ts:36`), so every restart re-runs the identical check and reaches the identical refusal.

The reporter's vault: **66 indexed, 32 present, 34 missing**, threshold 33 — over by one. **28 of the 34** missing entries are `Memory/memory/` phantoms created by #4 itself, which closes the loop: #4 surfaces phantom paths, writes land at them, staleness crosses 50%, the guard refuses forever, and the phantoms are never cleaned. `search_notes` returns the same note at two paths with identical score `0.528210`.

Reproduced on `7ad20b2` under Node 22, on host and in Docker.

---

## 2. Root cause findings

Two findings from reading the live source changed the design materially. Both are load-bearing; the implementation depends on them being true.

### 2.1 The vault-availability half of the guard is unreachable

`initialize()` throws before `reconcileWithFilesystem()` is ever called:

| Line | Condition | Throws |
|---|---|---|
| `smart-connections-loader.ts:25` | `.smart-env` missing | `Smart Connections directory not found at: …` |
| `smart-connections-loader.ts:45` | `smart_env.json` missing | `Configuration file not found at: …` |
| `smart-connections-loader.ts:59` | `multi/` missing | `Multi directory not found at: …` |

Reconcile runs at `:36`, after all three. `index.ts:58` is a bare top-level `await loader.initialize()` with no `catch`, so any of these exits the server.

Therefore, at reconcile time, `<vault>/.smart-env/multi/` **provably exists and is readable** — which means the vault directory provably exists and is non-empty. An unmounted drive or a typo'd `SMART_VAULT_PATH` crashes startup with a clear message; it never reaches the guard.

**Consequence:** the guard's stated rationale — "a wrong vault path or an unavailable drive" — describes a condition that cannot occur at that point. Any `fs.existsSync(vaultPath)` / non-empty-directory check added there would be dead code.

### 2.2 The loader never persists the index

There is no `writeFileSync`, `appendFileSync`, or `createWriteStream` anywhere in `smart-connections-loader.ts`. `reconcileWithFilesystem()` mutates only the in-memory `Map`. The `.ajson` files on disk are never rewritten, and a restart reloads every entry.

**Consequence:** over-reconciling is **not destructive and not permanent**. It costs one process lifetime and is undone by a restart. The guard is a diagnostic aid, not a data-safety mechanism.

---

## 3. Design

### 3.1 The guard

Replace the ratio with a single check on exactly-100%-missing, floored at 5 entries.

```ts
reconcileWithFilesystem(): number {
  const missing: string[] = [];
  for (const notePath of this.sources.keys()) {
    if (!fs.existsSync(path.join(this.vaultPath, notePath))) {
      missing.push(notePath);
    }
  }

  const indexed = this.sources.size;
  const sample = missing.slice(0, MISSING_SAMPLE_LIMIT);

  if (missing.length === 0) {
    this.indexHealth = { indexed, missing: 0, dropped: 0, refused: false, missingSample: [] };
    return 0;
  }

  // Every indexed note absent means .smart-env describes a different folder
  // than the one it sits in — a copied or restored env directory, or notes
  // moved wholesale. Ordinary staleness never reaches 100%: something always
  // survives. Below 5 entries "all gone" is unremarkable, so the floor keeps
  // a two-note vault from tripping it.
  if (missing.length === indexed && indexed >= FULL_MISS_FLOOR) {
    this.indexHealth = { indexed, missing: missing.length, dropped: 0, refused: true, missingSample: sample };
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
    missingSample: sample,
  };
  console.error(
    `Dropped ${missing.length} stale index entries with no file on disk: ${sample.join(', ')}` +
      (missing.length > sample.length ? `, and ${missing.length - sample.length} more` : '')
  );
  return missing.length;
}
```

Constants, module-level in `smart-connections-loader.ts`:

```ts
const MISSING_SAMPLE_LIMIT = 10;
const FULL_MISS_FLOOR = 5;
```

Every ratio strictly below 100% now reconciles, whatever its size. The reporter's 34/66 reconciles on the first startup after this ships — nothing about the trapped state is persisted, so it self-heals with no migration step and no escape hatch.

**Explicitly rejected:** an escape-hatch env var or `force` flag (issue #13, reporter's option 3). It would let a caller override the guard in exactly the state where the guard's diagnosis matters most, and §2.2 shows there is nothing to escape from — a restart already restores the full index.

### 3.2 Index health state

The refusal must outlive `initialize()` so the server can surface it on later requests. The loader records it.

```ts
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

Stored in a private field initialised to a zeroed, non-refused value so it is always readable, even before `initialize()` runs:

```ts
private indexHealth: IndexHealth = {
  indexed: 0,
  missing: 0,
  dropped: 0,
  refused: false,
  missingSample: [],
};

getIndexHealth(): IndexHealth {
  return { ...this.indexHealth, missingSample: [...this.indexHealth.missingSample] };
}
```

`getIndexHealth()` returns a copy so callers cannot mutate loader state.

`reconcileWithFilesystem()` keeps its `number` return type. Existing callers and tests are unaffected.

### 3.3 Surfacing

The current refusal is `console.error` only, which goes to the MCP client's stderr log and never enters the conversation. No agent has ever been able to act on it. Two response channels carry it instead.

**`get_stats`** gains an `index` block alongside the existing `sync` block. Health counts always; the full hint text only when refused.

```jsonc
{
  "index": {
    "indexed": 66,
    "missing": 66,
    "dropped": 0,
    "refused": true,
    "missing_sample": ["Memory/memory/Foo.md", "..."],
    "hint": "<full text from buildIndexRefusalHint>"
  }
}
```

When not refused, the same block appears without `hint`.

The `IndexHealth` field `missingSample` is serialised as `missing_sample`. Response payloads in this server are snake_case (`quarantined_paths`, `defer_hint_seconds`) while the TypeScript interface is camelCase; the mapping happens at the `index.ts` call site, not in the loader.

**`search_notes`** gains a compact `index_warning`, present **only** when `refused` — the moment a phantom twin can mislead the agent mid-task.

```jsonc
{
  "index_warning": {
    "state": "reconcile_refused",
    "missing": 66,
    "indexed": 66,
    "note": "Results may include paths with no file behind them. Call get_stats for the full diagnosis."
  }
}
```

Nothing is attached to search results when reconcile succeeded — a reconciled index has no phantoms. When refused, the warning is attached regardless of how many results the search returned, including zero: an empty result set from a phantom-laden index is itself misleading.

### 3.4 The refusal hint

New module `src/index-health-hints.ts`, mirroring `src/sync-hints.ts`. `index.ts` has top-level side effects and cannot be imported by a test, so the text builders live in their own module and are tested directly.

```ts
export function buildIndexRefusalHint(vaultPath: string, health: IndexHealth): string;
export function buildSearchIndexWarning(health: IndexHealth): Record<string, unknown> | undefined;
```

`buildSearchIndexWarning` returns `undefined` when `health.refused` is false, so the call site is a plain conditional spread.

The hint **asks rather than acts**. It presents two options and instructs the agent not to choose between them unilaterally:

```
The vault index at <vaultPath> lists <indexed> notes, and none of them
exist on disk. The index was left intact.

  indexed: 66 | missing: 66
  sample:  Memory/memory/Foo.md
           Memory/hermes-agent/Bar.md

This means .smart-env describes a different folder than the one it sits in
— usually a copied or restored .smart-env, or notes moved wholesale. It is
not ordinary staleness.

Until this is resolved, reads may return these paths even though no file
backs them.

Do NOT delete .smart-env or hand-edit the .ajson files. Those embeddings
are expensive to rebuild, and the vault server never rewrites them itself
— a restart reloads whatever is on disk.

Ask the user which they want. Do not choose for them:
  1. Investigate the vault directly — compare the sampled paths above
     against what is actually under <vaultPath> and report what differs.
  2. Open an issue at mvdbastos/smart-connections-mcp, if those paths look
     like they should exist.
```

**Bounded by design.** The agent may read and compare; it may not prune entries, delete `.smart-env`, or edit `.ajson`. This follows the shape already approved for `buildRemediationHint` in `sync-hints.ts`: named causes, specific read-only commands, an explicit prohibition on destructive recovery, and a stop-and-report fallback.

The tracker slug is imported from a shared constant rather than duplicated — see §3.5.

### 3.5 Agent-facing naming

All text the server hands an agent uses two terms consistently:

| Referent | Term |
|---|---|
| The notes and their index | **the vault** |
| The software serving them | **the vault server** |

Existing text already uses "the vault" (~20 occurrences); those stay as they are. Four sites carry misleading names and change:

| Site | Current | Becomes |
|---|---|---|
| `tool-definitions.ts:199` | `Get statistics about the Smart Connections knowledge base (total notes, blocks, embedding model, etc.).` | `Get statistics about the vault (total notes, blocks, embedding model, etc.).` |
| `resources.ts:221` | `Smart Connections uses **TaylorAI/bge-micro-v2** (384-dimensional, ~27MB).` | `The vault index uses **TaylorAI/bge-micro-v2** (384-dimensional, ~27MB).` |
| `sync-hints.ts:46` | `This failure survived a restart and is likely a bug in smart-connections-mcp.` | `This failure survived a restart and is likely a bug in the vault server.` |
| `prompts.ts:269` | `That behavior lives in the harness, not in this MCP server.` | `That behavior lives in the harness, not in the vault server.` |

**Must not change:** `sync-hints.ts:9`'s `const ISSUE_TRACKER = 'mvdbastos/smart-connections-mcp'`. It is a literal argument to `gh issue list -R <slug>`, not prose. Renaming it breaks the command.

`ISSUE_TRACKER` moves to a shared module so both hint files use one definition rather than duplicating the slug:

- Create `src/issue-tracker.ts` exporting `export const ISSUE_TRACKER = 'mvdbastos/smart-connections-mcp';`
- `sync-hints.ts` imports it instead of declaring it.
- `index-health-hints.ts` imports it.

---

## 4. Testing

### 4.1 One existing test asserts the buggy behaviour and must flip

`src/smart-connections-loader.test.ts:170`:

```ts
it('keeps the index intact when more than half the files are missing', async () => {
  const vault = createVaultWithStaleSources(['A.md', 'B.md', 'C.md', 'D.md'], ['A.md']);
  // ...
  expect(loader.getSources().size).toBe(4);
```

4 indexed, 1 on disk, 3 missing. Under the new rule 3 ≠ 4, so it reconciles to size 1. The test is **renamed and re-pointed at the new behaviour** — `reconciles even when most files are missing`, expecting size 1. This is the same situation as the scheduler test rewritten on the `sync-durability` branch: the old assertion encodes the defect being fixed. No assertion is loosened.

`:182` (`still reconciles when just under half are missing`) keeps passing unchanged and stays as a regression anchor.

### 4.2 New loader coverage

Note that `createVaultWithStaleSources` writes `.smart-env/` inside the vault, so any vault it builds is non-empty — consistent with §2.1.

| Test | Setup | Expect |
|---|---|---|
| reconciles at the reported ratio | 66 indexed / 32 on disk | `size === 32`, `dropped === 34` |
| refuses when every entry is missing | 6 indexed / 0 on disk | `size === 6`, `refused === true`, `dropped === 0` |
| reconciles when every entry is missing below the floor | 4 indexed / 0 on disk | `size === 0`, `refused === false` |
| health records a bounded sample | 12 indexed / 0 on disk | `missingSample.length === 10` |
| health is readable before initialize | fresh loader | zeroed, `refused === false` |
| getIndexHealth returns a copy | mutate the returned sample | loader state unchanged |

### 4.3 Hint module coverage

| Test | Expect |
|---|---|
| names the vault path and both counts | contains path, `indexed`, `missing` |
| includes the sampled paths | each sample path present |
| forbids destructive recovery | matches `/Do NOT delete \.smart-env/`; does **not** match `/rm -rf/`, `/reset --hard/` |
| presents both options and defers to the user | contains `Ask the user`, `Investigate the vault directly`, and the tracker slug |
| search warning is undefined unless refused | `buildSearchIndexWarning({ refused: false, … }) === undefined` |
| search warning omits paths | returned object contains no value from `missingSample` |

The last one matters: **the tracker repository is public.** The compact warning rides along in every search response and carries counts only. Vault note paths carry client names, project names, and personal titles. The full sample appears only in `get_stats`, which an agent fetches deliberately. This mirrors the existing `reports a count and never the paths` guarantee on `buildReportHint`, which must not be weakened.

### 4.4 Naming anti-drift

A test asserting no agent-facing string reintroduces the old names:

- Import `tools` from `tool-definitions.ts` and the resource/prompt text, assert none contains `Smart Connections` or `smart-connections-mcp`.
- Exempt the `ISSUE_TRACKER` constant and any string built from it.

This follows the registry-derived parity test added on the `prompt-scope-and-arg-errors` branch: derive the assertion from the real registry rather than a hand-copied list, so a new tool cannot quietly drift.

---

## 5. Out of scope

- **Reopening #4 and #7.** Issue #13 notes phantom paths stay reachable via `search_notes` while the guard blocks cleanup. This fix removes the block, so the phantoms clear on the next start. Whether #4/#7 warrant reopening is a tracker decision, made after this ships and the reporter re-checks their vault.
- **Persisting the index.** §2.2 establishes the loader is read-only against `.ajson`. Making it write is a much larger change and is not required here.
- **Catching the `initialize()` throw** at `index.ts:58`. The crash-with-a-clear-message behaviour is correct for a missing `.smart-env`; changing it is unrelated to #13.

---

## 6. Files

| File | Change |
|---|---|
| `src/smart-connections-loader.ts` | Rewrite `reconcileWithFilesystem()`; add `IndexHealth`, the private field, `getIndexHealth()`, and the two constants |
| `src/index-health-hints.ts` | **New** — `buildIndexRefusalHint`, `buildSearchIndexWarning` |
| `src/issue-tracker.ts` | **New** — shared `ISSUE_TRACKER` constant |
| `src/sync-hints.ts` | Import `ISSUE_TRACKER`; reword `:46` |
| `src/index.ts` | `index` block in `get_stats`; `index_warning` in `search_notes` |
| `src/tool-definitions.ts` | Reword `:199` |
| `src/resources.ts` | Reword `:221` |
| `src/prompts.ts` | Reword `:269` |
| `src/smart-connections-loader.test.ts` | Flip `:170`; add §4.2 coverage |
| `src/index-health-hints.test.ts` | **New** — §4.3 coverage |
| `src/index.test.ts` | Add §4.4 anti-drift test |
| `CHANGELOG.md` | New `## index-reconcile-recovery` heading at the top |

**Build policy:** never run `npm run build` on this branch and never stage `dist/`. Typecheck with `npx tsc --noEmit`. Stage explicitly (`git add src/ docs/ CHANGELOG.md`), never `git add -A`.
