import tls from 'node:tls';
import net from 'node:net';
import dns from 'node:dns/promises';
import { extractMeta } from './html-extract.mjs';

const SECURITY_HEADERS = ['strict-transport-security', 'content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy'];
const KEPT_HEADERS = [...new Set([...SECURITY_HEADERS, 'cache-control', 'content-encoding', 'server', 'x-powered-by', 'x-robots-tag', 'alt-svc', 'cf-cache-status', 'x-vercel-cache', 'x-nf-request-id', 'via', 'age'])];
const TRACKERS = {
  'google-analytics': /google-analytics\.com|googletagmanager\.com/i,
  'meta-pixel': /connect\.facebook\.net/i,
  hotjar: /hotjar\.com/i,
  clarity: /clarity\.ms/i,
  linkedin: /snap\.licdn\.com/i,
  tiktok: /analytics\.tiktok\.com/i,
  plausible: /plausible\.io/i,
  matomo: /matomo|piwik/i,
  fathom: /usefathom\.com/i,
};
const CONSENT = {
  cookiebot: /cookiebot/i, onetrust: /onetrust|cookielaw\.org/i, usercentrics: /usercentrics/i, cookieyes: /cookieyes/i,
  iubenda: /iubenda/i, complianz: /complianz/i, klaro: /klaro/i, termly: /termly/i, osano: /osano/i, borlabs: /borlabs/i,
};
const MONITORING = { sentry: /sentry/i, bugsnag: /bugsnag/i, logrocket: /logrocket/i, datadog: /datadoghq|dd-rum/i, newrelic: /newrelic|nr-data/i };
const LEGAL_RE = /privacy|datenschutz|imprint|impressum|cookie|terms|legal|agb/i;

export async function fetchPage(url, { fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  const redirects = [];
  const started = Date.now();
  let current = url;
  for (let i = 0; i < 10; i++) {
    const res = await fetchImpl(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'project-health/0.1 (site audit)' },
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      const next = new URL(location, current).href;
      redirects.push({ from: current, to: next, status: res.status });
      current = next;
      continue;
    }
    const body = await res.text();
    return {
      url, finalUrl: current, status: res.status, redirects,
      headers: Object.fromEntries(res.headers), ms: Date.now() - started,
      bytes: Buffer.byteLength(body), body: body.slice(0, 2_000_000),
    };
  }
  throw new Error(`Too many redirects starting at ${url}`);
}

export function checkTls(host, port = 443, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const cert = socket.getPeerCertificate();
      const validTo = new Date(cert.valid_to);
      const result = {
        authorized: socket.authorized,
        authorizationError: socket.authorizationError ? String(socket.authorizationError) : null,
        protocol: socket.getProtocol(),
        issuer: cert.issuer?.O ?? cert.issuer?.CN ?? null,
        validTo: Number.isNaN(validTo.getTime()) ? null : validTo.toISOString(),
        daysLeft: Number.isNaN(validTo.getTime()) ? null : Math.floor((validTo.getTime() - Date.now()) / 86400000),
      };
      socket.end();
      resolve(result);
    });
    socket.on('timeout', () => { socket.destroy(); reject(new Error('TLS connection timed out')); });
    socket.on('error', reject);
  });
}

export async function checkDns(hostname, resolver = dns) {
  const domain = hostname.replace(/^www\./, '');
  const txt = async (name) => { try { return (await resolver.resolveTxt(name)).map((r) => r.join('')); } catch { return []; } };
  const mx = await resolver.resolveMx(domain).then((r) => r.length > 0).catch(() => false);
  return {
    domain,
    mx,
    spf: (await txt(domain)).some((t) => t.startsWith('v=spf1')),
    dmarc: (await txt(`_dmarc.${domain}`)).some((t) => t.startsWith('v=DMARC1')),
  };
}

function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
}

function isHtml(p) {
  const type = p.headers['content-type'];
  return !type || /html/i.test(type);
}

function summarizePage(p, m) {
  const https = p.finalUrl.startsWith('https:');
  const insecure = [...m.scripts, ...m.stylesheets, ...m.images].filter((u) => /^http:\/\//i.test(u)).length;
  return {
    url: p.finalUrl, status: p.status, ms: p.ms, bytes: p.bytes,
    title: m.title, metaDescription: m.metaDescription, canonical: m.canonical,
    robotsMeta: m.robots, xRobotsTag: p.headers['x-robots-tag'] ?? null, lang: m.lang,
    h1Count: m.h1Count, hasOgTitle: Boolean(m.ogTitle), hasOgImage: Boolean(m.ogImage), ldJsonCount: m.ldJsonCount,
    imgCount: m.imgCount, imgMissingAlt: m.imgMissingAlt, mixedContent: https ? insecure : 0,
    scripts: m.scripts, stylesheets: m.stylesheets, generator: m.generator,
  };
}

export async function probeLive(url, { fetchImpl = fetch, maxPages = 10, tlsCheck = checkTls, dnsCheck = checkDns, lighthouse = null } = {}) {
  let base;
  try { base = new URL(url); } catch { throw new Error(`Invalid URL "${url}". Use a full address such as https://example.com`); }
  if (!/^https?:$/.test(base.protocol)) throw new Error(`Unsupported URL "${url}". Only http:// and https:// addresses can be checked.`);

  const errors = [];
  const skippedChecks = [];
  const safe = async (label, fn) => { try { return await fn(); } catch (e) { errors.push(`${label}: ${e.message}`); return null; } };
  const get = (u) => fetchPage(u, { fetchImpl });

  const home = await safe('home', () => get(base.href));
  if (!home) return { url: base.href, reachable: false, errors, skippedChecks: ['Live site unreachable — all live checks skipped'] };

  const blocked = home.status < 200 || home.status >= 300;
  if (blocked) skippedChecks.push(`Live site returned HTTP ${home.status} for the home page — page-content checks are unverified`);
  const final = new URL(home.finalUrl);
  const origin = final.origin;
  const homeMeta = extractMeta(home.body);
  const isIp = net.isIP(final.hostname) !== 0 || final.hostname === 'localhost';

  const httpRedirect = base.protocol === 'https:'
    ? await safe('http redirect', async () => { const r = await get(`http://${base.host}/`); return { status: r.status, redirectsToHttps: r.finalUrl.startsWith('https://') }; })
    : null;
  const tlsInfo = final.protocol === 'https:' ? await safe('tls', () => tlsCheck(final.hostname)) : null;
  const dnsInfo = isIp ? null : await safe('dns', () => dnsCheck(final.hostname));

  const robots = await safe('robots.txt', () => get(`${origin}/robots.txt`));
  const sitemapUrls = robots?.status === 200 ? [...robots.body.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]) : [];
  if (!sitemapUrls.length) sitemapUrls.push(`${origin}/sitemap.xml`);
  let sitemap = await safe('sitemap', () => get(sitemapUrls[0]));
  let locs = sitemap?.status === 200 ? [...sitemap.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]) : [];
  if (locs.length && locs.every((u) => u.endsWith('.xml'))) {
    const child = await safe('child sitemap', () => get(locs[0]));
    if (child?.status === 200) { sitemap = child; locs = [...child.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]); }
  }

  const sameOrigin = (u) => { try { return new URL(u, origin).origin === origin; } catch { return false; } };
  const candidates = [
    ...locs.filter((u) => sameOrigin(u) && !u.endsWith('.xml')),
    ...homeMeta.links.map((l) => l.href).filter((h) => sameOrigin(h) && !h.startsWith('#')).map((h) => new URL(h, origin).href),
  ];
  const withoutHash = (u) => { const x = new URL(u, origin); x.hash = ''; return x.href; };
  const pageUrls = [...new Set(candidates.map(withoutHash))].filter((u) => u !== home.finalUrl).slice(0, maxPages - 1);

  const pages = [summarizePage(home, homeMeta)];
  for (const u of pageUrls) {
    const p = await safe(`page ${u}`, () => get(u));
    if (p && isHtml(p)) pages.push(summarizePage(p, extractMeta(p.body)));
  }

  const exposed = {};
  for (const [name, p, looksReal] of [
    ['git', '/.git/HEAD', (b) => /^ref:\s/.test(b)],
    ['env', '/.env', (b) => /^[A-Z_][A-Z0-9_]*=/m.test(b) && !/<html/i.test(b)],
  ]) {
    const r = await safe(`exposed ${p}`, () => get(`${origin}${p}`));
    exposed[name] = Boolean(r && r.status === 200 && looksReal(r.body));
  }

  const allScripts = pages.flatMap((p) => p.scripts);
  const detect = (map) => Object.keys(map).filter((k) => map[k].test(home.body) || allScripts.some((s) => map[k].test(s)));
  const thirdPartyHosts = [...new Set(allScripts.map((s) => { try { return new URL(s, origin).host; } catch { return null; } }))]
    .filter((h) => h && h !== final.host);

  let lighthouseResult = null;
  if (!lighthouse) skippedChecks.push('Lighthouse disabled — performance metrics come from code inspection');
  else {
    lighthouseResult = await safe('lighthouse', () => lighthouse(home.finalUrl));
    if (!lighthouseResult) skippedChecks.push('Lighthouse failed — performance metrics come from code inspection');
  }

  return {
    url: base.href,
    finalUrl: home.finalUrl,
    reachable: true,
    blocked,
    fetchedAt: new Date().toISOString(),
    home: { status: home.status, redirects: home.redirects, ms: home.ms, bytes: home.bytes, headers: pick(home.headers, KEPT_HEADERS) },
    httpRedirect,
    tls: tlsInfo,
    dns: dnsInfo,
    securityHeaders: Object.fromEntries(SECURITY_HEADERS.map((h) => [h, home.headers[h] ?? null])),
    robots: robots ? { status: robots.status, body: robots.body.slice(0, 5000) } : null,
    sitemap: sitemap ? { url: sitemapUrls[0], status: sitemap.status, urlCount: locs.length } : null,
    pages,
    exposed,
    trackers: detect(TRACKERS),
    consentTools: detect(CONSENT),
    monitoring: detect(MONITORING),
    thirdPartyHosts,
    googleFontsRemote: /fonts\.(googleapis|gstatic)\.com/i.test(home.body),
    legalLinks: homeMeta.links.filter((l) => LEGAL_RE.test(`${l.href} ${l.text}`)).slice(0, 10),
    brand: {
      name: homeMeta.siteName,
      themeColor: homeMeta.themeColor,
      logo: homeMeta.logo ? new URL(homeMeta.logo, origin).href : null,
    },
    lighthouse: lighthouseResult,
    skippedChecks,
    errors,
  };
}
