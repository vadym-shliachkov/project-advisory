import fs from 'node:fs';
import path from 'node:path';
import { writeJson } from './io.mjs';
import { SKILL_DIR, LAB_DIR, scriptOf } from './paths.mjs';
import { today } from './bank.mjs';
import { digest, recordLine } from './digest.mjs';
import { loadIdeas, dueForCheck, trackRecord, ideasPath } from './ideas.mjs';
import { seat, proposers, isLab } from './session.mjs';
import { evidencePath } from './evidence.mjs';
import { loadGroundwork } from './groundwork.mjs';
import { loadFrame, dealtTo, adopted } from './lab.mjs';
import { inThread, threadsFor, passOf } from './record.mjs';
import { strengthAllowed, survivors } from './verdict.mjs';
import { docTurn, DOC_STAFF } from './flow.mjs';

// What one agent is given for one turn: the rules of the debate, its seat, the instructions for this kind of turn,
// the files to read and how to save. The agent's whole task is the text this returns.

// A lab session reads the lab's own prompt when it has one, and the council's otherwise (the rules of evidence, the
// customer's voice, the reply, the layout review are the same).
const agentsDir = (session, rel) => (isLab(session) && fs.existsSync(path.join(LAB_DIR, 'agents', rel)) ? path.join(LAB_DIR, 'agents') : path.join(SKILL_DIR, 'agents'));
const read = (rel, session = null) => fs.readFileSync(path.join(agentsDir(session, rel), rel), 'utf8').trim();
const exists = (rel, session = null) => fs.existsSync(path.join(agentsDir(session, rel), rel));
const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// Roles that are not seats at the table: they do one job for the session and say nothing in the debate.
export const STAFF = ['track-record', 'casting', 'horizon', 'primer', 'framer', ...DOC_STAFF];

function saveLines(cmd, save, shape, okLine, badLine) {
  if (!save) return ['Reply with the JSON object only, as described above. Do not write any files.'];
  return [
    'Save the JSON object by passing it to this command on standard input (Bash, with the quoted heredoc so nothing is expanded):',
    '',
    '```bash',
    `${cmd} <<'COUNCIL_JSON'`,
    shape,
    'COUNCIL_JSON',
    '```',
    '',
    `In PowerShell, pipe a here-string instead: \`@'<newline>{ ... }<newline>'@ | ${cmd}\`.`,
    `If the shell rejects the heredoc (some tool wrappers stop at quotes inside it), write the JSON to a file outside the project with your file-writing tool and run \`${cmd} < "<that file>"\`.`,
    '',
    'It prints `"ok": true` when the result is valid. When it prints `"ok": false`, nothing was saved: fix every item in `errors` and save again; stop after three attempts.',
    `Then reply with one line only, for example \`${okLine}\` or \`${badLine}\`. Do not repeat the result in your reply.`,
  ];
}

// ---- Blinding ----

const HONORIFIC = String.raw`(?:Her Grace the|The Hon\.|The Reverend|Lady|Sir|Mr|Mrs|Miss|Dr|Colonel|Captain|Professor|Dame)`;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The ways a seat may be named in a statement, as patterns: the character's name in full, its first name or its
// surname, each with or without an honorific ("Dr Graves", "Sir Barnaby"), and the seat's title when it is more than
// one word ("the red team"; "Conversion" alone is an ordinary word).
function namesOf(s) {
  const plain = s.name.replace(new RegExp(String.raw`^${HONORIFIC}\s+`, 'i'), '');
  const words = plain.split(/\s+/);
  const parts = [...new Set([plain, ...[words[0], words.at(-1)].filter((w) => w.length > 3)])];
  const title = s.title.replace(/^the\s+/i, '');
  return [
    ...parts.map((p) => ({ pattern: String.raw`(?:${HONORIFIC}\s+)?${escapeRe(p)}`, length: p.length })),
    ...(title.includes(' ') ? [{ pattern: String.raw`(?:the\s+)?${escapeRe(title)}`, length: title.length }] : []),
  ];
}

// Who is who in one thread, without names: the judge rules on what was said, not on who said it.
function labelsFor(session, t, { you = null, record = null } = {}) {
  const labels = new Map();
  for (const s of session.cast) labels.set(s.role, 'another member');
  labels.set('client', "the customer's voice");
  labels.set('red-team', 'attacker A');
  if (session.assignments[t.id]) labels.set(session.assignments[t.id], 'attacker B');
  // A seat that chose to speak on an idea it was not given is the next letter, in the order they spoke.
  const fixed = new Set(['client', 'red-team', 'judge', t.by, session.assignments[t.id]]);
  const others = [...new Set((record ? inThread(record, t.id) : []).filter((s) => ['attack', 'question'].includes(s.type) && !fixed.has(s.by)).map((s) => s.by))];
  others.forEach((role, i) => labels.set(role, `attacker ${String.fromCharCode(67 + i)}`));
  labels.set(t.by, 'the proposer');
  labels.set('judge', 'the judge');
  if (you) labels.set(you, 'you');
  return labels;
}

export function blindText(text, session, labels) {
  let out = String(text ?? '');
  // Longest first, so a full name is replaced whole before its surname is looked for.
  const names = session.cast.flatMap((s) => namesOf(s).map((n) => ({ ...n, label: labels.get(s.role) ?? 'another member' }))).sort((a, b) => b.length - a.length);
  for (const { pattern, label } of names) out = out.replace(new RegExp(String.raw`(?<![\w-])${pattern}(?:'s)?(?![\w-])`, 'gi'), label);
  // "The Duchess" becomes "The the judge": keep one article.
  return out.replace(/\bthe\s+the\b/gi, 'the');
}

// One thread as an agent sees it: the idea, then everything said, each statement by a label instead of a name.
function threadView(ctx, t, { you = null } = {}) {
  const { session, record } = ctx;
  const labels = labelsFor(session, t, { you, record });
  const said = inThread(record, t.id);
  const h = said.find((s) => s.type === 'hypothesis');
  const blind = (text) => blindText(text, session, labels);
  return {
    id: t.id, title: blind(h.title),
    hypothesis: Object.fromEntries(Object.entries(adopted(record, t, h)).map(([k, v]) => [k, blind(v)])),
    ...(h.assumptions ? { assumptions: h.assumptions.map(blind), riskiest: h.riskiest, upside: h.upside } : {}),
    ...(h.answers ? { answers: h.answers } : {}), ...(h.provocation ? { provocation: h.provocation } : {}), ...(h.cards ? { cards: h.cards } : {}),
    ...(t.adopted ? { amplifiedBy: t.adopted } : {}),
    test: h.test, effort: h.effort, ...(h.scale ? { scale: h.scale } : {}), evidence: h.evidence,
    ...(h.priorArt ? { priorArt: Object.fromEntries(Object.entries(h.priorArt).map(([k, v]) => [k, typeof v === 'string' ? blind(v) : v])) } : {}),
    ...(h.returns ? { returns: h.returns, whatChanged: blind(h.whatChanged) } : {}),
    // A merged idea is more than its title: what it would have changed must not vanish unseen.
    ...(t.mergedFrom ? { alsoCovers: t.mergedFrom.map((id) => { const merged = record.statements.find((s) => s.thread === id && s.type === 'hypothesis'); return { title: blind(merged?.title ?? id), change: blind(merged?.hypothesis.change ?? '') }; }) } : {}),
    statements: said.filter((s) => s.type !== 'hypothesis').map((s) => ({
      n: s.n, round: s.round, by: labels.get(s.by) ?? 'another member', type: s.type, text: blind(s.text), evidence: s.evidence,
      ...(s.kind ? { kind: s.kind } : {}), ...(s.cares ? { cares: s.cares } : {}), ...(s.stance ? { stance: s.stance } : {}),
      ...(s.narrowed ? { narrowed: s.narrowed } : {}), ...(s.to ? { to: s.to } : {}), ...(s.accepts !== undefined ? { accepts: s.accepts } : {}),
      // A question says whom it is for, and whether the proposer answered it by looking.
      ...(s.for ? { for: s.for } : {}), ...(s.answeredBy ? { answeredBy: s.answeredBy } : {}),
      ...(s.nothingNew ? { nothingNew: true } : {}), ...(s.verdict ? { verdict: s.verdict } : {}),
      ...(s.bigger ? { bigger: Object.fromEntries(Object.entries(s.bigger).map(([k, v]) => [k, blind(v)])) } : {}), ...(s.assumption !== undefined ? { assumption: s.assumption } : {}),
    })),
    ...(t.closed ? { closed: t.closed } : {}),
  };
}

// The idea alone, without what was said about it.
function ideaView(ctx, t) {
  const { statements, ...idea } = threadView(ctx, t);
  return idea;
}

// ---- The turns ----

function turnOf(ctx, role, root) {
  const { session, record, verdicts } = ctx;
  if (session.phase === 'write' || session.phase === 'review') return docTurn(ctx, role, root);
  const cmd = (rest) => `node "${scriptOf(session)}" ${rest} --root "${root}" --session ${session.id}`;
  const mine = threadsFor(session, record, role);
  const not = (why) => { throw new Error(`It is not ${role}'s turn: ${why}. See the status command for whose turn it is.`); };

  switch (session.phase) {
    case 'open':
      if (role !== 'casting') not('before the session starts only the cast can be chosen, by the casting role');
      return { prompts: ['casting.md'], digest: true, input: null, cmd: cmd('cast'), shape: '{ "seats": [ { "role": "onboarding", "title": "Onboarding", "ground": "…" } ] }', okLine: 'casting: ok, 5 seats', badLine: 'casting: invalid — <first error>' };
    case 'evidence':
      if (role === 'primer') {
        // A primer written before is refreshed, not written again: what still holds stays, and what changed is said.
        const previous = loadGroundwork(root, 'primer');
        return { prompts: ['primer.md'], digest: true, input: { name: 'primer', data: { refresh: Boolean(previous?.primer), previous: previous?.primer ? { at: previous.at, primer: previous.primer, sources: previous.entries } : null } }, cmd: cmd('primer'), shape: '{ "primer": { "trade": "…", "buyers": [ { "who": "…", "job": "…", "howTheyBuy": "…" } ], "economics": "…", "commodity": ["…"], "scarce": ["…"], "clocks": [ { "what": "…", "when": "2027-04" } ], "vocabulary": [ { "term": "…", "means": "…" } ], "playbook": ["…"] }, "evidence": [ { "grade": "observed", "source": "https://…", "date": "2026-10-02", "text": "…" } ] }', okLine: 'primer: ok, 6 sources', badLine: 'primer: invalid — <first error>' };
      }
      if (role === 'horizon') return { prompts: ['horizon.md'], digest: true, input: null, cmd: cmd('evidence --role horizon'), shape: '{ "evidence": [ { "grade": "observed", "source": "https://…", "date": "2026-10-02", "text": "…" } ] }', okLine: 'horizon: ok, 14 openings', badLine: 'horizon: invalid — <first error>' };
      if (role !== 'competitors') not('in the evidence phase only the domain primer, the competitor analyst and the horizon scan look around');
      return { prompts: ['scout.md'], input: null, cmd: cmd('evidence --role competitors'), shape: '{ "evidence": [ { "grade": "observed", "source": "https://…", "text": "…" } ] }', okLine: 'scout: ok, 9 observations', badLine: 'scout: invalid — <first error>' };
    case 'frame': {
      const frame = loadFrame(ctx.dir);
      if (role === 'framer') return { prompts: ['framer.md'], digest: true, input: null, cmd: cmd('frame --role framer'), shape: '{ "frame": { "ideal": "…", "contradictions": [ { "want": "…", "butThen": "…", "separate": "…" } ], "resources": ["…"], "curve": { "now": "…", "next": "…" }, "questions": [ { "text": "How might we …", "altitude": "reframe" } ] } }', okLine: 'framer: ok, 8 questions', badLine: 'framer: invalid — <first error>' };
      if (role !== 'provocateur' || session.step !== 'provoke') not('in the frame phase the framer sets the problem, then the provocateur writes the provocations');
      return { prompts: ['provocateur.md'], digest: true, input: { name: 'provoke', data: { frame: frame?.frame ?? null } }, cmd: cmd('frame --role provocateur'), shape: '{ "provocations": [ { "text": "Clients pay us nothing.", "kind": "reversal" } ] }', okLine: 'provocateur: ok, 8 provocations', badLine: 'provocateur: invalid — <first error>' };
    }
    case 'amplify': {
      if (!mine.length) not(`${role} has no bet to build on`);
      return { prompts: ['_contract.md', 'amplifier.md'], sheet: role !== 'client', input: { name: `amplify-${role}`, data: { bets: mine.map((t) => ideaView(ctx, t)) } }, cmd: cmd(`say --role ${role}`), shape: '{ "statements": [ { "type": "amplify", "thread": "T3", "text": "…", "bigger": { "change": "…", "effect": "…", "because": "…" } } ] }', okLine: `${role}: ok, 2 bets built on`, badLine: `${role}: invalid — <first error>` };
    }
    case 'track-record': {
      if (role !== 'track-record') not('the track record is checked by the track-record role');
      const due = dueForCheck(loadIdeas(root));
      if (!due.length) not('no idea has a test whose date has passed');
      return { prompts: ['track-record.md'], input: { name: 'track-record', data: { today: today(), ideas: due } }, cmd: `node "${scriptOf(session)}" ideas --root "${root}" --by council --session ${session.id}`, shape: '{ "ideas": [ { "id": "I3", "status": "worked", "result": { "found": "…", "source": "…" } } ] }', okLine: 'track record: ok, 2 results', badLine: 'track record: invalid — <first error>' };
    }
    case 'propose': {
      if (!proposers(session).includes(role)) not('this seat does not propose ideas');
      if (isLab(session)) {
        const frame = loadFrame(ctx.dir);
        const base = role === 'client' ? ['_contract.md', 'proposer.md', 'client.md'] : ['_contract.md', 'proposer.md'];
        const bet = '"assumptions": ["…", "…"], "riskiest": 0, "upside": "significant", "priorArt": { "exists": "no", "searched": "…" }, "evidence": []';
        if (passOf(session) === 2) {
          const taken = record.threads.map((t) => { const h = record.statements.find((s) => s.thread === t.id && s.type === 'hypothesis'); return { title: h.title, change: h.hypothesis.change, yours: t.by === role }; });
          return { prompts: [...base, 'proposer-second.md'], sheet: role !== 'client', digest: true, input: { name: `propose2-${role}`, data: { provocations: frame?.provocations ?? [], taken } }, cmd: cmd(`say --role ${role}`), shape: `{ "statements": [ { "type": "hypothesis", "title": "…", "hypothesis": { … }, "test": { … }, "effort": "large", "scale": "new", "provocation": "P3", ${bet} } ] }`, okLine: `${role}: ok, 2 bets`, badLine: `${role}: invalid — <first error>` };
        }
        return { prompts: base, sheet: role !== 'client', digest: true, input: { name: `propose-${role}`, data: dealtTo(session, frame, role) }, cmd: cmd(`say --role ${role}`), shape: `{ "statements": [ { "type": "hypothesis", "title": "…", "hypothesis": { … }, "test": { … }, "effort": "large", "scale": "new", "answers": "H2", "cards": ["K7"], ${bet} } ] }`, okLine: `${role}: ok, 3 bets`, badLine: `${role}: invalid — <first error>` };
      }
      const base = role === 'client' ? ['_contract.md', 'proposer.md', 'client.md'] : ['_contract.md', 'proposer.md'];
      if (passOf(session) === 2) {
        // The themes on the table, without who proposed them: what to steer away from, not whom to answer.
        const taken = record.threads.map((t) => { const h = record.statements.find((s) => s.thread === t.id && s.type === 'hypothesis'); return { title: h.title, change: h.hypothesis.change, scale: h.scale, yours: t.by === role }; });
        return { prompts: [...base, 'proposer-second.md'], sheet: role !== 'client', input: { name: `propose2-${role}`, data: { taken } }, digest: true, cmd: cmd(`say --role ${role}`), shape: '{ "statements": [ { "type": "hypothesis", "title": "…", "hypothesis": { … }, "test": { … }, "effort": "large", "scale": "new", "uncovered": "…", "priorArt": { "exists": "no", "searched": "…" }, "evidence": ["E31"] } ] }', okLine: `${role}: ok, 1 hypothesis`, badLine: `${role}: invalid — <first error>` };
      }
      return { prompts: base, sheet: role !== 'client', input: null, digest: true, cmd: cmd(`say --role ${role}`), shape: '{ "statements": [ { "type": "hypothesis", "title": "…", "hypothesis": { … }, "test": { … }, "effort": "small", "scale": "adjustment", "where": [ { "url": "https://…", "part": "…", "text": "…" } ], "priorArt": { "exists": "partly", "searched": "…", "who": "…", "outcome": "…", "difference": "…", "evidence": ["E9"] }, "evidence": ["E3"] } ] }', okLine: `${role}: ok, 3 hypotheses`, badLine: `${role}: invalid — <first error>` };
    }
    case 'docket':
      if (role !== 'judge') not('the docket is the judge\'s');
      return {
        prompts: ['docket.md'], digest: true, cmd: cmd('verdict --stage docket'), shape: '{ "admitted": [ { "thread": "T1", "merge": ["T4"], "novelty": "familiar" } ], "refused": [ { "thread": "T3", "reason": "…", "ref": "S3" } ] }', okLine: 'docket: ok, 14 admitted, 3 refused', badLine: 'docket: invalid — <first error>',
        // In the lab the judge sees what each bet became when another seat built on it, and may adopt that form.
        input: { name: 'docket', data: { ideas: record.threads.map((t) => (isLab(session) ? threadView(ctx, t) : ideaView(ctx, t))) } },
      };
    case 'examine': {
      if (!mine.length) not(`${role} has no thread to speak on in round ${session.round}, ${session.step}`);
      // In round one a seat sees every idea but its own; `cover` marks the ones it must speak on.
      const covers = session.step === 'attack' && !['red-team', 'client'].includes(role);
      const input = { name: `round${session.round}-${session.step}-${role}`, data: { round: session.round, step: session.step, threads: mine.map((t) => ({ ...(covers ? { cover: session.assignments[t.id] === role } : {}), ...threadView(ctx, t, { you: role }) })) } };
      const save = cmd(`say --role ${role}`);
      if (session.step === 'reply') return { prompts: ['_contract.md', 'defender.md'], sheet: true, input, cmd: save, shape: '{ "statements": [ { "type": "reply", "thread": "T1", "stance": "refute", "to": [14, 15], "text": "…", "evidence": ["E7"] } ] }', okLine: `${role}: ok, 3 replies`, badLine: `${role}: invalid — <first error>` };
      const kind = role === 'red-team' ? 'red-team.md' : role === 'client' ? 'client.md' : 'attacker.md';
      const shape = role === 'client' ? '{ "statements": [ { "type": "client", "thread": "T2", "cares": "no", "text": "…" } ] }'
        : '{ "statements": [ { "type": "steelman", "thread": "T1", "text": "…" }, { "type": "attack", "thread": "T1", "kind": "evidence", "text": "…", "evidence": ["E4"] } ] }';
      return { prompts: ['_contract.md', kind], sheet: role !== 'red-team' && role !== 'client', input, cmd: save, shape, okLine: `${role}: ok, 12 statements`, badLine: `${role}: invalid — <first error>` };
    }
    case 'verdict': {
      if (role !== 'judge') not('the verdict is the judge\'s');
      const ideas = loadIdeas(root);
      const threads = record.threads.filter((t) => t.status === 'admitted').map((t) => ({ ...threadView(ctx, t), strongestAllowed: strengthAllowed(record, ctx.evidence, t.id) }));
      return { prompts: ['judge.md'], input: { name: 'verdict', data: { goal: session.goal, trackRecord: recordLine(ideas.length, trackRecord(ideas)), threads } }, cmd: cmd('verdict --stage verdict'), shape: '{ "rulings": [ { "thread": "T1", "verdict": "survived", "strength": "fair", "vsDoNothing": "…", "reason": "…" } ] }', okLine: 'verdict: ok, 5 survived, 7 killed, 2 undecided', badLine: 'verdict: invalid — <first error>' };
    }
    case 'set': {
      const alive = survivors(verdicts).map((r) => ({ ...r, idea: ideaView(ctx, record.threads.find((t) => t.id === r.thread)) }));
      if (role === 'red-team') return { prompts: ['set.md'], input: { name: 'set-red-team', data: { goal: session.goal, survivors: alive } }, cmd: cmd('verdict --stage set --role red-team'), shape: '{ "notes": [ { "kind": "conflict", "threads": ["T1", "T4"], "text": "…", "asksRuling": false } ] }', okLine: 'set: ok, 3 notes', badLine: 'set: invalid — <first error>' };
      if (role !== 'judge') not('the survivors are looked at by the red team, then by the judge');
      if (!verdicts.set?.notes.some((n) => n.asksRuling)) not('no note asks for a verdict to be looked at again');
      return { prompts: ['judge.md'], set: true, input: { name: 'set-judge', data: { notes: verdicts.set.notes, survivors: alive } }, cmd: cmd('verdict --stage set --role judge'), shape: '{ "changes": [ { "thread": "T4", "verdict": "killed", "causeOfDeath": "…", "reason": "…" } ] }', okLine: 'set: ok, 1 verdict changed', badLine: 'set: invalid — <first error>' };
    }
    default:
      return not(`no agent speaks in the ${session.phase} phase`);
  }
}

function sheetOf(session, role) {
  const s = seat(session, role);
  const lines = ['## Your seat', '', `You hold the seat of **${s.title}**. ${s.ground}`];
  if (exists(`roles/${role}.md`, session)) lines.push('', read(`roles/${role}.md`, session));
  return lines;
}

export function buildContext(ctx, { root, dir, role, phase, save }) {
  const { session, evidence } = ctx;
  if (!seat(session, role) && !STAFF.includes(role)) throw new Error(`Unknown or missing --role "${role ?? ''}". The cast: ${session.cast.map((s) => s.role).join(', ')}; staff: ${STAFF.join(', ')}`);
  if (phase && phase !== session.phase) throw new Error(`The session is in the ${session.phase} phase, not ${phase}. See the status command for the next step.`);
  const turn = turnOf(ctx, role, root);
  const inputs = [`- The goal of this session: **${one(session.goal)}**`, `- Project root (read-only): ${root}`];
  if (session.url) inputs.push(`- The live site: ${session.url}. Open its pages yourself when you need to see them, and cite a page by its address.`);
  if (turn.digest) {
    const file = path.join(dir, 'digest.md');
    fs.writeFileSync(file, digest(root));
    inputs.push(`- What is known about the project (business, market, numbers, rules to respect, what is already planned, every earlier idea and its fate): ${file}`);
  }
  if (turn.input) {
    const file = path.join(dir, 'in', `${turn.input.name}.json`);
    writeJson(file, turn.input.data);
    inputs.push(`- Your material for this turn: ${file}`);
  }
  inputs.push(...(turn.extra ?? []));
  inputs.push(`- The evidence, by id, with its source and grade: ${evidencePath(dir)}`);
  if (evidence.data?.length) inputs.push(`- Data the person shared (${evidence.data.length} files, listed under "data" in the evidence file): ${session.data}`);
  if (evidence.missing?.length) inputs.push(`- What this session lacks: ${evidence.missing.map(one).join(' ')}`);
  if (['track-record', 'docket', 'verdict'].includes(session.phase)) inputs.push(`- The idea ledger: ${ideasPath(root)}`);
  inputs.push(`- Today: ${today()}`);
  if (session.phase === 'examine' || session.phase === 'propose' || session.phase === 'evidence') {
    inputs.push('', "To see a page as a visitor sees it (the site's, a rival's, any public page), take pictures of it on a desktop and a narrow screen, then open the files it names with your file reader:", '', '```bash', `node "${scriptOf(session)}" look --root "${root}" --session ${session.id} --url https://example.com/page`, '```');
    inputs.push('', 'To cite something that is not in the evidence yet, add it first; the reply gives you its id:', '', '```bash', `node "${scriptOf(session)}" evidence --root "${root}" --session ${session.id} --role ${role} <<'COUNCIL_JSON'`, '{ "evidence": [ { "grade": "observed", "source": "https://example.com/page", "text": "What you saw there, in one sentence" } ] }', 'COUNCIL_JSON', '```');
  }
  // In the debate a member sees only its own material; the writers and reviewers afterwards may read the session.
  if (!DOC_STAFF.includes(role)) inputs.push('', 'Read nothing else in the session folder, apart from the pictures the look command gives you: the other files hold what others said, which is not yours to see yet.');
  const prompt = (rel) => (turn.replace ? read(rel, session).replaceAll(turn.replace[0], turn.replace[1]) : read(rel, session));
  return [
    ...turn.prompts.map(prompt).flatMap((p) => [p, '']),
    // Every turn, whatever its role, is told that nobody outside the session is contacted.
    read('_no-contact.md', session), '',
    ...(turn.sheet ? [...sheetOf(session, role), ''] : []),
    ...(turn.set ? ['## This turn', '', 'This is the second look, after the red team\'s notes on the survivors as a set: follow "The set" above.', ''] : []),
    '## Inputs for this turn', '', ...inputs, '',
    '## Delivering your result', '', ...saveLines(turn.cmd, save, turn.shape, turn.okLine, turn.badLine), '',
  ].join('\n');
}

// The line an orchestrator gives a subagent as its whole task.
export const taskLine = (root, session, role, { save = true } = {}) =>
  `Run node "${scriptOf(session)}" context --root "${root}" --session ${session.id} --role ${role} --phase ${session.phase}${save ? ' --save' : ''} and follow the instructions it prints.`;
