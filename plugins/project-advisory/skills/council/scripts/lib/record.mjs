import path from 'node:path';
import { readJson, writeJson } from './io.mjs';
import { maxRounds, isLab, isVenture, isFramed, debateAllowance, proposers, seat, takeTurn, turnTaken } from './session.mjs';
import { applyIdeas } from './ideas.mjs';
import { loadFrame, betErrors, cleanBet, assignAmplifiers, deal } from './frame.mjs';
import { inventionErrors, cleanInvention, LAB_SCALES, LAB_ATTACK_KINDS } from './invention.mjs';
import { loadAnatomy } from './anatomy.mjs';
import { kindOf } from './paths.mjs';
import { survivors, finalise } from './verdict.mjs';

// The record of a session: every hypothesis, restatement, attack, reply and ruling, numbered in the order it was
// saved. It is the only source for both documents, and the place where the limits of the debate are enforced: who
// may speak when, how many rounds a thread may run, and that a later round must bring something new.

export const recordPath = (dir) => path.join(dir, 'record.json');
export const loadRecord = (dir) => readJson(recordPath(dir), null) ?? { statements: [], threads: [], docket: null, questions: [] };
export const saveRecord = (dir, record) => writeJson(recordPath(dir), record);

export const ATTACK_KINDS = {
  evidence: 'the evidence is weak or reads another way',
  cost: 'it costs more than it returns',
  customer: 'the customer does not care',
  exists: 'it exists already or was tried',
  harm: 'it harms something else',
  'do-nothing': 'leaving things as they are does as well',
};
// The invention lab attacks with one kind more: the thing, as it is built, cannot do it.
export const attackKinds = (session) => (isLab(session) ? LAB_ATTACK_KINDS : ATTACK_KINDS);
const STANCES = ['refute', 'narrow', 'concede'];
const HYPOTHESIS_PARTS = ['change', 'effect', 'because', 'trigger', 'killCondition'];
const TEST_PARTS = ['what', 'metric', 'threshold', 'checkAfter'];
// What a proposer's narrower claim may carry: the claim, and the test that can read it when the one first proposed
// cannot. Never the kill condition: a proposer does not move its own. The judge sets the one that fits the smaller
// form when it rules (see verdict.mjs).
const NARROW_PARTS = ['change', 'effect', 'test'];
const MAX_PER_ROLE = 4;
// Proposing takes two passes. In the first every proposer works alone; then each sees the themes already on the table
// and brings one or two ideas on ground none of them covers. Six seats reading the same site alone proposed the same
// four themes again and again (one offer four times); the second pass is where the themes nobody thought of come from.
export const PASSES = ['first', 'second'];
const SECOND_MIN = 1;
const SECOND_MAX = 2;
const SECOND_SCALES = ['new', 'direction'];
export const passOf = (session) => (session.step === 'second' ? 2 : 1);
// The docket says whether an idea is one any adviser would give any firm like this one, or one that comes from this
// project and could not have been written without looking at it.
export const NOVELTY = ['fresh', 'familiar'];
// Where an idea applies, so a reader sees the place instead of remembering it: the page, the part of it in plain words
// and how to find that part (words shown in it, or a CSS selector). The script photographs each one after the verdicts.
const MAX_WHERE = 3;
const WHERE_SCALES = ['adjustment', 'addition', 'direction'];
// How far an idea reaches: a change to what is there, something new beside it, a remake of what is there (the site,
// the position, the offer), or something the business does not do or have at all (a product, a tool, a channel, a
// partnership, an audience). Left to themselves, proposers who start from what they saw on a page propose only the
// first kind; required to bring a direction, they remade the site and still created nothing. So every proposer
// brings at least one new thing; a direction is asked for, not enforced.
export const SCALES = ['adjustment', 'addition', 'direction', 'new'];
const SCALE_TEXT = 'adjustment (a change to what is there), addition (something new beside it), direction (a remake of what is there: the site, the position, the offer) or new (something the business does not do or have at all)';
const TEXT_MIN = 20;
const TEXT_MAX = 1200;

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const same = (a, b) => one(a).toLowerCase() === one(b).toLowerCase();
const isOpen = (t) => t.status === 'admitted' && !t.closed;

export const thread = (record, id) => record.threads.find((t) => t.id === id) ?? null;
export const openThreads = (record) => record.threads.filter(isOpen);
export const inThread = (record, id) => record.statements.filter((s) => s.thread === id);

function textErrors(s, at, { field = 'text', min = TEXT_MIN, max = TEXT_MAX } = {}) {
  const t = one(s[field]);
  if (t.length < min) return [`${at}.${field}: at least ${min} characters are required`];
  if (t.length > max) return [`${at}.${field}: at most ${max} characters; say it more briefly`];
  return [];
}

// The test of a hypothesis, or of a narrower claim: what is done, what is read, the value that counts and when to look.
export function testErrors(test, at) {
  if (!test || typeof test !== 'object' || Array.isArray(test)) return [`${at}: say the cheapest way to find out (what, metric, threshold, checkAfter)`];
  return TEST_PARTS.flatMap((part) => textErrors(test, at, { field: part, min: part === 'what' ? 10 : 2, max: 300 }));
}
const cleanTest = (test) => Object.fromEntries([...TEST_PARTS, 'baseline'].filter((k) => one(test[k])).map((k) => [k, one(test[k])]));

// The places an idea applies to. `required` when the idea changes something a reader can look at.
export function whereErrors(where, at, { required = false } = {}) {
  if (where === undefined) return required ? [`${at}: say where the idea applies, as [{ "url", "part", "text" }]: the page, the part of it in plain words, and words shown in that part so the script can find and photograph it. The reader of the documents does not know the site by heart`] : [];
  if (!Array.isArray(where) || where.length > MAX_WHERE || (required && !where.length)) return [`${at}: ${required ? 'one' : 'zero'} to ${MAX_WHERE} places, each { "url", "part", "text" } (or "selector" in place of "text")`];
  const errors = [];
  where.forEach((w, i) => {
    const wat = `${at}[${i}]`;
    if (!w || typeof w !== 'object' || Array.isArray(w)) { errors.push(`${wat}: an object is required`); return; }
    let u = null;
    try { u = new URL(w.url); } catch { /* reported below */ }
    if (!u || !/^https?:$/.test(u.protocol)) errors.push(`${wat}.url: the full address of the page, such as https://example.com/services/`);
    const part = one(w.part);
    if (part.length < 5 || part.length > 160) errors.push(`${wat}.part: the part of the page in plain words, 5 to 160 characters ("the three phases under How we work", "the whole page" for a new page's place)`);
    const text = one(w.text);
    const selector = one(w.selector);
    if (!text && !selector) errors.push(`${wat}.text: words shown in that part of the page, exactly as on the page (a heading is best), so it can be found and photographed; or a CSS "selector"`);
    if (text && (text.length < 3 || text.length > 120)) errors.push(`${wat}.text: 3 to 120 characters, copied from the page`);
    if (selector && selector.length > 200) errors.push(`${wat}.selector: at most 200 characters`);
    for (const key of Object.keys(w)) if (!['url', 'part', 'text', 'selector'].includes(key)) errors.push(`${wat}: unknown property "${key}"`);
  });
  return errors;
}
export const cleanWhere = (where) => (where ?? []).map((w) => ({ url: one(w.url), part: one(w.part), ...(one(w.text) ? { text: one(w.text) } : {}), ...(one(w.selector) ? { selector: one(w.selector) } : {}) }));

// What the proposer found when it looked for the idea elsewhere, before sending it. Ideas that already existed died in
// the debate on facts anyone could have found (a study already published at a larger scale, an offer a rival already
// sells), and spent its rounds on them. Prior art does not kill an idea, since it can show the demand is real; the
// idea says how it differs. "no" says how it was looked for: not finding is not proof of absence.
export const PRIOR_ART = ['yes', 'partly', 'no'];
const PRIOR_ART_KEYS = ['exists', 'searched', 'who', 'outcome', 'difference', 'evidence'];
export function priorArtErrors(p, at, known = null) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return [`${at}: say what you found when you looked for this idea elsewhere, as { "exists": "yes" | "partly" | "no", "searched", "who", "outcome", "difference", "evidence" }. Look before you send it: an idea that already exists dies in the debate on a fact you could have found`];
  const errors = [];
  if (!PRIOR_ART.includes(p.exists)) errors.push(`${at}.exists: yes (someone already does this), partly (something close to it) or no (nothing found)`);
  errors.push(...textErrors(p, at, { field: 'searched', min: 10, max: 300 }));
  const found = p.exists === 'yes' || p.exists === 'partly';
  if (found) {
    errors.push(...textErrors(p, at, { field: 'who', min: 3, max: 200 }), ...textErrors(p, at, { field: 'outcome', min: 10, max: 300 }), ...textErrors(p, at, { field: 'difference', min: 20, max: 400 }));
    if (!Array.isArray(p.evidence) || !p.evidence.length) errors.push(`${at}.evidence: the evidence ids of what you found (add it with the evidence command first)`);
  } else {
    for (const field of ['who', 'outcome']) if (p[field] !== undefined) errors.push(`${at}.${field}: only prior art that was found has a ${field}`);
    if (p.difference !== undefined) errors.push(...textErrors(p, at, { field: 'difference', min: 20, max: 400 }));
  }
  if (p.evidence !== undefined) {
    if (!Array.isArray(p.evidence)) errors.push(`${at}.evidence: an array of evidence ids such as ["E3"]`);
    else if (known) for (const id of p.evidence) if (!known.has(id)) errors.push(`${at}.evidence: there is no evidence ${id}; add it with the evidence command first`);
  }
  for (const key of Object.keys(p)) if (!PRIOR_ART_KEYS.includes(key)) errors.push(`${at}: unknown property "${key}"`);
  return errors;
}
export const cleanPriorArt = (p) => ({
  exists: p.exists, searched: one(p.searched),
  ...Object.fromEntries(['who', 'outcome', 'difference'].filter((k) => one(p[k])).map((k) => [k, one(p[k])])),
  ...(p.evidence?.length ? { evidence: [...p.evidence] } : {}),
});

// A question put to the proposer: raised on the thread by somebody else. The proposer's own questions go to the
// person and change nothing in the debate.
const putToProposer = (record, s) => s.type === 'question' && s.by !== thread(record, s.thread)?.by;
// What a proposer may answer in a round: the attacks, the customer's voice and the questions put to it.
const toAnswer = (record, id, round) => inThread(record, id).filter((s) => s.round === round && (['attack', 'client'].includes(s.type) || putToProposer(record, s)));

function evidenceErrors(s, at, known) {
  if (s.evidence === undefined) return [];
  if (!Array.isArray(s.evidence)) return [`${at}.evidence: an array of evidence ids such as ["E3"] is required`];
  return s.evidence.filter((id) => !known.has(id)).map((id) => `${at}.evidence: there is no evidence ${id}; add it with the evidence command first`);
}

// Evidence ids a statement cites that nobody in its thread has cited before.
const freshEvidence = (record, s) => {
  const used = new Set(inThread(record, s.thread).flatMap((x) => x.evidence ?? []));
  return (s.evidence ?? []).filter((id) => !used.has(id));
};

const lastReply = (record, id, round) => inThread(record, id).find((s) => s.type === 'reply' && s.round === round) ?? null;

function close(t, round, reason, extra = {}) {
  if (!t.closed) t.closed = { round, reason, ...extra };
}

// Who attacks a thread besides the red team: one other proposing role, never its own proposer and never the client
// (who speaks for the customer on every thread), spread evenly.
export function assignAttackers(session, record) {
  const pool = proposers(session).filter((r) => r !== 'client');
  const load = Object.fromEntries(pool.map((r) => [r, 0]));
  const out = {};
  openThreads(record).forEach((t, n) => {
    const candidates = pool.filter((r) => r !== t.by);
    if (!candidates.length) return;
    const fewest = Math.min(...candidates.map((r) => load[r]));
    const rotated = [...candidates.slice(n % candidates.length), ...candidates.slice(0, n % candidates.length)];
    const pick = rotated.find((r) => load[r] === fewest);
    out[t.id] = pick;
    load[pick] += 1;
  });
  return out;
}

// The threads a role speaks on in the current step, and so whether it has a turn at all.
// In round one a seat is given every idea that is not its own. The assignment only says which ideas it must cover;
// on the others it speaks when its ground sees what nobody else at the table will (the competitor seat on an idea
// that breaks a habit every rival keeps). Handed only its share, the seat that knew the decisive fact never saw the
// idea it decided.
export function threadsFor(session, record, role) {
  const open = openThreads(record);
  if (session.phase === 'amplify') return record.threads.filter((t) => session.assignments?.[t.id] === role);
  if (session.phase !== 'examine') return [];
  if (session.step === 'attack') {
    if (role === 'red-team') return open;
    // In the venture board only the sceptic and the customer's voice attack: the seats built on each other's bets
    // instead. The invention lab debates as the council does: every seat attacks in the first round.
    if (isVenture(session) && role !== 'client') return [];
    if (session.round > 1) return [];
    if (role === 'client') return open.filter((t) => t.by !== 'client');
    if (!proposers(session).includes(role)) return [];
    return open.filter((t) => t.by !== role);
  }
  return open.filter((t) => t.by === role && toAnswer(record, t.id, session.round).length);
}

// The roles whose turn it is in the current step.
export function turns(session, record, verdicts = null) {
  const list = [];
  const add = (role, threads = [], extra = {}) => {
    const s = seat(session, role);
    list.push({ role, name: s?.name ?? role, model: s?.model ?? 'standard', threads: threads.map((t) => t.id), done: turnTaken(session, role), ...extra });
  };
  if (session.phase === 'evidence' && isLab(session)) {
    // The invention lab studies the thing itself: its anatomy (required: nothing can be invented for a thing nobody
    // has looked at), the standard kit of its genre, what the people who use it say, and what has become possible.
    const reused = new Set(session.reused ?? []);
    const done = (role, kind = role) => (reused.has(kind) ? { done: true, reused: true } : {});
    list.push({ role: 'anatomist', name: 'the anatomist', model: 'strongest', threads: [], done: turnTaken(session, 'anatomist'), ...done('anatomist', 'anatomy') });
    list.push({ role: 'genre', name: 'the genre scout', model: 'strongest', threads: [], done: turnTaken(session, 'genre'), optional: true, ...done('genre') });
    list.push({ role: 'voice', name: 'the voice scout', model: 'standard', threads: [], done: turnTaken(session, 'voice'), optional: true, ...done('voice') });
    list.push({ role: 'tech', name: 'the tech scan', model: 'standard', threads: [], done: turnTaken(session, 'tech'), optional: true, ...done('tech') });
  }
  // At the study the person reads what the lab understood; what they correct, the anatomist revises.
  if (session.phase === 'study' && session.study?.pending) list.push({ role: 'anatomist', name: 'the anatomist, to revise the anatomy', model: 'strongest', threads: [], done: false });
  if (session.phase === 'evidence' && !isLab(session)) {
    // Groundwork an earlier session left fresh in the knowledge bank is taken in at the collection: its turn is done.
    const reused = new Set(session.reused ?? []);
    const done = (role) => (reused.has(role) ? { done: true, reused: true } : {});
    // The primer is not a seat either: it learns how the trade works, so the proposers start from what insiders know.
    list.push({ role: 'primer', name: 'the domain primer', model: 'strongest', threads: [], done: turnTaken(session, 'primer'), optional: true, ...done('primer') });
    add('competitors', [], { name: 'the competitor analyst', optional: true, ...done('competitors') });
    // The horizon scan is not a seat: it looks outside the site, at what is changing around the business.
    list.push({ role: 'horizon', name: 'the horizon scan', model: 'strongest', threads: [], done: turnTaken(session, 'horizon'), optional: true, ...done('horizon') });
  }
  // Ideas are where the strongest model pays most: a weaker one proposes the familiar. In the debate the seats keep
  // their own models, so the room does not argue with one voice.
  if (session.phase === 'propose') for (const role of proposers(session)) add(role, [], { model: 'strongest' });
  if (session.phase === 'frame') {
    // The framer is not a seat: it sets the problem. The provocateur is, and proposes afterwards like the others.
    if (session.step === 'frame') list.push({ role: 'framer', name: 'the framer', model: 'strongest', threads: [], done: turnTaken(session, 'framer') });
    else add('provocateur', [], { model: 'strongest' });
  }
  if (session.phase === 'amplify') for (const role of proposers(session)) { const mine = threadsFor(session, record, role); if (mine.length) add(role, mine); }
  if (session.phase === 'docket' || session.phase === 'verdict') add('judge');
  if (session.phase === 'set') {
    add('red-team');
    // The judge looks again only when the red team asks for it.
    if (verdicts?.set?.notes.some((n) => n.asksRuling)) list.push({ ...list.pop(), done: true }, { role: 'judge', name: seat(session, 'judge')?.name ?? 'judge', model: seat(session, 'judge')?.model ?? 'standard', threads: [], done: Boolean(verdicts.set.changes) });
  }
  if (session.phase === 'examine') {
    const roles = session.step === 'attack' ? (isVenture(session) ? ['red-team', 'client'] : ['red-team', 'client', ...proposers(session).filter((r) => r !== 'client')]) : proposers(session);
    for (const role of roles) {
      const mine = threadsFor(session, record, role);
      if (mine.length) add(role, mine);
    }
  }
  // The debate cannot start more members than it has runs left (context refuses the rest), so no more turns not yet
  // taken are listed than that, in the order above: the session moves on with what was said. A member already started
  // was paid for and stays listed until it saves. The judge's docket is never dropped.
  if (!SPENDING.includes(session.phase)) return list;
  let room = Math.max(0, debateAllowance(session) - session.runs);
  return list.filter((t) => t.done || t.role === 'judge' || started(session, t.role) || room-- > 0);
}

const SPENDING = ['evidence', 'study', 'frame', 'propose', 'amplify', 'examine'];
export const debateSpent = (session) => SPENDING.includes(session.phase) && session.runs >= debateAllowance(session);
// Whether a role's context for the current step was printed already, and so its run counted.
const started = (session, role) => (session.log ?? []).some((l) => l.role === role && l.phase === session.phase && l.round === session.round && l.step === session.step);

// ---- Saving statements ----

function checkHypothesis(s, at, ctx, role) {
  const { session } = ctx;
  const errors = [];
  if (session.phase !== 'propose') return [`${at}: hypotheses are proposed in the propose phase; the session is in ${session.phase}`];
  if (!proposers(session).includes(role)) return [`${at}: ${role} does not propose ideas`];
  errors.push(...textErrors(s, at, { field: 'title', min: 5, max: 90 }));
  if (!s.hypothesis || typeof s.hypothesis !== 'object') return [...errors, `${at}.hypothesis: change, effect, because, trigger and killCondition are required`];
  for (const part of HYPOTHESIS_PARTS) errors.push(...textErrors(s.hypothesis, `${at}.hypothesis`, { field: part, min: 10, max: 400 }));
  for (const key of Object.keys(s.hypothesis)) if (!HYPOTHESIS_PARTS.includes(key)) errors.push(`${at}.hypothesis: unknown property "${key}"`);
  errors.push(...testErrors(s.test, `${at}.test`));
  if (!['small', 'medium', 'large'].includes(s.effort)) errors.push(`${at}.effort: small, medium or large`);
  if (!isLab(session) && !SCALES.includes(s.scale)) errors.push(`${at}.scale: ${SCALE_TEXT}`);
  errors.push(...whereErrors(s.where, `${at}.where`, { required: !isFramed(session) && WHERE_SCALES.includes(s.scale) }));
  errors.push(...priorArtErrors(s.priorArt, `${at}.priorArt`, new Set(ctx.evidence.entries.map((e) => e.id))));
  if (isLab(session)) {
    errors.push(...inventionErrors(s, at, { session, frame: loadFrame(ctx.dir), anatomy: loadAnatomy(ctx.dir), pass: passOf(session), role }));
    if (s.uncovered !== undefined) errors.push(`${at}.uncovered: an invention says where it comes from with "answers" or "provocation"`);
  } else if (isVenture(session)) {
    errors.push(...betErrors(s, at, { session, frame: loadFrame(ctx.dir), pass: passOf(session), role }));
    if (s.uncovered !== undefined) errors.push(`${at}.uncovered: a bet of the venture board says where it comes from with "answers" or "provocation"`);
  } else if (passOf(session) === 2) {
    if (SCALES.includes(s.scale) && !SECOND_SCALES.includes(s.scale)) errors.push(`${at}.scale: in the second pass an idea is new or a direction: something the business does not do yet, or a remake of what it has`);
    const uncovered = one(s.uncovered);
    if (uncovered.length < 20 || uncovered.length > 300) errors.push(`${at}.uncovered: in one or two sentences (20 to 300 characters), what this idea covers that none of the ideas already on the table does`);
  } else if (s.uncovered !== undefined) errors.push(`${at}.uncovered: only an idea of the second pass says what it covers that the others do not`);
  if (s.returns !== undefined && !/^I\d{1,4}$/.test(s.returns)) errors.push(`${at}.returns: the ledger id of the idea this brings back, such as I7`);
  if (s.returns && one(s.whatChanged).length < 10) errors.push(`${at}.whatChanged: say what is different since ${s.returns} was decided`);
  return errors;
}

function checkAttackStep(s, at, ctx, role) {
  const { session, record } = ctx;
  const t = thread(record, s.thread);
  const errors = [];
  const mine = threadsFor(session, record, role).some((x) => x.id === s.thread);
  if (!mine) {
    const why = role === 'red-team' ? 'it is closed or was not admitted'
      : session.round > 1 ? 'from round two only the red team presses a thread'
        : 'it is closed, or it is your own idea';
    return [`${at}: ${role} does not speak on ${s.thread} in this step: ${why}`];
  }
  if (s.type === 'client') {
    if (role !== 'client') return [`${at}: only the client's voice gives a client statement`];
    if (!['yes', 'no', 'unsure'].includes(s.cares)) errors.push(`${at}.cares: yes, no or unsure: would a customer notice or care?`);
    if (inThread(record, s.thread).some((x) => x.type === 'client' && !same(x.text, s.text))) errors.push(`${at}: the client has already spoken on ${s.thread}`);
    return errors;
  }
  if (role === 'client') return [`${at}: the client's voice gives a "client" statement, not a ${s.type}`];
  if (s.type === 'steelman') {
    if (session.round !== 1) return [`${at}: the restatement belongs to round one`];
    if (inThread(record, s.thread).some((x) => x.type === 'steelman' && x.by === role && !same(x.text, s.text))) errors.push(`${at}: ${role} has already restated ${s.thread}`);
    return errors;
  }
  // attack
  if (!Object.hasOwn(attackKinds(session), s.kind)) errors.push(`${at}.kind: one of ${Object.keys(attackKinds(session)).join(', ')}`);
  // In the lab an attack may name the assumption it is on; it need not.
  if (isLab(session) && s.assumption !== undefined) {
    const h = record.statements.find((x) => x.thread === s.thread && x.type === 'hypothesis');
    if (!Number.isInteger(s.assumption) || s.assumption < 0 || s.assumption >= (h?.assumptions?.length ?? 0)) errors.push(`${at}.assumption: the position (from 0) of the assumption this attack is on; leave it out when the attack is on the invention as a whole`);
  }
  if (isVenture(session) && role === 'red-team') {
    const h = record.statements.find((x) => x.thread === s.thread && x.type === 'hypothesis');
    const count = h?.assumptions?.length ?? 0;
    if (!Number.isInteger(s.assumption) || s.assumption < 0 || s.assumption >= count) errors.push(`${at}.assumption: the position (from 0) of the assumption this attack is on; ${t.id} rests on ${count}. In the venture board an attack is on what a bet assumes, never on the bet as a whole`);
  }
  if (role === 'red-team' && session.round === 1 && !ctx.pending.some((x) => x.type === 'steelman' && x.thread === s.thread)
    && !inThread(record, s.thread).some((x) => x.type === 'steelman' && x.by === 'red-team')) {
    errors.push(`${at}: restate ${t.id} in its strongest form first (a "steelman" statement before the attack)`);
  }
  return errors;
}

function checkReplyStep(s, at, ctx, role) {
  const { session, record } = ctx;
  const t = thread(record, s.thread);
  const errors = [];
  if (t.by !== role) return [`${at}: only ${t.by}, who proposed ${t.id}, replies on it`];
  if (!isOpen(t)) return [`${at}: ${t.id} is closed (${t.closed?.reason ?? t.status})`];
  if (s.type === 'steelman-reply') {
    if (session.round !== 1) return [`${at}: the restatement is accepted or corrected in round one, once`];
    if (typeof s.accepts !== 'boolean') errors.push(`${at}.accepts: true when the restatement is fair, false with a correction in "text"`);
    if (inThread(record, s.thread).some((x) => x.type === 'steelman-reply' && !same(x.text, s.text))) errors.push(`${at}: the restatement of ${t.id} has already been answered`);
    return errors;
  }
  // reply
  if (!STANCES.includes(s.stance)) errors.push(`${at}.stance: refute, narrow or concede`);
  const attacks = toAnswer(record, s.thread, session.round);
  if (!attacks.length) errors.push(`${at}: nobody attacked ${t.id} in this round, so there is nothing to reply to`);
  if (!Array.isArray(s.to) || !s.to.length) errors.push(`${at}.to: the numbers of the statements this answers, such as [14, 15]`);
  else for (const n of s.to) if (!attacks.some((x) => x.n === n)) errors.push(`${at}.to: ${n} is not an attack on ${t.id} in this round`);
  const earlier = lastReply(record, s.thread, session.round);
  if (earlier && !same(earlier.text, s.text)) errors.push(`${at}: ${t.id} already has its reply for this round`);
  if (s.stance === 'narrow') {
    if (!s.narrowed || typeof s.narrowed !== 'object') errors.push(`${at}.narrowed: the narrower claim, as { "change", "effect" }`);
    else {
      for (const part of ['change', 'effect']) errors.push(...textErrors(s.narrowed, `${at}.narrowed`, { field: part, min: 10, max: 400 }));
      // The test that reads the smaller claim is said in the open, where it can be attacked, not in passing in the text.
      if (s.narrowed.test !== undefined) errors.push(...testErrors(s.narrowed.test, `${at}.narrowed.test`));
      for (const key of Object.keys(s.narrowed)) {
        if (key === 'killCondition') errors.push(`${at}.narrowed: the kill condition stays as it was proposed; you cannot move your own. When it no longer fits the smaller claim, say so in your text: the judge sets the one that does`);
        else if (!NARROW_PARTS.includes(key)) errors.push(`${at}.narrowed: unknown property "${key}"; a narrower claim is "change" and "effect", with "test" when the smaller claim cannot be read by the test you proposed`);
      }
    }
  } else if (s.narrowed !== undefined) errors.push(`${at}.narrowed: only a reply with the stance "narrow" carries a narrower claim`);
  return errors;
}

// A seat makes another's bet bigger: "yes, and", never "but". The bigger form is a change, its effect and why; the
// judge may adopt it at the docket.
function amplifyErrors(s, at, ctx, role) {
  const { session, record } = ctx;
  const errors = [...textErrors(s, at)];
  if (session.assignments?.[s.thread] !== role) return [`${at}: ${s.thread} was not given to you to build on`];
  if (record.statements.some((x) => x.type === 'amplify' && x.thread === s.thread && x.by === role)) errors.push(`${at}: you have already built on ${s.thread}`);
  if (!s.bigger || typeof s.bigger !== 'object') errors.push(`${at}.bigger: the bigger bet, as { "change", "effect", "because" }`);
  else for (const part of ['change', 'effect', 'because']) errors.push(...textErrors(s.bigger, `${at}.bigger`, { field: part, min: 10, max: 400 }));
  return errors;
}

// Saves one agent's statements. Either all of them are saved or none. A repeated statement (an agent that retries
// its save) is accepted without being added, so it cannot spend a turn twice.
export function say(ctx, role, statements, { now = () => new Date().toISOString() } = {}) {
  const { session, record, evidence } = ctx;
  const errors = [];
  const warnings = [];
  if (!seat(session, role)) return { errors: [`Unknown or missing --role "${role ?? ''}". The cast: ${session.cast.map((s) => s.role).join(', ')}`], warnings };
  if (!Array.isArray(statements)) return { errors: ['$.statements: an array is required (it may be empty when you have nothing to say)'], warnings };
  if (!['propose', 'examine', 'amplify'].includes(session.phase)) return { errors: [`Nothing is said in the ${session.phase} phase; see the status command for the next step`], warnings };
  const known = new Set(evidence.entries.map((e) => e.id));
  const types = session.phase === 'propose' ? ['hypothesis'] : session.phase === 'amplify' ? ['amplify'] : session.step === 'attack' ? ['steelman', 'attack', 'client', 'question'] : ['steelman-reply', 'reply', 'question'];

  const pending = [];
  let repeated = 0;
  statements.forEach((s, i) => {
    const at = `$.statements[${i}]`;
    if (!s || typeof s !== 'object' || Array.isArray(s)) { errors.push(`${at}: an object is required`); return; }
    if (!types.includes(s.type)) { errors.push(`${at}.type: in this step (${session.phase}${session.step ? `, ${session.step}` : ''}) a statement is one of ${types.join(', ')}`); return; }
    const before = errors.length;
    if (s.type === 'hypothesis') {
      const again = record.threads.find((t) => t.by === role && same(t.title, s.title));
      if (again) {
        const first = record.statements.find((x) => x.thread === again.id && x.type === 'hypothesis');
        if (JSON.stringify(first.hypothesis) === JSON.stringify(s.hypothesis)) { repeated += 1; return; }
        errors.push(`${at}: you have already proposed "${again.title}" (${again.id}); a hypothesis cannot be rewritten once it is on the table`);
        return;
      }
      errors.push(...checkHypothesis(s, at, ctx, role), ...evidenceErrors(s, at, known));
      if (errors.length === before) pending.push({ ...s, thread: null });
      return;
    }
    const t = thread(record, s.thread);
    if (!t) { errors.push(`${at}.thread: there is no thread ${s.thread ?? ''}`); return; }
    if (record.statements.some((x) => x.thread === s.thread && x.by === role && x.type === s.type && x.round === session.round && same(x.text, s.text))) { repeated += 1; return; }
    if (s.type === 'amplify') {
      errors.push(...amplifyErrors(s, at, ctx, role), ...evidenceErrors(s, at, known));
      if (errors.length === before) pending.push(s);
      return;
    }
    if (!isOpen(t)) { errors.push(`${at}: ${t.id} is closed (${t.closed?.reason ?? t.status}); nothing more is said on it`); return; }
    errors.push(...textErrors(s, at), ...evidenceErrors(s, at, known));
    if (s.type === 'question') {
      if (!threadsFor(session, record, role).some((x) => x.id === s.thread)) errors.push(`${at}: ${role} does not speak on ${s.thread} in this step`);
      if (!['person', 'data'].includes(s.for)) errors.push(`${at}.for: "person" when only the people who run the project can answer, "data" when a number would`);
    } else if (session.step === 'attack') errors.push(...checkAttackStep(s, at, { ...ctx, pending }, role));
    else errors.push(...checkReplyStep(s, at, ctx, role));
    if (errors.length === before) pending.push(s);
  });
  // A seat that skips an idea it was given to cover leaves that idea with the red team alone.
  if (session.phase === 'examine' && session.step === 'attack' && session.round === 1 && !['red-team', 'client'].includes(role)) {
    const spoke = (id) => [...pending, ...record.statements.filter((x) => x.by === role && x.round === 1)].some((x) => x.thread === id && ['attack', 'question'].includes(x.type));
    const skipped = openThreads(record).filter((t) => session.assignments[t.id] === role && !spoke(t.id)).map((t) => t.id);
    if (skipped.length) warnings.push(`You were given ${skipped.join(', ')} to cover and said nothing on ${skipped.length > 1 ? 'them' : 'it'}: make your objection, or an attack starting "This holds:", and save again.`);
  }
  if (session.phase === 'propose' && passOf(session) === 1) {
    const have = record.threads.filter((t) => t.by === role && (t.pass ?? 1) === 1).length;
    if (have + pending.length > MAX_PER_ROLE) errors.push(`At most ${MAX_PER_ROLE} hypotheses per role: you have ${have} and sent ${pending.length} more. Keep the strongest.`);
    const scales = [...record.statements.filter((x) => x.type === 'hypothesis' && x.by === role).map((x) => x.scale), ...pending.map((x) => x.scale)];
    if (pending.length && !isFramed(session) && !scales.includes('new')) errors.push('At least one of your hypotheses is new: something the business does not do or have at all (a product, a tool, a channel, a partnership, an audience; see "Range" in your instructions), with a first step cheap enough to test. Replace your weakest idea with one, or send it with the others.');
  }
  if (session.phase === 'propose' && passOf(session) === 2) {
    const have = record.threads.filter((t) => t.by === role && t.pass === 2).length;
    if (have + pending.length < SECOND_MIN && !repeated) errors.push(isFramed(session) ? `The second pass asks for at least ${SECOND_MIN} ${isLab(session) ? 'invention' : 'bet'} harvested from a provocation: see "The second pass" in your instructions.` : `The second pass asks for at least ${SECOND_MIN} idea on ground none of the ideas on the table covers. Look where nobody looked: see "The second pass" in your instructions.`);
    if (have + pending.length > SECOND_MAX) errors.push(`At most ${SECOND_MAX} ideas in the second pass: you have ${have} and sent ${pending.length} more. Keep the furthest from what is on the table.`);
  }
  if (errors.length) return { errors, warnings };

  // From round two an attack needs new evidence, unless the proposer has just narrowed the claim: a new claim is new
  // ground. It is judged over everything the role says on the thread in this save, not statement by statement.
  const stale = new Set();
  if (session.round > 1) {
    for (const id of new Set(pending.filter((s) => s.type === 'attack').map((s) => s.thread))) {
      const fresh = pending.filter((s) => s.type === 'attack' && s.thread === id).some((s) => freshEvidence(record, s).length);
      if (!fresh && lastReply(record, id, session.round - 1)?.stance !== 'narrow') stale.add(id);
    }
  }

  const added = [];
  const closed = [];
  let n = record.statements.reduce((max, s) => Math.max(max, s.n), 0);
  for (const s of pending) {
    const base = { n: ++n, type: s.type, by: role, round: session.round, at: now(), evidence: s.evidence ?? [] };
    if (s.type === 'hypothesis') {
      const id = `T${record.threads.reduce((max, t) => Math.max(max, Number(t.id.slice(1))), 0) + 1}`;
      const pass = passOf(session);
      record.threads.push({ id, by: role, title: one(s.title), status: 'proposed', closed: null, ...(pass === 2 ? { pass } : {}) });
      record.statements.push({
        ...base, thread: id, title: one(s.title), hypothesis: Object.fromEntries(HYPOTHESIS_PARTS.map((p) => [p, one(s.hypothesis[p])])),
        test: Object.fromEntries(Object.entries(s.test).map(([k, v]) => [k, one(v)])), effort: s.effort, scale: s.scale,
        ...(s.where?.length ? { where: cleanWhere(s.where) } : {}),
        priorArt: cleanPriorArt(s.priorArt),
        ...(isLab(session) ? cleanInvention(s) : isVenture(session) ? cleanBet(s) : {}),
        ...(pass === 2 && !isFramed(session) ? { pass, uncovered: one(s.uncovered) } : pass === 2 ? { pass } : {}),
        ...(s.returns ? { returns: s.returns, whatChanged: one(s.whatChanged) } : {}),
      });
      added.push({ n, thread: id, type: s.type });
      continue;
    }
    const t = thread(record, s.thread);
    const entry = { ...base, thread: s.thread, text: one(s.text) };
    const fresh = freshEvidence(record, s);
    if (s.type === 'amplify') entry.bigger = Object.fromEntries(['change', 'effect', 'because'].map((k) => [k, one(s.bigger[k])]));
    if (s.type === 'attack') {
      entry.kind = s.kind;
      if (Number.isInteger(s.assumption)) entry.assumption = s.assumption;
      if (stale.has(s.thread)) {
        entry.nothingNew = true;
        close(t, session.round, 'nothing new from the attack');
      }
    }
    if (s.type === 'client') entry.cares = s.cares;
    if (s.type === 'steelman-reply') entry.accepts = s.accepts;
    if (s.type === 'reply') {
      entry.stance = s.stance;
      entry.to = s.to;
      if (s.stance === 'narrow') {
        entry.narrowed = {
          change: one(s.narrowed.change), effect: one(s.narrowed.effect),
          ...(s.narrowed.test ? { test: cleanTest(s.narrowed.test) } : {}),
        };
      }
      const unanswered = inThread(record, s.thread).filter((x) => x.round === session.round && x.type === 'attack' && !s.to.includes(x.n));
      if (unanswered.length) warnings.push(`${t.id}: attack${unanswered.length > 1 ? 's' : ''} ${unanswered.map((x) => x.n).join(', ')} got no answer; the judge will see that`);
      // A question the proposer answers by looking, with evidence, is no longer one for the person.
      const asked = record.questions.filter((q) => q.thread === s.thread && q.by !== role && s.to.includes(q.n));
      if (asked.length && s.stance !== 'concede') {
        if (!entry.evidence.length) warnings.push(`${t.id}: question${asked.length > 1 ? 's' : ''} ${asked.map((q) => q.n).join(', ')} stay${asked.length > 1 ? '' : 's'} open for the person; a question is answered by looking, so the reply that answers it cites evidence`);
        else {
          for (const q of asked) {
            record.statements.find((x) => x.n === q.n).answeredBy = n;
            (record.answered ??= []).push({ ...q, answeredBy: n });
          }
          record.questions = record.questions.filter((q) => !asked.includes(q));
        }
      }
      if (s.stance === 'concede') close(t, session.round, 'conceded');
      else if (session.round > 1 && s.stance === 'refute' && !fresh.length) {
        entry.nothingNew = true;
        close(t, session.round, 'nothing new from the reply');
      }
    }
    // A question goes to the person. It does not close the thread here: everyone who has a turn in this round still
    // speaks, and the proposer may answer it. See advance() for when a question that stands ends a thread.
    if (s.type === 'question') {
      entry.for = s.for;
      record.questions.push({ n, thread: s.thread, for: s.for, text: entry.text, by: role });
    }
    record.statements.push(entry);
    added.push({ n, thread: s.thread, type: s.type });
    if (t.closed && !closed.some((c) => c.thread === t.id)) closed.push({ thread: t.id, reason: t.closed.reason });
  }
  takeTurn(session, role);
  if (session.phase === 'propose' && record.threads.filter((t) => t.by === role).length < 2) warnings.push(`${role} has proposed fewer than two hypotheses`);
  return { errors, warnings, added, repeated, closed };
}

// ---- The docket ----

// The judge's list before the debate: which ideas are admitted (with the ones merged into them), and which are turned
// away because a rule forbids them, the roadmap already plans them or an earlier session settled them. Admitted ideas
// enter the ledger here, which refuses one that returns from the dead without saying what changed.
export function saveDocket(ctx, docket, { ideas, date } = {}) {
  const { session, record } = ctx;
  const errors = [];
  if (session.phase !== 'docket') return { errors: [`The docket is saved in the docket phase; the session is in ${session.phase}`] };
  const admitted = Array.isArray(docket?.admitted) ? docket.admitted : null;
  const refused = Array.isArray(docket?.refused) ? docket.refused : [];
  if (!admitted) return { errors: ['$.admitted: an array is required (it may be empty)'] };
  const seen = new Map();
  const note = (id, at, as) => {
    if (!thread(record, id)) { errors.push(`${at}: there is no thread ${id ?? ''}`); return; }
    if (seen.has(id)) errors.push(`${at}: ${id} is already listed as ${seen.get(id)}`);
    seen.set(id, as);
  };
  admitted.forEach((a, i) => {
    note(a?.thread, `$.admitted[${i}].thread`, 'admitted');
    (a?.merge ?? []).forEach((m, j) => note(m, `$.admitted[${i}].merge[${j}]`, `merged into ${a.thread}`));
    if (a?.returns !== undefined && !/^I\d{1,4}$/.test(a.returns)) errors.push(`$.admitted[${i}].returns: a ledger id such as I7`);
    if (a?.adopt !== undefined) {
      const amp = record.statements.find((s) => s.n === a.adopt);
      if (!isFramed(session)) errors.push(`$.admitted[${i}].adopt: only the venture board and the invention lab adopt an amplified form`);
      else if (!amp || amp.type !== 'amplify' || amp.thread !== a.thread) errors.push(`$.admitted[${i}].adopt: ${a.adopt} is not an amplification of ${a.thread}`);
    }
    if (!NOVELTY.includes(a?.novelty)) errors.push(`$.admitted[${i}].novelty: "fresh" when the idea could only come from looking at this project and its market, "familiar" when any adviser would give it to any firm of this kind`);
  });
  refused.forEach((r, i) => {
    note(r?.thread, `$.refused[${i}].thread`, 'refused');
    if (one(r?.reason).length < 10) errors.push(`$.refused[${i}].reason: say why it is turned away`);
  });
  for (const t of record.threads) if (!seen.has(t.id)) errors.push(`${t.id} "${t.title}" is not on the docket: admit it, merge it into another or refuse it with a reason`);
  if (errors.length) return { errors };

  // Into the ledger first: when it refuses an idea, nothing of the docket is saved.
  const hypothesisOf = (id) => record.statements.find((s) => s.thread === id && s.type === 'hypothesis');
  const entries = admitted.map((a) => {
    const h = hypothesisOf(a.thread);
    const returns = a.returns ?? h.returns;
    const whatChanged = a.whatChanged ?? h.whatChanged;
    return {
      title: h.title, goal: session.goal, proposedBy: h.by, effort: h.effort, ...(h.scale ? { scale: h.scale } : {}),
      hypothesis: a.adopt ? { ...h.hypothesis, ...record.statements.find((s) => s.n === a.adopt).bigger } : h.hypothesis,
      ...(isFramed(session) ? { origin: kindOf(session) } : {}),
      novelty: a.novelty, ...(h.where?.length ? { where: h.where } : {}),
      ...(h.priorArt ? { priorArt: { exists: h.priorArt.exists, searched: h.priorArt.searched, ...(h.priorArt.who ? { who: h.priorArt.who } : {}), ...(h.priorArt.difference ? { difference: h.priorArt.difference } : {}) } } : {}),
      test: { what: h.test.what, metric: h.test.metric, threshold: h.test.threshold, checkAfter: h.test.checkAfter, ...(h.test.baseline ? { baseline: h.test.baseline } : {}) },
      ...(returns ? { returns, ...(whatChanged ? { whatChanged } : {}) } : {}),
    };
  });
  const ledger = applyIdeas(ideas, { ideas: entries }, { by: kindOf(session), session: session.id, date });
  if (ledger.errors.length) return { errors: ledger.errors.map((e) => e.replace(/^\$\.ideas\[(\d+)\]/, (_, n) => `$.admitted[${n}] (${admitted[n].thread})`)) };

  admitted.forEach((a, i) => {
    const t = thread(record, a.thread);
    t.status = 'admitted';
    t.ideaId = ledger.saved[i].id;
    t.novelty = a.novelty;
    if (a.merge?.length) t.mergedFrom = a.merge;
    if (a.adopt) t.adopted = a.adopt;
    for (const m of a.merge ?? []) Object.assign(thread(record, m), { status: 'merged', mergedInto: a.thread });
  });
  for (const r of refused) Object.assign(thread(record, r.thread), { status: 'refused', refused: { reason: one(r.reason), ...(r.ref ? { ref: one(r.ref) } : {}) } });
  record.docket = { savedAt: new Date().toISOString(), admitted: admitted.length, refused: refused.length, merged: record.threads.filter((t) => t.status === 'merged').length };
  takeTurn(session, 'judge');
  return { errors, ideas: ledger.ideas, admitted: admitted.map((a, i) => ({ thread: a.thread, idea: ledger.saved[i].id })), refused: refused.length };
}

// ---- Moving on ----

// Moves the session to its next phase, round or step. It refuses while a role that has a turn has not taken it,
// unless forced (a role that failed twice is left out). This is where a thread closes for good: nothing new in a
// later round, no answer to an attack, a question that is all the attackers had and that stands after the proposer's
// turn, the third round over, or the budget spent.
export function advance(ctx, { force = false, ideas = [], date } = {}) {
  const { session, record, evidence, verdicts } = ctx;
  let ledger = null;
  // The verdicts are final from here: the ledger learns the outcome, and the documents are written from it.
  const settle = () => {
    const done = finalise(ctx, { ideas, date });
    if (done.errors.length) return done.errors;
    ledger = done.ideas;
    go('write');
    return [];
  };
  const from = { phase: session.phase, round: session.round, step: session.step };
  const closed = [];
  const shut = (t, reason, extra) => { if (isOpen(t)) { close(t, session.round, reason, extra); closed.push({ thread: t.id, reason }); } };
  const go = (phase, round = 0, step = null) => Object.assign(session, { phase, round, step });
  const waiting = turns(session, record, verdicts).filter((t) => !t.done && !t.optional);
  const hold = () => (waiting.length && !force
    ? [`${waiting.map((t) => `${t.name} (${t.role})`).join(', ')} ${waiting.length > 1 ? 'have' : 'has'} not taken ${waiting.length > 1 ? 'their' : 'the'} turn. Start ${waiting.length > 1 ? 'them' : 'that agent'}, or pass --force to go on without.`]
    : []);
  const toVerdict = () => {
    for (const t of openThreads(record)) shut(t, session.closing ? 'the budget ran out' : 'the debate ended', session.closing ? { cutOff: true } : {});
    go('verdict');
  };
  let errors = [];

  switch (session.phase) {
    case 'open': go('evidence'); break;
    case 'evidence':
      if (!evidence.collectedAt) errors = ['The evidence has not been collected: run "evidence --collect" first.'];
      else if (isLab(session)) {
        errors = hold();
        // Nothing is invented for a thing nobody has studied: the anatomy cannot be skipped, not even with --force.
        if (!errors.length && !session.study?.anatomy) errors = ['The anatomy has not been saved: start the anatomist. The lab invents for the thing it studied, so this turn cannot be skipped.'];
        if (!errors.length) go('study', 0, 'show');
      } else if (isVenture(session)) go('frame', 0, 'frame');
      else go('track-record');
      break;
    case 'study':
      errors = hold();
      if (!errors.length) go('frame', 0, 'frame');
      break;
    case 'track-record': go('propose', 0, 'first'); break;
    case 'frame': {
      errors = hold();
      if (errors.length) break;
      const frame = loadFrame(ctx.dir);
      if (session.step === 'frame') {
        if (!frame?.frame && !force) { errors = ['The frame has not been saved: start the framer first.']; break; }
        go('frame', 0, 'provoke');
        break;
      }
      if (!frame?.frame) { errors = ['There is no frame to propose from; the framer has to save one.']; break; }
      // The cards and the framings are dealt once, when the proposing starts.
      session.dealt = deal(session, frame);
      go('propose', 0, 'first');
      break;
    }
    case 'amplify':
      errors = hold();
      if (!errors.length) go('docket');
      break;
    case 'propose':
      errors = hold();
      if (!errors.length && !record.threads.length) errors = ['Nobody has proposed anything yet, so there is nothing to debate.'];
      if (errors.length) break;
      // The second pass needs runs of its own; with the debate's runs spent it is skipped, not cut short.
      if (passOf(session) === 1 && !debateSpent(session)) go('propose', 0, 'second');
      else if (isFramed(session) && !debateSpent(session)) {
        // In the venture board and the lab every idea is built on by another seat before the judge sees it.
        go('amplify');
        session.assignments = assignAmplifiers(session, record);
      } else go('docket');
      break;
    case 'docket':
      if (!record.docket) { errors = ['The docket has not been saved: the judge admits, merges or refuses every idea first.']; break; }
      if (!openThreads(record).length) { toVerdict(); break; }
      go('examine', 1, 'attack');
      session.assignments = assignAttackers(session, record);
      break;
    case 'examine': {
      errors = hold();
      if (errors.length) break;
      const said = (t, types) => record.statements.some((s) => s.thread === t.id && s.round === session.round && types.includes(s.type));
      // A question put to the proposer in this round that nobody has answered.
      const asked = (t) => record.questions.find((q) => q.thread === t.id && q.by !== t.by && record.statements.find((s) => s.n === q.n)?.round === session.round) ?? null;
      // With the runs spent nobody can reply, so the round ends here and the judge rules on what was said.
      if (session.step === 'attack' && debateSpent(session)) { toVerdict(); break; }
      if (session.step === 'attack') {
        // From round two a thread nobody presses any further is settled: the attack rests. A question is not rest:
        // the proposer gets the turn to answer it.
        if (session.round > 1) for (const t of openThreads(record)) if (!said(t, ['attack']) && !asked(t)) shut(t, 'the attack rests');
        if (openThreads(record).some((t) => toAnswer(record, t.id, session.round).length)) session.step = 'reply';
        else toVerdict();
        break;
      }
      // A proposer who could not be started because the runs are spent did not refuse to answer.
      const spent = session.runs >= debateAllowance(session);
      for (const t of openThreads(record)) {
        if (said(t, ['attack', 'client']) && !said(t, ['reply'])) shut(t, spent ? 'the budget ran out' : 'the attack went unanswered', spent ? { cutOff: true } : {});
      }
      // A question ends a thread only when it was all the attackers had to say in this round, and the proposer, who
      // had the turn, could not answer it by looking. Beside an attack it is a note for the person, and the debate
      // goes on; a proposer never ends the examination of its own idea by asking.
      for (const t of openThreads(record)) {
        const question = asked(t);
        if (question && !said(t, ['attack'])) shut(t, 'a question nobody present can answer', { question: question.n });
      }
      if (session.round >= maxRounds(session)) for (const t of openThreads(record)) shut(t, isVenture(session) ? 'the last round is over' : 'the third round is over');
      if (session.closing || !openThreads(record).length) toVerdict();
      else go('examine', session.round + 1, 'attack');
      break;
    }
    case 'verdict': {
      const admitted = record.threads.filter((t) => t.status === 'admitted');
      if (verdicts.rulings.length !== admitted.length) { errors = ['The judge has not ruled on every admitted idea yet.']; break; }
      // One survivor, or none, is not a set.
      if (survivors(verdicts).length >= 2 && !isVenture(session)) go('set');
      else errors = settle();
      break;
    }
    case 'set':
      if (!verdicts.set) {
        if (!force) { errors = hold(); break; }
        verdicts.set = { notes: [], changes: [], skipped: true };
      }
      if (verdicts.set.notes.some((n) => n.asksRuling) && !verdicts.set.changes) {
        if (!force) { errors = hold(); break; }
        verdicts.set.changes = [];
      }
      verdicts.set.changes ??= [];
      errors = settle();
      break;
    default:
      errors = [`"next" does not move the session out of the ${session.phase} phase; see the status command for what it needs.`];
  }
  return { errors, from, to: { phase: session.phase, round: session.round, step: session.step }, closed, ideas: ledger };
}

// One sentence on what happens next, for the orchestrator.
export function nextStep(session, record, evidence, verdicts = null) {
  const waiting = turns(session, record, verdicts).filter((t) => !t.done && !t.optional).map((t) => t.name);
  const names = waiting.join(', ');
  switch (session.phase) {
    case 'open': return 'Ask the person once about decisions and results still waiting from earlier sessions, then run "next".';
    case 'evidence': {
      if (!evidence.collectedAt) return 'Run "evidence --collect".';
      const reused = (evidence.reused ?? []).map((r) => `${r.kind} from ${r.at}`);
      const from = reused.length ? ` Reused from an earlier session: ${reused.join(', ')}.` : '';
      const all = turns(session, record, verdicts).filter((t) => !t.done).map((t) => t.name);
      return all.length ? `The evidence is collected.${from} Start ${all.join(', ')}, at once; then run "next".` : `The evidence is collected.${from} Nothing more to look up: run "next".`;
    }
    case 'track-record': return 'Check the ideas whose test date has passed, then run "next".';
    case 'study': {
      if (session.study?.pending) return 'The person corrected the anatomy: start the anatomist, to revise it. Then run "next".';
      return 'Show the person what the lab understood ("study --show") and ask what is wrong or missing. Save each correction with "study --correct"; with none, run "next".';
    }
    case 'propose': {
      const pass = passOf(session) === 2 ? 'second pass' : 'first pass';
      if (debateSpent(session)) return `The debate has used its agent runs, so no more proposers are started. ${waiting.length ? `Wait for ${names}, already started, then run "next"` : 'Run "next"'} with what was proposed.`;
      if (waiting.length) return `Proposals, ${pass}: start the proposers, all at once: ${names}.`;
      if (isFramed(session)) return passOf(session) === 1 ? 'Everyone has proposed. Run "next" for the second pass, where each seat harvests the provocations.' : `Both passes are done. Run "next": every ${isLab(session) ? 'invention' : 'bet'} is given to another seat to build on.`;
      return passOf(session) === 1 ? 'Everyone has proposed. Run "next" for the second pass, where each proposer sees the themes on the table and looks elsewhere.' : 'Both passes are done. Run "next" for the docket.';
    }
    case 'frame': {
      const waiting = turns(session, record, verdicts).filter((t) => !t.done).map((t) => t.name);
      if (session.step === 'frame') return waiting.length ? 'Start the framer.' : 'The frame is saved. Run "next": the provocateur writes the provocations.';
      return waiting.length ? 'Start the provocateur.' : 'The frame and the provocations are saved. Show the person the framings ("frame --show") and ask which matter; save their pick with "frame --pick H1,C2", or go on without one. Then run "next".';
    }
    case 'amplify': return names ? `Every ${isLab(session) ? 'invention' : 'bet'} goes to another seat to make it bigger: start, all at once: ${names}.` : `Every ${isLab(session) ? 'invention' : 'bet'} has been built on. Run "next" for the docket.`;
    case 'docket': return record.docket ? 'The docket is saved. Run "next" to open the examination.' : 'Start the judge for the docket.';
    case 'examine': {
      if (debateSpent(session)) return `The debate has used its agent runs, so nobody more is started in it: a refusal for the budget is final and is not retried. ${waiting.length ? `Wait for ${names}, already started, then run "next"` : 'Run "next"'}: the judge rules on what is there.`;
      const what = session.step === 'attack' ? 'attackers' : 'proposers, to reply';
      const tail = session.closing ? ' The budget is nearly spent: this is the last round.' : '';
      return waiting.length ? `Round ${session.round}: start the ${what}, all at once: ${names}.${tail}` : `Round ${session.round}, ${session.step}: everyone has spoken. Run "next".${tail}`;
    }
    case 'verdict': return waiting.length ? 'Start the judge for the verdict.' : 'Every idea has its ruling. Run "next".';
    case 'set': return waiting.length ? `Start ${names}: ${verdicts?.set ? 'the red team asks for a verdict to be looked at again' : 'the survivors are looked at as a set'}.` : 'The set has been looked at. Run "next" to make the verdicts final.';
    case 'write': return 'The verdicts are final and in the idea ledger. The two documents come next.';
    default: return `The session is in the ${session.phase} phase.`;
  }
}
