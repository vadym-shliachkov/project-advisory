import path from 'node:path';
import { readJson, writeJson } from './io.mjs';
import { OBJECT_KINDS, OBJECT_WORDS } from './object.mjs';

// What the invention lab understands about the thing before anyone invents: its anatomy, written by the anatomist from
// the project's files and its live pages, and its genre, written by the genre scout from what things of this kind
// usually have. Every invention says which parts of the anatomy it grows from, so it belongs to this thing and not to
// any thing; and the genre's standard kit is what an invention must go beyond, so it is new.
//
// The anatomy is shown to the person before anyone invents (the study). What they correct is given to the anatomist,
// who revises it once.

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
function textError(value, at, min, max) {
  if (typeof value !== 'string') return [`${at}: text is required`];
  const t = one(value);
  if (t.length < min) return [`${at}: at least ${min} characters are required`];
  if (t.length > max) return [`${at}: at most ${max} characters (it has ${t.length})`];
  return [];
}
const listError = (value, at, min, max, what) => (!Array.isArray(value) || value.length < min || value.length > max ? [`${at}: ${min === max ? min : `${min} to ${max}`} ${what}`] : []);

export const anatomyPath = (dir) => path.join(dir, 'anatomy.json');
export const loadAnatomy = (dir) => readJson(anatomyPath(dir), null);
export const saveAnatomy = (dir, data) => writeJson(anatomyPath(dir), data);
export const genrePath = (dir) => path.join(dir, 'genre.json');
export const loadGenre = (dir) => readJson(genrePath(dir), null);
export const saveGenre = (dir, data) => writeJson(genrePath(dir), data);

// The parts of an anatomy that an invention may grow from, by the letter of their ids.
export const ANATOMY_REFS = { A: 'parts', D: 'knows', U: 'unused', J: 'journeys', W: 'weak' };
// At least one of these: an invention grows from something the thing is, knows or could do. A journey or a weak spot
// alone says where it applies, not what it is made of.
export const ROOT_REFS = ['A', 'D', 'U'];

export function validateAnatomy(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return ['$.anatomy: an object is required'];
  const errors = [];
  if (!OBJECT_KINDS.includes(a.kind)) errors.push(`$.anatomy.kind: what kind of thing it is, one of ${OBJECT_KINDS.join(', ')}`);
  errors.push(...textError(a.what, '$.anatomy.what', 20, 300));
  errors.push(...listError(a.users, '$.anatomy.users', 1, 6, 'kinds of people who use it, each { "who", "jobs": [what they come to it to get done] }'));
  (Array.isArray(a.users) ? a.users : []).forEach((u, i) => {
    errors.push(...textError(u?.who, `$.anatomy.users[${i}].who`, 3, 120));
    errors.push(...listError(u?.jobs, `$.anatomy.users[${i}].jobs`, 1, 5, 'jobs, each one sentence'));
    (Array.isArray(u?.jobs) ? u.jobs : []).forEach((j, k) => errors.push(...textError(j, `$.anatomy.users[${i}].jobs[${k}]`, 10, 200)));
  });
  errors.push(...listError(a.parts, '$.anatomy.parts', 4, 40, 'parts of the thing (pages, screens, features, commands, modules), each { "name", "does", "where" }'));
  (Array.isArray(a.parts) ? a.parts : []).forEach((p, i) => errors.push(...textError(p?.name, `$.anatomy.parts[${i}].name`, 3, 90), ...textError(p?.does, `$.anatomy.parts[${i}].does`, 10, 300), ...textError(p?.where, `$.anatomy.parts[${i}].where`, 3, 300)));
  if (a.knows !== undefined) {
    errors.push(...listError(a.knows, '$.anatomy.knows', 0, 20, 'things it knows: data it holds or collects, each { "what", "where" }'));
    (Array.isArray(a.knows) ? a.knows : []).forEach((k, i) => errors.push(...textError(k?.what, `$.anatomy.knows[${i}].what`, 10, 240), ...textError(k?.where, `$.anatomy.knows[${i}].where`, 3, 300)));
  }
  if (a.unused !== undefined) {
    errors.push(...listError(a.unused, '$.anatomy.unused', 0, 15, 'things its platform or stack could do that it does not use, each { "what", "why" }'));
    (Array.isArray(a.unused) ? a.unused : []).forEach((u, i) => errors.push(...textError(u?.what, `$.anatomy.unused[${i}].what`, 10, 240), ...textError(u?.why, `$.anatomy.unused[${i}].why`, 10, 300)));
  }
  errors.push(...listError(a.journeys, '$.anatomy.journeys', 1, 8, 'journeys through it, each one or two sentences'));
  (Array.isArray(a.journeys) ? a.journeys : []).forEach((j, i) => errors.push(...textError(j, `$.anatomy.journeys[${i}]`, 20, 300)));
  for (const key of ['weak', 'rules']) {
    if (a[key] === undefined) continue;
    errors.push(...listError(a[key], `$.anatomy.${key}`, 0, 12, key === 'weak' ? 'weak spots and workarounds, each one sentence' : 'rules it must keep, each one sentence'));
    (Array.isArray(a[key]) ? a[key] : []).forEach((w, i) => errors.push(...textError(w, `$.anatomy.${key}[${i}]`, 10, 300)));
  }
  if (!(a.knows?.length || a.unused?.length)) errors.push('$.anatomy: name at least one thing it knows ("knows") or one thing its platform could do that it does not use ("unused"): inventions grow from them');
  for (const key of Object.keys(a)) if (!['kind', 'what', 'users', 'parts', 'knows', 'unused', 'journeys', 'weak', 'rules'].includes(key)) errors.push(`$.anatomy: unknown property "${key}"`);
  return errors;
}

// Ids are given by the script: A1… the parts, D1… what it knows, U1… what it could do and does not, J1… the journeys,
// W1… the weak spots.
export function cleanAnatomy(a) {
  return {
    kind: a.kind, what: one(a.what),
    users: a.users.map((u) => ({ who: one(u.who), jobs: u.jobs.map(one) })),
    parts: a.parts.map((p, i) => ({ id: `A${i + 1}`, name: one(p.name), does: one(p.does), where: one(p.where) })),
    knows: (a.knows ?? []).map((k, i) => ({ id: `D${i + 1}`, what: one(k.what), where: one(k.where) })),
    unused: (a.unused ?? []).map((u, i) => ({ id: `U${i + 1}`, what: one(u.what), why: one(u.why) })),
    journeys: a.journeys.map((j, i) => ({ id: `J${i + 1}`, text: one(j) })),
    weak: (a.weak ?? []).map((w, i) => ({ id: `W${i + 1}`, text: one(w) })),
    rules: (a.rules ?? []).map(one),
  };
}

// Every id of an anatomy, with a few words on what it is.
export function anatomyIds(anatomy) {
  const a = anatomy?.anatomy;
  if (!a) return new Map();
  return new Map([
    ...a.parts.map((p) => [p.id, p.name]), ...a.knows.map((k) => [k.id, k.what]), ...a.unused.map((u) => [u.id, u.what]),
    ...a.journeys.map((j) => [j.id, j.text]), ...a.weak.map((w) => [w.id, w.text]),
  ]);
}

// What the person is shown at the study, to correct before anyone invents.
export function anatomyView(anatomy) {
  const a = anatomy?.anatomy;
  if (!a) return null;
  return {
    kind: `${a.kind} (${OBJECT_WORDS[a.kind]})`, what: a.what,
    users: a.users.map((u) => `${u.who}: ${u.jobs.join('; ')}`),
    parts: a.parts.map((p) => `${p.id} ${p.name}: ${p.does}`),
    knows: a.knows.map((k) => `${k.id} ${k.what}`),
    unused: a.unused.map((u) => `${u.id} ${u.what}`),
    journeys: a.journeys.map((j) => `${j.id} ${j.text}`),
    weak: a.weak.map((w) => `${w.id} ${w.text}`),
    rules: a.rules,
    corrections: (anatomy.corrections ?? []).map((c) => c.text),
  };
}

// ---- The genre ----

export function validateGenre(g) {
  if (!g || typeof g !== 'object' || Array.isArray(g)) return ['$.genre: an object is required'];
  const errors = [...textError(g.category, '$.genre.category', 10, 200)];
  errors.push(...listError(g.kit, '$.genre.kit', 6, 40, 'things every thing of this kind already has (the standard kit), each one line'));
  (Array.isArray(g.kit) ? g.kit : []).forEach((k, i) => errors.push(...textError(k, `$.genre.kit[${i}]`, 5, 200)));
  errors.push(...listError(g.frontier, '$.genre.frontier', 2, 15, 'of the most inventive things in this category, each { "what", "who", "source" }'));
  (Array.isArray(g.frontier) ? g.frontier : []).forEach((f, i) => {
    errors.push(...textError(f?.what, `$.genre.frontier[${i}].what`, 10, 300), ...textError(f?.who, `$.genre.frontier[${i}].who`, 2, 120));
    if (!/^https?:\/\/\S+$/i.test(one(f?.source))) errors.push(`$.genre.frontier[${i}].source: the address of the page that shows it`);
  });
  if (g.habits !== undefined) {
    errors.push(...listError(g.habits, '$.genre.habits', 0, 10, 'habits of the people who use things of this kind, each one sentence'));
    (Array.isArray(g.habits) ? g.habits : []).forEach((h, i) => errors.push(...textError(h, `$.genre.habits[${i}]`, 10, 240)));
  }
  for (const key of Object.keys(g)) if (!['category', 'kit', 'frontier', 'habits'].includes(key)) errors.push(`$.genre: unknown property "${key}"`);
  return errors;
}

// G1… the standard kit, F1… the frontier.
export const cleanGenre = (g) => ({
  category: one(g.category),
  kit: g.kit.map((k, i) => ({ id: `G${i + 1}`, text: one(k) })),
  frontier: g.frontier.map((f, i) => ({ id: `F${i + 1}`, what: one(f.what), who: one(f.who), source: one(f.source) })),
  habits: (g.habits ?? []).map(one),
});
