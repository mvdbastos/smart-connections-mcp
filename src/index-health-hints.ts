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
    '     Report counts only — do NOT include note paths, note titles, or vault',
    '     contents; this repository is public.',
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
