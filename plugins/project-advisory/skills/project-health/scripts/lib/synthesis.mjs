import { loadSchema, validate } from './schema.mjs';
import { scanText } from './secrets.mjs';

const WORDING_FIELDS = { issue: ['title', 'why', 'toConfirm'], tooling: ['title', 'why', 'trigger', 'draftDescription', 'benefit'] };

const kindOf = (f) => (f.kind === 'tooling' ? 'tooling' : 'issue');

// Every string in the synthesis, with a readable location, for the secret scan.
function strings(value, at, out = []) {
  if (typeof value === 'string') out.push([at, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${at}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) strings(v, `${at}.${k}`, out);
  return out;
}

// What the report prints: every ticked finding, and every other problem that was not dismissed (the register lists
// all of them). Unticked AI tooling suggestions are not printed.
export function printedFindings(doc, selectedIds) {
  const selected = new Set(selectedIds);
  return doc.findings.filter((f) => selected.has(f.id) || kindOf(f) === 'issue');
}

const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

// Findings the synthesis marked as the same problem as another one (`duplicates[].same`): the report and the plan
// print and count each problem once, under the finding it keeps.
export function duplicateIds(syn) {
  return new Set((syn?.duplicates ?? []).flatMap((d) => d.same));
}

// For each copy, the finding kept for its problem; any other id stands for itself.
export function keptIdOf(syn) {
  const map = new Map((syn?.duplicates ?? []).flatMap((d) => d.same.map((id) => [id, d.keep])));
  return (id) => map.get(id) ?? id;
}

// The finding kept for a problem, with the most serious severity of its group, confirmed when any of them is, and the
// areas the others came from.
export function keptFinding(f, syn, byId) {
  const group = (syn?.duplicates ?? []).find((d) => d.keep === f.id);
  if (!group) return f;
  const others = group.same.map((id) => byId.get(id)).filter(Boolean);
  const severity = [f, ...others].map((x) => x.severity).sort((a, b) => SEVERITY_ORDER.indexOf(a) - SEVERITY_ORDER.indexOf(b))[0];
  return { ...f, severity, verified: f.verified || others.some((x) => x.verified), alsoIn: [...new Set(others.map((x) => x.area).filter((a) => a !== f.area))] };
}
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];

// The plan's fixes in reading order, each with its number in the report and the plan.
export function planFixes(syn) {
  return (syn?.plan?.stages ?? []).flatMap((stage) => stage.fixes).map((fx, i) => ({ ...fx, n: i + 1 }));
}

// The findings a fix deals with: those of the decisions and themes it covers, and its own.
export function fixFindings(fx, syn) {
  const groups = [...syn.decisions, ...syn.themes].filter((g) => (fx.covers ?? []).includes(g.id));
  return [...new Set([...groups.flatMap((g) => g.findingIds), ...(fx.findingIds ?? [])])];
}

function planErrors(syn, byId, selected) {
  const errors = [];
  const warnings = [];
  const fixes = planFixes(syn);
  const groups = new Set([...syn.decisions, ...syn.themes].map((g) => g.id));
  const seenFix = new Set();
  const stepIds = new Set();
  for (const fx of fixes) {
    const at = `$.plan.${fx.id}`;
    if (seenFix.has(fx.id)) errors.push(`${at}: duplicate fix id`);
    for (const id of fx.covers ?? []) if (!groups.has(id)) errors.push(`${at}.covers: no decision or theme ${id}`);
    for (const id of fx.findingIds ?? []) if (!byId.has(id) || !selected.has(id)) errors.push(`${at}.findingIds: ${id} is not a finding ticked for this report`);
    // The order of the plan is the recommended order, so a fix only waits for fixes before it.
    for (const id of fx.after ?? []) if (!seenFix.has(id)) errors.push(`${at}.after: ${id} is not an earlier fix`);
    seenFix.add(fx.id);
    // Routes are for genuinely equal ways forward: the plan then shows them side by side and says what the choice turns on.
    const routes = new Set((fx.routes ?? []).map((r) => r.name));
    if (routes.size !== (fx.routes ?? []).length) errors.push(`${at}.routes: two routes share a name`);
    if (routes.size && !fx.choice) errors.push(`${at}.choice: say what the choice between the routes depends on`);
    if (!routes.size && fx.choice) errors.push(`${at}.choice: only a fix with routes has a choice`);
    const seen = new Map();
    for (const st of fx.steps) {
      const sat = `$.plan.${st.id}`;
      if (!st.id.startsWith(`${fx.id}.`)) errors.push(`${sat}: step ids of ${fx.id} start with "${fx.id}."`);
      if (stepIds.has(st.id)) errors.push(`${sat}: duplicate step id`);
      stepIds.add(st.id);
      for (const id of st.after ?? []) if (!seen.has(id)) errors.push(`${sat}.after: ${id} is not an earlier step of ${fx.id}`);
      if (st.route && !routes.has(st.route)) errors.push(`${sat}.route: "${st.route}" is not one of the routes of ${fx.id}`);
      if (st.effort === 'after-check') {
        if (st.kind !== 'work') errors.push(`${sat}.effort: only work can be sized after a check; a check has its own size`);
        else if (!(st.after ?? []).some((id) => seen.get(id)?.kind === 'check')) errors.push(`${sat}.after: work sized after a check names that check step`);
        if (!st.sizeNote) errors.push(`${sat}.sizeNote: say what the check decides about the size`);
      }
      seen.set(st.id, st);
    }
    for (const r of routes) if (!fx.steps.some((st) => st.route === r)) warnings.push(`${at}: route "${r}" has no steps of its own`);
  }
  if (!fixes.length) return { errors, warnings };
  // A copy of a problem is planned when the finding kept for it is, wherever either is listed.
  const kept = keptIdOf(syn);
  const planned = new Set(fixes.flatMap((fx) => fixFindings(fx, syn)).map(kept));
  const checked = new Set(fixes.filter((fx) => fx.steps.some((st) => st.kind === 'check')).flatMap((fx) => fixFindings(fx, syn)).map(kept));
  for (const g of [...syn.decisions, ...syn.themes]) if (!fixes.some((fx) => (fx.covers ?? []).includes(g.id))) warnings.push(`${g.id} "${g.title}" is not in the plan`);
  for (const id of selected) {
    const f = byId.get(id);
    if (!f || kindOf(f) !== 'issue') continue;
    if (!planned.has(kept(id))) warnings.push(`${id} is not in the plan`);
    else if (!f.verified && !checked.has(kept(id))) warnings.push(`${id} is unconfirmed but its fix has no check step`);
  }
  return { errors, warnings };
}

// `draft` is the synthesis as the synthesis step saved it; the editor may reword everything but not regroup.
function structureErrors(syn, draft) {
  const errors = [];
  const shape = (list) => new Map((list ?? []).map((x) => [x.id, x]));
  for (const key of ['decisions', 'themes']) {
    const before = shape(draft[key]);
    const after = shape(syn[key]);
    if (!sameSet([...before.keys()], [...after.keys()])) errors.push(`$.${key}: the editor must keep the same ids (${[...before.keys()].join(', ') || 'none'})`);
    for (const [id, item] of after) {
      const old = before.get(id);
      if (!old) continue;
      if (!sameSet(old.findingIds, item.findingIds)) errors.push(`$.${key}[${id}].findingIds: the editor must not regroup findings`);
      if (key === 'decisions') {
        const rec = (d) => d.options.findIndex((o) => o.recommended);
        if (old.options.length !== item.options.length || rec(old) !== rec(item)) errors.push(`$.decisions[${id}].options: the editor must keep the options and which one is recommended`);
      }
    }
  }
  if (Boolean(draft.workflow) !== Boolean(syn.workflow)) errors.push('$.workflow: the editor must not add or remove the workflow section');
  if ((draft.tools ?? []).length !== (syn.tools ?? []).length) errors.push('$.tools: the editor must keep the same tools');
  const groups = (x) => JSON.stringify((x.duplicates ?? []).map((d) => [d.keep, [...d.same].sort()]).sort());
  if (groups(draft) !== groups(syn)) errors.push('$.duplicates: the editor must keep the same groups of one problem reported several times');
  // The editor rewords the plan; its fixes, routes and steps, their order, sizes and links stay as planned.
  const skeleton = (x) => JSON.stringify((x.plan?.stages ?? []).map((stage) => stage.fixes.map((fx) => [
    fx.id, fx.covers ?? [], fx.findingIds ?? [], fx.after ?? [],
    (fx.routes ?? []).map((r) => [r.effort, (r.compare ?? []).length]),
    fx.steps.map((st) => [st.id, st.kind, st.effort, st.after ?? [], st.route ? (fx.routes ?? []).findIndex((r) => r.name === st.route) : -1, (st.checklist ?? []).length]),
  ])));
  if (skeleton(draft) !== skeleton(syn)) errors.push('$.plan: the editor must keep the stages, the fixes and their routes, the steps in their order, their sizes and what they cover');
  return errors;
}

export function validateSynthesis(syn, { doc, selectedIds, stage = 'synthesis', draft = null }) {
  const errors = validate(loadSchema('synthesis'), syn);
  if (errors.length) return { errors, warnings: [] };
  const warnings = [];
  const byId = new Map(doc.findings.map((f) => [f.id, f]));
  const selected = new Set(selectedIds);
  const placed = new Map();

  const checkIds = (ids, at) => {
    for (const id of ids) {
      if (!byId.has(id)) errors.push(`${at}: unknown finding ${id}`);
      else if (!selected.has(id)) errors.push(`${at}: ${id} is not ticked for this report`);
      else if (kindOf(byId.get(id)) === 'issue') {
        if (placed.has(id)) errors.push(`${at}: ${id} is already used in ${placed.get(id)} — each issue belongs to one decision or theme`);
        else placed.set(id, at);
      }
    }
  };
  const ids = new Set();
  for (const [key, list] of [['decisions', syn.decisions], ['themes', syn.themes]]) {
    list.forEach((item, i) => {
      if (ids.has(item.id)) errors.push(`$.${key}[${i}].id: duplicate id ${item.id}`);
      ids.add(item.id);
      checkIds(item.findingIds, `$.${key}[${i}].findingIds`);
    });
  }
  syn.decisions.forEach((d, i) => {
    const n = d.options.filter((o) => o.recommended).length;
    if (n !== 1) errors.push(`$.decisions[${i}].options: exactly one option must be recommended (found ${n})`);
  });
  const toolNames = new Set();
  (syn.tools ?? []).forEach((t, i) => {
    if (!syn.decisions.some((d) => d.id === t.decision)) errors.push(`$.tools[${i}].decision: no decision ${t.decision}`);
    if (toolNames.has(t.name)) errors.push(`$.tools[${i}].name: "${t.name}" is listed twice`);
    toolNames.add(t.name);
  });
  (syn.workflow?.proposed ?? []).forEach((s, i) => {
    if (s.tool && !toolNames.has(s.tool)) errors.push(`$.workflow.proposed[${i}].tool: "${s.tool}" is not one of the names in "tools"`);
    if (!s.toolId) return;
    const f = byId.get(s.toolId);
    if (!f || !selected.has(s.toolId) || f.kind !== 'tooling') errors.push(`$.workflow.proposed[${i}].toolId: ${s.toolId} is not a ticked AI tooling finding`);
  });
  for (const [id, w] of Object.entries(syn.wording)) {
    const at = `$.wording.${id}`;
    const f = byId.get(id);
    if (!f) { errors.push(`${at}: unknown finding ${id}`); continue; }
    if (!selected.has(id) && kindOf(f) !== 'issue') { errors.push(`${at}: ${id} is an AI tooling suggestion that is not ticked, so the report does not print it`); continue; }
    if (!w || typeof w !== 'object' || Array.isArray(w)) { errors.push(`${at}: expected an object`); continue; }
    for (const [k, v] of Object.entries(w)) {
      if (!WORDING_FIELDS[kindOf(f)].includes(k)) errors.push(`${at}.${k}: only ${WORDING_FIELDS[kindOf(f)].join(', ')} can be reworded`);
      else if (typeof v !== 'string' || v.trim().length < 3) errors.push(`${at}.${k}: expected text`);
    }
  }
  const doubled = new Map();
  (syn.duplicates ?? []).forEach((d, i) => {
    const at = `$.duplicates[${i}]`;
    const group = [d.keep, ...d.same];
    for (const id of group) {
      const f = byId.get(id);
      if (!f) errors.push(`${at}: unknown finding ${id}`);
      else if (kindOf(f) !== 'issue') errors.push(`${at}: ${id} is an AI tooling suggestion, not a problem`);
      else if (doubled.has(id)) errors.push(`${at}: ${id} is already in ${doubled.get(id)}`);
      else doubled.set(id, at);
    }
    if (d.same.includes(d.keep)) errors.push(`${at}.same: ${d.keep} is the one kept`);
    if (group.every((id) => byId.has(id)) && new Set(group.map((id) => selected.has(id))).size > 1) errors.push(`${at}: tick all of ${group.join(', ')} for this report or none of them, since they are one problem`);
  });
  const terms = new Set();
  syn.glossary.forEach((g, i) => {
    const t = g.term.toLowerCase();
    if (terms.has(t)) errors.push(`$.glossary[${i}].term: "${g.term}" is defined twice`);
    terms.add(t);
  });
  for (const [at, text] of strings(syn, '$')) {
    if (scanText(text).length) errors.push(`${at}: contains what looks like a secret`);
  }
  const plan = planErrors(syn, byId, selected);
  errors.push(...plan.errors);
  warnings.push(...plan.warnings);
  if (stage === 'edit') {
    if (!syn.review) errors.push('$.review: the editor records its verdict in "review"');
    if (draft) errors.push(...structureErrors(syn, draft));
  }
  for (const id of selectedIds) {
    const f = byId.get(id);
    if (f?.direction && !placed.has(id) && !duplicateIds(syn).has(id)) warnings.push(`${id} is a structural problem but no decision covers it`);
  }
  return { errors, warnings };
}

// Which decision or theme explains each issue, and which fixes of the plan deal with it, for the issue register.
export function placements(syn) {
  const map = new Map();
  if (!syn) return map;
  syn.decisions.forEach((d, i) => d.findingIds.forEach((id) => map.set(id, { kind: 'decision', n: i + 1, title: d.title, fixes: [] })));
  syn.themes.forEach((t) => t.findingIds.forEach((id) => { if (!map.has(id)) map.set(id, { kind: 'theme', title: t.title, fixes: [] }); }));
  for (const fx of planFixes(syn)) {
    for (const id of fixFindings(fx, syn)) {
      if (!map.has(id)) map.set(id, { kind: null, fixes: [] });
      map.get(id).fixes.push(fx);
    }
  }
  return map;
}

// The fixes that act on a decision or theme, or on one of its problems.
export function fixesFor(syn, groupId) {
  const group = [...syn.decisions, ...syn.themes].find((g) => g.id === groupId);
  return planFixes(syn).filter((fx) => (fx.covers ?? []).includes(groupId) || (fx.findingIds ?? []).some((id) => group?.findingIds.includes(id)));
}

// The finding text as the report prints it: the editor's plain wording when there is one.
export function worded(f, syn) {
  const w = syn?.wording?.[f.id] ?? {};
  return { ...f, title: w.title ?? f.title, why: w.why ?? f.why, toConfirm: w.toConfirm ?? f.toConfirm, trigger: w.trigger ?? f.trigger, draftDescription: w.draftDescription ?? f.draftDescription, benefit: w.benefit ?? f.benefit };
}

// Every text the report and the plan print, with where it comes from, so the editor and the readability check see the
// same words as the reader. `printed` is what printedFindings returns.
export function reportItems(printed, syn) {
  const items = [];
  const add = (path, text) => { if (text) items.push({ path, text }); };
  if (syn) {
    add('summary.verdict', syn.summary.verdict);
    syn.decisions.forEach((d) => {
      add(`decisions.${d.id}.title`, d.title);
      add(`decisions.${d.id}.problem`, d.problem);
      d.costs.forEach((c, i) => add(`decisions.${d.id}.costs[${i}]`, c));
      d.options.forEach((o, k) => {
        add(`decisions.${d.id}.options[${k}].name`, o.name);
        add(`decisions.${d.id}.options[${k}].description`, o.description);
        o.pros.forEach((p, i) => add(`decisions.${d.id}.options[${k}].pros[${i}]`, p));
        o.cons.forEach((c, i) => add(`decisions.${d.id}.options[${k}].cons[${i}]`, c));
      });
      add(`decisions.${d.id}.recommendation`, d.recommendation);
    });
    syn.themes.forEach((t) => { add(`themes.${t.id}.title`, t.title); add(`themes.${t.id}.summary`, t.summary); });
    (syn.tools ?? []).forEach((t, i) => {
      add(`tools[${i}].name`, t.name);
      add(`tools[${i}].trigger`, t.trigger);
      add(`tools[${i}].description`, t.description);
      add(`tools[${i}].problem`, t.problem);
      add(`tools[${i}].benefit`, t.benefit);
    });
    if (syn.plan) {
      add('plan.summary', syn.plan.summary);
      syn.plan.stages.forEach((stage, i) => { add(`plan.stages[${i}].title`, stage.title); add(`plan.stages[${i}].goal`, stage.goal); });
      for (const fx of planFixes(syn)) {
        const at = `plan.${fx.id}`;
        add(`${at}.title`, fx.title);
        add(`${at}.problem`, fx.problem);
        add(`${at}.choice`, fx.choice);
        add(`${at}.approach`, fx.approach);
        (fx.routes ?? []).forEach((r, k) => {
          add(`${at}.routes[${k}].name`, r.name);
          add(`${at}.routes[${k}].summary`, r.summary);
          r.pros.forEach((p, i) => add(`${at}.routes[${k}].pros[${i}]`, p));
          r.cons.forEach((c, i) => add(`${at}.routes[${k}].cons[${i}]`, c));
          (r.compare ?? []).forEach((c, i) => { add(`${at}.routes[${k}].compare[${i}].row`, c.row); add(`${at}.routes[${k}].compare[${i}].value`, c.value); });
        });
        for (const st of fx.steps) {
          add(`plan.${st.id}.title`, st.title);
          add(`plan.${st.id}.what`, st.what);
          add(`plan.${st.id}.sizeNote`, st.sizeNote);
          (st.needs ?? []).forEach((t, i) => add(`plan.${st.id}.needs[${i}]`, t));
          (st.checklist ?? []).forEach((c, i) => { add(`plan.${st.id}.checklist[${i}].point`, c.point); add(`plan.${st.id}.checklist[${i}].needs`, c.needs); add(`plan.${st.id}.checklist[${i}].why`, c.why); });
        }
        fx.doneWhen.forEach((d, i) => add(`${at}.doneWhen[${i}]`, d));
      }
    }
    if (syn.workflow) {
      add('workflow.summary', syn.workflow.summary);
      for (const part of ['today', 'proposed']) {
        syn.workflow[part].forEach((s, i) => { add(`workflow.${part}[${i}].step`, s.step); add(`workflow.${part}[${i}].note`, s.note); });
      }
    }
  }
  for (const raw of printed) {
    const f = worded(raw, syn);
    add(`finding.${f.id}.title`, f.title);
    add(`finding.${f.id}.why`, f.why);
    if (!f.verified) add(`finding.${f.id}.toConfirm`, f.toConfirm);
    if (f.kind === 'tooling') {
      add(`finding.${f.id}.trigger`, f.trigger);
      add(`finding.${f.id}.draftDescription`, f.draftDescription);
      add(`finding.${f.id}.benefit`, f.benefit);
    }
  }
  (syn?.glossary ?? []).forEach((g, i) => add(`glossary[${i}].meaning`, g.meaning));
  return items;
}
