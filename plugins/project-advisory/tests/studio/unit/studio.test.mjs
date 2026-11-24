import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, readJson, PLUGIN_ROOT } from '../../council/helpers.mjs';
import { init, status, next, evidence, study, frame, context, say, verdict, save, tile, close, digest, note, ideas, COMMANDS } from '../../../skills/council/scripts/commands.mjs';
import { resolveSession, saveSession } from '../../../skills/council/scripts/lib/session.mjs';
import { loadIdeas } from '../../../skills/council/scripts/lib/ideas.mjs';
import { loadRecord } from '../../../skills/council/scripts/lib/record.mjs';
import { loadEvidence } from '../../../skills/council/scripts/lib/evidence.mjs';
import { loadVerdicts } from '../../../skills/council/scripts/lib/verdict.mjs';
import { loadCards } from '../../../skills/council/scripts/lib/frame.mjs';
import { saveDocument } from '../../../skills/council/scripts/lib/flow.mjs';
import { cleanTile, TILE_POLICY } from '../../../skills/council/scripts/lib/tiles.mjs';
import { detectTech, validateCurrents } from '../../../skills/council/scripts/lib/field.mjs';
import { STUDIO_ATTACK_KINDS, SIGNATURES, MADE_FROM, SWAPS, SIGNATURE_RULINGS, STUDIO_SCALES } from '../../../skills/council/scripts/lib/direction.mjs';
import { validateKnowledge } from '../../../skills/project-health/scripts/lib/knowledge.mjs';

process.env.COUNCIL_NO_BROWSER = '1';
const stdin = (data) => ({ stdin: () => JSON.stringify(data) });
const LONG = 'which is said here at enough length to be a real statement';
const errorOf = (r) => (r.errors ?? []).join('\n');
const STUDIO = { kind: 'studio' };

// The site of a small pottery: a few pages and a folder of its own photographs.
function potterySite() {
  const root = tmpDir('studio-test-');
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>The pottery</title><h1>Wood-fired pots</h1><p>Made and fired here.</p>');
  fs.writeFileSync(path.join(root, 'shop.html'), '<!doctype html><title>Shop</title><h1>Pots for sale</h1>');
  fs.mkdirSync(path.join(root, 'photos'));
  fs.writeFileSync(path.join(root, 'photos', 'kiln.txt'), 'A placeholder for the photographs of the kiln.');
  fs.writeFileSync(path.join(root, 'README.md'), '# The pottery\nThe site of a small pottery that fires with wood: its pots, its kiln and a shop.');
  fs.mkdirSync(path.join(root, '.git', 'refs', 'heads'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(root, '.git', 'refs', 'heads', 'main'), `${'c'.repeat(40)}\n`);
  return root;
}

const ANATOMY = {
  kind: 'website',
  what: 'The site of a small pottery that fires its pots with wood and sells them from a shop page.',
  users: [{ who: 'Someone looking for a pot to buy', jobs: ['See what is for sale and what it costs', 'Find out how the pots are made'] }],
  parts: [
    { name: 'The home page', does: 'Says what the pottery is and shows a few pots', where: 'index.html' },
    { name: 'The shop', does: 'Lists the pots for sale with their prices', where: 'shop.html' },
    { name: 'The opening hours', does: 'Says when the workshop can be visited', where: 'index.html' },
    { name: 'The contact line', does: 'Gives the telephone number and the address', where: 'index.html' },
  ],
  material: [
    { what: 'A log of every firing kept since the kiln was built: the date, the wood and the hours', where: 'the person says they have it, on paper' },
    { what: 'Photographs of the kiln door taken from inside after each firing', where: 'photos/' },
    { what: 'The ash glaze, which no two pots share', where: 'on every pot in the shop' },
  ],
  knows: [{ what: 'Which firing each pot in the shop came from', where: 'the kiln log' }],
  unused: [{ what: 'Type that changes its weight with the width of the screen', why: 'Every current browser supports variable fonts' }],
  journeys: ['A visitor arrives from a search, looks at the pots on the home page and opens the shop.'],
  weak: ['The home page looks like every other pottery site: a large photograph and a line of centred type.'],
  rules: ['The mark of the pottery, a small flame, is not redrawn.'],
};
const SECTOR = {
  category: 'Sites of small studio potteries that sell their own work',
  kit: ['A large photograph of a pot with a centred line of type (relied on by nobody)', 'A grid of pots on white', 'An "about the maker" page', 'A shop with a basket top right (visitors rely on it)', 'Earth colours', 'A serif typeface'],
  frontier: [{ what: 'A pottery whose site is one long scroll of a single pot being thrown', who: 'A studio pottery', source: 'https://sector.test/one-pot' }, { what: 'A pottery that lists its pots like a seed catalogue', who: 'A country pottery', source: 'https://sector.test/catalogue' }],
  habits: ['Visitors arrive on a telephone from a picture they saw elsewhere.'],
};
const CURRENTS = {
  sample: Array.from({ length: 6 }, (_, i) => ({ site: `https://awards.test/site-${i + 1}`, award: `Site of the day, month ${i + 1}`, idea: `The whole site is one object that changes as you move down it, number ${i + 1}`, motion: 'The object turns as the page is scrolled', technology: i % 2 ? ['GSAP', 'Three.js'] : ['GSAP'], signature: 'The object comes apart at the end' })),
  patterns: [
    { what: 'The first screen is one slow field of colour with a single line of type on it', kind: 'layout', share: 'everywhere' },
    { what: 'The pictures obey a force: they turn and settle as the visitor moves, like weather', kind: 'motion', share: 'rising' },
    { what: 'The page is one object that changes state as the visitor scrolls', kind: 'signature', share: 'common' },
    { what: 'Type is set so large that a word fills the screen', kind: 'type', share: 'common' },
    { what: 'A page gives way to the next without a break, as one shot does in a film', kind: 'motion', share: 'common' },
    { what: 'The site is drawn in three dimensions and the visitor moves through it', kind: 'technology', share: 'rare' },
  ],
  reading: 'The honoured sites are mostly the sites of studios and of products with money behind them, whose visitors come to be impressed. Nearly all rest on one moving object; few say anything about the business.',
};
const SLOP = {
  tells: ['A soft gradient behind a centred headline', 'Three cards in a row, each an icon and two lines', 'Everything fades up as it scrolls into view', 'A rounded button that says "Get started"', 'A headline of three adjectives', 'Glass panels over a blurred blob', 'Stock photographs of hands and laptops', 'A row of grey logos under the first screen']
    .map((what, i) => ({ what, where: ['colour', 'layout', 'motion', 'components', 'words', 'components', 'imagery', 'layout'][i], why: 'It is the default of every starter kit and says nothing about the business' })),
  reading: 'A site reads as slop when every choice is the commonest one and none comes from the business.',
};
const ev = (n) => Array.from({ length: n }, (_, i) => ({ grade: 'observed', source: i % 2 ? 'index.html' : 'README.md', text: `What the project shows in file number ${i + 1}, said plainly` }));
const webEv = (n, host) => Array.from({ length: n }, (_, i) => ({ grade: 'observed', source: `https://${host}/page-${i + 1}`, date: '2026-10-02', text: `What the page shows, number ${i + 1}, said plainly` }));

const FRAME = {
  ideal: 'A visitor knows in a glance that these pots come out of a wood fire, and has the one they want before the page has finished arriving.',
  contradictions: [
    { want: 'To show the slowness of a firing', butThen: 'the visitor who wants a price waits', separate: 'Separate in space: the price is always on the screen, the fire below it' },
    { want: 'To be remembered', butThen: 'the regular buyer is tired by the third visit', separate: 'Separate on condition: the first visit differs from the tenth' },
  ],
  morphology: [
    { name: 'What the first screen is', options: ['a photograph', 'a sentence', 'the pot itself', 'a list'], now: 0 },
    { name: 'What carries the character', options: ['type', 'colour', 'the material', 'movement'], now: 1 },
    { name: 'What moves', options: ['nothing', 'only what is touched', 'one thing, slowly'], now: 0 },
  ],
  evolution: { now: 'A brochure of the pottery with a shop attached to it', next: 'A place people come back to when a kiln is opened' },
  questions: [
    { text: 'How might we make the price list something people enjoy reading?', altitude: 'narrow' },
    { text: 'How might we show a firing without a film?', altitude: 'narrow' },
    { text: 'How might we make the site feel like standing in the workshop?', altitude: 'wide' },
    { text: 'How might we make every pot carry the fire it came from?', altitude: 'wide' },
    { text: 'How might we make a site so plain that its plainness is remembered?', altitude: 'reframe' },
    { text: 'How might we let the pots speak so the site needs no words about them?', altitude: 'reframe' },
  ],
};
const PROVOCATIONS = ['The site has no pictures of the pots.', 'The visitor fires the kiln.', 'Every word is a metre tall.', 'The footer comes first.', 'The visitor can feel the heat.']
  .map((text, i) => ({ text, kind: ['escape', 'reversal', 'exaggeration', 'distortion', 'wishful'][i] }));

const DESIGN = {
  type: 'One plain typewriter face throughout, as the kiln log is written, at two sizes only',
  colour: 'The page is the colour of unglazed clay; the only other colour is the grey of wood ash',
  layout: 'One column like a ledger: a row for each firing, the pots of that firing under it',
  imagery: 'The photographs of the kiln door the pottery already takes, one for each firing, never cropped',
  motion: 'One number counts the hours of the firing a visitor is looking at; nothing else moves',
  signature: { kind: 'material', what: 'Opening a firing shows the kiln door from inside and the pots that came out of it', why: 'Nobody else in the trade shows the fire, and it is what sets this pottery apart', tenth: 'The newest firing is first, so a regular sees at once what is new and nothing replays' },
  technology: 'Plain pages and a few lines of script for the count; with less motion asked for, the number is simply shown',
  keeps: ['A basket top right, where buyers of pots look for it'],
  breaks: [{ what: 'A large photograph of one pot with a centred line', why: 'Every pottery opens that way, and it says nothing about the fire' }],
  needs: ['A photograph of the kiln door for every firing still to come'],
};
const direction = (n, extra = {}) => ({
  type: 'hypothesis', title: `Direction ${n}: the site is the kiln log`, effort: 'medium', scale: 'redesign', newTo: 'category', madeFrom: 'material',
  hypothesis: {
    change: `The site becomes the kiln log, number ${n}: every pot is shown with the firing it came from`,
    effect: 'A visitor understands at once that these pots come out of a wood fire, and trusts the price',
    because: 'The pottery has kept a log of every firing, and no other pottery shows the fire at all',
    trigger: 'The kiln log and the photographs of the kiln door, which sit unused in a folder',
    killCondition: 'Fewer than three in five people shown the first screen say the pots are wood-fired',
  },
  design: DESIGN,
  experience: ['You arrive on a page the colour of unglazed clay, with a list of firings.', 'You open the newest firing and see the kiln door from inside.', 'Under it are the pots that came out, each with its price.'],
  buildsOn: ['M1', 'M2', 'A2'],
  test: { what: 'Build the first screen and show it to five customers in the shop', metric: 'people who say the pots are wood-fired', threshold: 'three in five', checkAfter: 'two weeks' },
  assumptions: ['Visitors care how a pot was fired', 'The pottery photographs every firing'], riskiest: 1, upside: 'significant',
  priorArt: { exists: 'partly', searched: 'Searched for sites of potteries and of bakeries that are built as a log of their batches', who: 'A bakery that lists its bakes by the day', outcome: 'It shows the day and nothing of the oven', difference: 'This is built from the firing itself and its photographs, not from a calendar', evidence: ['E1'] },
  ...extra,
});

// A studio session at the study: the anatomy, the sector, what wins awards and the slop list written.
function atStudy() {
  const root = potterySite();
  const o = { root, ...STUDIO };
  const r = init({ root, url: 'https://pottery.test', ...STUDIO });
  assert.equal(r.ok, true, errorOf(r));
  assert.deepEqual([r.object.kind, r.object.from], ['website', 'detected']);
  assert.match(r.goal, /could only be this business/);
  assert.match(r.dir, /[\\/]\.project-health[\\/]studio[\\/]\d{4}-\d{2}-\d{2}$/);
  assert.equal(r.budget.total, 100);
  assert.equal(next(o).to.phase, 'evidence');
  evidence({ ...o, collect: true });
  assert.deepEqual(status(o).turns.map((t) => [t.role, Boolean(t.optional)]), [['anatomist', false], ['genre', true], ['voice', true], ['awards', true], ['slop', true], ['tech', true]]);
  assert.deepEqual(status(o).turns.map((t) => t.name).slice(1), ['the sector scout', 'the voice scout', 'the awards scout', 'the slop scout', 'the craft scan']);
  assert.match(errorOf(next({ ...o, force: true })), /studio designs for the business it studied/);
  const anatomist = context({ ...o, role: 'anatomist', save: true });
  assert.ok(anatomist.startsWith('# The anatomist') && anatomist.includes('what the business has that a design could be made of'));
  assert.match(anatomist, /studio\.mjs" study --role anatomist/);
  assert.match(errorOf(study({ ...o, role: 'anatomist' }, stdin({ anatomy: { ...ANATOMY, material: ANATOMY.material.slice(0, 1) }, evidence: ev(3) }))), /anatomy\.material: at least two things the business has/);
  assert.equal(study({ ...o, role: 'anatomist' }, stdin({ anatomy: ANATOMY, evidence: ev(3) })).ok, true);
  assert.ok(context({ ...o, role: 'genre', save: true }).startsWith('# The sector scout'));
  assert.equal(study({ ...o, role: 'genre' }, stdin({ genre: SECTOR, evidence: webEv(3, 'sector.test') })).ok, true);
  const awards = context({ ...o, role: 'awards', save: true });
  assert.ok(awards.startsWith('# The awards scout'));
  assert.match(awards, /studio\.mjs" probe --root/);
  const named = { ...CURRENTS, patterns: [{ ...CURRENTS.patterns[0], what: 'The smoke of https://awards.test/site-1, exactly as it is there' }, ...CURRENTS.patterns.slice(1)] };
  assert.match(errorOf(study({ ...o, role: 'awards' }, stdin({ currents: named, evidence: webEv(6, 'awards.test') }))), /a pattern names no site/);
  assert.match(errorOf(study({ ...o, role: 'awards' }, stdin({ currents: CURRENTS, evidence: webEv(2, 'awards.test') }))), /at least 6 pages/);
  const saved = study({ ...o, role: 'awards' }, stdin({ currents: CURRENTS, evidence: webEv(6, 'awards.test') }));
  assert.deepEqual([saved.ok, saved.sites, saved.patterns], [true, 6, 6], errorOf(saved));
  assert.ok(context({ ...o, role: 'slop', save: true }).startsWith('# The slop scout'));
  assert.equal(study({ ...o, role: 'slop' }, stdin({ slop: SLOP, evidence: webEv(3, 'templates.test') })).ok, true);
  const moved = next(o);
  assert.deepEqual([moved.to.phase, moved.ok], ['study', true], errorOf(moved));
  return o;
}

test('the studio studies the business and the field, and shows the person what it understood', () => {
  const o = atStudy();
  const shown = study({ ...o, show: true });
  assert.equal(shown.ok, true);
  assert.ok(shown.material.some((m) => m.startsWith('M1 A log of every firing')));
  assert.match(shown.awardsNow.reading, /one moving object/);
  assert.ok(shown.awardsNow.patterns.some((p) => p.endsWith('(motion; rising)')));
  assert.equal(shown.slop.tells.length, 8);
  assert.match(shown.note, /before anyone designs/);
  // The studio's study is kept apart from the lab's, with the commit it describes.
  const bank = path.join(o.root, '.project-health', 'kb', 'groundwork');
  assert.deepEqual(fs.readdirSync(bank).sort(), ['awards.json', 'slop.json', 'studio-anatomy.json', 'studio-genre.json']);
  assert.equal(readJson(path.join(bank, 'studio-anatomy.json')).head, 'c'.repeat(40));
  // A later session reuses all of it while it is fresh.
  close({ ...o, abandon: true, reason: 'testing reuse' });
  init({ ...o, url: 'https://pottery.test' });
  next(o);
  assert.deepEqual(evidence({ ...o, collect: true }).reused.map((r) => r.kind).sort(), ['anatomy', 'awards', 'genre', 'slop']);
  assert.deepEqual(status(o).turns.filter((t) => t.done).map((t) => t.role), ['anatomist', 'genre', 'awards', 'slop']);
  assert.equal(next(o).to.phase, 'study');
  assert.equal(study({ ...o, show: true }).awardsNow.sites, 6);
});

// Past the frame, at the first pass of the design.
function atDesign() {
  const o = atStudy();
  next(o);
  assert.ok(context({ ...o, role: 'framer', save: true }).startsWith('# The frame'));
  assert.equal(frame({ ...o, role: 'framer' }, stdin({ frame: FRAME })).ok, true, 'the studio frames as the lab does');
  next(o);
  assert.equal(frame({ ...o, role: 'provocateur' }, stdin({ provocations: PROVOCATIONS })).ok, true);
  assert.equal(next(o).to.phase, 'propose');
  return o;
}
const sessionOf = (o) => resolveSession(o.root, undefined, 'studio');
const mine = (o, role) => { const { session } = sessionOf(o); return { cards: [session.dealt.cards[role][0]], answers: session.dealt.framings[role][0] }; };

test('a designer is handed the field without its sites, and a direction is one idea made of what the business has', () => {
  const o = atDesign();
  const { session, dir } = sessionOf(o);
  const cards = loadCards('studio');
  for (const ids of Object.values(session.dealt.cards)) assert.ok(ids.every((id) => cards.some((c) => c.id === id)), 'the studio deals its own cards');
  const text = context({ ...o, role: 'material', save: true });
  for (const part of ['# The rules of the design studio', '# Your turn: design', '**Your ground: the material.**', 'No site is named in it, on purpose']) assert.ok(text.includes(part), part);
  // The firewall: no address of a site the scouts looked at reaches a designer, in the field or in the evidence.
  const field = fs.readFileSync(path.join(dir, 'in', 'field-material.json'), 'utf8');
  assert.ok(!/https?:\/\//.test(field), 'the field names no address');
  assert.ok(field.includes('The pictures obey a force') && field.includes('A soft gradient behind a centred headline') && field.includes('one long scroll of a single pot'));
  assert.ok(!field.includes('A studio pottery'), 'nor who made the most distinctive sites');
  const handed = readJson(path.join(dir, 'in', 'evidence-material.json'));
  assert.ok(handed.entries.filter((e) => ['awards', 'genre', 'slop'].includes(e.by)).every((e) => e.source === null && e.withheld));
  assert.ok(handed.entries.filter((e) => e.by === 'anatomist').every((e) => e.source));
  assert.ok(!text.includes('currents.json') && !text.includes(path.join(dir, 'evidence.json')) && !text.includes('genre.json'));
  assert.ok(!text.includes('probe --root'), 'a designer is given no tool for looking at how other sites are built');

  const good = direction(1, mine(o, 'material'));
  const bad = errorOf(say({ ...o, role: 'material' }, stdin({ statements: [{ ...good, scale: 'feature', buildsOn: ['A2'], madeFrom: 'assembly', design: { ...DESIGN, signature: { kind: 'none', why: 'People come nine times to buy a pot', what: 'Nothing' }, breaks: [] } }] })));
  for (const part of [/\.scale: refresh/, /name at least one thing the business has \(M…\)/, /an assembly says what the whole is/, /a direction with no signature moment has only its "why"/, /\.breaks: one to four habits/]) assert.match(bad, part);
  assert.match(errorOf(say({ ...o, role: 'material' }, stdin({ statements: [{ ...good, design: undefined }] }))), /\.design: the design, as/);
  assert.match(errorOf(say({ ...o, role: 'material' }, stdin({ statements: [{ ...good, design: { ...DESIGN, signature: { kind: 'spectacle', what: DESIGN.signature.what, why: DESIGN.signature.why } } }] }))), /\.signature\.tenth[\s\S]*tenth visit/);
  assert.equal(say({ ...o, role: 'material' }, stdin({ statements: [good] })).ok, true);
  const saved = readJson(path.join(dir, 'record.json')).statements.find((s) => s.type === 'hypothesis');
  assert.deepEqual([saved.madeFrom, saved.design.signature.kind, saved.buildsOn, saved.newTo], ['material', 'material', ['M1', 'M2', 'A2'], 'category']);
});

test('joining known patterns is allowed, is never the main thing: one assembly a seat, more only for the seat of patterns', () => {
  const o = atDesign();
  const assembly = (n, role) => direction(n, { ...mine(o, role), title: `Assembly ${n}: the firing as weather`, madeFrom: 'assembly', whole: 'A log that behaves like weather is a record of something alive, which neither a list nor a moving gallery is' });
  const two = say({ ...o, role: 'idea' }, stdin({ statements: [assembly(1, 'idea'), assembly(2, 'idea')] }));
  assert.match(errorOf(two), /At most 1 of your directions may be an assembly of known patterns[\s\S]*not made by joining what was seen elsewhere/);
  assert.equal(say({ ...o, role: 'idea' }, stdin({ statements: [assembly(1, 'idea'), direction(2, { ...mine(o, 'idea'), madeFrom: 'idea' })] })).ok, true);
  assert.equal(say({ ...o, role: 'combiner' }, stdin({ statements: [assembly(3, 'combiner'), assembly(4, 'combiner')] })).ok, true);
  const sheet = context({ ...o, role: 'combiner', save: true });
  assert.ok(sheet.includes('**Your ground: the patterns of the web.**') && sheet.includes('You may send more than one `assembly`; no other seat may.'));
});

// From the design to the write phase: built on, docketed, debated, ruled.
function atWrite() {
  const o = atDesign();
  const dealt = () => sessionOf(o).session.dealt;
  let n = 0;
  for (const role of Object.keys(dealt().cards)) {
    const r = say({ ...o, role }, stdin({ statements: [direction(++n, mine(o, role))] }));
    assert.equal(r.ok, true, `${role}: ${errorOf(r)}`);
  }
  assert.equal(next(o).to.step, 'second');
  assert.ok(context({ ...o, role: 'analogist', save: true }).includes('harvesting provocations'));
  assert.equal(say({ ...o, role: 'analogist' }, stdin({ statements: [direction(++n, { provocation: 'P1', newTo: 'world', madeFrom: 'far-field', priorArt: { exists: 'no', searched: 'Searched for sites built as a printed ledger' } })] })).ok, true);
  assert.equal(next({ ...o, force: true }).to.phase, 'amplify');
  const { session, dir } = sessionOf(o);
  const record = () => readJson(path.join(dir, 'record.json'));
  assert.ok(context({ ...o, role: Object.values(session.assignments)[0], save: true }).includes('# Your turn: take it further'));
  for (const [id, r] of Object.entries(session.assignments)) {
    const saved = say({ ...o, role: r }, stdin({ statements: [{ type: 'amplify', thread: id, text: `Let the log reach the smallest things on the page, ${LONG}`, bigger: { change: 'Every label, error and empty state is written as a line of the kiln log', effect: 'The idea is believed because it reaches the corners', because: 'A ledger has one voice from its first line to its last' } }] }));
    assert.equal(saved.ok, true, errorOf(saved));
  }
  assert.equal(next(o).to.phase, 'docket');
  const docket = context({ ...o, role: 'judge', save: true });
  assert.ok(docket.startsWith('# The docket') && docket.includes('currents.json') && docket.includes('slop.json'), 'the judge sees the sites');
  const threads = record().threads;
  const done = verdict({ ...o, stage: 'docket' }, stdin({ admitted: threads.slice(1).map((t) => ({ thread: t.id, novelty: 'fresh' })), refused: [{ thread: threads[0].id, reason: 'A large photograph with a centred line is how nearly every pottery opens.', ref: 'G1' }] }));
  assert.equal(done.ok, true, errorOf(done));
  assert.ok(loadIdeas(o.root).every((i) => i.origin === 'studio' && i.scale === 'redesign'));
  assert.deepEqual([next(o).to.phase, status(o).round], ['examine', 1]);
  assert.deepEqual(status(o).turns.map((t) => t.role).slice(0, 2), ['red-team', 'client']);
  const examiner = context({ ...o, role: 'red-team', save: true });
  assert.ok(examiner.startsWith('# The rules of the design studio') && examiner.includes('# Your turn: the examiner'));
  for (const part of ['"copy" (it is one site that exists', '"assembled" (it is known patterns side by side', '"generic" (it would fit a rival', 'currents.json', path.join(dir, 'evidence.json'), 'probe --root']) assert.ok(examiner.includes(part), part);
  const attacker = context({ ...o, role: 'craft', save: true });
  assert.ok(attacker.includes('you are also shown what you were not shown while you designed') && attacker.includes('genre.json'), 'after the docket the seats see the sites too');
  const open = record().threads.filter((t) => t.status === 'admitted').map((t) => t.id);
  const steel = (t) => ({ type: 'steelman', thread: t, text: `At its strongest the site is the record of the fire, ${LONG}` });
  assert.match(errorOf(say({ ...o, role: 'red-team' }, stdin({ statements: [steel(open[0]), { type: 'attack', thread: open[0], kind: 'exists', text: `A bakery lists its bakes, ${LONG}` }] }))), /\.kind: one of copy, assembled, generic, slop, signature/);
  assert.equal(say({ ...o, role: 'red-team' }, stdin({ statements: open.flatMap((t) => [steel(t), { type: 'attack', thread: t, kind: 'copy', text: `A bakery already lists its bakes by the day, ${LONG}` }]) })).ok, true);
  next({ ...o, force: true });
  for (const t of record().threads.filter((x) => x.status === 'admitted')) {
    const attack = record().statements.find((s) => s.thread === t.id && s.type === 'attack');
    const r = say({ ...o, role: t.by }, stdin({ statements: [{ type: 'reply', thread: t.id, stance: 'refute', to: [attack.n], text: `The bakery shows a calendar and nothing of its oven, ${LONG}` }] }));
    assert.equal(r.ok, true, errorOf(r));
  }
  next({ ...o, force: true });
  next({ ...o, force: true });
  assert.equal(status(o).phase, 'verdict');
  assert.ok(context({ ...o, role: 'judge', save: true }).includes('**The swap test decides.**'));
  const ids = record().threads.filter((t) => t.status === 'admitted').map((t) => t.id);
  const lives = { strength: 'speculative', swap: 'own', newTo: 'category', madeFrom: 'material', signature: 'quieter', feasible: 'now', upside: 'significant', riskiest: 'That the pottery photographs every firing', vsDoNothing: 'Today the home page could be any pottery\'s, and says nothing of the fire' };
  const rulings = ids.map((thread, i) => (i === 0
    ? { thread, verdict: 'killed', causeOfDeath: 'With another pottery\'s name on it nothing would look wrong.', swap: 'sector', reason: `The generic attack stood, ${LONG}` }
    : i === 1 ? { thread, verdict: 'undecided', swap: 'own', newTo: 'world', madeFrom: 'idea', upside: 'transformative', riskiest: 'Whether visitors read a ledger at all', wouldDecide: 'The first screen shown to five customers', reason: `Nobody could tell, ${LONG}` }
      : { thread, verdict: 'survived', ...lives, reason: `No attack stood, ${LONG}` }));
  const swap = (change) => rulings.map((r) => (r.verdict === 'survived' ? { ...r, ...change } : r));
  assert.match(errorOf(verdict({ ...o, stage: 'verdict' }, stdin({ rulings: swap({ swap: 'sector' }) }))), /a direction that would fit a rival does not survive as one/);
  assert.match(errorOf(verdict({ ...o, stage: 'verdict' }, stdin({ rulings: swap({ newTo: 'here' }) }))), /sites of this trade already have does not survive/);
  assert.match(errorOf(verdict({ ...o, stage: 'verdict' }, stdin({ rulings: swap({ madeFrom: 'assembly' }) }))), /an assembly survives only when you can say/);
  assert.match(errorOf(verdict({ ...o, stage: 'verdict' }, stdin({ rulings: swap({ signature: undefined, feasible: undefined }) }))), /\.feasible: now[\s\S]*\.signature: your ruling on its signature moment/);
  assert.match(errorOf(verdict({ ...o, stage: 'verdict' }, stdin({ rulings: swap({ madeFrom: 'assembly', whole: 'What attacker A said the whole is, more or less' }) }))), /a label of the debate/);
  assert.equal(verdict({ ...o, stage: 'verdict' }, stdin({ rulings })).ok, true);
  assert.equal(next(o).to.phase, 'set');
  assert.ok(context({ ...o, role: 'red-team', save: true }).includes('You do not say which is best'));
  assert.equal(verdict({ ...o, stage: 'set', role: 'red-team' }, stdin({ notes: [] })).ok, true);
  assert.equal(next(o).to.phase, 'write');
  assert.ok(loadIdeas(o.root).filter((i) => i.status === 'survived').every((i) => i.verdict.swap === 'own' && i.verdict.madeFrom === 'material' && i.verdict.signature === 'quieter'));
  assert.deepEqual(status(o).turns.map((t) => t.role), ['writer', 'prototyper']);
  return { o, dir };
}

test('the studio debates a direction for what a design must not be, and the judge rules on the swap test, what it is made from and its signature moment', () => {
  atWrite();
});

const TILE = (title = 'Firing 212') => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="https://fonts.bunny.net/css?family=courier-prime:400,700">
<style>
  :root { --clay: #c9b8a3; --ash: #5b5750; }
  body { margin: 0; background: var(--clay); color: #1d1a16; font: 18px/1.5 "Courier Prime", monospace; }
  main { max-width: 60ch; padding: 8vh 6vw; }
  h1 { font-size: 1rem; font-weight: 700; margin: 0 0 2rem; }
  .row { border-top: 1px solid var(--ash); padding: 1rem 0; display: grid; grid-template-columns: 8ch 1fr; }
  .hours { font-variant-numeric: tabular-nums; }
  .door { aspect-ratio: 4 / 3; border: 1px solid var(--ash); display: grid; place-items: center; font-size: .8rem; color: var(--ash); }
  @keyframes settle { from { opacity: .4 } to { opacity: 1 } }
  .row:focus-within, .row:hover { animation: settle .6s ease-out both; }
  @media (prefers-reduced-motion: reduce) { .row { animation: none !important; } }
</style>
</head>
<body>
<main>
<h1>${title}: oak and ash, fifty-one hours</h1>
<div class="row" tabindex="0"><span class="hours" id="h">0</span><span>hours in the fire</span></div>
<div class="door">Your photograph of the kiln door, taken from inside</div>
<p>Nine bowls, four jars and a jug came out of it.</p>
</main>
<script>
  const h = document.getElementById('h');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let n = still ? 51 : 0;
  const tick = () => { h.textContent = n; if (n < 51) { n += 1; setTimeout(tick, 40); } };
  tick();
</script>
</body>
</html>`;
const TOKENS = {
  colours: [{ name: 'Unglazed clay', value: '#C9B8A3', use: 'The page' }, { name: 'Wood ash', value: '#5b5750', use: 'Rules and small type' }],
  type: [{ role: 'Everything', family: 'Courier Prime', source: 'fonts.bunny.net', use: 'Every word, at two sizes' }],
  motion: [{ name: 'The count', duration: 'two seconds', easing: 'linear', use: 'The hours of the firing a visitor opens' }],
  rules: ['Nothing is centred.', 'A photograph of the kiln is never cropped.', 'Only the firing a visitor opened moves.'],
};
const tilesFor = (survivors, html = TILE()) => ({ tiles: survivors.map((i) => ({ idea: i.id, caption: 'The newest firing: its hours, the kiln door and what came out.', shows: 'The hours count up once on arrival; with less motion asked for, the number is simply shown.', tokens: TOKENS, html })) });

function writtenBy(survivors, killed) {
  return {
    summary: 'The studio looked for what the pottery\'s site could look, read and move like that could only be this pottery. Several directions survived, all made of the kiln log and its photographs; each is shown as a tile to open, which shows whether the idea holds and is not a finished design.',
    plan: [{ text: 'Open the tiles first, then show one of them to a few customers in the shop.', ideas: [survivors[0].id] }],
    survivors: survivors.map((i) => ({
      idea: i.id, sentence: 'The site becomes the kiln log: every pot is shown with the firing it came from.',
      experience: ['You arrive on a page the colour of unglazed clay.', 'You open the newest firing and see the kiln door from inside.', 'Under it are the pots that came out, each with its price.'],
      whyNew: 'A bakery lists its bakes by the day and shows nothing of its oven; no pottery was found that shows the fire. With another pottery\'s name on it the log would be a lie.',
      why: 'The pottery has kept a log of every firing, and buyers of wood-fired pots care how a pot was fired.',
      prototype: 'Build the home page as the newest firing and show it to five customers in the shop.',
      firstStep: 'Open the tile, then photograph the next firing.', killCondition: 'Fewer than three in five people shown the first screen say the pots are wood-fired.',
      upside: 'The site becomes the reason to choose this pottery over one that buys its clay ready glazed.',
      survived: [{ attack: 'A bakery already lists its bakes by the day.', answer: 'It shows a calendar and nothing of its oven.' }],
      uncertain: ['Whether the pottery will photograph every firing.'], fromYou: ['Decide whether the log on paper may be shown as it is.'],
    })),
    killed: killed.map((i) => ({ idea: i.id, what: 'The kiln log with a common opening laid over it.', strongestPoint: 'It kept the basket where buyers look for it.', killedBy: 'With another pottery\'s name on it nothing would look wrong.', couldReturn: 'Only if the log, not the photograph, were the first thing seen.' })),
    bets: [], questions: [],
  };
}

test('every direction that survived is built as a tile that can load nothing but its type, and is handed over with its values and its rules', () => {
  const { o, dir } = atWrite();
  assert.ok(context({ ...o, role: 'writer', save: true }).startsWith('# The directions'));
  const prototyper = context({ ...o, role: 'prototyper', save: true });
  assert.ok(prototyper.startsWith('# The tiles') && prototyper.includes('That page is what this studio exists to avoid'));
  const input = readJson(path.join(dir, 'in', 'tiles.json'));
  assert.deepEqual([input.survivors[0].signatureRuling, input.survivors[0].design.signature.kind, input.slop.length], ['quieter', 'material', 8]);
  assert.equal(input.survivors[0].buildsOn[0].is, ANATOMY.material[0].what);

  const ledger = loadIdeas(o.root);
  const survivors = ledger.filter((i) => i.status === 'survived');
  const killed = ledger.filter((i) => i.status === 'killed');
  assert.ok(survivors.length >= 4);
  const saved = save({ ...o, doc: 'suggestions' }, stdin(writtenBy(survivors, killed)));
  assert.equal(saved.ok, true, errorOf(saved));
  assert.match(errorOf(save({ ...o, doc: 'discussion' }, stdin({}))), /design studio writes no minutes/);
  assert.match(errorOf(next(o)), /no tile yet: start the prototyper/);
  assert.match(errorOf(save({ ...o, doc: 'tiles' }, stdin({ tiles: [] }))), /has no tile: every direction that survived is built as a tile/);
  for (const [html, why] of [
    [TILE().replace('</body>', '<script src="https://cdn.test/gsap.js"></script></body>'), /a script loaded from a file or an address/],
    [TILE().replace('<main>', '<main><img src="https://stock.test/hands.jpg" alt="">'), /a tile names no address but those of its fonts/],
    [TILE().replace('<main>', '<main><img src="photos/kiln.jpg" alt="">'), /a file beside the page is named/],
    [TILE().replace(/@media \(prefers-reduced-motion[^\n]*\n/, '').replace(/const still[^\n]*\n/, 'const still = false;\n'), /must answer a visitor who asked for less motion/],
    [TILE().replace('tick();', 'tick(); fetch("/track");'), /a request to somewhere/],
    [TILE().replace('<main>', '<main><form action="/buy"></form>'), /a form: a tile collects nothing/],
    ['<p>A sketch</p>', /one whole HTML page starting with <!doctype html>/],
  ]) assert.match(errorOf(save({ ...o, doc: 'tiles' }, stdin(tilesFor(survivors, html)))), why);
  // A page is handed in on its own, as plain HTML, and the tiles are then saved without it.
  assert.match(prototyper, /studio\.mjs" tile --root .* --idea I21 <<'TILE_HTML'/);
  const pageIn = (text) => ({ stdin: () => text });
  assert.match(errorOf(tile({ ...o, idea: 'I999' }, pageIn(TILE()))), /is not a direction that survived/);
  assert.match(errorOf(tile({ ...o, idea: survivors[0].id }, pageIn(TILE().replace('tick();', 'tick(); fetch("/track");')))), /the page: a request to somewhere/);
  const bare = { tiles: tilesFor(survivors).tiles.map(({ html, ...rest }) => rest) };
  assert.match(errorOf(save({ ...o, doc: 'tiles' }, stdin(bare))), /has no page: hand it in with the tile command first/);
  for (const i of survivors) assert.equal(tile({ ...o, idea: i.id }, pageIn(TILE())).ok, true);
  const built = save({ ...o, doc: 'tiles' }, stdin(bare));
  assert.deepEqual([built.ok, built.tiles, built.pictures], [true, survivors.length, 0], errorOf(built));
  assert.match(built.warnings[0], /the tiles were not photographed/);
  const page = fs.readFileSync(path.join(dir, 'tiles', `${survivors[0].id}.html`), 'utf8');
  assert.ok(page.includes(`<meta http-equiv="Content-Security-Policy" content="${TILE_POLICY}">`), 'the script adds the rule that keeps the tile from loading anything else');
  assert.match(TILE_POLICY, /^default-src 'none'; .*form-action 'none'$/);
  // Without pictures nobody can look at the tiles as a stranger would, and the session goes on.
  assert.deepEqual(status(o).turns.map((t) => [t.role, t.done]), [['writer', true], ['prototyper', true]]);
  const printed = next(o);
  assert.equal(printed.to.phase, 'review', errorOf(printed));
  assert.equal(printed.handoff.length, survivors.length);

  const directions = fs.readFileSync(path.join(dir, 'directions.html'), 'utf8');
  for (const part of ['Design studio · The directions', 'The directions that survived', 'What to build first', 'The design it leads to', 'The signature moment', 'On the tenth visit', 'Keep it, smaller or slower', 'The values of the tile', '#c9b8a3', 'The rules of this direction', 'What of the business it is made of', 'What the business has: A log of every firing', 'made from: its own material', 'its own', 'new to its trade', 'Why it is not a copy', `tiles/${survivors[0].id}.html`, `handoff/${survivors[0].id}.md`, 'What the studio found in the field', 'What wins awards now', 'What the honoured sites are built with', 'GSAP', 'awards.test/site-1', 'How sites of this trade work', 'What a template or machine-made site looks like now', 'What the studio understood', 'What the business has that a design could be made of', 'The morphological box', 'The provocation wall', 'Not settled', 'Killed', 'Not debated', 'How the studio works', 'fits a rival']) assert.ok(directions.includes(part), part);
  assert.ok(!directions.includes('The inventions that survived') && !/\blab\b/.test(directions.replace(/<style[\s\S]*?<\/style>/g, '')), 'the studio does not speak as the lab');
  const brief = fs.readFileSync(path.join(dir, 'brief.html'), 'utf8');
  for (const part of ['Design studio · Decision brief', 'The directions that survived', 'What to build first', 'directions.pdf', '<b>tiles/</b>', '<b>handoff/</b>', 'none ranked above another']) assert.ok(brief.includes(part), part);
  const handoff = fs.readFileSync(path.join(dir, 'handoff', `${survivors[0].id}.md`), 'utf8');
  for (const part of ['## The idea', '**Why this business:**', '## The design', '**Type.**', '## The signature moment', '**On the tenth visit:**', "**The judge's ruling:** Keep it, smaller or slower", '## The values of the tile', '| Unglazed clay | `#c9b8a3` | The page |', '## The rules of this direction', '- Nothing is centred.', '## What it keeps, and what it breaks', '## What the business must supply', '## Do not', 'A soft gradient behind a centred headline', 'The nearest thing found: A bakery that lists its bakes by the day', '## Still uncertain', '**Drop the direction if:**']) assert.ok(handoff.includes(part), part);
  const ideaPage = fs.readFileSync(path.join(dir, 'site', 'ideas', `${survivors[0].id}.html`), 'utf8');
  assert.ok(ideaPage.includes('The design it leads to') && ideaPage.includes(`../../tiles/${survivors[0].id}.html`) && ideaPage.includes('Attack: it is one site that exists'));
  assert.ok(fs.readFileSync(path.join(dir, 'site', 'method.html'), 'utf8').includes('What the studio found in the field'));
  assert.match(fs.readFileSync(path.join(o.root, '.project-health', 'ideas.html'), 'utf8'), /Design studio, /);
  assert.deepEqual(status(o).turns, [], 'with no PDF there is no layout to review');
  const closed = close(o);
  assert.equal(closed.ok, true, errorOf(closed));
  assert.deepEqual(Object.keys(closed.documents), ['brief', 'directions']);
  assert.deepEqual([closed.tiles.length, closed.handoff.length, closed.tilesNotLookedAt], [survivors.length, survivors.length, true]);
  assert.match(digest({ root: o.root }), /\{from the design studio\}/);
});

test('a stranger who was told nothing looks at the tiles before anything is printed, and a tile it could not place goes back once', () => {
  const { o, dir } = atWrite();
  const ledger = loadIdeas(o.root);
  const survivors = ledger.filter((i) => i.status === 'survived');
  save({ ...o, doc: 'suggestions' }, stdin(writtenBy(survivors, ledger.filter((i) => i.status === 'killed'))));
  // With a browser the tiles are photographed as they are saved.
  const shoot = (browser, url, file) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'a picture'); return file; };
  const ctxOf = () => { const { session } = sessionOf(o); return { root: o.root, dir, session, record: loadRecord(dir), evidence: loadEvidence(dir), verdicts: loadVerdicts(dir) }; };
  const saveTiles = (data) => { const ctx = ctxOf(); const r = saveDocument(ctx, o.root, 'tiles', data, { browser: 'a browser', shoot }); saveSession(dir, ctx.session); return r; };
  const built = saveTiles(tilesFor(survivors));
  assert.deepEqual([built.errors, built.pictures], [[], survivors.length * 2]);
  assert.deepEqual(status(o).turns.map((t) => [t.role, t.done]), [['writer', true], ['prototyper', true], ['eye', false]]);
  assert.match(errorOf(next(o)), /Nobody has looked at the tiles yet: start the stranger/);
  // The stranger is told nothing: no goal, no business, no site, no evidence.
  const blind = context({ ...o, role: 'eye', save: true });
  assert.ok(blind.startsWith('# The stranger'));
  for (const hidden of ['The goal of this session', 'pottery.test', 'Project root', 'anatomy.json', 'evidence.json', 'currents.json']) assert.ok(!blind.includes(hidden), hidden);
  const given = readJson(path.join(dir, 'in', 'eye.json'));
  assert.deepEqual([given.tiles.length, given.tiles[0].pictures.length, given.slop.length], [survivors.length, 2, 8]);
  assert.match(given.sector, /studio potteries/);
  const seen = (idea, swap) => ({ idea, guess: 'A maker of pots who fires with wood: the list of firings says so', swap, remindsOf: 'nothing I can name', tells: swap === 'own' ? [] : ['A rounded button that says "Get started"'], works: 'The list of firings, read like a ledger', issues: [] });
  assert.match(errorOf(save({ ...o, doc: 'review-eye' }, stdin({ verdict: 'They differ, and two of them could only be a pottery.', tiles: [seen(survivors[0].id, 'own')] }))), /was not looked at: every tile is/);
  const looked = save({ ...o, doc: 'review-eye' }, stdin({ verdict: 'They differ, and all but one could only be a pottery that fires with wood.', tiles: survivors.map((i, n) => seen(i.id, n === 1 ? 'sector' : 'own')) }));
  assert.deepEqual([looked.ok, looked.backToThePrototyper], [true, [survivors[1].id]], errorOf(looked));
  assert.deepEqual(status(o).turns.map((t) => [t.role, t.done]), [['writer', true], ['prototyper', false], ['eye', true]]);
  assert.match(errorOf(next(o)), new RegExp(`The stranger sent ${survivors[1].id} back: start the prototyper`));
  context({ ...o, role: 'prototyper', save: true });
  const again = readJson(path.join(dir, 'in', 'tiles.json'));
  assert.deepEqual(again.revise, [survivors[1].id]);
  assert.equal(again.survivors.find((s) => s.idea === survivors[1].id).stranger.swap, 'sector');
  assert.equal(saveTiles(tilesFor(survivors, TILE('Firing 213'))).errors.length, 0);
  assert.deepEqual(status(o).turns.map((t) => [t.role, t.done]), [['writer', true], ['prototyper', true], ['eye', true]], 'a tile is revised once, and the stranger looks once');
  const printed = next(o);
  assert.equal(printed.to.phase, 'review', errorOf(printed));
  const directions = fs.readFileSync(path.join(dir, 'directions.html'), 'utf8');
  for (const part of ['What a stranger saw in the tile', 'Took it to be for', 'It would fit any business of this kind.', 'The tile was revised after this look', `tiles/${survivors[0].id}-desktop.png`, 'A still picture: the tile itself moves.']) assert.ok(directions.includes(part), part);
  assert.ok(fs.readFileSync(path.join(dir, 'handoff', `${survivors[0].id}.md`), 'utf8').includes('## What a stranger saw in the tile'));
  assert.equal(close(o).tilesNotLookedAt, false);
});

test('a tile is one page that can reach nothing but a font host', () => {
  const ok = cleanTile(TILE());
  assert.ok(ok.html.includes('Content-Security-Policy') && !ok.errors);
  for (const [bad, why] of [
    [TILE().replace('<main>', '<main><iframe></iframe>'), /a frame or an embedded page/],
    [TILE().replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta http-equiv="refresh" content="0;url=https://x.test">'), /a <meta http-equiv>/],
    [TILE().replace('<script>', '<script type="module">'), /a script module or an import/],
    [TILE().replace('tick();', 'tick(); new WebSocket("wss://x.test");'), /a request to somewhere/],
    [TILE().replace('tick();', 'tick(); window.open("about:blank");'), /a script that leaves the page/],
    [TILE().replace('<meta name="viewport" content="width=device-width, initial-scale=1">', ''), /a <meta name="viewport"/],
    [TILE().replace('fonts.bunny.net/css', 'fonts.evil.test/css'), /a tile names no address but those of its fonts/],
    [`${TILE()}${' '.repeat(10)}<p>after</p>`, /one whole page/],
    ['x'.repeat(200000), /at most 160000 characters/],
  ]) assert.match((cleanTile(bad).errors ?? []).join('\n'), why);
  assert.equal(cleanTile(TILE().replace('<main>', '<main><svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4"/></svg>')).errors, undefined, 'a drawing made in the page is welcome');
  // Ordinary code is not taken for an escape: a variable called location, a panel that opens.
  assert.equal(cleanTile(TILE().replace('tick();', 'tick(); const location = gl.getUniformLocation(p, "u"); panel.open = true;').replace('<main>', '<main onclick="panel.open = !panel.open">')).errors, undefined);
  assert.match(cleanTile(TILE().replace('tick();', 'tick(); window.location = "https://fonts.bunny.net/";')).errors.join('\n'), /a script that leaves the page/);
});

test('what a page is built with is read from its markup, and a pattern of the field names no site', () => {
  const found = detectTech(`<html class="lenis"><head><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400&family=Fraunces"><script src="/_next/static/chunks/gsap.min.js"></script>
<style>@font-face { font-family: "Studio Grotesk"; src: url(a.woff2) } @media (prefers-reduced-motion: reduce) { * { animation: none } } .a { view-transition-name: hero }</style></head>
<body><div id="__next"><canvas data-engine="three.js r170"></canvas><canvas></canvas><video></video><div data-barba="wrapper"></div></div></body></html>`);
  assert.deepEqual(found.libraries, ['GSAP', 'Lenis (smooth scroll)', 'Three.js', 'Barba (page transitions)', 'View transitions']);
  assert.deepEqual([found.builtOn, found.canvases, found.videos, found.reducedMotion, found.fontHosts], [['Next.js'], 2, 1, true, ['Google Fonts']]);
  assert.deepEqual(found.fonts, ['Inter', 'Fraunces', 'Studio Grotesk']);
  assert.deepEqual(detectTech('<p>plain</p>').libraries, []);
  // What a page says is not what it is built with: an awards gallery names other sites' technologies in its text.
  const gallery = detectTech('<main><p>Built with Three.js, GSAP and Lenis. Lottie too.</p><a href="https://spline.design/">Barba</a><div data-site="{&quot;tags&quot;:[&quot;Three.js&quot;,&quot;BARBA.js&quot;]}"></div><script type="application/json">{"tags":["three.js","gsap.min.js"]}</script><script>const a = 1;</script></main>');
  assert.deepEqual([gallery.libraries, gallery.builtOn], [[], []]);
  assert.deepEqual(detectTech('<script>gsap.registerPlugin(ScrollTrigger)</script>').libraries, ['GSAP'], 'a script the page carries is markup');
  assert.equal(validateCurrents(CURRENTS).length, 0);
  assert.match(validateCurrents({ ...CURRENTS, sample: CURRENTS.sample.slice(0, 2) }).join('\n'), /six to thirty sites/);
  assert.ok(COMMANDS.probe, 'the scouts can probe a page');
});

test('what the person says when they turn something down is kept as a rule, read by every skill, and only they retire it', () => {
  const root = potterySite();
  assert.throws(() => note({ root }), /Usage: note --type forbidden\|constraint\|decision\|preference/);
  assert.match(errorOf(note({ root, type: 'ban', title: 'No', value: 'short' })), /--type: what kind of note[\s\S]*--title: the rule in a few words[\s\S]*--value: what the person said/);
  assert.match(errorOf(note({ root, type: 'forbidden', title: 'No passwords shown', value: 'The password is password=hunter2hunter2, never show it' })), /must not hold a secret/);
  // A session of the council ended; the person turns a survivor down, and says why.
  const kb = path.join(root, '.project-health', 'kb');
  fs.mkdirSync(kb, { recursive: true });
  fs.writeFileSync(path.join(kb, 'ideas.json'), JSON.stringify({ ideas: [{ id: 'I1', title: 'A dark home page lit like a kiln at night', proposedBy: 'craft', origin: 'studio', status: 'survived', hypothesis: { change: 'The home page is dark, lit like a kiln at night', effect: 'A visitor remembers the fire', because: 'No pottery of the trade shows the fire at all', killCondition: 'Customers say they cannot read the prices' }, verdict: { strength: 'speculative', vsDoNothing: 'It would stand out from every pottery' }, history: [{ date: '2026-11-20', event: 'proposed', by: 'studio', session: '2026-11-20' }] }] }));
  fs.writeFileSync(path.join(kb, 'knowledge.json'), JSON.stringify({ people: [{ name: 'Sam', role: 'Owner', availability: 'An hour a week' }], notes: [{ id: 'K1', kind: 'feature', title: 'The shop stays', detail: 'The shop page must keep working as it does.', source: 'person' }], updatedAt: '2026-11-01' }));
  fs.writeFileSync(path.join(kb, 'knowledge.md'), '# old');
  assert.equal(ideas({ root, by: 'person' }, stdin({ ideas: [{ id: 'I1', status: 'rejected', decision: { reason: 'Too dark for our customers' } }] })).ok, true);
  const saved = note({ root, kind: 'studio', type: 'forbidden', title: 'No dark backgrounds', value: 'Never a dark background: our customers are over sixty and read us in daylight.', idea: 'I1', scope: 'design' });
  assert.deepEqual([saved.ok, saved.id, saved.kind], [true, 'K2', 'forbidden'], errorOf(saved));
  assert.equal(note({ root, type: 'forbidden', title: 'no dark backgrounds', value: 'Said again in other words, the same rule as before.' }).already, 'This note was saved before.');
  assert.equal(note({ root, kind: 'studio', type: 'preference', title: 'The hand-written price tags', value: 'More of the hand-written price tags: people photograph them.' }).id, 'K3');
  const file = readJson(path.join(kb, 'knowledge.json'));
  assert.deepEqual(file.notes[1], { id: 'K2', kind: 'forbidden', title: 'No dark backgrounds', detail: 'Never a dark background: our customers are over sixty and read us in daylight.', scope: 'design', source: 'person', by: 'studio', ideaIds: ['I1'], addedAt: file.notes[1].addedAt, updatedAt: file.notes[1].updatedAt });
  assert.deepEqual([file.people.length, file.notes[0].id], [1, 'K1'], 'what others wrote is left as it is');
  assert.deepEqual(validateKnowledge(file), [], 'the roadmap skill can still read and save the file');
  assert.match(fs.readFileSync(path.join(kb, 'knowledge.md'), 'utf8'), /## Not allowed\n\n- \*\*No dark backgrounds\*\* _\(design\)_[\s\S]*## Liked\n\n- \*\*The hand-written price tags\*\*/);
  // Every member of every skill reads it in the digest, with the instruction that a variant is the same idea.
  const text = digest({ root });
  for (const part of ['## What the person turned down, and what they asked for more of', 'The same thing under another name, or a variant that meets the same objection, is not proposed again', '- Turned down: I1 "A dark home page lit like a kiln at night" — Too dark for our customers', '- The rule behind it: **No dark backgrounds** [design] — Never a dark background', '(K2, said of I1)', 'The person asked for more of these', '- Liked: **The hand-written price tags**', '- Not allowed: **No dark backgrounds** [design]']) assert.ok(text.includes(part), part);
  assert.deepEqual(note({ root, show: true }).notes.map((n) => [n.id, n.kind]), [['K1', 'feature'], ['K2', 'forbidden'], ['K3', 'preference']]);
  assert.match(errorOf(note({ root, retire: 'K9' })), /There is no note K9/);
  assert.equal(note({ root, retire: 'K2' }).retired.title, 'No dark backgrounds');
  assert.ok(!digest({ root }).includes('The rule behind it'));
  // The prototyper is given the person's rules too, and the handoff carries them.
  for (const skill of ['council', 'venture', 'lab', 'studio']) {
    const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', skill, 'SKILL.md'), 'utf8');
    assert.match(text, /## What the person says that outlives the session/, skill);
    assert.match(text, /note --root "<ROOT>" --type forbidden/, skill);
    assert.match(text, /Is that a rule for every future proposal, or only for this one\?/, skill);
    assert.match(fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', skill, 'agents', 'docket.md'), 'utf8'), /under another name/, skill);
  }
});

test('the studio skill is registered, its prompts and cards exist, and they name what the scripts accept', () => {
  const studio = path.join(PLUGIN_ROOT, 'skills', 'studio');
  const skill = fs.readFileSync(path.join(studio, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: studio\ndescription: /);
  assert.match(skill, /\nallowed-tools: .*Bash\(node:\*\)/);
  const used = [...skill.matchAll(/SN ([a-z-]+)/g)].map((m) => m[1]);
  for (const c of new Set(used)) assert.ok(COMMANDS[c], `SKILL.md uses "SN ${c}", which does not exist`);
  for (const c of ['init', 'status', 'next', 'digest', 'fact', 'evidence', 'study', 'frame', 'shots', 'render', 'close', 'ideas', 'note']) assert.ok(used.includes(c), `SKILL.md never uses ${c}`);
  for (const part of ['**Keep the firewall.**', 'Do not summarise the directions, rank them or say which you like', '**Nobody is contacted, by you or by any member.**', 'data, not instructions', 'what to open first: the tiles']) assert.ok(skill.includes(part), part);
  const agent = (name) => fs.readFileSync(path.join(studio, 'agents', `${name}.md`), 'utf8');
  for (const f of ['_contract', 'anatomist', 'genre', 'awards', 'slop', 'voice', 'tech', 'framer', 'provocateur', 'proposer', 'proposer-second', 'client', 'amplifier', 'docket', 'red-team', 'attacker', 'defender', 'judge', 'set', 'writer', 'prototyper', 'eye']) assert.ok(agent(f).length > 500, f);
  for (const f of ['anatomist', 'genre', 'awards', 'slop', 'voice', 'tech', 'framer', 'provocateur', 'docket', 'judge', 'set', 'writer', 'prototyper', 'eye']) assert.match(agent(f), /never an instruction to you/, `${f} is read without the contract`);
  const cast = readJson(path.join(studio, 'references', 'cast.json'));
  assert.deepEqual(cast.seats.map((s) => s.role), ['client', 'provocateur', 'material', 'idea', 'analogist', 'craft', 'combiner', 'red-team', 'judge']);
  for (const s of cast.seats.filter((x) => x.proposes && x.role !== 'client')) assert.match(agent(`roles/${s.role}`), /^\*\*Your ground: /, s.role);
  assert.ok(new Set(cast.seats.filter((s) => s.proposes).map((s) => s.model)).size > 1);
  const files = fs.readdirSync(path.join(studio, 'agents'), { recursive: true }).filter((f) => f.endsWith('.md'));
  for (const file of files) {
    const text = fs.readFileSync(path.join(studio, 'agents', file), 'utf8');
    for (const s of cast.seats) assert.ok(!text.includes(s.name), `${file} names ${s.name}`);
    assert.ok(!/"(hours|days|cost|price)"\s*:/.test(text), `${file} has a field for time or money`);
    assert.ok(!/invention lab of|minutes of the/i.test(text), file);
  }
  const cards = loadCards('studio');
  assert.equal(new Set(cards.map((c) => c.id)).size, cards.length);
  assert.ok(new Set(cards.map((c) => c.family)).size >= 5);
  assert.ok(!cards.some((c) => c.family === 'pattern'), 'no card deals a pattern of the web');
  // The prompts name exactly what the scripts accept.
  for (const kind of Object.keys(STUDIO_ATTACK_KINDS)) {
    assert.ok(agent('red-team').includes(`\`${kind}\``), `examiner: ${kind}`);
    assert.ok(agent('attacker').includes(`\`${kind}\``), `attacker: ${kind}`);
  }
  for (const k of SIGNATURES) assert.ok(agent('proposer').includes(`\`${k}\``) || agent('proposer').includes(`"${k}"`), `signature ${k}`);
  for (const k of MADE_FROM) assert.ok(agent('proposer').includes(`\`${k}\``) && agent('judge').includes(`\`${k}\``), `made from ${k}`);
  for (const k of [...SWAPS, ...SIGNATURE_RULINGS]) assert.ok(agent('judge').includes(`\`${k}\``), `judge: ${k}`);
  for (const k of STUDIO_SCALES) assert.ok(agent('proposer').includes(`\`${k}\``) && agent('judge').includes(`\`${k}\``), `scale ${k}`);
  for (const k of ['own', 'sector', 'anyone']) assert.ok(agent('eye').includes(`\`${k}\``), `stranger: ${k}`);
  assert.match(agent('_contract'), /It is \*\*not an assembly of effects\*\*/);
  assert.match(agent('awards'), /What you know from memory about web design is out of date/);
  assert.match(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'rules.mjs'), 'utf8'), /\(council\|venture\|lab\|studio\|ph\)/);
  assert.match(fs.readFileSync(path.join(PLUGIN_ROOT, 'agents', 'member.md'), 'utf8'), /`studio\.mjs`/);
});
