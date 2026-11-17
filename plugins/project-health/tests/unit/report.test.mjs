import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, SKILL_DIR, FIXTURES } from '../helpers.mjs';
import { sampleDoc, sampleProfile, sampleSynthesis } from './sample-doc.mjs';
import { buildReportHtml, logoSource, plainNote } from '../../skills/project-health/scripts/lib/report-html.mjs';
import { buildPlanHtml } from '../../skills/project-health/scripts/lib/plan-html.mjs';
import { safeColor, textColorFor } from '../../skills/project-health/scripts/lib/color.mjs';
import { escapeHtml } from '../../skills/project-health/scripts/lib/html.mjs';
import { renderReport } from '../../skills/project-health/scripts/lib/render.mjs';
import { validateSynthesis } from '../../skills/project-health/scripts/lib/synthesis.mjs';
import { renderChecklist } from '../../skills/project-health/scripts/lib/checklist.mjs';
import { findBrowser } from '../../skills/project-health/scripts/lib/browser.mjs';
import { writeJson } from '../../skills/project-health/scripts/lib/io.mjs';

const template = fs.readFileSync(path.join(SKILL_DIR, 'templates', 'report.html'), 'utf8');
const css = fs.readFileSync(path.join(SKILL_DIR, 'templates', 'report.css'), 'utf8');
const TICKED = ['SEC-a91c', 'SEO-77de', 'SEO-1b2c', 'ARCH-5c10', 'AI-9e02'];
const buildPlan = (over = {}) => buildPlanHtml({ doc: sampleDoc(), profile: sampleProfile(), synthesis: sampleSynthesis(), template, css, logoSrc: null, generatedAt: new Date('2026-10-11T10:00:00Z'), ...over });
const build = (over = {}) => buildReportHtml({ doc: sampleDoc(), profile: sampleProfile(), selected: TICKED, synthesis: sampleSynthesis(), template, css, logoSrc: null, generatedAt: new Date('2026-10-11T10:00:00Z'), ...over });

test('colours are validated and text colour follows contrast', () => {
  assert.equal(safeColor('#0A7CFF'), '#0a7cff');
  assert.equal(safeColor('#abc'), '#aabbcc');
  assert.equal(safeColor('red;}</style><script>'), '#1f2937');
  assert.equal(textColorFor('#ffffff'), '#111111');
  assert.equal(textColorFor('#000000'), '#ffffff');
});

test('escapeHtml escapes the five special characters', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('the first page opens with a branded band, not a cover page', () => {
  const html = build();
  assert.match(html, /<header class="band">/);
  assert.match(html, /--band-bg: #0a7cff/);
  assert.match(html, /<h1 class="band-name">Acme Studio<\/h1>/, 'without a logo the project name is the title');
  assert.ok(html.includes('--band-font: "Inter"'));
  assert.match(html, /fonts\.googleapis\.com\/css2\?family=Inter/);
  const withLogo = build({ logoSrc: 'data:image/png;base64,AAAA' });
  assert.match(withLogo, /<img class="band-logo" src="data:image\/png;base64,AAAA" alt="Acme Studio">/);
  assert.ok(!withLogo.includes('class="band-name"'),'with a logo the name is not repeated as a title');
});

const section = (html, cls, next) => html.slice(html.indexOf(`<section class="${cls}">`), next ? html.indexOf(`<section class="${next}">`) : undefined);

test('the first page holds the score, the verdict and how to read the report, before anything else', () => {
  const html = build();
  const glance = section(html, 'glance', 'decisions');
  assert.ok(glance.includes('two problems put it at risk now'));
  assert.ok(glance.includes('<h2>How to read this report</h2>'));
  for (const name of ['Decisions', 'How changes reach the live site', 'Other problems worth fixing', 'All problems by area', 'AI toolkit', 'Glossary and notes']) {
    assert.ok(glance.includes(`<li><strong>${name}</strong>`), `contents name ${name}`);
  }
  assert.ok(!glance.includes('<li><strong>Plan and effort</strong>'), 'the plan is a document of its own');
  assert.ok(glance.includes('is in a separate document, “Plan and effort”.'));
  assert.ok(glance.includes('<div><span class="badge badge-critical">Critical</span><p>Causes harm now'), 'the severity scale is explained up front');
  assert.ok(glance.includes('<h3>Effort <span class="h-note">compares pieces of work. It is not a time or cost estimate.</span></h3>'), 'the effort scale is explained up front');
  assert.ok(glance.includes('<div><span class="effort effort-quick">Quick</span><p>One change in one place.'));
  assert.ok(!glance.includes('effort-after-check'), 'only the plan sizes work after a check');
  assert.ok(glance.includes('<p class="key-line"><span class="tag tag-check">Check first</span> Being certain needs a look outside the project'), 'the check-first mark is explained up front');
  assert.ok(glance.includes('<span class="count count-check"><b>2</b> to check first</span>'), 'counts every problem the register lists');
  assert.ok(glance.includes('<span class="count count-medium"><b>2</b> medium</span>'));
  assert.ok(!glance.includes('Every page carries its own copy of the header'), 'no list of decisions before the decisions themselves');
});

test('after a verdict too long for the first page, the reading guide gets a page of its own', () => {
  const syn = sampleSynthesis();
  syn.summary.verdict = 'The site works well enough today. '.repeat(25);
  const html = build({ synthesis: syn });
  assert.ok(!section(html, 'glance', 'guide-page').includes('How to read this report'));
  assert.ok(section(html, 'guide-page', 'decisions').includes('<h2>How to read this report</h2>'));
  assert.ok(!build().includes('class="guide-page"'), 'a verdict within the limit keeps the guide on the first page');
});

test('there is no overview page repeating the decisions, the other problems or the strengths', () => {
  const html = build();
  assert.ok(!html.includes('Decisions for you'));
  assert.ok(!html.includes('What is working well'));
  assert.ok(!html.includes('Pages are small and fast to load.'));
});

test('a decision explains the problem and its cost first, then the options, then the recommendation, without finding ids', () => {
  const decisions = section(build(), 'decisions', 'workflow');
  assert.ok(decisions.includes('<h3>Every page carries its own copy of the header</h3><p class="d-meta">Covers 1 problem: 1 medium · In the plan: fix 3</p>'));
  assert.ok(decisions.includes('<p class="size">Effort <span class="effort effort-medium">Medium</span></p>'), 'options use the same effort scale as the plan');
  assert.ok(decisions.includes('<h4>What we found</h4><p>The header and footer are written out in each of the 30 pages'));
  assert.ok(decisions.includes('<h4>What it costs you today</h4>'));
  assert.match(decisions, /<tr class="recommended"><td class="opt"><strong>Shared layouts<\/strong> <span class="pill">Recommended<\/span>/);
  assert.ok(decisions.includes('<div class="because"><h4>Why we recommend “Shared layouts”</h4><p>Shared layouts remove the cause'));
  const order = ['What we found', 'class="options"', 'class="because"'].map((s) => decisions.indexOf(s));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'problem, then options, then recommendation');
  assert.ok(!decisions.includes('ARCH-5c10'), 'finding ids mean nothing to the owner');
});

test('the workflow shows today and the proposal as full-width tables, with weak steps and the kind of each AI tool', () => {
  const workflow = section(build(), 'workflow', 'themes');
  assert.ok(!workflow.includes('class="flows"'), 'no side-by-side columns that break across pages');
  assert.ok(workflow.includes('<tr><td class="n weak">2</td><td>Upload by hand</td><td class="note">Nobody checks the upload</td></tr>'));
  assert.ok(workflow.includes('<tr><td class="n">1</td><td>Edit pages on a laptop</td><td class="note"></td></tr>'));
  assert.ok(workflow.includes('<span class="tool-chip"><b>Skill</b> Skill: scaffold a page</span>'));
  assert.ok(workflow.includes('<span class="tool-chip"><b>Command</b> Start each change on its own branch</span>'));
  assert.ok(workflow.indexOf('<h3>Today</h3>') < workflow.indexOf('<h3>Proposed</h3>'));
});

test('themes say how many problems they cover instead of listing ids', () => {
  const themes = section(build(), 'themes', 'register');
  assert.ok(themes.includes('<h3>Search engines are kept away</h3><p class="theme-meta">2 problems: 1 critical, 1 high · 1 to check first · In the plan: fix 2</p>'), 'a theme names the fix that solves it');
  assert.ok(!themes.includes('SEO-77de'));
});

test('the register explains every problem in its own words and names the decision or theme behind it', () => {
  const register = section(build(), 'register', 'toolkit');
  assert.ok(register.includes('Header and footer are copied into 30 files</strong><span class="why">Why header and footer are copied into 30 files matters for the business.</span><span class="see">Part of decision 1: Every page carries its own copy of the header</span>'), 'a problem a decision explains keeps its own explanation');
  assert.ok(register.includes('<span class="see">Part of “Search engines are kept away”</span> <span class="see">Plan: fix 2</span>'));
  assert.ok(register.includes('<span class="see">Plan: fix 1</span>'), 'a problem in no decision or theme still points to its fix');
  assert.ok(register.includes('Pages have no meta description</strong> <span class="tag tag-check">Check first</span>'));
  assert.ok(register.includes('<span class="confirm"><b>To be sure:</b> Look at the published pages, which this run could not reach.</span>'));
  assert.ok(register.includes('Passwords are stored in a file anyone with access can read'), 'wording replaces the technical title');
  assert.ok(register.includes('Former contractors could still use them.'));
  assert.ok(!register.includes('SEC-a91c'), 'no finding ids');
});

test('the report leaves the technical evidence out', () => {
  const html = build();
  assert.ok(!html.includes('evidence.txt'), 'evidence refs stay in the log');
  assert.ok(!html.includes('class="evidence"'));
});

test('the AI toolkit explains each kind of tool, and each tool says the problem, what it does, when and how it helps', () => {
  const syn = sampleSynthesis();
  syn.wording['AI-9e02'] = { benefit: 'New pages are complete from the start.' };
  const toolkit = section(build({ synthesis: syn }), 'toolkit', 'appendix');
  assert.match(toolkit, /<dt><span class="kind">Skill<\/span><span class="kind-plain">Reusable procedure<\/span><\/dt><dd>A written step-by-step routine/);
  assert.match(toolkit, /<dt><span class="kind">Command<\/span>/);
  assert.ok(!toolkit.includes('<span class="kind">Hook</span>'), 'only the kinds the report proposes are explained');
  assert.ok(toolkit.includes('<h3>For work that repeats or goes wrong today</h3>'));
  assert.ok(toolkit.includes('<p class="tool-kind"><span class="kind">Skill</span> Reusable procedure</p><h4>Skill: scaffold a page</h4>'));
  assert.ok(toolkit.includes('<dt>The problem today</dt><dd>Why skill: scaffold a page matters for the business.</dd><dt>What it does</dt><dd>Creates a page from the shared layout'));
  assert.ok(toolkit.includes('<dt>How it helps</dt><dd>New pages are complete from the start.</dd>'));
  assert.ok(toolkit.includes('<h3>To make the recommended way of working easy</h3>'));
  assert.ok(toolkit.includes('<dt>The problem today</dt><dd>Changes are made straight on the live copy'));
  assert.ok(toolkit.includes('<dt>How it helps</dt><dd>Each change can be checked on its own before anyone sees it.</dd><dt>Goes with</dt><dd>Decision 1: Every page carries its own copy of the header</dd>'));
});

test('the glossary and notes close the report', () => {
  const appendix = section(build(), 'appendix');
  assert.ok(appendix.startsWith('<section class="appendix"><h2>Glossary and notes</h2>'));
  assert.match(appendix, /<dt>site generator<\/dt><dd>A tool that builds every page from shared parts\.<\/dd>/);
  assert.ok(appendix.includes('AI toolkit suggestions do not affect scores.'));
  assert.ok(appendix.includes('<h3>Areas not analysed</h3><table><tr><td>Server and hosting</td><td>skipped · not selected</td></tr><tr><td>Content and conversion</td><td>failed · no output</td></tr></table>'));
});

test('pages after the first carry the report name in a footer that a project name cannot break', () => {
  assert.ok(build().includes('@bottom-left { content: "Website health report \\b7  Acme Studio"; }'));
  const evil = sampleDoc();
  evil.project.name = 'x"; } body { display: none } @page { content: "';
  const html = build({ doc: evil });
  assert.ok(!html.includes('x"; }'), 'a project name cannot close the CSS string');
  assert.ok(html.includes('content: "Website health report \\b7  x\\22 \\3b  \\7d  body'));
});

test('without a synthesis the report falls back to the register with the most serious problems first', () => {
  const html = build({ synthesis: null });
  assert.ok(html.includes('<h2>Most serious problems</h2>'));
  assert.ok(!html.includes('<section class="decisions">'));
  assert.ok(html.includes('<section class="register">'));
  assert.ok(html.includes('Secrets committed in .env.production'));
});

test('the plan is a document of its own, opening with the stages and how to read effort', () => {
  const html = buildPlan();
  assert.ok(!build().includes('<section class="plan">'), 'the report no longer holds the plan');
  assert.ok(html.includes('<p class="band-meta"><span>Plan and effort</span>'));
  assert.ok(html.includes('<title>Plan and effort — Acme Studio</title>'));
  assert.ok(html.includes('@bottom-left { content: "Plan and effort \\b7  Acme Studio"; }'));
  const glance = section(html, 'glance plan-glance', 'rm-phase');
  assert.ok(glance.startsWith('<section class="glance plan-glance"><p class="verdict">Stop the harm first'));
  assert.ok(glance.includes('<span class="count"><b>3</b> fixes</span><span class="count"><b>7</b> steps</span><span class="count"><b>2</b> check steps first</span><span class="count"><b>1</b> choice for you</span>'));
  assert.ok(glance.includes('<li><span class="stage-n">Stage 1</span><strong>Stop the harm and check what we could not see</strong>'));
  assert.ok(glance.includes('<div><span class="effort effort-after-check">After the check</span><p>'));
  assert.ok(glance.includes('<span class="step-kind step-check">Check</span> Confirms a problem'));
  assert.ok(!html.includes('<section class="register">') && !html.includes('<section class="decisions">'));
  assert.throws(() => buildPlan({ synthesis: { ...sampleSynthesis(), plan: undefined } }), /no plan/);
});

test('each fix reads like a fix plan: the problem, the steps with effort and needs, and how to tell it is done', () => {
  const plan = buildPlan();
  assert.ok(plan.includes('<span class="sid">1</span><div><h3>The passwords are safe again</h3><p class="d-meta">Effort: <span class="effort effort-quick">Quick</span></p>'));
  assert.ok(plan.includes('<span class="effort effort-after-check">After the check</span> <span class="why">largest of 2 steps: 1 quick, 1 after the check</span>'), 'a fix of several steps says how many and of what size');
  assert.ok(plan.includes('What a step needs from you or from others is listed beside it, whatever its size.'), 'the scale is about size only, so a quick step may need someone');
  assert.ok(!plan.includes('No decision or outside access needed'));
  assert.ok(plan.includes('<h4>The problem</h4><p>Passwords sit in a file that anyone with access to the project can read.</p>'));
  assert.ok(plan.includes('<li><span class="badge badge-critical">Critical</span> Passwords are stored in a file anyone with access can read</li>'), 'what it resolves, in plain words and without ids');
  assert.ok(plan.includes('Covers decision 1') && !plan.includes('Covers “'), 'the header names the decision a fix carries out; a theme would only repeat the title');
  assert.ok(plan.includes('<th>Step</th><th>Needs from you or others</th><th>Effort</th>'));
  assert.ok(plan.includes('<tr class="check"><td class="n">2.1</td><td><span class="step-kind step-check">Check</span><strong>Confirm what search results show</strong>'));
  assert.ok(plan.includes('<td class="effort-cell"><span class="effort effort-after-check">After the check</span><p>Quick if only a few pages lack a summary; small if most do.</p></td>'), 'work sized after a check says what decides the size');
  assert.ok(plan.includes('<p class="after">After 2.1</p>'));
  assert.ok(plan.includes('<td class="who"><ul class="needs"><li>Read access to the search console</li></ul></td>'));
  assert.ok(plan.includes('<h4>Done when</h4><ul class="criteria"><li>No password is stored in the project'));
  assert.ok(plan.includes('<h2>What the work needs from you and others</h2>'));
  assert.ok(plan.includes('<tr><td>Admin access to the hosting account</td><td class="refs">Steps 1.1, 3.3</td></tr>'), 'a need shared by two fixes is listed once, with the steps that need it');
  assert.ok(!/Developer|Marketing lead|Site owner/.test(plan.slice(plan.indexOf('<section class="glance'))), 'no roles or people');
  assert.ok(!/\b\d+\s*(hours?|days?|weeks?)\b/.test(plan), 'no time estimates');
});

test('two equally good routes are shown side by side, with what the choice depends on, and the steps flow around them', () => {
  const plan = buildPlan();
  assert.ok(plan.includes('<p class="d-meta">Effort: Site generator <span class="effort effort-medium">Medium</span> · Shared include <span class="effort effort-small">Small</span> · Covers decision 1</p>'));
  assert.ok(plan.includes('<h4 class="rm-h">Routes compared</h4>'));
  assert.ok(plan.includes('<tr><td><strong>Adding a page</strong></td><td class="route"><p>Fill in a short file.</p></td><td class="route"><p>Copy an existing page.</p></td></tr>'));
  assert.ok(plan.includes('<tr class="route-total"><td><strong>Effort</strong></td><td class="route"><b><span class="effort effort-medium">Medium</span></b></td>'));
  assert.ok(plan.includes('<h4>You choose the route</h4><p>Both remove the copied header'));
  assert.ok(plan.includes('<b>1. Both routes</b>') && plan.includes('<b>2. Then one route: Site generator or Shared include</b>') && plan.includes('<b>3. Then, whichever route was taken</b>'));
  assert.ok(plan.includes('<p class="fork-who"><span class="effort effort-small">Small</span> <span class="why">Needs: Admin access to the hosting account</span></p>'));
  assert.ok(plan.includes('<tr><td><b>1.</b> Main menu items</td><td>The list of pages to show</td><td>Visitors find the main pages from every page.</td></tr>'), 'a checklist keeps each point with what it needs and why');
  assert.ok(plan.includes('</tbody></table><div class="checklist-block"><p class="cl-title">Points to settle in step 3.1</p>'), 'the checklist follows the table of its step instead of nesting in it');
  assert.ok(!plan.includes('checklist-row'));
  assert.ok(!plan.includes('Options considered'), 'a fix without routes shows no empty options table');
  const reordered = sampleSynthesis();
  reordered.plan.stages[1].fixes[0].steps[3].after = [];
  const shown = buildPlan({ synthesis: reordered });
  assert.ok(shown.includes('<td class="n">3.2</td><td><span class="step-kind step-check">Check</span><strong>Check every page</strong>'), 'steps are numbered in the order they are shown');
  assert.ok(shown.includes('<span class="n">3.3</span> <strong>Build the pages with a site generator</strong>') && shown.includes('<span class="n">3.4</span> <strong>Insert the shared parts on the server</strong>'));
  assert.ok(plan.includes('<p class="after">After 3.2, 3.3</p>'), 'what a step waits for uses the shown numbers');
});

test('without a plan the report has no plan section and the guide only explains what it shows', () => {
  const syn = sampleSynthesis();
  delete syn.plan;
  const html = build({ synthesis: syn });
  assert.ok(!html.includes('<section class="plan">'));
  assert.ok(!html.includes('class="effort effort-after-check"'), 'the after-the-check level only appears with a plan');
  assert.ok(html.includes('<h3>Effort <span class="h-note">'), 'option sizes still need the scale');
});

test('the register lists every problem found, and unticked ones only there; unconfirmed problems are marked “Check first”', () => {
  const html = build();
  const register = section(html, 'register', 'toolkit');
  assert.ok(register.includes('Images are not lazy-loaded</strong> <span class="tag tag-check">Check first</span>'), 'an unticked problem is listed');
  assert.ok(register.includes('AGENTS.md is very long</strong><span class="why">'));
  assert.ok(register.includes('<span class="see">Not in the plan yet</span>'), 'an unticked problem says it is not planned');
  assert.ok(register.includes('<tr><td>Performance</td><td class="bar-cell">') && register.includes('<td class="num">96</td><td class="num">1</td>'), 'area counts include unticked problems');
  assert.equal(html.indexOf('Images are not lazy-loaded'), html.lastIndexOf('Images are not lazy-loaded'), 'nowhere but the register');
  assert.ok(!html.includes('PERF-0b3e'));
  const noTool = build({ selected: TICKED.filter((id) => id !== 'AI-9e02'), synthesis: null });
  assert.ok(!noTool.includes('Skill: scaffold a page'), 'an unticked AI tooling suggestion is not printed');
  assert.ok(!build({ synthesis: null }).includes('Not in the plan yet'), 'without a plan nothing says “not in the plan”');
  assert.ok(html.includes('Page speed was not measured on the live site; it was judged from the code instead.'), 'check-level notes stay, in plain words');
  const withPerf = build({ selected: ['SEC-a91c', 'PERF-0b3e'], synthesis: null });
  assert.ok(withPerf.includes('Images are not lazy-loaded</strong> <span class="tag tag-check">Check first</span>'));
  assert.ok(withPerf.includes('<b>To be sure:</b> Measure page speed on the live site.'));
  assert.ok(withPerf.includes('<h3>What this review could not see</h3>'));
  assert.ok(!/not confirmed/i.test(withPerf) && !/not confirmed/i.test(html));
});

test('finding text and brand values cannot inject markup (review focus 4)', () => {
  const doc = sampleDoc();
  doc.findings[0].title = '<script>alert(1)</script>';
  doc.project.name = 'Evil</style><script>x()</script>';
  const profile = sampleProfile();
  profile.brand.primaryColor = 'red;}</style><script>';
  profile.brand.fontFamily = 'x;}</style>';
  profile.brand.fontUrl = 'javascript:alert(1)';
  const syn = sampleSynthesis();
  syn.wording = {};
  syn.decisions[0].options[0].name = '<img src=x onerror=alert(1)>';
  const html = build({ doc, profile, synthesis: syn, logoSrc: 'javascript:alert(1)' });
  assert.ok(!html.includes('<script>'), 'no raw script tags');
  assert.ok(!html.includes('<img src=x'), 'synthesis text is escaped');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('javascript:'), 'no javascript: URLs');
  assert.match(html, /--band-bg: #1f2937/);
  assert.ok(!html.includes('--band-font: "'), 'invalid font is dropped');
});

test('logoSource embeds project files and refuses paths outside the project', () => {
  const root = path.join(FIXTURES, 'static-html');
  assert.match(logoSource(root, 'img/logo.svg'), /^data:image\/svg\+xml;base64,/);
  assert.equal(logoSource(root, '../../package.json'), null);
  assert.equal(logoSource(root, 'https://cdn.test/logo.png'), 'https://cdn.test/logo.png');
  assert.equal(logoSource(root, 'http://cdn.test/logo.png'), null);
  assert.equal(logoSource(root, null), null);
});

function makeRun() {
  const root = tmpDir();
  const runDir = path.join(root, '.project-health', 'runs', '2026-10-11T0950');
  fs.mkdirSync(runDir, { recursive: true });
  writeJson(path.join(runDir, 'findings.json'), sampleDoc());
  writeJson(path.join(runDir, 'profile.json'), sampleProfile());
  fs.writeFileSync(path.join(runDir, 'checklist.md'), renderChecklist(sampleDoc()));
  writeJson(path.join(runDir, 'synthesis.json'), sampleSynthesis());
  return { root, runDir };
}

test('renderReport writes report.html and warns when no browser is available', () => {
  const { root, runDir } = makeRun();
  const result = renderReport(root, runDir, { browser: null });
  assert.ok(fs.existsSync(result.html));
  assert.equal(result.pdf, null);
  assert.equal(result.selected, 5);
  assert.equal(result.synthesis, true);
  assert.equal(result.plan.html, path.join(runDir, 'plan.html'));
  assert.ok(fs.readFileSync(result.plan.html, 'utf8').includes('<span class="stage-n">Stage 1</span>'));
  assert.ok(!fs.readFileSync(result.html, 'utf8').includes('<section class="plan">'));
  assert.ok(result.warnings.some((w) => w.includes('No Chrome, Edge or Chromium')));
  assert.ok(fs.readFileSync(result.html, 'utf8').includes('Every page carries its own copy of the header'));
});

test('one problem that several areas or checks reported is printed and counted once', () => {
  const syn = { ...sampleSynthesis(), duplicates: [{ keep: 'SEC-a91c', same: ['SEO-77de'] }] };
  assert.deepEqual(validateSynthesis(syn, { doc: sampleDoc(), selectedIds: TICKED }).errors, []);
  const html = build({ synthesis: syn });
  assert.ok(html.includes('<span class="count count-critical"><b>1</b> critical</span>'), 'the cover counts it once');
  assert.ok(html.includes('Also found under SEO and discoverability: counted once'));
  assert.match(html, /<span class="score-num">95<\/span>/, 'the overall score counts it once too');
  assert.match(html, /SEO and discoverability<span class="area-score">90\/100 · /, 'the copy no longer costs its area points');
  const plain = build();
  assert.ok(plain.includes('<span class="count count-critical"><b>2</b> critical</span>'));
  assert.match(plain, /<span class="score-num">92<\/span>/);
  // A fix that planned only the copy resolves the problem kept for it, not nothing.
  const copyPlanned = structuredClone(syn);
  copyPlanned.duplicates = [{ keep: 'SEO-77de', same: ['SEC-a91c'] }];
  const plan = buildPlan({ synthesis: copyPlanned });
  const fix1 = plan.slice(plan.indexOf('<ul class="resolves">'), plan.indexOf('</ul>', plan.indexOf('<ul class="resolves">')));
  assert.ok(fix1.includes('noindex on the production site'), `the kept finding is listed where its copy was planned: ${fix1}`);
  assert.ok(!validateSynthesis(copyPlanned, { doc: sampleDoc(), selectedIds: TICKED }).warnings.some((w) => /SEC-a91c is not in the plan/.test(w)));
  const bad = validateSynthesis({ ...sampleSynthesis(), duplicates: [{ keep: 'SEC-a91c', same: ['PERF-0b3e', 'AI-9e02'] }, { keep: 'PERF-0b3e', same: ['ARCH-5c10'] }] }, { doc: sampleDoc(), selectedIds: TICKED }).errors;
  for (const re of [/AI-9e02 is an AI tooling suggestion/, /PERF-0b3e is already in \$\.duplicates\[0\]/, /tick all of SEC-a91c, PERF-0b3e, AI-9e02/]) assert.ok(bad.some((e) => re.test(e)), `${re}: ${bad.join(' | ')}`);
});

test('the tools’ notes on what they could not check reach the owner in plain words', () => {
  assert.equal(plainNote('npm audit skipped — no package-lock.json'), 'The code libraries the site uses were not checked against the public list of known security holes: the project does not record their exact versions.');
  assert.equal(plainNote('Lighthouse disabled — performance metrics come from code inspection'), 'Page speed was not measured on the live site; it was judged from the code instead.');
  assert.equal(plainNote('Something new the list does not know'), 'Something new the list does not know');
  const html = build({ doc: { ...sampleDoc(), notVerified: ['npm audit skipped — no package-lock.json'] } });
  assert.ok(!html.includes('package-lock'), 'no raw tool message in the owner report');
});

test('a brand name the user corrects after the run is printed at the next render', () => {
  const { root, runDir } = makeRun();
  writeJson(path.join(root, '.project-health', 'kb', 'facts.json'), { facts: [{ key: 'brand.name', value: 'Acme Joinery Ltd', source: 'human', confidence: 'high' }] });
  const html = fs.readFileSync(renderReport(root, runDir, { browser: null }).html, 'utf8');
  assert.ok(html.includes('Acme Joinery Ltd'));
  assert.ok(html.includes('<span>Checked 2026-10-11</span>'), 'the cover carries the date of the check, not of the printing');
});

test('renderReport says when the synthesis is missing, unreviewed or out of date', () => {
  const { root, runDir } = makeRun();
  const syn = sampleSynthesis();
  delete syn.review;
  writeJson(path.join(runDir, 'synthesis.json'), syn);
  const unreviewed = renderReport(root, runDir, { browser: null });
  assert.equal(unreviewed.synthesis, true);
  assert.ok(unreviewed.warnings.some((w) => w.includes('has not reviewed')));
  assert.equal(typeof unreviewed.readability.code, 'number');

  const md = fs.readFileSync(path.join(runDir, 'checklist.md'), 'utf8');
  fs.writeFileSync(path.join(runDir, 'checklist.md'), md.replace('- [x] **ARCH-5c10**', '- [ ] **ARCH-5c10**'));
  const stale = renderReport(root, runDir, { browser: null });
  assert.equal(stale.synthesis, false);
  assert.ok(stale.warnings.some((w) => w.includes('does not match the ticked findings') && w.includes('ARCH-5c10')), stale.warnings.join(' | '));

  fs.rmSync(path.join(runDir, 'synthesis.json'));
  const missing = renderReport(root, runDir, { browser: null });
  assert.ok(missing.warnings.some((w) => w.startsWith('No synthesis.json')));
  assert.equal(missing.plan, null);
  assert.ok(!fs.existsSync(path.join(runDir, 'plan.html')), 'a plan from an earlier render is removed');
});

test('renderReport explains a missing checklist', () => {
  const { root, runDir } = makeRun();
  fs.rmSync(path.join(runDir, 'checklist.md'));
  assert.throws(() => renderReport(root, runDir, { browser: null }), /no checklist\.md/);
});

test('renderReport prints a PDF when a browser exists', { skip: !findBrowser() && 'no Chrome/Edge/Chromium installed' }, () => {
  const { root, runDir } = makeRun();
  const result = renderReport(root, runDir);
  const head = fs.readFileSync(result.pdf).subarray(0, 4).toString();
  assert.equal(head, '%PDF');
  assert.equal(fs.readFileSync(result.plan.pdf).subarray(0, 4).toString(), '%PDF');
  assert.ok(fs.statSync(result.pdf).size > 5000);
});

test('renderReport keeps report.html and warns when PDF printing fails', () => {
  const { root, runDir } = makeRun();
  const result = renderReport(root, runDir, { browser: process.execPath });
  assert.ok(fs.existsSync(result.html));
  assert.equal(result.pdf, null);
  assert.ok(result.warnings.some((w) => /^PDF printing failed \(.+\) — wrote report\.html only\.$/s.test(w)), result.warnings.join('\n'));
});
