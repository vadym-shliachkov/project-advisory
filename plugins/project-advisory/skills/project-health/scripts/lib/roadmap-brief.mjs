import { AREAS, AREA_TITLES } from './areas.mjs';
import { planFixes } from './synthesis.mjs';
import { knowledgeLines } from './knowledge.mjs';

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// The facilitator's digest of the report and its plan, in Markdown, so the discussion starts from what the owner has
// read and nothing in it is unclear to the person running the discussion.
export function roadmapBriefMarkdown({ doc, synthesis: syn, knowledge, progress: p, next, files }) {
  const byId = new Map(doc.findings.map((f) => [f.id, f]));
  const title = (id) => one(syn?.wording?.[id]?.title ?? byId.get(id)?.title ?? id);
  const issues = doc.findings.filter((f) => f.kind !== 'tooling');
  const out = [
    `# Facilitator brief — ${one(doc.project.name)} — run ${doc.run}`,
    '',
    'Read all of this before the discussion starts. The owner has read the report and the plan; you must know them as well as they do, and know what is still unclear.',
    '',
    `- Report: ${files.report ?? 'not rendered yet'}`,
    `- Plan and effort: ${files.plan ?? 'not rendered yet'}`,
    `- Checklist: ${files.checklist ?? 'none'}`,
    '',
    '## The report in short',
    '',
    syn ? one(syn.summary.verdict) : 'The report has no synthesis yet: there are no decisions or plan to start from, so plan from the problems themselves.',
    '',
    `Overall score ${doc.overallScore ?? '—'}/100. ${issues.length} problems:`,
    '',
    ...AREAS.filter((a) => doc.areas[a]?.status === 'ok').map((a) => `- ${AREA_TITLES[a]}: ${doc.areas[a].score}/100, ${issues.filter((f) => f.area === a).length} problems`),
    '',
  ];
  if (syn?.decisions.length) {
    out.push('## Decisions the report asks the owner to make', '');
    syn.decisions.forEach((d, i) => {
      const rec = d.options.find((o) => o.recommended);
      out.push(
        `### Decision ${i + 1}: ${one(d.title)}`,
        '',
        `- Problems: ${d.findingIds.join(', ')}`,
        `- What was found: ${one(d.problem)}`,
        `- Recommended: **${one(rec.name)}** (${rec.size}) — ${one(rec.description)}`,
        `- Why: ${one(d.recommendation)}`,
        `- Other options: ${d.options.filter((o) => !o.recommended).map((o) => `${one(o.name)} (${o.size})`).join('; ')}`,
        '',
      );
    });
  }
  if (syn?.themes.length) {
    out.push('## Themes', '', ...syn.themes.map((t) => `- **${one(t.title)}** (${t.findingIds.join(', ')}): ${one(t.summary)}`), '');
  }
  if (syn?.plan) {
    out.push('## The report\'s plan ("Plan and effort")', '', one(syn.plan.summary), '');
    // Each fix of the plan is a ready starting point for a fix plan of the roadmap: its problem, routes and steps.
    const fixes = planFixes(syn);
    let n = 0;
    syn.plan.stages.forEach((stage, i) => {
      out.push(`### Stage ${i + 1}: ${one(stage.title)}`, '', one(stage.goal), '');
      for (const fx of fixes.slice(n, n += stage.fixes.length)) {
        const covers = [...(fx.covers ?? []).map((id) => {
          const d = syn.decisions.findIndex((x) => x.id === id);
          return d >= 0 ? `decision ${d + 1}` : `theme "${one(syn.themes.find((t) => t.id === id)?.title)}"`;
        }), ...(fx.findingIds ?? [])];
        out.push(`- **Fix ${fx.n}: ${one(fx.title)}**${covers.length ? ` (covers ${covers.join(', ')})` : ''}. ${one(fx.problem)}`);
        if ((fx.routes ?? []).length) out.push(`  - Routes, equally good: ${fx.routes.map((r) => `${one(r.name)} [${r.effort}]`).join(' or ')}. The choice depends on: ${one(fx.choice)}`);
        for (const st of fx.steps) {
          out.push(`  - ${st.id.replace(/^F/, '')} [${st.kind}, ${st.effort}]${st.route ? ` (${one(st.route)} only)` : ''} ${one(st.title)}: ${one(st.what)}${(st.needs ?? []).length ? ` Needs: ${st.needs.map(one).join('; ')}.` : ''}`);
        }
      }
      out.push('');
    });
  }
  const unconfirmed = issues.filter((f) => !f.verified);
  if (unconfirmed.length) {
    out.push('## Problems that are not confirmed', '', 'Each needs a check task before its fix can be estimated with confidence.', '',
      ...unconfirmed.map((f) => `- ${f.id} (${f.severity}) ${title(f.id)} — to confirm: ${one(f.toConfirm ?? 'not stated')}`), '');
  }
  const grouped = new Set([...(syn?.decisions ?? []), ...(syn?.themes ?? [])].flatMap((g) => g.findingIds));
  const outside = issues.filter((f) => !grouped.has(f.id));
  if (outside.length) {
    out.push('## Problems the report does not group or plan', '', 'The register lists them, but no decision, theme or plan step covers them. Each still needs a fix plan, to be discarded with a reason, or to move to the backlog.', '',
      ...AREAS.filter((a) => outside.some((f) => f.area === a)).map((a) => `- ${AREA_TITLES[a]}: ${outside.filter((f) => f.area === a).map((f) => `${f.id} (${f.severity})`).join(', ')}`), '');
  }
  const tools = doc.findings.filter((f) => f.kind === 'tooling');
  if (tools.length || syn?.tools?.length) {
    out.push('## AI tooling the report proposes', '', 'Optional: a fix plan may adopt them.', '', ...tools.map((f) => `- ${f.id} ${title(f.id)}`), ...(syn?.tools ?? []).map((t) => `- ${one(t.name)} (supports ${t.decision})`), '');
  }
  if (syn?.review?.notes?.length) out.push('## Points the report editor flagged', '', ...syn.review.notes.map((n) => `- ${one(n)}`), '');
  const clarify = [
    !knowledge.people.length && 'Who is available to work on the fixes: name, role, skills and how much time each has. Nothing can be planned before this.',
    syn?.decisions.length && `Whether the owner accepts each recommended option (${syn.decisions.length} decisions), or prefers another.`,
    unconfirmed.length && `Who can give the access the checks need (${unconfirmed.length} unconfirmed problems).`,
    outside.length && `What to do with the ${outside.length} problems the report did not plan: fix, discard or move to the backlog.`,
    ...(syn?.review?.notes ?? []).filter((n) => /legal|lawyer|adviser|confirm|check with/i.test(n)).map((n) => `Flagged by the editor: ${one(n)}`),
  ].filter(Boolean);
  out.push('## What to clarify with the person', '', ...clarify.map((c) => `- ${c}`), '', 'Add anything else in the report or plan that you could not explain to a developer yourself.', '');
  out.push('## Project knowledge', '', ...knowledgeLines(knowledge), '');
  out.push('## The roadmap so far', '',
    `${p.tracked} problems: ${p.agreed} with an agreed fix plan, ${p.draft} in drafts, ${p.backlog} moved to the backlog, ${p.discarded} discarded, ${p.open} open.`,
    '', `**Next step:** ${next}.`, '');
  return out.join('\n');
}
