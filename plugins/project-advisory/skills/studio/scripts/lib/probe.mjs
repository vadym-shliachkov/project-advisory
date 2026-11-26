// What a public page is built with: the libraries, frameworks and fonts its markup shows, how many canvases and films
// it has, and whether it answers a visitor who asked for less motion. The page is only opened and read: nothing is
// sent to it. A library bundled without a trace is not seen, so a scout adds what the makers' notes say.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// The markup of a public page after its scripts ran.
export function dumpUrl(browser, url, { timeoutMs = 60000 } = {}) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-chrome-'));
  try {
    const r = spawnSync(browser, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${profileDir}`, '--dump-dom', '--virtual-time-budget=8000', url,
    ], { timeout: timeoutMs, stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
    const html = String(r.stdout ?? '');
    if (!html.trim()) throw new Error(`The browser read nothing from ${url} (exit ${r.status ?? 'timeout'}). ${String(r.stderr ?? '').slice(0, 300)}`);
    return html;
  } finally {
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* the browser may still hold files on Windows */ }
  }
}

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
