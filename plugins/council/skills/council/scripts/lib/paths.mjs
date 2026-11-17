import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Where things live.
//
// The skill's own files (prompts, schemas, the cast) are in SKILL_DIR.
//
// In the analysed project everything is under `.project-health/`, the folder the plugins of this marketplace share:
//   kb/            the knowledge bank, shared by every skill and committed with the project (see references/knowledge-bank.md)
//   council/<id>/  this skill's sessions, ignored by git
//   runs/<id>/     written by the project-health skill; read here when it exists, never written
export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PROJECT_DIR = '.project-health';

export const projectDir = (root) => path.join(root, PROJECT_DIR);
export const bankDir = (root) => path.join(projectDir(root), 'kb');
export const councilDir = (root) => path.join(projectDir(root), 'council');
export const runsDir = (root) => path.join(projectDir(root), 'runs');

// Sessions are working files: the bank is what is kept. Adds the line to the shared .gitignore, creating the file
// with the lines the project-health skill expects when it is not there yet.
export function ignoreSessions(root) {
  const file = path.join(projectDir(root), '.gitignore');
  const exists = fs.existsSync(file);
  const text = exists ? fs.readFileSync(file, 'utf8') : 'runs/\nprofile.json\nlatest.json\n';
  if (exists && /^council\/$/m.test(text)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${text.replace(/\n?$/, '\n')}council/\n`);
}
