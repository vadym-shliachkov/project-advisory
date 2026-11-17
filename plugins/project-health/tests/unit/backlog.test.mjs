import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBacklog, orderBacklog, renderBacklog } from '../../skills/project-health/scripts/lib/backlog.mjs';
import { sampleDoc } from './sample-doc.mjs';

const selected = ['SEC-a91c', 'SEO-1b2c', 'AI-9e02'];
const item = (id, findingIds, priority, dependsOn = []) => ({
  id, findingIds, priority, dependsOn,
  outcome: `Outcome for ${id} is true.`, acceptanceCriteria: [`A re-run no longer reports ${findingIds.join(', ')}.`],
});

test('a valid backlog passes and priorities are corrected to the highest severity', () => {
  const { errors, warnings, items } = validateBacklog({ items: [item('BL-001', ['SEC-a91c'], 'high'), item('BL-002', ['SEO-1b2c'], 'high')] }, sampleDoc(), selected);
  assert.deepEqual(errors, []);
  assert.equal(items[0].priority, 'critical');
  assert.ok(warnings[0].includes('priority changed'));
});

test('items may only link ticked findings, and every ticked issue must be covered once', () => {
  const doc = sampleDoc();
  const notTicked = validateBacklog({ items: [item('BL-001', ['SEC-a91c', 'SEO-1b2c', 'PERF-0b3e'], 'critical')] }, doc, selected);
  assert.ok(notTicked.errors.some((e) => e.includes('PERF-0b3e, which is not ticked')));
  const uncovered = validateBacklog({ items: [item('BL-001', ['SEC-a91c'], 'critical')] }, doc, selected);
  assert.ok(uncovered.errors.some((e) => e.includes('SEO-1b2c is not covered')));
  const twice = validateBacklog({ items: [item('BL-001', ['SEC-a91c', 'SEO-1b2c'], 'critical'), item('BL-002', ['SEO-1b2c'], 'high')] }, doc, selected);
  assert.ok(twice.errors.some((e) => e.includes('linked from 2 items')));
});

test('unknown or self dependencies and schema violations are errors', () => {
  const doc = sampleDoc();
  const bad = validateBacklog({ items: [item('BL-001', ['SEC-a91c'], 'critical', ['BL-009']), item('BL-002', ['SEO-1b2c'], 'high', ['BL-002'])] }, doc, selected);
  assert.ok(bad.errors.some((e) => e.includes('unknown item BL-009')));
  assert.ok(bad.errors.some((e) => e.includes('depends on itself')));
  const schema = validateBacklog({ items: [{ ...item('BL-001', ['SEC-a91c'], 'critical'), estimate: '3d' }] }, doc, selected);
  assert.ok(schema.errors.some((e) => e.includes('unknown property "estimate"')));
});

test('orderBacklog puts dependencies first, then priority, and detects cycles', () => {
  const items = [item('BL-001', ['SEO-1b2c'], 'high'), item('BL-002', ['SEC-a91c'], 'critical', ['BL-003']), item('BL-003', ['AI-9e02'], 'medium')];
  assert.deepEqual(orderBacklog(items).map((i) => i.id), ['BL-001', 'BL-003', 'BL-002']);
  assert.throws(() => orderBacklog([item('BL-001', ['a'], 'low', ['BL-002']), item('BL-002', ['b'], 'low', ['BL-001'])]), /cycle/);
});

test('renderBacklog lists outcome, findings, dependencies and criteria as checkboxes', () => {
  const md = renderBacklog([item('BL-001', ['SEC-a91c'], 'critical')], sampleDoc());
  assert.match(md, /^# Backlog — Acme Studio — 2026-10-11/);
  assert.match(md, /## BL-001 · Critical/);
  assert.match(md, /\*\*Outcome:\*\* Outcome for BL-001 is true\./);
  assert.match(md, /- SEC-a91c — Secrets committed in \.env\.production/);
  assert.match(md, /\*\*Depends on:\*\* —/);
  assert.match(md, /- \[ \] A re-run no longer reports SEC-a91c\./);
});
