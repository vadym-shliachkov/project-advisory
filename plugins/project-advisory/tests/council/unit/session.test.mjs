import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, readJson } from '../helpers.mjs';
import { createSession, resolveSession, loadSession, saveSession, listSessions, spendRun, budgetOf, proposers, takeTurn, DEFAULT_GOAL, PHASES } from '../../../skills/council/scripts/lib/session.mjs';
import { collectEvidence, addEvidence, dataInventory, loadEvidence } from '../../../skills/council/scripts/lib/evidence.mjs';
import { loadRecord, say, saveDocket, advance, assignAttackers, turns, thread, openThreads, nextStep } from '../../../skills/council/scripts/lib/record.mjs';
import { loadVerdicts } from '../../../skills/council/scripts/lib/verdict.mjs';
import { loadIdeas } from '../../../skills/council/scripts/lib/ideas.mjs';
import { fact, ideas as ideaSave, init as councilInit, status as councilStatus, next as councilNext, evidence as councilEvidence, say as councilSay, verdict as councilVerdict, COMMANDS } from '../../../skills/council/scripts/commands.mjs';

const stdin = (data) => ({ stdin: () => JSON.stringify(data) });
const LONG = 'which is said here at enough length to be a real statement';

const hyp = (n, extra = {}) => ({
  type: 'hypothesis', priorArt: { exists: 'no', searched: 'Searched for case studies of this kind on rival sites' }, title: `Idea ${n}: a case study on the services page`, effort: 'small', scale: 'new',
  hypothesis: {
    change: `Publish case study number ${n} with the client's results`,
    effect: 'More enquiries from the services pages, about two a month',
    because: 'Visitors who see proof for their own industry are more likely to write',
    trigger: 'The services pages get visits but nobody goes on to the contact page',
    killCondition: 'No change in contact-page visits from the services pages after six weeks',
  },
  test: { what: 'Publish one case study and compare contact-page visits', metric: 'contact-page visits', threshold: '20 a month', checkAfter: 'six weeks' },
  ...extra,
});

// A session in memory, with five pieces of evidence to cite.
function session(opts = {}) {
  const root = tmpDir();
  const { dir, session: s } = createSession(root, { date: '2026-11-15', ...opts });
  const evidence = { entries: [1, 2, 3, 4, 5].map((n) => ({ id: `E${n}`, grade: 'observed', source: 'https://acme.test/', date: '2026-11-15', text: `Observation number ${n}`, by: 'probe' })), data: [], missing: [], collectedAt: 'now' };
  return { root, dir, session: s, record: loadRecord(dir), evidence, verdicts: loadVerdicts(dir) };
}
const ok = (r) => { assert.deepEqual(r.errors, []); return r; };
const move = (ctx, opts) => ok(advance(ctx, opts));
const errorOf = (r) => r.errors.join('\n');

// Every proposer proposes `each` ideas; the session ends in the docket phase.
function proposed(each = 1, opts) {
  const ctx = session(opts);
  move(ctx); move(ctx); move(ctx);
  assert.equal(ctx.session.phase, 'propose');
  let n = 0;
  for (const role of proposers(ctx.session)) ok(say(ctx, role, Array.from({ length: each }, () => hyp(++n))));
  move(ctx);
  move(ctx, { force: true });
  assert.equal(ctx.session.phase, 'docket');
  return ctx;
}

// All ideas admitted; the session is in round one, waiting for the attackers.
function examining(each = 1, opts) {
  const ctx = proposed(each, opts);
  ok(saveDocket(ctx, { admitted: ctx.record.threads.map((t) => ({ thread: t.id, novelty: 'familiar' })) }, { ideas: [] }));
  move(ctx);
  assert.deepEqual([ctx.session.phase, ctx.session.round, ctx.session.step], ['examine', 1, 'attack']);
  return ctx;
}

const steelman = (t) => ({ type: 'steelman', thread: t, text: `In its strongest form, ${t} says that proof brings enquiries, ${LONG}` });
const attack = (t, extra = {}) => ({ type: 'attack', thread: t, kind: 'evidence', text: `The numbers behind ${t} read another way, ${LONG}`, ...extra });
const reply = (ctx, t, extra = {}) => ({
  type: 'reply', thread: t, stance: 'refute', text: `The attack on ${t} misses the point, ${LONG}`,
  to: ctx.record.statements.filter((s) => s.thread === t && s.round === ctx.session.round && ['attack', 'client'].includes(s.type)).map((s) => s.n), ...extra,
});

// Round one on thread T1 (proposed by the client): the red team attacks, the proposer refutes; then round two opens.
function roundTwo(ctx = examining()) {
  ok(say(ctx, 'red-team', [steelman('T1'), attack('T1', { evidence: ['E1'] })]));
  move(ctx, { force: true });
  assert.equal(ctx.session.step, 'reply');
  ok(say(ctx, 'client', [reply(ctx, 'T1')]));
  move(ctx, { force: true });
  assert.deepEqual([ctx.session.round, ctx.session.step], [2, 'attack']);
  return ctx;
}

// ---- Sessions ----

test('a session gets the date as its id, the default cast, and its folder is ignored by git', () => {
  const root = tmpDir();
  const { dir, session: s } = createSession(root, { date: '2026-11-15' });
  assert.equal(s.id, '2026-11-15');
  assert.equal(dir, path.join(root, '.project-health', 'council', '2026-11-15'));
  assert.deepEqual([s.phase, s.runs, s.budget, s.closing], ['open', 0, 60, false]);
  assert.equal(s.cast.length, 9);
  assert.deepEqual(proposers(s), ['client', 'search', 'content', 'conversion', 'competitors', 'outsider']);
  assert.equal(fs.readFileSync(path.join(root, '.project-health', '.gitignore'), 'utf8'), 'runs/\nprofile.json\nlatest.json\ncouncil/\nventure/\nlab/\nstudio/\ncache/\nideas.html\n');
});

test('an existing .gitignore gains the council line once, and keeps what it had', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, '.project-health'));
  fs.writeFileSync(path.join(root, '.project-health', '.gitignore'), 'runs/\nprofile.json\nlatest.json');
  const { dir, session: s } = createSession(root, { date: '2026-11-15' });
  saveSession(dir, { ...s, phase: 'done' });
  createSession(root, { date: '2026-11-15' });
  assert.equal(fs.readFileSync(path.join(root, '.project-health', '.gitignore'), 'utf8'), 'runs/\nprofile.json\nlatest.json\ncouncil/\nventure/\nlab/\nstudio/\ncache/\nideas.html\n');
});

test('an unfinished session blocks a new one; a second session on the same day gets -2', () => {
  const root = tmpDir();
  const first = createSession(root, { date: '2026-11-15' });
  assert.throws(() => createSession(root, { date: '2026-11-15' }), /Session 2026-11-15 is not finished \(phase: open\)\. Continue it with --session 2026-11-15/);
  saveSession(first.dir, { ...first.session, phase: 'done' });
  assert.equal(createSession(root, { date: '2026-11-15' }).session.id, '2026-11-15-2');
  assert.deepEqual(listSessions(root), ['2026-11-15', '2026-11-15-2']);
});

test('a session the person does not continue is set aside in any phase, and a new one can start', () => {
  const root = tmpDir();
  const { dir, session: s } = createSession(root, { date: '2026-11-15' });
  saveSession(dir, { ...s, phase: 'examine', round: 1, step: 'attack' });
  const hypothesis = { change: 'Publish one case study with the results', effect: 'More enquiries, about two a month', because: 'Proof for their own industry makes visitors write', killCondition: 'No change in contact-page visits after six weeks' };
  ideaSave({ root, by: 'council', session: '2026-11-15' }, { stdin: () => JSON.stringify({ ideas: [{ title: 'One case study on the services page', proposedBy: 'content', hypothesis }] }) });
  assert.match(COMMANDS.close({ root }).errors[0], /set it aside with --abandon/);
  const out = COMMANDS.close({ root, session: '2026-11-15', abandon: true, reason: 'The goal changed' });
  assert.equal(out.ok, true);
  assert.deepEqual([out.phase, out.ideasSetAside], ['examine', ['I1']]);
  assert.deepEqual(loadSession(root, '2026-11-15').session.abandoned.phase, 'examine');
  const [idea] = loadIdeas(root);
  assert.equal(idea.status, 'undecided');
  assert.match(idea.verdict.wouldDecide, /set aside before the judge ruled/);
  assert.equal(idea.history.at(-1).event, 'set aside', 'not a ruling, so the track record does not count it');
  assert.equal(createSession(root, { date: '2026-11-15' }).session.id, '2026-11-15-2');
  assert.equal(COMMANDS.close({ root, session: '2026-11-15', abandon: true }).ok, false, 'a closed session is not set aside again');
});

test('init says when the budget cannot pay for one full round of the debate', () => {
  const root = tmpDir();
  const small = councilInit({ root, budget: '24' });
  assert.match(small.warnings[0], /^With a budget of 24, the debate has 12 agent runs .* one full round of attack and reply takes about 29\. .* at least 41/);
});

test('init asks for the business name when the documents would carry the folder name', () => {
  const root = tmpDir();
  const bare = councilInit({ root });
  assert.deepEqual(bare.business, { name: path.basename(root), from: 'folder' });
  assert.match(bare.warnings.at(-1), /would name the business ".+", after the project folder\. Ask the person .*"fact --key brand\.name/);
  const named = tmpDir();
  fact({ root: named, key: 'brand.name', value: 'Acme Studio' });
  const r = councilInit({ root: named });
  assert.deepEqual([r.business, r.warnings], [{ name: 'Acme Studio', from: 'person' }, undefined]);
});

test('the goal comes from the argument, then the knowledge base, then the default', () => {
  const root = tmpDir();
  assert.deepEqual([createSession(root, { date: '2026-11-01' }).session.goal, loadSession(root, '2026-11-01').session.goalSource], [DEFAULT_GOAL, 'default']);
  saveSession(loadSession(root, '2026-11-01').dir, { ...loadSession(root, '2026-11-01').session, phase: 'done' });

  const given = councilInit({ root, goal: ' More enquiries from product companies ' });
  assert.equal(given.goal, 'More enquiries from product companies');
  assert.equal(given.goalSource, 'given');
  saveSession(given.dir, { ...loadSession(root, given.session).session, phase: 'done' });

  const next = councilInit({ root });
  assert.deepEqual([next.goal, next.goalSource], ['More enquiries from product companies', 'knowledge base'], 'a goal the person gave is remembered');
});

test('the budget and the data folder are checked before anything is created', () => {
  const root = tmpDir();
  assert.throws(() => createSession(root, { budget: '10' }), /--budget must be a whole number of at least 22/);
  assert.throws(() => createSession(root, { budget: 'many' }), /--budget must be a whole number/);
  assert.throws(() => createSession(root, { data: path.join(root, 'nowhere') }), /Data folder not found/);
  assert.throws(() => councilInit({ root, url: 'acme.test' }), /Invalid URL/);
  assert.deepEqual(listSessions(root), []);
  assert.equal(createSession(root, { budget: '30', data: root }).session.budget, 30);
});

test('commands work on the session named, or on the latest unfinished one', () => {
  const root = tmpDir();
  assert.throws(() => resolveSession(root), /No council session is under way/);
  const a = createSession(root, { date: '2026-11-08' });
  saveSession(a.dir, { ...a.session, phase: 'done' });
  createSession(root, { date: '2026-11-15' });
  assert.equal(resolveSession(root).session.id, '2026-11-15');
  assert.equal(resolveSession(root, '2026-11-08').session.phase, 'done');
  assert.throws(() => resolveSession(root, '../x'), /Invalid session id/);
  assert.throws(() => resolveSession(root, '2026-01-01'), /Session "2026-01-01" not found/);
});

test('phases only move forward, one at a time, and each asks for what it needs', () => {
  const ctx = session();
  ctx.evidence = { entries: [], data: [], missing: [] };
  move(ctx);
  assert.equal(ctx.session.phase, 'evidence');
  assert.match(errorOf(advance(ctx)), /The evidence has not been collected/);
  ctx.evidence.collectedAt = 'now';
  move(ctx); move(ctx);
  assert.equal(ctx.session.phase, 'propose');
  assert.match(errorOf(advance(ctx)), /Lady Honoria Fairweather \(client\), Sir Barnaby Thistlewood \(search\).*have not taken their turn/);
  assert.match(errorOf(advance(ctx, { force: true })), /Nobody has proposed anything yet/);
  ok(say(ctx, 'search', [hyp(1), hyp(2)]));
  assert.match(errorOf(advance(ctx)), /have not taken their turn/, 'the others are still waited for');
  move(ctx, { force: true });
  move(ctx, { force: true });
  assert.equal(ctx.session.phase, 'docket');
  assert.match(errorOf(advance(ctx)), /The docket has not been saved/);
  ctx.session.phase = 'write';
  assert.match(errorOf(advance(ctx)), /"next" does not move the session out of the write phase/);
  assert.deepEqual(PHASES.slice(0, 7), ['open', 'evidence', 'track-record', 'propose', 'docket', 'examine', 'verdict']);
});

// ---- Evidence ----

function projectWithRun(runId = '2026-11-12T0900') {
  const root = tmpDir();
  const run = path.join(root, '.project-health', 'runs', runId);
  fs.mkdirSync(run, { recursive: true });
  const finding = (id, extra = {}) => ({ id, rule: 'seo.x', subject: 'site', area: 'seo', kind: 'issue', title: `Problem ${id}`, why: 'It costs visitors.', severity: 'high', confidence: 'high', evidence: [], verified: true, ...extra });
  fs.writeFileSync(path.join(run, 'findings.json'), JSON.stringify({ run: runId, findings: [finding('SEO-aa11'), finding('SEO-bb22', { verified: false }), finding('AI-cc33', { kind: 'tooling' }), finding('SEO-dd44')] }));
  fs.writeFileSync(path.join(run, 'checklist.md'), '## High\n- [x] **SEO-aa11** Problem SEO-aa11\n- [ ] **SEO-bb22** Problem SEO-bb22\n- [-] **SEO-dd44** Problem SEO-dd44\n');
  fs.writeFileSync(path.join(run, 'profile.json'), JSON.stringify({ url: 'https://acme.test' }));
  fs.writeFileSync(path.join(run, 'live.json'), JSON.stringify({ reachable: true, pages: [] }));
  return root;
}

test('the first evidence comes from the health run, the knowledge base and the data folder', () => {
  const root = projectWithRun();
  fact({ root, key: 'business.audience', value: 'Product companies' });
  fact({ root, key: 'metric.enquiries', value: '12', by: 'council', source: 'data/enquiries.csv' });
  fact({ root, key: 'hosting.provider', value: 'Netlify', by: 'hosting', source: 'netlify.toml' });
  fact({ root, key: 'council.goal', value: 'More enquiries' });
  fs.writeFileSync(path.join(root, '.project-health', 'runs', '2026-11-12T0900', 'roadmap.json'), '{}');
  const data = path.join(root, 'shared');
  fs.mkdirSync(path.join(data, 'ga'), { recursive: true });
  fs.writeFileSync(path.join(data, 'ga', 'pages.csv'), '﻿page,views\r\n/services,310\r\n/contact,12\r\n');
  fs.writeFileSync(path.join(data, 'notes.txt'), 'The owner says most enquiries come by phone.');
  const { session: s } = createSession(root, { date: '2026-11-15', data });
  assert.equal(s.run, '2026-11-12T0900');
  assert.equal(s.url, 'https://acme.test', 'the address of the health run is used');

  const ev = collectEvidence(root, s, { date: '2026-11-15' });
  const by = (source) => ev.entries.find((e) => e.source === source);
  assert.deepEqual(by('finding SEO-aa11'), { id: 'E1', grade: 'observed', source: 'finding SEO-aa11', date: '2026-11-12', text: 'Problem SEO-aa11. It costs visitors. (seo, high)', by: 'project-health' });
  assert.match(by('finding SEO-bb22').text, /not confirmed\)$/);
  assert.equal(by('finding AI-cc33'), undefined, 'tooling suggestions are not evidence');
  assert.equal(by('finding SEO-dd44'), undefined, 'a finding the reviewer dismissed is not evidence');
  assert.deepEqual([by('fact metric.enquiries').grade, by('fact business.audience').grade, by('fact business.audience').by], ['measured', 'observed', 'a person']);
  assert.equal(by('fact hosting.provider'), undefined);
  assert.equal(by('fact council.goal'), undefined);
  assert.deepEqual(ev.data.map((d) => [d.name, d.header, d.rows]), [['ga/pages.csv', 'page,views', 2], ['notes.txt', undefined, undefined]]);
  assert.equal(ev.site.url, 'https://acme.test');
  assert.equal(ev.site.probe.date, '2026-11-12');
  assert.match(by('https://acme.test').text, /The live site as the health check read it on 2026-11-12: its pages, headers and response times are in .*live\.json/);
  assert.deepEqual(ev.missing, []);
});

test('a session with nothing to go on still collects, and says what it lacks', () => {
  const root = tmpDir();
  const ev = collectEvidence(root, createSession(root, {}).session);
  assert.deepEqual(ev.entries, []);
  assert.equal(ev.missing.length, 3);
  assert.match(ev.missing.join('\n'), /No health check has been run[\s\S]*No data was shared[\s\S]*No live site address is known/);
});

test('an old reading of the live site is not offered as evidence: agents look at the site themselves', () => {
  const root = projectWithRun('2026-10-01T0900');
  const ev = collectEvidence(root, createSession(root, { date: '2026-11-15' }).session, { date: '2026-11-15' });
  assert.deepEqual(ev.site, { url: 'https://acme.test', probe: null });
  assert.equal(ev.entries.find((e) => e.source === 'https://acme.test'), undefined);
});

test('an agent adds evidence; a grade the source cannot carry is lowered, never refused', () => {
  const root = projectWithRun();
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>Acme</h1>');
  const data = path.join(root, 'shared');
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, 'pages.csv'), 'page,views\n/services,310\n');
  fact({ root, key: 'metric.enquiries', value: '12', by: 'council', source: 'shared/pages.csv' });
  const { session: s } = createSession(root, { date: '2026-11-15', data });
  const add = (items, by = 'competitors') => addEvidence({ entries: [], data: [], missing: [] }, items, { by, root, session: s, date: '2026-11-15' });
  const item = (grade, source, text = 'The services page had 310 views in October') => ({ grade, source, text });

  const r = add([
    item('measured', 'pages.csv'), item('measured', 'fact metric.enquiries', 'Twelve enquiries a month'), item('measured', 'https://acme.test/', 'A number seen on a page'),
    item('measured', '../index.html', 'A number from outside the data folder'), item('observed', 'index.html:1', 'The home page headline is the company name'),
    item('observed', 'finding SEO-aa11', 'The health check found a problem'), item('observed', 'I read it somewhere', 'Most agencies publish case studies'),
    { grade: 'argued', text: 'Buyers trust proof more than promises' },
  ]);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.added.map((a) => a.grade), ['measured', 'measured', 'observed', 'argued', 'observed', 'observed', 'argued', 'argued']);
  assert.deepEqual(r.added.map((a) => a.id), ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8']);
  assert.equal(r.warnings.length, 3);
  assert.match(r.warnings[0], /measured needs a source inside the shared data folder.*saved as observed/);
  assert.match(r.warnings[2], /observed needs a URL, a file in the project, a finding id/);
  assert.equal(r.evidence.entries[0].by, 'competitors');

  const again = addEvidence(r.evidence, [item('measured', 'pages.csv')], { by: 'search', root, session: s });
  assert.deepEqual(again.added, [{ id: 'E1', grade: 'measured', repeated: true }]);
  assert.equal(again.evidence.entries.length, 8);

  assert.match(errorOf(add([{ grade: 'proven', text: 'Something certain enough' }])), /grade: one of measured, observed, argued/);
  assert.match(errorOf(add([{ grade: 'observed', text: 'Seen but no source given' }])), /observed evidence needs its source/);
  assert.match(errorOf(add([{ grade: 'argued', text: 'short' }])), /at least 10 characters/);
  assert.match(errorOf(add([item('argued', null, 'x'.repeat(501))])), /at most 500 characters/);
  assert.match(errorOf(add([item('argued', null)], undefined)), /^$/);
  assert.match(errorOf(addEvidence({ entries: [] }, [], { root, session: s })), /Say which role/);
});

test('the data inventory stops at two levels and lists files in a stable order', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'a', 'b', 'c'), { recursive: true });
  for (const f of ['z.csv', 'a/y.csv', 'a/b/x.csv', 'a/b/c/w.csv']) fs.writeFileSync(path.join(dir, f), 'k,v\n1,2\n');
  assert.deepEqual(dataInventory(dir).map((d) => d.name), ['a/y.csv', 'z.csv']);
  assert.deepEqual(dataInventory(null), []);
});

test('evidence --collect runs once; agents then add their own', () => {
  // A reading of the live site is offered for a week after the health check, so the run is dated today.
  const root = projectWithRun(`${new Date().toISOString().slice(0, 10)}T0900`);
  councilInit({ root });
  const first = councilEvidence({ root, collect: true });
  assert.equal(first.ok, true);
  assert.equal(first.entries, 3);
  assert.equal(first.site.url, 'https://acme.test');
  const added = councilEvidence({ root, role: 'competitors' }, stdin({ evidence: [{ grade: 'observed', source: 'https://rival.test/work', text: 'The rival shows twelve case studies on its home page' }] }));
  assert.deepEqual(added.added, [{ id: 'E4', grade: 'observed' }]);
  const second = councilEvidence({ root, collect: true });
  assert.deepEqual([second.already, second.entries], [true, 4], 'statements cite evidence by id, so the collection never runs twice');
  assert.equal(loadEvidence(resolveSession(root).dir).entries.length, 4);
  assert.equal(councilEvidence({ root, role: 'competitors' }, { stdin: () => 'nope' }).ok, false);
});

// ---- Proposing ----

test('a hypothesis must be provable wrong: every part, a test and an effort level', () => {
  const ctx = session();
  move(ctx); move(ctx); move(ctx);
  const r = say(ctx, 'search', [
    hyp(1, { hypothesis: { ...hyp(1).hypothesis, killCondition: 'none' } }), hyp(2, { test: undefined }), hyp(3, { effort: 'two days' }),
    hyp(4, { hypothesis: { ...hyp(4).hypothesis, budget: 'unlimited' } }), hyp(5, { evidence: ['E9'] }), hyp(6, { returns: 'I7' }), { type: 'attack', thread: 'T1' },
  ]);
  const text = errorOf(r);
  assert.match(text, /\[0\]\.hypothesis\.killCondition: at least 10 characters/);
  assert.match(text, /\[1\]\.test: say the cheapest way to find out/);
  assert.match(text, /\[2\]\.effort: small, medium or large/);
  assert.match(text, /\[3\]\.hypothesis: unknown property "budget"/);
  assert.match(text, /\[4\]\.evidence: there is no evidence E9/);
  assert.match(text, /\[5\]\.whatChanged: say what is different since I7 was decided/);
  assert.match(text, /\[6\]\.type: in this step \(propose, first\) a statement is one of hypothesis/);
  assert.equal(ctx.record.threads.length, 0, 'nothing is saved when anything is refused');
  assert.match(errorOf(say(ctx, 'red-team', [hyp(1)])), /red-team does not propose ideas/);
  assert.match(errorOf(say(ctx, 'butler', [])), /Unknown or missing --role "butler"/);
  assert.match(errorOf(say(ctx, 'search', { statements: [] })), /an array is required/);
});

test('every idea says how far it reaches, and every proposer brings at least one new thing', () => {
  const ctx = session();
  move(ctx); move(ctx); move(ctx);
  assert.match(errorOf(say(ctx, 'search', [hyp(1, { scale: 'huge' })])), /\[0\]\.scale: adjustment \(a change to what is there\), addition .* direction .* or new \(something the business does not do or have at all\)/);
  const at = { where: [{ url: 'https://acme.test/services', part: 'the list of services', text: 'Our services' }] };
  assert.match(errorOf(say(ctx, 'search', [hyp(1, { scale: 'adjustment' })])), /\[0\]\.where: say where the idea applies/, 'a change to a page says which page, and which part of it');
  const bad = errorOf(say(ctx, 'search', [hyp(1, { scale: 'adjustment', where: [{ url: 'services', part: 'x' }] })]));
  for (const part of [/\.where\[0\]\.url: the full address/, /\.where\[0\]\.part: the part of the page/, /\.where\[0\]\.text: words shown in that part/]) assert.match(bad, part);
  assert.match(errorOf(say(ctx, 'search', [hyp(1, { scale: 'adjustment', ...at }), hyp(2, { scale: 'direction', ...at })])), /At least one of your hypotheses is new: something the business does not do or have at all/);
  assert.equal(ctx.record.threads.length, 0, 'a set without anything new is refused whole');
  ok(say(ctx, 'search', [hyp(1, { scale: 'adjustment', ...at }), hyp(2)]));
  assert.deepEqual(ctx.record.statements.map((s) => s.scale), ['adjustment', 'new']);
  // A new idea already on the table counts for a later save.
  ok(say(ctx, 'search', [hyp(3, { scale: 'adjustment', ...at })]));
  assert.equal(ok(say(ctx, 'outsider', [])).added.length, 0, 'an empty turn needs nothing new');
  assert.equal(ok(say(ctx, 'content', [hyp(9, { ...at })])).added.length, 1, 'a new idea may name a place too');
  assert.deepEqual(ctx.record.statements.at(-1).where, at.where);
  assert.deepEqual(ctx.record.statements[0].where, at.where, 'the place is kept with the idea');
});

test('each idea becomes a thread; a role proposes at most four, and a retried save adds nothing', () => {
  const ctx = session();
  move(ctx); move(ctx); move(ctx);
  const first = ok(say(ctx, 'search', [hyp(1, { evidence: ['E1'] }), hyp(2)], { now: () => 'T' }));
  assert.deepEqual(first.added, [{ n: 1, thread: 'T1', type: 'hypothesis' }, { n: 2, thread: 'T2', type: 'hypothesis' }]);
  assert.deepEqual(ctx.record.threads[0], { id: 'T1', by: 'search', title: 'Idea 1: a case study on the services page', status: 'proposed', closed: null });
  assert.deepEqual(ctx.record.statements[0].evidence, ['E1']);
  assert.equal(ctx.record.statements[0].round, 0);

  const again = ok(say(ctx, 'search', [hyp(1, { evidence: ['E1'] }), hyp(3)]));
  assert.equal(again.repeated, 1);
  assert.deepEqual(again.added.map((a) => a.thread), ['T3']);
  assert.match(errorOf(say(ctx, 'search', [hyp(1, { hypothesis: { ...hyp(1).hypothesis, killCondition: 'No change at all after a whole year has passed' } })])), /already proposed.*cannot be rewritten once it is on the table/);
  assert.match(errorOf(say(ctx, 'search', [hyp(4), hyp(5)])), /At most 4 hypotheses per role: you have 3 and sent 2 more/);
  assert.match(ok(say(ctx, 'content', [hyp(6)])).warnings[0], /content has proposed fewer than two hypotheses/);
  assert.equal(ok(say(ctx, 'outsider', [])).added.length, 0, 'a role may take its turn with nothing to say');
  assert.equal(turns(ctx.session, ctx.record).find((t) => t.role === 'outsider').done, true);
});

// ---- The docket ----

test('the docket places every idea: admitted, merged or refused with a reason', () => {
  const ctx = proposed();
  const all = ctx.record.threads.map((t) => t.id);
  assert.deepEqual(all, ['T1', 'T2', 'T3', 'T4', 'T5', 'T6']);
  const bad = saveDocket(ctx, { admitted: [{ thread: 'T1', merge: ['T2', 'T9'], novelty: 'familiar' }, { thread: 'T2', novelty: 'familiar' }], refused: [{ thread: 'T3', reason: 'no' }] }, { ideas: [] });
  const text = errorOf(bad);
  assert.match(text, /merge\[1\]: there is no thread T9/);
  assert.match(text, /\$\.admitted\[1\]\.thread: T2 is already listed as merged into T1/);
  assert.match(text, /refused\[0\]\.reason: say why it is turned away/);
  assert.match(text, /T4 "Idea 4: a case study on the services page" is not on the docket/);
  assert.equal(ctx.record.docket, null);

  const r = ok(saveDocket(ctx, {
    admitted: [{ thread: 'T1', merge: ['T2'], novelty: 'familiar' }, { thread: 'T4', novelty: 'familiar' }, { thread: 'T5', novelty: 'familiar' }],
    refused: [{ thread: 'T3', reason: 'The roadmap already plans this', ref: 'S3' }, { thread: 'T6', reason: 'Tracking before consent is not allowed', ref: 'K1' }],
  }, { ideas: [], date: '2026-11-15' }));
  assert.deepEqual(r.admitted, [{ thread: 'T1', idea: 'I1' }, { thread: 'T4', idea: 'I2' }, { thread: 'T5', idea: 'I3' }]);
  assert.deepEqual(thread(ctx.record, 'T1'), { id: 'T1', by: 'client', title: 'Idea 1: a case study on the services page', status: 'admitted', closed: null, ideaId: 'I1', novelty: 'familiar', mergedFrom: ['T2'] });
  assert.deepEqual([thread(ctx.record, 'T2').status, thread(ctx.record, 'T2').mergedInto], ['merged', 'T1']);
  assert.deepEqual(thread(ctx.record, 'T3').refused, { reason: 'The roadmap already plans this', ref: 'S3' });
  assert.deepEqual(r.ideas[0].test, { what: 'Publish one case study and compare contact-page visits', metric: 'contact-page visits', threshold: '20 a month', checkAfter: 'six weeks' });
  assert.deepEqual([r.ideas[0].status, r.ideas[0].proposedBy, r.ideas[0].goal, r.ideas[0].history[0].session], ['proposed', 'client', DEFAULT_GOAL, '2026-11-15']);
  assert.deepEqual(openThreads(ctx.record).map((t) => t.id), ['T1', 'T4', 'T5']);
  move(ctx);
  assert.deepEqual([ctx.session.phase, ctx.session.round, ctx.session.step], ['examine', 1, 'attack']);
});

test('an idea that returns from the dead needs "what changed", or nothing of the docket is saved', () => {
  const root = tmpDir();
  ideaSave({ root, by: 'council' }, stdin({ ideas: [hyp(0)].map(({ title, hypothesis }) => ({ title, hypothesis, proposedBy: 'content' })) }));
  ideaSave({ root, by: 'council' }, stdin({ ideas: [{ id: 'I1', status: 'killed', verdict: { causeOfDeath: 'The client does not allow results to be published' } }] }));
  const ctx = proposed();
  const admitted = ctx.record.threads.map((t) => ({ thread: t.id, novelty: 'familiar' }));
  admitted[2].returns = 'I1';
  const refused = saveDocket(ctx, { admitted }, { ideas: loadIdeas(root) });
  assert.match(errorOf(refused), /\$\.admitted\[2\] \(T3\)\.whatChanged: I1 "Idea 0: a case study on the services page" was killed; say what is different now/);
  assert.equal(ctx.record.docket, null);
  assert.equal(thread(ctx.record, 'T1').status, 'proposed');

  admitted[2].whatChanged = 'The client now allows a short, anonymised version';
  const r = ok(saveDocket(ctx, { admitted }, { ideas: loadIdeas(root) }));
  assert.deepEqual([r.ideas.find((i) => i.id === 'I4').returns, r.admitted[2].idea], ['I1', 'I4']);
});

test('with nothing admitted the session goes straight to the verdict', () => {
  const ctx = proposed();
  ok(saveDocket(ctx, { admitted: [], refused: ctx.record.threads.map((t) => ({ thread: t.id, reason: 'The roadmap already plans this' })) }, { ideas: [] }));
  move(ctx);
  assert.equal(ctx.session.phase, 'verdict');
});

// ---- The examination ----

test('second attackers are spread evenly, never on their own idea, and the client is not one of them', () => {
  const ctx = examining(2);
  const a = ctx.session.assignments;
  assert.equal(Object.keys(a).length, 12);
  const load = {};
  for (const [id, role] of Object.entries(a)) {
    assert.notEqual(role, thread(ctx.record, id).by, `${id} is not attacked by its own proposer`);
    assert.notEqual(role, 'client');
    load[role] = (load[role] ?? 0) + 1;
  }
  assert.ok(Math.max(...Object.values(load)) - Math.min(...Object.values(load)) <= 1, JSON.stringify(load));
  assert.deepEqual(assignAttackers(ctx.session, ctx.record), a, 'the assignment is the same every time');
});

test('round one: the red team restates before it attacks, others cover what they were given and may speak on any idea not their own, the client speaks for the customer', () => {
  const ctx = examining();
  const waiting = turns(ctx.session, ctx.record);
  assert.deepEqual(waiting.map((t) => t.role), ['red-team', 'client', 'search', 'content', 'conversion', 'competitors', 'outsider']);
  assert.deepEqual(waiting[0].threads, ['T1', 'T2', 'T3', 'T4', 'T5', 'T6']);
  assert.deepEqual(waiting[1].threads, ['T2', 'T3', 'T4', 'T5', 'T6'], 'the client does not judge its own idea');
  assert.deepEqual([waiting[0].name, waiting[0].model], ['Dr Lucius Graves', 'strongest']);

  assert.match(errorOf(say(ctx, 'red-team', [attack('T1')])), /restate T1 in its strongest form first/);
  assert.match(errorOf(say(ctx, 'red-team', [steelman('T1'), attack('T1', { kind: 'boring' })])), /kind: one of evidence, cost, customer, exists, harm, do-nothing/);
  ok(say(ctx, 'red-team', [steelman('T1'), attack('T1'), attack('T1', { kind: 'cost', text: `It costs more than it returns, ${LONG}` })]));

  const mine = Object.entries(ctx.session.assignments).find(([, role]) => role === 'search')[0];
  const other = Object.entries(ctx.session.assignments).find(([id, role]) => role !== 'search' && thread(ctx.record, id).by !== 'search')[0];
  const own = ctx.record.threads.find((t) => t.by === 'search').id;
  assert.ok(waiting.find((t) => t.role === 'search').threads.includes(other), 'a seat sees every idea that is not its own');
  assert.ok(!waiting.find((t) => t.role === 'search').threads.includes(own));
  const skipped = ok(say(ctx, 'search', [attack(other)]));
  assert.match(skipped.warnings.join(' '), new RegExp(`You were given ${mine} to cover and said nothing on it`), 'an idea given to cover and skipped is named');
  assert.deepEqual(ok(say(ctx, 'search', [attack(mine)])).warnings, []);
  assert.match(errorOf(say(ctx, 'search', [attack(own)])), new RegExp(`search does not speak on ${own} in this step: it is closed, or it is your own idea`));

  const client = (t, extra = {}) => ({ type: 'client', thread: t, cares: 'no', text: `A customer would not notice this on the page, ${LONG}`, ...extra });
  assert.match(errorOf(say(ctx, 'client', [client('T1')])), /client does not speak on T1 in this step: it is closed, or it is your own idea/);
  assert.match(errorOf(say(ctx, 'client', [client('T2', { cares: 'a bit' })])), /cares: yes, no or unsure/);
  assert.match(errorOf(say(ctx, 'client', [attack('T2')])), /the client's voice gives a "client" statement, not a attack/);
  assert.match(errorOf(say(ctx, 'search', [client(mine)])), /only the client's voice gives a client statement/);
  ok(say(ctx, 'client', [client('T2')]));
  assert.match(errorOf(say(ctx, 'client', [client('T2', { text: `On second thoughts a customer would love it, ${LONG}` })])), /the client has already spoken on T2/);

  assert.match(errorOf(say(ctx, 'client', [reply(ctx, 'T1')])), /a statement is one of steelman, attack, client, question/);
  assert.match(errorOf(say(ctx, 'red-team', [attack('T9')])), /there is no thread T9/);
  assert.match(errorOf(say(ctx, 'red-team', [attack('T2', { text: 'too short' })])), /text: at least 20 characters/);
});

test('the reply step: only the proposer answers, once, naming the attacks it answers', () => {
  const ctx = examining();
  ok(say(ctx, 'red-team', [steelman('T1'), attack('T1'), attack('T1', { kind: 'cost', text: `It costs more than it returns, ${LONG}` })]));
  move(ctx, { force: true });
  assert.deepEqual(turns(ctx.session, ctx.record).map((t) => [t.role, t.threads]), [['client', ['T1']]], 'only proposers whose ideas were attacked have a turn');

  assert.match(errorOf(say(ctx, 'search', [reply(ctx, 'T1')])), /only client, who proposed T1, replies on it/);
  assert.match(errorOf(say(ctx, 'client', [reply(ctx, 'T1', { to: [] })])), /to: the numbers of the statements this answers/);
  assert.match(errorOf(say(ctx, 'client', [reply(ctx, 'T1', { to: [1] })])), /1 is not an attack on T1 in this round/);
  assert.match(errorOf(say(ctx, 'client', [reply(ctx, 'T1', { stance: 'shrug' })])), /stance: refute, narrow or concede/);
  assert.match(errorOf(say(ctx, 'client', [reply(ctx, 'T1', { stance: 'narrow' })])), /narrowed: the narrower claim/);
  assert.match(errorOf(say(ctx, 'client', [reply(ctx, 'T1', { stance: 'narrow', narrowed: { change: 'Only for one industry page', effect: 'One more enquiry a month', killCondition: 'Never' } })])), /the kill condition stays as it was proposed/);
  assert.match(errorOf(say(ctx, 'client', [reply(ctx, 'T1', { stance: 'narrow', narrowed: { change: 'Only for one industry page', effect: 'One more enquiry a month', because: 'Buyers there ask for proof first' } })])), /narrowed: unknown property "because"; a narrower claim is "change" and "effect", with "test" when/);
  assert.match(errorOf(say(ctx, 'client', [reply(ctx, 'T1', { narrowed: { change: 'Only for one industry page', effect: 'One more enquiry a month' } })])), /only a reply with the stance "narrow" carries a narrower claim/);
  assert.match(errorOf(say(ctx, 'client', [attack('T1')])), /a statement is one of steelman-reply, reply, question/);
  assert.match(errorOf(say(ctx, 'client', [reply(ctx, 'T2')])), /only search, who proposed T2|nobody attacked/);

  const attacks = reply(ctx, 'T1').to;
  const partial = ok(say(ctx, 'client', [{ type: 'steelman-reply', thread: 'T1', accepts: true, text: `That is a fair restatement of the idea, ${LONG}` }, reply(ctx, 'T1', { to: [attacks[0]] })]));
  assert.match(partial.warnings[0], new RegExp(`T1: attack ${attacks[1]} got no answer; the judge will see that`));
  assert.equal(ok(say(ctx, 'client', [reply(ctx, 'T1', { to: [attacks[0]] })])).repeated, 1, 'the same reply again is accepted without being added');
  assert.match(errorOf(say(ctx, 'client', [reply(ctx, 'T1', { text: `A different answer altogether this time, ${LONG}` })])), /T1 already has its reply for this round/);
  assert.equal(ctx.record.statements.filter((s) => s.type === 'reply').length, 1);
});

test('a thread runs three rounds at most, each later round bringing something new', () => {
  const ctx = roundTwo();
  assert.deepEqual(turns(ctx.session, ctx.record).map((t) => t.role), ['red-team'], 'from round two only the red team presses');
  assert.match(errorOf(say(ctx, 'search', [attack('T1', { evidence: ['E2'] })])), /from round two only the red team presses a thread/);
  assert.match(errorOf(say(ctx, 'red-team', [steelman('T1')])), /the restatement belongs to round one/);

  // Round two: new evidence from the attack, a narrower claim in reply.
  ok(say(ctx, 'red-team', [attack('T1', { evidence: ['E2'], text: `A second look at the numbers, ${LONG}` })]));
  move(ctx);
  ok(say(ctx, 'client', [reply(ctx, 'T1', { stance: 'narrow', narrowed: { change: 'One case study, on the page for product companies only', effect: 'One more enquiry a month from that page' }, text: `Then let it be smaller, ${LONG}` })]));
  move(ctx);
  assert.deepEqual([ctx.session.round, ctx.session.step], [3, 'attack']);

  // Round three: the narrowed claim is new ground, so the attack needs no new evidence; the reply does.
  const third = ok(say(ctx, 'red-team', [attack('T1', { text: `Even the smaller claim costs more than it returns, ${LONG}`, kind: 'cost' })]));
  assert.deepEqual(third.closed, []);
  move(ctx);
  ok(say(ctx, 'client', [reply(ctx, 'T1', { evidence: ['E3'], text: `The cost is one afternoon, as the numbers show, ${LONG}` })]));
  const end = move(ctx);
  assert.deepEqual(end.closed, [{ thread: 'T1', reason: 'the third round is over' }]);
  assert.equal(ctx.session.phase, 'verdict');
  assert.deepEqual(ctx.record.statements.filter((s) => s.thread === 'T1').map((s) => [s.round, s.type]), [
    [0, 'hypothesis'], [1, 'steelman'], [1, 'attack'], [1, 'reply'], [2, 'attack'], [2, 'reply'], [3, 'attack'], [3, 'reply'],
  ]);
  assert.match(errorOf(say(ctx, 'red-team', [attack('T1')])), /Nothing is said in the verdict phase/);
});

test('an attack with nothing new is saved, and closes the thread', () => {
  const ctx = roundTwo();
  const r = ok(say(ctx, 'red-team', [attack('T1', { evidence: ['E1'], text: `The same point as before, said again, ${LONG}` })]));
  assert.deepEqual(r.closed, [{ thread: 'T1', reason: 'nothing new from the attack' }]);
  assert.equal(ctx.record.statements.at(-1).nothingNew, true);
  assert.match(errorOf(say(ctx, 'red-team', [attack('T1', { evidence: ['E2'], text: `One more thing occurs to me, ${LONG}` })])), /T1 is closed \(nothing new from the attack\); nothing more is said on it/);
  assert.equal(move(ctx).to.phase, 'verdict');
});

test('novelty is judged over all a role says on a thread in one save', () => {
  const ctx = roundTwo();
  const r = ok(say(ctx, 'red-team', [attack('T1', { text: `A point with no new evidence, ${LONG}` }), attack('T1', { kind: 'cost', evidence: ['E4'], text: `And one with a new number, ${LONG}` })]));
  assert.deepEqual(r.closed, []);
  assert.ok(ctx.record.statements.slice(-2).every((s) => !s.nothingNew));
});

test('a reply that only repeats itself closes the thread; so do a concession and an attack that rests', () => {
  const repeat = roundTwo();
  ok(say(repeat, 'red-team', [attack('T1', { evidence: ['E2'], text: `A second look at the numbers, ${LONG}` })]));
  move(repeat);
  assert.deepEqual(ok(say(repeat, 'client', [reply(repeat, 'T1', { evidence: ['E1', 'E2'], text: `As I said before, and say again, ${LONG}` })])).closed, [{ thread: 'T1', reason: 'nothing new from the reply' }]);

  const concede = examining();
  ok(say(concede, 'red-team', [steelman('T1'), attack('T1')]));
  move(concede, { force: true });
  assert.deepEqual(ok(say(concede, 'client', [reply(concede, 'T1', { stance: 'concede', text: `The point is taken and the idea withdrawn, ${LONG}` })])).closed, [{ thread: 'T1', reason: 'conceded' }]);

  const rests = roundTwo();
  ok(say(rests, 'red-team', []));
  const end = move(rests);
  assert.deepEqual(end.closed[0], { thread: 'T1', reason: 'the attack rests' });
  assert.equal(end.closed.length, 6, 'ideas nobody pressed in round one rest too');
  assert.equal(end.to.phase, 'verdict');
});

test('an attack nobody answers closes the thread as unanswered; ideas nobody attacked go on to the judge', () => {
  const ctx = examining();
  ok(say(ctx, 'red-team', [steelman('T1'), attack('T1'), steelman('T2'), attack('T2')]));
  move(ctx, { force: true });
  ok(say(ctx, 'client', [reply(ctx, 'T1')]));
  assert.match(errorOf(advance(ctx)), /Sir Barnaby Thistlewood \(search\) has not taken the turn/);
  const end = move(ctx, { force: true });
  assert.deepEqual(end.closed, [{ thread: 'T2', reason: 'the attack went unanswered' }]);
  assert.deepEqual([ctx.session.round, ctx.session.step], [2, 'attack']);
  assert.deepEqual(openThreads(ctx.record).map((t) => t.id), ['T1', 'T3', 'T4', 'T5', 'T6']);
});

test('a question is kept for the person, and closes nothing when it is asked', () => {
  const ctx = examining();
  assert.match(errorOf(say(ctx, 'red-team', [{ type: 'question', thread: 'T1', text: `How many enquiries come by phone each month, ${LONG}` }])), /for: "person" when only the people who run the project can answer/);
  const r = ok(say(ctx, 'red-team', [{ type: 'question', thread: 'T1', for: 'data', text: `How many enquiries come by phone each month, ${LONG}` }]));
  assert.deepEqual(r.closed, [], 'the others who have a turn in this round still speak; see debate-rules.test.mjs for when a question ends a thread');
  assert.deepEqual(ctx.record.questions.map((q) => [q.thread, q.for, q.by]), [['T1', 'data', 'red-team']]);
  assert.equal(thread(ctx.record, 'T1').closed, null);
});

// ---- The budget ----

test('every agent run is counted; at 80% of the debate allowance the session stops opening rounds', () => {
  const { session: s } = session();
  assert.deepEqual(budgetOf(s), { total: 60, forDebate: 48, spent: 0, closing: false });
  for (let n = 0; n < 38; n++) spendRun(s, { role: 'search', phase: 'examine' });
  assert.equal(s.closing, false, '38 of 48 is 79%');
  spendRun(s, { role: 'search', phase: 'examine' });
  assert.equal(s.closing, true, '39 of 48 is over 80%');
  for (let n = 0; n < 9; n++) spendRun(s, { role: 'search', phase: 'examine' });
  assert.throws(() => spendRun(s, { role: 'search', phase: 'examine' }), /The debate has used its 48 agent runs \(budget 60, 12 kept for the verdict and the documents\)/);
  spendRun(s, { role: 'judge', phase: 'verdict' });
  assert.equal(s.runs, 49, 'the verdict and the documents are never refused');
  assert.deepEqual(s.log.at(-1).role, 'judge');
});

test('when the budget closes the debate, the round is finished and open threads are marked as cut off', () => {
  const ctx = examining();
  ok(say(ctx, 'red-team', [steelman('T1'), attack('T1'), steelman('T2'), attack('T2')]));
  ctx.session.closing = true;
  move(ctx, { force: true });
  assert.equal(ctx.session.step, 'reply', 'the round under way is finished');
  assert.match(nextStep(ctx.session, ctx.record, ctx.evidence), /The budget is nearly spent: this is the last round\./);
  ok(say(ctx, 'client', [reply(ctx, 'T1')]));
  const end = move(ctx, { force: true });
  assert.equal(end.to.phase, 'verdict');
  assert.deepEqual(thread(ctx.record, 'T1').closed, { round: 1, reason: 'the budget ran out', cutOff: true });
  assert.equal(thread(ctx.record, 'T2').closed.reason, 'the attack went unanswered');

  const spent = examining();
  ok(say(spent, 'red-team', [steelman('T1'), attack('T1')]));
  spent.session.runs = 48;
  spent.session.closing = true;
  assert.equal(move(spent, { force: true }).to.phase, 'verdict');
  assert.deepEqual(thread(spent.record, 'T1').closed, { round: 1, reason: 'the budget ran out', cutOff: true }, 'a proposer who could not be started did not refuse to answer');
});

test('once the debate has spent its runs, status lists no turn that would be refused, and next moves to the verdict', () => {
  const ctx = examining();
  ok(say(ctx, 'red-team', [steelman('T1'), attack('T1')]));
  assert.ok(turns(ctx.session, ctx.record).some((t) => !t.done), 'other attackers still have a turn');
  ctx.session.runs = 48;
  ctx.session.closing = true;
  assert.deepEqual(turns(ctx.session, ctx.record).filter((t) => !t.done), [], 'nobody is listed who could not be started');
  assert.match(nextStep(ctx.session, ctx.record, ctx.evidence), /a refusal for the budget is final/);
  const end = move(ctx);
  assert.equal(end.to.phase, 'verdict', 'no reply step that nobody can take');
  assert.deepEqual(thread(ctx.record, 'T1').closed, { round: 1, reason: 'the budget ran out', cutOff: true });
});

test('status lists no more turns not yet taken than the runs left can start; a member already started stays listed', () => {
  const ctx = examining();
  const waiting = () => turns(ctx.session, ctx.record).filter((t) => !t.done).map((t) => t.role);
  assert.ok(waiting().length > 2, 'every attacker has a turn while the runs last');
  ctx.session.runs = 46;
  assert.deepEqual(waiting(), ['red-team', 'client'], 'two runs left: the first two attackers');
  spendRun(ctx.session, { role: 'red-team', phase: 'examine' });
  spendRun(ctx.session, { role: 'client', phase: 'examine' });
  assert.deepEqual(waiting(), ['red-team', 'client'], 'paid for and still running');
  assert.match(nextStep(ctx.session, ctx.record, ctx.evidence), /Wait for .+, already started, then run "next"/);
  assert.match(errorOf(advance(ctx)), /not taken their turn/);
  ok(say(ctx, 'red-team', [steelman('T1'), attack('T1')]));
  takeTurn(ctx.session, 'client');
  assert.equal(move(ctx).to.phase, 'verdict');
});

test('the judge is started for the docket even when the debate has spent its runs, so the proposals are not lost', () => {
  const ctx = proposed();
  ctx.session.runs = 48;
  assert.deepEqual(turns(ctx.session, ctx.record).map((t) => [t.role, t.done]), [['judge', false]]);
  assert.match(nextStep(ctx.session, ctx.record, ctx.evidence), /Start the judge for the docket/);
  spendRun(ctx.session, { role: 'judge', phase: 'docket' });
  assert.equal(ctx.session.runs, 49, 'paid from the reserve');
  ok(saveDocket(ctx, { admitted: ctx.record.threads.map((t) => ({ thread: t.id, novelty: 'familiar' })) }, { ideas: [] }));
  move(ctx);
  assert.deepEqual([ctx.session.phase, ctx.session.step], ['examine', 'attack']);
  assert.throws(() => spendRun(ctx.session, { role: 'red-team', phase: 'examine' }), /The debate has used its 48 agent runs/);
  assert.equal(move(ctx).to.phase, 'verdict', 'nobody can attack, so the judge rules on what was admitted');
});

// ---- The commands ----

test('a session can be stopped and picked up again from disk with the same state', () => {
  const root = tmpDir();
  const init = councilInit({ root, budget: '41' });
  assert.deepEqual(init.warnings.filter((w) => /budget/.test(w)), [], 'a budget of 41 covers one full round');
  assert.equal(init.next, 'Ask the person once about decisions and results still waiting from earlier sessions, then run "next".');
  assert.equal(councilNext({ root }).to.phase, 'evidence');
  assert.equal(councilNext({ root }).ok, false);
  councilEvidence({ root, collect: true });
  councilNext({ root }); councilNext({ root });

  let n = 0;
  for (const role of proposers(resolveSession(root).session)) assert.equal(councilSay({ root, role }, stdin({ statements: [hyp(++n), hyp(++n)] })).ok, true);
  const bad = councilSay({ root, role: 'search' }, stdin({ statements: [hyp(99, { effort: 'huge' })] }));
  assert.deepEqual([bad.ok, bad.errors.length], [false, 1]);
  assert.equal(councilNext({ root }).to.step, 'second');
  assert.equal(councilNext({ root, force: true }).to.phase, 'docket');
  assert.match(councilStatus({ root }).next, /Start the judge for the docket/);
  assert.throws(() => councilVerdict({ root, stage: 'ruling' }, stdin({})), /Valid stages: docket, verdict, set/);
  const docket = councilVerdict({ root, stage: 'docket' }, stdin({ admitted: Array.from({ length: 12 }, (_, i) => ({ thread: `T${i + 1}`, novelty: 'familiar' })) }));
  assert.equal(docket.ok, true);
  assert.equal(loadIdeas(root).length, 12);
  councilNext({ root });
  assert.equal(councilSay({ root, role: 'red-team' }, stdin({ statements: [steelman('T1'), attack('T1')] })).ok, true);

  // Everything above is on disk: a new look at the session sees the same state.
  const status = councilStatus({ root, session: init.session });
  assert.deepEqual([status.phase, status.round, status.step], ['examine', 1, 'attack']);
  assert.deepEqual(status.threads, { proposed: 12, admitted: 12, open: 12, refused: 0, merged: 0, cutOff: 0 });
  assert.deepEqual(status.budget, { total: 41, forDebate: 29, spent: 0, closing: false });
  assert.equal(status.turns.find((t) => t.role === 'red-team').done, true);
  assert.match(status.next, /Round 1: start the attackers, all at once: Lady Honoria Fairweather, Sir Barnaby Thistlewood/);
  assert.equal(readJson(path.join(init.dir, 'record.json')).statements.length, 14);
  assert.equal(councilSay({ root, role: 'red-team' }, stdin({ statements: [steelman('T1'), attack('T1')] })).repeated, 2);
  assert.equal(readJson(path.join(init.dir, 'record.json')).statements.length, 14, 'a retried save adds nothing');
  for (const c of ['init', 'status', 'next', 'evidence', 'say', 'verdict', 'ideas', 'fact', 'digest']) assert.ok(COMMANDS[c], c);
});
