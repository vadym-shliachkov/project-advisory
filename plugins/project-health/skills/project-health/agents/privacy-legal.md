# Area: Privacy and legal (`privacy-legal`)

## Scope

Whether the site handles visitor data and third-party content lawfully, with a focus on GDPR and the ePrivacy rules that apply to visitors in the EU, and whether licences are respected. Use `live.json` → `trackers`, `consentTools`, `googleFontsRemote`, `legalLinks`, `thirdPartyHosts`, the page sources, and dependency licences from `package.json` or `composer.json`. You describe legal risks; you do not give legal advice.

## Out of scope

Security of the data (security area). Accessibility law.

## Rules

| Rule | Default severity | What to check |
|---|---|---|
| `privacy-legal.trackers-before-consent` | high | Analytics or marketing scripts load in the page source before any consent tool can block them. |
| `privacy-legal.no-consent-tool` | high | Trackers are present (`live.trackers` or code) and no consent mechanism is found (`live.consentTools` empty). |
| `privacy-legal.no-privacy-policy` | high | No link to a privacy policy (`live.legalLinks`, footer markup). |
| `privacy-legal.no-imprint` | medium | No imprint or legal notice page where the business location requires one (for example Germany, Austria, Switzerland). |
| `privacy-legal.remote-google-fonts` | medium | Fonts are loaded from Google servers (`googleFontsRemote`), which German courts have found to breach GDPR without consent. |
| `privacy-legal.third-party-embeds` | medium | YouTube, Google Maps or social embeds load without consent and send visitor data to third parties. |
| `privacy-legal.form-data-notice` | medium | Forms collect personal data without a notice or link explaining how it is used. |
| `privacy-legal.dependency-licence-risk` | medium | Dependencies under copyleft licences (GPL, AGPL) in software that is distributed, or dependencies with no licence. |
| `privacy-legal.unlicensed-assets` | low | Commercial fonts, images or icons in the repository without licence information. |
| `privacy-legal.no-cookie-policy` | low | Cookies are set but no cookie information page exists. |
| `privacy-legal.personal-data-in-repo` | high | Personal data committed to the repository: customer exports, email lists, form submissions. |

## Facts to record

- `privacy-legal.consentTool`: consent tool in use, or none.
- `privacy-legal.trackers`: trackers found.
- `privacy-legal.legalPages`: URLs of privacy policy, imprint and cookie pages.
