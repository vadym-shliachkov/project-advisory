import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { tmpDir, hasGit } from '../helpers.mjs';
import { makeStaticHtmlRepo, FAKE_AWS_KEY } from '../fixtures/make-static-html-repo.mjs';
import { scanText, scanFiles, mask, envFiles, scanHistory } from '../../../skills/project-health/scripts/lib/secrets.mjs';
import { parseLog, changePattern, recurringChangeSets, subjectClusters } from '../../../skills/project-health/scripts/lib/gitstats.mjs';
import { structureClusters, inventory, summarizeNpmAudit, runCollect } from '../../../skills/project-health/scripts/lib/collect.mjs';
import { buildProfile } from '../../../skills/project-health/scripts/lib/detect.mjs';
import { isGitRepo } from '../../../skills/project-health/scripts/lib/tools.mjs';

test('scanText finds an AWS key and masks it (review focus 5)', () => {
  const hits = scanText(`KEY=${FAKE_AWS_KEY}\n`, '.env');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].type, 'aws-access-key');
  assert.equal(hits[0].line, 1);
  assert.ok(!JSON.stringify(hits).includes(FAKE_AWS_KEY));
});

test('mask reveals less of short values', () => {
  assert.equal(mask('abcdefgh'), '****');
  assert.equal(mask('abcdefghijkl'), 'ab…kl (12 chars)');
  assert.equal(mask('abcdefghijklmnopqrs'), 'ab…rs (19 chars)');
  assert.equal(mask(FAKE_AWS_KEY), 'AKIA…LE (20 chars)');
});

test('generic secrets match prefixed names and skip placeholders', () => {
  assert.equal(scanText('API_SECRET="fixture-only-not-a-secret-1234"', 'a.env')[0]?.type, 'generic-secret');
  assert.deepEqual(scanText('password = process.env.DB_PASSWORD_VALUE', 'a.js'), []);
  assert.deepEqual(scanText('token: "your-token-goes-here"', 'a.yml'), []);
});

test('envFiles ignores examples', () => {
  assert.deepEqual(envFiles(['.env', '.env.production', '.env.example', 'app/.env.local', 'env.js']), ['.env', '.env.production', 'app/.env.local']);
});

test('parseLog and changePattern', () => {
  const text = '\x1eabc1234\x1fadd page team\nA\tpages/team.html\nM\tindex.html\n\n\x1edef5678\x1fRename\nR100\told.html\tnew.html\n';
  const commits = parseLog(text);
  assert.equal(commits.length, 2);
  assert.deepEqual(commits[0].changes, [{ status: 'A', path: 'pages/team.html' }, { status: 'M', path: 'index.html' }]);
  assert.equal(commits[1].changes[0].path, 'new.html');
  assert.equal(changePattern({ status: 'A', path: 'pages/team.html' }), 'pages/*.html');
  assert.equal(changePattern({ status: 'A', path: 'README' }), './*');
  assert.equal(changePattern({ status: 'M', path: 'index.html' }), 'index.html');
});

test('recurring change sets and subject clusters need at least 3 occurrences', () => {
  const mk = (sha, subject, changes) => ({ sha, subject, changes });
  const commits = ['a', 'b', 'c'].map((s, i) => mk(s, `feat: add page p${i}`, [{ status: 'A', path: `pages/p${i}.html` }, { status: 'M', path: 'index.html' }]));
  commits.push(mk('d', 'fix typo', [{ status: 'M', path: 'index.html' }]));
  const sets = recurringChangeSets(commits);
  assert.equal(sets.length, 1);
  assert.deepEqual(sets[0].patterns, ['index.html', 'pages/*.html']);
  assert.equal(sets[0].count, 3);
  assert.deepEqual(subjectClusters(commits).map((c) => [c.phrase, c.count]), [['add page', 3]]);
});

test('structureClusters groups same-type files per folder', () => {
  const files = Array.from({ length: 6 }, (_, i) => `content/blog/post-${i}.md`).concat(['a.css']);
  assert.deepEqual(structureClusters(files).map((c) => [c.pattern, c.count]), [['content/blog/*.md', 6]]);
});

test('inventory finds AGENTS.md, CI and lint config', () => {
  const inv = inventory(['AGENTS.md', '.github/workflows/ci.yml', 'eslint.config.js', '.editorconfig', 'README.md', 'package-lock.json']);
  assert.deepEqual(inv.agents, ['AGENTS.md']);
  assert.deepEqual(inv.ci, ['.github/workflows/ci.yml']);
  assert.deepEqual(inv.lintConfig, ['eslint.config.js']);
  assert.deepEqual(inv.editorconfig, ['.editorconfig']);
  assert.deepEqual(inventory(['.editorconfig']).lintConfig, [], 'an .editorconfig alone is not lint configuration');
  assert.deepEqual(inv.readme, ['README.md']);
  assert.equal(inv.gitignore, false);
});

test('summarizeNpmAudit keeps counts and advisory titles', () => {
  const s = summarizeNpmAudit({
    metadata: { vulnerabilities: { high: 1, critical: 0 } },
    vulnerabilities: { lodash: { name: 'lodash', severity: 'high', via: [{ title: 'Prototype pollution' }, 'other-pkg'] } },
  });
  assert.deepEqual(s, { counts: { high: 1, critical: 0 }, packages: [{ name: 'lodash', severity: 'high', advisories: ['Prototype pollution'] }] });
});

test('runCollect on the fixture repo finds recurring commits and masked secrets', { skip: !hasGit && 'git not installed' }, () => {
  const root = makeStaticHtmlRepo(path.join(tmpDir(), 'site'));
  const data = runCollect(root, buildProfile(root));
  assert.ok(data.git.totalCommits >= 5);
  assert.ok(data.git.recurringChangeSets.some((s) => s.patterns.includes('pages/*.html') && s.count === 3));
  assert.deepEqual(data.secrets.trackedEnvFiles, ['.env.production']);
  assert.ok(data.secrets.files.some((h) => h.type === 'aws-access-key' && h.file === '.env.production'));
  assert.ok(data.secrets.history.some((h) => h.type === 'aws-access-key'));
  assert.ok(!JSON.stringify(data).includes(FAKE_AWS_KEY), 'collect output must not contain the raw secret');
});

test('failed git scans return null and are recorded as skipped checks', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
  assert.equal(scanHistory(dir), null);
  const data = runCollect(dir, { ...buildProfile(dir), isGitRepo: true });
  assert.deepEqual(data.secrets.history, []);
  assert.ok(data.skippedChecks.includes('Committed-file checks skipped (committed .env files, build artifacts) — git ls-files failed'));
  assert.ok(data.skippedChecks.includes('Secrets in git history not checked — git log failed or its output was too large'));
});

test('outside a git repository, local .env files and logs are not reported as committed', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'index.html'), '<title>A</title>');
  fs.writeFileSync(path.join(dir, '.env'), `KEY=${FAKE_AWS_KEY}\n`);
  fs.writeFileSync(path.join(dir, 'debug.log'), 'x\n');
  fs.writeFileSync(path.join(dir, 'config.php'), `<?php $key = '${FAKE_AWS_KEY}';\n`);
  const data = runCollect(dir, buildProfile(dir));
  assert.equal(data.secrets.trackedEnvFiles, null);
  assert.equal(data.committedArtifacts, null);
  assert.equal(data.secrets.scope, 'working-tree');
  assert.deepEqual(data.secrets.workingTreeEnvFiles, ['.env']);
  assert.deepEqual(data.secrets.files.map((h) => h.file), ['config.php'], 'project files are still scanned, local .env files are not');
});

test('generic secrets ignore code expressions, config names and URLs', () => {
  for (const [line, file] of [
    ['  password: req.body.password,', 'a.js'],
    ["const token = localStorage.getItem('t')", 'a.js'],
    ['apiKey: config.apiKey,', 'a.js'],
    ["const API_TOKEN_URL = 'https://auth.example.com/oauth'", 'a.js'],
    ['password = getPasswordFromVault', 'a.py'],
    ['resetTokenExpiry: 3600000000000,', 'a.js'],
    ['csrfToken: req.csrfToken(),', 'a.js'],
    ['  password: ${DB_PASSWORD}', 'docker-compose.yml'],
    ['DATABASE_URL=postgres://user:password@localhost/app', '.env'],
  ]) assert.deepEqual(scanText(line, file), [], line);
});

test('generic secrets find literals in code, JSON keys and bare values in config files', () => {
  for (const [line, file, type] of [
    ["const password = 'hunter2hunter2'", 'a.js', 'generic-secret'],
    ['"apiKey": "a1b2c3d4e5f6g7h8i9"', 'config.json', 'generic-secret'],
    ['SECRET_KEY=thisismysecretkeyvalue', '.env', 'generic-secret'],
    ['  password: s3cr3tPassw0rdValue', 'docker-compose.yml', 'generic-secret'],
    ['//registry.npmjs.org/:_authToken=abcdef0123456789abcdef', '.npmrc', 'generic-secret'],
    ['DATABASE_URL=postgres://app:Xy7pLm2qRs@db.internal/app', '.env', 'url-credentials'],
    ['-----BEGIN ENCRYPTED PRIVATE KEY-----', 'k.pem', 'private-key'],
  ]) assert.equal(scanText(line, file)[0]?.type, type, line);
});

test('key and credential files are scanned', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'server.pem'), '-----BEGIN RSA PRIVATE KEY-----\nabc\n');
  fs.writeFileSync(path.join(dir, '.npmrc'), `//registry.npmjs.org/:_authToken=npm_${'a1'.repeat(18)}\n`);
  assert.deepEqual(scanFiles(dir, ['server.pem', '.npmrc']).map((h) => [h.file, h.type]), [['server.pem', 'private-key'], ['.npmrc', 'npm-token']]);
});

test('isGitRepo is true only at the top level of a repository, not in a folder inside one', { skip: !hasGit && 'git not installed' }, () => {
  const top = tmpDir();
  execFileSync('git', ['-C', top, 'init', '-q'], { stdio: 'pipe' });
  const sub = path.join(top, 'site');
  fs.mkdirSync(sub);
  assert.equal(isGitRepo(top), true);
  assert.equal(isGitRepo(sub), false);
  if (process.platform === 'win32') assert.equal(isGitRepo(top.toUpperCase()), true);
});

test('history scan attributes files even when the repo sets diff.noprefix', { skip: !hasGit && 'git not installed' }, () => {
  const dir = tmpDir();
  const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { stdio: 'pipe' });
  git('init', '-q');
  git('config', 'diff.noprefix', 'true');
  fs.writeFileSync(path.join(dir, 'config.env'), `KEY=${FAKE_AWS_KEY}\n`);
  git('add', '-A');
  git('commit', '-q', '-m', 'add config');
  const hits = scanHistory(dir);
  assert.deepEqual(hits.map((h) => [h.file, h.type]), [['config.env', 'aws-access-key']]);
});

test('a history longer than the scan limit is recorded as a skipped check', { skip: !hasGit && 'git not installed' }, () => {
  const root = makeStaticHtmlRepo(path.join(tmpDir(), 'site'));
  const profile = buildProfile(root);
  const note = (n) => `Secrets in git history: only the latest ${n} commits were scanned`;
  assert.ok(!runCollect(root, profile).skippedChecks.some((s) => s.startsWith('Secrets in git history: only')));
  assert.ok(runCollect(root, profile, { historyLimit: 3 }).skippedChecks.includes(note(3)));
});

test('scanFiles skips a file it cannot read instead of aborting', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'locked.env'), 'x');
  fs.writeFileSync(path.join(dir, 'ok.env'), `KEY=${FAKE_AWS_KEY}\n`);
  const read = [];
  const readFile = (p, enc) => {
    read.push(path.basename(p));
    if (p.endsWith('locked.env')) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
    return fs.readFileSync(p, enc);
  };
  assert.deepEqual(scanFiles(dir, ['locked.env', 'ok.env'], { readFile }).map((h) => h.file), ['ok.env']);
  assert.deepEqual(read, ['locked.env', 'ok.env']);
});
