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
//   lab/<id>/      the invention lab's sessions (the lab runs on these scripts), ignored by git
//   cache/looks/   pictures of pages, reused for a week by any session, ignored by git
//   runs/<id>/     written by the project-health skill; read here when it exists, never written
export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PROJECT_DIR = '.project-health';

export const projectDir = (root) => path.join(root, PROJECT_DIR);
export const bankDir = (root) => path.join(projectDir(root), 'kb');
export const councilDir = (root) => path.join(projectDir(root), 'council');
// The invention lab runs on these scripts; its own prompts, cast and cards are in its skill folder, beside this one.
export const KINDS = ['council', 'lab'];
export const LAB_DIR = path.resolve(SKILL_DIR, '..', 'lab');
export const scriptOf = (session) => path.join(SKILL_DIR, 'scripts', session?.kind === 'lab' ? 'lab.mjs' : 'council.mjs');
export const sessionsDir = (root, kind = 'council') => path.join(projectDir(root), kind === 'lab' ? 'lab' : 'council');
export const runsDir = (root) => path.join(projectDir(root), 'runs');

// Sessions are working files: the bank is what is kept. Adds the lines to the shared .gitignore, creating the file
// with the lines the project-health skill expects when it is not there yet: the sessions of this skill and of the
// invention lab, the cache of pictures of pages they share, and the page of every idea built from the ledger.
const IGNORED = ['council/', 'lab/', 'cache/', 'ideas.html'];
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
