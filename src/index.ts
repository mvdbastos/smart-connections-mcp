#!/usr/bin/env node

/**
 * Smart Connections MCP Server
 *
 * Provides semantic search and knowledge graph capabilities for Obsidian Smart Connections
 * via the Model Context Protocol (MCP).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
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
await embedder.tryInit();
searchEngine.setEmbedder(embedder);

// Initialize git manager for the vault
const gitManager = new GitManager(VAULT_ROOT);

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
    },
  }
);

// Define tool schemas
const GetSimilarNotesSchema = z.object({
  note_path: z.string().describe('Path to the note (e.g., "Note.md" or "Folder/Note.md")'),
  threshold: z.number().min(0).max(1).default(0.5).describe('Similarity threshold (0-1)'),
  limit: z.number().int().positive().default(10).describe('Maximum number of results'),
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

const EditNoteSchema = z.object({
  note_path: z.string().describe('Path to the note, relative to the vault'),
  content: z.string().describe('Markdown content to write or append'),
  mode: z.enum(['overwrite', 'append', 'append-section']).default('append').describe('Edit mode'),
  heading: z.string().optional().describe('Heading used for append-section mode'),
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

// Define available tools
const tools: Tool[] = [
  {
    name: 'get_similar_notes',
    description: 'Find notes semantically similar to a given note using embeddings. Returns paths, similarity scores, and available blocks.',
    inputSchema: {
      type: 'object',
      properties: {
        note_path: {
          type: 'string',
          description: 'Path to the note (e.g., "Note.md" or "Folder/Note.md")',
        },
        threshold: {
          type: 'number',
          description: 'Similarity threshold (0-1), default 0.5',
          minimum: 0,
          maximum: 1,
          default: 0.5,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results, default 10',
          minimum: 1,
          default: 10,
        },
      },
      required: ['note_path'],
    },
  },
  {
    name: 'get_connection_graph',
    description: 'Build a multi-level connection graph starting from a note, showing how notes are semantically connected.',
    inputSchema: {
      type: 'object',
      properties: {
        note_path: {
          type: 'string',
          description: 'Path to the note to start from',
        },
        depth: {
          type: 'number',
          description: 'Depth of the connection graph (levels), default 2',
          minimum: 1,
          default: 2,
        },
        threshold: {
          type: 'number',
          description: 'Similarity threshold (0-1), default 0.6',
          minimum: 0,
          maximum: 1,
          default: 0.6,
        },
        max_per_level: {
          type: 'number',
          description: 'Max connections per level, default 5',
          minimum: 1,
          default: 5,
        },
      },
      required: ['note_path'],
    },
  },
  {
    name: 'search_notes',
    description: 'Search for notes using a text query. Returns notes ranked by relevance with similarity scores.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query text',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results, default 10',
          minimum: 1,
          default: 10,
        },
        threshold: {
          type: 'number',
          description: 'Similarity threshold (0-1), default 0.5',
          minimum: 0,
          maximum: 1,
          default: 0.5,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_embedding_neighbors',
    description: 'Find nearest neighbors for a given embedding vector. Useful for custom similarity searches.',
    inputSchema: {
      type: 'object',
      properties: {
        embedding_vector: {
          type: 'array',
          items: { type: 'number' },
          description: '384-dimensional embedding vector',
        },
        k: {
          type: 'number',
          description: 'Number of neighbors to return, default 10',
          minimum: 1,
          default: 10,
        },
        threshold: {
          type: 'number',
          description: 'Similarity threshold (0-1), default 0.5',
          minimum: 0,
          maximum: 1,
          default: 0.5,
        },
      },
      required: ['embedding_vector'],
    },
  },
  {
    name: 'get_note_content',
    description: 'Retrieve the full content of a note, optionally with specific blocks/sections extracted.',
    inputSchema: {
      type: 'object',
      properties: {
        note_path: {
          type: 'string',
          description: 'Path to the note',
        },
        include_blocks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific block headings to include (optional)',
        },
      },
      required: ['note_path'],
    },
  },
  {
    name: 'get_stats',
    description: 'Get statistics about the Smart Connections knowledge base (total notes, blocks, embedding model, etc.).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'create_note',
    description: 'Create a new markdown note in the vault and update its local embedding when available.',
    inputSchema: {
      type: 'object',
      properties: {
        note_path: { type: 'string', description: 'Path for the new note, relative to vault root' },
        content: { type: 'string', description: 'Markdown content to write' },
        frontmatter: { type: 'object', description: 'Optional frontmatter fields' },
      },
      required: ['note_path', 'content'],
    },
  },
  {
    name: 'edit_note',
    description: 'Edit a markdown note using overwrite, append, or append-section mode and update its local embedding when available.',
    inputSchema: {
      type: 'object',
      properties: {
        note_path: { type: 'string', description: 'Path to the note, relative to vault root' },
        content: { type: 'string', description: 'Markdown content to write or append' },
        mode: {
          type: 'string',
          enum: ['overwrite', 'append', 'append-section'],
          default: 'append',
          description: 'Edit mode',
        },
        heading: { type: 'string', description: 'Heading to add in append-section mode' },
      },
      required: ['note_path', 'content'],
    },
  },
  {
    name: 'delete_note',
    description: 'Delete a markdown note from the vault.',
    inputSchema: {
      type: 'object',
      properties: {
        note_path: { type: 'string', description: 'Path to the note, relative to vault root' },
      },
      required: ['note_path'],
    },
  },
  {
    name: 'git_commit_notes',
    description: 'Commit all uncommitted changes to git with an auto-generated or custom message.',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Commit message; auto-generated if omitted (e.g., "Updated: note1.md, note2.md")',
        },
        author_name: {
          type: 'string',
          description: 'Git author name; uses git config user.name if omitted',
        },
        author_email: {
          type: 'string',
          description: 'Git author email; uses git config user.email if omitted',
        },
      },
    },
  },
  {
    name: 'git_commit_notes_specific',
    description: 'Commit specific note files to git.',
    inputSchema: {
      type: 'object',
      properties: {
        note_paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Paths to notes to commit (relative to vault root, e.g., ["Note.md", "Folder/Note.md"])',
        },
        message: {
          type: 'string',
          description: 'Commit message; auto-generated if omitted',
        },
        author_name: {
          type: 'string',
          description: 'Git author name; uses git config user.name if omitted',
        },
        author_email: {
          type: 'string',
          description: 'Git author email; uses git config user.email if omitted',
        },
      },
      required: ['note_paths'],
    },
  },
  {
    name: 'git_push_notes',
    description: 'Push committed note changes to the configured git remote, with a local fallback when remote push is unavailable.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'git_sync_notes',
    description: 'Sync notes by fetching, pulling, then pushing changes. Detects and reports merge conflicts.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

console.error(`Registered ${tools.length} tools: ${tools.map((tool) => tool.name).join(', ')}`);

// Handle tool list requests
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handle tool execution requests
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'get_similar_notes': {
        const { note_path, threshold, limit } = GetSimilarNotesSchema.parse(args);
        const results = searchEngine.getSimilarNotes(note_path, threshold, limit);
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
        const { query, limit, threshold } = SearchNotesSchema.parse(args);
        const results = await searchEngine.searchByQuery(query, limit, threshold);
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
        createNote(VAULT_ROOT, note_path, content, frontmatter);
        const embedding = await embedUpdatedNote(note_path);
        const result = { success: true, note_path, ...embedding };
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
        const { note_path, content, mode, heading } = EditNoteSchema.parse(args);
        editNote(VAULT_ROOT, note_path, content, mode, heading);
        const embedding = await embedUpdatedNote(note_path);
        const result = { success: true, note_path, mode, ...embedding };
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
    const errorMessage = error instanceof Error ? error.message : String(error);
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

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);

console.error('Smart Connections MCP Server running on stdio');
