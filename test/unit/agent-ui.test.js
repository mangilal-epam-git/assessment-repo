/**
 * The console is emitted from a template literal, which means an escape
 * sequence intended for the browser can be consumed by the server-side
 * template instead. That produced a page whose entire script failed to
 * parse while every other test still passed, so the emitted artefact is
 * checked here directly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { renderUi } from '../../src/agent/ui.js';

const run = promisify(execFile);

const page = renderUi({
  modelBackend: 'deterministic',
  model: 'deterministic-planner-1',
  tenantId: 'fleet-nordic-logistics',
});

function script(html) {
  const match = /<script>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match, 'the page should contain exactly one inline script');
  return match[1];
}

test('the emitted browser script is valid JavaScript', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vh-ui-'));
  const file = path.join(dir, 'emitted.js');
  await writeFile(file, script(page), 'utf8');
  // node --check is the authority on whether a browser would parse it.
  await run(process.execPath, ['--check', file]);
});

test('escape sequences survive the server-side template intact', () => {
  // The exact defect: "\n" written in ui.js was consumed by the outer
  // template literal and emitted as an actual newline, leaving an
  // unterminated single-quoted string in the browser. The emitted script
  // must contain the two characters backslash and n, not a line break.
  const emitted = script(page);
  assert.ok(
    emitted.includes(String.raw`entries.\n\n`),
    'the newline escape in the verify dialog must reach the browser as \\n',
  );

  // Generally: no line that opens a plain single-quoted string may end
  // without closing it. Checked by locating quote-newline-quote patterns,
  // which is what an eaten escape looks like.
  assert.ok(
    !/'[^'\n]*\n[^'\n]*'\s*\+/.test(emitted),
    'a string literal appears to be split across a raw newline',
  );
});

test('the page is self-contained: nothing is fetched from the network', () => {
  assert.ok(!/<script[^>]+\bsrc=/i.test(page), 'no external script');
  assert.ok(!/<link[^>]+stylesheet/i.test(page), 'no external stylesheet');
  assert.ok(!/@import/i.test(page), 'no CSS import');
  assert.ok(!/\bfont-face\b/i.test(page), 'no downloaded webfont');
  const remote = page.match(/https?:\/\/[^\s"')]+/g) ?? [];
  assert.deepEqual(remote, [], `page must reference no remote URLs, found: ${remote.join(', ')}`);
});

test('interpolated values are HTML-escaped', () => {
  const hostile = renderUi({
    modelBackend: '"><script>alert(1)</script>',
    model: "' onload='alert(2)",
    tenantId: '<img src=x onerror=alert(3)>',
  });
  assert.ok(!hostile.includes('<script>alert(1)'), 'the backend name must be escaped');
  assert.ok(!hostile.includes('<img src=x'), 'the tenant id must be escaped');
  assert.ok(hostile.includes('&lt;img src=x'), 'escaping should be visible in the output');
  // Still exactly one script block: the injection did not open another.
  assert.equal((hostile.match(/<script>/g) ?? []).length, 1);
});

test('[hidden] is enforced against component classes that set a display', () => {
  // .busy sets display:inline-flex, which outranks the user-agent [hidden]
  // rule, so the "thinking" indicator showed permanently without this.
  assert.match(page, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

test('reduced motion is respected', () => {
  assert.match(page, /@media \(prefers-reduced-motion: reduce\)/);
});

test('the page states the supervision claims it is there to demonstrate', () => {
  assert.match(page, /Actions taken without human approval/);
  assert.match(page, /no such tool exists in any environment/);
  assert.match(page, /The assistant proposes/);
  assert.match(page, /You decide/);
});
