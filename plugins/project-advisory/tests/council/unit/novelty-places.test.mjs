import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, readJson } from '../helpers.mjs';
import { createSession, resolveSession, proposers, spendRun } from '../../../skills/council/scripts/lib/session.mjs';
import { loadRecord, say as saySaved, saveDocket, advance, turns } from '../../../skills/council/scripts/lib/record.mjs';
import { loadEvidence } from '../../../skills/council/scripts/lib/evidence.mjs';
import { loadVerdicts } from '../../../skills/council/scripts/lib/verdict.mjs';
import { buildModel, validateSuggestions } from '../../../skills/council/scripts/lib/documents.mjs';
import { takePictures, renderDocs } from '../../../skills/council/scripts/lib/flow.mjs';
import { rich } from '../../../skills/council/scripts/lib/html.mjs';
import { digest } from '../../../skills/council/scripts/lib/digest.mjs';
import { init, status, next, evidence, context, say, verdict, save, fact, shots } from '../../../skills/council/scripts/commands.mjs';

process.env.COUNCIL_NO_BROWSER = '1';

const stdin = (data) => ({ stdin: () => JSON.stringify(data) });
const LONG = 'which is said here at enough length to be a real statement';
const errorOf = (r) => (r.errors ?? r).join('\n');
const ok = (r) => { assert.deepEqual(r.errors, []); return r; };

const PLACE = { url: 'https://acme.test/services', part: 'the list of services under the first heading', text: 'What we do' };
const hyp = (n, extra = {}) => ({
  type: 'hypothesis', title: `Idea ${n}: a case study on the services page`, effort: 'small', scale: 'new',
  hypothesis: {
    change: `Publish case study number ${n} with the client's results`,
    effect: 'More enquiries from the services pages, about two a month',
    because: 'Visitors who see proof for their own industry are more likely to write',
    trigger: 'The services page had 310 views and nobody went on to the contact page',
    killCondition: 'No change in contact-page visits from the services pages after six weeks',
  },
  test: { what: 'Publish one case study and compare contact-page visits', metric: 'contact-page visits', threshold: '20 a month', checkAfter: 'six weeks' },
  ...extra,
});
const second = (n, extra = {}) => hyp(n, { title: `Idea ${n}: a new offer nobody on the table named`, uncovered: 'No idea on the table reaches buyers before they start looking for a supplier.', ...extra });

// A session in memory at the first pass of the proposals.
function proposing(opts = {}) {
  const root = tmpDir();
  const { dir, session } = createSession(root, { date: '2026-11-15', ...opts });
  const ctx = { root, dir, session, record: loadRecord(dir), evidence: { entries: [{ id: 'E1', grade: 'observed', source: 'https://acme.test/', date: '2026-11-15', text: 'Observation number one', by: 'probe' }], data: [], missing: [], collectedAt: 'now' }, verdicts: loadVerdicts(dir) };
  for (let n = 0; n < 3; n++) ok(advance(ctx));
  assert.deepEqual([ctx.session.phase, ctx.session.step], ['propose', 'first']);
  return ctx;
}

// ---- Two passes ----

test('proposals come in two passes: alone first, then each seat on ground none of the ideas on the table covers', () => {
  const ctx = proposing();
  assert.ok(turns(ctx.session, ctx.record).every((t) => t.model === 'strongest'), 'every proposer runs on the strongest model while it proposes');
  assert.match(errorOf(saySaved(ctx, 'content', [hyp(8, { uncovered: 'Said in the first pass, where it has no place.' })])), /.uncovered: only an idea of the second pass/);
  proposers(ctx.session).forEach((role, n) => ok(saySaved(ctx, role, [hyp(n + 1)])));
  ok(advance(ctx));
  assert.deepEqual([ctx.session.phase, ctx.session.step], ['propose', 'second']);
  assert.ok(turns(ctx.session, ctx.record).every((t) => !t.done), 'every proposer has a turn again');

  assert.match(errorOf(saySaved(ctx, 'search', [])), /The second pass asks for at least 1 idea on ground none of the ideas on the table covers/);
  assert.match(errorOf(saySaved(ctx, 'search', [second(7, { scale: 'adjustment', where: [PLACE] })])), /\.scale: in the second pass an idea is new or a direction/);
  assert.match(errorOf(saySaved(ctx, 'search', [hyp(7, { title: 'Idea 7: something else entirely' })])), /\.uncovered: in one or two sentences/);
  assert.match(errorOf(saySaved(ctx, 'search', [second(7), second(8, { title: 'Idea 8: a second new offer' }), second(9, { title: 'Idea 9: a third new offer' })])), /At most 2 ideas in the second pass/);
  ok(saySaved(ctx, 'search', [second(7)]));
  const t = ctx.record.threads.at(-1);
  assert.equal(t.pass, 2);
  assert.match(ctx.record.statements.at(-1).uncovered, /No idea on the table reaches buyers/);

  // The usher may go on without a seat that fails twice; then the docket.
  assert.match(errorOf(advance(ctx)), /have not taken their turn/);
  ok(advance(ctx, { force: true }));
  assert.equal(ctx.session.phase, 'docket');
});

test('the second pass is skipped when the debate has spent its runs', () => {
  const ctx = proposing();
  proposers(ctx.session).forEach((role, n) => ok(saySaved(ctx, role, [hyp(n + 1)])));
  ctx.session.runs = 48;
  ok(advance(ctx));
  assert.equal(ctx.session.phase, 'docket');
});

test('a seat in the second pass sees the themes on the table, not who proposed them', () => {
  const root = tmpDir();
  const o = { root };
  init({ root, url: 'https://acme.test' });
  next(o);
  evidence({ root, collect: true });
  next(o); next(o);
  ['client', 'search', 'content', 'conversion', 'competitors', 'outsider'].forEach((role, n) => assert.equal(say({ root, role }, stdin({ statements: [hyp(n + 1)] })).ok, true));
  assert.match(status(o).next, /Run "next" for the second pass/);
  next(o);
  const text = context({ root, role: 'content' });
  assert.match(text, /## This turn: the second pass/);
  assert.match(text, /## Not the playbook/);
  const file = /Your material for this turn: (.+propose2-content\.json)/.exec(text)[1];
  const { taken } = readJson(file);
  assert.equal(taken.length, 6);
  assert.deepEqual(Object.keys(taken[0]).sort(), ['change', 'scale', 'title', 'yours']);
  assert.equal(taken.filter((x) => x.yours).length, 1, 'its own idea is marked');
  assert.ok(!JSON.stringify(taken).includes('Sir Barnaby'), 'no names');
});

// ---- Fresh or familiar ----

test('the docket marks every admitted idea fresh or familiar, and the ledger keeps the mark and the places', () => {
  const ctx = proposing();
  ok(saySaved(ctx, 'search', [hyp(1, { scale: 'adjustment', where: [PLACE] }), hyp(2)]));
  ok(advance(ctx, { force: true }));
  ok(advance(ctx, { force: true }));
  assert.equal(ctx.session.phase, 'docket');
  assert.match(errorOf(saveDocket(ctx, { admitted: [{ thread: 'T1' }, { thread: 'T2', novelty: 'new' }] }, { ideas: [] })), /\[0\]\.novelty: "fresh" when .*\n.*\[1\]\.novelty/);
  const r = ok(saveDocket(ctx, { admitted: [{ thread: 'T1', novelty: 'familiar' }, { thread: 'T2', novelty: 'fresh' }] }, { ideas: [] }));
  assert.deepEqual(r.ideas.map((i) => [i.novelty, i.where]), [['familiar', [PLACE]], ['fresh', undefined]]);
  assert.equal(ctx.record.threads[1].novelty, 'fresh');
});

// ---- The horizon scan ----

test('the horizon scan looks outside the site before anyone proposes; an opening needs the page that reports it', () => {
  const root = tmpDir();
  const o = { root };
  init({ root, url: 'https://acme.test' });
  next(o);
  evidence({ root, collect: true });
  const listed = status(o).turns;
  assert.deepEqual(listed.map((t) => [t.role, t.optional]), [['competitors', true], ['horizon', true]]);
  assert.match(status(o).next, /Start the competitor analyst and the horizon scan, at once/);
  const text = context({ root, role: 'horizon', save: true });
  assert.match(text, /^# The horizon scan/);
  assert.match(text, /evidence --role horizon/);
  assert.match(text, /What is known about the project/);
  assert.match(errorOf(evidence({ root, role: 'horizon' }, stdin({ evidence: [{ grade: 'argued', text: 'Buyers are said to be moving to AI assistants for this.' }] }))), /an opening needs the address of the page that reports it/);
  assert.equal(evidence({ root, role: 'horizon' }, stdin({ evidence: [{ grade: 'observed', source: 'https://example.org/report', date: '2026-09-14', text: 'Most buyers now ask an assistant first. For this business: it must be quotable.' }] })).ok, true);
  assert.equal(status(o).turns.find((t) => t.role === 'horizon').done, true);
  const added = loadEvidence(resolveSession(root).dir).entries.at(-1);
  assert.deepEqual([added.by, added.date], ['horizon', '2026-09-14']);
});

test('what the person already has in mind is in the digest every member reads', () => {
  const root = tmpDir();
  assert.match(digest(root), /## What the person already has in mind\n\nNone recorded yet\./);
  fact({ root, key: 'owner.considered', value: 'A newsletter and a new logo' });
  assert.match(digest(root), /`owner\.considered`: A newsletter and a new logo \(said by a person/);
});

// ---- Places, links and pictures in the documents ----

// A finished debate: T1 (search, an adjustment on the services page) survived; T2 (search, a new offer) was killed
// as a bet; T3 (outsider, a direction) survived in a smaller form on another page; T4 (outsider) was merged into T2.
function finished() {
  const root = tmpDir();
  const o = { root };
  const { dir } = init({ root, url: 'https://acme.test' });
  next(o);
  evidence({ root, collect: true });
  evidence({ root, role: 'search' }, stdin({ evidence: [{ grade: 'observed', source: 'https://acme.test/services', text: 'The services page had 310 views in October and no link to the contact page' }] }));
  next(o); next(o);
  assert.equal(say({ root, role: 'search' }, stdin({ statements: [hyp(1, { scale: 'adjustment', where: [PLACE], evidence: ['E1'] }), hyp(2)] })).ok, true);
  assert.equal(say({ root, role: 'outsider' }, stdin({ statements: [hyp(3, { scale: 'direction', where: [{ url: 'https://acme.test/', part: 'the first screen of the home page', text: 'Welcome' }] }), hyp(4)] })).ok, true);
  next({ ...o, force: true });
  next({ ...o, force: true });
  assert.equal(verdict({ root, stage: 'docket' }, stdin({ admitted: [{ thread: 'T1', novelty: 'familiar' }, { thread: 'T2', merge: ['T4'], novelty: 'fresh' }, { thread: 'T3', novelty: 'fresh' }] })).ok, true);
  next(o);
  say({ root, role: 'red-team' }, stdin({ statements: [] }));
  assert.equal(next({ ...o, force: true }).to.phase, 'verdict');
  const vs = 'The services pages lose visitors today, so waiting costs enquiries';
  const smaller = { url: 'https://acme.test/about', part: 'the paragraph under Our story', text: 'Our story' };
  assert.equal(verdict({ root, stage: 'verdict' }, stdin({ rulings: [
    { thread: 'T1', verdict: 'survived', strength: 'fair', vsDoNothing: vs, reason: `Nobody attacked it, ${LONG}` },
    { thread: 'T2', verdict: 'killed', reason: `The first step could show nothing, ${LONG}`, causeOfDeath: 'Its first step could not tell interest from politeness' },
    { thread: 'T3', verdict: 'narrowed', strength: 'speculative', vsDoNothing: vs, reason: `Only the story page stands, ${LONG}`, narrowed: { title: 'Retell the story on the about page', change: 'Retell the company story on the about page', effect: 'One more enquiry a month from the about page', scale: 'adjustment', where: [smaller] } },
  ] })).ok, true);
  assert.equal(next(o).to.phase, 'set');
  verdict({ root, stage: 'set', role: 'red-team' }, stdin({ notes: [] }));
  assert.equal(next(o).to.phase, 'write');
  const ctx = () => { const { session } = resolveSession(root); return { dir, session, record: loadRecord(dir), evidence: loadEvidence(dir), verdicts: loadVerdicts(dir) }; };
  return { root, o, dir, smaller, ctx, model: () => buildModel(ctx(), root) };
}

const survivor = (idea, extra = {}) => ({
  idea, sentence: 'Add one case study under the list of services on [the services page](https://acme.test/services) so that more visitors write.',
  comesFrom: 'The services page had 310 views in October and no link to the contact page.',
  expected: 'Contact-page visits from the services pages reach 20 a month within six weeks.',
  why: 'Buyers who see proof for their own industry are more likely to write.',
  survived: [{ attack: 'The views may be the staff of the company itself.', answer: 'Staff visits are filtered out of that count.' }],
  uncertain: ['Whether visitors read a case study at all on this page.'],
  test: 'Publish one case study and compare contact-page visits; 20 a month counts as working.',
  killCondition: 'No change in contact-page visits after six weeks.', firstStep: 'Pick the client whose results may be published.',
  fromYou: ['Decide which client may be named on the page.'], ...extra,
});
const writeUp = (ids) => ({
  summary: 'The session looked for ways to bring more enquiries. Two ideas survived, neither on a measured number, so each is a test to run and not a result.',
  plan: [{ text: 'Start with the services page: it needs nothing but a yes.', ideas: [ids.services] }],
  survivors: [survivor(ids.services), survivor(ids.about, { sentence: 'Retell the company story in the paragraph under Our story on [the about page](https://acme.test/about).' })],
  bets: [{ idea: ids.bet, sentence: 'Sell the first case study as a product of its own, apart from the site work.', worthIt: 'Worth trying if the next five people who write are asked whether they would buy it.' }],
  questions: [],
});

test('a narrowed idea that moved keeps its new place; the bold idea that fell is a bet, not a grave', () => {
  const d = finished();
  const m = d.model();
  const byThread = Object.fromEntries(m.ideas.map((i) => [i.thread, i]));
  assert.deepEqual(byThread.T1.where, [PLACE]);
  assert.deepEqual(byThread.T3.where, [d.smaller], 'the smaller form applies where the judge put it');
  assert.deepEqual(m.bets.map((i) => i.thread), ['T2']);
  assert.equal(m.fresh, 2);
});

test('the writer links the page each survivor changes, only to pages the session looked at, and reports every bet', () => {
  const d = finished();
  const m = d.model();
  const ids = { services: m.ideas.find((i) => i.thread === 'T1').id, about: m.ideas.find((i) => i.thread === 'T3').id, bet: m.ideas.find((i) => i.thread === 'T2').id };
  assert.deepEqual(validateSuggestions(writeUp(ids), m), []);
  const unlinked = writeUp(ids);
  unlinked.survivors[0].sentence = 'Add one case study under the list of services on the services page so that more visitors write.';
  assert.match(errorOf(validateSuggestions(unlinked, m)), /\[0\]: link the page this idea changes where you first name it.*https:\/\/acme\.test\/services/);
  const invented = writeUp(ids);
  invented.survivors[0].why = 'Buyers who see proof are more likely to write, as [a study](https://elsewhere.test/study-2024) shows.';
  assert.match(errorOf(validateSuggestions(invented, m)), /the link to https:\/\/elsewhere\.test\/study-2024 is to a page nobody in the session looked at/);
  const sitePage = writeUp(ids);
  sitePage.survivors[0].firstStep = 'Pick a client from [the work page](https://www.acme.test/work/).';
  assert.deepEqual(validateSuggestions(sitePage, m), [], 'any page of the site may be linked, and the address counts for neither length nor numbers');
  const noBets = writeUp(ids);
  delete noBets.bets;
  assert.match(errorOf(validateSuggestions(noBets, m)), /\$\.bets: one entry for each bold idea that did not survive/);
  assert.match(errorOf(validateSuggestions({ ...writeUp(ids), bets: [] }, m)), /is missing: every bold idea that fell is reported/);
  assert.equal(rich('Open [the page](https://acme.test/a?b=1&c=2) now'), 'Open <a href="https://acme.test/a?b=1&amp;c=2">the page</a> now');
});

test('the places are photographed after the verdicts; the documents show each part, outlined, with its link', async () => {
  const d = finished();
  const m = d.model();
  const ids = { services: m.ideas.find((i) => i.thread === 'T1').id, about: m.ideas.find((i) => i.thread === 'T3').id, bet: m.ideas.find((i) => i.thread === 'T2').id };
  assert.deepEqual(save({ root: d.root, doc: 'suggestions' }, stdin(writeUp(ids))).errors, undefined);
  assert.match(status(d.o).next, /^Run "shots"/);

  // Without a browser nothing is photographed and the documents link the pages.
  const plain = await shots({ root: d.root });
  assert.equal(plain.ok, true);
  assert.match(plain.warnings[0], /no place was photographed/);

  // With one, each place becomes a picture; a part that is not on the page is said to be missing.
  const asked = [];
  const shoot = async (browser, jobs) => jobs.flatMap((job) => job.parts.map((p) => { asked.push([job.url, p.text]); fs.mkdirSync(path.dirname(p.file), { recursive: true }); fs.writeFileSync(p.file, 'png'); return { key: p.key, file: p.file, found: p.text !== 'Our story', how: 'text' }; }));
  const ctx = d.ctx();
  const r = await takePictures(ctx, d.root, { browser: 'chrome', shoot });
  ok(r);
  assert.deepEqual(asked.sort(), [['https://acme.test/about', 'Our story'], ['https://acme.test/services', 'What we do']], 'the smaller form is photographed where it now applies, and an idea off the site is not');
  assert.deepEqual([r.places, r.taken, r.notFound], [2, 2, 1]);
  assert.match(r.warnings.join('\n'), /"the paragraph under Our story" was not found on https:\/\/acme\.test\/about/);
  const parts = readJson(path.join(d.dir, 'parts.json'));
  assert.deepEqual(parts.places.map((p) => [p.key, p.file, p.found]), [['T1-1', 'parts/T1-1.png', true], ['T3-1', 'parts/T3-1.png', false]]);

  const out = renderDocs(ctx, d.root, { only: 'suggestions', html: true });
  ok(out);
  const html = fs.readFileSync(out.documents.suggestions.html, 'utf8');
  for (const part of [
    '<h5>Where</h5>', '<img src="parts/T1-1.png" alt="the list of services under the first heading, outlined, on acme.test/services">',
    '<a href="https://acme.test/services">acme.test/services</a> · the list of services under the first heading, seen',
    'This part was not found on the page when it was photographed; the top of the page is shown.',
    '<a href="https://acme.test/services">the services page</a>',
    '<h2 class="group">Improvements to what is there</h2>', 'Bold ideas the council could not prove', 'Worth trying if the next five people',
    'tag-fresh">fresh', '<b>2</b> fresh',
  ]) assert.ok(html.includes(part), part);
  assert.ok(!html.includes('<table class="killed">'), 'the bet is not listed again among the dead');
});

test('the documents are not printed before the places are photographed, unless the usher says so', () => {
  const d = finished();
  const m = d.model();
  const ids = { services: m.ideas.find((i) => i.thread === 'T1').id, about: m.ideas.find((i) => i.thread === 'T3').id, bet: m.ideas.find((i) => i.thread === 'T2').id };
  assert.deepEqual(save({ root: d.root, doc: 'suggestions' }, stdin(writeUp(ids))).errors, undefined);
  fs.writeFileSync(path.join(d.dir, 'discussion.json'), '{}');
  const refused = next({ root: d.root });
  assert.equal(refused.ok, false);
  assert.match(errorOf(refused), /have not been photographed: run "shots" first/);
});
