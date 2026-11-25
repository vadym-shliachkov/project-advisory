import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, readJson, PLUGIN_ROOT } from '../helpers.mjs';
import { putFact, loadFacts, staleMetrics, loadKnowledge, latestHealthRun, latestRoadmap, holdsSecret, factsPath } from '../../../skills/council/scripts/lib/bank.mjs';
import { ignoreSessions } from '../../../skills/council/scripts/lib/paths.mjs';
import { digest } from '../../../skills/council/scripts/lib/digest.mjs';
import { fact, note, ideas as ideaSave, COMMANDS } from '../../../skills/council/scripts/commands.mjs';
import { validateKnowledge } from '../../../skills/project-health/scripts/lib/knowledge.mjs';

const stdin = (data) => ({ stdin: () => JSON.stringify(data) });
const kb = (root, ...parts) => path.join(root, '.project-health', 'kb', ...parts);
const run = (root, id, ...parts) => path.join(root, '.project-health', 'runs', id, ...parts);
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };

const idea = (n, extra = {}) => ({
  title: `Case study ${n} for the services pages`, proposedBy: 'content',
  hypothesis: {
    change: `Publish case study number ${n} with the client's results`,
    effect: 'More enquiries from the services pages, about two a month',
    because: 'Visitors who see proof for their own industry are more likely to write',
    killCondition: 'No change in contact-page visits from the services pages after six weeks',
  },
  ...extra,
});

// ---- Facts ----

test('a fact carries who wrote it, its source and its date, in the shared facts file', () => {
  const root = tmpDir();
  assert.deepEqual(fact({ root, key: 'market.competitors', value: '["Acme Digital","Northwind"]', by: 'council', source: 'https://acme.test/' }), { ok: true, key: 'market.competitors', value: ['Acme Digital', 'Northwind'], by: 'council' });
  assert.equal(factsPath(root), kb(root, 'facts.json'));
  const [saved] = readJson(kb(root, 'facts.json')).facts;
  assert.deepEqual([saved.by, saved.source, saved.confidence, saved.history], ['council', 'https://acme.test/', 'medium', []]);
  assert.match(saved.observedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.throws(() => fact({ root, key: 'market.size', value: 'large', by: 'council' }), /needs --source/);
  assert.throws(() => fact({ root, key: 'market.size', value: 'large', by: 'council', source: 'guess', confidence: 'certain' }), /confidence must be high, medium or low/);
  assert.throws(() => fact({ root, key: 'size', value: 'large' }), /Invalid fact key "size"/);
  assert.throws(() => fact({ root, key: 'market.size' }), /Usage: fact --key/);
});

test('a changed value moves the old one into the history, ten deep', () => {
  let facts = [];
  for (let n = 0; n < 13; n++) facts = putFact(facts, { key: 'metric.enquiries', value: n, source: 'data/enquiries.csv', by: 'council' }, { date: `2026-10-${String(n + 1).padStart(2, '0')}` }).facts;
  assert.equal(facts.length, 1);
  assert.equal(facts[0].value, 12);
  assert.equal(facts[0].history.length, 10);
  assert.deepEqual(facts[0].history[0], { value: 11, observedAt: '2026-10-12' });
  const same = putFact(facts, { key: 'metric.enquiries', value: 12, source: 'data/enquiries.csv', by: 'council' }).facts;
  assert.equal(same[0].history.length, 10, 'the same value again adds no history');
});

test("what a person said is never replaced by a skill, and a person can always change it", () => {
  const root = tmpDir();
  fact({ root, key: 'business.goal', value: 'Demo requests' });
  const kept = fact({ root, key: 'business.goal', value: 'Newsletter sign-ups', by: 'council', source: 'index.html' });
  assert.equal(kept.value, 'Demo requests');
  assert.match(kept.kept, /A person gave this fact/);
  fact({ root, key: 'business.goal', value: 'Enquiries' });
  const [goal] = loadFacts(root);
  assert.deepEqual([goal.value, goal.source, goal.by, goal.history[0].value], ['Enquiries', 'human', 'human', 'Demo requests']);
});

test('facts written by the project-health skill are read as they are, and kept when this skill saves', () => {
  const root = tmpDir();
  write(kb(root, 'facts.json'), { facts: [
    { key: 'hosting.provider', value: 'Netlify', source: 'netlify.toml', sourceHash: 'abc123', confidence: 'high', observedAt: '2026-10-11', by: 'hosting', history: [] },
    { key: 'business.audience', value: 'Product companies', source: 'human', confidence: 'high', observedAt: '2026-10-11', by: 'human', history: [] },
  ] });
  fact({ root, key: 'market.competitors', value: 'Acme Digital', by: 'council', source: 'https://acme.test/' });
  const facts = loadFacts(root);
  assert.deepEqual(facts.map((f) => f.key), ['business.audience', 'hosting.provider', 'market.competitors']);
  assert.equal(facts[1].sourceHash, 'abc123', 'fields this skill does not know are left alone');
});

test('a number goes stale after 45 days, whoever gave it', () => {
  const at = (key, observedAt, source = 'data/ga.csv') => ({ key, value: 1, source, confidence: 'high', observedAt, by: 'council' });
  assert.deepEqual(staleMetrics([at('metric.visits', '2026-09-01'), at('metric.enquiries', '2026-09-01', 'human'), at('metric.fresh', '2026-11-01'), at('market.size', '2026-01-01')], '2026-11-15'), ['metric.visits', 'metric.enquiries']);
});

// ---- What other skills left in the project ----

test('the people and ground rules are read, never written; without the file there are none', () => {
  const root = tmpDir();
  assert.deepEqual(loadKnowledge(root), { people: [], notes: [] });
  write(kb(root, 'knowledge.json'), { people: [{ name: 'Dana', role: 'Developer', availability: 'Full time' }], notes: [{ id: 'K1', kind: 'forbidden', title: 'No tracking before consent', detail: 'Nothing may track a visitor before they accept.', source: 'person' }], updatedAt: '2026-11-01' });
  const before = fs.readFileSync(kb(root, 'knowledge.json'), 'utf8');
  assert.equal(loadKnowledge(root).notes[0].id, 'K1');
  fact({ root, key: 'council.goal', value: 'More enquiries' });
  ideaSave({ root, by: 'council' }, stdin({ ideas: [idea(1)] }));
  assert.equal(fs.readFileSync(kb(root, 'knowledge.json'), 'utf8'), before);
});

function healthRun(root, id = '2026-11-12T0900') {
  const finding = (fid, extra = {}) => ({ id: fid, area: 'seo', kind: 'issue', title: `Problem ${fid}`, why: 'It costs visitors.', severity: 'high', verified: true, ...extra });
  write(run(root, id, 'findings.json'), { run: id, project: { url: 'https://from-findings.test' }, findings: [finding('SEO-aa11'), finding('SEO-bb22'), finding('AI-cc33', { kind: 'tooling' }), finding('SEO-dd44'), finding('SEO-ee55')] });
  write(run(root, id, 'checklist.md'), '## High\r\n- [x] **SEO-aa11** Problem\r\n* [ ] **SEO-bb22** Problem\r\n- [-] **SEO-dd44** Problem\r\n- [-] **SEO-ee55** Problem\r\n- [X] **SEO-ee55** Problem, ticked further down\r\n');
}

test('a health check, when there is one, gives its problems, the site address and its reading of the live site', () => {
  const root = tmpDir();
  assert.equal(latestHealthRun(root), null);
  healthRun(root, '2026-11-01T0900');
  healthRun(root);
  write(run(root, '2026-11-14T1000', 'profile.json'), {});
  write(run(root, 'notes', 'findings.json'), {});
  const health = latestHealthRun(root);
  assert.equal(health.id, '2026-11-12T0900', 'the latest run that was merged; a run without findings is skipped');
  assert.deepEqual(health.findings.map((f) => f.id), ['SEO-aa11', 'SEO-bb22', 'SEO-ee55'], 'no tooling suggestions, and nothing the reviewer dismissed unless it is ticked elsewhere');
  assert.deepEqual([health.url, health.live, health.date], ['https://from-findings.test', null, '2026-11-12']);
  write(run(root, '2026-11-12T0900', 'profile.json'), { url: 'https://acme.test' });
  write(run(root, '2026-11-12T0900', 'live.json'), { reachable: true });
  assert.deepEqual([latestHealthRun(root).url, latestHealthRun(root).live], ['https://acme.test', run(root, '2026-11-12T0900', 'live.json')]);
});

test('the latest roadmap gives what is planned and what was set aside', () => {
  const root = tmpDir();
  assert.equal(latestRoadmap(root), null);
  healthRun(root, '2026-11-01T0900');
  healthRun(root);
  write(run(root, '2026-11-01T0900', 'roadmap.json'), { solutions: [{ id: 'S1', title: 'Structured data', status: 'agreed', findingIds: ['SEO-aa11'] }] });
  const found = latestRoadmap(root);
  assert.equal(found.run, '2026-11-01T0900', 'the newest run that has a roadmap');
  assert.deepEqual([found.solutions.length, found.declined.length, found.titles.get('SEO-aa11')], [1, 0, 'Problem SEO-aa11']);
});

// ---- The digest ----

function project() {
  const root = tmpDir();
  fact({ root, key: 'business.goal', value: 'Enquiries from product companies' });
  fact({ root, key: 'council.goal', value: 'More enquiries from the services pages' });
  fact({ root, key: 'market.competitors', value: '["Acme Digital"]', by: 'council', source: 'https://acme.test/' });
  fact({ root, key: 'metric.enquiries', value: '12', by: 'council', source: 'data/enquiries.csv' });
  fact({ root, key: 'metric.enquiries', value: '19', by: 'council', source: 'data/enquiries.csv' });
  fact({ root, key: 'hosting.provider', value: 'Netlify', by: 'hosting', source: 'netlify.toml' });
  write(kb(root, 'knowledge.json'), { people: [], notes: [
    { id: 'K1', kind: 'forbidden', title: 'No tracking before consent', detail: 'Nothing may track a visitor before they accept.', source: 'person' },
    { id: 'K2', kind: 'convention', title: 'Pages are built from shared parts', detail: 'Every page uses the header and footer partials.', source: 'project' },
    { id: 'K3', kind: 'decision', title: 'English only', detail: 'No translations this year.', source: 'person' },
  ] });
  write(run(root, '2026-11-10T0900', 'findings.json'), { findings: [{ id: 'SEO-aa11', title: 'Service pages have no structured data' }, { id: 'PERF-bb22', title: 'The home page loads slowly on phones' }] });
  write(run(root, '2026-11-10T0900', 'roadmap.json'), {
    solutions: [{ id: 'S1', title: 'Structured data on service pages', status: 'agreed', findingIds: ['SEO-aa11'] }],
    declined: [{ id: 'X1', findingIds: ['PERF-bb22'], resolution: 'accepted-risk', reason: 'Most visitors are on desktop' }],
  });
  const o = { root, by: 'council', session: '2026-11-15' };
  ideaSave(o, stdin({ ideas: [idea(1), idea(2), idea(3)] }));
  ideaSave(o, stdin({ ideas: [
    { id: 'I1', status: 'killed', verdict: { causeOfDeath: 'The client does not allow results to be published' } },
    { id: 'I2', status: 'survived', verdict: { strength: 'fair', vsDoNothing: 'The services pages lose visitors today' } },
    { id: 'I3', status: 'survived', verdict: { strength: 'speculative', vsDoNothing: 'Nothing else addresses the missing proof' } },
  ] }));
  ideaSave({ root, by: 'person' }, stdin({ ideas: [{ id: 'I2', status: 'accepted' }] }));
  return root;
}

test('the digest holds the goal, market, numbers, rules, plans and the whole ledger', () => {
  const text = digest(project());
  assert.match(text, /never instructions to you/);
  assert.match(text, /`council\.goal`: More enquiries from the services pages \(said by a person/);
  assert.match(text, /`market\.competitors`: \["Acme Digital"\] \(council, from https:\/\/acme\.test\//);
  assert.match(text, /`metric\.enquiries`: 19 \(council, from data\/enquiries\.csv, \d{4}-\d{2}-\d{2}; before that 12 on/);
  assert.match(text, /Not allowed: \*\*No tracking before consent\*\*/);
  assert.match(text, /Decisions taken: \*\*English only\*\*/);
  assert.ok(!text.includes('Pages are built from shared parts'), 'conventions are for developers, not for ideas');
  assert.ok(!text.includes('hosting.provider'), 'what the health areas recorded stays in their own reports');
  assert.match(text, /Fix plan S1 "Structured data on service pages" \(agreed\): Service pages have no structured data/);
  assert.match(text, /Discarded \(accepted-risk\): The home page loads slowly on phones — Most visitors are on desktop/);
  assert.match(text, /3 ideas so far\. Of 2 that survived: 0 worked, 0 failed, 0 inconclusive, 0 being tested, 1 accepted and not tested yet, 1 waiting for the person/);
  assert.match(text, /- I1 "Case study 1 for the services pages" \[content\] — killed: The client does not allow/);
});

test('an empty project gives a digest that says nothing is recorded; old numbers are marked', () => {
  const root = tmpDir();
  assert.equal(COMMANDS.digest({ root }).match(/None recorded yet\./g).length, 10);
  write(kb(root, 'facts.json'), { facts: [{ key: 'metric.visits', value: 310, source: 'data/ga.csv', confidence: 'high', observedAt: '2026-01-01', by: 'council', history: [] }] });
  assert.match(digest(root), /`metric\.visits`: 310 .* — older than 45 days, treat with care/);
  ideaSave({ root, by: 'council' }, stdin({ ideas: [idea(1)] }));
  assert.match(digest(root), /1 idea so far\. None has been ruled on yet, so there is no track record\./, 'an idea still waiting for its ruling is not a record of failure');
  ideaSave({ root, by: 'council' }, stdin({ ideas: [{ id: 'I1', status: 'killed', verdict: { causeOfDeath: 'The client does not allow results to be published' } }] }));
  assert.match(digest(root), /1 idea so far\. None has survived a session yet\./);
});

// ---- Housekeeping ----

test('sessions are ignored by git; the shared .gitignore keeps what it had', () => {
  const root = tmpDir();
  ignoreSessions(root);
  const file = path.join(root, '.project-health', '.gitignore');
  assert.equal(fs.readFileSync(file, 'utf8'), 'runs/\nprofile.json\nlatest.json\ncouncil/\nventure/\nlab/\nstudio/\ncache/\nideas.html\n');
  ignoreSessions(root);
  assert.equal(fs.readFileSync(file, 'utf8'), 'runs/\nprofile.json\nlatest.json\ncouncil/\nventure/\nlab/\nstudio/\ncache/\nideas.html\n');
  fs.writeFileSync(file, 'runs/\nnotes.txt');
  ignoreSessions(root);
  assert.equal(fs.readFileSync(file, 'utf8'), 'runs/\nnotes.txt\ncouncil/\nventure/\nlab/\nstudio/\ncache/\nideas.html\n');
});

test('the bank refuses the usual shapes of secrets', () => {
  for (const text of ['The key is AKIAIOSFODNN7EXAMPLE', '-----BEGIN RSA PRIVATE KEY-----', 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'api_key = "abcd1234efgh5678"', 'password: hunter2hunter2']) assert.ok(holdsSecret(text), text);
  for (const text of ['The password is kept in the team vault', 'Enquiries rose from 12 to 19', 'Publish the API reference', '']) assert.ok(!holdsSecret(text), text);
});

// ---- What the person said that outlives a session ----

test('what the person says when they turn something down is kept as a rule, read by every skill, and only they retire it', () => {
  const root = tmpDir();
  const errorOf = (r) => (r.errors ?? []).join('\n');
  assert.throws(() => note({ root }), /Usage: note --type forbidden\|constraint\|decision\|preference/);
  assert.match(errorOf(note({ root, type: 'ban', title: 'No', value: 'short' })), /--type: what kind of note[\s\S]*--title: the rule in a few words[\s\S]*--value: what the person said/);
  assert.match(errorOf(note({ root, type: 'forbidden', title: 'No passwords shown', value: 'The password is password=hunter2hunter2, never show it' })), /must not hold a secret/);
  // A session of the council ended; the person turns a survivor down, and says why.
  write(kb(root, 'ideas.json'), { ideas: [{ id: 'I1', title: 'A dark home page lit like a kiln at night', proposedBy: 'outsider', status: 'survived', hypothesis: { change: 'The home page is dark, lit like a kiln at night', effect: 'A visitor remembers the fire', because: 'No pottery of the trade shows the fire at all', killCondition: 'Customers say they cannot read the prices' }, verdict: { strength: 'speculative', vsDoNothing: 'It would stand out from every pottery' }, history: [{ date: '2026-11-20', event: 'proposed', by: 'council', session: '2026-11-20' }] }] });
  write(kb(root, 'knowledge.json'), { people: [{ name: 'Sam', role: 'Owner', availability: 'An hour a week' }], notes: [{ id: 'K1', kind: 'feature', title: 'The shop stays', detail: 'The shop page must keep working as it does.', source: 'person' }], updatedAt: '2026-11-01' });
  write(kb(root, 'knowledge.md'), '# old');
  assert.equal(ideaSave({ root, by: 'person' }, stdin({ ideas: [{ id: 'I1', status: 'rejected', decision: { reason: 'Too dark for our customers' } }] })).ok, true);
  const saved = note({ root, type: 'forbidden', title: 'No dark backgrounds', value: 'Never a dark background: our customers are over sixty and read us in daylight.', idea: 'I1', scope: 'design' });
  assert.deepEqual([saved.ok, saved.id, saved.kind], [true, 'K2', 'forbidden'], errorOf(saved));
  assert.equal(note({ root, type: 'forbidden', title: 'no dark backgrounds', value: 'Said again in other words, the same rule as before.' }).already, 'This note was saved before.');
  assert.equal(note({ root, kind: 'lab', type: 'preference', title: 'The hand-written price tags', value: 'More of the hand-written price tags: people photograph them.' }).id, 'K3');
  const file = readJson(kb(root, 'knowledge.json'));
  assert.deepEqual(file.notes[1], { id: 'K2', kind: 'forbidden', title: 'No dark backgrounds', detail: 'Never a dark background: our customers are over sixty and read us in daylight.', scope: 'design', source: 'person', by: 'council', ideaIds: ['I1'], addedAt: file.notes[1].addedAt, updatedAt: file.notes[1].updatedAt });
  assert.equal(file.notes[2].by, 'lab');
  assert.deepEqual([file.people.length, file.notes[0].id], [1, 'K1'], 'what others wrote is left as it is');
  assert.deepEqual(validateKnowledge(file), [], 'the roadmap skill can still read and save the file');
  assert.match(fs.readFileSync(kb(root, 'knowledge.md'), 'utf8'), /## Not allowed\n\n- \*\*No dark backgrounds\*\* _\(design\)_[\s\S]*## Liked\n\n- \*\*The hand-written price tags\*\*/);
  // Every member of every skill reads it in the digest, with the instruction that a variant is the same idea.
  const text = digest(root);
  for (const part of ['## What the person turned down, and what they asked for more of', 'The same thing under another name, or a variant that meets the same objection, is not proposed again', '- Turned down: I1 "A dark home page lit like a kiln at night" — Too dark for our customers', '- The rule behind it: **No dark backgrounds** [design] — Never a dark background', '(K2, said of I1)', 'The person asked for more of these', '- Liked: **The hand-written price tags**', '- Not allowed: **No dark backgrounds** [design]']) assert.ok(text.includes(part), part);
  assert.deepEqual(note({ root, show: true }).notes.map((n) => [n.id, n.kind]), [['K1', 'feature'], ['K2', 'forbidden'], ['K3', 'preference']]);
  assert.match(errorOf(note({ root, retire: 'K9' })), /There is no note K9/);
  assert.equal(note({ root, retire: 'K2' }).retired.title, 'No dark backgrounds');
  assert.ok(!digest(root).includes('The rule behind it'));
  for (const skill of ['council', 'venture', 'lab']) {
    const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', skill, 'SKILL.md'), 'utf8');
    assert.match(text, /## What the person says that outlives the session/, skill);
    assert.match(text, /note --root "<ROOT>" --type forbidden/, skill);
    assert.match(text, /Is that a rule for every future proposal, or only for this one\?/, skill);
    assert.match(fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', skill, 'agents', 'docket.md'), 'utf8'), /under another name/, skill);
  }
});
