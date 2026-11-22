import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, readJson, PLUGIN_ROOT } from '../../council/helpers.mjs';
import { init, status, next, evidence, study, frame, context, say, verdict, save, close, digest, render } from '../../../skills/council/scripts/commands.mjs';
import { resolveSession } from '../../../skills/council/scripts/lib/session.mjs';
import { loadIdeas } from '../../../skills/council/scripts/lib/ideas.mjs';
import { detectObject, gitHead } from '../../../skills/council/scripts/lib/object.mjs';
import { cleanSvg, validateSketches } from '../../../skills/council/scripts/lib/sketch.mjs';
import { loadCards } from '../../../skills/council/scripts/lib/frame.mjs';

process.env.COUNCIL_NO_BROWSER = '1';
const stdin = (data) => ({ stdin: () => JSON.stringify(data) });
const LONG = 'which is said here at enough length to be a real statement';
const errorOf = (r) => (r.errors ?? []).join('\n');
const LAB = { kind: 'lab' };

// A small booking site: a few pages, a form, a search.
function bookingSite() {
  const root = tmpDir('lab-test-');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'guesthouse', dependencies: { next: '15.0.0', react: '19.0.0' } }));
  fs.mkdirSync(path.join(root, 'app', 'rooms'), { recursive: true });
  fs.writeFileSync(path.join(root, 'app', 'page.tsx'), 'export default function Home() { return <main>Rooms by the sea</main>; }');
  fs.writeFileSync(path.join(root, 'app', 'rooms', 'page.tsx'), 'export default function Rooms() { return <form>Book a room</form>; }');
  fs.writeFileSync(path.join(root, 'README.md'), '# Guesthouse\nThe site of a small guesthouse: rooms, a booking form and a search.');
  fs.mkdirSync(path.join(root, '.git', 'refs', 'heads'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(root, '.git', 'refs', 'heads', 'main'), `${'a'.repeat(40)}\n`);
  return root;
}

const ANATOMY = {
  kind: 'website',
  what: 'The site of a small guesthouse by the sea, where guests find a room and book it.',
  users: [{ who: 'A guest planning a short stay', jobs: ['Find a free room for given nights', 'Book it without calling'] }, { who: 'The owner', jobs: ['See the bookings of the week'] }],
  parts: [
    { name: 'The home page', does: 'Shows the house, the sea and the rooms', where: 'app/page.tsx' },
    { name: 'The rooms page', does: 'Lists the rooms with their photos and prices', where: 'app/rooms/page.tsx' },
    { name: 'The booking form', does: 'Takes the dates, the room and the guest details', where: 'app/rooms/page.tsx' },
    { name: 'The search', does: 'Finds rooms by date and number of guests', where: 'app/page.tsx' },
  ],
  knows: [{ what: 'Every search a guest made, with its dates, even when nothing was free', where: 'the search log' }],
  unused: [{ what: 'Push notifications to a guest who allowed them', why: 'The site is built on a framework that can register a service worker' }],
  journeys: ['A guest searches for dates, opens a room and books it through the form.'],
  weak: ['When nothing is free the search shows an empty page and the guest leaves.'],
  rules: ['Guest details are kept only as long as the booking needs them.'],
};
const GENRE = {
  category: 'Sites of small independent guesthouses and inns',
  kit: ['A gallery of the rooms', 'A booking form with dates', 'A map of the location', 'Reviews from past guests', 'A confirmation email', 'A price per night'],
  frontier: [{ what: 'A hotel that lets guests pick the exact room from a floor plan', who: 'A boutique hotel group', source: 'https://frontier.test/floorplan' }, { what: 'An inn that shows the view from each window', who: 'A coastal inn', source: 'https://frontier.test/views' }],
  habits: ['Guests compare three or four places in tabs before they book.'],
};
const ev = (n) => Array.from({ length: n }, (_, i) => ({ grade: 'observed', source: i % 2 ? 'app/page.tsx' : 'README.md', text: `What the project shows in file number ${i + 1}, said plainly` }));
const webEv = (n, host = 'genre.test') => Array.from({ length: n }, (_, i) => ({ grade: 'observed', source: `https://${host}/page-${i + 1}`, date: '2026-10-02', text: `What the page shows about things of this kind, number ${i + 1}` }));

const LAB_FRAME = {
  ideal: 'The guest has the right room for the right nights without searching, asking or filling anything in.',
  contradictions: [
    { want: 'To be quick for a guest who knows the dates', butThen: 'a guest who is still choosing sees nothing to help them', separate: 'Separate in time: help before the dates are known, speed after' },
    { want: 'To know the guest well enough to help', butThen: 'the guest gives away more than they want', separate: 'Separate on condition: remember only what the guest chose to keep' },
  ],
  morphology: [
    { name: 'How a guest asks', options: ['a form', 'a conversation', 'a photo of a place', 'nothing: it guesses'], now: 0 },
    { name: 'When it acts', options: ['when asked', 'before they ask', 'after they leave'], now: 0 },
    { name: 'Who else is in it', options: ['only the guest', 'a companion', 'the owner', 'other guests'], now: 0 },
  ],
  evolution: { now: 'A site the guest goes to and asks, one search at a time', next: 'A site that comes to the guest when what they wanted becomes possible' },
  questions: [
    { text: 'How might we help the guest who finds nothing free?', altitude: 'narrow' },
    { text: 'How might we let a guest book without filling in a form?', altitude: 'narrow' },
    { text: 'How might we make the site the place guests plan the whole stay?', altitude: 'wide' },
    { text: 'How might we make the house remember a guest from one stay to the next?', altitude: 'wide' },
    { text: 'How might we let guests get what they came for without opening the site at all?', altitude: 'reframe' },
    { text: 'How might we make the site better every time someone searches?', altitude: 'reframe' },
  ],
};
const PROVOCATIONS = ['The site has no pages: it is one question.', 'The guest books before they search.', 'Every room is free every night.', 'The site writes to the guest, not the other way round.', 'The house knows why you are coming.']
  .map((text, i) => ({ text, kind: ['escape', 'reversal', 'exaggeration', 'distortion', 'wishful'][i] }));

const invention = (n, extra = {}) => ({
  type: 'hypothesis', title: `Invention ${n}: the search that writes back when a room frees up`, effort: 'medium', scale: 'feature', newTo: 'category',
  hypothesis: {
    change: `Keep every search that found nothing, number ${n}, and write to the guest the moment a matching room becomes free`,
    effect: 'Guests who found nothing come back and book instead of leaving for good',
    because: 'The guests who search for dates nobody has are the ones who already want to come',
    trigger: 'The search log keeps every empty search, and the empty page is where guests leave',
    killCondition: 'Fewer than one in ten guests offered the alert accept it',
  },
  experience: ['You search for two nights in August and nothing is free.', 'The site says so, and offers to write when a room for those nights frees up.', 'Three days later a cancellation frees a room, and you get a message with a link that books it.'],
  buildsOn: ['A4', 'D1', 'U1'],
  test: { what: 'Show the offer on the empty search page for a month, with the alert sent by hand', metric: 'guests who accept the alert', threshold: 'one in ten', checkAfter: 'four weeks' },
  assumptions: ['Guests who find nothing would accept a message', 'Cancellations happen often enough to matter'], riskiest: 1, upside: 'significant',
  priorArt: { exists: 'partly', searched: 'Searched for waiting lists on booking sites of guesthouses and in restaurant booking apps', who: 'Restaurant booking apps', outcome: 'They offer a waiting list for a table', difference: 'No guesthouse site of this kind offers it, and it writes back with a booking link', evidence: ['E1'] },
  ...extra,
});

// A lab session at the study: the anatomy and the genre written.
function atStudy() {
  const root = bookingSite();
  const o = { root, ...LAB };
  const r = init({ root, url: 'https://guesthouse.test', ...LAB });
  assert.equal(r.ok, true, errorOf(r));
  assert.deepEqual([r.object.kind, r.object.from], ['website', 'detected']);
  assert.match(r.goal, /nobody has made yet/);
  assert.match(r.dir, /[\\/]\.project-health[\\/]lab[\\/]\d{4}-\d{2}-\d{2}$/);
  assert.equal(next(o).to.phase, 'evidence');
  evidence({ ...o, collect: true });
  assert.deepEqual(status(o).turns.map((t) => [t.role, Boolean(t.optional)]), [['anatomist', false], ['genre', true], ['voice', true], ['tech', true]]);
  assert.match(errorOf(next(o)), /anatomist/);
  assert.match(errorOf(next({ ...o, force: true })), /anatomy has not been saved.*cannot be skipped/);
  const text = context({ ...o, role: 'anatomist', save: true });
  assert.ok(text.startsWith('# The anatomist'));
  assert.match(text, /lab\.mjs" study --role anatomist/);
  assert.match(errorOf(study({ ...o, role: 'anatomist' }, stdin({ anatomy: { ...ANATOMY, kind: 'spaceship', knows: [], unused: [] }, evidence: ev(1) }))), /kind: what kind of thing[\s\S]*name at least one thing it knows[\s\S]*at least three files/);
  const saved = study({ ...o, role: 'anatomist' }, stdin({ anatomy: ANATOMY, evidence: ev(3) }));
  assert.equal(saved.ok, true, errorOf(saved));
  context({ ...o, role: 'genre', save: true });
  assert.match(errorOf(study({ ...o, role: 'genre' }, stdin({ genre: GENRE, evidence: ev(3) }))), /needs the address of the page/);
  assert.equal(study({ ...o, role: 'genre' }, stdin({ genre: GENRE, evidence: webEv(3) })).ok, true);
  assert.equal(evidence({ ...o, role: 'voice' }, stdin({ evidence: webEv(2, 'reviews.test') })).ok, true);
  const moved = next(o);
  assert.deepEqual([moved.to.phase, moved.ok], ['study', true], errorOf(moved));
  return o;
}

test('the kind of thing is guessed from its files, and the person or the anatomist can say otherwise', () => {
  const root = tmpDir('lab-detect-');
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  assert.equal(detectObject(root).kind, 'other');
  assert.deepEqual([detectObject(root, { url: 'https://x.test' }).kind, detectObject(root, { url: 'https://x.test' }).confidence], ['website', 'low']);
  write('package.json', JSON.stringify({ name: 'tool', bin: { tool: 'cli.js' } }));
  assert.equal(detectObject(root).kind, 'cli');
  write('package.json', JSON.stringify({ name: 'app', dependencies: { next: '15', '@prisma/client': '5' } }));
  assert.equal(detectObject(root).kind, 'web-app');
  write('package.json', JSON.stringify({ name: 'app', dependencies: { expo: '50' } }));
  assert.equal(detectObject(root).kind, 'mobile-app');
  write('manifest.json', JSON.stringify({ manifest_version: 3 }));
  assert.equal(detectObject(root).kind, 'extension');
  write('skills/x/SKILL.md', '---\nname: x\n---');
  assert.equal(detectObject(root).kind, 'plugin');
  const lib = tmpDir('lab-detect-');
  fs.writeFileSync(path.join(lib, 'Cargo.toml'), '[package]\nname = "x"');
  assert.equal(detectObject(lib).kind, 'library');
  assert.equal(gitHead(lib), null);
  assert.equal(gitHead(bookingSite()), 'a'.repeat(40));
  const r = init({ root: lib, object: 'game', ...LAB });
  assert.deepEqual(r.object, { kind: 'game', from: 'person' });
  assert.throws(() => init({ root: tmpDir(), object: 'spaceship', ...LAB }), /Unknown --object/);
  assert.throws(() => init({ root: tmpDir(), focus: 'the checkout' }), /for the invention lab/);
});

test('the study: the person sees what the lab understood, corrects it, and the anatomist revises it once per round of corrections', () => {
  const o = atStudy();
  assert.deepEqual(status(o).turns, []);
  assert.match(status(o).next, /study --show/);
  const shown = study({ ...o, show: true });
  assert.equal(shown.ok, true);
  assert.match(shown.kind, /^website \(a website\)$/);
  assert.ok(shown.parts.some((p) => p.startsWith('A3 The booking form')));
  assert.deepEqual(shown.genre.standardKit.slice(0, 2), ['A gallery of the rooms', 'A booking form with dates']);
  assert.match(errorOf(study({ ...o, correct: 'no' })), /in the person's words/);
  assert.equal(study({ ...o, correct: 'The owner also takes bookings by phone and types them in' }).ok, true);
  assert.deepEqual(status(o).turns.map((t) => [t.role, t.done]), [['anatomist', false]]);
  assert.match(errorOf(next(o)), /anatomist/);
  const text = context({ ...o, role: 'anatomist', save: true });
  const { dir } = resolveSession(o.root, undefined, 'lab');
  const revise = readJson(path.join(dir, 'in', 'anatomist-revise.json'));
  assert.deepEqual([revise.revise, revise.corrections], [true, ['The owner also takes bookings by phone and types them in']]);
  assert.ok(text.includes('# The anatomist'));
  const revised = { ...ANATOMY, parts: [...ANATOMY.parts, { name: 'The bookings list', does: 'Lets the owner type in bookings taken by phone', where: 'app/admin/page.tsx' }] };
  assert.equal(study({ ...o, role: 'anatomist' }, stdin({ anatomy: revised, evidence: [] })).ok, true);
  const anatomy = readJson(path.join(dir, 'anatomy.json'));
  assert.deepEqual([anatomy.anatomy.parts.length, anatomy.corrections[0].applied, Boolean(anatomy.revisedAt)], [5, true, true]);
  assert.deepEqual(status(o).turns, []);
  assert.deepEqual(next(o).to, { phase: 'frame', round: 0, step: 'frame' });
  // The anatomy is kept in the knowledge bank with the commit it describes, and reused while the code has not moved.
  const bank = readJson(path.join(o.root, '.project-health', 'kb', 'groundwork', 'anatomy.json'));
  assert.deepEqual([bank.head, bank.anatomy.anatomy.parts.length], ['a'.repeat(40), 5]);
});

test('a fresh anatomy and genre are reused by the next lab session; a new commit asks for a new anatomy', () => {
  const o = atStudy();
  close({ ...o, abandon: true, reason: 'testing reuse' });
  init({ ...o, url: 'https://guesthouse.test' });
  next(o);
  const collected = evidence({ ...o, collect: true });
  assert.deepEqual(collected.reused.map((r) => r.kind).sort(), ['anatomy', 'genre', 'voice']);
  assert.ok(status(o).turns.find((t) => t.role === 'anatomist').done);
  assert.equal(next(o).to.phase, 'study');
  assert.equal(study({ ...o, show: true }).ok, true);
  close({ ...o, abandon: true, reason: 'testing reuse' });
  fs.writeFileSync(path.join(o.root, '.git', 'refs', 'heads', 'main'), `${'b'.repeat(40)}\n`);
  init({ ...o, url: 'https://guesthouse.test' });
  next(o);
  assert.deepEqual(evidence({ ...o, collect: true }).reused.map((r) => r.kind).sort(), ['genre', 'voice']);
  assert.equal(status(o).turns.find((t) => t.role === 'anatomist').done, false);
});

// A lab session past the frame, with every seat's inventions on the table; returns at the amplify phase.
function atAmplify() {
  const o = atStudy();
  next(o);
  assert.equal(frame({ ...o, role: 'framer' }, stdin({ frame: LAB_FRAME })).ok, true);
  next(o);
  assert.equal(frame({ ...o, role: 'provocateur' }, stdin({ provocations: PROVOCATIONS })).ok, true);
  const shown = frame({ ...o, show: true });
  assert.deepEqual(shown.morphology[0], 'How a guest asks: [a form] / a conversation / a photo of a place / nothing: it guesses');
  next(o);
  const dealt = () => resolveSession(o.root, undefined, 'lab').session.dealt;
  let n = 0;
  for (const role of Object.keys(dealt().cards)) {
    const r = say({ ...o, role }, stdin({ statements: [invention(++n, { cards: [dealt().cards[role][0]], answers: dealt().framings[role][0] })] }));
    assert.equal(r.ok, true, `${role}: ${errorOf(r)}`);
  }
  assert.equal(next(o).to.step, 'second');
  const r = say({ ...o, role: 'analogist' }, stdin({ statements: [invention(++n, { provocation: 'P4', newTo: 'world', priorArt: { exists: 'no', searched: 'Searched for sites that write to the guest first' } })] }));
  assert.equal(r.ok, true, errorOf(r));
  assert.equal(next({ ...o, force: true }).to.phase, 'amplify');
  return o;
}

test('an invention belongs to the thing, says how a person would live it and how new it is, and comes from the cards of the lab', () => {
  const o = atStudy();
  next(o);
  frame({ ...o, role: 'framer' }, stdin({ frame: LAB_FRAME }));
  next(o);
  frame({ ...o, role: 'provocateur' }, stdin({ provocations: PROVOCATIONS }));
  next(o);
  const { session, dir } = resolveSession(o.root, undefined, 'lab');
  const cards = loadCards('lab');
  for (const ids of Object.values(session.dealt.cards)) assert.ok(ids.every((id) => cards.some((c) => c.id === id)), 'the lab deals its own cards');
  const material = context({ ...o, role: 'combiner', save: true });
  assert.ok(material.includes('# Your turn: invent'));
  assert.ok(material.includes('**Your ground: what the thing is made of.**'));
  assert.ok(material.includes('# The rules of the invention lab'));
  assert.match(material, /its anatomy, with the ids an invention grows from/);
  assert.match(material, /An invention on the standard kit is not one/);
  const mine = { cards: [session.dealt.cards.combiner[0]], answers: session.dealt.framings.combiner[0] };
  const errors = errorOf(say({ ...o, role: 'combiner' }, stdin({ statements: [invention(1, { ...mine, scale: 'new', experience: ['Too few'], buildsOn: ['J1', 'Z9'], newTo: 'world' })] })));
  for (const part of [/\.scale: feature/, /\.experience: three to six steps/, /Z9 is not in the anatomy/, /\.newTo: your own search found something like it/]) assert.match(errors, part);
  assert.match(errorOf(say({ ...o, role: 'combiner' }, stdin({ statements: [invention(1, { ...mine, buildsOn: ['J1', 'W1'] })] }))), /at least one part \(A…\)/);
  assert.equal(say({ ...o, role: 'combiner' }, stdin({ statements: [invention(1, mine)] })).ok, true);
  const saved = readJson(path.join(dir, 'record.json')).statements.find((s) => s.type === 'hypothesis');
  assert.deepEqual([saved.buildsOn, saved.newTo, saved.experience.length, saved.upside], [['A4', 'D1', 'U1'], 'category', 3, 'significant']);
});

// From the amplify phase to the write phase: built on, docketed, debated, ruled.
function atWrite() {
  const o = atAmplify();
  const { session, dir } = resolveSession(o.root, undefined, 'lab');
  const record = () => readJson(path.join(dir, 'record.json'));
  for (const [id, r] of Object.entries(session.assignments)) {
    const saved = say({ ...o, role: r }, stdin({ statements: [{ type: 'amplify', thread: id, text: `Make it learn which nights guests wait for, ${LONG}`, bigger: { change: 'Keep every empty search and open the nights guests wait for most', effect: 'Fewer empty nights and fewer guests lost', because: 'The waiting list shows demand before it is lost' } }] }));
    assert.equal(saved.ok, true, errorOf(saved));
  }
  assert.equal(next(o).to.phase, 'docket');
  assert.ok(context({ ...o, role: 'judge', save: true }).includes('# The docket'));
  const threads = record().threads;
  const docket = verdict({ ...o, stage: 'docket' }, stdin({ admitted: threads.slice(1).map((t) => ({ thread: t.id, novelty: 'fresh' })), refused: [{ thread: threads[0].id, reason: 'Every guesthouse site already sends a confirmation email.', ref: 'G5' }] }));
  assert.equal(docket.ok, true, errorOf(docket));
  assert.ok(loadIdeas(o.root).every((i) => i.origin === 'lab' && i.scale === 'feature'));
  assert.deepEqual([next(o).to.phase, status(o).round], ['examine', 1]);
  const roles = status(o).turns.map((t) => t.role);
  assert.deepEqual(roles.slice(0, 2), ['red-team', 'client']);
  assert.ok(roles.length > 2, 'the other seats attack too');
  const examiner = context({ ...o, role: 'red-team', save: true });
  assert.ok(examiner.startsWith('# The rules of the invention lab') && examiner.includes('# Your turn: the examiner'));
  assert.match(examiner, /"feasibility" \(the thing, as it is built, cannot do it/);
  const open = record().threads.filter((t) => t.status === 'admitted').map((t) => t.id);
  const steel = (t) => ({ type: 'steelman', thread: t, text: `At its strongest the invention keeps the guests who found nothing, ${LONG}` });
  assert.match(errorOf(say({ ...o, role: 'red-team' }, stdin({ statements: [steel(open[0]), { type: 'attack', thread: open[0], kind: 'feasibility', assumption: 7, text: `The site cannot send messages, ${LONG}` }] }))), /\.assumption: the position/);
  const attacks = open.flatMap((t) => [steel(t), { type: 'attack', thread: t, kind: 'exists', text: `Restaurant apps already do this, ${LONG}` }]);
  assert.equal(say({ ...o, role: 'red-team' }, stdin({ statements: attacks })).ok, true);
  next({ ...o, force: true });
  assert.equal(status(o).step, 'reply');
  for (const t of record().threads.filter((x) => x.status === 'admitted')) {
    const attack = record().statements.find((s) => s.thread === t.id && s.type === 'attack');
    const r = say({ ...o, role: t.by }, stdin({ statements: [{ type: 'reply', thread: t.id, stance: 'refute', to: [attack.n], text: `No guesthouse site writes back with a booking link, ${LONG}` }] }));
    assert.equal(r.ok, true, errorOf(r));
  }
  next({ ...o, force: true });
  assert.equal(status(o).round, 2);
  next({ ...o, force: true });
  assert.equal(status(o).phase, 'verdict');
  context({ ...o, role: 'judge', save: true });
  const ids = record().threads.filter((t) => t.status === 'admitted').map((t) => t.id);
  const vs = 'Today a guest who finds nothing free is lost for good';
  const rulings = ids.map((thread, i) => (i === 0
    ? { thread, verdict: 'killed', causeOfDeath: 'The leading booking apps already keep a waiting list for a room.', newTo: 'here', reason: `The exists attack stood, ${LONG}` }
    : i === 1 ? { thread, verdict: 'undecided', newTo: 'world', upside: 'transformative', riskiest: 'Whether guests would let the site write to them first', wouldDecide: 'Five guests shown the message', reason: `Nobody could tell, ${LONG}` }
      : { thread, verdict: 'survived', strength: 'speculative', newTo: 'category', feasible: 'stretch', upside: 'significant', riskiest: 'That cancellations free rooms often enough', vsDoNothing: vs, reason: `No attack stood, ${LONG}` }));
  assert.match(errorOf(verdict({ ...o, stage: 'verdict' }, stdin({ rulings: rulings.map((r) => (r.verdict === 'survived' ? { ...r, newTo: 'here' } : r)) }))), /does not survive as an invention/);
  assert.match(errorOf(verdict({ ...o, stage: 'verdict' }, stdin({ rulings: rulings.map((r) => (r.verdict === 'survived' ? { ...r, feasible: undefined } : r)) }))), /\.feasible: now/);
  assert.match(errorOf(verdict({ ...o, stage: 'verdict' }, stdin({ rulings: rulings.map((r) => (r.verdict === 'survived' ? { ...r, ventureCandidate: true } : r)) }))), /only the council hands bets/);
  assert.equal(verdict({ ...o, stage: 'verdict' }, stdin({ rulings })).ok, true);
  assert.equal(next(o).to.phase, 'set', 'the lab looks at its survivors as a set');
  assert.ok(context({ ...o, role: 'red-team', save: true }).includes('# The survivors as a set'));
  assert.equal(verdict({ ...o, stage: 'set', role: 'red-team' }, stdin({ notes: [] })).ok, true);
  assert.equal(next(o).to.phase, 'write');
  const ledger = loadIdeas(o.root);
  assert.ok(ledger.filter((i) => i.status === 'survived').every((i) => i.verdict.newTo === 'category' && i.verdict.feasible === 'stretch'));
  assert.deepEqual(status(o).turns.map((t) => t.role), ['narrator', 'writer', 'sketcher']);
  return { o, dir };
}

test('the lab debates as the council does: every seat attacks in round one, up to three rounds, and the judge rules on how new and how feasible', () => {
  atWrite();
});

// Minutes that render every statement that decided each invention, one speech each.
function minutesOf(dir) {
  const record = readJson(path.join(dir, 'record.json'));
  const must = ['hypothesis', 'attack', 'client', 'reply', 'question', 'ruling'];
  const speech = 'The member put the point plainly, and the bench listened with care.';
  const chapters = record.threads.filter((t) => t.status === 'admitted').map((t) => {
    const scenes = record.statements.filter((s) => s.thread === t.id && must.includes(s.type)).map((s) => ({ speaker: s.by, refs: [s.n], text: s.type === 'ruling' ? 'The President ruled, and gave the one reason that decided it.' : speech }));
    scenes.splice(1, 0, { aside: 'The kettle boiled, and nobody moved to take it off the stove.' });
    return { thread: t.id, line: 'Heard, argued and ruled on before the fog lifted.', pullQuote: speech, scenes };
  });
  return {
    title: 'A night on searches that find nothing',
    opening: 'The fog came up from the river early, and the members of the Society came in out of it one by one.\n\nOn the bench lay the site of a small guesthouse by the sea, and the question was what it could do that no site of its kind had ever done.',
    brief: 'The night kept the inventions that grow from what the site already knows about guests who found nothing, and let go of what the booking apps already do. One question was left for the owner.',
    chapters,
    memoriam: 'One invention was found already built across the water, and was let go with good grace.',
    closing: 'The Society adjourned after the last ruling.\n\nWhat it left on the bench was a short list of things to build and show to a few guests.',
  };
}

const SVG = '<svg viewBox="0 0 960 600"><rect x="0" y="0" width="960" height="600" fill="#f3f4f6" /><rect x="40" y="40" width="880" height="80" fill="#ffffff" stroke="#d1d5db" /><text x="60" y="90" font-size="20" font-family="sans-serif" fill="#6b7280">No room is free for those nights</text><rect x="60" y="160" width="400" height="56" rx="8" fill="#2563eb" /><text x="80" y="195" font-size="18" fill="#ffffff">Write to me when one frees up</text></svg>';

test('the inventions are written, sketched and printed with the minutes of the Society, reviewed and closed', () => {
  const { o, dir } = atWrite();
  const writer = context({ ...o, role: 'writer', save: true });
  assert.ok(writer.startsWith('# The inventions'));
  assert.match(writer, /What the lab understood about the thing \(the anatomy/);
  const sketcher = context({ ...o, role: 'sketcher', save: true });
  assert.ok(sketcher.startsWith('# The sketches'));
  const input = readJson(path.join(dir, 'in', 'sketches.json'));
  assert.equal(input.form, 'screen');
  assert.deepEqual(input.survivors[0].buildsOn.map((b) => b.id), ['A4', 'D1', 'U1']);
  assert.equal(input.survivors[0].buildsOn[0].is, 'The search');
  assert.ok(context({ ...o, role: 'narrator', save: true }).startsWith('# The minutes of the Society'));

  const ledger = loadIdeas(o.root);
  const survivors = ledger.filter((i) => i.status === 'survived');
  const killed = ledger.filter((i) => i.status === 'killed');
  assert.equal(survivors.length, 4);
  const minutes = save({ ...o, doc: 'discussion' }, stdin(minutesOf(dir)));
  assert.equal(minutes.ok, true, errorOf(minutes));
  assert.equal(minutes.complete, true);
  const doc = {
    summary: 'The lab looked for what the guesthouse site could do that no site of its kind does. Several inventions survived, all new to the category and grown from what the site already knows; each is a bet with a cheap prototype, not a plan.',
    plan: [{ text: 'Put the offer on the empty search page first: the other prototypes read from what it collects.', ideas: [survivors[0].id] }],
    survivors: survivors.map((i) => ({
      idea: i.id, sentence: 'When a search finds nothing, the site keeps it and writes to the guest when a room frees up.',
      experience: ['You search for two nights and nothing is free.', 'The site offers to write when a room frees up for those nights.', 'A cancellation frees a room, and a message arrives with a link that books it.'],
      whyNew: 'Restaurant apps keep a waiting list for a table; no guesthouse site of this kind was found that writes back with a booking link.',
      why: 'The guests who search for dates nobody has are the ones who already want to come.',
      prototype: 'Show the offer on the empty search page and send the messages by hand for a month.',
      firstStep: 'Add the offer to the empty search page.', killCondition: 'Fewer than one in ten guests offered the alert accept it.',
      upside: 'Fewer guests lost at the moment they were most ready to book.',
      survived: [{ attack: 'Restaurant apps already do this.', answer: 'No guesthouse site writes back with a booking link.' }],
      uncertain: ['Whether cancellations free rooms often enough to matter.'], fromYou: [],
    })),
    killed: killed.map((i) => ({ idea: i.id, what: 'A waiting list for a room that is already full.', strongestPoint: 'Guests who found nothing are the most willing to book.', killedBy: 'The leading booking apps already keep such a list.', couldReturn: 'Only if it did something those lists cannot do.' })),
    bets: [], questions: [],
  };
  const saved = save({ ...o, doc: 'suggestions' }, stdin(doc));
  assert.equal(saved.ok, true, errorOf(saved));
  assert.match(errorOf(next(o)), /no sketch yet: start the sketcher/);
  const bad = save({ ...o, doc: 'sketches' }, stdin({ sketches: survivors.map((i) => ({ idea: i.id, form: 'screen', caption: 'The moment a search finds nothing, and the offer to write.', svg: '<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>' })) }));
  assert.match(errorOf(bad), /<script> is not allowed/);
  assert.match(errorOf(save({ ...o, doc: 'sketches' }, stdin({ sketches: [] }))), /has no sketch: every invention that survived is sketched/);
  const sketches = survivors.map((i, n) => (n === 1
    ? { idea: i.id, form: 'terminal', caption: 'The owner sees the nights guests are waiting for, from the command line.', lines: ['$ guesthouse waiting', 'August, two nights: waiting', 'Done'] }
    : { idea: i.id, form: 'screen', caption: 'The moment a search finds nothing, and the offer to write.', svg: SVG }));
  assert.equal(save({ ...o, doc: 'sketches' }, stdin({ sketches })).ok, true);
  const printed = next(o);
  assert.equal(printed.to.phase, 'review', errorOf(printed));

  const inventions = fs.readFileSync(path.join(dir, 'inventions.html'), 'utf8');
  for (const part of ['Invention lab · The inventions', 'The inventions that survived', 'How you would live it', 'Why it is new', 'What of the thing it grows from', 'The search: Finds rooms by date', 'Smallest prototype', 'new to the category', 'feasible: stretch', '<svg', 'Write to me when one frees up', 'sketch-terminal', 'What the lab understood', 'The morphological box', '<b>a form</b>', 'The provocation wall', 'Not settled', 'Killed', 'Not debated', 'How the lab works']) assert.ok(inventions.includes(part), part);
  assert.ok(!inventions.includes('<script'), 'no script reaches the document');
  const minutesHtml = fs.readFileSync(path.join(dir, 'discussion.html'), 'utf8');
  for (const part of ['Minutes of the Society', 'The question before the Society', 'The night in brief', 'The Society adjourns', 'Mr Lemuel Hatchwell', 'Invention lab · The discussion']) assert.ok(minutesHtml.includes(part), part);
  assert.ok(!minutesHtml.includes('Minutes of the library'));
  const brief = fs.readFileSync(path.join(dir, 'brief.html'), 'utf8');
  for (const part of ['Invention lab · Decision brief', 'The inventions that survived', 'Smallest prototype', 'inventions.pdf', 'discussion.pdf']) assert.ok(brief.includes(part), part);
  const page = fs.readFileSync(path.join(dir, 'site', 'ideas', `${survivors[0].id}.html`), 'utf8');
  assert.ok(page.includes('How you would live it') && page.includes('<svg') && page.includes('Attack: it exists already'));
  assert.ok(fs.readFileSync(path.join(dir, 'site', 'method.html'), 'utf8').includes('What the lab understood'));
  assert.ok(fs.readFileSync(path.join(dir, 'site', 'discussion', 'index.html'), 'utf8').includes('Minutes of the Society'));
  assert.match(fs.readFileSync(path.join(o.root, '.project-health', 'ideas.html'), 'utf8'), /Invention lab, /);

  assert.deepEqual(status(o).turns.map((t) => t.role), ['fidelity', 'critic']);
  assert.ok(context({ ...o, role: 'critic', save: true }).startsWith('# The critic'));
  assert.match(context({ ...o, role: 'fidelity', save: true }), /minutes of the Society/);
  for (const doc of ['review-fidelity', 'review-critic']) assert.equal(save({ ...o, doc }, stdin({ verdict: 'A faithful and readable account of the night.', issues: [] })).ok, true);
  const closed = close(o);
  assert.equal(closed.ok, true, errorOf(closed));
  assert.deepEqual(Object.keys(closed.documents), ['brief', 'inventions', 'discussion']);
  assert.match(digest({ root: o.root }), /\{from the invention lab\}/);
  assert.equal(render({ ...o, session: closed.session, html: true }).ok, true, 'a closed session can be rendered again');
});

test('a sketch is rebuilt from a short list of shapes; anything active is refused', () => {
  assert.deepEqual(cleanSvg('<svg viewBox="0 0 10 10"><g transform="translate(1, 2)"><circle cx="2" cy="2" r="1" fill="red" /></g></svg>'), { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" role="img"><g transform="translate(1, 2)"><circle cx="2" cy="2" r="1" fill="red" /></g></svg>' });
  for (const [bad, why] of [
    ['<svg viewBox="0 0 10 10" onload="x()"></svg>', /"onload" on <svg> is not allowed/],
    ['<svg viewBox="0 0 10 10"><image href="https://x.test/a.png" /></svg>', /<image> is not allowed/],
    ['<svg viewBox="0 0 10 10"><rect style="fill:red" /></svg>', /"style" on <rect> is not allowed/],
    ['<svg viewBox="0 0 10 10"><rect fill="url(#g)" /></svg>', /not a value it can take/],
    ['<svg viewBox="0 0 10 10"><!-- a comment --></svg>', /no comments/],
    ['<svg viewBox="0 0 10 10">loose text</svg>', /text outside <text>/],
    ['<svg><rect /></svg>', /needs a viewBox/],
    ['<svg viewBox="0 0 10 10"><rect></svg>', /closes nothing open/],
    ['<svg viewBox="0 0 10 10"></svg><svg viewBox="0 0 10 10"></svg>', /one <svg> element only/],
    ['<div></div>', /<div> is not allowed/],
  ]) assert.match(cleanSvg(bad).errors.join('\n'), why);
  assert.equal(cleanSvg('<svg viewBox="0 0 10 10"><text x="1" y="5">Rooms &amp; views</text></svg>').svg.includes('Rooms &amp; views'), true);
  const survivors = [{ id: 'I1', title: 'One' }];
  assert.match(validateSketches({ sketches: [{ idea: 'I1', form: 'code', caption: 'How a developer would call it from code.', lines: ['a', 'b'] }] }, { survivors, form: 'code' }).errors.join('\n'), /three to forty lines/);
  assert.equal(validateSketches({ sketches: [{ idea: 'I1', form: 'code', caption: 'How a developer would call it from code.', lines: ['import x', 'x()', 'done'], language: 'js' }] }, { survivors, form: 'code' }).errors.length, 0);
});

test('the sessions of the old invention lab move to the venture board, once, with their ledger entries and goal', () => {
  const root = tmpDir('lab-migrate-');
  const old = path.join(root, '.project-health', 'lab', '2026-11-17');
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, 'session.json'), JSON.stringify({ id: '2026-11-17', kind: 'lab', phase: 'done', goal: 'What the business could become' }));
  const kb = path.join(root, '.project-health', 'kb');
  fs.mkdirSync(path.join(kb, 'groundwork'), { recursive: true });
  fs.writeFileSync(path.join(kb, 'ideas.json'), JSON.stringify({ ideas: [
    { id: 'I1', title: 'A bet of the old lab', origin: 'lab', status: 'killed', history: [{ date: '2026-11-17', event: 'proposed', by: 'lab', session: '2026-11-17' }] },
    { id: 'I2', title: 'A council idea for the lab', status: 'killed', labCandidate: true, history: [{ date: '2026-11-10', event: 'proposed', by: 'council', session: '2026-11-10' }] },
  ] }));
  fs.writeFileSync(path.join(kb, 'facts.json'), JSON.stringify({ facts: [{ key: 'lab.goal', value: 'What the business could become', source: 'human' }] }));
  fs.writeFileSync(path.join(kb, 'groundwork', 'horizon.json'), JSON.stringify({ kind: 'horizon', at: '2026-11-17', by: { skill: 'lab', session: '2026-11-17' }, entries: [] }));
  assert.match(digest({ root }), /\{from the venture board\}/);
  assert.ok(fs.existsSync(path.join(root, '.project-health', 'venture', '2026-11-17', 'session.json')));
  assert.ok(!fs.existsSync(path.join(root, '.project-health', 'lab')));
  assert.equal(readJson(path.join(root, '.project-health', 'venture', '2026-11-17', 'session.json')).kind, 'venture');
  const ideas = readJson(path.join(kb, 'ideas.json')).ideas;
  assert.deepEqual([ideas[0].origin, ideas[0].history[0].by, ideas[1].ventureCandidate, 'labCandidate' in ideas[1]], ['venture', 'venture', true, false]);
  assert.equal(readJson(path.join(kb, 'facts.json')).facts[0].key, 'venture.goal');
  assert.equal(readJson(path.join(kb, 'groundwork', 'horizon.json')).by.skill, 'venture');
  // A session of the new lab carries the kind of thing it studies, and stays where it is.
  init({ root, kind: 'lab' });
  digest({ root });
  assert.equal(fs.readdirSync(path.join(root, '.project-health', 'lab')).length, 1);
});

test('the lab skill is registered, its prompts and cards exist, and it names no real person', () => {
  const lab = path.join(PLUGIN_ROOT, 'skills', 'lab');
  const skill = fs.readFileSync(path.join(lab, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: lab\ndescription: /);
  assert.match(skill, /lab\.mjs/);
  for (const cmd of ['init', 'evidence --root', 'study --root', '--show', '--correct', 'frame --root', 'shots --root', 'render --root', 'close --root']) assert.ok(skill.includes(cmd), cmd);
  for (const f of ['_contract', 'anatomist', 'genre', 'voice', 'tech', 'framer', 'provocateur', 'proposer', 'proposer-second', 'client', 'amplifier', 'docket', 'red-team', 'attacker', 'defender', 'judge', 'set', 'narrator', 'writer', 'sketcher', 'critic', 'fidelity-review']) assert.ok(fs.existsSync(path.join(lab, 'agents', `${f}.md`)), f);
  const cast = readJson(path.join(lab, 'references', 'cast.json'));
  for (const s of cast.seats.filter((x) => x.proposes && x.role !== 'client')) assert.ok(fs.existsSync(path.join(lab, 'agents', 'roles', `${s.role}.md`)), s.role);
  assert.deepEqual(cast.seats.map((s) => s.role), ['client', 'provocateur', 'contradictions', 'combiner', 'analogist', 'technologist', 'red-team', 'judge', 'librarian']);
  const cards = loadCards('lab');
  assert.equal(new Set(cards.map((c) => c.id)).size, cards.length);
  assert.ok(new Set(cards.map((c) => c.family)).size >= 3);
  for (const f of fs.readdirSync(path.join(lab, 'agents')).filter((x) => x.endsWith('.md'))) assert.ok(!/invention lab of a council|minutes of the library/i.test(fs.readFileSync(path.join(lab, 'agents', f), 'utf8')), f);
});
