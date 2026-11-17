import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readJson, writeJson } from './io.mjs';
import { healthDir } from './paths.mjs';

const HISTORY_LIMIT = 10;
const URL_MAX_AGE_DAYS = 30;

export function kbPath(root) {
  return path.join(healthDir(root), 'kb', 'facts.json');
}

export function loadKb(root) {
  return readJson(kbPath(root), { facts: [] }).facts ?? [];
}

export function saveKb(root, facts) {
  writeJson(kbPath(root), { facts: [...facts].sort((a, b) => a.key.localeCompare(b.key)) });
}

export function today(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

// Sources that are not files in the project: re-derived when the owning area runs, never hashed.
const NON_FILE_SOURCES = /^(human|git|collect\.json|live\.json|profile\.json)$/i;

// The project files a source names: one path, or several separated by commas, with line suffixes removed.
// null when the source names no project file (a URL, git, tool output) or points outside the project.
function sourceFiles(root, source) {
  if (/^https?:/i.test(source)) return null;
  const parts = String(source).split(/\s*[,;]\s*/)
    .map((p) => p.trim().replace(/#L\d+(-L?\d+)?$/i, '').replace(/:\d+(-\d+)?$/, ''))
    .filter((p) => p && !NON_FILE_SOURCES.test(p));
  if (!parts.length) return null;
  const files = [];
  for (const p of parts) {
    const abs = path.resolve(root, p);
    const rel = path.relative(path.resolve(root), abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    files.push(abs);
  }
  return files;
}

const isFile = (f) => fs.existsSync(f) && fs.statSync(f).isFile();

// Null unless every named file exists, so a hash always describes the complete source.
export function hashSource(root, source) {
  const files = sourceFiles(root, source);
  if (!files || !files.every(isFile)) return null;
  const h = createHash('sha1');
  if (files.length === 1) h.update(fs.readFileSync(files[0]));
  else for (const f of files) h.update(path.relative(root, f)).update('\0').update(fs.readFileSync(f)).update('\0');
  return h.digest('hex').slice(0, 12);
}

export function mergeFacts(existing, incoming, { root, by, date = today() }) {
  const byKey = new Map(existing.map((f) => [f.key, structuredClone(f)]));
  for (const fact of incoming) {
    const current = byKey.get(fact.key);
    if (current?.source === 'human') continue;
    const next = {
      key: fact.key,
      value: fact.value,
      source: fact.source,
      confidence: fact.confidence,
      observedAt: date,
      by: fact.by ?? by,
      history: current?.history ?? [],
    };
    const hash = hashSource(root, fact.source);
    if (hash) next.sourceHash = hash;
    if (current && JSON.stringify(current.value) !== JSON.stringify(fact.value)) {
      next.history = [{ value: current.value, observedAt: current.observedAt }, ...next.history].slice(0, HISTORY_LIMIT);
    }
    byKey.set(fact.key, next);
  }
  return [...byKey.values()];
}

export function staleFacts(facts, root, date = today()) {
  const out = [];
  for (const f of facts) {
    if (f.source === 'human') continue;
    if (/^https?:/.test(f.source)) {
      const ageDays = (Date.parse(date) - Date.parse(f.observedAt)) / 86400000;
      if (ageDays > URL_MAX_AGE_DAYS) out.push({ key: f.key, by: f.by, reason: 'older than 30 days' });
      continue;
    }
    // Without a hash the source was never a readable project file, so there is nothing to compare.
    const files = f.sourceHash ? sourceFiles(root, f.source) : null;
    if (!files) continue;
    if (!files.every(isFile)) out.push({ key: f.key, by: f.by, reason: 'source missing' });
    else if (hashSource(root, f.source) !== f.sourceHash) out.push({ key: f.key, by: f.by, reason: 'source changed' });
  }
  return out;
}
