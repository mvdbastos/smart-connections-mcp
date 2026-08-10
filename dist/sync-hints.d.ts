/**
 * Escalation hints for sync failures the server cannot fix itself.
 *
 * The server cannot clear a stale index.lock or repair a failing hook; the
 * agent reading these hints can. Both are surfaced through the sync block,
 * following the NEXT_STEPS_TEXT precedent.
 */
/**
 * Deliberately bounded: named causes with exact commands, and an explicit
 * prohibition on destructive recovery. An open mandate to "fix git" in the
 * repository holding the user's notes invites an agent to reach for
 * `reset --hard` and destroy uncommitted vault edits.
 */
export declare function buildRemediationHint(vaultRoot: string, error: string): string;
/**
 * Only reachable once a failure has survived a restart, which is a high
 * enough bar to justify touching a public tracker.
 *
 * Takes the quarantined paths solely to count them. They are never included:
 * the repository is public and vault note paths carry client names, project
 * names, and personal note titles.
 */
export declare function buildReportHint(error: string, quarantinedPaths: string[]): string;
//# sourceMappingURL=sync-hints.d.ts.map