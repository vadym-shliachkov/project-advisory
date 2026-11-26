#!/usr/bin/env node
// The design studio: from what the business is to one concept for its site, shown as one working page.
//
//   study      six scouts: the business, what customers say, what wins awards now (measured), how the trade looks,
//              what a template looks like, and what the web can newly do. Each study is reused while it is fresh.
//   frame      a framer sets the problem: the ideal result, contradictions, a morphological box, "how might we"
//   provoke    a provocateur writes absurd statements to be mined
//   concepts   six seats, each dealt framings and idea cards, propose two concepts each and search for prior art
//   bolder     another seat takes every concept further, "yes, and"
//   attack     a critic who has seen the field and the visitor's voice attack; the proposers defend, narrow or
//   reply      concede; up to three rounds, only on what is still contested
//   pick       the judge rules on every concept and picks one, worked out in full
//   build      a builder makes one page that opens as the new site, live; a stranger looks at it; one revision
//   done       the page, its pictures and a one-page note for whoever builds the site
//
// Everything the debate says stays in the session folder as its log; `render` writes it as a document (and a PDF)
// only when the person asks. Members write their own files and run `done --role <role>` to have them checked. Every
// command prints JSON (Markdown for `brief` and `show`) and exits non-zero on error.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findBrowser, screenshot, lookSlug, printPdf } from '../../council/scripts/lib/browser.mjs';
import { addNote, NOTE_KINDS } from '../../council/scripts/lib/notes.mjs';
import { arm, disarm } from '../../../hooks/guard.mjs';
import { dumpUrl, detectTech } from './lib/probe.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '..');
const SCRIPT = fileURLToPath(import.meta.url);
const STEPS = path.join(SKILL, 'steps');
const SEATS = JSON.parse(fs.readFileSync(path.join(SKILL, 'references', 'seats.json'), 'utf8')).seats;
const CARDS = JSON.parse(fs.readFileSync(path.join(SKILL, 'references', 'cards.json'), 'utf8')).cards;
const MAX_ROUNDS = 3;

// The studies, each with how long it stays fresh. The awards, trade and template scouts photograph what they look at.
export const STUDY = {
  business: { title: 'the business scout', days: 14 },
  voice: { title: 'the voice scout', days: 14 },
  awards: { title: 'the awards scout', days: 30, looks: true },
  trade: { title: 'the trade scout', days: 30, looks: true },
  templates: { title: 'the template scout', days: 30, looks: true },
  craft: { title: 'the craft scan', days: 14 },
};
// What a session of the earlier version of the studio left that still counts as a study.
const LEGACY = { business: ['study-shown.md'], trade: ['study-shown.md'], awards: ['study-shown.md', 'currents.json'], templates: ['slop.json'] };

// The hosts a concept page may load from: fonts and the usual script CDNs. The SVG namespace is a name, not a request.
export const HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'fonts.bunny.net', 'api.fontshare.com', 'cdn.fontshare.com', 'cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'www.w3.org'];
export const SHOTS = { desktop: [1440, 900], 'desktop-long': [1440, 6000], phone: [390, 844], 'phone-long': [390, 5000] };
const MIN_WINDOW = 500;

// ---- Small helpers ----

const readJson = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`); };
const today = () => new Date().toISOString().slice(0, 10);
const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const q = (s) => `"${s}"`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) o[key] = true; else { o[key] = val; i++; }
  }
  return o;
}

const studioDir = (root) => path.join(root, '.project-health', 'studio');
const sessionFile = (dir) => path.join(dir, 'studio.json');

function sessions(root) {
  const base = studioDir(root);
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse();
}

function load(root, id) {
  const pick = id ?? sessions(root).find((s) => fs.existsSync(sessionFile(path.join(studioDir(root), s))));
  if (!pick) throw new Error('No studio session here. Run "init" first.');
  const dir = path.join(studioDir(root), pick);
  const s = readJson(sessionFile(dir));
  if (!s) throw new Error(`Session ${pick} has no studio.json: it was made by the earlier version of the studio and cannot be continued. Run "init"; its research is reused.`);
  if (!s.study?.kinds) throw new Error(`Session ${pick} was made by an earlier version of this studio and cannot be continued. Run "init --new"; its research is reused.`);
  return { s, dir };
}
const save = (dir, s) => writeJson(sessionFile(dir), s);

// A small random generator seeded by the session, so the cards dealt are the same every time they are worked out.
function seeded(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}

// ---- Reusing research ----

const ageDays = (file) => (Date.now() - fs.statSync(file).mtimeMs) / 86400e3;

// For each study, the newest earlier session that holds it fresh: one of this version (study/<kind>.md) or of the
// earlier version of the studio (study-shown.md, currents.json, slop.json). `wanted` is "latest", a session id, or
// "none".
export function findStudies(root, exclude, wanted = 'latest') {
  const kinds = Object.fromEntries(Object.keys(STUDY).map((k) => [k, null]));
  const looks = new Set();
  if (wanted === 'none') return { kinds, looks: [] };
  for (const id of sessions(root)) {
    if (id === exclude || (wanted !== 'latest' && id !== wanted)) continue;
    const dir = path.join(studioDir(root), id);
    const fresh = (f, days) => fs.existsSync(path.join(dir, f)) && ageDays(path.join(dir, f)) <= days;
    const rel = (f) => path.relative(root, path.join(dir, f));
    let used = false;
    for (const [kind, { days }] of Object.entries(STUDY)) {
      if (kinds[kind]) continue;
      if (fresh(`study/${kind}.md`, days)) { kinds[kind] = { from: id, files: [rel(`study/${kind}.md`)] }; used = true; continue; }
      const legacy = (LEGACY[kind] ?? []).filter((f) => fresh(f, days));
      if (legacy.length && legacy[0] === (LEGACY[kind] ?? [])[0]) { kinds[kind] = { from: id, files: legacy.map(rel) }; used = true; }
    }
    if (used) for (const f of ['study/looks', 'looks']) if (fs.existsSync(path.join(dir, f))) looks.add(rel(f));
  }
  return { kinds, looks: [...looks] };
}

// ---- What the person said that every member respects ----

function personSays(root) {
  const facts = readJson(path.join(root, '.project-health', 'kb', 'facts.json'), { facts: [] }).facts ?? [];
  const notes = readJson(path.join(root, '.project-health', 'kb', 'knowledge.json'), { notes: [] }).notes ?? [];
  const lines = [];
  for (const f of facts) if (/^(brand|owner|studio)\./.test(f.key)) lines.push(`- ${f.key}: ${one(f.value)}`);
  for (const n of notes) {
    if (!['forbidden', 'constraint', 'decision', 'preference'].includes(n.kind)) continue;
    if (n.scope && !/design|site|studio/i.test(n.scope)) continue;
    lines.push(`- ${n.kind === 'forbidden' ? 'NEVER' : n.kind === 'preference' ? 'More of this' : n.kind}: ${one(n.title)}: ${one(n.detail)}`);
  }
  return lines;
}

// ---- Who has a turn, and where they write ----

const isSeat = (role) => SEATS.some((x) => x.role === role);
const TITLES = { ...Object.fromEntries(Object.entries(STUDY).map(([k, v]) => [k, v.title])), framer: 'the framer', provocations: 'the provocateur, writing provocations', bolder: 'the seat that takes every concept further', critic: 'the critic', visitor: 'the visitor\'s voice', judge: 'the judge', builder: 'the builder', eye: 'the stranger\'s eye' };
const MODELS = { framer: 'strongest', provocations: 'strongest', bolder: 'standard', critic: 'strongest', visitor: 'standard', judge: 'strongest', builder: 'strongest', eye: 'standard' };

function outOf(s, role) {
  if (STUDY[role]) return `study/${role}.md`;
  switch (role) {
    case 'framer': return 'frame.json';
    case 'provocations': return 'provocations.json';
    case 'bolder': return 'bolder.json';
    case 'critic': case 'visitor': return `rounds/r${s.round}-${role}.json`;
    case 'judge': return 'pick.json';
    case 'builder': return 'page/index.html';
    case 'eye': return 'look.json';
    default: return s.phase === 'reply' ? `rounds/r${s.round}-reply-${role}.json` : `concepts/${role}.json`;
  }
}

const bySeat = (dir) => Object.fromEntries((readJson(path.join(dir, 'concepts-by-seat.json'), { seats: [] }).seats).map((x) => [x.id, x.seat]));
const concepts = (dir) => readJson(path.join(dir, 'concepts.json'), { concepts: [] }).concepts ?? [];

function rolesOf(dir, s) {
  switch (s.phase) {
    case 'study': return Object.keys(STUDY).filter((k) => !s.study.kinds[k]);
    case 'frame': return ['framer'];
    case 'provoke': return ['provocations'];
    case 'concepts': return SEATS.map((x) => x.role);
    case 'bolder': return ['bolder'];
    case 'attack': return ['critic', 'visitor'];
    case 'reply': { const owner = bySeat(dir); return SEATS.map((x) => x.role).filter((r) => s.pressed.some((id) => owner[id] === r)); }
    case 'pick': return ['judge'];
    case 'build': case 'revise': return ['builder'];
    case 'look': return ['eye'];
    default: return [];
  }
}

function turnsOf(root, dir, s) {
  return rolesOf(dir, s).map((role) => {
    const seat = SEATS.find((x) => x.role === role);
    return {
      role,
      name: seat ? `the seat "${seat.title}"` : TITLES[role],
      model: seat?.model ?? MODELS[role] ?? 'standard',
      done: check(root, dir, s, role).length === 0,
      task: `You are ${seat ? seat.name : TITLES[role]} in a design studio session. Run: node ${q(SCRIPT)} brief --root ${q(root)} --session ${s.id} --role ${role}  and follow what it prints exactly.`,
    };
  });
}

// ---- Checking what a member wrote ----

const len = (v, lo, hi, at, errors) => {
  const t = one(v);
  if (t.length < lo || t.length > hi) errors.push(`${at}: ${lo} to ${hi} characters (now ${t.length})`);
};

// A concept is an idea with a world, a feeling and movement. A rule about the size or weight of the letters is not a
// concept: type follows from the idea.
const TYPE_RULE = /\b(font|type|typeface|text|letters?|headings?|headlines?|words?)\b[^.]{0,40}\b(size|sizes|larger|bigger|smaller|heav\w*|weights?|bold|scale)\b|\b(larger|bigger|smaller|heavier|bolder|lighter)\b[^.]{0,30}\b(font|type|text|letters|headings?)\b/i;
const STILL = /^\s*(nothing|no (motion|animation|movement)|it does not move|stillness)\b/i;

export function conceptErrors(c, at, { dealt = null } = {}) {
  const e = [];
  if (!c || typeof c !== 'object') return [`${at}: a concept object`];
  len(c.name, 3, 60, `${at}.name`, e);
  len(c.idea, 30, 320, `${at}.idea`, e);
  len(c.feeling, 30, 400, `${at}.feeling`, e);
  len(c.world, 80, 800, `${at}.world`, e);
  len(c.motion, 80, 800, `${at}.motion`, e);
  len(c.moment, 30, 400, `${at}.moment`, e);
  len(c.hero, 60, 600, `${at}.hero`, e);
  len(c.inside, 60, 600, `${at}.inside`, e);
  len(c.type, 20, 300, `${at}.type`, e);
  len(c.onlyThem, 30, 320, `${at}.onlyThem`, e);
  if (!Array.isArray(c.madeOf) || !c.madeOf.length || c.madeOf.length > 6) e.push(`${at}.madeOf: one to six things of the business it is made of, as the study names them`);
  if (TYPE_RULE.test(`${c.name ?? ''} ${c.idea ?? ''}`)) e.push(`${at}: the name or the idea is a rule about the size or weight of type. That is not a concept: type follows from the idea. Say what the site IS, what it shows and how it moves.`);
  if (STILL.test(c.motion ?? '')) e.push(`${at}.motion: say what moves and the feeling it carries. Stillness may be part of a concept, never all of its motion.`);
  if (dealt) {
    if (typeof c.answers !== 'string' || !/^[HT]\d+$/.test(c.answers)) e.push(`${at}.answers: the framing it answers (an H… or T… id)`);
    if (!Array.isArray(c.cards) || !c.cards.length || c.cards.some((k) => !dealt.cards.includes(k))) e.push(`${at}.cards: the ids of the cards dealt to you that led to it (${dealt.cards.join(', ')})`);
    if (c.provocation !== undefined && c.provocation !== null && !/^P\d+$/.test(c.provocation)) e.push(`${at}.provocation: a P… id, or leave it out`);
    const p = c.priorArt ?? {};
    if (!['yes', 'partly', 'no'].includes(p.exists)) e.push(`${at}.priorArt.exists: yes, partly or no`);
    len(p.searched, 20, 500, `${at}.priorArt.searched`, e);
    if (p.exists && p.exists !== 'no') { len(p.nearest, 10, 400, `${at}.priorArt.nearest`, e); len(p.difference, 20, 500, `${at}.priorArt.difference`, e); }
  }
  return e;
}

const FLAGS = ['copy', 'template', 'collection', 'type-only', 'no-feeling', 'not-this-business', 'gets-in-the-way', 'cannot-build', 'cannot-feed', 'not-new'];
const STANCES = ['defend', 'narrow', 'concede'];
const RULINGS = ['survived', 'narrowed', 'killed', 'undecided'];

export function pageErrors(dir) {
  const file = path.join(dir, 'page', 'index.html');
  if (!fs.existsSync(file)) return ['page/index.html has not been written'];
  const html = fs.readFileSync(file, 'utf8');
  const e = [];
  if (html.length > 1_500_000) e.push('page/index.html is over 1.5 MB: move pictures into page/assets/');
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) e.push('a <meta name="viewport"> is missing');
  if (!/prefers-reduced-motion/i.test(html)) e.push('a prefers-reduced-motion rule is missing: a visitor who asked for less motion must still get the page');
  const banned = [[/<form\b/i, 'a form'], [/<iframe\b/i, 'a frame'], [/\bfetch\s*\(/, 'fetch()'], [/XMLHttpRequest/, 'XMLHttpRequest'], [/sendBeacon/, 'sendBeacon'], [/\bWebSocket\b/, 'a WebSocket'], [/localStorage|sessionStorage|indexedDB/, 'storage'], [/document\.cookie/, 'cookies'], [/http-equiv/i, '<meta http-equiv>']];
  for (const [re, what] of banned) if (re.test(html)) e.push(`the page may not use ${what}`);
  for (const m of html.matchAll(/(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,})(?=[/"'\s)?#:]|$)/gi)) {
    if (!HOSTS.includes(m[1].toLowerCase())) e.push(`the page may not load from or link to ${m[1]}: only fonts and the script CDNs (${HOSTS.slice(0, -1).join(', ')}). Copy the business's own pictures in with the asset command.`);
  }
  for (const m of html.matchAll(/(?:src|href)\s*=\s*["'](?!https?:|data:|#|mailto:|tel:|javascript:)([^"']+)["']/gi)) {
    const ref = decodeURIComponent(m[1].split(/[?#]/)[0]);
    if (ref && !fs.existsSync(path.join(dir, 'page', ref))) e.push(`${m[1]} is not in page/`);
  }
  return [...new Set(e)];
}

function frameErrors(f) {
  const e = [];
  if (!f || typeof f !== 'object') return ['frame.json: an object'];
  len(f.ideal, 30, 600, 'ideal', e);
  if (!Array.isArray(f.contradictions) || f.contradictions.length < 2 || f.contradictions.length > 5 || f.contradictions.some((c) => !c.want || !c.butThen || !c.separate)) e.push('contradictions: two to five, each { want, butThen, separate }');
  if (!Array.isArray(f.morphology) || f.morphology.length < 3 || f.morphology.length > 6 || f.morphology.some((d) => !d.name || !Array.isArray(d.options) || d.options.length < 3 || d.options.length > 6)) e.push('morphology: three to six dimensions, each { name, options: three to six, now }');
  if (!f.evolution?.now || !f.evolution?.next) e.push('evolution: { now, next }');
  if (!Array.isArray(f.questions) || f.questions.length < 6 || f.questions.length > 10 || f.questions.some((x) => !/^How might we\b/i.test(x.text ?? '') || !['narrow', 'wide', 'reframe'].includes(x.altitude))) e.push('questions: six to ten, each { text: "How might we …", altitude: narrow | wide | reframe }');
  else if (f.questions.filter((x) => x.altitude === 'reframe').length < 2) e.push('questions: at least two that reframe the goal');
  return e;
}

export function check(root, dir, s, role) {
  const rel = outOf(s, role);
  const file = path.join(dir, rel);
  if (!fs.existsSync(file)) return [`${rel} has not been written`];
  if (STUDY[role]) {
    const n = fs.readFileSync(file, 'utf8').length;
    return n < 1200 ? [`${rel} is too short to design from (${n} characters)`] : n > 30000 ? [`${rel} is over 30,000 characters: others must read it; keep what a designer needs`] : [];
  }
  if (role === 'builder') {
    const e = pageErrors(dir);
    if (!e.length && s.phase === 'revise' && fs.statSync(file).mtimeMs <= fs.statSync(path.join(dir, 'look.json')).mtimeMs) e.push('the page has not been revised since the look');
    return e;
  }
  const data = readJson(file);
  if (!data) return [`${rel} is not valid JSON`];
  const e = [];
  const all = concepts(dir);
  const ids = all.map((c) => c.id);
  if (role === 'framer') return frameErrors(data);
  if (role === 'provocations') {
    if (!Array.isArray(data.provocations) || data.provocations.length < 5 || data.provocations.length > 12) return ['provocations: five to twelve'];
    data.provocations.forEach((p, i) => { len(p.text, 10, 240, `provocations[${i}].text`, e); if (!['reversal', 'escape', 'exaggeration', 'distortion', 'wishful'].includes(p.kind)) e.push(`provocations[${i}].kind: reversal, escape, exaggeration, distortion or wishful`); });
    return e;
  }
  if (isSeat(role) && s.phase === 'concepts') {
    if (!Array.isArray(data.concepts) || data.concepts.length < 1 || data.concepts.length > 3) return ['concepts: one to three concepts (two are asked for)'];
    data.concepts.forEach((c, i) => e.push(...conceptErrors(c, `concepts[${i}]`, { dealt: s.dealt?.[role] ?? { cards: [] } })));
    return e;
  }
  if (isSeat(role) && s.phase === 'reply') {
    const owner = bySeat(dir);
    const mine = s.pressed.filter((id) => owner[id] === role);
    if (!Array.isArray(data.replies)) return ['replies: one per concept of yours that was pressed'];
    for (const id of mine) if (!data.replies.some((r) => r.concept === id)) e.push(`replies: nothing on ${id}`);
    data.replies.forEach((r, i) => {
      if (!mine.includes(r.concept)) e.push(`replies[${i}].concept: ${r.concept} is not one of yours to answer (${mine.join(', ')})`);
      if (!STANCES.includes(r.stance)) e.push(`replies[${i}].stance: ${STANCES.join(', ')}`);
      len(r.says, 30, 900, `replies[${i}].says`, e);
      if (r.stance === 'narrow' && (!r.change || typeof r.change !== 'object' || !Object.keys(r.change).length)) e.push(`replies[${i}].change: the fields of the concept as narrowed (any of idea, world, motion, moment, hero, inside, type)`);
      if (r.change && TYPE_RULE.test(`${r.change.name ?? ''} ${r.change.idea ?? ''}`)) e.push(`replies[${i}].change: narrowing a concept into a rule about type kills it; concede instead`);
    });
    return e;
  }
  if (role === 'bolder') {
    if (!Array.isArray(data.takes)) return ['takes: one per concept'];
    for (const id of ids) if (!data.takes.some((t) => t.concept === id)) e.push(`takes: nothing on ${id}`);
    data.takes.forEach((t, i) => { len(t.text, 40, 700, `takes[${i}].text`, e); if (!t.bigger?.idea || !t.bigger?.world || !t.bigger?.motion) e.push(`takes[${i}].bigger: { idea, world, motion } at least`); });
    return e;
  }
  if (role === 'critic' || role === 'visitor') {
    if (!Array.isArray(data.notes)) return ['notes: one entry per concept still open'];
    for (const id of s.open) if (!data.notes.some((n) => n.concept === id)) e.push(`notes: nothing on ${id}; every open concept gets a note`);
    data.notes.forEach((n, i) => {
      if (!s.open.includes(n.concept)) e.push(`notes[${i}].concept: ${n.concept} is not open in this round (${s.open.join(', ')})`);
      len(n.says, 20, 900, `notes[${i}].says`, e);
      if (s.round === 1) len(n.strongest, 10, 300, `notes[${i}].strongest`, e);
      if (typeof n.presses !== 'boolean') e.push(`notes[${i}].presses: true when you want the proposer to answer, false when it holds`);
      for (const f of n.flags ?? []) if (!FLAGS.includes(f)) e.push(`notes[${i}].flags: ${f} is not one of ${FLAGS.join(', ')}`);
    });
    return e;
  }
  if (role === 'judge') {
    if (!ids.includes(data.chosen)) e.push(`chosen: one of ${ids.join(', ')}`);
    if (!Array.isArray(data.rulings)) e.push('rulings: one per concept');
    else {
      for (const id of ids) if (!data.rulings.some((r) => r.concept === id)) e.push(`rulings: nothing on ${id}`);
      data.rulings.forEach((r, i) => { if (!RULINGS.includes(r.ruling)) e.push(`rulings[${i}].ruling: ${RULINGS.join(', ')}`); len(r.why, 20, 600, `rulings[${i}].why`, e); });
      const chosen = data.rulings.find((r) => r.concept === data.chosen);
      if (chosen && !['survived', 'narrowed'].includes(chosen.ruling)) e.push('chosen: the concept picked must have survived (as proposed or narrowed)');
    }
    len(data.why, 40, 900, 'why', e);
    const c = data.concept ?? {};
    len(c.name, 3, 60, 'concept.name', e);
    len(c.idea, 30, 320, 'concept.idea', e);
    len(c.feeling, 30, 400, 'concept.feeling', e);
    if (!Array.isArray(c.story) || c.story.length < 3 || c.story.length > 8) e.push('concept.story: three to eight beats, how the idea unfolds as a visitor moves down the first page');
    if (!Array.isArray(c.palette) || c.palette.length < 2 || c.palette.length > 8 || c.palette.some((p) => !/^#[0-9a-f]{3,8}$/i.test(p.value ?? '') || !p.from)) e.push('concept.palette: two to eight colours, each { name, value: "#rrggbb", from }');
    if (!Array.isArray(c.type) || !c.type.length || c.type.length > 3) e.push('concept.type: one to three faces, each { role, family, source, why }');
    len(c.forms, 60, 800, 'concept.forms', e);
    len(c.imagery, 40, 700, 'concept.imagery', e);
    if (!Array.isArray(c.motion) || c.motion.length < 3 || c.motion.length > 7 || c.motion.some((m) => !m.what || !m.feels || !m.trigger)) e.push('concept.motion: three to seven movements, each { name, trigger, what, feels, duration, easing }');
    if (!c.moment?.what) e.push('concept.moment: { what, why }');
    len(c.hero, 60, 700, 'concept.hero', e);
    if (!Array.isArray(c.pages) || !c.pages.length) e.push('concept.pages: one to four inner pages, each { page, what }');
    len(c.voice, 30, 500, 'concept.voice', e);
    len(c.onlyThem, 30, 320, 'concept.onlyThem', e);
    if (TYPE_RULE.test(`${c.name ?? ''} ${c.idea ?? ''}`)) e.push('concept: the name or idea is a rule about type size or weight; the concept is the idea behind the site');
    return e;
  }
  if (role === 'eye') {
    if (!['ready', 'revise'].includes(data.verdict)) e.push('verdict: "ready" or "revise"');
    len(data.saw?.business, 10, 400, 'saw.business', e);
    len(data.saw?.feeling, 10, 400, 'saw.feeling', e);
    if (data.verdict === 'revise' && (!Array.isArray(data.fixes) || !data.fixes.length || data.fixes.length > 8)) e.push('fixes: one to eight things to change, each one sentence');
    return e;
  }
  return [`no check for role ${role}`];
}

// ---- Dealing framings and cards ----

// Each seat is dealt two framings (the ones the person picked first) and three cards from three different families.
export function deal(s, frame) {
  const rand = seeded(s.id);
  const framings = [...(frame.questions ?? []).map((x) => x.id), ...(frame.contradictions ?? []).map((x) => x.id)];
  const picked = (s.framingPick ?? []).filter((id) => framings.includes(id));
  const order = [...picked, ...framings.filter((id) => !picked.includes(id)).sort(() => rand() - 0.5)];
  const dealt = {};
  SEATS.forEach((seat, i) => {
    const mine = [order[(2 * i) % order.length], order[(2 * i + 1) % order.length]];
    const families = [...new Set(CARDS.map((c) => c.family))].sort(() => rand() - 0.5).slice(0, 3);
    const cards = families.map((f) => { const pool = CARDS.filter((c) => c.family === f); return pool[Math.floor(rand() * pool.length)].id; });
    dealt[seat.role] = { framings: [...new Set(mine)], cards };
  });
  return dealt;
}

// ---- The brief a member reads ----

function brief(root, dir, s, role) {
  const seat = SEATS.find((x) => x.role === role);
  const step = seat ? (s.phase === 'reply' ? 'reply' : 'seat') : role;
  const abs = (rel) => path.resolve(root, rel);
  const out = [fs.readFileSync(path.join(STEPS, `${step}.md`), 'utf8').trim(), '', '## Your material', ''];
  out.push(`- The session folder: ${dir}`);
  if (s.url) out.push(`- The live site: ${s.url}`);
  out.push(`- The project's files: ${root} (read; never change anything outside the session folder)`);
  if (s.goal) out.push(`- The person's goal for this session: ${one(s.goal)}`);
  if (s.focus) out.push(`- The part of the site the person wants looked at first: ${one(s.focus)}`);
  const studies = (kinds) => kinds.flatMap((k) => (s.study.kinds[k]?.files ?? []).map((f) => `  - ${k}: ${abs(f)}`));
  const seesField = ['critic', 'judge', 'builder', 'eye', 'awards', 'trade', 'templates'].includes(role);
  if (!STUDY[role]) {
    const lines = [...new Set(studies(Object.keys(STUDY)))];
    if (lines.length) out.push('- The studies (what the studio understood; read them all):', ...lines);
    const corr = path.join(dir, 'study', 'corrections.md');
    if (fs.existsSync(corr)) out.push(`- What the person corrected in the study (this overrides it): ${corr}`);
  }
  if (seesField && s.study.looks.length) out.push(`- Pictures of honoured, rival and template sites: ${s.study.looks.map(abs).join(', ')}`);
  if (['provocations', ...SEATS.map((x) => x.role), 'bolder', 'critic', 'visitor', 'judge'].includes(role) && fs.existsSync(path.join(dir, 'frame.json'))) out.push(`- The frame (ideal result, contradictions T…, morphological box, line of evolution, "how might we" questions H…): ${path.join(dir, 'frame.json')}`);
  if (seat && s.phase === 'concepts') {
    out.push(`- The provocations (P…), to mine: ${path.join(dir, 'provocations.json')}`);
    const d = s.dealt?.[role];
    if (d) {
      const frame = readJson(path.join(dir, 'frame.json'), {});
      const text = (id) => (frame.questions ?? []).find((x) => x.id === id)?.text ?? (() => { const c = (frame.contradictions ?? []).find((x) => x.id === id); return c ? `${c.want}, but then ${c.butThen}` : id; })();
      out.push('', '**Your framings** (answer these first):', ...d.framings.map((id) => `- ${id}: ${one(text(id))}`));
      out.push('', '**Your cards** (apply each to the material):', ...d.cards.map((id) => { const c = CARDS.find((x) => x.id === id); return `- ${id} ${c.name}: ${c.prompt}`; }));
    }
    out.push('', `**Your starting place: ${seat.title}.** ${seat.start}`);
  }
  if (['bolder', 'critic', 'visitor', 'judge'].includes(role) || (seat && s.phase === 'reply')) out.push(`- The concepts, as they stand now: ${path.join(dir, 'concepts.json')}`);
  if (['critic', 'visitor', 'judge'].includes(role) || (seat && s.phase === 'reply')) out.push(`- Each concept taken further by another seat: ${path.join(dir, 'bolder.json')}`);
  if ((['critic', 'visitor'].includes(role) && s.round > 1) || role === 'judge' || (seat && s.phase === 'reply')) out.push(`- The debate so far (attacks and replies, by round): ${path.join(dir, 'rounds')}`);
  if (['critic', 'visitor'].includes(role)) out.push('', `**This is round ${s.round} of at most ${MAX_ROUNDS}.** Write a note on each of these concepts, and only these: ${s.open.join(', ')}.`);
  if (seat && s.phase === 'reply') {
    const owner = bySeat(dir);
    out.push('', `**Round ${s.round}. Your concepts that were pressed:** ${s.pressed.filter((id) => owner[id] === role).join(', ')}. The attacks are in rounds/r${s.round}-critic.json and rounds/r${s.round}-visitor.json.`);
  }
  if (['builder', 'eye'].includes(role)) out.push(`- The concept: ${path.join(dir, 'pick.json')}`);
  if (role === 'builder' && s.phase === 'revise') out.push(`- **What the stranger saw, and what to change**: ${path.join(dir, 'look.json')}. Revise the page you made (it is in page/): change what the look asks, within the concept.`);
  if (role === 'eye') out.push(`- The pictures of the page: ${path.join(dir, 'shots')}. The page itself: ${path.join(dir, 'page', 'index.html')}`);
  const says = personSays(root);
  out.push('', '## What the person said (respect every line)', '', ...(says.length ? says : ['- Nothing yet.']));
  out.push('', '## Saving', '');
  out.push(`Write **${path.join(dir, outOf(s, role))}** with the Write tool${role === 'builder' ? ' (and any files it needs in page/)' : ''}. Then run:`, '', `    node ${q(SCRIPT)} done --root ${q(root)} --session ${s.id} --role ${role}`, '', 'It checks what you wrote and says what to fix. Fix it and run it again until it says ok. Then reply with one line: what you saved, or what failed.');
  const cmds = [];
  if (STUDY[role]?.looks || ['critic', 'builder', 'business'].includes(role) || (seat && s.phase === 'reply')) cmds.push(`- Photograph a live page (desktop, long, phone): node ${q(SCRIPT)} look --root ${q(root)} --session ${s.id} --url <https://…>`);
  if (['awards', 'trade', 'critic'].includes(role)) cmds.push(`- Read what a live page is built with (libraries, frameworks, fonts, canvases, reduced motion): node ${q(SCRIPT)} probe --root ${q(root)} --session ${s.id} --url <https://…>`);
  if (role === 'builder') {
    cmds.push(`- Copy a picture, a font or another file of the project into page/assets/: node ${q(SCRIPT)} asset --root ${q(root)} --session ${s.id} --from "<path under the project>" [--as <name>]`);
    cmds.push(`- Photograph the page as it is now (desktop, long, phone), to look at your own work: node ${q(SCRIPT)} shoot --root ${q(root)} --session ${s.id}`);
  }
  if (cmds.length) out.push('', 'Commands you may run:', '', ...cmds);
  out.push('', fs.readFileSync(path.join(STEPS, '_rules.md'), 'utf8').trim());
  return out.join('\n');
}

// ---- Pictures ----

function shootPage(dir) {
  const browser = findBrowser();
  if (!browser) return { errors: ['No Chrome, Edge or Chromium was found: the page cannot be photographed.'] };
  const page = path.join(dir, 'page', 'index.html');
  const files = {};
  const errors = [];
  fs.mkdirSync(path.join(dir, 'shots'), { recursive: true });
  for (const [name, [width, height]] of Object.entries(SHOTS)) {
    // Headless Chrome will not make a window narrower than about 500 pixels, so a phone is photographed as the page in
    // a frame of the phone's width, at the left of a window the browser accepts.
    let url = pathToFileURL(page).href;
    let size = [width, height];
    if (width < MIN_WINDOW) {
      const frame = path.join(dir, 'shots', `.${name}.html`);
      fs.writeFileSync(frame, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#888}iframe{display:block;border:0;width:${width}px;height:${height}px}</style><iframe src="${pathToFileURL(page).href}"></iframe>`);
      url = pathToFileURL(frame).href;
      size = [MIN_WINDOW, height];
    }
    try { files[name] = screenshot(browser, url, path.join(dir, 'shots', `${name}.png`), size, { timeoutMs: 90000 }); } catch (err) { errors.push(err.message); }
  }
  for (const f of fs.readdirSync(path.join(dir, 'shots'))) if (f.startsWith('.')) fs.rmSync(path.join(dir, 'shots', f), { force: true });
  return { errors, files };
}

function lookAt(dir, url) {
  const browser = findBrowser();
  if (!browser) return { errors: ['No Chrome, Edge or Chromium was found.'] };
  const slug = lookSlug(url);
  const files = {};
  const errors = [];
  for (const [name, size] of [['desktop', [1440, 900]], ['desktop-long', [1440, 3600]], ['phone', [500, 900]]]) {
    try { files[name] = screenshot(browser, url, path.join(dir, 'study', 'looks', `${slug}-${name}.png`), size); } catch (err) { errors.push(err.message); }
  }
  return { errors, files };
}

// ---- The note for whoever builds the site ----

function handoff(s, pick) {
  const c = pick.concept;
  const L = [`# ${one(c.name)}`, '', `A design concept for ${s.url ?? 'the site'}, from the design studio session ${s.id}. Open \`page/index.html\` first: the page shows it; this note is for building it.`, ''];
  L.push(`**The idea.** ${one(c.idea)}`, '', `**What a visitor should feel.** ${one(c.feeling)}`, '', `**Why only this business.** ${one(c.onlyThem)}`, '');
  L.push('## How it unfolds', '', ...c.story.map((b, i) => `${i + 1}. ${one(b)}`), '');
  L.push('## The first screen', '', one(c.hero), '');
  L.push('## Inside', '', ...c.pages.map((p) => `- **${one(p.page)}**: ${one(p.what)}`), '');
  L.push('## Colour', '', '| Name | Value | Where it comes from |', '|---|---|---|', ...c.palette.map((p) => `| ${one(p.name)} | \`${p.value}\` | ${one(p.from)} |`), '');
  L.push('## Type', '', ...c.type.map((t) => `- **${one(t.role)}**: ${one(t.family)} (${one(t.source)}). ${one(t.why)}`), '');
  L.push('## Forms and imagery', '', one(c.forms), '', one(c.imagery), '');
  L.push('## Motion', '', '| Movement | When | What happens | What it makes you feel | Duration | Easing |', '|---|---|---|---|---|---|', ...c.motion.map((m) => `| ${one(m.name)} | ${one(m.trigger)} | ${one(m.what)} | ${one(m.feels)} | ${one(m.duration)} | ${one(m.easing)} |`), '');
  L.push(`**The moment people will tell someone about.** ${one(c.moment.what)}${c.moment.why ? ` ${one(c.moment.why)}` : ''}`, '');
  L.push('## Voice', '', one(c.voice), '');
  if (c.needs?.length) L.push('## What the business must supply', '', ...c.needs.map((n) => `- ${one(n)}`), '');
  if (pick.borrowed?.length) L.push('## Taken from the other concepts', '', ...pick.borrowed.map((b) => `- ${one(b.what)}`), '');
  return `${L.join('\n')}\n`;
}

// ---- The record of the session, written only when asked ----

function record(root, dir, s) {
  const all = concepts(dir);
  const owner = bySeat(dir);
  const frame = readJson(path.join(dir, 'frame.json'));
  const prov = readJson(path.join(dir, 'provocations.json'));
  const bolder = readJson(path.join(dir, 'bolder.json'), { takes: [] });
  const pick = readJson(path.join(dir, 'pick.json'));
  const rounds = fs.existsSync(path.join(dir, 'rounds')) ? fs.readdirSync(path.join(dir, 'rounds')).sort().map((f) => ({ f, d: readJson(path.join(dir, 'rounds', f)) })) : [];
  const seatTitle = (r) => SEATS.find((x) => x.role === r)?.title ?? r;
  const H = [];
  H.push(`<h1>Design studio · ${esc(s.id)}</h1><p class="lead">${esc(s.url ?? '')} — the record of the session: what was studied, how the problem was set, every concept, the debate and the rulings.</p>`);
  if (pick) H.push(`<section class="pick"><h2>The concept picked: ${esc(pick.concept.name)}</h2><p><b>${esc(pick.concept.idea)}</b></p><p>${esc(pick.concept.feeling)}</p><p>${esc(pick.why)}</p></section>`);
  H.push('<h2>What was studied</h2><ul>', ...Object.entries(s.study.kinds).map(([k, v]) => `<li><b>${esc(k)}</b>: ${v ? `${v.files.map(esc).join(', ')}${v.from !== s.id ? ` (from session ${esc(v.from)})` : ''}` : 'not studied'}</li>`), '</ul>');
  if (frame) {
    H.push(`<h2>The frame</h2><p><b>Ideal result.</b> ${esc(frame.ideal)}</p><h3>Contradictions</h3><ul>${frame.contradictions.map((c) => `<li><b>${esc(c.id)}</b> ${esc(c.want)}, but then ${esc(c.butThen)}. <i>${esc(c.separate)}</i></li>`).join('')}</ul>`);
    H.push(`<h3>How might we</h3><ul>${frame.questions.map((x) => `<li><b>${esc(x.id)}</b> ${esc(x.text)} <i>(${esc(x.altitude)})</i></li>`).join('')}</ul>`);
    H.push(`<h3>Morphological box</h3><table>${frame.morphology.map((d) => `<tr><th>${esc(d.name)}</th>${d.options.map((o, i) => `<td${i === d.now ? ' class="now"' : ''}>${esc(o)}</td>`).join('')}</tr>`).join('')}</table><p><b>Line of evolution.</b> ${esc(frame.evolution.now)} → ${esc(frame.evolution.next)}</p>`);
  }
  if (prov) H.push(`<h2>Provocations</h2><ul>${prov.provocations.map((p) => `<li><b>${esc(p.id)}</b> ${esc(p.text)} <i>(${esc(p.kind)})</i></li>`).join('')}</ul>`);
  H.push('<h2>Every concept</h2>');
  for (const c of all) {
    const ruling = pick?.rulings?.find((r) => r.concept === c.id);
    const take = bolder.takes.find((t) => t.concept === c.id);
    H.push(`<article><h3>${esc(c.id)} · ${esc(c.name)} <small>${esc(seatTitle(owner[c.id]))}${ruling ? ` · <b>${esc(ruling.ruling)}</b>` : ''}</small></h3>`);
    H.push(`<p><b>${esc(c.idea)}</b></p><dl>${['feeling', 'world', 'motion', 'moment', 'hero', 'inside', 'type', 'onlyThem'].map((k) => `<dt>${k}</dt><dd>${esc(c[k])}</dd>`).join('')}</dl>`);
    if (c.priorArt) H.push(`<p class="small"><b>Prior art (${esc(c.priorArt.exists)}).</b> ${esc(c.priorArt.searched)} ${esc(c.priorArt.nearest ?? '')} ${esc(c.priorArt.difference ?? '')}</p>`);
    if (take) H.push(`<p class="small"><b>Taken further.</b> ${esc(take.text)} <i>${esc(take.bigger.idea)}</i></p>`);
    for (const { f, d } of rounds) {
      for (const n of d?.notes ?? []) if (n.concept === c.id) H.push(`<p class="small"><b>${esc(f.replace('.json', ''))}</b>${n.flags?.length ? ` [${n.flags.map(esc).join(', ')}]` : ''}: ${esc(n.says)}</p>`);
      for (const r of d?.replies ?? []) if (r.concept === c.id) H.push(`<p class="small"><b>${esc(f.replace('.json', ''))} · ${esc(r.stance)}</b>: ${esc(r.says)}</p>`);
    }
    if (ruling) H.push(`<p class="small"><b>Ruling.</b> ${esc(ruling.why)}</p>`);
    H.push('</article>');
  }
  const css = 'body{font:15px/1.5 system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 24px;color:#1b1b1b}h1{font-size:30px}h2{margin-top:40px;border-top:2px solid #222;padding-top:12px}article{border-top:1px solid #ccc;padding:12px 0;break-inside:avoid-page}small{font-weight:400;color:#666}dt{font-weight:600;font-size:12px;text-transform:uppercase;color:#555}dd{margin:0 0 6px}.small{font-size:13px;color:#333}.lead{color:#555}.pick{background:#f4f1ea;padding:12px 18px}table{border-collapse:collapse;font-size:13px}td,th{border:1px solid #ccc;padding:4px 6px;text-align:left}td.now{background:#ffe9b3}';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Design studio ${esc(s.id)} · record</title><style>${css}</style><body>${H.join('\n')}</body></html>`;
}

// ---- Moving on ----

function nextLine(root, dir, s) {
  const waiting = turnsOf(root, dir, s).filter((t) => !t.done);
  const start = waiting.length ? `Start, all at once: ${waiting.map((t) => t.name).join(', ')}. Then run "next".` : 'Everyone has done their turn: run "next".';
  switch (s.phase) {
    case 'study': {
      const reused = Object.entries(s.study.kinds).filter(([, v]) => v && v.from !== s.id).map(([k, v]) => `${k} (from ${v.from})`);
      const head = reused.length ? `Reused: ${reused.join(', ')}. ` : '';
      if (waiting.length) return `${head}Study: ${start}`;
      return `${head}The study is complete. Show the person "show --what study" when it is new (or ask in one line whether anything has changed when it was all reused), save corrections with "correct", then run "next".`;
    }
    case 'frame': return `The frame: ${start}`;
    case 'provoke': return waiting.length ? `Provocations: ${start}` : 'Optionally show the person "show --what frame" and ask which questions and contradictions matter most ("framings --pick H2,T1"); then run "next" to deal the cards.';
    case 'concepts': return `Concepts: ${start}`;
    case 'bolder': return `Every concept is taken further before anyone attacks it: ${start}`;
    case 'attack': return `Round ${s.round}, attack (${s.open.length} concepts open): ${start}`;
    case 'reply': return `Round ${s.round}, reply (${s.pressed.length} concepts pressed): ${start}`;
    case 'pick': return `The judge rules on every concept and picks one: ${start}`;
    case 'build': return `The page: ${start}`;
    case 'look': return `A stranger looks at the pictures of the page: ${start}`;
    case 'revise': return `The builder revises the page once, from the look: ${start}`;
    case 'done': return 'Done. Run "close" for the result.';
    default: return '';
  }
}

// Gives every item of a list an id with the prefix, in place.
const number = (list, prefix) => list.map((x, i) => ({ id: `${prefix}${i + 1}`, ...x }));

function advance(root, dir, s, o, warnings) {
  switch (s.phase) {
    case 'study': {
      for (const kind of Object.keys(STUDY)) {
        if (s.study.kinds[kind]) continue;
        if (!check(root, dir, s, kind).length) s.study.kinds[kind] = { from: s.id, files: [path.relative(root, path.join(dir, `study/${kind}.md`))] };
        else warnings.push(`No study of ${kind}: ${STUDY[kind].title} did not finish.`);
      }
      if (!s.study.kinds.business) return ['There is no study of the business: the studio cannot design without one.'];
      if (fs.existsSync(path.join(dir, 'study', 'looks'))) s.study.looks = [...new Set([...s.study.looks, path.relative(root, path.join(dir, 'study', 'looks'))])];
      s.phase = 'frame';
      return [];
    }
    case 'frame': {
      if (check(root, dir, s, 'framer').length) return ['There is no frame: start the framer again.'];
      const f = readJson(path.join(dir, 'frame.json'));
      if (!f.questions[0].id) writeJson(path.join(dir, 'frame.json'), { ...f, contradictions: number(f.contradictions, 'T'), questions: number(f.questions, 'H') });
      s.phase = 'provoke';
      return [];
    }
    case 'provoke': {
      if (!check(root, dir, s, 'provocations').length) {
        const p = readJson(path.join(dir, 'provocations.json'));
        if (!p.provocations[0].id) writeJson(path.join(dir, 'provocations.json'), { provocations: number(p.provocations, 'P') });
      } else { warnings.push('No provocations: the seats propose without them.'); writeJson(path.join(dir, 'provocations.json'), { provocations: [] }); }
      s.dealt = deal(s, readJson(path.join(dir, 'frame.json')));
      s.phase = 'concepts';
      return [];
    }
    case 'concepts': {
      const all = [];
      for (const seat of SEATS) {
        if (check(root, dir, s, seat.role).length) { warnings.push(`${seat.title} left out: it did not finish.`); continue; }
        for (const c of readJson(path.join(dir, outOf(s, seat.role))).concepts) all.push({ id: `C${all.length + 1}`, seat: seat.role, ...c });
      }
      if (all.length < 3) return ['Fewer than three concepts: start the seats that did not finish.'];
      // The critics and the judge see the concepts without the seat that proposed them.
      writeJson(path.join(dir, 'concepts.json'), { concepts: all.map(({ seat, ...c }) => c) });
      writeJson(path.join(dir, 'concepts-by-seat.json'), { seats: all.map((c) => ({ id: c.id, seat: c.seat })) });
      s.phase = 'bolder';
      return [];
    }
    case 'bolder':
      if (check(root, dir, s, 'bolder').length) warnings.push('No concept was taken further.');
      Object.assign(s, { phase: 'attack', round: 1, open: concepts(dir).map((c) => c.id), pressed: [] });
      return [];
    case 'attack': {
      const said = ['critic', 'visitor'].filter((r) => !check(root, dir, s, r).length).map((r) => readJson(path.join(dir, outOf(s, r))));
      if (!said.length) return ['Nobody attacked: start the critic and the visitor\'s voice.'];
      const pressed = s.open.filter((id) => said.some((d) => d.notes.some((n) => n.concept === id && n.presses)));
      s.closed = [...(s.closed ?? []), ...s.open.filter((id) => !pressed.includes(id)).map((id) => ({ id, round: s.round, why: 'the attack rests' }))];
      if (!pressed.length) { s.open = []; s.phase = 'pick'; return []; }
      Object.assign(s, { phase: 'reply', pressed });
      return [];
    }
    case 'reply': {
      const owner = bySeat(dir);
      const all = concepts(dir);
      const stillOpen = [];
      for (const id of s.pressed) {
        const seat = owner[id];
        const reply = !check(root, dir, s, seat).length ? readJson(path.join(dir, outOf(s, seat))).replies.find((r) => r.concept === id) : null;
        const c = all.find((x) => x.id === id);
        if (!reply) { s.closed.push({ id, round: s.round, why: 'the attack went unanswered' }); continue; }
        c.history = [...(c.history ?? []), { round: s.round, stance: reply.stance }];
        if (reply.stance === 'concede') { s.closed.push({ id, round: s.round, why: 'conceded' }); continue; }
        if (reply.stance === 'narrow') Object.assign(c, Object.fromEntries(Object.entries(reply.change).filter(([k]) => ['name', 'idea', 'feeling', 'world', 'motion', 'moment', 'hero', 'inside', 'type', 'onlyThem'].includes(k))), { narrowed: true });
        stillOpen.push(id);
      }
      writeJson(path.join(dir, 'concepts.json'), { concepts: all });
      if (s.round >= MAX_ROUNDS || !stillOpen.length) {
        s.closed.push(...stillOpen.map((id) => ({ id, round: s.round, why: 'the last round is over' })));
        Object.assign(s, { phase: 'pick', open: [], pressed: [] });
      } else Object.assign(s, { phase: 'attack', round: s.round + 1, open: stillOpen, pressed: [] });
      return [];
    }
    case 'pick':
      if (check(root, dir, s, 'judge').length) return ['The judge has not picked: start the judge again. A concept cannot be built without its pick.'];
      s.phase = 'build';
      return [];
    case 'build':
    case 'revise': {
      if (check(root, dir, s, 'builder').length) return ['There is no page that passes its check: start the builder again.'];
      const shots = shootPage(dir);
      if (shots.errors.length) warnings.push(...shots.errors);
      if (s.phase === 'revise' || !Object.keys(shots.files ?? {}).length) {
        if (s.phase === 'build') warnings.push('The page could not be photographed, so nobody looked at it as a stranger.');
        s.phase = 'done';
      } else s.phase = 'look';
      return [];
    }
    case 'look':
      s.phase = readJson(path.join(dir, 'look.json'))?.verdict === 'revise' ? 'revise' : 'done';
      return [];
    default: return [`Nothing comes after ${s.phase}: run "close".`];
  }
}

// ---- Commands ----

const rootOf = (o) => path.resolve(typeof o.root === 'string' ? o.root : process.cwd());

const COMMANDS = {
  init(o) {
    const root = rootOf(o);
    let id = today();
    for (let n = 2; fs.existsSync(path.join(studioDir(root), id)); n++) id = `${today()}-${n}`;
    const open = sessions(root).map((x) => ({ x, s: readJson(sessionFile(path.join(studioDir(root), x))) })).find((r) => r.s && r.s.phase !== 'done' && !r.s.closedSession && r.s.study?.kinds);
    if (open && !o.new) return { ok: false, errors: [`Session ${open.x} is not finished (phase ${open.s.phase}). Ask the person whether to continue it (pass --session ${open.x} to the other commands) or start anew (init --new).`] };
    const wanted = typeof o.reuse === 'string' ? o.reuse : 'latest';
    const found = findStudies(root, id, wanted);
    // The craft scan is never reused when the person asked for a fresh look at what is possible.
    if (o.fresh) for (const k of String(o.fresh === true ? 'all' : o.fresh).split(',')) for (const kind of Object.keys(STUDY)) if (k === 'all' || k === kind) found.kinds[kind] = null;
    const dir = path.join(studioDir(root), id);
    fs.mkdirSync(path.join(dir, 'study'), { recursive: true });
    const s = {
      id, version: 3, createdAt: new Date().toISOString(), phase: 'study', round: 0, open: [], pressed: [], closed: [],
      url: typeof o.url === 'string' ? o.url : null, goal: typeof o.goal === 'string' ? o.goal : null, focus: typeof o.focus === 'string' ? o.focus : null,
      study: { kinds: found.kinds, looks: found.looks },
    };
    if (!s.url) {
      for (const from of new Set(Object.values(found.kinds).filter(Boolean).map((v) => v.from))) {
        const prevDir = path.join(studioDir(root), from);
        const prev = readJson(sessionFile(prevDir)) ?? readJson(path.join(prevDir, 'session.json'));
        if (prev?.url) { s.url = prev.url; break; }
      }
    }
    save(dir, s);
    arm({ root, skill: 'studio' });
    const browser = !!findBrowser();
    return {
      ok: true, session: id, dir, url: s.url, browser,
      reused: Object.fromEntries(Object.entries(found.kinds).filter(([, v]) => v).map(([k, v]) => [k, v.from])),
      toStudy: Object.keys(STUDY).filter((k) => !found.kinds[k]),
      warnings: browser ? [] : ['No Chrome, Edge or Chromium was found: the scouts cannot photograph or measure sites, and the page will be built but not photographed, so nobody looks at it as a stranger. Tell the person before anything is spent.'],
    };
  },

  status(o) {
    const root = rootOf(o);
    const { s, dir } = load(root, o.session);
    return { ok: true, session: s.id, dir, phase: s.phase, round: s.round, next: nextLine(root, dir, s), turns: turnsOf(root, dir, s) };
  },

  brief(o) {
    const root = rootOf(o);
    const { s, dir } = load(root, o.session);
    if (!rolesOf(dir, s).includes(o.role)) return { ok: false, errors: [`${o.role} has no turn in the ${s.phase} phase.`] };
    return { markdown: brief(root, dir, s, o.role) };
  },

  done(o) {
    const root = rootOf(o);
    const { s, dir } = load(root, o.session);
    const errors = check(root, dir, s, o.role);
    return errors.length ? { ok: false, errors } : { ok: true };
  },

  correct(o) {
    const root = rootOf(o);
    const { dir } = load(root, o.session);
    if (typeof o.text !== 'string') return { ok: false, errors: ['Usage: correct --text "<the person\'s words>"'] };
    fs.mkdirSync(path.join(dir, 'study'), { recursive: true });
    fs.appendFileSync(path.join(dir, 'study', 'corrections.md'), `- ${one(o.text)}\n`);
    return { ok: true };
  },

  framings(o) {
    const root = rootOf(o);
    const { s, dir } = load(root, o.session);
    if (typeof o.pick !== 'string') return { ok: false, errors: ['Usage: framings --pick H2,T1'] };
    const f = readJson(path.join(dir, 'frame.json'), {});
    const known = [...(f.questions ?? []), ...(f.contradictions ?? [])].map((x) => x.id);
    const pick = o.pick.split(',').map((x) => x.trim()).filter(Boolean);
    const unknown = pick.filter((x) => !known.includes(x));
    if (unknown.length) return { ok: false, errors: [`Not in the frame: ${unknown.join(', ')}`] };
    s.framingPick = pick;
    save(dir, s);
    return { ok: true, picked: pick };
  },

  show(o) {
    const root = rootOf(o);
    const { s, dir } = load(root, o.session);
    if (o.what === 'study') {
      const files = Object.entries(s.study.kinds).filter(([, v]) => v && v.from === s.id).flatMap(([, v]) => v.files);
      return { markdown: files.map((f) => fs.readFileSync(path.resolve(root, f), 'utf8')).join('\n\n') || 'The whole study was reused.' };
    }
    if (o.what === 'frame') {
      const f = readJson(path.join(dir, 'frame.json'));
      if (!f) return { ok: false, errors: ['No frame yet.'] };
      return { markdown: [`**The ideal result.** ${one(f.ideal)}`, '', '**How might we**', ...f.questions.map((x) => `- ${x.id}: ${one(x.text)}`), '', '**Contradictions**', ...f.contradictions.map((c) => `- ${c.id}: ${one(c.want)}, but then ${one(c.butThen)}`)].join('\n') };
    }
    if (o.what === 'pick') {
      const p = readJson(path.join(dir, 'pick.json'));
      if (!p) return { ok: false, errors: ['No pick yet.'] };
      return { markdown: `**${one(p.concept.name)}**: ${one(p.concept.idea)}\n\nWhat a visitor should feel: ${one(p.concept.feeling)}` };
    }
    return { ok: false, errors: ['Usage: show --what study|frame|pick'] };
  },

  asset(o) {
    const root = rootOf(o);
    const { dir } = load(root, o.session);
    if (typeof o.from !== 'string') return { ok: false, errors: ['Usage: asset --from "<path under the project>" [--as <name>]'] };
    const from = path.resolve(root, o.from);
    if (!from.startsWith(root + path.sep) || !fs.existsSync(from) || !fs.statSync(from).isFile()) return { ok: false, errors: [`${o.from} is not a file under the project`] };
    if (/[\\/]\.(env|git)\b|[\\/]kb[\\/]/i.test(from)) return { ok: false, errors: ['That file may not be copied into a page.'] };
    const name = (typeof o.as === 'string' ? o.as : path.basename(from)).replace(/[^a-z0-9._-]+/gi, '-');
    const to = path.join(dir, 'page', 'assets', name);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    return { ok: true, src: `assets/${name}` };
  },

  look(o) {
    const root = rootOf(o);
    const { dir } = load(root, o.session);
    if (typeof o.url !== 'string' || !/^https?:\/\//.test(o.url)) return { ok: false, errors: ['Usage: look --url https://…'] };
    const r = lookAt(dir, o.url);
    return { ok: !r.errors?.length || !!Object.keys(r.files ?? {}).length, ...r };
  },

  probe(o) {
    rootOf(o);
    if (typeof o.url !== 'string' || !/^https?:\/\//.test(o.url)) return { ok: false, errors: ['Usage: probe --url https://…'] };
    const browser = findBrowser();
    if (!browser) return { ok: false, errors: ['No Chrome, Edge or Chromium was found: what a page is built with cannot be measured. Say so, and read the makers\' notes instead.'] };
    try { return { ok: true, url: o.url, ...detectTech(dumpUrl(browser, o.url)), note: 'A library bundled without a trace is not seen: add what the makers\' notes or credits say.' }; } catch (err) { return { ok: false, errors: [err.message] }; }
  },

  shoot(o) {
    const root = rootOf(o);
    const { dir } = load(root, o.session);
    const r = shootPage(dir);
    return { ok: !r.errors.length, ...r };
  },

  next(o) {
    const root = rootOf(o);
    const { s, dir } = load(root, o.session);
    const waiting = turnsOf(root, dir, s).filter((t) => !t.done);
    const from = { phase: s.phase, round: s.round };
    const warnings = [];
    if (waiting.length && !o.force) return { ok: false, errors: [`${waiting.map((t) => t.name).join(', ')} ${waiting.length > 1 ? 'have' : 'has'} not finished: ${waiting.map((t) => `${t.role}: ${check(root, dir, s, t.role)[0]}`).join('; ')}. Start ${waiting.length > 1 ? 'them' : 'it'} again, or pass --force to go on without.`] };
    const errors = advance(root, dir, s, o, warnings);
    if (errors.length) return { ok: false, errors };
    if (s.phase === 'done') fs.writeFileSync(path.join(dir, 'concept.md'), handoff(s, readJson(path.join(dir, 'pick.json'))));
    s.log = [...(s.log ?? []), { from, to: { phase: s.phase, round: s.round }, at: new Date().toISOString(), forced: !!(o.force && waiting.length), left: waiting.map((t) => t.role) }];
    save(dir, s);
    return { ok: true, from: from.phase, to: s.phase, round: s.round, warnings, next: nextLine(root, dir, s) };
  },

  // The record of the session (the frame, every concept, the debate, the rulings), as a page and, with a browser, a
  // PDF. Written only when the person asks for it.
  render(o) {
    const root = rootOf(o);
    const { s, dir } = load(root, o.session);
    const html = path.join(dir, 'record.html');
    fs.writeFileSync(html, record(root, dir, s));
    const browser = findBrowser();
    if (!browser) return { ok: true, html, pdf: null, warnings: ['No browser: the record is written as HTML only.'] };
    const pdf = path.join(dir, 'record.pdf');
    try { printPdf(browser, html, pdf); return { ok: true, html, pdf }; } catch (err) { return { ok: true, html, pdf: null, warnings: [err.message] }; }
  },

  // A rule the person gave that reaches past this concept: kept in the shared knowledge bank, where every skill of the
  // plugin reads it.
  note(o) {
    const root = rootOf(o);
    if (!NOTE_KINDS.includes(o.type) || typeof o.title !== 'string' || typeof o.value !== 'string') return { ok: false, errors: [`Usage: note --type ${NOTE_KINDS.join('|')} --title "<a few words>" --value "<the person's words>" [--scope design]`] };
    const name = readJson(path.join(root, '.project-health', 'kb', 'facts.json'), { facts: [] }).facts?.find((f) => f.key === 'brand.name')?.value ?? path.basename(root);
    const r = addNote(root, { kind: o.type, title: o.title, detail: o.value, scope: typeof o.scope === 'string' ? o.scope : undefined, by: 'studio', name });
    return r.errors.length ? { ok: false, errors: r.errors } : { ok: true, id: r.note.id };
  },

  close(o) {
    const root = rootOf(o);
    const { s, dir } = load(root, o.session);
    if (s.phase !== 'done' && !o.abandon) return { ok: false, errors: [`The session is in the ${s.phase} phase. Finish it, or pass --abandon.`] };
    s.closed_at = new Date().toISOString();
    s.closedSession = true;
    if (o.abandon) s.abandoned = true;
    save(dir, s);
    disarm({ root });
    const look = readJson(path.join(dir, 'look.json'));
    const pick = readJson(path.join(dir, 'pick.json'));
    const shots = fs.existsSync(path.join(dir, 'shots')) ? fs.readdirSync(path.join(dir, 'shots')).map((f) => path.join(dir, 'shots', f)) : [];
    const rulings = Object.fromEntries(RULINGS.map((r) => [r, (pick?.rulings ?? []).filter((x) => x.ruling === r).length]));
    return {
      ok: true,
      page: fs.existsSync(path.join(dir, 'page', 'index.html')) ? path.join(dir, 'page', 'index.html') : null,
      concept: pick ? { id: pick.chosen, name: pick.concept.name, idea: pick.concept.idea } : null,
      handoff: fs.existsSync(path.join(dir, 'concept.md')) ? path.join(dir, 'concept.md') : null,
      shots,
      look: look ? { verdict: look.verdict, business: look.saw?.business, feeling: look.saw?.feeling } : null,
      revised: (s.log ?? []).some((l) => l.to?.phase === 'revise'),
      leftOut: (s.log ?? []).flatMap((l) => l.left ?? []),
      concepts: concepts(dir).length,
      rounds: s.round,
      rulings,
      studied: Object.fromEntries(Object.entries(s.study.kinds).map(([k, v]) => [k, v ? (v.from === s.id ? 'new' : `reused from ${v.from}`) : 'missing'])),
      record: 'Everything the debate said is in the session folder. "render" writes it as a document and a PDF, when the person asks.',
    };
  },
};

// ---- Entry ----

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) {
  const [cmd, ...rest] = process.argv.slice(2);
  const o = args(rest);
  if (!COMMANDS[cmd]) {
    console.log(JSON.stringify({ ok: false, errors: [`Commands: ${Object.keys(COMMANDS).join(', ')}`] }));
    process.exit(1);
  }
  try {
    const r = COMMANDS[cmd](o);
    if (r.markdown !== undefined) console.log(r.markdown);
    else console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok === false ? 1 : 0);
  } catch (err) {
    console.log(JSON.stringify({ ok: false, errors: [err.message] }));
    process.exit(1);
  }
}

export { COMMANDS };
