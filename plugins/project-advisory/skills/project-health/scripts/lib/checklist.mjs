import { AREAS, SEVERITIES } from './areas.mjs';

const LINE_RE = /^\s*[-*+]\s+\[([ xX-])\]\s+\*\*([A-Z]+-[0-9a-f]{4,8})\*\*/;
const SEVERITY_TITLES = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

export function defaultTicked(f) {
  if (f.kind === 'tooling') return true;
  // Structural problems with a direction feed the report's decisions, so they are included by default.
  if (f.direction) return true;
  return f.severity === 'critical' || f.severity === 'high';
}

function oneLine(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function line(f, mark) {
  const tags = [];
  if (f.kind === 'tooling') tags.push(f.toolType);
  if (f.kind === 'tooling') tags.push(f.severity);
  if (f.direction) tags.push('structural');
  if (f.status === 'new') tags.push('⚠ new');
  if (!f.verified) tags.push('unverified');
  const head = `- [${mark}] **${f.id}** · ${oneLine(f.title)}${tags.map((t) => ` · ${t}`).join('')}`;
  return `${head}\n  > ${oneLine(f.why)}`;
}

// `dismissed` holds ids the reviewer marked [-] in an earlier run's checklist; they stay dismissed, even with --final.
export function renderChecklist(doc, { final = false, dismissed = new Set() } = {}) {
  const mark = (f) => (dismissed.has(f.id) ? '-' : final || defaultTicked(f) ? 'x' : ' ');
  const issues = doc.findings.filter((f) => f.kind !== 'tooling');
  const counts = SEVERITIES.map((s) => `${issues.filter((f) => f.severity === s).length} ${s}`).join(' · ');
  const out = [
    `# Project health — ${oneLine(doc.project.name)} — ${doc.run.slice(0, 10)}`,
    '',
    `<!-- run: ${doc.run} -->`,
    final
      ? 'All findings are included in the report (--final), except any dismissed in an earlier review.'
      : 'Tick `[x]` the findings to include in the report, then run `project-health report`. Mark a finding `[-]` when it is wrong or does not apply: it is left out of the report and its scores, and stays dismissed in later runs.',
    '',
    `Summary: ${counts} · ${doc.fixed.length} fixed since last run`,
    '',
  ];
  for (const s of SEVERITIES) {
    const group = issues.filter((f) => f.severity === s);
    if (group.length) out.push(`## ${SEVERITY_TITLES[s]}`, '', ...group.map((f) => line(f, mark(f))), '');
  }
  const section = (title, list) => {
    if (list.length) out.push(`## ${title}`, '', ...list.map((f) => line(f, mark(f))), '');
  };
  section('Recommended AI tooling', doc.findings.filter((f) => f.kind === 'tooling'));
  if (doc.fixed.length) out.push('## Fixed since last run', '', ...doc.fixed.map((f) => `- ~~${f.id}~~ · ${oneLine(f.title)}`), '');
  const notRechecked = doc.notRechecked ?? [];
  if (notRechecked.length) {
    out.push('## Not re-checked this run', '', ...notRechecked.map((f) => `- ${f.id} · ${oneLine(f.title)} — ${f.reason}`), '');
  }
  const notRun = AREAS.filter((a) => doc.areas[a] && doc.areas[a].status !== 'ok');
  if (notRun.length) out.push('## Areas not analysed', '', ...notRun.map((a) => `- ${a}: ${doc.areas[a].status} — ${doc.areas[a].reason}`), '');
  return out.join('\n');
}

// A finding ticked anywhere is ticked; otherwise one marked [-] anywhere is dismissed.
export function parseTicks(markdown) {
  const ticked = new Set();
  const unticked = new Set();
  const dismissed = new Set();
  for (const raw of String(markdown).split(/\r?\n/)) {
    const m = LINE_RE.exec(raw);
    if (!m) continue;
    (m[1] === ' ' ? unticked : m[1] === '-' ? dismissed : ticked).add(m[2]);
  }
  for (const id of ticked) { unticked.delete(id); dismissed.delete(id); }
  for (const id of dismissed) unticked.delete(id);
  return { ticked, unticked, dismissed };
}

export function resolveSelection(doc, parsed) {
  const known = new Set(doc.findings.map((f) => f.id));
  const warnings = [...parsed.ticked, ...parsed.unticked, ...(parsed.dismissed ?? [])]
    .filter((id) => !known.has(id))
    .map((id) => `Checklist mentions unknown finding ${id} — ignored.`);
  const selected = doc.findings.filter((f) => parsed.ticked.has(f.id)).map((f) => f.id);
  const dismissed = doc.findings.filter((f) => parsed.dismissed?.has(f.id)).map((f) => f.id);
  return { selected, dismissed, warnings };
}
