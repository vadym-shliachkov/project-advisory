import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COMMANDS, conceptErrors, pageErrors, findReusable } from '../../../skills/studio/scripts/studio.mjs';

process.env.COUNCIL_NO_BROWSER = '1';
const SKILL = path.resolve(import.meta.dirname, '../../../skills/studio');
const run = (cmd, o = {}) => COMMANDS[cmd]({ ...o });

// A project with a study left by an earlier session, one picture of its own, and nothing else.
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-concept-'));
  const old = path.join(root, '.project-health', 'studio', '2026-01-01');
  fs.mkdirSync(path.join(old, 'study', 'looks'), { recursive: true });
  fs.writeFileSync(path.join(old, 'study', 'business.md'), `# The business\n${'A pottery that fires with wood. '.repeat(80)}`);
  fs.writeFileSync(path.join(old, 'study', 'field.md'), `# The field\n${'Honoured sites move slowly. '.repeat(80)}`);
  fs.writeFileSync(path.join(old, 'studio.json'), JSON.stringify({ id: '2026-01-01', phase: 'done', closed: 'x', url: 'https://example.com', study: {} }));
  fs.mkdirSync(path.join(root, 'img'));
  fs.writeFileSync(path.join(root, 'img', 'kiln.jpg'), 'jpg');
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

const pick = (ids, chosen) => ({
  chosen,
  why: 'The strongest idea, made of what the pottery has, and it moves people.',
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
  others: ids.filter((id) => id !== chosen).map((id) => ({ concept: id, why: 'A weaker form of the same fire.' })),
});

const GOOD_PAGE = '<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="https://fonts.bunny.net/css?family=fraunces"><script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script><svg xmlns="http://www.w3.org/2000/svg"></svg><style>@media (prefers-reduced-motion: reduce){*{animation:none}}</style><img src="assets/kiln.jpg"><h1>The kiln</h1>';

test('a concept is an idea with a world and motion; a rule about type, or a page where nothing moves, is refused', () => {
  assert.deepEqual(conceptErrors(concept(), 'c'), []);
  const typeRule = conceptErrors(concept({ idea: 'Type weight is the proof: settled facts get heavier type on every page of the site.' }), 'c');
  assert.ok(typeRule.some((e) => /size or weight of type/.test(e)), typeRule.join('\n'));
  assert.ok(conceptErrors(concept({ name: 'Bigger headings everywhere' }), 'c').some((e) => /size or weight of type/.test(e)));
  const still = conceptErrors(concept({ motion: 'Nothing moves, on purpose: weight is a still property that must survive print and a screenshot.' }), 'c');
  assert.ok(still.some((e) => /Stillness/.test(e)), still.join('\n'));
  assert.ok(conceptErrors(concept({ world: 'short' }), 'c').some((e) => /world/.test(e)));
});

test('the page check lets in fonts, script CDNs and its own files, and nothing that sends or loads from elsewhere', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-page-'));
  fs.mkdirSync(path.join(dir, 'page', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'page', 'assets', 'kiln.jpg'), 'jpg');
  fs.writeFileSync(path.join(dir, 'page', 'index.html'), GOOD_PAGE);
  assert.deepEqual(pageErrors(dir), []);
  fs.writeFileSync(path.join(dir, 'page', 'index.html'), '<!doctype html><img src="https://tracker.example.com/x.png"><img src="assets/missing.png"><form></form><script>fetch("/x");localStorage.a=1</script>');
  const e = pageErrors(dir).join('\n');
  for (const want of [/tracker\.example\.com/, /missing\.png/, /a form/, /fetch/, /storage/, /viewport/, /prefers-reduced-motion/]) assert.match(e, want);
});

test('a session runs from a reused study to one picked concept, one page and a note for whoever builds it', () => {
  const root = project();
  let r = run('init', { root });
  assert.equal(r.ok, true);
  assert.equal(r.reused.from, '2026-01-01');
  assert.equal(r.url, 'https://example.com');
  const { dir } = r;
  assert.equal(run('init', { root }).ok, false, 'an unfinished session is not silently replaced');

  r = run('status', { root });
  assert.equal(r.phase, 'study');
  assert.equal(r.turns.length, 0, 'a reused study needs no scouts');
  assert.equal(run('correct', { root, text: 'We fire twice a year now, not four times.' }).ok, true);
  assert.equal(run('next', { root }).to, 'concepts');

  r = run('status', { root });
  assert.deepEqual(r.turns.map((t) => t.role), JSON.parse(fs.readFileSync(path.join(SKILL, 'references', 'seats.json'), 'utf8')).seats.map((s) => s.role));
  const brief = run('brief', { root, role: 'material' }).markdown;
  assert.match(brief, /Your starting place: The material/);
  assert.match(brief, /business\.md/);
  assert.match(brief, /corrections\.md/, 'the person\'s correction reaches the seats');
  assert.doesNotMatch(brief, /Pictures of honoured/, 'a seat is not shown the pictures of other sites');
  assert.equal(run('brief', { root, role: 'critic' }).ok, false, 'a member has no brief outside its phase');

  fs.mkdirSync(path.join(dir, 'concepts'), { recursive: true });
  for (const seat of ['idea', 'material', 'feeling', 'far', 'motion']) fs.writeFileSync(path.join(dir, 'concepts', `${seat}.json`), JSON.stringify({ concepts: [concept(), concept({ name: 'The ash glaze' })] }));
  assert.equal(run('next', { root }).ok, false, 'next waits for the seat that has not finished');
  r = run('next', { root, force: true });
  assert.equal(r.to, 'critique');
  assert.ok(r.warnings.some((w) => /Provocation/.test(w)));
  const concepts = JSON.parse(fs.readFileSync(path.join(dir, 'concepts.json'), 'utf8')).concepts;
  assert.equal(concepts.length, 10);
  assert.equal(concepts[0].id, 'C1');
  assert.ok(concepts.every((c) => !('seat' in c)), 'the critics and the judge do not see who proposed what');
  assert.match(run('brief', { root, role: 'critic' }).markdown, /Pictures of honoured/, 'the critic sees the field');

  fs.mkdirSync(path.join(dir, 'critique'), { recursive: true });
  const notes = (ids) => ({ notes: ids.map((id) => ({ concept: id, says: 'Close to no honoured site; one idea throughout; it would feel warm and patient.', strongest: 'the glow of the kiln', flags: [] })) });
  fs.writeFileSync(path.join(dir, 'critique', 'visitor.json'), JSON.stringify(notes(concepts.slice(1).map((c) => c.id))));
  assert.ok(run('done', { root, role: 'visitor' }).errors.some((e) => /C1/.test(e)), 'every concept gets a note');
  fs.writeFileSync(path.join(dir, 'critique', 'visitor.json'), JSON.stringify(notes(concepts.map((c) => c.id))));
  fs.writeFileSync(path.join(dir, 'critique', 'critic.json'), JSON.stringify(notes(concepts.map((c) => c.id))));
  assert.equal(run('next', { root }).to, 'pick');

  const ids = concepts.map((c) => c.id);
  fs.writeFileSync(path.join(dir, 'pick.json'), JSON.stringify({ ...pick(ids, 'C3'), others: [] }));
  assert.ok(run('done', { root, role: 'judge' }).errors.some((e) => /C1/.test(e)), 'every concept not chosen gets a reason');
  fs.writeFileSync(path.join(dir, 'pick.json'), JSON.stringify(pick(ids, 'C3')));
  assert.deepEqual(run('done', { root, role: 'judge' }), { ok: true });
  assert.equal(run('next', { root }).to, 'build');

  assert.equal(run('asset', { root, from: 'img/kiln.jpg' }).src, 'assets/kiln.jpg');
  assert.equal(run('asset', { root, from: '../outside.txt' }).ok, false, 'nothing outside the project is copied in');
  fs.writeFileSync(path.join(dir, 'page', 'index.html'), GOOD_PAGE);
  r = run('next', { root });
  assert.equal(r.to, 'done', 'without a browser nobody looks, and the session says so');
  assert.ok(r.warnings.some((w) => /nobody looked/.test(w)));

  const handoff = fs.readFileSync(path.join(dir, 'concept.md'), 'utf8');
  for (const want of ['# The kiln at night', '#ff7a1a', 'Fraunces', '| M1 | scroll |', 'Photographs of the firing']) assert.ok(handoff.includes(want), want);

  r = run('close', { root });
  assert.equal(r.concept.name, 'The kiln at night');
  assert.ok(r.page.endsWith('index.html'));
  assert.deepEqual(r.leftOut, ['provocateur']);
});

test('a page the stranger sends back is revised once, and the revision must be newer than the look', () => {
  const root = project();
  const { dir } = run('init', { root });
  const s = JSON.parse(fs.readFileSync(path.join(dir, 'studio.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'concepts.json'), JSON.stringify({ concepts: [{ id: 'C1' }, { id: 'C2' }] }));
  fs.writeFileSync(path.join(dir, 'pick.json'), JSON.stringify(pick(['C1', 'C2'], 'C1')));
  fs.mkdirSync(path.join(dir, 'page'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'page', 'index.html'), GOOD_PAGE.replace('<img src="assets/kiln.jpg">', ''));
  fs.writeFileSync(path.join(dir, 'look.json'), JSON.stringify({ saw: { business: 'A pottery, perhaps a glassworks', feeling: 'warm and patient' }, verdict: 'revise', fixes: ['Show a pot sooner.'] }));
  fs.writeFileSync(path.join(dir, 'studio.json'), JSON.stringify({ ...s, phase: 'look' }));
  assert.equal(run('next', { root }).to, 'revise');
  const later = new Date(Date.now() - 60000);
  fs.utimesSync(path.join(dir, 'page', 'index.html'), later, later);
  assert.ok(run('done', { root, role: 'builder' }).errors.some((e) => /revised/.test(e)));
  fs.appendFileSync(path.join(dir, 'page', 'index.html'), '<p>A pot.</p>');
  assert.equal(run('next', { root }).to, 'done');
  assert.equal(run('close', { root }).revised, true);
});

test('a study is reused only when it is fresh, and one from the earlier version of the studio counts', () => {
  const root = project();
  assert.equal(findReusable(root, 'x', 'latest').from, '2026-01-01');
  assert.equal(findReusable(root, 'x', 'none-such'), null);
  const legacy = path.join(root, '.project-health', 'studio', '2025-12-01');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'study-shown.md'), 'x');
  fs.writeFileSync(path.join(legacy, 'currents.json'), '{}');
  const r = findReusable(root, 'x', '2025-12-01');
  assert.deepEqual(r.business, [path.join('.project-health', 'studio', '2025-12-01', 'study-shown.md')]);
  const old = new Date(Date.now() - 40 * 86400e3);
  for (const f of ['study-shown.md', 'currents.json']) fs.utimesSync(path.join(legacy, f), old, old);
  assert.equal(findReusable(root, 'x', '2025-12-01'), null, 'a study older than 30 days is not reused');
});

test('the skill, its seats and every step it names exist, and the skill names only commands the script has', () => {
  const skill = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  const used = new Set([...skill.matchAll(/`ST (\w+)/g)].map((m) => m[1]));
  for (const cmd of used) assert.ok(COMMANDS[cmd], `SKILL.md uses ${cmd}`);
  for (const step of ['_rules', 'business', 'field', 'seat', 'critic', 'visitor', 'judge', 'builder', 'eye']) assert.ok(fs.existsSync(path.join(SKILL, 'steps', `${step}.md`)), step);
  assert.ok(fs.existsSync(path.resolve(SKILL, '../../agents/designer.md')));
  assert.match(skill, /project-advisory:designer/);
});
