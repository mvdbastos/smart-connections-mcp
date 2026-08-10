#!/usr/bin/env node

/**
 * Smart Connections MCP Server
 *
 * Provides semantic search and knowledge graph capabilities for Obsidian Smart Connections
 * via the Model Context Protocol (MCP).
 */

import { fileURLToPath } from 'url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { SmartConnectionsLoader } from './smart-connections-loader.js';
import { SearchEngine } from './search-engine.js';
import { GitManager } from './git-manager.js';
import { Embedder } from './embedder.js';
import { appendSourceVector } from './ajson-writer.js';
import { createNote, deleteNote, editNote } from './note-writer.js';
import { UsageLog } from './tool-usage-log.js';
import { MEMORY_RESOURCE_BY_URI, MEMORY_RESOURCES } from './resources.js';
import { MEMORY_PROMPT_BY_NAME, type PromptContext } from './prompts.js';
import { SyncScheduler } from './sync-scheduler.js';
import type { SyncStatus } from './sync-scheduler.js';
import { SyncJournal } from './sync-journal.js';
import { buildRemediationHint, buildReportHint } from './sync-hints.js';
import { EditNoteSchema, NoteWorkflowSchema, formatToolError } from './tool-schemas.js';
import { tools } from './tool-definitions.js';
import type { EditOptions } from './note-writer.js';
import type { GitCommitResult, GitSyncResult, GitStatus } from './types.js';

// Environment variable for vault path
const VAULT_PATH_ENV = process.env.SMART_VAULT_PATH;

if (!VAULT_PATH_ENV) {
  console.error('Error: SMART_VAULT_PATH environment variable is required');
  console.error('Please set it to your Obsidian vault path, e.g.:');
  console.error('  export SMART_VAULT_PATH="/Users/username/My Vault"');
  process.exit(1);
}

const VAULT_ROOT = VAULT_PATH_ENV;

// Initialize loader
const loader = new SmartConnectionsLoader(VAULT_ROOT);
await loader.initialize();

// Create search engine after loader is initialized
const searchEngine = new SearchEngine(loader);

// Initialize local embedder for query search and write-time note embeddings.
const embedder = new Embedder();
embedder.tryInit().then(() => {
  searchEngine.setEmbedder(embedder);
}).catch((err) => {
  console.error('Embedder initialization failed; keyword search will be used as fallback:', err);
});

// Initialize git manager for the vault
const gitManager = new GitManager(VAULT_ROOT);

function parseUsageLogPath(argv: string[]): string | null {
  for (const arg of argv) {
    if (arg === '--log-usage') {
      return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'logs', 'mcp-tool-usage.log');
    }
    if (arg.startsWith('--log-usage=')) {
      return arg.slice('--log-usage='.length);
    }
  }
  return null;
}

const usageLogPath = parseUsageLogPath(process.argv.slice(2));
const usageLog = usageLogPath ? new UsageLog(usageLogPath) : null;

if (usageLog) {
  console.error(`Deprecated-tool usage logging enabled: ${usageLogPath}`);
}

const COMMIT_IDLE_MS = parseInt(process.env.SYNC_COMMIT_IDLE_MS ?? '30000', 10);
const PUSH_IDLE_MS = parseInt(process.env.SYNC_PUSH_IDLE_MS ?? '120000', 10);

const syncScheduler = new SyncScheduler(
  {
    commitPaths: (paths, message) =>
      gitManager.commitSpecific(paths.map((notePath) => path.join(VAULT_ROOT, notePath)), message),
    push: () => gitManager.push(),
  },
  {
    commitIdleMs: COMMIT_IDLE_MS,
    pushIdleMs: PUSH_IDLE_MS,
    onIdleFlush: () => {
      void usageLog?.flush();
    },
    journal: new SyncJournal(path.join(VAULT_ROOT, '.git', 'smart-connections-mcp', 'pending.json')),
  }
);

function buildSyncBlock(status: SyncStatus, deferred: boolean): Record<string, unknown> {
  const state = status.state === 'commit_pending'
    ? (deferred ? 'commit_deferred' : 'commit_scheduled')
    : status.state;

  const quarantined = status.quarantinedPaths.length > 0;
  const remediation = quarantined
    ? buildRemediationHint(VAULT_ROOT, status.lastCommitError ?? 'unknown error')
    : undefined;
  const report = quarantined && status.quarantineSurvivedRestart
    ? buildReportHint(status.lastCommitError ?? 'unknown error', status.quarantinedPaths)
    : undefined;

  return {
    state,
    commit_in_seconds: status.commitInSeconds,
    pending_paths: status.pendingPaths,
    push_after_commit_seconds: Math.round(PUSH_IDLE_MS / 1000),
    ...(status.lastCommitError ? { error: status.lastCommitError } : {}),
    ...(status.pushState ? { push_state: status.pushState } : {}),
    ...(quarantined ? { quarantined_paths: status.quarantinedPaths } : {}),
    ...(remediation ? { remediation } : {}),
    ...(report ? { report } : {}),
  };
}

const NEXT_STEPS_TEXT = `Changes auto-commit after ${Math.round(COMMIT_IDLE_MS / 1000)}s idle and auto-push ${Math.round(PUSH_IDLE_MS / 1000)}s later. Pass defer_hint_seconds if more edits are coming. No git tool calls needed.`;

console.error('Smart Connections MCP Server initialized successfully');
console.error(`Vault: ${VAULT_ROOT}`);
console.error(`Loaded ${loader.getSources().size} notes`);

// Create MCP server
const server = new Server(
  {
    name: 'smart-connections-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  }
);

// Define tool schemas
const GetSimilarNotesSchema = z.object({
  note_path: z.string().describe('Path to the note (e.g., "Note.md" or "Folder/Note.md")'),
  threshold: z.number().min(0).max(1).default(0.5).describe('Similarity threshold (0-1)'),
  limit: z.number().int().positive().default(10).describe('Maximum number of results'),
  include_content: z.boolean().default(false).describe('Include note content inline in each result'),
  content_max_chars: z.number().int().positive().default(2000).describe('Max content characters per note'),
});

const GetConnectionGraphSchema = z.object({
  note_path: z.string().describe('Path to the note to start from'),
  depth: z.number().int().positive().default(2).describe('Depth of the connection graph'),
  threshold: z.number().min(0).max(1).default(0.6).describe('Similarity threshold (0-1)'),
  max_per_level: z.number().int().positive().default(5).describe('Max connections per level'),
});

const SearchNotesSchema = z.object({
  query: z.string().describe('Search query text'),
  limit: z.number().int().positive().default(10).describe('Maximum number of results'),
  threshold: z.number().min(0).max(1).default(0.5).describe('Similarity threshold (0-1)'),
  include_content: z.boolean().default(false).describe('Include note content inline in each result'),
  content_max_chars: z.number().int().positive().default(2000).describe('Max content characters per note'),
});

const GetEmbeddingNeighborsSchema = z.object({
  embedding_vector: z.array(z.number()).describe('384-dimensional embedding vector'),
  k: z.number().int().positive().default(10).describe('Number of neighbors to return'),
  threshold: z.number().min(0).max(1).default(0.5).describe('Similarity threshold (0-1)'),
});

const GetNoteContentSchema = z.object({
  note_path: z.string().describe('Path to the note'),
  include_blocks: z.array(z.string()).optional().describe('Specific block headings to include'),
});

const GetStatsSchema = z.object({});

const CommitNotesSchema = z.object({
  message: z.string().optional().describe('Commit message; auto-generated if omitted'),
  author_name: z.string().optional().describe('Git author name; uses config if omitted'),
  author_email: z.string().optional().describe('Git author email; uses config if omitted'),
});

const CommitNotesSpecificSchema = z.object({
  note_paths: z.array(z.string()).describe('Paths to notes to commit (relative to vault)'),
  message: z.string().optional().describe('Commit message; auto-generated if omitted'),
  author_name: z.string().optional().describe('Git author name; uses config if omitted'),
  author_email: z.string().optional().describe('Git author email; uses config if omitted'),
});

const CreateNoteSchema = z.object({
  note_path: z.string().describe('Path for the new note, relative to the vault'),
  content: z.string().describe('Markdown content to write'),
  frontmatter: z.record(z.unknown()).optional().describe('Optional frontmatter fields'),
});

const DeleteNoteSchema = z.object({
  note_path: z.string().describe('Path to the note, relative to the vault'),
});

const SyncNotesSchema = z.object({});

async function embedUpdatedNote(notePath: string): Promise<{ embedded: boolean; error?: string }> {
  if (!embedder.isAvailable()) {
    return { embedded: false, error: 'Embedder unavailable; note write succeeded without vector update' };
  }

  try {
    const fullPath = path.join(VAULT_ROOT, notePath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const vec = await embedder.embed(content);
    const hash = createHash('sha256').update(content).digest('hex');
    const tokens = content.trim().length === 0 ? 0 : content.trim().split(/\s+/).length;
    const source = appendSourceVector(VAULT_ROOT, notePath, vec, loader.getEmbeddingModelKey(), hash, tokens);
    loader.upsertSource(source);
    return { embedded: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { embedded: false, error: message };
  }
}

console.error(`Registered ${tools.length} tools: ${tools.map((tool) => tool.name).join(', ')}`);

// Handle tool list requests
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: MEMORY_RESOURCES.map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      description: resource.description,
      mimeType: 'text/markdown',
    })),
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const resource = MEMORY_RESOURCE_BY_URI.get(request.params.uri);

  if (!resource) {
    throw new Error(`Unknown resource: ${request.params.uri}`);
  }

  return {
    contents: [
      {
        uri: resource.uri,
        mimeType: 'text/markdown',
        text: resource.text,
      },
    ],
  };
});

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: Array.from(MEMORY_PROMPT_BY_NAME.values()).map((prompt) => ({
      name: prompt.name,
      description: prompt.description,
      arguments: prompt.arguments,
    })),
  };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const prompt = MEMORY_PROMPT_BY_NAME.get(request.params.name);

  if (!prompt) {
    throw new Error(`Unknown prompt: ${request.params.name}`);
  }

  const context: PromptContext = {
    search: async (query: string, limit: number, threshold: number) => {
      const results = await searchEngine.searchByQuery(query, limit, threshold);
      return results.map((r) => ({ path: r.path, score: r.similarity }));
    },
    listByPrefix: async (prefix: string) =>
      Array.from(loader.getSources().keys())
        .filter((notePath) => notePath.startsWith(prefix))
        .filter((notePath) => fs.existsSync(path.join(VAULT_ROOT, notePath)))
        .sort(),
  };

  const text = await prompt.build(request.params.arguments || {}, context);

  return {
    description: prompt.description,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text,
        },
      },
    ],
  };
});

const DEPRECATED_TOOLS = new Set([
  'create_note',
  'edit_note',
  'delete_note',
  'git_commit_notes',
  'git_commit_notes_specific',
  'git_push_notes',
  'git_sync_notes',
]);

function summarizeArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object') {
    return {};
  }

  const source = args as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const key of ['note_path', 'note_paths', 'mode', 'message']) {
    if (key in source) {
      summary[key] = source[key];
    }
  }

  return summary;
}

// Handle tool execution requests
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (usageLog && DEPRECATED_TOOLS.has(name)) {
    usageLog.record(name, summarizeArgs(args));
  }

  try {
    switch (name) {
      case 'note_workflow': {
        const params = NoteWorkflowSchema.parse(args);

        let targetPath = params.note_path;
        if (params.action !== 'create') {
          try {
            targetPath = loader.resolveNotePath(params.note_path, 'write');
          } catch {
            // Not indexed, or indexed but gone from disk. Fall back to the
            // literal path; note-writer performs the authoritative existence
            // check and refuses rather than fabricating the file.
          }
        }

        let payload: Record<string, unknown>;
        let wroteChanges = false;

        if (params.action === 'create') {
          targetPath = createNote(VAULT_ROOT, targetPath, params.content ?? '', params.frontmatter);
          const embedding = await embedUpdatedNote(targetPath);
          payload = { action: 'create', note_path: targetPath, written: true, embedding };
          wroteChanges = true;
        } else if (params.action === 'edit') {
          const editResult = editNote(VAULT_ROOT, targetPath, {
            mode: params.mode,
            content: params.content,
            heading: params.heading,
            find: params.find,
            regex: params.regex,
            count: params.count,
            dryRun: params.dry_run,
          });
          wroteChanges = editResult.written && editResult.changed;
          const embedding = wroteChanges ? await embedUpdatedNote(targetPath) : undefined;
          payload = { action: 'edit', ...editResult, ...(embedding ? { embedding } : {}) };
        } else {
          deleteNote(VAULT_ROOT, targetPath);
          loader.removeSource(targetPath);
          payload = { action: 'delete', note_path: targetPath, written: true };
          wroteChanges = true;
        }

        if (wroteChanges) {
          try {
            syncScheduler.markDirty(targetPath, params.defer_hint_seconds);
          } catch (error) {
            payload.sync_error = error instanceof Error ? error.message : String(error);
          }
        }

        payload.sync = buildSyncBlock(syncScheduler.getStatus(), params.defer_hint_seconds !== undefined);
        payload.next_steps = NEXT_STEPS_TEXT;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(payload, null, 2),
            },
          ],
        };
      }

      case 'get_similar_notes': {
        const { note_path, threshold, limit, include_content, content_max_chars } = GetSimilarNotesSchema.parse(args);
        const results = searchEngine.getSimilarNotes(note_path, threshold, limit, {
          includeContent: include_content,
          contentMaxChars: content_max_chars,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }

      case 'get_connection_graph': {
        const { note_path, depth, threshold, max_per_level } = GetConnectionGraphSchema.parse(args);
        const graph = searchEngine.getConnectionGraph(note_path, depth, threshold, max_per_level);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(graph, null, 2),
            },
          ],
        };
      }

      case 'search_notes': {
        const { query, limit, threshold, include_content, content_max_chars } = SearchNotesSchema.parse(args);
        const results = await searchEngine.searchByQuery(query, limit, threshold, {
          includeContent: include_content,
          contentMaxChars: content_max_chars,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }

      case 'get_embedding_neighbors': {
        const { embedding_vector, k, threshold } = GetEmbeddingNeighborsSchema.parse(args);
        const results = searchEngine.getEmbeddingNeighbors(embedding_vector, k, threshold);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }

      case 'get_note_content': {
        const { note_path, include_blocks } = GetNoteContentSchema.parse(args);
        const result = searchEngine.getNoteWithContext(note_path, include_blocks);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'create_note': {
        const { note_path, content, frontmatter } = CreateNoteSchema.parse(args);
        const writtenPath = createNote(VAULT_ROOT, note_path, content, frontmatter);
        const embedding = await embedUpdatedNote(writtenPath);
        syncScheduler.markDirty(writtenPath);
        const result = { success: true, note_path: writtenPath, ...embedding };
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'edit_note': {
        const { note_path, content, mode, heading, find, regex, count, dry_run } = EditNoteSchema.parse(args);
        const options: EditOptions = {
          mode,
          content,
          heading,
          find,
          regex,
          count,
          dryRun: dry_run,
        };
        const editResult = editNote(VAULT_ROOT, note_path, options);
        const embedding = editResult.written && editResult.changed ? await embedUpdatedNote(note_path) : undefined;
        if (editResult.written && editResult.changed) {
          syncScheduler.markDirty(note_path);
        }
        const result = embedding ? { ...editResult, embedding } : editResult;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'delete_note': {
        const { note_path } = DeleteNoteSchema.parse(args);
        deleteNote(VAULT_ROOT, note_path);
        loader.removeSource(note_path);
        syncScheduler.markDirty(note_path);
        const result = { success: true, note_path };
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'git_commit_notes': {
        const { message, author_name, author_email } = CommitNotesSchema.parse(args);

        let commitMessage = message;
        if (!commitMessage) {
          try {
            const statusOutput = execFileSync('git', ['status', '--short'], {
              cwd: VAULT_ROOT,
              stdio: 'pipe',
              encoding: 'utf-8',
              timeout: 10000,
              env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
            });
            const files = statusOutput
              .split('\n')
              .filter((line) => line.length > 0)
              .map((line) => line.substring(3));
            const fileList = files.length > 5 ? [...files.slice(0, 4), '...'].join(', ') : files.join(', ');
            commitMessage = `Updated: ${fileList || 'workspace'}`;
          } catch {
            commitMessage = 'Updated: workspace';
          }
        }

        const result: GitCommitResult = gitManager.commitAll(commitMessage, author_name, author_email);
        if (result.success) {
          syncScheduler.notifyManualCommit();
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
          isError: !result.success,
        };
      }

      case 'git_commit_notes_specific': {
        const { note_paths, message, author_name, author_email } = CommitNotesSpecificSchema.parse(args);

        let commitMessage = message;
        if (!commitMessage) {
          const noteList = note_paths.slice(0, 3).join(', ');
          const suffix = note_paths.length > 3 ? ` (+${note_paths.length - 3} more)` : '';
          commitMessage = `Updated: ${noteList}${suffix}`;
        }

        const absolutePaths = note_paths.map((notePath) => path.join(VAULT_ROOT, notePath));
        const result: GitCommitResult = gitManager.commitSpecific(absolutePaths, commitMessage, author_name, author_email);
        if (result.success) {
          syncScheduler.notifyManualCommit();
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
          isError: !result.success,
        };
      }

      case 'git_push_notes': {
        SyncNotesSchema.parse(args);
        const result = gitManager.push();
        if (result.success) {
          syncScheduler.notifyManualPush();
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
          isError: !result.success,
        };
      }

      case 'git_sync_notes': {
        SyncNotesSchema.parse(args);
        const result: GitSyncResult = gitManager.syncNotes();
        if (result.success) {
          syncScheduler.notifyManualPush();
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
          isError: !result.success,
        };
      }

      case 'get_stats': {
        GetStatsSchema.parse(args);
        const stats = searchEngine.getStats();
        let gitStatus: GitStatus | null = null;

        if (gitManager.isGitAvailable()) {
          gitStatus = gitManager.getStatus();
        }

        const combinedStats = {
          ...stats,
          git: gitStatus,
          sync: syncScheduler.getStatus(),
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(combinedStats, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = formatToolError(name, error);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: errorMessage }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Flush pending commits/pushes and queued usage-log entries on shutdown.
let shutdownRan = false;
function shutdown(): void {
  if (shutdownRan) {
    return;
  }
  shutdownRan = true;

  try {
    syncScheduler.flushSync();
  } catch (error) {
    console.error('Sync flush on shutdown failed:', error);
  }

  try {
    usageLog?.flushSync();
  } catch (error) {
    console.error('Usage log flush on shutdown failed:', error);
  }
}

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});
process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});
process.stdin.on('close', () => {
  shutdown();
});

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);

console.error('Smart Connections MCP Server running on stdio');
