import { inventionErrors, cleanInvention, NEW_TO, FEASIBLE } from './invention.mjs';

// A direction of the design studio: what one site could look, read and move like. It is debated as an invention of the
// lab is (how a visitor would live it, what of the business it grows from, how new it is, what it assumes), with what
// makes it a design:
//
//   design     the choices that follow from its one idea: type, colour, layout, imagery, motion, the signature moment
//              (or the reason there is none), the technology, the habits of the trade it keeps and the ones it breaks,
//              and what the business must supply for it to be fed;
//   madeFrom   what it was made from: something the business has, an idea about what it is, a field far from the web,
//              or known patterns of the web joined together (an assembly). An assembly is allowed, and carries a
//              burden: it says what the whole is that none of its parts is. A seat sends one at most (the seat whose
//              ground is patterns may send more), so joining what was seen elsewhere is never what the room mostly does.
//
// Three things a direction must not be, each an attack of its own: a copy (one named site, or one effect lifted from
// one), generic (it would fit a rival unchanged: the swap test) and slop (what template and machine-made sites look
// like, as the slop scout listed it).

export const STUDIO_SCALES = ['refresh', 'redesign', 'reinvention'];
export const STUDIO_SCALE_WORDS = {
  refresh: 'A new look, voice and movement on the pages and structure the site has.',
  redesign: 'A new structure as well as a new look: what the pages are, and how a visitor moves through them.',
  reinvention: 'A site of a different kind: not the kind of site its trade usually has.',
};
export const MADE_FROM = ['material', 'idea', 'far-field', 'assembly'];
export const MADE_WORDS = {
  material: 'Made from something the business has: its work, its product, its place, its people, its archive, its data.',
  idea: 'Made from one idea about what the business is or does.',
  'far-field': 'Carried over from a field far from the web: print, film, architecture, an exhibition, a game.',
  assembly: 'Known patterns of the web, joined into something none of them is alone.',
};
// What a signature moment is, when a direction has one. "none" is a ruling like the others, with its reason.
export const SIGNATURES = ['none', 'craft', 'material', 'narrative', 'interaction', 'spectacle', 'speed', 'wit'];
export const SIGNATURE_WORDS = {
  none: 'No signature moment: the site does its job quietly, and that is the choice.',
  craft: 'Detail and finish: type, spacing and small movements done so well they are felt before they are noticed.',
  material: 'The business\'s own material shown as nobody shows it: the product, the work, the place, the numbers.',
  narrative: 'A story the visitor moves through, told by the page.',
  interaction: 'Something the visitor does, and the site answers: play, touch, a tool in the hand.',
  spectacle: 'A scene built to be looked at: three dimensions, a film, a large moving image.',
  speed: 'It is there before the visitor expects it, and never makes them wait.',
  wit: 'A turn of words or a small surprise that makes the visitor smile and remember.',
};
// The swap test, as the judge rules it: put a rival's name on the design.
export const SWAPS = ['own', 'sector', 'anyone'];
export const SWAP_WORDS = {
  own: 'It could only be this business: with a rival\'s name on it, it would be wrong.',
  sector: 'It would fit any business of this trade as well.',
  anyone: 'It would fit almost any business.',
};
// What the judge rules on the signature moment after the debate.
export const SIGNATURE_RULINGS = ['keep', 'quieter', 'drop', 'none'];
export const SIGNATURE_RULING_WORDS = {
  keep: 'The signature moment earned its place.',
  quieter: 'Keep it, smaller or slower: as proposed it would tire or delay the visitor.',
  drop: 'The direction stands without its signature moment.',
  none: 'It has no signature moment, and needs none.',
};
export const STUDIO_NEW_TO_WORDS = {
  world: 'Nothing like it was found on any site.',
  category: 'Sites elsewhere, or fields far from the web, have something like it; sites of this trade do not.',
  here: 'Sites of this trade already look like this.',
};
export const STUDIO_FEASIBLE_WORDS = {
  now: 'It can be built with what the web does today and what the business has.',
  stretch: 'It needs a specialist craft or content the business does not have yet, both known how to get.',
  research: 'It needs something nobody has made work well on the web yet.',
};
export const STUDIO_ATTACK_KINDS = {
  copy: 'it is one site that exists, or one effect lifted from one: name the site and say how close it is',
  assembled: 'it is known patterns side by side, with nothing that makes them one thing',
  generic: 'it would fit a rival, or any business, with the name changed',
  slop: 'it is what template and machine-made sites look like: name the tell',
  signature: 'the signature moment is for the designer, not the visitor: it delays, tires on the tenth visit or says nothing about the business',
  customer: 'the people who come would not want it, or it stands between them and what they came for',
  harm: 'it harms something: accessibility, speed, people who are made ill by movement, privacy, trust',
  feasibility: 'it cannot be built as said, or the business cannot feed it with the content it needs',
  evidence: 'the evidence is weak or reads another way',
  cost: 'it costs more to build and keep than it returns',
  'do-nothing': 'leaving the site as it is does as well',
};

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
function textError(value, at, min, max) {
  if (typeof value !== 'string') return [`${at}: text is required`];
  const t = one(value);
  if (t.length < min) return [`${at}: at least ${min} characters are required`];
  if (t.length > max) return [`${at}: at most ${max} characters (it has ${t.length})`];
  return [];
}

const DESIGN_TEXTS = {
  type: 'the letters and the words: what kind of type, how large, how it speaks',
  colour: 'the colours, and where each comes from',
  layout: 'how a page is built: the grid, the rhythm, what is large and what is left empty',
  imagery: 'what is shown: photographs, drawings, the product, data, nothing at all',
  motion: 'what moves, when, and what the movement means; or why nothing moves',
  technology: 'what it would be built with and why, and what a visitor gets who asked for less motion or has a slow device',
};
const DESIGN_KEYS = [...Object.keys(DESIGN_TEXTS), 'signature', 'keeps', 'breaks', 'needs'];

export function designErrors(d, at) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return [`${at}: the design, as { ${DESIGN_KEYS.map((k) => `"${k}"`).join(', ')} }: the choices that follow from the idea`];
  const errors = Object.entries(DESIGN_TEXTS).flatMap(([key, what]) => textError(d[key], `${at}.${key}`, 20, 400).map((e) => `${e} (${what})`));
  const g = d.signature;
  if (!g || typeof g !== 'object' || Array.isArray(g)) errors.push(`${at}.signature: { "kind", "what", "why", "tenth" }: the one moment a visitor would tell someone about, or { "kind": "none", "why" } with the reason the site needs none`);
  else {
    if (!SIGNATURES.includes(g.kind)) errors.push(`${at}.signature.kind: ${SIGNATURES.join(', ')}`);
    errors.push(...textError(g.why, `${at}.signature.why`, 20, 400).map((e) => `${e} (why this site, for these visitors, needs ${g.kind === 'none' ? 'no signature moment' : 'this one'})`));
    if (g.kind === 'none') {
      for (const key of ['what', 'tenth']) if (g[key] !== undefined) errors.push(`${at}.signature.${key}: a direction with no signature moment has only its "why"`);
    } else {
      errors.push(...textError(g.what, `${at}.signature.what`, 20, 400).map((e) => `${e} (what the visitor sees or does at that moment)`));
      errors.push(...textError(g.tenth, `${at}.signature.tenth`, 15, 300).map((e) => `${e} (what it is like on the tenth visit, for someone who came to get something done)`));
    }
    for (const key of Object.keys(g)) if (!['kind', 'what', 'why', 'tenth'].includes(key)) errors.push(`${at}.signature: unknown property "${key}"`);
  }
  if (!Array.isArray(d.keeps) || d.keeps.length < 1 || d.keeps.length > 5) errors.push(`${at}.keeps: one to five habits of sites of this trade it keeps, because visitors rely on them, each one line`);
  else d.keeps.forEach((k, i) => errors.push(...textError(k, `${at}.keeps[${i}]`, 10, 200)));
  if (!Array.isArray(d.breaks) || d.breaks.length < 1 || d.breaks.length > 4) errors.push(`${at}.breaks: one to four habits of sites of this trade it breaks, each { "what", "why" }: a direction that breaks none looks like every site of the trade`);
  else d.breaks.forEach((b, i) => errors.push(...textError(b?.what, `${at}.breaks[${i}].what`, 10, 200), ...textError(b?.why, `${at}.breaks[${i}].why`, 10, 300)));
  if (d.needs !== undefined) {
    if (!Array.isArray(d.needs) || d.needs.length > 6) errors.push(`${at}.needs: up to six things the business must supply for it (photographs, texts, a product model, data), each one line`);
    else d.needs.forEach((n, i) => errors.push(...textError(n, `${at}.needs[${i}]`, 5, 200)));
  }
  for (const key of Object.keys(d)) if (!DESIGN_KEYS.includes(key)) errors.push(`${at}: unknown property "${key}"`);
  return errors;
}

export const cleanDesign = (d) => ({
  ...Object.fromEntries(Object.keys(DESIGN_TEXTS).map((k) => [k, one(d[k])])),
  signature: { kind: d.signature.kind, why: one(d.signature.why), ...(d.signature.kind === 'none' ? {} : { what: one(d.signature.what), tenth: one(d.signature.tenth) }) },
  keeps: d.keeps.map(one), breaks: d.breaks.map((b) => ({ what: one(b.what), why: one(b.why) })),
  needs: (d.needs ?? []).map(one),
});

const SCALE_TEXT = 'refresh (a new look, voice and movement on the structure the site has), redesign (a new structure as well) or reinvention (a site of a different kind); the studio does not tidy a page';
const GROWS_FROM = 'at least one of them something the business has (M…)';
const ROOT_TEXT = 'name at least one thing the business has (M…): a direction that grows from nothing of this business would fit any business';
const NEW_TEXT = {
  claim: 'world (nothing like it was found on any site) or category (sites elsewhere or fields far from the web have something like it, sites of this trade do not). A direction sites of this trade already have is not one',
  found: 'it is not new to the world; say "category" when what you found is outside this trade',
};

export function directionErrors(s, at, { session, frame, anatomy, pass, role }) {
  const errors = inventionErrors(s, at, { session, frame, anatomy, pass, role }, { scales: STUDIO_SCALES, scaleText: SCALE_TEXT, roots: ['M'], growsFrom: GROWS_FROM, rootText: ROOT_TEXT, newText: NEW_TEXT, unit: 'direction' });
  errors.push(...designErrors(s.design, `${at}.design`));
  if (!MADE_FROM.includes(s.madeFrom)) errors.push(`${at}.madeFrom: what it was made from: material (something the business has), idea (one idea about what the business is or does), far-field (a field far from the web) or assembly (known patterns of the web, joined)`);
  if (s.madeFrom === 'assembly') errors.push(...textError(s.whole, `${at}.whole`, 20, 300).map((e) => `${e}: an assembly says what the whole is that none of its parts is; when it cannot, it is a collection of effects`));
  else if (s.whole !== undefined) errors.push(`${at}.whole: only an assembly of known patterns says what its whole is`);
  return errors;
}

export const cleanDirection = (s) => ({ ...cleanInvention(s), design: cleanDesign(s.design), madeFrom: s.madeFrom, ...(s.madeFrom === 'assembly' ? { whole: one(s.whole) } : {}) });

// What the judge adds to a ruling of the studio. A direction that would fit a rival does not survive as one; neither
// does one sites of the trade already have; and an assembly survives only when the judge can say what its whole is.
export function studioRulingErrors(r, at) {
  const errors = [];
  if (r.verdict === 'killed') {
    if (r.newTo !== undefined && !NEW_TO.includes(r.newTo)) errors.push(`${at}.newTo: ${NEW_TO.join(', ')}`);
    if (r.swap !== undefined && !SWAPS.includes(r.swap)) errors.push(`${at}.swap: ${SWAPS.join(', ')}`);
    if (r.madeFrom !== undefined && !MADE_FROM.includes(r.madeFrom)) errors.push(`${at}.madeFrom: ${MADE_FROM.join(', ')}`);
    return errors;
  }
  const lives = r.verdict !== 'undecided';
  if (!NEW_TO.includes(r.newTo)) errors.push(`${at}.newTo: how new it is after the debate: world, category, or here (sites of this trade already look like this)`);
  else if (r.newTo === 'here' && lives) errors.push(`${at}.newTo: a direction sites of this trade already have does not survive as one: kill it, with what already exists as its cause of death`);
  if (!SWAPS.includes(r.swap)) errors.push(`${at}.swap: the swap test after the debate: own (with a rival's name on it, it would be wrong), sector (it would fit any business of this trade) or anyone (it would fit almost any business)`);
  else if (r.swap !== 'own' && lives) errors.push(`${at}.swap: a direction that would fit ${r.swap === 'sector' ? 'a rival' : 'any business'} does not survive as one: kill it, or rule it undecided when nobody could tell`);
  if (!MADE_FROM.includes(r.madeFrom)) errors.push(`${at}.madeFrom: what it is made from, after the debate: ${MADE_FROM.join(', ')}. It may not be what its proposer said`);
  else if (r.madeFrom === 'assembly' && lives) errors.push(...textError(r.whole, `${at}.whole`, 20, 300).map((e) => `${e}: an assembly survives only when you can say, for the reader, what the whole is that none of its parts is`));
  if (lives) {
    if (!FEASIBLE.includes(r.feasible)) errors.push(`${at}.feasible: now (it can be built with what the web does today and what the business has), stretch (it needs a craft or content that is known how to get) or research (it needs something nobody has made work well yet)`);
    if (!SIGNATURE_RULINGS.includes(r.signature)) errors.push(`${at}.signature: your ruling on its signature moment: keep, quieter (keep it smaller or slower), drop (the direction stands without it) or none (it has none and needs none)`);
  }
  if (r.verdict === 'narrowed' && r.narrowed?.scale !== undefined && !STUDIO_SCALES.includes(r.narrowed.scale)) errors.push(`${at}.narrowed.scale: ${STUDIO_SCALES.join(', ')}`);
  return errors;
}

export const cleanStudioRuling = (r) => ({
  ...(r.swap ? { swap: r.swap } : {}), ...(r.madeFrom ? { madeFrom: r.madeFrom } : {}),
  ...(r.madeFrom === 'assembly' && one(r.whole) ? { whole: one(r.whole) } : {}),
  ...(r.signature && r.verdict !== 'killed' && r.verdict !== 'undecided' ? { signature: r.signature } : {}),
});
