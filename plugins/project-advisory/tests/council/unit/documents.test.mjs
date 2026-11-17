import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpDir, readJson } from '../helpers.mjs';
import { resolveSession } from '../../../skills/council/scripts/lib/session.mjs';
import { loadRecord } from '../../../skills/council/scripts/lib/record.mjs';
import { loadEvidence } from '../../../skills/council/scripts/lib/evidence.mjs';
import { loadVerdicts } from '../../../skills/council/scripts/lib/verdict.mjs';
import { buildModel, validateSuggestions, validateChapter, mergeDiscussion, discussionGaps, numbersIn, brandOf, shownSource } from '../../../skills/council/scripts/lib/documents.mjs';
import { rich, roman, longDate } from '../../../skills/council/scripts/lib/html.mjs';
import { findBrowser } from '../../../skills/council/scripts/lib/browser.mjs';
import { init, status, next, evidence, context, say, verdict, save, render, close, fact, COMMANDS } from '../../../skills/council/scripts/commands.mjs';

const REAL_BROWSER = findBrowser();
// Printing a PDF takes seconds and needs a browser; every test but the last one works with the HTML.
process.env.COUNCIL_NO_BROWSER = '1';

const stdin = (data) => ({ stdin: () => JSON.stringify(data) });
const LONG = 'which is said here at enough length to be a real statement';
const errorOf = (r) => (r.errors ?? r).join('\n');

const hyp = (n, extra = {}) => ({
  type: 'hypothesis', priorArt: { exists: 'no', searched: 'Searched for case studies of this kind on rival sites' }, title: `Idea ${n}: a case study on the services page`, effort: n === 3 ? 'medium' : 'small', scale: 'new',
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

// A small finished debate: T1 (the customer's voice) killed, T2 (search) survived on something observed after one
// round of attack and reply, T3 (content) survived in a smaller form on argument alone. The session stands at "write".
function debated() {
  const root = tmpDir();
  const o = { root };
  const { dir } = init({ root, url: 'https://acme.test' });
  next(o);
  evidence({ root, collect: true });
  evidence({ root, role: 'search' }, stdin({ evidence: [{ grade: 'observed', source: 'https://acme.test/services', text: 'The services page had 310 views in October and no link to the contact page' }] }));
  next(o); next(o);
  say({ root, role: 'client' }, stdin({ statements: [hyp(1)] }));
  say({ root, role: 'search' }, stdin({ statements: [hyp(2, { evidence: ['E1'] })] }));
  say({ root, role: 'content' }, stdin({ statements: [hyp(3)] }));
  for (const role of ['conversion', 'competitors', 'outsider']) say({ root, role }, stdin({ statements: [] }));
  next(o);
  next({ ...o, force: true });
  verdict({ root, stage: 'docket' }, stdin({ admitted: [{ thread: 'T1', novelty: 'familiar' }, { thread: 'T2', novelty: 'familiar' }, { thread: 'T3', novelty: 'familiar' }] }));
  next(o);
  say({ root, role: 'red-team' }, stdin({ statements: [
    { type: 'steelman', thread: 'T2', text: `In its strongest form the idea says that proof brings enquiries, ${LONG}` },
    { type: 'attack', thread: 'T2', kind: 'evidence', evidence: ['E1'], text: `The 310 views may be the company's own staff, ${LONG}` },
  ] }));
  next({ root, force: true });
  const attackNo = loadRecord(dir).statements.find((s) => s.type === 'attack').n;
  say({ root, role: 'search' }, stdin({ statements: [{ type: 'reply', thread: 'T2', stance: 'refute', to: [attackNo], evidence: ['E1'], text: `Staff visits are filtered out of that count, ${LONG}` }] }));
  next({ root, force: true });
  say({ root, role: 'red-team' }, stdin({ statements: [] }));
  assert.equal(next(o).to.phase, 'verdict');
  const vs = 'The services pages lose visitors today, so waiting costs enquiries';
  verdict({ root, stage: 'verdict' }, stdin({ rulings: [
    { thread: 'T1', verdict: 'killed', reason: `Nobody could say why a customer would read it, ${LONG}`, causeOfDeath: 'A customer would never read a case study this long' },
    { thread: 'T2', verdict: 'survived', strength: 'fair', vsDoNothing: vs, reason: `The one attack was answered with the filter, ${LONG}` },
    { thread: 'T3', verdict: 'narrowed', strength: 'speculative', vsDoNothing: vs, reason: `Only a smaller form stands, ${LONG}`, narrowed: { title: 'One short case study on one page', change: 'Publish one short case study on the page for product companies', effect: 'One more enquiry a month from that page' } },
  ] }));
  assert.equal(next(o).to.phase, 'set');
  verdict({ root, stage: 'set', role: 'red-team' }, stdin({ notes: [{ kind: 'order', threads: ['T2', 'T3'], text: `The link to the contact page comes first, since the case study needs it, ${LONG}` }] }));
  assert.equal(next(o).to.phase, 'write');
  const n = (thread, type) => loadRecord(dir).statements.filter((s) => s.thread === thread && s.type === type).map((s) => s.n);
  return { root, o, dir, n, model: () => { const { session } = resolveSession(root); return buildModel({ dir, session, record: loadRecord(dir), evidence: loadEvidence(dir), verdicts: loadVerdicts(dir) }, root); } };
}

const survivor = (idea, extra = {}) => ({
  idea, sentence: 'Publish one case study on the services page so that more visitors go on to write.',
  comesFrom: 'The services page had 310 views in October and no link to the contact page.',
  expected: 'Contact-page visits from the services pages reach 20 a month within six weeks.',
  why: 'Buyers who see proof for their own industry are more likely to write.',
  survived: [{ attack: 'The views may be the staff of the company itself.', answer: 'Staff visits are filtered out of that count.' }],
  uncertain: ['Whether visitors read a case study at all on this page.'],
  test: 'Publish one case study and compare contact-page visits; 20 a month counts as working.',
  killCondition: 'No change in contact-page visits after six weeks.', firstStep: 'Pick the client whose results may be published.',
  fromYou: ['Decide which client may be named on the page.'], upside: 'More enquiries from product companies, the group the site serves least today.', ...extra,
});
const goodSuggestions = () => ({ summary: 'The session looked for ways to bring more enquiries. Two ideas survived, neither on a measured number, so each is a test to run and not a result.', plan: [{ text: 'Start with the case study: it needs nothing but a yes from the client.', ideas: ['I2'] }, { text: 'Then the second idea, read against the first.', ideas: ['I4'] }], survivors: [survivor('I2'), survivor('I4')], killed: [{ idea: 'I1', what: 'A long case study on the services page, published as it was first proposed.', strongestPoint: 'Buyers in this trade do ask for proof before they write.', killedBy: 'Nobody could say why a customer would read a case study that long.', couldReturn: 'Only as a short case study, which survived in another form.' }], bets: [{ idea: 'I1', sentence: 'Publish the first case study as a product of its own, sold apart from the site work.', worthIt: 'Worth trying if one client agrees to be named and the next five enquirers are asked about it.' }], questions: [] });

function chapters(d) {
  const speech = (speaker, refs, text) => ({ speaker, refs, text: `${text}, ${LONG}` });
  return [
    { thread: 'T1', line: 'Killed before the port had gone round once.', pullQuote: 'I should not read it myself',
      scenes: [speech('client', d.n('T1', 'hypothesis'), 'I propose a case study on the services page, though I should not read it myself'), { aside: 'The fire was attended to, at some length.' }, speech('judge', d.n('T1', 'ruling'), 'Killed: nobody could say why a customer would read it')] },
    { thread: 'T2', line: 'Attacked once, answered once, and left standing.', pullQuote: 'The 310 views may be the staff',
      scenes: [
        speech('search', d.n('T2', 'hypothesis'), 'The services page had 310 views and nobody went on'),
        speech('red-team', [...d.n('T2', 'steelman'), ...d.n('T2', 'attack')], 'I am sorry to say it, but The 310 views may be the staff'),
        speech('search', d.n('T2', 'reply'), 'Staff visits are filtered out of that count'),
        speech('judge', d.n('T2', 'ruling'), 'It survives: the one attack was answered'),
      ] },
    { thread: 'T3', line: 'Cut down to one page, and the better for it.', pullQuote: 'Only a smaller form stands',
      scenes: [speech('content', d.n('T3', 'hypothesis'), 'A case study, with the results of the client'), { aside: 'Nobody rose to attack it, which was noticed.' }, speech('judge', d.n('T3', 'ruling'), 'Only a smaller form stands')] },
  ];
}
const goodDiscussion = (d) => ({ title: 'An evening on being found', opening: `The library was warm and the company punctual. ${'The question before the house was put plainly. '.repeat(2)}`, brief: 'Most ideas came through in a smaller form; the one that died was killed by its own page, which already did what it asked.', closing: 'The house rose with two ideas standing and one laid to rest.', memoriam: 'One idea did not see the morning, and was mourned briefly.', chapters: chapters(d) });

// ---- The model ----

test('the model holds what the documents may say: counts, survivors in order, the smaller form of a narrowed idea', () => {
  const d = debated();
  const m = d.model();
  assert.deepEqual(m.counts, { proposed: 3, admitted: 3, survived: 1, narrowed: 1, killed: 1, undecided: 0 });
  assert.deepEqual(m.survivors.map((i) => [i.id, i.thread, i.strength, i.effort]), [['I2', 'T2', 'fair', 'small'], ['I4', 'T3', 'speculative', 'medium']], 'better supported first');
  const small = m.survivors[1];
  assert.deepEqual([small.title, small.originalTitle, small.parentId], ['One short case study on one page', 'Idea 3: a case study on the services page', 'I3']);
  assert.equal(small.hypothesis.change, 'Publish one short case study on the page for product companies');
  assert.equal(small.hypothesis.killCondition, small.originalHypothesis.killCondition);
  assert.deepEqual([m.killed.map((i) => i.id), m.setNotes[0].ideas, m.final], [['I1'], ['Idea 2: a case study on the services page', 'One short case study on one page'], true]);
  assert.deepEqual(m.survivors[0].proposerEvidence.map((e) => e.id), ['E1']);
  assert.equal(m.survivors[0].proposer.title, 'Search and AI answers');
  assert.deepEqual(m.grades, { measured: 0, observed: 1, argued: 0 });
  assert.equal(m.missing.length, 2);
});

test('a source on this computer is printed by where it sits in the project, never as the computer\'s own path', () => {
  const root = path.join(path.parse(process.cwd()).root, 'work', 'client', 'site');
  const data = path.join(path.parse(process.cwd()).root, 'exports', 'acme');
  assert.equal(shownSource(path.join(root, 'pages', 'index.html'), root, data), 'in the project: pages/index.html');
  assert.equal(shownSource(path.join(data, 'visits.csv'), root, data), 'in the data folder: visits.csv');
  assert.equal(shownSource(pathToFileURL(path.join(root, 'index.html')).href, root, null), 'in the project: index.html');
  assert.equal(shownSource(path.join(path.parse(process.cwd()).root, 'other', 'notes.txt'), root, data), 'a file on the computer the session ran on: notes.txt');
  for (const kept of ['https://acme.test/services', 'finding SEC-1a2b', 'the owner, by email', undefined]) assert.equal(shownSource(kept, root, data), kept);
});

test('the documents carry the project name a person gave, else what a health check found, else the folder', () => {
  const root = tmpDir();
  assert.deepEqual(brandOf(root), { name: path.basename(root), nameFrom: 'folder', color: null });
  fs.mkdirSync(path.join(root, '.project-health'), { recursive: true });
  fs.writeFileSync(path.join(root, '.project-health', 'profile.json'), JSON.stringify({ brand: { name: 'Acme', primaryColor: '#0A0E22' } }));
  assert.deepEqual(brandOf(root), { name: 'Acme', nameFrom: 'health check', color: '#0a0e22' });
  fact({ root, key: 'brand.name', value: 'Acme Studio' });
  assert.deepEqual([brandOf(root).name, brandOf(root).nameFrom], ['Acme Studio', 'person']);
  fs.writeFileSync(path.join(root, '.project-health', 'profile.json'), JSON.stringify({ brand: { primaryColor: 'red; } body { display: none' } }));
  assert.equal(brandOf(root).color, null, 'a colour is a colour or it is nothing');
});

// ---- The suggestions ----

test('every survivor is reported, once, with every part', () => {
  const m = debated().model();
  assert.deepEqual(validateSuggestions(goodSuggestions(), m), []);
  const text = errorOf(validateSuggestions({
    summary: 'Too short.',
    survivors: [survivor('I2', { why: '', survived: [], uncertain: [], needs: ['a', 'b', 'c', 'd', 'e', 'f'], grade: 'A' }), survivor('I2'), survivor('I1'), survivor('I9')],
  }, m));
  assert.match(text, /\$\.summary: at least 60 characters/);
  assert.match(text, /\[0\]\.why: at least 20 characters/);
  assert.match(text, /\[0\]\.survived: one to four of the strongest attacks/);
  assert.match(text, /\[0\]\.uncertain: one to five things nobody could test; an idea with nothing uncertain was not examined/);
  assert.match(text, /\[0\]\.needs: at most five things/);
  assert.match(text, /\[0\]: unknown property "grade"/);
  assert.match(text, /\[1\]\.idea: I2 appears twice/);
  assert.match(text, /\[2\]\.idea: "I1" is not a survivor of this session; the survivors are I2, I4/);
  assert.match(text, /\[3\]\.idea: "I9" is not a survivor/);
  assert.match(text, /I4 "One short case study on one page" survived and is missing: every survivor is reported/);
  assert.match(text, /\$\.questions: an array is required/);
  assert.match(errorOf(validateSuggestions([], m)), /must be a JSON object/);
});

test('a number comes from the debate on that idea, or it is not printed', () => {
  const m = debated().model();
  const check = (extra) => errorOf(validateSuggestions({ ...goodSuggestions(), survivors: [survivor('I2', extra), survivor('I4', { comesFrom: 'The services page has no proof for product companies today.' })] }, m));
  assert.equal(check({}), '', '310, 20 and six weeks are in the thread and its evidence');
  assert.match(check({ expected: 'Enquiries rise by 37% and visits reach 1,200 a month within six weeks.' }), /\[0\]: the numbers 37, 1200 are not in the debate on I2 or in the evidence it cites/);
  assert.equal(check({ uncertain: ['Whether 3 of the 5 pages are read at all by visitors.'] }), '', 'small counts need no source');
  const clocked = structuredClone(m);
  for (const i of clocked.ideas) for (const s of i.statements) s.at = '2026-11-16T12:37:45.000Z';
  assert.match(errorOf(validateSuggestions({ ...goodSuggestions(), survivors: [survivor('I2', { expected: 'Enquiries rise by 37% within six weeks.' }), survivor('I4', { comesFrom: 'The services page has no proof for product companies today.' })] }, clocked)), /the number 37 is not in the debate on I2/, 'the time a statement was saved is not a number of the debate');
  // The set note names both survivors, so its numbers are theirs; the killed idea's are not.
  const other = structuredClone(m);
  other.ideas.find((i) => i.thread === 'T1').statements[0].hypothesis.effect = 'Enquiries rise to 77 a month';
  assert.match(errorOf(validateSuggestions({ ...goodSuggestions(), survivors: [survivor('I2', { expected: 'Enquiries reach 77 a month within six weeks.' }), survivor('I4')] }, other)), /\[0\]: the number 77 is not in the debate on I2/, 'another idea\'s number is not this idea\'s');
  assert.match(check({ firstStep: 'Spend 8 hours writing the case study with the client.' }), /"8 hours" reads as an estimate of the work\. Effort is small, medium or large/);
  assert.equal(check({ test: 'Publish it and look again after 6 weeks; 20 a month counts as working.' }), '', 'how long a test waits is not an estimate');
  assert.match(errorOf(validateSuggestions({ ...goodSuggestions(), summary: `${goodSuggestions().summary} Enquiries will rise by 250 a month.` }, m)), /\$\.summary: the number 250 is not in the record/);
  assert.deepEqual(numbersIn('1,200 visits, 12.5% and 16.3 s, in 2026.'), ['1200', '12.5', '16.3', '2026']);
});

test('every question the debate left open reaches the person', () => {
  const d = debated();
  const { session } = resolveSession(d.root);
  const record = loadRecord(d.dir);
  record.questions.push({ n: 90, thread: 'T2', for: 'data', text: 'How many of the views were first visits?', by: 'red-team' }, { n: 91, thread: 'T3', for: 'person', text: 'May the results be published?', by: 'content' });
  const m = buildModel({ dir: d.dir, session, record, evidence: loadEvidence(d.dir), verdicts: loadVerdicts(d.dir) }, d.root);
  const withQ = (questions) => errorOf(validateSuggestions({ ...goodSuggestions(), survivors: [survivor('I2'), survivor('I4', { comesFrom: 'The services page has no proof for product companies today.' })], questions }, m));
  assert.match(withQ([]), /Question 90 \(on "Idea 2: a case study on the services page"\) is missing[\s\S]*Question 91/);
  assert.match(withQ([{ refs: [90, 99], text: 'How many of the views were first visits?' }]), /refs: 99 is not a question in the record[\s\S]*Question 91/);
  assert.equal(withQ([{ refs: [90, 91], text: 'How many views were first visits, and may the results be published?' }]), '');
});

// ---- The discussion ----

test('a chapter renders everything that decided the idea, and nothing that was not said', () => {
  const d = debated();
  const m = d.model();
  const [t1, t2] = chapters(d);
  assert.deepEqual(validateChapter(t2, m), []);
  const change = (fn) => { const c = structuredClone(t2); fn(c); return errorOf(validateChapter(c, m)); };
  assert.match(change((c) => c.scenes.splice(2, 1)), /statement \d+ \(reply by search\) is rendered by no speech; nothing that decided the idea is left out/);
  assert.match(change((c) => { c.scenes[1].speaker = 'content'; }), /refs: statement \d+ was made by red-team, not by content/);
  assert.match(change((c) => { c.scenes[0].refs = d.n('T1', 'hypothesis'); }), /statement \d+ is not part of the debate on T2/);
  assert.match(change((c) => { c.scenes[2].refs = []; }), /a speech with nothing behind it is fiction/);
  assert.match(change((c) => { c.scenes[2].text = `Staff visits are filtered out, which leaves 480 real ones, ${LONG}`; }), /the number 480 is not in the statements it renders/);
  assert.match(change((c) => { c.scenes[3].text = `It survives, with 310 views behind it, ${LONG}`; }), /the number 310 is not in the statements it renders/, 'the ruling cites no evidence, so the figure is not the judge\'s to give');
  assert.match(change((c) => c.scenes.splice(1, 0, { aside: 'The clock struck 9 and nobody looked up.' })), /an aside is the librarian's own remark and carries no numbers/);
  assert.match(change((c) => { c.scenes[0].speaker = 'librarian'; }), /the librarian speaks in asides/);
  assert.match(change((c) => { c.pullQuote = 'Something nobody in the room ever said'; }), /pullQuote: it must be words taken from one of this chapter's speeches, exactly/);
  assert.match(change((c) => { c.line = 'Short.'; }), /line: at least 10 characters/);
  assert.match(change((c) => { c.scenes = c.scenes.slice(0, 2); }), /three to 12 speeches and asides \(it has 2\)/);
  const long = (speaker, n) => change((c) => { c.scenes.find((s) => s.speaker === speaker).text = `${'A point made at some length. '.repeat(n)}`; });
  assert.match(long('red-team', 27), /text: at most 750 characters \(it has \d+\); say it more briefly/);
  assert.equal(long('search', 27), '', 'the speech that puts the idea has more to carry');
  assert.match(long('search', 32), /text: at most 900 characters/);
  assert.match(change((c) => { c.scenes[2].text = `As attacker A said of T12, staff visits are filtered out, ${LONG}`; }), /"attacker A" is a label of the debate; a character names the person/);
  assert.match(long('judge', 16), /the judge's ruling is at most 420 characters: the verdict and the one reason that decided it/);
  assert.match(change((c) => { c.mood = 'tense'; }), /unknown property "mood"/);
  assert.match(errorOf(validateChapter({ ...t1, thread: 'T9' }, m)), /"T9" is not an idea that was debated; the ideas are T1, T2, T3/);
  assert.deepEqual(validateChapter({ ...t2, pullQuote: 'The *310* views may be the staff' }, m), [], 'emphasis marks do not stop a quotation from matching');
});

test('the minutes are saved in parts, and say what is still missing', () => {
  const d = debated();
  const m = d.model();
  const all = goodDiscussion(d);
  assert.deepEqual(discussionGaps(null, m), ['Nothing of the discussion has been saved yet']);
  const first = mergeDiscussion(null, { title: all.title, opening: all.opening, brief: all.brief, chapters: all.chapters.slice(0, 1) }, m);
  assert.deepEqual(first.errors, []);
  assert.deepEqual(discussionGaps(first.discussion, m), ['the closing is missing', '2 ideas have no chapter: T2 "Idea 2: a case study on the services page"; T3 "One short case study on one page"']);
  const second = mergeDiscussion(first.discussion, { chapters: [{ ...all.chapters[0], line: 'Killed, and nobody was surprised by it.' }, ...all.chapters.slice(1)], closing: all.closing }, m);
  assert.deepEqual(second.errors, []);
  assert.equal(second.discussion.chapters.length, 3, 'a chapter saved again replaces the earlier one');
  assert.equal(second.discussion.chapters[0].line, 'Killed, and nobody was surprised by it.');
  assert.deepEqual(discussionGaps(second.discussion, m), []);

  const bad = mergeDiscussion(first.discussion, { opening: 'Too short.', closing: 'The house rose at 11 with 2 ideas standing and one laid to rest for good.', chapters: [{ ...all.chapters[1], scenes: [] }], mood: 'warm' }, m);
  assert.match(errorOf(bad), /\$\.opening: at least 80 characters/);
  assert.match(errorOf(bad), /\$\.closing: the librarian's own words carry no numbers/);
  assert.match(errorOf(bad), /\$\.chapters\[0\]\.scenes: three to 12/);
  assert.match(errorOf(bad), /unknown property "mood"/);
  assert.equal(bad.discussion, undefined, 'nothing is saved when anything is refused');
  assert.deepEqual(mergeDiscussion(null, { opening: `In the winter of 1897 the library was warm. ${'The company was punctual. '.repeat(3)}` }, m).errors, [], 'a year is not a figure');
});

// ---- From writing to the closed session ----

function written() {
  const d = debated();
  const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r.errors)); return r; };
  ok(save({ root: d.root, doc: 'suggestions' }, stdin({ ...goodSuggestions(), survivors: [survivor('I2'), survivor('I4', { comesFrom: 'The services page has no proof for product companies today.' })] })));
  const all = goodDiscussion(d);
  const part = ok(save({ root: d.root, doc: 'discussion' }, stdin({ title: all.title, opening: all.opening, brief: all.brief, chapters: all.chapters.slice(0, 2) })));
  assert.deepEqual([part.chapters, part.of, part.complete], [2, 3, false]);
  assert.match(part.stillMissing.join(' '), /the closing is missing/);
  return { ...d, all, ok };
}

test('the writers each have a turn, and the session waits for both documents', () => {
  const d = debated();
  const s = status(d.o);
  assert.deepEqual(s.turns.map((t) => [t.role, t.done]), [['narrator', false], ['writer', false]]);
  assert.match(s.turns[0].task, /context --root ".*" --session \S+ --role narrator --phase write --save/);
  const blocked = next(d.o);
  assert.equal(blocked.ok, false);
  assert.match(errorOf(blocked), /The suggestions have not been written yet\.[\s\S]*The discussion is not complete: Nothing of the discussion has been saved yet/);

  const narrator = context({ ...d.o, role: 'narrator', save: true });
  assert.ok(narrator.startsWith('# The minutes of the library'));
  assert.match(narrator, /save --doc discussion --root/);
  assert.ok(!narrator.includes('Read nothing else in the session folder'));
  const material = readJson(path.join(d.dir, 'in', 'discussion-model.json'));
  assert.deepEqual(material.cast.map((c) => c.name).slice(0, 2), ['Lady Honoria Fairweather', 'Sir Barnaby Thistlewood']);
  assert.ok(material.cast.every((c) => c.temper), 'the narrator, alone, knows the characters');
  assert.deepEqual(material.ideas.map((i) => [i.thread, i.proposedBy, i.verdict]), [['T1', 'client', 'killed'], ['T2', 'search', 'survived'], ['T3', 'content', 'narrowed']]);
  const writer = context({ ...d.o, role: 'writer', save: true });
  assert.ok(writer.startsWith('# The suggestions'));
  assert.match(writer, /save --doc suggestions --root/);
  assert.deepEqual(readJson(path.join(d.dir, 'in', 'suggestions-model.json')).survivors.map((i) => i.id), ['I2', 'I4']);
  assert.throws(() => context({ ...d.o, role: 'critic' }), /It is not critic's turn in the write phase/);
  assert.match(errorOf(save({ root: d.root, doc: 'review-critic' }, stdin({ verdict: 'A pleasure to read.', issues: [] }))), /reviewed once they are complete and printed/);
  assert.match(errorOf(save({ root: d.root, doc: 'poem' }, stdin({}))), /Unknown or missing --doc "poem"/);
  assert.match(errorOf(render(d.o)), /The suggestions have not been written yet/);
});

test('both documents are written as HTML from the record: verdicts by the script, every text escaped', () => {
  const d = written();
  d.ok(save({ root: d.root, doc: 'discussion' }, stdin({ closing: d.all.closing, memoriam: d.all.memoriam, chapters: [{ ...d.all.chapters[2], line: 'Cut down to one page, <script>alert(1)</script> & the better for it.' }] })));
  assert.deepEqual(status(d.o).turns.map((t) => t.done), [true, true]);
  const moved = d.ok(next(d.o));
  assert.equal(moved.to.phase, 'review');
  assert.ok(moved.warnings.some((w) => /No Chrome, Edge or Chromium was found, so suggestions\.html is the document/.test(w)));
  assert.ok(moved.warnings.some((w) => /so brief\.html is the document/.test(w)));
  assert.equal(moved.documents.discussion.pdf, null);

  const talk = fs.readFileSync(path.join(d.dir, 'discussion.html'), 'utf8');
  assert.ok(!talk.includes('<script>alert'), 'what an agent wrote is escaped');
  assert.ok(talk.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; the better for it.'));
  for (const part of ['<html lang="en">', 'An evening on being found', 'Chapter I<', 'Chapter III<', 'Lady Honoria Fairweather', 'stamp-killed">Killed', 'stamp-narrowed">Survived, smaller', 'stamp-survived">Survived<', '<dt>Cause of death</dt><dd>A customer would never read a case study this long', '<dt>What stands</dt><dd>One short case study on one page', '<dt>Support</dt>', 'Evidence: E1', 'In memoriam', 'The evidence cited', 'The characters are invented'.toLowerCase().slice(4, 26), '<th scope="col">Verdict</th>']) assert.ok(talk.includes(part), part);
  assert.ok(talk.indexOf('Chapter I<') < talk.indexOf('Chapter II<'));
  // The front says what was decided; the idea-by-idea list is the résumé after the story.
  const [brief, chapterOne, closing, resume, cited] = ['The evening in brief', 'Chapter I<', 'The house rises', 'The evening in sum', 'The evidence cited'].map((x) => talk.indexOf(x));
  assert.ok(brief > 0 && brief < chapterOne && chapterOne < closing && closing < resume && resume < cited, 'brief, chapters, closing, résumé, evidence');
  assert.ok(talk.includes('Most ideas came through in a smaller form'));
  assert.ok(talk.indexOf('class="brief-table"') > resume, 'the list of ideas is not on the front');
  assert.ok(talk.includes('<span class="seat">, The red team</span>'), 'a speaker is named with the seat');

  const report = fs.readFileSync(path.join(d.dir, 'suggestions.html'), 'utf8');
  for (const part of ['Council · Suggestions', 'Make potential clients see clearly what the business offers and why to choose it, on the site and beyond it, so that more of them get in touch', '<b>2</b> debated'.replace('2', '3'), '<b>1</b> killed', 'tag-fair">fair support', 'tag-speculative">speculative support', 'tag-scale-new">new', 'How far an idea reaches', 'New things first, then remakes', '<h2 class="group">New directions</h2>', 'A smaller form of the idea as it was proposed: “Idea 3: a case study on the services page”', '<h2>Where to start</h2>', 'href="#idea-I2">idea 1</a>', '<h2>Your decisions</h2>', '<h3>What we need from you</h3>', 'Decide which client may be named on the page.', '<dt>First step</dt>', '<dt>Needs from you</dt>', '<dt>Drop it if</dt>', '<h4 class="case">The case for it</h4>', 'Proposed from the seat of Search and AI answers', 'debated in chapter II of the discussion', 'The survivors as a set', 'tag-order">Order', 'Bold ideas the council could not prove', 'Worth trying if', 'Method and limits', 'No data was shared']) assert.ok(report.includes(part), part);
  // The owner is asked the decision the next session runs on, with the council's advice and a place to mark it.
  for (const part of ['<b>What you decide:</b> for each idea, <b>yes</b> (test it), <b>later</b>, or <b>no</b> with a reason', 'The council advises yes for each', '<th scope="col">Your answer</th>', '<i class="box" aria-hidden="true"></i>Later']) assert.ok(report.includes(part), part);
  assert.ok(report.indexOf('What you decide:') < report.indexOf('<h3>What we need from you</h3>'), 'the decision is asked before the side questions');
  assert.ok(report.indexOf('id="idea-I2"') < report.indexOf('id="idea-I4"'), 'the better supported idea comes first');
  assert.ok(!/\bhours?\b/.test(report));
});

test('the minutes are read by two reviewers who did not write them, revised once, and the session is closed', () => {
  const d = written();
  d.ok(save({ root: d.root, doc: 'discussion' }, stdin({ closing: d.all.closing, chapters: d.all.chapters.slice(2) })));
  d.ok(next(d.o));
  assert.deepEqual(status(d.o).turns.map((t) => [t.role, t.done]), [['fidelity', false], ['critic', false]], 'with no PDF there is no layout to look at');
  assert.match(errorOf(close(d.o)), /the fidelity reviewer; the literary critic have not had their turn\. Start them, or pass --force/);
  assert.match(errorOf(next(d.o)), /The session ends with "close"/);

  const fidelity = context({ ...d.o, role: 'fidelity', save: true });
  assert.ok(fidelity.startsWith('# Fidelity review of the minutes'));
  assert.match(fidelity, /save --doc review-fidelity --root/);
  const critic = context({ ...d.o, role: 'critic', save: true });
  assert.ok(critic.startsWith('# The critic'));
  assert.match(critic, /The document to read, from the first page to the last: .*discussion\.html/);
  assert.deepEqual(readJson(path.join(d.dir, 'in', 'critic.json')).chapters.map((c) => [c.chapter, c.thread]), [[1, 'T1'], [2, 'T2'], [3, 'T3']]);

  const bad = save({ root: d.root, doc: 'review-fidelity' }, stdin({ verdict: 'Mostly true to it.', issues: [{ where: 'T9', kind: 'made-up', severity: 'huge', what: 'x' }, { where: 'T2', kind: 'softened', severity: 'medium', what: 'The attack was a doubt, not a blow.' }] }));
  assert.match(errorOf(bad), /\[0\]\.where: a chapter by its idea[\s\S]*\[0\]\.kind: one of invented, reversed[\s\S]*\[0\]\.severity[\s\S]*\[1\]\.scene: the position of the speech/);
  d.ok(save({ root: d.root, doc: 'review-fidelity' }, stdin({ verdict: 'The minutes can be trusted as an account.', issues: [] })));
  assert.deepEqual(d.ok(save({ root: d.root, doc: 'review-critic' }, stdin({ verdict: 'A pleasure, with one slow chapter.', issues: [{ where: 'T1', scene: 2, kind: 'forced-humour', severity: 'low', what: 'The fire is attended to once too often.', replacement: 'The fire settled.' }] }))).issues, { high: 0, medium: 0, low: 1 });

  assert.deepEqual(status(d.o).turns.map((t) => [t.role, t.done]), [['fidelity', true], ['critic', true], ['narrator', false]], 'the reviews found something, so the librarian revises');
  const again = context({ ...d.o, role: 'narrator', save: true });
  assert.match(again, /The fidelity review, every issue of which you apply or answer: .*review-fidelity\.json/);
  assert.match(again, /The minutes as they stand, to go on from or to revise/);
  d.ok(save({ root: d.root, doc: 'discussion' }, stdin({ chapters: [{ ...d.all.chapters[0], scenes: d.all.chapters[0].scenes.map((s) => (s.aside ? { aside: 'The fire settled.' } : s)) }] })));
  assert.deepEqual(status(d.o).turns.at(-1), { ...status(d.o).turns.at(-1), role: 'narrator', done: true });
  assert.match(status(d.o).next, /A document changed after it was printed\. Run "render"/);
  assert.match(errorOf(close(d.o)), /A document changed after it was printed: run "render" first/);
  assert.equal(d.ok(render(d.o)).rendered, 2);
  assert.ok(fs.readFileSync(path.join(d.dir, 'discussion.html'), 'utf8').includes('The fire settled.'));
  assert.match(status(d.o).next, /The documents are reviewed\. Run "close"/);

  const closed = d.ok(close(d.o));
  assert.match(closed.documents.suggestions, /suggestions\.html$/);
  assert.deepEqual(closed.skipped, []);
  assert.equal(close({ root: d.root, session: closed.session }).already, true);
  assert.equal(init({ root: d.root }).ok, true, 'next week\'s session can start');
  for (const c of ['save', 'render', 'close']) assert.ok(COMMANDS[c], c);
});

test('with a browser the documents are printed, and each printing gets a layout review', { skip: !REAL_BROWSER }, () => {
  const d = written();
  d.ok(save({ root: d.root, doc: 'discussion' }, stdin({ closing: d.all.closing, chapters: d.all.chapters.slice(2) })));
  delete process.env.COUNCIL_NO_BROWSER;
  try {
    const moved = d.ok(next(d.o));
    assert.ok(moved.documents.suggestions.pages >= 2, 'the suggestions have a first page and at least one more');
    assert.ok(moved.documents.discussion.pages >= 2);
    assert.ok(fs.statSync(moved.documents.discussion.pdf).size > 10000);
    assert.deepEqual(status(d.o).turns.map((t) => t.role), ['fidelity', 'critic', 'layout-brief', 'layout-suggestions', 'layout-discussion']);
    assert.ok(moved.documents.brief.pages >= 1);
    const layout = context({ ...d.o, role: 'layout-discussion', save: true });
    assert.ok(layout.startsWith('# Layout review of a rendered document'));
    assert.match(layout, /"doc": "discussion", "pagesSeen": \d+/);
    assert.ok(!layout.includes('<doc>'));
    const pages = moved.documents.discussion.pages;
    assert.match(errorOf(save({ root: d.root, doc: 'layout-discussion' }, stdin({ doc: 'discussion', pagesSeen: pages - 1, defects: [{ page: 99, kind: 'ugly', severity: 'high', cause: 'template', where: 'x', what: 'y' }] }))), /look at every page[\s\S]*page: a page number from 1 to/);
    const saved = d.ok(save({ root: d.root, doc: 'layout-discussion' }, stdin({ doc: 'discussion', pagesSeen: pages, defects: [{ page: 1, kind: 'large-gap', severity: 'high', cause: 'template', where: 'The opening', what: 'Half the page is empty' }], notes: [] })));
    assert.deepEqual([saved.defects, saved.byCause], [{ high: 1, medium: 0, low: 0 }, { template: 1, content: 0 }]);
    assert.equal(status(d.o).turns.find((t) => t.role === 'layout-discussion').done, true);
    d.ok(render(d.o));
    assert.equal(status(d.o).turns.find((t) => t.role === 'layout-discussion').done, false, 'a new printing is looked at again');
    d.ok(render(d.o));
    assert.equal(status(d.o).turns.find((t) => t.role === 'layout-discussion').done, true, 'and after two rounds it is not asked for again');
    const closed = d.ok(close({ ...d.o, force: true }));
    assert.match(closed.documents.discussion, /discussion\.pdf$/);
    assert.match(closed.documents.brief, /brief\.pdf$/);
    assert.deepEqual(closed.highLayoutDefects, ['discussion, page 1: Half the page is empty']);
  } finally {
    process.env.COUNCIL_NO_BROWSER = '1';
  }
});

test('the small helpers of the page', () => {
  assert.equal(rich('A <b>bold</b> claim & a **strong** one, *said softly*'), 'A &lt;b&gt;bold&lt;/b&gt; claim &amp; a <strong>strong</strong> one, <em>said softly</em>');
  assert.equal(rich('2 * 3 * 4 stays as it is'), '2 * 3 * 4 stays as it is');
  assert.deepEqual([roman(1), roman(4), roman(9), roman(14), roman(40)], ['I', 'IV', 'IX', 'XIV', 'XL']);
  assert.equal(longDate('2026-11-15-2'), '15 November 2026');
});

test('texts the judge and the red team wrote for each other are made readable: no ids of the debate', async () => {
  const { readerText, paras } = await import('../../../skills/council/scripts/lib/html.mjs');
  const name = (id) => ({ T12: 'idea 3', T5: 'idea 2' }[id] ?? null);
  assert.equal(readerText('T12 asks for a check (E96, E118), and T5 does not (question 95). Only T12 holds; T99 is unknown.', name), 'Idea 3 asks for a check, and idea 2 does not. Only idea 3 holds; T99 is unknown.');
  assert.equal(readerText("One form (the page opens on 'Loading…', E96) serves all (T12's opinion, question 95).", name), "One form (the page opens on 'Loading…') serves all (idea 3's opinion).");
  assert.equal(readerText('Seen on the page (E12 and E13).', name), 'Seen on the page.');
  assert.equal(paras('The fire was lit.\n\nThe company came in.\n \nNobody spoke.'), '<p>The fire was lit.</p><p>The company came in.</p><p>Nobody spoke.</p>');
  assert.equal(paras('One <b>paragraph</b> only'), '<p>One &lt;b&gt;paragraph&lt;/b&gt; only</p>');
});

test('the narrator can set the order of the chapters, and a speaker who goes straight on is named once', () => {
  const d = written();
  d.ok(save({ root: d.root, doc: 'discussion' }, stdin({ closing: d.all.closing, chapters: d.all.chapters.slice(2) })));
  const model = d.model();
  const current = readJson(path.join(d.dir, 'discussion.json'));
  assert.deepEqual(current.chapters.map((c) => c.thread), ['T1', 'T2', 'T3']);
  assert.deepEqual(mergeDiscussion(current, { order: ['T3', 'T1', 'T2'] }, model).discussion.chapters.map((c) => c.thread), ['T3', 'T1', 'T2']);
  for (const order of [['T3', 'T1'].concat('T9'), ['T1', 'T1', 'T2'], 'T1']) assert.match(errorOf(mergeDiscussion(current, { order }, model)), /\$\.order: the ideas of the saved chapters, each once/);

  // The red team speaks twice in a row in chapter two.
  const twice = structuredClone(d.all.chapters[1]);
  const [steel, attack] = [d.n('T2', 'steelman'), d.n('T2', 'attack')];
  twice.scenes.splice(1, 1, { speaker: 'red-team', refs: steel, text: `Let me first put the idea at its best, ${LONG}` }, { speaker: 'red-team', refs: attack, text: `I am sorry to say it, but The 310 views may be the staff, ${LONG}` });
  d.ok(save({ root: d.root, doc: 'discussion' }, stdin({ chapters: [twice] })));
  d.ok(next(d.o));
  const html = fs.readFileSync(path.join(d.dir, 'discussion.html'), 'utf8');
  assert.equal(html.match(/<p class="speaker">Dr Lucius Graves<span class="seat">, The red team<\/span><\/p>/g).length, 1);
  assert.equal(html.match(/class="speech speech-on"/g).length, 1);
});

// ---- The decision brief and the session's pages ----

// Every relative link of every page of the site leads to a file that exists.
function brokenLinks(siteDir) {
  const broken = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.html') ? [path.join(dir, e.name)] : []));
  for (const file of walk(siteDir)) {
    const html = fs.readFileSync(file, 'utf8');
    for (const [, href] of html.matchAll(/(?:href|src)="([^"#]+)(?:#[^"]*)?"/g)) {
      if (/^(https?:|mailto:)/.test(href)) continue;
      if (!fs.existsSync(path.resolve(path.dirname(file), href))) broken.push(`${path.relative(siteDir, file)} -> ${href}`);
    }
  }
  return broken;
}

test('the decision brief and the session pages show every idea, each analysed, and nothing ranked', () => {
  const d = written();
  d.ok(save({ root: d.root, doc: 'discussion' }, stdin({ closing: d.all.closing, chapters: d.all.chapters.slice(2) })));
  const moved = d.ok(next(d.o));
  assert.ok(moved.documents.brief.html.endsWith('brief.html'));

  const brief = fs.readFileSync(path.join(d.dir, 'brief.html'), 'utf8');
  for (const part of ['Council · Decision brief', 'class="decision-brief"', 'The ideas that survived', 'none ranked above another', '<dt>If it works</dt>', 'More enquiries from product companies', '<dt>Drop it if</dt>', '<dt>Needs from you</dt>', 'Bold ideas the council could not prove', '<dt>Its strongest point</dt>', 'Buyers in this trade do ask for proof', 'Where the rest is', 'site/index.html']) assert.ok(brief.includes(part), part);
  assert.ok(!brief.includes('Your answer'), 'the brief is read, not filled in');
  for (const idea of d.model().ideas) assert.ok(brief.includes(idea.title.replace(/&/g, '&amp;')) || brief.includes(idea.originalTitle), `every idea is in the brief: ${idea.id}`);

  const site = path.join(d.dir, 'site');
  const index = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
  for (const part of ['<a class="skip" href="#main">', '<main id="main">', '<nav class="site-nav" aria-label="Session pages">', 'aria-current="page"', 'Every idea the council looked at', '<caption>', '<th scope="col" data-type="number"><button type="button">', 'role="status"', 'href="ideas/I2.html"', 'href="style.css"']) assert.ok(index.includes(part), part);
  assert.ok(!/fonts\.googleapis/.test(index), 'the pages load nothing from the web');
  const killed = d.model().killed[0];
  const dead = fs.readFileSync(path.join(site, 'ideas', `${killed.id}.html`), 'utf8');
  for (const part of ['<dt>Its strongest point</dt>', '<dt>Could it return</dt>', 'As it was proposed', 'Looked for elsewhere first', 'Nothing like it was found', 'How it was argued', 'class="record"', 'Ruling: killed']) assert.ok(dead.includes(part), part);
  const lived = fs.readFileSync(path.join(site, 'ideas', 'I2.html'), 'utf8');
  for (const part of ['<dt>If it works</dt>', 'The case for it', 'Attack: the evidence is weak or reads another way', 'href="../evidence.html#E1"', 'Chapter II of the discussion']) assert.ok(lived.includes(part), part);
  assert.match(fs.readFileSync(path.join(site, 'evidence.html'), 'utf8'), /<tr id="E1">/);
  assert.ok(fs.existsSync(path.join(site, 'discussion', '1.html')));
  assert.ok(fs.existsSync(path.join(site, 'method.html')));
  assert.deepEqual(brokenLinks(site), []);

  const history = fs.readFileSync(path.join(d.root, '.project-health', 'ideas.html'), 'utf8');
  for (const part of ['Every idea, every session', 'Changed in the latest session', 'href="council/', '/site/ideas/I2.html"', 'href="cache/site.css"']) assert.ok(history.includes(part), part);
  assert.match(fs.readFileSync(path.join(d.root, '.project-health', '.gitignore'), 'utf8'), /^ideas\.html$/m);
});
