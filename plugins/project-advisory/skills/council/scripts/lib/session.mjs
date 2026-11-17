import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from './io.mjs';
import { SKILL_DIR, councilDir, ignoreSessions } from './paths.mjs';
import { loadFacts, today, latestHealthRun } from './bank.mjs';

// A council session: a cast of role agents proposes ideas for a goal, attacks them and a judge rules on what is left.
// This module is the session itself: where it lives, which phase it is in, whose turn it is and what it may still
// spend. Nothing here trusts an agent to stop by itself.

export const DEFAULT_GOAL = 'Make potential clients see clearly what the business offers and why to choose it, on the site and beyond it, so that more of them get in touch';
export const DEFAULT_BUDGET = 60;
// Runs kept back for the verdict and the two documents, so a long debate cannot leave the session without a result.
export const RESERVE = 12;
export const MAX_ROUNDS = 3;
export const PHASES = ['open', 'evidence', 'track-record', 'propose', 'docket', 'examine', 'verdict', 'set', 'write', 'review', 'close', 'done'];
const DEBATE = ['open', 'evidence', 'track-record', 'propose', 'docket', 'examine'];
// The judge's docket is paid like the verdict, from the reserve when it must be: without it the session can neither go
// on to the examination nor reach the verdict, and every proposal would be lost.
const REFUSED_WHEN_SPENT = DEBATE.filter((p) => p !== 'docket');
export const SESSION_ID_RE = /^\d{4}-\d{2}-\d{2}(-\d+)?$/;

export const loadCast = () => readJson(path.join(SKILL_DIR, 'references', 'cast.json'));

export function listSessions(root) {
  const dir = councilDir(root);
  if (!fs.existsSync(dir)) return [];
  const order = (id) => { const [, day, n] = /^(\d{4}-\d{2}-\d{2})(?:-(\d+))?$/.exec(id); return `${day}-${String(n ?? 1).padStart(4, '0')}`; };
  return fs.readdirSync(dir).filter((d) => SESSION_ID_RE.test(d) && fs.existsSync(path.join(dir, d, 'session.json'))).sort((a, b) => order(a).localeCompare(order(b)));
}

export function loadSession(root, id) {
  if (!SESSION_ID_RE.test(id ?? '')) throw new Error(`Invalid session id "${id ?? ''}". Expected the form YYYY-MM-DD.`);
  const dir = path.join(councilDir(root), id);
  const session = readJson(path.join(dir, 'session.json'), null);
  if (!session) throw new Error(`Session "${id}" not found in ${councilDir(root)}.`);
  return { dir, session };
}

// The session a command works on: the one named, or the latest one that is not finished.
export function resolveSession(root, id) {
  if (id) return loadSession(root, id);
  const open = listSessions(root).reverse().find((s) => loadSession(root, s).session.phase !== 'done');
  if (!open) throw new Error('No council session is under way. Start one with "init".');
  return loadSession(root, open);
}

export function saveSession(dir, session) {
  writeJson(path.join(dir, 'session.json'), session);
}

function goalFor(root, given) {
  if (given?.trim()) return { goal: given.trim(), goalSource: 'given' };
  const stored = loadFacts(root).find((f) => f.key === 'council.goal');
  if (stored) return { goal: String(stored.value), goalSource: 'knowledge base' };
  return { goal: DEFAULT_GOAL, goalSource: 'default' };
}

export function createSession(root, { goal, url, data, budget, date = today() } = {}) {
  const unfinished = listSessions(root).reverse().find((s) => loadSession(root, s).session.phase !== 'done');
  if (unfinished) throw new Error(`Session ${unfinished} is not finished (phase: ${loadSession(root, unfinished).session.phase}). Continue it with --session ${unfinished}, or set it aside with "close --abandon --session ${unfinished}".`);
  const total = budget === undefined ? DEFAULT_BUDGET : Number(budget);
  if (!Number.isInteger(total) || total < RESERVE + 10) throw new Error(`--budget must be a whole number of at least ${RESERVE + 10}: a session needs about ${DEFAULT_BUDGET} agent runs, ${RESERVE} of them for the verdict and the documents.`);
  let dataDir = null;
  if (data) {
    dataDir = path.resolve(data);
    if (!fs.existsSync(dataDir) || !fs.statSync(dataDir).isDirectory()) throw new Error(`Data folder not found: ${dataDir}`);
  }
  ignoreSessions(root);
  let id = date;
  for (let n = 2; fs.existsSync(path.join(councilDir(root), id)); n++) id = `${date}-${n}`;
  const dir = path.join(councilDir(root), id);
  fs.mkdirSync(dir, { recursive: true });
  // A health check of the project, when the project-health skill has run one, gives the council findings to work from.
  const health = latestHealthRun(root);
  const session = {
    id, ...goalFor(root, goal), url: url ?? health?.url ?? null, data: dataDir, run: health?.id ?? null,
    budget: total, runs: 0, closing: false,
    phase: 'open', round: 0, step: null,
    cast: loadCast().seats, assignments: {}, turns: [], log: [], createdAt: new Date().toISOString(),
  };
  // A goal that was cast before meets the same cast again.
  const stored = loadFacts(root).find((f) => f.key === 'council.cast')?.value;
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

// The runs one full round of debate takes with this cast: the competitor analyst and the horizon scan, every proposer
// twice (the two passes), the judge's docket, every attacker (the red team and each proposer) and every proposer's reply.
export const oneRound = (session) => 4 * proposers(session).length + 4;

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
