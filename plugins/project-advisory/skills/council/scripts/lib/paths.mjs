import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Where things live.
//
// The skill's own files (prompts, schemas, the cast) are in SKILL_DIR.
//
// In the analysed project everything is under `.project-health/`, the folder the plugins of this marketplace share:
//   kb/            the knowledge bank, shared by every skill and committed with the project (see references/knowledge-bank.md)
//                  (kb/groundwork/ holds the research a session did before proposing, reused while fresh)
//   council/<id>/  this skill's sessions, ignored by git
//   venture/<id>/  the venture board's sessions (it runs on these scripts), ignored by git
//   lab/<id>/      the invention lab's sessions (it runs on these scripts), ignored by git
//   studio/<id>/   the design studio's sessions (it has its own script, skills/studio/scripts), ignored by git
//   cache/looks/   pictures of pages, reused for a week by any session, ignored by git
//   runs/<id>/     written by the project-health skill; read here when it exists, never written
export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PROJECT_DIR = '.project-health';

export const projectDir = (root) => path.join(root, PROJECT_DIR);
export const bankDir = (root) => path.join(projectDir(root), 'kb');
export const councilDir = (root) => path.join(projectDir(root), 'council');

// Three skills run on these scripts. The council improves what the business has; the venture board looks for what the
// business could start, sell or become; the invention lab invents new things for the thing itself (the site, the app,
// the tool). Each has its own prompts, cast and cards in its skill folder, beside this one, and its own sessions.
export const KINDS = ['council', 'venture', 'lab'];
export const VENTURE_DIR = path.resolve(SKILL_DIR, '..', 'venture');
export const LAB_DIR = path.resolve(SKILL_DIR, '..', 'lab');
const KIND_DIRS = { council: SKILL_DIR, venture: VENTURE_DIR, lab: LAB_DIR };
// The design studio's label stays for the ideas an earlier version of it left in the ledger.
export const LABELS = { council: 'Council', venture: 'Venture board', lab: 'Invention lab', studio: 'Design studio' };
export const kindOf = (session) => (KINDS.includes(session?.kind) ? session.kind : 'council');
export const skillDirOf = (kind = 'council') => KIND_DIRS[kind] ?? SKILL_DIR;
export const labelOf = (kind = 'council') => LABELS[kind] ?? LABELS.council;
export const scriptOf = (session) => path.join(SKILL_DIR, 'scripts', `${kindOf(session)}.mjs`);
export const sessionsDir = (root, kind = 'council') => path.join(projectDir(root), KINDS.includes(kind) ? kind : 'council');
export const runsDir = (root) => path.join(projectDir(root), 'runs');

// Sessions are working files: the bank is what is kept. Adds the lines to the shared .gitignore, creating the file
// with the lines the project-health skill expects when it is not there yet: the sessions of the three skills and of
// the design studio, the cache of pictures of pages they share, and the page of every idea built from the ledger.
const IGNORED = ['council/', 'venture/', 'lab/', 'studio/', 'cache/', 'ideas.html'];
export function ignoreSessions(root) {
  const file = path.join(projectDir(root), '.gitignore');
  const exists = fs.existsSync(file);
  const text = exists ? fs.readFileSync(file, 'utf8') : 'runs/\nprofile.json\nlatest.json\n';
  const lines = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const missing = IGNORED.filter((line) => !lines.has(line));
  if (exists && !missing.length) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${text.replace(/\n?$/, '\n')}${missing.map((l) => `${l}\n`).join('')}`);
}
