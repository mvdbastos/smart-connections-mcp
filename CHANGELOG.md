# Changelog

## git-integration

### Added
- Added Vitest with `test` and `test:watch` scripts for TDD workflow.
- Added git result and status types: `GitCommitResult`, `GitSyncResult`, and `GitStatus`.
- Added `GitManager` to handle git availability checks, repository detection, commits, sync, and status reporting.
- Added MCP git tools:
  - `git_commit_notes`
  - `git_commit_notes_specific`
  - `git_sync_notes`
- Added git status data to `get_stats`.
- Added startup logging for registered MCP tools.

### Changed
- Renamed git-focused MCP tools to use the `git_` prefix.
- Bounded git command execution time and disabled interactive git prompts so MCP requests fail fast instead of timing out in the client.
- Resolved upstream tracking from `@{upstream}` with fallback to `origin/<branch>` for ahead/behind and remote commit calculations.
- Restricted specific-file commits to the requested paths only, preserving unrelated staged files.
- Normalized repository path comparison for Windows path variants.

### Tests
- Added GitManager coverage for:
  - git availability and repository detection
  - branch and git config lookup
  - commit-all and commit-specific flows
  - custom author commits
  - git status structure
  - missing repository handling
  - sync timeout handling
  - non-`origin` upstream handling
  - protection against committing unrelated staged files

### Verification
- `npm test` passes with 13 tests.
- `npm run build` passes.
