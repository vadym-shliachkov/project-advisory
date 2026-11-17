import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, readJson } from '../helpers.mjs';
import { applyIdeas, MOVES, STATUSES, lineage, trackRecord, dueForCheck, ideaLine, ideasPath, loadIdeas, saveIdeas, checkDate } from '../../skills/council/scripts/lib/ideas.mjs';
import { ideas as ideaSave, COMMANDS } from '../../skills/council/scripts/commands.mjs';

const hypothesis = (n = 1) => ({
  change: `Publish case study number ${n} with the client's results`,
  effect: 'More enquiries from the services pages, about two a month',
  because: 'Visitors who see proof for their own industry are more likely to write',
  trigger: 'The services pages get visits but nobody goes on to the contact page',
  killCondition: 'No change in contact-page visits from the services pages after six weeks',
});
const fresh = (n = 1, extra = {}) => ({ title: `Case study ${n} for the services pages`, proposedBy: 'content', hypothesis: hypothesis(n), ...extra });
const by = { by: 'council', session: '2026-11-15', date: '2026-11-15' };

const save = (ideas, entries, opts = by) => {
  const r = applyIdeas(ideas, { ideas: entries }, opts);
  assert.deepEqual(r.errors, []);
  return r.ideas;
};

// What each status needs, so a move in a test is refused only for the reason the test is about.
const WITH = {
  killed: { verdict: { causeOfDeath: 'The client voice would not read a case study this long' } },
  undecided: { verdict: { wouldDecide: 'Visits to the contact page by source, from analytics' } },
  survived: { verdict: { strength: 'fair', vsDoNothing: 'The services pages lose visitors today, so waiting costs enquiries' } },
  accepted: {},
  rejected: { decision: { reason: 'The client does not allow their results to be published' } },
  later: {},
  planned: { plannedIn: 'S4 of run 2026-11-10T0900' },
  testing: { test: { what: 'Publish one case study and compare contact-page visits', checkOn: '2026-12-20' } },
  worked: { result: { found: 'Contact-page visits from services pages rose from 12 to 31 a month' } },
  failed: { result: { found: 'Contact-page visits from services pages stayed at 12 a month' } },
  inconclusive: { result: { found: 'Traffic fell over the holidays, so the numbers cannot be compared' } },
  proposed: {},
};

// Walks one idea along a path of statuses and returns the ledger.
function walk(path, ideas = save([], [fresh()])) {
  let out = ideas;
  for (const status of path) out = save(out, [{ id: out[0].id, status, ...WITH[status] }]);
  return out;
}

test('new ideas get the next id, start as proposed and carry who proposed them and when', () => {
  let ideas = save([], [fresh(1), fresh(2)]);
  assert.deepEqual(ideas.map((i) => i.id), ['I1', 'I2']);
  assert.equal(ideas[0].status, 'proposed');
  assert.deepEqual(ideas[0].history, [{ date: '2026-11-15', event: 'proposed', by: 'council', session: '2026-11-15' }]);
  ideas = save(ideas.filter((i) => i.id === 'I2'), [fresh(3)]);
  assert.equal(ideas.at(-1).id, 'I3', 'ids continue after the highest, not after the count');
});

test('an agent cannot choose an id, start an idea in another status or save without saying who it is', () => {
  assert.match(applyIdeas([], { ideas: [{ ...fresh(), id: 'I9' }] }, by).errors[0], /there is no idea I9/);
  assert.match(applyIdeas([], { ideas: [fresh(1, { status: 'survived' })] }, by).errors[0], /a new idea starts as proposed/);
  assert.match(applyIdeas([], { ideas: [fresh()] }, {}).errors[0], /Say who is saving/);
  assert.match(applyIdeas([], {}, by).errors[0], /an array of ideas is required/);
});

test('every move the ledger allows works, and each one is added to the history', () => {
  for (const path of [
    ['killed'], ['undecided', 'proposed'], ['survived', 'accepted', 'testing', 'worked'], ['survived', 'accepted', 'planned', 'testing', 'failed'],
    ['survived', 'rejected'], ['survived', 'later', 'accepted'], ['survived', 'later', 'proposed'], ['survived', 'accepted', 'testing', 'inconclusive', 'testing'],
  ]) {
    const [idea] = walk(path);
    assert.equal(idea.status, path.at(-1), path.join(' → '));
    assert.deepEqual(idea.history.map((h) => h.event), ['proposed', ...path]);
  }
  for (const [from, to] of Object.entries(MOVES)) for (const s of to) assert.ok(STATUSES.includes(s), `${from} → ${s}`);
});

test('a move the ledger does not allow is refused in plain words, and nothing is saved', () => {
  const ideas = walk(['killed']);
  const r = applyIdeas(ideas, { ideas: [{ id: 'I1', status: 'survived', ...WITH.survived }, fresh(2)] }, by);
  assert.match(r.errors[0], /I1 cannot become survived: it is killed, which is final; bring it back as a new idea/);
  assert.equal(r.ideas.length, 1, 'the valid second entry is not saved either');
  assert.match(applyIdeas(save([], [fresh()]), { ideas: [{ id: 'I1', status: 'accepted' }] }, by).errors[0], /it is proposed, and from there it can only become killed, undecided, survived/);
});

test('a status needs what makes it useful later: a cause of death, a reason, a test with a date, a result', () => {
  const proposed = save([], [fresh()]);
  assert.match(applyIdeas(proposed, { ideas: [{ id: 'I1', status: 'killed' }] }, by).errors[0], /without verdict\.causeOfDeath/);
  assert.match(applyIdeas(proposed, { ideas: [{ id: 'I1', status: 'survived', verdict: { strength: 'fair' } }] }, by).errors[0], /verdict\.vsDoNothing/);
  assert.match(applyIdeas(walk(['survived']), { ideas: [{ id: 'I1', status: 'rejected' }] }, by).errors[0], /decision\.reason/);
  assert.match(applyIdeas(walk(['survived', 'accepted']), { ideas: [{ id: 'I1', status: 'testing', test: { what: 'Publish one and compare visits' } }] }, by).errors[0], /test\.checkOn/);
  assert.match(applyIdeas(walk(['survived', 'accepted', 'testing']), { ideas: [{ id: 'I1', status: 'worked' }] }, by).errors[0], /result\.found/);
});

test("the person's decision is recorded with its date, and the reason of a rejection is kept", () => {
  const [idea] = save(walk(['survived']), [{ id: 'I1', status: 'rejected', ...WITH.rejected }], { by: 'person', date: '2026-11-17' });
  assert.deepEqual(idea.decision, { reason: WITH.rejected.decision.reason, decision: 'rejected', date: '2026-11-17' });
  assert.equal(idea.history.at(-1).by, 'person');
});

test('a killed, rejected or failed idea returns only as a new idea that says what changed', () => {
  const dead = walk(['killed']);
  assert.match(applyIdeas(dead, { ideas: [fresh(2, { returns: 'I1' })] }, by).errors[0], /I1 "Case study 1 for the services pages" was killed; say what is different now/);
  const back = save(dead, [fresh(2, { returns: 'I1', whatChanged: 'The client now allows a short, anonymised version' })]);
  assert.equal(back[1].returns, 'I1');
  assert.equal(back[0].status, 'killed', 'the old idea keeps its fate');
  assert.match(applyIdeas(dead, { ideas: [fresh(2, { returns: 'I7' })] }, by).errors[0], /there is no idea I7/);
  const open = walk(['undecided']);
  assert.deepEqual(applyIdeas(open, { ideas: [fresh(2, { returns: 'I1' })] }, by).errors, [], 'an undecided idea may be taken up again freely');
});

test('a narrowed idea keeps its lineage, and where an idea comes from cannot be rewritten', () => {
  let ideas = save([], [fresh(1)]);
  ideas = save(ideas, [fresh(2, { parent: 'I1' })]);
  ideas = save(ideas, [fresh(3, { parent: 'I2' })]);
  assert.deepEqual(lineage(ideas, 'I3').map((i) => i.id), ['I1', 'I2', 'I3']);
  assert.deepEqual(lineage(ideas, 'I1').map((i) => i.id), ['I1']);
  assert.deepEqual(lineage(ideas, 'I9'), []);
  assert.match(applyIdeas(ideas, { ideas: [{ id: 'I3', parent: 'I1' }] }, by).errors[0], /where I3 comes from cannot be changed/);
  assert.match(applyIdeas(ideas, { ideas: [fresh(4, { parent: 'I8' })] }, by).errors[0], /there is no idea I8/);
});

test('fields can be updated without a move; only a note or a move adds to the history', () => {
  let ideas = save([], [fresh()]);
  ideas = save(ideas, [{ id: 'I1', effort: 'small' }]);
  assert.equal(ideas[0].effort, 'small');
  assert.equal(ideas[0].history.length, 1);
  ideas = save(ideas, [{ id: 'I1', note: 'The client asked to see a draft first' }]);
  assert.deepEqual(ideas[0].history.at(-1), { date: '2026-11-15', event: 'note', by: 'council', session: '2026-11-15', note: 'The client asked to see a draft first' });
});

test('the ledger refuses invalid entries and secrets', () => {
  assert.match(applyIdeas([], { ideas: [{ ...fresh(), hypothesis: { change: 'Too short' } }] }, by).errors.join('\n'), /hypothesis.*killCondition/s);
  assert.match(applyIdeas([], { ideas: [fresh(1, { surprise: true })] }, by).errors[0], /unknown property "surprise"/);
  const secret = fresh(1, { hypothesis: { ...hypothesis(), trigger: 'The analytics key is AKIAIOSFODNN7EXAMPLE and anyone can read it' } });
  assert.match(applyIdeas([], { ideas: [secret] }, by).errors.join('\n'), /must not hold secrets/);
});

test('the track record counts how the survivors have done', () => {
  let ideas = [];
  const add = (path) => { ideas = [...ideas, ...walk(path, save(ideas, [fresh(ideas.length + 1)]).slice(-1)).map((i) => i)]; };
  // Each idea is walked alone and then joined, so ids repeat; give them their own.
  const paths = [['survived', 'accepted', 'testing', 'worked'], ['survived', 'accepted', 'testing', 'worked'], ['survived', 'accepted', 'testing', 'failed'], ['survived', 'accepted'], ['survived'], ['survived', 'rejected'], ['killed'], ['undecided']];
  paths.forEach(add);
  ideas = ideas.map((i, n) => ({ ...i, id: `I${n + 1}` }));
  assert.deepEqual(trackRecord(ideas), { ruled: 8, survived: 6, worked: 2, failed: 1, inconclusive: 0, testing: 0, planned: 0, notStarted: 1, later: 0, rejected: 1, awaitingDecision: 1, workedShare: 67 });
  assert.equal(trackRecord([]).workedShare, null);
});

test('an accepted idea whose change is live starts its test, and the date to read it follows from its wait', () => {
  const ready = save([], [fresh(1, { test: { what: 'Publish one case study and compare contact-page visits', checkAfter: 'six weeks' } })]);
  const accepted = save(save(ready, [{ id: 'I1', status: 'survived', ...WITH.survived }]), [{ id: 'I1', status: 'accepted' }, { id: 'I1', status: 'testing' }]);
  assert.deepEqual([accepted[0].status, accepted[0].test.checkOn, accepted[0].test.what], ['testing', '2026-12-27', 'Publish one case study and compare contact-page visits']);
  assert.equal(dueForCheck(accepted, '2026-12-27').length, 1, 'the track-record turn picks it up');
  assert.equal(checkDate('4 to 6 weeks', '2026-11-15'), '2026-12-27', 'the longer end of a range');
  assert.equal(checkDate('a month', '2026-11-15'), '2026-12-15');
  assert.equal(checkDate('after the season', '2026-11-15'), null);
});

test('the wait is read from the number that goes with its unit, never from the largest number in the text', () => {
  const from = '2026-11-16';
  // Waits the council has written in real sessions.
  assert.equal(checkDate('eight weeks, or sixteen if the pages had fewer than 300 visits together', from), '2027-01-11');
  assert.equal(checkDate('when the three pages have had 300 visits together, and no later than six months', from), '2027-05-15');
  assert.equal(checkDate('ten weeks, or when 20 submissions are in, whichever is later', from), '2027-01-25');
  assert.equal(checkDate('twelve weeks, or 24 weeks when the baseline is below 3', from), '2027-02-08');
  assert.equal(checkDate('one round of five-second tests, then six weeks of contact-page visits if analytics is shared', from), '2026-12-28');
  assert.equal(checkDate('thirteen weeks', from), '2027-02-15');
  assert.equal(checkDate('one quarter', from), '2027-02-15');
  assert.equal(checkDate('two weeks or 50 enquiries', from), '2026-11-30');
  assert.equal(checkDate('one month and two weeks', from), '2026-12-30', 'parts joined by "and" are added');
  assert.equal(checkDate('one round of five viewings', from), null, 'no unit of time: the person is asked');
});

test('the wait is counted from the day the change went live, and the save says the date', () => {
  const root = tmpDir();
  const seed = save([], [fresh(1, { test: { what: 'Publish one case study and compare contact-page visits', checkAfter: 'six weeks' } })]);
  saveIdeas(root, save(save(seed, [{ id: 'I1', status: 'survived', ...WITH.survived }]), [{ id: 'I1', status: 'accepted' }]));
  const r = ideaSave({ root, by: 'person' }, { stdin: () => JSON.stringify({ ideas: [{ id: 'I1', status: 'testing', test: { liveSince: '2026-10-20' } }] }) });
  assert.deepEqual(r.saved, [{ id: 'I1', title: 'Case study 1 for the services pages', status: 'testing', checkOn: '2026-12-01' }]);
  assert.equal(loadIdeas(root)[0].test.checkAfter, 'six weeks', 'what the council wrote stays');
});

test('ideas being tested come up when their check date has passed', () => {
  const ideas = walk(['survived', 'accepted', 'testing']);
  assert.equal(dueForCheck(ideas, '2026-12-19').length, 0);
  assert.equal(dueForCheck(ideas, '2026-12-20').length, 1);
});

test('one line per idea says its fate', () => {
  assert.equal(ideaLine(walk(['killed'])[0]), 'I1 "Case study 1 for the services pages" [content] — killed: The client voice would not read a case study this long');
  assert.match(ideaLine(walk(['survived', 'rejected'])[0]), /rejected by the person: The client does not allow/);
  assert.match(ideaLine(walk(['survived', 'accepted', 'testing'])[0]), /being tested, look on 2026-12-20/);
});

test('the ideas command writes ideas.json in the knowledge bank, sorted by id, and reports the track record', () => {
  const root = tmpDir();
  const o = { root, by: 'council', session: '2026-11-15' };
  const first = ideaSave(o, { stdin: () => JSON.stringify({ ideas: Array.from({ length: 11 }, (_, n) => fresh(n + 1)) }) });
  assert.equal(first.ok, true);
  assert.equal(first.total, 11);
  assert.deepEqual(readJson(ideasPath(root)).ideas.map((i) => i.id).slice(-3), ['I9', 'I10', 'I11'], 'sorted by number, not as text');
  const bad = ideaSave(o, { stdin: () => JSON.stringify({ ideas: [{ id: 'I1', status: 'worked' }] }) });
  assert.equal(bad.ok, false);
  assert.equal(loadIdeas(root)[0].status, 'proposed');
  assert.equal(ideaSave(o, { stdin: () => 'not json' }).ok, false);
  assert.equal(ideaSave({ root }, { stdin: () => JSON.stringify({ ideas: [fresh()] }) }).ok, false, 'who is saving is required');
  assert.equal(COMMANDS.ideas, ideaSave);
  assert.equal(ideasPath(root), path.join(root, '.project-health', 'kb', 'ideas.json'));
  assert.ok(fs.existsSync(ideasPath(root)));
});
