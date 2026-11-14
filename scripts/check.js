#!/usr/bin/env node
/**
 * Dependency-free static checks, so `npm run check` works on a clean machine
 * with no network access. CI runs this before the test suite.
 *
 *   1. every JavaScript file parses;
 *   2. no stray debugging statements or focused tests;
 *   3. no obvious hard-coded secrets;
 *   4. source files carry a top-of-file explanation;
 *   5. required project files exist;
 *   6. JSON and Terraform files are well-formed enough to read.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'coverage', '.terraform']);
const problems = [];
const notes = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

const allFiles = await walk(root);
const relative = (file) => path.relative(root, file).split(path.sep).join('/');
const jsFiles = allFiles.filter((f) => f.endsWith('.js'));
const sourceFiles = jsFiles.filter((f) => relative(f).startsWith('src/'));

// 1. Every JavaScript file parses.
for (const file of jsFiles) {
  try {
    await run(process.execPath, ['--check', file]);
  } catch (error) {
    problems.push(`${relative(file)}: does not parse - ${String(error.stderr ?? error).split('\n')[0]}`);
  }
}

// 2. No stray debugging statements or focused tests.
const BANNED = [
  { pattern: /\bconsole\.log\s*\(/, message: 'console.log (use the structured logger)' },
  { pattern: /\bdebugger\b/, message: 'debugger statement' },
  { pattern: /\.only\s*\(/, message: 'focused test (.only)' },
  { pattern: /\bTODO\b|\bFIXME\b/, message: 'unresolved TODO/FIXME' },
];
for (const file of jsFiles) {
  if (relative(file) === 'scripts/check.js') continue;
  const text = await readFile(file, 'utf8');
  text.split('\n').forEach((line, index) => {
    for (const { pattern, message } of BANNED) {
      if (pattern.test(line)) problems.push(`${relative(file)}:${index + 1}: ${message}`);
    }
  });
}

// 3. No obvious hard-coded secrets outside clearly-labelled local defaults.
const SECRET_PATTERNS = [
  { pattern: /AKIA[0-9A-Z]{16}/, message: 'AWS access key id' },
  { pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, message: 'private key' },
  { pattern: /xox[baprs]-[0-9A-Za-z-]{10,}/, message: 'Slack token' },
  { pattern: /ghp_[0-9A-Za-z]{30,}/, message: 'GitHub token' },
];
const textFiles = allFiles.filter((f) => /\.(js|json|md|ya?ml|tf|tfvars|sh|env)$/.test(f));
for (const file of textFiles) {
  if (relative(file) === 'scripts/check.js') continue;
  const text = await readFile(file, 'utf8');
  for (const { pattern, message } of SECRET_PATTERNS) {
    if (pattern.test(text)) problems.push(`${relative(file)}: possible ${message} committed`);
  }
}

// 4. Source files explain themselves at the top.
for (const file of sourceFiles) {
  const text = await readFile(file, 'utf8');
  if (!text.trimStart().startsWith('/**') && !text.trimStart().startsWith('//')) {
    problems.push(`${relative(file)}: missing a file-level comment explaining its purpose`);
  }
}

// 5. Required project files exist.
const REQUIRED = [
  'README.md', 'package.json', 'Dockerfile', 'Dockerfile.mock', 'Dockerfile.agent', 'docker-compose.yml',
  '.gitignore', '.editorconfig', 'LICENSE', 'CONTRIBUTING.md', 'SECURITY.md',
  'config/pricing-config.json', 'fixtures/telemetry1.json', 'fixtures/telemetry2.json',
  'docs/README.md', 'infrastructure/README.md',
];
for (const name of REQUIRED) {
  try {
    await stat(path.join(root, name));
  } catch {
    problems.push(`missing required file: ${name}`);
  }
}

// 6. JSON files are well-formed.
for (const file of allFiles.filter((f) => f.endsWith('.json'))) {
  try {
    JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    problems.push(`${relative(file)}: invalid JSON - ${error.message}`);
  }
}

// 7. Terraform files balance their braces (a cheap proxy when terraform is absent).
for (const file of allFiles.filter((f) => f.endsWith('.tf'))) {
  const text = (await readFile(file, 'utf8')).replace(/#.*$/gm, '').replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const open = (text.match(/\{/g) ?? []).length;
  const close = (text.match(/\}/g) ?? []).length;
  if (open !== close) problems.push(`${relative(file)}: unbalanced braces (${open} open, ${close} close)`);
}

notes.push(`checked ${jsFiles.length} JavaScript files, ${allFiles.filter((f) => f.endsWith('.tf')).length} Terraform files`);

for (const note of notes) process.stdout.write(`note: ${note}\n`);
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} problem(s) found:\n`);
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
  process.exit(1);
}
process.stdout.write('All static checks passed.\n');
