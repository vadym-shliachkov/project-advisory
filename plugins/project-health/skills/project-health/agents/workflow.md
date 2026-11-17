# Area: Delivery workflow (`workflow`)

## Scope

The whole path a change takes, from "we need to update this" to "it is live and correct", seen as one process. Reconstruct it from the README, AGENTS.md, CLAUDE.md, workflow documents, scripts, CI configuration and git history (`git log --all --graph --oneline`, `git branch -a`, merge commits, pull-request merges, who commits where), then look for the weak spots.

Walk through these scenarios and write down, for each, who does what, where, and what can go wrong:

1. **A small text or image update** on one page.
2. **A change that touches every page**, such as the header, navigation or footer.
3. **A new page of an existing type**, such as a new case study, blog post or team member: how does the author know which sections, images, metadata, calls to action and checks that type needs?
4. **A new kind of page** that does not exist yet.
5. **A mistake reaches the live site**: how is it noticed, and how is the previous version restored?
6. **A second person, or an AI agent, makes a change**: can they do it without the original author's machine, accounts or memory?

Signals in git: work committed straight to the branch that goes live, long-lived branches that never merge back, a branch holding something other than its name suggests (for example source code on a side branch and build output on main), fixes applied in two places, many "fix" commits right after a release, every commit from one person or one machine.

Most problems here are structural, so add `direction` (see the contract), for example "a short-lived branch for each change, merged through a reviewed pull request, with an automatic preview and deploy from main" or "a written checklist per page type that authors and AI agents follow".

## Out of scope

Repository tidiness (README content, `.gitignore`, lockfiles, licence) belongs to process-hygiene; the hosting platform itself (TLS, headers, monitoring) to hosting; agent instruction files to ai-setup. Refer to them only as part of the flow.

## Rules

| Rule | Default severity | What to check |
|---|---|---|
| `workflow.no-branch-per-change` | high | Changes are committed straight to the branch that goes live, rather than on a short-lived branch per task. Medium when nothing deploys automatically from that branch. |
| `workflow.no-review-before-live` | medium | No step where a second person, or an automatic check, approves a change before it reaches visitors (no pull requests, or pull requests merged without review). |
| `workflow.no-preview` | medium | A change cannot be seen on a realistic copy of the site (a preview link, staging, or at least a documented local live-reload server) before it goes live. |
| `workflow.no-automated-checks` | medium | Nothing checks a change automatically before it goes live: no CI, no pre-commit or pre-push checks for broken links, missing page metadata, tests or build errors. |
| `workflow.manual-release` | medium | Releasing is a manual sequence of steps run from one person's machine, so a skipped step or an unavailable person blocks or breaks a release. |
| `workflow.no-rollback` | medium | There is no documented, tested way to restore the previous version of the live site quickly. |
| `workflow.page-type-rules-missing` | medium | Page types (case study, article, service page, team member) have no written rules: which sections, fields, image sizes, metadata, calls to action and checks each needs, so new pages are inconsistent and agents guess. |
| `workflow.new-page-process-undefined` | medium | Adding a page, or a new kind of page, has no defined procedure: where to create it, how to add it to navigation, sitemap and listings, and what to check before publishing. |
| `workflow.unclear-branches` | medium | The branches do not tell a clear story: long-lived branches that diverge from main, branches whose content does not match their name, abandoned branches, or no naming convention. |
| `workflow.single-person-dependency` | medium | The process depends on one person's knowledge, accounts or machine (`git.authors`, local paths in instructions, credentials on one computer). |
| `workflow.changes-redone` | medium | The history shows the same change made twice (in output and source, on two branches) or reverted and redone, because the flow does not say where a change belongs. |

## Facts to record

- `workflow.currentFlow`: the steps a change goes through today, in order, as a list of short strings ("edit a page in src/pages on a feature branch", "run the build script locally", "copy output to main and push", "AWS deploys main").
- `workflow.liveBranch`: the branch that goes live and how (automatic deploy, manual upload).
- `workflow.branching`: how branches are used today (for example "everything on main", "one long-lived source branch, output on main").
- `workflow.pageTypes`: page types and whether each has a template and written rules.
- `workflow.contributors`: number of people (and agents, if visible) who changed the site recently.
