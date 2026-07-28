import { describe, it, expect } from 'vitest';
import { MEMORY_PROMPTS, MEMORY_PROMPT_BY_NAME } from './prompts';
describe('prompts', () => {
    it('should have 5 prompts', () => {
        expect(MEMORY_PROMPTS).toHaveLength(5);
    });
    it('should have unique names', () => {
        const names = MEMORY_PROMPTS.map((p) => p.name);
        expect(new Set(names).size).toBe(names.length);
    });
    it('should have MEMORY_PROMPT_BY_NAME map all prompts', () => {
        expect(MEMORY_PROMPT_BY_NAME.size).toBe(MEMORY_PROMPTS.length);
        MEMORY_PROMPTS.forEach((p) => {
            expect(MEMORY_PROMPT_BY_NAME.get(p.name)).toBe(p);
        });
    });
    it('should have all required fields', () => {
        MEMORY_PROMPTS.forEach((p) => {
            expect(p).toHaveProperty('name');
            expect(p).toHaveProperty('description');
            expect(p).toHaveProperty('arguments');
            expect(p).toHaveProperty('build');
            expect(typeof p.name).toBe('string');
            expect(typeof p.description).toBe('string');
            expect(Array.isArray(p.arguments)).toBe(true);
            expect(typeof p.build).toBe('function');
        });
    });
    it('should have non-empty descriptions', () => {
        MEMORY_PROMPTS.forEach((p) => {
            expect(p.description.length).toBeGreaterThan(0);
        });
    });
    it('all prompts should mention note_workflow in their content', async () => {
        const mockSearch = async () => [];
        const context = { search: mockSearch };
        const testArgs = {
            capture_memory: { topic: 'test' },
            project_research: { topic: 'test' },
            cleanup_stale: { query: 'test' },
            daily_note: {},
            review_before_write: { note_path: 'test.md' },
        };
        for (const prompt of MEMORY_PROMPTS) {
            const args = testArgs[prompt.name] || {};
            const text = await prompt.build(args, context);
            expect(text).toMatch(/note_workflow/i);
        }
    });
    it('should not reference deprecated git tools', async () => {
        const deprecatedTools = ['git_commit_notes', 'git_push_notes', 'git_sync_notes'];
        const mockSearch = async () => [];
        const context = { search: mockSearch };
        const testArgs = {
            capture_memory: { topic: 'test' },
            project_research: { topic: 'test' },
            cleanup_stale: { query: 'test' },
            daily_note: {},
            review_before_write: { note_path: 'test.md' },
        };
        for (const prompt of MEMORY_PROMPTS) {
            const args = testArgs[prompt.name] || {};
            const text = await prompt.build(args, context);
            deprecatedTools.forEach((tool) => {
                expect(text).not.toMatch(new RegExp(`\\b${tool}\\b`));
            });
        }
    });
    describe('capture_memory prompt', () => {
        const prompt = MEMORY_PROMPT_BY_NAME.get('capture_memory');
        it('should require topic argument', () => {
            expect(prompt.arguments).toContainEqual(expect.objectContaining({ name: 'topic', required: true }));
        });
        it('should have optional tags argument', () => {
            expect(prompt.arguments).toContainEqual(expect.objectContaining({ name: 'tags', required: false }));
        });
        it('should throw on missing topic', async () => {
            const context = { search: async () => [] };
            await expect(prompt.build({}, context)).rejects.toThrow();
        });
        it('should build successfully with topic', async () => {
            const context = { search: async () => [] };
            const text = await prompt.build({ topic: 'AI' }, context);
            expect(text).toBeTruthy();
            expect(text).toMatch(/AI/);
        });
        it('should pre-fetch hits when search returns results', async () => {
            const hits = [
                { path: 'AI/LLMs.md', score: 0.9 },
                { path: 'AI/Transformers.md', score: 0.8 },
            ];
            const context = { search: async () => hits };
            const text = await prompt.build({ topic: 'AI' }, context);
            expect(text).toMatch(/LLMs.md.*0.9/);
            expect(text).toMatch(/Transformers.md.*0.8/);
        });
        it('should fail soft when search throws', async () => {
            const context = {
                search: async () => {
                    throw new Error('Search failed');
                },
            };
            const text = await prompt.build({ topic: 'AI' }, context);
            expect(text).toBeTruthy();
            expect(text).not.toMatch(/Error/);
        });
    });
    describe('project_research prompt', () => {
        const prompt = MEMORY_PROMPT_BY_NAME.get('project_research');
        it('should require topic argument', () => {
            expect(prompt.arguments).toContainEqual(expect.objectContaining({ name: 'topic', required: true }));
        });
        it('should throw on missing topic', async () => {
            const context = { search: async () => [] };
            await expect(prompt.build({}, context)).rejects.toThrow();
        });
        it('should build successfully with topic', async () => {
            const context = { search: async () => [] };
            const text = await prompt.build({ topic: 'RAG' }, context);
            expect(text).toBeTruthy();
            expect(text).toMatch(/RAG/);
        });
        it('should pre-fetch seed notes', async () => {
            const hits = [{ path: 'Research/RAG.md', score: 0.85 }];
            const context = { search: async () => hits };
            const text = await prompt.build({ topic: 'RAG' }, context);
            expect(text).toMatch(/RAG.md.*0.85/);
            expect(text).toMatch(/get_note_content|get_similar_notes/);
        });
    });
    describe('cleanup_stale prompt', () => {
        const prompt = MEMORY_PROMPT_BY_NAME.get('cleanup_stale');
        it('should require query argument', () => {
            expect(prompt.arguments).toContainEqual(expect.objectContaining({ name: 'query', required: true }));
        });
        it('should throw on missing query', async () => {
            const context = { search: async () => [] };
            await expect(prompt.build({}, context)).rejects.toThrow();
        });
        it('should build successfully with query', async () => {
            const context = { search: async () => [] };
            const text = await prompt.build({ query: 'deprecated' }, context);
            expect(text).toBeTruthy();
            expect(text).toMatch(/deprecated/i);
        });
        it('should pre-fetch candidates for removal', async () => {
            const hits = [
                { path: 'Archive/Old.md', score: 0.7 },
                { path: 'Archive/Obsolete.md', score: 0.65 },
            ];
            const context = { search: async () => hits };
            const text = await prompt.build({ query: 'old' }, context);
            expect(text).toMatch(/Old.md.*0.7/);
            expect(text).toMatch(/Obsolete.md.*0.65/);
        });
    });
    describe('daily_note prompt', () => {
        const prompt = MEMORY_PROMPT_BY_NAME.get('daily_note');
        it('should have optional heading argument', () => {
            expect(prompt.arguments).toContainEqual(expect.objectContaining({ name: 'heading', required: false }));
        });
        it('should build successfully without arguments', async () => {
            const context = { search: async () => [] };
            const text = await prompt.build({}, context);
            expect(text).toBeTruthy();
            expect(text).toMatch(/append.*section|daily/i);
        });
        it('should include provided heading', async () => {
            const context = { search: async () => [] };
            const text = await prompt.build({ heading: 'Tuesday Standup' }, context);
            expect(text).toMatch(/Tuesday Standup/);
        });
        it('should not call search (pure instruction)', async () => {
            let searchCalled = false;
            const context = {
                search: async () => {
                    searchCalled = true;
                    return [];
                },
            };
            await prompt.build({}, context);
            expect(searchCalled).toBe(false);
        });
    });
    describe('review_before_write prompt', () => {
        const prompt = MEMORY_PROMPT_BY_NAME.get('review_before_write');
        it('should require note_path argument', () => {
            expect(prompt.arguments).toContainEqual(expect.objectContaining({ name: 'note_path', required: true }));
        });
        it('should throw on missing note_path', async () => {
            const context = { search: async () => [] };
            await expect(prompt.build({}, context)).rejects.toThrow();
        });
        it('should build successfully with note_path', async () => {
            const context = { search: async () => [] };
            const text = await prompt.build({ note_path: 'Notes/MyNote.md' }, context);
            expect(text).toBeTruthy();
            expect(text).toMatch(/Notes\/MyNote.md/);
        });
        it('should not call search (pure instruction)', async () => {
            let searchCalled = false;
            const context = {
                search: async () => {
                    searchCalled = true;
                    return [];
                },
            };
            await prompt.build({ note_path: 'Note.md' }, context);
            expect(searchCalled).toBe(false);
        });
    });
    describe('argument validation', () => {
        it('should validate argument types in build', async () => {
            const prompt = MEMORY_PROMPT_BY_NAME.get('capture_memory');
            const context = { search: async () => [] };
            // topic is required
            await expect(prompt.build({ topic: undefined }, context)).rejects.toThrow();
            // topic must be a string
            await expect(prompt.build({ topic: 123 }, context)).rejects.toThrow();
        });
    });
    describe('search integration', () => {
        it('should handle empty search results gracefully', async () => {
            const prompt = MEMORY_PROMPT_BY_NAME.get('project_research');
            const context = { search: async () => [] };
            const text = await prompt.build({ topic: 'NonExistent' }, context);
            expect(text).toBeTruthy();
            expect(text).not.toMatch(/undefined|null/);
        });
        it('should format search results with scores', async () => {
            const prompt = MEMORY_PROMPT_BY_NAME.get('cleanup_stale');
            const hits = [
                { path: 'Path/To/Note.md', score: 0.756 },
                { path: 'Another/Note.md', score: 0.423 },
            ];
            const context = { search: async () => hits };
            const text = await prompt.build({ query: 'test' }, context);
            expect(text).toMatch(/0\.75|0\.76/);
            expect(text).toMatch(/0\.42/);
        });
    });
});
//# sourceMappingURL=prompts.test.js.map