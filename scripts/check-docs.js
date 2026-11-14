#!/usr/bin/env node
/**
 * Documentation integrity checks.
 *
 * Documentation that links to a file that no longer exists is worse than no
 * documentation: it costs the reader time and quietly erodes trust in the
 * rest. These checks run offline in CI.
 *
 *   1. every relative Markdown link resolves to a real file;
 *   2. every in-page anchor link matches a heading in the target document;
 *   3. every Mermaid block is balanced and non-empty;
 *   4. every document listed in the docs index exists, and vice versa.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

async function markdownFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'coverage', '.terraform'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await markdownFiles(full)));
    else if (entry.name.endsWith('.md')) found.push(full);
  }
  return found;
}

/** GitHub's heading-to-anchor transformation. */
function toAnchor(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\w\s-]/g, '')
    // Each whitespace character becomes its own hyphen; GitHub does not
    // collapse runs, so "A — B" yields "a--b" after the dash is stripped.
    .replace(/\s/g, '-');
}

const files = await markdownFiles(root);
const anchors = new Map();
const bodies = new Map();

for (const file of files) {
  const text = await readFile(file, 'utf8');
  bodies.set(file, text);
  const set = new Set();
  for (const match of text.matchAll(/^#{1,6}\s+(.+)$/gm)) set.add(toAnchor(match[1]));
  anchors.set(file, set);
}

const relative = (file) => path.relative(root, file).split(path.sep).join('/');

for (const file of files) {
  const text = bodies.get(file);
  const dir = path.dirname(file);

  // 1 and 2. Link targets and anchors.
  for (const match of text.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    const target = match[2];
    if (/^(https?:|mailto:|#)/.test(target)) {
      if (target.startsWith('#')) {
        const anchor = target.slice(1).toLowerCase();
        if (!anchors.get(file).has(anchor)) {
          problems.push(`${relative(file)}: in-page anchor "${target}" matches no heading`);
        }
      }
      continue;
    }
    const [linkPath, anchor] = target.split('#');
    const resolved = path.resolve(dir, decodeURIComponent(linkPath));
    try {
      await stat(resolved);
    } catch {
      problems.push(`${relative(file)}: link target "${target}" does not exist`);
      continue;
    }
    if (anchor && resolved.endsWith('.md')) {
      const targetAnchors = anchors.get(resolved);
      if (targetAnchors && !targetAnchors.has(anchor.toLowerCase())) {
        problems.push(`${relative(file)}: anchor "#${anchor}" not found in ${relative(resolved)}`);
      }
    }
  }

  // 3. Mermaid blocks.
  const fences = [...text.matchAll(/^```mermaid\s*$/gm)];
  const closings = [...text.matchAll(/^```\s*$/gm)];
  if (fences.length > closings.length) {
    problems.push(`${relative(file)}: unclosed mermaid code fence`);
  }
  for (const block of text.matchAll(/```mermaid\n([\s\S]*?)```/g)) {
    if (block[1].trim().length === 0) problems.push(`${relative(file)}: empty mermaid block`);
  }
}

// 4. The docs index lists what exists, and only what exists.
const indexPath = path.join(root, 'docs', 'README.md');
const indexText = bodies.get(indexPath);
if (!indexText) {
  problems.push('docs/README.md is missing');
} else {
  const linked = new Set();
  for (const match of indexText.matchAll(/\]\((architecture\/[^)#]+|adr\/[^)#]+|coding-task\/[^)#]+|runbooks\/[^)#]+)\)/g)) {
    linked.add(path.resolve(root, 'docs', match[1]));
  }
  for (const file of files) {
    const rel = relative(file);
    if (!rel.startsWith('docs/')) continue;
    if (rel === 'docs/README.md' || rel === 'docs/adr/README.md') continue;
    if (!linked.has(file)) problems.push(`${rel} exists but is not linked from the docs index`);
  }
}

const mermaidCount = files.reduce(
  (total, file) => total + [...bodies.get(file).matchAll(/```mermaid/g)].length,
  0,
);
process.stdout.write(
  `note: checked ${files.length} Markdown files containing ${mermaidCount} Mermaid diagrams\n`,
);

if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} documentation problem(s) found:\n`);
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
  process.exit(1);
}
process.stdout.write('All documentation checks passed.\n');
