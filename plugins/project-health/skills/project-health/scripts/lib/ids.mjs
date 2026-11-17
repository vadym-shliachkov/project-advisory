import { createHash } from 'node:crypto';
import { AREA_PREFIX } from './areas.mjs';

export function normalizeRef(ref) {
  const r = String(ref).trim().replace(/\\/g, '/');
  if (/^https?:\/\//i.test(r)) {
    try {
      const u = new URL(r);
      return `${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '') || '/'}`;
    } catch {
      return r.toLowerCase();
    }
  }
  return r
    .replace(/#L\d+(-L?\d+)?$/i, '')
    .replace(/:\d+(-\d+)?(:\d+)?$/, '')
    .replace(/^\.\//, '');
}

export function identityKey(finding) {
  return `${finding.rule}|${normalizeRef(finding.subject)}`;
}

function fullHash(finding) {
  return createHash('sha1').update(identityKey(finding)).digest('hex');
}

// `previous` holds findings from earlier runs: a finding with the same rule and subject keeps its earlier id, so an
// id never changes length because a colliding finding appeared later.
export function assignIds(findings, previous = []) {
  const known = new Map(previous.map((f) => [identityKey(f), f.id]));
  const reused = findings.map((f) => known.get(identityKey(f)) ?? null);
  const taken = new Set(reused.filter(Boolean));
  const hashes = findings.map(fullHash);
  // Keyed by area prefix + short hash: only findings that would get the same id are lengthened.
  const shortKey = (i) => `${AREA_PREFIX[findings[i].area]}-${hashes[i].slice(0, 4)}`;
  const byShort = new Map();
  hashes.forEach((h, i) => {
    if (reused[i]) return;
    const key = shortKey(i);
    if (!byShort.has(key)) byShort.set(key, new Set());
    byShort.get(key).add(h);
  });
  return findings.map((finding, i) => {
    if (reused[i]) return { id: reused[i], ...finding };
    const prefix = AREA_PREFIX[finding.area];
    const h = hashes[i];
    const clash = byShort.get(shortKey(i)).size > 1 || taken.has(shortKey(i));
    const id = [4, 6, 8].map((len) => `${prefix}-${h.slice(0, len)}`).find((x, n) => (n > 0 || !clash) && !taken.has(x));
    taken.add(id);
    return { id, ...finding };
  });
}
