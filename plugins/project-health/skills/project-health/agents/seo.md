# Area: SEO and discoverability (`seo`)

## Scope

Whether search engines and social platforms can find, understand and present the site. Use `live.json` → `pages`, `robots`, `sitemap`, and the page source files. Without `live.json`, check the source files and mark live-only rules as unverified.

## Out of scope

Page speed (performance area). Accessibility is out of scope for this whole health check; report missing image `alt` text only for its effect on image search.

## Rules

| Rule | Default severity | What to check |
|---|---|---|
| `seo.noindex-production` | critical | A `robots` meta tag or `X-Robots-Tag` header says `noindex`, or `robots.txt` disallows everything, on the live site or on pages that will be deployed as they are. |
| `seo.missing-title` | high | Pages without a `<title>`. |
| `seo.duplicate-title` | medium | Several pages share the same title. |
| `seo.missing-meta-description` | high | Pages without a meta description. |
| `seo.duplicate-meta-description` | medium | Several pages share the same meta description. |
| `seo.missing-canonical` | medium | Pages without a canonical link where duplicates exist (trailing slashes, parameters, `www`). |
| `seo.missing-sitemap` | medium | No sitemap, or `robots.txt` does not point to it. |
| `seo.missing-robots-txt` | low | No `robots.txt`. |
| `seo.h1-structure` | medium | Pages with no `<h1>` or with more than one. |
| `seo.missing-structured-data` | medium | No JSON-LD for the organisation, local business, articles or products where it applies. |
| `seo.missing-social-cards` | medium | No `og:title` or `og:image`, so shared links look bare. |
| `seo.missing-lang` | low | The `<html>` element has no `lang`. |
| `seo.hreflang-missing` | medium | The site has several languages but no `hreflang` links. |
| `seo.broken-internal-links` | high | Internal links or images point to files or pages that do not exist. |
| `seo.missing-image-alt` | low | Images without `alt`, which lowers their chance of appearing in image search. |
| `seo.client-rendered-content` | high | The main content only appears after JavaScript runs. |

## Facts to record

- `seo.sitemapUrl`: sitemap location, or none.
- `seo.titlePattern`: the usual title pattern, for example "<Page> | <Brand>".
- `seo.languages`: languages the site is published in.
