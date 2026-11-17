import { escapeHtml as esc } from './html.mjs';
import { EFFORT, EFFORT_TEXT, badge, list, effortBadge, effortKey, fixRef, frame } from './report-html.mjs';
import { solutionCard, flowParts } from './roadmap-html.mjs';
import { planFixes, fixFindings, worded, keptIdOf, keptFinding } from './synthesis.mjs';

// "Plan and effort" is written for the site owner, like the report: plain words, no finding ids, and effort levels in
// place of people and hours. Each fix reads like a fix plan of the roadmap: the problem, the routes when there are two
// equal ways forward, the steps in order, and how to tell it is done.
const PLAN_INTRO = 'The plan is a set of fixes in the recommended order, grouped in stages. Each fix says what is wrong, how it is solved step by step, how big each step is and what it needs from you or others, and how to tell it is done. Where two ways forward are equally good, both are shown side by side and you choose.';
const CHECK_TEXT = 'Confirms a problem, usually by looking at the server or an account, before the work it decides is sized.';
const ORDER = ['quick', 'small', 'medium', 'large'];

// The size of a set of steps: the largest one, and whether part of it waits for a check.
function overall(steps) {
  const sized = steps.map((st) => st.effort).filter((e) => ORDER.includes(e));
  const top = sized.sort((a, b) => ORDER.indexOf(b) - ORDER.indexOf(a))[0];
  const later = steps.some((st) => st.effort === 'after-check');
  return { top, later };
}
const overallHtml = ({ top, later }) => [top && effortBadge(top), later && effortBadge('after-check')].filter(Boolean).join(' ');
// The badge of a fix is its largest step; beside it, how many steps there are of each size, so four small steps do not
// read as one.
function stepMix(steps) {
  if (steps.length < 2) return '';
  const mix = [...ORDER, 'after-check'].map((e) => [e, steps.filter((st) => st.effort === e).length]).filter(([, n]) => n)
    .map(([e, n]) => `${n} ${EFFORT[e][0].toLowerCase()}`);
  return ` <span class="why">largest of ${steps.length} steps: ${esc(mix.join(', '))}</span>`;
}

// A fix as the shared card expects it: routes become options with their comparison rows, steps become tasks. Steps are
// numbered in the order the plan shows them (shared steps, then each route's, then what follows), so the numbers read
// 1, 2, 3 down the page whatever order they were written in.
function stepOrder(fx) {
  const { before, routes, after } = flowParts(fx.steps);
  const order = [...before, ...routes.flatMap(([, list]) => list), ...after];
  return { order, numbers: new Map(order.map((st, i) => [st.id, `${fx.n}.${i + 1}`])) };
}

function card(fx, syn) {
  const { order, numbers } = stepOrder(fx);
  const label = (id) => numbers.get(id) ?? id;
  return {
    ...fx,
    // A problem several areas reported is listed once, as the finding kept for it, wherever a copy was planned.
    findingIds: [...new Set(fixFindings(fx, syn).map(keptIdOf(syn)))],
    options: (fx.routes ?? []).map((r) => ({ name: r.name, summary: r.summary, pros: r.pros, cons: r.cons, effort: r.effort, steps: (r.compare ?? []).map((c) => ({ step: c.row, note: c.value })) })),
    tasks: order.map((st) => ({ ...st, id: label(st.id), detail: st.what, after: (st.after ?? []).map(label) })),
    acceptanceCriteria: fx.doneWhen,
  };
}

// What the owner's plan shows where the roadmap shows people and hours.
function planView(syn, fixes) {
  const byFix = new Map(fixes.map((fx) => [fx.id, fx]));
  const decisions = new Map(syn.decisions.map((d, i) => [d.id, `decision ${i + 1}`]));
  return {
    taskLabel: 'Step',
    tableClass: 'plan-steps',
    taskHead: ['Needs from you or others', 'Effort'],
    tasksTitle: 'Steps',
    totalLabel: 'Effort',
    routeCell: () => '',
    routeTotal: (o) => effortBadge(o.effort),
    whoCell: (t) => ((t.needs ?? []).length ? list(t.needs, 'needs') : '<p class="why">—</p>'),
    sizeCell: (t) => `${effortBadge(t.effort)}${t.sizeNote ? `<p>${esc(t.sizeNote)}</p>` : ''}`,
    cardMeta: (t) => `${effortBadge(t.effort)}${(t.needs ?? []).length ? ` <span class="why">Needs: ${esc(t.needs.join('; '))}</span>` : ''}`,
    label: (s) => String(s.n),
    meta: (s) => {
      const effort = (s.routes ?? []).length
        ? `Effort: ${s.routes.map((r) => `${esc(r.name)} ${effortBadge(r.effort)}`).join(' · ')}`
        : `Effort: ${overallHtml(overall(s.steps))}${stepMix(s.steps)}`;
      const carries = (s.covers ?? []).map((id) => decisions.get(id)).filter(Boolean);
      const after = (s.after ?? []).map((id) => byFix.get(id)).filter(Boolean);
      return [effort, carries.length && `Covers ${esc(carries.join(', '))}`, after.length && `After ${esc(fixRef(after))}`].filter(Boolean).join(' · ');
    },
    resolve: (f) => `<li>${f.kind === 'tooling' ? '<span class="tag">AI tool</span>' : badge(f.severity)} ${esc(f.title)}${f.verified ? '' : ' <span class="tag tag-check">Check first</span>'}</li>`,
    choice: (s) => ((s.routes ?? []).length ? `<div class="because"><h4>You choose the route</h4><p>${esc(s.choice ?? '')}</p></div>` : ''),
    side: () => '',
    notesTitle: 'Notes',
  };
}

function glance(syn, fixes) {
  const steps = fixes.flatMap((fx) => fx.steps);
  const choices = fixes.filter((fx) => (fx.routes ?? []).length).length;
  const stat = (n, label) => `<span class="count"><b>${esc(String(n))}</b> ${esc(label)}</span>`;
  const counts = `<p class="counts">${stat(fixes.length, fixes.length === 1 ? 'fix' : 'fixes')}${stat(steps.length, 'steps')}`
    // Steps, not problems: the report counts the problems to check first, and one check can cover several.
    + `${steps.some((st) => st.kind === 'check') ? stat(steps.filter((st) => st.kind === 'check').length, steps.filter((st) => st.kind === 'check').length === 1 ? 'check step first' : 'check steps first') : ''}`
    + `${choices ? stat(choices, choices === 1 ? 'choice for you' : 'choices for you') : ''}</p>`;
  let n = 0;
  const stages = syn.plan.stages.map((stage, i) => {
    const own = fixes.slice(n, n += stage.fixes.length);
    return `<li><span class="stage-n">Stage ${i + 1}</span><strong>${esc(stage.title)}</strong><p>${esc(stage.goal)}</p>`
      + `<p class="meta">${own.length} ${own.length === 1 ? 'fix' : 'fixes'} ${own.map((fx) => overallHtml((fx.routes ?? []).length ? { top: fx.routes.map((r) => r.effort).sort((a, b) => ORDER.indexOf(b) - ORDER.indexOf(a))[0] } : overall(fx.steps))).join(' ')}</p></li>`;
  }).join('');
  const guide = `<div class="guide"><h2>How to read this plan</h2><p>${esc(PLAN_INTRO)}</p>`
    + `<h3>Effort <span class="h-note">compares pieces of work. It is not a time or cost estimate.</span></h3>${effortKey(Object.keys(EFFORT))}`
    + (steps.some((st) => st.kind === 'check') ? `<p class="key-line"><span class="step-kind step-check">Check</span> ${esc(CHECK_TEXT)}</p>` : '')
    + '</div>';
  // The guide opens the second page, right above the first stage: on the first page it is cut or pushed off alone.
  return `<section class="glance plan-glance"><p class="verdict">${esc(syn.plan.summary)}</p>${counts}<ol class="stage-list">${stages}</ol></section><section class="guide-page lead-in">${guide}</section>`;
}

// Everything the work depends on from people outside it, once each, with the steps that need it, numbered as the
// fixes above number them.
function needsSection(fixes) {
  const map = new Map();
  for (const fx of fixes) {
    const { numbers } = stepOrder(fx);
    for (const st of fx.steps) for (const t of st.needs ?? []) {
      const key = t.trim().toLowerCase().replace(/[. ]+$/, '');
      if (!map.has(key)) map.set(key, { text: t.trim(), steps: [] });
      map.get(key).steps.push(numbers.get(st.id));
    }
  }
  const stepRef = (list) => `${list.length === 1 ? 'Step' : 'Steps'} ${list.join(', ')}`;
  if (!map.size) return '';
  return `<section class="plan-needs"><h2>What the work needs from you and others</h2><p class="lead">Access, information and approvals the fixes wait for, so they can be arranged early.</p>`
    + `<table class="plan-index"><thead><tr><th>Access, information or approval</th><th>In the plan</th></tr></thead><tbody>${[...map.values()].map((r) => `<tr><td>${esc(r.text)}</td><td class="refs">${esc(stepRef(r.steps))}</td></tr>`).join('')}</tbody></table></section>`;
}

// The plan as a document of its own: the stages at a glance, then every fix with its steps and effort.
export function buildPlanHtml({ doc, profile, synthesis: syn, template, css, logoSrc, generatedAt = new Date() }) {
  if (!syn?.plan) throw new Error('The synthesis has no plan.');
  const fixes = planFixes(syn);
  const every = new Map(doc.findings.map((f) => [f.id, f]));
  const d = { ...doc, byId: new Map(doc.findings.map((f) => [f.id, worded(keptFinding(f, syn, every), syn)])) };
  const view = planView(syn, fixes);
  const roadmap = { solutions: fixes.map((fx) => card(fx, syn)) };
  let n = 0;
  const stages = syn.plan.stages.map((stage, i) => {
    const own = roadmap.solutions.slice(n, n += stage.fixes.length);
    return `<section class="rm-phase"><h2><span class="stage-n">Stage ${i + 1}</span>${esc(stage.title)}</h2><p class="lead">${esc(stage.goal)}</p>`
      + own.map((s) => solutionCard(s, roadmap, d, view)).join('') + '</section>';
  }).join('');
  const body = glance(syn, fixes) + stages + needsSection(fixes) + `<p class="meta rm-foot">${esc(EFFORT_TEXT)}</p>`;
  return frame({ doc, profile, template, css, logoSrc, generatedAt, label: 'Plan and effort', body });
}
