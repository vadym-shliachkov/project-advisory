import { loadSchema, validate } from './schema.mjs';
import { scanText } from './secrets.mjs';
import { AREAS, AREA_TITLES, SEVERITY_RANK } from './areas.mjs';
import { today } from './kb.mjs';
import { findPerson } from './knowledge.mjs';

// The roadmap plans every problem a run found that the reviewer did not dismiss, ticked for the report or not.
export function trackedIssues(doc) {
  return doc.findings.filter((f) => f.kind !== 'tooling');
}

export function emptyRoadmap(run) {
  return { run, solutions: [], declined: [] };
}

// A save carries only what changed. Solutions, declined entries and questions are merged field by field into the
// entry with the same id, so a draft saved again with one more problem keeps its tasks; a field sent as null is
// cleared. `remove` drops ids, and context, summary and phases replace what was there. The discussion need not be
// linear: a problem saved into one entry leaves whichever other entry held it, and an entry left with no problems is
// dropped. Returns the new roadmap and what moved, so the facilitator can tell the person.
export const PATCH_KEYS = ['solutions', 'declined', 'questions', 'remove', 'context', 'summary', 'phases'];

// What is wrong with the shape of a save before it is merged: unknown top-level keys (a misspelt key would otherwise
// save nothing and still say ok), lists that are not lists, and entries without an id.
export function patchErrors(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return ['the save must be a JSON object such as { "solutions": [ … ] }'];
  const errors = Object.keys(patch).filter((k) => !PATCH_KEYS.includes(k) && k !== 'run' && k !== 'updatedAt')
    .map((k) => `$.${k}: unknown key, so nothing would be saved; a save holds ${PATCH_KEYS.join(', ')}`);
  for (const key of ['solutions', 'declined', 'questions', 'remove']) {
    if (!(key in patch)) continue;
    if (!Array.isArray(patch[key])) { errors.push(`$.${key}: must be a list`); continue; }
    if (key === 'remove') continue;
    patch[key].forEach((x, i) => {
      if (!x || typeof x !== 'object' || Array.isArray(x)) errors.push(`$.${key}[${i}]: must be an object`);
      else if (typeof x.id !== 'string' || !x.id) errors.push(`$.${key}[${i}].id: every entry needs its id`);
      else if (x.findingIds != null && !Array.isArray(x.findingIds)) errors.push(`$.${key}[${i}].findingIds: must be a list`);
    });
  }
  return errors;
}

const mergeFields = (old, item) => {
  const out = { ...(old ?? {}), ...item };
  for (const [k, v] of Object.entries(item)) if (v === null) delete out[k];
  return out;
};

export function mergeRoadmap(current, patch) {
  const next = { ...current, solutions: [...current.solutions], declined: [...current.declined], questions: [...(current.questions ?? [])] };
  const moved = [];
  const dropped = [];
  const incoming = [...(patch.solutions ?? []), ...(patch.declined ?? [])];
  const patched = new Set(incoming.map((x) => x.id));
  const claimed = new Map(incoming.flatMap((x) => (Array.isArray(x.findingIds) ? x.findingIds : []).map((id) => [id, x.id])));
  // An entry being saved keeps its place even when it loses problems: the save merges into it next.
  const release = (list) => list.flatMap((x) => {
    const lost = x.findingIds.filter((id) => claimed.has(id) && claimed.get(id) !== x.id);
    if (!lost.length) return [x];
    for (const id of lost) moved.push({ finding: id, from: x.id, to: claimed.get(id) });
    const kept = x.findingIds.filter((id) => !lost.includes(id));
    if (!kept.length && !patched.has(x.id)) { dropped.push(x.id); return []; }
    return [{ ...x, findingIds: kept }];
  });
  next.solutions = release(next.solutions);
  next.declined = release(next.declined);
  const upsert = (list, items, stamp) => {
    for (const item of items ?? []) {
      const at = list.findIndex((x) => x.id === item.id);
      const old = at >= 0 ? list[at] : null;
      const value = stamp(mergeFields(old, item), item, old);
      if (at >= 0) list[at] = value;
      else list.push(value);
    }
  };
  upsert(next.solutions, patch.solutions, (s, sent, old) => {
    const { agreedAt, ...rest } = s;
    return s.status === 'agreed' ? { ...rest, agreedAt: sent.agreedAt ?? (old?.status === 'agreed' ? old.agreedAt : null) ?? today() } : rest;
  });
  upsert(next.declined, patch.declined, (x) => ({ ...x, decidedAt: x.decidedAt ?? today() }));
  upsert(next.questions, patch.questions, (q) => ({ ...q, raisedAt: q.raisedAt ?? today() }));
  const drop = new Set(patch.remove ?? []);
  next.solutions = next.solutions.filter((s) => !drop.has(s.id));
  next.declined = next.declined.filter((x) => !drop.has(x.id));
  next.questions = next.questions.filter((q) => !drop.has(q.id));
  if (!next.questions.length) delete next.questions;
  for (const key of ['context', 'summary', 'phases']) if (key in patch) next[key] = patch[key];
  next.updatedAt = today();
  // A list sent shorter than it was lets problems go: say which are now planned nowhere, as moves are said.
  const planned = new Set([...next.solutions, ...next.declined].flatMap((x) => x.findingIds ?? []));
  const released = [...current.solutions, ...current.declined]
    .filter((x) => incoming.some((s) => s.id === x.id && Array.isArray(s.findingIds)) || drop.has(x.id))
    .flatMap((x) => (x.findingIds ?? []).filter((id) => !planned.has(id)).map((finding) => ({ finding, from: x.id })));
  // An entry this save updates but whose every problem another entry took would be kept empty.
  const emptied = [...next.solutions, ...next.declined].filter((x) => patched.has(x.id) && !drop.has(x.id) && Array.isArray(x.findingIds) && !x.findingIds.length).map((x) => x.id);
  return { roadmap: next, moved, dropped, released, emptied };
}

function strings(value, at, out = []) {
  if (typeof value === 'string') out.push([at, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${at}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) strings(v, `${at}.${k}`, out);
  return out;
}

// Dependencies must form a chain that can be worked through: no solution waits, through others, for itself.
function cycle(solutions) {
  const deps = new Map(solutions.map((s) => [s.id, (s.dependsOn ?? []).filter((d) => d !== s.id)]));
  const state = new Map();
  const visit = (id, trail) => {
    if (state.get(id) === 'done') return null;
    if (state.get(id) === 'open') return [...trail.slice(trail.indexOf(id)), id];
    state.set(id, 'open');
    for (const d of deps.get(id) ?? []) {
      if (!deps.has(d)) continue;
      const found = visit(d, [...trail, id]);
      if (found) return found;
    }
    state.set(id, 'done');
    return null;
  };
  for (const id of deps.keys()) {
    const found = visit(id, []);
    if (found) return found;
  }
  return null;
}

const HOURS_PER_DAY = 8;
const inDays = (e) => (e.unit === 'hours' ? { min: e.min / HOURS_PER_DAY, max: e.max / HOURS_PER_DAY } : { min: e.min, max: e.max });

// The estimate of a set of tasks in days, as a range. Tasks without an estimate are counted in `missing`.
export function totalDays(tasks) {
  let min = 0;
  let max = 0;
  let missing = 0;
  for (const t of tasks) {
    if (!t.estimate) { missing += 1; continue; }
    const d = inDays(t.estimate);
    min += d.min;
    max += d.max;
  }
  return { min, max, missing };
}

// A task with a `route` belongs to that option only; the others are common to every route. Each route's tasks are the
// common ones plus its own.
export function routeTasks(s) {
  const tasks = s.tasks ?? [];
  const named = [...new Set(tasks.map((t) => t.route).filter(Boolean))];
  return named.map((route) => ({ route, tasks: tasks.filter((t) => !t.route || t.route === route) }));
}

// The tasks that count towards totals: those of the chosen route, or of the costliest route while none is chosen.
export function activeTasks(s) {
  const routes = routeTasks(s);
  if (!routes.length) return s.tasks ?? [];
  const pick = routes.find((r) => r.route === s.chosen) ?? routes.reduce((a, b) => (totalDays(b.tasks).max > totalDays(a.tasks).max ? b : a));
  return pick.tasks;
}

// A task needs an estimate unless its person was agreed to work without one, such as a site owner who decides and approves.
export const needsEstimate = (knowledge, t) => !findPerson(knowledge, t.assignee ?? '')?.notEstimated;

const AGREED_FIELDS =['problem', 'options', 'chosen', 'rationale', 'approach', 'tasks', 'acceptanceCriteria'];
export const openQuestions = (roadmap) => (roadmap.questions ?? []).filter((q) => q.status === 'open');

const NO_PEOPLE ='Declare the available people first: name, role, skills and availability of everyone who can work on the fixes (knowledge-save)';

// `final` adds what must be true before the roadmap is rendered: every problem planned or declined, every solution
// agreed, placed in a phase and given an owner, every task an assignee and an estimate (unless its person is marked
// notEstimated), and a summary.
// `knowledge` holds the people that owners and assignees must be.
export function validateRoadmap(roadmap, doc, { final = false, knowledge = { people: [], notes: [] } } = {}) {
  const errors = validate(loadSchema('roadmap'), roadmap);
  if (errors.length) return { errors, warnings: [] };
  const warnings = [];
  const byId = new Map(doc.findings.map((f) => [f.id, f]));
  const owner = new Map();
  const claim = (ids, at, holder) => {
    for (const id of ids) {
      if (!byId.has(id)) { errors.push(`${at}: unknown finding ${id} (or it was dismissed in the checklist)`); continue; }
      if (owner.has(id)) errors.push(`${at}: ${id} is already planned in ${owner.get(id)} — each problem has one solution or one reason`);
      else owner.set(id, holder);
    }
  };
  const person = (name, at) => {
    if (name && !findPerson(knowledge, name)) errors.push(`${at}: "${name}" is not one of the people in the project knowledge — add them there first`);
  };
  if (roadmap.solutions.length && !knowledge.people.length) errors.push(NO_PEOPLE);
  const ids = new Set();
  const phases = new Map((roadmap.phases ?? []).map((p, i) => [p.id, i]));
  if (phases.size !== (roadmap.phases ?? []).length) errors.push('$.phases: duplicate phase id');

  roadmap.solutions.forEach((s, i) => {
    const at = `$.solutions[${i}]`;
    if (ids.has(s.id)) errors.push(`${at}.id: duplicate id ${s.id}`);
    ids.add(s.id);
    claim(s.findingIds, `${at}.findingIds`, s.id);
    if (s.chosen && !(s.options ?? []).some((o) => o.name === s.chosen)) errors.push(`${at}.chosen: "${s.chosen}" is not one of the options`);
    (s.options ?? []).forEach((o, j) => {
      const names = new Set();
      (o.steps ?? []).forEach((st, k) => {
        const sat = `${at}.options[${j}].steps[${k}]`;
        if (names.has(st.step)) errors.push(`${sat}.step: "${st.step}" appears twice in "${o.name}"`);
        names.add(st.step);
        person(st.assignee, `${sat}.assignee`);
        (st.orAssignees ?? []).forEach((n, m) => person(n, `${sat}.orAssignees[${m}]`));
        if (st.estimate && !(st.estimate.min > 0 && st.estimate.max >= st.estimate.min)) errors.push(`${sat}.estimate: min must be above 0 and max at least min`);
      });
    });
    if (s.phase && !phases.has(s.phase)) errors.push(`${at}.phase: no phase ${s.phase}`);
    // A draft captures a decision the moment it is made; an agreed fix plan is complete enough for a developer to start,
    // and says who does it and how long it takes.
    const agreed = s.status === 'agreed';
    // A plan may be agreed with its routes kept open when it names who chooses between them.
    const routed = (s.options ?? []).filter((o) => (o.steps ?? []).length || (s.tasks ?? []).some((t) => t.route === o.name)).length > 1;
    if (s.choiceBy && !routed) errors.push(`${at}.choiceBy: only a plan with two or more routes leaves the choice to someone`);
    person(s.choiceBy, `${at}.choiceBy`);
    const missing = AGREED_FIELDS.filter((k) => !(k === 'chosen' && s.choiceBy && routed) && !(Array.isArray(s[k]) ? s[k].length : s[k]));
    if (agreed && missing.length) errors.push(`${at}: an agreed fix plan needs ${missing.join(', ')} — complete ${s.id}, or keep it as a draft`);
    person(s.owner, `${at}.owner`);
    if (agreed && !s.owner) errors.push(`${at}.owner: an agreed fix plan names who owns ${s.id} — agree it with the person, or save it as a draft`);
    const seen = new Map();
    (s.tasks ?? []).forEach((t, k) => {
      const tat = `${at}.tasks[${k}]`;
      if (!t.id.startsWith(`${s.id}.`)) errors.push(`${tat}.id: task ids of ${s.id} start with "${s.id}."`);
      if (seen.has(t.id)) errors.push(`${tat}.id: duplicate task id ${t.id}`);
      for (const a of t.after ?? []) if (!seen.has(a)) errors.push(`${tat}.after: ${a} is not an earlier task of ${s.id}`);
      person(t.assignee, `${tat}.assignee`);
      (t.orAssignees ?? []).forEach((n, m) => person(n, `${tat}.orAssignees[${m}]`));
      if (t.route && !(s.options ?? []).some((o) => o.name === t.route)) errors.push(`${tat}.route: "${t.route}" is not one of the options of ${s.id}`);
      if (t.estimate && !(t.estimate.min > 0 && t.estimate.max >= t.estimate.min)) errors.push(`${tat}.estimate: min must be above 0 and max at least min`);
      if (agreed && !t.assignee) errors.push(`${tat}.assignee: agree who does ${t.id}, or save ${s.id} as a draft`);
      if (agreed && !t.estimate && needsEstimate(knowledge, t)) errors.push(`${tat}.estimate: agree an estimate for ${t.id}, or save ${s.id} as a draft`);
      seen.set(t.id, t);
    });
    const unverified = s.findingIds.filter((id) => byId.get(id) && byId.get(id).kind !== 'tooling' && !byId.get(id).verified);
    if (unverified.length && (agreed || s.tasks?.length) && !(s.tasks ?? []).some((t) => t.kind === 'check')) {
      (final ? errors : warnings).push(`${at}.tasks: ${unverified.join(', ')} ${unverified.length === 1 ? 'is' : 'are'} not confirmed — start with a check task that confirms it`);
    }
  });
  roadmap.solutions.forEach((s, i) => {
    for (const d of s.dependsOn ?? []) {
      if (d === s.id) errors.push(`$.solutions[${i}].dependsOn: ${s.id} depends on itself`);
      else if (!ids.has(d)) errors.push(`$.solutions[${i}].dependsOn: no solution ${d}`);
    }
  });
  const loop = cycle(roadmap.solutions);
  if (loop) errors.push(`$.solutions: dependencies go in a circle: ${loop.join(' → ')}`);

  roadmap.declined.forEach((x, i) => {
    const at = `$.declined[${i}]`;
    if (ids.has(x.id)) errors.push(`${at}.id: duplicate id ${x.id}`);
    ids.add(x.id);
    claim(x.findingIds, `${at}.findingIds`, x.id);
  });

  (roadmap.questions ?? []).forEach((q, i) => {
    const at = `$.questions[${i}]`;
    if (ids.has(q.id)) errors.push(`${at}.id: duplicate id ${q.id}`);
    ids.add(q.id);
    for (const id of q.findingIds ?? []) if (!byId.has(id)) errors.push(`${at}.findingIds: unknown finding ${id}`);
    if (q.status === 'answered' && !q.answer) errors.push(`${at}.answer: record the answer to ${q.id}`);
  });

  for (const [at, text] of strings(roadmap, '$')) {
    if (scanText(text).length) errors.push(`${at}: contains what looks like a secret`);
  }

  if (final) {
    const open = trackedIssues(doc).filter((f) => !owner.has(f.id));
    if (open.length) errors.push(`${open.length} ${open.length === 1 ? 'problem has no fix plan and is' : 'problems have no fix plan and are'} neither discarded nor moved to the backlog: ${open.map((f) => f.id).join(', ')}`);
    const drafts = roadmap.solutions.filter((s) => s.status !== 'agreed');
    if (drafts.length) errors.push(`${drafts.map((s) => s.id).join(', ')} ${drafts.length === 1 ? 'is' : 'are'} still a draft — agree ${drafts.length === 1 ? 'it' : 'them'} with the person first`);
    const asked = openQuestions(roadmap);
    if (asked.length) errors.push(`${asked.map((q) => q.id).join(', ')} ${asked.length === 1 ? 'is' : 'are'} still an open question — settle or drop ${asked.length === 1 ? 'it' : 'them'} with the person`);
    if (!(roadmap.phases ?? []).length) errors.push('$.phases: put the solutions into phases');
    const unphased = roadmap.solutions.filter((s) => !s.phase);
    if (unphased.length) errors.push(`${unphased.map((s) => s.id).join(', ')} ${unphased.length === 1 ? 'has' : 'have'} no phase`);
    const phaseOf = new Map(roadmap.solutions.map((s) => [s.id, phases.get(s.phase)]));
    for (const s of roadmap.solutions) {
      for (const d of s.dependsOn ?? []) {
        if (phaseOf.get(d) != null && phaseOf.get(s.id) != null && phaseOf.get(d) > phaseOf.get(s.id)) errors.push(`${s.id} depends on ${d}, which comes in a later phase`);
      }
    }
    for (const p of roadmap.phases ?? []) if (!roadmap.solutions.some((s) => s.phase === p.id)) warnings.push(`${p.id} "${p.title}" has no solutions`);
    if (!roadmap.summary) errors.push('$.summary: write the summary of the roadmap');
  }
  return { errors, warnings };
}

// Where each problem stands: in which solution or declined entry, and how far that is.
export function progress(roadmap, doc) {
  const where = new Map();
  for (const s of roadmap.solutions) for (const id of s.findingIds) where.set(id, { by: s.id, state: s.status });
  for (const x of roadmap.declined) for (const id of x.findingIds) where.set(id, { by: x.id, state: x.resolution === 'backlog' ? 'backlog' : 'discarded' });
  const issues = trackedIssues(doc);
  const count = (state) => issues.filter((f) => where.get(f.id)?.state === state).length;
  return {
    tracked: issues.length,
    agreed: count('agreed'),
    draft: count('draft'),
    backlog: count('backlog'),
    discarded: count('discarded'),
    open: issues.filter((f) => !where.has(f.id)).length,
    openQuestions: openQuestions(roadmap).length,
    solutions: roadmap.solutions.length,
    where,
    openIssues: issues.filter((f) => !where.has(f.id)),
  };
}

// What the facilitator does next. The discussion is finished only when this says to render. It is a reminder of what
// is left, not an order to follow: the person may take things in any order.
export function nextStep(roadmap, doc, knowledge, finalErrors) {
  if (!knowledge.people.length) return NO_PEOPLE;
  const p = progress(roadmap, doc);
  const asked = openQuestions(roadmap).map((q) => q.id);
  const questions = asked.length ? `; open questions ${asked.join(', ')}` : '';
  if (p.open) {
    const areas = AREAS.filter((a) => p.openIssues.some((f) => f.area === a)).map((a) => `${AREA_TITLES[a]} ${p.openIssues.filter((f) => f.area === a).length}`);
    return `${p.open} of ${p.tracked} problems still need an outcome (${areas.join(', ')})${questions}. Continue with what the person raises, or offer the next open group`;
  }
  const drafts = roadmap.solutions.filter((s) => s.status !== 'agreed').map((s) => s.id);
  if (drafts.length) return `Finish the drafts ${drafts.join(', ')}: agree the approach, the owner, and who does each task and how long it takes${questions}`;
  if (asked.length) return `Settle or drop the open questions ${asked.join(', ')}`;
  if (!(roadmap.phases ?? []).length || roadmap.solutions.some((s) => !s.phase)) return 'Agree the phases with the person and place every fix plan in one';
  if (!roadmap.summary) return 'Write the summary of the roadmap';
  if (finalErrors.length) return `Resolve: ${finalErrors[0]}`;
  return 'Everything is planned: render the roadmap (roadmap-render)';
}

const STATE_LABEL = { agreed: 'fix plan', draft: 'draft', backlog: 'backlog', discarded: 'discarded' };

// Every problem with where it stands, area by area, as Markdown: what the facilitator shows when the discussion has
// jumped between areas and the person asks where things are.
export function boardMarkdown(roadmap, doc) {
  const p = progress(roadmap, doc);
  const titles = new Map([...roadmap.solutions, ...roadmap.declined].map((x) => [x.id, x.title ?? x.reason]));
  const one = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/\|/g, '/').trim();
  const out = [
    `# Roadmap board — run ${doc.run}`,
    '',
    `${p.tracked} problems: ${p.agreed} with an agreed fix plan, ${p.draft} in drafts, ${p.backlog} in the backlog, ${p.discarded} discarded, **${p.open} open**.`,
    '',
  ];
  for (const area of AREAS) {
    const own = trackedIssues(doc).filter((f) => f.area === area);
    if (!own.length) continue;
    const done = own.filter((f) => p.where.has(f.id)).length;
    out.push(`## ${AREA_TITLES[area]} — ${done} of ${own.length} decided`, '', '| Problem | Severity | Outcome |', '|---|---|---|');
    for (const f of own) {
      const w = p.where.get(f.id);
      out.push(`| ${f.id} ${one(f.title)} | ${f.severity} | ${w ? `${STATE_LABEL[w.state]}: ${w.by} ${one(titles.get(w.by)).slice(0, 60)}` : '**open**'} |`);
    }
    out.push('');
  }
  const asked = openQuestions(roadmap);
  if (asked.length) out.push('## Open questions', '', ...asked.map((q) => `- ${q.id}: ${one(q.text)}${q.askedOf ? ` (for ${one(q.askedOf)})` : ''}${(q.findingIds ?? []).length ? ` — ${q.findingIds.join(', ')}` : ''}`), '');
  return out.join('\n');
}

// A suggested order for open problems: each decision of the report, then each theme, then the rest by area, most
// serious first. A group of one cause is planned together. The person may take them in any order.
export function openGroups(openIssues, synthesis) {
  const left = new Map(openIssues.map((f) => [f.id, f]));
  const groups = [];
  const take = (label, ids) => {
    const found = ids.map((id) => left.get(id)).filter(Boolean);
    if (!found.length) return;
    found.forEach((f) => left.delete(f.id));
    groups.push({ group: label, issues: found });
  };
  (synthesis?.decisions ?? []).forEach((d, i) => take(`Decision ${i + 1} of the report: ${d.title}`, d.findingIds));
  (synthesis?.themes ?? []).forEach((t) => take(`Theme of the report: ${t.title}`, t.findingIds));
  for (const area of AREAS) {
    const rest = [...left.values()].filter((f) => f.area === area).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
    take(`Area: ${AREA_TITLES[area]}`, rest.map((f) => f.id));
  }
  return groups.map((g) => ({ group: g.group, issues: g.issues.map((f) => ({ id: f.id, severity: f.severity, title: f.title, verified: f.verified })) }));
}
