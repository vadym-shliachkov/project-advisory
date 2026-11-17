import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from './io.mjs';
import { bankDir, runsDir } from './paths.mjs';

// The knowledge bank: what is known about the project, kept across sessions and shared by every skill in the
// marketplace. Each skill reads and writes it with its own code, following the same contract
// (references/knowledge-bank.md):
//
//   facts.json      single facts by key, each with who wrote it, its source and its date. Shared: any skill adds
//                   facts under its own name; what a person said is never replaced by a skill.
//   knowledge.json  the people and the ground rules agreed with them. Written in discussions with the people
//                   (the roadmap skill); this skill only reads it.
//   ideas.json      the idea ledger. Written by this skill (lib/ideas.mjs); others read it.

const HISTORY_LIMIT = 10;
const METRIC_MAX_AGE_DAYS = 45;
const KEY_RE = /^[a-z0-9-]+(\.[a-zA-Z0-9-]+)+$/;

export const today = (date = new Date()) => date.toISOString().slice(0, 10);
export const factsPath = (root) => path.join(bankDir(root), 'facts.json');
export const knowledgePath = (root) => path.join(bankDir(root), 'knowledge.json');

export const loadFacts = (root) => readJson(factsPath(root), { facts: [] }).facts ?? [];
export const saveFacts = (root, facts) => writeJson(factsPath(root), { facts: [...facts].sort((a, b) => a.key.localeCompare(b.key)) });

const fromPerson = (f) => f.source === 'human';

// Adds or updates one fact. A fact a person gave stays as it is unless a person changes it; a changed value moves
// the old one into the history.
export function putFact(facts, { key, value, source, confidence = 'medium', by }, { date = today() } = {}) {
  if (!KEY_RE.test(key ?? '')) throw new Error(`Invalid fact key "${key ?? ''}": use a dotted name such as market.competitors`);
  if (!by) throw new Error('A fact needs who wrote it (by)');
  if (!source) throw new Error('A fact needs its source: "human" when a person said it, otherwise the page, file or data it comes from');
  if (!['high', 'medium', 'low'].includes(confidence)) throw new Error('confidence must be high, medium or low');
  const current = facts.find((f) => f.key === key);
  if (current && fromPerson(current) && source !== 'human') return { facts, kept: current };
  const history = current && JSON.stringify(current.value) !== JSON.stringify(value)
    ? [{ value: current.value, observedAt: current.observedAt }, ...(current.history ?? [])].slice(0, HISTORY_LIMIT)
    : current?.history ?? [];
  const next = { key, value, source, confidence, observedAt: date, by, history };
  return { facts: [...facts.filter((f) => f.key !== key), next], saved: next };
}

// Numbers about visitors and enquiries are old after six weeks, whoever gave them.
export function staleMetrics(facts, date = today()) {
  return facts.filter((f) => f.key.startsWith('metric.') && (Date.parse(date) - Date.parse(f.observedAt)) / 86400000 > METRIC_MAX_AGE_DAYS).map((f) => f.key);
}

export const KIND_TITLES = {
  feature: 'Key features',
  allowed: 'Allowed',
  forbidden: 'Not allowed',
  convention: 'Conventions',
  constraint: 'Constraints',
  decision: 'Decisions taken',
};

// The people and ground rules, read only: they are agreed with the people who run the project, not by this skill.
export function loadKnowledge(root) {
  const k = readJson(knowledgePath(root), null);
  return { people: k?.people ?? [], notes: k?.notes ?? [] };
}

// ---- What the project-health skill left in the project, when it has been run. Read only. ----

const RUN_ID_RE = /^\d{4}-\d{2}-\d{2}T\d{4}(-\d+)?$/;
const TICK_RE = /^\s*[-*+]\s+\[([ xX-])\]\s+\*\*([A-Z]+-[0-9a-f]{4,8})\*\*/;

const runIds = (root) => (fs.existsSync(runsDir(root)) ? fs.readdirSync(runsDir(root)).filter((d) => RUN_ID_RE.test(d)).sort() : []);

// Findings the reviewer marked [-] in the checklist were judged wrong, so they are not evidence. A finding ticked
// anywhere in the checklist is kept.
function dismissedIn(checklist) {
  const dismissed = new Set();
  const ticked = new Set();
  for (const line of checklist.split(/\r?\n/)) {
    const m = TICK_RE.exec(line);
    if (!m) continue;
    if (m[1] === '-') dismissed.add(m[2]);
    else if (m[1] !== ' ') ticked.add(m[2]);
  }
  for (const id of ticked) dismissed.delete(id);
  return dismissed;
}

// The latest health check that was merged: its problems, the site address and its probe of the live site.
export function latestHealthRun(root) {
  const id = runIds(root).reverse().find((r) => fs.existsSync(path.join(runsDir(root), r, 'findings.json')));
  if (!id) return null;
  const dir = path.join(runsDir(root), id);
  const doc = readJson(path.join(dir, 'findings.json'), null);
  const checklist = path.join(dir, 'checklist.md');
  const dismissed = fs.existsSync(checklist) ? dismissedIn(fs.readFileSync(checklist, 'utf8')) : new Set();
  const live = path.join(dir, 'live.json');
  return {
    id, dir, date: id.slice(0, 10),
    url: readJson(path.join(dir, 'profile.json'), null)?.url ?? doc?.project?.url ?? null,
    findings: (doc?.findings ?? []).filter((f) => f.kind !== 'tooling' && !dismissed.has(f.id)),
    live: fs.existsSync(live) ? live : null,
  };
}

// The latest roadmap: what is already planned, and what was set aside and why.
export function latestRoadmap(root) {
  for (const id of runIds(root).reverse()) {
    const dir = path.join(runsDir(root), id);
    const roadmap = readJson(path.join(dir, 'roadmap.json'), null);
    if (!roadmap) continue;
    const titles = new Map((readJson(path.join(dir, 'findings.json'), null)?.findings ?? []).map((f) => [f.id, f.title]));
    return { run: id, solutions: roadmap.solutions ?? [], declined: roadmap.declined ?? [], titles };
  }
  return null;
}

// ---- Secrets ----

// The bank is committed with the project, so nothing in it may hold a secret. A short list of shapes that are
// never meant to be written down.
const SECRET_SHAPES = [
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\b\s*[:=]\s*["']?[^\s"']{8,}/i,
];
export const holdsSecret = (text) => SECRET_SHAPES.some((re) => re.test(String(text ?? '')));
