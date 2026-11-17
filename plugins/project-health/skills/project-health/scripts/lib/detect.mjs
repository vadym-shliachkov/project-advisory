import path from 'node:path';
import { readJson } from './io.mjs';
import { AREAS } from './areas.mjs';
import { listFiles } from './files.mjs';
import { detectBrand } from './brand.mjs';
import { hasCommand, isGitRepo } from './tools.mjs';
import { findBrowser } from './browser.mjs';
import { loadKb, staleFacts } from './kb.mjs';

const ECOMMERCE_DEPS = ['stripe', '@stripe/stripe-js', '@shopify/hydrogen', 'snipcart', '@medusajs/medusa', '@commercelayer/sdk'];
const APP_DEPS = ['next-auth', '@auth/core', '@clerk/nextjs', '@supabase/supabase-js', 'firebase', 'lucia', 'passport'];
const SKIP_BY_TYPE = {
  library: {
    hosting: 'library — not deployed as a website',
    seo: 'library — no public website',
    'content-conversion': 'library — no public website',
    performance: 'library — no public website',
  },
};

function deps(pkg) {
  return { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
}

// Frameworks that own routing and rendering. When one is present, the UI library it builds on is not listed too.
const META_FRAMEWORKS = [
  ['next', 'nextjs'], ['nuxt', 'nuxt'], ['astro', 'astro'], ['gatsby', 'gatsby'], ['@sveltejs/kit', 'sveltekit'],
  ['@remix-run/react', 'remix'], ['@angular/core', 'angular'], ['@11ty/eleventy', 'eleventy'],
];
const UI_LIBRARIES = [['react', 'react'], ['vue', 'vue'], ['svelte', 'svelte'], ['solid-js', 'solid'], ['preact', 'preact']];
const SERVER_FRAMEWORKS = [['express', 'express'], ['fastify', 'fastify'], ['koa', 'koa'], ['@nestjs/core', 'nestjs'], ['hono', 'hono'], ['@hapi/hapi', 'hapi']];
const BUILD_TOOLS = [['vite', 'vite'], ['parcel', 'parcel'], ['webpack', 'webpack']];
// Stacks a published package (a component library, a CLI) can have; a site or app framework rules a library out.
const LIBRARY_STACKS = new Set(['node', 'unknown', ...UI_LIBRARIES.map(([, s]) => s), ...BUILD_TOOLS.map(([, s]) => s)]);

export function detectStacks(root, files) {
  const has = (re) => files.some((f) => re.test(f));
  const pkg = readJson(path.join(root, 'package.json'), null);
  const d = deps(pkg);
  const stacks = [];
  if (has(/(^|\/)wp-config(-sample)?\.php$/) || has(/(^|\/)wp-content\//)) stacks.push('wordpress');
  if (has(/\.liquid$/) && has(/(^|\/)config\/settings_schema\.json$/)) stacks.push('shopify-theme');
  const meta = META_FRAMEWORKS.filter(([dep]) => dep in d).map(([, s]) => s);
  if (has(/(^|\/)next\.config\.(js|mjs|cjs|ts)$/)) meta.push('nextjs');
  if (has(/(^|\/)astro\.config\.(js|mjs|ts)$/)) meta.push('astro');
  if (has(/(^|\/)nuxt\.config\.(js|mjs|ts)$/)) meta.push('nuxt');
  stacks.push(...meta);
  if (!meta.length) stacks.push(...UI_LIBRARIES.filter(([dep]) => dep in d).map(([, s]) => s));
  if (!stacks.length) stacks.push(...BUILD_TOOLS.filter(([dep]) => dep in d).map(([, s]) => s));
  stacks.push(...SERVER_FRAMEWORKS.filter(([dep]) => dep in d).map(([, s]) => s));
  if (has(/^hugo\.(toml|ya?ml|json)$/) || (has(/^config\.(toml|ya?ml)$/) && has(/^layouts\//))) stacks.push('hugo');
  if (has(/^_config\.ya?ml$/) && (has(/^_layouts\//) || has(/^_posts\//))) stacks.push('jekyll');
  if (has(/^manage\.py$/)) stacks.push('django');
  if (has(/^artisan$/) && has(/^composer\.json$/)) stacks.push('laravel');
  if (has(/^config\/routes\.rb$/) && has(/^Gemfile$/)) stacks.push('rails');
  // Plain HTML only when nothing builds or serves the pages: index.html in a Vite or Angular app is a build input.
  if (!stacks.length && has(/\.html?$/)) stacks.push('static-html');
  if (!stacks.length && pkg) stacks.push('node');
  return stacks.length ? [...new Set(stacks)] : ['unknown'];
}

export function detectSiteType(root, files, stacks, humanFacts = []) {
  const override = humanFacts.find((f) => f.key === 'site.type')?.value;
  if (override) return override;
  const pkg = readJson(path.join(root, 'package.json'), null);
  const d = deps(pkg);
  const has = (re) => files.some((f) => re.test(f));
  if (stacks.includes('shopify-theme') || has(/(^|\/)plugins\/woocommerce\//) || ECOMMERCE_DEPS.some((x) => x in d)) return 'ecommerce';
  if (APP_DEPS.some((x) => x in d)) return 'saas-app';
  // `npm init` writes "main" into every package.json, so "main" alone is not enough: a library is also not marked
  // private and has no site or server framework. Apps scaffolded by Vite, Create React App and others are private.
  const libraryShaped = stacks.every((s) => LIBRARY_STACKS.has(s));
  if (libraryShaped && pkg && !pkg.private && (pkg.main || pkg.exports || pkg.bin)) return 'library';
  if (files.filter((f) => /(^|\/)(blog|posts|articles|news)\/.+\.(md|mdx|html)$/.test(f)).length >= 5) return 'blog';
  return 'brochure';
}

export function planAreas(siteType, only) {
  const skipped = { ...(SKIP_BY_TYPE[siteType] ?? {}) };
  let applicable = AREAS.filter((a) => !skipped[a]);
  if (only?.length) {
    const unknown = only.filter((a) => !AREAS.includes(a));
    if (unknown.length) throw new Error(`Unknown area(s): ${unknown.join(', ')}. Valid areas: ${AREAS.join(', ')}`);
    applicable = applicable.filter((a) => only.includes(a));
  }
  return { applicable, skipped };
}

export function buildProfile(root, { only } = {}) {
  const files = listFiles(root);
  const kb = loadKb(root);
  const human = kb.filter((f) => f.source === 'human');
  const stacks = detectStacks(root, files);
  const siteType = detectSiteType(root, files, stacks, human);
  const { applicable, skipped } = planAreas(siteType, only);
  return {
    root: path.resolve(root),
    detectedAt: new Date().toISOString(),
    stacks,
    siteType,
    applicableAreas: applicable,
    skippedAreas: skipped,
    isGitRepo: isGitRepo(root),
    brand: detectBrand(root, files, human),
    tools: {
      node: process.versions.node,
      git: hasCommand('git'),
      npm: hasCommand('npm'),
      composer: hasCommand('composer'),
      browser: findBrowser(),
    },
    staleFacts: staleFacts(kb, root),
    fileCount: files.length,
  };
}
