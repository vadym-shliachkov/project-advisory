#!/usr/bin/env node
// The design studio: from what the business is to one concept for its site, shown as one working page.
//
//   study     what the business is and what the field looks like (reused from an earlier session when fresh)
//   concepts  seats that each start from a different place propose two concepts each
//   critique  a critic who has seen the field and the visitor's voice comment on every concept, once
//   pick      the judge picks one concept and works it out in full
//   build     a builder makes one page that presents it: the new site's first screen, live, then its world and motion
//   look      someone who was told nothing looks at the pictures of the page; one revision when it asks for one
//   done      the page, its pictures and a one-page note for whoever builds the site
//
// Members write their own files into the session folder and run `done --role <role>` to have them checked. Every
// command prints JSON (Markdown for `brief` and `show`) and exits non-zero on error.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findBrowser, screenshot, lookSlug } from '../../council/scripts/lib/browser.mjs';
import { addNote, NOTE_KINDS } from '../../council/scripts/lib/notes.mjs';
import { arm, disarm } from '../../../hooks/guard.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '..');
const SCRIPT = fileURLToPath(import.meta.url);
const STEPS = path.join(SKILL, 'steps');
const SEATS = JSON.parse(fs.readFileSync(path.join(SKILL, 'references', 'seats.json'), 'utf8')).seats;
const FRESH_DAYS = 30;

// The hosts a concept page may load from: fonts, and the usual script CDNs for animation libraries. The SVG and
// XHTML namespaces are names, not requests.
export const HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'fonts.bunny.net', 'api.fontshare.com', 'cdn.fontshare.com', 'cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'www.w3.org'];
export const SHOTS = { desktop: [1440, 900], 'desktop-long': [1440, 6000], phone: [390, 844], 'phone-long': [390, 5000] };
const MIN_WINDOW = 500;

// ---- Small helpers ----

const readJson = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJson = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`); };
const today = () => new Date().toISOString().slice(0, 10);
const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const q = (s) => `"${s}"`;

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
  return { s, dir };
}
const save = (dir, s) => writeJson(sessionFile(dir), s);

// ---- Reusing research ----

const ageDays = (file) => (Date.now() - fs.statSync(file).mtimeMs) / 86400e3;

// The newest earlier session whose study is fresh: one of this version (study/business.md, study/field.md) or of the
// earlier version (study-shown.md, which holds the anatomy and the field, with currents.json and slop.json beside it).
export function findReusable(root, exclude, wanted) {
  for (const id of sessions(root)) {
    if (id === exclude || (wanted && wanted !== 'latest' && id !== wanted)) continue;
    const dir = path.join(studioDir(root), id);
    const rel = (f) => path.relative(root, path.join(dir, f));
    const has = (f) => fs.existsSync(path.join(dir, f)) && ageDays(path.join(dir, f)) <= FRESH_DAYS;
    const looks = ['study/looks', 'looks'].find((f) => fs.existsSync(path.join(dir, f)));
    if (has('study/business.md') && has('study/field.md')) {
      return { from: id, business: [rel('study/business.md'), ...(has('study/corrections.md') ? [rel('study/corrections.md')] : [])], field: [rel('study/field.md')], looks: looks ? rel(looks) : null };
    }
    if (has('study-shown.md')) {
      return { from: id, business: [rel('study-shown.md')], field: [rel('study-shown.md'), ...['currents.json', 'slop.json'].filter(has).map(rel)], looks: looks ? rel(looks) : null };
    }
  }
  return null;
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

// ---- Turns ----

const OUT = {
  business: 'study/business.md',
  field: 'study/field.md',
  critic: 'critique/critic.json',
  visitor: 'critique/visitor.json',
  judge: 'pick.json',
  builder: 'page/index.html',
  eye: 'look.json',
};
const outOf = (role) => OUT[role] ?? `concepts/${role}.json`;

const MODELS = { business: 'standard', field: 'standard', critic: 'standard', visitor: 'standard', judge: 'strongest', builder: 'strongest', eye: 'standard' };
const TITLES = { business: 'the business scout', field: 'the field scout', critic: 'the critic', visitor: 'the visitor\'s voice', judge: 'the judge', builder: 'the builder', eye: 'the stranger\'s eye' };

function rolesOf(s) {
  switch (s.phase) {
    case 'study': return [...(s.study.business.length ? [] : ['business']), ...(s.study.field.length ? [] : ['field'])];
    case 'concepts': return SEATS.map((x) => x.role);
    case 'critique': return ['critic', 'visitor'];
    case 'pick': return ['judge'];
    case 'build': case 'revise': return ['builder'];
    case 'look': return ['eye'];
    default: return [];
  }
}

function turnsOf(root, dir, s) {
  return rolesOf(s).map((role) => {
    const seat = SEATS.find((x) => x.role === role);
    const errors = check(root, dir, s, role);
    return {
      role,
      name: seat ? `the seat "${seat.title}"` : TITLES[role],
      model: seat?.model ?? MODELS[role],
      done: errors.length === 0,
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

export function conceptErrors(c, at) {
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
  return e;
}

const FLAGS = ['copy', 'template', 'collection', 'type-only', 'no-feeling', 'not-this-business', 'gets-in-the-way', 'cannot-build', 'cannot-feed'];
const conceptIds = (dir) => (readJson(path.join(dir, 'concepts.json'), { concepts: [] }).concepts ?? []).map((c) => c.id);

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

export function check(root, dir, s, role) {
  const file = path.join(dir, outOf(role));
  if (!fs.existsSync(file)) return [`${outOf(role)} has not been written`];
  if (role === 'business' || role === 'field') {
    const n = fs.readFileSync(file, 'utf8').length;
    return n < 1500 ? [`${outOf(role)} is too short to design from (${n} characters)`] : n > 30000 ? [`${outOf(role)} is over 30,000 characters: the seats must read it; keep what a designer needs`] : [];
  }
  if (role === 'builder') {
    const e = pageErrors(dir);
    if (!e.length && s.phase === 'revise' && fs.statSync(file).mtimeMs <= fs.statSync(path.join(dir, OUT.eye)).mtimeMs) e.push('the page has not been revised since the look');
    return e;
  }
  const data = readJson(file);
  if (!data) return [`${outOf(role)} is not valid JSON`];
  const e = [];
  if (SEATS.some((x) => x.role === role)) {
    if (!Array.isArray(data.concepts) || data.concepts.length < 1 || data.concepts.length > 3) return ['concepts: one to three concepts (two are asked for)'];
    data.concepts.forEach((c, i) => e.push(...conceptErrors(c, `concepts[${i}]`)));
    return e;
  }
  if (role === 'critic' || role === 'visitor') {
    const ids = conceptIds(dir);
    if (!Array.isArray(data.notes)) return ['notes: one entry per concept'];
    for (const id of ids) if (!data.notes.some((n) => n.concept === id)) e.push(`notes: nothing on ${id}; every concept gets a note`);
    data.notes.forEach((n, i) => {
      len(n.says, 40, 700, `notes[${i}].says`, e);
      len(n.strongest, 10, 300, `notes[${i}].strongest`, e);
      for (const f of n.flags ?? []) if (!FLAGS.includes(f)) e.push(`notes[${i}].flags: ${f} is not one of ${FLAGS.join(', ')}`);
    });
    return e;
  }
  if (role === 'judge') {
    const ids = conceptIds(dir);
    if (!ids.includes(data.chosen)) e.push(`chosen: one of ${ids.join(', ')}`);
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
    const others = ids.filter((id) => id !== data.chosen);
    for (const id of others) if (!(data.others ?? []).some((o) => o.concept === id && one(o.why).length >= 20)) e.push(`others: a line on ${id}, why it was not chosen`);
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

// ---- The brief a member reads ----

function brief(root, dir, s, role) {
  const seat = SEATS.find((x) => x.role === role);
  const step = seat ? 'seat' : role;
  const abs = (rel) => path.resolve(root, rel);
  const out = [fs.readFileSync(path.join(STEPS, `${step}.md`), 'utf8').trim(), '', '## Your material', ''];
  out.push(`- The session folder: ${dir}`);
  if (s.url) out.push(`- The live site: ${s.url}`);
  out.push(`- The project's files: ${root} (read; never change anything outside the session folder)`);
  if (s.goal) out.push(`- The person's goal for this session: ${one(s.goal)}`);
  if (s.focus) out.push(`- The part of the site the person wants looked at first: ${one(s.focus)}`);
  if (!['business', 'field'].includes(role)) {
    out.push(`- What the studio understood about the business: ${s.study.business.map(abs).join(', ')}`);
    out.push(`- What the field looks like (what wins awards now, what a template site looks like): ${s.study.field.map(abs).join(', ')}`);
    const corr = path.join(dir, 'study', 'corrections.md');
    if (fs.existsSync(corr)) out.push(`- What the person corrected in the study (this overrides it): ${corr}`);
  }
  if (['critic', 'builder', 'eye', 'field'].includes(role) && s.study.looks) out.push(`- Pictures of honoured, rival and template sites: ${abs(s.study.looks)}`);
  if (seat) out.push('', `**Your starting place: ${seat.title}.** ${seat.start}`);
  if (['critic', 'visitor', 'judge'].includes(role)) out.push(`- The concepts: ${path.join(dir, 'concepts.json')}`);
  if (role === 'judge') out.push(`- What the critic and the visitor's voice said: ${path.join(dir, 'critique')}`);
  if (['builder', 'eye'].includes(role)) out.push(`- The concept: ${path.join(dir, 'pick.json')}`);
  if (role === 'builder' && s.phase === 'revise') out.push(`- **What the stranger saw, and what to change**: ${path.join(dir, OUT.eye)}. Revise the page you made (it is in page/): change what the look asks, within the concept.`);
  if (role === 'eye') out.push(`- The pictures of the page: ${path.join(dir, 'shots')}. The page itself: ${path.join(dir, 'page', 'index.html')}`);
  const says = personSays(root);
  out.push('', '## What the person said (respect every line)', '', ...(says.length ? says : ['- Nothing yet.']));
  out.push('', '## Saving', '');
  out.push(`Write **${path.join(dir, outOf(role))}** with the Write tool${role === 'builder' ? ' (and any files it needs in page/)' : ''}. Then run:`, '', `    node ${q(SCRIPT)} done --root ${q(root)} --session ${s.id} --role ${role}`, '', 'It checks what you wrote and says what to fix. Fix it and run it again until it says ok. Then reply with one line: what you saved, or what failed.');
  if (role === 'builder' || role === 'field') {
    out.push('', 'Commands you may run:', '');
    if (role === 'builder') {
      out.push(`- Copy a picture, a font or another file of the project into page/assets/: node ${q(SCRIPT)} asset --root ${q(root)} --session ${s.id} --from "<path under the project>" [--as <name>]`);
      out.push(`- Photograph the page as it is now (desktop, long, phone), to look at your own work: node ${q(SCRIPT)} shoot --root ${q(root)} --session ${s.id}`);
    }
    out.push(`- Photograph a live page: node ${q(SCRIPT)} look --root ${q(root)} --session ${s.id} --url <https://…>`);
  }
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
  for (const [name, size] of [['desktop', [1440, 900]], ['desktop-long', [1440, 3600]], ['phone', [390, 844]]]) {
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

// ---- Commands ----

function nextLine(root, dir, s) {
  const turns = turnsOf(root, dir, s);
  const waiting = turns.filter((t) => !t.done);
  const start = waiting.length ? `Start, all at once: ${waiting.map((t) => t.name).join(', ')}. Then run "next".` : 'Everyone has done their turn: run "next".';
  switch (s.phase) {
    case 'study':
      if (!waiting.length && !s.study.shown) return s.study.from ? `The study is reused from session ${s.study.from}. Tell the person in one line, ask if anything about the business has changed (save it with "correct"), then run "next".` : 'The study is done. Show the person "show --what study", save each correction with "correct", then run "next".';
      return start;
    case 'concepts': return `Concepts: ${start}`;
    case 'critique': return `Critique, one round: ${start}`;
    case 'pick': return `The judge picks one concept: ${start}`;
    case 'build': return `The page: ${start}`;
    case 'look': return `A stranger looks at the pictures of the page: ${start}`;
    case 'revise': return `The builder revises the page once, from the look: ${start}`;
    case 'done': return 'Done. Run "close" for the result.';
    default: return '';
  }
}

const COMMANDS = {
  init(o) {
    const root = path.resolve(o.root ?? process.cwd());
    let id = today();
    for (let n = 2; fs.existsSync(path.join(studioDir(root), id)); n++) id = `${today()}-${n}`;
    const open = sessions(root).map((x) => ({ x, s: readJson(sessionFile(path.join(studioDir(root), x))) })).find((r) => r.s && r.s.phase !== 'done' && !r.s.closed);
    if (open && !o.new) return { ok: false, errors: [`Session ${open.x} is not finished (phase ${open.s.phase}). Ask the person whether to continue it (pass --session ${open.x} to the other commands) or start anew (init --new).`] };
    const reuse = o.reuse === 'none' ? null : findReusable(root, id, typeof o.reuse === 'string' ? o.reuse : 'latest');
    const dir = path.join(studioDir(root), id);
    fs.mkdirSync(path.join(dir, 'study'), { recursive: true });
    const s = {
      id, version: 2, createdAt: new Date().toISOString(), phase: 'study',
      url: typeof o.url === 'string' ? o.url : null, goal: typeof o.goal === 'string' ? o.goal : null, focus: typeof o.focus === 'string' ? o.focus : null,
      study: reuse ? { ...reuse, shown: false } : { from: null, business: [], field: [], looks: null, shown: false },
    };
    if (!s.url) {
      const prev = reuse && readJson(path.join(studioDir(root), reuse.from, 'session.json'));
      if (prev?.url) s.url = prev.url;
    }
    if (!reuse) s.study.looks = path.relative(root, path.join(dir, 'study', 'looks'));
    save(dir, s);
    arm({ root, skill: 'studio' });
    const browser = !!findBrowser();
    return { ok: true, session: id, dir, reused: reuse ? { from: reuse.from, files: [...new Set([...reuse.business, ...reuse.field])] } : null, url: s.url, browser, warnings: browser ? [] : ['No Chrome, Edge or Chromium was found: the page will be built but not photographed, and nobody will look at it as a stranger. Tell the person before anything is spent.'] };
  },

  status(o) {
    const root = path.resolve(o.root ?? process.cwd());
    const { s, dir } = load(root, o.session);
    return { ok: true, session: s.id, dir, phase: s.phase, next: nextLine(root, dir, s), turns: turnsOf(root, dir, s) };
  },

  brief(o) {
    const root = path.resolve(o.root ?? process.cwd());
    const { s, dir } = load(root, o.session);
    if (!rolesOf(s).includes(o.role)) return { ok: false, errors: [`${o.role} has no turn in the ${s.phase} phase.`] };
    return { markdown: brief(root, dir, s, o.role) };
  },

  done(o) {
    const root = path.resolve(o.root ?? process.cwd());
    const { s, dir } = load(root, o.session);
    const errors = check(root, dir, s, o.role);
    return errors.length ? { ok: false, errors } : { ok: true };
  },

  correct(o) {
    const root = path.resolve(o.root ?? process.cwd());
    const { s, dir } = load(root, o.session);
    if (typeof o.text !== 'string') return { ok: false, errors: ['Usage: correct --text "<the person\'s words>"'] };
    fs.appendFileSync(path.join(dir, 'study', 'corrections.md'), `- ${one(o.text)}\n`);
    return { ok: true };
  },

  show(o) {
    const root = path.resolve(o.root ?? process.cwd());
    const { s, dir } = load(root, o.session);
    if (o.what === 'study') return { markdown: s.study.business.map((f) => fs.readFileSync(path.resolve(root, f), 'utf8')).join('\n\n') };
    if (o.what === 'pick') {
      const p = readJson(path.join(dir, OUT.judge));
      if (!p) return { ok: false, errors: ['No pick yet.'] };
      return { markdown: `**${one(p.concept.name)}**: ${one(p.concept.idea)}\n\nWhat a visitor should feel: ${one(p.concept.feeling)}` };
    }
    return { ok: false, errors: ['Usage: show --what study|pick'] };
  },

  asset(o) {
    const root = path.resolve(o.root ?? process.cwd());
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
    const root = path.resolve(o.root ?? process.cwd());
    const { dir } = load(root, o.session);
    if (typeof o.url !== 'string' || !/^https?:\/\//.test(o.url)) return { ok: false, errors: ['Usage: look --url https://…'] };
    const r = lookAt(dir, o.url);
    return { ok: !r.errors?.length || !!Object.keys(r.files ?? {}).length, ...r };
  },

  shoot(o) {
    const root = path.resolve(o.root ?? process.cwd());
    const { dir } = load(root, o.session);
    const r = shootPage(dir);
    return { ok: !r.errors.length, ...r };
  },

  next(o) {
    const root = path.resolve(o.root ?? process.cwd());
    const { s, dir } = load(root, o.session);
    const turns = turnsOf(root, dir, s);
    const waiting = turns.filter((t) => !t.done);
    const from = s.phase;
    const warnings = [];
    if (waiting.length && !o.force) return { ok: false, errors: [`${waiting.map((t) => t.name).join(', ')} ${waiting.length > 1 ? 'have' : 'has'} not finished: ${waiting.map((t) => `${t.role}: ${check(root, dir, s, t.role)[0]}`).join('; ')}. Start ${waiting.length > 1 ? 'them' : 'it'} again, or pass --force to go on without.`] };
    switch (s.phase) {
      case 'study': {
        const rel = (f) => path.relative(root, path.join(dir, f));
        if (!s.study.business.length) { if (check(root, dir, s, 'business').length) return { ok: false, errors: ['There is no study of the business: the studio cannot design without one.'] }; s.study.business = [rel(OUT.business)]; }
        if (!s.study.field.length && !check(root, dir, s, 'field').length) s.study.field = [rel(OUT.field)];
        if (!s.study.field.length) warnings.push('No study of the field: the critic cannot tell a copy or a template from a fresh idea.');
        s.study.shown = true;
        s.phase = 'concepts';
        break;
      }
      case 'concepts': {
        const all = [];
        for (const seat of SEATS) {
          if (check(root, dir, s, seat.role).length) { warnings.push(`${seat.title} left out: it did not finish.`); continue; }
          for (const c of readJson(path.join(dir, outOf(seat.role))).concepts) all.push({ id: `C${all.length + 1}`, seat: seat.role, ...c });
        }
        if (all.length < 3) return { ok: false, errors: ['Fewer than three concepts: start the seats that did not finish.'] };
        // The critics and the judge see the concepts without the seat that proposed them.
        writeJson(path.join(dir, 'concepts.json'), { concepts: all.map(({ seat, ...c }) => c) });
        writeJson(path.join(dir, 'concepts-by-seat.json'), { seats: all.map((c) => ({ id: c.id, seat: c.seat })) });
        s.phase = 'critique';
        break;
      }
      case 'critique':
        if (['critic', 'visitor'].every((r) => check(root, dir, s, r).length)) return { ok: false, errors: ['Nobody has commented on the concepts: start the critic and the visitor\'s voice.'] };
        s.phase = 'pick';
        break;
      case 'pick':
        if (check(root, dir, s, 'judge').length) return { ok: false, errors: ['The judge has not picked: start the judge again. A concept cannot be built without its pick.'] };
        s.phase = 'build';
        break;
      case 'build':
      case 'revise': {
        if (check(root, dir, s, 'builder').length) return { ok: false, errors: ['There is no page that passes its check: start the builder again.'] };
        const shots = shootPage(dir);
        if (shots.errors.length) warnings.push(...shots.errors);
        if (s.phase === 'revise' || !Object.keys(shots.files ?? {}).length) {
          if (s.phase === 'build') warnings.push('The page could not be photographed, so nobody looked at it as a stranger.');
          s.phase = 'done';
        } else s.phase = 'look';
        break;
      }
      case 'look': {
        const look = readJson(path.join(dir, OUT.eye));
        s.phase = look?.verdict === 'revise' ? 'revise' : 'done';
        break;
      }
      default: return { ok: false, errors: [`Nothing comes after ${s.phase}: run "close".`] };
    }
    if (s.phase === 'done') fs.writeFileSync(path.join(dir, 'concept.md'), handoff(s, readJson(path.join(dir, OUT.judge))));
    s.log = [...(s.log ?? []), { from, to: s.phase, at: new Date().toISOString(), forced: !!(o.force && waiting.length), left: waiting.map((t) => t.role) }];
    save(dir, s);
    return { ok: true, from, to: s.phase, warnings, next: nextLine(root, dir, s) };
  },

  // A rule the person gave that reaches past this concept: kept in the shared knowledge bank, where every skill of the
  // plugin reads it.
  note(o) {
    const root = path.resolve(o.root ?? process.cwd());
    if (!NOTE_KINDS.includes(o.type) || typeof o.title !== 'string' || typeof o.value !== 'string') return { ok: false, errors: [`Usage: note --type ${NOTE_KINDS.join('|')} --title "<a few words>" --value "<the person's words>" [--scope design]`] };
    const name = readJson(path.join(root, '.project-health', 'kb', 'facts.json'), { facts: [] }).facts?.find((f) => f.key === 'brand.name')?.value ?? path.basename(root);
    const r = addNote(root, { kind: o.type, title: o.title, detail: o.value, scope: typeof o.scope === 'string' ? o.scope : undefined, by: 'studio', name });
    return r.errors.length ? { ok: false, errors: r.errors } : { ok: true, id: r.note.id };
  },

  close(o) {
    const root = path.resolve(o.root ?? process.cwd());
    const { s, dir } = load(root, o.session);
    if (s.phase !== 'done' && !o.abandon) return { ok: false, errors: [`The session is in the ${s.phase} phase. Finish it, or pass --abandon.`] };
    s.closed = new Date().toISOString();
    if (o.abandon) s.abandoned = true;
    save(dir, s);
    disarm({ root });
    const look = readJson(path.join(dir, OUT.eye));
    const pick = readJson(path.join(dir, OUT.judge));
    const shots = fs.existsSync(path.join(dir, 'shots')) ? fs.readdirSync(path.join(dir, 'shots')).map((f) => path.join(dir, 'shots', f)) : [];
    return {
      ok: true,
      page: fs.existsSync(path.join(dir, 'page', 'index.html')) ? path.join(dir, 'page', 'index.html') : null,
      concept: pick ? { name: pick.concept.name, idea: pick.concept.idea } : null,
      handoff: fs.existsSync(path.join(dir, 'concept.md')) ? path.join(dir, 'concept.md') : null,
      shots,
      look: look ? { verdict: look.verdict, business: look.saw?.business, feeling: look.saw?.feeling } : null,
      revised: (s.log ?? []).some((l) => l.to === 'revise'),
      leftOut: (s.log ?? []).flatMap((l) => l.left ?? []),
      concepts: readJson(path.join(dir, 'concepts.json'), { concepts: [] }).concepts.length,
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
