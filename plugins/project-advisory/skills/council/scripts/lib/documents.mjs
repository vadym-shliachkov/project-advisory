import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from './io.mjs';
import { projectDir } from './paths.mjs';
import { loadFacts } from './bank.mjs';
import { loadIdeas, trackRecord } from './ideas.mjs';
import { seat } from './session.mjs';
import { inThread } from './record.mjs';
import { adopted } from './frame.mjs';

// The two documents of a session, as data: what the script knows for certain (the model, built from the record and
// the verdicts) and what the writers add (checked here against the model before it is saved). A document never
// states what the record does not hold.

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const STRENGTH_ORDER = ['strong', 'fair', 'speculative'];
const EFFORT_ORDER = ['small', 'medium', 'large'];
// The survivors are listed from the furthest-reaching: a bet on direction is a decision for the owner, a change to a
// page is work for whoever keeps the site.
const SCALE_ORDER = ['new', 'direction', 'reinvention', 'redesign', 'refresh', 'remake', 'product', 'feature', 'addition', 'adjustment', null];
export const BOLD = ['new', 'direction'];
const lived = (r) => r.verdict === 'survived' || r.verdict === 'narrowed';

export const docPath = (dir, name) => path.join(dir, `${name}.json`);
export const loadDoc = (dir, name) => readJson(docPath(dir, name), null);
export const saveDoc = (dir, name, data) => writeJson(docPath(dir, name), data);

// The name and colour the documents carry: a person's fact first, then what a health check detected, then the folder.
export function brandOf(root) {
  const profile = readJson(path.join(projectDir(root), 'profile.json'), null)?.brand ?? {};
  const named = loadFacts(root).find((f) => f.key === 'brand.name')?.value;
  const [name, nameFrom] = one(named) ? [one(named), 'person'] : one(profile.name) ? [one(profile.name), 'health check'] : [path.basename(root), 'folder'];
  return { name, nameFrom, color: /^#[0-9a-f]{6}$/i.test(profile.primaryColor ?? '') ? profile.primaryColor.toLowerCase() : null };
}

// A file on this computer is shown by where it sits in the project or the data folder: the reader cannot open this
// computer's own path, and it would show the folders of whoever ran the session.
export function shownSource(src, root, data) {
  let s = String(src ?? '');
  if (/^file:\/\//i.test(s)) { try { s = fileURLToPath(s); } catch { return src; } }
  else if (!s || !(path.isAbsolute(s) || /^[a-z]:[\\/]/i.test(s))) return src;
  for (const [base, label] of [[data, 'in the data folder: '], [root, 'in the project: ']]) {
    if (!base) continue;
    const rel = path.relative(path.resolve(base), path.resolve(s));
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return label + rel.split(path.sep).join('/');
  }
  return `a file on the computer the session ran on: ${path.basename(s)}`;
}

// Everything the documents are built from, in one place.
export function buildModel(ctx, root) {
  const { session, record, evidence, verdicts } = ctx;
  const byId = new Map(evidence.entries.map((e) => [e.id, { ...e, source: shownSource(e.source, root, session.data) }]));
  const ledger = loadIdeas(root);
  const titleOf = (id) => record.threads.find((t) => t.id === id)?.title ?? id;

  const ideas = record.threads.filter((t) => t.status === 'admitted').map((t) => {
    const said = inThread(record, t.id);
    const h = said.find((s) => s.type === 'hypothesis');
    const ruling = verdicts.rulings.find((r) => r.thread === t.id) ?? null;
    const narrowed = ruling?.verdict === 'narrowed' ? ruling.narrowed : null;
    // What the idea cites, and what its proposer found when it looked for the idea elsewhere.
    const cited = [...new Set([...said.flatMap((s) => s.evidence ?? []), ...(h.priorArt?.evidence ?? [])])];
    return {
      thread: t.id, id: ruling?.ideaId ?? t.ideaId, parentId: narrowed ? t.ideaId : null,
      title: narrowed?.title ?? h.title, originalTitle: h.title,
      proposer: seat(session, t.by), proposerRole: t.by,
      // The idea that survived is what will be tested: when the judge or the proposer gave the smaller form a kill
      // condition or a test of its own, those are its, and the first ones are history.
      hypothesis: narrowed ? { ...adopted(record, t, h), change: narrowed.change, effect: narrowed.effect, killCondition: narrowed.killCondition ?? h.hypothesis.killCondition } : adopted(record, t, h),
      originalHypothesis: h.hypothesis,
      // A bet of the invention lab: what it assumes, the riskiest of it, what it is worth if it works, where it came from.
      ...(h.assumptions ? { bet: { assumptions: h.assumptions, riskiest: h.riskiest, upside: ruling?.upside ?? h.upside, riskiestNow: ruling?.riskiest ?? null, answers: h.answers ?? null, provocation: h.provocation ?? null, cards: h.cards ?? [], amplified: Boolean(t.adopted) } } : {}), effort: h.effort, scale: narrowed?.scale ?? h.scale ?? null,
      // An invention of the lab: how a person would live it, what of the thing it grows from, and how new it is, as
      // claimed and as ruled.
      ...(h.experience ? { invention: { experience: h.experience, buildsOn: h.buildsOn, claimed: h.newTo, newTo: ruling?.newTo ?? null, feasible: ruling?.feasible ?? null } } : {}),
      // A direction of the design studio: the design its idea leads to, what it is made from as proposed, and what the
      // judge ruled on it (the swap test, what it is made from after the debate, its signature moment).
      ...(h.design ? { direction: { design: h.design, madeFrom: h.madeFrom, ...(h.whole ? { whole: h.whole } : {}), ruled: { swap: ruling?.swap ?? null, madeFrom: ruling?.madeFrom ?? null, whole: ruling?.whole ?? null, signature: ruling?.signature ?? null } } } : {}),
      where: narrowed?.where ?? h.where ?? [], novelty: t.novelty ?? null, pass: t.pass ?? 1, uncovered: h.uncovered ?? null,
      priorArt: h.priorArt ?? null,
      test: narrowed ? narrowed.test ?? said.filter((s) => s.type === 'reply' && s.by === t.by && s.narrowed?.test).at(-1)?.narrowed.test ?? h.test : h.test,
      ruling, verdict: ruling?.verdict ?? null, strength: ruling?.strength ?? null,
      statements: said, closed: t.closed, alsoCovers: (t.mergedFrom ?? []).map(titleOf),
      evidence: cited.map((id) => byId.get(id)).filter(Boolean),
      proposerEvidence: [...new Set(said.filter((s) => s.by === t.by).flatMap((s) => s.evidence ?? []))].map((id) => byId.get(id)).filter(Boolean),
    };
  });

  const order = (a, b) => SCALE_ORDER.indexOf(a.scale) - SCALE_ORDER.indexOf(b.scale) || STRENGTH_ORDER.indexOf(a.strength) - STRENGTH_ORDER.indexOf(b.strength) || EFFORT_ORDER.indexOf(a.effort) - EFFORT_ORDER.indexOf(b.effort) || Number(a.thread.slice(1)) - Number(b.thread.slice(1));
  const survivors = ideas.filter((i) => i.ruling && lived(i.ruling)).sort(order);
  const count = (v) => ideas.filter((i) => i.verdict === v).length;
  const killed = ideas.filter((i) => i.verdict === 'killed');
  const undecided = ideas.filter((i) => i.verdict === 'undecided');
  return {
    session: { id: session.id, kind: session.kind ?? 'council', goal: session.goal, url: session.url, budget: session.budget, runs: session.runs, ...(session.object ? { object: session.object } : {}), ...(session.focus ? { focus: session.focus } : {}) },
    brand: brandOf(root),
    cast: session.cast,
    ideas, survivors,
    killed, undecided,
    // A bold idea the council could not prove is still worth the owner's eye: what it would take is the conversation.
    bets: [...undecided, ...killed].filter((i) => BOLD.includes(i.scale)),
    fresh: ideas.some((i) => i.novelty) ? ideas.filter((i) => i.novelty === 'fresh').length : null,
    refused: record.threads.filter((t) => t.status === 'refused').map((t) => ({ thread: t.id, title: t.title, reason: t.refused.reason, ref: t.refused.ref ?? null })),
    merged: record.threads.filter((t) => t.status === 'merged').map((t) => ({ thread: t.id, title: t.title, into: titleOf(t.mergedInto) })),
    setNotes: (verdicts.set?.notes ?? []).map((n) => ({ ...n, ideas: n.threads.map((id) => ideas.find((i) => i.thread === id)?.title ?? id) })),
    setChanges: verdicts.set?.changes ?? [],
    setSkipped: Boolean(verdicts.set?.skipped),
    questions: record.questions.map((q) => ({ ...q, idea: ideas.find((i) => i.thread === q.thread)?.title ?? q.thread })),
    cutOff: ideas.filter((i) => i.closed?.cutOff),
    missing: evidence.missing ?? [],
    evidenceCount: evidence.entries.length,
    grades: Object.fromEntries(['measured', 'observed', 'argued'].map((g) => [g, evidence.entries.filter((e) => e.grade === g).length])),
    counts: { proposed: record.threads.length, admitted: ideas.length, survived: count('survived'), narrowed: count('narrowed'), killed: count('killed'), undecided: count('undecided') },
    trackRecord: trackRecord(ledger), ledgerSize: ledger.length,
    final: verdicts.final,
  };
}

// ---- Checks shared by both documents ----

function textErrors(value, at, min, max) {
  if (typeof value !== 'string') return [`${at}: text is required`];
  const t = one(value);
  if (t.length < min) return [`${at}: at least ${min} characters are required`];
  if (t.length > max) return [`${at}: at most ${max} characters (it has ${t.length}); say it more briefly`];
  return [];
}

// The numbers in a text, as plain digits: "1,200", "12.5%" and "16.3 s" give 1200, 12.5 and 16.3.
export function numbersIn(text) {
  return [...String(text ?? '').matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,(?=\d{3}\b)/g, '').replace(/,$/, ''));
}

// Small counts ("three attacks", written as 3) need no source; every other number must come from the record.
const free = (n) => /^\d+$/.test(n) && Number(n) <= 12;
// When something was saved is not a number of the debate: a clock reading "12:37" must not let "37" through.
const STAMPS = new Set(['at', 'savedAt', 'collectedAt', 'finalAt']);
const numbersOf = (value) => new Set(numbersIn(JSON.stringify(value, (k, v) => (STAMPS.has(k) ? undefined : v))));

function strayNumbers(text, allowed) {
  return [...new Set(numbersIn(text).filter((n) => !free(n) && !allowed.has(n)))];
}

// Effort estimates in time, and prices of the work, have no place in a council document. Waiting times of a test
// ("look after six weeks") and prices that are facts about the market are not estimates and are left alone.
const ESTIMATE_RE = /\b\d+(?:[.,]\d+)?\s*(?:hours?|hrs?|man[- ]?days?|person[- ]?days?|working days?)\b/i;

// What an idea's thread holds, for checking numbers: everything said, the evidence it cites, and the ruling.
const sourcesOf = (idea) => [idea.statements, idea.evidence, idea.ruling, idea.hypothesis, idea.test];

// ---- Links ----

// A writer names a page as a link, [the pricing page](https://…/pricing/), so the reader can open it instead of
// remembering it. Only pages the council looked at, or pages of the site itself, may be linked: an address nobody
// opened may not exist.
export const LINK_RE = /\[([^\]\n]{1,160})\]\((https?:\/\/[^\s)]+)\)/g;
export const sameUrl = (u) => { try { const x = new URL(u); return `${x.hostname.replace(/^www\./, '').toLowerCase()}${x.pathname.replace(/\/+$/, '')}${x.search}`; } catch { return String(u); } };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } };
// The words of a text without the addresses of its links: what the reader reads, and what lengths and numbers are about.
export const unlinked = (value) => (typeof value === 'string' ? value.replace(LINK_RE, '$1')
  : Array.isArray(value) ? value.map(unlinked)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unlinked(v)])) : value);
const linksIn = (value) => [...JSON.stringify(value ?? '').matchAll(LINK_RE)].map((m) => m[2]);

function linkErrors(value, at, model) {
  const site = hostOf(model.session.url);
  const known = new Set([...model.ideas.flatMap((i) => [...i.where.map((w) => w.url), ...i.evidence.map((e) => e.source)])].filter((s) => /^https?:/i.test(s ?? '')).map(sameUrl));
  return linksIn(value).filter((u) => !(site && hostOf(u) === site) && !known.has(sameUrl(u)))
    .map((u) => `${at}: the link to ${u} is to a page nobody in the session looked at. Link pages of the site, the places the ideas name, or sources in the evidence`);
}

// ---- The suggestions ----

// The decision box of each idea holds `expected`, `killCondition` and `firstStep`: they are short, so the box can be
// read at a glance. Documents saved before these limits were tightened are still printed (`strict: false`).
const SURVIVOR_TEXTS = { sentence: [20, 260], comesFrom: [20, 600], expected: [20, 320], why: [20, 450], test: [20, 600], killCondition: [10, 300], firstStep: [10, 240], upside: [20, 300] };
const { upside: _upside, ...BEFORE_UPSIDE } = SURVIVOR_TEXTS;
// Documents saved before a field was added are still printed: without what if-it-works means, and with longer texts.
const OLD_TEXTS = { ...BEFORE_UPSIDE, expected: [20, 500], why: [20, 600], killCondition: [10, 400], firstStep: [10, 300] };
// A surviving bet of the venture board: the idea, why it could work, its first step, when to drop it, what it is worth
// if it works, a press release from the day it worked and the questions a sceptic would ask about it.
export const VENTURE_SURVIVOR_TEXTS = { sentence: [20, 260], why: [20, 450], firstStep: [10, 240], killCondition: [10, 300], upside: [20, 300] };
const PRESS_TEXTS = { headline: [10, 120], subhead: [20, 240], body: [200, 1400], quote: [20, 300] };
function ventureSurvivorErrors(s, at) {
  const errors = Object.entries(VENTURE_SURVIVOR_TEXTS).flatMap(([field, [min, max]]) => textErrors(s[field], `${at}.${field}`, min, max));
  if (!s.pressRelease || typeof s.pressRelease !== 'object') errors.push(`${at}.pressRelease: the press release from the day it worked, { "headline", "subhead", "body", "quote" }`);
  else {
    for (const [field, [min, max]] of Object.entries(PRESS_TEXTS)) errors.push(...textErrors(s.pressRelease[field], `${at}.pressRelease.${field}`, min, max));
    for (const key of Object.keys(s.pressRelease)) if (!(key in PRESS_TEXTS)) errors.push(`${at}.pressRelease: unknown property "${key}"`);
  }
  if (!Array.isArray(s.faq) || s.faq.length < 2 || s.faq.length > 4) errors.push(`${at}.faq: two to four questions a sceptic would ask, each { "q", "a" }`);
  else s.faq.forEach((f, j) => errors.push(...textErrors(f?.q, `${at}.faq[${j}].q`, 10, 200), ...textErrors(f?.a, `${at}.faq[${j}].a`, 20, 500)));
  return errors;
}

// A surviving invention of the lab: what it is, how a person would live it, why it is new (what was searched, the
// closest thing found and the difference), why it could work, the smallest prototype that would show whether it does,
// the first step, when to drop it and what it is worth if it works; then, as in the council, the attacks it survived
// and what is still uncertain.
export const INVENTION_TEXTS = { sentence: [20, 260], whyNew: [20, 450], why: [20, 450], prototype: [20, 450], firstStep: [10, 240], killCondition: [10, 300], upside: [20, 300] };
function inventionSurvivorErrors(s, at) {
  const errors = Object.entries(INVENTION_TEXTS).flatMap(([field, [min, max]]) => textErrors(s[field], `${at}.${field}`, min, max));
  if (!Array.isArray(s.experience) || s.experience.length < 3 || s.experience.length > 6) errors.push(`${at}.experience: three to six steps, how a person who uses the thing would live it, in plain words for the reader`);
  else s.experience.forEach((x, j) => errors.push(...textErrors(x, `${at}.experience[${j}]`, 10, 240)));
  errors.push(...attackAnswerErrors(s, at));
  return errors;
}

// The attacks a survivor came through and what is still uncertain about it: the council's and the lab's.
function attackAnswerErrors(s, at) {
  const errors = [];
  if (!Array.isArray(s.survived) || s.survived.length < 1 || s.survived.length > 4) errors.push(`${at}.survived: one to four of the strongest attacks, each with how it was answered`);
  else s.survived.forEach((x, j) => errors.push(...textErrors(x?.attack, `${at}.survived[${j}].attack`, 15, 320), ...textErrors(x?.answer, `${at}.survived[${j}].answer`, 15, 320)));
  if (!Array.isArray(s.uncertain) || s.uncertain.length < 1 || s.uncertain.length > 5) errors.push(`${at}.uncertain: one to five things nobody could test; an idea with nothing uncertain was not examined`);
  else s.uncertain.forEach((x, j) => errors.push(...textErrors(x, `${at}.uncertain[${j}]`, 15, 320)));
  return errors;
}

// Every killed idea is analysed for the reader, not only listed with its cause of death: what it was, the best that
// could be said for it, what killed it and whether it could come back.
export const KILLED_TEXTS = { what: [20, 260], strongestPoint: [20, 300], killedBy: [20, 300], couldReturn: [15, 300] };
const SUMMARY_MAX = 600;
const MAX_PLAN = 5;

// The writer's part of the suggestions document. The script adds the rest from the model. `strict` is the check of a
// save; a document saved by an earlier version of the writer is printed without the parts it did not have.
export function validateSuggestions(doc, model, { strict = true } = {}) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return ['The result must be a JSON object'];
  if (!model.final) return ['The verdicts are not final yet; the suggestions are written after the session leaves the set'];
  const TEXTS = strict ? SURVIVOR_TEXTS : OLD_TEXTS;
  const kind = model.session.kind ?? 'council';
  errors.push(...textErrors(unlinked(doc.summary), '$.summary', 60, strict ? SUMMARY_MAX : 700), ...linkErrors(doc.summary, '$.summary', model));
  const list = Array.isArray(doc.survivors) ? doc.survivors : null;
  if (!list) return [...errors, '$.survivors: an array is required (empty when nothing survived)'];
  const seen = new Set();
  const all = numbersOf([model.ideas.map(sourcesOf), model.setNotes, model.counts]);

  list.forEach((raw, i) => {
    const at = `$.survivors[${i}]`;
    const idea = model.survivors.find((x) => x.id === raw?.idea);
    if (!idea) { errors.push(`${at}.idea: "${raw?.idea ?? ''}" is not a survivor of this session; the survivors are ${model.survivors.map((x) => x.id).join(', ') || 'none'}`); return; }
    if (seen.has(idea.id)) { errors.push(`${at}.idea: ${idea.id} appears twice`); return; }
    seen.add(idea.id);
    errors.push(...linkErrors(raw, at, model));
    // The page an idea changes is named as a link at least once, so the reader can open it.
    const linked = new Set(linksIn(raw).map(sameUrl));
    if (strict) for (const w of idea.where) if (!linked.has(sameUrl(w.url))) errors.push(`${at}: link the page this idea changes where you first name it, as [${w.part.length > 40 ? 'the page' : w.part}](${w.url}): the reader does not know the site by heart`);
    const s = unlinked(raw);
    if (kind === 'venture') errors.push(...ventureSurvivorErrors(s, at));
    else if (kind === 'lab' || kind === 'studio') errors.push(...inventionSurvivorErrors(s, at));
    else {
      for (const [field, [min, max]] of Object.entries(TEXTS)) errors.push(...textErrors(s[field], `${at}.${field}`, min, max));
      if (!strict && s.upside !== undefined) errors.push(...textErrors(s.upside, `${at}.upside`, ...SURVIVOR_TEXTS.upside));
      errors.push(...attackAnswerErrors(s, at));
    }
    if (s.needs !== undefined && (!Array.isArray(s.needs) || s.needs.length > 5)) errors.push(`${at}.needs: at most five things (access, content, a decision)`);
    else (s.needs ?? []).forEach((x, j) => errors.push(...textErrors(x, `${at}.needs[${j}]`, 5, 200)));
    if (s.fitsWith !== undefined) errors.push(...textErrors(s.fitsWith, `${at}.fitsWith`, 15, 400));
    // What only the owner can give: a decision, a sign-off, a fact, a price. Printed in the idea's decision box and
    // gathered on the second page, so the owner finds everything asked of them in one place.
    if (s.fromYou === undefined) { if (strict) errors.push(`${at}.fromYou: what this idea needs from the owner (a decision, a sign-off, a fact only they know), up to three points; [] when it needs nothing from them`); }
    else if (!Array.isArray(s.fromYou) || s.fromYou.length > 3) errors.push(`${at}.fromYou: up to three points, [] when it needs nothing from the owner`);
    else s.fromYou.forEach((x, j) => errors.push(...textErrors(x, `${at}.fromYou[${j}]`, 10, 200)));
    const keys = kind === 'venture' ? ['idea', ...Object.keys(VENTURE_SURVIVOR_TEXTS), 'pressRelease', 'faq', 'needs', 'fromYou']
      : kind === 'lab' || kind === 'studio' ? ['idea', ...Object.keys(INVENTION_TEXTS), 'experience', 'survived', 'uncertain', 'needs', 'fromYou', 'fitsWith']
        : ['idea', ...Object.keys(SURVIVOR_TEXTS), 'survived', 'uncertain', 'needs', 'fromYou', 'fitsWith'];
    for (const key of Object.keys(s)) if (!keys.includes(key)) errors.push(`${at}: unknown property "${key}"`);

    // A survivor may also draw on the set notes that name it.
    const allowed = numbersOf([sourcesOf(idea), model.setNotes.filter((n) => n.threads.includes(idea.thread))]);
    const text = JSON.stringify(s);
    const stray = strayNumbers(text, allowed);
    if (stray.length) errors.push(`${at}: the number${stray.length > 1 ? 's' : ''} ${stray.join(', ')} ${stray.length > 1 ? 'are' : 'is'} not in the debate on ${idea.id} or in the evidence it cites. Use the numbers of the record, or say it without a number`);
    if (ESTIMATE_RE.test(text)) errors.push(`${at}: "${ESTIMATE_RE.exec(text)[0]}" reads as an estimate of the work. Effort is small, medium or large, and the script prints it`);
  });
  for (const idea of model.survivors) if (!seen.has(idea.id)) errors.push(`${idea.id} "${idea.title}" survived and is missing: every survivor is reported`);

  // Every killed idea, analysed: the reader decides nothing about it, but learns what was looked at and why it fell.
  const dead = new Map(model.killed.map((k) => [k.id, k]));
  if (doc.killed === undefined) { if (strict && dead.size) errors.push(`$.killed: one entry for each killed idea (${[...dead.keys()].join(', ')}), each { "idea", "what", "strongestPoint", "killedBy", "couldReturn" }`); }
  else if (!Array.isArray(doc.killed)) errors.push('$.killed: an array is required (empty when nothing was killed)');
  else {
    const covered = new Set();
    doc.killed.forEach((raw, i) => {
      const at = `$.killed[${i}]`;
      const idea = dead.get(raw?.idea);
      if (!idea) { errors.push(`${at}.idea: "${raw?.idea ?? ''}" is not an idea killed in this session; they are ${[...dead.keys()].join(', ') || 'none'}`); return; }
      if (covered.has(idea.id)) { errors.push(`${at}.idea: ${idea.id} appears twice`); return; }
      covered.add(idea.id);
      errors.push(...linkErrors(raw, at, model));
      const k = unlinked(raw);
      for (const [field, [min, max]] of Object.entries(KILLED_TEXTS)) errors.push(...textErrors(k[field], `${at}.${field}`, min, max));
      for (const key of Object.keys(raw)) if (!['idea', ...Object.keys(KILLED_TEXTS)].includes(key)) errors.push(`${at}: unknown property "${key}"`);
      const stray = strayNumbers(JSON.stringify(k), numbersOf(sourcesOf(idea)));
      if (stray.length) errors.push(`${at}: the number${stray.length > 1 ? 's' : ''} ${stray.join(', ')} ${stray.length > 1 ? 'are' : 'is'} not in the debate on ${idea.id}`);
    });
    for (const id of dead.keys()) if (!covered.has(id)) errors.push(`$.killed: ${id} "${dead.get(id).title}" is missing: every killed idea is analysed for the reader`);
  }

  // The bold ideas that did not survive: what each would do, and what would make it worth trying.
  const bets = new Map(model.bets.map((b) => [b.id, b]));
  if (doc.bets === undefined) { if (strict && bets.size) errors.push(`$.bets: one entry for each bold idea that did not survive (${[...bets.keys()].join(', ')}), each { "idea", "sentence", "worthIt" }`); }
  else if (!Array.isArray(doc.bets)) errors.push('$.bets: an array is required (empty when no bold idea fell)');
  else {
    const covered = new Set();
    doc.bets.forEach((raw, i) => {
      const at = `$.bets[${i}]`;
      const idea = bets.get(raw?.idea);
      if (!idea) { errors.push(`${at}.idea: "${raw?.idea ?? ''}" is not a bold idea that fell in this session; they are ${[...bets.keys()].join(', ') || 'none'}`); return; }
      if (covered.has(idea.id)) { errors.push(`${at}.idea: ${idea.id} appears twice`); return; }
      covered.add(idea.id);
      errors.push(...linkErrors(raw, at, model));
      const b = unlinked(raw);
      errors.push(...textErrors(b.sentence, `${at}.sentence`, 20, 260), ...textErrors(b.worthIt, `${at}.worthIt`, 20, 400));
      for (const key of Object.keys(raw)) if (!['idea', 'sentence', 'worthIt'].includes(key)) errors.push(`${at}: unknown property "${key}"`);
      const stray = strayNumbers(JSON.stringify(b), numbersOf(sourcesOf(idea)));
      if (stray.length) errors.push(`${at}: the number${stray.length > 1 ? 's' : ''} ${stray.join(', ')} ${stray.length > 1 ? 'are' : 'is'} not in the debate on ${idea.id}`);
    });
    for (const id of bets.keys()) if (!covered.has(id)) errors.push(`$.bets: ${id} "${bets.get(id).title}" is missing: every bold idea that fell is reported with what would make it worth trying`);
  }

  const stray = strayNumbers(one(unlinked(doc.summary)), all);
  if (stray.length) errors.push(`$.summary: the number${stray.length > 1 ? 's' : ''} ${stray.join(', ')} ${stray.length > 1 ? 'are' : 'is'} not in the record`);

  // The questions for the person, in the reader's words: each one of the record is covered, none is invented.
  const asked = new Set(model.questions.map((q) => q.n));
  const covered = new Set();
  if (!Array.isArray(doc.questions)) errors.push('$.questions: an array is required (empty when the debate raised none)');
  else doc.questions.forEach((q, i) => {
    const at = `$.questions[${i}]`;
    errors.push(...textErrors(q?.text, `${at}.text`, 15, 400));
    if (!Array.isArray(q?.refs) || !q.refs.length) errors.push(`${at}.refs: the numbers of the questions in the record this stands for`);
    else for (const n of q.refs) { if (!asked.has(n)) errors.push(`${at}.refs: ${n} is not a question in the record`); covered.add(n); }
  });
  for (const q of model.questions) if (Array.isArray(doc.questions) && !covered.has(q.n)) errors.push(`Question ${q.n} (on "${q.idea}") is missing from $.questions: every open question reaches the person`);
  // Where to start: a few steps across the survivors, in order, each naming the ideas it is about. The script turns the
  // ledger ids into the numbers of this document.
  const ids = new Set(model.survivors.map((x) => x.id));
  if (doc.plan === undefined) { if (strict && ids.size) errors.push(`$.plan: one to ${MAX_PLAN} steps, in the order to take them, each { "text", "ideas": ["I21"] }`); }
  else if (!Array.isArray(doc.plan) || doc.plan.length > MAX_PLAN || (ids.size && !doc.plan.length)) errors.push(`$.plan: one to ${MAX_PLAN} steps, in the order to take them, each { "text", "ideas": ["I21"] }`);
  else doc.plan.forEach((p, i) => {
    const at = `$.plan[${i}]`;
    errors.push(...textErrors(unlinked(p?.text), `${at}.text`, 10, 220), ...linkErrors(p?.text, `${at}.text`, model));
    if (!Array.isArray(p?.ideas) || !p.ideas.length) errors.push(`${at}.ideas: the ledger ids of the survivors this step is about, such as ["I21"]`);
    else for (const id of p.ideas) if (!ids.has(id)) errors.push(`${at}.ideas: "${id}" is not a survivor of this session`);
    const stray = strayNumbers(one(unlinked(p?.text)), all);
    if (stray.length) errors.push(`${at}.text: the number${stray.length > 1 ? 's' : ''} ${stray.join(', ')} ${stray.length > 1 ? 'are' : 'is'} not in the record`);
  });
  for (const key of Object.keys(doc)) if (!['summary', 'plan', 'survivors', 'killed', 'bets', 'questions'].includes(key)) errors.push(`$: unknown property "${key}"`);
  return errors;
}

// ---- The discussion ----

// What a chapter must render: nothing that decided the idea may be left out of the minutes.
const MUST_CITE = ['hypothesis', 'attack', 'client', 'reply', 'question', 'ruling'];
const LIMITS = { title: [5, 90], opening: [80, 1300], brief: [80, 700], closing: [40, 1200], memoriam: [40, 900] };
// A chapter that runs to three pages loses its reader: twelve speeches and asides, none longer than a short paragraph.
const MAX_SCENES = 12;
const SPEECH_MAX = 750;
const RULING_MAX = 420;
const PROPOSAL_MAX = 900;
// What the record calls things, and no character in a library would.
const DEBATE_LABEL = /\b(?:[TE]\d{1,3}|attacker [A-H]|the proposer|(?:statement|attack) \d+)\b/;

// What a statement holds, for checking the numbers of a speech that renders it.
function statementSources(model, idea, refs) {
  const said = idea.statements.filter((s) => refs.includes(s.n));
  const evidence = idea.evidence.filter((e) => said.some((s) => (s.evidence ?? []).includes(e.id)));
  const ruled = said.some((s) => s.type === 'ruling') ? idea.ruling : null;
  return [said, evidence, ruled];
}

export function validateChapter(chapter, model, at = '$.chapters[0]') {
  const errors = [];
  const idea = model.ideas.find((i) => i.thread === chapter?.thread);
  if (!idea) return [`${at}.thread: "${chapter?.thread ?? ''}" is not an idea that was debated; the ideas are ${model.ideas.map((i) => i.thread).join(', ')}`];
  errors.push(...textErrors(chapter.line, `${at}.line`, 10, 150), ...textErrors(chapter.pullQuote, `${at}.pullQuote`, 20, 240));
  const scenes = Array.isArray(chapter.scenes) ? chapter.scenes : null;
  if (!scenes || scenes.length < 3 || scenes.length > MAX_SCENES) return [...errors, `${at}.scenes: three to ${MAX_SCENES} speeches and asides (it has ${scenes?.length ?? 0}); join the statements of one speaker and one round into one speech`];
  const cited = new Set();
  const speeches = [];
  scenes.forEach((scene, i) => {
    const sat = `${at}.scenes[${i}]`;
    if (scene && typeof scene.aside === 'string' && scene.speaker === undefined) {
      errors.push(...textErrors(scene.aside, `${sat}.aside`, 10, 420));
      if (/\d/.test(scene.aside)) errors.push(`${sat}.aside: an aside is the librarian's own remark and carries no numbers; put facts in a speech that cites the record`);
      return;
    }
    const who = seat({ cast: model.cast }, scene?.speaker);
    if (!who || scene.speaker === 'librarian') { errors.push(`${sat}.speaker: a seat that spoke in the debate (${model.cast.filter((s) => s.role !== 'librarian').map((s) => s.role).join(', ')}); the librarian speaks in asides`); return; }
    // The speech that puts the idea has the most to carry: what was seen, the change, the effect and what would prove it wrong.
    const opens = Array.isArray(scene.refs) && idea.statements.some((s) => s.type === 'hypothesis' && scene.refs.includes(s.n));
    errors.push(...textErrors(scene.text, `${sat}.text`, 20, opens ? PROPOSAL_MAX : SPEECH_MAX));
    const label = DEBATE_LABEL.exec(String(scene.text ?? ''));
    if (label) errors.push(`${sat}.text: "${label[0]}" is a label of the debate; a character names the person, the idea in a few words, or the thing that was seen`);
    // The judge is brief: the ruling box under the chapter says the rest.
    if (scene.speaker === 'judge' && String(scene.text ?? '').replace(/\s+/g, ' ').trim().length > RULING_MAX) errors.push(`${sat}.text: the judge's ruling is at most ${RULING_MAX} characters: the verdict and the one reason that decided it. The script prints the full ruling under the chapter`);
    if (!Array.isArray(scene.refs) || !scene.refs.length) { errors.push(`${sat}.refs: the numbers of the statements this speech renders; a speech with nothing behind it is fiction`); return; }
    for (const n of scene.refs) {
      const said = idea.statements.find((s) => s.n === n);
      if (!said) errors.push(`${sat}.refs: statement ${n} is not part of the debate on ${idea.thread}`);
      else if (said.by !== scene.speaker) errors.push(`${sat}.refs: statement ${n} was made by ${said.by}, not by ${scene.speaker}`);
      else cited.add(n);
    }
    const stray = strayNumbers(one(scene.text), numbersOf(statementSources(model, idea, scene.refs)));
    if (stray.length) errors.push(`${sat}.text: the number${stray.length > 1 ? 's' : ''} ${stray.join(', ')} ${stray.length > 1 ? 'are' : 'is'} not in the statements it renders (${scene.refs.join(', ')}). Facts stay exact`);
    speeches.push(one(scene.text));
  });
  // The ruling that stands is the last one; an earlier ruling it revised need not be rendered.
  const revised = new Set(idea.statements.filter((s) => s.revises).map((s) => s.revises));
  for (const s of idea.statements) {
    if (MUST_CITE.includes(s.type) && !revised.has(s.n) && !cited.has(s.n)) errors.push(`${at}: statement ${s.n} (${s.type} by ${s.by}) is rendered by no speech; nothing that decided the idea is left out`);
  }
  const quote = one(chapter.pullQuote).replace(/\*/g, '');
  if (quote.length >= 20 && !speeches.some((t) => t.replace(/\*/g, '').includes(quote))) errors.push(`${at}.pullQuote: it must be words taken from one of this chapter's speeches, exactly`);
  for (const key of Object.keys(chapter)) if (!['thread', 'line', 'pullQuote', 'scenes'].includes(key)) errors.push(`${at}: unknown property "${key}"`);
  return errors;
}

// The narrator saves the minutes in parts: the framing texts replace what was there, and a chapter replaces the
// chapter of the same idea. Nothing is saved when anything sent is refused.
export function mergeDiscussion(current, patch, model) {
  const errors = [];
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { errors: ['The result must be a JSON object'] };
  const next = { title: '', opening: '', closing: '', chapters: [], ...(current ?? {}) };
  next.chapters = [...next.chapters];
  for (const [field, [min, max]] of Object.entries(LIMITS)) {
    if (patch[field] === undefined) continue;
    errors.push(...textErrors(patch[field], `$.${field}`, min, max));
    if (['opening', 'brief', 'closing', 'memoriam'].includes(field) && /\d/.test(String(patch[field]).replace(/\b(1[0-9]{3}|20[0-9]{2})\b/g, ''))) errors.push(`$.${field}: the librarian's own words carry no numbers (a year is allowed); the facts are in the chapters`);
    next[field] = patch[field];
  }
  if (patch.chapters !== undefined && !Array.isArray(patch.chapters)) errors.push('$.chapters: an array is required');
  (Array.isArray(patch.chapters) ? patch.chapters : []).forEach((chapter, i) => {
    errors.push(...validateChapter(chapter, model, `$.chapters[${i}]`));
    const at = next.chapters.findIndex((c) => c.thread === chapter?.thread);
    if (at >= 0) next.chapters[at] = chapter;
    else next.chapters.push(chapter);
  });
  // The chapters are printed in the order they were first saved, unless the narrator gives the order of the evening.
  if (patch.order !== undefined) {
    const known = new Set(next.chapters.map((c) => c.thread));
    if (!Array.isArray(patch.order) || patch.order.some((id) => !known.has(id)) || new Set(patch.order).size !== patch.order.length) errors.push('$.order: the ideas of the saved chapters, each once, in the order to print them, such as ["T5", "T4"]');
    else next.chapters.sort((a, b) => { const [x, y] = [patch.order.indexOf(a.thread), patch.order.indexOf(b.thread)]; return (x < 0 ? Infinity : x) - (y < 0 ? Infinity : y); });
  }
  for (const key of Object.keys(patch)) if (!['chapters', 'order', ...Object.keys(LIMITS)].includes(key)) errors.push(`$: unknown property "${key}"`);
  return errors.length ? { errors } : { errors, discussion: next };
}

// What the minutes still lack before they can be printed.
export function discussionGaps(discussion, model) {
  if (!discussion) return ['Nothing of the discussion has been saved yet'];
  const gaps = [];
  for (const field of ['title', 'opening', 'brief', 'closing']) if (!one(discussion[field])) gaps.push(`the ${field} is missing`);
  const have = new Set((discussion.chapters ?? []).map((c) => c.thread));
  const missing = model.ideas.filter((i) => !have.has(i.thread));
  if (missing.length) gaps.push(`${missing.length} idea${missing.length > 1 ? 's have' : ' has'} no chapter: ${missing.map((i) => `${i.thread} "${i.title}"`).join('; ')}`);
  return gaps;
}

// ---- Reviews ----

const SEVERITIES = ['high', 'medium', 'low'];

// The fidelity reviewer compares the minutes with the record; the critic reads them as a person would.
export function validateReview(review, kind, { discussion }) {
  const errors = [];
  if (!review || typeof review !== 'object' || Array.isArray(review)) return ['The result must be a JSON object'];
  errors.push(...textErrors(review.verdict, '$.verdict', 10, 400));
  if (!Array.isArray(review.issues)) return [...errors, '$.issues: an array is required (empty when there is nothing to change)'];
  const chapters = new Set((discussion?.chapters ?? []).map((c) => c.thread));
  const kinds = kind === 'fidelity' ? ['invented', 'reversed', 'softened', 'dropped', 'number', 'misattributed'] : ['drags', 'forced-humour', 'hard-to-read', 'overwritten', 'flat', 'unkind', 'other'];
  review.issues.forEach((issue, i) => {
    const at = `$.issues[${i}]`;
    // "template" is for what the script prints around the writing: the cast list, the ruling boxes, the tables.
    if (!['opening', 'brief', 'closing', 'memoriam', 'title', 'template'].includes(issue?.where) && !chapters.has(issue?.where)) errors.push(`${at}.where: a chapter by its idea (such as "T5"), or opening, brief, closing, memoriam, title or template`);
    if (!kinds.includes(issue?.kind)) errors.push(`${at}.kind: one of ${kinds.join(', ')}`);
    if (!SEVERITIES.includes(issue?.severity)) errors.push(`${at}.severity: high, medium or low`);
    errors.push(...textErrors(issue?.what, `${at}.what`, 10, 500));
    if (issue?.replacement !== undefined) errors.push(...textErrors(issue.replacement, `${at}.replacement`, 5, 1600));
    // Only a chapter has scenes; the opening, the closing and the memoriam are one text each.
    if (kind === 'fidelity' && chapters.has(issue?.where) && issue?.kind !== 'dropped' && !Number.isInteger(issue?.scene)) errors.push(`${at}.scene: the position of the speech or aside in its chapter, counting from 1`);
  });
  return errors;
}

const LAYOUT_KINDS = ['overlap', 'split-box', 'empty-page', 'large-gap', 'orphan', 'overflow', 'cut-off', 'broken-text', 'inconsistent', 'unrecognisable', 'other'];

export function validateLayout(review, { doc, pages }) {
  const errors = [];
  if (!review || typeof review !== 'object' || Array.isArray(review)) return ['The result must be a JSON object'];
  if (review.doc !== doc) errors.push(`$.doc: expected "${doc}"`);
  if (!Number.isInteger(review.pagesSeen)) errors.push('$.pagesSeen: a whole number is required');
  else if (review.pagesSeen !== 0 && review.pagesSeen !== pages) errors.push(`$.pagesSeen: the document has ${pages} pages, you saw ${review.pagesSeen}; look at every page`);
  if (!Array.isArray(review.defects)) errors.push('$.defects: an array is required');
  if (review.notes !== undefined && (!Array.isArray(review.notes) || review.notes.some((n) => typeof n !== 'string'))) errors.push('$.notes: an array of strings is required');
  (Array.isArray(review.defects) ? review.defects : []).forEach((d, i) => {
    const at = `$.defects[${i}]`;
    if (!Number.isInteger(d?.page) || d.page < 1 || d.page > pages) errors.push(`${at}.page: a page number from 1 to ${pages} is required`);
    if (!LAYOUT_KINDS.includes(d?.kind)) errors.push(`${at}.kind: one of ${LAYOUT_KINDS.join(', ')}`);
    if (!SEVERITIES.includes(d?.severity)) errors.push(`${at}.severity: high, medium or low`);
    if (!['template', 'content'].includes(d?.cause)) errors.push(`${at}.cause: template or content`);
    for (const k of ['where', 'what']) if (typeof d?.[k] !== 'string' || d[k].trim().length < 3) errors.push(`${at}.${k}: a short description is required`);
  });
  return errors;
}
