import { loadSchema, validate } from './schema.mjs';
import { findPerson } from './knowledge.mjs';
import { activeTasks } from './roadmap.mjs';
import { lintText } from './readability.mjs';

// A brief is one participant's own document, made from the agreed roadmap: only what that person decides or does,
// written for how they read. The text comes from an agent; this module checks it against the roadmap and the person.

export const AUDIENCES = ['owner', 'technical', 'developer'];
// Cyrillic names are written in Latin letters, so "\u041e\u043b\u0435\u0433 \u041f\u0435\u0442\u0440\u043e\u0432" gets brief-oleg-petrov; a name in any other script gets
// a short code of its own, so two such people never share one file.
const CYRILLIC = { \u0430: 'a', \u0431: 'b', \u0432: 'v', \u0433: 'g', \u0491: 'g', \u0434: 'd', \u0435: 'e', \u0451: 'e', \u0454: 'ye', \u0436: 'zh', \u0437: 'z', \u0438: 'i', \u0456: 'i', \u0457: 'yi', \u0439: 'y', \u043a: 'k', \u043b: 'l', \u043c: 'm', \u043d: 'n', \u043e: 'o', \u043f: 'p', \u0440: 'r', \u0441: 's', \u0442: 't', \u0443: 'u', \u0444: 'f', \u0445: 'kh', \u0446: 'ts', \u0447: 'ch', \u0448: 'sh', \u0449: 'shch', \u044a: '', \u044b: 'y', \u044c: '', \u044d: 'e', \u044e: 'yu', \u044f: 'ya' };
const code = (s) => [...s].reduce((h, c) => (h * 31 + c.codePointAt(0)) >>> 0, 7).toString(36);
export const slugOf = (name) => {
  const text = String(name).toLowerCase().normalize('NFC');
  const slug = [...text].map((c) => CYRILLIC[c] ?? c).join('').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || `person-${code(text.trim())}`;
};
export const briefFile = (person) => `brief-${slugOf(person)}`;

// Someone who decides and approves without estimates reads as an owner; everyone else does the work.
export function audienceOf(person) {
  if (AUDIENCES.includes(person?.audience)) return person.audience;
  return person?.notEstimated ? 'owner' : 'developer';
}

const isPerson = (knowledge, name, person) => Boolean(name) && findPerson(knowledge, name)?.name === person.name;
const doesTask = (knowledge, t, person) => isPerson(knowledge, t.assignee, person) || (t.orAssignees ?? []).some((n) => isPerson(knowledge, n, person));
// While someone else still chooses the route, every route's tasks may happen; otherwise only the chosen route's.
const liveTasks = (s) => (s.choiceBy ? s.tasks ?? [] : activeTasks(s));

// What one person carries in the roadmap: the tasks they do, the route choices they make and the plans they own.
export function personWork(roadmap, knowledge, person) {
  const out = [];
  for (const s of roadmap.solutions ?? []) {
    const tasks = liveTasks(s).filter((t) => doesTask(knowledge, t, person));
    const chooses = isPerson(knowledge, s.choiceBy, person);
    const owns = isPerson(knowledge, s.owner, person);
    if (tasks.length || chooses || owns) out.push({ solution: s, tasks, chooses, owns });
  }
  return out;
}

// Everyone with tasks or a choice to make gets a brief; owning a plan alone does not make one necessary.
export function participants(roadmap, knowledge) {
  return knowledge.people.map((p) => {
    const work = personWork(roadmap, knowledge, p);
    return { person: p, audience: audienceOf(p), work, tasks: work.reduce((n, w) => n + w.tasks.length, 0), choices: work.filter((w) => w.chooses).length };
  }).filter((x) => x.tasks || x.choices);
}

// What the writer reads: the person, their work with the problems behind it, what others do around it, and what is
// already settled.
export function briefInput({ roadmap, knowledge, doc, synthesis, person, project }) {
  const findings = new Map(doc.findings.map((f) => [f.id, f]));
  const allTasks = new Map((roadmap.solutions ?? []).flatMap((s) => (s.tasks ?? []).map((t) => [t.id, t])));
  const work = personWork(roadmap, knowledge, person).map(({ solution: s, tasks, chooses, owns }) => {
    const mine = new Set(tasks.map((t) => t.id));
    return {
      solution: {
        id: s.id, title: s.title, phase: s.phase, owner: s.owner, problem: s.problem, options: s.options, chosen: s.chosen, choiceBy: s.choiceBy,
        rationale: s.rationale, approach: s.approach, acceptanceCriteria: s.acceptanceCriteria, needs: s.needs, risks: s.risks, notes: s.notes, dependsOn: s.dependsOn,
      },
      role: [tasks.length && 'does tasks', chooses && 'chooses the route', owns && 'owns the plan'].filter(Boolean).join(', '),
      tasks,
      othersTasks: (s.tasks ?? []).filter((t) => !mine.has(t.id)).map((t) => ({ id: t.id, title: t.title, assignee: t.assignee, route: t.route })),
      waitsFor: [...new Set(tasks.flatMap((t) => t.after ?? []))].filter((id) => !mine.has(id)).map((id) => allTasks.get(id)).filter(Boolean)
        .map((t) => ({ id: t.id, title: t.title, assignee: t.assignee })),
      problems: s.findingIds.map((id) => findings.get(id)).filter(Boolean).map((f) => ({
        id: f.id, area: f.area, severity: f.severity, title: f.title, plainTitle: synthesis?.wording?.[f.id]?.title, why: f.why,
        verified: f.verified, toConfirm: f.toConfirm, evidence: f.evidence,
      })),
    };
  });
  return {
    project, run: roadmap.run, roadmapUpdated: roadmap.updatedAt, summary: roadmap.summary, phases: roadmap.phases,
    person: { ...person, audience: audienceOf(person) },
    people: knowledge.people.map((p) => ({ name: p.name, role: p.role })),
    work,
    questions: (roadmap.questions ?? []).filter((q) => isPerson(knowledge, q.askedOf, person)),
    knowledge: knowledge.notes.map((n) => ({ id: n.id, kind: n.kind, title: n.title, detail: n.detail })),
  };
}

// ---- Inline markup ----
// **bold**; [[A]] marks where the answer to question A goes, [[A: text]] is text that stays or goes with that answer;
// [[?text]] is a gap for the reader to fill, [[~text]] a gap someone else fills; [[#D3]] is the number of item D3 and
// [[#D3.B]] its question B, so references stay right when items move; [[+text]] marks what an option changes.
// A mark may hold another one ("[[E: Our EU company: [[~Dev: its name]].]]"); MARK matches the innermost.
export const MARK = /\[\[(#D\d{1,2}(?:\.[A-Z])?|[A-Z](?::(?:(?!\[\[)[^\]])*)?|[?~+](?:(?!\[\[)[^\]])+)\]\]/g;

// Replaces every mark, the innermost first, with what render(token) returns; inner output is put back in place.
export function replaceMarks(text, render) {
  const held = [];
  let s = text;
  for (let prev; prev !== s;) {
    prev = s;
    s = s.replace(MARK, (_, tok) => { held.push(render(tok)); return `\u0001${held.length - 1}\u0002`; });
  }
  const restore = (x) => x.replace(/\u0001(\d+)\u0002/g, (_, i) => restore(held[Number(i)]));
  return restore(s);
}
export const marksOf = (text) => { const out = []; replaceMarks(text, (tok) => { out.push(tok); return ''; }); return out; };
export const unmarked = (text, fill = '') => replaceMarks(text, () => fill);

// Every text of an item with where it is, for checks and the readability pass.
export function itemTexts(item, at) {
  const out = [];
  const add = (p, t) => { if (typeof t === 'string') out.push({ path: p, text: t }); };
  for (const k of ['title', 'short', 'summary', 'need', 'when', 'problem', 'ask', 'recommendation', 'next']) add(`${at}.${k}`, item[k]);
  (item.blocks ?? []).forEach((b, i) => {
    const bp = `${at}.blocks[${i}]`;
    add(`${bp}.title`, b.title);
    add(`${bp}.text`, b.text);
    (b.items ?? []).forEach((t, j) => add(`${bp}.items[${j}]`, t));
    (b.steps ?? []).forEach((s, j) => { add(`${bp}.steps[${j}].label`, s.label); add(`${bp}.steps[${j}].text`, s.text); });
    (b.head ?? []).forEach((t, j) => add(`${bp}.head[${j}]`, t));
    (b.rows ?? []).forEach((r, j) => r.forEach((t, c) => add(`${bp}.rows[${j}][${c}]`, t)));
    (b.questions ?? []).forEach((q, j) => { add(`${bp}.questions[${j}].question`, q.question); add(`${bp}.questions[${j}].why`, q.why); });
    (b.groups ?? []).forEach((g, j) => { add(`${bp}.groups[${j}].title`, g.title); add(`${bp}.groups[${j}].note`, g.note); });
    (b.variants ?? []).forEach((v, j) => { for (const k of ['label', 'kicker', 'heading', 'text', 'note']) add(`${bp}.variants[${j}].${k}`, v[k]); });
    (b.sections ?? []).forEach((s, j) => {
      const sp = `${bp}.sections[${j}]`;
      add(`${sp}.heading`, s.heading);
      (s.paragraphs ?? []).forEach((t, k) => add(`${sp}.paragraphs[${k}]`, t));
      (s.rows ?? []).forEach((r, k) => r.forEach((t, c) => add(`${sp}.rows[${k}][${c}]`, t)));
      (s.notes ?? []).forEach((n, k) => add(`${sp}.notes[${k}].text`, n.text));
    });
  });
  return out;
}

const HOURS = /\b\d+(?:[.,]\d+)?(?:\s*(?:–|-|to)\s*\d+(?:[.,]\d+)?)?\s*(?:h|hrs?|hours?|person-days?)\b/i;
// The three cards stay short and side by side; the detail goes into the blocks below them.
const CARD_MAX = { problem: 320, ask: 260, recommendation: 280 };
// The cards' own labels, which the script prints (see LABELS in brief-html.mjs).
const CARD_LABELS = new Set(['recommendation', 'proposal', 'done when', 'to do', 'to agree', 'to decide', 'the problem']);
// Blocks with a heading of their own or a default one; every other block has a small label above it.
const UNLABELLED = new Set(['note', 'template', 'document', 'questions', 'tasks']);
const LITERAL_REF = /\b(?:decision|topic|item|question)\s+\d+[A-Z]?\b/i;

// The roadmap entries a ref names: a solution stands for all of the person's work in it.
function covered(refs, work) {
  const tasks = new Set();
  const choices = new Set();
  for (const w of work) {
    for (const r of refs) {
      if (r === w.solution.id) { w.tasks.forEach((t) => tasks.add(t.id)); if (w.chooses) choices.add(w.solution.id); }
      if (w.tasks.some((t) => t.id === r)) tasks.add(r);
    }
  }
  return { tasks, choices };
}

export function validateBrief(brief, { roadmap, knowledge }) {
  const errors = validate(loadSchema('brief'), brief);
  const warnings = [];
  if (errors.length) return { errors, warnings };
  const person = findPerson(knowledge, brief.person);
  if (!person) return { errors: [`$.person: "${brief.person}" is not one of the people in the project knowledge`], warnings };
  const items = brief.items;
  const ids = items.map((i) => i.id);
  ids.filter((id, i) => ids.indexOf(id) !== i).forEach((id) => errors.push(`$.items: ${id} is used twice`));

  const solutions = new Map((roadmap.solutions ?? []).map((s) => [s.id, s]));
  const tasks = new Map([...solutions.values()].flatMap((s) => (s.tasks ?? []).map((t) => [t.id, t])));
  const questions = new Set((roadmap.questions ?? []).map((q) => q.id));
  const notes = new Set(knowledge.notes.map((n) => n.id));
  const exists = (r) => (r.startsWith('K') ? notes.has(r) : r.startsWith('Q') ? questions.has(r) : r.includes('.') ? tasks.has(r) : solutions.has(r));

  // Tasks the roadmap gives someone else but that belong to this reader, said with the reason.
  const taken = new Set((brief.takes ?? []).map((x) => x.ref));
  for (const x of brief.takes ?? []) {
    if (!tasks.has(x.ref)) errors.push(`$.takes: ${x.ref} is not a task in the roadmap`);
    else if (!items.some((it) => it.refs.includes(x.ref))) errors.push(`$.takes: ${x.ref} is in no item's refs`);
  }
  const keysOf = (item) => new Set((item.blocks ?? []).flatMap((b) => (b.questions ?? []).map((q) => q.key)));
  items.forEach((item, n) => {
    const at = `$.items[${n}]`;
    for (const r of item.refs) {
      if (!exists(r)) errors.push(`${at}.refs: ${r} is not in the roadmap or the project knowledge`);
      const t = tasks.get(r);
      if (t && !doesTask(knowledge, t, person) && !taken.has(r)) warnings.push(`${at}.refs: ${r} is ${t.assignee ?? 'nobody'}'s task, not ${person.name}'s. A brief asks only what its reader decides or does; leave others' work out, mention it in one line as context, or, when it really is the reader's, list it in "takes" with the reason.`);
    }
    const keys = [...(item.blocks ?? []).flatMap((b) => (b.questions ?? []).map((q) => q.key))];
    keys.filter((k, i) => keys.indexOf(k) !== i).forEach((k) => errors.push(`${at}: question ${k} is used twice`));
    (item.blocks ?? []).forEach((b, i) => {
      const bp = `${at}.blocks[${i}]`;
      const need = { text: ['text'], list: ['items'], flow: ['steps'], table: ['head', 'rows'], note: ['text'], questions: ['questions'], groups: ['groups'], variants: ['variants'], template: ['title', 'text'], document: ['title', 'sections'], tasks: ['tasks'] }[b.type];
      for (const k of need) if (b[k] === undefined || (Array.isArray(b[k]) && !b[k].length)) errors.push(`${bp}: a ${b.type} block needs "${k}"`);
      for (const [rows, head, p] of [[b.rows, b.head, bp], ...(b.sections ?? []).map((s, j) => [s.rows, s.head, `${bp}.sections[${j}]`])]) {
        if (rows && head && rows.some((r) => r.length !== head.length)) errors.push(`${p}.rows: every row needs ${head.length} cells, like the head`);
        if (rows && !head && rows.some((r) => r.length !== rows[0].length)) errors.push(`${p}.rows: every row needs the same number of cells`);
      }
      if (!b.title && !UNLABELLED.has(b.type)) errors.push(`${bp}: a ${b.type} block needs a short "title", the label above it that says what it shows ("The plans", "How each logo is decided")`);
      if (b.pick !== undefined && !(b.pick >= 0 && b.pick < (b.rows ?? []).length)) errors.push(`${bp}.pick: there is no row ${b.pick}`);
      if (b.type === 'flow' && b.steps && (b.steps.length < 2 || b.steps.length > 5)) warnings.push(`${bp}: a flow reads best with 2 to 5 steps (has ${b.steps.length})`);
      if (b.type === 'tasks') {
        if (audienceOf(person) === 'owner' || brief.audience === 'owner') errors.push(`${bp}: an owner's brief shows no task list with estimates`);
        for (const id of b.tasks ?? []) if (!tasks.has(id)) errors.push(`${bp}.tasks: ${id} is not a task in the roadmap`);
      }
    });
    for (const [k, max] of Object.entries(CARD_MAX)) {
      const len = unmarked(item[k], 'xx').replace(/\*\*/g, '').length;
      if (len > max) errors.push(`${at}.${k}: ${len} characters; a card holds at most ${max}. Keep it to two or three sentences and move the detail into a block below the cards, such as a "Why it matters" list`);
    }
    if (!/^\*\*[^*]+\*\*/.test(item.recommendation.trim())) errors.push(`${at}.recommendation: open with the answer in bold, so it reads at a glance ("**Basic, billed yearly.** …")`);
    const lead = /^\*\*([^*]+)\*\*/.exec(item.recommendation.trim())?.[1].replace(/[:.]\s*$/, '').trim().toLowerCase();
    if (CARD_LABELS.has(lead)) errors.push(`${at}.recommendation: "**${lead}**" repeats the card's label; open with the answer itself ("**Consent first:** nothing loads before …")`);
    const notes = (item.blocks ?? []).filter((b) => b.type === 'note').length;
    if (notes > 1) errors.push(`${at}.blocks: ${notes} notes; one note per item, so the trade-off that matters stands out. Merge them, or move one into a table`);
    const own = keysOf(item);
    for (const { path, text } of itemTexts(item, at)) {
      if (/\[\[|\]\]/.test(unmarked(text))) errors.push(`${path}: broken markup: a [[ or ]] that is not part of a mark ("${text.slice(0, 80)}")`);
      for (const tok of marksOf(text)) {
        if (tok.startsWith('#')) {
          const [id, key] = tok.slice(1).split('.');
          const target = items.find((x) => x.id === id);
          if (!target) errors.push(`${path}: [[${tok}]] names no item`);
          else if (key && !keysOf(target).has(key)) errors.push(`${path}: [[${tok}]]: ${id} has no question ${key}`);
        } else if (/^[A-Z](:|$)/.test(tok) && !own.has(tok[0])) errors.push(`${path}: [[${tok}]]: this item has no question ${tok[0]}`);
      }
      if (brief.audience === 'owner' && HOURS.test(text)) errors.push(`${path}: an owner's brief has no time estimates ("${HOURS.exec(text)[0]}")`);
      if (LITERAL_REF.test(unmarked(text)) && !path.includes('.sections[')) warnings.push(`${path}: "${LITERAL_REF.exec(unmarked(text))[0]}" — write [[#D…]] so the number stays right when items move`);
    }
  });

  // Item numbers may be used on the first page and in the context too.
  const outside = [{ path: '$.reply', text: brief.reply ?? '' }, ...(brief.context ?? []).flatMap((c, i) => c.rows.map((r, j) => ({ path: `$.context[${i}].rows[${j}]`, text: `${r.label} ${r.text}` })))];
  for (const { path, text } of outside) {
    for (const tok of marksOf(text)) {
      const [id, key] = tok.startsWith('#') ? tok.slice(1).split('.') : [null];
      if (!id) errors.push(`${path}: [[${tok}]]: only item numbers ([[#D1]], [[#D1.A]]) work outside an item`);
      else if (!items.some((x) => x.id === id && (!key || keysOf(x).has(key)))) errors.push(`${path}: [[${tok}]] names no item or question`);
    }
  }

  // Nothing of the person's may be lost: each task and route choice is in an item or left out with a reason.
  const work = personWork(roadmap, knowledge, person);
  const { tasks: done, choices } = covered([...items.flatMap((i) => i.refs), ...(brief.omit ?? []).map((o) => o.ref)], work);
  const missing = work.flatMap((w) => [...w.tasks.filter((t) => !done.has(t.id)).map((t) => t.id), ...(w.chooses && !choices.has(w.solution.id) ? [`${w.solution.id} (route choice)`] : [])]);
  if (missing.length) errors.push(`${person.name}'s roadmap work that no item covers: ${missing.join(', ')}. Put each in an item's refs, or in "omit" with the reason.`);
  if (brief.audience !== audienceOf(person) && !person.audience) warnings.push(`$.audience: "${brief.audience}", while the project knowledge suggests "${audienceOf(person)}" for ${person.name}`);
  if (brief.audience === 'owner') {
    // Drafts and templates are quoted text the reader passes on, not the brief's own words.
    const own = (p) => !/\.sections\[|\.blocks\[\d+\]\.text$/.test(p) || !items.some((it, n) => p.startsWith(`$.items[${n}].blocks[`) && ['template', 'document'].includes(it.blocks?.[Number(/blocks\[(\d+)\]/.exec(p)[1])]?.type));
    const lint = items.flatMap((item, n) => itemTexts(item, `$.items[${n}]`)).filter(({ path }) => own(path)).flatMap(({ path, text }) => lintText(unmarked(text)).map((p) => `${path}: ${p.kind} — ${p.match}`));
    if (lint.length) warnings.push(...lint.slice(0, 15).map((l) => `readability: ${l}`));
  }
  return { errors, warnings };
}

export function validateBriefReview(review, { person, pages }) {
  const errors = [];
  if (!review || typeof review !== 'object' || Array.isArray(review)) return ['the result must be a JSON object'];
  if (review.person !== person) errors.push(`$.person: expected "${person}"`);
  if (typeof review.verdict !== 'string' || review.verdict.trim().length < 10) errors.push('$.verdict: one sentence is required');
  if (!Array.isArray(review.issues)) errors.push('$.issues: an array is required');
  (Array.isArray(review.issues) ? review.issues : []).forEach((x, i) => {
    const at = `$.issues[${i}]`;
    if (!['high', 'medium', 'low'].includes(x?.severity)) errors.push(`${at}.severity: high, medium or low`);
    if (!Number.isInteger(x?.page) || x.page < 1 || x.page > pages) errors.push(`${at}.page: a page number from 1 to ${pages} is required`);
    for (const k of ['quote', 'why', 'fix']) if (typeof x?.[k] !== 'string' || x[k].trim().length < 3) errors.push(`${at}.${k}: text is required`);
  });
  return errors;
}
