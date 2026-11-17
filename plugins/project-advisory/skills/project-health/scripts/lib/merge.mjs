import { validateAreaOutput, ownFact } from './findings.mjs';
import { assignIds, identityKey, normalizeRef } from './ids.mjs';
import { AREAS, SEVERITY_RANK, RETIRED_RULES } from './areas.mjs';
import { areaScore, overallScore } from './score.mjs';

// A finding that came from the live site cannot be called fixed by a run that had no usable live data.
function needsLive(f) {
  return f.liveRun && f.evidence.some((e) => e.type === 'url' || (e.type === 'command' && /lighthouse/i.test(e.ref)));
}

export function mergeRun({ runId, project, mode = 'subagents', planned, outputs, failures = {}, previous = null, notVerified = [], liveAvailable = true }) {
  const areas = {};
  const warnings = [];
  const factsByArea = {};
  const collected = [];

  for (const area of AREAS) {
    if (planned.skipped?.[area]) { areas[area] = { status: 'skipped', reason: planned.skipped[area] }; continue; }
    if (!planned.applicable.includes(area)) { areas[area] = { status: 'skipped', reason: 'not selected' }; continue; }
    if (failures[area]) { areas[area] = { status: 'failed', reason: failures[area] }; continue; }
    const out = outputs[area];
    if (out === undefined) { areas[area] = { status: 'failed', reason: 'no output' }; continue; }
    const { errors, warnings: w } = validateAreaOutput(area, out);
    if (errors.length) { areas[area] = { status: 'failed', reason: `invalid output: ${errors.slice(0, 3).join('; ')}` }; continue; }
    warnings.push(...w.map((x) => `${area}: ${x}`));
    areas[area] = { status: 'ok' };
    collected.push(...out.findings);
    factsByArea[area] = out.facts.filter((fact) => ownFact(area, fact));
  }

  // Runs are compared by rule + subject, not by id, so a finding is matched even if its id would differ.
  const baseline = baselineFindings(areas, previous);
  const prevKeys = new Set(baseline.map(identityKey));
  const findings = assignIds(dedupe(collected).map(capUnverified), baseline)
    .map((f) => ({ ...f, status: prevKeys.has(identityKey(f)) ? 'persisting' : 'new' }))
    .sort(compareFindings);
  const currentKeys = new Set(findings.map(identityKey));
  // A retired rule's finding moved to another rule; its absence does not mean the problem was fixed.
  const gone = baseline.filter((f) => !currentKeys.has(identityKey(f)) && !RETIRED_RULES[f.rule]);
  const brief = (f) => ({ id: f.id, area: f.area, title: f.title });
  const fixed = gone.filter((f) => liveAvailable || !needsLive(f)).map(brief);
  const notRechecked = gone.filter((f) => !liveAvailable && needsLive(f))
    .map((f) => ({ ...brief(f), reason: 'needs the live site, which this run did not check' }));
  for (const area of AREAS) {
    if (areas[area].status === 'ok') areas[area].score = areaScore(findings.filter((f) => f.area === area));
  }

  return {
    doc: {
      run: runId,
      project,
      mode,
      liveAvailable,
      areas,
      overallScore: overallScore(areas),
      findings,
      fixed,
      notRechecked,
      notVerified: [...notVerified],
    },
    factsByArea,
    warnings,
  };
}

// `previous` is one earlier findings doc or a list of them, newest first. An area's baseline is its findings in
// the latest earlier run where that area ran ok.
function previousAreaDoc(area, previous) {
  const docs = Array.isArray(previous) ? previous : previous ? [previous] : [];
  return docs.find((d) => d?.areas?.[area]?.status === 'ok') ?? null;
}

export function previousAreaFindings(area, previous) {
  return (previousAreaDoc(area, previous)?.findings ?? []).filter((f) => f.area === area);
}

// Each baseline finding remembers whether its run had live data (runs merged before this field existed did not say).
function baselineFindings(areas, previous) {
  return AREAS.filter((area) => areas[area].status === 'ok').flatMap((area) => {
    const doc = previousAreaDoc(area, previous);
    return (doc?.findings ?? []).filter((f) => f.area === area).map((f) => ({ ...f, liveRun: doc.liveAvailable !== false }));
  });
}

function dedupe(findings) {
  const map = new Map();
  for (const f of findings) {
    const key = identityKey(f);
    const current = map.get(key);
    if (!current) { map.set(key, { ...f, evidence: [...f.evidence] }); continue; }
    const refs = new Set(current.evidence.map((e) => normalizeRef(e.ref)));
    for (const e of f.evidence) {
      const r = normalizeRef(e.ref);
      if (!refs.has(r)) { current.evidence.push(e); refs.add(r); }
    }
    if (SEVERITY_RANK[f.severity] < SEVERITY_RANK[current.severity]) current.severity = f.severity;
    current.verified = current.verified || f.verified;
    current.toConfirm ??= f.toConfirm;
  }
  // A check is only needed while the problem is unconfirmed.
  return [...map.values()].map(({ toConfirm, ...f }) => (f.verified || !toConfirm ? f : { ...f, toConfirm }));
}

function capUnverified(f) {
  return !f.verified && f.severity === 'critical' ? { ...f, severity: 'high', capped: true } : f;
}

function compareFindings(a, b) {
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || AREAS.indexOf(a.area) - AREAS.indexOf(b.area)
    || a.id.localeCompare(b.id);
}
