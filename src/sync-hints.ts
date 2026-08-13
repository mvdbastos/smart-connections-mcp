/**
 * Escalation hints for sync failures the server cannot fix itself.
 *
 * The server cannot clear a stale index.lock or repair a failing hook; the
 * agent reading these hints can. Both are surfaced through the sync block,
 * following the NEXT_STEPS_TEXT precedent.
 */

import { ISSUE_TRACKER } from './issue-tracker.js';

/**
 * Deliberately bounded: named causes with exact commands, and an explicit
 * prohibition on destructive recovery. An open mandate to "fix git" in the
 * repository holding the user's notes invites an agent to reach for
 * `reset --hard` and destroy uncommitted vault edits.
 */
export function buildRemediationHint(vaultRoot: string, error: string): string {
  return [
    `Auto-commit is blocked in ${vaultRoot}.`,
    `Error: ${error}`,
    '',
    `Diagnose:  git -C ${vaultRoot} status`,
    '',
    'Likely causes:',
    `  1. stale lock     -> remove ${vaultRoot}/.git/index.lock if no git process is running`,
    `  2. failing hook   -> git -C ${vaultRoot} commit  to see hook output`,
    `  3. detached HEAD  -> git -C ${vaultRoot} switch main`,
    '',
    'Do NOT run reset --hard, checkout -- ., or clean — uncommitted vault edits would be lost.',
    'If none of these apply, stop and report rather than improvising.',
    '',
    'Then call git_commit_notes to resume.',
  ].join('\n');
}

/**
 * Only reachable once a failure has survived a restart, which is a high
 * enough bar to justify touching a public tracker.
 *
 * Takes the quarantined paths solely to count them. They are never included:
 * the repository is public and vault note paths carry client names, project
 * names, and personal note titles.
 */
export function buildReportHint(error: string, quarantinedPaths: string[]): string {
  return [
    'This failure survived a restart and is likely a bug in the vault server.',
    '',
    'Search existing issues first:',
    `  gh issue list -R ${ISSUE_TRACKER} --search "${error.replace(/"/g, "'")}"`,
    '',
    'Update the matching issue if one exists; otherwise open a new one.',
    '',
    `Include: the git error text, git --version, your OS, and the number of quarantined paths (${quarantinedPaths.length}).`,
    'Do NOT include note paths, note titles, or vault contents — this repository is public.',
  ].join('\n');
}
