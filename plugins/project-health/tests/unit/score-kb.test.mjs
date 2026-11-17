import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from '../helpers.mjs';
import { areaScore, overallScore, withoutDismissed } from '../../skills/project-health/scripts/lib/score.mjs';
import { mergeFacts, staleFacts, loadKb, saveKb, hashSource } from '../../skills/project-health/scripts/lib/kb.mjs';

const issue = (severity) => ({ kind: 'issue', severity });

test('area score subtracts weights of every problem but not tooling, floored at 0', () => {
  assert.equal(areaScore([]), 100);
  assert.equal(areaScore([issue('critical'), issue('high'), issue('medium'), issue('low')]), 60);
  assert.equal(areaScore([{ kind: 'tooling', severity: 'high' }]), 100);
  assert.equal(areaScore([{ kind: 'opportunity', severity: 'medium' }]), 96, 'structural findings from older runs count too');
  assert.equal(areaScore(Array.from({ length: 5 }, () => issue('critical'))), 0);
});

test('overall score is the rounded mean of ok areas', () => {
  assert.equal(overallScore({ a: { status: 'ok', score: 90 }, b: { status: 'ok', score: 75 }, c: { status: 'failed' } }), 83);
  assert.equal(overallScore({ a: { status: 'skipped' } }), null);
});

test('mergeFacts adds new facts with date, author and source hash', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'netlify.toml'), '[build]\n');
  const facts = mergeFacts([], [{ key: 'hosting.provider', value: 'Netlify', source: 'netlify.toml', confidence: 'high' }], { root, by: 'hosting', date: '2026-10-11' });
  assert.equal(facts.length, 1);
  assert.equal(facts[0].observedAt, '2026-10-11');
  assert.equal(facts[0].by, 'hosting');
  assert.equal(facts[0].sourceHash, hashSource(root, 'netlify.toml'));
  assert.deepEqual(facts[0].history, []);
});

test('mergeFacts moves a changed value into history and keeps 10 entries', () => {
  const root = tmpDir();
  let facts = [];
  for (let i = 0; i < 13; i++) facts = mergeFacts(facts, [{ key: 'seo.pages', value: i, source: 'git', confidence: 'high' }], { root, by: 'seo', date: `2026-10-${String(i + 1).padStart(2, '0')}` });
  assert.equal(facts[0].value, 12);
  assert.equal(facts[0].history.length, 10);
  assert.equal(facts[0].history[0].value, 11);
});

test('human facts are never overwritten', () => {
  const human = { key: 'business.goal', value: 'Demo requests', source: 'human', confidence: 'high', observedAt: '2026-01-01', by: 'human', history: [] };
  const facts = mergeFacts([human], [{ key: 'business.goal', value: 'Sales', source: 'index.html', confidence: 'low' }], { root: tmpDir(), by: 'content-conversion' });
  assert.equal(facts[0].value, 'Demo requests');
});

test('staleFacts reports missing and changed sources, old URL facts, and ignores human facts', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'a.txt'), 'one');
  fs.writeFileSync(path.join(root, 'gone.txt'), 'soon deleted');
  const facts = mergeFacts([], [
    { key: 'x.changed', value: 1, source: 'a.txt', confidence: 'high' },
    { key: 'x.missing', value: 1, source: 'gone.txt', confidence: 'high' },
    { key: 'x.url', value: 1, source: 'https://a.test/', confidence: 'high' },
  ], { root, by: 'hosting', date: '2026-09-01' });
  facts.push({ key: 'x.human', value: 1, source: 'human', confidence: 'high', observedAt: '2020-01-01', by: 'human' });
  fs.writeFileSync(path.join(root, 'a.txt'), 'two');
  fs.rmSync(path.join(root, 'gone.txt'));
  const stale = staleFacts(facts, root, '2026-10-11');
  assert.deepEqual(stale.map((s) => [s.key, s.reason]).sort(), [
    ['x.changed', 'source changed'],
    ['x.missing', 'source missing'],
    ['x.url', 'older than 30 days'],
  ]);
});

test('tool-output, multi-file and line-suffixed sources do not go stale on every run', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  fs.writeFileSync(path.join(root, 'netlify.toml'), '[build]\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# A\n');
  const facts = mergeFacts([], [
    { key: 'x.tool', value: 1, source: 'collect.json', confidence: 'high' },
    { key: 'x.live', value: 1, source: 'live.json', confidence: 'high' },
    { key: 'x.never', value: 1, source: 'not-a-file-the-agent-made-up', confidence: 'high' },
    { key: 'x.multi', value: 1, source: 'package.json, netlify.toml', confidence: 'high' },
    { key: 'x.line', value: 1, source: 'README.md#L1', confidence: 'high' },
  ], { root, by: 'hosting', date: '2026-10-01' });
  assert.ok(facts.find((f) => f.key === 'x.multi').sourceHash);
  assert.ok(facts.find((f) => f.key === 'x.line').sourceHash);
  assert.deepEqual(staleFacts(facts, root, '2026-10-11'), []);
  fs.writeFileSync(path.join(root, 'netlify.toml'), '[build]\ncommand = "x"\n');
  assert.deepEqual(staleFacts(facts, root, '2026-10-11').map((s) => [s.key, s.reason]), [['x.multi', 'source changed']]);
});

test('withoutDismissed removes dismissed findings and recomputes the scores', () => {
  const doc = {
    areas: { seo: { status: 'ok', score: 65 }, security: { status: 'ok', score: 75 }, hosting: { status: 'skipped', reason: 'x' } },
    overallScore: 70,
    findings: [
      { id: 'SEO-1', area: 'seo', kind: 'issue', severity: 'critical' },
      { id: 'SEO-2', area: 'seo', kind: 'issue', severity: 'high' },
      { id: 'SEC-1', area: 'security', kind: 'issue', severity: 'critical' },
    ],
  };
  const out = withoutDismissed(doc, ['SEO-1']);
  assert.deepEqual(out.findings.map((f) => f.id), ['SEO-2', 'SEC-1']);
  assert.equal(out.areas.seo.score, 90);
  assert.equal(out.areas.security.score, 75);
  assert.equal(out.overallScore, 83);
  assert.equal(withoutDismissed(doc, []), doc);
});

test('sources outside the project root are ignored', () => {
  assert.equal(hashSource(tmpDir(), '../../etc/hosts'), null);
});

test('loadKb and saveKb round-trip sorted by key', () => {
  const root = tmpDir();
  assert.deepEqual(loadKb(root), []);
  saveKb(root, [{ key: 'b.x', value: 1 }, { key: 'a.x', value: 2 }]);
  assert.deepEqual(loadKb(root).map((f) => f.key), ['a.x', 'b.x']);
});
