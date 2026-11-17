import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SKILL_DIR, PLUGIN_ROOT, REPO_ROOT, readJson } from '../helpers.mjs';
import { COMMANDS } from '../../skills/project-health/scripts/commands.mjs';

const text = () => fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');

test('SKILL.md frontmatter has the name and a short description', () => {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text())?.[1];
  assert.ok(fm, 'frontmatter missing');
  assert.match(fm, /^name: project-health$/m);
  const description = /^description: (.+)$/m.exec(fm)?.[1] ?? '';
  assert.ok(description.length > 50 && description.length <= 1024, `description length ${description.length}`);
});

test('every PH command used in SKILL.md exists', () => {
  const used = [...text().matchAll(/`PH ([a-z-]+)/g)].map((m) => m[1]);
  assert.ok(used.length >= 8, 'expected the main commands to be documented');
  for (const c of used) assert.ok(c in COMMANDS, `unknown command in SKILL.md: ${c}`);
});

test('SKILL.md documents the three flows, the fallback and the no-fix rule', () => {
  const t = text();
  for (const h of ['## analyse', '## report', '## backlog']) assert.ok(t.includes(h), h);
  assert.match(t, /CLAUDE_SKILL_DIR/);
  assert.match(t, /--mode sequential/);
  assert.match(t, /spawn_agent/);
  assert.match(t, /Recommendations and effort levels appear only as written by the synthesis step/);
  assert.match(t, /never turn effort levels into hours, days or money/);
  assert.match(t, /--stage synthesis --save/);
  assert.match(t, /`--stage edit`/);
});

test('the skill folder is where the Codex manifest says skills live', () => {
  const codex = readJson(path.join(PLUGIN_ROOT, '.codex-plugin', 'plugin.json'));
  assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, codex.skills, 'project-health', 'SKILL.md')));
});

test('the README explains installation for both hosts', () => {
  const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
  assert.match(readme, /claude plugin marketplace add/);
  assert.match(readme, /codex plugin marketplace add/);
  assert.match(readme, /Node\.js 22/);
});

test('SKILL.md explains that validation failures are retryable, not fatal', () => {
  const setup = text().split('\n').filter((l) => l.startsWith('- **PH**'));
  assert.equal(setup.length, 1);
  assert.match(setup[0], /`validate-area`, `save-area`, `save-report` and `backlog-render` exit 1 with `"ok": false` for invalid subagent output/);
  assert.match(setup[0], /not a fatal error/);
});

test('Claude Code subagents use the bundled read-only agent and save their own results', () => {
  const t = text();
  assert.match(t, /`project-health:area-analyst`/);
  assert.match(t, /--area <area> --save/);
  const agent = fs.readFileSync(path.join(PLUGIN_ROOT, 'agents', 'area-analyst.md'), 'utf8').replace(/\r\n/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(agent)?.[1] ?? '';
  assert.match(fm, /^name: area-analyst$/m);
  const tools = /^tools: (.+)$/m.exec(fm)?.[1].split(',').map((s) => s.trim());
  assert.deepEqual(tools, ['Read', 'Grep', 'Glob', 'Bash'], 'no Write, Edit or web tools');
});

test('ph.mjs checks the Node version before loading anything else', () => {
  const src = fs.readFileSync(path.join(SKILL_DIR, 'scripts', 'ph.mjs'), 'utf8');
  assert.doesNotMatch(src, /^import\s/m, 'static imports are hoisted above the version check');
  const check = src.indexOf('major < 22');
  assert.ok(check > 0);
  assert.ok(src.indexOf("await import('node:util')") > check);
  assert.ok(src.indexOf("await import('./commands.mjs')") > check);
});

test('the roadmap skill names only existing commands and refuses to render before every problem is planned', () => {
  const t = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'roadmap', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(t)?.[1] ?? '';
  assert.match(fm, /^name: roadmap$/m);
  const description = /^description: (.+)$/m.exec(fm)?.[1] ?? '';
  assert.ok(description.length > 50 && description.length <= 1024, `description length ${description.length}`);
  const used = [...t.matchAll(/`PH ([a-z-]+)/g)].map((m) => m[1]);
  for (const c of ['roadmap-board', 'roadmap-brief', 'roadmap-status', 'roadmap-save', 'roadmap-render', 'knowledge-save']) assert.ok(used.includes(c), `documents ${c}`);
  for (const c of used) assert.ok(c in COMMANDS, `unknown command in roadmap SKILL.md: ${c}`);
  assert.match(t, /<SKILL_DIR>\/\.\.\/project-health\/scripts\/ph\.mjs/);
  assert.match(t, /Do not try to produce the roadmap any other way/);
  assert.match(t, /Estimates are theirs to agree, not yours to decide/);
  assert.match(t, /Never move a problem to the backlog or discard it on your own/);
  assert.match(t, /## Step 1: prepare before you say anything/);
  assert.match(t, /## Step 2: declare the available people \(before any planning\)/);
  assert.match(t, /## The discussion does not end early/);
  assert.match(t, /## Step 3: every problem, in whatever order the discussion takes/);
  assert.match(t, /Save every decision the moment it is made/);
});
