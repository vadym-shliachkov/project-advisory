import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from './io.mjs';
import { today, knowledgePath, holdsSecret, KIND_TITLES } from './bank.mjs';

// What the person said that outlives a session. When the person turns something down for a reason that reaches past
// that one idea ("no dark themes: our clients are over sixty"), the reason is a rule, and a rule is kept as a note in
// the knowledge bank (kb/knowledge.json), where every skill of the marketplace reads it: nothing is proposed that it
// rules out, under any name, and the docket refuses what slipped through. A strong "more of this" is kept the same
// way, as a preference. Only the person's own words are saved here, and only the person retires a note.
//
// The file is shared with the roadmap skill, which agrees the people and the ground rules of a project: a note written
// here has the shape that skill's schema allows, and every other note and every person is left exactly as it is.

export const NOTE_KINDS = ['forbidden', 'constraint', 'decision', 'preference'];
export const NOTE_KIND_WORDS = {
  forbidden: 'something that must not be proposed or done',
  constraint: 'a limit every proposal has to stay inside',
  decision: 'something that is settled and is not asked again',
  preference: 'something the person liked and wants more of',
};
const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

const load = (root) => { const k = readJson(knowledgePath(root), null); return { people: k?.people ?? [], notes: k?.notes ?? [] }; };
const nextId = (notes) => `K${notes.reduce((max, n) => Math.max(max, Number(/^K(\d+)$/.exec(n.id ?? '')?.[1] ?? 0)), 0) + 1}`;

// The Markdown copy the project-health skill keeps beside the file, for people and for assistants working on the
// project. When it is there it is written again, in the same form, so it never says less than the file it mirrors.
// (Each skill writes the bank with its own code: nothing is imported from the health skill.)
function knowledgeMarkdown(k, name) {
  const out = [`# Project knowledge — ${one(name)}`, '', `Updated ${k.updatedAt ?? today()}. Agreed with the people who run the project; written from \`kb/knowledge.json\`, so edit through the roadmap skill or that file.`, ''];
  if (k.people.length) out.push('## People', '', ...k.people.map((p) => `- **${one(p.name)}** — ${one(p.role)}${p.skills?.length ? ` · skills: ${p.skills.map(one).join(', ')}` : ''}${p.availability ? ` · ${one(p.availability)}` : ''}${p.notEstimated ? ' · tasks not estimated' : ''}${p.notes ? ` · ${one(p.notes)}` : ''}`), '');
  for (const [kind, title] of Object.entries(KIND_TITLES)) {
    const notes = k.notes.filter((n) => n.kind === kind);
    if (!notes.length) continue;
    out.push(`## ${title}`, '', ...notes.map((n) => `- **${one(n.title)}**${n.scope ? ` _(${one(n.scope)})_` : ''} — ${one(n.detail)} <!-- ${n.id}${n.source === 'project' ? ', from the project' : ''} -->`), '');
  }
  return out.join('\n');
}
function refreshMarkdown(root, knowledge, name) {
  const md = path.join(path.dirname(knowledgePath(root)), 'knowledge.md');
  if (fs.existsSync(md)) fs.writeFileSync(md, knowledgeMarkdown(knowledge, name));
}

export function addNote(root, { kind, title, detail, scope, idea, by = 'council', name = path.basename(root), date = today() }) {
  const errors = [];
  if (!NOTE_KINDS.includes(kind)) errors.push(`--type: what kind of note it is: ${NOTE_KINDS.map((k) => `${k} (${NOTE_KIND_WORDS[k]})`).join(', ')}`);
  const t = one(title);
  const d = one(detail);
  if (t.length < 5 || t.length > 120) errors.push('--title: the rule in a few words, 5 to 120 characters ("No dark themes")');
  if (d.length < 10 || d.length > 600) errors.push('--value: what the person said, in their words, with their reason, 10 to 600 characters');
  if (scope !== undefined && (one(scope).length < 2 || one(scope).length > 60)) errors.push('--scope: where it applies, in a word or two ("design", "the home page"); leave it out when it applies everywhere');
  if (idea !== undefined && !/^I\d{1,4}$/.test(idea)) errors.push('--idea: the ledger id of the idea the person was speaking of, such as I12');
  if (holdsSecret(t) || holdsSecret(d)) errors.push('A note must not hold a secret such as a password or a key: say where it is kept instead.');
  if (errors.length) return { errors };
  const knowledge = load(root);
  const same = knowledge.notes.find((n) => n.kind === kind && one(n.title).toLowerCase() === t.toLowerCase());
  if (same) return { errors: [], note: same, already: true };
  const note = { id: nextId(knowledge.notes), kind, title: t, detail: d, ...(scope ? { scope: one(scope) } : {}), source: 'person', by, ...(idea ? { ideaIds: [idea] } : {}), addedAt: date, updatedAt: date };
  const next = { people: knowledge.people, notes: [...knowledge.notes, note], updatedAt: date };
  writeJson(knowledgePath(root), next);
  refreshMarkdown(root, next, name);
  return { errors: [], note };
}

// Only the person lifts a rule they gave: the usher runs this when they say so, with their words as the reason.
export function retireNote(root, id, { name = path.basename(root), date = today() } = {}) {
  const knowledge = load(root);
  const note = knowledge.notes.find((n) => n.id === id);
  if (!note) return { errors: [`There is no note ${id ?? ''}. The notes: ${knowledge.notes.map((n) => n.id).join(', ') || 'none'}`] };
  const next = { people: knowledge.people, notes: knowledge.notes.filter((n) => n.id !== id), updatedAt: date };
  writeJson(knowledgePath(root), next);
  refreshMarkdown(root, next, name);
  return { errors: [], retired: note };
}

export const listNotes = (root) => load(root).notes.map((n) => ({ id: n.id, kind: n.kind, title: n.title, detail: n.detail, ...(n.scope ? { scope: n.scope } : {}), ...(n.ideaIds?.length ? { ideas: n.ideaIds } : {}), ...(n.by ? { by: n.by } : {}), addedAt: n.addedAt ?? null }));

// For the digest every member reads: what the person turned down and why, and what they asked for more of. A rejected
// idea is in the ledger with its reason; a rule drawn from a rejection is a note that names the idea.
export function declinedLines(notes, ideas) {
  const rejected = ideas.filter((i) => i.status === 'rejected');
  const drawn = notes.filter((n) => n.kind !== 'preference' && n.ideaIds?.length);
  const liked = notes.filter((n) => n.kind === 'preference');
  if (!rejected.length && !drawn.length && !liked.length) return [];
  return [
    ...(rejected.length || drawn.length ? ['The person turned these down. The same thing under another name, or a variant that meets the same objection, is not proposed again, and the docket refuses it; an idea that returns says what has changed.'] : []),
    ...rejected.map((i) => `- Turned down: ${i.id} "${one(i.title)}" — ${one(i.decision?.reason) || 'no reason recorded'}`),
    ...drawn.map((n) => `- The rule behind it: **${one(n.title)}**${n.scope ? ` [${one(n.scope)}]` : ''} — ${one(n.detail)} (${n.id}, said of ${n.ideaIds.join(', ')})`),
    ...(liked.length ? ['', 'The person asked for more of these. Lean towards them where they fit; they are not rules.'] : []),
    ...liked.map((n) => `- ${KIND_TITLES.preference}: **${one(n.title)}**${n.scope ? ` [${one(n.scope)}]` : ''} — ${one(n.detail)} (${n.id})`),
  ];
}
