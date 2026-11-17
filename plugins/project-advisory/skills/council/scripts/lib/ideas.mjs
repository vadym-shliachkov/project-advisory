import path from 'node:path';
import { readJson, writeJson } from './io.mjs';
import { bankDir } from './paths.mjs';
import { loadSchema, validate } from './schema.mjs';
import { today, holdsSecret } from './bank.mjs';

// The idea ledger: every idea the council ever proposed, with its fate. It lives in the knowledge bank, outlives
// every session, and is what stops week three from repeating week one. Other skills read it; only this one writes it.
export const ideasPath = (root) => path.join(bankDir(root), 'ideas.json');

const num = (id) => Number(id.slice(1));

export function loadIdeas(root) {
  return readJson(ideasPath(root), null)?.ideas ?? [];
}

export function saveIdeas(root, ideas) {
  writeJson(ideasPath(root), { ideas: [...ideas].sort((a, b) => num(a.id) - num(b.id)) });
}

// Where an idea may go from each status. The council rules, then the person decides, then the world answers.
export const MOVES = {
  proposed: ['killed', 'undecided', 'survived'],
  killed: [],
  undecided: ['proposed'],
  survived: ['accepted', 'rejected', 'later'],
  accepted: ['planned', 'testing'],
  rejected: [],
  later: ['accepted', 'rejected', 'proposed'],
  planned: ['testing'],
  testing: ['worked', 'failed', 'inconclusive'],
  worked: [],
  failed: [],
  inconclusive: ['testing'],
};
export const STATUSES = Object.keys(MOVES);

// An idea that ended here may come back only as a new idea that says what changed.
const DEAD = ['killed', 'rejected', 'failed'];

// What a status needs before an idea can take it.
const NEEDS = {
  killed: [(i) => i.verdict?.causeOfDeath, 'verdict.causeOfDeath: say in one line what killed it'],
  undecided: [(i) => i.verdict?.wouldDecide, 'verdict.wouldDecide: say what would decide it'],
  survived: [(i) => i.verdict?.strength && i.verdict?.vsDoNothing, 'verdict.strength and verdict.vsDoNothing: say how strong the support is and why it beats leaving things as they are'],
  rejected: [(i) => i.decision?.reason, 'decision.reason: the reason is kept so the idea does not return'],
  planned: [(i) => i.plannedIn, 'plannedIn: name the fix plan that adopted it'],
  testing: [(i) => i.test?.what && i.test?.checkOn, 'test.what and test.checkOn: say how it is tested and when to look'],
  worked: [(i) => i.result?.found, 'result.found: say what was found'],
  failed: [(i) => i.result?.found, 'result.found: say what was found'],
  inconclusive: [(i) => i.result?.found, 'result.found: say what was found'],
};

const WORD_NUMBERS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
};
const UNIT_DAYS = { day: 1, week: 7, month: 30, quarter: 91, year: 365 };
const COUNT = `(\\d+|${Object.keys(WORD_NUMBERS).join('|')})`;
// A count that stands right before its unit, with an optional range: "six weeks", "4 to 6 weeks", "a month".
const SPAN = new RegExp(`\\b${COUNT}(?:\\s*(?:to|-|–|or)\\s*${COUNT})?[\\s-]+(day|week|month|quarter|year)s?\\b`, 'g');
const countOf = (word) => (word === undefined ? 0 : Number(word) || WORD_NUMBERS[word]);

// The date to read a test that starts on `from`, from a wait such as "six weeks" or "4 to 6 weeks" (the longer end).
// Only a number that goes with a unit counts, so "eight weeks, or sixteen if the site gets fewer than 300 visits" is
// eight weeks; the first wait named is the one read, and a part joined to it by "and" ("one month and two weeks") is
// added. Null when the wait cannot be read, so the person is asked for the date.
export function checkDate(checkAfter, from = today()) {
  const text = String(checkAfter ?? '').toLowerCase();
  const spans = [...text.matchAll(SPAN)];
  if (!spans.length) return null;
  const days = (m) => Math.max(countOf(m[1]), countOf(m[2])) * UNIT_DAYS[m[3]];
  let total = days(spans[0]);
  for (let n = 1; n < spans.length && /^\s*,?\s*and\s*$/.test(text.slice(spans[n - 1].index + spans[n - 1][0].length, spans[n].index)); n++) total += days(spans[n]);
  const at = new Date(`${from}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return null;
  at.setUTCDate(at.getUTCDate() + total);
  return at.toISOString().slice(0, 10);
}

export function nextIdeaId(ideas) {
  return `I${ideas.reduce((max, i) => Math.max(max, num(i.id)), 0) + 1}`;
}

const moveError = (from, to) => (MOVES[from].length
  ? `it is ${from}, and from there it can only become ${MOVES[from].join(', ')}`
  : `it is ${from}, which is final; bring it back as a new idea with "returns" and "whatChanged"`);

// A save carries only what changed. An entry without an id is a new idea and gets the next id; an entry with an id
// updates that idea, and a change of status must be a move the ledger allows. Every such change is added to the
// idea's history. Nothing is saved when anything is refused.
export function applyIdeas(current, patch, { by, session, date = today() } = {}) {
  const ideas = current.map((i) => structuredClone(i));
  const errors = [];
  const saved = [];
  const list = Array.isArray(patch?.ideas) ? patch.ideas : null;
  if (!list) return { ideas: current, errors: ['$.ideas: an array of ideas is required'], saved };
  if (!by) return { ideas: current, errors: ['Say who is saving (--by): a skill name, or "person"'], saved };
  const stamp = (event, note) => ({ date, event, by, ...(session ? { session } : {}), ...(note ? { note } : {}) });

  list.forEach((entry, n) => {
    const at = `$.ideas[${n}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { errors.push(`${at}: an object is required`); return; }
    const { note, history, addedAt, updatedAt, ...fields } = entry;

    if (fields.id === undefined) {
      const status = fields.status ?? 'proposed';
      if (status !== 'proposed') { errors.push(`${at}.status: a new idea starts as proposed, not ${status}`); return; }
      if (fields.returns) {
        const old = ideas.find((i) => i.id === fields.returns);
        if (!old) { errors.push(`${at}.returns: there is no idea ${fields.returns}`); return; }
        if (DEAD.includes(old.status) && !fields.whatChanged) {
          errors.push(`${at}.whatChanged: ${old.id} "${old.title}" was ${old.status}; say what is different now, or leave the idea out`);
          return;
        }
      }
      if (fields.parent && !ideas.some((i) => i.id === fields.parent)) { errors.push(`${at}.parent: there is no idea ${fields.parent}`); return; }
      const idea = { ...fields, id: nextIdeaId(ideas), status, history: [stamp('proposed', note)], addedAt: date, updatedAt: date };
      ideas.push(idea);
      saved.push(idea);
      return;
    }

    const idea = ideas.find((i) => i.id === fields.id);
    if (!idea) { errors.push(`${at}.id: there is no idea ${fields.id}; leave the id out for a new idea`); return; }
    const from = idea.status;
    const to = fields.status ?? from;
    for (const k of ['parent', 'returns']) {
      if (fields[k] !== undefined && fields[k] !== idea[k]) errors.push(`${at}.${k}: where ${idea.id} comes from cannot be changed`);
    }
    if (to !== from && !MOVES[from]?.includes(to)) { errors.push(`${at}.status: ${idea.id} cannot become ${to}: ${moveError(from, to)}`); return; }
    // A test is completed, not replaced: the person adds when to look, and what the council wrote stays.
    const test = fields.test && idea.test ? { ...idea.test, ...fields.test } : fields.test ?? idea.test;
    Object.assign(idea, fields, test ? { test } : {});
    // When a test starts, the date to read it follows from how long the council said to wait, counted from the day the
    // change went live when the person said it, or else from today.
    if (to === 'testing' && to !== from && idea.test && !idea.test.checkOn) {
      const on = checkDate(idea.test.checkAfter, idea.test.liveSince ?? date);
      if (on) idea.test.checkOn = on;
    }
    if (['accepted', 'rejected', 'later'].includes(to) && to !== from) idea.decision = { ...idea.decision, decision: to, date };
    if (to !== from && NEEDS[to] && !NEEDS[to][0](idea)) { errors.push(`${at}: ${idea.id} cannot become ${to} without ${NEEDS[to][1]}`); return; }
    if (to !== from || note) idea.history.push(stamp(to !== from ? to : 'note', note));
    idea.updatedAt = date;
    saved.push(idea);
  });

  if (!errors.length) errors.push(...validateIdeas(ideas));
  return errors.length ? { ideas: current, errors, saved: [] } : { ideas, errors, saved };
}

export function validateIdeas(ideas) {
  const schema = loadSchema('idea');
  const errors = ideas.flatMap((idea, n) => validate(schema, idea, `$.ideas[${n}]`));
  if (errors.length) return errors;
  const ids = new Set();
  for (const i of ideas) {
    if (ids.has(i.id)) errors.push(`duplicate id ${i.id}`);
    ids.add(i.id);
  }
  const texts = ideas.flatMap((i) => [i.title, ...Object.values(i.hypothesis), i.whatChanged, i.verdict?.causeOfDeath, i.verdict?.wouldDecide, i.decision?.reason, i.test?.what, i.result?.found]);
  if (texts.some((t) => t && holdsSecret(t))) errors.push('The idea ledger must not hold secrets such as passwords or keys: describe where they are kept instead.');
  return errors;
}

// The idea and the ideas it was narrowed from, the oldest first.
export function lineage(ideas, id) {
  const chain = [];
  const seen = new Set();
  for (let idea = ideas.find((i) => i.id === id); idea && !seen.has(idea.id); idea = ideas.find((i) => i.id === idea.parent)) {
    seen.add(idea.id);
    chain.unshift(idea);
  }
  return chain;
}

// How the council's survivors have done so far, for the judge and for the suggestions document.
export function trackRecord(ideas) {
  const survivors = ideas.filter((i) => i.history.some((h) => h.event === 'survived'));
  const count = (...statuses) => survivors.filter((i) => statuses.includes(i.status)).length;
  const worked = count('worked');
  const failed = count('failed');
  return {
    // Ideas a judge has ruled on. The ideas of the session under way are in the ledger as proposed, and are not counted.
    ruled: ideas.filter((i) => i.history.some((h) => ['survived', 'killed', 'undecided'].includes(h.event))).length,
    survived: survivors.length,
    worked,
    failed,
    inconclusive: count('inconclusive'),
    testing: count('testing'),
    planned: count('planned'),
    notStarted: count('accepted'),
    later: count('later'),
    rejected: count('rejected'),
    awaitingDecision: count('survived'),
    workedShare: worked + failed ? Math.round((worked / (worked + failed)) * 100) : null,
  };
}

// A session set aside before its verdicts were final leaves its ideas proposed and never ruled on. They become
// undecided, with the reason, so they can be proposed again; their history says "set aside", not a ruling, so the
// track record does not count them.
export function setAside(ideas, sessionId, { date = today(), reason } = {}) {
  const ofSession = (i) => i.status === 'proposed' && i.history.some((h) => h.event === 'proposed' && h.session === sessionId);
  const moved = [];
  const out = ideas.map((i) => {
    if (!ofSession(i)) return i;
    moved.push(i.id);
    return {
      ...i, status: 'undecided',
      verdict: { ...i.verdict, session: sessionId, wouldDecide: `Session ${sessionId} was set aside before the judge ruled; a later session can take it up again.` },
      history: [...i.history, { date, event: 'set aside', by: 'person', session: sessionId, ...(reason ? { note: reason } : {}) }],
      updatedAt: date,
    };
  });
  return { ideas: out, moved };
}

// Ideas whose test should have an answer by now.
export function dueForCheck(ideas, date = today()) {
  return ideas.filter((i) => i.status === 'testing' && i.test?.checkOn && i.test.checkOn <= date);
}

// One line per idea, for an agent's context and for the digest.
export function ideaLine(i) {
  const fate = {
    killed: `killed: ${i.verdict?.causeOfDeath ?? 'no cause recorded'}`,
    undecided: `undecided: ${i.verdict?.wouldDecide ?? 'nothing recorded'}`,
    survived: `survived (${i.verdict?.strength ?? 'strength not recorded'}), waiting for the person's decision`,
    rejected: `rejected by the person: ${i.decision?.reason ?? 'no reason recorded'}`,
    later: `kept for later${i.decision?.reason ? `: ${i.decision.reason}` : ''}`,
    planned: `planned in ${i.plannedIn}`,
    testing: `being tested, look on ${i.test?.checkOn}`,
    worked: `worked: ${i.result?.found}`,
    failed: `failed: ${i.result?.found}`,
    inconclusive: `inconclusive: ${i.result?.found}`,
  }[i.status] ?? i.status;
  return `${i.id} "${i.title}" [${i.proposedBy}] — ${fate}`.replace(/\s+/g, ' ');
}
