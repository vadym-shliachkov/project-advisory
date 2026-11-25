import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from './io.mjs';
import { loadFacts, today, latestHealthRun, latestRoadmap } from './bank.mjs';
import { reusable } from './groundwork.mjs';

// What the council may cite. Every entry has an id, a source, a date and a grade:
//   measured: a number from data the person shared;
//   observed: seen on the live site, in the project, on a competitor's site or in a dated public source;
//   argued:   reasoning or general knowledge, with no source; also a finding of a health check that nobody confirmed.
// A statement that cites nothing counts as argued.
export const GRADES = ['measured', 'observed', 'argued'];
const FINDING_ID = /^(?:finding\s+)?([A-Z]+-[0-9a-f]{4,8})$/;
const FACT_REF = /^fact\s+([a-z0-9-]+(?:\.[a-zA-Z0-9-]+)+)$/;
const PROBE_MAX_AGE_DAYS = 7;
const TEXT_MAX = 500;
// Facts worth citing in a debate about growth; what the health areas recorded about hosting or code is not.
const FACT_GROUPS = ['business', 'conversion', 'team', 'site', 'brand', 'market', 'metric', 'studio'];
// The areas of a health check that describe what a visitor or a search engine meets. Their findings are given in
// full. The others (how the code, the releases and the server are kept) are given by their title: enough to cite
// and to look up, without making every member read them at length.
const VISITOR_AREAS = ['content-conversion', 'seo', 'performance', 'privacy-legal'];
// What the people decided about a finding when the roadmap was agreed. What a person said beats what a check found:
// a finding they called wrong or fixed is not evidence of a problem, and their answer is evidence in its place.
const SETTLED = { wrong: 'found to be wrong', 'already-fixed': 'already fixed', 'not-applicable': 'does not apply here' };
const SET_ASIDE = { backlog: 'kept in the backlog', 'wont-fix': 'not to be fixed', 'accepted-risk': 'accepted as a risk' };

export const evidencePath = (dir) => path.join(dir, 'evidence.json');
export const loadEvidence = (dir) => readJson(evidencePath(dir), null) ?? { entries: [], data: [], missing: [], site: null, reused: [] };
export const saveEvidence = (dir, evidence) => writeJson(evidencePath(dir), evidence);

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s, max = TEXT_MAX) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const nextId = (entries) => `E${entries.reduce((max, e) => Math.max(max, Number(e.id.slice(1))), 0) + 1}`;
const inside = (dir, file) => { const rel = path.relative(dir, file); return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel); };

// The files of the shared data folder, two levels deep: agents read them themselves, the list tells them what is there.
export function dataInventory(dataDir, { maxFiles = 200 } = {}) {
  if (!dataDir || !fs.existsSync(dataDir)) return [];
  const out = [];
  const walk = (dir, depth) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= maxFiles) return;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (depth < 2) walk(file, depth + 1); continue; }
      const item = { file, name: path.relative(dataDir, file).split(path.sep).join('/'), bytes: fs.statSync(file).size };
      if (/\.(csv|tsv)$/i.test(entry.name) && item.bytes < 20 * 1024 * 1024) {
        const lines = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
        item.header = clip(lines[0] ?? '', 300);
        item.rows = Math.max(0, lines.length - 1);
      }
      out.push(item);
    }
  };
  walk(dataDir, 1);
  return out;
}

// The grade a source can carry. A higher grade than the source supports is lowered, with a warning, never refused:
// an agent that cannot prove its number still gets to make its point, as an argument.
export function gradeFor(item, { root, session, facts }) {
  const source = one(item.source);
  const fact = FACT_REF.exec(source)?.[1];
  const known = fact ? facts.some((f) => f.key === fact) : false;
  const dataFile = session.data && source ? path.resolve(session.data, source) : null;
  const measured = (dataFile && inside(session.data, dataFile) && fs.existsSync(dataFile)) || (known && fact.startsWith('metric.'));
  const projectFile = source && !/^https?:/i.test(source) ? path.resolve(root, source.replace(/#L\d+(-L?\d+)?$/i, '').replace(/:\d+(-\d+)?$/, '')) : null;
  const observed = /^https?:\/\/\S+$/i.test(source) || FINDING_ID.test(source) || known || (projectFile && inside(path.resolve(root), projectFile) && fs.existsSync(projectFile));
  if (item.grade === 'measured' && !measured) {
    return { grade: observed ? 'observed' : 'argued', warning: `"${clip(one(item.text), 60)}": measured needs a source inside the shared data folder (or "fact metric.<name>"); saved as ${observed ? 'observed' : 'argued'}` };
  }
  if (item.grade === 'observed' && !observed && !measured) {
    return { grade: 'argued', warning: `"${clip(one(item.text), 60)}": observed needs a URL, a file in the project, a finding id or "fact <key>" as its source; saved as argued` };
  }
  return { grade: item.grade };
}

// Adds entries from an agent. The same source and text again returns the id it already has.
export function addEvidence(evidence, items, { by, root, session, date = today() }) {
  const errors = [];
  const warnings = [];
  const added = [];
  if (!Array.isArray(items)) return { evidence, errors: ['$.evidence: an array is required'], warnings, added };
  if (!by) return { evidence, errors: ['Say which role is adding the evidence (--role)'], warnings, added };
  const facts = loadFacts(root);
  const entries = [...evidence.entries];
  items.forEach((item, n) => {
    const at = `$.evidence[${n}]`;
    if (!item || typeof item !== 'object') { errors.push(`${at}: an object is required`); return; }
    if (!GRADES.includes(item.grade)) { errors.push(`${at}.grade: one of ${GRADES.join(', ')}`); return; }
    const text = one(item.text);
    if (text.length < 10) { errors.push(`${at}.text: say what was seen or measured, in at least 10 characters`); return; }
    if (text.length > TEXT_MAX) { errors.push(`${at}.text: at most ${TEXT_MAX} characters; one fact per entry`); return; }
    if (item.grade !== 'argued' && !one(item.source)) { errors.push(`${at}.source: ${item.grade} evidence needs its source`); return; }
    // An opening from the horizon scan is a change in the world, and a line of the primer a fact about the trade:
    // without the page that reports it, either is a guess.
    if (['horizon', 'primer', 'tech', 'genre'].includes(by) && !/^https?:\/\/\S+$/i.test(one(item.source))) { errors.push(`${at}.source: ${by === 'primer' ? 'a fact about the trade' : by === 'genre' ? 'a fact about things of this kind' : 'an opening'} needs the address of the page that reports it, and its "date" when the page gives one`); return; }
    const { grade, warning } = gradeFor(item, { root, session, facts });
    if (warning) warnings.push(warning);
    const source = one(item.source) || null;
    const same = entries.find((e) => e.source === source && e.text === text);
    if (same) { added.push({ id: same.id, grade: same.grade, repeated: true }); return; }
    const entry = { id: nextId(entries), grade, source, date: /^\d{4}-\d{2}-\d{2}$/.test(item.date ?? '') ? item.date : date, text, by };
    entries.push(entry);
    added.push({ id: entry.id, grade });
  });
  return errors.length ? { evidence, errors, warnings, added: [] } : { evidence: { ...evidence, entries }, errors, warnings, added };
}

const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;

// The first set of evidence, gathered without an agent: what a health check found (when the project-health skill
// has run one), what the knowledge bank holds and what is in the shared data folder. It also says what the session
// lacks. The live site is not fetched here: agents open its pages themselves and cite them by address. The groundwork
// an earlier session (of this skill or of the invention lab) left fresh in the knowledge bank is taken in as well,
// unless `refresh` asks for it to be done again: its turns are then taken.
export function collectEvidence(root, session, { date = today(), refresh = [], head = null } = {}) {
  const entries = [];
  const missing = [];
  const add = (grade, source, text, by, at = date) => entries.push({ id: nextId(entries), grade, source, date: at, text: clip(one(text)), by });

  const health = latestHealthRun(root);
  const site = session.url ? { url: session.url, probe: null } : null;
  if (health) {
    const roadmap = latestRoadmap(root);
    const decided = new Map((roadmap?.declined ?? []).flatMap((d) => (d.findingIds ?? []).map((id) => [id, d])));
    const planned = new Map((roadmap?.solutions ?? []).flatMap((s) => (s.findingIds ?? []).map((id) => [id, s.id])));
    for (const f of health.findings) {
      const d = decided.get(f.id);
      if (d && SETTLED[d.resolution]) {
        add('observed', `finding ${f.id}`, `The health check reported "${clip(one(f.title), 140)}". The people who run the project settled it (${SETTLED[d.resolution]}): ${one(d.reason)}`, 'roadmap', d.decidedAt ?? health.date);
        continue;
      }
      // The notes come last and are never cut off: "not confirmed" is what a member must not miss.
      const notes = [f.area, f.severity, ...(f.verified ? [] : ['not confirmed']), ...(planned.has(f.id) ? [`planned as ${planned.get(f.id)}`] : []), ...(d ? [`${SET_ASIDE[d.resolution] ?? d.resolution}: ${clip(one(d.reason), 140)}`] : [])];
      const tail = ` (${notes.join(', ')})`;
      const body = VISITOR_AREAS.includes(f.area) ? `${f.title}. ${f.why}` : `${f.title}.`;
      // A finding nobody confirmed is a claim, not something seen.
      entries.push({ id: nextId(entries), grade: f.verified ? 'observed' : 'argued', source: `finding ${f.id}`, date: health.date, text: `${clip(one(body), TEXT_MAX - tail.length)}${tail}`, by: 'project-health' });
    }
    if (site && health.live && daysBetween(health.date, date) <= PROBE_MAX_AGE_DAYS) {
      site.probe = { file: health.live, date: health.date };
      add('observed', session.url, `The live site as the health check read it on ${health.date}: its pages, headers and response times are in ${health.live}`, 'project-health', health.date);
    }
  } else {
    missing.push('No health check has been run on this project, so the evidence has no findings. Running the project-health skill first gives a session more to work from.');
  }

  for (const f of loadFacts(root)) {
    if (!FACT_GROUPS.includes(f.key.split('.')[0])) continue;
    const value = typeof f.value === 'string' ? f.value : JSON.stringify(f.value);
    add(f.key.startsWith('metric.') ? 'measured' : 'observed', `fact ${f.key}`, `${f.key}: ${value}`, f.source === 'human' ? 'a person' : (f.by ?? 'knowledge bank'), f.observedAt ?? date);
  }

  const data = dataInventory(session.data);
  if (!session.data) missing.push('No data was shared (analytics, search console, enquiries), so nothing in this session is measured: ideas rest on what can be seen and argued.');
  else if (!data.length) missing.push(`The data folder ${session.data} is empty.`);
  if (!session.url && session.kind === 'lab') missing.push('No live address was given, so the thing is studied from its files only: the anatomist reads the project, and nobody sees it running.');
  else if (!session.url) missing.push('No live site address is known, so the site itself could not be looked at.');

  const reused = [];
  for (const { kind, record } of reusable(root, session, { refresh, date, head })) {
    for (const e of record.entries ?? []) entries.push({ ...e, id: nextId(entries), reusedFrom: `${record.by?.skill ?? 'council'} ${record.by?.session ?? record.at}` });
    reused.push({ kind, at: record.at, from: record.by ?? null, entries: (record.entries ?? []).length });
  }

  return { entries, data, missing, site, reused, collectedAt: new Date().toISOString() };
}
