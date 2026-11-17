import { loadSchema, validate } from './schema.mjs';
import { SEVERITY_RANK } from './areas.mjs';

const PRIORITY = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

export function validateBacklog(backlog, doc, selectedIds) {
  const errors = validate(loadSchema('backlog'), backlog);
  if (errors.length) return { errors, warnings: [], items: [] };
  const warnings = [];
  const byId = new Map(doc.findings.map((f) => [f.id, f]));
  const selected = new Set(selectedIds);
  const items = backlog.items.map((i) => ({ ...i }));
  const ids = new Set();

  for (const item of items) {
    if (ids.has(item.id)) errors.push(`${item.id}: duplicate item id`);
    ids.add(item.id);
    for (const fid of item.findingIds) {
      if (!selected.has(fid)) errors.push(`${item.id}: links ${fid}, which is not ticked in the checklist`);
    }
    const severities = item.findingIds.map((fid) => byId.get(fid)?.severity).filter(Boolean);
    if (severities.length) {
      const top = severities.sort((a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b])[0];
      if (top !== item.priority) {
        warnings.push(`${item.id}: priority changed from ${item.priority} to ${top} (highest linked severity)`);
        item.priority = top;
      }
    }
  }
  for (const item of items) {
    for (const dep of item.dependsOn) {
      if (dep === item.id) errors.push(`${item.id}: depends on itself`);
      else if (!ids.has(dep)) errors.push(`${item.id}: depends on unknown item ${dep}`);
    }
  }
  const links = new Map();
  for (const fid of items.flatMap((i) => i.findingIds)) links.set(fid, (links.get(fid) ?? 0) + 1);
  for (const fid of selectedIds) {
    if (byId.get(fid)?.kind !== 'issue') continue;
    const n = links.get(fid) ?? 0;
    if (n === 0) errors.push(`Ticked issue ${fid} is not covered by any backlog item`);
    if (n > 1) errors.push(`${fid} is linked from ${n} items — each issue belongs to exactly one item`);
  }
  return { errors, warnings, items };
}

export function orderBacklog(items) {
  const cmp = (a, b) => SEVERITY_RANK[a.priority] - SEVERITY_RANK[b.priority] || a.id.localeCompare(b.id);
  const remaining = new Map(items.map((i) => [i.id, i]));
  const done = new Set();
  const ordered = [];
  while (remaining.size) {
    const ready = [...remaining.values()].filter((i) => i.dependsOn.every((d) => done.has(d))).sort(cmp);
    if (!ready.length) throw new Error(`Backlog dependencies contain a cycle among: ${[...remaining.keys()].join(', ')}`);
    const next = ready[0];
    ordered.push(next);
    done.add(next.id);
    remaining.delete(next.id);
  }
  return ordered;
}

export function renderBacklog(items, doc) {
  const byId = new Map(doc.findings.map((f) => [f.id, f]));
  const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const out = [
    `# Backlog — ${one(doc.project.name)} — ${doc.run.slice(0, 10)}`,
    '',
    `<!-- run: ${doc.run} -->`,
    'Each item states what must be true when it is done. How to get there is decided by whoever implements it.',
    '',
  ];
  for (const item of items) {
    out.push(
      `## ${item.id} · ${PRIORITY[item.priority]}`,
      '',
      `**Outcome:** ${one(item.outcome)}`,
      '',
      '**Resolves:**',
      ...item.findingIds.map((fid) => `- ${fid} — ${one(byId.get(fid)?.title ?? 'unknown finding')}`),
      '',
      `**Depends on:** ${item.dependsOn.length ? item.dependsOn.join(', ') : '—'}`,
      '',
      '**Acceptance criteria:**',
      ...item.acceptanceCriteria.map((c) => `- [ ] ${one(c)}`),
      '',
    );
  }
  return out.join('\n');
}
