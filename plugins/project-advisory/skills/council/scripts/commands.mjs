import fs from 'node:fs';
import path from 'node:path';
import { parseLooseJson } from './lib/io.mjs';
import { loadFacts, saveFacts, putFact } from './lib/bank.mjs';
import { loadIdeas, saveIdeas, applyIdeas, ideasPath, trackRecord, setAside } from './lib/ideas.mjs';
import { digest as bankDigest } from './lib/digest.mjs';
import { createSession, resolveSession, loadSession, saveSession, budgetOf, budgetWarning, spendRun, recast, takeTurn, DEFAULT_GOAL } from './lib/session.mjs';
import { buildContext, taskLine } from './lib/context.mjs';
import { dueForCheck } from './lib/ideas.mjs';
import { docTurns, docNextStep, advanceDocs, renderDocs, saveDocument, closeSession, takePictures } from './lib/flow.mjs';
import { brandOf } from './lib/documents.mjs';
import { loadEvidence, saveEvidence, collectEvidence, addEvidence, evidencePath } from './lib/evidence.mjs';
import { loadRecord, saveRecord, say as saySaved, saveDocket, advance, turns, nextStep, openThreads } from './lib/record.mjs';
import { findBrowser, screenshot, VIEWS, lookSlug } from './lib/browser.mjs';
import { saveFrame, loadFrame, validateFrame, cleanFrame, validateProvocations, cleanProvocations, pickErrors } from './lib/lab.mjs';
import { saveGroundwork, parseRefresh, cachedLook, cacheLook, loadGroundwork } from './lib/groundwork.mjs';
import { validatePrimer, cleanPrimer } from './lib/primer.mjs';
import { loadVerdicts, saveVerdicts, saveRulings, saveSetNotes, saveSetChanges, survivors, VERDICTS } from './lib/verdict.mjs';

// The commands of the council skill. Each returns JSON (Markdown for `digest`); a refused save returns
// { "ok": false, "errors": [...] }, which the caller fixes and sends again.

const rootOf = (o) => path.resolve(o.root ?? process.cwd());
const kindOf = (o) => { const k = o.kind ?? 'council'; if (!['council', 'lab'].includes(k)) throw new Error(`Unknown --kind "${k}": council or lab`); return k; };

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
  if (session.phase === 'open' && session.kind !== 'lab' && session.goal !== DEFAULT_GOAL && session.cast.some((s) => s.role === 'search')) list.push({ role: 'casting', name: 'casting', model: 'strongest', threads: [], done: false, optional: true });
  const due = session.phase === 'track-record' ? dueForCheck(loadIdeas(root)).map((i) => i.id) : [];
  if (due.length) list.push({ role: 'track-record', name: 'track record', model: 'standard', threads: [], done: false, optional: true });
  return {
    session: session.id, dir, goal: session.goal, phase: session.phase, round: session.round || null, step: session.step,
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
  const { dir, session } = createSession(root, { goal: o.goal, url: o.url, data: o.data, budget: o.budget, kind });
  // A goal the person gives is remembered: next week's session starts from it without being told again.
  if (session.goalSource === 'given') saveFacts(root, putFact(loadFacts(root), { key: `${kind}.goal`, value: session.goal, source: 'human', confidence: 'high', by: 'human' }).facts);
  const short = budgetWarning(session);
  // With nothing better, the documents would carry the folder's name as the business's.
  const brand = brandOf(root);
  const unnamed = brand.nameFrom === 'folder' ? `The documents would name the business "${brand.name}", after the project folder. Ask the person for the business's name and save it with "fact --key brand.name --value <name>".` : null;
  const warnings = [short, unnamed].filter(Boolean);
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
    return { ok: true, from: moved.from, to: moved.to, documents: moved.documents, ...(moved.site ? { site: moved.site } : {}), warnings: moved.warnings, ...view(ctx) };
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
    const collected = collectEvidence(root, session, { refresh });
    saveEvidence(dir, collected);
    // What was reused needs no turn; what is asked to be done again is done again, pictures of pages included.
    session.reused = collected.reused.map((r) => r.kind);
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
  if (session.phase === 'evidence' && ['competitors', 'horizon'].includes(o.role)) {
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
  if (session.kind !== 'lab') return { ok: false, errors: ['Only an invention lab session has a frame (run it as the lab).'], warnings: [] };
  const current = loadFrame(dir) ?? {};
  if (o.show) {
    if (!current.frame) return { ok: false, errors: ['The frame has not been written yet.'], warnings: [] };
    return { ok: true, ideal: current.frame.ideal, questions: current.frame.questions, contradictions: current.frame.contradictions.map(({ id, want, butThen }) => ({ id, text: `${want}, but then ${butThen}` })), picked: current.picked ?? null, provocations: (current.provocations ?? []).length };
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
    const errors = validateFrame(data.frame);
    if (errors.length) { refused(ctx, 'framer', 'frame', errors); return { ok: false, errors, warnings: [] }; }
    saveFrame(dir, { ...current, frame: cleanFrame(data.frame), savedAt: new Date().toISOString() });
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
  const { errors, warnings, documents, site, rendered } = renderDocs(ctx, ctx.root, { only: o.doc ?? null, html: Boolean(o.html) });
  if (errors.length) return { ok: false, errors, warnings };
  saveSession(ctx.dir, ctx.session);
  return { ok: true, documents, ...(site ? { site } : {}), rendered, warnings };
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

export function digest(o) {
  return bankDigest(rootOf(o));
}

export const COMMANDS = { init, status, next, cast, evidence, primer, frame, context, say, look, verdict, save, shots, render, close, ideas, fact, digest };
