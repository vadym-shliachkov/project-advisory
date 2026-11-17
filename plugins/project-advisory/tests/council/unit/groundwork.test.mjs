import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, readJson } from '../helpers.mjs';
import { isFresh, saveGroundwork, loadGroundwork, groundworkPath, reusable, parseRefresh, cachedLook, cacheLook, lookCacheDir, FRESH_DAYS } from '../../../skills/council/scripts/lib/groundwork.mjs';
import { validatePrimer } from '../../../skills/council/scripts/lib/primer.mjs';
import { priorArtErrors } from '../../../skills/council/scripts/lib/record.mjs';
import { today } from '../../../skills/council/scripts/lib/bank.mjs';
import { ideaLine } from '../../../skills/council/scripts/lib/ideas.mjs';
import { init, next, status, evidence, primer, context, close, digest } from '../../../skills/council/scripts/commands.mjs';
import { resolveSession } from '../../../skills/council/scripts/lib/session.mjs';
import { loadEvidence } from '../../../skills/council/scripts/lib/evidence.mjs';

const stdin = (data) => ({ stdin: () => JSON.stringify(data) });
const daysAgo = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const URL_ = 'https://acme.test';

const PRIMER = {
  trade: 'Small studios that build websites and internal tools for service firms, sold by the project after a call.',
  buyers: [{ who: 'Owners of professional service firms', job: 'Win more of the right clients without hiring a marketer.', howTheyBuy: 'Ask peers first, then compare two or three studios on past work.' }],
  economics: 'A first project is usually a fixed price; the margin is in the follow-on work, which most studios never sell.',
  commodity: ['A brochure website built on a common platform'],
  scarce: ['A studio that can show results measured after launch'],
  playbook: ['Publish case studies with numbers', 'Package a fixed-price first offer', 'Ask past clients for reviews', 'List the studio in directories', 'Write a downloadable guide'],
};
const SOURCES = [1, 2, 3].map((n) => ({ grade: 'observed', source: `https://example.org/report-${n}`, date: '2026-09-14', text: `A survey of studio buyers, finding number ${n}, says peers decide.` }));

// A session in the evidence phase, with the evidence collected.
function atEvidence(root, opts = {}) {
  init({ root, url: URL_ });
  next({ root });
  return evidence({ root, collect: true, ...opts });
}
// Ends the current session so another can start.
function finish(root) {
  close({ root, abandon: true, reason: 'test' });
}

test('groundwork is fresh within its window, for the same site only', () => {
  const record = { at: daysAgo(3), url: 'https://www.acme.test/' };
  assert.equal(isFresh('competitors', record, { url: 'https://acme.test' }), true);
  assert.equal(isFresh('competitors', record, { url: 'https://other.test' }), false, 'another site is not this research');
  assert.equal(isFresh('horizon', { ...record, at: daysAgo(FRESH_DAYS.horizon + 1) }, { url: URL_ }), false);
  assert.equal(isFresh('primer', { ...record, at: daysAgo(FRESH_DAYS.primer + 1) }, { url: URL_ }), false);
  assert.equal(isFresh('primer', null, { url: URL_ }), false);
  assert.deepEqual(parseRefresh('competitors, looks'), ['competitors', 'looks']);
  assert.throws(() => parseRefresh('rivals'), /Unknown --refresh "rivals"/);
});

test('what the competitor analyst and the horizon scan find is kept, and the next session reuses it', () => {
  const root = tmpDir();
  atEvidence(root);
  assert.equal(evidence({ root, role: 'competitors' }, stdin({ evidence: [{ grade: 'observed', source: 'https://rival.test/work', text: 'Rival shows twelve case studies, each with a named client.' }] })).ok, true);
  assert.equal(evidence({ root, role: 'horizon' }, stdin({ evidence: [{ grade: 'observed', source: 'https://example.org/trend', date: '2026-10-01', text: 'Buyers now ask an assistant first. For this business: be quotable.' }] })).ok, true);
  const kept = loadGroundwork(root, 'competitors');
  assert.deepEqual([kept.at, kept.url, kept.by.skill, kept.entries.length, kept.entries[0].id], [today(), URL_, 'council', 1, undefined]);
  finish(root);

  const collected = atEvidence(root);
  assert.deepEqual(collected.reused.map((r) => r.kind).sort(), ['competitors', 'horizon']);
  const s = status({ root });
  assert.deepEqual(s.turns.filter((t) => !t.done).map((t) => t.role), ['primer'], 'only the primer, never written, is still to do');
  assert.ok(s.turns.find((t) => t.role === 'competitors').reused);
  assert.match(s.next, /Reused from an earlier session: (competitors|horizon) from \d{4}-\d{2}-\d{2}/);
  const entries = loadEvidence(resolveSession(root).dir).entries.filter((e) => e.reusedFrom);
  assert.deepEqual(entries.map((e) => e.by).sort(), ['competitors', 'horizon']);
  assert.ok(entries.every((e) => /^E\d+$/.test(e.id) && /^council \d{4}-\d{2}-\d{2}/.test(e.reusedFrom)), 'reused entries get ids of this session');
  finish(root);

  // Asked to be done again, it is not reused.
  const again = atEvidence(root, { refresh: 'competitors' });
  assert.deepEqual(again.reused.map((r) => r.kind), ['horizon']);
  assert.equal(status({ root }).turns.find((t) => t.role === 'competitors').done, false);
});

test('stale groundwork is not reused', () => {
  const root = tmpDir();
  saveGroundwork(root, 'competitors', { session: { id: '2026-01-01', url: URL_ }, entries: [{ grade: 'observed', source: 'https://rival.test', text: 'An old observation of a rival.', by: 'competitors' }], date: daysAgo(FRESH_DAYS.competitors + 2) });
  assert.deepEqual(reusable(root, { url: URL_ }), []);
  assert.deepEqual(atEvidence(root).reused, []);
});

test('the primer learns how the trade works, rests on pages, and is in what every member reads', () => {
  const root = tmpDir();
  atEvidence(root);
  const text = context({ root, role: 'primer', save: true });
  assert.ok(text.startsWith('# The domain primer'));
  assert.match(text, /primer --root/);
  const material = readJson(path.join(resolveSession(root).dir, 'in', 'primer.json'));
  assert.deepEqual([material.refresh, material.previous], [false, null]);

  const few = primer({ root }, stdin({ primer: PRIMER, evidence: SOURCES.slice(0, 2) }));
  assert.match(few.errors.join('\n'), /at least three pages/);
  const thin = primer({ root }, stdin({ primer: { ...PRIMER, playbook: ['Publish case studies with numbers'] }, evidence: SOURCES }));
  assert.match(thin.errors.join('\n'), /\$\.primer\.playbook: 5 to 20 lines/);
  const unsourced = primer({ root }, stdin({ primer: PRIMER, evidence: SOURCES.map((s) => ({ ...s, source: 'general knowledge' })) }));
  assert.match(unsourced.errors.join('\n'), /a fact about the trade needs the address of the page/);

  const saved = primer({ root }, stdin({ primer: PRIMER, evidence: SOURCES }));
  assert.deepEqual([saved.ok, saved.refreshed, saved.added.length], [true, false, 3]);
  assert.equal(status({ root }).turns.find((t) => t.role === 'primer').done, true);
  const kept = readJson(groundworkPath(root, 'primer'));
  assert.deepEqual([kept.primer.playbook.length, kept.entries.length], [5, 3]);
  const md = digest({ root });
  assert.match(md, /## How this trade works\n\nWritten \d{4}-\d{2}-\d{2} by a council session/);
  assert.match(md, /## The playbook of this trade\n\nWhat any adviser would tell any firm in this trade[^\n]*\n\n- Publish case studies with numbers/);
});

test('a primer older than a week is refreshed from the one before, and says what changed', () => {
  const root = tmpDir();
  saveGroundwork(root, 'primer', { session: { id: '2026-01-01', url: URL_ }, entries: SOURCES.map((s) => ({ ...s, by: 'primer' })), primer: PRIMER, date: daysAgo(FRESH_DAYS.primer + 1) });
  atEvidence(root);
  assert.equal(status({ root }).turns.find((t) => t.role === 'primer').done, false);
  context({ root, role: 'primer', save: true });
  const material = readJson(path.join(resolveSession(root).dir, 'in', 'primer.json'));
  assert.equal(material.refresh, true);
  assert.equal(material.previous.primer.trade, PRIMER.trade);
  assert.match(primer({ root }, stdin({ primer: PRIMER, evidence: SOURCES.slice(0, 1) })).errors.join('\n'), /\$\.primer\.changed: what changed since the primer before/);
  const saved = primer({ root }, stdin({ primer: { ...PRIMER, changed: ['A new accessibility law applies to buyers from next spring.'] }, evidence: [{ ...SOURCES[0], source: 'https://example.org/new-law', text: 'A new accessibility law applies to these buyers from next spring.' }] }));
  assert.deepEqual([saved.ok, saved.refreshed], [true, true]);
  assert.equal(loadGroundwork(root, 'primer').entries.length, 4, 'a refresh keeps the sources it rests on, with the new one');
  assert.match(digest({ root }), /\*\*Changed since the primer before\*\*\n- A new accessibility law/);
});

test('the primer checks its own shape', () => {
  assert.deepEqual(validatePrimer(PRIMER), []);
  assert.match(validatePrimer({ ...PRIMER, buyers: [] }).join('\n'), /one to six kinds of buyer/);
  assert.match(validatePrimer({ ...PRIMER, extra: 1 }).join('\n'), /unknown property "extra"/);
  assert.match(validatePrimer({ ...PRIMER, changed: [] }).join('\n'), /only a refresh/);
});

test('every idea says what was found when it was looked for elsewhere', () => {
  const known = new Set(['E1']);
  assert.match(priorArtErrors(undefined, '$.p').join('\n'), /say what you found when you looked for this idea elsewhere/);
  assert.deepEqual(priorArtErrors({ exists: 'no', searched: 'Searched rival sites and two directories' }, '$.p', known), []);
  const found = priorArtErrors({ exists: 'partly', searched: 'Searched rival sites and two directories' }, '$.p', known).join('\n');
  assert.match(found, /\$\.p\.who/);
  assert.match(found, /\$\.p\.difference/);
  assert.match(found, /\$\.p\.evidence: the evidence ids of what you found/);
  assert.match(priorArtErrors({ exists: 'yes', searched: 'Searched rival sites', who: 'A rival studio', outcome: 'It sells this as a package', difference: 'Ours is for law firms, which the rival does not serve', evidence: ['E9'] }, '$.p', known).join('\n'), /there is no evidence E9/);
  assert.match(priorArtErrors({ exists: 'maybe', searched: 'Searched rival sites' }, '$.p').join('\n'), /yes \(someone already does this\)/);
});

test('a picture of a page taken in the last week is used again, with the date it was taken', () => {
  const root = tmpDir();
  const shot = path.join(tmpDir(), 'acme-test-desktop.png');
  fs.writeFileSync(shot, 'png');
  const taken = new Date(Date.now() - 2 * 86400000);
  fs.utimesSync(shot, taken, taken);
  cacheLook(root, shot);
  assert.ok(fs.existsSync(path.join(lookCacheDir(root), 'acme-test-desktop.png')));
  const target = path.join(tmpDir(), 'looks', 'acme-test-desktop.png');
  const kept = cachedLook(root, target);
  assert.deepEqual([kept.taken, fs.readFileSync(target, 'utf8')], [taken.toISOString().slice(0, 10), 'png']);
  assert.equal(fs.statSync(target).mtime.toISOString().slice(0, 10), kept.taken, 'the copy keeps the date it was taken');
  const old = new Date(Date.now() - 9 * 86400000);
  fs.utimesSync(path.join(lookCacheDir(root), 'acme-test-desktop.png'), old, old);
  assert.equal(cachedLook(root, target), null);
});

test('an idea that reached further than the council could test is marked for the invention lab in the ledger', () => {
  const base = { id: 'I4', title: 'A product built from client work', proposedBy: 'outsider', status: 'killed', verdict: { causeOfDeath: 'Nothing on the site could show it' }, history: [] };
  assert.match(ideaLine({ ...base, labCandidate: true }), /worth taking to the invention lab/);
  assert.doesNotMatch(ideaLine(base), /invention lab/);
  assert.match(ideaLine({ ...base, origin: 'lab' }), /{from the invention lab}/);
});
