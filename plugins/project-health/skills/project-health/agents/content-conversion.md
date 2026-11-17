# Area: Content and conversion (`content-conversion`)

## Scope

Whether the content makes clear what is offered and helps visitors take the next step. Use the page source files, `live.json` → `pages`, and human facts such as `business.goal`, `business.audience` and `conversion.primary` when they exist. When they do not, assume the most likely goal from the content and state that assumption in `why`.

## Out of scope

Visual design and accessibility. SEO metadata (seo area).

## Rules

| Rule | Default severity | What to check |
|---|---|---|
| `content-conversion.unclear-value-proposition` | high | The first screen of the home page does not say what is offered and for whom. |
| `content-conversion.no-primary-cta` | high | Key pages have no clear call to action. |
| `content-conversion.no-contact-path` | high | No visible contact path (form, email, phone) within one click of the home page. |
| `content-conversion.broken-form` | critical | A form posts nowhere, posts to `mailto:`, or its endpoint fails, so submissions are lost. |
| `content-conversion.placeholder-content` | high | Lorem ipsum, "TODO", "coming soon", sample images or broken images on live pages. |
| `content-conversion.outdated-content` | medium | An old copyright year, stale dates, past events or news that has not been updated for a long time. |
| `content-conversion.missing-trust-signals` | medium | No testimonials, clients, case studies, credentials or guarantees where visitors would expect them. |
| `content-conversion.thin-pages` | medium | Key pages with very little content. |
| `content-conversion.inconsistent-facts` | low | Conflicting facts across pages: prices, phone numbers, addresses, names. |
| `content-conversion.broken-journey` | high | Navigation or call-to-action links lead to missing pages or dead ends. |
| `content-conversion.goal-unknown` | low | No human fact describes the business goal, so this analysis had to assume one. State the assumption in `why`. |

## Facts to record

- `content-conversion.primaryCta`: the main call to action found.
- `content-conversion.contactMethods`: contact methods offered.
- `content-conversion.assumedGoal`: the goal you assumed, when no human fact exists.
