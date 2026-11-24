import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from './io.mjs';
import { bankDir, projectDir } from './paths.mjs';
import { today } from './bank.mjs';

// The groundwork of a session: what is learned about the project's world before anyone proposes. The domain primer
// (how this trade works), the competitor scan and the horizon scan are kept in the knowledge bank, so a session that
// runs soon after another one, of the council or of the invention lab, starts from them instead of doing the same
// research again. Each kind stays fresh for a while; after that it is done again (the primer is refreshed from the
// one before). Pictures of pages are kept in a cache outside the bank, which is committed with the project.

// The invention lab studies the thing itself instead: its anatomy (what it is, what it is made of, what it knows), its
// genre (what things of its kind already have), what the people who use it say (the voice) and what has become
// possible for things of its kind (the tech scan). An anatomy is reused only while the project's code has not changed.
// The design studio studies the site and the business behind it (its own anatomy, with what the business has that a
// design could be made of), the habits of sites of its trade (its own genre), what wins awards now (the currents),
// what template and machine-made sites look like (the slop), what visitors say and what the web can now do. Its
// records are its own: a lab's anatomy of the same project answers another question.
export const KINDS = ['primer', 'competitors', 'horizon', 'anatomy', 'genre', 'voice', 'tech', 'studio-anatomy', 'studio-genre', 'studio-tech', 'awards', 'slop'];
const COUNCIL_KINDS = ['primer', 'competitors', 'horizon'];
const LAB_KINDS = ['anatomy', 'genre', 'voice', 'tech'];
const STUDIO_KINDS = ['studio-anatomy', 'studio-genre', 'voice', 'studio-tech', 'awards', 'slop'];
export const kindsFor = (session) => (session?.kind === 'studio' ? STUDIO_KINDS : session?.kind === 'lab' ? LAB_KINDS : COUNCIL_KINDS);
// The record a role's work is kept in: the studio keeps its anatomy, its sector and its craft scan apart from the lab's.
export const recordKind = (session, kind) => (session?.kind === 'studio' && ['anatomy', 'genre', 'tech'].includes(kind) ? `studio-${kind}` : kind);
// The turn a reused record stands for: "studio-anatomy" is the anatomist's.
export const turnKind = (kind) => kind.replace(/^studio-/, '');
// How many days each kind stays fresh. A rival's site changes slowly; what is happening around the business faster;
// the primer is refreshed from the one before, so it is looked at again weekly.
export const FRESH_DAYS = { primer: 7, competitors: 30, horizon: 14, anatomy: 7, genre: 30, voice: 14, tech: 14, 'studio-anatomy': 7, 'studio-genre': 30, 'studio-tech': 14, awards: 30, slop: 30 };
export const LOOK_FRESH_DAYS = 7;

export const groundworkDir = (root) => path.join(bankDir(root), 'groundwork');
export const groundworkPath = (root, kind) => path.join(groundworkDir(root), `${kind}.json`);
export const lookCacheDir = (root) => path.join(projectDir(root), 'cache', 'looks');

const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;
const siteOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } };

export function loadGroundwork(root, kind) {
  if (!KINDS.includes(kind)) throw new Error(`Unknown groundwork "${kind}". Kinds: ${KINDS.join(', ')}`);
  return readJson(groundworkPath(root, kind), null);
}

// Fresh when it is younger than its window and was made for the same site. A record made with no site address is
// fresh for a session that has none either.
export function isFresh(kind, record, { url = null, date = today(), head = null } = {}) {
  if (!record?.at) return false;
  if (daysBetween(record.at, date) > FRESH_DAYS[kind]) return false;
  // An anatomy describes the code as it was: once the project has moved on, it is written again.
  if (turnKind(kind) === 'anatomy' && (record.head ?? null) !== head) return false;
  return siteOf(record.url) === siteOf(url);
}

// Saves what a session learned. `entries` are its evidence entries as the session saved them; the ids are the
// session's own and are dropped: each session numbers its evidence anew.
export function saveGroundwork(root, role, { session, entries = [], primer = null, anatomy = null, genre = null, currents = null, slop = null, head = null, date = today() }) {
  const kind = recordKind(session, role);
  const record = {
    kind, at: date, url: session.url ?? null, by: { skill: session.kind ?? 'council', session: session.id },
    entries: entries.map(({ id, ...rest }) => rest),
    ...(primer ? { primer } : {}), ...(anatomy ? { anatomy, head } : {}), ...(genre ? { genre } : {}), ...(currents ? { currents } : {}), ...(slop ? { slop } : {}),
  };
  writeJson(groundworkPath(root, kind), record);
  return record;
}

// The kinds to reuse in a session: fresh, and not asked to be done again. `refresh` is a list of kinds, or ["all"].
export function reusable(root, session, { refresh = [], date = today(), head = null } = {}) {
  // The person names a kind by its turn ("anatomy"), whichever skill's record it is.
  const again = new Set(refresh.includes('all') ? KINDS.map(turnKind) : refresh);
  return kindsFor(session).flatMap((kind) => {
    if (again.has(turnKind(kind))) return [];
    const record = loadGroundwork(root, kind);
    return isFresh(kind, record, { url: session.url, date, head }) ? [{ kind, record }] : [];
  });
}

// Reads the --refresh option: a comma-separated list of kinds, or "all".
export function parseRefresh(value) {
  if (!value) return [];
  const kinds = String(value).split(',').map((s) => s.trim()).filter(Boolean);
  const known = [...new Set(KINDS.map(turnKind))];
  const bad = kinds.filter((k) => k !== 'all' && !known.includes(k) && k !== 'looks');
  if (bad.length) throw new Error(`Unknown --refresh "${bad.join(', ')}". Use ${[...known, 'looks', 'all'].join(', ')}, separated by commas`);
  return kinds;
}

// ---- Pictures of pages ----

// A picture taken in the last week is used again; it keeps the date it was taken.
export function cachedLook(root, file, { date = today() } = {}) {
  const at = path.join(lookCacheDir(root), path.basename(file));
  if (!fs.existsSync(at)) return null;
  const taken = fs.statSync(at).mtime;
  if (daysBetween(taken.toISOString().slice(0, 10), date) > LOOK_FRESH_DAYS) return null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(at, file);
  fs.utimesSync(file, taken, taken);
  return { file, taken: taken.toISOString().slice(0, 10) };
}

export function cacheLook(root, file) {
  const at = path.join(lookCacheDir(root), path.basename(file));
  fs.mkdirSync(path.dirname(at), { recursive: true });
  fs.copyFileSync(file, at);
  const { mtime } = fs.statSync(file);
  fs.utimesSync(at, mtime, mtime);
}
