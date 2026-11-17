import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readJson } from './io.mjs';
import { listFiles } from './files.mjs';
import { scanFiles, scanHistory, envFiles, HISTORY_LIMIT } from './secrets.mjs';
import { gitLsFiles, gitSummary } from './gitstats.mjs';

const FRAMEWORKS = ['next', 'react', 'vue', 'nuxt', 'astro', 'svelte', '@sveltejs/kit', 'gatsby', '@angular/core', 'jquery', 'bootstrap', 'tailwindcss', 'vite', 'webpack'];
const ARTIFACT_PATTERNS = {
  'node_modules/': /(^|\/)node_modules\//,
  'dist/ or build/': /(^|\/)(dist|build)\//,
  '.DS_Store / Thumbs.db': /(^|\/)(\.DS_Store|Thumbs\.db)$/,
  'log files': /\.log$/,
};

export function structureClusters(files, min = 5) {
  const groups = new Map();
  for (const f of files) {
    const ext = /\.[^./]+$/.exec(f)?.[0];
    if (!ext) continue;
    const i = f.lastIndexOf('/');
    const key = `${i < 0 ? '.' : f.slice(0, i)}/*${ext}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  return [...groups]
    .filter(([, list]) => list.length >= min)
    .map(([pattern, list]) => ({ pattern, count: list.length, sample: list.slice(0, 3) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);
}

export function largeFiles(root, files, limitBytes = 1_000_000) {
  const out = [];
  for (const f of files) {
    try {
      const { size } = fs.statSync(path.join(root, f));
      if (size > limitBytes) out.push({ path: f, bytes: size });
    } catch { /* deleted or unreadable */ }
  }
  return out.sort((a, b) => b.bytes - a.bytes).slice(0, 20);
}

export function committedArtifacts(tracked) {
  return Object.entries(ARTIFACT_PATTERNS)
    .map(([label, re]) => ({ label, count: tracked.filter((f) => re.test(f)).length }))
    .filter((x) => x.count > 0);
}

export function inventory(files) {
  const has = (re) => files.filter((f) => re.test(f));
  return {
    readme: has(/^readme(\.\w+)?$/i),
    license: has(/^(license|licence)(\.\w+)?$/i),
    changelog: has(/^changelog(\.\w+)?$/i),
    gitignore: files.includes('.gitignore'),
    envExample: has(/(^|\/)\.env\.(example|sample|template)$/),
    ci: has(/^\.github\/workflows\/.+\.ya?ml$|^\.gitlab-ci\.yml$|^bitbucket-pipelines\.yml$|^\.circleci\/config\.yml$|^azure-pipelines\.yml$/),
    agents: has(/(^|\/)(AGENTS|CLAUDE)\.md$/),
    claudeConfig: has(/^\.claude\//),
    codexConfig: has(/^\.codex\//),
    cursorRules: has(/^\.cursor\/rules\/|^\.cursorrules$/),
    mcpConfig: has(/(^|\/)\.mcp\.json$/),
    lintConfig: has(/(^|\/)(\.eslintrc(\.\w+)?|eslint\.config\.\w+|\.prettierrc(\.\w+)?|prettier\.config\.\w+|biome\.jsonc?|\.stylelintrc(\.\w+)?|phpcs\.xml(\.dist)?)$/),
    editorconfig: has(/(^|\/)\.editorconfig$/),
    lockfiles: has(/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|bun\.lockb?)$/),
    tests: has(/(^|\/)(__tests__|tests?|spec|e2e)\/|\.(test|spec)\.\w+$/).slice(0, 20),
    hostingConfig: has(/(^|\/)(netlify\.toml|vercel\.json|Dockerfile|docker-compose\.ya?ml|fly\.toml|render\.yaml|app\.yaml|\.htaccess|nginx\.conf|wrangler\.toml|firebase\.json|CNAME)$/),
  };
}

export function runtimes(root) {
  const pkg = readJson(path.join(root, 'package.json'), null);
  const composer = readJson(path.join(root, 'composer.json'), null);
  const readTrim = (rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8').trim(); } catch { return null; } };
  const allDeps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  return {
    node: pkg?.engines?.node ?? readTrim('.nvmrc') ?? readTrim('.node-version'),
    php: composer?.require?.php ?? null,
    wordpress: /\$wp_version\s*=\s*'([^']+)'/.exec(readTrim('wp-includes/version.php') ?? '')?.[1] ?? null,
    frameworks: Object.fromEntries(FRAMEWORKS.filter((n) => n in allDeps).map((n) => [n, allDeps[n]])),
  };
}

export function summarizeNpmAudit(json) {
  return {
    counts: json.metadata?.vulnerabilities ?? null,
    packages: Object.values(json.vulnerabilities ?? {}).slice(0, 50).map((v) => ({
      name: v.name,
      severity: v.severity,
      advisories: (v.via ?? []).filter((x) => typeof x === 'object').map((x) => x.title).slice(0, 3),
    })),
  };
}

export function summarizeComposerAudit(json) {
  return {
    packages: Object.entries(json.advisories ?? {}).map(([name, list]) => {
      const items = Object.values(list ?? {});
      return { name, count: items.length, advisories: items.map((a) => a.title).slice(0, 3) };
    }),
    abandoned: Object.keys(json.abandoned ?? {}),
  };
}

function runJson(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(r.stdout);
}

export function audits(root, tools) {
  const audit = { npm: null, composer: null };
  const skipped = [];
  const has = (f) => fs.existsSync(path.join(root, f));
  if (has('package.json')) {
    if (!has('package-lock.json')) skipped.push('npm audit skipped — no package-lock.json');
    else if (!tools.npm) skipped.push('npm audit skipped — npm is not installed');
    else {
      try {
        const json = runJson('npm', ['audit', '--json', '--omit=dev'], root);
        if (json.error) skipped.push(`npm audit failed — ${json.error.summary ?? 'unknown error'}`);
        else audit.npm = summarizeNpmAudit(json);
      } catch {
        skipped.push('npm audit failed — could not read its output');
      }
    }
  }
  if (has('composer.json')) {
    if (!has('composer.lock')) skipped.push('composer audit skipped — no composer.lock');
    else if (!tools.composer) skipped.push('composer audit skipped — composer is not installed');
    else {
      try {
        audit.composer = summarizeComposerAudit(runJson('composer', ['audit', '--format=json', '--locked'], root));
      } catch {
        skipped.push('composer audit failed — could not read its output');
      }
    }
  }
  return { audit, skipped };
}

export function runCollect(root, profile, { historyLimit = HISTORY_LIMIT } = {}) {
  const files = listFiles(root);
  const skippedChecks = [];
  // Without a list of tracked files nothing can be called "committed": a local .env or log file is normal there.
  const tracked = profile.isGitRepo ? gitLsFiles(root) : null;
  if (profile.isGitRepo && tracked === null) {
    skippedChecks.push('Committed-file checks skipped (committed .env files, build artifacts) — git ls-files failed');
  }
  const localEnv = new Set(tracked ? [] : envFiles(files));
  const scanList = (tracked ?? files.filter((f) => !localEnv.has(f))).filter((f) => !/(^|\/)(node_modules|vendor)\//.test(f));
  const git = profile.isGitRepo ? gitSummary(root) : null;
  const history = profile.isGitRepo ? scanHistory(root, historyLimit) : [];
  if (history === null) {
    skippedChecks.push('Secrets in git history not checked — git log failed or its output was too large');
  } else if (git && git.totalCommits > historyLimit) {
    skippedChecks.push(`Secrets in git history: only the latest ${historyLimit} commits were scanned`);
  }
  if (!profile.isGitRepo) {
    skippedChecks.push('Git checks skipped — not a git repository (committed .env files and build artifacts, AI tooling patterns, secrets in history, commit and branch hygiene)');
  }
  const { audit, skipped } = audits(root, profile.tools);
  skippedChecks.push(...skipped);
  return {
    collectedAt: new Date().toISOString(),
    git,
    structureClusters: structureClusters(scanList),
    largeFiles: largeFiles(root, scanList),
    committedArtifacts: tracked ? committedArtifacts(tracked) : null,
    secrets: {
      scope: tracked ? 'tracked' : 'working-tree',
      files: scanFiles(root, scanList),
      trackedEnvFiles: tracked ? envFiles(tracked) : null,
      workingTreeEnvFiles: envFiles(files),
      history: history ?? [],
    },
    audit,
    runtimes: runtimes(root),
    inventory: inventory(files),
    skippedChecks,
  };
}
