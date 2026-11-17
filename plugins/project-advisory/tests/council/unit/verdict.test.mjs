import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDir } from '../helpers.mjs';
import { createSession, proposers } from '../../../skills/council/scripts/lib/session.mjs';
import { loadRecord, say, saveDocket, advance, turns, nextStep } from '../../../skills/council/scripts/lib/record.mjs';
import { loadVerdicts, saveRulings, saveSetNotes, saveSetChanges, strengthAllowed, survivors, finalise } from '../../../skills/council/scripts/lib/verdict.mjs';
import { lineage, loadIdeas } from '../../../skills/council/scripts/lib/ideas.mjs';
import { init, next, evidence, say as sayCommand, verdict, status, COMMANDS } from '../../../skills/council/scripts/commands.mjs';

const stdin = (data) => ({ stdin: () => JSON.stringify(data) });
const errorOf = (r) => r.errors.join('\n');
const ok = (r) => { assert.deepEqual(r.errors, []); return r; };
const LONG = 'which is said here at enough length to be a real statement';

const hyp = (n, evidence = []) => ({
  type: 'hypothesis', title: `Idea ${n}: a case study on the services page`, effort: 'small', scale: 'new', evidence,
  hypothesis: {
    change: `Publish case study number ${n} with the client's results`,
    effect: 'More enquiries from the services pages, about two a month',
    because: 'Visitors who see proof for their own industry are more likely to write',
    trigger: 'The services pages get visits but nobody goes on to the contact page',
    killCondition: 'No change in contact-page visits from the services pages after six weeks',
  },
  test: { what: 'Publish one case study and compare contact-page visits', metric: 'contact-page visits', threshold: '20 a month', checkAfter: 'six weeks' },
});

// Six ideas, one per proposer, debated by nobody: the session stands at the verdict.
// T1 (client) rests on a measured number, T2 (search) on something observed, the rest on argument alone.
function atVerdict() {
  const root = tmpDir();
  const { dir, session } = createSession(root, { date: '2026-11-15' });
  const evidence = { entries: [
    { id: 'E1', grade: 'measured', source: 'fact metric.enquiries', date: '2026-11-15', text: 'Twelve enquiries a month', by: 'a person' },
    { id: 'E2', grade: 'observed', source: 'https://acme.test/', date: '2026-11-15', text: 'The services page has no proof', by: 'search' },
    { id: 'E3', grade: 'argued', source: null, date: '2026-11-15', text: 'Buyers trust proof more than promises', by: 'content' },
  ], data: [], missing: [], collectedAt: 'now' };
  const ctx = { root, dir, session, record: loadRecord(dir), evidence, verdicts: loadVerdicts(dir) };
  for (let n = 0; n < 3; n++) ok(advance(ctx));
  proposers(session).forEach((role, n) => ok(say(ctx, role, [hyp(n + 1, [['E1'], ['E2'], ['E3'], [], [], []][n])])));
  ok(advance(ctx));
  ctx.ideas = ok(saveDocket(ctx, { admitted: ctx.record.threads.map((t) => ({ thread: t.id })) }, { ideas: [], date: '2026-11-15' })).ideas;
  ok(advance(ctx));
  ok(advance(ctx, { force: true }));
  assert.equal(session.phase, 'verdict');
  return ctx;
}

const survived = (thread, strength = 'speculative') => ({ thread, verdict: 'survived', strength, reason: `The attacks on ${thread} were answered, ${LONG}`, vsDoNothing: 'The services pages lose visitors today, so waiting costs enquiries' });
const killed = (thread) => ({ thread, verdict: 'killed', reason: `The idea in ${thread} does not hold, ${LONG}`, causeOfDeath: 'A customer would never read a case study this long' });
const undecided = (thread) => ({ thread, verdict: 'undecided', reason: `Nobody could say either way on ${thread}, ${LONG}`, wouldDecide: 'Visits to the contact page by source, from analytics' });
const narrowed = (thread) => ({
  thread, verdict: 'narrowed', strength: 'speculative', reason: `Only a smaller form of ${thread} stands, ${LONG}`, vsDoNothing: 'Even the small form answers a question visitors ask today',
  narrowed: { title: 'One short case study on one page', change: 'Publish one short case study on the page for product companies', effect: 'One more enquiry a month from that page' },
});
const mixed = () => [survived('T1', 'strong'), survived('T2', 'fair'), killed('T3'), undecided('T4'), narrowed('T5'), survived('T6')];

test('how strong a survivor may be called depends on the evidence its proposer cited', () => {
  const ctx = atVerdict();
  assert.deepEqual(['T1', 'T2', 'T3', 'T4'].map((t) => strengthAllowed(ctx.record, ctx.evidence, t)), ['strong', 'fair', 'speculative', 'speculative']);
  const r = saveRulings(ctx, { rulings: [survived('T1', 'strong'), survived('T2', 'strong'), survived('T3', 'fair'), survived('T4'), survived('T5'), survived('T6')] });
  assert.deepEqual(r.errors, [
    '$.rulings[1].strength: the proposer\'s evidence on T2 supports "fair" at most (strong needs measured evidence, fair needs observed)',
    '$.rulings[2].strength: the proposer\'s evidence on T3 supports "speculative" at most (strong needs measured evidence, fair needs observed)',
  ]);
});

test('every admitted idea gets exactly one ruling, with what its verdict needs', () => {
  const ctx = atVerdict();
  const text = errorOf(saveRulings(ctx, { rulings: [
    survived('T1'), survived('T1'), { ...survived('T2'), vsDoNothing: 'It is better' }, { ...killed('T3'), causeOfDeath: 'x'.repeat(161) },
    { ...undecided('T4'), wouldDecide: '' }, { ...narrowed('T5'), narrowed: undefined }, { thread: 'T9', verdict: 'survived' }, { thread: 'T6', verdict: 'buried' },
  ] }));
  assert.match(text, /\[1\]\.thread: T1 is ruled twice/);
  assert.match(text, /\[2\]\.vsDoNothing: at least 20 characters are required: say why it beats leaving the site as it is/);
  assert.match(text, /\[3\]\.causeOfDeath: at most 160 characters: the cause of death, in one line/);
  assert.match(text, /\[4\]\.wouldDecide: at least 10 characters are required: the number, the access or the answer that would decide it/);
  assert.match(text, /\[5\]\.narrowed: the smaller idea that survives/);
  assert.match(text, /\[6\]\.thread: T9 is not an admitted idea/);
  assert.match(text, /\[7\]\.verdict: one of survived, narrowed, killed, undecided/);
  assert.match(errorOf(saveRulings(ctx, { rulings: [survived('T1')] })), /T2 "Idea 2: a case study on the services page" has no ruling: every admitted idea ends in one of/);
  assert.match(errorOf(saveRulings(ctx, { rulings: [{ ...survived('T1'), reason: 'Fine.' }] })), /reason: at least 20 characters/);
  assert.match(errorOf(saveRulings(ctx, {})), /\$\.rulings: an array is required/);
  assert.equal(ctx.verdicts.rulings.length, 0);
  assert.match(errorOf(advance(ctx)), /The judge has not ruled on every admitted idea yet/);
});

test('a thread the budget cut off still needs its ruling, and the judge is told why', () => {
  const ctx = atVerdict();
  ctx.record.threads[1].closed = { round: 1, reason: 'the budget ran out', cutOff: true };
  assert.match(errorOf(saveRulings(ctx, { rulings: [survived('T1')] })), /T2 .* has no ruling.*\(it was cut off by the budget; undecided is the honest verdict unless the thread already settles it\)/);
});

test('rulings go into the record, and saving again replaces them', () => {
  const ctx = atVerdict();
  const before = ctx.record.statements.length;
  assert.deepEqual(ok(saveRulings(ctx, { rulings: mixed() })).counts, { survived: 3, narrowed: 1, killed: 1, undecided: 1 });
  ok(saveRulings(ctx, { rulings: [...mixed().slice(0, 5), killed('T6')] }));
  const rulings = ctx.record.statements.filter((s) => s.type === 'ruling');
  assert.equal(rulings.length, 6, 'the earlier rulings are replaced, not added to');
  assert.equal(ctx.record.statements.length, before + 6);
  assert.deepEqual([rulings[0].by, rulings[0].thread, rulings[0].verdict], ['judge', 'T1', 'survived']);
  assert.equal(ctx.verdicts.rulings[0].n, rulings[0].n);
  assert.deepEqual(survivors(ctx.verdicts).map((r) => r.thread), ['T1', 'T2', 'T5']);
  assert.match(nextStep(ctx.session, ctx.record, ctx.evidence, ctx.verdicts), /Every idea has its ruling/);
  ctx.session.phase = 'set';
  assert.match(errorOf(saveRulings(ctx, { rulings: mixed() })), /The verdict is saved in the verdict phase; the session is in set/);
});

test('with fewer than two survivors there is no set: the verdicts go straight into the ledger', () => {
  const ctx = atVerdict();
  ok(saveRulings(ctx, { rulings: [survived('T1', 'strong'), killed('T2'), killed('T3'), undecided('T4'), killed('T5'), killed('T6')] }));
  const moved = ok(advance(ctx, { ideas: ctx.ideas, date: '2026-11-15' }));
  assert.equal(moved.to.phase, 'write');
  assert.deepEqual(moved.ideas.map((i) => i.status), ['survived', 'killed', 'killed', 'undecided', 'killed', 'killed']);
  assert.deepEqual(moved.ideas[0].verdict, { session: '2026-11-15', strength: 'strong', vsDoNothing: 'The services pages lose visitors today, so waiting costs enquiries' });
  assert.equal(moved.ideas[1].verdict.causeOfDeath, 'A customer would never read a case study this long');
  assert.equal(moved.ideas[3].verdict.wouldDecide, 'Visits to the contact page by source, from analytics');
  assert.deepEqual(moved.ideas[0].history.map((h) => [h.event, h.by, h.session]), [['proposed', 'council', '2026-11-15'], ['survived', 'council', '2026-11-15']]);
  assert.equal(ctx.verdicts.final, true);
  assert.deepEqual(ctx.verdicts.rulings.map((r) => r.ideaId), ['I1', 'I2', 'I3', 'I4', 'I5', 'I6']);
});

test('a narrowed idea dies as proposed and its smaller child survives in its place', () => {
  const ctx = atVerdict();
  ok(saveRulings(ctx, { rulings: [killed('T1'), killed('T2'), killed('T3'), killed('T4'), narrowed('T5'), killed('T6')] }));
  const { ideas } = ok(advance(ctx, { ideas: ctx.ideas, date: '2026-11-15' }));
  const parent = ideas.find((i) => i.id === 'I5');
  const child = ideas.find((i) => i.id === 'I7');
  assert.deepEqual([parent.status, parent.verdict.causeOfDeath], ['killed', 'Too broad as proposed; it survived in a smaller form as I7']);
  assert.deepEqual([child.status, child.parent, child.title, child.proposedBy, child.verdict.strength], ['survived', 'I5', 'One short case study on one page', 'competitors', 'speculative']);
  assert.equal(child.hypothesis.change, 'Publish one short case study on the page for product companies');
  assert.equal(child.hypothesis.killCondition, parent.hypothesis.killCondition, 'the kill condition stays as it was proposed');
  assert.deepEqual(lineage(ideas, 'I7').map((i) => i.id), ['I5', 'I7']);
  assert.equal(ctx.verdicts.rulings.find((r) => r.thread === 'T5').ideaId, 'I7', 'the documents speak of the idea that lives');
  assert.deepEqual(ok(finalise(ctx, { ideas })).ideas, ideas, 'final verdicts are written once');
});

test('the red team looks at the survivors as a set; the judge is called only when it asks', () => {
  const ctx = atVerdict();
  ok(saveRulings(ctx, { rulings: mixed() }));
  assert.equal(ok(advance(ctx, { ideas: ctx.ideas })).to.phase, 'set');
  assert.deepEqual(turns(ctx.session, ctx.record, ctx.verdicts).map((t) => [t.role, t.done]), [['red-team', false]]);
  assert.match(errorOf(advance(ctx, { ideas: ctx.ideas })), /Dr Lucius Graves \(red-team\) has not taken the turn/);

  const note = (extra = {}) => ({ kind: 'conflict', threads: ['T1', 'T2'], text: `Both ideas want the same space on the services page, ${LONG}`, ...extra });
  const text = errorOf(saveSetNotes(ctx, { notes: [note({ kind: 'rivalry' }), note({ threads: ['T3'] }), note({ threads: [] }), note({ text: 'They clash.' }), note({ asksRuling: 'yes' })] }));
  assert.match(text, /\[0\]\.kind: one of conflict, shared-assumption, order, other/);
  assert.match(text, /\[1\]\.threads: T3 is not a survivor/);
  assert.match(text, /\[2\]\.threads: the survivors this is about/);
  assert.match(text, /\[3\]\.text: at least 20 characters/);
  assert.match(text, /\[4\]\.asksRuling: true when the judge should look at a verdict again/);

  assert.deepEqual(ok(saveSetNotes(ctx, { notes: [note({ kind: 'order', threads: ['T1', 'T5'] })] })), { errors: [], notes: 1, asksRuling: false });
  assert.deepEqual(turns(ctx.session, ctx.record, ctx.verdicts).map((t) => [t.role, t.done]), [['red-team', true]]);
  assert.match(nextStep(ctx.session, ctx.record, ctx.evidence, ctx.verdicts), /The set has been looked at/);

  ok(saveSetNotes(ctx, { notes: [note({ asksRuling: true })] }));
  assert.equal(ctx.record.statements.filter((s) => s.type === 'set-note').length, 1, 'saving the notes again replaces them');
  assert.deepEqual(turns(ctx.session, ctx.record, ctx.verdicts).map((t) => [t.role, t.done]), [['red-team', true], ['judge', false]]);
  assert.match(errorOf(advance(ctx, { ideas: ctx.ideas })), /Her Grace the Duchess of Wexcombe \(judge\) has not taken the turn/);
  assert.match(nextStep(ctx.session, ctx.record, ctx.evidence, ctx.verdicts), /the red team asks for a verdict to be looked at again/);
});

test('at the set stage a verdict can only be lowered: at most three, each with a reason, once', () => {
  const ctx = atVerdict();
  ok(saveRulings(ctx, { rulings: mixed() }));
  ok(advance(ctx, { ideas: ctx.ideas }));
  assert.match(errorOf(saveSetChanges(ctx, { changes: [] })), /The red team has not looked at the survivors as a set yet/);
  ok(saveSetNotes(ctx, { notes: [{ kind: 'shared-assumption', threads: ['T1', 'T2', 'T5'], asksRuling: true, text: `All three assume that visitors read case studies at all, ${LONG}` }] }));

  const lower = (thread, strength) => ({ thread, verdict: 'survived', strength, reason: `It leans on the same assumption as the others, ${LONG}` });
  assert.match(errorOf(saveSetChanges(ctx, { changes: [killed('T1'), killed('T2'), killed('T5'), killed('T6')] })), /At most 3 verdicts can change at this stage; you sent 4/);
  const text = errorOf(saveSetChanges(ctx, { changes: [lower('T1', 'strong'), lower('T2', 'strong'), killed('T3')] }));
  assert.match(text, /\[0\]\.strength: lower than "strong"; a verdict is only lowered at this stage, never raised/);
  assert.match(text, /\[1\]\.strength: lower than "fair"/);
  assert.match(text, /\[2\]\.thread: T3 is not a survivor/);
  assert.match(errorOf(saveSetChanges(ctx, { changes: [{ thread: 'T5', verdict: 'narrowed' }] })), /\[0\]\.verdict: killed, undecided, or survived with a lower strength/);
  assert.match(errorOf(saveSetChanges(ctx, { changes: [killed('T1'), undecided('T1')] })), /T1 is changed twice/);

  const r = ok(saveSetChanges(ctx, { changes: [lower('T1', 'fair'), killed('T5')] }));
  assert.equal(r.changed, 2);
  const [t1, , , , t5] = ctx.verdicts.rulings;
  assert.deepEqual([t1.verdict, t1.strength, t1.revised.fromStrength], ['survived', 'fair', 'strong']);
  assert.deepEqual([t5.verdict, t5.narrowed, t5.strength, t5.revised.from], ['killed', undefined, undefined, 'narrowed']);
  const revisions = ctx.record.statements.filter((s) => s.type === 'ruling' && s.revises);
  assert.equal(revisions.length, 2);
  assert.equal(t5.n, revisions[1].n, 'the ruling that stands is the later one');
  assert.match(errorOf(saveSetChanges(ctx, { changes: [] })), /already been looked at again; that happens once/);

  const { ideas } = ok(advance(ctx, { ideas: ctx.ideas, date: '2026-11-15' }));
  assert.equal(ctx.session.phase, 'write');
  assert.deepEqual(ideas.map((i) => i.status), ['survived', 'survived', 'killed', 'undecided', 'killed', 'survived']);
  assert.equal(ideas.length, 6, 'a narrowed idea that falls at the set stage leaves no child');
  assert.equal(ideas[0].verdict.strength, 'fair');
});

test('a red team that fails twice does not hold the session: the verdicts stand as they are', () => {
  const ctx = atVerdict();
  ok(saveRulings(ctx, { rulings: mixed() }));
  ok(advance(ctx, { ideas: ctx.ideas }));
  const moved = ok(advance(ctx, { force: true, ideas: ctx.ideas }));
  assert.equal(moved.to.phase, 'write');
  assert.deepEqual(ctx.verdicts.set, { notes: [], changes: [], skipped: true });
  assert.equal(moved.ideas.length, 7);
});

test('the commands carry a session from the verdict to final verdicts in the ledger', () => {
  const root = tmpDir();
  init({ root });
  next({ root });
  const { dir } = status({ root });
  evidence({ root, collect: true });
  next({ root }); next({ root });
  assert.equal(status({ root }).phase, 'propose');
  ['client', 'search', 'content', 'conversion', 'competitors', 'outsider'].forEach((role, n) => assert.equal(sayCommand({ root, role }, stdin({ statements: [hyp(n + 1)] })).ok, true));
  next({ root });
  assert.equal(verdict({ root, stage: 'docket' }, stdin({ admitted: [1, 2, 3, 4, 5, 6].map((n) => ({ thread: `T${n}` })) })).ok, true);
  next({ root });
  assert.equal(next({ root, force: true }).to.phase, 'verdict');

  const bad = verdict({ root, stage: 'verdict' }, stdin({ rulings: [survived('T1', 'strong')] }));
  assert.equal(bad.ok, false);
  const saved = verdict({ root, stage: 'verdict' }, stdin({ rulings: [survived('T1'), survived('T2'), killed('T3'), undecided('T4'), narrowed('T5'), killed('T6')] }));
  assert.deepEqual(saved.counts, { survived: 2, narrowed: 1, killed: 2, undecided: 1 });
  assert.deepEqual(status({ root }).verdicts, { survived: 2, narrowed: 1, killed: 2, undecided: 1, final: false });
  assert.equal(next({ root }).to.phase, 'set');
  assert.throws(() => verdict({ root, stage: 'set' }, stdin({ notes: [] })), /needs --role red-team \(the notes\) or --role judge/);
  assert.equal(verdict({ root, stage: 'set', role: 'red-team' }, stdin({ notes: [] })).ok, true);
  const done = next({ root });
  assert.deepEqual([done.to.phase, done.verdicts.final], ['write', true]);
  assert.match(done.next, /Start the librarian, who writes the minutes and the writer of the suggestions, at once\./);
  assert.deepEqual(done.turns.map((t) => [t.role, t.done]), [['narrator', false], ['writer', false]]);
  assert.deepEqual(loadIdeas(root).map((i) => `${i.id} ${i.status}`), ['I1 survived', 'I2 survived', 'I3 killed', 'I4 undecided', 'I5 killed', 'I6 killed', 'I7 survived']);
  assert.equal(loadVerdicts(dir).rulings.find((r) => r.thread === 'T5').ideaId, 'I7');
  // Set aside after the verdict, the survivors keep waiting for the person, and the result says so.
  const aside = COMMANDS.close({ root, abandon: true });
  assert.match(aside.next, /no document is printed, but the ideas that survived stay in the ledger and wait for the person/);
  assert.deepEqual(loadIdeas(root).filter((i) => i.status === 'survived').map((i) => i.id), ['I1', 'I2', 'I7']);
});
