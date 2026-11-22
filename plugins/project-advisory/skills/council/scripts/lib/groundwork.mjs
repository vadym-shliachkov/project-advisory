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
export const KINDS = ['primer', 'competitors', 'horizon', 'anatomy', 'genre', 'voice', 'tech'];
const COUNCIL_KINDS = ['primer', 'competitors', 'horizon'];
const LAB_KINDS = ['anatomy', 'genre', 'voice', 'tech'];
export const kindsFor = (session) => (session?.kind === 'lab' ? LAB_KINDS : COUNCIL_KINDS);
// How many days each kind stays fresh. A rival's site changes slowly; what is happening around the business faster;
// the primer is refreshed from the one before, so it is looked at again weekly.
export const FRESH_DAYS = { primer: 7, competitors: 30, horizon: 14, anatomy: 7, genre: 30, voice: 14, tech: 14 };
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
  if (kind === 'anatomy' && (record.head ?? null) !== head) return false;
  return siteOf(record.url) === siteOf(url);
}

// Saves what a session learned. `entries` are its evidence entries as the session saved them; the ids are the
// session's own and are dropped: each session numbers its evidence anew.
export function saveGroundwork(root, kind, { session, entries = [], primer = null, anatomy = null, genre = null, head = null, date = today() }) {
  const record = {
    kind, at: date, url: session.url ?? null, by: { skill: session.kind ?? 'council', session: session.id },
    entries: entries.map(({ id, ...rest }) => rest),
    ...(primer ? { primer } : {}), ...(anatomy ? { anatomy, head } : {}), ...(genre ? { genre } : {}),
  };
  writeJson(groundworkPath(root, kind), record);
  return record;
}

// The kinds to reuse in a session: fresh, and not asked to be done again. `refresh` is a list of kinds, or ["all"].
export function reusable(root, session, { refresh = [], date = today(), head = null } = {}) {
  const again = new Set(refresh.includes('all') ? KINDS : refresh);
  return kindsFor(session).flatMap((kind) => {
    if (again.has(kind)) return [];
    const record = loadGroundwork(root, kind);
    return isFresh(kind, record, { url: session.url, date, head }) ? [{ kind, record }] : [];
  });
}

// Reads the --refresh option: a comma-separated list of kinds, or "all".
export function parseRefresh(value) {
  if (!value) return [];
  const kinds = String(value).split(',').map((s) => s.trim()).filter(Boolean);
  const bad = kinds.filter((k) => k !== 'all' && !KINDS.includes(k) && k !== 'looks');
  if (bad.length) throw new Error(`Unknown --refresh "${bad.join(', ')}". Use ${[...KINDS, 'looks', 'all'].join(', ')}, separated by commas`);
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
