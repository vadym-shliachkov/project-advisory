# Area: Security and dependencies (`security`)

## Scope

Exposure of secrets and data, known-vulnerable or end-of-life software, and missing protections on the live site. Use `collect.json` → `secrets` (already masked), `audit`, `runtimes`, and `live.json` → `securityHeaders`, `exposed`, `pages`. Never copy a secret value: use the masked form.

## Out of scope

Privacy and legal compliance (privacy-legal area). HTTPS redirects and certificates (hosting area).

## Rules

| Rule | Default severity | What to check |
|---|---|---|
| `security.secret-in-repo` | critical | A secret in a project file (`secrets.files`). When `secrets.scope` is `tracked` the file is committed; when it is `working-tree` the folder is not a git repository and the file is part of the project as delivered (local `.env` files are excluded). One finding per file; `subject` is the file path. |
| `security.secret-in-history` | critical | A secret in git history, even if removed since (`secrets.history`). One finding per file. |
| `security.env-file-committed` | critical | A `.env` file is tracked by git (`secrets.trackedEnvFiles`). `null` means this could not be checked (not a git repository): do not report the rule then. |
| `security.vulnerable-dependencies` | high | Known vulnerabilities in dependencies (`audit`). Critical when an advisory is critical. |
| `security.eol-runtime` | high | An end-of-life runtime or framework version (`runtimes`), which no longer gets security fixes. |
| `security.missing-hsts` | medium | No `Strict-Transport-Security` header on an HTTPS site. |
| `security.missing-csp` | medium | No `Content-Security-Policy` header. |
| `security.missing-security-headers` | low | Missing `X-Content-Type-Options`, `Referrer-Policy` or frame protection (`X-Frame-Options` or CSP `frame-ancestors`). |
| `security.exposed-git` | critical | `/.git/` can be downloaded from the live site (`exposed.git`). |
| `security.exposed-env` | critical | `/.env` can be downloaded from the live site (`exposed.env`). |
| `security.mixed-content` | medium | HTTPS pages load scripts, styles or images over HTTP (`pages[].mixedContent`). |
| `security.version-disclosure` | low | `Server`, `X-Powered-By` or a generator tag reveals software versions. |
| `security.unprotected-forms` | medium | Forms with no spam protection or, for logged-in actions, no CSRF protection. |

## Facts to record

- `security.auditTool`: which dependency audit ran (npm, composer, none).
- `security.runtimeVersions`: runtime and framework versions found.
- `security.headersPresent`: security headers present on the live site.
