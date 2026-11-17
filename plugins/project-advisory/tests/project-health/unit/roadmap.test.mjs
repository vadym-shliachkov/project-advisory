import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, SKILL_DIR } from '../helpers.mjs';
import { sampleDoc, sampleProfile } from './sample-doc.mjs';
import { writeJson, readJson } from '../../../skills/project-health/scripts/lib/io.mjs';
import { renderChecklist } from '../../../skills/project-health/scripts/lib/checklist.mjs';
import { mergeRoadmap, patchErrors, validateRoadmap, progress, openGroups, totalDays, trackedIssues, emptyRoadmap, nextStep, boardMarkdown } from '../../../skills/project-health/scripts/lib/roadmap.mjs';
import { mergeKnowledge, validateKnowledge, knowledgeMarkdown, knowledgeLines } from '../../../skills/project-health/scripts/lib/knowledge.mjs';
import { buildRoadmapHtml, estimateText } from '../../../skills/project-health/scripts/lib/roadmap-html.mjs';
import { roadmapStatus, roadmapSave, roadmapRender, roadmapBrief, roadmapBoard, knowledgeSave, context } from '../../../skills/project-health/scripts/commands.mjs';
import { FAKE_AWS_KEY } from '../fixtures/make-static-html-repo.mjs';

const KNOWLEDGE = {
  people: [{ name: 'Dana', role: 'Front-end developer', skills: ['HTML', 'CSS'], availability: '3 days a week' }, { name: 'Lee', role: 'Site owner', availability: 'A few hours a week' }],
  notes: [{ id: 'K1', kind: 'forbidden', title: 'No tracking before consent', detail: 'No analytics script may load before the visitor agrees.', source: 'person' }],
};
const task = (id, extra = {}) => ({ id, kind: 'work', title: `Task ${id}`, detail: 'Change the shared header template and check every page.', assignee: 'Dana', estimate: { min: 2, max: 4, unit: 'hours' }, ...extra });
const solution = (id, findingIds, extra = {}) => ({
  id, title: `Solution ${id}`, status: 'agreed', owner: 'Dana', phase: 'PH1', findingIds,
  problem: 'The cause of these problems in technical terms.',
  options: [{ name: 'Fix in place', summary: 'Change the existing files directly.', effort: 'small' }, { name: 'Rebuild', summary: 'Move the pages to a site generator.', effort: 'large' }],
  chosen: 'Fix in place', rationale: 'The smallest change that removes the cause for good.',
  approach: 'Edit the shared template and the pages that copy it, then check every page in a preview.',
  tasks: [task(`${id}.1`)], acceptanceCriteria: [`A re-run of project-health no longer reports ${findingIds.join(', ')}.`],
  ...extra,
});
// Every problem of the sample run: SEC-a91c, SEO-77de, SEO-1b2c (unverified), PERF-0b3e (unverified), AI-4d5e, ARCH-5c10.
const complete = () => ({
  run: '2026-10-11T0950',
  summary: 'Stop the leaks and get the site listed first, then share the layout so later changes are cheap.',
  phases: [{ id: 'PH1', title: 'Stop the harm', goal: 'Close what costs visitors or exposes data now.' }, { id: 'PH2', title: 'Share the layout', goal: 'Make every later change cheaper.' }],
  solutions: [
    solution('S1', ['SEC-a91c', 'SEO-77de']),
    solution('S2', ['SEO-1b2c', 'PERF-0b3e'], { tasks: [task('S2.1', { kind: 'check', title: 'Confirm on the live site', estimate: { min: 1, max: 1, unit: 'hours' } }), task('S2.2', { after: ['S2.1'], estimate: { min: 1, max: 2, unit: 'days' } })] }),
    solution('S3', ['ARCH-5c10', 'AI-9e02'], { phase: 'PH2', dependsOn: ['S1'], owner: 'Lee' }),
  ],
  declined: [{ id: 'X1', findingIds: ['AI-4d5e'], resolution: 'wont-fix', reason: 'The instructions file is long on purpose; the team reads it in full.' }],
});
const check = (r, opts = {}) => validateRoadmap(r, sampleDoc(), { knowledge: KNOWLEDGE, ...opts });

test('a complete roadmap is valid, and only then', () => {
  assert.deepEqual(check(complete(), { final: true }), { errors: [], warnings: [] });
  const { errors } = check(emptyRoadmap('2026-10-11T0950'), { final: true });
  assert.ok(errors.some((e) => e.startsWith('6 problems have no fix plan and are neither discarded nor moved to the backlog: SEC-a91c')));
  assert.ok(errors.some((e) => e.includes('put the solutions into phases')));
  assert.ok(errors.some((e) => e.includes('write the summary')));
  assert.deepEqual(check(emptyRoadmap('2026-10-11T0950')).errors, [], 'an empty roadmap can be saved while planning');
});

test('the roadmap tracks every problem, ticked or not, and not AI tooling', () => {
  assert.deepEqual(trackedIssues(sampleDoc()).map((f) => f.id), ['SEC-a91c', 'SEO-77de', 'SEO-1b2c', 'PERF-0b3e', 'AI-4d5e', 'ARCH-5c10']);
  const p = progress(complete(), sampleDoc());
  assert.deepEqual([p.tracked, p.agreed, p.draft, p.backlog, p.discarded, p.open], [6, 5, 0, 0, 1, 0]);
  const later = complete();
  later.declined[0].resolution = 'backlog';
  later.declined[0].revisit = 'After the move to the new host';
  assert.deepEqual([progress(later, sampleDoc()).backlog, progress(later, sampleDoc()).discarded], [1, 0]);
});

test('each problem has one solution or one reason, and solutions name real findings and options', () => {
  const r = complete();
  r.solutions[1].findingIds.push('SEC-a91c', 'NOPE-1234');
  r.solutions[0].chosen = 'Something else';
  const { errors } = check(r);
  assert.ok(errors.some((e) => e.includes('SEC-a91c is already planned in S1')));
  assert.ok(errors.some((e) => e.includes('unknown finding NOPE-1234')));
  assert.ok(errors.some((e) => e.includes('"Something else" is not one of the options')));
});

test('tasks belong to their solution, wait only for earlier tasks, and have real people and sane estimates', () => {
  const r = complete();
  r.solutions[0].tasks.push(task('S9.1'), task('S1.2', { after: ['S1.3'], assignee: 'Sam', estimate: { min: 3, max: 1, unit: 'days' } }));
  r.solutions[0].owner = 'Nobody';
  const { errors } = check(r);
  assert.ok(errors.some((e) => e.includes('task ids of S1 start with "S1."')));
  assert.ok(errors.some((e) => e.includes('S1.3 is not an earlier task of S1')));
  assert.ok(errors.some((e) => e.includes('assignee: "Sam" is not one of the people in the project knowledge')));
  assert.ok(errors.some((e) => e.includes('owner: "Nobody" is not one of the people')));
  assert.ok(errors.some((e) => e.includes('min must be above 0 and max at least min')));
  assert.ok(check(complete(), { knowledge: { people: [{ name: 'dana', role: 'Developer', availability: 'Full time' }, { name: 'LEE', role: 'Owner', availability: 'Fridays' }], notes: [] } }).errors.length === 0, 'names match without case');
  assert.ok(check(complete(), { knowledge: { people: [], notes: [] } }).errors.some((e) => e.startsWith('Declare the available people first')), 'no fix plan before the people are declared');
});

test('an agreed fix plan has an owner and every task a person and an estimate; drafts may wait', () => {
  const r = complete();
  delete r.solutions[1].owner;
  delete r.solutions[1].tasks[1].estimate;
  delete r.solutions[2].tasks[0].assignee;
  const { errors } = check(r);
  assert.ok(errors.some((e) => e.includes('an agreed fix plan names who owns S2')));
  assert.ok(errors.some((e) => e.includes('agree an estimate for S2.2, or save S2 as a draft')));
  assert.ok(errors.some((e) => e.includes('agree who does S3.1, or save S3 as a draft')));
  for (const s of r.solutions.slice(1)) s.status = 'draft';
  delete r.solutions[2].phase;
  assert.deepEqual(check(r).errors, [], 'a draft may lack all of this while planning');
  const final = check(r, { final: true }).errors;
  assert.ok(final.some((e) => e.includes('S2, S3 are still a draft')));
  assert.ok(final.some((e) => e.includes('S3 has no phase')));
});

test('options can carry their routes, shown side by side with each route\'s total per person', () => {
  const r = complete();
  const [own, service] = r.solutions[0].options;
  own.steps = [{ step: 'Banner', assignee: 'Dana', estimate: { min: 1, max: 2, unit: 'hours' } }, { step: 'Visitor country', assignee: 'Dana', estimate: { min: 0.5, max: 1, unit: 'hours' } }, { step: 'Check', assignee: 'Dana', estimate: { min: 1, max: 1, unit: 'hours' } }];
  service.steps = [{ step: 'Banner', assignee: 'Dana', estimate: { min: 0.5, max: 0.5, unit: 'hours' }, note: 'Configure the service template.' }, { step: 'Check', assignee: 'Dana', estimate: { min: 1, max: 1, unit: 'hours' } }];
  assert.deepEqual(check(r).errors, []);
  service.steps.push({ step: 'Check', assignee: 'Sam' });
  const { errors } = check(r);
  assert.ok(errors.some((e) => e.includes('"Check" appears twice in "Rebuild"')));
  assert.ok(errors.some((e) => e.includes('steps[2].assignee: "Sam" is not one of the people')));
  service.steps.pop();
  const html = buildRoadmapHtml({
    doc: sampleDoc(), profile: sampleProfile(), roadmap: r, knowledge: KNOWLEDGE,
    template: fs.readFileSync(path.join(SKILL_DIR, 'templates', 'report.html'), 'utf8'),
    css: fs.readFileSync(path.join(SKILL_DIR, 'templates', 'report.css'), 'utf8'),
    logoSrc: null, generatedAt: new Date('2026-10-11T10:00:00Z'),
  });
  assert.ok(html.includes('<h4 class="rm-h">Routes compared</h4>'));
  assert.ok(html.includes('<th class="recommended">Fix in place <span class="pill">Chosen</span></th><th>Rebuild</th>'));
  assert.ok(html.includes('<tr><td><strong>Visitor country</strong></td><td class="route"><b>Dana · 0.5–1 hours</b></td><td class="route"><p class="why">Not needed</p></td></tr>'));
  assert.ok(html.includes('<td class="route"><b>Dana 2.5–4 hours</b></td><td class="route"><b>Dana 1.5 hours</b></td>'), 'each route totals per person');
  assert.equal((html.match(/Routes compared/g) ?? []).length, 1, 'only solutions with two routes get the table');
});

test('tasks can belong to one route; totals count the chosen route, and a preview shows drafts, open questions and only the solutions asked for', () => {
  const r = complete();
  const s1 = r.solutions[0];
  s1.tasks.push(task('S1.2', { route: 'Fix in place', estimate: { min: 1, max: 1, unit: 'hours' }, orAssignees: ['Lee'] }), task('S1.3', { route: 'Rebuild', estimate: { min: 3, max: 3, unit: 'hours' } }));
  assert.deepEqual(check(r).errors, []);
  assert.ok(check({ ...r, solutions: [{ ...s1, tasks: [...s1.tasks, task('S1.9', { orAssignees: ['Sam'] })] }, ...r.solutions.slice(1)] }).errors.some((e) => e.includes('orAssignees[0]: "Sam" is not one of the people')));
  r.solutions[0].tasks.push(task('S1.4', { route: 'Neither' }));
  assert.ok(check(r).errors.some((e) => e.includes('S1.4') || e.includes('"Neither" is not one of the options of S1')));
  s1.tasks.pop();
  const build = (roadmap, extra = {}) => buildRoadmapHtml({
    doc: sampleDoc(), profile: sampleProfile(), roadmap, knowledge: KNOWLEDGE,
    template: fs.readFileSync(path.join(SKILL_DIR, 'templates', 'report.html'), 'utf8'),
    css: fs.readFileSync(path.join(SKILL_DIR, 'templates', 'report.css'), 'utf8'),
    logoSrc: null, generatedAt: new Date('2026-10-11T10:00:00Z'), ...extra,
  });
  const html = build(r);
  assert.ok(html.includes('Estimate: Fix in place 3–5 hours; Rebuild 5–7 hours'), 'each route: common tasks plus its own');
  assert.ok(html.includes('<b>1. Both routes</b>') && html.includes('<b>2. Then one route: Fix in place or Rebuild</b>'), 'common tasks first, then the routes side by side');
  assert.ok(html.indexOf('<span class="n">S1.2</span>') < html.indexOf('<span class="n">S1.3</span>') && html.includes('<table class="plan-table fork">'));
  assert.ok(html.includes('<p class="fork-who">Dana or Lee · 1 hour</p>'), 'either person may do it');
  s1.tasks[0].checklist = [{ point: 'Controller and address', needs: 'The legal name', why: 'The law asks who is responsible.' }];
  assert.ok(build(r).includes('<tr><td><b>1.</b> Controller and address</td><td>The legal name</td><td>The law asks who is responsible.</td></tr>'));
  delete s1.tasks[0].checklist;
  const draft = { run: r.run, solutions: [{ ...s1, status: 'draft', phase: undefined, chosen: undefined }], declined: [], questions: [{ id: 'Q1', text: 'Which route does the owner take?', findingIds: ['SEC-a91c'], askedOf: 'Lee', status: 'open' }, { id: 'Q2', text: 'Unrelated question here.', findingIds: ['ARCH-5c10'], status: 'open' }] };
  const preview = build(draft, { preview: true, only: true });
  assert.ok(preview.includes('Implementation roadmap — draft preview'));
  assert.ok(preview.includes('<h2>Not yet in a phase</h2>') && preview.includes('<span class="tag tag-check">Draft</span>'));
  assert.ok(preview.includes('<h4>Route not chosen yet</h4>'));
  assert.ok(preview.includes('<b>Q1</b> Which route does the owner take?') && !preview.includes('Unrelated question'), 'only the questions about the solutions shown');
  assert.ok(!preview.includes('Every problem and its plan'), 'a chunk shows its problems on the card, not in a trace');
  assert.ok(preview.includes('Rebuild 5–7 hours') && preview.includes('<b>5–7 hours</b> in total'), 'without a choice, totals take the costliest route');
  const { chosen, ...unchosen } = s1;
  const open = { ...r, solutions: [unchosen, ...r.solutions.slice(1)] };
  assert.ok(check(open).errors.some((e) => e.includes('an agreed fix plan needs chosen')), 'an agreed plan names its route');
  open.solutions[0].choiceBy = 'Lee';
  assert.deepEqual(check(open, { final: true }).errors, [], 'or who chooses it later');
  assert.ok(build(open).includes('<h4>Lee chooses the route</h4>'));
  open.solutions[2].choiceBy = 'Lee';
  assert.ok(check(open).errors.some((e) => e.includes('choiceBy: only a plan with two or more routes')));
});

test('tasks of a person agreed to work without estimates need none, and show as not estimated', () => {
  const r = complete();
  const { estimate, ...approval } = task('S3.2', { title: 'Site owner approves the wording', assignee: 'Lee' });
  r.solutions[2].tasks.push(approval);
  assert.ok(check(r).errors.some((e) => e.includes('agree an estimate for S3.2')), 'everyone is estimated by default');
  const knowledge = { ...KNOWLEDGE, people: KNOWLEDGE.people.map((p) => (p.name === 'Lee' ? { ...p, notEstimated: true } : p)) };
  assert.deepEqual(validateRoadmap(r, sampleDoc(), { knowledge, final: true }).errors, []);
  assert.deepEqual(validateKnowledge(knowledge), []);
  assert.ok(knowledgeMarkdown(knowledge, 'Sample').includes('**Lee** — Site owner · A few hours a week · tasks not estimated'));
  const html = buildRoadmapHtml({
    doc: sampleDoc(), profile: sampleProfile(), roadmap: r, knowledge,
    template: fs.readFileSync(path.join(SKILL_DIR, 'templates', 'report.html'), 'utf8'),
    css: fs.readFileSync(path.join(SKILL_DIR, 'templates', 'report.css'), 'utf8'),
    logoSrc: null, generatedAt: new Date('2026-10-11T10:00:00Z'),
  });
  assert.ok(html.includes('<td class="effort-cell"><b>Not estimated</b>'));
  assert.ok(html.includes('<span class="count"><b>1.5–3 days</b> in total</span>'), 'unestimated tasks add nothing to the totals');
});

test('the next step leads the discussion until everything is planned', () => {
  const doc = sampleDoc();
  const step = (r, k = KNOWLEDGE) => nextStep(r, doc, k, validateRoadmap(r, doc, { final: true, knowledge: k }).errors);
  assert.match(step(emptyRoadmap('2026-10-11T0950'), { people: [], notes: [] }), /^Declare the available people first/);
  assert.match(step(emptyRoadmap('2026-10-11T0950')), /^6 of 6 problems still need an outcome \(AI setup 1, Architecture 1, SEO and discoverability 2, Performance 1, Security and dependencies 1\)\. Continue with what the person raises/);
  const drafts = complete();
  drafts.solutions[0].status = 'draft';
  assert.match(step(drafts), /^Finish the drafts S1/);
  const unphased = complete();
  delete unphased.phases;
  assert.match(step(unphased), /^Agree the phases/);
  const nosummary = complete();
  delete nosummary.summary;
  assert.match(step(nosummary), /^Write the summary/);
  assert.match(step(complete()), /^Everything is planned: render/);
});

test('unconfirmed problems start with a check, and dependencies go forward only', () => {
  const r = complete();
  r.solutions[1].tasks = [task('S2.1')];
  assert.ok(check(r).warnings.some((w) => w.includes('SEO-1b2c, PERF-0b3e are not confirmed')));
  assert.ok(check(r, { final: true }).errors.some((e) => e.includes('start with a check task')));
  const loop = complete();
  loop.solutions[0].dependsOn = ['S3'];
  assert.ok(check(loop).errors.some((e) => e.includes('dependencies go in a circle: S1 → S3 → S1')));
  const late = complete();
  late.solutions[2].phase = 'PH1';
  late.solutions[0].phase = 'PH2';
  late.solutions[0].dependsOn = [];
  late.solutions[2].dependsOn = ['S1'];
  assert.ok(check(late, { final: true }).errors.some((e) => e.includes('S3 depends on S1, which comes in a later phase')));
});

test('secrets are refused in the roadmap and the knowledge base', () => {
  const r = complete();
  r.solutions[0].notes = [`The key is ${FAKE_AWS_KEY}`];
  assert.ok(check(r).errors.some((e) => e.includes('looks like a secret')));
  const k = mergeKnowledge(KNOWLEDGE, { notes: [{ id: 'K2', kind: 'constraint', title: 'Deploy key', detail: `Use ${FAKE_AWS_KEY} to deploy.`, source: 'person' }] });
  assert.ok(validateKnowledge(k).some((e) => e.includes('must not hold secrets')));
});

test('saves merge by id, stamp agreement dates and drop removed entries', () => {
  let r = mergeRoadmap(emptyRoadmap('2026-10-11T0950'), { solutions: [solution('S1', ['SEC-a91c'], { status: 'draft' })] }).roadmap;
  assert.equal(r.solutions[0].agreedAt, undefined);
  r = mergeRoadmap(r, { solutions: [solution('S1', ['SEC-a91c'])], declined: [{ id: 'X1', findingIds: ['AI-4d5e'], resolution: 'wrong', reason: 'The file is not long at all.' }] }).roadmap;
  assert.match(r.solutions[0].agreedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(r.declined[0].decidedAt, /^\d{4}-\d{2}-\d{2}$/);
  r = mergeRoadmap(r, { remove: ['X1'], summary: 'A summary that is long enough to describe the whole roadmap.' }).roadmap;
  assert.equal(r.declined.length, 0);
  assert.equal(r.solutions.length, 1);
  assert.ok(r.summary.startsWith('A summary'));
});

test('an agreed estimate below a quarter hour is never printed as 0', () => {
  assert.equal(estimateText({ min: 0.1, max: 0.25, unit: 'hours' }), '0.1–0.25 hours');
  assert.equal(estimateText({ min: 1.1, max: 2, unit: 'hours' }), '1–2 hours', 'larger amounts still round to the quarter');
});

test('a partial save merges into the entry: tasks survive, null clears a field, and a bad shape is refused', () => {
  let r = mergeRoadmap(emptyRoadmap('2026-10-11T0950'), { solutions: [solution('S2', ['SEO-1b2c'], { status: 'draft' })] }).roadmap;
  r = mergeRoadmap(r, { solutions: [{ id: 'S2', findingIds: ['SEO-1b2c', 'PERF-0b3e'] }] }).roadmap;
  assert.equal(r.solutions[0].tasks.length, 1, 'adding a problem keeps the tasks already saved');
  assert.deepEqual(r.solutions[0].findingIds, ['SEO-1b2c', 'PERF-0b3e']);
  r = mergeRoadmap(r, { solutions: [{ id: 'S2', phase: 'PH2' }] }).roadmap;
  assert.equal(r.solutions[0].phase, 'PH2', 'a save with only id and phase does not crash');
  assert.equal(r.solutions[0].title, 'Solution S2');
  r = mergeRoadmap(r, { solutions: [{ id: 'S2', chosen: null, choiceBy: 'Lee' }] }).roadmap;
  assert.equal('chosen' in r.solutions[0], false, 'null clears a field');
  assert.ok(patchErrors({ solution: [{ id: 'S1' }] })[0].startsWith('$.solution: unknown key'), 'a misspelt key is not ok');
  assert.ok(patchErrors({ solutions: { id: 'S1' } }).includes('$.solutions: must be a list'));
  assert.ok(patchErrors({ solutions: [{ title: 'No id' }] }).includes('$.solutions[0].id: every entry needs its id'));
  assert.deepEqual(patchErrors({ run: 'x', solutions: [{ id: 'S1' }], remove: ['X1'] }), []);
});

test('the discussion can jump around: a problem saved elsewhere moves there, and an emptied entry goes', () => {
  let r = complete();
  // The person decides mid-discussion that the copied header belongs with the security fix, and that AI-4d5e is wrong.
  const out = mergeRoadmap(r, { solutions: [{ ...r.solutions[0], findingIds: ['SEC-a91c', 'SEO-77de', 'ARCH-5c10'] }], declined: [{ id: 'X2', findingIds: ['AI-4d5e'], resolution: 'wrong', reason: 'The instructions file is not long at all.' }] });
  assert.deepEqual(out.moved, [{ finding: 'ARCH-5c10', from: 'S3', to: 'S1' }, { finding: 'AI-4d5e', from: 'X1', to: 'X2' }]);
  assert.deepEqual(out.dropped, ['X1'], 'an entry left with no problems is removed');
  assert.deepEqual(out.roadmap.solutions.find((s) => s.id === 'S3').findingIds, ['AI-9e02']);
  assert.deepEqual(check(out.roadmap).errors, []);
  assert.deepEqual([out.released, out.emptied], [[], []], 'a moved problem is planned elsewhere');
});

test('a shorter list says which problems it let go, and an entry emptied by the same save is named', () => {
  const r = complete();
  const kept = r.solutions[0].findingIds.slice(1);
  const out = mergeRoadmap(r, { solutions: [{ id: r.solutions[0].id, findingIds: kept }] });
  assert.deepEqual(out.released, [{ finding: r.solutions[0].findingIds[0], from: r.solutions[0].id }], 'left out of the list and planned nowhere');
  assert.deepEqual(out.moved, []);
  const s3 = r.solutions.find((s) => s.id === 'S3');
  const emptied = mergeRoadmap(r, { solutions: [{ id: 'S3', phase: r.solutions[0].phase }, { ...r.solutions[0], findingIds: [...r.solutions[0].findingIds, ...s3.findingIds] }] });
  assert.deepEqual(emptied.emptied, ['S3']);
});

test('a draft captures a decision the moment it is made; an agreed fix plan must be complete', () => {
  const r = complete();
  r.solutions.push({ id: 'S4', title: 'Move to a managed host', status: 'draft', findingIds: ['PERF-0b3e'] });
  r.solutions[1].findingIds = ['SEO-1b2c'];
  assert.deepEqual(check(r).errors, [], 'a bare draft is enough to capture the decision');
  r.solutions[3].status = 'agreed';
  assert.ok(check(r).errors.some((e) => e.includes('an agreed fix plan needs problem, options, chosen, rationale, approach, tasks, acceptanceCriteria')));
});

test('open questions are tracked and must be settled before rendering', () => {
  const r = complete();
  r.questions = [{ id: 'Q1', text: 'Does the hosting contact keep server backups?', findingIds: ['SEO-1b2c'], askedOf: 'Lee', status: 'open' }, { id: 'Q2', text: 'Which analytics account is in use?', status: 'answered' }];
  const { errors } = check(r, { final: true });
  assert.ok(errors.some((e) => e.startsWith('Q1 is still an open question')));
  assert.ok(errors.some((e) => e.includes('record the answer to Q2')));
  assert.equal(progress(r, sampleDoc()).openQuestions, 1);
  r.questions[1].answer = 'The marketing account.';
  assert.match(nextStep(r, sampleDoc(), KNOWLEDGE, check(r, { final: true }).errors), /^Settle or drop the open questions Q1/);
  const merged = mergeRoadmap(r, { questions: [{ ...r.questions[0], status: 'answered', answer: 'Yes, nightly.' }] }).roadmap;
  assert.deepEqual(check(merged, { final: true }).errors, []);
  assert.match(merged.questions[0].raisedAt, /^\d{4}-/);
});

test('the board shows every problem, area by area, with its outcome or open', () => {
  const r = complete();
  r.solutions = r.solutions.slice(0, 1);
  r.questions = [{ id: 'Q1', text: 'Who has the hosting login?', status: 'open', askedOf: 'Lee' }];
  const md = boardMarkdown(r, sampleDoc());
  assert.ok(md.includes('6 problems: 2 with an agreed fix plan, 0 in drafts, 0 in the backlog, 1 discarded, **3 open**.'));
  assert.ok(md.includes('## SEO and discoverability — 1 of 2 decided'));
  assert.ok(md.includes('| SEC-a91c Secrets committed in .env.production | critical | fix plan: S1 Solution S1 |'));
  assert.ok(md.includes('| SEO-1b2c Pages have no meta description | high | **open** |'));
  assert.ok(md.includes('| AI-4d5e AGENTS.md is very long | low | discarded: X1 The instructions file is long on purpose'));
  assert.ok(md.includes('- Q1: Who has the hosting login? (for Lee)'));
});

test('estimates add up in days, and open problems are discussed decision by decision, then by area', () => {
  assert.deepEqual(totalDays([task('S1.1'), task('S1.2', { estimate: { min: 1, max: 2, unit: 'days' } }), task('S1.3', { estimate: undefined })]), { min: 1.25, max: 2.5, missing: 1 });
  const groups = openGroups(trackedIssues(sampleDoc()), { decisions: [{ title: 'Copied header', findingIds: ['ARCH-5c10'] }], themes: [{ title: 'Search', findingIds: ['SEO-77de', 'SEO-1b2c'] }] });
  assert.deepEqual(groups.map((g) => g.group), ['Decision 1 of the report: Copied header', 'Theme of the report: Search', 'Area: AI setup', 'Area: Performance', 'Area: Security and dependencies']);
  assert.deepEqual(groups[1].issues.map((f) => f.id), ['SEO-77de', 'SEO-1b2c']);
});

test('the knowledge base keeps people by name and notes by id, and reads as Markdown and as agent context', () => {
  const k = mergeKnowledge(KNOWLEDGE, { people: [{ name: 'dana', role: 'Lead developer', availability: 'Full time' }], notes: [{ id: 'K2', kind: 'feature', title: 'Contact form sends enquiries', detail: 'Every enquiry reaches the sales inbox.', source: 'project' }], remove: ['Lee'] });
  assert.deepEqual(k.people.map((p) => `${p.name}: ${p.role}`), ['dana: Lead developer']);
  assert.deepEqual(validateKnowledge(k), []);
  assert.ok(k.notes[1].addedAt);
  const md = knowledgeMarkdown(k, 'Acme');
  assert.ok(md.includes('## Not allowed\n\n- **No tracking before consent** — No analytics script may load before the visitor agrees.'));
  assert.ok(md.includes('## Key features'));
  assert.ok(knowledgeLines(k).some((l) => l === '- Not allowed: No tracking before consent — No analytics script may load before the visitor agrees.'));
  assert.ok(validateKnowledge(mergeKnowledge(KNOWLEDGE, { notes: [{ id: 'K1', kind: 'nope', title: 'x', detail: 'y', source: 'person' }] })).length > 0);
});

test('the roadmap document is for the team: owners, tasks with people and estimates, rules and a trace of every problem', () => {
  const html = buildRoadmapHtml({
    doc: sampleDoc(), profile: sampleProfile(), roadmap: complete(), knowledge: KNOWLEDGE,
    template: fs.readFileSync(path.join(SKILL_DIR, 'templates', 'report.html'), 'utf8'),
    css: fs.readFileSync(path.join(SKILL_DIR, 'templates', 'report.css'), 'utf8'),
    logoSrc: null, generatedAt: new Date('2026-10-11T10:00:00Z'),
  });
  assert.ok(html.includes('<span>Implementation roadmap</span>'));
  assert.ok(html.includes('<span class="count"><b>5</b> problems planned</span>'));
  assert.ok(html.includes('<span class="count"><b>1.5–3 days</b> in total</span>'), 'all tasks in days, to the half day');
  assert.ok(html.includes('<tr><td><strong>Dana</strong><span class="why">Front-end developer · 3 days a week</span></td><td>S1, S2</td>'));
  assert.ok(!html.includes('Ground rules'), 'the rules stay in the knowledge base, not in the plan of the work');
  assert.ok(html.includes('<span class="pill">Chosen</span>'));
  assert.ok(html.includes('<td class="effort-cell"><b>1–2 days</b>'));
  assert.ok(html.includes('<span class="step-kind step-check">Check</span><strong>Confirm on the live site</strong>'));
  assert.ok(html.includes('<p class="after">After S2.1</p>'));
  assert.ok(html.includes('<b>PERF-0b3e</b> Images are not lazy-loaded <span class="tag tag-check">Check first</span>'));
  assert.ok(html.includes('<h2>Discarded, with reasons</h2>') && html.includes('Will not fix'));
  assert.ok(!html.includes('<h2>Moved to the backlog</h2>'), 'no backlog section without backlog items');
  assert.ok(html.includes('<td><b>AI-4d5e</b> AGENTS.md is very long</td><td>Will not fix (X1)</td>'), 'the trace names where each problem went');
  assert.ok(html.indexOf('Phase 1</span>Stop the harm') < html.indexOf('Phase 2</span>Share the layout'));
});

function makeRun() {
  const root = tmpDir();
  const run = '2026-10-11T0950';
  const runDir = path.join(root, '.project-health', 'runs', run);
  fs.mkdirSync(runDir, { recursive: true });
  writeJson(path.join(runDir, 'findings.json'), sampleDoc());
  writeJson(path.join(runDir, 'profile.json'), sampleProfile());
  writeJson(path.join(root, '.project-health', 'profile.json'), sampleProfile());
  fs.writeFileSync(path.join(runDir, 'checklist.md'), renderChecklist(sampleDoc()));
  return { root, run, runDir };
}

test('the commands track progress, save what changed, and render only a finished roadmap', () => {
  const { root, run, runDir } = makeRun();
  const o = { root, run };
  const status = roadmapStatus(o);
  assert.equal(status.tracked, 6);
  assert.equal(status.open, 6);
  assert.equal(status.readyToRender, false);
  assert.match(status.nextStep, /^Declare the available people first/);
  const brief = roadmapBrief(o);
  assert.ok(brief.startsWith('# Facilitator brief — Acme Studio — run 2026-10-11T0950'));
  assert.ok(brief.includes('- SEO-1b2c (high) Pages have no meta description — to confirm: Look at the published pages'));
  assert.ok(brief.includes('report has no synthesis yet'));
  assert.ok(brief.includes('- Who is available to work on the fixes'));
  assert.ok(brief.includes('**Next step:** Declare the available people first'));
  assert.ok(fs.existsSync(path.join(runDir, 'roadmap.json')));
  assert.equal(readJson(status.issues).issues.find((f) => f.id === 'SEO-1b2c').toConfirm, 'Look at the published pages, which this run could not reach.');

  assert.equal(roadmapRender(o).ok, false);
  const early = roadmapSave(o, { stdin: () => JSON.stringify({ solutions: [solution('S1', ['SEC-a91c', 'SEO-77de'])] }) });
  assert.equal(early.ok, false, 'owners must be people in the knowledge base');
  assert.ok(early.errors.some((e) => e.includes('"Dana" is not one of the people')), early.errors.join(' | '));

  const k = knowledgeSave(o, { stdin: () => JSON.stringify(KNOWLEDGE) });
  assert.equal(k.ok, true);
  assert.ok(fs.readFileSync(k.markdown, 'utf8').includes('No tracking before consent'));
  assert.equal(path.basename(path.dirname(k.path)), 'kb');
  const elsewhere = path.join(tmpDir(), 'c', 'Work', 'site');
  assert.throws(() => knowledgeSave({ root: elsewhere }, { stdin: () => JSON.stringify(KNOWLEDGE) }), /No health check has been run in .*Check --root/);
  assert.equal(fs.existsSync(elsewhere), false, 'a wrong --root makes no project');

  const { declined, summary, phases, solutions } = complete();
  const bare = roadmapSave(o, { stdin: () => JSON.stringify({ solutions: [{ id: 'S7', title: 'Decided later in detail', status: 'draft', findingIds: ['ARCH-5c10'] }] }) });
  assert.equal(bare.ok, true, 'a draft needs no tasks yet');
  assert.equal(roadmapRender({ ...o, preview: true, only: 'S7', html: true }).ok, true, 'and previews without them');
  assert.equal(roadmapSave(o, { stdin: () => JSON.stringify({ remove: ['S7'] }) }).ok, true);
  assert.equal(roadmapSave(o, { stdin: () => JSON.stringify({ solutions: solutions.slice(0, 2), phases }) }).ok, true);
  const mid = roadmapStatus(o);
  assert.deepEqual([mid.agreed, mid.open], [4, 2]);
  assert.deepEqual(mid.openGroups.flatMap((g) => g.issues.map((f) => f.id)).sort(), ['AI-4d5e', 'ARCH-5c10']);
  const refused = roadmapRender(o);
  assert.equal(refused.ok, false);
  assert.ok(refused.errors.some((e) => e.includes('neither discarded nor moved to the backlog: AI-4d5e, ARCH-5c10')));
  assert.ok(!fs.existsSync(path.join(runDir, 'roadmap.html')), 'nothing is rendered before every problem is planned');

  assert.ok(roadmapBoard(o).includes('**2 open**'));
  const backlogged = [{ ...declined[0], resolution: 'backlog', revisit: 'After the layout work' }];
  assert.equal(roadmapSave(o, { stdin: () => JSON.stringify({ solutions: [solutions[2]], declined: backlogged, summary }) }).ok, true);
  assert.equal(roadmapStatus(o).readyToRender, true);
  const done = roadmapRender(o);
  assert.equal(done.ok, true, JSON.stringify(done.errors));
  const doneHtml = fs.readFileSync(done.html, 'utf8');
  assert.ok(doneHtml.includes('Every problem and its plan'));
  assert.ok(doneHtml.includes('<h2>Moved to the backlog</h2>') && doneHtml.includes('After the layout work'));
  assert.ok(doneHtml.includes('<span class="count"><b>1</b> in the backlog</span>'));

  assert.match(context({ root, run, area: 'seo' }), /## Nobody is contacted[\s\S]*\*\*Never submit a form\.\*\*/);
  assert.match(context({ root, run, area: 'seo' }), /### Project knowledge\n\nAgreed with the people who run the project[\s\S]*- Not allowed: No tracking before consent/);
});
