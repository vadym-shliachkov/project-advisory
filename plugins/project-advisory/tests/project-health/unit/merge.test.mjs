import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mergeRun } from '../../../skills/project-health/scripts/lib/merge.mjs';
import { identityKey } from '../../../skills/project-health/scripts/lib/ids.mjs';

const seoIssue = (over = {}) => ({
  rule: 'seo.missing-meta-description', subject: 'site', area: 'seo', kind: 'issue',
  title: 'Pages have no meta description', why: 'Search engines write their own snippet, so fewer people click.',
  severity: 'high', confidence: 'high', evidence: [{ type: 'url', ref: 'https://a.test/a' }, { type: 'url', ref: 'https://a.test/b' }], verified: true, ...over,
});
const secIssue = (over = {}) => ({
  rule: 'security.secret-in-repo', subject: '.env.production', area: 'security', kind: 'issue',
  title: 'AWS key committed', why: 'Anyone with repository access can use the key to run up costs.',
  severity: 'critical', confidence: 'high', evidence: [{ type: 'file', ref: '.env.production:1' }], verified: true, ...over,
});
const base = (outputs, extra = {}) => mergeRun({
  runId: '2026-10-11T0950', project: { name: 'Acme', url: null }, mode: 'subagents',
  planned: { applicable: ['seo', 'security'], skipped: { hosting: 'library — not deployed as a website' } },
  outputs, ...extra,
});

test('statuses: ok, failed (missing/invalid/forced), skipped, not selected', () => {
  const { doc } = base({ seo: { findings: [seoIssue()], facts: [] }, security: { findings: [{ nope: 1 }], facts: [] } });
  assert.equal(doc.areas.seo.status, 'ok');
  assert.equal(doc.areas.security.status, 'failed');
  assert.match(doc.areas.security.reason, /invalid output/);
  assert.equal(doc.areas.hosting.status, 'skipped');
  assert.equal(doc.areas['ai-setup'].reason, 'not selected');
  const missing = base({ seo: { findings: [], facts: [] } });
  assert.equal(missing.doc.areas.security.reason, 'no output');
  const forced = base({ seo: { findings: [], facts: [] } }, { failures: { security: 'invalid JSON: Unexpected token' } });
  assert.match(forced.doc.areas.security.reason, /invalid JSON/);
});

test('findings get ids, new status, scores and sorting by severity', () => {
  const { doc } = base({ seo: { findings: [seoIssue()], facts: [] }, security: { findings: [secIssue()], facts: [] } });
  assert.deepEqual(doc.findings.map((f) => f.area), ['security', 'seo']);
  assert.ok(doc.findings.every((f) => f.status === 'new' && /^[A-Z]+-[0-9a-f]{4}$/.test(f.id)));
  assert.equal(doc.areas.security.score, 75);
  assert.equal(doc.areas.seo.score, 90);
  assert.equal(doc.overallScore, 83);
});

test('duplicates are merged: evidence united, highest severity kept', () => {
  const { doc } = base({ seo: { findings: [seoIssue(), seoIssue({ severity: 'critical', evidence: [{ type: 'url', ref: 'https://a.test/c' }, { type: 'url', ref: 'https://a.test/a?x=1' }] })], facts: [] } });
  assert.equal(doc.findings.length, 1);
  assert.equal(doc.findings[0].severity, 'critical');
  assert.equal(doc.findings[0].evidence.length, 3);
});

test('unverified critical findings are capped at high', () => {
  const { doc } = base({ security: { findings: [secIssue({ verified: false })], facts: [] } });
  assert.equal(doc.findings[0].severity, 'high');
  assert.equal(doc.findings[0].capped, true);
});

test('a check is kept only while the problem is unconfirmed', () => {
  const open = base({ security: { findings: [secIssue({ verified: false, toConfirm: 'Look at the live server.' })], facts: [] } }).doc;
  assert.equal(open.findings[0].toConfirm, 'Look at the live server.');
  const confirmed = base({ security: { findings: [secIssue({ verified: false, toConfirm: 'Look at the live server.' }), secIssue({ verified: true })], facts: [] } }).doc;
  assert.equal(confirmed.findings.length, 1);
  assert.equal(confirmed.findings[0].verified, true);
  assert.ok(!('toConfirm' in confirmed.findings[0]));
});

test('notVerified holds check-level notes only, never per-finding lines', () => {
  const { doc } = base({ security: { findings: [secIssue({ verified: false })], facts: [] } }, { notVerified: ['Lighthouse disabled'] });
  assert.deepEqual(doc.notVerified, ['Lighthouse disabled']);
});

test('a finding whose evidence grows keeps its id and becomes persisting (review focus 1)', () => {
  const first = base({ seo: { findings: [seoIssue()], facts: [] }, security: { findings: [], facts: [] } }).doc;
  const grown = seoIssue({ title: '13 pages have no meta description', evidence: [...seoIssue().evidence, { type: 'url', ref: 'https://a.test/new' }] });
  const second = base({ seo: { findings: [grown], facts: [] }, security: { findings: [], facts: [] } }, { previous: first }).doc;
  assert.equal(second.findings[0].id, first.findings[0].id);
  assert.equal(second.findings[0].status, 'persisting');
  assert.deepEqual(second.fixed, []);
});

test('only areas that ran ok can report fixes (review focus 2)', () => {
  const first = base({ seo: { findings: [seoIssue()], facts: [] }, security: { findings: [secIssue()], facts: [] } }).doc;
  const second = mergeRun({
    runId: '2026-10-12T0900', project: { name: 'Acme', url: null }, mode: 'subagents',
    planned: { applicable: ['seo'], skipped: {} },
    outputs: { seo: { findings: [], facts: [] } }, previous: first,
  }).doc;
  assert.deepEqual(second.fixed.map((f) => f.area), ['seo']);
  const failed = base({ seo: { findings: [], facts: [] } }, { previous: first }).doc;
  assert.ok(!failed.fixed.some((f) => f.area === 'security'));
});

test('facts are returned per ok area and warnings are prefixed with the area', () => {
  const { factsByArea, warnings } = base({
    seo: { findings: [seoIssue({ why: 'You should add descriptions to every page soon.' })], facts: [{ key: 'seo.sitemapUrl', value: '/sitemap.xml', source: 'robots.txt', confidence: 'high' }] },
    security: { findings: [], facts: [] },
  });
  assert.equal(factsByArea.seo.length, 1);
  assert.ok(warnings.some((w) => w.startsWith('seo: ')));
});

test('each area is compared with the latest earlier run where that area ran ok', () => {
  const seoA = seoIssue();
  const seoB = seoIssue({ rule: 'seo.missing-title', title: 'Pages have no title' });
  const run1 = base({ seo: { findings: [seoA, seoB], facts: [] }, security: { findings: [secIssue()], facts: [] } }).doc;
  const run2 = mergeRun({
    runId: '2026-10-12T0900', project: { name: 'Acme', url: null }, mode: 'subagents',
    planned: { applicable: ['security'], skipped: {} },
    outputs: { security: { findings: [], facts: [] } }, previous: [run1],
  }).doc;
  assert.equal(run2.areas.seo.status, 'skipped');
  const run3 = base({ seo: { findings: [seoA], facts: [] }, security: { findings: [], facts: [] } }, { previous: [run2, run1] }).doc;
  const idA = run1.findings.find((f) => f.rule === seoA.rule).id;
  const idB = run1.findings.find((f) => f.rule === seoB.rule).id;
  assert.equal(run3.findings.find((f) => f.id === idA).status, 'persisting');
  assert.deepEqual(run3.fixed.map((f) => f.id), [idB], 'SEO-b is fixed against run1; the security fix was already reported in run2');
});

test('a finding keeps its earlier id even when a new finding collides with it later', () => {
  const short = (x) => createHash('sha1').update(identityKey(x)).digest('hex').slice(0, 4);
  const seen = new Map();
  let pair = null;
  for (let i = 0; i < 20000 && !pair; i++) {
    const x = seoIssue({ subject: `/page-${i}` });
    if (seen.has(short(x))) pair = [seen.get(short(x)), x];
    else seen.set(short(x), x);
  }
  assert.ok(pair, 'expected to find a 4-hex collision');
  const first = base({ seo: { findings: [pair[0]], facts: [] }, security: { findings: [], facts: [] } }).doc;
  const second = base({ seo: { findings: pair, facts: [] }, security: { findings: [], facts: [] } }, { previous: first }).doc;
  const old = second.findings.find((f) => f.subject === pair[0].subject);
  const added = second.findings.find((f) => f.subject === pair[1].subject);
  assert.equal(old.id, first.findings[0].id);
  assert.equal(old.status, 'persisting');
  assert.match(added.id, /^SEO-[0-9a-f]{6}$/);
  assert.deepEqual(second.fixed, []);
});

test('a live-site finding is not reported fixed by a run without live data', () => {
  const csp = { ...secIssue(), rule: 'security.missing-csp', subject: 'site', severity: 'medium', evidence: [{ type: 'url', ref: 'https://a.test/' }] };
  const secret = secIssue();
  const first = base({ seo: { findings: [], facts: [] }, security: { findings: [csp, secret], facts: [] } }).doc;
  const offline = base({ seo: { findings: [], facts: [] }, security: { findings: [], facts: [] } }, { previous: first, liveAvailable: false }).doc;
  assert.deepEqual(offline.fixed.map((f) => f.title), [secret.title], 'the file-based finding is fixed');
  assert.deepEqual(offline.notRechecked.map((f) => f.title), [csp.title]);
  const online = base({ seo: { findings: [], facts: [] }, security: { findings: [], facts: [] } }, { previous: first, liveAvailable: true }).doc;
  assert.equal(online.fixed.length, 2);
  // A finding from a run that had no live data itself can be fixed without live data.
  const firstOffline = base({ seo: { findings: [], facts: [] }, security: { findings: [csp], facts: [] } }, { liveAvailable: false }).doc;
  const later = base({ seo: { findings: [], facts: [] }, security: { findings: [], facts: [] } }, { previous: firstOffline, liveAvailable: false }).doc;
  assert.equal(later.fixed.length, 1);
});

test('facts outside the area key prefix are not stored', () => {
  const { factsByArea, warnings } = base({
    seo: { findings: [], facts: [
      { key: 'seo.sitemapUrl', value: '/sitemap.xml', source: 'robots.txt', confidence: 'high' },
      { key: 'architecture.framework', value: 'none', source: 'index.html', confidence: 'high' },
    ] },
    security: { findings: [], facts: [] },
  });
  assert.deepEqual(factsByArea.seo.map((f) => f.key), ['seo.sitemapUrl']);
  assert.ok(warnings.some((w) => w.includes('"architecture.framework" does not start with "seo."')));
});

test('a finding under a retired rule is not called fixed when it disappears', () => {
  const procIssue = { ...seoIssue(), rule: 'process-hygiene.no-ci', area: 'process-hygiene', title: 'No CI configuration' };
  const planned = { applicable: ['process-hygiene'], skipped: {} };
  const first = mergeRun({ runId: '2026-10-11T0950', project: { name: 'Acme', url: null }, planned, outputs: { 'process-hygiene': { findings: [procIssue], facts: [] } } });
  const second = mergeRun({ runId: '2026-10-12T0950', project: { name: 'Acme', url: null }, planned, outputs: { 'process-hygiene': { findings: [], facts: [] } }, previous: first.doc });
  assert.deepEqual(second.doc.fixed, []);
});
