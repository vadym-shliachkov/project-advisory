import fs from 'node:fs';
import path from 'node:path';
import { parseLooseJson } from './lib/io.mjs';
import { loadFacts, saveFacts, putFact } from './lib/bank.mjs';
import { loadIdeas, saveIdeas, applyIdeas, ideasPath, trackRecord, setAside } from './lib/ideas.mjs';
import { digest as bankDigest } from './lib/digest.mjs';
import { createSession, resolveSession, loadSession, saveSession, budgetOf, budgetWarning, spendRun, recast, takeTurn, DEFAULT_GOAL, isLab, isStudio, isFramed } from './lib/session.mjs';
import { buildContext, taskLine } from './lib/context.mjs';
import { dueForCheck } from './lib/ideas.mjs';
import { docTurns, docNextStep, advanceDocs, renderDocs, saveDocument, saveTilePage, closeSession, takePictures } from './lib/flow.mjs';
import { brandOf } from './lib/documents.mjs';
import { loadEvidence, saveEvidence, collectEvidence, addEvidence, evidencePath } from './lib/evidence.mjs';
import { loadRecord, saveRecord, say as saySaved, saveDocket, advance, turns, nextStep, openThreads } from './lib/record.mjs';
import { findBrowser, screenshot, dumpUrl, VIEWS, lookSlug } from './lib/browser.mjs';
import { saveFrame, loadFrame, validateFrame, cleanFrame, validateProvocations, cleanProvocations, pickErrors } from './lib/frame.mjs';
import { KINDS, kindOf as kindOfSession, labelOf } from './lib/paths.mjs';
import { migrateVenture } from './lib/migrate.mjs';
import { detectObject, gitHead, OBJECT_KINDS, OBJECT_WORDS } from './lib/object.mjs';
import { loadAnatomy, saveAnatomy, validateAnatomy, cleanAnatomy, anatomyView, loadGenre, saveGenre, validateGenre, cleanGenre } from './lib/anatomy.mjs';
import { saveGroundwork, parseRefresh, cachedLook, cacheLook, loadGroundwork, recordKind } from './lib/groundwork.mjs';
import { loadCurrents, saveCurrents, validateCurrents, cleanCurrents, loadSlop, saveSlop, validateSlop, cleanSlop, detectTech, SHARE_WORDS } from './lib/field.mjs';
import { addNote, retireNote, listNotes, NOTE_KINDS } from './lib/notes.mjs';
import { validatePrimer, cleanPrimer } from './lib/primer.mjs';
import { loadVerdicts, saveVerdicts, saveRulings, saveSetNotes, saveSetChanges, survivors, VERDICTS } from './lib/verdict.mjs';

// The commands of the council skill. Each returns JSON (Markdown for `digest`); a refused save returns
// { "ok": false, "errors": [...] }, which the caller fixes and sends again.

// The old invention lab's sessions are moved to the venture board the first time any command runs on the project.
const rootOf = (o) => { const root = path.resolve(o.root ?? process.cwd()); if (fs.existsSync(root)) migrateVenture(root); return root; };
const kindOf = (o) => { const k = o.kind ?? 'council'; if (!KINDS.includes(k)) throw new Error(`Unknown --kind "${k}": ${KINDS.join(', ')}`); return k; };
const fail = (...errors) => ({ ok: false, errors, warnings: [] });
const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function readStdin() {
  if (process.stdin.isTTY) throw new Error('This command reads JSON from standard input — pipe it in.');
  return fs.readFileSync(0, 'utf8');
}

function readJsonInput(stdin, what) {
  try { return { data: parseLooseJson(stdin()) }; } catch (e) { return { error: { ok: false, errors: [`invalid JSON for ${what}: ${e.message}`], warnings: [] } }; }
}

function checkUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error(`Invalid URL "${url}". Use a full address such as https://example.com`); }
  if (!/^https?:$/.test(u.protocol)) throw new Error(`Invalid URL "${url}". Only http:// and https:// addresses can be used.`);
}

function sessionCtx(o) {
  const root = rootOf(o);
  const { dir, session } = resolveSession(root, o.session, kindOf(o));
  return { root, dir, session, record: loadRecord(dir), evidence: loadEvidence(dir), verdicts: loadVerdicts(dir) };
}

function view({ root, dir, session, record, evidence, verdicts }) {
  const count = (fn) => record.threads.filter(fn).length;
  const documents = ['write', 'review'].includes(session.phase);
  const list = documents ? docTurns({ dir, session, record, evidence, verdicts }, root) : turns(session, record, verdicts);
  // Two jobs are not seats at the table: choosing the cast for an unusual goal, and checking the tests that are due.
  if (session.phase === 'open' && !session.kind && session.goal !== DEFAULT_GOAL && session.cast.some((s) => s.role === 'search')) list.push({ role: 'casting', name: 'casting', model: 'strongest', threads: [], done: false, optional: true });
  const due = session.phase === 'track-record' ? dueForCheck(loadIdeas(root)).map((i) => i.id) : [];
  if (due.length) list.push({ role: 'track-record', name: 'track record', model: 'standard', threads: [], done: false, optional: true });
  return {
    session: session.id, dir, goal: session.goal, phase: session.phase, round: session.round || null, step: session.step,
    ...(isLab(session) ? { object: session.object ?? null, ...(session.focus ? { focus: session.focus } : {}) } : {}),
    budget: budgetOf(session),
    evidence: { entries: evidence.entries.length, missing: evidence.missing, ...(evidence.reused?.length ? { reused: evidence.reused.map(({ kind, at, from }) => ({ kind, at, from })) } : {}) },
    threads: {
      proposed: record.threads.length, admitted: count((t) => t.status === 'admitted'), open: openThreads(record).length,
      refused: count((t) => t.status === 'refused'), merged: count((t) => t.status === 'merged'), cutOff: count((t) => t.closed?.cutOff),
    },
    verdicts: verdicts.rulings.length ? { ...Object.fromEntries(VERDICTS.map((v) => [v, verdicts.rulings.filter((r) => r.verdict === v).length])), final: verdicts.final } : null,
    openQuestions: record.questions.length,
    ...(record.docket ? { fresh: count((t) => t.status === 'admitted' && t.novelty === 'fresh') } : {}),
    ...(due.length ? { dueForCheck: due } : {}),
    // Each turn carries the one line that is the agent's whole task.
    turns: list.map((t) => ({ ...t, task: taskLine(root, session, t.role) })),
    next: session.phase === 'done' ? 'The session is closed.' : documents ? docNextStep({ dir, session, record, evidence, verdicts }, root) : nextStep(session, record, evidence, verdicts),
  };
}

// A refused save leaves a trace in the session, so wasted attempts can be counted afterwards.
function refused(ctx, role, command, errors) {
  const { session } = loadSession(ctx.root, ctx.session.id, ctx.session.kind ?? 'council');
  (session.refused ??= []).push({ role: role ?? null, command, phase: session.phase, round: session.round, errors: errors.length, first: String(errors[0]).slice(0, 200), at: new Date().toISOString() });
  saveSession(ctx.dir, session);
}

function persist(ctx) {
  saveSession(ctx.dir, ctx.session);
  saveRecord(ctx.dir, ctx.record);
  saveVerdicts(ctx.dir, ctx.verdicts);
}

export function init(o) {
  const root = rootOf(o);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Project folder not found: ${root}`);
  if (o.url) checkUrl(o.url);
  const kind = kindOf(o);
  // The lab works on a thing of a kind: the person may name it, otherwise it is guessed from the project and the
  // anatomist confirms or corrects it.
  if (o.object !== undefined && !OBJECT_KINDS.includes(o.object)) throw new Error(`Unknown --object "${o.object}". The kinds: ${OBJECT_KINDS.join(', ')}`);
  const studies = ['lab', 'studio'].includes(kind);
  if (!studies && (o.object !== undefined || o.focus !== undefined)) throw new Error('--object and --focus are for the invention lab and the design studio');
  const detected = studies ? detectObject(root, { url: o.url }) : null;
  // The studio designs a site: a project that does not say what it is (a new site, with nothing built yet) is one.
  const guess = kind === 'studio' && detected.kind === 'other' ? { kind: 'website', confidence: 'high', signals: ['the studio designs a site, and nothing in the project says otherwise'] } : detected;
  const object = guess ? (o.object ? { kind: o.object, from: 'person' } : { kind: guess.kind, from: 'detected', confidence: guess.confidence, signals: guess.signals }) : null;
  const { dir, session } = createSession(root, { goal: o.goal, url: o.url, data: o.data, budget: o.budget, kind, object, focus: o.focus });
  // A goal the person gives is remembered: next week's session starts from it without being told again.
  if (session.goalSource === 'given') saveFacts(root, putFact(loadFacts(root), { key: `${kind}.goal`, value: session.goal, source: 'human', confidence: 'high', by: 'human' }).facts);
  const short = budgetWarning(session);
  // With nothing better, the documents would carry the folder's name as the business's.
  const brand = brandOf(root);
  const unnamed = brand.nameFrom === 'folder' ? `The documents would name the business "${brand.name}", after the project folder. Ask the person for the business's name and save it with "fact --key brand.name --value <name>".` : null;
  const unsure = kind === 'lab' && object?.from === 'detected' && object.confidence === 'low' ? `The lab guessed this project is ${OBJECT_WORDS[object.kind]} (${object.signals.at(-1)}), without much to go on. Ask the person what it is; to name it, set this session aside and run "init" again with --object (${OBJECT_KINDS.join(', ')}).` : null;
  // The studio leans on a browser more than its siblings: it measures what sites are built with, photographs the
  // tiles, and nobody can look at a tile that was not photographed.
  const blind = kind === 'studio' && !findBrowser() ? 'No Chrome, Edge or Chromium was found. The session can run, but what honoured sites are built with will be read and not measured, the tiles will not be photographed, nobody will look at them as a stranger would, and the documents will be HTML. Tell the person now; installing one of them, or setting CHROME_PATH, before going on gives the session all of it.' : null;
  const warnings = [short, unnamed, unsure, blind].filter(Boolean);
  return { ok: true, goalSource: session.goalSource, healthRun: session.run, url: session.url, data: session.data, business: { name: brand.name, from: brand.nameFrom }, ...(warnings.length ? { warnings } : {}), ...view({ root, dir, session, record: loadRecord(dir), evidence: loadEvidence(dir), verdicts: loadVerdicts(dir) }) };
}

export function status(o) {
  return view(sessionCtx(o));
}

export function next(o) {
  const ctx = sessionCtx(o);
  // Once the verdicts are final the session moves through its documents, not through the debate.
  if (['write', 'review'].includes(ctx.session.phase)) {
    const moved = advanceDocs(ctx, ctx.root, { force: Boolean(o.force) });
    if (moved.errors.length) return { ok: false, errors: moved.errors, ...view(ctx) };
    persist(ctx);
    return { ok: true, from: moved.from, to: moved.to, documents: moved.documents, ...(moved.site ? { site: moved.site } : {}), ...(moved.handoff ? { handoff: moved.handoff } : {}), warnings: moved.warnings, ...view(ctx) };
  }
  const { errors, from, to, closed, ideas } = advance(ctx, { force: Boolean(o.force), ideas: loadIdeas(ctx.root) });
  if (errors.length) return { ok: false, errors, ...view(ctx) };
  if (ideas) saveIdeas(ctx.root, ideas);
  persist(ctx);
  return { ok: true, from, to, closed, ...view(ctx) };
}

// With --collect: the first set of evidence, gathered without an agent, once. Otherwise: entries from an agent.
export function evidence(o, { stdin = readStdin } = {}) {
  const ctx = sessionCtx(o);
  const { root, dir, session } = ctx;
  if (o.collect) {
    const have = ctx.evidence;
    // Statements cite evidence by id, so the collection never runs twice.
    if (have.collectedAt) return { ok: true, already: true, path: evidencePath(dir), entries: have.entries.length, missing: have.missing, reused: have.reused ?? [] };
    const refresh = parseRefresh(o.refresh);
    const collected = collectEvidence(root, session, { refresh, head: isLab(session) ? gitHead(root) : null });
    saveEvidence(dir, collected);
    // What was reused needs no turn; what is asked to be done again is done again, pictures of pages included.
    session.reused = collected.reused.map((r) => r.kind);
    // A reused anatomy or genre is what this session studies from, as if its own turn had written it.
    if (session.reused.includes('anatomy')) {
      const record = loadGroundwork(root, recordKind(session, 'anatomy'));
      saveAnatomy(dir, { ...record.anatomy, reusedFrom: record.at });
      session.study = { anatomy: record.at, reused: true };
      if (record.anatomy?.anatomy?.kind) session.object = { ...(session.object ?? {}), kind: record.anatomy.anatomy.kind, from: 'anatomist' };
    }
    if (session.reused.includes('genre')) { const record = loadGroundwork(root, recordKind(session, 'genre')); saveGenre(dir, { genre: record.genre, reusedFrom: record.at }); }
    // The studio's look at the field: what wins awards now, and what template sites look like.
    if (session.reused.includes('awards')) { const record = loadGroundwork(root, 'awards'); saveCurrents(dir, { currents: record.currents, reusedFrom: record.at }); }
    if (session.reused.includes('slop')) { const record = loadGroundwork(root, 'slop'); saveSlop(dir, { slop: record.slop, reusedFrom: record.at }); }
    session.refresh = refresh;
    saveSession(dir, session);
    return { ok: true, path: evidencePath(dir), entries: collected.entries.length, dataFiles: collected.data.length, site: collected.site, missing: collected.missing, reused: collected.reused.map(({ kind, at, from, entries }) => ({ kind, at, from, entries })) };
  }
  const { data, error } = readJsonInput(stdin, 'the evidence');
  if (error) return error;
  const { evidence: updated, errors, warnings, added } = addEvidence(ctx.evidence, data.evidence, { by: o.role, root, session });
  if (errors.length) return { ok: false, errors, warnings };
  saveEvidence(dir, updated);
  // The competitor analyst's look around, and the horizon scan, are their turns in the evidence phase. What they found
  // is kept in the knowledge bank, so the next session soon after (of this skill or the invention lab) reuses it.
  if (session.phase === 'evidence' && ['competitors', 'horizon', 'voice', 'tech'].includes(o.role)) {
    takeTurn(session, o.role);
    saveSession(dir, session);
    saveGroundwork(root, o.role, { session, entries: updated.entries.filter((e) => e.by === o.role && !e.reusedFrom) });
  }
  return { ok: true, added, warnings };
}

// The invention lab's frame. The framer saves the frame (--role framer) and the provocateur the provocations (--role
// provocateur); --show prints the framings for the person, and --pick saves the ones they want worked on.
export function frame(o, { stdin = readStdin } = {}) {
  const ctx = sessionCtx(o);
  const { dir, session } = ctx;
  if (!isFramed(session)) return { ok: false, errors: ['Only a venture board or an invention lab session has a frame (run it as one of them).'], warnings: [] };
  const current = loadFrame(dir) ?? {};
  if (o.show) {
    if (!current.frame) return { ok: false, errors: ['The frame has not been written yet.'], warnings: [] };
    return {
      ok: true, ideal: current.frame.ideal, questions: current.frame.questions, contradictions: current.frame.contradictions.map(({ id, want, butThen }) => ({ id, text: `${want}, but then ${butThen}` })),
      ...(current.frame.morphology ? { morphology: current.frame.morphology.map((d) => `${d.name}: ${d.options.map((x, i) => (i === d.now ? `[${x}]` : x)).join(' / ')}`), evolution: current.frame.evolution } : {}),
      picked: current.picked ?? null, provocations: (current.provocations ?? []).length,
    };
  }
  if (o.pick !== undefined) {
    if (!['frame', 'propose'].includes(session.phase) || (session.phase === 'propose' && session.dealt)) return { ok: false, errors: ['The framings are picked before the proposing starts.'], warnings: [] };
    const ids = String(o.pick).split(',').map((s) => s.trim()).filter(Boolean);
    const errors = pickErrors(current, ids);
    if (errors.length) return { ok: false, errors, warnings: [] };
    saveFrame(dir, { ...current, picked: ids });
    return { ok: true, picked: ids };
  }
  if (session.phase !== 'frame') return { ok: false, errors: [`The frame is written in the frame phase; the session is in the ${session.phase} phase`], warnings: [] };
  const { data, error } = readJsonInput(stdin, 'the frame');
  if (error) return error;
  if (o.role === 'framer') {
    const errors = validateFrame(data.frame, kindOfSession(session));
    if (errors.length) { refused(ctx, 'framer', 'frame', errors); return { ok: false, errors, warnings: [] }; }
    saveFrame(dir, { ...current, frame: cleanFrame(data.frame, kindOfSession(session)), savedAt: new Date().toISOString() });
    takeTurn(session, 'framer');
    saveSession(dir, session);
    return { ok: true, questions: data.frame.questions.length, contradictions: data.frame.contradictions.length };
  }
  if (o.role === 'provocateur') {
    if (session.step !== 'provoke') return { ok: false, errors: ['The provocations are written after the frame.'], warnings: [] };
    const errors = validateProvocations(data.provocations);
    if (errors.length) { refused(ctx, 'provocateur', 'frame', errors); return { ok: false, errors, warnings: [] }; }
    saveFrame(dir, { ...current, provocations: cleanProvocations(data.provocations) });
    takeTurn(session, 'provocateur');
    saveSession(dir, session);
    return { ok: true, provocations: data.provocations.length };
  }
  throw new Error('Usage: frame --role framer | --role provocateur (JSON on standard input), --show, or --pick H1,C2');
}

// The invention lab's study of the thing it works on. The anatomist saves the anatomy (--role anatomist) and the genre
// scout the standard kit of the genre (--role genre), each with the evidence it rests on; --show prints what the lab
// understood, for the person; --correct saves what the person says is wrong or missing, which the anatomist then
// revises, twice at most.
export function study(o, { stdin = readStdin } = {}) {
  const ctx = sessionCtx(o);
  const { root, dir, session } = ctx;
  if (!isLab(session)) return fail('Only an invention lab session studies the thing it works on (run it as the lab).');
  const current = loadAnatomy(dir);
  if (o.show) {
    if (!current?.anatomy) return fail('The anatomy has not been written yet: the anatomist writes it in the evidence phase.');
    const genre = loadGenre(dir)?.genre;
    // The studio also shows what it found in the field: the reading of what wins awards now, with how common each
    // pattern has become, and what a template site looks like. The person may know their trade's sites better.
    const currents = isStudio(session) ? loadCurrents(dir)?.currents : null;
    const slop = isStudio(session) ? loadSlop(dir)?.slop : null;
    const field = { ...(currents ? { awardsNow: { reading: currents.reading, sites: currents.sample.length, patterns: currents.patterns.map((p) => `${p.what} (${p.kind}; ${p.share})`), shares: SHARE_WORDS } } : {}), ...(slop ? { slop: { reading: slop.reading, tells: slop.tells.map((t) => t.what) } } : {}) };
    return { ok: true, ...anatomyView(current), ...(genre ? { genre: { category: genre.category, standardKit: genre.kit.map((k) => k.text) } } : {}), ...field, ...(session.focus ? { focus: session.focus } : {}), note: `Show the person this, as it is, and ask what is wrong or missing. Each correction goes to the anatomist, who revises the anatomy before anyone ${isStudio(session) ? 'designs' : 'invents'}.` };
  }
  if (o.correct !== undefined) {
    if (session.phase !== 'study') return fail(`Corrections are made at the study, after the anatomy is written and before the frame; the session is in the ${session.phase} phase`);
    if (!current?.anatomy) return fail('The anatomy has not been written yet.');
    const text = one(o.correct);
    if (text.length < 5) return fail('--correct: what is wrong or missing, in the person\'s words');
    if ((session.study?.revisions ?? 0) >= 2) return fail('The anatomy has been revised twice. Go on with "next"; what is still wrong, tell the members in the open questions of the session instead.');
    saveAnatomy(dir, { ...current, corrections: [...(current.corrections ?? []), { text, at: new Date().toISOString() }] });
    session.study = { ...(session.study ?? {}), pending: (session.study?.pending ?? 0) + 1 };
    saveSession(dir, session);
    return { ok: true, corrections: (current.corrections?.length ?? 0) + 1, next: 'Start the anatomist, to revise the anatomy, once the person has said everything.' };
  }
  const { data, error } = readJsonInput(stdin, `the ${({ genre: 'genre', awards: 'currents', slop: 'slop' })[o.role] ?? 'anatomy'}`);
  if (error) return error;
  const items = Array.isArray(data.evidence) ? data.evidence : null;
  if (o.role === 'anatomist') {
    const revising = session.phase === 'study' && session.study?.pending;
    if (session.phase !== 'evidence' && !revising) return fail(`The anatomy is written in the evidence phase, and revised at the study when the person corrects it; the session is in the ${session.phase} phase`);
    const errors = validateAnatomy(data.anatomy);
    // A direction grows from what the business has: with nothing named, every direction would fit any business.
    if (isStudio(session) && !errors.length && (data.anatomy.material?.length ?? 0) < 2) errors.push('$.anatomy.material: at least two things the business has that a design could be made of (its work, its product, its place, its people, its archive, its data, its words), each { "what", "where" }');
    // A site that does not exist yet is studied from what the person said about the business: one source is enough.
    const least = isStudio(session) && !session.url ? 1 : 3;
    if (!items) errors.push('$.evidence: what the anatomy rests on, each { "grade": "observed", "source": "<a file in the project or a page address>", "text" }');
    else if (!revising && items.length < least) errors.push(`$.evidence: at least ${least === 1 ? 'one file, page or fact' : 'three files or pages'} it rests on: an anatomy that rests on nothing is a guess`);
    if (errors.length) { refused(ctx, 'anatomist', 'study', errors); return fail(...errors); }
    const { evidence: updated, errors: evErrors, warnings } = addEvidence(ctx.evidence, items, { by: 'anatomist', root, session });
    if (evErrors.length) { refused(ctx, 'anatomist', 'study', evErrors); return { ok: false, errors: evErrors, warnings }; }
    saveEvidence(dir, updated);
    const anatomy = cleanAnatomy(data.anatomy);
    const corrections = (current?.corrections ?? []).map((c) => (revising ? { ...c, applied: true } : c));
    const saved = { anatomy, savedAt: new Date().toISOString(), ...(corrections.length ? { corrections } : {}), ...(revising ? { revisedAt: new Date().toISOString() } : {}) };
    saveAnatomy(dir, saved);
    const before = session.object?.kind;
    session.object = { ...(session.object ?? {}), kind: anatomy.kind, from: session.object?.from === 'person' && before === anatomy.kind ? 'person' : 'anatomist' };
    session.study = { ...(session.study ?? {}), anatomy: new Date().toISOString().slice(0, 10), ...(revising ? { pending: 0, revisions: (session.study?.revisions ?? 0) + 1 } : {}) };
    takeTurn(session, 'anatomist');
    saveSession(dir, session);
    saveGroundwork(root, 'anatomy', { session, entries: updated.entries.filter((e) => e.by === 'anatomist' && !e.reusedFrom), anatomy: { anatomy, ...(corrections.length ? { corrections } : {}) }, head: gitHead(root) });
    const changed = before && before !== anatomy.kind ? [`The anatomist says this is ${OBJECT_WORDS[anatomy.kind]}, not ${OBJECT_WORDS[before]} as ${session.object.from === 'person' ? 'the person said' : 'was guessed'}: tell the person at the study.`] : [];
    return { ok: true, revised: Boolean(revising), kind: anatomy.kind, parts: anatomy.parts.length, warnings: [...warnings, ...changed] };
  }
  if (o.role === 'genre') {
    if (session.phase !== 'evidence') return fail(`The genre is written in the evidence phase; the session is in the ${session.phase} phase`);
    const errors = validateGenre(data.genre);
    if (!items || items.length < 3) errors.push('$.evidence: at least three pages it rests on, each { "grade": "observed", "source": "https://…", "date", "text" }');
    if (errors.length) { refused(ctx, 'genre', 'study', errors); return fail(...errors); }
    const { evidence: updated, errors: evErrors, warnings } = addEvidence(ctx.evidence, items, { by: 'genre', root, session });
    if (evErrors.length) { refused(ctx, 'genre', 'study', evErrors); return { ok: false, errors: evErrors, warnings }; }
    saveEvidence(dir, updated);
    const genre = cleanGenre(data.genre);
    saveGenre(dir, { genre, savedAt: new Date().toISOString() });
    takeTurn(session, 'genre');
    saveSession(dir, session);
    saveGroundwork(root, 'genre', { session, entries: updated.entries.filter((e) => e.by === 'genre' && !e.reusedFrom), genre });
    return { ok: true, kit: genre.kit.length, frontier: genre.frontier.length, warnings };
  }
  // The studio's two looks at the field, each with the pages it rests on.
  if (['awards', 'slop'].includes(o.role)) {
    if (!isStudio(session)) return fail('Only the design studio looks at what wins awards and at what template sites look like.');
    if (session.phase !== 'evidence') return fail(`The field is looked at in the evidence phase; the session is in the ${session.phase} phase`);
    const awards = o.role === 'awards';
    const errors = awards ? validateCurrents(data.currents) : validateSlop(data.slop);
    const least = awards ? 6 : 3;
    if (!items || items.length < least) errors.push(`$.evidence: at least ${least} pages it rests on, each { "grade": "observed", "source": "https://…", "date", "text" }`);
    if (errors.length) { refused(ctx, o.role, 'study', errors); return fail(...errors); }
    const { evidence: updated, errors: evErrors, warnings } = addEvidence(ctx.evidence, items, { by: o.role, root, session });
    if (evErrors.length) { refused(ctx, o.role, 'study', evErrors); return { ok: false, errors: evErrors, warnings }; }
    saveEvidence(dir, updated);
    const entries = updated.entries.filter((e) => e.by === o.role && !e.reusedFrom);
    if (awards) {
      const currents = cleanCurrents(data.currents);
      saveCurrents(dir, { currents, savedAt: new Date().toISOString() });
      saveGroundwork(root, 'awards', { session, entries, currents });
      takeTurn(session, 'awards');
      saveSession(dir, session);
      return { ok: true, sites: currents.sample.length, patterns: currents.patterns.length, warnings };
    }
    const slop = cleanSlop(data.slop);
    saveSlop(dir, { slop, savedAt: new Date().toISOString() });
    saveGroundwork(root, 'slop', { session, entries, slop });
    takeTurn(session, 'slop');
    saveSession(dir, session);
    return { ok: true, tells: slop.tells.length, warnings };
  }
  throw new Error('Usage: study --role anatomist | --role genre (JSON on standard input), --show, or --correct "<what the person said>"');
}

// The domain primer: how the trade works, with the sources it rests on. Saved in the knowledge bank, and its sources
// as evidence any member can cite.
export function primer(o, { stdin = readStdin } = {}) {
  const ctx = sessionCtx(o);
  const { root, dir, session } = ctx;
  if (session.phase !== 'evidence') return { ok: false, errors: [`The primer is written in the evidence phase; the session is in the ${session.phase} phase`], warnings: [] };
  const { data, error } = readJsonInput(stdin, 'the primer');
  if (error) return error;
  const previous = loadGroundwork(root, 'primer');
  const refresh = Boolean(previous?.primer);
  const errors = validatePrimer(data.primer, { refresh });
  const items = Array.isArray(data.evidence) ? data.evidence : null;
  if (!items) errors.push('$.evidence: the pages the primer rests on, each { "grade": "observed", "source": "https://…", "date", "text" }');
  else if (items.length < (refresh ? 1 : 3)) errors.push(`$.evidence: at least ${refresh ? 'one page that shows what is new or still holds' : 'three pages'}: a primer that rests on nothing is a guess`);
  if (errors.length) { refused(ctx, 'primer', 'primer', errors); return { ok: false, errors, warnings: [] }; }
  const { evidence: updated, errors: evErrors, warnings, added } = addEvidence(ctx.evidence, items, { by: 'primer', root, session });
  if (evErrors.length) { refused(ctx, 'primer', 'primer', evErrors); return { ok: false, errors: evErrors, warnings }; }
  saveEvidence(dir, updated);
  // A refresh keeps the sources of the primer before, with the new ones.
  const sources = [...(refresh ? previous.entries ?? [] : []), ...updated.entries.filter((e) => e.by === 'primer' && !e.reusedFrom)];
  const unique = sources.filter((e, i) => sources.findIndex((x) => x.source === e.source && x.text === e.text) === i);
  saveGroundwork(root, 'primer', { session, entries: unique, primer: cleanPrimer(data.primer) });
  takeTurn(session, 'primer');
  saveSession(dir, session);
  return { ok: true, refreshed: refresh, added, warnings };
}

export function say(o, { stdin = readStdin } = {}) {
  const ctx = sessionCtx(o);
  const { data, error } = readJsonInput(stdin, 'the statements');
  if (error) return error;
  const { errors, warnings, added, repeated, closed } = saySaved(ctx, o.role, data.statements);
  if (errors.length) {
    refused(ctx, o.role, 'say', errors);
    return { ok: false, errors, warnings };
  }
  persist(ctx);
  return { ok: true, saved: added, repeated, closed, warnings };
}

// Prints one agent's whole task for its turn, and counts the run against the budget.
export function context(o) {
  const ctx = sessionCtx(o);
  const text = buildContext(ctx, { root: ctx.root, dir: ctx.dir, role: o.role, phase: o.phase, save: Boolean(o.save) });
  spendRun(ctx.session, { role: o.role, phase: ctx.session.phase });
  saveSession(ctx.dir, ctx.session);
  return text;
}

// The five open seats for a goal other than the usual one. The cast is remembered with its goal.
export function cast(o, { stdin = readStdin } = {}) {
  const ctx = sessionCtx(o);
  const { data, error } = readJsonInput(stdin, 'the cast');
  if (error) return error;
  const { errors } = recast(ctx.session, data.seats);
  if (errors.length) return { ok: false, errors, warnings: [] };
  saveSession(ctx.dir, ctx.session);
  saveFacts(ctx.root, putFact(loadFacts(ctx.root), { key: 'council.cast', value: { goal: ctx.session.goal, cast: ctx.session.cast }, source: `council session ${ctx.session.id}`, confidence: 'high', by: 'council' }).facts);
  return { ok: true, cast: ctx.session.cast.map((s) => `${s.name}: ${s.title}`) };
}

// ---- The documents ----

// Saves what a writer or a reviewer hands in: the suggestions, the discussion (in parts), a review or a layout review.
export function save(o, { stdin = readStdin } = {}) {
  const ctx = sessionCtx(o);
  const { data, error } = readJsonInput(stdin, `the ${o.doc ?? 'document'}`);
  if (error) return error;
  const { errors, ...rest } = saveDocument(ctx, ctx.root, o.doc, data);
  if (errors.length) {
    refused(ctx, null, `save ${o.doc}`, errors);
    return { ok: false, doc: o.doc, errors };
  }
  saveSession(ctx.dir, ctx.session);
  return { ok: true, doc: o.doc, ...rest };
}

// One page of a tile of the design studio, as plain HTML on standard input: it is checked and kept until the tiles are
// saved. A page is code; sent on its own it is escaped once, not three times.
export function tile(o, { stdin = readStdin } = {}) {
  const ctx = sessionCtx(o);
  if (!o.idea) throw new Error('Usage: tile --idea I21 (the whole page, as HTML, on standard input)');
  const { errors, ...rest } = saveTilePage(ctx, ctx.root, o.idea, stdin());
  if (errors.length) { refused(ctx, 'prototyper', 'tile', errors); return { ok: false, idea: o.idea, errors }; }
  return { ok: true, idea: o.idea, ...rest, next: 'When every page is handed in, save the tiles (their captions, what each shows and their values) without "html".' };
}

// Photographs the part of each page the ideas apply to, once the verdicts are final, for the documents.
export async function shots(o) {
  const ctx = sessionCtx(o);
  const { errors, ...rest } = await takePictures(ctx, ctx.root);
  if (errors.length) return { ok: false, errors, warnings: [] };
  saveSession(ctx.dir, ctx.session);
  return { ok: true, ...rest };
}

// Writes the documents as HTML and prints them to PDF. --doc for one of them, --html to skip the printing.
export function render(o) {
  const ctx = sessionCtx(o);
  if (!['write', 'review', 'done'].includes(ctx.session.phase)) return { ok: false, errors: [`The documents are made after the verdicts are final; the session is in the ${ctx.session.phase} phase`], warnings: [] };
  const { errors, warnings, documents, site, handoff, rendered } = renderDocs(ctx, ctx.root, { only: o.doc ?? null, html: Boolean(o.html) });
  if (errors.length) return { ok: false, errors, warnings };
  saveSession(ctx.dir, ctx.session);
  return { ok: true, documents, ...(site ? { site } : {}), ...(handoff ? { handoff } : {}), rendered, warnings };
}

export function close(o) {
  const ctx = sessionCtx(o);
  if (o.abandon) return abandon(ctx, o.reason);
  const { errors, ...rest } = closeSession(ctx, ctx.root, { force: Boolean(o.force) });
  if (errors.length) return { ok: false, errors, ...view(ctx) };
  saveSession(ctx.dir, ctx.session);
  return { ok: true, ...rest, session: ctx.session.id, dir: ctx.dir };
}

// A session the person does not want to continue is set aside in whatever phase it is, so a new one can start. What
// the judge already ruled stands; ideas still waiting for a ruling become undecided, and no document is made.
function abandon(ctx, reason) {
  const { root, dir, session } = ctx;
  if (session.phase === 'done') return { ok: false, errors: [`Session ${session.id} is already closed${session.abandoned ? ' (set aside)' : ''}`], warnings: [] };
  const from = session.phase;
  const { ideas, moved } = ctx.verdicts.final ? { ideas: null, moved: [] } : setAside(loadIdeas(root), session.id, { reason: reason?.trim() || undefined });
  if (ideas) saveIdeas(root, ideas);
  session.abandoned = { at: new Date().toISOString(), phase: from, ...(reason?.trim() ? { reason: reason.trim() } : {}) };
  session.phase = 'done';
  session.closedAt = session.abandoned.at;
  saveSession(dir, session);
  // After the verdict nothing is set aside: the survivors are in the ledger and wait for the person, with no document.
  const next = ctx.verdicts.final
    ? 'The session is set aside after its verdicts, so no document is printed, but the ideas that survived stay in the ledger and wait for the person\'s answer. Tell the person which they are ("digest" lists them), then start a new session with "init".'
    : 'The session is set aside. Start a new one with "init".';
  return { ok: true, abandoned: true, session: session.id, dir, phase: from, ideasSetAside: moved, next };
}

const STAGES = ['docket', 'verdict', 'set'];

// The judge's rulings: the docket before the debate, the verdict after it, and the look at the survivors as a set.
export function verdict(o, { stdin = readStdin } = {}) {
  const ctx = sessionCtx(o);
  if (!STAGES.includes(o.stage)) throw new Error(`Unknown or missing --stage "${o.stage ?? ''}". Valid stages: ${STAGES.join(', ')}`);
  const { data, error } = readJsonInput(stdin, `the ${o.stage}`);
  if (error) return error;
  const done = (result) => {
    if (result.errors.length) {
      refused(ctx, o.role ?? 'judge', `verdict ${o.stage}`, result.errors);
      return { ok: false, errors: result.errors, warnings: [] };
    }
    persist(ctx);
    const { errors, ideas, ...rest } = result;
    return { ok: true, stage: o.stage, ...rest };
  };
  if (o.stage === 'docket') {
    const result = saveDocket(ctx, data, { ideas: loadIdeas(ctx.root) });
    if (!result.errors.length) saveIdeas(ctx.root, result.ideas);
    return done(result);
  }
  if (o.stage === 'verdict') return done(saveRulings(ctx, data));
  // The set has two voices: the red team's notes, then the judge's answer to them.
  if (o.role === 'red-team') return done(saveSetNotes(ctx, data));
  if (o.role === 'judge') return done({ ...saveSetChanges(ctx, data), survivors: survivors(ctx.verdicts).length });
  throw new Error('The set stage needs --role red-team (the notes) or --role judge (the verdicts looked at again)');
}

// ---- Looking ----

// Pictures of one page as a visitor sees it, on a desktop and on a narrow screen, for a member to look at with its file
// reader. Any public page: the site, a rival's, a directory listing. The pictures stay in the session folder.
export function look(o) {
  if (!o.url) throw new Error('Usage: look --url https://example.com/page [--role <your role>]');
  checkUrl(o.url);
  const { root, dir, session } = sessionCtx(o);
  const browser = findBrowser();
  if (!browser) return { ok: false, errors: ['No Chrome, Edge or Chromium was found, so pages cannot be looked at here. Read them instead, and say in your evidence that you did not see them.'], warnings: [] };
  const u = new URL(o.url);
  const slug = `${u.hostname}${u.pathname}`.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 80) || 'page';
  const shots = [];
  const failed = [];
  // A picture of the same page taken in the last week, by any session, is used again unless the session asked for
  // fresh ones (--refresh looks at the collection).
  const again = (session.refresh ?? []).some((k) => k === 'looks' || k === 'all');
  for (const [view, size] of Object.entries(VIEWS)) {
    const file = path.join(dir, 'looks', `${slug}-${view}.png`);
    const kept = again ? null : cachedLook(root, file);
    if (kept) { shots.push({ view, size: size.join('x'), file, taken: kept.taken, reused: true }); continue; }
    try { shots.push({ view, size: size.join('x'), file: screenshot(browser, o.url, file, size) }); cacheLook(root, file); } catch (e) { failed.push(`${view}: ${e.message}`); }
  }
  if (!shots.length) return { ok: false, errors: failed, warnings: [] };
  return { ok: true, url: o.url, shots, failed, note: 'Open each file with your file reader to see it. "desktop" is the first screen on a computer; "narrow" is the first screen at 500 pixels wide, the narrowest this browser lays out, which most sites show as their phone layout (a phone is narrower still, so do not judge text that is cut off at the edge); "desktop-long" goes further down the page. To cite what you saw, add it to the evidence with this address as its source.' };
}

// What a public page is built with, read from its markup after its scripts ran: the libraries, frameworks and fonts it
// shows, how many canvases and films it has, and whether it answers a visitor who asked for less motion. For the design
// studio's scouts: the technology of a site is measured where it can be, not remembered.
export function probe(o) {
  if (!o.url) throw new Error('Usage: probe --url https://example.com/');
  checkUrl(o.url);
  sessionCtx(o);
  const browser = findBrowser();
  if (!browser) return { ok: false, errors: ['No Chrome, Edge or Chromium was found, so a page cannot be probed here. Read the page and its credits instead, and say in your evidence that its technology was read, not measured.'], warnings: [] };
  let html;
  try { html = dumpUrl(browser, o.url); } catch (e) { return { ok: false, errors: [String(e.message).trim()], warnings: [] }; }
  return { ok: true, url: o.url, ...detectTech(html), note: 'Read from the page\'s markup after its scripts ran. A library bundled into the site\'s own code without a trace is not seen: an empty list means "nothing shown", not "nothing used". To cite it, add it to the evidence with this address as its source.' };
}

// ---- The knowledge bank ----

// Saves ideas into the ledger: a new idea gets the next id, and a change of status must be a move the ledger allows.
export function ideas(o, { stdin = readStdin } = {}) {
  const root = rootOf(o);
  const { data, error } = readJsonInput(stdin, 'the ideas');
  if (error) return error;
  const { ideas: updated, errors, saved } = applyIdeas(loadIdeas(root), data, { by: o.by, session: o.session });
  if (errors.length) return { ok: false, errors, warnings: [] };
  saveIdeas(root, updated);
  return { ok: true, path: ideasPath(root), saved: saved.map((i) => ({ id: i.id, title: i.title, status: i.status, ...(i.status === 'testing' ? { checkOn: i.test?.checkOn } : {}) })), total: updated.length, trackRecord: trackRecord(updated) };
}

// Stores one fact in the bank. Without --by it is what a person said; with --by it is what this skill observed,
// which needs its --source and never replaces what a person said.
export function fact(o) {
  const root = rootOf(o);
  if (!o.key || o.value === undefined) throw new Error('Usage: fact --key council.goal --value "More enquiries from product companies"');
  let value = o.value;
  try { value = JSON.parse(o.value); } catch { /* plain text value */ }
  const person = !o.by || o.by === 'human';
  if (!person && !o.source) throw new Error('A fact saved with --by needs --source: the page, file or data it comes from');
  const { facts, kept } = putFact(loadFacts(root), { key: o.key, value, source: person ? 'human' : o.source, confidence: o.confidence ?? (person ? 'high' : 'medium'), by: person ? 'human' : o.by });
  if (kept) return { ok: true, key: o.key, value: kept.value, kept: 'A person gave this fact, so it was not replaced.' };
  saveFacts(root, facts);
  return { ok: true, key: o.key, value, by: person ? 'human' : o.by };
}

// What the person said that outlives the session: a rule drawn from the reason they turned something down, or a
// "more of this". Saved in their words, read by every skill, and retired only when they say so.
export function note(o) {
  const root = rootOf(o);
  const name = brandOf(root).name;
  if (o.show) return { ok: true, notes: listNotes(root) };
  if (o.retire !== undefined) {
    const { errors, retired } = retireNote(root, o.retire, { name });
    return errors.length ? fail(...errors) : { ok: true, retired: { id: retired.id, title: retired.title } };
  }
  if (!o.type || !o.title || o.value === undefined) throw new Error(`Usage: note --type ${NOTE_KINDS.join('|')} --title "<the rule in a few words>" --value "<what the person said, in their words>" [--idea I12] [--scope design], note --show, or note --retire K3`);
  const { errors, note: saved, already } = addNote(root, { kind: o.type, title: o.title, detail: o.value, scope: o.scope, idea: o.idea, by: o.kind ?? 'council', name });
  if (errors.length) return fail(...errors);
  return { ok: true, id: saved.id, kind: saved.kind, title: saved.title, ...(already ? { already: 'This note was saved before.' } : {}), next: saved.kind === 'preference' ? 'Every later session leans towards it where it fits.' : 'Every later session, of any skill here, reads it: nothing it rules out is proposed, under any name.' };
}

export function digest(o) {
  return bankDigest(rootOf(o));
}

export const COMMANDS = { init, status, next, cast, evidence, primer, study, frame, context, say, look, probe, verdict, save, tile, shots, render, close, ideas, fact, note, digest };
