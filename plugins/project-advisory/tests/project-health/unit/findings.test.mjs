import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAreaOutput } from '../../../skills/project-health/scripts/lib/findings.mjs';
import { FAKE_AWS_KEY } from '../fixtures/make-static-html-repo.mjs';

const issue = (over = {}) => ({
  rule: 'seo.missing-meta-description', subject: 'site', area: 'seo', kind: 'issue',
  title: '12 pages have no meta description', why: 'Search engines write their own snippet, so fewer people click.',
  severity: 'high', confidence: 'high', evidence: [{ type: 'url', ref: 'https://a.test/' }], verified: true, ...over,
});
const tooling = (evidence) => ({
  rule: 'ai-setup.tooling-opportunity', subject: 'scaffold-page', area: 'ai-setup', kind: 'tooling',
  title: 'Skill: scaffold a page', why: 'Adding a page repeats the same four manual edits each time.',
  severity: 'medium', confidence: 'high', evidence, verified: true,
  toolType: 'skill', trigger: 'When a new page is added', draftDescription: 'Creates a page from the shared layout and links it in the navigation.',
});
const commit = (sha) => ({ type: 'commit', ref: sha });

test('a valid output has no errors', () => {
  assert.deepEqual(validateAreaOutput('seo', { findings: [issue()], facts: [] }), { errors: [], warnings: [] });
});

test('non-object and missing arrays are errors', () => {
  assert.ok(validateAreaOutput('seo', []).errors.length);
  assert.ok(validateAreaOutput('seo', { findings: [] }).errors.some((e) => e.includes('facts')));
  assert.ok(validateAreaOutput('seo', { findings: [], facts: [], notes: 'x' }).errors.some((e) => e.includes('unknown property "notes"')));
});

test('area and rule prefix must match the analysed area', () => {
  const { errors } = validateAreaOutput('security', { findings: [issue()], facts: [] });
  assert.ok(errors.some((e) => e.includes('does not match')));
  assert.ok(errors.some((e) => e.includes('must start with "security."')));
});

test('structural issues may carry a direction; opportunities are gone and tooling has no direction', () => {
  const structural = issue({ direction: 'Shared layouts in a static site generator such as Eleventy.' });
  assert.deepEqual(validateAreaOutput('seo', { findings: [structural], facts: [] }), { errors: [], warnings: [] });
  const opp = validateAreaOutput('seo', { findings: [issue({ kind: 'opportunity' })], facts: [] });
  assert.ok(opp.errors.some((e) => e.includes('kind: must be one of issue, tooling')), opp.errors.join('\n'));
  const tool = validateAreaOutput('ai-setup', { findings: [{ ...tooling([{ type: 'file', ref: 'README.md:1', highRisk: true }]), direction: 'Use a skill for this.' }], facts: [] });
  assert.ok(tool.errors.some((e) => e.includes('only issues carry a direction')));
});

test('tooling needs 3 evidence items or one marked highRisk', () => {
  const two = validateAreaOutput('ai-setup', { findings: [tooling([commit('a1'), commit('b2')])], facts: [] });
  assert.ok(two.errors.some((e) => e.includes('at least 3 evidence')));
  const risky = validateAreaOutput('ai-setup', { findings: [tooling([{ type: 'file', ref: 'README.md:10', highRisk: true }])], facts: [] });
  assert.deepEqual(risky.errors, []);
  const three = validateAreaOutput('ai-setup', { findings: [tooling([commit('a1'), commit('b2'), commit('c3')])], facts: [] });
  assert.deepEqual(three.errors, []);
});

test('fix advice and estimates in the text produce warnings', () => {
  const { errors, warnings } = validateAreaOutput('seo', { findings: [issue({ why: 'You should add descriptions; this takes 2 hours of work.' })], facts: [] });
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes('fix advice')));
});

test('an unverified issue says what would confirm it', () => {
  const base = issue();
  const missing = validateAreaOutput('seo', { findings: [{ ...base, verified: false }], facts: [] });
  assert.ok(missing.warnings.some((w) => w.includes('toConfirm: an unverified issue says what would confirm it')));
  const given = validateAreaOutput('seo', { findings: [{ ...base, verified: false, toConfirm: 'Look at the live pages.' }], facts: [] });
  assert.ok(!given.warnings.some((w) => w.includes('toConfirm')));
});

test('duplicate rule + subject produces a warning', () => {
  const { warnings } = validateAreaOutput('seo', { findings: [issue(), issue({ title: 'again' })], facts: [] });
  assert.ok(warnings.some((w) => w.includes('same rule and subject')));
});

test('invalid facts are errors', () => {
  const { errors } = validateAreaOutput('seo', { findings: [], facts: [{ key: 'seo.sitemap', value: 1 }] });
  assert.ok(errors.some((e) => e.includes('$.facts[0]')));
});

test('a raw secret anywhere in a finding is an error; the masked form passes', () => {
  const leak = issue({ evidence: [{ type: 'file', ref: '.env.production:1', excerpt: `AWS_ACCESS_KEY_ID=${FAKE_AWS_KEY}` }] });
  const { errors } = validateAreaOutput('seo', { findings: [leak], facts: [] });
  assert.deepEqual(errors, ['$.findings[0].evidence[0].excerpt: contains what looks like a secret — use the masked form from collect.json']);
  const inTitle = validateAreaOutput('seo', { findings: [issue({ title: `Key ${FAKE_AWS_KEY} is public` })], facts: [] });
  assert.ok(inTitle.errors.some((e) => e.startsWith('$.findings[0].title: contains what looks like a secret')));
  const masked = issue({ evidence: [{ type: 'file', ref: '.env.production:1', excerpt: 'AKIA…LE (20 chars)' }] });
  assert.deepEqual(validateAreaOutput('seo', { findings: [masked], facts: [] }).errors, []);
});

test('an excerpt quoting ordinary code is not mistaken for a secret', () => {
  const code = issue({ evidence: [
    { type: 'file', ref: 'src/api.js:3', excerpt: "const API_TOKEN_URL = 'https://auth.example.com/oauth'" },
    { type: 'file', ref: 'src/login.js:9', excerpt: 'password: req.body.password,' },
  ] });
  assert.deepEqual(validateAreaOutput('seo', { findings: [code], facts: [] }).errors, []);
});
