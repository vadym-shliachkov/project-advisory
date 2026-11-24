import path from 'node:path';
import { readJson, writeJson } from './io.mjs';
import { takeTurn, isLab, isStudio, isVenture, isFramed } from './session.mjs';
import { UPSIDES, VENTURE_SCALES } from './frame.mjs';
import { labRulingErrors, LAB_SCALES } from './invention.mjs';
import { studioRulingErrors, cleanStudioRuling, STUDIO_SCALES } from './direction.mjs';
import { kindOf } from './paths.mjs';
import { thread, inThread, testErrors, whereErrors, cleanWhere, SCALES } from './record.mjs';
import { applyIdeas } from './ideas.mjs';

// The judge's rulings. Every admitted idea ends in exactly one of four verdicts; the red team then looks at the
// survivors as a set, and the judge may lower a few verdicts on that ground, once. Only then does the ledger learn
// the outcome, so nothing in it has to be taken back.

export const verdictsPath = (dir) => path.join(dir, 'verdicts.json');
export const loadVerdicts = (dir) => readJson(verdictsPath(dir), null) ?? { rulings: [], set: null, final: false };
export const saveVerdicts = (dir, verdicts) => writeJson(verdictsPath(dir), verdicts);

export const VERDICTS = ['survived', 'narrowed', 'killed', 'undecided'];
export const STRENGTHS = ['speculative', 'fair', 'strong'];
export const SET_KINDS = ['conflict', 'shared-assumption', 'order', 'other'];
export const MAX_SET_CHANGES = 3;
const CAUSE_MAX = 160;

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const lived = (r) => r.verdict === 'survived' || r.verdict === 'narrowed';
export const survivors = (verdicts) => verdicts.rulings.filter(lived);

function textError(value, at, min, max) {
  const t = one(value);
  if (t.length < min) return [`${at}: at least ${min} characters are required`];
  if (max && t.length > max) return [`${at}: at most ${max} characters`];
  return [];
}

// What the judge and the red team write for the reader is printed in the documents as it is. The reader did not see
// the debate, so these lines must not speak in its labels: thread and evidence ids, statement numbers, "attacker A".
// The judge's `reason` is the working note behind a ruling and may cite them.
const DEBATE_LABELS = [
  [/\bT\d{1,3}\b/, 'a thread id'],
  [/\bE\d{1,4}\b/, 'an evidence id'],
  [/\battacker [A-H]\b/i, 'a label of the debate'],
  [/\b(?:questions?|attacks?|statements?|repl(?:y|ies)|rulings?)\s+\d+\b/i, 'a statement number'],
];
function readerErrors(value, at) {
  const text = one(value);
  for (const [re, what] of DEBATE_LABELS) {
    const found = re.exec(text);
    if (found) return [`${at}: "${found[0]}" is ${what}. This line is printed for a reader who did not see the debate: name an idea by a few words of its title, and say what was seen or said instead of citing its number`];
  }
  return [];
}
// The test the proposer last gave while narrowing its idea, when it gave one.
const lastTest = (record, id) => inThread(record, id).filter((s) => s.type === 'reply' && s.by === thread(record, id)?.by && s.narrowed?.test).at(-1)?.narrowed.test;
const readerErrorsIn = (fields, at) => Object.entries(fields).flatMap(([key, value]) => (value && typeof value === 'object' ? readerErrorsIn(value, `${at}.${key}`) : readerErrors(value, `${at}.${key}`)));

// The strongest support the proposer's own evidence allows: measured for strong, observed for fair, otherwise the
// idea is speculative, worth a test and nothing more.
export function strengthAllowed(record, evidence, id) {
  const t = thread(record, id);
  const cited = new Set(inThread(record, id).filter((s) => s.by === t.by).flatMap((s) => s.evidence ?? []));
  const grades = evidence.entries.filter((e) => cited.has(e.id)).map((e) => e.grade);
  return grades.includes('measured') ? 'strong' : grades.includes('observed') ? 'fair' : 'speculative';
}

function rulingErrors(r, at, ctx) {
  const errors = [];
  if (!VERDICTS.includes(r.verdict)) return [`${at}.verdict: one of ${VERDICTS.join(', ')}`];
  errors.push(...textError(r.reason, `${at}.reason`, 20, 800));
  if (lived(r)) {
    if (!STRENGTHS.includes(r.strength)) errors.push(`${at}.strength: one of ${[...STRENGTHS].reverse().join(', ')}`);
    else {
      const allowed = strengthAllowed(ctx.record, ctx.evidence, r.thread);
      if (STRENGTHS.indexOf(r.strength) > STRENGTHS.indexOf(allowed)) {
        errors.push(`${at}.strength: the proposer's evidence on ${r.thread} supports "${allowed}" at most (strong needs measured evidence, fair needs observed)`);
      }
    }
    errors.push(...textError(r.vsDoNothing, `${at}.vsDoNothing`, 20, 400).map((e) => `${e}: say why it beats leaving the site as it is`));
  }
  if (r.verdict === 'narrowed') {
    if (!r.narrowed || typeof r.narrowed !== 'object') errors.push(`${at}.narrowed: the smaller idea that survives, as { "title", "change", "effect" }`);
    else {
      errors.push(...textError(r.narrowed.title, `${at}.narrowed.title`, 5, 90), ...textError(r.narrowed.change, `${at}.narrowed.change`, 10, 400), ...textError(r.narrowed.effect, `${at}.narrowed.effect`, 10, 400));
      // The smaller idea is the one that will be tested, so it may carry the test and the kill condition that read it.
      if (r.narrowed.killCondition !== undefined) errors.push(...textError(r.narrowed.killCondition, `${at}.narrowed.killCondition`, 10, 400));
      // A direction narrowed to its first page is an addition or an adjustment now; the documents say how far it reaches.
      const scales = isStudio(ctx.session) ? STUDIO_SCALES : isLab(ctx.session) ? LAB_SCALES : SCALES;
      if (r.narrowed.scale !== undefined && !scales.includes(r.narrowed.scale)) errors.push(`${at}.narrowed.scale: ${scales.join(', ')}`);
      // A smaller form that moved to another page, or to one part of it, says where it is now; otherwise it keeps the
      // places of the idea as proposed.
      errors.push(...whereErrors(r.narrowed.where, `${at}.narrowed.where`));
      if (r.narrowed.test !== undefined) errors.push(...testErrors(r.narrowed.test, `${at}.narrowed.test`));
      // A test left out is taken from the proposer's narrowing, which was written for the debate, not for the reader.
      else if (readerErrorsIn(lastTest(ctx.record, r.thread) ?? {}, '').length) errors.push(`${at}.narrowed.test: the test the proposer gave with the narrowing speaks in the labels of the debate; write the test of the smaller idea here, in words for a reader who did not see it`);
    }
  }
  if (r.verdict === 'killed') errors.push(...textError(r.causeOfDeath, `${at}.causeOfDeath`, 10, CAUSE_MAX).map((e) => `${e}: the cause of death, in one line`));
  if (r.verdict === 'undecided') errors.push(...textError(r.wouldDecide, `${at}.wouldDecide`, 10, 400).map((e) => `${e}: the number, the access or the answer that would decide it`));
  if (isFramed(ctx.session) && r.verdict !== 'killed') {
    if (!UPSIDES.includes(r.upside)) errors.push(`${at}.upside: what it is worth if it works: ${UPSIDES.join(', ')}`);
    errors.push(...textError(r.riskiest, `${at}.riskiest`, 10, 300).map((e) => `${e}: the assumption most likely to be false, after the debate, in words for the reader`), ...readerErrors(r.riskiest, `${at}.riskiest`));
    if (isVenture(ctx.session) && r.verdict === 'narrowed' && r.narrowed?.scale !== undefined && !VENTURE_SCALES.includes(r.narrowed.scale)) errors.push(`${at}.narrowed.scale: a bet stays new or a direction; the venture board does not narrow a bet into an edit of the site`);
  }
  if (isStudio(ctx.session)) errors.push(...studioRulingErrors(r, at), ...(r.whole ? readerErrors(r.whole, `${at}.whole`) : []));
  else if (isLab(ctx.session)) errors.push(...labRulingErrors(r, at));
  // A bet that fell, or was cut down, for reaching further than the council can test is worth the venture board's time.
  if (r.ventureCandidate !== undefined) {
    if (isFramed(ctx.session)) errors.push(`${at}.ventureCandidate: only the council hands bets to the venture board`);
    else if (typeof r.ventureCandidate !== 'boolean') errors.push(`${at}.ventureCandidate: true or false`);
    else if (r.ventureCandidate && r.verdict === 'survived') errors.push(`${at}.ventureCandidate: only an idea killed, left undecided or narrowed goes to the venture board`);
  }
  errors.push(...readerErrorsIn({
    ...(lived(r) ? { vsDoNothing: r.vsDoNothing } : {}),
    ...(r.verdict === 'narrowed' && r.narrowed && typeof r.narrowed === 'object' ? { narrowed: r.narrowed } : {}),
    ...(r.verdict === 'killed' ? { causeOfDeath: r.causeOfDeath } : {}),
    ...(r.verdict === 'undecided' ? { wouldDecide: r.wouldDecide } : {}),
  }, at));
  return errors;
}

const TEST_PARTS = ['what', 'metric', 'baseline', 'threshold', 'checkAfter'];
const cleanTest = (test) => Object.fromEntries(TEST_PARTS.filter((k) => one(test[k])).map((k) => [k, one(test[k])]));

const clean = (r) => ({
  thread: r.thread, verdict: r.verdict, reason: one(r.reason),
  ...(lived(r) ? { strength: r.strength, vsDoNothing: one(r.vsDoNothing) } : {}),
  ...(r.verdict === 'narrowed' ? { narrowed: {
    title: one(r.narrowed.title), change: one(r.narrowed.change), effect: one(r.narrowed.effect),
    ...(r.narrowed.test ? { test: cleanTest(r.narrowed.test) } : {}),
    ...(r.narrowed.killCondition ? { killCondition: one(r.narrowed.killCondition) } : {}),
    ...(r.narrowed.scale ? { scale: r.narrowed.scale } : {}),
    ...(r.narrowed.where?.length ? { where: cleanWhere(r.narrowed.where) } : {}),
  } } : {}),
  ...(r.verdict === 'killed' || (r.verdict === 'narrowed' && r.causeOfDeath) ? { causeOfDeath: one(r.causeOfDeath) } : {}),
  ...(r.verdict === 'undecided' ? { wouldDecide: one(r.wouldDecide) } : {}),
  ...(r.ventureCandidate && r.verdict !== 'survived' ? { ventureCandidate: true } : {}),
  ...(r.upside ? { upside: r.upside } : {}), ...(r.riskiest ? { riskiest: one(r.riskiest) } : {}),
  ...(r.newTo ? { newTo: r.newTo } : {}), ...(r.feasible && r.verdict !== 'killed' && r.verdict !== 'undecided' ? { feasible: r.feasible } : {}),
  // The studio's rulings: the swap test, what the direction is made from, and what becomes of its signature moment.
  ...cleanStudioRuling(r),
});

function addToRecord(record, entry) {
  const n = record.statements.reduce((max, s) => Math.max(max, s.n), 0) + 1;
  record.statements.push({ n, round: 0, at: new Date().toISOString(), evidence: [], ...entry });
  return n;
}

// One ruling per admitted idea, the cut-off ones included. Saving again replaces the rulings, until they are final.
export function saveRulings(ctx, data) {
  const { session, record, verdicts } = ctx;
  if (session.phase !== 'verdict') return { errors: [`The verdict is saved in the verdict phase; the session is in ${session.phase}`] };
  const rulings = Array.isArray(data?.rulings) ? data.rulings : null;
  if (!rulings) return { errors: ['$.rulings: an array is required'] };
  const admitted = record.threads.filter((t) => t.status === 'admitted');
  const errors = [];
  const seen = new Set();
  rulings.forEach((r, i) => {
    const at = `$.rulings[${i}]`;
    const t = thread(record, r?.thread);
    if (!t || t.status !== 'admitted') { errors.push(`${at}.thread: ${r?.thread ?? 'nothing'} is not an admitted idea`); return; }
    if (seen.has(t.id)) { errors.push(`${at}.thread: ${t.id} is ruled twice`); return; }
    seen.add(t.id);
    errors.push(...rulingErrors(r, at, ctx));
  });
  for (const t of admitted) if (!seen.has(t.id)) errors.push(`${t.id} "${t.title}" has no ruling: every admitted idea ends in one of ${VERDICTS.join(', ')}${t.closed?.cutOff ? ' (it was cut off by the budget; undecided is the honest verdict unless the thread already settles it)' : ''}`);
  if (errors.length) return { errors };

  record.statements = record.statements.filter((s) => s.type !== 'ruling');
  verdicts.rulings = rulings.map((r) => {
    const ruling = clean(r);
    ruling.n = addToRecord(record, { thread: r.thread, type: 'ruling', by: 'judge', verdict: r.verdict, text: ruling.reason });
    return ruling;
  });
  verdicts.set = null;
  takeTurn(session, 'judge');
  const count = (v) => verdicts.rulings.filter((r) => r.verdict === v).length;
  return { errors, counts: Object.fromEntries(VERDICTS.map((v) => [v, count(v)])) };
}

// The red team on the survivors as a set: what conflicts, what rests on one assumption, what order to try them in.
export function saveSetNotes(ctx, data) {
  const { session, record, verdicts } = ctx;
  if (session.phase !== 'set') return { errors: [`The survivors are looked at as a set in the set phase; the session is in ${session.phase}`] };
  const notes = Array.isArray(data?.notes) ? data.notes : null;
  if (!notes) return { errors: ['$.notes: an array is required (it may be empty when the survivors fit together)'] };
  const alive = new Set(survivors(verdicts).map((r) => r.thread));
  const errors = [];
  notes.forEach((note, i) => {
    const at = `$.notes[${i}]`;
    if (!SET_KINDS.includes(note?.kind)) errors.push(`${at}.kind: one of ${SET_KINDS.join(', ')}`);
    if (!Array.isArray(note?.threads) || !note.threads.length) errors.push(`${at}.threads: the survivors this is about`);
    else for (const id of note.threads) if (!alive.has(id)) errors.push(`${at}.threads: ${id} is not a survivor`);
    errors.push(...textError(note?.text, `${at}.text`, 20, 800), ...readerErrors(note?.text, `${at}.text`));
    if (note?.asksRuling !== undefined && typeof note.asksRuling !== 'boolean') errors.push(`${at}.asksRuling: true when the judge should look at a verdict again because of this`);
  });
  if (errors.length) return { errors };
  record.statements = record.statements.filter((s) => s.type !== 'set-note');
  verdicts.set = {
    notes: notes.map((note) => {
      const entry = { kind: note.kind, threads: note.threads, text: one(note.text), asksRuling: Boolean(note.asksRuling) };
      entry.n = addToRecord(record, { thread: null, threads: note.threads, type: 'set-note', by: 'red-team', kind: note.kind, text: entry.text });
      return entry;
    }),
    changes: null,
  };
  takeTurn(session, 'red-team');
  return { errors, notes: notes.length, asksRuling: verdicts.set.notes.some((n) => n.asksRuling) };
}

// The judge's answer to the set: at most a few verdicts lowered, each with its reason, once.
export function saveSetChanges(ctx, data) {
  const { session, record, verdicts } = ctx;
  if (session.phase !== 'set') return { errors: [`Verdicts are looked at again in the set phase; the session is in ${session.phase}`] };
  if (!verdicts.set) return { errors: ['The red team has not looked at the survivors as a set yet.'] };
  if (verdicts.set.changes) return { errors: ['The verdicts have already been looked at again; that happens once.'] };
  const changes = Array.isArray(data?.changes) ? data.changes : null;
  if (!changes) return { errors: ['$.changes: an array is required (it may be empty when every verdict stands)'] };
  if (changes.length > MAX_SET_CHANGES) return { errors: [`At most ${MAX_SET_CHANGES} verdicts can change at this stage; you sent ${changes.length}. Keep the ones the notes make necessary.`] };
  const errors = [];
  const seen = new Set();
  changes.forEach((c, i) => {
    const at = `$.changes[${i}]`;
    const before = verdicts.rulings.find((r) => r.thread === c?.thread);
    if (!before || !lived(before)) { errors.push(`${at}.thread: ${c?.thread ?? 'nothing'} is not a survivor`); return; }
    if (seen.has(c.thread)) { errors.push(`${at}.thread: ${c.thread} is changed twice`); return; }
    seen.add(c.thread);
    if (!['killed', 'undecided', 'survived'].includes(c.verdict)) { errors.push(`${at}.verdict: killed, undecided, or survived with a lower strength`); return; }
    if (c.verdict === 'survived') {
      if (!STRENGTHS.includes(c.strength) || STRENGTHS.indexOf(c.strength) >= STRENGTHS.indexOf(before.strength)) errors.push(`${at}.strength: lower than "${before.strength}"; a verdict is only lowered at this stage, never raised`);
      errors.push(...textError(c.reason, `${at}.reason`, 20, 800));
    } else errors.push(...rulingErrors({ ...c, thread: c.thread }, at, ctx));
  });
  if (errors.length) return { errors };
  verdicts.set.changes = changes.map((c) => {
    const ruling = verdicts.rulings.find((r) => r.thread === c.thread);
    ruling.revised = { from: ruling.verdict, fromStrength: ruling.strength, n: ruling.n };
    ruling.n = addToRecord(record, { thread: c.thread, type: 'ruling', by: 'judge', verdict: c.verdict, text: one(c.reason), revises: ruling.n });
    ruling.reason = one(c.reason);
    if (c.verdict === 'survived') ruling.strength = c.strength;
    else {
      // A survivor that falls here falls whole: a narrowed idea leaves no child behind.
      for (const key of ['strength', 'vsDoNothing', 'narrowed']) delete ruling[key];
      Object.assign(ruling, clean(c));
    }
    return { thread: c.thread, to: c.verdict, ...(c.verdict === 'survived' ? { strength: c.strength } : {}), reason: one(c.reason) };
  });
  takeTurn(session, 'judge');
  return { errors, changed: changes.length };
}

// Writes the final verdicts into the ledger. A narrowed idea dies as proposed and its smaller child takes its place.
export function finalise(ctx, { ideas, date } = {}) {
  const { session, record, verdicts } = ctx;
  if (verdicts.final) return { errors: [], ideas };
  const by = { by: kindOf(session), session: session.id, date };
  const ideaOf = (id) => thread(record, id).ideaId;
  const narrowed = verdicts.rulings.filter((r) => r.verdict === 'narrowed');
  // The child is the idea that will be tested, so it must not go into the ledger with a test the debate has already
  // replaced. Its test is the judge's when the ruling gives one, else the last one the proposer stated while
  // narrowing, else the one first proposed. Its kill condition is the judge's, else the one first proposed: a
  // proposer never moves its own.
  const children = applyIdeas(ideas, {
    ideas: narrowed.map((r) => {
      const parent = ideas.find((i) => i.id === ideaOf(r.thread));
      return {
        title: r.narrowed.title, goal: parent.goal, proposedBy: parent.proposedBy, parent: parent.id, effort: parent.effort,
        ...(r.narrowed.scale ?? parent.scale ? { scale: r.narrowed.scale ?? parent.scale } : {}),
        ...(parent.novelty ? { novelty: parent.novelty } : {}),
        ...(parent.priorArt ? { priorArt: parent.priorArt } : {}),
        ...(parent.origin ? { origin: parent.origin } : {}),
        ...((r.narrowed.where ?? parent.where)?.length ? { where: r.narrowed.where ?? parent.where } : {}),
        test: r.narrowed.test ?? lastTest(record, r.thread) ?? parent.test,
        hypothesis: { ...parent.hypothesis, change: r.narrowed.change, effect: r.narrowed.effect, killCondition: r.narrowed.killCondition ?? parent.hypothesis.killCondition },
      };
    }),
  }, by);
  if (children.errors.length) return { errors: children.errors, ideas };
  // The ruling shows the test and the kill condition the child took, so the documents need not look them up.
  narrowed.forEach((r, i) => {
    const child = children.saved[i];
    r.childId = child.id;
    r.narrowed = { ...r.narrowed, ...(child.test ? { test: child.test } : {}), killCondition: child.hypothesis.killCondition };
  });

  const verdict = (r) => ({ session: session.id, ...(r.strength ? { strength: r.strength, vsDoNothing: r.vsDoNothing } : {}), ...(r.upside ? { upside: r.upside } : {}), ...(r.riskiest ? { riskiest: r.riskiest } : {}), ...(r.newTo ? { newTo: r.newTo } : {}), ...(r.feasible ? { feasible: r.feasible } : {}), ...(r.swap ? { swap: r.swap } : {}), ...(r.madeFrom ? { madeFrom: r.madeFrom } : {}), ...(r.signature ? { signature: r.signature } : {}) });
  const moves = verdicts.rulings.flatMap((r) => {
    const id = ideaOf(r.thread);
    if (r.verdict === 'survived') return [{ id, status: 'survived', verdict: verdict(r) }];
    const lab = r.ventureCandidate ? { ventureCandidate: true } : {};
    if (r.verdict === 'killed') return [{ id, status: 'killed', verdict: { session: session.id, causeOfDeath: r.causeOfDeath }, ...lab }];
    if (r.verdict === 'undecided') return [{ id, status: 'undecided', verdict: { session: session.id, wouldDecide: r.wouldDecide, ...(r.upside ? { upside: r.upside } : {}), ...(r.riskiest ? { riskiest: r.riskiest } : {}) }, ...lab }];
    return [
      { id, status: 'killed', verdict: { session: session.id, causeOfDeath: r.causeOfDeath ?? `Too broad as proposed; it survived in a smaller form as ${r.childId}` }, ...lab },
      { id: r.childId, status: 'survived', verdict: verdict(r) },
    ];
  });
  const done = applyIdeas(children.ideas, { ideas: moves }, by);
  if (done.errors.length) return { errors: done.errors, ideas };
  for (const r of verdicts.rulings) r.ideaId = r.verdict === 'narrowed' ? r.childId : ideaOf(r.thread);
  verdicts.final = true;
  verdicts.finalAt = new Date().toISOString();
  return { errors: [], ideas: done.ideas };
}
