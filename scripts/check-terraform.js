#!/usr/bin/env node
/**
 * Terraform consistency checks that run without the Terraform binary.
 *
 * `terraform validate` is the authority and runs in CI, but it needs a
 * provider download. These checks are instant, work offline, and catch the
 * mistakes that actually happen when editing modules by hand:
 *
 *   1. unbalanced braces;
 *   2. variables used but never declared, or declared but never used;
 *   3. module calls that pass unknown arguments or omit required ones;
 *   4. references to module outputs that do not exist;
 *   5. missing module source directories;
 *   6. provider version constraints that are not pinned.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'infrastructure');
const problems = [];

/**
 * Removes comments while leaving string and heredoc content intact.
 *
 * A naive regex cannot do this: Terraform is full of strings that contain
 * comment-like sequences. `path_pattern { values = ["/agent/*"] }` opens a
 * block comment as far as a regex is concerned, and silently ate 14 000
 * characters of a module before this was written as a scanner.
 *
 * String bodies are kept because `"${var.thing}"` is a genuine reference.
 *
 * @param {string} source
 * @returns {string}
 */
function strip(source) {
  let out = '';
  let index = 0;
  const length = source.length;

  while (index < length) {
    const char = source[index];
    const next = source[index + 1];

    // Heredoc: <<TAG or <<-TAG, ending at a line containing only TAG.
    if (char === '<' && next === '<') {
      const heredoc = /^<<-?([A-Za-z_][A-Za-z0-9_]*)\r?\n/.exec(source.slice(index));
      if (heredoc) {
        const tag = heredoc[1];
        const bodyStart = index + heredoc[0].length;
        const terminator = new RegExp(`^[ \\t]*${tag}[ \\t]*$`, 'm');
        const match = terminator.exec(source.slice(bodyStart));
        const bodyEnd = match ? bodyStart + match.index + match[0].length : length;
        out += source.slice(index, bodyEnd);
        index = bodyEnd;
        continue;
      }
    }

    // Quoted string: copy verbatim, honouring backslash escapes.
    if (char === '"') {
      out += char;
      index += 1;
      while (index < length) {
        if (source[index] === '\\') {
          out += source.slice(index, index + 2);
          index += 2;
          continue;
        }
        out += source[index];
        if (source[index] === '"') {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    // Block comment.
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end === -1 ? length : end + 2;
      out += ' ';
      continue;
    }

    // Line comment, either style.
    if ((char === '/' && next === '/') || char === '#') {
      const end = source.indexOf('\n', index);
      index = end === -1 ? length : end;
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}

async function terraformDirectories(dir) {
  const found = [];
  const entries = await readdir(dir, { withFileTypes: true });
  let hasTf = false;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.terraform') continue;
      found.push(...(await terraformDirectories(full)));
    } else if (entry.name.endsWith('.tf')) {
      hasTf = true;
    }
  }
  if (hasTf) found.push(dir);
  return found;
}

async function readDirectory(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const sources = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.tf')) {
      sources.push(await readFile(path.join(dir, entry.name), 'utf8'));
    }
  }
  return strip(sources.join('\n'));
}

/** Extracts the body of each `block "label" { ... }` using brace matching. */
function blocks(source, keyword) {
  const results = [];
  const header = new RegExp(`${keyword}\\s+"([^"]+)"\\s*\\{`, 'g');
  let match;
  while ((match = header.exec(source)) !== null) {
    let depth = 1;
    let index = header.lastIndex;
    while (index < source.length && depth > 0) {
      if (source[index] === '{') depth += 1;
      else if (source[index] === '}') depth -= 1;
      index += 1;
    }
    results.push({ label: match[1], body: source.slice(header.lastIndex, index - 1) });
  }
  return results;
}

/** Top-level `name =` assignments only, ignoring keys nested inside maps. */
function topLevelArguments(body) {
  const names = new Set();
  let depth = 0;
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (depth === 0) {
      const match = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=/.exec(line);
      if (match) names.add(match[1]);
    }
    for (const character of line) {
      if (character === '{' || character === '[') depth += 1;
      else if (character === '}' || character === ']') depth -= 1;
    }
    if (depth < 0) depth = 0;
  }
  return names;
}

const META_ARGUMENTS = new Set(['source', 'count', 'for_each', 'providers', 'depends_on', 'version', 'lifecycle']);

const directories = await terraformDirectories(root);
const cache = new Map();
const load = async (dir) => {
  if (!cache.has(dir)) cache.set(dir, await readDirectory(dir));
  return cache.get(dir);
};

for (const dir of directories) {
  const source = await load(dir);
  const relative = path.relative(root, dir) || '.';

  // 1. Balanced braces.
  const withoutStrings = source.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const open = (withoutStrings.match(/\{/g) ?? []).length;
  const close = (withoutStrings.match(/\}/g) ?? []).length;
  if (open !== close) problems.push(`${relative}: unbalanced braces (${open} open, ${close} close)`);

  // 2. Variable declaration hygiene.
  const declared = new Set(blocks(source, 'variable').map((b) => b.label));
  const used = new Set([...source.matchAll(/\bvar\.([a-zA-Z0-9_]+)/g)].map((m) => m[1]));
  for (const name of used) {
    if (!declared.has(name)) problems.push(`${relative}: var.${name} is used but not declared`);
  }
  for (const name of declared) {
    if (!used.has(name)) problems.push(`${relative}: variable "${name}" is declared but never used`);
  }

  // 3 and 4. Module wiring.
  for (const { label, body } of blocks(source, 'module')) {
    const sourceMatch = /source\s*=\s*"([^"]+)"/.exec(body);
    if (!sourceMatch) {
      problems.push(`${relative}: module "${label}" has no source`);
      continue;
    }
    if (!sourceMatch[1].startsWith('.')) continue;

    const moduleDir = path.resolve(dir, sourceMatch[1]);
    if (!directories.includes(moduleDir)) {
      problems.push(`${relative}: module "${label}" points at ${sourceMatch[1]}, which has no Terraform files`);
      continue;
    }

    const moduleSource = await load(moduleDir);
    const moduleVariables = blocks(moduleSource, 'variable');
    const names = new Set(moduleVariables.map((v) => v.label));
    const required = new Set(
      moduleVariables.filter((v) => !/^\s*default\s*=/m.test(v.body)).map((v) => v.label),
    );

    const passed = topLevelArguments(body);
    for (const name of passed) {
      if (!META_ARGUMENTS.has(name) && !names.has(name)) {
        problems.push(`${relative}: module "${label}" passes "${name}", which the module does not declare`);
      }
    }
    for (const name of required) {
      if (!passed.has(name)) {
        problems.push(`${relative}: module "${label}" omits required variable "${name}"`);
      }
    }
  }

  // 4. Output references resolve.
  const moduleSources = new Map();
  for (const { label, body } of blocks(source, 'module')) {
    const sourceMatch = /source\s*=\s*"([^"]+)"/.exec(body);
    if (sourceMatch?.[1].startsWith('.')) moduleSources.set(label, path.resolve(dir, sourceMatch[1]));
  }
  for (const match of source.matchAll(/module\.([a-zA-Z0-9_]+)(?:\[[^\]]*\])?\.([a-zA-Z0-9_]+)/g)) {
    const [, moduleName, outputName] = match;
    const moduleDir = moduleSources.get(moduleName);
    if (!moduleDir) {
      problems.push(`${relative}: reference to module.${moduleName}, which is not declared here`);
      continue;
    }
    const outputs = new Set(blocks(await load(moduleDir), 'output').map((o) => o.label));
    if (!outputs.has(outputName)) {
      problems.push(`${relative}: module.${moduleName}.${outputName} is not an output of ${path.relative(root, moduleDir)}`);
    }
  }

  // 5. Provider versions are pinned.
  for (const match of source.matchAll(/source\s*=\s*"(hashicorp\/[a-z]+)"\s*\n\s*version\s*=\s*"([^"]+)"/g)) {
    if (!/[~>=]/.test(match[2])) {
      problems.push(`${relative}: provider ${match[1]} has an unconstrained version "${match[2]}"`);
    }
  }
}

process.stdout.write(`note: checked ${directories.length} Terraform directories\n`);
if (problems.length > 0) {
  process.stderr.write(`\n${problems.length} Terraform problem(s) found:\n`);
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
  process.exit(1);
}
process.stdout.write('All Terraform checks passed.\n');
