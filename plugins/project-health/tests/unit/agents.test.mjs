import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SKILL_DIR } from '../helpers.mjs';
import { AREAS } from '../../skills/project-health/scripts/lib/areas.mjs';

const read = (rel) => fs.readFileSync(path.join(SKILL_DIR, rel), 'utf8');
const RULE_ROW = /^\|\s*`([a-z0-9-]+\.[a-z0-9-]+)`\s*\|\s*(critical|high|medium|low)\s*\|/gm;
const ruleKeys = (area) => [...read(`agents/${area}.md`).matchAll(RULE_ROW)].map((m) => m[1]);

test('every area prompt has the required sections', () => {
  for (const area of AREAS) {
    const text = read(`agents/${area}.md`);
    for (const h of ['## Scope', '## Out of scope', '## Rules', '## Facts to record']) assert.ok(text.includes(h), `${area}: ${h}`);
  }
});

test('rule keys are unique, use the area prefix, and each area has at least 5', () => {
  const all = new Set();
  for (const area of AREAS) {
    const keys = ruleKeys(area);
    assert.ok(keys.length >= 5, `${area} has ${keys.length} rules`);
    for (const k of keys) {
      assert.ok(k.startsWith(`${area}.`), `${k} in ${area}.md`);
      assert.ok(!all.has(k), `duplicate rule ${k}`);
      all.add(k);
    }
  }
});

test('the contract forbids fixes and estimates and defines the output', () => {
  const text = read('agents/_contract.md');
  assert.match(text, /## Never include/);
  assert.match(text, /Effort, time or cost estimates/);
  assert.match(text, /"findings"/);
  assert.match(text, /"facts"/);
  assert.match(text, /`subject`/);
  assert.match(text, /Only use live pages whose `status` is 200 for content rules/);
});

test('the backlog prompt defines outcome-only items', () => {
  const text = read('agents/backlog.md');
  assert.match(text, /## Output/);
  assert.match(text, /Never include implementation steps/);
});

test('stack packs exist and only reference existing rule keys', () => {
  const known = new Set(AREAS.flatMap(ruleKeys));
  for (const pack of ['generic', 'static-html', 'wordpress', 'nextjs']) {
    const text = read(`references/stacks/${pack}.md`);
    for (const m of text.matchAll(/`([a-z0-9-]+)\.([a-z0-9-]+)`/g)) {
      if (AREAS.includes(m[1])) assert.ok(known.has(`${m[1]}.${m[2]}`), `${pack}.md references unknown rule ${m[0]}`);
    }
  }
});

test('the severity rubric names the four levels', () => {
  const text = read('references/severity-rubric.md');
  for (const s of ['critical', 'high', 'medium', 'low']) assert.ok(text.includes(`| ${s} |`), s);
});

test('hosting compression and caching rules are limited to what live.json can show', () => {
  const rows = read('agents/hosting.md').split('\n').filter((l) => /`hosting\.(no-compression|weak-caching)`/.test(l));
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.match(row, /home page HTML/);
    assert.match(row, /cannot be verified from `live\.json`/);
    assert.match(row, /"verified": false/);
  }
});

test('code-quality does not point at largeFiles for line counts', () => {
  const scope = /## Scope\n+([\s\S]*?)\n## /.exec(read('agents/code-quality.md').replace(/\r\n/g, '\n'))[1];
  assert.match(scope, /`inventory`/);
  assert.doesNotMatch(scope, /largeFiles/);
});

test('nobody is contacted: the rule is in every subagent prompt, both orchestrators and the agent', () => {
  const rule = read('agents/_no-contact.md');
  assert.match(rule, /^## Nobody is contacted/);
  for (const part of ['**Never submit a form.**', '**Never contact a real company or person, in any form.**', 'not even with test data', 'the one that started you']) assert.ok(rule.includes(part), part);
  const commands = read('scripts/commands.mjs');
  for (const prompt of ['agents/${o.area}.md', 'agents/editor.md', 'agents/brief-writer.md', 'brief-review.md', 'layout-review.md']) {
    const at = commands.indexOf(prompt);
    assert.ok(at > 0 && commands.slice(at, at + 400).includes('noContact()'), `${prompt} is printed without the rule`);
  }
  assert.match(read('SKILL.md'), /\*\*Nobody is contacted, by you or by any subagent\.\*\*/);
  assert.match(read('SKILL.md'), /the content of both files followed by the JSON/);
  assert.match(read('../roadmap/SKILL.md'), /\*\*Nobody is contacted, by you or by any subagent\.\*\*/);
  assert.match(read('../../agents/area-analyst.md'), /Never submit a form on any site/);
});
