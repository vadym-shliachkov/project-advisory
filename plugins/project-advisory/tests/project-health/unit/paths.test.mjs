import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from '../helpers.mjs';
import { createRun, resolveRun, newRunId, previousRuns, healthDir } from '../../../skills/project-health/scripts/lib/paths.mjs';
import { parseLooseJson, readJson, writeJson } from '../../../skills/project-health/scripts/lib/io.mjs';
import { AREAS, AREA_PREFIX } from '../../../skills/project-health/scripts/lib/areas.mjs';

const date = new Date(2026, 9, 11, 9, 50);

test('there are eleven areas, each with a prefix', () => {
  assert.equal(AREAS.length, 11);
  for (const a of AREAS) assert.match(AREA_PREFIX[a], /^[A-Z]+$/);
});

test('newRunId formats local time as YYYY-MM-DDTHHmm', () => {
  assert.equal(newRunId(date), '2026-10-11T0950');
});

test('createRun creates the run folder, gitignore and latest pointer', () => {
  const root = tmpDir();
  const run = createRun(root, date);
  assert.equal(run.id, '2026-10-11T0950');
  assert.ok(fs.existsSync(path.join(run.dir, 'areas')));
  assert.equal(fs.readFileSync(path.join(healthDir(root), '.gitignore'), 'utf8'), 'runs/\nprofile.json\nlatest.json\n');
  assert.deepEqual(readJson(path.join(healthDir(root), 'latest.json')), { run: '2026-10-11T0950' });
});

test('two runs in the same minute get distinct ids', () => {
  const root = tmpDir();
  createRun(root, date);
  assert.equal(createRun(root, date).id, '2026-10-11T0950-2');
});

test('resolveRun defaults to the latest run', () => {
  const root = tmpDir();
  const run = createRun(root, date);
  assert.equal(resolveRun(root).dir, run.dir);
});

test('resolveRun rejects ids that are not run ids', () => {
  const root = tmpDir();
  createRun(root, date);
  assert.throws(() => resolveRun(root, '../../etc'), /Invalid run id/);
});

test('resolveRun explains when there is no run yet', () => {
  assert.throws(() => resolveRun(tmpDir()), /No analysis run found/);
});

test('previousRuns lists earlier runs that have findings, newest first', () => {
  const root = tmpDir();
  const a = createRun(root, new Date(2026, 9, 10, 8, 0));
  createRun(root, new Date(2026, 9, 10, 9, 0)); // no findings.json
  const c = createRun(root, new Date(2026, 9, 10, 10, 0));
  const d = createRun(root, date);
  writeJson(path.join(a.dir, 'findings.json'), { findings: [] });
  writeJson(path.join(c.dir, 'findings.json'), { findings: [] });
  assert.deepEqual(previousRuns(root, d.id), [c.id, a.id]);
  assert.deepEqual(previousRuns(root, a.id), []);
});

test('parseLooseJson accepts fences, BOM and surrounding text', () => {
  assert.deepEqual(parseLooseJson('\uFEFF```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseLooseJson('Here you go:\n{"a":{"b":2}}\nDone.'), { a: { b: 2 } });
  assert.throws(() => parseLooseJson('no json here'));
});

test('parseLooseJson tolerates trailing prose, braces in leading prose and in strings', () => {
  const doc = { findings: [], facts: [] };
  assert.deepEqual(parseLooseJson('{"findings":[],"facts":[]}\n\nI found no issues.'), doc);
  assert.deepEqual(parseLooseJson('Output shape { findings, facts }:\n{"findings":[],"facts":[]}'), doc);
  assert.deepEqual(parseLooseJson('```json\n{"findings":[],"facts":[]}\n```\n\nDone — nothing else to report.'), doc);
  assert.deepEqual(parseLooseJson('Result:\n{"a":"x } y { \\" }","b":{"c":1}} trailing }'), { a: 'x } y { " }', b: { c: 1 } });
  assert.throws(() => parseLooseJson('Shape { findings, facts } only'), /No JSON object found/);
});
