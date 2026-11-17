import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURES, tmpDir } from '../helpers.mjs';
import { listFiles } from '../../skills/project-health/scripts/lib/files.mjs';
import { detectStacks, detectSiteType, planAreas, buildProfile } from '../../skills/project-health/scripts/lib/detect.mjs';
import { detectBrand, firstFamily, titleBrand } from '../../skills/project-health/scripts/lib/brand.mjs';
import { findBrowser } from '../../skills/project-health/scripts/lib/browser.mjs';

const fx = (name) => path.join(FIXTURES, name);

test('listFiles returns forward-slash paths, includes dotfiles and skips ignored dirs', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'x', 'i.js'), '');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), '');
  fs.writeFileSync(path.join(root, '.env'), 'A=1');
  assert.deepEqual(listFiles(root).sort(), ['.env', 'src/a.js']);
});

test('stacks are detected from fixtures', () => {
  assert.deepEqual(detectStacks(fx('static-html'), listFiles(fx('static-html'))), ['static-html']);
  assert.deepEqual(detectStacks(fx('wordpress-lite'), listFiles(fx('wordpress-lite'))), ['wordpress']);
  assert.deepEqual(detectStacks(fx('nextjs-lite'), listFiles(fx('nextjs-lite'))), ['nextjs']);
});

test('a package with main and no site is a library and skips site-only areas', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'tiny-lib', main: 'index.js' }));
  fs.writeFileSync(path.join(root, 'index.js'), 'module.exports = 1;');
  const files = listFiles(root);
  const type = detectSiteType(root, files, detectStacks(root, files));
  assert.equal(type, 'library');
  const plan = planAreas(type);
  assert.ok(!plan.applicable.includes('seo'));
  assert.match(plan.skipped.seo, /library/);
});

function project(pkg, files = {}) {
  const root = tmpDir();
  if (pkg) fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), body);
  }
  const list = listFiles(root);
  const stacks = detectStacks(root, list);
  return { stacks, type: detectSiteType(root, list, stacks) };
}

test('a server app with the "main" that npm init writes is not a library', () => {
  assert.deepEqual(project({ name: 'shop-api', main: 'index.js', dependencies: { express: '^4' } }, { 'index.js': '' }), { stacks: ['express'], type: 'brochure' });
  assert.equal(project({ name: 'app', main: 'index.js', private: true }, { 'index.js': '' }).type, 'brochure');
  assert.equal(project({ name: 'ui-kit', main: 'dist/index.js', peerDependencies: { react: '*' }, devDependencies: { react: '^18', vite: '^5' } }).type, 'library');
});

test('an index.html that a framework builds from is not a static HTML site', () => {
  assert.deepEqual(project({ private: true, dependencies: { react: '^18' }, devDependencies: { vite: '^5' } }, { 'index.html': '' }).stacks, ['react']);
  assert.deepEqual(project({ private: true, dependencies: { '@angular/core': '^18' } }, { 'src/index.html': '' }).stacks, ['angular']);
  assert.deepEqual(project({ private: true, dependencies: { next: '^15', react: '^19' } }).stacks, ['nextjs']);
  assert.deepEqual(project({ private: true, devDependencies: { vite: '^5' } }, { 'index.html': '' }).stacks, ['vite']);
  assert.deepEqual(project(null, { 'manage.py': '', 'templates/base.html': '' }).stacks, ['django']);
  assert.deepEqual(project(null, { 'hugo.toml': '', 'layouts/index.html': '' }).stacks, ['hugo']);
  assert.deepEqual(project({ private: true, devDependencies: { prettier: '^3' } }, { 'index.html': '' }).stacks, ['static-html']);
});

test('a human site.type fact overrides detection', () => {
  const files = listFiles(fx('static-html'));
  assert.equal(detectSiteType(fx('static-html'), files, ['static-html'], [{ key: 'site.type', value: 'ecommerce', source: 'human' }]), 'ecommerce');
});

test('planAreas filters with --only and rejects unknown areas', () => {
  assert.deepEqual(planAreas('brochure', ['seo', 'security']).applicable, ['seo', 'security']);
  assert.throws(() => planAreas('brochure', ['seo', 'speed']), /Unknown area\(s\): speed/);
});

test('brand is read from the static fixture', () => {
  const brand = detectBrand(fx('static-html'), listFiles(fx('static-html')));
  assert.deepEqual(brand, {
    name: 'Acme Studio',
    nameFrom: 'the page title in index.html ("Acme Studio | Home")',
    logo: 'img/logo.svg',
    primaryColor: '#0a7cff',
    fontFamily: 'Inter',
    fontUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap',
  });
});

test('the logo is the one the home page header shows, never a client logo', () => {
  const root = tmpDir();
  const write = (rel, text = '<svg/>') => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  write('assets/clients/take5-logo.svg');
  write('assets/brand/acme-lockup-white.svg');
  write('acme-logo.png', 'png');
  write('index.html', '<title>Acme</title><header><a class="logo" href="/"><img src="/assets/brand/acme-lockup-white.svg?v=2" alt="Acme"></a></header><img src="assets/clients/take5-logo.svg">');
  assert.equal(detectBrand(root, listFiles(root)).logo, 'assets/brand/acme-lockup-white.svg');
  write('index.html', '<title>Acme</title><main><img src="assets/clients/take5-logo.svg"></main>');
  assert.equal(detectBrand(root, listFiles(root)).logo, 'acme-logo.png', 'without a header logo the brand-named file wins over a client SVG');
});

test('brand name comes from the WordPress theme and package name', () => {
  assert.equal(detectBrand(fx('wordpress-lite'), listFiles(fx('wordpress-lite'))).name, 'Acme Theme');
  assert.equal(detectBrand(fx('wordpress-lite'), listFiles(fx('wordpress-lite'))).primaryColor, '#c2410c');
  assert.equal(detectBrand(fx('nextjs-lite'), listFiles(fx('nextjs-lite'))).name, 'Acme Next Site');
});

test('firstFamily rejects values that could break CSS', () => {
  assert.equal(firstFamily('"Inter", sans-serif'), 'Inter');
  assert.equal(firstFamily('x;}</style><script>'), null);
});

test('findBrowser prefers CHROME_PATH and falls back to known locations', () => {
  const exists = (p) => p === '/custom/chrome' || p === '/usr/bin/chromium';
  assert.equal(findBrowser({ CHROME_PATH: '/custom/chrome' }, 'linux', exists), '/custom/chrome');
  assert.equal(findBrowser({}, 'linux', exists), '/usr/bin/chromium');
  assert.equal(findBrowser({}, 'linux', () => false), null);
  const win = findBrowser({ 'PROGRAMFILES(X86)': 'C:\\PF86' }, 'win32', (p) => p.endsWith('msedge.exe'));
  assert.match(win, /msedge\.exe$/);
});

test('buildProfile combines everything', () => {
  const profile = buildProfile(fx('static-html'));
  assert.deepEqual(profile.stacks, ['static-html']);
  assert.equal(profile.siteType, 'brochure');
  assert.equal(profile.applicableAreas.length, 11);
  assert.equal(profile.brand.name, 'Acme Studio');
  assert.equal(typeof profile.tools.git, 'boolean');
  assert.deepEqual(profile.staleFacts, []);
});

test('a generic first title segment such as "Home" gives way to the last segment', () => {
  assert.equal(titleBrand('Home | Acme'), 'Acme');
  assert.equal(titleBrand('Startseite – Muster GmbH'), 'Muster GmbH');
  assert.equal(titleBrand('Welcome - Blog - Acme'), 'Acme');
  assert.equal(titleBrand('Acme Studio | Design'), 'Acme Studio');
  assert.equal(titleBrand('Home'), 'Home');
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'index.html'), '<html><head><title>Home | Acme</title></head></html>');
  assert.equal(detectBrand(root, listFiles(root)).name, 'Acme');
});
