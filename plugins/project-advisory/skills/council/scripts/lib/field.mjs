import path from 'node:path';
import { readJson, writeJson } from './io.mjs';

// What the design studio learns about the field before anyone designs, beside the anatomy of the thing and the habits
// of its trade (the genre, which the studio calls the sector):
//
//   currents  what wins awards now: a sample of honoured sites, each with its one idea, how it moves, what it is built
//             with and its signature moment, and the patterns the sample shares. A pattern is written as what it does
//             for the visitor ("the page is one object that changes state as you scroll"), never as how one site looks,
//             and says how common it has become. The designers are handed the patterns without the sites: a map of
//             what visitors have already seen, not a kit of parts. Only the examiner and the judge see the sites.
//   slop      what template and machine-made sites look like now: the tells a visitor reads as "nobody chose this".
//             A direction made of them is refused at the docket.
//
// Technology is measured where it can be: the probe opens a page in the browser and reads the libraries, frameworks
// and fonts its markup shows (see detectTech). A library bundled without a trace is not seen, and the probe says so.

export const PATTERN_KINDS = ['idea', 'type', 'layout', 'imagery', 'motion', 'signature', 'technology'];
export const SHARES = ['rare', 'rising', 'common', 'everywhere'];
export const SHARE_WORDS = { rare: 'Seen once or twice.', rising: 'Seen on several of the newest.', common: 'Seen on many.', everywhere: 'Seen on most: visitors expect it, or are tired of it.' };
export const SLOP_WHERE = ['type', 'colour', 'layout', 'imagery', 'motion', 'words', 'components'];

export const currentsPath = (dir) => path.join(dir, 'currents.json');
export const loadCurrents = (dir) => readJson(currentsPath(dir), null);
export const saveCurrents = (dir, data) => writeJson(currentsPath(dir), data);
export const slopPath = (dir) => path.join(dir, 'slop.json');
export const loadSlop = (dir) => readJson(slopPath(dir), null);
export const saveSlop = (dir, data) => writeJson(slopPath(dir), data);

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
function textError(value, at, min, max) {
  if (typeof value !== 'string') return [`${at}: text is required`];
  const t = one(value);
  if (t.length < min) return [`${at}: at least ${min} characters are required`];
  if (t.length > max) return [`${at}: at most ${max} characters (it has ${t.length})`];
  return [];
}
const isUrl = (s) => /^https?:\/\/\S+$/i.test(one(s));

export function validateCurrents(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return ['$.currents: an object is required'];
  const errors = [];
  if (!Array.isArray(c.sample) || c.sample.length < 6 || c.sample.length > 30) errors.push('$.currents.sample: six to thirty sites honoured in the last year or so, each { "site", "award", "idea", "motion", "technology", "signature" }');
  else c.sample.forEach((s, i) => {
    const at = `$.currents.sample[${i}]`;
    if (!isUrl(s?.site)) errors.push(`${at}.site: the address of the site`);
    errors.push(...textError(s?.award, `${at}.award`, 3, 160).map((e) => `${e} (who honoured it and when, as the page says)`));
    errors.push(...textError(s?.idea, `${at}.idea`, 20, 300).map((e) => `${e} (the one idea its design rests on, in a sentence)`));
    errors.push(...textError(s?.motion, `${at}.motion`, 10, 300).map((e) => `${e} (what moves, and what the movement does)`));
    if (!Array.isArray(s?.technology) || s.technology.length > 12) errors.push(`${at}.technology: up to twelve things it is built with, as the probe or its credits show ([] when nothing could be seen)`);
    else s.technology.forEach((t, j) => errors.push(...textError(t, `${at}.technology[${j}]`, 2, 60)));
    errors.push(...textError(s?.signature, `${at}.signature`, 4, 300).map((e) => `${e} (its signature moment, or "none")`));
    for (const key of Object.keys(s ?? {})) if (!['site', 'award', 'idea', 'motion', 'technology', 'signature'].includes(key)) errors.push(`${at}: unknown property "${key}"`);
  });
  if (!Array.isArray(c.patterns) || c.patterns.length < 6 || c.patterns.length > 30) errors.push('$.currents.patterns: six to thirty patterns the sample shares, each { "what", "kind", "share" }');
  else c.patterns.forEach((p, i) => {
    const at = `$.currents.patterns[${i}]`;
    errors.push(...textError(p?.what, `${at}.what`, 15, 300).map((e) => `${e} (what it does for the visitor, never how one site looks)`));
    if (isUrl(p?.what) || /https?:\/\//i.test(String(p?.what ?? ''))) errors.push(`${at}.what: a pattern names no site and carries no address: the designers read it, and they are not shown the sites`);
    if (!PATTERN_KINDS.includes(p?.kind)) errors.push(`${at}.kind: ${PATTERN_KINDS.join(', ')}`);
    if (!SHARES.includes(p?.share)) errors.push(`${at}.share: how common it is in the sample: ${SHARES.join(', ')}`);
    for (const key of Object.keys(p ?? {})) if (!['what', 'kind', 'share'].includes(key)) errors.push(`${at}: unknown property "${key}"`);
  });
  errors.push(...textError(c.reading, '$.currents.reading', 60, 900).map((e) => `${e} (what the honoured sites have in common now, and what is fading)`));
  for (const key of Object.keys(c)) if (!['sample', 'patterns', 'reading'].includes(key)) errors.push(`$.currents: unknown property "${key}"`);
  return errors;
}

// R1… the patterns.
export const cleanCurrents = (c) => ({
  sample: c.sample.map((s) => ({ site: one(s.site), award: one(s.award), idea: one(s.idea), motion: one(s.motion), technology: s.technology.map(one), signature: one(s.signature) })),
  patterns: c.patterns.map((p, i) => ({ id: `R${i + 1}`, what: one(p.what), kind: p.kind, share: p.share })),
  reading: one(c.reading),
});

export function validateSlop(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return ['$.slop: an object is required'];
  const errors = [];
  if (!Array.isArray(s.tells) || s.tells.length < 8 || s.tells.length > 40) errors.push('$.slop.tells: eight to forty tells of a template or machine-made site, each { "what", "where", "why" }');
  else s.tells.forEach((t, i) => {
    const at = `$.slop.tells[${i}]`;
    errors.push(...textError(t?.what, `${at}.what`, 10, 240));
    if (!SLOP_WHERE.includes(t?.where)) errors.push(`${at}.where: ${SLOP_WHERE.join(', ')}`);
    errors.push(...textError(t?.why, `${at}.why`, 10, 300).map((e) => `${e} (why a visitor reads it as "nobody chose this")`));
    for (const key of Object.keys(t ?? {})) if (!['what', 'where', 'why'].includes(key)) errors.push(`${at}: unknown property "${key}"`);
  });
  errors.push(...textError(s.reading, '$.slop.reading', 40, 600));
  for (const key of Object.keys(s)) if (!['tells', 'reading'].includes(key)) errors.push(`$.slop: unknown property "${key}"`);
  return errors;
}

// X1… the tells.
export const cleanSlop = (s) => ({ tells: s.tells.map((t, i) => ({ id: `X${i + 1}`, what: one(t.what), where: t.where, why: one(t.why) })), reading: one(s.reading) });

// What a designer is handed of the field: the patterns with how common each is, the slop list, and the habits and the
// most distinctive ideas of the trade, all without a site's name or address. A designer cannot copy what it was not shown.
export function designersField({ currents = null, slop = null, genre = null } = {}) {
  return {
    note: 'What visitors have already seen. It is a map of the used, not a kit of parts: a direction is not made by joining these.',
    ...(currents ? { awardsNow: { reading: currents.reading, patterns: currents.patterns } } : {}),
    ...(slop ? { slop: { reading: slop.reading, tells: slop.tells } } : {}),
    ...(genre ? { sector: { category: genre.category, habits: genre.habits, conventions: genre.kit, mostDistinctive: genre.frontier.map(({ id, what }) => ({ id, what })) } } : {}),
  };
}

// ---- What a page is built with, read from its markup ----

// A library shows in one of two places: in the address of a file the page loads or in a script or style it carries
// (`file`), or as an element or attribute the library puts into the page (`mark`). Never in an attribute's value: a
// gallery that keeps a list of other sites' technologies in a data attribute is not built with them.
const LIBRARIES = [
  ['GSAP', /gsap(?:\.min)?\.m?js|\/gsap@|\bgsap\.(?:to|from|fromTo|set|timeline|registerPlugin)\b|ScrollTrigger|ScrollSmoother/i, /\sdata-gsap[\w-]*=/i],
  ['Lenis (smooth scroll)', /lenis(?:\.min)?\.(?:m?js|css)|\/lenis@|new Lenis\b/i, /\sclass="(?:[^"]*\s)?lenis(?:\s[^"]*)?"|\sdata-lenis[\w-]*[\s=>]/i],
  ['Locomotive Scroll', /locomotive-scroll/i, /\sdata-scroll-container[\s=>]/i],
  ['Three.js', /three(?:\.module)?(?:\.min)?\.m?js|\/three@|\bTHREE\.(?:Scene|WebGLRenderer|PerspectiveCamera)\b/i, /\sdata-engine="three\.js/i],
  ['Babylon.js', /babylon(?:\.max)?\.js|\bBABYLON\.Engine\b/i, /\sdata-engine="Babylon/i],
  ['PixiJS', /pixi(?:\.min)?\.m?js|\/pixi\.js@|\bPIXI\.Application\b/i, null],
  ['OGL', /\/ogl(?:\.min)?\.m?js|\/ogl@/i, null],
  ['Spline', /splinetool|spline\.design/i, /<spline-viewer\b/i],
  ['Rive', /@rive-app|rive(?:\.wasm|-canvas)|\.riv\b/i, null],
  ['Lottie', /lottie(?:-player|-web|\.min)?\.m?js|dotlottie|\.lottie\b|lottie\.loadAnimation/i, /<lottie-player\b|<dotlottie[\w-]*\b/i],
  ['Barba (page transitions)', /barba(?:\.umd)?(?:\.min)?\.js|@barba\/|\bbarba\.init\b/i, /\sdata-barba(?:-namespace)?=/i],
  ['Swup (page transitions)', /swup(?:\.min)?\.js|new Swup\b/i, /\sid="swup"/i],
  ['Taxi (page transitions)', /taxi(?:\.min)?\.js|@unseenco\/taxi/i, /\sdata-taxi(?:-view)?[\s=>]/i],
  ['model-viewer (3D models)', null, /<model-viewer\b/i],
  ['Split text', /SplitText|splitting(?:\.min)?\.js|split-type/i, /\sdata-splitting[\s=>]/i],
  ['Swiper', /swiper(?:-bundle)?(?:\.min)?\.(?:m?js|css)|new Swiper\b/i, /\sclass="(?:[^"]*\s)?swiper(?:\s[^"]*)?"/i],
  ['Matter.js (physics)', /matter(?:\.min)?\.js|\/matter-js@|\bMatter\.Engine\b/i, null],
  ['Shaders in the page', /gl_FragColor|gl_Position/, /<script[^>]+type="x-shader/i],
  ['View transitions', /view-transition-name|@view-transition|startViewTransition/i, null],
  ['Scroll-driven CSS animation', /animation-timeline\s*:|scroll-timeline|view-timeline/i, null],
];
const FRAMEWORKS = [
  ['Next.js', /\/_next\//, /\sid="__next"|\sid="__NEXT_DATA__"/],
  ['Nuxt', /\/_nuxt\/|__NUXT__/, /\sid="__nuxt"/],
  ['Astro', /\/_astro\//, /<astro-island\b/],
  ['Gatsby', null, /\sid="___gatsby"/],
  ['SvelteKit', /__sveltekit|\/_app\/immutable\//, null],
  ['Remix', /__remixContext/, null],
  ['Webflow', /webflow(?:\.[\w]+)?\.js|website-files\.com/i, /\sdata-wf-site=/i],
  ['Framer', /framerusercontent\.com|framer\.com\/m\//i, /\sdata-framer-[\w-]+=/i],
  ['WordPress', /\/wp-content\/|\/wp-includes\//, null],
  ['Shopify', /cdn\.shopify\.com/i, null],
  ['Squarespace', /squarespace(?:-cdn)?\.com/i, null],
  ['Wix', /wixstatic\.com/i, null],
  ['Sanity (content)', /cdn\.sanity\.io/i, null],
  ['Contentful (content)', /ctfassets\.net/i, null],
  ['Prismic (content)', /prismic\.io/i, null],
  ['Storyblok (content)', /storyblok\.com/i, null],
];

const count = (html, re) => (html.match(re) ?? []).length;

// What a page is made of, without what it says, in two parts: `tags` (every tag, with its attributes) and `code` (the
// scripts and styles it carries, and the addresses of the files it loads). A page that writes "built with Three.js" in
// a sentence, or keeps a list of other sites' technologies as labels or as data, is not thereby built with it: visible
// text and data blocks (JSON a page ships for its own content) are left out.
export function markupOf(html) {
  const src = String(html ?? '');
  const bodies = [];
  const openers = [];
  const rest = src.replace(/<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi, (whole, tag, attrs, body) => {
    const data = tag.toLowerCase() === 'script' && /type\s*=\s*["']?(?:application\/(?:ld\+)?json|text\/(?:template|html|plain))/i.test(attrs);
    openers.push(`<${tag}${attrs}>`);
    if (!data) bodies.push(body);
    return ' ';
  });
  const list = [...openers, ...(rest.match(/<[^>]+>/g) ?? [])];
  // The files a page loads: what a script, a stylesheet, a picture or a film names. A link to another site is not one:
  // a page that links to a tool's home page is not built with the tool.
  const addresses = list.filter((t) => !/^<\/?(?:a|area)\b/i.test(t))
    .flatMap((t) => [...t.matchAll(/\s(?:src|href|data-src|poster)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((m) => m[1] ?? m[2]));
  return { tags: list.join('\n'), code: `${addresses.join('\n')}\n${bodies.join('\n')}` };
}

export function detectTech(html) {
  const { tags, code } = markupOf(html);
  const seen = ([, file, mark]) => Boolean((file && file.test(code)) || (mark && mark.test(tags)));
  const fonts = new Set();
  for (const m of code.matchAll(/fonts\.(?:googleapis|bunny)\.(?:com|net)\/css2?\?([^"'\s>]+)/gi)) {
    for (const f of m[1].replace(/&amp;/g, '&').matchAll(/family=([^&:"']+)/gi)) fonts.add(decodeURIComponent(f[1]).replace(/\+/g, ' '));
  }
  for (const m of code.matchAll(/@font-face\s*\{[^}]*?font-family\s*:\s*["']?([^;"'}]+)/gi)) fonts.add(one(m[1]));
  const hosted = [/use\.typekit\.net/i.test(code) ? 'Adobe Fonts' : null, /fonts\.googleapis\.com/i.test(code) ? 'Google Fonts' : null, /fonts\.bunny\.net/i.test(code) ? 'Bunny Fonts' : null, /api\.fontshare\.com/i.test(code) ? 'Fontshare' : null].filter(Boolean);
  return {
    libraries: LIBRARIES.filter(seen).map(([name]) => name),
    builtOn: FRAMEWORKS.filter(seen).map(([name]) => name),
    canvases: count(tags, /<canvas\b/gi), videos: count(tags, /<video\b/gi), inlineSvgs: count(tags, /<svg\b/gi), sounds: count(tags, /<audio\b/gi),
    fonts: [...fonts].filter((f) => f.length > 1 && f.length < 60).slice(0, 12), fontHosts: hosted,
    reducedMotion: /prefers-reduced-motion/i.test(code),
    size: String(html ?? '').length,
  };
}
