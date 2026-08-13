import { describe, it, expect } from 'vitest';
import { buildIndexRefusalHint, buildSearchIndexWarning } from './index-health-hints.js';
function refusedHealth(overrides = {}) {
    return {
        indexed: 66,
        missing: 66,
        dropped: 0,
        refused: true,
        missingSample: ['Memory/memory/Foo.md', 'Memory/hermes-agent/Bar.md'],
        ...overrides,
    };
}
describe('index refusal hint', () => {
    it('names the vault path and both counts', () => {
        const hint = buildIndexRefusalHint('/vault', refusedHealth());
        expect(hint).toContain('/vault');
        expect(hint).toContain('66');
    });
    it('includes the sampled paths so the user can eyeball them', () => {
        const hint = buildIndexRefusalHint('/vault', refusedHealth());
        expect(hint).toContain('Memory/memory/Foo.md');
        expect(hint).toContain('Memory/hermes-agent/Bar.md');
    });
    it('forbids destructive recovery', () => {
        const hint = buildIndexRefusalHint('/vault', refusedHealth());
        expect(hint).toMatch(/Do NOT delete \.smart-env/);
        expect(hint).not.toMatch(/rm -rf/);
        expect(hint).not.toMatch(/reset --hard/);
    });
    it('presents both options and defers the choice to the user', () => {
        const hint = buildIndexRefusalHint('/vault', refusedHealth());
        expect(hint).toContain('Ask the user');
        expect(hint).toContain('Do not choose for them');
        expect(hint).toContain('Investigate the vault directly');
        expect(hint).toContain('mvdbastos/smart-connections-mcp');
    });
    it('calls the software the vault server', () => {
        const hint = buildIndexRefusalHint('/vault', refusedHealth());
        expect(hint).toContain('the vault server');
        expect(hint).not.toContain('Smart Connections');
    });
    it('forbids including note paths in a public issue report', () => {
        const hint = buildIndexRefusalHint('/vault', refusedHealth());
        expect(hint).toMatch(/Report counts only/i);
        expect(hint).toMatch(/this repository is public/i);
    });
});
describe('search index warning', () => {
    it('is undefined when the index reconciled', () => {
        expect(buildSearchIndexWarning(refusedHealth({ refused: false }))).toBeUndefined();
    });
    it('reports counts when refused', () => {
        const warning = buildSearchIndexWarning(refusedHealth());
        expect(warning).toMatchObject({
            state: 'reconcile_refused',
            indexed: 66,
            missing: 66,
        });
    });
    it('never carries note paths', () => {
        const health = refusedHealth();
        const serialized = JSON.stringify(buildSearchIndexWarning(health));
        for (const notePath of health.missingSample) {
            expect(serialized).not.toContain(notePath);
        }
    });
});
//# sourceMappingURL=index-health-hints.test.js.map