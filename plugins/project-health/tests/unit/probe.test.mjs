import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from '../helpers.mjs';
import { init, probe, fact } from '../../skills/project-health/scripts/commands.mjs';
import { extractMeta, attr } from '../../skills/project-health/scripts/lib/html-extract.mjs';
import { probeLive, fetchPage } from '../../skills/project-health/scripts/lib/probe.mjs';
import { summarizeLighthouse, lighthouseCommand } from '../../skills/project-health/scripts/lib/lighthouse.mjs';

const HOME = `<!doctype html><html lang="en"><head>
<title>Acme</title><meta name="description" content="We build brands">
<meta name='theme-color' content='#0a7cff'><meta property="og:title" content="Acme">
<link rel="canonical" href="/"><link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">
<script src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>
</head><body><img src="/logo.svg" class="site-logo" alt="Acme"><img src="/hero.jpg">
<h1>Hi</h1><a href="/about">About</a><a href="/privacy">Privacy policy</a></body></html>`;
const PAGE = (t) => `<html><head><title>${t}</title></head><body><h1>${t}</h1></body></html>`;

let server;
let origin;

before(async () => {
  const routes = {
    '/': { body: HOME },
    '/about': { body: PAGE('About') },
    '/contact': { body: PAGE('Contact') },
    '/privacy': { body: PAGE('Privacy') },
    '/.git/HEAD': { body: 'ref: refs/heads/main\n', type: 'text/plain' },
    '/old': { status: 301, location: '/' },
  };
  server = http.createServer((req, res) => {
    if (req.url === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(`User-agent: *\nSitemap: ${origin}/sitemap.xml\n`); }
    if (req.url === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(`<urlset><url><loc>${origin}/about</loc></url><url><loc>${origin}/contact</loc></url></urlset>`); }
    const r = routes[req.url];
    if (!r) { res.writeHead(404); return res.end('not found'); }
    if (r.location) { res.writeHead(r.status, { location: r.location }); return res.end(); }
    res.writeHead(200, { 'content-type': r.type ?? 'text/html' });
    res.end(r.body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('attr reads double, single and unquoted values', () => {
  assert.equal(attr('<a href="/x">', 'href'), '/x');
  assert.equal(attr("<a href='/y'>", 'href'), '/y');
  assert.equal(attr('<a href=/z>', 'href'), '/z');
  assert.equal(attr('<img data-src="/a">', 'src'), null);
});

test('extractMeta reads the main SEO signals', () => {
  const m = extractMeta(HOME);
  assert.equal(m.title, 'Acme');
  assert.equal(m.metaDescription, 'We build brands');
  assert.equal(m.themeColor, '#0a7cff');
  assert.equal(m.ogTitle, 'Acme');
  assert.equal(m.canonical, '/');
  assert.equal(m.lang, 'en');
  assert.equal(m.h1Count, 1);
  assert.equal(m.imgCount, 2);
  assert.equal(m.imgMissingAlt, 1);
  assert.equal(m.logo, '/logo.svg');
  assert.deepEqual(m.links.map((l) => l.href), ['/about', '/privacy']);
});

test('fetchPage follows and records redirects', async () => {
  const p = await fetchPage(`${origin}/old`);
  assert.equal(p.status, 200);
  assert.equal(p.finalUrl, `${origin}/`);
  assert.equal(p.redirects[0].status, 301);
});

test('probeLive collects pages, exposed files, trackers and legal links', async () => {
  const live = await probeLive(`${origin}/`, { lighthouse: null });
  assert.equal(live.reachable, true);
  assert.deepEqual(live.pages.map((p) => new URL(p.url).pathname), ['/', '/about', '/contact', '/privacy']);
  assert.equal(live.exposed.git, true);
  assert.equal(live.exposed.env, false);
  assert.deepEqual(live.trackers, ['google-analytics']);
  assert.deepEqual(live.consentTools, []);
  assert.equal(live.googleFontsRemote, true);
  assert.equal(live.legalLinks.length, 1);
  assert.equal(live.brand.themeColor, '#0a7cff');
  assert.equal(live.brand.logo, `${origin}/logo.svg`);
  assert.equal(live.securityHeaders['content-security-policy'], null);
  assert.equal(live.tls, null);
  assert.equal(live.dns, null);
  assert.ok(live.skippedChecks.some((s) => s.includes('Lighthouse disabled')));
});

test('an unreachable site is reported, not thrown', async () => {
  const s = http.createServer();
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve));
  const port = s.address().port;
  await new Promise((resolve) => s.close(resolve));
  const live = await probeLive(`http://127.0.0.1:${port}/`, { lighthouse: null });
  assert.equal(live.reachable, false);
  assert.ok(live.skippedChecks[0].includes('unreachable'));
});

test('an invalid URL is rejected with a helpful message', async () => {
  await assert.rejects(probeLive('example.com', { lighthouse: null }), /Invalid URL/);
  await assert.rejects(probeLive('ftp://example.com', { lighthouse: null }), /http/);
});

test('summarizeLighthouse keeps category scores, key metrics and failed audits', () => {
  const s = summarizeLighthouse({
    categories: { performance: { score: 0.42 }, seo: { score: 0.9 } },
    audits: {
      'largest-contentful-paint': { id: 'largest-contentful-paint', title: 'LCP', numericValue: 4800, displayValue: '4.8 s', score: 0.1, scoreDisplayMode: 'numeric' },
      'uses-https': { id: 'uses-https', title: 'Uses HTTPS', score: 1, scoreDisplayMode: 'binary' },
      'is-crawlable': { id: 'is-crawlable', title: 'Page is blocked from indexing', score: 0, scoreDisplayMode: 'binary' },
    },
  });
  assert.deepEqual(s.categories, { performance: 42, seo: 90 });
  assert.equal(s.metrics.lcp.display, '4.8 s');
  assert.deepEqual(s.failedAudits.map((a) => a.id).sort(), ['is-crawlable', 'largest-contentful-paint']);
});

test('lighthouseCommand passes POSIX args unmodified without a shell', () => {
  const c = lighthouseCommand('https://a.test/', '/tmp/o.json', 'linux');
  assert.equal(c.command, 'npx');
  assert.equal(c.shell, false);
  assert.ok(c.args.includes('https://a.test/'));
});

test('lighthouseCommand quotes every Windows argument but not the command name', () => {
  const c = lighthouseCommand('https://a.test/a&calc', 'C:\\Users\\John Smith\\o.json', 'win32');
  assert.equal(c.shell, true);
  assert.deepEqual(c.args, []);
  assert.ok(c.command.startsWith('npx "--yes"'), 'started by a quoted name, npx.cmd looks for its files in the current folder');
  assert.ok(c.command.includes('"https://a.test/a&calc"'));
  assert.ok(c.command.includes('"--output-path=C:\\Users\\John Smith\\o.json"'));
});

test('lighthouseCommand rejects unsafe Windows characters', () => {
  assert.throws(() => lighthouseCommand('https://a.test/%PATH%', 'o.json', 'win32'), /Unsafe character/);
  assert.throws(() => lighthouseCommand('https://a.test/"x', 'o.json', 'win32'), /Unsafe character/);
});

async function serve(handler) {
  const s = http.createServer(handler);
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${s.address().port}/`, close: () => s.close() };
}

test('a non-2xx home page (WAF challenge) is marked blocked but keeps header data', async () => {
  const site = await serve((req, res) => {
    res.writeHead(req.url === '/' ? 403 : 404, { 'content-type': 'text/html', 'x-frame-options': 'DENY' });
    res.end('<html><head><title>Just a moment...</title><meta name="robots" content="noindex"></head><body>Checking your browser</body></html>');
  });
  try {
    const live = await probeLive(site.url, { lighthouse: null });
    assert.equal(live.reachable, true);
    assert.equal(live.blocked, true);
    assert.equal(live.home.status, 403);
    assert.equal(live.securityHeaders['x-frame-options'], 'DENY');
    assert.ok(live.skippedChecks.includes('Live site returned HTTP 403 for the home page — page-content checks are unverified'));
  } finally { site.close(); }
});

test('fragment links are not fetched as separate pages and non-HTML responses are not summarised', async () => {
  const site = await serve((req, res) => {
    const types = { '/': 'text/html', '/a': 'text/html; charset=utf-8', '/doc.pdf': 'application/pdf', '/img.png': 'image/png' };
    if (!types[req.url]) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[req.url] });
    res.end(req.url === '/' ? '<html><body><a href="/a">A</a><a href="/a#team">Team</a><a href="/#top">Top</a><a href="/doc.pdf">PDF</a><a href="/img.png">Image</a></body></html>' : PAGE('A'));
  });
  try {
    const live = await probeLive(site.url, { lighthouse: null });
    assert.equal(live.blocked, false);
    assert.deepEqual(live.pages.map((p) => new URL(p.url).pathname), ['/', '/a']);
  } finally { site.close(); }
});

test('probe takes the brand name from og:site_name unless a human set brand.name', async () => {
  const site = await serve((req, res) => {
    if (req.url !== '/') { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><head><title>Home</title><meta property="og:site_name" content="Acme Live"></head><body><h1>Hi</h1></body></html>');
  });
  try {
    const brandAfterProbe = async (root) => {
      const { run, runDir } = init({ root });
      await probe({ root, run, url: site.url, 'no-lighthouse': true });
      return JSON.parse(fs.readFileSync(path.join(runDir, 'profile.json'), 'utf8')).brand.name;
    };
    assert.equal(await brandAfterProbe(tmpDir()), 'Acme Live');
    const human = tmpDir();
    fact({ root: human, key: 'brand.name', value: 'Human Co' });
    assert.equal(await brandAfterProbe(human), 'Human Co');
  } finally { site.close(); }
});
