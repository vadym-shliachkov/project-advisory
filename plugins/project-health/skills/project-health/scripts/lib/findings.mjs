import { loadSchema, validate } from './schema.mjs';
import { AREAS } from './areas.mjs';
import { identityKey } from './ids.mjs';
import { scanText } from './secrets.mjs';

export const ADVICE_RE = /\b(you should|we recommend|recommended to|consider (adding|using|switching|migrating|moving)|to fix this|should be (added|fixed|replaced|removed)|estimated? (effort|time)|\d+\s*(hours?|days?|weeks?)\s+(of work|to fix|of effort))\b/i;

export function validateAreaOutput(area, output) {
  const errors = [];
  const warnings = [];
  if (!AREAS.includes(area)) return { errors: [`unknown area "${area}"`], warnings };
  if (output === null || typeof output !== 'object' || Array.isArray(output)) {
    return { errors: ['$: expected an object with "findings" and "facts" arrays'], warnings };
  }
  for (const key of Object.keys(output)) {
    if (key !== 'findings' && key !== 'facts') errors.push(`$: unknown property "${key}"`);
  }
  if (!Array.isArray(output.findings)) errors.push('$.findings: expected array');
  if (!Array.isArray(output.facts)) errors.push('$.facts: expected array');
  if (errors.length) return { errors, warnings };

  const findingSchema = loadSchema('finding');
  const factSchema = loadSchema('fact');
  const seen = new Set();
  output.findings.forEach((f, i) => {
    const at = `$.findings[${i}]`;
    const schemaErrors = validate(findingSchema, f, at);
    errors.push(...schemaErrors);
    if (schemaErrors.length) return;
    errors.push(...kindErrors(area, f, at));
    errors.push(...secretErrors(f, at));
    for (const field of ['title', 'why']) {
      if (ADVICE_RE.test(f[field])) warnings.push(`${at}.${field}: reads like fix advice or an estimate — findings describe the problem only`);
    }
    if (f.kind === 'issue' && !f.verified && !f.toConfirm) warnings.push(`${at}.toConfirm: an unverified issue says what would confirm it and what access that needs`);
    if (f.verified && f.toConfirm) warnings.push(`${at}.toConfirm: only unverified findings need a check — it will be dropped`);
    const key = identityKey(f);
    if (seen.has(key)) warnings.push(`${at}: same rule and subject as an earlier finding — they will be merged`);
    seen.add(key);
  });
  output.facts.forEach((fact, i) => {
    const factErrors = validate(factSchema, fact, `$.facts[${i}]`);
    errors.push(...factErrors);
    if (!factErrors.length && !ownFact(area, fact)) warnings.push(`$.facts[${i}].key: "${fact.key}" does not start with "${area}." — it will not be stored`);
  });
  return { errors, warnings };
}

// Each area owns the facts under its own key prefix, so two areas never overwrite each other's facts.
export function ownFact(area, fact) {
  return fact.key.startsWith(`${area}.`);
}

const TEXT_FIELDS = ['title', 'why', 'direction', 'trigger', 'draftDescription', 'toConfirm'];

function secretErrors(f, at) {
  const texts = [
    ...TEXT_FIELDS.map((k) => [`${at}.${k}`, f[k]]),
    ...f.evidence.flatMap((e, j) => [[`${at}.evidence[${j}].ref`, e.ref], [`${at}.evidence[${j}].excerpt`, e.excerpt]]),
  ];
  return texts
    .filter(([, text]) => typeof text === 'string' && scanText(text).length > 0)
    .map(([p]) => `${p}: contains what looks like a secret — use the masked form from collect.json`);
}

function kindErrors(area, f, at) {
  const e = [];
  if (f.area !== area) e.push(`${at}.area: "${f.area}" does not match the area being analysed ("${area}")`);
  if (!f.rule.startsWith(`${area}.`)) e.push(`${at}.rule: must start with "${area}."`);
  const need = (fields) => {
    for (const k of fields) if (!f[k]) e.push(`${at}: kind "${f.kind}" requires "${k}"`);
  };
  if (f.kind === 'tooling') {
    if (f.direction) e.push(`${at}.direction: only issues carry a direction; describe the tool in "draftDescription"`);
    if (area !== 'ai-setup') e.push(`${at}.kind: tooling suggestions belong to the ai-setup area`);
    need(['toolType', 'trigger', 'draftDescription']);
    if (f.evidence.length < 3 && !f.evidence.some((x) => x.highRisk)) {
      e.push(`${at}.evidence: tooling findings need at least 3 evidence items or one marked "highRisk": true`);
    }
  }
  return e;
}
