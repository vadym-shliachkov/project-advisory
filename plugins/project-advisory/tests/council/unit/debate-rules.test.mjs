import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, SKILL_DIR } from '../helpers.mjs';
import { createSession, proposers } from '../../../skills/council/scripts/lib/session.mjs';
import { collectEvidence } from '../../../skills/council/scripts/lib/evidence.mjs';
import { loadRecord, say, saveDocket, advance, turns, thread, openThreads } from '../../../skills/council/scripts/lib/record.mjs';
import { loadVerdicts, saveRulings, saveSetNotes } from '../../../skills/council/scripts/lib/verdict.mjs';
import { applyIdeas, trackRecord } from '../../../skills/council/scripts/lib/ideas.mjs';
import { recordLine } from '../../../skills/council/scripts/lib/digest.mjs';

// Rules that the first real session (2026-11-15) showed to be wrong or missing:
//   - a question closed a thread the moment it was asked, before the red team and the proposer had spoken;
//   - a narrowed idea went into the ledger with the test and the kill condition of the idea it replaced;
//   - a finding the people had settled as fixed or wrong was still given to the debate as something observed;
//   - the judge was told "none has survived a session yet" about the ideas it was about to rule on.

const LONG = 'which is said here at enough length to be a real statement';
const ok = (r) => { assert.deepEqual(r.errors, []); return r; };
const move = (ctx, opts) => ok(advance(ctx, opts));
const errorOf = (r) => r.errors.join('\n');

const hyp = (n) => ({
  type: 'hypothesis', title: `Idea ${n}: a case study on the services page`, effort: 'small', scale: 'new', evidence: ['E1'],
  hypothesis: {
    change: `Publish case study number ${n} with the client's results`,
    effect: 'More enquiries from the services pages, about two a month',
    because: 'Visitors who see proof for their own industry are more likely to write',
    trigger: 'The services pages get visits but nobody goes on to the contact page',
    killCondition: 'No change in contact-page visits from the services pages after six weeks',
  },
  test: { what: 'Publish one case study and compare contact-page visits', metric: 'contact-page visits', threshold: '20 a month', checkAfter: 'six weeks' },
});

// One idea per proposer, all admitted: T1 client, T2 search, T3 content, T4 conversion, T5 competitors, T6 outsider.
// The session stands in round one, waiting for the attackers.
function examining() {
  const root = tmpDir();
  const { dir, session } = createSession(root, { date: '2026-11-15' });
  const evidence = { entries: [1, 2, 3].map((n) => ({ id: `E${n}`, grade: 'observed', source: 'https://acme.test/', date: '2026-11-15', text: `Observation number ${n}`, by: 'probe' })), data: [], missing: [], collectedAt: 'now' };
  const ctx = { root, dir, session, record: loadRecord(dir), evidence, verdicts: loadVerdicts(dir) };
  move(ctx); move(ctx); move(ctx);
  proposers(session).forEach((role, n) => ok(say(ctx, role, [hyp(n + 1)])));
  move(ctx);
  ctx.ideas = ok(saveDocket(ctx, { admitted: ctx.record.threads.map((t) => ({ thread: t.id })) }, { ideas: [], date: '2026-11-15' })).ideas;
  move(ctx);
  assert.deepEqual([session.phase, session.round, session.step], ['examine', 1, 'attack']);
  assert.equal(thread(ctx.record, 'T2').by, 'search');
  return ctx;
}

const steelman = (t) => ({ type: 'steelman', thread: t, text: `In its strongest form, ${t} says that proof brings enquiries, ${LONG}` });
const attack = (t, extra = {}) => ({ type: 'attack', thread: t, kind: 'evidence', text: `The numbers behind ${t} read another way, ${LONG}`, ...extra });
const question = (t, extra = {}) => ({ type: 'question', thread: t, for: 'data', text: `How many visits does the services page get in a month, ${LONG}`, ...extra });
const reply = (ctx, t, extra = {}) => ({
  type: 'reply', thread: t, stance: 'refute', text: `The attack on ${t} misses the point, ${LONG}`,
  to: ctx.record.statements.filter((s) => s.thread === t && s.round === ctx.session.round && ['attack', 'client', 'question'].includes(s.type)).map((s) => s.n), ...extra,
});
const statement = (ctx, n) => ctx.record.statements.find((s) => s.n === n);

// ---- Questions ----

test('a question asked beside an attack shuts nobody out: the red team still attacks and the proposer still replies', () => {
  const ctx = examining();
  const second = ctx.session.assignments.T2;
  const asked = ok(say(ctx, second, [attack('T2'), question('T2')]));
  assert.deepEqual(asked.closed, []);
  assert.equal(thread(ctx.record, 'T2').closed, null);

  // In the first session the red team's whole save was refused here, because the thread had just been closed.
  ok(say(ctx, 'red-team', [steelman('T2'), attack('T2', { kind: 'cost', text: `It costs more than it returns, ${LONG}` })]));
  ok(say(ctx, 'client', [{ type: 'client', thread: 'T2', cares: 'unsure', text: `A customer might notice this on the page, ${LONG}` }]));
  move(ctx, { force: true });
  assert.equal(ctx.session.step, 'reply');
  assert.deepEqual(turns(ctx.session, ctx.record).map((t) => [t.role, t.threads]), [['search', ['T2']]], 'the proposer has its turn');

  ok(say(ctx, 'search', [reply(ctx, 'T2', { to: ctx.record.statements.filter((s) => s.thread === 'T2' && ['attack', 'client'].includes(s.type)).map((s) => s.n) })]));
  move(ctx, { force: true });
  assert.deepEqual([ctx.session.round, ctx.session.step], [2, 'attack']);
  assert.equal(thread(ctx.record, 'T2').closed, null, 'the attackers had more than a question, so the debate goes on');
  assert.deepEqual(ctx.record.questions.map((q) => [q.thread, q.by]), [['T2', second]], 'and the question still goes to the person');
});

test('a question that is all the attackers had ends the thread, but only after the proposer has had the turn', () => {
  const ctx = examining();
  const second = ctx.session.assignments.T2;
  const { added } = ok(say(ctx, second, [question('T2')]));
  move(ctx, { force: true });
  assert.equal(ctx.session.step, 'reply', 'a question alone still gives the proposer a turn');
  assert.deepEqual(turns(ctx.session, ctx.record).map((t) => [t.role, t.threads]), [['search', ['T2']]]);
  assert.equal(thread(ctx.record, 'T2').closed, null);

  ok(say(ctx, 'search', []));
  const end = move(ctx);
  assert.deepEqual(end.closed, [{ thread: 'T2', reason: 'a question nobody present can answer' }]);
  assert.deepEqual(thread(ctx.record, 'T2').closed, { round: 1, reason: 'a question nobody present can answer', question: added[0].n });
  assert.equal(ctx.record.questions.length, 1);
});

test('the proposer may answer a question by looking: with evidence it is answered, without it stays open', () => {
  const answered = examining();
  const { added } = ok(say(answered, answered.session.assignments.T2, [question('T2')]));
  move(answered, { force: true });
  const r = ok(say(answered, 'search', [reply(answered, 'T2', { evidence: ['E2'], text: `The page view counts are in the source of the page, ${LONG}` })]));
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(answered.record.questions, [], 'an answered question is not put to the person');
  assert.deepEqual(answered.record.answered.map((q) => [q.n, q.thread, q.answeredBy]), [[added[0].n, 'T2', r.added[0].n]]);
  assert.equal(statement(answered, added[0].n).answeredBy, r.added[0].n);
  assert.deepEqual(move(answered).closed, []);
  assert.equal(thread(answered.record, 'T2').closed, null, 'the thread goes on to round two');

  const open = examining();
  ok(say(open, open.session.assignments.T2, [question('T2')]));
  move(open, { force: true });
  const bare = ok(say(open, 'search', [reply(open, 'T2', { text: `I believe the page gets enough visits, ${LONG}` })]));
  assert.match(bare.warnings.join('\n'), /T2: question \d+ stays open for the person; a question is answered by looking, so the reply that answers it cites evidence/);
  assert.equal(open.record.questions.length, 1);
  assert.deepEqual(move(open).closed, [{ thread: 'T2', reason: 'a question nobody present can answer' }]);
});

test('a proposer does not end the examination of its own idea by asking a question', () => {
  const ctx = examining();
  ok(say(ctx, 'red-team', [steelman('T2'), attack('T2')]));
  move(ctx, { force: true });
  const narrowed = { change: 'One case study, on the page for product companies only', effect: 'One more enquiry a month from that page' };
  const r = ok(say(ctx, 'search', [
    reply(ctx, 'T2', { stance: 'narrow', narrowed, text: `Then let it be smaller, ${LONG}` }),
    question('T2', { for: 'person', text: `Which client allows its results to be published, ${LONG}` }),
  ]));
  assert.deepEqual(r.closed, []);
  assert.deepEqual(move(ctx).closed, []);
  assert.deepEqual([ctx.session.round, ctx.session.step], [2, 'attack']);
  assert.ok(openThreads(ctx.record).some((t) => t.id === 'T2'), 'the narrowed claim can still be pressed by the red team');
  assert.deepEqual(ctx.record.questions.map((q) => [q.thread, q.for, q.by]), [['T2', 'person', 'search']]);
  assert.match(errorOf(say(ctx, 'search', [reply(ctx, 'T2', { to: [ctx.record.questions[0].n] })])), /a statement is one of steelman, attack, client, question/);
});

test('from round two a question is not rest: the proposer answers before the thread can close', () => {
  const ctx = examining();
  ok(say(ctx, 'red-team', [steelman('T2'), attack('T2', { evidence: ['E1'] })]));
  move(ctx, { force: true });
  ok(say(ctx, 'search', [reply(ctx, 'T2')]));
  move(ctx, { force: true });
  assert.deepEqual([ctx.session.round, ctx.session.step], [2, 'attack']);

  const { added } = ok(say(ctx, 'red-team', [question('T2', { for: 'person' })]));
  const toReply = move(ctx);
  assert.equal(ctx.session.step, 'reply');
  assert.ok(!toReply.closed.some((c) => c.thread === 'T2'), 'the other threads rest; this one waits for its proposer');
  assert.ok(toReply.closed.every((c) => c.reason === 'the attack rests'));
  assert.deepEqual(turns(ctx.session, ctx.record).map((t) => [t.role, t.threads]), [['search', ['T2']]]);
  ok(say(ctx, 'search', []));
  assert.deepEqual(move(ctx).closed, [{ thread: 'T2', reason: 'a question nobody present can answer' }]);
  assert.equal(thread(ctx.record, 'T2').closed.question, added[0].n);
  assert.equal(ctx.session.phase, 'verdict');
});

// ---- A narrower claim, its test and its kill condition ----

const smaller = {
  change: 'One case study, on the page for product companies only', effect: 'Two enquiries in eight weeks that name the case study',
  test: { what: 'Publish it with its own contact link and count the enquiries that come through that link', metric: 'enquiries through the new link', threshold: 'two in eight weeks', checkAfter: 'eight weeks', baseline: 'none: the link does not exist today' },
};

// T2 is attacked once and narrowed once; everything else rests. The session stands at the verdict.
function narrowedThread(narrowed = smaller) {
  const ctx = examining();
  ok(say(ctx, 'red-team', [steelman('T2'), attack('T2')]));
  move(ctx, { force: true });
  ok(say(ctx, 'search', [reply(ctx, 'T2', { stance: 'narrow', narrowed, text: `The attack is right about the other pages, ${LONG}` })]));
  move(ctx, { force: true });
  ok(say(ctx, 'red-team', []));
  move(ctx);
  assert.equal(ctx.session.phase, 'verdict');
  return ctx;
}
const killed = (id) => ({ thread: id, verdict: 'killed', reason: `The idea in ${id} does not hold, ${LONG}`, causeOfDeath: 'A customer would never read a case study this long' });
const others = () => ['T1', 'T3', 'T4', 'T5', 'T6'].map(killed);
const ruledNarrowed = (extra = {}) => ({
  thread: 'T2', verdict: 'narrowed', strength: 'speculative', reason: `Only a smaller form of T2 stands, as attack 12 showed, ${LONG}`, vsDoNothing: 'Even the small form answers a question visitors ask today',
  narrowed: { title: 'One short case study on one page', change: 'Publish one short case study on the page for product companies', effect: 'Two enquiries in eight weeks that name it', ...extra },
});
const rule = (ctx, ruling) => {
  ok(saveRulings(ctx, { rulings: others().concat(ruling) }));
  const { ideas } = move(ctx, { ideas: ctx.ideas, date: '2026-11-15' });
  return { ideas, child: ideas.find((i) => i.parent === 'I2'), parent: ideas.find((i) => i.id === 'I2') };
};

test('a proposer who narrows may state the test that reads the smaller claim, and never moves its own kill condition', () => {
  const ctx = examining();
  ok(say(ctx, 'red-team', [steelman('T2'), attack('T2')]));
  move(ctx, { force: true });
  const narrow = (narrowed) => say(ctx, 'search', [reply(ctx, 'T2', { stance: 'narrow', narrowed, text: `The attack is right about the other pages, ${LONG}` })]);
  assert.match(errorOf(narrow({ ...smaller, test: { what: 'Count the enquiries that come through the new link' } })), /narrowed\.test\.metric: at least 2 characters[\s\S]*narrowed\.test\.threshold[\s\S]*narrowed\.test\.checkAfter/);
  assert.match(errorOf(narrow({ ...smaller, test: 'count them' })), /narrowed\.test: say the cheapest way to find out/);
  assert.match(errorOf(narrow({ ...smaller, killCondition: 'Fewer than two enquiries through the new link in eight weeks' })), /the kill condition stays as it was proposed; you cannot move your own\. When it no longer fits the smaller claim, say so in your text: the judge sets the one that does/);
  ok(narrow(smaller));
  assert.deepEqual(ctx.record.statements.at(-1).narrowed, smaller);
  assert.equal(ctx.record.statements.find((s) => s.type === 'hypothesis' && s.thread === 'T2').hypothesis.killCondition, hyp(2).hypothesis.killCondition);
});

test('the narrowed child takes the test the proposer last stated, not the test of the idea it replaced', () => {
  const ctx = narrowedThread();
  const { child, parent } = rule(ctx, ruledNarrowed());
  assert.deepEqual(child.test, smaller.test);
  assert.equal(child.hypothesis.killCondition, parent.hypothesis.killCondition, 'only the judge gives the smaller idea another kill condition');
  assert.equal(parent.test.threshold, '20 a month', 'the parent is kept as it was proposed');
  const ruling = ctx.verdicts.rulings.find((r) => r.thread === 'T2');
  assert.deepEqual([ruling.narrowed.test, ruling.narrowed.killCondition], [smaller.test, parent.hypothesis.killCondition], 'the ruling shows what the child took');
});

test('the judge sets the kill condition and the test that fit the smaller idea; they come first', () => {
  const ctx = narrowedThread();
  const test = { what: 'Publish it and count the enquiries that name the case study', metric: 'enquiries that name it', threshold: 'three in ten weeks', checkAfter: 'ten weeks' };
  assert.match(errorOf(saveRulings(ctx, { rulings: others().concat(ruledNarrowed({ test: { what: 'Count them all' }, killCondition: 'no' })) })), /narrowed\.killCondition: at least 10 characters[\s\S]*narrowed\.test\.metric/);
  const { child, parent } = rule(ctx, ruledNarrowed({ test, killCondition: 'Fewer than three enquiries that name it in ten weeks' }));
  assert.deepEqual(child.test, test);
  assert.equal(child.hypothesis.killCondition, 'Fewer than three enquiries that name it in ten weeks');
  assert.equal(parent.hypothesis.killCondition, hyp(2).hypothesis.killCondition, 'the idea as proposed keeps its own');
});

test('a narrowing that states no test leaves the child with the test first proposed', () => {
  const ctx = narrowedThread({ change: smaller.change, effect: smaller.effect });
  const { child, parent } = rule(ctx, ruledNarrowed());
  assert.deepEqual(child.test, parent.test);
  assert.equal(child.hypothesis.killCondition, parent.hypothesis.killCondition);
});

// ---- What is printed for the reader ----

test('what the judge writes for the reader carries no labels of the debate; the reason may', () => {
  const ctx = narrowedThread();
  const save = (ruling) => errorOf(saveRulings(ctx, { rulings: others().slice(1).concat(ruledNarrowed(), ruling) }));
  const label = (field, found, what) => new RegExp(`\\[5\\]\\.${field}: "${found}" is ${what}\\. This line is printed for a reader who did not see the debate: name an idea by a few words of its title`);
  assert.match(save({ ...killed('T1'), causeOfDeath: 'The email is already on the page, as E131 shows' }), label('causeOfDeath', 'E131', 'an evidence id'));
  assert.match(save({ ...killed('T1'), causeOfDeath: 'What is left of it is carried by T19' }), label('causeOfDeath', 'T19', 'a thread id'));
  assert.match(save({ thread: 'T1', verdict: 'undecided', reason: `Nobody could say, ${LONG}`, wouldDecide: 'The answer to question 95 about the assessment' }), label('wouldDecide', 'question 95', 'a statement number'));
  assert.match(save({ thread: 'T1', verdict: 'survived', strength: 'speculative', reason: `It held, ${LONG}`, vsDoNothing: 'Even attacker B found that it helps and harms nothing' }), label('vsDoNothing', 'attacker B', 'a label of the debate'));
  assert.match(errorOf(saveRulings(ctx, { rulings: others().concat(ruledNarrowed({ killCondition: 'Fewer than two enquiries, or attack 133 still stands' })) })), /\[5\]\.narrowed\.killCondition: "attack 133" is a statement number/);
  assert.match(errorOf(saveRulings(ctx, { rulings: others().concat(ruledNarrowed({ test: { ...smaller.test, what: 'Retitle half the pages and keep them out of T17' } })) })), /\[5\]\.narrowed\.test\.what: "T17" is a thread id/);
  ok(saveRulings(ctx, { rulings: others().concat(ruledNarrowed()) }));
  assert.match(ctx.verdicts.rulings.at(-1).reason, /as attack 12 showed/, 'the reason is the working note behind the ruling');
});

test('the red team writes its notes on the set for the reader too', () => {
  const ctx = narrowedThread();
  const survived = (id) => ({ thread: id, verdict: 'survived', strength: 'speculative', reason: `The attacks on ${id} were answered, ${LONG}`, vsDoNothing: 'The services pages lose visitors today, so waiting costs enquiries' });
  ok(saveRulings(ctx, { rulings: ['T3', 'T4', 'T5', 'T6'].map(killed).concat(survived('T1'), ruledNarrowed()) }));
  move(ctx, { ideas: ctx.ideas });
  assert.equal(ctx.session.phase, 'set');
  const note = (text) => ({ kind: 'conflict', threads: ['T1', 'T2'], text });
  assert.match(errorOf(saveSetNotes(ctx, { notes: [note(`T1 and T2 both change the services page in the same weeks, ${LONG}`)] })), /\[0\]\.text: "T1" is a thread id\. This line is printed for a reader/);
  assert.match(errorOf(saveSetNotes(ctx, { notes: [note(`Both ideas rest on the form working (E96), ${LONG}`)] })), /\[0\]\.text: "E96" is an evidence id/);
  ok(saveSetNotes(ctx, { notes: [note(`The case study on the services page and the short one for product companies change the same page in the same weeks, ${LONG}`)] }));
});

// ---- Evidence from a health check ----

function projectWithRoadmap() {
  const root = tmpDir();
  const run = path.join(root, '.project-health', 'runs', '2026-11-12T0900');
  fs.mkdirSync(run, { recursive: true });
  const finding = (id, extra = {}) => ({ id, area: 'content-conversion', kind: 'issue', title: `Problem ${id}`, why: `Why ${id} costs enquiries. ${'It goes on at length. '.repeat(40)}`, severity: 'high', verified: true, ...extra });
  fs.writeFileSync(path.join(run, 'findings.json'), JSON.stringify({ run: '2026-11-12T0900', findings: [
    finding('CONV-aa11', { title: 'The contact form has never been tested end to end', verified: false }),
    finding('HOST-bb22', { area: 'hosting', title: 'No mail records were found for the domain', verified: false }),
    finding('CONV-cc33', { title: 'Only one case study shows AI work' }),
    finding('PERF-dd44', { area: 'performance', title: 'The home page is slow on phones', verified: false }),
    finding('ARCH-ee55', { area: 'architecture', title: 'One stylesheet holds every page\'s styles' }),
    finding('SEO-ff66', { area: 'seo', title: 'No share image on any page', why: 'Shared links look bare.' }),
  ] }));
  fs.writeFileSync(path.join(run, 'profile.json'), JSON.stringify({ url: 'https://acme.test' }));
  fs.writeFileSync(path.join(run, 'roadmap.json'), JSON.stringify({
    solutions: [{ id: 'S9', title: 'The home page appears fast on phones', status: 'agreed', findingIds: ['PERF-dd44'] }],
    declined: [
      { id: 'X1', findingIds: ['CONV-aa11'], resolution: 'already-fixed', reason: 'The owner confirms the contact form works end to end and is checked after every release.', decidedAt: '2026-11-13' },
      { id: 'X2', findingIds: ['HOST-bb22'], resolution: 'wrong', reason: 'A live lookup shows mail records; the check itself failed.', decidedAt: '2026-11-13' },
      { id: 'X3', findingIds: ['CONV-cc33'], resolution: 'wont-fix', reason: 'The number of AI case studies is not treated as a problem for now.', decidedAt: '2026-11-13' },
    ],
  }));
  return root;
}

test('what the people settled about a finding reaches the debate in place of the finding', () => {
  const root = projectWithRoadmap();
  const ev = collectEvidence(root, createSession(root, { date: '2026-11-15' }).session, { date: '2026-11-15' });
  const by = (id) => ev.entries.find((e) => e.source === `finding ${id}`);

  // In the first session "the contact form has never been tested" was cited four times as observed, after the owner
  // had confirmed that it works.
  assert.deepEqual(by('CONV-aa11'), {
    id: 'E1', grade: 'observed', source: 'finding CONV-aa11', date: '2026-11-13', by: 'roadmap',
    text: 'The health check reported "The contact form has never been tested end to end". The people who run the project settled it (already fixed): The owner confirms the contact form works end to end and is checked after every release.',
  });
  assert.match(by('HOST-bb22').text, /settled it \(found to be wrong\): A live lookup shows mail records/);
  assert.equal(by('HOST-bb22').by, 'roadmap');

  // A finding set aside is still true; the decision travels with it.
  assert.equal(by('CONV-cc33').grade, 'observed');
  assert.match(by('CONV-cc33').text, /^Only one case study shows AI work\. Why CONV-cc33 costs enquiries\./);
  assert.match(by('CONV-cc33').text, /… \(content-conversion, high, not to be fixed: The number of AI case studies is not treated as a problem for now\.\)$/);
});

test('a finding nobody confirmed is argued, and its notes are never cut off', () => {
  const root = projectWithRoadmap();
  const ev = collectEvidence(root, createSession(root, { date: '2026-11-15' }).session, { date: '2026-11-15' });
  const slow = ev.entries.find((e) => e.source === 'finding PERF-dd44');
  assert.equal(slow.grade, 'argued');
  assert.ok(slow.text.length <= 500);
  assert.match(slow.text, /… \(performance, high, not confirmed, planned as S9\)$/, 'the long text is cut, the notes are not');
  assert.equal(ev.entries.find((e) => e.source === 'finding SEO-ff66').text, 'No share image on any page. Shared links look bare. (seo, high)');
});

test('findings about how the project is kept are given by their title only', () => {
  const root = projectWithRoadmap();
  const ev = collectEvidence(root, createSession(root, { date: '2026-11-15' }).session, { date: '2026-11-15' });
  assert.equal(ev.entries.find((e) => e.source === 'finding ARCH-ee55').text, 'One stylesheet holds every page\'s styles. (architecture, high)');
  assert.equal(ev.entries.length, 6, 'every finding is still there to cite');
});

// ---- The track record ----

test('the ideas of the session under way are not a track record', () => {
  const by = { by: 'council', session: '2026-11-15', date: '2026-11-15' };
  const fresh = (n) => ({ title: `Idea ${n}: a case study`, proposedBy: 'content', hypothesis: hyp(n).hypothesis });
  let { ideas } = applyIdeas([], { ideas: [fresh(1), fresh(2)] }, by);
  assert.equal(trackRecord(ideas).ruled, 0);
  assert.equal(recordLine(ideas.length, trackRecord(ideas)), '2 ideas so far. None has been ruled on yet, so there is no track record.');

  ({ ideas } = applyIdeas(ideas, { ideas: [{ id: 'I1', status: 'killed', verdict: { causeOfDeath: 'The client does not allow results to be published' } }] }, by));
  assert.equal(trackRecord(ideas).ruled, 1);
  assert.equal(recordLine(ideas.length, trackRecord(ideas)), '2 ideas so far. None has survived a session yet.');

  ({ ideas } = applyIdeas(ideas, { ideas: [{ id: 'I2', status: 'survived', verdict: { strength: 'fair', vsDoNothing: 'The services pages lose visitors today' } }] }, by));
  assert.match(recordLine(ideas.length, trackRecord(ideas)), /^2 ideas so far\. Of 1 that survived: 0 worked, .* 1 waiting for the person/);
});

// ---- The prompts say what the scripts do ----

test('the prompts tell each member the rules above', () => {
  const agent = (name) => fs.readFileSync(path.join(SKILL_DIR, 'agents', `${name}.md`), 'utf8');
  assert.match(agent('_contract'), /## A question for the person/);
  assert.match(agent('_contract'), /Looking and not finding is not proof that a thing is absent/);
  for (const name of ['red-team', 'attacker', 'defender']) {
    assert.match(agent(name), /The rules for a question are in "A question for the person" above/, name);
    assert.ok(!/closes the thread and goes to the person/.test(agent(name)), `${name}: a question no longer closes a thread when it is asked`);
  }
  assert.match(agent('red-team'), /A question does not stand in for your attack/);
  assert.match(agent('defender'), /It does not close the thread and it does not answer an attack/);
  assert.match(agent('defender'), /with `"test"` when it needs another test\. The kill condition stays as you proposed it/);
  assert.match(agent('defender'), /the judge sets the kill condition of what survives/);
  assert.match(agent('judge'), /write the ones that fit into `narrowed`: a `killCondition`/);
  assert.match(agent('judge'), /The customer's voice is a member speaking as a customer/);
  assert.match(agent('proposer'), /\*\*Its test can be read here\.\*\*/);
  // What is printed for the reader is written for the reader.
  assert.match(agent('judge'), /## Two readers/);
  assert.match(agent('judge'), /printed as it is for people who did not see the debate: `vsDoNothing`, `causeOfDeath`, `wouldDecide` and all of `narrowed`/);
  assert.match(agent('set'), /Your notes are printed as they are, for people who did not see the debate/);
  for (const name of ['judge', 'set']) assert.match(agent(name), /never by its thread id/, name);
});

test('a test taken over from the proposer is not printed in the labels of the debate', () => {
  const ctx = narrowedThread({ ...smaller, test: { ...smaller.test, what: 'Retitle half the pages and keep the four pages of T18 out of it' } });
  assert.match(errorOf(saveRulings(ctx, { rulings: others().concat(ruledNarrowed()) })), /\[5\]\.narrowed\.test: the test the proposer gave with the narrowing speaks in the labels of the debate; write the test of the smaller idea here/);
  ok(saveRulings(ctx, { rulings: others().concat(ruledNarrowed({ test: { ...smaller.test, what: 'Retitle half the pages and leave the four linked case studies as they are' } })) }));
});
