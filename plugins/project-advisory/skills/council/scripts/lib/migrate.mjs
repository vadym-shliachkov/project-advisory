import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from './io.mjs';
import { projectDir, bankDir } from './paths.mjs';

// The skill that looks for what the business could start, sell or become used to be called the invention lab and kept
// its sessions in `.project-health/lab/`. It is the venture board now, with its sessions in `.project-health/venture/`;
// the invention lab is a new skill that invents for the thing itself. A project with sessions of the old lab is moved
// over once, the first time any of the three skills runs on it: its sessions, the ledger entries they made, their
// groundwork and the goal the person gave. A session of the new lab carries the kind of thing it studied (`object`);
// a session of the old one never does.

const isOld = (session) => session?.kind === 'lab' && !Object.hasOwn(session, 'object');
const SESSION_RE = /^\d{4}-\d{2}-\d{2}(-\d+)?$/;

export function migrateVenture(root) {
  const from = path.join(projectDir(root), 'lab');
  if (!fs.existsSync(from)) return { moved: [] };
  const old = fs.readdirSync(from).filter((id) => SESSION_RE.test(id) && isOld(readJson(path.join(from, id, 'session.json'), null)));
  if (!old.length) return { moved: [] };
  const to = path.join(projectDir(root), 'venture');
  fs.mkdirSync(to, { recursive: true });
  const moved = [];
  for (const id of old) {
    let target = id;
    for (let n = 2; fs.existsSync(path.join(to, target)); n++) target = `${id.replace(/-\d+$/, '')}-${n}`;
    fs.renameSync(path.join(from, id), path.join(to, target));
    const file = path.join(to, target, 'session.json');
    const session = readJson(file);
    writeJson(file, { ...session, id: target, kind: 'venture' });
    moved.push({ from: id, to: target });
  }
  if (!fs.readdirSync(from).length) fs.rmdirSync(from);

  // The ledger: what those sessions proposed came from the venture board, and an idea the council marked for "the
  // invention lab" was marked for the venture board.
  const ideasFile = path.join(bankDir(root), 'ideas.json');
  const ledger = readJson(ideasFile, null);
  if (ledger) {
    const ids = new Map(moved.map((m) => [m.from, m.to]));
    // The sessions of the new lab, which stay where they are: an idea of theirs keeps its origin. Every other idea
    // marked "lab" came from the old one, the smaller forms the old scripts saved under the council's name included.
    const kept = new Set(fs.existsSync(from) ? fs.readdirSync(from) : []);
    const list = Array.isArray(ledger) ? ledger : ledger.ideas ?? [];
    for (const idea of list) {
      const ofNewLab = (idea.history ?? []).some((h) => kept.has(h.session));
      const old = idea.origin === 'lab' && !ofNewLab;
      if (old) idea.origin = 'venture';
      // The old scripts stamped the verdicts of a lab session as the council's. On an idea of the old lab, an event of
      // a moved session is the venture board's; on any other idea it is left alone (a council session can share the
      // date, and so the id, of a lab session).
      for (const h of idea.history ?? []) {
        if (!ids.has(h.session) || !(h.by === 'lab' || (old && h.by === 'council'))) continue;
        h.by = 'venture';
        h.session = ids.get(h.session);
      }
      if (idea.labCandidate !== undefined) { if (idea.labCandidate) idea.ventureCandidate = true; delete idea.labCandidate; }
    }
    writeJson(ideasFile, ledger);
  }

  // The groundwork they left, and the goal the person gave the old lab.
  const work = path.join(bankDir(root), 'groundwork');
  if (fs.existsSync(work)) {
    for (const name of fs.readdirSync(work).filter((f) => f.endsWith('.json'))) {
      const record = readJson(path.join(work, name), null);
      if (record?.by?.skill === 'lab') writeJson(path.join(work, name), { ...record, by: { ...record.by, skill: 'venture' } });
    }
  }
  const factsFile = path.join(bankDir(root), 'facts.json');
  const facts = readJson(factsFile, null);
  const list = Array.isArray(facts) ? facts : facts?.facts;
  if (Array.isArray(list) && list.some((f) => f.key === 'lab.goal')) {
    for (const f of list) if (f.key === 'lab.goal') f.key = 'venture.goal';
    writeJson(factsFile, facts);
  }
  return { moved };
}
