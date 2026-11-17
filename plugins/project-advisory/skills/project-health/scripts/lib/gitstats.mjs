import { execFileSync } from 'node:child_process';

const LOCKFILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|bun\.lockb?)$/;
const DAY = 86400000;

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}

export function parseLog(text) {
  return String(text).split('\x1e').filter((c) => c.trim()).map((chunk) => {
    const [head, ...rest] = chunk.split('\n');
    const [sha, subject = ''] = head.split('\x1f');
    const changes = rest.map((l) => l.trim()).filter(Boolean).map((l) => {
      const parts = l.split('\t');
      return { status: parts[0][0], path: parts[parts.length - 1] };
    });
    return { sha: sha.trim(), subject: subject.trim(), changes };
  });
}

export function changePattern({ status, path: p }) {
  if (status !== 'A') return p;
  const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.';
  const ext = /\.[^./]+$/.exec(p)?.[0] ?? '';
  return `${dir}/*${ext}`;
}

export function recurringChangeSets(commits, min = 3) {
  const groups = new Map();
  for (const c of commits) {
    const patterns = [...new Set(c.changes.filter((ch) => !LOCKFILES.test(ch.path)).map(changePattern))].sort();
    if (!patterns.length || patterns.length > 10) continue;
    if (patterns.length < 2 && !patterns[0].includes('*')) continue;
    const key = patterns.join(' + ');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(`${c.sha} ${c.subject}`);
  }
  return [...groups]
    .filter(([, examples]) => examples.length >= min)
    .map(([key, examples]) => ({ patterns: key.split(' + '), count: examples.length, examples: examples.slice(0, 5) }))
    .sort((a, b) => b.count - a.count);
}

export function subjectClusters(commits, min = 3) {
  const groups = new Map();
  for (const c of commits) {
    const words = c.subject.toLowerCase().replace(/^[a-z]+(\([^)]*\))?!?:\s*/, '').match(/[a-z]+/g) ?? [];
    if (words.length < 2) continue;
    const phrase = words.slice(0, 2).join(' ');
    if (!groups.has(phrase)) groups.set(phrase, []);
    groups.get(phrase).push(`${c.sha} ${c.subject}`);
  }
  return [...groups]
    .filter(([, examples]) => examples.length >= min)
    .map(([phrase, examples]) => ({ phrase, count: examples.length, examples: examples.slice(0, 5) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

export function gitLsFiles(root) {
  try {
    return git(root, ['ls-files', '-z']).split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

export function gitSummary(root) {
  const safe = (args, fallback = '') => { try { return git(root, args); } catch { return fallback; } };
  const commits = parseLog(safe(['log', '--no-merges', '-n', '500', '--name-status', '--pretty=format:%x1e%h%x1f%s']));
  const refs = safe(['for-each-ref', '--format=%(refname:short)%09%(committerdate:iso-strict)', 'refs/heads', 'refs/remotes'])
    .split('\n').filter(Boolean).map((l) => { const [name, date] = l.split('\t'); return { name, date }; });
  const now = Date.now();
  return {
    totalCommits: Number(safe(['rev-list', '--count', 'HEAD'], '0').trim()) || 0,
    authors: safe(['shortlog', '-sn', 'HEAD']).split('\n').filter((l) => l.trim()).length,
    lastCommit: safe(['log', '-1', '--format=%cI']).trim() || null,
    branches: refs.map((r) => r.name),
    staleBranches: refs.filter((r) => now - Date.parse(r.date) > 90 * DAY).map((r) => r.name),
    recentSubjects: commits.slice(0, 30).map((c) => c.subject),
    recurringChangeSets: recurringChangeSets(commits),
    subjectClusters: subjectClusters(commits),
  };
}
