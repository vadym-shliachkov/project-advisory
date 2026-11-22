import path from 'node:path';
import { readJson, writeJson } from './io.mjs';
import { skillDirOf, kindOf } from './paths.mjs';
import { proposers } from './session.mjs';

// What the venture board and the invention lab do differently from the council: they frame the problem, provoke, deal
// idea cards, and build on every idea before anyone attacks it. Each is its own skill (skills/venture, skills/lab),
// with its own cast, prompts, cards and documents; both run on the council's scripts. A venture session:
//
//   frame     a framer sets the problem (the ideal final result, the contradictions of the business, its unused
//             resources, where it is on its curve, and "how might we" questions at three heights); a provocateur then
//             writes deliberately absurd statements, to be mined for what is workable in them. The person may pick
//             the framings that matter.
//   propose   first pass: each seat answers its framings with idea cards dealt to it (inventive principles,
//             separation principles, business-model patterns, eliminate-reduce-raise-create moves, other trades);
//             second pass: each seat harvests one or two provocations into workable bets.
//   amplify   every bet is made bigger by another seat ("yes, and"), before anyone attacks it.
//   docket    the judge admits each bet, as proposed or in an amplified form.
//   examine   the sceptic attacks what each bet assumes, never the bet as a whole; two rounds at most.
//   verdict   each bet is ruled on with what it is worth if it works, and the riskiest thing it assumes.
//
// Ideas here are bets: what must be true is the debate, not what can be counted in ten weeks on today's site.

// The invention lab frames the thing it studied instead of the business (its ideal result, its contradictions, a
// morphological box of what it is made of, where it stands on its line of evolution), and debates its inventions as
// the council does: see invention.mjs.

export const UPSIDES = ['incremental', 'significant', 'transformative'];
export const VENTURE_SCALES = ['new', 'direction'];
export const PROVOCATION_KINDS = ['reversal', 'escape', 'exaggeration', 'distortion', 'wishful'];
const ALTITUDES = ['narrow', 'wide', 'reframe'];
const CARDS_PER_SEAT = 3;

export const framePath = (dir) => path.join(dir, 'frame.json');
export const loadFrame = (dir) => readJson(framePath(dir), null);
export const saveFrame = (dir, frame) => writeJson(framePath(dir), frame);
export const loadCards = (kind = 'venture') => readJson(path.join(skillDirOf(kind), 'references', 'cards.json')).cards;

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
function textError(value, at, min, max) {
  if (typeof value !== 'string') return [`${at}: text is required`];
  const t = one(value);
  if (t.length < min) return [`${at}: at least ${min} characters are required`];
  if (t.length > max) return [`${at}: at most ${max} characters (it has ${t.length})`];
  return [];
}
const idsOf = (list, prefix) => (list ?? []).map((x, i) => x.id ?? `${prefix}${i + 1}`);

// ---- The frame ----

export function validateFrame(f, kind = 'venture') {
  if (kind === 'lab') return validateLabFrame(f);
  if (!f || typeof f !== 'object' || Array.isArray(f)) return ['$.frame: an object is required'];
  const errors = [...textError(f.ideal, '$.frame.ideal', 30, 400)];
  if (!Array.isArray(f.contradictions) || f.contradictions.length < 2 || f.contradictions.length > 5) errors.push('$.frame.contradictions: two to five, each { "want", "butThen", "separate" }: what the business needs, what that makes worse, and how the two could be separated');
  else f.contradictions.forEach((c, i) => errors.push(...textError(c?.want, `$.frame.contradictions[${i}].want`, 10, 240), ...textError(c?.butThen, `$.frame.contradictions[${i}].butThen`, 10, 240), ...textError(c?.separate, `$.frame.contradictions[${i}].separate`, 10, 300)));
  if (!Array.isArray(f.resources) || f.resources.length < 3 || f.resources.length > 10) errors.push('$.frame.resources: three to ten things the business has and does not use (its waste included), each one line');
  else f.resources.forEach((r, i) => errors.push(...textError(r, `$.frame.resources[${i}]`, 10, 240)));
  if (!f.curve || typeof f.curve !== 'object') errors.push('$.frame.curve: { "now", "next" }: where the business is on its curve, and the step after it');
  else errors.push(...textError(f.curve.now, '$.frame.curve.now', 20, 300), ...textError(f.curve.next, '$.frame.curve.next', 20, 300));
  if (!Array.isArray(f.questions) || f.questions.length < 6 || f.questions.length > 10) errors.push('$.frame.questions: six to ten "How might we" questions, each { "text", "altitude" }');
  else {
    f.questions.forEach((q, i) => {
      errors.push(...textError(q?.text, `$.frame.questions[${i}].text`, 15, 240));
      if (!/^how might we\b/i.test(one(q?.text))) errors.push(`$.frame.questions[${i}].text: start with "How might we"`);
      if (!ALTITUDES.includes(q?.altitude)) errors.push(`$.frame.questions[${i}].altitude: ${ALTITUDES.join(', ')}`);
    });
    if (f.questions.filter((q) => q?.altitude === 'reframe').length < 2) errors.push('$.frame.questions: at least two at the altitude "reframe": questions that change the goal itself');
  }
  for (const key of Object.keys(f)) if (!['ideal', 'contradictions', 'resources', 'curve', 'questions'].includes(key)) errors.push(`$.frame: unknown property "${key}"`);
  return errors;
}

// Ids are given by the script: H1… for the questions, C1… for the contradictions, P1… for the provocations.
export function cleanFrame(f, kind = 'venture') {
  if (kind === 'lab') return cleanLabFrame(f);
  return {
    ideal: one(f.ideal),
    contradictions: f.contradictions.map((c, i) => ({ id: `C${i + 1}`, want: one(c.want), butThen: one(c.butThen), separate: one(c.separate) })),
    resources: f.resources.map(one),
    curve: { now: one(f.curve.now), next: one(f.curve.next) },
    questions: f.questions.map((q, i) => ({ id: `H${i + 1}`, text: one(q.text), altitude: q.altitude })),
  };
}

// The invention lab's frame, about the thing rather than the business. The morphological box lists what the thing is
// made of (its dimensions) and the options each could take, with the one it has now: the combinations nobody has built
// are where a seat looks first. Its line of evolution says where it stands (by hand or automatic, fixed or adapting,
// one of a kind or one of many) and what the next step on that line would be.
function questionErrors(f) {
  const errors = [];
  if (!Array.isArray(f.questions) || f.questions.length < 6 || f.questions.length > 10) return ['$.frame.questions: six to ten "How might we" questions, each { "text", "altitude" }'];
  f.questions.forEach((q, i) => {
    errors.push(...textError(q?.text, `$.frame.questions[${i}].text`, 15, 240));
    if (!/^how might we\b/i.test(one(q?.text))) errors.push(`$.frame.questions[${i}].text: start with "How might we"`);
    if (!ALTITUDES.includes(q?.altitude)) errors.push(`$.frame.questions[${i}].altitude: ${ALTITUDES.join(', ')}`);
  });
  if (f.questions.filter((q) => q?.altitude === 'reframe').length < 2) errors.push('$.frame.questions: at least two at the altitude "reframe": questions that change the goal itself');
  return errors;
}
function contradictionErrors(f) {
  if (!Array.isArray(f.contradictions) || f.contradictions.length < 2 || f.contradictions.length > 5) return ['$.frame.contradictions: two to five, each { "want", "butThen", "separate" }: what the thing needs, what that makes worse, and how the two could be separated'];
  return f.contradictions.flatMap((c, i) => [...textError(c?.want, `$.frame.contradictions[${i}].want`, 10, 240), ...textError(c?.butThen, `$.frame.contradictions[${i}].butThen`, 10, 240), ...textError(c?.separate, `$.frame.contradictions[${i}].separate`, 10, 300)]);
}
export function validateLabFrame(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return ['$.frame: an object is required'];
  const errors = [...textError(f.ideal, '$.frame.ideal', 30, 400), ...contradictionErrors(f)];
  if (!Array.isArray(f.morphology) || f.morphology.length < 3 || f.morphology.length > 6) errors.push('$.frame.morphology: three to six dimensions of the thing, each { "name", "options": [three to six], "now": the position of the option it has today, or -1 }');
  else f.morphology.forEach((d, i) => {
    const at = `$.frame.morphology[${i}]`;
    errors.push(...textError(d?.name, `${at}.name`, 3, 60));
    if (!Array.isArray(d?.options) || d.options.length < 3 || d.options.length > 6) errors.push(`${at}.options: three to six options this dimension could take, the one it has now among them`);
    else d.options.forEach((o, j) => errors.push(...textError(o, `${at}.options[${j}]`, 2, 80)));
    if (!Number.isInteger(d?.now) || d.now < -1 || d.now >= (d?.options?.length ?? 0)) errors.push(`${at}.now: the position (from 0) of the option the thing has today, or -1 when it has none of them`);
  });
  if (!f.evolution || typeof f.evolution !== 'object') errors.push('$.frame.evolution: { "now", "next" }: where the thing stands on its line of evolution, and the next step on it');
  else errors.push(...textError(f.evolution.now, '$.frame.evolution.now', 20, 300), ...textError(f.evolution.next, '$.frame.evolution.next', 20, 300));
  errors.push(...questionErrors(f));
  for (const key of Object.keys(f)) if (!['ideal', 'contradictions', 'morphology', 'evolution', 'questions'].includes(key)) errors.push(`$.frame: unknown property "${key}"`);
  return errors;
}
export function cleanLabFrame(f) {
  return {
    ideal: one(f.ideal),
    contradictions: f.contradictions.map((c, i) => ({ id: `C${i + 1}`, want: one(c.want), butThen: one(c.butThen), separate: one(c.separate) })),
    morphology: f.morphology.map((d, i) => ({ id: `M${i + 1}`, name: one(d.name), options: d.options.map(one), now: d.now })),
    evolution: { now: one(f.evolution.now), next: one(f.evolution.next) },
    questions: f.questions.map((q, i) => ({ id: `H${i + 1}`, text: one(q.text), altitude: q.altitude })),
  };
}

export function validateProvocations(list) {
  if (!Array.isArray(list) || list.length < 5 || list.length > 12) return ['$.provocations: five to twelve, each { "text", "kind" }'];
  return list.flatMap((p, i) => [
    ...textError(p?.text, `$.provocations[${i}].text`, 10, 240),
    ...(PROVOCATION_KINDS.includes(p?.kind) ? [] : [`$.provocations[${i}].kind: ${PROVOCATION_KINDS.join(', ')}`]),
  ]);
}
export const cleanProvocations = (list) => list.map((p, i) => ({ id: `P${i + 1}`, text: one(p.text), kind: p.kind }));

// The framings the seats work on: the ones the person picked, or all of them.
export function framings(frame) {
  if (!frame?.frame) return [];
  const all = [...frame.frame.questions.map((q) => q.id), ...frame.frame.contradictions.map((c) => c.id)];
  return frame.picked?.length ? all.filter((id) => frame.picked.includes(id)) : all;
}

export function pickErrors(frame, ids) {
  if (!frame?.frame) return ['The frame has not been written yet.'];
  const known = new Set([...idsOf(frame.frame.questions, 'H'), ...idsOf(frame.frame.contradictions, 'C')]);
  const bad = ids.filter((id) => !known.has(id));
  return bad.length ? [`Unknown framings: ${bad.join(', ')}. The framings are ${[...known].join(', ')}.`] : ids.length ? [] : ['Pick at least one framing, or pick none to keep them all.'];
}

// ---- Dealing ----

// A small seeded generator, so the same session deals the same cards when it is run again.
function seeded(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}
const shuffle = (list, rnd) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Each seat gets cards from three different families, and one or two framings, spread so every framing has a seat.
export function deal(session, frame, cards = loadCards(kindOf(session))) {
  const rnd = seeded(session.id);
  const seats = proposers(session);
  const families = [...new Set(cards.map((c) => c.family))];
  const decks = Object.fromEntries(families.map((f) => [f, shuffle(cards.filter((c) => c.family === f), rnd)]));
  const dealt = {};
  seats.forEach((role, i) => {
    const order = shuffle(families, rnd);
    dealt[role] = order.slice(0, CARDS_PER_SEAT).map((f) => decks[f][i % decks[f].length].id);
  });
  const ids = shuffle(framings(frame), rnd);
  const given = Object.fromEntries(seats.map((r) => [r, []]));
  ids.forEach((id, i) => given[seats[i % seats.length]].push(id));
  // A seat left without one, when there are fewer framings than seats, takes one from the start of the list.
  seats.forEach((r, i) => { if (!given[r].length && ids.length) given[r].push(ids[i % ids.length]); });
  return { cards: dealt, framings: given };
}

// Each bet is given to one other seat to make it bigger, never its proposer's; spread evenly.
export function assignAmplifiers(session, record) {
  const pool = proposers(session);
  const load = Object.fromEntries(pool.map((r) => [r, 0]));
  const out = {};
  record.threads.forEach((t, n) => {
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

// What a seat is handed for the first pass: the frame, its framings and its cards in full.
export function dealtTo(session, frame, role, cards = loadCards(kindOf(session))) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  return {
    frame: frame?.frame ?? null,
    yourFramings: session.dealt?.framings?.[role] ?? [],
    picked: frame?.picked ?? null,
    yourCards: (session.dealt?.cards?.[role] ?? []).map((id) => byId.get(id)).filter(Boolean),
  };
}

// ---- The fields a bet of the venture board carries beyond a council hypothesis ----

export function betErrors(s, at, { session, frame, pass, role, scales = null }) {
  const errors = [];
  // The lab checks its own scales (see invention.mjs); the venture board's are new and direction.
  if (!scales && !VENTURE_SCALES.includes(s.scale)) errors.push(`${at}.scale: new (something the business does not do or have at all) or direction (a remake of what it is); the venture board does not propose edits`);
  if (!Array.isArray(s.assumptions) || s.assumptions.length < 2 || s.assumptions.length > 6) errors.push(`${at}.assumptions: two to six things that would have to be true for this to work, each one sentence`);
  else s.assumptions.forEach((a, i) => errors.push(...textError(a, `${at}.assumptions[${i}]`, 10, 240)));
  if (!Number.isInteger(s.riskiest) || s.riskiest < 0 || s.riskiest >= (s.assumptions?.length ?? 0)) errors.push(`${at}.riskiest: the position in "assumptions" (from 0) of the one most likely to be false`);
  if (!UPSIDES.includes(s.upside)) errors.push(`${at}.upside: what it is worth if it works: ${UPSIDES.join(', ')}`);
  if (pass === 1) {
    const mine = session.dealt?.cards?.[role] ?? null;
    if (!Array.isArray(s.cards) || !s.cards.length) errors.push(`${at}.cards: the ids of the cards dealt to you that led to this bet`);
    else if (mine) for (const c of s.cards) if (!mine.includes(c)) errors.push(`${at}.cards: ${c} was not dealt to you; your cards are ${mine.join(', ')}`);
    const known = new Set([...(frame?.frame?.questions ?? []).map((q) => q.id), ...(frame?.frame?.contradictions ?? []).map((c) => c.id)]);
    if (!known.has(s.answers)) errors.push(`${at}.answers: the framing this bet answers, such as H2 or C1`);
    if (s.provocation !== undefined) errors.push(`${at}.provocation: provocations are harvested in the second pass`);
  } else {
    const known = new Set((frame?.provocations ?? []).map((p) => p.id));
    if (!known.has(s.provocation)) errors.push(`${at}.provocation: the provocation this bet was harvested from, such as P3`);
    for (const key of ['cards', 'answers']) if (s[key] !== undefined) errors.push(`${at}.${key}: only a first-pass bet names ${key === 'cards' ? 'its cards' : 'the framing it answers'}`);
  }
  return errors;
}

export const cleanBet = (s) => ({
  assumptions: s.assumptions.map(one), riskiest: s.riskiest, upside: s.upside,
  ...(s.cards ? { cards: [...s.cards] } : {}), ...(s.answers ? { answers: s.answers } : {}), ...(s.provocation ? { provocation: s.provocation } : {}),
});

// The idea a bet is debated as: its amplified form when the judge adopted one at the docket.
export function adopted(record, t, h) {
  if (!t?.adopted) return h.hypothesis;
  const amp = record.statements.find((s) => s.n === t.adopted);
  return amp?.bigger ? { ...h.hypothesis, ...amp.bigger } : h.hypothesis;
}
