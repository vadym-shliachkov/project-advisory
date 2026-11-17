import { loadGroundwork } from './groundwork.mjs';

// The domain primer: how the project's trade works, written once and refreshed from the one before. Proposers read it
// before they propose, so they do not spend the debate learning what any insider knows (that the study they propose
// already exists, that a rival already sells the offer), and its playbook lists the ideas any adviser gives any firm
// in this trade, which they look past.

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const LIST_FIELDS = {
  commodity: { min: 1, max: 8, text: [10, 240], what: 'what buyers can get from many firms and compare on price' },
  scarce: { min: 1, max: 8, text: [10, 240], what: 'what is hard to find and buyers pay for' },
  playbook: { min: 5, max: 20, text: [10, 200], what: 'the ideas any adviser would give any firm in this trade, without looking at this one' },
};

function textError(value, at, [min, max]) {
  if (typeof value !== 'string') return [`${at}: text is required`];
  const t = one(value);
  if (t.length < min) return [`${at}: at least ${min} characters are required`];
  if (t.length > max) return [`${at}: at most ${max} characters (it has ${t.length})`];
  return [];
}

export function validatePrimer(p, { refresh = false } = {}) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['$.primer: an object is required'];
  const errors = [...textError(p.trade, '$.primer.trade', [40, 800]), ...textError(p.economics, '$.primer.economics', [40, 1200])];
  if (!Array.isArray(p.buyers) || p.buyers.length < 1 || p.buyers.length > 6) errors.push('$.primer.buyers: one to six kinds of buyer, each { "who", "job", "howTheyBuy" }');
  else p.buyers.forEach((b, i) => {
    const at = `$.primer.buyers[${i}]`;
    errors.push(...textError(b?.who, `${at}.who`, [3, 160]), ...textError(b?.job, `${at}.job`, [10, 400]), ...textError(b?.howTheyBuy, `${at}.howTheyBuy`, [10, 500]));
  });
  for (const [field, rule] of Object.entries(LIST_FIELDS)) {
    const list = p[field];
    if (!Array.isArray(list) || list.length < rule.min || list.length > rule.max) errors.push(`$.primer.${field}: ${rule.min} to ${rule.max} lines: ${rule.what}`);
    else list.forEach((x, i) => errors.push(...textError(x, `$.primer.${field}[${i}]`, rule.text)));
  }
  if (p.clocks !== undefined) {
    if (!Array.isArray(p.clocks) || p.clocks.length > 8) errors.push('$.primer.clocks: up to eight dates set from outside (a law, a standard, a season), each { "what", "when" }');
    else p.clocks.forEach((c, i) => errors.push(...textError(c?.what, `$.primer.clocks[${i}].what`, [10, 300]), ...textError(c?.when, `$.primer.clocks[${i}].when`, [4, 60])));
  }
  if (p.vocabulary !== undefined) {
    if (!Array.isArray(p.vocabulary) || p.vocabulary.length > 15) errors.push('$.primer.vocabulary: up to fifteen words of the trade, each { "term", "means" }');
    else p.vocabulary.forEach((v, i) => errors.push(...textError(v?.term, `$.primer.vocabulary[${i}].term`, [2, 60]), ...textError(v?.means, `$.primer.vocabulary[${i}].means`, [10, 240])));
  }
  if (refresh) {
    if (!Array.isArray(p.changed) || p.changed.length > 10) errors.push('$.primer.changed: what changed since the primer before, up to ten lines; [] when nothing did');
    else p.changed.forEach((x, i) => errors.push(...textError(x, `$.primer.changed[${i}]`, [10, 300])));
  } else if (p.changed !== undefined) errors.push('$.primer.changed: only a refresh of an earlier primer says what changed');
  const known = ['trade', 'buyers', 'economics', 'clocks', 'vocabulary', 'changed', ...Object.keys(LIST_FIELDS)];
  for (const key of Object.keys(p)) if (!known.includes(key)) errors.push(`$.primer: unknown property "${key}"`);
  return errors;
}

export function cleanPrimer(p) {
  const pair = (list, a, b) => (list ?? []).map((x) => ({ [a]: one(x[a]), [b]: one(x[b]) }));
  return {
    trade: one(p.trade),
    buyers: p.buyers.map((b) => ({ who: one(b.who), job: one(b.job), howTheyBuy: one(b.howTheyBuy) })),
    economics: one(p.economics),
    commodity: p.commodity.map(one), scarce: p.scarce.map(one),
    ...(p.clocks?.length ? { clocks: pair(p.clocks, 'what', 'when') } : {}),
    ...(p.vocabulary?.length ? { vocabulary: pair(p.vocabulary, 'term', 'means') } : {}),
    playbook: p.playbook.map(one),
    ...(p.changed ? { changed: p.changed.map(one) } : {}),
  };
}

// The primer as Markdown, for what is known about the project.
export function primerLines(root) {
  const record = loadGroundwork(root, 'primer');
  const p = record?.primer;
  if (!p) return { trade: [], playbook: [] };
  const trade = [
    `Written ${record.at} by a ${record.by?.skill ?? 'council'} session; its sources are in the evidence (by \`primer\`).`,
    '',
    one(p.trade),
    '',
    '**Who buys, and how**',
    ...p.buyers.map((b) => `- ${b.who}: ${b.job} How they buy: ${b.howTheyBuy}`),
    '',
    `**The economics:** ${p.economics}`,
    '',
    '**What buyers can get anywhere**',
    ...p.commodity.map((x) => `- ${x}`),
    '',
    '**What is scarce**',
    ...p.scarce.map((x) => `- ${x}`),
    ...(p.clocks?.length ? ['', '**Dates set from outside**', ...p.clocks.map((c) => `- ${c.when}: ${c.what}`)] : []),
    ...(p.vocabulary?.length ? ['', '**Words of the trade**', ...p.vocabulary.map((v) => `- ${v.term}: ${v.means}`)] : []),
    ...(p.changed?.length ? ['', '**Changed since the primer before**', ...p.changed.map((x) => `- ${x}`)] : []),
  ];
  const playbook = [
    'What any adviser would tell any firm in this trade, without looking at this one. An idea on this list tells the owner nothing new: look past it, unless what you saw makes it urgent here.',
    '',
    ...p.playbook.map((x) => `- ${x}`),
  ];
  return { trade, playbook };
}
