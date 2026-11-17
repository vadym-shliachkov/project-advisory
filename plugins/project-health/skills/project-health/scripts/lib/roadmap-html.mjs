import { AREAS, AREA_TITLES } from './areas.mjs';
import { escapeHtml as esc } from './html.mjs';
import { badge, list, frame } from './report-html.mjs';
import { findPerson } from './knowledge.mjs';
import { totalDays, activeTasks, routeTasks } from './roadmap.mjs';

// The implementation roadmap is written for the team that does the work: finding ids, files and technical terms are
// welcome here, unlike in the owner's report.
const RESOLUTION = {
  backlog: 'Moved to the backlog',
  'wont-fix': 'Will not fix',
  'accepted-risk': 'Risk accepted',
  'not-applicable': 'Does not apply',
  'already-fixed': 'Already fixed',
  wrong: 'Finding was wrong',
};
const ESTIMATE_TEXT = 'Estimates are agreed ranges of working time (a day is 8 hours), not time spent waiting for others. Tasks marked "Not estimated", such as the site owner\'s decisions and approvals, are left out of the totals.';
const NOT_ESTIMATED = 'Not estimated';

// Days to the half day, hours to the quarter hour. An agreed amount below that never prints as 0: it keeps its own
// value, to the twentieth (0.1 hours stays 0.1).
const round = (n, unit) => {
  const r = unit === 'hours' ? Math.round(n * 4) / 4 : Math.round(n * 2) / 2;
  return n > 0 && r === 0 ? Math.max(Math.round(n * 20) / 20, 0.05) : r;
};
const num = (n, unit) => String(round(n, unit));
function range(min, max, unit) {
  const one = unit === 'hours' ? 'hour' : 'day';
  const [a, b] = [num(min, unit), num(max, unit)];
  return a === b ? `${a} ${a === '1' ? one : `${one}s`}` : `${a}–${b} ${one}s`;
}
// Under a day of work, all estimated in hours, reads better in hours.
const daysOf = (tasks) => {
  const est = tasks.filter((x) => x.estimate);
  const hours = (k) => est.reduce((n, x) => n + x.estimate[k], 0);
  if (est.length && est.every((x) => x.estimate.unit === 'hours') && hours('max') < 8) return range(hours('min'), hours('max'), 'hours');
  const t = totalDays(tasks);
  return t.max ? range(t.min, t.max, 'days') : '—';
};
export const estimateText = (e) => (e ? range(e.min, e.max, e.unit) : '—');
// A sum of estimates in hours when all are in hours, otherwise in days.
export const sumOf = (items) => {
  const est = items.filter((x) => x.estimate);
  if (!est.length) return '—';
  if (est.every((x) => x.estimate.unit === 'hours')) return range(est.reduce((n, x) => n + x.estimate.min, 0), est.reduce((n, x) => n + x.estimate.max, 0), 'hours');
  return daysOf(est);
};

// The routes of the options side by side, row by row, with each route's total, so the choice is easy to weigh and
// stays on record after it is made. The view says what a cell and a total show: people and hours in the roadmap,
// effort in the owner's plan.
function routesTable(s, view) {
  const routes = s.options.filter((o) => (o.steps ?? []).length || s.tasks.some((t) => t.route === o.name));
  if (routes.length < 2) return '';
  // One row per step, in the order of each route: a step only one route has sits right after the step before it.
  const steps = [];
  for (const o of routes) {
    let at = -1;
    for (const st of o.steps ?? []) {
      const found = steps.indexOf(st.step);
      if (found >= 0) at = found;
      else steps.splice(++at, 0, st.step);
    }
  }
  const cell = (st) => {
    if (!st) return '<td class="route"><p class="why">Not needed</p></td>';
    const who = view.routeCell(st);
    return `<td class="route">${who ? `<b>${esc(who)}</b>` : ''}${st.note ? `<p>${esc(st.note)}</p>` : ''}</td>`;
  };
  const rows = steps.map((step) => `<tr><td><strong>${esc(step)}</strong></td>${routes.map((o) => cell((o.steps ?? []).find((st) => st.step === step))).join('')}</tr>`).join('');
  const byRoute = new Map(routeTasks(s).map((r) => [r.route, r.tasks]));
  return `<h4 class="rm-h">Routes compared</h4><p class="route-summary">${routes.map((o) => `<b>${esc(o.name)}</b>: ${esc(o.summary)}`).join('<br>')}</p><table class="plan-table routes"><thead><tr><th></th>${routes.map((o) => `<th${o.name === s.chosen ? ' class="recommended"' : ''}>${esc(o.name)}${o.name === s.chosen ? ' <span class="pill">Chosen</span>' : ''}</th>`).join('')}</tr></thead>`
    + `<tbody>${rows}<tr class="route-total"><td><strong>${esc(view.totalLabel)}</strong></td>${routes.map((o) => `<td class="route"><b>${view.routeTotal(o, byRoute.get(o.name) ?? o.steps ?? [])}</b></td>`).join('')}</tr>`
    + `<tr><td><strong>Advantages</strong></td>${routes.map((o) => `<td class="route">${list(o.pros ?? [], 'pros')}</td>`).join('')}</tr>`
    + `<tr><td><strong>Drawbacks</strong></td>${routes.map((o) => `<td class="route">${list(o.cons ?? [], 'cons')}</td>`).join('')}</tr></tbody></table>`;
}

// What the roadmap shows for a task: who does it and the agreed estimate.
export function roadmapView(knowledge) {
  const name = (n) => findPerson(knowledge, n ?? '')?.name ?? n;
  return {
    taskHead: ['Who', 'Estimate'],
    totalLabel: 'Total',
    routeCell: (st) => [whoOf(knowledge, st), st.estimate ? range(st.estimate.min, st.estimate.max, st.estimate.unit) : st.assignee && findPerson(knowledge, st.assignee)?.notEstimated ? NOT_ESTIMATED : ''].filter(Boolean).join(' · '),
    routeTotal: (o, items) => {
      const est = items.filter((x) => x.estimate);
      const people = [...new Set(est.map((x) => name(x.assignee) ?? 'Unassigned'))];
      return esc(people.map((p) => `${p} ${sumOf(est.filter((x) => (name(x.assignee) ?? 'Unassigned') === p))}`).join(' · ') || '—');
    },
    whoCell: (t) => `<p>${esc(whoOf(knowledge, t))}</p>`,
    sizeCell: (t) => `<b>${esc(estimateOf(knowledge, t))}</b>${t.sizeNote ? `<p>${esc(t.sizeNote)}</p>` : ''}`,
    cardMeta: (t) => esc(`${whoOf(knowledge, t)} · ${estimateOf(knowledge, t)}`),
    label: (s) => s.id,
    meta: (s, roadmap) => {
      const byId = new Map(roadmap.solutions.map((x) => [x.id, x]));
      const owner = name(s.owner);
      const deps = (s.dependsOn ?? []).map((d) => (byId.get(d)?.title ? `${d}: ${byId.get(d).title}` : d));
      return [`Owner: ${owner}`, routeTasks(s).length ? `Estimate: ${routeTasks(s).map((r) => `${r.route} ${daysOf(r.tasks)}`).join('; ')}` : `Estimate: ${daysOf(s.tasks)}`, deps.length && `After ${deps.join('; ')}`].filter(Boolean).map(esc).join(' · ');
    },
    resolve: (f) => `<li>${f.kind === 'tooling' ? '<span class="tag">AI tool</span>' : badge(f.severity)} <b>${esc(f.id)}</b> ${esc(f.title)}${f.verified ? '' : ' <span class="tag tag-check">Check first</span>'}</li>`,
    choice: (s) => (s.chosen
      ? `<div class="because"><h4>Why “${esc(s.chosen)}”</h4><p>${esc(s.rationale ?? '')}</p></div>`
      : `<div class="because"><h4>${s.choiceBy ? `${esc(name(s.choiceBy))} chooses the route` : 'Route not chosen yet'}</h4><p>${esc(s.rationale ?? 'The routes are kept side by side until the choice is made.')}</p></div>`),
    side: (s) => [
      (s.needs ?? []).length && `<h4>Needs from others</h4>${list(s.needs, 'needs')}`,
      (s.risks ?? []).length && `<h4>Risks</h4>${list(s.risks, 'costs')}`,
    ].filter(Boolean).join(''),
    notesTitle: 'Agreed in planning',
  };
}

const whoOf = (knowledge, t) => [t.assignee, ...(t.orAssignees ?? [])].filter(Boolean).map((n) => findPerson(knowledge, n)?.name ?? n).join(' or ');

const estimateOf = (knowledge, t) => (t.estimate ? range(t.estimate.min, t.estimate.max, t.estimate.unit) : findPerson(knowledge, t.assignee ?? '')?.notEstimated ? NOT_ESTIMATED : '—');

// The points a task settles, such as what a policy must say: what each needs and why it matters. It is a block of its
// own after the table the task sits in, since a table nested in a table row breaks badly across pages.
function checklist(t) {
  if (!(t.checklist ?? []).length) return '';
  return `<div class="checklist-block"><p class="cl-title">Points to settle in step ${esc(t.id)}</p><table class="checklist"><thead><tr><th>Point</th><th>What is needed</th><th>Why</th></tr></thead><tbody>`
    + t.checklist.map((c, i) => `<tr><td><b>${i + 1}.</b> ${esc(c.point)}</td><td>${esc(c.needs ?? '—')}</td><td>${esc(c.why ?? '')}</td></tr>`).join('')
    + '</tbody></table></div>';
}

// With routes, the tasks read as a flow: what every route does first, then the routes side by side as alternatives,
// then what follows whichever route is taken. A common task comes after the fork when it waits, directly or through
// other tasks, for a task of a route.
// The tasks in the order they are shown: those every route shares and that wait for no route task, then each route's
// own, then the shared ones that wait, directly or through other tasks, for a route task.
export function flowParts(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const waits = (t, seen = new Set()) => (t.after ?? []).some((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    const d = byId.get(id);
    return Boolean(d && (d.route || waits(d, seen)));
  });
  const common = tasks.filter((t) => !t.route);
  const routes = [...new Set(tasks.map((t) => t.route).filter(Boolean))];
  return { before: common.filter((t) => !waits(t)), routes: routes.map((r) => [r, tasks.filter((t) => t.route === r)]), after: common.filter((t) => waits(t)) };
}

function tasksSection(s, view, taskRow) {
  const routes = routeTasks(s).map((r) => r.route);
  const head = `<thead><tr><th class="n"></th><th>${esc(view.taskLabel ?? 'Task')}</th>${view.taskHead.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>`;
  // The table of tasks pauses after a task with a checklist, shows the checklist, and goes on with its head again: a
  // table that starts low on a page and runs onto the next one repeats only the head it has.
  const table = (list) => {
    let out = '';
    let rows = [];
    let first = true;
    const flush = () => {
      if (!rows.length) return;
      out += `<table class="plan-table task-table${view.tableClass ? ` ${view.tableClass}` : ''}${first ? '' : ' cont'}">${head}<tbody>${rows.join('')}</tbody></table>`;
      first = false;
      rows = [];
    };
    for (const t of list) {
      rows.push(taskRow(t));
      if ((t.checklist ?? []).length) { flush(); out += checklist(t); }
    }
    flush();
    return out;
  };
  if (!routes.length) return table(s.tasks);
  const { before, after } = flowParts(s.tasks);
  const card = (t) => `<div class="fork-task ${t.kind}"><p class="fork-head"><span class="n">${esc(t.id)}</span> <strong>${esc(t.title)}</strong></p>`
    + `<p class="fork-who">${view.cardMeta(t)}</p><p>${esc(t.detail)}</p></div>`;
  const heads = routes.map((r) => `<th${r === s.chosen ? ' class="recommended"' : ''}>${esc(r)}${r === s.chosen ? ' <span class="pill">Chosen</span>' : ''}</th>`).join('');
  const fork = `<table class="plan-table fork"><thead><tr>${heads}</tr></thead><tbody><tr>${routes.map((r) => `<td>${s.tasks.filter((t) => t.route === r).map(card).join('')}</td>`).join('')}</tr></tbody></table>`;
  let n = 0;
  return (before.length ? `<p class="flow-step"><b>${++n}. Both routes</b></p>${table(before)}` : '')
    + `<p class="flow-step"><b>${++n}. Then one route: ${routes.map(esc).join(' or ')}</b>${s.chosen ? '' : ' <span class="why">only the chosen route is done</span>'}</p>${fork}${s.tasks.filter((t) => t.route).map(checklist).join('')}`
    + (after.length ? `<p class="flow-step"><b>${++n}. Then, whichever route was taken</b></p>${table(after)}` : '');
}

const paragraphs = (text) => String(text).split(/\n\s*\n/).map((p) => `<p>${esc(p.trim())}</p>`).join('');

function stat(n, label) {
  return `<span class="count"><b>${esc(String(n))}</b> ${esc(label)}</span>`;
}

function glance(roadmap, doc, phases, preview) {
  const tasks = roadmap.solutions.flatMap(activeTasks);
  const set = (backlog) => roadmap.declined.filter((x) => (x.resolution === 'backlog') === backlog).reduce((n, x) => n + x.findingIds.length, 0);
  const [backlog, discarded] = [set(true), set(false)];
  const planned = roadmap.solutions.reduce((n, s) => n + s.findingIds.filter((id) => doc.byId.get(id)?.kind !== 'tooling').length, 0);
  const counts = `<p class="counts">${stat(planned, 'problems planned')}${stat(roadmap.solutions.length, 'solutions')}${stat(tasks.length, 'tasks')}${backlog ? stat(backlog, 'in the backlog') : ''}${discarded ? stat(discarded, 'discarded, with reasons') : ''}${stat(daysOf(tasks), roadmap.solutions.some((s) => !s.chosen && routeTasks(s).length) ? 'in total, on the costlier route' : 'in total')}</p>`;
  const items = phases.map((p, i) => {
    const own = roadmap.solutions.filter((s) => s.phase === p.id);
    return `<li><span class="stage-n">Phase ${i + 1}</span><strong>${esc(p.title)}</strong><p>${esc(p.goal)}</p>`
      + `<p class="meta">${own.length} ${own.length === 1 ? 'solution' : 'solutions'} · ${esc(daysOf(own.flatMap(activeTasks)))}</p></li>`;
  }).join('');
  const guide = `<div class="guide"><h2>How to read this roadmap</h2>`
    + '<p>Each solution says which problems it fixes, how, who does each task and why, and how to tell it is done.</p>'
    + `<p class="key-line"><span class="step-kind step-check">Check</span> Confirms a problem before the work on it starts.</p>`
    + `<p class="key-line">${esc(ESTIMATE_TEXT)}</p>`
    + '</div>';
  // The guide opens the second page, right above the first section: on the first page it is cut or pushed off alone.
  return `<section class="glance roadmap-glance"><p class="verdict">${esc(roadmap.summary ?? (preview ? 'Draft preview: the planning discussion is still going on, so this shows only what has been planned so far.' : ''))}</p>${counts}<ol class="stage-list">${items}</ol></section><section class="guide-page lead-in">${guide}</section>`;
}

function teamSection(roadmap, knowledge) {
  const tasks = roadmap.solutions.flatMap((s) => activeTasks(s).map((t) => ({ ...t, solution: s })));
  const names = [...new Set([...roadmap.solutions.map((s) => s.owner), ...tasks.map((t) => t.assignee)].filter(Boolean).map((n) => findPerson(knowledge, n)?.name ?? n))];
  const rows = names.map((name) => {
    const p = findPerson(knowledge, name);
    const owns = roadmap.solutions.filter((s) => s.owner && findPerson(knowledge, s.owner)?.name === name).map((s) => s.id);
    const mine = tasks.filter((t) => t.assignee && findPerson(knowledge, t.assignee)?.name === name);
    return `<tr><td><strong>${esc(name)}</strong><span class="why">${esc(p?.role ?? '')}${p?.availability ? ` · ${esc(p.availability)}` : ''}</span></td>`
      + `<td>${esc(owns.join(', ') || '—')}</td><td class="num">${mine.length}</td><td class="num">${esc(p?.notEstimated && !mine.some((t) => t.estimate) ? NOT_ESTIMATED : daysOf(mine))}</td></tr>`;
  }).join('');
  return `<section class="rm-team"><h2>People and workload</h2><p class="lead">Who owns each solution and how much of the estimated work each person carries.</p>`
    + `<table class="issues"><thead><tr><th>Person</th><th>Owns</th><th class="num">Tasks</th><th class="num">Estimate</th></tr></thead><tbody>${rows}</tbody></table>`
    + '</section>';
}

// One fix plan: the problem and what it resolves, the routes or options, the approach, the steps and how to tell it is
// done. The view decides what the roadmap and the owner's plan each show about people, time and effort.
export function solutionCard(s, roadmap, doc, view) {
  const meta = view.meta(s, roadmap);
  const resolves = s.findingIds.map((id) => doc.byId.get(id)).filter(Boolean).map(view.resolve).join('');
  const routes = routesTable(s, view);
  const options = s.options.map((o) => `<tr${o.name === s.chosen ? ' class="recommended"' : ''}><td class="opt"><strong>${esc(o.name)}</strong>${o.name === s.chosen ? ' <span class="pill">Chosen</span>' : ''}<p>${esc(o.summary)}</p></td><td>${list(o.pros ?? [], 'pros')}</td><td>${list(o.cons ?? [], 'cons')}</td></tr>`).join('');
  const taskRow = (t) => {
    const kind = t.kind === 'check' ? '<span class="step-kind step-check">Check</span>' : '<span class="step-kind step-work">Work</span>';
    const files = (t.files ?? []).length ? `<p class="files">${t.files.map((f) => `<code>${esc(f).replaceAll('/', '/<wbr>')}</code>`).join(' ')}</p>` : '';
    const after = (t.after ?? []).length ? `<p class="after">After ${esc(t.after.join(', '))}</p>` : '';
    return `<tr class="${t.kind}"><td class="n">${esc(t.id)}</td><td>${kind}${t.route ? `<span class="tag">${esc(t.route)} only</span> ` : ''}<strong>${esc(t.title)}</strong><p>${esc(t.detail)}</p>${files}${after}</td>`
      + `<td class="who">${view.whoCell(t)}</td>`
      + `<td class="effort-cell">${view.sizeCell(t)}</td></tr>`;
  };
  const side = view.side(s);
  return `<article class="solution"><div class="d-top"><header class="d-head"><span class="sid">${esc(view.label(s))}</span><div><h3>${esc(s.title)}${s.status === 'draft' ? ' <span class="tag tag-check">Draft</span>' : ''}</h3><p class="d-meta">${meta}</p></div></header>`
    + `<div class="split"><div class="panel panel-found"><h4>The problem</h4><p>${esc(s.problem)}</p></div><div class="panel"><h4>Resolves</h4><ul class="resolves">${resolves}</ul></div></div></div>`
    + (routes || (s.options.length ? `<table class="options"><thead><tr><th>Options considered</th><th>Advantages</th><th>Drawbacks</th></tr></thead><tbody>${options}</tbody></table>` : ''))
    + view.choice(s)
    + `<h4 class="rm-h">Approach</h4><div class="approach">${paragraphs(s.approach)}</div>`
    + `<h4 class="rm-h">${esc(view.tasksTitle ?? 'Tasks')}</h4>${tasksSection(s, view, taskRow)}`
    + `<div class="${side ? 'split ' : ''}rm-done"><div><h4>Done when</h4><ul class="criteria">${s.acceptanceCriteria.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>${side ? `<div>${side}</div>` : ''}</div>`
    + ((s.notes ?? []).length ? `<h4 class="rm-h">${esc(view.notesTitle)}</h4>${list(s.notes)}` : '')
    + '</article>';
}

function phaseSection(p, i, roadmap, doc, view) {
  const own = roadmap.solutions.filter((s) => s.phase === p.id);
  return `<section class="rm-phase"><h2><span class="stage-n">Phase ${i + 1}</span>${esc(p.title)}</h2><p class="lead">${esc(p.goal)} Estimate: ${esc(daysOf(own.flatMap(activeTasks)))}.</p>`
    + own.map((s) => solutionCard(s, roadmap, doc, view)).join('') + '</section>';
}

// Problems moved to the backlog are for later; discarded ones will not be worked on. Both say why.
function declinedSection(roadmap, doc) {
  const table = (entries, extra) => `<table class="issues"><thead><tr><th>Problems</th><th>${extra ? 'When to look again' : 'Decision'}</th><th>Reason</th></tr></thead><tbody>`
    + entries.map((x) => `<tr><td><span class="tag">${esc(x.id)}</span>${x.findingIds.map((id) => `<span class="dl-item"><b>${esc(id)}</b> ${esc(doc.byId.get(id)?.title ?? '')}</span>`).join('')}</td><td>${esc(extra ? x.revisit ?? '—' : RESOLUTION[x.resolution])}</td><td>${esc(x.reason)}</td></tr>`).join('')
    + '</tbody></table>';
  const backlog = roadmap.declined.filter((x) => x.resolution === 'backlog');
  const discarded = roadmap.declined.filter((x) => x.resolution !== 'backlog');
  return (backlog.length ? `<section class="rm-declined"><h2>Moved to the backlog</h2><p class="lead">Problems the team will fix later, outside this roadmap, and why they wait.</p>${table(backlog, true)}</section>` : '')
    + (discarded.length ? `<section class="rm-declined"><h2>Discarded, with reasons</h2><p class="lead">Problems the people running the project decided not to work on, and why.</p>${table(discarded, false)}</section>` : '');
}

// A preview lists the questions still open, those about the solutions shown when only some are rendered. A finished
// roadmap has none.
function questionsSection(roadmap, only) {
  const shown = new Set(roadmap.solutions.flatMap((s) => s.findingIds));
  const open = (roadmap.questions ?? []).filter((q) => q.status === 'open' && (!only || (q.findingIds ?? []).some((id) => shown.has(id))));
  if (!open.length) return '';
  return `<section class="rm-declined"><h2>Open questions</h2><p class="lead">Still to settle before the roadmap is final.</p><table class="issues"><thead><tr><th>Question</th><th>For</th></tr></thead><tbody>`
    + open.map((q) => `<tr><td><b>${esc(q.id)}</b> ${esc(q.text)}</td><td>${esc(q.askedOf ?? '—')}</td></tr>`).join('')
    + '</tbody></table></section>';
}

// Every problem the run found and where the roadmap deals with it, so nothing is lost between the check and the work.
function traceSection(roadmap, doc, only) {
  const where = new Map();
  for (const s of roadmap.solutions) for (const id of s.findingIds) where.set(id, `${s.id} · ${s.title}`);
  for (const x of roadmap.declined) for (const id of x.findingIds) where.set(id, `${RESOLUTION[x.resolution]} (${x.id})`);
  const issues = doc.findings.filter((f) => f.kind !== 'tooling' && (!only || where.has(f.id)));
  // One heading and table per area: a heading stays with its first rows, where a heading row in one long table could be
  // left alone at the foot of a page.
  const areas = AREAS.filter((a) => issues.some((f) => f.area === a)).map((a) => `<h3 class="rm-area-h">${esc(AREA_TITLES[a])}</h3>`
    + `<table class="issues trace"><thead><tr><th></th><th>Problem</th><th>Planned in</th></tr></thead><tbody>`
    + issues.filter((f) => f.area === a).map((f) => `<tr><td class="sev">${badge(f.severity)}</td><td><b>${esc(f.id)}</b> ${esc(f.title)}</td><td>${esc(where.get(f.id) ?? '')}</td></tr>`).join('')
    + '</tbody></table>').join('');
  return `<section class="rm-trace"><h2>Every problem and its plan</h2><p class="lead">${only ? `The ${issues.length} problems of the solutions shown` : `All ${issues.length} problems`} from health check run ${esc(doc.run)}, by area.</p>${areas}</section>`;
}

// `preview` renders a roadmap still being planned, labelled as a draft; `only` says it holds some solutions only.
export function buildRoadmapHtml({ doc, profile, roadmap: given, knowledge, template, css, logoSrc, generatedAt = new Date(), preview = false, only = false }) {
  // A draft in a preview may still lack most of its parts.
  const roadmap = { ...given, solutions: given.solutions.map((s) => ({ problem: '', approach: '', options: [], tasks: [], acceptanceCriteria: [], ...s })) };
  const d = { ...doc, byId: new Map(doc.findings.map((f) => [f.id, f])) };
  const phases = roadmap.phases ?? [];
  const view = roadmapView(knowledge);
  const unphased = roadmap.solutions.filter((s) => !phases.some((p) => p.id === s.phase));
  const body = glance(roadmap, d, phases, preview)
    + teamSection(roadmap, knowledge)
    + phases.map((p, i) => phaseSection(p, i, roadmap, d, view)).join('')
    + (unphased.length ? `<section class="rm-phase"><h2>Not yet in a phase</h2><p class="lead">Solutions that are not placed in a phase yet.</p>${unphased.map((s) => solutionCard(s, roadmap, d, view)).join('')}</section>` : '')
    + (preview ? questionsSection(roadmap, only) : '')
    + declinedSection(roadmap, d)
    + (only ? '' : traceSection(roadmap, d, only))
    + `<p class="meta rm-foot">Planned from health check run ${esc(doc.run)}; generated ${esc(generatedAt.toISOString().slice(0, 16).replace('T', ' '))} UTC.</p>`;
  // The cover carries the day the roadmap was last agreed or changed, not the day it was printed.
  const dated = roadmap.updatedAt ? `Planned ${roadmap.updatedAt}` : null;
  return frame({ doc, profile, template, css, logoSrc, generatedAt, label: preview ? 'Implementation roadmap — draft preview' : 'Implementation roadmap', body, dated });
}
