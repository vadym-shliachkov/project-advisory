import path from 'node:path';
import { readJson, writeJson } from './io.mjs';

// A sketch of each invention that survived: what it could look like, so the reader sees it instead of imagining it.
// A thing people look at (a site, an app, a game) is sketched as a screen, in SVG; a thing people type into or call
// from code (a command-line tool, a library, an API, a plugin) as a transcript: the terminal session or the code that
// would use it. A sketch is a picture of an idea, not a design: its words and numbers are illustrative.
//
// The SVG is written by an agent and printed in the documents and the pages, so it is never trusted: it is parsed and
// rebuilt from a short list of shapes and attributes, and anything else (a script, a link, a style, an image, an
// event handler, an entity) refuses the sketch.

export const FORMS = ['screen', 'terminal', 'code'];
export const sketchesPath = (dir) => path.join(dir, 'sketches.json');
export const loadSketches = (dir) => readJson(sketchesPath(dir), null);
export const saveSketches = (dir, data) => writeJson(sketchesPath(dir), data);

const SVG_MAX = 40000;
const MAX_ELEMENTS = 500;
const ELEMENTS = new Set(['svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'tspan', 'title']);
const TEXT_HOLDERS = new Set(['text', 'tspan', 'title']);
const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:px|%|em)?$/;
const COLOR = /^(?:none|currentColor|transparent|#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\))$/;
const ATTRS = {
  x: NUMBER, y: NUMBER, width: NUMBER, height: NUMBER, rx: NUMBER, ry: NUMBER, cx: NUMBER, cy: NUMBER, r: NUMBER,
  x1: NUMBER, y1: NUMBER, x2: NUMBER, y2: NUMBER, dx: NUMBER, dy: NUMBER, opacity: NUMBER, 'fill-opacity': NUMBER, 'stroke-opacity': NUMBER,
  'stroke-width': NUMBER, 'font-size': NUMBER, 'letter-spacing': NUMBER,
  fill: COLOR, stroke: COLOR,
  'stroke-dasharray': /^[\d.\s,]{1,40}$/, 'stroke-linecap': /^(?:butt|round|square)$/, 'stroke-linejoin': /^(?:miter|round|bevel)$/,
  'font-weight': /^(?:normal|bold|bolder|lighter|[1-9]00)$/, 'font-style': /^(?:normal|italic)$/, 'font-family': /^[a-zA-Z0-9 ,'-]{1,80}$/,
  'text-anchor': /^(?:start|middle|end)$/, 'dominant-baseline': /^(?:auto|middle|central|hanging|alphabetic)$/,
  transform: /^(?:\s*(?:translate|scale|rotate)\(\s*-?[\d.]+(?:[\s,]+-?[\d.]+){0,2}\s*\)\s*)+$/,
  d: /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]{1,8000}$/, points: /^[0-9.,\s-]{1,4000}$/,
  viewBox: /^-?[\d.]+(?:[\s,]+-?[\d.]+){3}$/, xmlns: /^http:\/\/www\.w3\.org\/2000\/svg$/, role: /^img$/, 'aria-label': /^[^<>"&]{1,200}$/,
};
const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Parses the SVG and writes it again from what is allowed. Returns { svg } or { errors }.
export function cleanSvg(input, at = '$.svg') {
  const src = String(input ?? '').trim();
  if (!src) return { errors: [`${at}: the sketch, as one <svg> element with a viewBox`] };
  if (src.length > SVG_MAX) return { errors: [`${at}: at most ${SVG_MAX} characters (it has ${src.length}); draw fewer, simpler shapes`] };
  if (/<!|<\?|&(?!amp;|lt;|gt;|quot;|#39;)/.test(src)) return { errors: [`${at}: no comments, declarations, processing instructions or entities other than &amp; &lt; &gt; &quot; &#39;`] };
  const out = [];
  const stack = [];
  const errors = [];
  let count = 0;
  let rooted = false;
  const TOKEN = /<\/?([a-zA-Z][\w:-]*)([^<>]*?)(\/?)>|([^<]+)/g;
  let m;
  let pos = 0;
  while ((m = TOKEN.exec(src))) {
    if (m.index !== pos) { errors.push(`${at}: a stray "<" near character ${pos}`); break; }
    pos = TOKEN.lastIndex;
    const [whole, name, rawAttrs, selfClose, text] = m;
    if (text !== undefined) {
      const holder = stack.at(-1);
      if (text.trim() && !TEXT_HOLDERS.has(holder)) { errors.push(`${at}: text outside <text>, <tspan> or <title>: "${text.trim().slice(0, 40)}"`); break; }
      if (!stack.length) continue;
      out.push(escText(text.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e])));
      continue;
    }
    const tag = name.toLowerCase() === 'svg' ? 'svg' : name;
    if (whole.startsWith('</')) {
      if (stack.at(-1) !== tag) { errors.push(`${at}: </${name}> closes nothing open`); break; }
      stack.pop();
      out.push(`</${tag}>`);
      continue;
    }
    if (!ELEMENTS.has(tag)) { errors.push(`${at}: <${name}> is not allowed; use ${[...ELEMENTS].join(', ')}`); break; }
    if (!stack.length && tag !== 'svg') { errors.push(`${at}: the sketch starts with <svg>`); break; }
    if (!stack.length && rooted) { errors.push(`${at}: one <svg> element only`); break; }
    if (tag === 'svg' && !stack.length) rooted = true;
    if ((count += 1) > MAX_ELEMENTS) { errors.push(`${at}: at most ${MAX_ELEMENTS} elements`); break; }
    const attrs = [];
    const ATTR = /([a-zA-Z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    const rest = rawAttrs.replace(ATTR, '').trim();
    if (rest) { errors.push(`${at}: <${name}> has an attribute without a quoted value: "${rest.slice(0, 40)}"`); break; }
    let a;
    while ((a = ATTR.exec(rawAttrs))) {
      const key = a[1];
      const value = (a[2] ?? a[3]).trim();
      const rule = ATTRS[key];
      if (!rule) { errors.push(`${at}: the attribute "${key}" on <${name}> is not allowed`); break; }
      if (!rule.test(value)) { errors.push(`${at}: ${key}="${value.slice(0, 40)}" on <${name}> is not a value it can take`); break; }
      attrs.push(`${key}="${escAttr(value)}"`);
    }
    if (errors.length) break;
    if (tag === 'svg') {
      if (!/viewBox="/.test(attrs.join(' '))) { errors.push(`${at}: the <svg> needs a viewBox, such as viewBox="0 0 800 500"`); break; }
      if (!attrs.some((x) => x.startsWith('xmlns='))) attrs.unshift('xmlns="http://www.w3.org/2000/svg"');
      if (!attrs.some((x) => x.startsWith('role='))) attrs.push('role="img"');
    }
    out.push(`<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}${selfClose ? ' />' : '>'}`);
    if (!selfClose) stack.push(tag);
  }
  if (!errors.length && pos !== src.length) errors.push(`${at}: something after character ${pos} is not SVG`);
  if (!errors.length && stack.length) errors.push(`${at}: <${stack.at(-1)}> is never closed`);
  return errors.length ? { errors } : { svg: out.join('') };
}

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// The sketches the sketcher hands in: one for every survivor, in the form its kind of thing calls for.
export function validateSketches(data, { survivors, form }) {
  const errors = [];
  const list = Array.isArray(data?.sketches) ? data.sketches : null;
  if (!list) return { errors: ['$.sketches: an array, one sketch for each invention that survived'] };
  const ids = new Map(survivors.map((s) => [s.id, s]));
  const seen = new Set();
  const clean = [];
  list.forEach((k, i) => {
    const at = `$.sketches[${i}]`;
    if (!ids.has(k?.idea)) { errors.push(`${at}.idea: "${k?.idea ?? ''}" is not an invention that survived; they are ${[...ids.keys()].join(', ') || 'none'}`); return; }
    if (seen.has(k.idea)) { errors.push(`${at}.idea: ${k.idea} is sketched twice`); return; }
    seen.add(k.idea);
    if (!FORMS.includes(k.form)) { errors.push(`${at}.form: ${FORMS.join(', ')}; for this kind of thing, "${form}"`); return; }
    const caption = one(k.caption);
    if (caption.length < 20 || caption.length > 240) errors.push(`${at}.caption: 20 to 240 characters: what the sketch shows, at which step of the experience`);
    if (k.form === 'screen') {
      const { svg, errors: svgErrors } = cleanSvg(k.svg, `${at}.svg`);
      errors.push(...(svgErrors ?? []));
      if (k.lines !== undefined) errors.push(`${at}.lines: a screen is drawn in "svg"; lines are for a terminal or code`);
      if (svg) clean.push({ idea: k.idea, form: k.form, caption, svg });
    } else {
      if (k.svg !== undefined) errors.push(`${at}.svg: a ${k.form} sketch is written as "lines"`);
      if (!Array.isArray(k.lines) || k.lines.length < 3 || k.lines.length > 40) errors.push(`${at}.lines: three to forty lines of the ${k.form === 'terminal' ? 'terminal session' : 'code that would use it'}`);
      else {
        k.lines.forEach((l, j) => { if (typeof l !== 'string' || l.length > 110) errors.push(`${at}.lines[${j}]: a line of at most 110 characters`); });
        if (k.language !== undefined && !/^[a-z0-9+#-]{1,20}$/i.test(k.language)) errors.push(`${at}.language: the name of the language, such as "js" or "python"`);
        clean.push({ idea: k.idea, form: k.form, caption, lines: k.lines.map((l) => String(l).replace(/\t/g, '  ').replace(/\s+$/, '')), ...(k.language ? { language: k.language } : {}) });
      }
    }
    for (const key of Object.keys(k)) if (!['idea', 'form', 'caption', 'svg', 'lines', 'language'].includes(key)) errors.push(`${at}: unknown property "${key}"`);
  });
  for (const id of ids.keys()) if (!seen.has(id)) errors.push(`$.sketches: ${id} "${ids.get(id).title}" has no sketch: every invention that survived is sketched`);
  return errors.length ? { errors } : { errors: [], sketches: clean };
}

// A sketch as HTML, for the documents and the pages. The SVG was rebuilt when it was saved; a transcript is escaped.
export function sketchHtml(sketch, esc) {
  if (!sketch) return '';
  const body = sketch.form === 'screen'
    ? `<div class="sketch-screen">${sketch.svg.includes('aria-label=') ? sketch.svg : sketch.svg.replace('<svg ', `<svg aria-label="${esc(sketch.caption)}" `)}</div>`
    : `<pre class="sketch-${sketch.form}"${sketch.language ? ` data-language="${esc(sketch.language)}"` : ''}><code>${sketch.lines.map(esc).join('\n')}</code></pre>`;
  return `<figure class="sketch">${body}<figcaption>${esc(sketch.caption)} <span class="meta">A sketch of the idea, not a design: its words and numbers are illustrative.</span></figcaption></figure>`;
}
