import * as fs from 'fs';
import * as path from 'path';

export type EditMode = 'overwrite' | 'append' | 'append-section';

function safe(vault: string, notePath: string): string {
  const vaultRoot = path.resolve(vault);
  const resolved = path.resolve(vaultRoot, notePath);
  const relative = path.relative(vaultRoot, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('path escapes vault');
  }

  return resolved;
}

function frontmatterYaml(frontmatter?: Record<string, unknown>): string {
  if (!frontmatter || Object.keys(frontmatter).length === 0) {
    return '';
  }

  const yaml = Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n');

  return `---\n${yaml}\n---\n`;
}

export function createNote(
  vault: string,
  notePath: string,
  body: string,
  frontmatter?: Record<string, unknown>
): void {
  const file = safe(vault, notePath);

  if (fs.existsSync(file)) {
    throw new Error(`Note already exists: ${notePath}`);
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${frontmatterYaml(frontmatter)}${body}`, 'utf-8');
}

export function editNote(
  vault: string,
  notePath: string,
  content: string,
  mode: EditMode,
  heading?: string
): void {
  const file = safe(vault, notePath);
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  let next: string;

  if (mode === 'overwrite') {
    next = content;
  } else if (mode === 'append') {
    next = current.length > 0 ? `${current}\n${content}` : content;
  } else {
    const sectionHeading = heading ?? 'Note';
    const prefix = current.length > 0 ? `${current}\n` : '';
    next = `${prefix}## ${sectionHeading}\n${content}`;
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next, 'utf-8');
}

export function deleteNote(vault: string, notePath: string): void {
  fs.rmSync(safe(vault, notePath));
}
