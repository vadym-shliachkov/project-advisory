# Area: Performance (`performance`)

## Scope

How fast pages load and respond for visitors. Use `live.json` → `lighthouse` when present (`metrics.lcp`, `metrics.cls`, `metrics.tbt`, `categories.performance`, `failedAudits`), `live.json` → `pages` (bytes, scripts), and the source files (image sizes, how assets load). Without Lighthouse data, findings based only on code are `"verified": false`.

## Out of scope

Server configuration such as compression and caching (hosting area).

## Rules

| Rule | Default severity | What to check |
|---|---|---|
| `performance.poor-lcp` | high | Largest Contentful Paint above 2.5 s on mobile; high above 4 s, medium between 2.5 and 4 s. |
| `performance.poor-cls` | medium | Cumulative Layout Shift above 0.1. |
| `performance.poor-tbt` | medium | Total Blocking Time above 200 ms. |
| `performance.low-lighthouse-score` | medium | Lighthouse performance score below 90; high below 50. |
| `performance.oversized-images` | high | Images over about 300 KB, much larger than displayed, or no modern formats (WebP, AVIF). |
| `performance.no-lazy-loading` | low | Images below the first screen without `loading="lazy"`. |
| `performance.render-blocking-resources` | medium | CSS or JavaScript in `<head>` that blocks rendering (no `defer`, `async` or media queries). |
| `performance.large-bundles` | medium | More than about 300 KB of compressed JavaScript, or very large CSS, on a page. |
| `performance.font-loading` | low | Many font families or weights, no `font-display`, or fonts from third-party servers delaying text. |
| `performance.heavy-third-parties` | medium | Many third-party scripts (`live.thirdPartyHosts`), each adding requests and main-thread work. |
| `performance.unminified-assets` | low | CSS or JavaScript served unminified. |
| `performance.heavy-page-weight` | medium | HTML documents over about 500 KB, or pages that load several megabytes in total. |

## Facts to record

- `performance.lighthouseScore`: mobile performance score and the date measured.
- `performance.lcp`: LCP value and the page measured.
- `performance.imageFormats`: image formats in use.
