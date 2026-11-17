// A mechanical first pass over the report text for a non-technical reader. The editor agent decides what to change;
// this only points at likely problems: code-like fragments, unexplained jargon and very long sentences.

const ACRONYMS = ['CI/CD', 'CI', 'CD', 'CSP', 'HSTS', 'GTM', 'LCP', 'CLS', 'INP', 'TTFB', 'SDK', 'API', 'CDN', 'DNS', 'TLS', 'SSL', 'SPF',
  'DMARC', 'DKIM', 'MCP', 'PR', 'PRs', 'AVIF', 'JSON-LD', 'JSON', 'YAML', 'CMS', 'SSG', 'CSS', 'HTML', 'JS', 'npm', 'WebP', 'OG'];
const WORDS = ['srcset', 'repo', 'repos', 'commit', 'commits', 'committed', 'branch', 'branches', 'merge', 'merged', 'pull request',
  'pull requests', 'minified', 'unminified', 'render-blocking', 'meta refresh', 'meta-refresh', 'canonical', 'noindex', 'hreflang',
  'lint', 'linter', 'linting', 'selector', 'selectors', '!important', 'content-hashed', 'fingerprinted', 'fingerprint', 'frontmatter',
  'stylesheet', 'stylesheets', 'lockfile', 'webhook', 'runtime', 'payload', 'endpoint', 'serverless', 'headless', 'partials',
  'viewport', 'preload', 'bundle', 'bundles', 'design tokens', 'staging', 'deploy', 'deploys', 'deployed', 'deployment',
  'build step', 'build output', 'pipeline', 'hook', 'hooks', 'markup', 'consent mode', 'tag manager', 'structured data',
  'schema markup', 'sitemap', 'crawler', 'crawlers', 'caching'];
const STATUS_CODES = /\b(301|302|307|308|410)\b/g;
const FRAMEWORK_NAMES = /^(next|node|vue|nuxt|express|three|chart|alpine|d3)\.js$/i;

const CODE_PATTERNS = [
  /`[^`]+`/g,
  /<\/?[a-z][^>]*>/gi,
  /\b[\w-]+\.(?:html?|css|js|mjs|cjs|ts|tsx|jsx|json|md|py|toml|ya?ml|php|xml|txt|log|env|sh)\b/gi,
  /\b[\w.-]+(?:\/[\w.-]+){2,}\/?/g,
  /\b[\w-]+\/[\w-]+\.\w{2,4}\b/g,
  /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g,
  /(?:^|\s)--[a-z][\w-]*/g,
  /\b[a-z]{2,}(?:[A-Z][a-z0-9]+)+\b/g,
  /\b[a-z0-9]+_[a-z0-9_]+\b/g,
  /\b[a-z]+:[a-z][\w:-]*\b/g,
  // Ids of decisions, themes, plan fixes and findings mean nothing to the reader.
  /\b[DTPF]\d{1,2}\b/g,
  /\b[A-Z]{2,}-[0-9a-f]{4,8}\b/g,
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const JARGON = [
  ...ACRONYMS.map((t) => [t, new RegExp(`(?<![\\w-])${escapeRe(t)}(?![\\w-])`, 'g')]),
  ...WORDS.map((t) => [t, new RegExp(`(?<![\\w-])${escapeRe(t)}(?![\\w-])`, 'gi')]),
];

function explained(term, glossary) {
  const t = term.toLowerCase();
  return glossary.some((g) => {
    const k = g.toLowerCase();
    return k === t || t.startsWith(k) || k.startsWith(t) || k.split(/[\s(),/]+/).includes(t);
  });
}

export function lintText(text, glossaryTerms = []) {
  const s = String(text ?? '');
  const out = [];
  const code = new Set();
  for (const re of CODE_PATTERNS) {
    for (const m of s.matchAll(re)) {
      const hit = m[0].trim();
      if (!FRAMEWORK_NAMES.test(hit)) code.add(hit);
    }
  }
  // Report each fragment once: "css/site.css" inside "assets/css/site.css" is the same problem.
  for (const hit of code) {
    if (![...code].some((o) => o !== hit && o.includes(hit))) out.push({ kind: 'code', match: hit });
  }
  const jargon = new Set();
  for (const [term, re] of JARGON) {
    if (re.test(s) && !explained(term, glossaryTerms)) jargon.add(term);
    re.lastIndex = 0;
  }
  // A longer term already flagged covers its parts ("pull request" and "PR", "CI/CD" and "CI").
  for (const term of jargon) {
    if (![...jargon].some((o) => o !== term && o.toLowerCase().includes(term.toLowerCase()))) out.push({ kind: 'jargon', match: term });
  }
  for (const m of s.matchAll(STATUS_CODES)) if (!explained(m[0], glossaryTerms)) out.push({ kind: 'jargon', match: m[0] });
  for (const sentence of s.split(/(?<=[.!?])\s+/)) {
    const words = sentence.split(/\s+/).filter(Boolean).length;
    if (words > 32) out.push({ kind: 'long-sentence', match: `${words} words: ${sentence.slice(0, 60)}…` });
  }
  return out;
}

// The longest a text can be where the report prints it before it reads as a wall of text, in words.
const WORD_LIMITS = [
  [/^summary\.verdict$/, 90],
  [/^decisions\.[^.]+\.problem$/, 75],
  [/^decisions\.[^.]+\.recommendation$/, 70],
  [/^themes\.[^.]+\.summary$/, 70],
  [/^finding\.[^.]+\.why$/, 45],
  [/^finding\.[^.]+\.toConfirm$/, 35],
  [/^plan\.summary$/, 60],
  [/^plan\.stages\[\d+\]\.goal$/, 35],
  [/^plan\.F\d+\.problem$/, 60],
  [/^plan\.F\d+\.approach$/, 70],
  [/^plan\.F\d+\.choice$/, 40],
  [/^plan\.F\d+\.routes\[\d+\]\.summary$/, 30],
  [/^plan\.F\d+\.doneWhen\[\d+\]$/, 30],
  [/^plan\.F\d+\.\d+\.what$/, 45],
  [/^plan\.F\d+\.\d+\.sizeNote$/, 35],
  [/^plan\.F\d+\.\d+\.checklist\[\d+\]\.(point|why)$/, 25],
];

function lengthProblem(path, text) {
  const limit = WORD_LIMITS.find(([re]) => re.test(path))?.[1];
  const words = String(text ?? '').split(/\s+/).filter(Boolean).length;
  return limit && words > limit ? [{ kind: 'long-text', match: `${words} words, keep it under ${limit}` }] : [];
}

// items: [{ path, text }] — every text the report prints, with where it comes from.
export function lintItems(items, glossaryTerms = []) {
  return items.flatMap(({ path, text }) => [...lintText(text, glossaryTerms), ...lengthProblem(path, text)].map((p) => ({ path, ...p })));
}

export function lintSummary(problems) {
  const count = (k) => problems.filter((p) => p.kind === k).length;
  return { code: count('code'), jargon: count('jargon'), longSentences: count('long-sentence'), longTexts: count('long-text') };
}
