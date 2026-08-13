/**
 * Escalation hints for an index the server declined to reconcile.
 *
 * The refusal used to reach stderr only, where the MCP client logs it and no
 * agent ever sees it. These builders carry it into get_stats and search_notes
 * instead, following the sync-hints precedent.
 */
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
export declare function buildIndexRefusalHint(vaultPath: string, health: IndexHealth): string;
/**
 * Rides along in every search response while the index is unreconciled, so it
 * carries counts only. Vault note paths carry client names, project names, and
 * personal note titles, and the tracker repository is public. The full sample
 * lives in get_stats, which an agent fetches deliberately.
 */
export declare function buildSearchIndexWarning(health: IndexHealth): Record<string, unknown> | undefined;
//# sourceMappingURL=index-health-hints.d.ts.map