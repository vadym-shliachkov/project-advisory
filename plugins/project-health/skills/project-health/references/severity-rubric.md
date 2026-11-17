# Severity rubric

Choose the level by the consequence of leaving the issue as it is, not by how hard it would be to address.

| Level | Use when | Examples |
|---|---|---|
| critical | The issue causes harm now: data or security exposure, the site is down or cannot be indexed, or a legal obligation is breached. | Secrets committed to the repository; `noindex` on the production site; expired TLS certificate; `/.git` downloadable from the live site |
| high | Measurable loss of traffic, conversions or money, or a risk that is likely to materialise. | No meta descriptions; LCP above 4 s on mobile; no backups; trackers firing before consent |
| medium | A real but gradual cost: maintainability, friction, slower delivery. | No CI; duplicated components; no AGENTS.md; outdated copyright year |
| low | Polish, or a best practice with small impact. | Missing favicon sizes; inconsistent file naming |

Rules:

- A finding with `"verified": false` is never critical. Use high at most, and say in `toConfirm` what would confirm it.
- When unsure between two levels, choose the lower one and set `confidence` to `medium` or `low`.
- Severity describes the issue, not the work to address it. Never mention effort.
- Opportunities and AI tooling suggestions use the same scale for how much the project would gain.
