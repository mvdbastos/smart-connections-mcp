import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

export type EditMode = 'overwrite' | 'append' | 'append-section' | 'replace' | 'insert-after-heading';

export interface EditOptions {
  content?: string;
  mode: EditMode;
  heading?: string;
  find?: string;
  regex?: boolean;
  count?: number;
  dryRun?: boolean;
}

export interface EditResult {
  path: string;
  mode: string;
  changed: boolean;
  written: boolean;
  diff?: string;
  previousHash: string;
  newHash: string;
}

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

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function unifiedDiff(notePath: string, previous: string, next: string): string {
  if (previous === next) {
    return '';
  }

  const previousLines = previous.split('\n');
  const nextLines = next.split('\n');
  const lines = [`--- a/${notePath}`, `+++ b/${notePath}`];

  for (const line of previousLines) {
    lines.push(`-${line}`);
  }

  for (const line of nextLines) {
    lines.push(`+${line}`);
  }

  return `${lines.join('\n')}\n`;
}

function replaceLiteral(current: string, find: string, replacement: string, count?: number): string {
  if (find.length === 0) {
    throw new Error('replace find must not be empty');
  }

  let replacements = 0;
  const maxReplacements = count ?? Number.POSITIVE_INFINITY;
  let next = '';
  let offset = 0;

  while (replacements < maxReplacements) {
    const index = current.indexOf(find, offset);
    if (index === -1) {
      break;
    }

    next += current.slice(offset, index) + replacement;
    offset = index + find.length;
    replacements += 1;
  }

  if (replacements === 0) {
    throw new Error(`replace target not found: ${find}`);
  }

  return next + current.slice(offset);
}

function replaceRegex(current: string, find: string, replacement: string, count?: number): string {
  let pattern: RegExp;

  try {
    pattern = new RegExp(find, 'g');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid replace regex: ${message}`);
  }

  let replacements = 0;
  const maxReplacements = count ?? Number.POSITIVE_INFINITY;
  const next = current.replace(pattern, (match) => {
    if (replacements >= maxReplacements) {
      return match;
    }

    replacements += 1;
    return replacement;
  });

  if (replacements === 0) {
    throw new Error(`replace target not found: ${find}`);
  }

  return next;
}

function normalizeHeading(heading: string): string {
  return heading.replace(/^#+\s*/, '').trim().toLowerCase();
}

function insertAfterHeading(current: string, heading: string | undefined, content: string): string {
  if (!heading) {
    throw new Error('insert-after-heading requires heading');
  }

  const target = normalizeHeading(heading);
  const lines = current.split('\n');
  const headingIndex = lines.findIndex((line) => /^#{1,6}\s+/.test(line) && normalizeHeading(line) === target);

  if (headingIndex === -1) {
    throw new Error(`heading not found: ${heading}`);
  }

  lines.splice(headingIndex + 1, 0, content);
  return lines.join('\n');
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
  options: EditOptions
): EditResult;
export function editNote(
  vault: string,
  notePath: string,
  content: string,
  mode: EditMode,
  heading?: string
): EditResult;
export function editNote(
  vault: string,
  notePath: string,
  contentOrOptions: string | EditOptions,
  mode?: EditMode,
  heading?: string
): EditResult {
  const options: EditOptions = typeof contentOrOptions === 'string'
    ? { content: contentOrOptions, mode: mode ?? 'append', heading }
    : contentOrOptions;
  const file = safe(vault, notePath);

  if (!fs.existsSync(file)) {
    throw new Error(`Note not found: "${notePath}". Use action=create to create it.`);
  }

  const current = fs.readFileSync(file, 'utf-8');
  const content = options.content ?? '';
  let next: string;

  if (options.mode === 'overwrite') {
    next = content;
  } else if (options.mode === 'append') {
    next = current.length > 0 ? `${current}\n${content}` : content;
  } else if (options.mode === 'append-section') {
    const sectionHeading = options.heading ?? 'Note';
    const prefix = current.length > 0 ? `${current}\n` : '';
    next = `${prefix}## ${sectionHeading}\n${content}`;
  } else if (options.mode === 'replace') {
    if (options.find === undefined) {
      throw new Error('replace requires find');
    }

    next = options.regex
      ? replaceRegex(current, options.find, content, options.count)
      : replaceLiteral(current, options.find, content, options.count);
  } else {
    next = insertAfterHeading(current, options.heading, content);
  }

  const changed = current !== next;
  const result: EditResult = {
    path: notePath,
    mode: options.mode,
    changed,
    written: false,
    previousHash: sha256(current),
    newHash: sha256(next),
  };

  if (options.dryRun) {
    result.diff = unifiedDiff(notePath, current, next);
    return result;
  }

  fs.writeFileSync(file, next, 'utf-8');

  result.written = true;
  if (changed) {
    result.diff = unifiedDiff(notePath, current, next);
  }

  return result;
}

export function deleteNote(vault: string, notePath: string): void {
  const file = safe(vault, notePath);

  if (!fs.existsSync(file)) {
    throw new Error(`Note not found: "${notePath}". Nothing to delete.`);
  }

  fs.rmSync(file);
}
