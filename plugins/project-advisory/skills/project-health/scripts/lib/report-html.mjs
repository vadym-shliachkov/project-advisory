import fs from 'node:fs';
import path from 'node:path';
import { AREAS, AREA_TITLES, SEVERITIES } from './areas.mjs';
import { escapeHtml as esc } from './html.mjs';
import { DEFAULT_HERO, contrast, safeColor, textColorFor } from './color.mjs';
import { firstFamily } from './brand.mjs';
import { placements, fixesFor, worded, duplicateIds, keptFinding } from './synthesis.mjs';
import { scoredOnce } from './score.mjs';

export const SEV = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
const SEV_MEANING = {
  critical: 'Causes harm now: data or security exposure, the site is down or cannot be found in search, or a legal obligation is breached.',
  high: 'Measurable loss of visitors, enquiries or money, or a risk that is likely to happen.',
  medium: 'A real but gradual cost: slower changes, more mistakes, more work for the team.',
  low: 'Polish, or good practice with a small effect.',
};
// One effort scale for options and plan steps. It describes the scope of the work only, so the owner can compare pieces
// of work; what a step needs from the owner or from others is listed beside it. The team doing the work turns it into a quote.
export const EFFORT = {
  quick: ['Quick', 'One change in one place.'],
  small: ['Small', 'A few related changes by one person. Fits into normal work.'],
  medium: ['Medium', 'Many pages or a shared part. Needs its own time and testing.'],
  large: ['Large', 'Changes how the site is built or run. Done in stages, after a decision.'],
  'after-check': ['After the check', 'Depends on what a check finds. The step says what decides it.'],
};
export const EFFORT_TEXT = 'Effort levels compare the size of pieces of work. What a step needs from you or from others is listed beside it, whatever its size. They are not time or cost estimates: the team doing the work turns them into a quote.';
const PLAN_ELSEWHERE = 'How each problem gets fixed, step by step and with its effort, is in a separate document, “Plan and effort”.';
const CHECK_TEXT = 'Being certain needs a look outside the project, such as at the server or an account. Checked before the work is sized.';
// Each kind of AI tool, by its usual name and in plain words, so the owner knows what is being proposed.
const TOOL_KIND = {
  rule: ['Rule', 'Standing instruction', 'A short note the assistant reads by itself before it works on a certain part of the site, like a house style guide. It keeps every change within the agreed rules without anyone repeating them.'],
  skill: ['Skill', 'Reusable procedure', 'A written step-by-step routine for a task that comes back often. The assistant follows it the same way every time, like a checklist handed to a new colleague.'],
  command: ['Command', 'Shortcut', 'A short name a person types to start a routine, such as starting a preview. Nobody has to remember the steps behind it.'],
  hook: ['Hook', 'Automatic check', 'Runs by itself at a set moment, for example just before something is published, and stops the action when something is wrong. It works even when people forget.'],
  agent: ['Agent', 'Specialist assistant', 'A second assistant with one narrow job and its own instructions, for example reviewing a change before it goes live.'],
  mcp: ['Connection', 'Link to another service', 'Gives the assistant controlled access to an outside service, such as a web browser or the analytics account, so it can check results itself.'],
};
const kindName = (type) => TOOL_KIND[type]?.[0] ?? type;
const MIME = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
// The report's own type: IBM Plex Serif for headings over IBM Plex Sans for text (see report.css).
const REPORT_FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
  + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Serif:wght@600&display=swap">';
const GFONTS_URL_RE = /^https:\/\/fonts\.googleapis\.com\/css2?\?[^"'<>\s]+$/;
const GUIDE_FITS_WORDS = 95;
const SCORES_TEXT = 'Each area starts at 100 and loses points for every problem found there: Critical 25, High 10, Medium 4, Low 1. The overall score is the average of the analysed areas.';
const SCORES_DETAIL = 'Every problem found counts, whether or not it was chosen for this report; a problem found in several areas counts once, in the area it is listed under. Problems dismissed during review as wrong or not applicable do not count. Scores do not go below 0. AI toolkit suggestions do not affect scores.';

export function logoSource(root, logo) {
  if (!logo) return null;
  if (/^https:\/\//i.test(logo)) return logo;
  if (/^[a-z]+:/i.test(logo)) return null;
  const abs = path.resolve(root, logo);
  const rel = path.relative(path.resolve(root), abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const mime = MIME[path.extname(abs).toLowerCase()];
  if (!mime || !fs.existsSync(abs) || fs.statSync(abs).size > 2_000_000) return null;
  return `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`;
}

const isIssue = (f) => f.kind !== 'tooling';
export const badge = (s) => `<span class="badge badge-${s}">${SEV[s]}</span>`;
export const list = (items, cls = '') => `<ul${cls ? ` class="${cls}"` : ''}>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
// A CSS string literal that cannot close the rule it sits in.
const cssString = (s) => `"${String(s).replace(/[^\w .,-]/g, (c) => `\\${c.codePointAt(0).toString(16)} `)}"`;

function clampScore(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 0;
}

const problems = (n) => `${n} ${n === 1 ? 'problem' : 'problems'}`;
export const effortBadge = (e) => `<span class="effort effort-${e}">${esc(EFFORT[e][0])}</span>`;

// "fix 3", "fixes 3 and 5", "fixes 2, 4 and 6".
export function fixRef(fixes) {
  const ns = [...new Set(fixes.map((fx) => fx.n))].sort((a, b) => a - b);
  if (!ns.length) return '';
  if (ns.length === 1) return `fix ${ns[0]}`;
  return `fixes ${ns.slice(0, -1).join(', ')} and ${ns.at(-1)}`;
}

// "7 problems: 1 high, 6 medium" — how much a decision or theme covers, without listing ids.
function weight(ids, byId) {
  const found = ids.map((id) => byId.get(id)).filter((f) => f && isIssue(f));
  if (!found.length) return '';
  const parts = SEVERITIES.map((s) => [s, found.filter((f) => f.severity === s).length]).filter(([, n]) => n).map(([s, n]) => `${n} ${s}`);
  const toCheck = found.filter((f) => !f.verified).length;
  return `${problems(found.length)}: ${parts.join(', ')}${toCheck ? ` · ${toCheck} to check first` : ''}`;
}

// The branded band at the top of the first page. With a logo the logo is the title; without one the project name is.
// The date on the cover is when the site was checked (the run's date), or the date the caller names, never the day it
// was printed: a report printed again must not read as a fresh check.
function band(doc, logoSrc, generatedAt, label, dated) {
  const safeLogo = logoSrc && /^(data:image\/|https:\/\/)/i.test(logoSrc) ? logoSrc : null;
  const run = /^\d{4}-\d{2}-\d{2}/.exec(doc.run ?? '')?.[0];
  const date = dated ?? (run ? `Checked ${run}` : generatedAt.toISOString().slice(0, 10));
  const mark = safeLogo
    ? `<img class="band-logo" src="${esc(safeLogo)}" alt="${esc(doc.project.name)}">`
    : `<h1 class="band-name">${esc(doc.project.name)}</h1>`;
  const meta = [label, doc.project.url, date].filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join('');
  return `<header class="band">${mark}<p class="band-meta">${meta}</p></header>`;
}

export const effortKey = (levels) => `<div class="effort-key" style="--cols:${levels.length}">${levels.map((e) => `<div>${effortBadge(e)}<p>${esc(EFFORT[e][1])}</p></div>`).join('')}</div>`;

function counts(issues) {
  const toCheck = issues.filter((f) => !f.verified).length;
  return `<p class="counts">${SEVERITIES.map((s) => `<span class="count count-${s}"><b>${issues.filter((f) => f.severity === s).length}</b> ${SEV[s].toLowerCase()}</span>`).join('')}`
    + `${toCheck ? `<span class="count count-check"><b>${toCheck}</b> to check first</span>` : ''}</p>`;
}

// What each section of the report answers, in reading order; only the sections this report has.
function contents(chosen, syn) {
  const tools = chosen.some((f) => f.kind === 'tooling') || (syn?.tools ?? []).length;
  const rows = [
    syn?.decisions.length && ['Decisions', 'Choices to make: the problem, its cost, the options and our advice.'],
    syn?.workflow && ['How changes reach the live site', 'Today’s steps and where they go wrong, then the proposed steps.'],
    syn?.themes.length && ['Other problems worth fixing', 'Problems with one clear way to fix them, grouped by cause.'],
    ['All problems by area', 'Every problem with its severity and explanation, and area scores.'],
    tools && ['AI toolkit', 'Additions to the AI assistant that take over repeated work.'],
    ['Glossary and notes', 'Technical words, how scores work, and what we could not see.'],
  ].filter(Boolean);
  const plan = syn?.plan ? `<p class="key-line">${esc(PLAN_ELSEWHERE)}</p>` : '';
  return `<ol class="contents">${rows.map(([name, what]) => `<li><strong>${esc(name)}</strong><span>${esc(what)}</span></li>`).join('')}</ol>${plan}`;
}

// First page: the score, the verdict and how to read the rest. `issues` are all the problems the register lists.
function glance(doc, chosen, issues, syn) {
  const overall = doc.overallScore == null ? '—' : clampScore(doc.overallScore);
  const score = `<div class="score"><span class="score-num">${overall}</span><span class="score-of">/100</span><span class="score-label">overall health</span></div>`;
  const verdict = syn ? `<p class="verdict">${esc(syn.summary.verdict)}</p>` : '';
  const sized = syn?.decisions.length;
  const toCheck = issues.some((f) => !f.verified);
  const severity = `<div class="sev-key">${SEVERITIES.map((s) => `<div>${badge(s)}<p>${esc(SEV_MEANING[s])}</p></div>`).join('')}</div>`;
  const effort = effortKey(Object.keys(EFFORT).filter((e) => e !== 'after-check'));
  // Severity and effort are scales, one row each, then the check mark. How scores work is in the notes at the back.
  const guide = `<div class="guide"><h2>How to read this report</h2>${contents(chosen, syn)}<h3>Severity</h3>${severity}`
    + (sized ? `<h3>Effort <span class="h-note">compares pieces of work. It is not a time or cost estimate.</span></h3>${effort}` : '')
    + (toCheck ? `<p class="key-line"><span class="tag tag-check">Check first</span> ${CHECK_TEXT}</p>` : '')
    + '</div>';
  // Next to a verdict longer than the editor's limit the guide no longer fits on the first page; it then gets a page of
  // its own instead of being pushed over with the first page's padding.
  const fits = !syn || syn.summary.verdict.split(/\s+/).length <= GUIDE_FITS_WORDS;
  const head = `<div class="glance-head">${score}${verdict}</div>${counts(issues)}`;
  return fits ? `<section class="glance">${head}${guide}</section>` : `<section class="glance">${head}</section><section class="guide-page">${guide}</section>`;
}

// Without a synthesis there are no decisions; the most serious problems stand in for them.
function seriousProblems(chosen, syn) {
  if (syn) return '';
  const top = chosen.filter((f) => isIssue(f) && (f.severity === 'critical' || f.severity === 'high')).slice(0, 8);
  return top.length
    ? `<section class="serious"><h2>Most serious problems</h2><ol class="serious-list">${top.map((f) => `<li><strong>${esc(f.title)}</strong><span>${SEV[f.severity]}</span></li>`).join('')}</ol></section>`
    : '';
}

// "7 problems: 1 high, 6 medium · In the plan: fixes 3 and 4"
function groupMeta(syn, g, byId) {
  const fixes = fixRef(fixesFor(syn, g.id));
  return [weight(g.findingIds, byId), fixes && `In the plan: ${fixes}`].filter(Boolean).join(' · ');
}

function decisionsSection(syn, byId) {
  if (!syn?.decisions.length) return '';
  const blocks = syn.decisions.map((d, i) => {
    const rec = d.options.find((o) => o.recommended);
    const covers = groupMeta(syn, d, byId);
    const rows = d.options.map((o) => `<tr${o.recommended ? ' class="recommended"' : ''}><td class="opt"><strong>${esc(o.name)}</strong>${o.recommended ? ' <span class="pill">Recommended</span>' : ''}<p>${esc(o.description)}</p><p class="size">Effort ${effortBadge(o.size)}</p></td><td>${list(o.pros, 'pros')}</td><td>${list(o.cons, 'cons')}</td></tr>`).join('');
    // The problem and its cost first, then the options, then which one we recommend and why.
    return `<article class="decision"><div class="d-top"><header class="d-head"><span class="num">${i + 1}</span><div><h3>${esc(d.title)}</h3>${covers ? `<p class="d-meta">Covers ${esc(covers)}</p>` : ''}</div></header>`
      + `<div class="split"><div class="panel panel-found"><h4>What we found</h4><p>${esc(d.problem)}</p></div><div class="panel panel-cost"><h4>What it costs you today</h4>${list(d.costs, 'costs')}</div></div></div>`
      + `<table class="options"><thead><tr><th>Your options</th><th>Advantages</th><th>Drawbacks</th></tr></thead><tbody>${rows}</tbody></table>`
      + `<div class="because"><h4>Why we recommend “${esc(rec.name)}”</h4><p>${esc(d.recommendation)}</p></div></article>`;
  }).join('');
  return `<section class="decisions"><h2>Decisions</h2><p class="lead">Each decision is one cause behind several problems. It shows what we found and what it costs you, then the options from the lightest to the most thorough, and which one we recommend and why.</p>${blocks}</section>`;
}

// The AI tools the report proposes, from the tooling findings and from the decisions, by name.
function allTools(chosen, syn) {
  const decisionRef = new Map((syn?.decisions ?? []).map((d, i) => [d.id, `Decision ${i + 1}: ${d.title}`]));
  const found = chosen.filter((f) => f.kind === 'tooling').map((raw) => {
    const f = worded(raw, syn);
    return { id: f.id, name: f.title, type: f.toolType, trigger: f.trigger, description: f.draftDescription, problem: f.why, benefit: f.benefit, decision: null };
  });
  const planned = (syn?.tools ?? []).map((t) => ({ ...t, decision: decisionRef.get(t.decision) ?? null }));
  return { found, planned };
}

function workflowSection(syn, tools) {
  const w = syn?.workflow;
  if (!w) return '';
  const chip = (t) => (t ? `<span class="tool-chip"><b>${esc(kindName(t.type))}</b> ${esc(t.name)}</span>` : '');
  const byId = new Map(tools.found.map((t) => [t.id, t]));
  const byName = new Map(tools.planned.map((t) => [t.name, t]));
  // Two full-width tables, one after the other: rows break cleanly across pages, where side-by-side columns cannot.
  const num = (i, weak) => `<td class="n${weak ? ' weak' : ''}">${i + 1}</td>`;
  const today = w.today.map((s, i) => `<tr>${num(i, s.weak)}<td>${esc(s.step)}</td><td class="note">${esc(s.note ?? '')}</td></tr>`).join('');
  const proposed = w.proposed.map((s, i) => `<tr>${num(i)}<td>${esc(s.step)}${s.note ? `<span class="note">${esc(s.note)}</span>` : ''}</td><td>${chip(byId.get(s.toolId))}${chip(byName.get(s.tool))}</td></tr>`).join('');
  return `<section class="workflow"><h2>How changes reach the live site</h2><p class="lead">${esc(w.summary)}</p>`
    + `<h3>Today</h3><table class="flow-table"><thead><tr><th class="n"></th><th>Step</th><th>What goes wrong</th></tr></thead><tbody>${today}</tbody></table>`
    + `<p class="meta">Steps marked in red are where mistakes or delays happen today.</p>`
    + `<h3>Proposed</h3><table class="flow-table flow-new"><thead><tr><th class="n"></th><th>Step</th><th>AI help</th></tr></thead><tbody>${proposed}</tbody></table>`
    + `<p class="meta">The AI help column names the addition from the AI toolkit section that does the step.</p></section>`;
}

function themesSection(syn, byId) {
  if (!syn?.themes.length) return '';
  return `<section class="themes"><h2>Other problems worth fixing</h2><p class="lead">These problems have one clear way to fix them, so there are no options to choose between. Anything a fix needs from you, such as an answer or a sign-off, is listed in the plan. Each group shares one cause, so fixing the cause clears the whole group.</p>`
    + syn.themes.map((t) => `<article class="theme"><h3>${esc(t.title)}</h3><p class="theme-meta">${esc(groupMeta(syn, t, byId))}</p><p>${esc(t.summary)}</p></article>`).join('')
    + `</section>`;
}

// One row per problem found, with its own short explanation, and where the report and the plan deal with it.
function registerSection(doc, issues, syn) {
  const placed = placements(syn);
  const bars = AREAS.filter((a) => doc.areas[a]?.status === 'ok').map((a) => {
    const score = clampScore(doc.areas[a].score);
    const n = issues.filter((f) => f.area === a).length;
    return `<tr><td>${esc(AREA_TITLES[a])}</td><td class="bar-cell"><span class="bar"><span class="bar-fill" style="width:${score}%"></span></span></td><td class="num">${score}</td><td class="num">${n}</td></tr>`;
  }).join('');
  const row = (raw) => {
    const f = worded(raw, syn);
    const p = placed.get(f.id);
    const group = p?.kind === 'decision' ? `Part of decision ${p.n}: ${esc(p.title)}` : p?.kind === 'theme' ? `Part of “${esc(p.title)}”` : '';
    const plan = p?.fixes.length ? `Plan: ${fixRef(p.fixes)}` : syn?.plan && !p ? 'Not in the plan yet' : '';
    const see = [group, plan].filter(Boolean).map((t) => `<span class="see">${t}</span>`).join(' ');
    const tag = f.verified ? '' : ' <span class="tag tag-check">Check first</span>';
    const confirm = !f.verified && f.toConfirm ? `<span class="confirm"><b>To be sure:</b> ${esc(f.toConfirm)}</span>` : '';
    const also = f.alsoIn?.length ? `<span class="see">Also found under ${esc(f.alsoIn.map((a) => AREA_TITLES[a] ?? a).join(', '))}: counted once</span>` : '';
    return `<tr><td class="sev">${badge(f.severity)}</td><td><strong>${esc(f.title)}</strong>${tag}<span class="why">${esc(f.why)}</span>${confirm}${see}${also}</td></tr>`;
  };
  const areas = AREAS.filter((a) => issues.some((f) => f.area === a))
    .map((a) => `<div class="reg-area"><h3>${esc(AREA_TITLES[a])}<span class="area-score">${doc.areas[a]?.status === 'ok' ? `${clampScore(doc.areas[a].score)}/100 · ` : ''}${problems(issues.filter((f) => f.area === a).length)}</span></h3><table class="issues">${issues.filter((f) => f.area === a).map(row).join('')}</table></div>`).join('');
  return `<section class="register"><h2>All problems by area</h2><p class="lead">Every problem we found, grouped by area and most serious first. A problem chosen for this round names the decision or group above that deals with its cause, and the fix in the plan that solves it. The others say they are not in the plan yet. Problems marked “Check first” say what would make them certain.</p>`
    + `<table class="scores"><thead><tr><th>Area</th><th></th><th class="num">Score</th><th class="num">Problems</th></tr></thead><tbody>${bars}</tbody></table>`
    + (areas || '<p>No problems were found.</p>')
    + `</section>`;
}

function toolCard(t) {
  const [name, plain] = TOOL_KIND[t.type] ?? [t.type, ''];
  const field = (label, text) => (text ? `<dt>${label}</dt><dd>${esc(text)}</dd>` : '');
  return `<article class="tool"><header><p class="tool-kind"><span class="kind">${esc(name)}</span>${plain ? ` ${esc(plain)}` : ''}</p><h4>${esc(t.name)}</h4></header>`
    + `<dl>${field('The problem today', t.problem)}${field('What it does', t.description)}${field('When it is used', t.trigger)}${field('How it helps', t.benefit)}`
    + `${t.decision ? `<dt>Goes with</dt><dd>${esc(t.decision)}</dd>` : ''}</dl></article>`;
}

function toolkitSection(tools) {
  const { found, planned } = tools;
  if (!found.length && !planned.length) return '';
  const used = Object.keys(TOOL_KIND).filter((k) => [...found, ...planned].some((t) => t.type === k));
  const kinds = `<dl class="kinds">${used.map((k) => `<dt><span class="kind">${TOOL_KIND[k][0]}</span><span class="kind-plain">${TOOL_KIND[k][1]}</span></dt><dd>${esc(TOOL_KIND[k][2])}</dd>`).join('')}</dl>`;
  return `<section class="toolkit"><h2>AI toolkit for this project</h2>`
    + `<p class="lead">An AI coding assistant can do much of the routine work on a site like this one. The additions below are short files kept in the project. They tell the assistant how this site works, take over work that repeats, and stop mistakes before visitors see them. Each is small to add and can be changed or removed at any time.</p>`
    + `<h3>The kinds of additions</h3>${kinds}`
    + (found.length ? `<h3>For work that repeats or goes wrong today</h3>${found.map(toolCard).join('')}` : '')
    + (planned.length ? `<h3>To make the recommended way of working easy</h3>${planned.map(toolCard).join('')}` : '')
    + `</section>`;
}

// The tools' own notes on what they could not check, in the owner's words. The technical wording stays in
// findings.json for the team; a note this list does not know is printed as it is.
const AUDIT_WHY = (why) => (/no (package-lock|composer\.lock)/.test(why) ? 'the project does not record their exact versions'
  : /not installed/.test(why) ? 'the checking tool was not available' : 'the check did not complete');
const PLAIN_NOTES = [
  [/^npm audit (?:skipped|failed) — (.*)$/, (m) => `The code libraries the site uses were not checked against the public list of known security holes: ${AUDIT_WHY(m[1])}.`],
  [/^composer audit (?:skipped|failed) — (.*)$/, (m) => `The PHP libraries the site uses were not checked against the public list of known security holes: ${AUDIT_WHY(m[1])}.`],
  [/^Lighthouse disabled/, () => 'Page speed was not measured on the live site; it was judged from the code instead.'],
  [/^Lighthouse failed/, () => 'Page speed could not be measured on the live site; it was judged from the code instead.'],
  [/^Committed-file checks skipped/, () => 'Which files are stored in the project could not be listed, so stored settings files and build files were not checked.'],
  [/^Secrets in git history not checked/, () => 'The project’s history of changes was not searched for passwords.'],
  [/^Secrets in git history: only the latest (\d+) commits/, (m) => `Only the latest ${m[1]} changes in the project’s history were searched for passwords.`],
  [/^Git checks skipped/, () => 'The project keeps no history of its changes, so the checks that read that history (stored passwords, stored settings files, how changes are made) were not run.'],
  [/^Live site returned HTTP (\d+)/, (m) => `The live site turned our visit away (code ${m[1]}), so what its pages show could not be checked.`],
  [/^Live site unreachable/, () => 'The live site could not be reached, so nothing on it was checked.'],
];
export function plainNote(text) {
  for (const [re, say] of PLAIN_NOTES) { const m = re.exec(text); if (m) return say(m); }
  return text;
}

function appendix(doc, chosen, syn, generatedAt) {
  const checks = [
    ...(doc.notVerified ?? []).map(plainNote),
    ...(doc.notRechecked ?? []).map((f) => `${f.title} (found in an earlier run; not re-checked because ${f.reason.replace(/^needs/, 'it needs')})`),
  ];
  // Analysed areas already appear with their scores in the register; only the gaps are listed here.
  const notAnalysed = AREAS.map((a) => [a, doc.areas[a] ?? { status: 'skipped', reason: 'not run' }]).filter(([, s]) => s.status !== 'ok');
  const statusRows = notAnalysed.map(([a, s]) => `<tr><td>${esc(AREA_TITLES[a])}</td><td>${esc(s.status)} · ${esc(s.reason ?? '')}</td></tr>`).join('');
  const glossary = syn?.glossary.length
    ? `<h3>Glossary</h3><dl class="glossary">${[...syn.glossary].sort((a, b) => a.term.localeCompare(b.term)).map((g) => `<dt>${esc(g.term)}</dt><dd>${esc(g.meaning)}</dd>`).join('')}</dl>`
    : '';
  return `<section class="appendix"><h2>Glossary and notes</h2>`
    + glossary
    + `<h3>How scores are calculated</h3><p>${SCORES_TEXT} ${SCORES_DETAIL}</p>`
    + (statusRows ? `<h3>Areas not analysed</h3><table>${statusRows}</table>` : '')
    + (checks.length ? `<h3>What this review could not see</h3><p>These checks could not be run, usually because they need the live site or access to a service outside the project. Problems that depend on them are marked “Check first” in the register.</p>${list(checks)}` : '')
    + `<p class="meta">The technical details behind every problem (files, pages and history) are in the analysis log of run ${esc(doc.run)}. Analysed with ${doc.mode === 'sequential' ? 'a single agent' : 'one agent per area'}; generated ${esc(generatedAt.toISOString().slice(0, 16).replace('T', ' '))} UTC.</p>`
    + `</section>`;
}

// The page shell every document shares: the brand band, the report's type and colours, and a footer naming the document.
export function frame({ doc, profile, template, css, logoSrc, generatedAt, label, body, dated = null }) {
  const brand = profile?.brand ?? {};
  const bg = safeColor(brand.primaryColor);
  const font = brand.fontFamily ? firstFamily(brand.fontFamily) : null;
  const fontLink = REPORT_FONTS + (brand.fontUrl && GFONTS_URL_RE.test(brand.fontUrl) ? `<link rel="stylesheet" href="${esc(brand.fontUrl)}">` : '');
  // The brand colour is the one accent when it is dark enough to read as text on white; otherwise a neutral ink.
  const accent = contrast(bg, '#ffffff') >= 4.5 ? bg : DEFAULT_HERO;
  const heroCss = `:root { --accent: ${accent}; } .band { --band-bg: ${bg}; --band-fg: ${textColorFor(bg)};${font ? ` --band-font: "${font}", var(--sans);` : ''} }`
    + ` @page { @bottom-left { content: ${cssString(`${label} · ${doc.project.name}`)}; } } @page :first { @bottom-left { content: none; } }`;
  const parts = {
    title: esc(`${label} — ${doc.project.name}`),
    fontLink,
    css: css.replace(/<\/style/gi, ''),
    heroCss: heroCss.replace(/<\/style/gi, ''),
    hero: band(doc, logoSrc, generatedAt, label, dated),
    body,
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => parts[key] ?? '');
}

export function buildReportHtml({ doc: found, profile, selected, synthesis = null, template, css, logoSrc, generatedAt = new Date() }) {
  const chosenIds = new Set(selected);
  const chosen = found.findings.filter((f) => chosenIds.has(f.id));
  // A problem several areas reported is printed, counted and scored once, under the finding the synthesis kept.
  const hidden = duplicateIds(synthesis);
  const every = new Map(found.findings.map((f) => [f.id, f]));
  const once = (list) => list.filter((f) => !hidden.has(f.id)).map((f) => keptFinding(f, synthesis, every));
  const doc = hidden.size ? scoredOnce(found, once(found.findings)) : found;
  const issues = once(doc.findings.filter(isIssue)).sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
  const byId = new Map(once(chosen).map((f) => [f.id, f]));
  const tools = allTools(chosen, synthesis);
  const body = glance(doc, chosen, issues, synthesis)
    + seriousProblems(chosen, synthesis)
    + decisionsSection(synthesis, byId)
    + workflowSection(synthesis, tools)
    + themesSection(synthesis, byId)
    + registerSection(doc, issues, synthesis)
    + toolkitSection(tools)
    + appendix(doc, chosen, synthesis, generatedAt);
  return frame({ doc, profile, template, css, logoSrc, generatedAt, label: 'Website health report', body });
}
