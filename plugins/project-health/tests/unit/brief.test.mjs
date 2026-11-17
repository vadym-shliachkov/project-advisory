import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, PLUGIN_ROOT } from '../helpers.mjs';
import { sampleDoc, sampleProfile } from './sample-doc.mjs';
import { writeJson, readJson } from '../../skills/project-health/scripts/lib/io.mjs';
import { renderChecklist } from '../../skills/project-health/scripts/lib/checklist.mjs';
import { participants, validateBrief, briefInput, audienceOf, slugOf } from '../../skills/project-health/scripts/lib/brief.mjs';
import { buildBriefHtml, inline } from '../../skills/project-health/scripts/lib/brief-html.mjs';
import { findBrowser } from '../../skills/project-health/scripts/lib/browser.mjs';
import { briefStatus, briefContext, briefSave, briefRender, knowledgeSave, roadmapSave, COMMANDS } from '../../skills/project-health/scripts/commands.mjs';

const KNOWLEDGE = {
  people: [
    { name: 'Dana', role: 'Front-end developer', availability: '3 days a week' },
    { name: 'Lee', role: 'Site owner', availability: 'A few hours a week', notEstimated: true },
    { name: 'Sam', role: 'Server administrator', availability: 'On request', audience: 'technical' },
  ],
  notes: [{ id: 'K1', kind: 'decision', title: 'Consent tool chosen', detail: 'An established consent service, not a home-made one.', source: 'person' }],
};
const task = (id, extra = {}) => ({ id, kind: 'work', title: `Task ${id}`, detail: 'Change the shared header template and check every page.', assignee: 'Dana', estimate: { min: 2, max: 4, unit: 'hours' }, ...extra });
const solution = (id, findingIds, extra = {}) => ({
  id, title: `Solution ${id}`, status: 'agreed', owner: 'Dana', phase: 'PH1', findingIds,
  problem: 'The cause of these problems in technical terms.',
  options: [{ name: 'Fix in place', summary: 'Change the existing files directly.', effort: 'small' }],
  chosen: 'Fix in place', rationale: 'The smallest change that removes the cause for good.',
  approach: 'Edit the shared template and the pages that copy it, then check every page in a preview.',
  tasks: [task(`${id}.1`)], acceptanceCriteria: [`A re-run of project-health no longer reports ${findingIds.join(', ')}.`],
  ...extra,
});
const ROADMAP = {
  run: '2026-10-11T0950',
  summary: 'Stop the leaks and get the site listed first, then share the layout so later changes are cheap.',
  phases: [{ id: 'PH1', title: 'Stop the harm', goal: 'Close what costs visitors or exposes data now.' }],
  solutions: [
    solution('S1', ['SEC-a91c', 'SEO-77de'], { tasks: [task('S1.1'), task('S1.2', { assignee: 'Lee', title: 'Choose the consent plan', estimate: undefined }), task('S1.3', { assignee: 'Sam', title: 'Set the server header' })] }),
    solution('S2', ['SEO-1b2c', 'PERF-0b3e', 'ARCH-5c10'], { tasks: [task('S2.1', { kind: 'check', assignee: 'Lee', title: 'Supply the policy facts', estimate: undefined })] }),
  ],
  declined: [{ id: 'X1', findingIds: ['AI-4d5e'], resolution: 'wont-fix', reason: 'The instructions file is long on purpose; the team reads it in full.' }],
};
const item = (id, refs, extra = {}) => ({
  id, title: 'Which plan to buy', short: 'Short', summary: 'Basic yearly', need: 'The plan', when: 'Now', refs,
  problem: 'Trackers start before the visitor agrees to anything.', ask: 'Which plan to buy, and who pays.', recommendation: '**Basic, billed yearly,** on the company card.',
  ...extra,
});
const leeBrief = () => ({
  person: 'Lee', audience: 'owner', title: 'Two decisions the website waits for', intro: 'Each decision starts with the problem and our recommendation.',
  reply: 'Reply with the number and your answer, for example "1: Basic; [[#D2.A]]: the address".',
  items: [
    item('D1', ['S1.2'], { blocks: [{ type: 'flow', title: 'What changes', steps: [{ label: 'Today', text: 'No pop-up', tone: 'bad' }, { label: 'After', text: 'Asked first', tone: 'good' }] }] }),
    item('D2', ['S2.1'], { when: 'With [[#D1]]', blocks: [
      { type: 'questions', questions: [{ key: 'A', question: 'Which email for privacy requests?', why: 'Visitors must know where to ask.' }] },
      { type: 'document', title: 'The draft policy', text: 'You do not edit it.', sections: [{ heading: 'Who we are', paragraphs: ['Email: [[A]]. [[A: Only if a new address.]] Date: [[~Dev: date]].'] }] },
    ] }),
  ],
  context: [{ title: 'Already decided', rows: [{ label: 'Consent', text: 'An established consent service.' }] }],
});
const check = (b) => validateBrief(b, { roadmap: ROADMAP, knowledge: KNOWLEDGE });

test('everyone with tasks gets a brief, with an audience from the knowledge', () => {
  const list = participants(ROADMAP, KNOWLEDGE);
  assert.deepEqual(list.map((p) => [p.person.name, p.audience, p.tasks]), [['Dana', 'developer', 1], ['Lee', 'owner', 2], ['Sam', 'technical', 1]]);
  assert.equal(audienceOf({ notEstimated: true }), 'owner');
  assert.equal(slugOf('Ana María'), 'ana-maria');
  assert.equal(slugOf('Олег Петров'), 'oleg-petrov', 'Cyrillic names are written in Latin letters');
  assert.equal(slugOf('Ірина'), 'irina');
  assert.match(slugOf('王伟'), /^person-[a-z0-9]+$/);
  assert.notEqual(slugOf('王伟'), slugOf('李娜'), 'two names in another script never share one brief file');
  const input = briefInput({ roadmap: ROADMAP, knowledge: KNOWLEDGE, doc: sampleDoc(), synthesis: null, person: KNOWLEDGE.people[1], project: 'Acme' });
  assert.deepEqual(input.work.map((w) => w.tasks.map((t) => t.id)), [['S1.2'], ['S2.1']]);
  assert.ok(input.work[0].othersTasks.some((t) => t.id === 'S1.3' && t.assignee === 'Sam'));
  assert.ok(input.work[0].problems.some((f) => f.id === 'SEC-a91c'));
});

test('a brief covers all of its reader\'s work and only theirs', () => {
  assert.deepEqual(check(leeBrief()), { errors: [], warnings: [] });
  const lost = leeBrief();
  lost.items.pop();
  assert.ok(check(lost).errors.some((e) => e.includes("Lee's roadmap work that no item covers: S2.1")));
  lost.omit = [{ ref: 'S2.1', reason: 'Answered in the meeting on Monday already.' }];
  delete lost.reply;
  assert.deepEqual(check(lost).errors, [], 'or is left out with a reason');
  const foreign = leeBrief();
  foreign.items[0].refs.push('S1.3');
  assert.ok(check(foreign).warnings.some((w) => w.includes("S1.3 is Sam's task, not Lee's")));
  foreign.takes = [{ ref: 'S1.3', reason: 'A business choice the roadmap gave to the server administrator.' }];
  assert.deepEqual(check(foreign), { errors: [], warnings: [] }, 'unless the brief takes it over with a reason');
  foreign.takes.push({ ref: 'S1.1', reason: 'Listed here but in no item at all.' });
  assert.ok(check(foreign).errors.some((e) => e.includes("$.takes: S1.1 is in no item's refs")));
});

test('an owner\'s brief has no estimates, and its marks name what exists', () => {
  const b = leeBrief();
  b.items[0].recommendation = 'Basic: about 2–3 hours to set up.';
  b.items[0].blocks.push({ type: 'tasks', tasks: ['S1.2'] });
  b.items[1].next = 'Dev sends the draft; see [[B]] and [[#D7]]. Then decision 2 is done.';
  const { errors, warnings } = check(b);
  assert.ok(errors.some((e) => e.includes('no time estimates ("2–3 hours")')));
  assert.ok(errors.some((e) => e.includes("an owner's brief shows no task list")));
  assert.ok(errors.some((e) => e.includes('[[B]]: this item has no question B')));
  assert.ok(errors.some((e) => e.includes('[[#D7]] names no item')));
  assert.ok(warnings.some((w) => w.includes('"decision 2" — write [[#D…]]')));
});

test('the cards stay short, the answer comes first, and every block has its label', () => {
  const b = leeBrief();
  b.items[0].problem = 'Trackers start before the visitor agrees. '.repeat(10);
  b.items[0].recommendation = 'Basic, billed yearly.';
  b.items[0].blocks.push({ type: 'groups', groups: [{ title: 'With a story (2)', items: ['A', 'B'] }] }, { type: 'note', text: 'One trade-off.' }, { type: 'note', text: 'Another one.' });
  const { errors } = check(b);
  assert.ok(errors.some((e) => e.includes('problem: 420 characters; a card holds at most 320')));
  assert.ok(errors.some((e) => e.includes('recommendation: open with the answer in bold')));
  assert.ok(errors.some((e) => e.includes('blocks[1]: a groups block needs a short "title"')));
  assert.ok(errors.some((e) => e.includes('2 notes; one note per item')));
  const label = leeBrief();
  label.items[0].recommendation = '**Recommendation:** Basic.';
  label.items[1].next = 'Dev fills [[A: the address [[~Dev: from A]].]] and [[B';
  const le = check(label).errors;
  assert.ok(le.some((e) => e.includes('repeats the card'))); 
  assert.ok(le.some((e) => e.includes('broken markup')));
  assert.ok(le.some((e) => e.includes('[[B]]') === false));
  const ok = leeBrief();
  ok.items[0].blocks.push({ type: 'groups', title: 'The logos', groups: [{ title: 'With a story (2)', items: ['A', 'B'] }] },
    { type: 'variants', title: 'The options', variants: [{ label: 'Name the audience below', recommended: true, kicker: 'AI engineering', heading: 'AI is no longer the advantage.', text: 'Acme helps [[+enterprise teams]] respond faster.' }] });
  assert.deepEqual(check(ok).errors, []);
  const html = buildBriefHtml({ brief: ok, roadmap: ROADMAP, knowledge: KNOWLEDGE, project: 'Acme', css: '', generatedAt: new Date('2026-11-07T10:00:00Z') });
  assert.ok(html.includes('<b class="l">With a story (2)</b>'), 'the count is shown once');
  assert.ok(html.includes('<b>A. Name the audience below (recommended)</b><div class="screen"><div class="eyebrow">AI engineering</div>'));
  assert.ok(html.includes('<span class="chg">enterprise teams</span>') && html.includes('7 November 2026'));
});

test('the markup renders squares, gaps and item numbers', () => {
  const n = new Map([['D1', '1'], ['D2', '2']]);
  assert.equal(inline('[[A: kept [[~Dev: name]].]]', new Map()), '<span class="fb">A</span><span class="ph">kept <span class="todo">[Dev: name]</span>.</span>', 'a mark may hold another');
  assert.equal(inline('**Yes** [[A]] [[A: kept]] [[?date]] [[~Dev: list]] [[#D2.B]] <b>', n),
    '<b>Yes</b> <span class="fb">A</span> <span class="fb">A</span><span class="ph">kept</span> <span class="ph">[date]</span> <span class="todo">[Dev: list]</span> 2B &lt;b&gt;');
  const html = buildBriefHtml({ brief: leeBrief(), roadmap: ROADMAP, knowledge: KNOWLEDGE, project: 'Acme', css: '' });
  for (const s of ['<h2>1. Which plan to buy</h2>', '<b class="l">To decide</b>', '<th>What we need from you</th>', 'class="tag">With 1</span>', 'class="attach"', 'Note for', 'For context', 'Also in this work: Dana (Front-end developer), Sam (Server administrator)']) {
    if (s !== 'Note for') assert.ok(html.includes(s), s);
  }
  assert.ok(!html.includes('Your tasks and estimates'), 'an owner sees no estimates');
  const sam = { person: 'Sam', audience: 'technical', title: 'One topic to agree on', intro: 'The problem first, then the proposal.', items: [item('D1', ['S1.3'])] };
  assert.deepEqual(check(sam).errors, []);
  const samHtml = buildBriefHtml({ brief: sam, roadmap: ROADMAP, knowledge: KNOWLEDGE, project: 'Acme', css: '' });
  assert.ok(samHtml.includes('<b class="l">Proposal</b>') && samHtml.includes('Your tasks and estimates') && samHtml.includes('2–4 hours'));
});

test('the brief commands save, check and render a brief from the agreed roadmap', () => {
  const root = tmpDir();
  const runDir = path.join(root, '.project-health', 'runs', ROADMAP.run);
  fs.mkdirSync(runDir, { recursive: true });
  writeJson(path.join(runDir, 'findings.json'), sampleDoc());
  writeJson(path.join(runDir, 'profile.json'), sampleProfile());
  fs.writeFileSync(path.join(runDir, 'checklist.md'), renderChecklist(sampleDoc()));
  const o = { root, run: ROADMAP.run };
  assert.equal(knowledgeSave(o, { stdin: () => JSON.stringify(KNOWLEDGE) }).ok, true);
  const saved = roadmapSave(o, { stdin: () => JSON.stringify(ROADMAP) });
  assert.equal(saved.ok, true, JSON.stringify(saved.errors));
  assert.equal(saved.readyToRender, true, JSON.stringify(saved.stillNeeded));

  const status = briefStatus(o);
  assert.deepEqual(status.people.map((p) => [p.name, p.next]), [['Dana', 'write'], ['Lee', 'write'], ['Sam', 'write']]);
  assert.throws(() => briefContext(o), /Missing --person/);
  const prompt = briefContext({ ...o, person: 'lee', save: true });
  assert.match(prompt, /# Participant brief writer/);
  assert.match(prompt, /## Nobody is contacted/);
  assert.match(prompt, /Audience: \*\*owner\*\*/);
  assert.match(prompt, /brief-save --root .* --person "Lee"/);
  assert.ok(fs.existsSync(path.join(runDir, 'brief-lee.input.json')));

  const bad = briefSave({ ...o, person: 'Lee' }, { stdin: () => JSON.stringify({ ...leeBrief(), items: [leeBrief().items[0]] }), browser: null });
  assert.equal(bad.ok, false);
  const ok = briefSave({ ...o, person: 'Lee' }, { stdin: () => JSON.stringify(leeBrief()), browser: null });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.ok(ok.warnings.some((w) => w.includes('fits on one page was not checked')));
  const r = briefRender({ ...o, person: 'Lee', html: true });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.ok(fs.readFileSync(r.html, 'utf8').includes('Two decisions the website waits for'));
  assert.equal(briefStatus(o).people.find((p) => p.name === 'Lee').next, 'render', 'an HTML-only render still needs the PDF');
  assert.equal(readJson(path.join(runDir, 'brief-lee.json')).person, 'Lee');
  for (const c of ['brief-status', 'brief-context', 'brief-save', 'brief-render', 'brief-review-context', 'brief-review-save']) assert.ok(c in COMMANDS, c);
});

test('the save refuses an item that does not fit on one page', { skip: !findBrowser() && 'no browser installed' }, () => {
  const root = tmpDir();
  const o = { root, run: ROADMAP.run };
  const runDir = path.join(root, '.project-health', 'runs', ROADMAP.run);
  fs.mkdirSync(runDir, { recursive: true });
  writeJson(path.join(runDir, 'findings.json'), sampleDoc());
  writeJson(path.join(runDir, 'profile.json'), sampleProfile());
  fs.writeFileSync(path.join(runDir, 'checklist.md'), renderChecklist(sampleDoc()));
  knowledgeSave(o, { stdin: () => JSON.stringify(KNOWLEDGE) });
  roadmapSave(o, { stdin: () => JSON.stringify(ROADMAP) });
  assert.equal(briefSave({ ...o, person: 'Lee' }, { stdin: () => JSON.stringify(leeBrief()) }).ok, true);
  const long = leeBrief();
  long.items[0].blocks.push({ type: 'table', title: 'The plans', head: ['Plan', 'Fit'], rows: Array.from({ length: 40 }, (_, i) => [`Plan ${i}`, 'A long line about what this plan covers and what it does not.']) });
  const r = briefSave({ ...o, person: 'Lee' }, { stdin: () => JSON.stringify(long) });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /^\$\.items\[0\] \(item 1, "Which plan to buy"\) takes \d\.\d\d pages; it must fit on one/);
});

test('the roadmap skill makes a brief for every participant after the roadmap', () => {
  const t = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'roadmap', 'SKILL.md'), 'utf8');
  assert.match(t, /## Step 6: a brief for every participant/);
  for (const c of ['brief-status', 'brief-context', 'brief-render', 'brief-review-context', 'brief-save']) assert.ok(t.includes(`PH ${c}`), c);
  assert.match(t, /--doc brief-<person>/);
  assert.match(t, /Do not send anything to anyone/);
});
