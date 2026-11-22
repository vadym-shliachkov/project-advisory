import { betErrors, cleanBet } from './frame.mjs';
import { anatomyIds, ROOT_REFS } from './anatomy.mjs';

// An invention of the invention lab: something new the thing itself could do, have or become. It is a bet (what would
// have to be true, the riskiest of it, what it is worth if it works) with three things more:
//
//   experience  how a person who uses the thing would live it, step by step: an invention nobody can picture is a slogan;
//   buildsOn    the parts of the anatomy it grows from (a part, something the thing knows, something its platform could
//               do that it does not use): an invention that grows from nothing of this thing belongs to any thing;
//   newTo       how new its proposer claims it is, after looking: new to the world, or new to this category (borrowed
//               from another field). The judge rules on it after the debate, and may find it is new only here.
//
// Its debate is the council's: three rounds of attack and reply, every seat attacking in the first. The attack that
// matters most is "exists": a search that finds the same thing already made.

// How far an invention reaches: a new capability inside the thing, a new thing built from it beside it, or a remake of
// how the thing works.
export const LAB_SCALES = ['feature', 'product', 'remake'];
export const SCALE_WORDS = {
  feature: 'A new capability inside the thing.',
  product: 'A new thing built from it, beside it: a companion, a tool, an edition.',
  remake: 'A remake of how the thing works or what it is.',
};
// What the proposer may claim, and what the judge may rule.
export const CLAIMS = ['world', 'category'];
export const NEW_TO = ['world', 'category', 'here'];
export const NEW_TO_WORDS = {
  world: 'Nothing like it was found anywhere.',
  category: 'It exists in other fields, not in things of this kind.',
  here: 'Things of this kind already have it; it is new only to this one.',
};
// How far the thing is from being able to do it, as it is built.
export const FEASIBLE = ['now', 'stretch', 'research'];
export const FEASIBLE_WORDS = {
  now: 'The thing as it is built could do it.',
  stretch: 'It needs parts the thing does not have yet, which are known how to build.',
  research: 'It needs something nobody has solved well yet.',
};
// The attacks of the lab. "feasibility" is the one the council has no need of: the thing, as it is built, cannot do it.
export const LAB_ATTACK_KINDS = {
  exists: 'it exists already: in this thing, in things of its kind, or elsewhere',
  feasibility: 'the thing, as it is built, cannot do it, or not without a cost the invention does not carry',
  customer: 'the people who use it would not want it',
  harm: 'it harms something else: privacy, accessibility, trust, safety',
  evidence: 'the evidence is weak or reads another way',
  cost: 'it costs more to build and keep than it returns',
  'do-nothing': 'leaving the thing as it is does as well',
};

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
function textError(value, at, min, max) {
  if (typeof value !== 'string') return [`${at}: text is required`];
  const t = one(value);
  if (t.length < min) return [`${at}: at least ${min} characters are required`];
  if (t.length > max) return [`${at}: at most ${max} characters (it has ${t.length})`];
  return [];
}

export function inventionErrors(s, at, { session, frame, anatomy, pass, role }) {
  const errors = betErrors(s, at, { session, frame, pass, role, scales: LAB_SCALES });
  if (!LAB_SCALES.includes(s.scale)) errors.push(`${at}.scale: feature (a new capability inside the thing), product (a new thing built from it, beside it) or remake (a new way the thing works); the lab invents, it does not tidy`);
  if (!Array.isArray(s.experience) || s.experience.length < 3 || s.experience.length > 6) errors.push(`${at}.experience: three to six steps, how a person who uses the thing would live the invention, each one sentence ("You open…", "It shows…")`);
  else s.experience.forEach((step, i) => errors.push(...textError(step, `${at}.experience[${i}]`, 10, 240)));
  const known = anatomyIds(anatomy);
  if (!Array.isArray(s.buildsOn) || !s.buildsOn.length || s.buildsOn.length > 6) errors.push(`${at}.buildsOn: one to six ids of the anatomy this invention grows from, at least one a part (A…), something the thing knows (D…) or something its platform could do and does not (U…)`);
  else {
    for (const id of s.buildsOn) if (!known.has(id)) errors.push(`${at}.buildsOn: ${id} is not in the anatomy; its ids are ${[...known.keys()].join(', ') || 'none (the anatomy has not been written)'}`);
    if (known.size && !s.buildsOn.some((id) => ROOT_REFS.includes(String(id)[0]))) errors.push(`${at}.buildsOn: name at least one part (A…), one thing it knows (D…) or one thing its platform could do (U…): an invention that grows from none of them belongs to any thing, not to this one`);
  }
  if (!CLAIMS.includes(s.newTo)) errors.push(`${at}.newTo: world (nothing like it was found anywhere) or category (it exists in other fields, not in things of this kind). An invention that things of this kind already have is not one: see the standard kit of the genre`);
  else if (s.newTo === 'world' && ['yes', 'partly'].includes(s.priorArt?.exists)) errors.push(`${at}.newTo: your own search found something like it (priorArt.exists is "${s.priorArt.exists}"), so it is not new to the world; say "category" when what you found is in another field`);
  return errors;
}

export const cleanInvention = (s) => ({ ...cleanBet(s), experience: s.experience.map(one), buildsOn: [...s.buildsOn], newTo: s.newTo });

// What the judge adds to a ruling of the lab, beyond what it is worth if it works and its riskiest assumption (which
// the venture board asks for too). An invention new only to this thing does not survive as an invention.
export function labRulingErrors(r, at) {
  const errors = [];
  if (r.verdict === 'killed') {
    if (r.newTo !== undefined && !NEW_TO.includes(r.newTo)) errors.push(`${at}.newTo: ${NEW_TO.join(', ')}`);
    return errors;
  }
  if (!NEW_TO.includes(r.newTo)) errors.push(`${at}.newTo: how new it is after the debate: world, category, or here (things of this kind already have it)`);
  else if (r.newTo === 'here' && r.verdict !== 'undecided') errors.push(`${at}.newTo: an invention that things of this kind already have does not survive as an invention: kill it, with what already exists as its cause of death`);
  if (r.verdict !== 'undecided' && !FEASIBLE.includes(r.feasible)) errors.push(`${at}.feasible: now (the thing as it is built could do it), stretch (it needs parts that are known how to build) or research (it needs something nobody has solved well)`);
  if (r.verdict === 'narrowed' && r.narrowed?.scale !== undefined && !LAB_SCALES.includes(r.narrowed.scale)) errors.push(`${at}.narrowed.scale: ${LAB_SCALES.join(', ')}; the lab does not narrow an invention into a tidy-up of what is there`);
  return errors;
}
