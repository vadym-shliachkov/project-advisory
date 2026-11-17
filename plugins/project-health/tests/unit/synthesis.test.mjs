import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSynthesis, reportItems, placements, printedFindings } from '../../skills/project-health/scripts/lib/synthesis.mjs';
import { lintText, lintItems, lintSummary } from '../../skills/project-health/scripts/lib/readability.mjs';
import { sampleDoc, sampleSynthesis } from './sample-doc.mjs';
import { FAKE_AWS_KEY } from '../fixtures/make-static-html-repo.mjs';

const TICKED = ['SEC-a91c', 'SEO-77de', 'SEO-1b2c', 'ARCH-5c10', 'AI-9e02'];
const check = (syn, opts = {}) => validateSynthesis(syn, { doc: sampleDoc(), selectedIds: TICKED, ...opts });

test('the sample synthesis is valid at both stages', () => {
  assert.deepEqual(check(sampleSynthesis()), { errors: [], warnings: [] });
  assert.deepEqual(check(sampleSynthesis(), { stage: 'edit', draft: sampleSynthesis() }), { errors: [], warnings: [] });
});

test('findings must be ticked, and each issue belongs to one decision or theme', () => {
  const syn = sampleSynthesis();
  syn.themes[0].findingIds.push('PERF-0b3e', 'NOPE-1234', 'ARCH-5c10');
  const { errors } = check(syn);
  assert.ok(errors.some((e) => e.includes('PERF-0b3e is not ticked')));
  assert.ok(errors.some((e) => e.includes('unknown finding NOPE-1234')));
  assert.ok(errors.some((e) => e.includes('ARCH-5c10 is already used in $.decisions[0].findingIds')));
});

test('a decision recommends exactly one of two to four options', () => {
  const syn = sampleSynthesis();
  syn.decisions[0].options[0].recommended = true;
  assert.ok(check(syn).errors.some((e) => e.includes('exactly one option must be recommended (found 2)')));
  syn.decisions[0].options = [syn.decisions[0].options[1]];
  assert.ok(check(syn).errors.some((e) => e.includes('at least 2 item')));
});

test('option sizes are relative words, never estimates', () => {
  const syn = sampleSynthesis();
  syn.decisions[0].options[1].size = '3 weeks';
  assert.ok(check(syn).errors.some((e) => e.includes('size: must be one of quick, small, medium, large')));
});

test('wording rewords printed findings and only their printed fields', () => {
  const syn = sampleSynthesis();
  syn.wording['PERF-0b3e'] = { title: 'Images load late' };
  syn.wording['SEO-1b2c'] = { severity: 'low' };
  syn.wording['NOPE-1234'] = { title: 'Nothing' };
  const { errors } = check(syn);
  assert.ok(!errors.some((e) => e.includes('PERF-0b3e')), 'the register prints unticked problems, so they can be reworded');
  assert.ok(errors.some((e) => e.includes('$.wording.NOPE-1234: unknown finding NOPE-1234')));
  const tool = sampleSynthesis();
  tool.wording['AI-9e02'] = { benefit: 'New pages are complete.' };
  assert.ok(check(tool, { selectedIds: TICKED.filter((id) => id !== 'AI-9e02') }).errors.some((e) => e.includes('$.wording.AI-9e02: AI-9e02 is an AI tooling suggestion that is not ticked')));
  assert.ok(errors.some((e) => e.includes('$.wording.SEO-1b2c.severity: only title, why, toConfirm can be reworded')));
});

test('a workflow step can only name a ticked AI tooling finding', () => {
  const syn = sampleSynthesis();
  syn.workflow.proposed[1].toolId = 'SEC-a91c';
  assert.ok(check(syn).errors.some((e) => e.includes('toolId: SEC-a91c is not a ticked AI tooling finding')));
});

test('tools support an existing decision and workflow steps name only listed tools', () => {
  const syn = sampleSynthesis();
  syn.tools.push({ ...syn.tools[0] }, { ...syn.tools[0], name: 'Open a pull request', decision: 'D4' });
  syn.workflow.proposed[2].tool = 'Preview server';
  const { errors } = check(syn);
  assert.ok(errors.some((e) => e.includes('$.tools[1].name: "Start each change on its own branch" is listed twice')));
  assert.ok(errors.some((e) => e.includes('$.tools[2].decision: no decision D4')));
  assert.ok(errors.some((e) => e.includes('$.workflow.proposed[2].tool: "Preview server" is not one of the names')));
  const edited = sampleSynthesis();
  edited.tools = [];
  edited.workflow.proposed[0].tool = undefined;
  delete edited.workflow.proposed[0].tool;
  assert.ok(check(edited, { stage: 'edit', draft: sampleSynthesis() }).errors.some((e) => e.includes('must keep the same tools')));
});

test('secrets and duplicate glossary terms are rejected', () => {
  const syn = sampleSynthesis();
  syn.themes[0].summary = `The key ${FAKE_AWS_KEY} is public and search engines are kept away.`;
  syn.glossary.push({ term: 'Site generator', meaning: 'Defined a second time here.' });
  const { errors } = check(syn);
  assert.ok(errors.some((e) => e.startsWith('$.themes[0].summary: contains what looks like a secret')));
  assert.ok(errors.some((e) => e.includes('"Site generator" is defined twice')));
});

test('the editor must record a review and keep the structure', () => {
  const draft = sampleSynthesis();
  const edited = sampleSynthesis();
  delete edited.review;
  edited.themes[0].findingIds = ['SEO-77de'];
  edited.decisions[0].options.reverse();
  delete edited.workflow;
  const { errors } = check(edited, { stage: 'edit', draft });
  assert.ok(errors.some((e) => e.includes('records its verdict in "review"')));
  assert.ok(errors.some((e) => e.includes('$.themes[T1].findingIds: the editor must not regroup')));
  assert.ok(errors.some((e) => e.includes('keep the options and which one is recommended')));
  assert.ok(errors.some((e) => e.includes('must not add or remove the workflow')));
  const grouped = { ...sampleSynthesis(), duplicates: [{ keep: 'SEC-a91c', same: ['SEO-77de'] }] };
  const ungrouped = check({ ...sampleSynthesis() }, { stage: 'edit', draft: grouped }).errors;
  assert.ok(ungrouped.some((e) => e.includes('$.duplicates: the editor must keep the same groups')), 'an editor that drops the groups would count the problem twice again');
});

test('a structural issue left out of every decision is a warning', () => {
  const syn = sampleSynthesis();
  syn.decisions = [];
  syn.tools = [];
  delete syn.plan;
  delete syn.workflow.proposed[0].tool;
  const { errors, warnings } = check(syn);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, ['ARCH-5c10 is a structural problem but no decision covers it']);
});

test('the plan only waits for earlier fixes and steps, and sizes work after a check only when it names that check', () => {
  const syn = sampleSynthesis();
  const [f1, f2] = syn.plan.stages[0].fixes;
  const f3 = syn.plan.stages[1].fixes[0];
  f1.after = ['F3'];
  f1.steps[0].after = ['F1.2'];
  f2.steps[0].effort = 'after-check';
  f2.steps[1].after = [];
  delete f2.steps[1].sizeNote;
  f3.covers = ['D7'];
  f3.findingIds = ['PERF-0b3e'];
  f3.steps[1].id = 'F9.1';
  const { errors } = check(syn);
  for (const e of ['$.plan.F1.after: F3 is not an earlier fix', '$.plan.F1.1.after: F1.2 is not an earlier step of F1', '$.plan.F2.1.effort: only work can be sized after a check',
    '$.plan.F2.2.after: work sized after a check names that check step', '$.plan.F2.2.sizeNote: say what the check decides', '$.plan.F3.covers: no decision or theme D7',
    '$.plan.F3.findingIds: PERF-0b3e is not a finding ticked', '$.plan.F9.1: step ids of F3 start with "F3."']) {
    assert.ok(errors.some((x) => x.startsWith(e)), `${e}\n${errors.join('\n')}`);
  }
  const effort = sampleSynthesis();
  effort.plan.stages[0].fixes[0].steps[0].effort = '2 days';
  assert.ok(check(effort).errors.some((x) => x.includes('effort: must be one of quick, small, medium, large, after-check')));
});

test('routes are equal ways forward: each has its steps, and the fix says what the choice depends on', () => {
  const syn = sampleSynthesis();
  const f3 = syn.plan.stages[1].fixes[0];
  delete f3.choice;
  f3.steps[2].route = 'Plugin';
  f3.routes[1].name = 'Site generator';
  const { errors, warnings } = check(syn);
  assert.ok(errors.some((e) => e.startsWith('$.plan.F3.choice: say what the choice between the routes depends on')));
  assert.ok(errors.some((e) => e.startsWith('$.plan.F3.routes: two routes share a name')));
  assert.ok(errors.some((e) => e.startsWith('$.plan.F3.3.route: "Plugin" is not one of the routes of F3')));
  const single = sampleSynthesis();
  single.plan.stages[0].fixes[0].choice = 'There is nothing to choose here.';
  assert.ok(check(single).errors.some((e) => e.startsWith('$.plan.F1.choice: only a fix with routes has a choice')));
  const idle = sampleSynthesis();
  idle.plan.stages[1].fixes[0].steps.splice(2, 1);
  idle.plan.stages[1].fixes[0].steps[2].after = ['F3.2'];
  assert.deepEqual(check(idle).warnings, ['$.plan.F3: route "Shared include" has no steps of its own']);
});

test('the plan warns about decisions, themes and problems it leaves out, and unconfirmed problems with no check', () => {
  const syn = sampleSynthesis();
  const f2 = syn.plan.stages[0].fixes[1];
  f2.steps.splice(0, 1);
  f2.steps[0].after = [];
  f2.steps[0].effort = 'small';
  syn.plan.stages[1].fixes[0].covers = [];
  const { errors, warnings } = check(syn);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings.sort(), ['ARCH-5c10 is not in the plan', 'D1 "Every page carries its own copy of the header" is not in the plan', 'SEO-1b2c is unconfirmed but its fix has no check step']);
});

test('the editor may reword the plan but not change its fixes, routes, steps, order or sizes', () => {
  const reworded = sampleSynthesis();
  reworded.plan.stages[0].fixes[0].title = 'The passwords are changed and stored safely';
  reworded.plan.stages[1].fixes[0].routes[0].pros = ['Every new page comes out complete'];
  reworded.plan.stages[1].fixes[0].steps[0].checklist[0].why = 'Every page shows the main pages.';
  assert.deepEqual(check(reworded, { stage: 'edit', draft: sampleSynthesis() }).errors, []);
  const changes = [
    (p) => { p.stages[1].fixes[0].steps[0].effort = 'small'; },
    (p) => { p.stages[1].fixes.unshift(p.stages[0].fixes.pop()); },
    (p) => { p.stages[1].fixes[0].routes[1].effort = 'medium'; },
    (p) => { p.stages[1].fixes[0].steps[2].route = 'Site generator'; },
    (p) => { p.stages[1].fixes[0].steps[0].checklist.push({ point: 'Footer links' }); },
  ];
  for (const change of changes) {
    const edited = sampleSynthesis();
    change(edited.plan);
    assert.ok(check(edited, { stage: 'edit', draft: sampleSynthesis() }).errors.some((e) => e.startsWith('$.plan: the editor must keep')), change.toString());
  }
});

test('reportItems lists what the reader sees: plain wording, every problem explanation and every tool field', () => {
  const doc = sampleDoc();
  const syn = sampleSynthesis();
  syn.wording['AI-9e02'] = { benefit: 'New pages are complete from the start.' };
  const printed = printedFindings(doc, TICKED);
  assert.deepEqual(printed.map((f) => f.id), ['SEC-a91c', 'SEO-77de', 'SEO-1b2c', 'PERF-0b3e', 'AI-4d5e', 'ARCH-5c10', 'AI-9e02'], 'every problem, and ticked AI tooling');
  assert.deepEqual(printedFindings(doc, ['SEC-a91c']).filter((f) => f.kind === 'tooling'), [], 'unticked AI tooling is not printed');
  const items = new Map(reportItems(printed, syn).map((i) => [i.path, i.text]));
  assert.equal(items.get('finding.PERF-0b3e.toConfirm'), 'Measure page speed on the live site.', 'the register prints unticked problems too');
  assert.equal(items.get('finding.SEC-a91c.title'), 'Passwords are stored in a file anyone with access can read');
  assert.ok(items.has('finding.ARCH-5c10.why'), 'the register prints it even though decision 1 explains the cause');
  assert.ok(items.has('decisions.D1.options[1].pros[0]'));
  assert.ok(items.has('finding.AI-9e02.draftDescription'));
  assert.equal(items.get('finding.AI-9e02.benefit'), 'New pages are complete from the start.');
  assert.ok(items.has('tools[0].problem') && items.has('tools[0].benefit'));
  assert.equal(placements(sampleSynthesis()).get('SEO-1b2c').kind, 'theme');
  assert.deepEqual(placements(sampleSynthesis()).get('SEO-1b2c').fixes.map((fx) => fx.n), [2]);
  assert.equal(items.get('finding.SEO-1b2c.toConfirm'), 'Look at the published pages, which this run could not reach.');
  assert.ok(!items.has('finding.SEC-a91c.toConfirm'));
  for (const path of ['plan.F2.2.sizeNote', 'plan.F3.3.needs[0]', 'plan.stages[1].goal', 'plan.F3.problem', 'plan.F3.choice', 'plan.F3.routes[1].cons[0]', 'plan.F3.routes[0].compare[0].value', 'plan.F3.1.checklist[0].why', 'plan.F1.doneWhen[0]']) {
    assert.ok(items.has(path), path);
  }
});

test('the readability check flags code, unexplained jargon and long sentences', () => {
  const kinds = (t, g) => lintText(t, g).map((p) => `${p.kind}:${p.match}`);
  assert.deepEqual(kinds('See `site.css` in assets/css/site.css and commit a0ee2d7.'), [
    'code:`site.css`', 'code:assets/css/site.css', 'code:a0ee2d7', 'jargon:commit',
  ]);
  assert.deepEqual(kinds('Pages lack og:image and use inlineStyles and page_id.'), ['code:inlineStyles', 'code:page_id', 'code:og:image']);
  assert.deepEqual(kinds('Built with Next.js and Node.js.'), []);
  assert.deepEqual(kinds('Do it with D2, after P4, as SEO-7e23 says.'), ['code:D2', 'code:P4', 'code:SEO-7e23'], 'ids mean nothing to the reader');
  assert.deepEqual(kinds('Decision 2 comes after step 4.'), []);
  assert.deepEqual(kinds('There is no CI and no HSTS header.'), ['jargon:CI', 'jargon:HSTS']);
  assert.deepEqual(kinds('Work happens on one branch.', ['branch']), [], 'a glossary term is explained');
  assert.deepEqual(kinds('Open a pull request.'), ['jargon:pull request'], 'the longer term covers "PR"');
  const long = `${'word '.repeat(40)}end.`;
  assert.equal(lintText(long)[0].kind, 'long-sentence');
  const problems = lintItems([{ path: 'a', text: 'Fix site.css now.' }, { path: 'b', text: 'Plain words only.' }]);
  assert.deepEqual(problems, [{ path: 'a', kind: 'code', match: 'site.css' }]);
  assert.deepEqual(lintSummary(problems), { code: 1, jargon: 0, longSentences: 0, longTexts: 0 });
});

test('the readability check flags text too long for where the report prints it', () => {
  const words = (n) => `${'word '.repeat(n - 1)}end.`;
  const flagged = lintItems([
    { path: 'summary.verdict', text: words(95) },
    { path: 'decisions.D1.problem', text: words(70) },
    { path: 'finding.SEO-1b2c.why', text: words(50) },
    { path: 'decisions.D1.options[0].description', text: words(95) },
  ]).filter((p) => p.kind === 'long-text');
  assert.deepEqual(flagged.map((p) => p.path), ['summary.verdict', 'finding.SEO-1b2c.why'], 'only places with a limit, over that limit');
  assert.match(flagged[0].match, /keep it under 90/);
});
