import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderChecklist, parseTicks, resolveSelection } from '../../../skills/project-health/scripts/lib/checklist.mjs';
import { sampleDoc } from './sample-doc.mjs';

test('default ticks: critical/high issues, structural issues and tooling ticked; the rest unticked', () => {
  const { ticked, unticked } = parseTicks(renderChecklist(sampleDoc()));
  assert.deepEqual([...ticked].sort(), ['AI-9e02', 'ARCH-5c10', 'SEC-a91c', 'SEO-1b2c', 'SEO-77de']);
  assert.deepEqual([...unticked].sort(), ['AI-4d5e', 'PERF-0b3e']);
});

test('final ticks everything', () => {
  const { unticked, ticked } = parseTicks(renderChecklist(sampleDoc(), { final: true }));
  assert.equal(unticked.size, 0);
  assert.equal(ticked.size, 7);
});

test('the checklist has sections, summary, tags, fixed and areas not analysed', () => {
  const md = renderChecklist(sampleDoc());
  for (const heading of ['## Critical', '## High', '## Medium', '## Low', '## Recommended AI tooling', '## Fixed since last run', '## Areas not analysed']) {
    assert.ok(md.includes(heading), heading);
  }
  assert.match(md, /Summary: 2 critical · 1 high · 2 medium · 1 low · 1 fixed since last run/);
  assert.match(md, /\*\*ARCH-5c10\*\* · Header and footer are copied into 30 files · structural · ⚠ new/);
  assert.ok(!md.includes('## Opportunities'));
  assert.match(md, /\*\*PERF-0b3e\*\* · Images are not lazy-loaded · ⚠ new · unverified/);
  assert.match(md, /~~HOST-12aa~~/);
  assert.match(md, /content-conversion: failed — no output/);
});

test('titles with line breaks stay on one line', () => {
  const doc = sampleDoc();
  doc.findings[0].title = 'Secrets\ncommitted';
  assert.match(renderChecklist(doc), /\*\*SEC-a91c\*\* · Secrets committed/);
});

test('ticks survive CRLF, [X], * bullets, BOM, reordering and notes (review focus 3)', () => {
  const md = '\uFEFF# Project health\r\n'
    + '* [X] **SEO-1b2c** · edited title · my note\r\n'
    + '  > why\r\n'
    + '- [ ] **SEC-a91c** · moved down\r\n'
    + '   - [x] **AI-4d5e** indented\r\n'
    + 'Some text I added **ARCH-5c10**\r\n'
    + '- ~~HOST-12aa~~ · fixed\r\n';
  const { ticked, unticked } = parseTicks(md);
  assert.deepEqual([...ticked].sort(), ['AI-4d5e', 'SEO-1b2c']);
  assert.deepEqual([...unticked], ['SEC-a91c']);
});

test('a finding ticked anywhere wins over an unticked duplicate line', () => {
  const { ticked, unticked } = parseTicks('- [ ] **SEO-1b2c** a\n- [x] **SEO-1b2c** b\n');
  assert.ok(ticked.has('SEO-1b2c'));
  assert.ok(!unticked.has('SEO-1b2c'));
});

test('resolveSelection keeps doc order, warns on unknown ids, treats missing as unticked', () => {
  const parsed = parseTicks('- [x] **SEO-1b2c** a\n- [x] **SEC-a91c** b\n- [x] **SEO-ffff** c\n');
  const { selected, warnings } = resolveSelection(sampleDoc(), parsed);
  assert.deepEqual(selected, ['SEC-a91c', 'SEO-1b2c']);
  assert.deepEqual(warnings, ['Checklist mentions unknown finding SEO-ffff — ignored.']);
});

test('[-] marks a finding as dismissed; a tick elsewhere still wins', () => {
  const { ticked, unticked, dismissed } = parseTicks('- [-] **SEO-1b2c** a\n- [ ] **SEC-a91c** b\n- [-] **AI-4d5e** c\n- [x] **AI-4d5e** d\n');
  assert.deepEqual([...dismissed], ['SEO-1b2c']);
  assert.deepEqual([...unticked], ['SEC-a91c']);
  assert.deepEqual([...ticked], ['AI-4d5e']);
  const { selected, dismissed: ids } = resolveSelection(sampleDoc(), parseTicks('- [-] **SEO-1b2c** a\n- [x] **SEC-a91c** b\n'));
  assert.deepEqual(selected, ['SEC-a91c']);
  assert.deepEqual(ids, ['SEO-1b2c']);
});

test('findings dismissed earlier stay dismissed, even with --final', () => {
  for (const final of [false, true]) {
    const md = renderChecklist(sampleDoc(), { final, dismissed: new Set(['SEC-a91c']) });
    assert.match(md, /- \[-\] \*\*SEC-a91c\*\*/);
    assert.ok(!parseTicks(md).ticked.has('SEC-a91c'));
  }
});

test('earlier findings that were not re-checked are listed without a checkbox', () => {
  const doc = sampleDoc();
  doc.notRechecked = [{ id: 'SEC-0c5p', area: 'security', title: 'No CSP header', reason: 'needs the live site, which this run did not check' }];
  const md = renderChecklist(doc);
  assert.match(md, /## Not re-checked this run\n\n- SEC-0c5p · No CSP header — needs the live site/);
  assert.ok(!parseTicks(md).unticked.has('SEC-0c5p'));
});
