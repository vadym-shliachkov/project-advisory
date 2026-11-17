# Area: Code quality (`code-quality`)

## Scope

How easy and safe the code is to change. Read the source, the configuration files and `collect.json` → `inventory`, `structureClusters`, `runtimes`.

## Out of scope

Security vulnerabilities and secrets (security area), CI and repository hygiene (process-hygiene area), page speed (performance area).

## Rules

| Rule | Default severity | What to check |
|---|---|---|
| `code-quality.no-linting` | medium | No lint or formatter configuration (`inventory.lintConfig` is empty). |
| `code-quality.lint-not-enforced` | low | Lint configuration exists but no script or CI step runs it. |
| `code-quality.duplicated-code` | medium | Substantial blocks of logic or markup duplicated across files. |
| `code-quality.oversized-files` | medium | Source files over about 500 lines that mix several responsibilities. |
| `code-quality.dead-code` | low | Unused files, large commented-out blocks, or unused dependencies. |
| `code-quality.no-tests` | medium | No automated tests for logic that would justify them (forms, calculations, data handling, app features). |
| `code-quality.no-type-safety` | low | A JavaScript app with complex logic and no TypeScript or type checking. |
| `code-quality.deprecated-apis` | medium | Use of deprecated language features, library methods or framework APIs. |
| `code-quality.inconsistent-conventions` | low | Mixed naming, formatting or folder conventions. |
| `code-quality.hardcoded-config` | medium | URLs, keys or environment-specific values written into code instead of configuration. |
| `code-quality.error-handling-gaps` | medium | Errors swallowed (empty `catch`), unhandled promise rejections, or no handling on critical paths such as form submission. |
| `code-quality.inline-styles-scripts` | low | Heavy inline styles or scripts in markup. |

## Facts to record

- `code-quality.languages`: main languages used.
- `code-quality.linters`: lint and format tools configured.
- `code-quality.testFramework`: test framework, or none.
