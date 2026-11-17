import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const SECRET_PATTERNS = [
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private-key', re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
  { name: 'stripe-live-key', re: /\b[sr]k_live_[0-9a-zA-Z]{16,}\b/ },
  { name: 'github-token', re: /\b(?:ghp|gho|ghs|ghu)_[0-9A-Za-z]{36}\b|\bgithub_pat_[0-9A-Za-z_]{40,}\b/ },
  { name: 'slack-token', re: /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/ },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'npm-token', re: /\bnpm_[0-9A-Za-z]{36}\b/ },
  { name: 'url-credentials', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"]+:([^\s@/'"]{6,})@/i },
];
// A name containing a secret word, an assignment, then a quoted literal (groups 3/4) or a bare value (group 5).
// Group 2 is the part of the name after the secret word, used to skip names such as TOKEN_URL or passwordField.
const GENERIC_RE = /(?:^|[^A-Za-z0-9])[A-Za-z0-9_-]*?(?:api[_-]?key|secret|token|passw(?:or)?d)([A-Za-z0-9_-]*)["']?\s*(?:=>|:=|[:=])\s*(?:(["'`])([^"'`\s]{12,})\2|([^\s"'`,;#]{12,}))/gi;
const NOT_A_SECRET_NAME = /url|uri|endpoint|host|path|file|dir|name|field|header|type|length|count|size|limit|expir|ttl|timeout|label|placeholder|pattern|regex|format|prefix|policy|hint|id$/i;
const PLACEHOLDER_RE = /^(process\.env|import\.meta\.env|\$\{|\{\{|%\(|<|your|xxx|changeme|example|placeholder|dummy|redacted|\*{3})/i;
const URL_PLACEHOLDER_RE = /^(password|pass|pwd|secret|changeme|\*+|x+|\$\{.*|<.*|\{.*|%.*)$/i;
// Files whose bare values are data, not code: KEY=value and key: value lines hold literal values here.
const CONFIG_FILE_RE = /(^|\/)\.env[^/]*$|\.(env|ini|cfg|conf|properties|toml|ya?ml|tfvars)$|(^|\/)\.(npmrc|netrc|pgpass|git-credentials)$/i;
const TEXT_EXT = /\.(js|mjs|cjs|ts|tsx|jsx|json|jsonc|ya?ml|toml|env|ini|cfg|conf|php|py|rb|go|java|kt|cs|rs|swift|dart|html?|vue|svelte|astro|twig|erb|ejs|hbs|njk|liquid|md|txt|sh|ps1|xml|properties|tf|tfvars|pem|key|p8|asc|ppk|npmrc|netrc|pgpass|git-credentials)$/i;
const LOCK_RE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|bun\.lockb?)$/;

// In code, a bare value after `password:` is usually an expression (req.body.password, getToken()), not a secret.
function looksLikeCode(value) {
  if (/[()[\]{}<>]/.test(value)) return true;
  if (/^[A-Za-z_$][\w$]*(\.[\w$]+)+$/.test(value)) return true;
  return /^[A-Za-z_$][\w$]*$/.test(value) && !/\d/.test(value);
}

function genericSecret(line, file) {
  const config = Boolean(file) && CONFIG_FILE_RE.test(file);
  for (const m of line.matchAll(GENERIC_RE)) {
    const [, nameRest, , quoted, bare] = m;
    if (NOT_A_SECRET_NAME.test(nameRest)) continue;
    const value = quoted ?? bare;
    if (PLACEHOLDER_RE.test(value)) continue;
    if (quoted !== undefined && (/^https?:\/\/[^@\s]*$/i.test(value) || /^\.{0,2}\/[\w./-]*$/.test(value))) continue;
    if (bare !== undefined && (config ? /[()]/.test(value) : looksLikeCode(value))) continue;
    return value;
  }
  return null;
}

export function mask(value) {
  const s = String(value);
  if (s.length <= 8) return '****';
  const head = s.length < 20 ? 2 : 4;
  return `${s.slice(0, head)}…${s.slice(-2)} (${s.length} chars)`;
}

export function scanText(text, file) {
  const hits = [];
  String(text).split(/\r?\n/).forEach((line, i) => {
    for (const { name, re } of SECRET_PATTERNS) {
      const m = re.exec(line);
      if (!m) continue;
      const value = m[1] ?? m[0];
      if (name === 'url-credentials' && URL_PLACEHOLDER_RE.test(value)) continue;
      hits.push({ file, line: i + 1, type: name, masked: mask(value) });
      return;
    }
    const generic = genericSecret(line, file);
    if (generic) hits.push({ file, line: i + 1, type: 'generic-secret', masked: mask(generic) });
  });
  return hits;
}

export function scanFiles(root, files, { readFile = fs.readFileSync } = {}) {
  const hits = [];
  for (const f of files) {
    const base = f.split('/').pop();
    if (!(TEXT_EXT.test(f) || base.startsWith('.env') || !base.includes('.'))) continue;
    if (LOCK_RE.test(f)) continue;
    const abs = path.join(root, f);
    let st;
    try { st = fs.statSync(abs); } catch { continue; }
    if (!st.isFile() || st.size > 1_000_000) continue;
    let text;
    try { text = readFile(abs, 'utf8'); } catch { continue; } // locked (EBUSY) or unreadable (EACCES)
    if (text.includes('\0')) continue;
    hits.push(...scanText(text, f));
  }
  return hits;
}

export const HISTORY_LIMIT = 300;

export function scanHistory(root, limit = HISTORY_LIMIT) {
  let out;
  try {
    out = execFileSync('git', [
      '-C', root, 'log', '-p', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/',
      '-n', String(limit), '--pretty=format:@@commit %h',
    ], {
      encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
  const hits = [];
  const seen = new Set();
  let commit = null;
  let file = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('@@commit ')) { commit = line.slice(9).trim(); continue; }
    if (line.startsWith('+++ b/')) { file = line.slice(6); continue; }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    for (const h of scanText(line.slice(1), file)) {
      const key = `${commit}|${file}|${h.type}`;
      if (!seen.has(key)) {
        seen.add(key);
        hits.push({ commit, file, type: h.type, masked: h.masked });
      }
    }
  }
  return hits;
}

export function envFiles(files) {
  return files.filter((f) => /(^|\/)\.env(\.[\w.-]+)?$/.test(f) && !/\.(example|sample|template|dist)$/.test(f));
}
