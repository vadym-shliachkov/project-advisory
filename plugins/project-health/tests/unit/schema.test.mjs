import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSchema, validate } from '../../skills/project-health/scripts/lib/schema.mjs';
import { AREAS } from '../../skills/project-health/scripts/lib/areas.mjs';

const finding = () => ({
  rule: 'seo.missing-meta-description',
  subject: 'site',
  area: 'seo',
  kind: 'issue',
  title: '12 of 15 pages have no meta description',
  why: 'Search engines write their own snippet, so fewer people click through.',
  severity: 'high',
  confidence: 'high',
  evidence: [{ type: 'url', ref: 'https://example.com/about' }],
  verified: true,
});

test('a valid finding passes', () => {
  assert.deepEqual(validate(loadSchema('finding'), finding()), []);
});

test('the finding schema lists exactly the known areas', () => {
  assert.deepEqual(loadSchema('finding').properties.area.enum, AREAS);
});

for (const forbidden of ['recommendation', 'effort', 'cost', 'fix']) {
  test(`a finding with "${forbidden}" is rejected`, () => {
    const errors = validate(loadSchema('finding'), { ...finding(), [forbidden]: 'x' });
    assert.ok(errors.some((e) => e.includes(`unknown property "${forbidden}"`)), errors.join('\n'));
  });
}

test('missing required fields are reported', () => {
  const { why, subject, ...rest } = finding();
  const errors = validate(loadSchema('finding'), rest);
  assert.ok(errors.some((e) => e.includes('"why"')));
  assert.ok(errors.some((e) => e.includes('"subject"')));
});

test('enums, types, minItems and patterns are enforced', () => {
  const schema = loadSchema('finding');
  assert.ok(validate(schema, { ...finding(), severity: 'urgent' }).some((e) => e.includes('must be one of')));
  assert.ok(validate(schema, { ...finding(), verified: 'yes' }).some((e) => e.includes('expected boolean')));
  assert.ok(validate(schema, { ...finding(), evidence: [] }).some((e) => e.includes('at least 1')));
  assert.ok(validate(schema, { ...finding(), rule: 'Missing Meta' }).some((e) => e.includes('must match')));
});

test('facts need key, value, source and confidence; value may be any JSON', () => {
  const schema = loadSchema('fact');
  assert.deepEqual(validate(schema, { key: 'hosting.provider', value: null, source: 'netlify.toml', confidence: 'high' }), []);
  assert.ok(validate(schema, { key: 'hosting.provider', value: 'x', confidence: 'high' }).some((e) => e.includes('"source"')));
});

test('backlog items reject estimates and implementation steps', () => {
  const item = { id: 'BL-001', findingIds: ['SEC-a91c'], outcome: 'No secrets are present in the repository.', acceptanceCriteria: ['A re-run no longer reports SEC-a91c.'], dependsOn: [], priority: 'critical' };
  const schema = loadSchema('backlog');
  assert.deepEqual(validate(schema, { items: [item] }), []);
  assert.ok(validate(schema, { items: [{ ...item, estimate: '2h' }] }).some((e) => e.includes('unknown property "estimate"')));
  assert.ok(validate(schema, { items: [{ ...item, steps: ['a'] }] }).some((e) => e.includes('unknown property "steps"')));
});
