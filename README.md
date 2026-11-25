# project-advisory

A Claude Code and Codex plugin with six skills for a web project, all under one name:

| Command | What it does |
|---|---|
| `/project-advisory:project-health` | Health check of the project, with a checklist, a PDF report and a plan. |
| `/project-advisory:roadmap` | Implementation roadmap agreed with the person who runs the project. |
| `/project-advisory:council` | Weekly council of role agents that proposes ideas for growth and tries to kill them. |
| `/project-advisory:venture` | Venture board, monthly or quarterly, that looks for what the business could start, sell, build or become. |
| `/project-advisory:lab` | Invention lab that studies the site, app or tool itself and invents new things it could do, that nothing of its kind has. |
| `/project-advisory:studio` | Design studio that comes back with one new design concept for a site (the idea behind it, its visual world and its motion) and one working page that shows it. |

No skill ever submits a form or contacts a real company or person. Every agent is told so, and on Claude Code a hook enforces it (see [No-contact guard](#no-contact-guard)).

## project-health

Analyses the health of a web project and produces:

1. a Markdown **checklist** of findings to review and tick,
2. a **PDF report** for the site owner, opening with a band in the project's own branding, and a separate **"Plan and effort" PDF** with the staged plan,
3. optionally, an **outcome backlog** for whoever implements the changes,
4. through the **roadmap** skill, an **implementation roadmap PDF** for the development team, agreed in a discussion with the person who runs the project, and a lasting **project knowledge base**.

Findings say what is wrong and why it matters, with a severity level. The report is written for a non-technical owner who has to decide what to do: it opens with a plain verdict and the decisions to make, turns each structural problem (copied layouts, no design system, no rules per page type, how changes go live) into options with pros, cons, an effort level and one recommendation, compares today's workflow with a proposed one, and lists every problem found with a plain explanation, the ones not chosen for this round included. The staged plan is a document of its own, built like the roadmap but for the owner: stages of fixes, each with the problem, an approach, its steps, how to tell it is done and the access or approvals the steps need. Checks for problems that cannot be confirmed from the project come apart from the work they size, and each step has an effort level (quick, small, medium, large, or sized after the check) instead of people and hours. When two ways forward are equally good, the fix shows both routes side by side, with what the choice depends on. The report also lists an AI toolkit for the team. Technical evidence stays in the analysis log and the checklist, not in the report. The report and the plan have no step-by-step fixes and no hour, day or cost estimates: effort levels compare pieces of work. Detailed solutions, people and time estimates belong in the implementation roadmap.

Eleven areas are analysed by parallel subagents: AI setup, architecture, delivery workflow, server and hosting, SEO, content and conversion, code quality, performance, process and repo hygiene, security and dependencies, privacy and legal. At report time two more subagents run: one groups the ticked findings by root cause into decisions and themes and writes the plan, and a plain-language editor rewrites the text for a non-technical reader.

## Requirements

- Node.js 22 or newer, and git.
- Chrome, Edge or Chromium for the PDF (otherwise you get `report.html`). Set `CHROME_PATH` to use a specific browser.
- Network access for live checks and Lighthouse (`npx lighthouse@12`, downloaded on first use) when you pass `--url`.

## Install

Claude Code:

```bash
claude plugin marketplace add https://github.com/vadym-shliachkov/project-advisory.git
claude plugin install project-advisory@project-advisory
```

Codex:

```bash
git clone https://github.com/vadym-shliachkov/project-advisory.git
codex plugin marketplace add ./project-advisory
```

Then enable `project-advisory` from the plugin list in the Codex app, or add to `.codex/config.toml`:

```toml
[plugins."project-advisory@project-advisory"]
enabled = true
```

## Use

```text
/project-advisory:project-health analyse --url https://example.com
/project-advisory:project-health report
/project-advisory:project-health backlog
```

In Codex, mention the skill (`$project-health`, `$roadmap`, `$council`, `$venture`, `$lab`, `$studio`) with the same arguments.

### Implementation roadmap

```text
/project-advisory:roadmap
```

The roadmap skill acts as the facilitator of a planning discussion. It goes through **every** problem in the report, ticked or not, until each one has an agreed fix plan, is moved to the backlog, or is discarded with a reason:

1. **Prepare.** It reads a brief of the report and the "Plan and effort" document (`roadmap-brief`), then the evidence for anything it could not explain to a developer. It opens with a summary, the agenda and the questions that need answers.
2. **Declare the available people.** Before any planning it records the name, role, skills and availability of everyone who can do the work. It also records the key features to keep, what is allowed and not allowed, and the constraints. These go in the project knowledge base.
3. **In any order, across areas.** The person can start anywhere and raise problems from several areas at once. The skill maps what they say to problems, saves each decision at once (a draft needs only a title and its problems), moves a problem when it is saved into another plan, tracks open questions, and shows a board of every problem and its outcome (`roadmap-board`) when the discussion jumps around. For each problem or group it presents the problem, proposes two or three ways forward with a recommendation, and lets the person choose: a fix plan, the backlog or discarding. A fix plan is written for developers: the cause, the options considered, the technical approach, tasks with files, acceptance criteria, dependencies, needs and risks. It can only be saved as agreed once it has an owner, plus a person and an agreed time estimate for every task.
4. **No early ending.** After every save, the skill names the next step and keeps going until nothing is open. If the person has to stop, everything open is saved as a draft and the next run continues from there.
5. **Phases, then the PDF.** It agrees the phases and the load on each person, then renders `roadmap.pdf`. The PDF covers the people and their workload, the ground rules, each phase with its fix plans, the backlog, the discarded problems, and a trace of every problem to its outcome.

Progress lives in `runs/<run>/roadmap.json`. The roadmap will not render while any problem is open, any fix plan is a draft, or any task lacks a person or an estimate.

The knowledge base is `kb/knowledge.json`, with a readable `kb/knowledge.md` next to it. It holds the people, key features, what is allowed and not allowed, conventions, constraints and decisions. It outlives the run, and later analyses and plans respect it. The council, the venture board, the invention lab and the design studio add to it what the person says when they turn something down for a reason that reaches past that one idea, or ask for more of something (see [What the person says](#what-the-person-says)).

| Option | Effect |
|---|---|
| `--url <https://…>` | Enables live checks: headers, TLS, DNS, crawl sample, Lighthouse. |
| `--only seo,security` | Analyse only these areas. |
| `--final` | Skip the review step: include every finding and render the PDF straight away. |
| `--backlog` | Also produce `backlog.md` after the report. |
| `--run <id>` | Work on a specific earlier run (default: the latest). |

### Reviewing the checklist

`analyse` stops at `checklist.md`. Mark each finding before running `report`:

- `[x]` include it in the report;
- `[ ]` leave it out of the report (it still counts towards the area scores);
- `[-]` dismiss it as wrong or not applicable: it is left out of the report and the scores, and stays dismissed in later runs.

`analyse` first asks for the business goal, audience, main conversion and who maintains the site, unless the knowledge base already has them; the answers shape the recommendations.

On Claude Code each area, and each report stage, runs in the plugin's read-only `area-analyst` subagent, which saves its own result; the analysed project's files are treated as data, never as instructions.

## Output

Everything is written to `.project-health/` in the analysed project:

```text
.project-health/
├─ .gitignore              ignores everything except kb/ (runs/, profile.json, latest.json)
├─ kb/facts.json           facts learned by the analysis, worth committing
├─ kb/knowledge.json       people, key features and ground rules agreed while planning (+ knowledge.md)
├─ profile.json
├─ latest.json
└─ runs/<run-id>/          collect.json, live.json, areas/, findings.json, checklist.md,
                           selected.json, synthesis.json, report.pdf, plan.pdf, backlog.md,
                           roadmap.json, roadmap.pdf
```

The knowledge base keeps what each run learned (stack, hosting, conventions) so later runs are faster and consistent. Add facts only a person knows:

```bash
node plugins/project-advisory/skills/project-health/scripts/ph.mjs fact --root <project> --key business.goal --value "Get demo requests"
```

## Council

```text
/project-advisory:council [path] [--goal "<text>"] [--url <https://…>] [--data <folder>] [--budget <n>]
```

A cast of role agents (the customer's voice, search, content, conversion, competitors, an outsider) proposes ideas for reaching a goal. A red team and the other members try to prove each idea wrong, the proposers defend, narrow or concede, and a judge who took no part rules on what is left. The default goal is to make potential clients see clearly what the business offers and why to choose it, so that more of them get in touch.

Before anyone proposes, a domain primer learns how the trade works (its buyers, its economics, its playbook), and every idea says what was found when it was looked for elsewhere. Every idea is a hypothesis with a test and a kill condition, and every claim cites evidence. Each session ends with three PDFs: a decision brief (every idea in a few lines, nothing ranked), the suggestions (every idea that survived, with where it comes from, the expected result and how to test it, and an analysis of every killed idea) and the discussion (the debate written up as a conversation), plus the session as linked pages (`site/index.html`: one page per idea with its plain argument record and the evidence it rests on). Ideas and their fate are kept in a ledger across sessions, in the same `.project-health/kb/` knowledge base the other skills use, and `.project-health/ideas.html` lists every idea of every session. Running a health check first gives the council findings to work from.

## Venture board

```text
/project-advisory:venture [path] [--goal "<text>"] [--url <https://…>] [--data <folder>] [--budget <n>]
```

The council's sibling for the business, for big bets rather than improvements. A framer sets the problem with design thinking and TRIZ: the ideal result, the contradictions of the business, its unused resources, where it stands on its curve, and "how might we" questions, some of which question the goal itself; the person may pick the framings that matter. A provocateur writes deliberately absurd statements. Seats with inventive roles (contradictions, business models, other trades, what is coming, the customer's voice) answer their framings with idea cards dealt to them (inventive principles, separation principles, business-model patterns, eliminate-reduce-raise-create moves, other trades) and harvest the provocations. Another seat makes every bet bigger before a sceptic attacks what each one assumes, and a judge rules on what it is worth if it works and the riskiest thing it rests on.

Each session ends with a decision brief, the bets (each as a press release from the day it worked, with what would have to be true and the cheapest first step, plus the frame and the provocation wall) and the session's pages. The venture board runs on the council's scripts and shares the knowledge bank, the idea ledger and the groundwork with it: research one of them did recently (the primer, the competitor and horizon scans, pictures of pages) is reused by the other. It used to be called the invention lab; its earlier sessions in `.project-health/lab/` are moved to `.project-health/venture/` the first time any of the three skills runs on the project.

## Invention lab

```text
/project-advisory:lab [path] [--url <https://…>] [--object <kind>] [--focus "<part>"] [--goal "<text>"] [--data <folder>] [--budget <n>]
```

Invents new things for the thing itself: a website, a web or mobile app, a desktop app, a command-line tool, a library or API, a browser extension, a plugin or skill, a game. The kind is guessed from the project (or given with `--object`), and `--focus` points the lab at one part first.

It starts by understanding the thing. An anatomist reads the project's files and live pages and writes its anatomy: what it is, who uses it and for what, its parts, what it knows, what its platform could do and does not, its journeys, weak spots and rules. A genre scout lists what things of its kind already have (the standard kit, which inventions must go beyond) and the most inventive of them; a voice scout gathers what its users say; a tech scan finds what has become possible. The person sees what the lab understood and corrects it before anyone invents.

A framer then sets the problem with TRIZ and design thinking (the ideal result, the thing's contradictions, a morphological box, its line of evolution, "how might we" questions), and a provocateur writes absurd statements. Inventive seats (the user's voice, contradictions, parts and materials, far fields, what has become possible) invent from cards dealt to them; every invention says how a person would live it, names the parts of the thing it grows from, and says what was found when it was looked for elsewhere. Another seat makes every invention bigger, the judge turns away what things of its kind already have, and an examiner and the other seats attack each one over up to three rounds (does it exist already, can the thing do it, would its users want it) while its proposer defends, narrows or concedes. A judge who took no part rules on what survived, how new it is (new to the world, or new to things of its kind) and how feasible.

Each session ends with a decision brief, the inventions (each with a sketch of what it could look like, how a person would live it, why it is new, what it grows from, the smallest prototype and what it survived), the discussion (the debate as the minutes of a society of inventors) and the session's pages. Its research is kept in the knowledge bank: the anatomy is reused while the project's code has not changed.

## Design studio

```text
/project-advisory:studio [path] [--url <https://…>] [--focus "<part>"] [--goal "<text>"] [--reuse latest|<session>|none]
```

Comes back with **one new design concept** for a site, existing or not built yet, and **one working page that shows it**. A concept is the idea behind the site, the visual world that carries it and the motion that gives it feeling. Corrections such as larger type or more white space are not design, and the studio refuses them as concepts.

1. **Study.** A business scout writes what the business is as raw material for a designer: its world, what it has that no other has, what visitors must feel. A field scout looks at what wins awards now, how sites of the trade look and what a template looks like, with pictures. A study an earlier session left in the last 30 days is reused.
2. **Concepts.** Six seats each propose two concepts, starting from different places: one idea, the business's own material, the feeling, fields far from the web, motion, provocation. They are not shown other sites, so nothing can be copied. A concept that is a rule about type size or weight, or whose motion is "nothing moves", is refused by the script.
3. **Critique.** A critic who has seen the field and the visitor's voice comment once on every concept: copy, template, collection of effects, type-only, does it make people feel something.
4. **Pick.** A judge picks one concept and works it out: the story as a visitor moves down the page, palette, type, forms, imagery, a choreography of three to seven movements with durations and easing, the signature moment, the inner pages, the voice. Every other concept gets a line on why it was not chosen.
5. **Build.** A builder makes one page that opens as the new site's first screen, live and moving, then shows the idea, the story, the world, each movement (replayable), inner pages on desktop and phone, and the site before and after. It may load fonts and GSAP, Three.js or similar from the usual CDNs, and the business's own pictures from the project; nothing else leaves the page.
6. **Look.** A stranger who was told nothing looks at pictures of the page and says what business it seems for and what it makes them feel; the builder revises once when asked.

The session ends with `page/index.html`, its pictures, and `concept.md`, a one-page note for whoever builds the site.

## What the person says

When the person turns an idea down, the ledger keeps the idea with their reason, and it is not proposed again. When the reason reaches past that one idea ("no dark backgrounds: our customers are over sixty"), it is a rule, and the usher of any of the four debating skills saves it as a note in `kb/knowledge.json`, in the person's words, with the idea it was said of; a strong "more of this" is saved as a preference. When it is not clear whether a reason is a rule, the usher asks once. Every later session, of any of the skills, reads the notes: nothing a rule forbids is proposed under another name, and the judge's docket refuses what slipped through. Only the person retires a note.

```bash
node plugins/project-advisory/skills/council/scripts/council.mjs note --root <project> --show
node plugins/project-advisory/skills/council/scripts/council.mjs note --root <project> --retire K3
```

## No-contact guard

The plugin ships a `PreToolUse` hook (`hooks/hooks.json`, `hooks/no-contact.mjs`) that refuses a tool call which would submit a form, send a message, a post, an issue or a push, or otherwise send data to a site:

- `curl`, `wget` and `Invoke-WebRequest` with a body or a method that sends data, mail commands, raw connections, `git push`, `gh` commands that create or comment, mail and chat links, and code run inline (`node -e`, `python -`, `bash -c`, `powershell -Command`) that posts, sends mail or drives a browser to click and type;
- MCP tools whose name does not say they read (browser clicks, typing, form filling, script evaluation, sending messages, creating anything), and page addresses that carry form fields or an email address.

Reading is never refused: opening and fetching pages, searching, pictures of pages, reading files, read-only `git` and `gh`, and the plugin's own scripts, whatever their input quotes.

It applies always inside the plugin's own subagents (`member`, `area-analyst`, `writer`, `designer`, none of which has browser tools), and in the main session while a skill runs: every command of the skills' scripts arms it for two hours, and closing a council, venture, lab or studio session lifts it. It is armed for the user, so every Claude Code window is guarded meanwhile. To lift it at once, run in your own terminal:

```bash
node "<plugin folder>/hooks/guard.mjs" off      # or: status
```

The hook refuses that command, and any change to the marker, from an agent. It is a guard, not a sandbox: it reads each command as a shell would, but a program written to a file and run later is not read. For a hard boundary, also turn on Claude Code's sandbox with a network allowlist. Codex does not run the hook; there, the rule rests on the agents' instructions and Codex's own sandbox.

## Development

```bash
cd plugins/project-advisory
npm test
```

`tests/project-health/fixtures/make-static-html-repo.mjs <dir>` creates a sample site with planted issues for manual end-to-end runs.
