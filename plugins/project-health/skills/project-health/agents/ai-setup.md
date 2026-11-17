# Area: AI setup (`ai-setup`)

## Scope

How well the project is prepared for AI coding agents: instruction files (`AGENTS.md`, `CLAUDE.md`, Cursor rules), agent configuration (`.claude/`, `.codex/`, `.mcp.json`), and whether repeated work in the project would benefit from AI tooling. Use `collect.json` → `inventory` and `git`, and the known facts.

## Out of scope

Code quality, tests and CI themselves (other areas cover them). Never write or edit instruction files.

## Rules

| Rule | Default severity | What to check |
|---|---|---|
| `ai-setup.no-agent-instructions` | medium | No `AGENTS.md` or `CLAUDE.md` anywhere in the project (`inventory.agents` is empty). |
| `ai-setup.instructions-missing-commands` | medium | The instruction file does not say how to install, run, build and test the project. |
| `ai-setup.instructions-missing-conventions` | medium | The instruction file does not describe the folder layout and the conventions an agent must follow. |
| `ai-setup.instructions-missing-verification` | medium | The instruction file gives no way for an agent to check its own work (tests, lint, preview, checks before deploy). |
| `ai-setup.instructions-outdated` | high | The instruction file contradicts the code: commands, paths or stack that no longer exist. Quote both sides as evidence. |
| `ai-setup.instructions-too-long` | low | The instruction file is over about 500 lines or mostly generic advice, so the project-specific rules get lost. |
| `ai-setup.instructions-inconsistent` | medium | `AGENTS.md`, `CLAUDE.md` and Cursor rules disagree, or duplicate each other without one referencing the other. |
| `ai-setup.kb-facts-missing` | medium | A fact in the known facts that matters to agents (deploy method, hosting, stack, content workflow) is absent from the instruction file. One finding per missing topic; `subject` is the fact key. |
| `ai-setup.no-agent-permissions` | low | No `.claude/settings.json` or `.codex/` configuration, so agents either ask before every command or run without guardrails. |
| `ai-setup.secrets-readable-by-agents` | high | Secret files exist in the working tree (`secrets.workingTreeEnvFiles`) and no agent configuration denies reading them. |
| `ai-setup.mcp-config-broken` | medium | `.mcp.json` references commands, files or environment variables that do not exist in the project. |
| `ai-setup.tooling-opportunity` | medium | A step in the team's way of working that a rule, hook, skill, command, agent or MCP connection would make faster or safer. See "Recommended AI tooling". |
| `ai-setup.instructions-status-log` | low | The instruction file is used as a status log (current release, recent fixes, commit hashes), so the standing rules get lost and the file goes stale after every release. |
| `ai-setup.instructions-machine-specific` | medium | The instruction file depends on one person's machine: absolute local paths, local tool locations, personal accounts or credentials helpers. |

## Recommended AI tooling

Findings for `ai-setup.tooling-opportunity` use `"kind": "tooling"` and add `toolType`, `trigger` and `draftDescription`. `subject` is a short slug of the tool (for example `start-task`). Think of the result as a **toolkit for the whole way this team works**, not a list of isolated ideas: follow the life of a change (start, edit, preview, check, review, publish, record) and ask at each step what an AI assistant could do automatically, enforce, or remember for the team.

Consider every candidate below. Report one when the project shows the need (evidence from git history, the docs, the structure, or the known facts), and leave it out when it does not:

| Candidate (`subject`) | Usual `toolType` | Report it when |
|---|---|---|
| `start-task` | `command` or `skill` | Work lands directly on the live branch. At the start of a significant task it creates a branch named after the task, and lets trivial edits stay on a quick path. |
| `preview-server` | `command` | There is no documented way to see changes locally with live reload, or the preview needs several manual steps. |
| `open-pull-request` | `skill` | Changes reach the live branch without a pull request, or pull requests have no description or checklist. It writes the description from the diff, lists affected pages and runs the checks. |
| `new-<page-type>` (for example `new-case-study`) | `skill` | Pages of one type are added repeatedly (`structureClusters`, `git.recurringChangeSets`, `git.subjectClusters`). It creates the page from the type's template and rules and adds it to navigation, listings and sitemap. |
| `<page-type>-rules` | `rule` | Page types exist without written rules. Instructions that load when an agent edits that type's files (for example a rules file scoped to the case-studies folder). |
| `design-system-rule` | `rule` | Styles drift: an instruction that agents use the existing tokens and components and never add one-off colours, sizes or `!important`. |
| `pre-publish-check` | `hook` | A check must always run before something goes live (links, page metadata, image sizes, build success, no edits to generated files). |
| `protect-live-branch` | `hook` | Agents could commit or push straight to the branch that goes live, or edit generated files. |
| `release` | `skill` | Publishing is a multi-step manual procedure (mark the evidence item `"highRisk": true` when a mistake goes live). |
| `content-update` | `skill` | The same content (a person, a client logo, a statistic) appears on several pages and is changed by hand in each. |
| `site-review` | `agent` | Changes are not reviewed before going live: an assistant that checks a branch for broken layout, inconsistent styling, SEO metadata and copy against the rules. |
| `<service>-connection` | `mcp` | The project depends on an external system (CMS, analytics, forms, design files, issue tracker) that agents cannot see. |

You may add tools outside this list when the evidence supports them.

Minimum bar: at least 3 evidence items (commits, files or documented steps), or one evidence item with `"highRisk": true` for a procedure where a mistake is costly or reaches visitors (deploy, release, pushing to the live branch, migration). `draftDescription` says what the tool would do in one or two sentences, never how to build it. `trigger` says when someone would use it. `severity` is how much the project would gain. Write `title` as the tool's purpose ("Start each significant change on its own branch"), not as a problem statement.

## Facts to record

- `ai-setup.instructionFiles`: paths of instruction files found.
- `ai-setup.agentConfig`: which agent configuration folders exist.
- `ai-setup.repeatedTasks`: short names of the repeated tasks you found.
