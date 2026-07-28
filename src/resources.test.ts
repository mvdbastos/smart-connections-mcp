import { describe, it, expect } from 'vitest';
import { MEMORY_RESOURCES, MEMORY_RESOURCE_BY_URI } from './resources';
import { MEMORY_PROMPTS } from './prompts';

describe('resources', () => {
  it('should have 4 resources', () => {
    expect(MEMORY_RESOURCES).toHaveLength(4);
  });

  it('should have unique URIs', () => {
    const uris = MEMORY_RESOURCES.map((r) => r.uri);
    expect(new Set(uris).size).toBe(uris.length);
  });

  it('should have all URIs start with memory-guide://', () => {
    MEMORY_RESOURCES.forEach((r) => {
      expect(r.uri).toMatch(/^memory-guide:\/\/\w+$/);
    });
  });

  it('should have MEMORY_RESOURCE_BY_URI map all resources', () => {
    expect(MEMORY_RESOURCE_BY_URI.size).toBe(MEMORY_RESOURCES.length);
    MEMORY_RESOURCES.forEach((r) => {
      expect(MEMORY_RESOURCE_BY_URI.get(r.uri)).toBe(r);
    });
  });

  it('should document but clearly mark deprecated tools', () => {
    const deprecatedTools = ['create_note', 'edit_note', 'delete_note', 'git_commit_notes', 'git_commit_notes_specific', 'git_push_notes', 'git_sync_notes'];
    const toolsResource = MEMORY_RESOURCES.find((r) => r.uri === 'memory-guide://tools');
    // Deprecated tools should only appear in the "Deprecated" section with clear replacement guidance
    deprecatedTools.forEach((tool) => {
      expect(toolsResource?.text).toMatch(tool);
    });
    expect(toolsResource?.text).toMatch(/Deprecated.*Do Not Use/s);
  });

  it('should mention note_workflow as the primary write tool', () => {
    const toolsResource = MEMORY_RESOURCES.find((r) => r.uri === 'memory-guide://tools');
    expect(toolsResource?.text).toMatch(/note_workflow.*Preferred|⭐.*note_workflow/i);
  });

  it('should have all required fields', () => {
    MEMORY_RESOURCES.forEach((r) => {
      expect(r).toHaveProperty('uri');
      expect(r).toHaveProperty('name');
      expect(r).toHaveProperty('description');
      expect(r).toHaveProperty('text');
      expect(typeof r.uri).toBe('string');
      expect(typeof r.name).toBe('string');
      expect(typeof r.description).toBe('string');
      expect(typeof r.text).toBe('string');
    });
  });

  it('should have non-empty descriptions', () => {
    MEMORY_RESOURCES.forEach((r) => {
      expect(r.description.length).toBeGreaterThan(0);
    });
  });

  it('should have non-empty text content', () => {
    MEMORY_RESOURCES.forEach((r) => {
      expect(r.text.length).toBeGreaterThan(0);
    });
  });

  describe('index resource', () => {
    it('should exist and point to other resources', () => {
      const indexResource = MEMORY_RESOURCES.find((r) => r.uri === 'memory-guide://index');
      expect(indexResource).toBeDefined();
      expect(indexResource?.text).toMatch(/tools|sync|embeddings/i);
    });
  });

  describe('tools resource', () => {
    it('should document all current tools', () => {
      const toolsResource = MEMORY_RESOURCES.find((r) => r.uri === 'memory-guide://tools');
      const currentTools = ['note_workflow', 'search_notes', 'get_similar_notes', 'get_connection_graph', 'get_embedding_neighbors', 'get_note_content', 'get_stats'];
      currentTools.forEach((tool) => {
        expect(toolsResource?.text).toMatch(new RegExp(tool));
      });
    });

    it('should mark deprecated tools clearly', () => {
      const toolsResource = MEMORY_RESOURCES.find((r) => r.uri === 'memory-guide://tools');
      expect(toolsResource?.text).toMatch(/Deprecated|Do Not Use/i);
    });
  });

  describe('sync resource', () => {
    it('should explain idle debounce timing', () => {
      const syncResource = MEMORY_RESOURCES.find((r) => r.uri === 'memory-guide://sync');
      expect(syncResource?.text).toMatch(/30.*idle|commit.*30|120|push.*2/i);
    });
  });

  describe('embeddings resource', () => {
    it('should mention embedding model and fallback behavior', () => {
      const embeddingsResource = MEMORY_RESOURCES.find((r) => r.uri === 'memory-guide://embeddings');
      expect(embeddingsResource?.text).toMatch(/bge-micro|TaylorAI|fallback|keyword/i);
    });
  });

  describe('index resource prompt listing', () => {
    const indexResource = MEMORY_RESOURCE_BY_URI.get('memory-guide://index')!;

    it('should list the three memory-capture prompts', () => {
      expect(indexResource.text).toMatch(/\binit\b/);
      expect(indexResource.text).toMatch(/\bmigrate\b/);
      expect(indexResource.text).toMatch(/\bdisable\b/);
    });

    it('should describe the vault as the system of record', () => {
      expect(indexResource.text).toMatch(/system of record/i);
    });

    it('lists every registered prompt', () => {
      for (const p of MEMORY_PROMPTS) {
        expect(indexResource.text).toContain(p.name);
      }
    });
  });
});
