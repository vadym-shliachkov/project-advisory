import fs from 'node:fs';
import path from 'node:path';
import { readJson } from './io.mjs';

const COLOR_RE = /--(?:color-)?(?:primary|brand|accent)(?:-500|-main|-base)?\s*:\s*(#[0-9a-fA-F]{3,8})\b/;
const THEME_RE = /<meta\s+name=["']theme-color["']\s+content=["'](#[0-9a-fA-F]{3,8})["']/i;
const FONT_VAR_RE = /--font-(?:sans|body|base|primary|heading)\s*:\s*([^;]+);/;
const GFONTS_RE = /<link[^>]+href=["'](https:\/\/fonts\.googleapis\.com\/[^"']+)["']/i;
const TITLE_RE = /<title>([^<]{1,120})<\/title>/i;
const WP_THEME_RE = /Theme Name:\s*(.+)/;

export function firstFamily(value) {
  const first = String(value).split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  return /^[\w\s-]{1,60}$/.test(first) ? first : null;
}

export function humanize(name) {
  return String(name).replace(/^@[^/]+\//, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const GENERIC_PAGE_RE = /^(home|homepage|welcome|index|start|startseite|accueil|inicio)$/i;

// "Acme | Services" → "Acme"; "Home | Acme" → "Acme" (the first segment is a page word, not the brand).
export function titleBrand(title) {
  const segments = String(title).split(/\s[|–—-]\s/).map((s) => s.trim()).filter(Boolean);
  if (!segments.length) return null;
  return GENERIC_PAGE_RE.test(segments[0]) && segments.length > 1 ? segments[segments.length - 1] : segments[0];
}

const IMG_EXT_RE = /\.(svg|png|jpe?g|webp)$/i;
const THIRD_PARTY_DIR_RE = /(^|\/)(clients?|customers?|partners?|sponsors?|press|awards?|testimonials?|case-?stud(y|ies)|work|portfolio|logos)\//i;

// The image the home page's header shows, which is the site's own logo far more reliably than a file name.
function headerLogo(html, htmlEntry, files) {
  if (!html || !htmlEntry) return null;
  const header = /<header\b[\s\S]*?<\/header>/i.exec(html)?.[0] ?? '';
  const imgs = [...header.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const tag = imgs.find((t) => /logo|brand/i.test(t)) ?? imgs[0];
  const src = tag && /\ssrc=["']([^"']+)["']/i.exec(tag)?.[1];
  if (!src || /^[a-z]+:|^\/\//i.test(src)) return null;
  const clean = src.split(/[?#]/)[0];
  const rel = clean.startsWith('/') ? clean.slice(1) : path.posix.join(path.posix.dirname(htmlEntry), clean);
  const normal = path.posix.normalize(rel);
  return IMG_EXT_RE.test(normal) && files.includes(normal) ? normal : null;
}

// Otherwise a file named like a logo: the brand's own before client or partner logos, shallow before deep, SVG first.
function rankedLogo(files, name) {
  const brand = String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const score = (f) => (THIRD_PARTY_DIR_RE.test(f) ? 4 : 0) + (brand && path.posix.basename(f).toLowerCase().replace(/[^a-z0-9]/g, '').includes(brand) ? 0 : 2);
  return files
    .filter((f) => /(^|\/)[^/]*(logo|lockup)[^/]*\.(svg|png|jpe?g|webp)$/i.test(f))
    .sort((a, b) => score(a) - score(b)
      || a.split('/').length - b.split('/').length
      || Number(b.endsWith('.svg')) - Number(a.endsWith('.svg'))
      || a.length - b.length)[0] ?? null;
}

function cssPriority(file) {
  return /token|variable|theme|global|style/i.test(file) ? 0 : 1;
}

export const NAME_FROM = { human: 'what the user said (the brand.name fact)', live: 'the title of the live site' };

// A brand name the user gives with `ph fact --key brand.name` wins at every render, also over a run made before it.
export function withBrandFact(profile, facts) {
  const said = facts.find((f) => f.source === 'human' && f.key === 'brand.name')?.value;
  return said ? { ...profile, brand: { ...profile.brand, name: String(said), nameFrom: NAME_FROM.human } } : profile;
}

export function detectBrand(root, files, humanFacts = []) {
  const read = (rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return ''; } };
  const htmlEntry = files.find((f) => /^(public\/|src\/)?index\.html?$/.test(f)) ?? files.find((f) => /\.html?$/.test(f));
  const html = htmlEntry ? read(htmlEntry) : '';

  let primaryColor = null;
  let fontFamily = null;
  const cssFiles = files.filter((f) => /\.(css|scss)$/.test(f)).sort((a, b) => cssPriority(a) - cssPriority(b)).slice(0, 50);
  for (const f of cssFiles) {
    const css = read(f);
    primaryColor ??= COLOR_RE.exec(css)?.[1] ?? null;
    const fontVar = FONT_VAR_RE.exec(css)?.[1];
    if (!fontFamily && fontVar) fontFamily = firstFamily(fontVar);
    if (primaryColor && fontFamily) break;
  }
  primaryColor ??= THEME_RE.exec(html)?.[1] ?? null;

  const pkg = readJson(path.join(root, 'package.json'), null);
  const wpTheme = files.find((f) => /wp-content\/themes\/[^/]+\/style\.css$/.test(f));
  const wpName = wpTheme ? WP_THEME_RE.exec(read(wpTheme))?.[1]?.trim() : null;
  const title = TITLE_RE.exec(html)?.[1];
  const titleName = title ? titleBrand(title) : null;
  // Where the name came from goes with it, so a reviewer can judge a guess instead of being told it is right.
  const [name, nameFrom] = [
    [humanFacts.find((f) => f.key === 'brand.name')?.value, NAME_FROM.human],
    [wpName, `the name of the WordPress theme (${wpTheme})`],
    [titleName, `the page title in ${htmlEntry} ("${title?.trim()}")`],
    [pkg?.name ? humanize(pkg.name) : null, `the package name in package.json ("${pkg?.name}")`],
    [humanize(path.basename(path.resolve(root))), 'the name of the project folder'],
  ].find(([n]) => n);

  return {
    name,
    nameFrom,
    logo: headerLogo(html, htmlEntry, files) ?? rankedLogo(files, name),
    primaryColor: primaryColor ? primaryColor.toLowerCase() : null,
    fontFamily,
    fontUrl: GFONTS_RE.exec(html)?.[1] ?? null,
  };
}
