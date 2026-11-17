import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, readJson, SKILL_DIR } from '../helpers.mjs';
import { loadSession, saveSession } from '../../../skills/council/scripts/lib/session.mjs';
import { blindText } from '../../../skills/council/scripts/lib/context.mjs';
import { init, status, next, evidence, context, say, look, verdict, cast, ideas, fact } from '../../../skills/council/scripts/commands.mjs';

const stdin = (data) => ({ stdin: () => JSON.stringify(data) });
const LONG = 'which is said here at enough length to be a real statement';
const ROLES = ['client', 'search', 'content', 'conversion', 'competitors', 'outsider'];

const hyp = (n, extra = {}) => ({
  type: 'hypothesis', title: `Idea ${n}: a case study on the services page`, effort: 'small', scale: 'new',
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

// A session on disk, moved to the phase asked for.
function sessionAt(phase, opts = {}) {
  const root = tmpDir();
  const started = init({ root, url: 'https://acme.test', ...opts });
  const o = { root };
  const material = (role) => readJson(path.join(started.dir, 'in', `${role}.json`));
  const out = { root, o, dir: started.dir, material };
  if (phase === 'open') return out;
  next(o);
  evidence({ root, collect: true });
  evidence({ root, role: 'competitors' }, stdin({ evidence: [{ grade: 'observed', source: 'https://rival.test/work', text: 'The rival shows twelve case studies on its work page' }] }));
  if (phase === 'evidence') return out;
  next(o);
  if (phase === 'track-record') return out;
  next(o);
  if (phase === 'propose') return out;
  ROLES.forEach((role, n) => assert.equal(say({ root, role }, stdin({ statements: [hyp(n + 1, n === 1 ? { evidence: ['E1'] } : {})] })).ok, true));
  next(o);
  if (phase === 'docket') return out;
  assert.equal(verdict({ root, stage: 'docket' }, stdin({ admitted: ROLES.map((_, n) => ({ thread: `T${n + 1}` })) })).ok, true);
  next(o);
  if (phase === 'examine') return out;
  // Round one on T2 (proposed by search), with names where they do not belong.
  // The seat given T2 to cover; every other seat sees T2 too, and may choose to speak on it.
  const second = readJson(path.join(started.dir, 'session.json')).assignments.T2;
  say({ root, role: 'red-team' }, stdin({ statements: [
    { type: 'steelman', thread: 'T2', text: `Sir Barnaby Thistlewood means that proof brings enquiries, ${LONG}` },
    { type: 'attack', thread: 'T2', kind: 'evidence', text: `Thistlewood's numbers read another way, as Lady Honoria Fairweather would say, ${LONG}` },
  ] }));
  say({ root, role: second }, stdin({ statements: [{ type: 'attack', thread: 'T2', kind: 'cost', text: `Speaking for Content and brand, the red team is right and Dr Graves undersells it, ${LONG}` }] }));
  say({ root, role: 'client' }, stdin({ statements: [{ type: 'client', thread: 'T2', cares: 'no', text: `A customer would not scroll that far down the page, ${LONG}` }] }));
  next({ root, force: true });
  if (phase === 'reply') return { ...out, second };
  const attacks = status(o).turns.length && readJson(path.join(started.dir, 'record.json')).statements.filter((s) => s.thread === 'T2' && ['attack', 'client'].includes(s.type)).map((s) => s.n);
  say({ root, role: 'search' }, stdin({ statements: [{ type: 'reply', thread: 'T2', stance: 'refute', to: attacks, text: `The Duchess of Wexcombe will see that the search seat answered Mr Quillfeather, ${LONG}` }] }));
  next({ root, force: true });
  next({ root, force: true });
  assert.equal(status(o).phase, 'verdict');
  return { ...out, second };
}

test('a proposer is given the rules, its seat, the digest and its save command, and nothing of the others', () => {
  const { root, o, dir } = sessionAt('propose');
  say({ root, role: 'content' }, stdin({ statements: [hyp(9, { title: 'A secret idea from the content seat' })] }));
  const text = context({ ...o, role: 'search', phase: 'propose', save: true });
  for (const part of ['# The rules of the council', '# Your turn: propose', '## Your seat', 'You hold the seat of **Search and AI answers**', '**Your ground: how the site is found.**', '## Nobody is contacted', '## Inputs for this turn', '## Delivering your result']) assert.ok(text.includes(part), part);
  assert.ok(text.includes(path.join(dir, 'digest.md')));
  assert.ok(fs.readFileSync(path.join(dir, 'digest.md'), 'utf8').startsWith('# What is known about the project'));
  assert.match(text, /say --role search --root ".*" --session \d{4}-\d{2}-\d{2} <<'COUNCIL_JSON'/);
  assert.match(text, /evidence --root ".*" --session \S+ --role search <<'COUNCIL_JSON'/);
  assert.match(text, /The live site: https:\/\/acme\.test\. Open its pages yourself/);
  assert.match(text, /What this session lacks: No health check has been run/);
  assert.ok(!text.includes('Thistlewood'), 'an agent argues plainly: it is not told its character');
  assert.ok(!text.includes('A secret idea'), 'the other proposers\' ideas are not shown');
  assert.ok(!text.includes('record.json'));
  assert.match(text, /Read nothing else in the session folder/);

  const reply = context({ ...o, role: 'search' });
  assert.match(reply, /Reply with the JSON object only, as described above\. Do not write any files\./);
  assert.ok(!reply.includes("<<'COUNCIL_JSON'\n{ \"statements\""), 'without --save the agent does not save');
});

test('the customer\'s voice proposes with its own sheet', () => {
  const { o } = sessionAt('propose');
  const text = context({ ...o, role: 'client' });
  assert.ok(text.includes('# Your turn: propose'));
  assert.ok(text.includes("# Your seat: the customer's voice"));
  assert.ok(text.includes('## When you propose'));
});

test('every context counts one run, and a debating agent cannot be started once the allowance is spent', () => {
  const { root, o, dir } = sessionAt('propose');
  context({ ...o, role: 'search' });
  context({ ...o, role: 'search' });
  assert.equal(status(o).budget.spent, 2, 'a retry is a run too');
  const { session } = loadSession(root, path.basename(dir));
  saveSession(dir, { ...session, runs: 38 });
  assert.throws(() => context({ ...o, role: 'content' }), /The debate has used its 38 agent runs/);
  assert.equal(status(o).budget.spent, 38);
});

test('a context is refused when it is not that role\'s turn', () => {
  const { o } = sessionAt('propose');
  assert.throws(() => context({ ...o, role: 'red-team' }), /It is not red-team's turn: this seat does not propose ideas/);
  assert.throws(() => context({ ...o, role: 'search', phase: 'examine' }), /The session is in the propose phase, not examine/);
  assert.throws(() => context({ ...o, role: 'butler' }), /Unknown or missing --role "butler"\. The cast: client, search.*staff: track-record, casting/);
  assert.throws(() => context({ ...o, role: 'judge' }), /this seat does not propose ideas/);
  const exam = sessionAt('examine');
  say({ root: exam.root, role: 'red-team' }, stdin({ statements: [] }));
  next({ root: exam.root, force: true });
  assert.equal(status(exam.o).phase, 'verdict', 'nobody attacked, so the judge is next');
  assert.throws(() => context({ ...exam.o, role: 'search' }), /It is not search's turn: the verdict is the judge's/);
});

test('status gives every turn the one line that is the agent\'s task', () => {
  const { o, root } = sessionAt('propose');
  const s = status(o);
  assert.deepEqual(s.turns.map((t) => t.role), ROLES);
  assert.match(s.turns[1].task, /^Run node ".*council\.mjs" context --root ".*" --session \S+ --role search --phase propose --save and follow the instructions it prints\.$/);
  assert.ok(s.turns[1].task.includes(root));
  assert.deepEqual([s.turns[1].name, s.turns[1].model], ['Sir Barnaby Thistlewood', 'strongest']);
});

test('the competitor analyst looks around before anyone proposes, and that turn is optional', () => {
  const { o } = sessionAt('evidence');
  const turn = status(o).turns[0];
  assert.deepEqual([turn.role, turn.optional, turn.done], ['competitors', true, true]);
  const text = context({ ...o, role: 'competitors', save: true });
  assert.ok(text.startsWith('# Reconnaissance'));
  assert.match(text, /evidence --role competitors --root/);
  assert.match(text, /\*\*Never submit a form\.\*\*/, 'the one who looks around is told not to send anything');
  assert.throws(() => context({ ...o, role: 'search' }), /only the competitor analyst looks around/);
  assert.equal(next(o).ok, true, 'the session does not wait for an optional turn');
});

test('the docket shows every idea without its proposer', () => {
  const { o, material } = sessionAt('docket');
  const text = context({ ...o, role: 'judge', save: true });
  assert.ok(text.startsWith('# The docket'));
  assert.match(text, /verdict --stage docket --root/);
  assert.match(text, /The idea ledger: .*ideas\.json/);
  const { ideas: listed } = material('docket');
  assert.equal(listed.length, 6);
  assert.deepEqual(Object.keys(listed[0]), ['id', 'title', 'hypothesis', 'test', 'effort', 'scale', 'evidence']);
  assert.ok(!JSON.stringify(listed).includes('"by"'));
});

test('in round one each attacker gets its own threads, and its own words are marked as its own', () => {
  const { o, material, second } = sessionAt('reply');
  assert.throws(() => context({ ...o, role: 'red-team' }), /red-team has no thread to speak on in round 1, reply/);
  const text = context({ ...o, role: 'search' });
  assert.ok(text.includes('# Your turn: reply'));
  assert.ok(text.includes('You hold the seat of **Search and AI answers**'));
  const mine = material('round1-reply-search');
  assert.deepEqual([mine.round, mine.step, mine.threads.map((t) => t.id)], [1, 'reply', ['T2']]);
  assert.deepEqual(mine.threads[0].statements.map((s) => [s.type, s.by]), [['steelman', 'attacker A'], ['attack', 'attacker A'], ['attack', 'attacker B'], ['client', "the customer's voice"]]);
  assert.equal(mine.threads[0].statements[2].kind, 'cost');
  assert.ok(second);

  const exam = sessionAt('examine');
  const red = context({ ...exam.o, role: 'red-team' });
  assert.ok(red.includes('# Your turn: the red team'));
  assert.ok(!red.includes('## Your seat'));
  assert.equal(exam.material('round1-attack-red-team').threads.length, 6);
  const one = status(exam.o).turns.find((t) => !['red-team', 'client'].includes(t.role));
  assert.ok(context({ ...exam.o, role: one.role }).includes('# Your turn: attack from your own ground'));
  const given = exam.material(`round1-attack-${one.role}`).threads;
  assert.deepEqual(given.map((t) => t.id), one.threads);
  assert.equal(given.length, 5, 'a seat sees every idea that is not its own');
  assert.ok(given.some((t) => t.cover === true) && given.some((t) => t.cover === false), 'and is told which ones it must cover');
  assert.ok(context({ ...exam.o, role: 'client' }).includes('## When you judge the others\' ideas'));
  assert.equal(exam.material('round1-attack-client').threads.length, 5);
});

test('the judge reads every thread blind: no name of the cast, no seat, anywhere', () => {
  const { o, material } = sessionAt('verdict');
  const text = context({ ...o, role: 'judge', save: true });
  assert.ok(text.startsWith('# The verdict'));
  assert.match(text, /verdict --stage verdict --root/);
  const data = material('verdict');
  const raw = JSON.stringify(data);
  const cast = readJson(path.join(SKILL_DIR, 'references', 'cast.json')).seats;
  for (const name of [...cast.map((s) => s.name), 'Thistlewood', 'Fairweather', 'Graves', 'Quillfeather', 'Wexcombe', 'Barnaby', 'red team', 'Content and brand', '"search"', '"red-team"']) {
    assert.ok(!raw.toLowerCase().includes(name.toLowerCase()), `the judge's material names ${name}`);
  }
  const t2 = data.threads.find((t) => t.id === 'T2');
  assert.deepEqual(t2.statements.map((s) => s.by), ['attacker A', 'attacker A', 'attacker B', "the customer's voice", 'the proposer']);
  assert.match(t2.statements[0].text, /^the proposer means that proof brings enquiries/);
  assert.match(t2.statements[1].text, /^the proposer numbers read another way, as the customer's voice would say/);
  assert.match(t2.statements[2].text, /^Speaking for (attacker B|another member), attacker A is right and attacker A undersells it/);
  assert.match(t2.statements[4].text, /^the judge will see that the search seat answered (attacker B|another member)/);
  assert.equal(t2.strongestAllowed, 'fair', 'the proposer cited something observed');
  assert.equal(data.threads.find((t) => t.id === 'T1').strongestAllowed, 'speculative');
  assert.equal(data.threads.length, 6);
  assert.match(data.trackRecord, /6 ideas so far\. None has been ruled on yet, so there is no track record\./, 'the ideas of the session under way are not a record of failure');
  assert.equal(data.goal, 'Make potential clients see clearly what the business offers and why to choose it, on the site and beyond it, so that more of them get in touch');
});

test('blinding replaces names in every form, and leaves ordinary words alone', () => {
  const { root, dir } = sessionAt('open');
  const { session } = loadSession(root, path.basename(dir));
  const labels = new Map([['search', 'the proposer'], ['red-team', 'attacker A'], ['client', "the customer's voice"]]);
  const blind = (t) => blindText(t, session, labels);
  assert.equal(blind('SIR BARNABY THISTLEWOOD and Barnaby Thistlewood and thistlewood'), 'the proposer and the proposer and the proposer');
  assert.equal(blind("Dr Lucius Graves's point, and the Red Team's"), 'attacker A point, and attacker A');
  assert.equal(blind('Mr Ambrose Quillfeather agrees'), 'another member agrees');
  assert.equal(blind('The search results and the conversion rate matter to the client'), 'The search results and the conversion rate matter to the client');
  assert.equal(blind('A grave mistake, said gravely'), 'A grave mistake, said gravely');
});

test('the red team looks at the survivors as a set; the judge is given the notes only when one asks', () => {
  const { root, o, material } = sessionAt('verdict');
  const ruling = (thread, n) => (n < 3
    ? { thread, verdict: 'survived', strength: 'speculative', vsDoNothing: 'The services pages lose visitors today, so waiting costs enquiries', reason: `The attacks were answered, ${LONG}` }
    : { thread, verdict: 'killed', causeOfDeath: 'A customer would never read a case study this long', reason: `It does not hold, ${LONG}` });
  assert.equal(verdict({ root, stage: 'verdict' }, stdin({ rulings: ROLES.map((_, n) => ruling(`T${n + 1}`, n)) })).ok, true);
  next(o);
  assert.throws(() => context({ ...o, role: 'judge' }), /no note asks for a verdict to be looked at again/);
  const text = context({ ...o, role: 'red-team', save: true });
  assert.ok(text.startsWith('# The survivors as a set'));
  assert.match(text, /verdict --stage set --role red-team --root/);
  const set = material('set-red-team');
  assert.deepEqual(set.survivors.map((s) => [s.thread, s.verdict, s.idea.id]), [['T1', 'survived', 'T1'], ['T2', 'survived', 'T2'], ['T3', 'survived', 'T3']]);
  assert.equal(set.survivors[0].idea.statements, undefined);

  verdict({ root, stage: 'set', role: 'red-team' }, stdin({ notes: [{ kind: 'shared-assumption', threads: ['T1', 'T2'], asksRuling: true, text: `Both assume visitors read case studies at all, ${LONG}` }] }));
  const again = context({ ...o, role: 'judge', save: true });
  assert.ok(again.includes('## The set'));
  assert.match(again, /This is the second look, after the red team's notes/);
  assert.match(again, /verdict --stage set --role judge --root/);
  assert.equal(material('set-judge').notes.length, 1);
});

test('the track record is checked only when a test is due', () => {
  const { root, o, material } = sessionAt('track-record');
  assert.throws(() => context({ ...o, role: 'track-record' }), /no idea has a test whose date has passed/);
  assert.equal(status(o).dueForCheck, undefined);
  const by = { root, by: 'council' };
  ideas(by, stdin({ ideas: [{ title: 'One case study on the services page', proposedBy: 'content', hypothesis: hyp(1).hypothesis }] }));
  ideas(by, stdin({ ideas: [{ id: 'I1', status: 'survived', verdict: { strength: 'fair', vsDoNothing: 'The services pages lose visitors today' } }] }));
  ideas({ root, by: 'person' }, stdin({ ideas: [{ id: 'I1', status: 'accepted' }] }));
  ideas({ root, by: 'person' }, stdin({ ideas: [{ id: 'I1', status: 'testing', test: { what: 'Publish one case study and compare visits', checkOn: '2026-01-10' } }] }));
  const s = status(o);
  assert.deepEqual(s.dueForCheck, ['I1']);
  assert.deepEqual(s.turns.map((t) => [t.role, t.optional]), [['track-record', true]]);
  const text = context({ ...o, role: 'track-record', save: true });
  assert.ok(text.startsWith('# The track record'));
  assert.match(text, /ideas --root ".*" --by council --session/);
  assert.deepEqual(material('track-record').ideas.map((i) => i.id), ['I1']);
});

test('for another goal the five open seats are cast anew, and the same goal meets the same cast again', () => {
  const { root, o, dir } = sessionAt('open', { goal: 'More trial users who finish onboarding' });
  const offered = status(o).turns;
  assert.deepEqual(offered.map((t) => [t.role, t.optional]), [['casting', true]]);
  const text = context({ ...o, role: 'casting', save: true });
  assert.ok(text.startsWith('# Casting'));
  assert.match(text, /cast --root/);

  const seats = ['onboarding', 'pricing', 'support', 'peers', 'stranger'].map((role) => ({ role, title: `The ${role} seat`, ground: `What a new user meets in ${role}, from the first minute to the tenth.` }));
  const bad = cast(o, stdin({ seats: [{ ...seats[0], role: 'judge' }, { ...seats[1], role: 'Pricing!' }, seats[2], { ...seats[2], ground: 'Short.' }, seats[4]] }));
  assert.deepEqual(bad.errors, ['$.seats[0].role: "judge" is taken', '$.seats[1].role: a short word in lower case with hyphens', '$.seats[3].role: "support" is taken', '$.seats[3].ground: one sentence on what this seat looks at']);
  assert.match(cast(o, stdin({ seats: seats.slice(0, 4) })).errors[0], /exactly 5 seats are required/);

  const done = cast(o, stdin({ seats }));
  assert.equal(done.ok, true);
  const { session } = loadSession(root, path.basename(dir));
  assert.deepEqual(session.cast.map((s) => s.role), ['client', 'onboarding', 'pricing', 'support', 'peers', 'stranger', 'red-team', 'judge', 'librarian']);
  assert.deepEqual(session.cast.slice(1, 6).map((s) => [s.name, s.model, s.proposes]), [
    ['Miss Euphemia Larkspur', 'strongest', true], ['Professor Octavius Penhallow', 'standard', true], ['Mrs Araminta Coldstream', 'strongest', true],
    ['Mr Jasper Wyndham-Hale', 'standard', true], ['The Reverend Silas Merriweather', 'strongest', true],
  ]);
  assert.deepEqual(status(o).turns, [], 'the cast is chosen once');

  next(o); evidence({ root, collect: true }); next(o); next(o);
  const sheet = context({ ...o, role: 'onboarding' });
  assert.match(sheet, /You hold the seat of \*\*The onboarding seat\*\*\. What a new user meets in onboarding/);
  assert.equal(status(o).turns.length, 6);
  assert.match(cast(o, stdin({ seats })).errors[0], /The cast is chosen before the session starts; it is in the propose phase/);

  saveSession(dir, { ...loadSession(root, path.basename(dir)).session, phase: 'done' });
  assert.deepEqual(loadSession(root, init({ root }).session).session.cast.map((s) => s.role).slice(1, 3), ['onboarding', 'pricing'], 'the remembered goal brings its cast');
});

test('a fact about the goal does not disturb a session under way', () => {
  const { root, o } = sessionAt('propose');
  fact({ root, key: 'council.goal', value: 'Something else entirely' });
  assert.equal(status(o).goal, 'Make potential clients see clearly what the business offers and why to choose it, on the site and beyond it, so that more of them get in touch');
});

test('a refused save leaves a trace in the session, and a merged idea keeps what it would have changed', () => {
  const { root, o, dir, material } = sessionAt('docket');
  assert.equal(say({ root, role: 'search' }, stdin({ statements: [{ type: 'attack', thread: 'T1' }] })).ok, false);
  assert.equal(verdict({ root, stage: 'docket' }, stdin({ admitted: [{ thread: 'T1' }] })).ok, false);
  const log = loadSession(root, path.basename(dir)).session.refused;
  assert.deepEqual(log.map((r) => [r.role, r.command, r.phase]), [['search', 'say', 'docket'], ['judge', 'verdict docket', 'docket']]);
  assert.ok(log[1].errors >= 5 && log[1].first.length > 10);

  assert.equal(verdict({ root, stage: 'docket' }, stdin({ admitted: [{ thread: 'T1', merge: ['T2'] }, ...[3, 4, 5, 6].map((n) => ({ thread: `T${n}` }))] })).ok, true);
  next(o);
  context({ ...o, role: 'red-team' });
  const t1 = material('round1-attack-red-team').threads.find((t) => t.id === 'T1');
  assert.deepEqual(t1.alsoCovers, [{ title: 'Idea 2: a case study on the services page', change: "Publish case study number 2 with the client's results" }]);
});

test('a member may look at a page; without a browser it is told to read the page instead', () => {
  const root = tmpDir();
  init({ root, url: 'https://acme.test' });
  assert.throws(() => look({ root }), /Usage: look --url/);
  assert.throws(() => look({ root, url: 'file:///etc/passwd' }), /Only http:\/\/ and https:\/\//);
  const before = process.env.COUNCIL_NO_BROWSER;
  process.env.COUNCIL_NO_BROWSER = '1';
  try {
    const r = look({ root, url: 'https://acme.test/' });
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /No Chrome, Edge or Chromium was found/);
  } finally {
    if (before === undefined) delete process.env.COUNCIL_NO_BROWSER; else process.env.COUNCIL_NO_BROWSER = before;
  }
  // Whoever proposes or attacks is told how to look.
  const o = { root };
  next(o); evidence({ root, collect: true }); next(o); next(o);
  assert.match(context({ root, role: 'search' }), /look --root .* --url https:\/\/example\.com\/page/);
});
