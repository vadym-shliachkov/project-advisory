import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from './io.mjs';
import { healthDir } from './paths.mjs';
import { loadSchema, validate } from './schema.mjs';
import { scanText } from './secrets.mjs';
import { today } from './kb.mjs';

// What the people who run the project have said about it: who works on it, its key features, and what is allowed and
// what is not. It lives next to the facts in kb/, outlives every run, and later analyses and plans respect it.
export const KIND_TITLES = {
  feature: 'Key features',
  allowed: 'Allowed',
  forbidden: 'Not allowed',
  convention: 'Conventions',
  constraint: 'Constraints',
  decision: 'Decisions taken',
};

export const knowledgePath = (root) => path.join(healthDir(root), 'kb', 'knowledge.json');

export function loadKnowledge(root) {
  return readJson(knowledgePath(root), null) ?? { people: [], notes: [] };
}

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// A save carries only what changed: people replace the person with the same name, notes the note with the same id;
// `remove` drops note ids and people's names.
export function mergeKnowledge(current, patch) {
  const people = [...current.people];
  for (const p of patch.people ?? []) {
    const at = people.findIndex((x) => sameName(x.name, p.name));
    if (at >= 0) people[at] = p;
    else people.push(p);
  }
  const notes = [...current.notes];
  for (const n of patch.notes ?? []) {
    const at = notes.findIndex((x) => x.id === n.id);
    const stamped = { ...n, addedAt: n.addedAt ?? (at >= 0 ? notes[at].addedAt : null) ?? today(), updatedAt: today() };
    if (at >= 0) notes[at] = stamped;
    else notes.push(stamped);
  }
  const drop = patch.remove ?? [];
  return {
    people: people.filter((p) => !drop.some((d) => sameName(d, p.name))),
    notes: notes.filter((n) => !drop.includes(n.id)),
    updatedAt: today(),
  };
}

export function validateKnowledge(k) {
  const errors = validate(loadSchema('knowledge'), k);
  if (errors.length) return errors;
  const names = new Set();
  k.people.forEach((p, i) => {
    const key = p.name.trim().toLowerCase();
    if (names.has(key)) errors.push(`$.people[${i}].name: "${p.name}" is listed twice`);
    names.add(key);
  });
  const ids = new Set();
  k.notes.forEach((n, i) => {
    if (ids.has(n.id)) errors.push(`$.notes[${i}].id: duplicate id ${n.id}`);
    ids.add(n.id);
  });
  const texts = [...k.people.flatMap((p) => [p.name, p.role, p.notes, p.availability]), ...k.notes.flatMap((n) => [n.title, n.detail, n.scope])];
  if (texts.some((t) => t && scanText(t).length)) errors.push('The knowledge base must not hold secrets such as passwords or keys: describe where they are kept instead.');
  return errors;
}

// The person a roadmap names as owner or assignee, by name.
export function findPerson(k, name) {
  return k.people.find((p) => sameName(p.name, name)) ?? null;
}

// The same knowledge as Markdown, for people and for AI assistants working on the project.
export function knowledgeMarkdown(k, projectName) {
  const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const out = [`# Project knowledge — ${one(projectName)}`, '', `Updated ${k.updatedAt ?? today()}. Agreed with the people who run the project; written by project-health from \`kb/knowledge.json\`, so edit through the roadmap skill or that file.`, ''];
  if (k.people.length) {
    out.push('## People', '', ...k.people.map((p) => `- **${one(p.name)}** — ${one(p.role)}${p.skills?.length ? ` · skills: ${p.skills.map(one).join(', ')}` : ''}${p.availability ? ` · ${one(p.availability)}` : ''}${p.notEstimated ? ' · tasks not estimated' : ''}${p.notes ? ` · ${one(p.notes)}` : ''}`), '');
  }
  for (const [kind, title] of Object.entries(KIND_TITLES)) {
    const notes = k.notes.filter((n) => n.kind === kind);
    if (!notes.length) continue;
    out.push(`## ${title}`, '', ...notes.map((n) => `- **${one(n.title)}**${n.scope ? ` _(${one(n.scope)})_` : ''} — ${one(n.detail)} <!-- ${n.id}${n.source === 'project' ? ', from the project' : ''} -->`), '');
  }
  return out.join('\n');
}

export function saveKnowledge(root, k, projectName) {
  writeJson(knowledgePath(root), k);
  const md = path.join(path.dirname(knowledgePath(root)), 'knowledge.md');
  fs.writeFileSync(md, knowledgeMarkdown(k, projectName));
  return md;
}

// The knowledge as context lines for an analysis or planning agent.
export function knowledgeLines(k) {
  if (!k.people.length && !k.notes.length) return ['None recorded yet.'];
  return [
    'Agreed with the people who run the project. Respect it: do not recommend what it rules out, and name the conflict when a finding needs it.',
    '',
    ...k.people.map((p) => `- Person: ${p.name} — ${p.role}${p.skills?.length ? ` (${p.skills.join(', ')})` : ''}`),
    ...k.notes.map((n) => `- ${KIND_TITLES[n.kind]}: ${n.title}${n.scope ? ` [${n.scope}]` : ''} — ${n.detail.replace(/\s+/g, ' ')}`),
  ];
}
