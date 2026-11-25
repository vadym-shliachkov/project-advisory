import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from './io.mjs';
import { skillDirOf, sessionsDir, ignoreSessions, kindOf, labelOf } from './paths.mjs';
import { loadFacts, today, latestHealthRun } from './bank.mjs';

// A council session: a cast of role agents proposes ideas for a goal, attacks them and a judge rules on what is left.
// This module is the session itself: where it lives, which phase it is in, whose turn it is and what it may still
// spend. Nothing here trusts an agent to stop by itself.

export const DEFAULT_GOAL = 'Make potential clients see clearly what the business offers and why to choose it, on the site and beyond it, so that more of them get in touch';
// The venture board asks a larger question: not how to improve what is there, but what the business could become.
export const VENTURE_GOAL = 'Find what the business could start, sell, build or become that would change its results far more than improving what it already has';
// The invention lab asks about the thing itself: what it could do, have or become that nobody has made yet.
export const LAB_GOAL = 'Invent things this project could do, have or become that nobody has made yet, grown from what it already is and from the people who use it';
export const DEFAULT_BUDGET = 60;
// The lab studies the thing before anyone invents, debates for up to three rounds and writes the minutes and a sketch
// of every invention that survives: it needs more runs than the council.
export const LAB_BUDGET = 80;
// Runs kept back for the verdict and the two documents, so a long debate cannot leave the session without a result.
export const RESERVE = 12;
export const MAX_ROUNDS = 3;
// The venture board tests its bets on their assumptions, in at most two rounds: a bet is not defended line by line.
export const VENTURE_ROUNDS = 2;
export const PHASES = ['open', 'evidence', 'track-record', 'propose', 'docket', 'examine', 'verdict', 'set', 'write', 'review', 'close', 'done'];
// The venture board frames the problem before anyone proposes, and builds on every idea before anyone attacks it.
export const VENTURE_PHASES = ['open', 'evidence', 'frame', 'propose', 'amplify', 'docket', 'examine', 'verdict', 'write', 'review', 'close', 'done'];
// The invention lab first studies the thing it works on and shows the person what it understood (the study), then
// frames, provokes, invents, builds on every invention, and debates them as the council does.
export const LAB_PHASES = ['open', 'evidence', 'study', 'frame', 'propose', 'amplify', 'docket', 'examine', 'verdict', 'set', 'write', 'review', 'close', 'done'];
export const isVenture = (session) => session?.kind === 'venture';
export const isLab = (session) => session?.kind === 'lab';
// Both the venture board and the lab frame the problem, provoke, deal cards and build on every idea before the docket.
export const isFramed = (session) => isVenture(session) || isLab(session);
export const maxRounds = (session) => (isVenture(session) ? VENTURE_ROUNDS : MAX_ROUNDS);
export const phasesOf = (session) => (isLab(session) ? LAB_PHASES : isVenture(session) ? VENTURE_PHASES : PHASES);
const GOALS = { council: DEFAULT_GOAL, venture: VENTURE_GOAL, lab: LAB_GOAL };
export const defaultGoal = (kind = 'council') => GOALS[kind] ?? DEFAULT_GOAL;
const DEBATE = ['open', 'evidence', 'track-record', 'study', 'frame', 'propose', 'amplify', 'docket', 'examine'];
// The judge's docket is paid like the verdict, from the reserve when it must be: without it the session can neither go
// on to the examination nor reach the verdict, and every proposal would be lost.
const REFUSED_WHEN_SPENT = DEBATE.filter((p) => p !== 'docket');
export const SESSION_ID_RE = /^\d{4}-\d{2}-\d{2}(-\d+)?$/;

export const loadCast = (kind = 'council') => readJson(path.join(skillDirOf(kind), 'references', 'cast.json'));

export function listSessions(root, kind = 'council') {
  const dir = sessionsDir(root, kind);
  if (!fs.existsSync(dir)) return [];
  const order = (id) => { const [, day, n] = /^(\d{4}-\d{2}-\d{2})(?:-(\d+))?$/.exec(id); return `${day}-${String(n ?? 1).padStart(4, '0')}`; };
  return fs.readdirSync(dir).filter((d) => SESSION_ID_RE.test(d) && fs.existsSync(path.join(dir, d, 'session.json'))).sort((a, b) => order(a).localeCompare(order(b)));
}

export function loadSession(root, id, kind = 'council') {
  if (!SESSION_ID_RE.test(id ?? '')) throw new Error(`Invalid session id "${id ?? ''}". Expected the form YYYY-MM-DD.`);
  const dir = path.join(sessionsDir(root, kind), id);
  const session = readJson(path.join(dir, 'session.json'), null);
  if (!session) throw new Error(`Session "${id}" not found in ${sessionsDir(root, kind)}.`);
  return { dir, session };
}

// The session a command works on: the one named, or the latest one that is not finished.
export function resolveSession(root, id, kind = 'council') {
  if (id) return loadSession(root, id, kind);
  const open = listSessions(root, kind).reverse().find((s) => loadSession(root, s, kind).session.phase !== 'done');
  if (!open) throw new Error(`No ${kind === 'council' ? 'council' : labelOf(kind).toLowerCase()} session is under way. Start one with "init".`);
  return loadSession(root, open, kind);
}

export function saveSession(dir, session) {
  writeJson(path.join(dir, 'session.json'), session);
}

function goalFor(root, given, kind) {
  if (given?.trim()) return { goal: given.trim(), goalSource: 'given' };
  const stored = loadFacts(root).find((f) => f.key === `${kind}.goal`);
  if (stored) return { goal: String(stored.value), goalSource: 'knowledge base' };
  return { goal: defaultGoal(kind), goalSource: 'default' };
}

export function createSession(root, { goal, url, data, budget, kind = 'council', object = null, focus = null, date = today() } = {}) {
  const unfinished = listSessions(root, kind).reverse().find((s) => loadSession(root, s, kind).session.phase !== 'done');
  if (unfinished) throw new Error(`Session ${unfinished} is not finished (phase: ${loadSession(root, unfinished, kind).session.phase}). Continue it with --session ${unfinished}, or set it aside with "close --abandon --session ${unfinished}".`);
  const total = budget === undefined ? (kind === 'lab' ? LAB_BUDGET : DEFAULT_BUDGET) : Number(budget);
  if (!Number.isInteger(total) || total < RESERVE + 10) throw new Error(`--budget must be a whole number of at least ${RESERVE + 10}: a session needs about ${DEFAULT_BUDGET} agent runs, ${RESERVE} of them for the verdict and the documents.`);
  let dataDir = null;
  if (data) {
    dataDir = path.resolve(data);
    if (!fs.existsSync(dataDir) || !fs.statSync(dataDir).isDirectory()) throw new Error(`Data folder not found: ${dataDir}`);
  }
  ignoreSessions(root);
  let id = date;
  for (let n = 2; fs.existsSync(path.join(sessionsDir(root, kind), id)); n++) id = `${date}-${n}`;
  const dir = path.join(sessionsDir(root, kind), id);
  fs.mkdirSync(dir, { recursive: true });
  // A health check of the project, when the project-health skill has run one, gives the council findings to work from.
  const health = latestHealthRun(root);
  const session = {
    id, ...(kind !== 'council' ? { kind } : {}), ...goalFor(root, goal, kind),
    // The thing the lab works on: what kind of thing it is, and the part of it the person asked the lab to look at.
    ...(kind === 'lab' ? { object, ...(focus?.trim() ? { focus: focus.trim() } : {}) } : {}), url: url ?? health?.url ?? null, data: dataDir, run: health?.id ?? null,
    budget: total, runs: 0, closing: false,
    phase: 'open', round: 0, step: null,
    cast: loadCast(kind).seats, assignments: {}, turns: [], log: [], createdAt: new Date().toISOString(),
  };
  // A goal that was cast before meets the same cast again.
  const stored = kind !== 'council' ? null : loadFacts(root).find((f) => f.key === 'council.cast')?.value;
  if (stored?.goal === session.goal && Array.isArray(stored.cast)) session.cast = stored.cast;
  saveSession(dir, session);
  return { dir, session };
}

// For a goal other than the usual one, the five open seats are cast anew. The four fixed seats stay, the new seats
// take characters from the pool, and every second one runs on the standard model so the room does not think alike.
const FIXED = ['client', 'red-team', 'judge', 'librarian'];
export const OPEN_SEATS = 5;

export function recast(session, seats) {
  if (session.phase !== 'open') return { errors: [`The cast is chosen before the session starts; it is in the ${session.phase} phase`] };
  if (!Array.isArray(seats) || seats.length !== OPEN_SEATS) return { errors: [`$.seats: exactly ${OPEN_SEATS} seats are required`] };
  const errors = [];
  const roles = new Set();
  seats.forEach((s, i) => {
    const at = `$.seats[${i}]`;
    if (!/^[a-z][a-z0-9-]{2,24}$/.test(s?.role ?? '')) errors.push(`${at}.role: a short word in lower case with hyphens`);
    else if (FIXED.includes(s.role) || roles.has(s.role)) errors.push(`${at}.role: "${s.role}" is taken`);
    roles.add(s?.role);
    if (String(s?.title ?? '').trim().length < 3) errors.push(`${at}.title: the name of the seat`);
    if (String(s?.ground ?? '').trim().length < 20) errors.push(`${at}.ground: one sentence on what this seat looks at`);
  });
  if (errors.length) return { errors };
  const { seats: usual, pool } = loadCast();
  const fixed = usual.filter((s) => FIXED.includes(s.role));
  const cast = seats.map((s, i) => ({ role: s.role, name: pool[i].name, title: s.title.trim(), ground: s.ground.trim(), temper: pool[i].temper, fixed: false, proposes: true, model: i % 2 ? 'standard' : 'strongest' }));
  session.cast = [fixed.find((s) => s.role === 'client'), ...cast, ...fixed.filter((s) => s.role !== 'client')];
  return { errors: [] };
}

export const seat = (session, role) => session.cast.find((s) => s.role === role) ?? null;
export const proposers = (session) => session.cast.filter((s) => s.proposes).map((s) => s.role);

// ---- Budget ----

export const debateAllowance = (session) => session.budget - RESERVE;

// Counts one agent run. The debate may spend all but the reserve; at 80% of that it stops opening rounds. The
// judge's docket is never refused for the budget.
export function spendRun(session, { role, phase }) {
  const allowance = debateAllowance(session);
  if (REFUSED_WHEN_SPENT.includes(phase) && session.runs >= allowance) {
    throw new Error(`The debate has used its ${allowance} agent runs (budget ${session.budget}, ${RESERVE} kept for the verdict and the documents). Move on with "next": the judge rules on what is there.`);
  }
  session.runs += 1;
  session.log.push({ n: session.runs, role, phase, round: session.round, step: session.step, at: new Date().toISOString() });
  if (!session.closing && DEBATE.includes(phase) && session.runs >= Math.ceil(allowance * 0.8)) session.closing = true;
  return session;
}

export const budgetOf = (session) => ({ total: session.budget, forDebate: debateAllowance(session), spent: session.runs, closing: session.closing });

// The runs one full round of debate takes with this cast: the domain primer, the competitor analyst and the horizon
// scan, every proposer twice (the two passes), the judge's docket, every attacker (the red team and each proposer) and
// every proposer's reply.
export const oneRound = (session) => 4 * proposers(session).length + 5;

// What the budget will not cover, said at the start so the person can choose a larger one before anything is spent.
export function budgetWarning(session) {
  const need = oneRound(session);
  if (debateAllowance(session) >= need) return null;
  return `With a budget of ${session.budget}, the debate has ${debateAllowance(session)} agent runs (${RESERVE} are kept for the verdict and the documents), but one full round of attack and reply takes about ${need}. Some attackers will not run and the proposers may not reply. A budget of at least ${need + RESERVE} gives the debate one full round.`;
}

// ---- Turns ----

// A role's turn in a step is taken once it has saved, even when it had nothing to say.
export function takeTurn(session, role) {
  const key = { phase: session.phase, round: session.round, step: session.step, role };
  if (!session.turns.some((t) => t.phase === key.phase && t.round === key.round && t.step === key.step && t.role === role)) session.turns.push(key);
}

export const turnTaken = (session, role, { phase = session.phase, round = session.round, step = session.step } = {}) =>
  session.turns.some((t) => t.phase === phase && t.round === round && t.step === step && t.role === role);
