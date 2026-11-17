# Area: Process and repo hygiene (`process-hygiene`)

## Scope

Whether the repository and the way work flows through it make the project easy to hand over and safe to change. Use `collect.json` → `inventory`, `git`, `largeFiles`, `committedArtifacts`, and the README.

## Out of scope

Code style (code-quality area), secrets (security area), AI instruction files (ai-setup area). How changes flow to the live site (branches, reviews, CI, releases, who does the work) belongs to the workflow area.

## Rules

| Rule | Default severity | What to check |
|---|---|---|
| `process-hygiene.no-readme` | medium | No README at the root. |
| `process-hygiene.readme-missing-setup` | medium | The README does not say how to install, run and deploy the project. |
| `process-hygiene.no-gitignore` | medium | No `.gitignore`. |
| `process-hygiene.committed-build-artifacts` | low | `node_modules`, build output, OS files or logs are committed (`committedArtifacts`; `null` means not a git repository, so do not report the rule). |
| `process-hygiene.large-binaries` | low | Large binary files in the repository (`largeFiles`). |
| `process-hygiene.work-files-committed` | low | Working files are committed next to the site: logs, review bundles, screenshots, exports or scratch notes. |
| `process-hygiene.no-env-example` | low | The code reads environment variables but there is no `.env.example`. |
| `process-hygiene.no-lockfile` | medium | `package.json` or `composer.json` without a lockfile, so installs are not reproducible. |
| `process-hygiene.poor-commit-messages` | low | Most recent commit subjects (`git.recentSubjects`) say nothing ("fix", "update", "wip"). |
| `process-hygiene.no-license` | low | No licence file for a public repository or a library. |
| `process-hygiene.no-changelog` | low | No changelog or release notes for a library or a delivered client project. |

## Facts to record

- `process-hygiene.defaultBranch`: name of the main branch.
