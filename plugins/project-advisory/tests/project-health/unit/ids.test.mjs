import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assignIds, normalizeRef, identityKey } from '../../../skills/project-health/scripts/lib/ids.mjs';

const f = (over = {}) => ({ rule: 'seo.missing-meta-description', subject: 'site', area: 'seo', title: 't', evidence: [{ type: 'url', ref: 'https://a.test/x' }], ...over });

test('normalizeRef strips line numbers, ./ and backslashes from file refs', () => {
  assert.equal(normalizeRef('./src\\pages\\about.html:12'), 'src/pages/about.html');
  assert.equal(normalizeRef('src/app.js:10-20'), 'src/app.js');
  assert.equal(normalizeRef('src/app.js#L4-L9'), 'src/app.js');
});

test('normalizeRef strips query, fragment and trailing slash from URLs and lowercases the host', () => {
  assert.equal(normalizeRef('https://Example.COM/About/?utm=1#top'), 'example.com/About');
  assert.equal(normalizeRef('https://example.com'), 'example.com/');
});

test('ids have the area prefix and 4 hex characters', () => {
  const [a] = assignIds([f()]);
  assert.match(a.id, /^SEO-[0-9a-f]{4}$/);
  const [b] = assignIds([f({ area: 'security', rule: 'security.secret-in-repo' })]);
  assert.match(b.id, /^SEC-[0-9a-f]{4}$/);
});

test('the id ignores title, evidence and line-number changes in the subject', () => {
  const [a] = assignIds([f({ subject: 'src/a.html:12' })]);
  const [b] = assignIds([f({ subject: './src/a.html:40', title: 'other words', evidence: [{ type: 'url', ref: 'https://a.test/1' }, { type: 'url', ref: 'https://a.test/2' }, { type: 'url', ref: 'https://a.test/3' }] })]);
  assert.equal(a.id, b.id);
});

test('different rules or subjects give different ids', () => {
  const [a, b, c] = assignIds([f(), f({ rule: 'seo.missing-title' }), f({ subject: '/pricing' })]);
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.id, c.id);
});

test('colliding short hashes are extended to 6 characters', () => {
  const seen = new Map();
  let pair = null;
  for (let i = 0; i < 20000 && !pair; i++) {
    const x = f({ subject: `page-${i}` });
    const short = createHash('sha1').update(identityKey(x)).digest('hex').slice(0, 4);
    if (seen.has(short)) pair = [seen.get(short), x];
    else seen.set(short, x);
  }
  assert.ok(pair, 'expected to find a 4-hex collision');
  const [a, b] = assignIds(pair);
  assert.match(a.id, /^SEO-[0-9a-f]{6}$/);
  assert.match(b.id, /^SEO-[0-9a-f]{6}$/);
  assert.notEqual(a.id, b.id);
});

test('a short-hash collision in another area does not lengthen an id', () => {
  const short = (x) => createHash('sha1').update(identityKey(x)).digest('hex').slice(0, 4);
  const seo = new Map();
  for (let i = 0; i < 5000; i++) { const x = f({ subject: `page-${i}` }); seo.set(short(x), x); }
  let pair = null;
  for (let i = 0; i < 20000 && !pair; i++) {
    const y = f({ area: 'security', rule: 'security.secret-in-repo', subject: `file-${i}` });
    if (seo.has(short(y))) pair = [seo.get(short(y)), y];
  }
  assert.ok(pair, 'expected to find a cross-area 4-hex collision');
  const [a, b] = assignIds(pair);
  assert.match(a.id, /^SEO-[0-9a-f]{4}$/);
  assert.match(b.id, /^SEC-[0-9a-f]{4}$/);
});
