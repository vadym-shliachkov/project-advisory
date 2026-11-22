#!/usr/bin/env node
// The no-contact guard's marker. Every command of the plugin's scripts (council.mjs and the venture and lab entry
// points, ph.mjs for project-health and the roadmap) arms the guard for the next hours; the hook in no-contact.mjs
// then refuses, in the main session too, any tool call that would send something to a site or contact someone. The
// plugin's own subagents are guarded always, armed or not. Closing a council, venture or lab session lifts it, and so
// does time; the person can lift it at once by running `node "<this file>" off` in their own terminal (the hook
// refuses that command from an agent).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOURS = 2;
const FALLBACK = path.join('.project-health', 'guard.json');

// Where the marker lives: one file for the user, so a skill run in any window guards every window of that user.
// PROJECT_ADVISORY_GUARD_FILE moves it (the tests use it).
export const guardFile = () => process.env.PROJECT_ADVISORY_GUARD_FILE || path.join(os.homedir(), '.project-advisory', 'guard.json');

const readMarker = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const fresh = (m, now) => (m && Date.parse(m.until) > now ? m : null);

// Arms the guard for HOURS from now. The tests of the scripts run without a marker unless they name one. When the
// user's folder cannot be written (a sandbox), the marker goes into the project's .project-health folder instead.
export function arm({ root = process.cwd(), skill = 'council', now = Date.now(), hours = HOURS } = {}) {
  if (process.env.NODE_TEST_CONTEXT && !process.env.PROJECT_ADVISORY_GUARD_FILE) return null;
  const marker = { skill, root: path.resolve(root), armedAt: new Date(now).toISOString(), until: new Date(now + hours * 3600e3).toISOString() };
  for (const file of [guardFile(), path.join(path.resolve(root), FALLBACK)]) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(marker, null, 2)}\n`);
      return file;
    } catch { /* try the next place */ }
  }
  return null;
}

// Lifts the guard: the user's marker, and the project's when a root is given.
export function disarm({ root = null } = {}) {
  if (process.env.NODE_TEST_CONTEXT && !process.env.PROJECT_ADVISORY_GUARD_FILE) return;
  for (const file of [guardFile(), ...(root ? [path.join(path.resolve(root), FALLBACK)] : [])]) fs.rmSync(file, { force: true });
}

// The marker in force, if any: the user's, or a project's in the working folder or one of its parents.
export function armedState({ cwd = process.cwd(), now = Date.now() } = {}) {
  const own = fresh(readMarker(guardFile()), now);
  if (own) return own;
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const m = fresh(readMarker(path.join(dir, FALLBACK)), now);
    if (m) return m;
    if (path.dirname(dir) === dir) return null;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd = 'status'] = process.argv.slice(2);
  if (cmd === 'off') { disarm({ root: process.cwd() }); console.log('The no-contact guard is lifted.'); }
  else if (cmd === 'on') console.log(`The no-contact guard is armed until ${arm({ skill: 'manual' }) ? new Date(Date.now() + HOURS * 3600e3).toLocaleTimeString() : '(could not write the marker)'}.`);
  else { const m = armedState(); console.log(m ? `Armed by ${m.skill} for ${m.root} until ${new Date(m.until).toLocaleString()}.` : 'Not armed.'); }
}
