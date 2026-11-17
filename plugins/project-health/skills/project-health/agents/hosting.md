# Area: Server and hosting (`hosting`)

## Scope

Where and how the site is served and deployed, and whether anyone would notice when it breaks. Use `live.json` (`home`, `httpRedirect`, `tls`, `dns`, `trackers`, `monitoring`), `collect.json` → `inventory.hostingConfig`, `inventory.ci`, and the README.

## Out of scope

Security headers and exposed files (security area). Page speed metrics (performance area).

## Rules

| Rule | Default severity | What to check |
|---|---|---|
| `hosting.no-https-redirect` | high | Plain HTTP is not redirected to HTTPS (`httpRedirect.redirectsToHttps` is false). |
| `hosting.tls-invalid` | critical | The certificate is not trusted (`tls.authorized` is false) or has expired (`tls.daysLeft` below 0). |
| `hosting.tls-expiring` | high | The certificate expires within 14 days. |
| `hosting.redirect-chain` | medium | Reaching the home page takes more than one redirect (`home.redirects`). |
| `hosting.slow-response` | high | The home page HTML takes more than 800 ms to arrive (`home.ms`); one sample, so use medium confidence. |
| `hosting.no-compression` | medium | The home page HTML is served without gzip or brotli (judged from the home page headers in `live.json`: `content-encoding` missing). CSS and JavaScript compression cannot be verified from `live.json`; if you report it, use `"verified": false`. |
| `hosting.weak-caching` | medium | The home page HTML has no cache policy at all (judged from the home page headers in `live.json`: `cache-control` missing). Static-asset caching cannot be verified from `live.json`; if you report it, use `"verified": false`. |
| `hosting.no-cdn` | low | No CDN signals (`cf-cache-status`, `x-vercel-cache`, `x-nf-request-id`, `via`, `age`) for a site with visitors in several regions. |
| `hosting.manual-deploy` | medium | No deploy configuration or CI deploy; the README describes copying files by hand or FTP. |
| `hosting.no-staging` | medium | No staging or preview environment is evident, so changes go straight to the live site. |
| `hosting.no-backups` | high | No evidence of backups for the site or its database. Usually `"verified": false`. |
| `hosting.email-auth-missing` | medium | The domain receives email (`dns.mx`) but has no SPF or no DMARC record, so its email can be spoofed or land in spam. |
| `hosting.no-analytics` | high | No analytics found in `live.trackers` or in the code, so traffic and conversions cannot be measured. |
| `hosting.no-error-tracking` | medium | No error monitoring (`live.monitoring` empty, no SDK in the code) for a site with forms, checkout or an app; low for a simple brochure site. |
| `hosting.no-uptime-monitoring` | medium | No uptime monitoring is evident. Usually `"verified": false` with medium confidence. |

## Facts to record

- `hosting.provider`: hosting provider, if known.
- `hosting.deployMethod`: how the site is deployed.
- `hosting.cdn`: CDN in use, or none.
- `hosting.analytics`: analytics tools in use.
