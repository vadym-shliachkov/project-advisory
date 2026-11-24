import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJson, writeJson } from './io.mjs';
import { screenshot, VIEWS } from './browser.mjs';
import { MADE_WORDS, SIGNATURE_WORDS, SIGNATURE_RULING_WORDS, SWAP_WORDS } from './direction.mjs';

// A tile of each direction that survived: one small working page with the real type, the colours, the first screen
// and the signature moment in motion, so the direction is seen and not only described. It is a tile, not a site: it
// shows whether the idea holds, and it is the only place a reader can check that a direction is not generic.
//
// A tile is written by an agent and opened by the person from disk, with its scripts running, so it is never trusted:
// it is one file, it may load type from a short list of font hosts and nothing else, and the script that saves it adds
// a rule to the page (a content security policy) under which the browser refuses every other request. It carries no
// form, no frame, no link out and no outside script, and it must answer a visitor who asked for less motion.
//
// With each tile come its tokens: the colours, the type and the movement as values, and the rules of the direction.
// They are written into the handoff file, so whoever builds the site, person or assistant, starts from the direction
// and not from their own defaults.

export const tilesPath = (dir) => path.join(dir, 'tiles.json');
export const loadTiles = (dir) => readJson(tilesPath(dir), null);
export const saveTiles = (dir, data) => writeJson(tilesPath(dir), data);
export const tileFile = (id) => `tiles/${id}.html`;
export const tilePicture = (id, view) => `tiles/${id}-${view}.png`;
export const TILE_VIEWS = ['desktop', 'narrow'];
export const handoffFile = (id) => `handoff/${id}.md`;
// A page handed in on its own, before the record of the tiles names it (see the tile command).
export const draftFile = (id) => `tiles/draft/${id}.html`;
export const loadDraft = (dir, id) => { try { return fs.readFileSync(path.join(dir, draftFile(id)), 'utf8'); } catch { return null; } };
export function saveDraft(dir, id, html) { const file = path.join(dir, draftFile(id)); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, html); return file; }

const HTML_MIN = 800;
const HTML_MAX = 160000;
const STYLE_HOSTS = ['fonts.googleapis.com', 'fonts.bunny.net', 'api.fontshare.com'];
const FONT_HOSTS = ['fonts.gstatic.com', 'fonts.bunny.net', 'cdn.fontshare.com'];
const NAMESPACES = ['www.w3.org'];
// The browser enforces this, whatever the page's own code tries.
export const TILE_POLICY = `default-src 'none'; style-src 'unsafe-inline' ${STYLE_HOSTS.map((h) => `https://${h}`).join(' ')}; font-src data: ${FONT_HOSTS.map((h) => `https://${h}`).join(' ')}; img-src data:; media-src data:; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`;
const FORBIDDEN = [
  [/<script\b[^>]*\bsrc\s*=/i, 'a script loaded from a file or an address: the tile carries its own script, inline'],
  [/<(?:iframe|object|embed|frame|frameset|portal)\b/i, 'a frame or an embedded page'],
  [/<form\b/i, 'a form: a tile collects nothing'],
  [/<base\b/i, 'a <base> element'],
  [/<meta\b[^>]*http-equiv/i, 'a <meta http-equiv>: the script adds the page\'s own rule'],
  [/<link\b(?![^>]*\brel\s*=\s*["']?(?:stylesheet|preconnect)\b)/i, 'a <link> that is not a stylesheet of a font host'],
  [/\b(?:fetch|importScripts)\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\bsendBeacon\b|\bserviceWorker\b|\bRTCPeerConnection\b/, 'a request to somewhere: a tile loads its type and nothing else'],
  [/\bwindow\.open\s*\(|\b(?:window|document|self|top|parent)\.location\b|(?<![\w.$])location\.(?:href|assign|replace|reload)\b|\bdocument\.cookie\b/, 'a script that leaves the page or reads cookies'],
  [/\bimport\s*\(|<script\b[^>]*\btype\s*=\s*["']?(?:module|importmap)/i, 'a script module or an import: the tile is one file'],
];

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
function textError(value, at, min, max) {
  if (typeof value !== 'string') return [`${at}: text is required`];
  const t = one(value);
  if (t.length < min) return [`${at}: at least ${min} characters are required`];
  if (t.length > max) return [`${at}: at most ${max} characters (it has ${t.length})`];
  return [];
}
const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase(); } catch { return null; } };

// Checks one tile and returns it with the page's rule added, or the reasons it is refused.
export function cleanTile(input, at = '$.html') {
  const src = String(input ?? '').trim();
  const errors = [];
  if (src.length < HTML_MIN) return { errors: [`${at}: the tile, as one whole HTML page starting with <!doctype html> (at least ${HTML_MIN} characters; it has ${src.length})`] };
  if (src.length > HTML_MAX) return { errors: [`${at}: at most ${HTML_MAX} characters (it has ${src.length}): a tile is one screen and one moment, not a site`] };
  if (!/^<!doctype html>/i.test(src)) errors.push(`${at}: it starts with <!doctype html>`);
  if (!/<head\b[^>]*>/i.test(src) || !/<\/html>\s*$/i.test(src)) errors.push(`${at}: one whole page: <html>, a <head>, a <body>, closed`);
  if (!/<meta\b[^>]*name\s*=\s*["']?viewport/i.test(src)) errors.push(`${at}: a <meta name="viewport" content="width=device-width, initial-scale=1">, so it can be looked at on a narrow screen`);
  if (!/prefers-reduced-motion/i.test(src)) errors.push(`${at}: it must answer a visitor who asked for less motion (a "prefers-reduced-motion" rule that stills or shortens what moves)`);
  for (const [re, what] of FORBIDDEN) if (re.test(src)) errors.push(`${at}: ${what} is not allowed in a tile`);
  const allowed = new Set([...STYLE_HOSTS, ...FONT_HOSTS, ...NAMESPACES]);
  const away = [...new Set([...src.matchAll(/https?:\/\/[^\s"'()<>\\]+/gi)].map((m) => m[0]).filter((u) => !allowed.has(hostOf(u))))];
  if (away.length) errors.push(`${at}: ${away.slice(0, 3).join(', ')}${away.length > 3 ? ` and ${away.length - 3} more` : ''}: a tile names no address but those of its fonts (${STYLE_HOSTS.join(', ')}). Draw pictures as inline SVG or CSS, and show a photograph the business has not supplied yet as a labelled empty frame`);
  if (/(?:src|href|poster)\s*=\s*["'](?!#|data:|https:\/\/)[^"']+["']/i.test(src) || /url\(\s*["']?(?!data:|https:\/\/|#)[^)"']+/i.test(src)) errors.push(`${at}: a file beside the page is named (src, href or url()): the tile is one file, and what it shows is inside it`);
  if (errors.length) return { errors };
  const rule = `<meta http-equiv="Content-Security-Policy" content="${TILE_POLICY}">`;
  return { html: src.replace(/<head\b[^>]*>/i, (head) => `${head}\n${rule}`) };
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
function tokenErrors(t, at) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return [`${at}: the values the tile uses, as { "colours", "type", "motion", "rules" }`];
  const errors = [];
  if (!Array.isArray(t.colours) || t.colours.length < 2 || t.colours.length > 8) errors.push(`${at}.colours: two to eight colours, each { "name", "value": "#1a1a1a", "use" }`);
  else t.colours.forEach((c, i) => {
    errors.push(...textError(c?.name, `${at}.colours[${i}].name`, 2, 40), ...textError(c?.use, `${at}.colours[${i}].use`, 5, 160));
    if (!HEX.test(one(c?.value))) errors.push(`${at}.colours[${i}].value: a hex colour such as #1a1a1a`);
  });
  if (!Array.isArray(t.type) || t.type.length < 1 || t.type.length > 4) errors.push(`${at}.type: one to four typefaces, each { "role", "family", "source", "use" }`);
  else t.type.forEach((f, i) => errors.push(...textError(f?.role, `${at}.type[${i}].role`, 3, 40), ...textError(f?.family, `${at}.type[${i}].family`, 2, 80), ...textError(f?.source, `${at}.type[${i}].source`, 3, 120).map((e) => `${e} (where the typeface comes from: a font host, a foundry, or "on the visitor's device")`), ...textError(f?.use, `${at}.type[${i}].use`, 5, 200)));
  if (t.motion !== undefined) {
    if (!Array.isArray(t.motion) || t.motion.length > 6) errors.push(`${at}.motion: up to six movements, each { "name", "duration", "easing", "use" }; [] when nothing moves`);
    else t.motion.forEach((m, i) => errors.push(...textError(m?.name, `${at}.motion[${i}].name`, 2, 40), ...textError(m?.duration, `${at}.motion[${i}].duration`, 2, 40), ...textError(m?.easing, `${at}.motion[${i}].easing`, 2, 80), ...textError(m?.use, `${at}.motion[${i}].use`, 5, 200)));
  }
  if (!Array.isArray(t.rules) || t.rules.length < 3 || t.rules.length > 10) errors.push(`${at}.rules: three to ten rules of the direction for whoever builds the site, each one line ("Type is never set on a photograph")`);
  else t.rules.forEach((r, i) => errors.push(...textError(r, `${at}.rules[${i}]`, 10, 200)));
  for (const key of Object.keys(t)) if (!['colours', 'type', 'motion', 'rules'].includes(key)) errors.push(`${at}: unknown property "${key}"`);
  return errors;
}
const cleanTokens = (t) => ({
  colours: t.colours.map((c) => ({ name: one(c.name), value: one(c.value).toLowerCase(), use: one(c.use) })),
  type: t.type.map((f) => ({ role: one(f.role), family: one(f.family), source: one(f.source), use: one(f.use) })),
  motion: (t.motion ?? []).map((m) => ({ name: one(m.name), duration: one(m.duration), easing: one(m.easing), use: one(m.use) })),
  rules: t.rules.map(one),
});

// The tiles the prototyper hands in: one for every survivor. Returns what to keep (the pages, and the record of them).
// A page comes with its tile ("html"), or was handed in before on its own (`draft` gives it): a page is code, and code
// inside a JSON string inside a shell is escaped three times over, which is where it gets broken.
export function validateTiles(data, { survivors, draft = () => null }) {
  const errors = [];
  const list = Array.isArray(data?.tiles) ? data.tiles : null;
  if (!list) return { errors: ['$.tiles: an array, one tile for each direction that survived'] };
  const ids = new Map(survivors.map((s) => [s.id, s]));
  const seen = new Set();
  const tiles = [];
  const pages = [];
  list.forEach((k, i) => {
    const at = `$.tiles[${i}]`;
    if (!ids.has(k?.idea)) { errors.push(`${at}.idea: "${k?.idea ?? ''}" is not a direction that survived; they are ${[...ids.keys()].join(', ') || 'none'}`); return; }
    if (seen.has(k.idea)) { errors.push(`${at}.idea: ${k.idea} has two tiles`); return; }
    seen.add(k.idea);
    errors.push(...textError(k.caption, `${at}.caption`, 20, 240).map((e) => `${e} (what the tile shows, and what moves in it)`));
    errors.push(...textError(k.shows, `${at}.shows`, 20, 400).map((e) => `${e} (how to see the signature moment: what to do on the page, or that it plays by itself)`));
    errors.push(...tokenErrors(k.tokens, `${at}.tokens`));
    const source = k.html ?? draft(k.idea);
    const { html, errors: pageErrors } = source === null || source === undefined
      ? { errors: [`${at}: ${k.idea} has no page: hand it in with the tile command first (see "Handing in a page"), or send it here as "html"`] }
      : cleanTile(source, k.html === undefined ? `the page handed in for ${k.idea}` : `${at}.html`);
    errors.push(...(pageErrors ?? []));
    for (const key of Object.keys(k)) if (!['idea', 'caption', 'shows', 'html', 'tokens'].includes(key)) errors.push(`${at}: unknown property "${key}"`);
    if (html && !errors.length) { tiles.push({ idea: k.idea, caption: one(k.caption), shows: one(k.shows), file: tileFile(k.idea), tokens: cleanTokens(k.tokens) }); pages.push({ idea: k.idea, html }); }
  });
  for (const id of ids.keys()) if (!seen.has(id)) errors.push(`$.tiles: ${id} "${ids.get(id).title}" has no tile: every direction that survived is built as a tile`);
  return errors.length ? { errors } : { errors: [], tiles, pages };
}

export function writeTiles(dir, tiles, pages) {
  fs.mkdirSync(path.join(dir, 'tiles'), { recursive: true });
  for (const p of pages) fs.writeFileSync(path.join(dir, tileFile(p.idea)), p.html);
  saveTiles(dir, { tiles, savedAt: new Date().toISOString() });
}

// A picture of every tile on a desktop and on a narrow screen, for the documents and for the stranger who looks at
// them. A picture older than its tile is taken again.
export function shootTiles(dir, tiles, browser, { shoot = screenshot } = {}) {
  const warnings = [];
  let taken = 0;
  if (!browser) return { taken, warnings: tiles.length ? ['No Chrome, Edge or Chromium was found, so the tiles were not photographed: the documents link each tile instead, and nobody looked at them as a stranger would. Open them yourself.'] : [] };
  for (const t of tiles) {
    const page = path.join(dir, t.file);
    if (!fs.existsSync(page)) continue;
    for (const view of TILE_VIEWS) {
      const file = path.join(dir, tilePicture(t.idea, view));
      if (fs.existsSync(file) && fs.statSync(file).mtimeMs >= fs.statSync(page).mtimeMs) { taken += 1; continue; }
      try { shoot(browser, pathToFileURL(page).href, file, VIEWS[view]); taken += 1; } catch (e) { warnings.push(`${t.idea}, ${view}: no picture of the tile (${String(e.message).trim().slice(0, 160)})`); }
    }
  }
  return { taken, warnings };
}
export const picturesOfTile = (dir, id) => Object.fromEntries(TILE_VIEWS.map((v) => [v, fs.existsSync(path.join(dir, tilePicture(id, v))) ? tilePicture(id, v) : null]));

// ---- The stranger's look ----

// Someone who was told nothing looks at the pictures of each tile: what business they think it is for, whether it
// would fit a rival, what it reminds them of, which tells of a template they see. Their word is printed beside the
// tile, and a tile they could not place goes back to the prototyper once.
const SEVERITIES = ['high', 'medium', 'low'];
export function validateEye(review, { tiles }) {
  const errors = [];
  if (!review || typeof review !== 'object' || Array.isArray(review)) return ['The result must be a JSON object'];
  errors.push(...textError(review.verdict, '$.verdict', 10, 400));
  const list = Array.isArray(review.tiles) ? review.tiles : null;
  if (!list) return [...errors, '$.tiles: one entry for each tile you looked at'];
  const ids = new Set(tiles.map((t) => t.idea));
  const seen = new Set();
  list.forEach((t, i) => {
    const at = `$.tiles[${i}]`;
    if (!ids.has(t?.idea)) { errors.push(`${at}.idea: "${t?.idea ?? ''}" is not a tile; they are ${[...ids].join(', ')}`); return; }
    if (seen.has(t.idea)) { errors.push(`${at}.idea: ${t.idea} appears twice`); return; }
    seen.add(t.idea);
    errors.push(...textError(t.guess, `${at}.guess`, 10, 240).map((e) => `${e} (what kind of business you take it to be for, and what tells you)`));
    if (!['own', 'sector', 'anyone'].includes(t.swap)) errors.push(`${at}.swap: own (with another business's name on it, it would be wrong), sector (it would fit any business of this kind) or anyone (it would fit almost any business)`);
    errors.push(...textError(t.remindsOf, `${at}.remindsOf`, 4, 300).map((e) => `${e} (the site, the template or the style it brings to mind, or "nothing I can name")`));
    if (!Array.isArray(t.tells) || t.tells.length > 8) errors.push(`${at}.tells: up to eight things in it that read as a template or as machine-made; [] when you see none`);
    else t.tells.forEach((x, j) => errors.push(...textError(x, `${at}.tells[${j}]`, 5, 200)));
    errors.push(...textError(t.works, `${at}.works`, 10, 300).map((e) => `${e} (the one thing in it that is its own)`));
    if (!Array.isArray(t.issues)) errors.push(`${at}.issues: an array (empty when there is nothing to change)`);
    else t.issues.forEach((x, j) => {
      if (!SEVERITIES.includes(x?.severity)) errors.push(`${at}.issues[${j}].severity: high, medium or low`);
      errors.push(...textError(x?.what, `${at}.issues[${j}].what`, 10, 400));
    });
    for (const key of Object.keys(t)) if (!['idea', 'guess', 'swap', 'remindsOf', 'tells', 'works', 'issues'].includes(key)) errors.push(`${at}: unknown property "${key}"`);
  });
  for (const id of ids) if (!seen.has(id)) errors.push(`$.tiles: ${id} was not looked at: every tile is`);
  return errors;
}
// A tile goes back to the prototyper when the stranger could not tell it from any business's, or found something grave.
export const eyeAsks = (review) => (review?.tiles ?? []).filter((t) => t.swap !== 'own' || t.issues.some((x) => x.severity === 'high')).map((t) => t.idea);

// ---- The handoff ----

const bullets = (items) => items.map((x) => `- ${one(x)}`);

// One file per direction that survived, for whoever builds the site: a person, or an assistant that would otherwise
// fall back on its own defaults. Everything in it comes from the record, the writer, the tile and the knowledge bank.
export function handoffMarkdown({ idea, written = {}, tile = null, eye = null, slop = null, rules = [], anatomy = null, session }) {
  const d = idea.direction?.design ?? {};
  const ruled = idea.direction?.ruled ?? {};
  const names = new Map([...(anatomy?.anatomy?.material ?? []).map((m) => [m.id, m.what]), ...(anatomy?.anatomy?.parts ?? []).map((p) => [p.id, p.name]), ...(anatomy?.anatomy?.knows ?? []).map((k) => [k.id, k.what])]);
  const grows = (idea.invention?.buildsOn ?? []).map((id) => names.get(id)).filter(Boolean);
  const g = d.signature ?? {};
  const pa = idea.priorArt;
  const out = [
    `# ${one(idea.title)}`, '',
    `A design direction for ${one(session.brand)}, from the design studio session of ${session.id}. It came through a debate that tried to show it was a copy, generic or unbuildable, and a judge ruled that it stands. It is a direction to build from, not a finished design.`, '',
    '## The idea', '',
    one(written.sentence) || one(idea.hypothesis.change), '',
    `**What the site becomes:** ${one(idea.hypothesis.change)}`, '',
    `**Why this business:** ${one(idea.hypothesis.because)}`, '',
    ...(grows.length ? ['**What of the business it is made of:**', '', ...bullets(grows), ''] : []),
    ...(ruled.madeFrom ? [`**How it was made:** ${MADE_WORDS[ruled.madeFrom]}${ruled.whole ? ` ${one(ruled.whole)}` : ''}`, ''] : []),
    '## The design', '',
    ...[['Type', d.type], ['Colour', d.colour], ['Layout', d.layout], ['Imagery', d.imagery], ['Motion', d.motion], ['Technology', d.technology]].filter(([, v]) => v).flatMap(([k, v]) => [`**${k}.** ${one(v)}`, '']),
    '## The signature moment', '',
    ...(g.kind === 'none' || !g.kind ? [`None. ${one(g.why)}`, ''] : [
      `${SIGNATURE_WORDS[g.kind]}`, '', `**What happens:** ${one(g.what)}`, '', `**Why this site needs it:** ${one(g.why)}`, '', `**On the tenth visit:** ${one(g.tenth)}`, '',
    ]),
    ...(ruled.signature ? [`**The judge's ruling:** ${SIGNATURE_RULING_WORDS[ruled.signature]}`, ''] : []),
    ...(tile ? [
      '## The values of the tile', '',
      `The tile beside this file (\`../${tile.file}\`) shows the first screen and the signature moment. ${one(tile.shows)} Its values are a start, not a finished system.`, '',
      '| Colour | Value | Used for |', '|---|---|---|', ...tile.tokens.colours.map((c) => `| ${c.name} | \`${c.value}\` | ${c.use} |`), '',
      '| Type | Family | From | Used for |', '|---|---|---|---|', ...tile.tokens.type.map((f) => `| ${f.role} | ${f.family} | ${f.source} | ${f.use} |`), '',
      ...(tile.tokens.motion.length ? ['| Movement | Duration | Easing | Used for |', '|---|---|---|---|', ...tile.tokens.motion.map((m) => `| ${m.name} | ${m.duration} | ${m.easing} | ${m.use} |`), ''] : ['Nothing moves.', '']),
      '## The rules of this direction', '', ...bullets(tile.tokens.rules), '',
    ] : []),
    '## What it keeps, and what it breaks', '',
    'Kept, because visitors rely on it:', '', ...bullets(d.keeps ?? []), '',
    'Broken, on purpose:', '', ...(d.breaks ?? []).map((b) => `- ${one(b.what)}: ${one(b.why)}`), '',
    ...((d.needs ?? []).length ? ['## What the business must supply', '', ...bullets(d.needs), ''] : []),
    '## Do not', '',
    '- Do not let it drift back to the defaults of a template: when a choice is not written here, ask what the idea above would choose, not what sites usually do.',
    ...(pa?.who ? [`- Do not turn it into what already exists. The nearest thing found: ${one(pa.who)}. How this differs: ${one(pa.difference)}`] : []),
    ...(ruled.swap ? [`- Keep it this business's own. The judge's ruling on the swap test: ${SWAP_WORDS[ruled.swap]}`] : []),
    ...rules.map((n) => `- ${one(n.title)}: ${one(n.detail)} (the person's rule)`),
    ...(slop?.tells?.length ? ['', 'What a template or machine-made site looks like now, as the studio found it. None of it belongs here:', '', ...slop.tells.map((t) => `- ${one(t.what)}`)] : []), '',
    ...(eye ? ['## What a stranger saw in the tile', '', `Shown the tile and told nothing, a reviewer took it to be for: ${one(eye.guess)} It reminded them of: ${one(eye.remindsOf)}`, '', ...(eye.tells.length ? ['Read as a template:', '', ...bullets(eye.tells), ''] : []), `Its own: ${one(eye.works)}`, ''] : []),
    '## Still uncertain', '',
    ...bullets(written.uncertain ?? []),
    ...(written.killCondition ? ['', `**Drop the direction if:** ${one(written.killCondition)}`] : []), '',
  ];
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

export function writeHandoffs(dir, items) {
  fs.mkdirSync(path.join(dir, 'handoff'), { recursive: true });
  return items.map(({ id, markdown }) => { const file = path.join(dir, handoffFile(id)); fs.writeFileSync(file, markdown); return file; });
}
