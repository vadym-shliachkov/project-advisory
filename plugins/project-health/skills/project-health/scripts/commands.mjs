import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { AREAS, RETIRED_RULES } from './lib/areas.mjs';
import { readJson, writeJson, parseLooseJson } from './lib/io.mjs';
import { createRun, resolveRun, previousRuns, healthDir } from './lib/paths.mjs';
import { buildProfile } from './lib/detect.mjs';
import { runCollect } from './lib/collect.mjs';
import { probeLive } from './lib/probe.mjs';
import { runLighthouse } from './lib/lighthouse.mjs';
import { validateAreaOutput } from './lib/findings.mjs';
import { mergeRun, previousAreaFindings } from './lib/merge.mjs';
import { identityKey } from './lib/ids.mjs';
import { loadKb, saveKb, mergeFacts, today } from './lib/kb.mjs';
import { renderChecklist, parseTicks, resolveSelection } from './lib/checklist.mjs';
import { renderReport, writeDocument } from './lib/render.mjs';
import { logoSource } from './lib/report-html.mjs';
import { withBrandFact, NAME_FROM } from './lib/brand.mjs';
import { findBrowser, dumpDom } from './lib/browser.mjs';
import { loadKnowledge, mergeKnowledge, validateKnowledge, saveKnowledge, knowledgePath, knowledgeLines } from './lib/knowledge.mjs';
import { trackedIssues, emptyRoadmap, mergeRoadmap, patchErrors, validateRoadmap, progress, openGroups, nextStep, openQuestions, boardMarkdown, needsEstimate } from './lib/roadmap.mjs';
import { roadmapBriefMarkdown } from './lib/roadmap-brief.mjs';
import { buildRoadmapHtml } from './lib/roadmap-html.mjs';
import { validateBacklog, orderBacklog, renderBacklog } from './lib/backlog.mjs';
import { loadSchema, validate } from './lib/schema.mjs';
import { withoutDismissed } from './lib/score.mjs';
import { validateSynthesis, reportItems, planFixes, printedFindings } from './lib/synthesis.mjs';
import { lintItems, lintSummary } from './lib/readability.mjs';
import { participants, briefInput, validateBrief, validateBriefReview, briefFile, audienceOf } from './lib/brief.mjs';
import { buildBriefHtml, readFit } from './lib/brief-html.mjs';
import { findPerson } from './lib/knowledge.mjs';

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const rootOf = (o) => path.resolve(o.root ?? process.cwd());

function requireArea(area) {
  if (!AREAS.includes(area)) throw new Error(`Unknown or missing --area "${area ?? ''}". Valid areas: ${AREAS.join(', ')}`);
}

function checkUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error(`Invalid URL "${url}". Use a full address such as https://example.com`); }
  if (!/^https?:$/.test(u.protocol)) throw new Error(`Invalid URL "${url}". Only http:// and https:// addresses can be checked.`);
}

function loadRun(o) {
  const root = rootOf(o);
  const run = resolveRun(root, o.run);
  // A brand name the user corrected after the run counts at once, in every document and for every reviewer.
  return { root, run, profile: withBrandFact(readJson(path.join(run.dir, 'profile.json')), loadKb(root)) };
}

function loadDoc(o) {
  const ctx = loadRun(o);
  const doc = readJson(path.join(ctx.run.dir, 'findings.json'), null);
  if (!doc) throw new Error(`Run ${ctx.run.id} has not been merged yet — run "ph merge" first.`);
  const name = ctx.profile.brand?.nameFrom === NAME_FROM.human ? ctx.profile.brand.name : null;
  return { ...ctx, doc: name ? { ...doc, project: { ...doc.project, name } } : doc };
}

function readChecklist(run) {
  const file = path.join(run.dir, 'checklist.md');
  if (!fs.existsSync(file)) throw new Error(`Run ${run.id} has no checklist.md — run "ph checklist" first.`);
  return fs.readFileSync(file, 'utf8');
}

function countBy(findings) {
  const c = { critical: 0, high: 0, medium: 0, low: 0, structural: 0, tooling: 0 };
  for (const f of findings) {
    if (f.kind === 'tooling') { c.tooling += 1; continue; }
    c[f.severity] += 1;
    if (f.direction) c.structural += 1;
  }
  return c;
}

export function init(o) {
  const root = rootOf(o);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Project folder not found: ${root}`);
  if (o.url) checkUrl(o.url);
  const only = o.only ? o.only.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const profile = buildProfile(root, { only });
  if (o.url) profile.url = o.url;
  const run = createRun(root);
  writeJson(path.join(healthDir(root), 'profile.json'), profile);
  writeJson(path.join(run.dir, 'profile.json'), profile);
  return {
    run: run.id, runDir: run.dir, stacks: profile.stacks, siteType: profile.siteType,
    applicableAreas: profile.applicableAreas, skippedAreas: profile.skippedAreas, isGitRepo: profile.isGitRepo,
    brand: profile.brand, tools: profile.tools, staleFacts: profile.staleFacts,
  };
}

export function collect(o) {
  const { root, run, profile } = loadRun(o);
  const data = runCollect(root, profile);
  writeJson(path.join(run.dir, 'collect.json'), data);
  return {
    run: run.id,
    secretsInFiles: data.secrets.files.length,
    secretsInHistory: data.secrets.history.length,
    trackedEnvFiles: data.secrets.trackedEnvFiles,
    npmAudit: data.audit.npm?.counts ?? null,
    composerAdvisories: data.audit.composer?.packages.length ?? null,
    recurringChangeSets: data.git?.recurringChangeSets.length ?? 0,
    skippedChecks: data.skippedChecks,
  };
}

export async function probe(o) {
  const { root, run, profile } = loadRun(o);
  const url = o.url ?? profile.url;
  if (!url) throw new Error('No URL given. Pass --url https://… (or pass it to "ph init").');
  checkUrl(url);
  const lighthouse = o['no-lighthouse'] ? null : (u) => runLighthouse(u, { browser: profile.tools?.browser ?? null });
  const live = await probeLive(url, { lighthouse });
  writeJson(path.join(run.dir, 'live.json'), live);
  if (live.reachable) {
    profile.url = url;
    if (!live.blocked) {
      const humanName = loadKb(root).some((f) => f.source === 'human' && f.key === 'brand.name');
      profile.brand = {
        ...profile.brand,
        name: (!humanName && live.brand.name) || profile.brand?.name,
        nameFrom: (!humanName && live.brand.name) ? NAME_FROM.live : profile.brand?.nameFrom,
        primaryColor: profile.brand?.primaryColor ?? live.brand.themeColor ?? null,
        logo: profile.brand?.logo ?? live.brand.logo ?? null,
      };
    }
    writeJson(path.join(run.dir, 'profile.json'), profile);
  }
  return {
    run: run.id, reachable: live.reachable, blocked: Boolean(live.blocked), finalUrl: live.finalUrl ?? null, pages: live.pages?.length ?? 0,
    lighthouse: Boolean(live.lighthouse), skippedChecks: live.skippedChecks, errors: live.errors,
  };
}

function liveLine(file, live) {
  if (!live) return '- Live site data: none — no URL was given. Rules that need the live site must use "verified": false.';
  if (live.reachable !== false && live.blocked !== true) return `- Live site data: ${file}`;
  const reason = live.reachable === false ? (live.errors?.[0] ?? 'no response') : `the home page returned HTTP ${live.home?.status ?? 'error'}`;
  return `- Live site data: ${file} — the site was unreachable or blocked (${reason}); treat rules that need live page content as "verified": false.`;
}

function previousLines(root, run, area) {
  const docs = previousRuns(root, run.id).map((id) => readJson(path.join(healthDir(root), 'runs', id, 'findings.json')));
  const prev = previousAreaFindings(area, docs).filter((f) => !RETIRED_RULES[f.rule]);
  if (!prev.length) return ['None — this area has not been analysed before, or it found nothing.'];
  return [
    'Re-check each of these. If it still applies, report it again with exactly the same `rule` and `subject` (title, severity and evidence may change). If it no longer applies, leave it out. If you could not check it this time (for example the live site was not available), report it again with `"verified": false`.',
    '',
    ...prev.map((f) => `- \`${f.rule}\` · subject \`${f.subject}\` · ${f.title.replace(/\s+/g, ' ')}`),
  ];
}

function deliveryLines(root, run, area, save) {
  const cmd = `node "${path.join(SKILL_DIR, 'scripts', 'ph.mjs')}" save-area --root "${root}" --run ${run.id} --area ${area}`;
  return saveLines(cmd, save, '{ "findings": [ ... ], "facts": [ ... ] }', `${area}: ok, 7 findings`, `${area}: invalid — <first error>`);
}

function saveLines(cmd, save, shape, okLine, badLine) {
  if (!save) {
    return ['Reply with the JSON object only, as described under "Output". Do not write any files.'];
  }
  return [
    'Save the JSON object by passing it to this command on standard input (Bash, with the quoted heredoc so nothing is expanded):',
    '',
    '```bash',
    `${cmd} <<'PH_JSON'`,
    shape,
    'PH_JSON',
    '```',
    '',
    `In PowerShell, pipe a here-string instead: \`@'<newline>{ ... }<newline>'@ | ${cmd}\`.`,
    `If the shell rejects the heredoc (some tool wrappers stop at quotes inside it), write the JSON to a file outside the project with your file-writing tool and run \`${cmd} < "<that file>"\`.`,
    '',
    'It prints `"ok": true` when the result is valid. When it prints `"ok": false`, fix every item in `errors` and save again; stop after three attempts.',
    `Then reply with one line only, for example \`${okLine}\` or \`${badLine}\`. Do not repeat the result in your reply.`,
  ];
}

// Every subagent prompt carries the rule that nobody outside the run is contacted.
const noContact = () => fs.readFileSync(path.join(SKILL_DIR, 'agents', '_no-contact.md'), 'utf8').trim();

export function context(o) {
  requireArea(o.area);
  const { root, run, profile } = loadRun(o);
  const read = (rel) => fs.readFileSync(path.join(SKILL_DIR, rel), 'utf8').trim();
  const stacksDir = path.join(SKILL_DIR, 'references', 'stacks');
  const packs = profile.stacks.map((s) => path.join(stacksDir, `${s}.md`)).filter((p) => fs.existsSync(p));
  if (!packs.length) packs.push(path.join(stacksDir, 'generic.md'));
  const liveFile = path.join(run.dir, 'live.json');
  const live = readJson(liveFile, null);
  // ai-setup compares everything the knowledge base knows with AGENTS.md, so it sees every fact.
  const facts = loadKb(root)
    .filter((f) => o.area === 'ai-setup' || f.by === o.area || f.source === 'human' || f.key.startsWith(`${o.area}.`))
    .map(({ history, sourceHash, ...f }) => f);
  const stale = (profile.staleFacts ?? []).filter((s) => s.by === o.area);
  return [
    read('agents/_contract.md'),
    '',
    read(`agents/${o.area}.md`),
    '',
    noContact(),
    '',
    '## Inputs for this run',
    '',
    `- Project root: ${root}`,
    `- Area: ${o.area}`,
    `- Site type: ${profile.siteType}; stacks: ${profile.stacks.join(', ')}`,
    `- Profile: ${path.join(run.dir, 'profile.json')}`,
    `- Local tool output: ${path.join(run.dir, 'collect.json')}`,
    liveLine(liveFile, live),
    `- Severity rubric: ${path.join(SKILL_DIR, 'references', 'severity-rubric.md')}`,
    `- Finding schema: ${path.join(SKILL_DIR, 'references', 'finding.schema.json')}`,
    ...packs.map((p) => `- Stack pack: ${p}`),
    `- Today: ${today()}`,
    '',
    '### Known facts',
    '',
    facts.length ? `\`\`\`json\n${JSON.stringify(facts, null, 2)}\n\`\`\`` : 'None yet.',
    '',
    '### Stale facts to re-derive',
    '',
    stale.length ? stale.map((s) => `- ${s.key} (${s.reason})`).join('\n') : 'None.',
    '',
    '### Project knowledge',
    '',
    ...knowledgeLines(loadKnowledge(root)),
    '',
    '### Findings from the previous run',
    '',
    ...previousLines(root, run, o.area),
    '',
    '## Delivering your result',
    '',
    ...deliveryLines(root, run, o.area, Boolean(o.save)),
    '',
  ].join('\n');
}

function checkAreaFile(area, file) {
  let data;
  try { data = parseLooseJson(fs.readFileSync(file, 'utf8')); } catch (e) { return { ok: false, area, errors: [`invalid JSON: ${e.message}`], warnings: [] }; }
  const { errors, warnings } = validateAreaOutput(area, data);
  return { ok: errors.length === 0, area, findings: Array.isArray(data.findings) ? data.findings.length : 0, errors, warnings };
}

function readStdin() {
  if (process.stdin.isTTY) throw new Error('save-area reads the JSON from standard input — pipe it in.');
  return fs.readFileSync(0, 'utf8');
}

// Reads a subagent's JSON from standard input, so the result goes straight to disk without passing through the
// orchestrator's conversation.
export function saveArea(o, { stdin = readStdin } = {}) {
  requireArea(o.area);
  const { run } = loadRun(o);
  const text = stdin();
  const file = path.join(run.dir, 'areas', `${o.area}.json`);
  let data = null;
  try { data = parseLooseJson(text); } catch { /* saved as received so merge reports it */ }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (data) writeJson(file, data);
  else fs.writeFileSync(file, text);
  return { ...checkAreaFile(o.area, file), path: file };
}

export function validateArea(o) {
  requireArea(o.area);
  const { run } = loadRun(o);
  const file = path.join(run.dir, 'areas', `${o.area}.json`);
  if (!fs.existsSync(file)) return { ok: false, area: o.area, errors: [`${file} does not exist — the area has not saved a result`], warnings: [] };
  return checkAreaFile(o.area, file);
}

export function merge(o) {
  const { root, run, profile } = loadRun(o);
  const outputs = {};
  const failures = {};
  for (const area of profile.applicableAreas) {
    const file = path.join(run.dir, 'areas', `${area}.json`);
    if (!fs.existsSync(file)) continue;
    try { outputs[area] = parseLooseJson(fs.readFileSync(file, 'utf8')); } catch (e) { failures[area] = `invalid JSON: ${e.message}`; }
  }
  const previous = previousRuns(root, run.id).map((id) => readJson(path.join(healthDir(root), 'runs', id, 'findings.json')));
  const collected = readJson(path.join(run.dir, 'collect.json'), { skippedChecks: [] });
  const live = readJson(path.join(run.dir, 'live.json'), null);
  const notVerified = [...(collected.skippedChecks ?? []), ...(live?.skippedChecks ?? [])];
  if (!live && profile.siteType !== 'library') notVerified.push('No live site address was given, so the live server, its security settings, the published pages and page speed were not measured');

  const { doc, factsByArea, warnings } = mergeRun({
    runId: run.id,
    project: { name: profile.brand?.name ?? path.basename(root), url: profile.url ?? null },
    mode: o.mode === 'sequential' ? 'sequential' : 'subagents',
    planned: { applicable: profile.applicableAreas, skipped: profile.skippedAreas },
    outputs,
    failures,
    previous,
    notVerified,
    liveAvailable: Boolean(live && live.reachable !== false && !live.blocked),
  });
  writeJson(path.join(run.dir, 'findings.json'), doc);
  let kb = loadKb(root);
  for (const [area, facts] of Object.entries(factsByArea)) kb = mergeFacts(kb, facts, { root, by: area });
  saveKb(root, kb);
  return {
    run: run.id,
    overallScore: doc.overallScore,
    areas: Object.fromEntries(Object.entries(doc.areas).map(([a, s]) => [a, s.status === 'ok' ? `ok (${s.score})` : `${s.status}: ${s.reason}`])),
    counts: countBy(doc.findings),
    fixed: doc.fixed.length,
    notRechecked: doc.notRechecked.length,
    warnings,
  };
}

// Findings dismissed ([-]) in the latest earlier checklist, matched to this run by rule and subject.
function carriedDismissals(root, run, doc) {
  for (const id of previousRuns(root, run.id)) {
    const dir = path.join(healthDir(root), 'runs', id);
    const md = path.join(dir, 'checklist.md');
    if (!fs.existsSync(md)) continue;
    const { dismissed } = parseTicks(fs.readFileSync(md, 'utf8'));
    const keys = new Set(readJson(path.join(dir, 'findings.json')).findings.filter((f) => dismissed.has(f.id)).map(identityKey));
    return new Set(doc.findings.filter((f) => keys.has(identityKey(f))).map((f) => f.id));
  }
  return new Set();
}

export function checklist(o) {
  const { root, run, doc } = loadDoc(o);
  const file = path.join(run.dir, 'checklist.md');
  const dismissed = carriedDismissals(root, run, doc);
  const md = renderChecklist(doc, { final: Boolean(o.final), dismissed });
  fs.writeFileSync(file, md);
  return {
    run: run.id, path: file, findings: doc.findings.length, ticked: parseTicks(md).ticked.size, dismissedEarlier: dismissed.size, counts: countBy(doc.findings),
    notAnalysed: Object.entries(doc.areas).filter(([, s]) => s.status !== 'ok').map(([a, s]) => `${a}: ${s.status} — ${s.reason}`),
  };
}

export function render(o) {
  const { root, run } = loadRun(o);
  return { run: run.id, ...renderReport(root, run.dir) };
}

const STAGES = ['synthesis', 'edit'];

function requireStage(stage) {
  if (!STAGES.includes(stage)) throw new Error(`Unknown or missing --stage "${stage ?? ''}". Valid stages: ${STAGES.join(', ')}`);
}

// The findings the report is about: ticked in the checklist, with dismissed findings removed from the scores.
function reportSelection(run, rawDoc) {
  const { selected: ids, dismissed } = resolveSelection(rawDoc, parseTicks(readChecklist(run)));
  const doc = withoutDismissed(rawDoc, dismissed);
  const chosenIds = new Set(ids);
  return { doc, selectedIds: ids, chosen: doc.findings.filter((f) => chosenIds.has(f.id)), printed: printedFindings(doc, ids) };
}

function readability(printed, syn) {
  const problems = lintItems(reportItems(printed, syn), (syn?.glossary ?? []).map((g) => g.term));
  return { problems, summary: lintSummary(problems) };
}

// Instructions for the two report-time agents: the synthesis step groups the ticked findings into decisions and
// themes for the site owner; the edit step rewrites that text for a non-technical reader.
export function reportContext(o) {
  requireStage(o.stage);
  const { root, run, doc: rawDoc } = loadDoc(o);
  const { doc, chosen, printed } = reportSelection(run, rawDoc);
  if (!chosen.length) throw new Error('No findings are ticked in the checklist — tick some, then run the report again.');
  const read = (rel) => fs.readFileSync(path.join(SKILL_DIR, rel), 'utf8').trim();
  const cmd = `node "${path.join(SKILL_DIR, 'scripts', 'ph.mjs')}" save-report --root "${root}" --run ${run.id} --stage ${o.stage}`;
  const synFile = path.join(run.dir, 'synthesis.json');
  const lines = [read(o.stage === 'synthesis' ? 'agents/synthesis.md' : 'agents/editor.md'), '', noContact(), '', '## Inputs for this run', '', `- Project root (read-only): ${root}`];
  // What the probe measured settles some open questions, such as whether the settings file can be downloaded.
  const liveFile = path.join(run.dir, 'live.json');
  if (fs.existsSync(liveFile)) lines.push(`- What the probe measured on the live site: ${liveFile}. These are measured facts (for example "exposed": whether the private settings file or the project history can be downloaded from the site). Where one answers what a problem asks to check, say what was measured instead of leaving it open.`);

  if (o.stage === 'synthesis') {
    const selectedFile = path.join(run.dir, 'selected.json');
    writeJson(selectedFile, {
      run: run.id, project: doc.project, overallScore: doc.overallScore,
      areas: doc.areas, findings: chosen.map(({ status, ...f }) => f),
      // The register lists every problem found, so the unticked ones need plain wording too.
      otherIssues: printed.filter((f) => !chosen.includes(f)).map(({ id, area, severity, title, why, verified, toConfirm }) => ({ id, area, severity, title, why, verified, toConfirm })),
    });
    const counts = countBy(chosen);
    lines.push(
      `- Ticked findings: ${selectedFile} (${chosen.length}: ${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low, ${counts.structural} structural, ${counts.tooling} AI tooling; plus ${printed.length - chosen.length} other problems in otherIssues that the register also lists)`,
      `- Knowledge base: ${path.join(healthDir(root), 'kb', 'facts.json')}`,
      `- Project knowledge (people, key features, what is allowed and what is not; respect it): ${knowledgePath(root)}`,
      `- Profile: ${path.join(run.dir, 'profile.json')}`,
      `- Synthesis schema: ${path.join(SKILL_DIR, 'references', 'synthesis.schema.json')}`,
      `- Today: ${today()}`,
    );
  } else {
    const syn = readJson(synFile, null);
    if (!syn) throw new Error(`Run ${run.id} has no synthesis.json — run the synthesis stage first.`);
    const { problems } = readability(printed, syn);
    lines.push(
      `- Synthesis to edit: ${synFile}`,
      `- Ticked findings (for checking facts): ${path.join(run.dir, 'selected.json')}`,
      `- Synthesis schema: ${path.join(SKILL_DIR, 'references', 'synthesis.schema.json')}`,
      '',
      '### The report text, as the reader will see it',
      '',
      ...reportItems(printed, syn).map(({ path: p, text }) => `- \`${p}\`: ${text.replace(/\s+/g, ' ')}`),
      '',
      '### Readability check',
      '',
      ...(problems.length ? problems.map((p) => `- \`${p.path}\` · ${p.kind} · ${p.match}`) : ['No mechanical problems found.']),
    );
  }
  lines.push('', '## Delivering your result', '', ...saveLines(cmd, Boolean(o.save), '{ "summary": { ... }, "decisions": [ ... ], ... }', `${o.stage}: ok`, `${o.stage}: invalid — <first error>`), '');
  return lines.join('\n');
}

export function saveReport(o, { stdin = readStdin } = {}) {
  requireStage(o.stage);
  const { run, doc: rawDoc } = loadDoc(o);
  const { doc, selectedIds, printed } = reportSelection(run, rawDoc);
  let syn;
  try { syn = parseLooseJson(stdin()); } catch (e) { return { ok: false, stage: o.stage, errors: [`invalid JSON: ${e.message}`], warnings: [] }; }
  const synFile = path.join(run.dir, 'synthesis.json');
  const draftFile = path.join(run.dir, 'synthesis.draft.json');
  const draft = o.stage === 'edit' ? readJson(draftFile, null) : null;
  const { errors, warnings } = validateSynthesis(syn, { doc, selectedIds, stage: o.stage, draft });
  if (errors.length) return { ok: false, stage: o.stage, errors, warnings };
  writeJson(synFile, syn);
  if (o.stage === 'synthesis') writeJson(draftFile, syn);
  return {
    ok: true, stage: o.stage, path: synFile, decisions: syn.decisions.length, themes: syn.themes.length, planFixes: planFixes(syn).length,
    readability: readability(printed, syn).summary, warnings,
  };
}

export function selected(o) {
  const { run, doc } = loadDoc(o);
  const { selected: ids, warnings } = resolveSelection(doc, parseTicks(readChecklist(run)));
  const chosen = new Set(ids);
  return { run: run.id, warnings, findings: doc.findings.filter((f) => chosen.has(f.id)).map(({ status, ...f }) => f) };
}

export function backlogRender(o) {
  const { run, doc } = loadDoc(o);
  const file = path.join(run.dir, 'backlog.json');
  if (!fs.existsSync(file)) return { ok: false, errors: [`${file} does not exist — save the backlog JSON there first`], warnings: [] };
  let data;
  try { data = parseLooseJson(fs.readFileSync(file, 'utf8')); } catch (e) { return { ok: false, errors: [`invalid JSON: ${e.message}`], warnings: [] }; }
  const { selected: ids } = resolveSelection(doc, parseTicks(readChecklist(run)));
  const { errors, warnings, items } = validateBacklog(data, doc, ids);
  if (errors.length) return { ok: false, errors, warnings };
  let ordered;
  try { ordered = orderBacklog(items); } catch (e) { return { ok: false, errors: [e.message], warnings }; }
  const out = path.join(run.dir, 'backlog.md');
  fs.writeFileSync(out, renderBacklog(ordered, doc));
  return { ok: true, path: out, items: ordered.length, warnings };
}

export function latest(o) {
  return { run: resolveRun(rootOf(o)).id };
}

export function fact(o) {
  const root = rootOf(o);
  if (!o.key || o.value === undefined) throw new Error('Usage: ph fact --key business.goal --value "Get demo requests"');
  let value = o.value;
  try { value = JSON.parse(o.value); } catch { /* plain text value */ }
  const entry = { key: o.key, value, source: 'human', confidence: 'high' };
  const errors = validate(loadSchema('fact'), entry);
  if (errors.length) throw new Error(`Invalid fact: ${errors.join('; ')}`);
  const facts = loadKb(root).filter((f) => f.key !== o.key);
  facts.push({ ...entry, observedAt: today(), by: 'human', history: [] });
  saveKb(root, facts);
  return { ok: true, key: o.key, value };
}

// ---- Project knowledge and the implementation roadmap ----

function readJsonInput(stdin, what) {
  try { return { data: parseLooseJson(stdin()) }; } catch (e) { return { error: { ok: false, errors: [`invalid JSON for ${what}: ${e.message}`], warnings: [] } }; }
}

export function knowledgeSave(o, { stdin = readStdin } = {}) {
  const root = rootOf(o);
  // Knowledge is kept beside a health check: a --root that points anywhere else would make a project nobody reads.
  if (!fs.existsSync(path.join(healthDir(root), 'runs'))) throw new Error(`No health check has been run in ${root}, so the knowledge would be saved where nothing reads it. Check --root: it is the project folder the health check ran on (on Windows, write a path such as /c/Work/site as C:/Work/site).`);
  const { data, error } = readJsonInput(stdin, 'the knowledge');
  if (error) return error;
  const next = mergeKnowledge(loadKnowledge(root), data);
  const errors = validateKnowledge(next);
  if (errors.length) return { ok: false, errors, warnings: [] };
  const name = readJson(path.join(healthDir(root), 'profile.json'), {})?.brand?.name ?? path.basename(root);
  const md = saveKnowledge(root, next, name);
  return { ok: true, path: knowledgePath(root), markdown: md, people: next.people.map((p) => `${p.name} (${p.role})`), notes: next.notes.length };
}

// The findings the roadmap plans: everything the run found, minus what the reviewer dismissed in the checklist.
function roadmapRun(o) {
  const { root, run, profile, doc: raw } = loadDoc(o);
  const md = path.join(run.dir, 'checklist.md');
  const dismissed = fs.existsSync(md) ? resolveSelection(raw, parseTicks(fs.readFileSync(md, 'utf8'))).dismissed : [];
  const file = path.join(run.dir, 'roadmap.json');
  return { root, run, profile, doc: withoutDismissed(raw, dismissed), file, roadmap: readJson(file, null), knowledge: loadKnowledge(root) };
}

function roadmapProgress(ctx, roadmap) {
  const p = progress(roadmap, ctx.doc);
  const final = validateRoadmap(roadmap, ctx.doc, { final: true, knowledge: ctx.knowledge });
  return {
    tracked: p.tracked, agreed: p.agreed, draft: p.draft, backlog: p.backlog, discarded: p.discarded, open: p.open,
    openQuestions: openQuestions(roadmap).map((q) => `${q.id}: ${q.text}`),
    readyToRender: final.errors.length === 0,
    nextStep: nextStep(roadmap, ctx.doc, ctx.knowledge, final.errors),
    stillNeeded: final.errors.slice(0, 12),
    solutions: roadmap.solutions.map((s) => ({
      id: s.id, title: s.title, status: s.status, owner: s.owner ?? null, phase: s.phase ?? null, problems: s.findingIds.length,
      tasksWithoutAssignee: (s.tasks ?? []).filter((t) => !t.assignee).length, tasksWithoutEstimate: (s.tasks ?? []).filter((t) => !t.estimate && needsEstimate(ctx.knowledge, t)).length,
    })),
  };
}

// Starts the roadmap when there is none, and writes every tracked problem with its details and where it is planned
// to roadmap-issues.json for the planner to read.
export function roadmapStatus(o) {
  const ctx = roadmapRun(o);
  const roadmap = ctx.roadmap ?? emptyRoadmap(ctx.run.id);
  if (!ctx.roadmap) writeJson(ctx.file, roadmap);
  const syn = readJson(path.join(ctx.run.dir, 'synthesis.json'), null);
  const p = progress(roadmap, ctx.doc);
  const issuesFile = path.join(ctx.run.dir, 'roadmap-issues.json');
  writeJson(issuesFile, {
    run: ctx.run.id,
    issues: trackedIssues(ctx.doc).map(({ status, ...f }) => ({ ...f, plainTitle: syn?.wording?.[f.id]?.title, plannedIn: p.where.get(f.id)?.by ?? null })),
    tooling: ctx.doc.findings.filter((f) => f.kind === 'tooling').map(({ status, ...f }) => ({ ...f, plannedIn: p.where.get(f.id)?.by ?? null })),
  });
  return {
    run: ctx.run.id, roadmap: ctx.file, issues: issuesFile, knowledge: knowledgePath(ctx.root),
    report: fs.existsSync(path.join(ctx.run.dir, 'synthesis.json')) ? path.join(ctx.run.dir, 'synthesis.json') : null,
    people: ctx.knowledge.people.map((x) => `${x.name} (${x.role}; ${x.availability}${x.notEstimated ? '; tasks not estimated' : ''})`), notes: ctx.knowledge.notes.length,
    ...roadmapProgress(ctx, roadmap),
    openGroups: openGroups(p.openIssues, syn),
  };
}

// What the facilitator reads before the discussion: the report and its plan in short, what is unconfirmed or flagged,
// what the knowledge base holds, and where the roadmap stands.
export function roadmapBrief(o) {
  const ctx = roadmapRun(o);
  const roadmap = ctx.roadmap ?? emptyRoadmap(ctx.run.id);
  const final = validateRoadmap(roadmap, ctx.doc, { final: true, knowledge: ctx.knowledge });
  const file = (name) => (fs.existsSync(path.join(ctx.run.dir, name)) ? path.join(ctx.run.dir, name) : null);
  return roadmapBriefMarkdown({
    doc: ctx.doc,
    synthesis: readJson(path.join(ctx.run.dir, 'synthesis.json'), null),
    knowledge: ctx.knowledge,
    progress: progress(roadmap, ctx.doc),
    next: nextStep(roadmap, ctx.doc, ctx.knowledge, final.errors),
    files: { report: file('report.pdf') ?? file('report.html'), plan: file('plan.pdf') ?? file('plan.html'), checklist: file('checklist.md') },
  });
}

export function roadmapSave(o, { stdin = readStdin } = {}) {
  const ctx = roadmapRun(o);
  const { data, error } = readJsonInput(stdin, 'the roadmap');
  if (error) return error;
  const shape = patchErrors(data);
  if (shape.length) return { ok: false, errors: shape, warnings: [] };
  const { roadmap: next, moved, dropped, released, emptied } = mergeRoadmap(ctx.roadmap ?? emptyRoadmap(ctx.run.id), data);
  if (emptied.length) return { ok: false, errors: emptied.map((id) => `${id} would hold no problems: this save moves all of them to other entries (${moved.filter((m) => m.from === id).map((m) => `${m.finding} to ${m.to}`).join(', ')}). Keep a problem in ${id}, or add "${id}" to "remove".`), warnings: [] };
  const { errors, warnings } = validateRoadmap(next, ctx.doc, { knowledge: ctx.knowledge });
  if (errors.length) return { ok: false, errors, warnings };
  writeJson(ctx.file, next);
  // A problem saved into a new entry leaves its old one, and one left out of a shorter list is open again; say so,
  // because the person may not have meant it.
  const moves = moved.map((m) => `${m.finding} moved from ${m.from} to ${m.to}`)
    .concat(dropped.map((id) => `${id} held no problems any more and was removed`))
    .concat(released.map((r) => `${r.finding} left ${r.from} and is planned nowhere now: it is open again`));
  return { ok: true, path: ctx.file, moves, warnings, ...roadmapProgress(ctx, next) };
}

// Every problem and its outcome, area by area, for when the discussion has jumped around.
export function roadmapBoard(o) {
  const ctx = roadmapRun(o);
  return boardMarkdown(ctx.roadmap ?? emptyRoadmap(ctx.run.id), ctx.doc);
}

// The roadmap PDF exists only once every problem has an agreed, owned and estimated solution or a recorded reason.
export function roadmapRender(o) {
  const ctx = roadmapRun(o);
  if (!ctx.roadmap) return { ok: false, errors: ['There is no roadmap yet — run roadmap-status and plan the problems first.'], warnings: [] };
  // A preview shows the roadmap as it stands, drafts included, so the person can judge how it reads before it is
  // finished; `--only S1,X2` limits it to some entries. It never replaces roadmap.pdf.
  const preview = Boolean(o.preview);
  const { errors, warnings } = validateRoadmap(ctx.roadmap, ctx.doc, { final: !preview, knowledge: ctx.knowledge });
  if (errors.length) return { ok: false, errors, warnings, ...roadmapProgress(ctx, ctx.roadmap) };
  const only = preview && o.only ? new Set(o.only.split(',').map((x) => x.trim())) : null;
  const roadmap = only ? { ...ctx.roadmap, solutions: ctx.roadmap.solutions.filter((s) => only.has(s.id)), declined: ctx.roadmap.declined.filter((x) => only.has(x.id)) } : ctx.roadmap;
  if (only && !roadmap.solutions.length && !roadmap.declined.length) return { ok: false, errors: [`--only: none of ${[...only].join(', ')} is in the roadmap`], warnings };
  const html = buildRoadmapHtml({
    doc: ctx.doc, profile: ctx.profile, roadmap, knowledge: ctx.knowledge,
    template: fs.readFileSync(path.join(SKILL_DIR, 'templates', 'report.html'), 'utf8'),
    css: fs.readFileSync(path.join(SKILL_DIR, 'templates', 'report.css'), 'utf8'),
    logoSrc: logoSource(ctx.root, ctx.profile.brand?.logo),
    preview, only: Boolean(only),
  });
  const htmlPath = path.join(ctx.run.dir, preview ? 'roadmap-preview.html' : 'roadmap.html');
  // --html writes the page only, for quick reviews; an old PDF is removed so it is never taken for the current one.
  let pdf = null;
  if (o.html) {
    fs.writeFileSync(htmlPath, html);
    const old = htmlPath.replace(/\.html$/, '.pdf');
    try { fs.rmSync(old, { force: true }); } catch (e) {
      // A PDF open in a viewer on Windows cannot be removed.
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw e;
      warnings.push(`Could not remove the older ${old}: it is probably open in a PDF viewer, and it is not the current roadmap. Close it there; ${path.basename(htmlPath)} was written.`);
    }
  } else pdf = writeDocument(html, htmlPath, findBrowser(), warnings);
  return { ok: true, preview, html: htmlPath, pdf, solutions: roadmap.solutions.length, warnings };
}

// ---- Participant briefs: each person of the agreed roadmap gets a document of their own ----

function briefPerson(ctx, name) {
  if (!name) throw new Error('Missing --person "<name>": one of the people in the project knowledge.');
  const person = findPerson(ctx.knowledge, name);
  if (!person) throw new Error(`"${name}" is not one of the people in the project knowledge: ${ctx.knowledge.people.map((p) => p.name).join(', ')}`);
  const base = path.join(ctx.run.dir, briefFile(person.name));
  return { person, paths: { json: `${base}.json`, input: `${base}.input.json`, html: `${base}.html`, pdf: `${base}.pdf`, review: `${base}.review.json`, layout: path.join(ctx.run.dir, `layout-${briefFile(person.name)}.json`) } };
}

// Briefs are made from the agreed roadmap; a preview may be drafted from an unfinished one.
function briefRoadmap(o) {
  const ctx = roadmapRun(o);
  if (!ctx.roadmap) throw new Error('There is no roadmap yet — run the roadmap discussion first.');
  const { errors } = validateRoadmap(ctx.roadmap, ctx.doc, { final: true, knowledge: ctx.knowledge });
  if (errors.length && !o.preview) throw new Error(`The roadmap is not finished (${errors[0]}) — briefs are made from the agreed roadmap. Add --preview to draft one anyway.`);
  return { ...ctx, project: ctx.profile.brand?.name ?? ctx.doc.project.name };
}

// Who needs a brief, and how far each one has got: saved, rendered, layout-reviewed, read by a reviewer.
export function briefStatus(o) {
  const ctx = roadmapRun(o);
  if (!ctx.roadmap) return { ok: false, errors: ['There is no roadmap yet — run the roadmap discussion first.'], warnings: [] };
  const final = validateRoadmap(ctx.roadmap, ctx.doc, { final: true, knowledge: ctx.knowledge });
  const list = participants(ctx.roadmap, ctx.knowledge).map((p) => {
    const { paths } = briefPerson(ctx, p.person.name);
    const has = (f) => fs.existsSync(f);
    const next = !has(paths.json) ? 'write' : !has(paths.pdf) ? 'render' : !has(paths.layout) ? 'layout review' : !has(paths.review) ? 'reader review' : 'done';
    return { name: p.person.name, role: p.person.role, audience: p.audience, tasks: p.tasks, routeChoices: p.choices, brief: has(paths.json) ? paths.json : null, pdf: has(paths.pdf) ? paths.pdf : null, next };
  });
  const without = ctx.knowledge.people.filter((p) => !list.some((x) => x.name === p.name)).map((p) => `${p.name}: no tasks or route choices in the roadmap`);
  return { run: ctx.run.id, roadmapReady: final.errors.length === 0, people: list, noBrief: without };
}

export function briefContext(o) {
  const ctx = briefRoadmap(o);
  const { person, paths } = briefPerson(ctx, o.person);
  const syn = readJson(path.join(ctx.run.dir, 'synthesis.json'), null);
  writeJson(paths.input, briefInput({ roadmap: ctx.roadmap, knowledge: ctx.knowledge, doc: ctx.doc, synthesis: syn, person, project: ctx.project }));
  const read = (rel) => fs.readFileSync(path.join(SKILL_DIR, rel), 'utf8').trim();
  const cmd = `node "${path.join(SKILL_DIR, 'scripts', 'ph.mjs')}" brief-save --root "${ctx.root}" --run ${ctx.run.id} --person "${person.name}"`;
  const has = (f) => fs.existsSync(f);
  return [
    read('agents/brief-writer.md'), '', noContact(), '', '## Inputs for this run', '',
    `- Reader: ${person.name}, ${person.role}. Audience: **${audienceOf(person)}** (follow that section above).${person.notEstimated ? ' Agreed to work without time estimates.' : ''}`,
    `- Their work, the problems behind it and what others do around it: ${paths.input}`,
    `- The agreed roadmap: ${ctx.file}`,
    `- Every problem with its evidence: ${path.join(ctx.run.dir, 'findings.json')}`,
    `- Project knowledge (people, features, what is allowed and what is not): ${knowledgePath(ctx.root)}`,
    `- Project root (read-only, for checking facts): ${ctx.root}`,
    `- Brief schema: ${path.join(SKILL_DIR, 'references', 'brief.schema.json')}`,
    has(paths.json) ? `- The current brief, to revise rather than start again: ${paths.json}` : '- There is no brief for this person yet.',
    has(paths.review) ? `- The reader review of the current brief, every issue of which you must apply or answer: ${paths.review}` : null,
    `- Today: ${today()}`,
    '', '## Delivering your result', '',
    ...saveLines(cmd, Boolean(o.save), '{ "person": "…", "audience": "…", "title": "…", "intro": "…", "items": [ ... ] }', `brief ${person.name}: ok, 7 items`, `brief ${person.name}: invalid — <first error>`),
    '',
  ].filter((l) => l !== null).join('\n');
}

const briefCss = () => fs.readFileSync(path.join(SKILL_DIR, 'templates', 'brief.css'), 'utf8');

// Lays the brief out in the browser at the printed width: each item must fit on one page, apart from its attached document.
function briefFit(ctx, brief, browser) {
  if (!browser) return { errors: [], warnings: ['No browser found, so whether each item fits on one page was not checked.'] };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-fit-'));
  try {
    const file = path.join(tmp, 'brief.html');
    fs.writeFileSync(file, buildBriefHtml({ brief, roadmap: ctx.roadmap, knowledge: ctx.knowledge, project: ctx.project, css: briefCss(), measure: true }));
    const fit = readFit(dumpDom(browser, file));
    if (!fit) return { errors: [], warnings: ['The browser did not report the page layout, so whether each item fits on one page was not checked.'] };
    const errors = [];
    const warnings = [];
    for (const { part, pages } of fit) {
      const n = part.startsWith('item ') ? Number(part.slice(5)) - 1 : null;
      const at = n === null ? part : `$.items[${n}] (${part}, "${brief.items[n].title}")`;
      if (pages > 1) errors.push(`${at} takes ${pages.toFixed(2)} pages; it must fit on one. Shorten the cards, cut the weakest block, or say a simple sequence in "next" instead of a flow`);
      else if (pages > 0.95) warnings.push(`${at} fills ${Math.round(pages * 100)}% of its page; a small change will push it onto a second one`);
    }
    return { errors, warnings };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* the browser may still hold the file on Windows */ }
  }
}

export function briefSave(o, { stdin = readStdin, browser = findBrowser() } = {}) {
  const ctx = briefRoadmap(o);
  const { person, paths } = briefPerson(ctx, o.person);
  let brief;
  try { brief = parseLooseJson(stdin()); } catch (e) { return { ok: false, errors: [`invalid JSON: ${e.message}`], warnings: [] }; }
  const { errors, warnings } = validateBrief(brief, { roadmap: ctx.roadmap, knowledge: ctx.knowledge });
  if (!errors.length && findPerson(ctx.knowledge, brief.person)?.name !== person.name) errors.push(`$.person: this brief is for ${person.name}`);
  // The page check runs whenever the brief can be laid out, so all its problems come back in one answer.
  if (!validate(loadSchema('brief'), brief).length) {
    const fit = briefFit(ctx, brief, browser);
    errors.push(...fit.errors);
    warnings.push(...fit.warnings);
  }
  if (errors.length) return { ok: false, errors, warnings };
  writeJson(paths.json, brief);
  return { ok: true, path: paths.json, items: brief.items.length, warnings };
}

export function briefRender(o) {
  const ctx = briefRoadmap(o);
  const { person, paths } = briefPerson(ctx, o.person);
  const brief = readJson(paths.json, null);
  if (!brief) return { ok: false, errors: [`There is no brief for ${person.name} yet — write it with brief-context and brief-save first.`], warnings: [] };
  const { errors, warnings } = validateBrief(brief, { roadmap: ctx.roadmap, knowledge: ctx.knowledge });
  if (errors.length) return { ok: false, errors, warnings };
  const html = buildBriefHtml({ brief, roadmap: ctx.roadmap, knowledge: ctx.knowledge, project: ctx.project, css: briefCss() });
  // A change to the template can push a saved item onto a second page; say so here too.
  if (!o.html) { const fit = briefFit(ctx, brief, findBrowser()); warnings.push(...fit.errors, ...fit.warnings); }
  let pdf;
  try {
    pdf = o.html ? (fs.writeFileSync(paths.html, html), null) : writeDocument(html, paths.html, findBrowser(), warnings);
  } catch (e) {
    // A PDF open in a viewer on Windows cannot be replaced.
    return { ok: false, errors: [`Could not replace ${paths.pdf} (${e.code ?? e.message}) — close it in the PDF viewer and render again.`], warnings };
  }
  return { ok: true, person: person.name, html: paths.html, pdf, pages: pdf ? pdfPageCount(pdf) : null, items: brief.items.length, warnings };
}

export function briefReviewContext(o) {
  const ctx = briefRoadmap(o);
  const { person, paths } = briefPerson(ctx, o.person);
  if (!fs.existsSync(paths.pdf)) throw new Error(`${person.name}'s brief has not been rendered — run brief-render first.`);
  const pages = pdfPageCount(paths.pdf);
  const cmd = `node "${path.join(SKILL_DIR, 'scripts', 'ph.mjs')}" brief-review-save --root "${ctx.root}" --run ${ctx.run.id} --person "${person.name}"`;
  return [
    fs.readFileSync(path.join(SKILL_DIR, 'agents', 'brief-review.md'), 'utf8').trim(), '', noContact(), '', '## Inputs for this run', '',
    `- The brief: ${paths.pdf} (${pages} pages); its HTML: ${paths.html}`,
    `- Its reader: ${person.name}, ${person.role}. Audience: **${audienceOf(person)}**.${person.notEstimated ? ' Works without time estimates.' : ''}`,
    `- The facts behind it, for checking claims: ${paths.input}, and every problem with its evidence in ${path.join(ctx.run.dir, 'findings.json')}`,
    `- Page images may be written to ${path.join(ctx.run.dir, `${briefFile(person.name)}-pages`)}; write nothing else.`,
    '', '## Delivering your result', '',
    ...saveLines(cmd, Boolean(o.save), `{ "person": "${person.name}", "verdict": "…", "issues": [ ... ] }`, `review ${person.name}: 2 high, 3 medium`, `review ${person.name}: invalid — <first error>`),
    '',
  ].join('\n');
}

export function briefReviewSave(o, { stdin = readStdin } = {}) {
  const ctx = briefRoadmap(o);
  const { person, paths } = briefPerson(ctx, o.person);
  if (!fs.existsSync(paths.pdf)) return { ok: false, errors: [`${person.name}'s brief has not been rendered`] };
  let review;
  try { review = parseLooseJson(stdin()); } catch (e) { return { ok: false, errors: [`invalid JSON: ${e.message}`] }; }
  const errors = validateBriefReview(review, { person: person.name, pages: pdfPageCount(paths.pdf) });
  if (errors.length) return { ok: false, errors };
  writeJson(paths.review, { ...review, pdf: paths.pdf, reviewedAt: new Date().toISOString() });
  const by = (s) => review.issues.filter((x) => x.severity === s).length;
  return { ok: true, path: paths.review, issues: { high: by('high'), medium: by('medium'), low: by('low') }, verdict: review.verdict };
}

// ---- Layout review: a fresh agent looks at every page of a rendered PDF and lists what lets the reader down ----

const LAYOUT_DOCS = { report: 'report.pdf', plan: 'plan.pdf', roadmap: 'roadmap.pdf' };
const LAYOUT_KINDS = ['overlap', 'split-box', 'empty-page', 'large-gap', 'orphan', 'overflow', 'cut-off', 'broken-text', 'inconsistent', 'other'];
// A participant's brief is reviewed like the other documents, as `--doc brief-<person>`.
const layoutFile = (d) => LAYOUT_DOCS[d] ?? (/^brief-[a-z0-9-]+$/.test(d ?? '') ? `${d}.pdf` : null);

function requireLayoutDoc(d) {
  if (!layoutFile(d)) throw new Error(`Unknown or missing --doc "${d ?? ''}". Valid documents: ${Object.keys(LAYOUT_DOCS).join(', ')}, brief-<person>`);
}

// The page count of a PDF printed by Chrome: the largest /Count is the root of the page tree.
export function pdfPageCount(file) {
  const text = fs.readFileSync(file).toString('latin1');
  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  return counts.length ? Math.max(...counts) : (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

function layoutPdf(o) {
  requireLayoutDoc(o.doc);
  const { root, run, profile } = loadRun(o);
  const pdf = path.join(run.dir, layoutFile(o.doc));
  if (!fs.existsSync(pdf)) throw new Error(`Run ${run.id} has no ${layoutFile(o.doc)} — render it first.`);
  // A PDF older than its page was not replaced by the last render (it is open in a viewer, or printing failed), so
  // reviewing it would review the previous version.
  const html = pdf.replace(/\.pdf$/, '.html');
  if (fs.existsSync(html) && fs.statSync(pdf).mtimeMs < fs.statSync(html).mtimeMs) throw new Error(`${layoutFile(o.doc)} is older than ${path.basename(html)}: the last render could not replace it (it is probably open in a PDF viewer). Close it there and render again before the layout review.`);
  return { root, run, profile, pdf, pages: pdfPageCount(pdf) };
}

export function layoutContext(o) {
  const { root, run, profile, pdf, pages } = layoutPdf(o);
  const read = fs.readFileSync(path.join(SKILL_DIR, 'agents', 'layout-review.md'), 'utf8').trim();
  const cmd = `node "${path.join(SKILL_DIR, 'scripts', 'ph.mjs')}" save-layout --root "${root}" --run ${run.id} --doc ${o.doc}`;
  return [
    read.replaceAll('<doc>', o.doc), '', noContact(), '', '## Inputs for this run', '',
    `- Document: ${pdf} (${pages} pages)`,
    `- Its HTML, for checking the markup of a block: ${pdf.replace(/\.pdf$/, '.html')}`,
    `- The company or project name on the document: "${profile.brand?.name ?? path.basename(root)}", taken from ${profile.brand?.nameFrom ?? 'the name of the project folder'}. It is a guess unless the user said it: if it is not the business's real name, or reads oddly (a theme or package name, "Home", an escaped character), report it as a content defect.`,
    '', '## Delivering your result', '',
    ...saveLines(cmd, Boolean(o.save), `{ "doc": "${o.doc}", "pagesSeen": ${pages}, "defects": [ ... ], "notes": [ ... ] }`, `layout ${o.doc}: 0 defects`, `layout ${o.doc}: 3 high, 2 medium`),
    '',
  ].join('\n');
}

export function validateLayoutReview(review, { doc, pages }) {
  const errors = [];
  if (!review || typeof review !== 'object' || Array.isArray(review)) return ['the result must be a JSON object'];
  if (review.doc !== doc) errors.push(`$.doc: expected "${doc}"`);
  if (!Number.isInteger(review.pagesSeen)) errors.push('$.pagesSeen: a whole number is required');
  else if (review.pagesSeen !== 0 && review.pagesSeen !== pages) errors.push(`$.pagesSeen: the document has ${pages} pages, you saw ${review.pagesSeen}; look at every page`);
  if (!Array.isArray(review.defects)) errors.push('$.defects: an array is required');
  if (review.notes !== undefined && (!Array.isArray(review.notes) || review.notes.some((n) => typeof n !== 'string'))) errors.push('$.notes: an array of strings is required');
  (Array.isArray(review.defects) ? review.defects : []).forEach((d, i) => {
    const at = `$.defects[${i}]`;
    if (!Number.isInteger(d?.page) || d.page < 1 || d.page > pages) errors.push(`${at}.page: a page number from 1 to ${pages} is required`);
    if (!LAYOUT_KINDS.includes(d?.kind)) errors.push(`${at}.kind: one of ${LAYOUT_KINDS.join(', ')}`);
    if (!['high', 'medium', 'low'].includes(d?.severity)) errors.push(`${at}.severity: high, medium or low`);
    if (!['template', 'content'].includes(d?.cause)) errors.push(`${at}.cause: template or content`);
    for (const k of ['where', 'what']) if (typeof d?.[k] !== 'string' || d[k].trim().length < 3) errors.push(`${at}.${k}: a short description is required`);
  });
  return errors;
}

export function saveLayout(o, { stdin = readStdin } = {}) {
  const { run, pdf, pages } = layoutPdf(o);
  let review;
  try { review = parseLooseJson(stdin()); } catch (e) { return { ok: false, doc: o.doc, errors: [`invalid JSON: ${e.message}`] }; }
  const errors = validateLayoutReview(review, { doc: o.doc, pages });
  if (errors.length) return { ok: false, doc: o.doc, errors };
  const file = path.join(run.dir, `layout-${o.doc}.json`);
  writeJson(file, { ...review, pdf, pages, reviewedAt: new Date().toISOString() });
  const by = (s) => review.defects.filter((d) => d.severity === s).length;
  return {
    ok: true, doc: o.doc, path: file, pages, pagesSeen: review.pagesSeen,
    // A reviewer that could not see the pages found nothing because it looked at nothing: that is not a clean review.
    reviewed: review.pagesSeen > 0,
    ...(review.pagesSeen > 0 ? {} : { warning: `The layout of ${o.doc} was not reviewed: the reviewer could not view the pages. Tell the user, and do not report it as free of defects.` }),
    defects: { high: by('high'), medium: by('medium'), low: by('low') },
    byCause: { template: review.defects.filter((d) => d.cause === 'template').length, content: review.defects.filter((d) => d.cause === 'content').length },
  };
}

export const COMMANDS = {
  init,
  collect,
  probe,
  context,
  'save-area': saveArea,
  'validate-area': validateArea,
  merge,
  checklist,
  'report-context': reportContext,
  'save-report': saveReport,
  render,
  selected,
  'backlog-render': backlogRender,
  latest,
  fact,
  'knowledge-save': knowledgeSave,
  'roadmap-board': roadmapBoard,
  'roadmap-brief': roadmapBrief,
  'roadmap-status': roadmapStatus,
  'roadmap-save': roadmapSave,
  'roadmap-render': roadmapRender,
  'brief-status': briefStatus,
  'brief-context': briefContext,
  'brief-save': briefSave,
  'brief-render': briefRender,
  'brief-review-context': briefReviewContext,
  'brief-review-save': briefReviewSave,
  'layout-context': layoutContext,
  'save-layout': saveLayout,
};
