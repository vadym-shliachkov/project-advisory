import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from './io.mjs';

export const HEALTH_DIR = '.project-health';
export const RUN_ID_RE = /^\d{4}-\d{2}-\d{2}T\d{4}(-\d+)?$/;

export function healthDir(root) {
  return path.join(root, HEALTH_DIR);
}

export function newRunId(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}${p(date.getMinutes())}`;
}

export function createRun(root, date = new Date()) {
  const base = healthDir(root);
  fs.mkdirSync(path.join(base, 'runs'), { recursive: true });
  const gitignore = path.join(base, '.gitignore');
  // Only kb/ is meant to be committed.
  if (!fs.existsSync(gitignore)) fs.writeFileSync(gitignore, 'runs/\nprofile.json\nlatest.json\n');
  const stem = newRunId(date);
  let id = stem;
  for (let n = 2; fs.existsSync(path.join(base, 'runs', id)); n++) id = `${stem}-${n}`;
  const dir = path.join(base, 'runs', id);
  fs.mkdirSync(path.join(dir, 'areas'), { recursive: true });
  writeJson(path.join(base, 'latest.json'), { run: id });
  return { id, dir };
}

export function resolveRun(root, id) {
  const base = healthDir(root);
  let runId = id;
  if (runId == null) {
    const latest = readJson(path.join(base, 'latest.json'), null);
    if (!latest?.run) throw new Error('No analysis run found. Run "project-health analyse" first.');
    runId = latest.run;
  }
  if (!RUN_ID_RE.test(runId)) throw new Error(`Invalid run id "${runId}". Expected the form YYYY-MM-DDTHHmm.`);
  const dir = path.join(base, 'runs', runId);
  if (!fs.existsSync(dir)) throw new Error(`Run "${runId}" not found in ${path.join(base, 'runs')}.`);
  return { id: runId, dir };
}

export function listRuns(root) {
  const runs = path.join(healthDir(root), 'runs');
  if (!fs.existsSync(runs)) return [];
  return fs.readdirSync(runs).filter((d) => RUN_ID_RE.test(d)).sort();
}

export function previousRuns(root, id) {
  return listRuns(root)
    .filter((r) => r < id && fs.existsSync(path.join(healthDir(root), 'runs', r, 'findings.json')))
    .reverse();
}
