#!/usr/bin/env node
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Embedder } from '../dist/embedder.js';
import { appendSourceVector } from '../dist/ajson-writer.js';

const MODEL_KEY = 'TaylorAI/bge-micro-v2';

const vault = process.argv[2];
if (!vault) {
  console.error('Usage: node scripts/bootstrap-embeddings.mjs <vault-path>');
  process.exit(1);
}

function walk(dir, base, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === '.smart-env') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, base, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(path.relative(base, full));
    }
  }
  return out;
}

const notePaths = walk(vault, vault, []);
console.log(`Found ${notePaths.length} notes to embed.`);

const embedder = new Embedder();
const ok = await embedder.tryInit();
if (!ok) {
  console.error('Embedder failed to initialize.');
  process.exit(1);
}

async function embedWithBackoff(content) {
  const attempts = [1500, 800, 400, 200];
  let lastError;
  for (const maxChars of attempts) {
    try {
      return await embedder.embed(content.slice(0, maxChars));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

let count = 0;
let skipped = 0;
for (const notePath of notePaths) {
  const fullPath = path.join(vault, notePath);
  const content = fs.readFileSync(fullPath, 'utf-8');
  const hash = createHash('sha256').update(content).digest('hex');
  const tokens = content.trim().length === 0 ? 0 : content.trim().split(/\s+/).length;

  try {
    const vec = await embedWithBackoff(content);
    appendSourceVector(vault, notePath, vec, MODEL_KEY, hash, tokens);
    count += 1;
    console.log(`[${count + skipped}/${notePaths.length}] embedded ${notePath}`);
  } catch (error) {
    skipped += 1;
    console.error(`[skip] ${notePath}: ${error.message ?? error}`);
  }
}

console.log(`Done. Embedded ${count} notes, skipped ${skipped}.`);
