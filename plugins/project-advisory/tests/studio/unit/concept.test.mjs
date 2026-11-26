import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COMMANDS, STUDY, conceptErrors, pageErrors, findStudies, deal } from '../../../skills/studio/scripts/studio.mjs';
import { detectTech } from '../../../skills/studio/scripts/lib/probe.mjs';

process.env.COUNCIL_NO_BROWSER = '1';
const SKILL = path.resolve(import.meta.dirname, '../../../skills/studio');
const SEATS = JSON.parse(fs.readFileSync(path.join(SKILL, 'references', 'seats.json'), 'utf8')).seats.map((s) => s.role);
const CARDS = JSON.parse(fs.readFileSync(path.join(SKILL, 'references', 'cards.json'), 'utf8')).cards;
const run = (cmd, o = {}) => COMMANDS[cmd]({ ...o });
const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };
const state = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'studio.json'), 'utf8'));

// A project with every study left by an earlier session, one picture of its own, and nothing else.
function project({ kinds = Object.keys(STUDY) } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-concept-'));
  const old = path.join(root, '.project-health', 'studio', '2026-01-01');
  for (const k of kinds) put(path.join(old, 'study', `${k}.md`), `# ${k}\n${'A pottery that fires with wood for three days. '.repeat(40)}`);
  fs.mkdirSync(path.join(old, 'study', 'looks'), { recursive: true });
  put(path.join(old, 'studio.json'), { id: '2026-01-01', phase: 'done', closedSession: true, url: 'https://example.com', study: { kinds: {}, looks: [] } });
  put(path.join(root, 'img', 'kiln.jpg'), 'jpg');
  return root;
}

const concept = (over = {}) => ({
  name: 'The kiln at night',
  idea: 'The site is a kiln being fired through the night, because this pottery fires with wood for three days.',
  feeling: 'Warm patience: something slow and real is happening, and a visitor is let in to watch it.',
  world: 'A dark field lit from below by firelight; the pots appear as silhouettes in the glow; colour comes from the flame and the ash on the glaze, nothing else.',
  motion: 'The glow breathes slowly as you scroll, like a fire being stoked; pots surface from the dark one at a time; the heat rises when you stop.',
  moment: 'Scrolling to the end, the fire dies down and the first pot comes out, still glowing.',
  hero: 'A dark screen, the kiln mouth glowing low in the middle, one line of words above it.',
  inside: 'A pot page shows the pot turning in the same firelight; getting in touch is the kiln door opening.',
  type: 'A warm old-style serif, like the stamps on the pots.',
  onlyThem: 'Only a wood-firing pottery has a three-day fire to show.',
  madeOf: ['M1', 'W2'],
  ...over,
});
const seatConcept = (dealt, over = {}) => concept({ answers: dealt.framings[0], cards: [dealt.cards[0]], priorArt: { exists: 'partly', searched: 'Searched for kiln and fire sites of potteries and studios.', nearest: 'A glassworks site with a furnace video.', difference: 'Theirs is a video; here the visitor stokes the fire.' }, ...over });

const FRAME = {
  ideal: 'A visitor feels the heat of the kiln and knows within a moment that every pot here went through a three-day fire.',
  contradictions: [{ want: 'a slow fire', butThen: 'the buyer waits', separate: 'in time' }, { want: 'darkness', butThen: 'the pots are hard to see', separate: 'on condition' }],
  morphology: [{ name: 'First screen', options: ['a scene', 'an object', 'a mechanism'], now: -1 }, { name: 'Character', options: ['light', 'material', 'motion'], now: 0 }, { name: 'What moves', options: ['nothing', 'the fire', 'the visitor'], now: 0 }],
  evolution: { now: 'a brochure', next: 'a place people come back to at each firing' },
  questions: ['make the site feel like standing at the kiln?', 'let the fire tell the time?', 'make waiting the pleasure?', 'show a pot before it exists?', 'make the visitor stoke the fire?', 'make a site with no pictures of pots?'].map((t, i) => ({ text: `How might we ${t}`, altitude: i < 2 ? 'reframe' : 'wide' })),
};

const pick = (ids, chosen) => ({
  chosen,
  why: 'The strongest idea, made of what the pottery has, and it moves people.',
  rulings: ids.map((id) => ({ concept: id, ruling: id === chosen ? 'survived' : 'killed', why: 'Ruled on what was said in the debate.' })),
  borrowed: [],
  concept: {
    name: 'The kiln at night', idea: concept().idea, feeling: concept().feeling,
    story: ['Dark.', 'The glow.', 'The first pot.'],
    palette: [{ name: 'Ash', value: '#1a1714', from: 'the kiln floor' }, { name: 'Flame', value: '#ff7a1a', from: 'the fire' }],
    type: [{ role: 'All', family: 'Fraunces', source: 'fonts.bunny.net', why: 'like the stamps' }],
    forms: 'Round forms in silhouette, the kiln arch, smoke and the grain of ash on glaze.',
    imagery: 'The pottery\'s own photographs of the firing, from its photos folder.',
    motion: [1, 2, 3].map((i) => ({ name: `M${i}`, trigger: 'scroll', what: 'the glow breathes', feels: 'patience', duration: '3s', easing: 'ease-in-out' })),
    moment: { what: 'The first pot comes out.', why: 'It is what the visitor waited for.' },
    hero: 'A dark screen with the kiln mouth glowing low and one line of words above it.',
    pages: [{ page: 'A pot', what: 'The pot turning in firelight.' }],
    voice: 'Few words, like a firing log: "Day two. Stoked at four."',
    onlyThem: concept().onlyThem,
    needs: ['Photographs of the firing'],
  },
});

const GOOD_PAGE = '<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="https://fonts.bunny.net/css?family=fraunces"><script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script><svg xmlns="http://www.w3.org/2000/svg"></svg><style>@media (prefers-reduced-motion: reduce){*{animation:none}}</style><img src="assets/kiln.jpg"><h1>The kiln</h1>';
const note = (id, presses) => ({ concept: id, says: 'Close to no honoured site; one idea throughout; it would feel warm.', strongest: 'the glow of the kiln', flags: [], presses });

test('a concept is an idea with a world and motion; a rule about type, or a page where nothing moves, is refused', () => {
  assert.deepEqual(conceptErrors(concept(), 'c'), []);
  const typeRule = conceptErrors(concept({ idea: 'Type weight is the proof: settled facts get heavier type on every page of the site.' }), 'c');
  assert.ok(typeRule.some((e) => /size or weight of type/.test(e)), typeRule.join('\n'));
  assert.ok(conceptErrors(concept({ name: 'Bigger headings everywhere' }), 'c').some((e) => /size or weight of type/.test(e)));
  assert.ok(conceptErrors(concept({ motion: 'Nothing moves, on purpose: weight is a still property that must survive print and a screenshot.' }), 'c').some((e) => /Stillness/.test(e)));
  const dealt = { framings: ['H1'], cards: ['K1', 'K2', 'K3'] };
  assert.ok(conceptErrors(concept(), 'c', { dealt }).some((e) => /answers/.test(e)), 'a seat says which framing it answers');
  assert.ok(conceptErrors(seatConcept(dealt, { cards: ['K40'] }), 'c', { dealt }).some((e) => /cards/.test(e)), 'only the cards dealt');
  assert.ok(conceptErrors(seatConcept(dealt, { priorArt: { exists: 'maybe' } }), 'c', { dealt }).some((e) => /priorArt/.test(e)), 'prior art is searched');
  assert.deepEqual(conceptErrors(seatConcept(dealt), 'c', { dealt }), []);
});

test('the cards push towards worlds and motion: no card asks for type only or stillness, and every seat is dealt three families', () => {
  assert.ok(!CARDS.some((c) => /^(Type only|Nothing moves|The sentence as the picture)$/.test(c.name)));
  assert.ok(CARDS.filter((c) => c.family === 'visual').length >= 4);
  const dealt = deal({ id: 'x' }, { questions: [{ id: 'H1' }, { id: 'H2' }], contradictions: [{ id: 'T1' }] });
  for (const seat of SEATS) {
    const families = dealt[seat].cards.map((id) => CARDS.find((c) => c.id === id).family);
    assert.equal(new Set(families).size, 3, seat);
    assert.ok(dealt[seat].framings.length >= 1);
  }
  const picked = deal({ id: 'x', framingPick: ['T1'] }, { questions: [{ id: 'H1' }, { id: 'H2' }], contradictions: [{ id: 'T1' }] });
  assert.ok(picked[SEATS[0]].framings.includes('T1'), 'the person\'s pick is dealt first');
  assert.deepEqual(deal({ id: 'x' }, { questions: [{ id: 'H1' }], contradictions: [] }), deal({ id: 'x' }, { questions: [{ id: 'H1' }], contradictions: [] }), 'the deal is the same every time');
});

test('the page check lets in fonts, script CDNs and its own files, and nothing that sends or loads from elsewhere', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-page-'));
  put(path.join(dir, 'page', 'assets', 'kiln.jpg'), 'jpg');
  put(path.join(dir, 'page', 'index.html'), GOOD_PAGE);
  assert.deepEqual(pageErrors(dir), []);
  put(path.join(dir, 'page', 'index.html'), '<!doctype html><img src="https://tracker.example.com/x.png"><img src="assets/missing.png"><form></form><script>fetch("/x");localStorage.a=1</script>');
  const e = pageErrors(dir).join('\n');
  for (const want of [/tracker\.example\.com/, /missing\.png/, /a form/, /fetch/, /storage/, /viewport/, /prefers-reduced-motion/]) assert.match(e, want);
});

test('what a page is built with is read from its markup, not from what it says', () => {
  const t = detectTech('<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script><canvas></canvas><p>Built with Three.js</p><style>@media (prefers-reduced-motion: reduce){}</style>');
  assert.deepEqual(t.libraries, ['GSAP']);
  assert.equal(t.canvases, 1);
  assert.equal(t.reducedMotion, true);
});

test('studies are reused one by one while fresh, an old session counts, and --fresh studies again', () => {
  const root = project({ kinds: ['business', 'awards'] });
  const found = findStudies(root, 'x');
  assert.equal(found.kinds.business.from, '2026-01-01');
  assert.equal(found.kinds.craft, null);
  const legacy = path.join(root, '.project-health', 'studio', '2025-12-01');
  put(path.join(legacy, 'study-shown.md'), 'x');
  put(path.join(legacy, 'slop.json'), '{}');
  assert.deepEqual(findStudies(root, 'x').kinds.templates.files, [path.join('.project-health', 'studio', '2025-12-01', 'slop.json')]);
  const old = new Date(Date.now() - 40 * 86400e3);
  fs.utimesSync(path.join(legacy, 'slop.json'), old, old);
  assert.equal(findStudies(root, 'x').kinds.templates, null, 'a study older than it stays fresh is not reused');
  const r = run('init', { root, fresh: 'awards' });
  assert.deepEqual(r.toStudy.sort(), ['awards', 'craft', 'templates', 'voice'], 'the trade comes from the old session; awards are studied again on request');
  assert.equal(r.reused.business, '2026-01-01');
});

test('a session runs from the studies through the frame, concepts and the debate to one picked concept and one page', () => {
  const root = project();
  let r = run('init', { root });
  assert.equal(r.ok, true);
  assert.deepEqual(r.toStudy, []);
  assert.equal(r.url, 'https://example.com');
  const { dir } = r;
  assert.equal(run('init', { root }).ok, false, 'an unfinished session is not silently replaced');
  assert.equal(run('correct', { root, text: 'We fire twice a year now.' }).ok, true);
  assert.equal(run('next', { root }).to, 'frame');

  // The frame and the provocations, numbered by the script.
  assert.equal(run('status', { root }).turns[0].role, 'framer');
  put(path.join(dir, 'frame.json'), { ...FRAME, questions: FRAME.questions.slice(0, 3) });
  assert.ok(run('done', { root, role: 'framer' }).errors.some((e) => /six to ten/.test(e)));
  put(path.join(dir, 'frame.json'), FRAME);
  assert.equal(run('next', { root }).to, 'provoke');
  const frame = JSON.parse(fs.readFileSync(path.join(dir, 'frame.json'), 'utf8'));
  assert.equal(frame.questions[0].id, 'H1');
  assert.equal(frame.contradictions[1].id, 'T2');
  put(path.join(dir, 'provocations.json'), { provocations: ['The site has no pots.', 'The fire never goes out.', 'The visitor fires the kiln.', 'Every page is ash.', 'It takes three days to load.'].map((text) => ({ text, kind: 'escape' })) });
  assert.equal(run('framings', { root, pick: 'H9' }).ok, false);
  assert.equal(run('framings', { root, pick: 'T1' }).ok, true);
  assert.equal(run('next', { root }).to, 'concepts');
  const { dealt } = state(dir);
  assert.ok(dealt[SEATS[0]].framings.includes('T1'));

  // The seats' brief: their framings and cards, the frame, the provocations, every study; no pictures of other sites.
  const brief = run('brief', { root, role: 'material' }).markdown;
  for (const want of ['Your framings', 'Your cards', 'provocations.json', 'frame.json', 'craft.md', 'awards.md', 'corrections.md', 'Your starting place: The material']) assert.ok(brief.includes(want), want);
  assert.doesNotMatch(brief, /Pictures of honoured/);
  assert.equal(run('brief', { root, role: 'critic' }).ok, false, 'a member has no brief outside its phase');

  for (const seat of SEATS.slice(0, 5)) put(path.join(dir, 'concepts', `${seat}.json`), { concepts: [seatConcept(dealt[seat]), seatConcept(dealt[seat], { name: 'The ash glaze' })] });
  put(path.join(dir, 'concepts', 'idea.json'), { concepts: [concept()] });
  assert.ok(run('done', { root, role: 'idea' }).errors.some((e) => /answers/.test(e)));
  put(path.join(dir, 'concepts', 'idea.json'), { concepts: [seatConcept(dealt.idea), seatConcept(dealt.idea, { name: 'The ash glaze' })] });
  assert.equal(run('next', { root }).ok, false, 'next waits for the seat that has not finished');
  r = run('next', { root, force: true });
  assert.equal(r.to, 'bolder');
  const ids = JSON.parse(fs.readFileSync(path.join(dir, 'concepts.json'), 'utf8')).concepts.map((c) => c.id);
  assert.equal(ids.length, 10);

  put(path.join(dir, 'bolder.json'), { takes: ids.map((id) => ({ concept: id, text: 'Followed the fire into the footer and the contact moment, and took out the grid of pots.', bigger: { idea: 'i', world: 'w', motion: 'm' } })) });
  assert.equal(run('next', { root }).to, 'attack');

  // Round one: the critic presses C1 and C2; the visitor presses nothing. Only C1's and C2's seat replies.
  assert.match(run('brief', { root, role: 'critic' }).markdown, /Pictures of honoured/, 'the critic sees the field');
  put(path.join(dir, 'rounds', 'r1-critic.json'), { notes: ids.map((id) => note(id, ['C1', 'C2'].includes(id))) });
  put(path.join(dir, 'rounds', 'r1-visitor.json'), { notes: ids.slice(1).map((id) => note(id, false)) });
  assert.ok(run('done', { root, role: 'visitor' }).errors.some((e) => /C1/.test(e)), 'round one covers every concept');
  put(path.join(dir, 'rounds', 'r1-visitor.json'), { notes: ids.map((id) => note(id, false)) });
  r = run('next', { root });
  assert.equal(r.to, 'reply');
  const owner = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(dir, 'concepts-by-seat.json'), 'utf8')).seats.map((x) => [x.id, x.seat]));
  assert.deepEqual(run('status', { root }).turns.map((t) => t.role), [owner.C1], 'only the seat whose concepts were pressed replies');
  assert.match(run('brief', { root, role: owner.C1 }).markdown, /Your concepts that were pressed:\*\* C1, C2/);
  put(path.join(dir, 'rounds', `r1-reply-${owner.C1}.json`), { replies: [{ concept: 'C1', stance: 'narrow', says: 'The fire stays, but the visitor may skip it on the tenth visit.', change: { motion: 'The glow breathes once on arrival and then waits for the visitor.' } }, { concept: 'C2', stance: 'concede', says: 'The critic is right: it is the glassworks site.' }] });
  r = run('next', { root });
  assert.equal(r.to, 'attack');
  assert.equal(r.round, 2);
  assert.deepEqual(state(dir).open, ['C1'], 'only what is still contested goes on');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'concepts.json'), 'utf8')).concepts[0].narrowed, true);

  // Round two: nobody presses; the debate ends.
  put(path.join(dir, 'rounds', 'r2-critic.json'), { notes: [{ concept: 'C1', says: 'The narrowing answers it: this holds.', flags: [], presses: false }] });
  put(path.join(dir, 'rounds', 'r2-visitor.json'), { notes: [{ concept: 'C1', says: 'A returning buyer is no longer held up.', flags: [], presses: false }] });
  assert.equal(run('next', { root }).to, 'pick');

  put(path.join(dir, 'pick.json'), { ...pick(ids, 'C1'), rulings: pick(ids, 'C1').rulings.slice(1) });
  assert.ok(run('done', { root, role: 'judge' }).errors.some((e) => /C1/.test(e)), 'every concept gets a ruling');
  put(path.join(dir, 'pick.json'), { ...pick(ids, 'C1'), rulings: ids.map((id) => ({ concept: id, ruling: 'killed', why: 'An attack it could not answer holds.' })) });
  assert.ok(run('done', { root, role: 'judge' }).errors.some((e) => /must have survived/.test(e)), 'a killed concept cannot be picked');
  put(path.join(dir, 'pick.json'), pick(ids, 'C1'));
  assert.equal(run('next', { root }).to, 'build');

  assert.equal(run('asset', { root, from: 'img/kiln.jpg' }).src, 'assets/kiln.jpg');
  assert.equal(run('asset', { root, from: '../outside.txt' }).ok, false, 'nothing outside the project is copied in');
  put(path.join(dir, 'page', 'index.html'), GOOD_PAGE);
  r = run('next', { root });
  assert.equal(r.to, 'done', 'without a browser nobody looks, and the session says so');
  assert.ok(r.warnings.some((w) => /nobody looked/.test(w)));

  const handoff = fs.readFileSync(path.join(dir, 'concept.md'), 'utf8');
  for (const want of ['# The kiln at night', '#ff7a1a', 'Fraunces', '| M1 | scroll |', 'Photographs of the firing']) assert.ok(handoff.includes(want), want);
  assert.ok(!fs.existsSync(path.join(dir, 'record.html')), 'the record is not written unasked');

  r = run('close', { root });
  assert.equal(r.concept.name, 'The kiln at night');
  assert.equal(r.rounds, 2);
  assert.equal(r.rulings.survived, 1);
  assert.deepEqual(r.leftOut, ['provocateur']);
  assert.equal(r.studied.craft, 'reused from 2026-01-01');

  r = run('render', { root });
  const html = fs.readFileSync(r.html, 'utf8');
  for (const want of ['How might we make the site feel like standing at the kiln?', 'The site has no pots.', 'r1-critic', 'concede', 'The material', 'Ruled on what was said']) assert.ok(html.includes(want), want);
});

test('a page the stranger sends back is revised once, and the revision must be newer than the look', () => {
  const root = project();
  const { dir } = run('init', { root });
  put(path.join(dir, 'concepts.json'), { concepts: [{ id: 'C1' }, { id: 'C2' }] });
  put(path.join(dir, 'pick.json'), pick(['C1', 'C2'], 'C1'));
  put(path.join(dir, 'page', 'index.html'), GOOD_PAGE.replace('<img src="assets/kiln.jpg">', ''));
  put(path.join(dir, 'look.json'), { saw: { business: 'A pottery, perhaps a glassworks', feeling: 'warm and patient' }, verdict: 'revise', fixes: ['Show a pot sooner.'] });
  put(path.join(dir, 'studio.json'), { ...state(dir), phase: 'look' });
  assert.equal(run('next', { root }).to, 'revise');
  const earlier = new Date(Date.now() - 60000);
  fs.utimesSync(path.join(dir, 'page', 'index.html'), earlier, earlier);
  assert.ok(run('done', { root, role: 'builder' }).errors.some((e) => /revised/.test(e)));
  fs.appendFileSync(path.join(dir, 'page', 'index.html'), '<p>A pot.</p>');
  assert.equal(run('next', { root }).to, 'done');
  assert.equal(run('close', { root }).revised, true);
});

test('the debate stops after the third round even when something is still pressed', () => {
  const root = project();
  const { dir } = run('init', { root });
  put(path.join(dir, 'concepts.json'), { concepts: [{ id: 'C1' }] });
  put(path.join(dir, 'concepts-by-seat.json'), { seats: [{ id: 'C1', seat: 'idea' }] });
  put(path.join(dir, 'studio.json'), { ...state(dir), phase: 'reply', round: 3, open: ['C1'], pressed: ['C1'] });
  put(path.join(dir, 'rounds', 'r3-reply-idea.json'), { replies: [{ concept: 'C1', stance: 'defend', says: 'The fire is the business: no rival fires for three days.' }] });
  const r = run('next', { root });
  assert.equal(r.to, 'pick');
  assert.ok(state(dir).closed.some((c) => c.id === 'C1' && /last round/.test(c.why)));
});

test('the skill, its seats and every step it names exist, and the skill names only commands the script has', () => {
  const skill = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  const used = new Set([...skill.matchAll(/`ST (\w+)/g)].map((m) => m[1]));
  for (const cmd of used) assert.ok(COMMANDS[cmd], `SKILL.md uses ${cmd}`);
  for (const step of ['_rules', ...Object.keys(STUDY), 'framer', 'provocations', 'seat', 'bolder', 'critic', 'visitor', 'reply', 'judge', 'builder', 'eye']) assert.ok(fs.existsSync(path.join(SKILL, 'steps', `${step}.md`)), step);
  assert.ok(fs.existsSync(path.resolve(SKILL, '../../agents/designer.md')));
  assert.match(skill, /project-advisory:designer/);
});
