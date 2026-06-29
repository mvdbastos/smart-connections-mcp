import * as fs from 'fs';
import * as path from 'path';
export function appendSourceVector(vault, notePath, vec, modelKey, hash, tokens) {
    const multiDir = path.join(vault, '.smart-env', 'multi');
    fs.mkdirSync(multiDir, { recursive: true });
    const file = path.join(multiDir, `${notePath.replace(/[\\/]/g, '_')}.ajson`);
    const noteFile = path.join(vault, notePath);
    const stat = fs.existsSync(noteFile) ? fs.statSync(noteFile) : null;
    const now = Date.now();
    const source = {
        path: notePath,
        embeddings: {
            [modelKey]: {
                vec,
                last_embed: { hash, tokens },
            },
        },
        last_read: {
            hash,
            at: now,
        },
        class_name: 'SmartSource',
        last_import: {
            mtime: stat?.mtimeMs ?? now,
            size: stat?.size ?? 0,
            at: now,
            hash,
        },
        blocks: {},
    };
    const line = `"smart_sources:${notePath}": ${JSON.stringify(source)},\n`;
    fs.appendFileSync(file, line, 'utf-8');
    return source;
}
//# sourceMappingURL=ajson-writer.js.map