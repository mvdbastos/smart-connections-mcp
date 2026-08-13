# Documentation Accuracy and a `dist/` Freshness Gate — Design

## 1. Problem

Three loose ends survived PR #14.

**1.1 The agent-facing `get_stats` contract is fiction.** `src/resources.ts` documents the tool as returning `total_notes`, `total_vectors`, `embedder_ready`, and `sync`. The handler at `src/index.ts:660-693` actually returns `totalNotes`, `totalBlocks`, `embeddingDimension`, `modelKey`, `git`, `sync`, and `index`. Only `sync` is correct.

`total_vectors` and `embedder_ready` appear nowhere in `src/` except the documentation that promises them. `src/resources.ts:241` goes further and instructs an agent to "Check `get_stats` → `embedder_ready` to verify model status" — an instruction that can never succeed. An agent following the tools resource to learn the response contract is being handed field names that do not exist.

**1.2 Three comments make claims the code contradicts.** Two are stale, one is wrong. Detailed in §3.

**1.3 CI cannot catch a stale `dist/`.** `dist/` is tracked in git and rebuilt by hand as the final commit of a branch. That step is easy to forget, and forgetting it ships a server whose behavior does not match its source. Every merged PR before #14 landed with no CI at all; #14 added typecheck/build/test but nothing that compares the committed `dist/` against what `src/` produces.

## 2. Scope

Documentation, comments, and one CI step. **No code behavior changes** — no response shape changes, no new fields, no renames, no control flow touched. Agent-facing prose does change; that is the point of the PR, and it is why `dist/` must be rebuilt (§4).

The mismatch in 1.1 could equally be fixed by changing the code to match the docs — implementing `total_vectors` and `embedder_ready` and renaming the response to consistent snake_case. That is a breaking response change and was explicitly declined for this PR. The response therefore stays mixed-case (camelCase from the spread, snake_case inside the `index` block), and the documentation describes it as it is.

Out of scope: the casing inconsistency itself, implementing the two absent fields, and reopening #4 or #7 (see §5 — the comments invite a report, they do not presuppose one).

## 3. Documentation and comment changes

### D1 — `src/smart-connections-loader.ts:300-301`

The `reconcileWithFilesystem` doc comment reads:

> initialize() throws at :25, :45, and :59 before this runs

The throws are at lines 56, 76, and 90. The citation was accurate when written and drifted when code was added above it.

Fix by naming the conditions rather than the lines, so the comment cannot drift again:

> `initialize()` throws on a missing `.smart-env`, a missing `smart_env.json`, or a missing `multi/` before this runs

### D2 — `src/smart-connections-loader.ts:304`

> The .ajson files are never rewritten

True of this function, but stated as a property of the whole server, which D3 shows is false. Scope it: "This function never writes to `.ajson`."

### D3 — `src/index-health-hints.ts:40`

The refusal hint tells the user:

> the vault server never rewrites them itself

This is wrong. `src/ajson-writer.ts:43` calls `fs.appendFileSync` on every `note_workflow` write.

The prohibition this sentence supports — do not delete `.smart-env`, do not hand-edit `.ajson` — remains correct, and for a stronger reason than the one given: the server only ever *appends* new vectors and never regenerates deleted ones, so anything removed is gone until re-embedded. Replace the false claim with the accurate one.

No existing test asserts the false claim, so none breaks. But `src/index-health-hints.test.ts:51` asserts the hint contains `the vault server`, and the sentence being rewritten is the only place that phrase appears — so the replacement must retain it. A new assertion covers the corrected reasoning (§6).

### D4 — `src/resources.ts:152-156`

Replace the fabricated Returns block with the fields the handler actually emits, and add the `index` block from PR #14:

```
**Returns:**
- `totalNotes`: Notes currently in the index
- `totalBlocks`: Indexed blocks across those notes
- `embeddingDimension`: Vector length of the active model
- `modelKey`: Active embedding model
- `git`: Repository status, or null when git is unavailable
- `sync`: Commit/push state, pending paths, errors
- `index`: Startup reconcile counts — `indexed`, `missing`, `dropped`,
  `refused`, `missing_sample`, and `hint` when refused
```

`index.indexed` is a startup snapshot while `totalNotes` is read live, so the two differ by design after a reconcile drops entries. The block states the relationship — `indexed − dropped = totalNotes` — so an agent seeing 66 next to 32 can reconcile them instead of reporting a bug.

### D5 — `src/resources.ts:241`

"Check `get_stats` → `embedder_ready` to verify model status" points at a field that does not exist.

There is no field to repoint it at. `Embedder.isAvailable()` exists (`src/embedder.ts:42`) and `SearchEngine` consults it (`src/search-engine.ts:199`), but `getStats()` never surfaces it. `embeddingDimension` is not a substitute: it is derived from vectors already stored on disk, so it stays non-zero when the model fails to load in a vault that has been embedded before — it would report "ready" in exactly the failure case the section is about.

So the sentence is removed rather than repointed, and the section states plainly that the fallback is automatic and no field currently reports model status. Documenting the absence is honest; inventing a proxy is not.

**Noted, not done:** surfacing the real signal is one additive line in `getStats()` — `embedderReady: this.embedder?.isAvailable() ?? false` — which is non-breaking and would make the original documentation's intent true. It is excluded because §2 fixes docs only, and implementing this field was part of the code-change option that was declined. Worth revisiting as its own change.

### D6 — `src/resources.ts:99-108`

`search_notes` documents parameters but has no Returns block, so PR #14's `index_warning` and the response wrap are undocumented. Add one, stating that the normal response is the results array and that it becomes `{ results, index_warning }` only while the index is unreconciled.

## 4. CI: `dist/` freshness gate

One step in `.github/workflows/ci.yml`, appended to the existing `test` job after `Build`:

```yaml
      - name: Verify dist/ is current
        run: git diff --exit-code -- dist/
```

`Build` already runs `npm run build`. This asserts the build produced nothing the committed tree does not already contain.

**Determinism.** The gate compares a Windows-authored `dist/` against an Ubuntu-built one, which is safe here for three verified reasons:

- `.gitattributes` sets `text eol=lf` for `*.js`, `*.ts`, and `*.map`, so line endings are LF in both working trees despite `core.autocrlf=true` locally.
- Sourcemaps carry relative POSIX paths (`"sources":["../src/issue-tracker.ts"]`), not absolute or platform-specific ones.
- `npm ci` installs the exact TypeScript version pinned in `package-lock.json`, so both sides run the same compiler.

**Failure mode.** A red `Verify dist/ is current` means the author changed `src/` without rebuilding. The fix is `npm run build` and commit — the same manual step, now enforced instead of remembered.

This PR proves the gate on itself: D3 changes a string in `src/index-health-hints.ts`, so `dist/` must be rebuilt for CI to pass.

## 5. Comments on issues #4 and #7

Both are closed, both were fixed by PR #12, and both were raised again by issue #13's reporter as possibly warranting reopening.

The distinction that makes a follow-up worth posting: PR #12 filtered phantom paths at **read** time, so the stale entries stayed in the index and stayed reachable by any path that bypassed the filter. PR #14 is what allows them to be **dropped**, because the old `>50%` guard was refusing the cleanup. A vault that was stuck now self-heals on its first start. Whether that actually happened in a real vault is unverified.

Each comment is tailored to what its issue claimed, and both carry the same verification recipe and the same public-repo constraint.

### Comment on #4

> **Follow-up: this should now self-heal — can you confirm?**
>
> This was fixed in #12 by filtering `listByPrefix` against the filesystem, which stopped phantom paths from reaching the `init` listing. But the stale entries themselves stayed in the index, because `reconcileWithFilesystem` was refusing to drop them — the `>50%` guard described in #13. With 28 of your entries phantom, that guard was likely tripped in exactly the vault this issue came from.
>
> #14 fixed the guard. The stale entries should now actually be dropped on startup rather than filtered at read time.
>
> To confirm, run `get_stats` and look at the new `index` block:
>
> - On the first start after updating, `dropped` should be non-zero.
> - On every start after that, `missing` should be 0.
> - The `Memory/memory/` paths should be gone from the index entirely — not just absent from the `init` listing.
>
> Please report the counts here. **Counts only — no note paths, note titles, or vault contents; this repository is public.**
>
> If `missing` stays non-zero across restarts, say so and this gets reopened.

### Comment on #7

> **Follow-up: this should now self-heal — can you confirm?**
>
> This was fixed in #12 by making `resolveNotePath` verify the file exists rather than trusting the index key. That closed the silent-create, but it left the stale keys in place — `reconcileWithFilesystem` was refusing to drop them under the `>50%` guard described in #13.
>
> #14 fixed the guard, so the stale keys that made this reachable should now be dropped on startup.
>
> To confirm, run `get_stats` and look at the new `index` block:
>
> - On the first start after updating, `dropped` should be non-zero.
> - On every start after that, `missing` should be 0.
>
> Then try a `note_workflow` `edit` against a path you know is stale. It should error rather than silently creating a file — and after the reconcile, that path should no longer be in the index at all.
>
> Please report the counts and the error here. **Counts only — no note paths, note titles, or vault contents; this repository is public.**
>
> If `missing` stays non-zero across restarts, or the edit still creates a file, say so and this gets reopened.

These are posted independently of the PR. The #14 fix is already on `main`, so the behavior they ask about is live now.

## 6. Testing

**Regression test — fabricated field names.** Following the registry-derived anti-drift pattern established in PR #14, scan the actual `MEMORY_RESOURCES` registry and assert that `total_vectors`, `embedder_ready`, and `total_notes` appear nowhere in the rendered text. This is what prevents a field name that does not exist from being documented again — the exact defect §1.1 describes. Asserting against the live registry rather than a hand-copied list means new resources are covered automatically.

**New test — D3.** Assert the hint states the append-only reason and no longer claims the server never writes to `.ajson`. The existing assertions at `src/index-health-hints.test.ts:34` (`Do NOT delete .smart-env`) and `:51` (`the vault server`) must both still pass, which pins the prohibition and the naming through the rewrite.

**Unchanged.** No behavior changes, so no new behavioral tests. `src/index.ts` remains untestable by design (top-level side effects at import).

**Verification.** `npx tsc --noEmit` and the full suite must be green. The `dist/` gate verifies itself on this PR's own CI run.

## 7. Changelog

A new `## docs-and-ci-accuracy` section at the top of `CHANGELOG.md`, before `## index-reconcile-recovery`, per the repo's undated-heading convention:

- **Fixed** — the `get_stats` documentation naming fields that never existed, including an instruction to check `embedder_ready`; the false claim that the server never writes to `.ajson`; stale line-number citations.
- **Added** — a CI step failing the build when the committed `dist/` does not match what `src/` produces; a Returns block for `search_notes` documenting `index_warning`.
