export const WEIGHTS = { critical: 25, high: 10, medium: 4, low: 1 };

// Every problem counts, including structural ones; only AI tooling suggestions do not. (Runs merged before
// architecture findings became issues stored them as kind "opportunity"; they count too.)
export function areaScore(findings) {
  const penalty = findings.filter((f) => f.kind !== 'tooling').reduce((sum, f) => sum + WEIGHTS[f.severity], 0);
  return Math.max(0, 100 - penalty);
}

export function overallScore(areas) {
  const scores = Object.values(areas).filter((a) => a.status === 'ok').map((a) => a.score);
  if (!scores.length) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

// The findings doc as the report sees it: findings the reviewer dismissed are removed and the scores recomputed.
export function withoutDismissed(doc, dismissedIds) {
  const dismissed = new Set(dismissedIds);
  if (!dismissed.size) return doc;
  const findings = doc.findings.filter((f) => !dismissed.has(f.id));
  const areas = Object.fromEntries(Object.entries(doc.areas).map(([area, s]) => [
    area,
    s.status === 'ok' ? { ...s, score: areaScore(findings.filter((f) => f.area === area)) } : s,
  ]));
  return { ...doc, findings, areas, overallScore: overallScore(areas) };
}

// The scores as the report counts its problems: a problem several areas reported counts once, in the area of the
// finding kept for it and with the group's severity. `findings` is the doc's findings with the copies folded in.
export function scoredOnce(doc, findings) {
  const areas = Object.fromEntries(Object.entries(doc.areas).map(([area, s]) => [
    area,
    s.status === 'ok' ? { ...s, score: areaScore(findings.filter((f) => f.area === area)) } : s,
  ]));
  return { ...doc, areas, overallScore: overallScore(areas) };
}
