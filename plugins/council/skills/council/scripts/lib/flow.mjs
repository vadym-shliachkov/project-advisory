import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from './io.mjs';
import { SKILL_DIR } from './paths.mjs';
import { buildModel, loadDoc, saveDoc, docPath, validateSuggestions, mergeDiscussion, discussionGaps, validateReview, validateLayout } from './documents.mjs';
import { buildSuggestionsHtml, buildDiscussionHtml } from './html.mjs';
import { findBrowser, printPdf, pdfPageCount, lookSlug } from './browser.mjs';

// After the verdicts are final: the two documents are written, printed, read by reviewers who did not write them,
// corrected once, and the session is closed. Like the debate, this part has turns, and it cannot loop: the minutes
// are revised once, and a document is looked at for layout at most twice.

const SCRIPT = path.join(SKILL_DIR, 'scripts', 'council.mjs');
export const DOCS = ['suggestions', 'discussion'];
export const DOC_STAFF = ['narrator', 'writer', 'fidelity', 'critic', 'layout-suggestions', 'layout-discussion'];
const MAX_LAYOUT_ROUNDS = 2;
const STAFF_NAMES = {
  narrator: 'the librarian, who writes the minutes', writer: 'the writer of the suggestions', fidelity: 'the fidelity reviewer', critic: 'the literary critic',
  'layout-suggestions': 'the layout reviewer of the suggestions', 'layout-discussion': 'the layout reviewer of the discussion',
};

const file = (dir, name) => path.join(dir, name);
const has = (dir, name) => fs.existsSync(file(dir, name));
const docsOf = (session) => (session.docs ??= { rendered: 0, revised: false, stale: false });

export function docState(ctx, root) {
  const { dir, session } = ctx;
  const model = buildModel(ctx, root);
  const suggestions = loadDoc(dir, 'suggestions');
  const discussion = loadDoc(dir, 'discussion');
  const reviews = { fidelity: loadDoc(dir, 'review-fidelity'), critic: loadDoc(dir, 'review-critic') };
  const layouts = Object.fromEntries(DOCS.map((d) => [d, loadDoc(dir, `layout-${d}`)]));
  return { model, suggestions, discussion, gaps: discussionGaps(discussion, model), reviews, layouts, docs: docsOf(session), pdf: Object.fromEntries(DOCS.map((d) => [d, has(dir, `${d}.pdf`) ? file(dir, `${d}.pdf`) : null])) };
}

// Whose turn it is while the documents are made.
export function docTurns(ctx, root) {
  const { session } = ctx;
  if (!['write', 'review'].includes(session.phase)) return [];
  const s = docState(ctx, root);
  const turn = (role, done, extra = {}) => ({ role, name: STAFF_NAMES[role], model: 'strongest', threads: [], done, ...extra });
  if (session.phase === 'write') return [turn('narrator', !s.gaps.length), turn('writer', Boolean(s.suggestions))];
  const list = [turn('fidelity', Boolean(s.reviews.fidelity)), turn('critic', Boolean(s.reviews.critic))];
  // A layout is looked at after every printing, twice at most; without a PDF there is nothing to look at.
  for (const d of DOCS) {
    if (!s.pdf[d]) continue;
    const seen = s.layouts[d]?.render === s.docs.rendered;
    list.push(turn(`layout-${d}`, seen || s.docs.rendered > MAX_LAYOUT_ROUNDS, { model: 'standard' }));
  }
  // A text of the suggestions that does not fit its place, or carries a broken character, goes back to its writer once.
  if (s.layouts.suggestions?.defects.some((d) => d.cause === 'content')) list.push(turn('writer', Boolean(s.docs.suggestionsRevised)));
  const issues = (s.reviews.fidelity?.issues.length ?? 0) + (s.reviews.critic?.issues.length ?? 0);
  if (s.reviews.fidelity && s.reviews.critic && issues) list.push(turn('narrator', s.docs.revised));
  return list;
}

export function docNextStep(ctx, root) {
  const { session } = ctx;
  const s = docState(ctx, root);
  const waiting = docTurns(ctx, root).filter((t) => !t.done).map((t) => t.name);
  if (session.phase === 'write') {
    return waiting.length ? `Start ${waiting.join(' and ')}, at once.` : 'Both documents are written. Run "next": it prints them and opens the review.';
  }
  if (s.docs.stale) return 'A document changed after it was printed. Run "render", then start the layout reviewers again.';
  if (waiting.length) return `Start, at once: ${waiting.join('; ')}.`;
  return 'The documents are reviewed. Run "close" to finish the session.';
}

// The pictures members took of the pages they cite (the look command), by address: the documents show them beside the
// evidence, so a reader sees the page an idea is about without opening it. Only pictures taken in the session are
// used; nothing is fetched while printing.
export function picturesOf(dir) {
  return (url) => {
    let slug;
    try { slug = lookSlug(url); } catch { return null; }
    const rel = `looks/${slug}-desktop.png`;
    const at = path.join(dir, rel);
    return fs.existsSync(at) ? { src: rel, taken: fs.statSync(at).mtime.toISOString().slice(0, 10) } : null;
  };
}

// Writes both documents as HTML and prints them. Without a browser the HTML is the document.
export function renderDocs(ctx, root, { only = null, html = false, browser = findBrowser(), print = printPdf } = {}) {
  const { dir, session } = ctx;
  const s = docState(ctx, root);
  const errors = [];
  const warnings = [];
  const wanted = only ? [only] : DOCS;
  if (only && !DOCS.includes(only)) return { errors: [`Unknown --doc "${only}". Valid documents: ${DOCS.join(', ')}`], warnings };
  if (wanted.includes('suggestions') && !s.suggestions) errors.push('The suggestions have not been written yet.');
  if (wanted.includes('suggestions') && s.suggestions) errors.push(...validateSuggestions(s.suggestions, s.model, { strict: false }).map((e) => `suggestions: ${e}`));
  if (wanted.includes('discussion') && s.gaps.length) errors.push(`The discussion is not complete: ${s.gaps.join('; ')}.`);
  if (errors.length) return { errors, warnings };

  const build = {
    suggestions: () => buildSuggestionsHtml({ model: s.model, suggestions: s.suggestions, discussion: s.gaps.length ? null : s.discussion, picture: picturesOf(dir) }),
    discussion: () => buildDiscussionHtml({ model: s.model, discussion: s.discussion }),
  };
  const out = {};
  for (const d of wanted) {
    const htmlPath = file(dir, `${d}.html`);
    const pdfPath = file(dir, `${d}.pdf`);
    fs.writeFileSync(htmlPath, build[d]());
    out[d] = { html: htmlPath, pdf: null, pages: null };
    // Without printing, an older PDF is removed so it is never taken for the current document.
    if (html || !browser) {
      try { fs.rmSync(pdfPath, { force: true }); } catch { warnings.push(`The older ${d}.pdf could not be removed (it may be open in a PDF viewer); it is not the current document.`); }
    }
    if (html) continue;
    if (!browser) { warnings.push(`No Chrome, Edge or Chromium was found, so ${d}.html is the document. Install one of them or set CHROME_PATH, then render again.`); continue; }
    try {
      fs.rmSync(pdfPath, { force: true });
      print(browser, htmlPath, pdfPath);
      out[d].pdf = pdfPath;
      out[d].pages = pdfPageCount(pdfPath);
    } catch (e) {
      // A PDF open in a viewer on Windows cannot be replaced.
      if (['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) return { errors: [`Could not replace ${pdfPath} — close it in the PDF viewer and render again.`], warnings };
      warnings.push(`Printing ${d}.pdf failed (${String(e.message).trim()}); ${d}.html was written.`);
    }
  }
  const docs = docsOf(session);
  docs.rendered += 1;
  docs.stale = false;
  return { errors, warnings: [...new Set(warnings)], documents: out, rendered: docs.rendered };
}

// From writing to reviewing: both documents must be there, and they are printed on the way.
export function advanceDocs(ctx, root, { force = false, render = renderDocs } = {}) {
  const { session } = ctx;
  const from = { phase: session.phase, round: session.round, step: session.step };
  if (session.phase === 'review') return { errors: ['The session ends with "close", once the documents are reviewed.'], from, to: from, closed: [] };
  const s = docState(ctx, root);
  const errors = [];
  if (!s.suggestions) errors.push('The suggestions have not been written yet.');
  if (s.gaps.length) errors.push(`The discussion is not complete: ${s.gaps.join('; ')}.`);
  // No document is skipped: a writer that keeps failing ends the session with "close --abandon", and the verdicts
  // already in the ledger stand.
  if (errors.length && force) errors.push('--force does not skip a document. If its writer keeps failing, tell the person which document is missing and set the session aside with "close --abandon": the verdicts are already in the idea ledger.');
  if (errors.length) return { errors, from, to: from, closed: [] };
  const printed = render(ctx, root);
  if (printed.errors.length) return { errors: printed.errors, from, to: from, closed: [] };
  session.phase = 'review';
  return { errors: [], from, to: { phase: 'review', round: session.round, step: session.step }, closed: [], documents: printed.documents, warnings: printed.warnings };
}

// ---- Saving what the writers and reviewers hand in ----

export function saveDocument(ctx, root, doc, data) {
  const { dir, session } = ctx;
  if (!['write', 'review'].includes(session.phase)) return { errors: [`The documents are written after the verdicts are final; the session is in the ${session.phase} phase`] };
  const s = docState(ctx, root);
  const docs = s.docs;
  const changed = () => { if (session.phase === 'review') docs.stale = true; };

  if (doc === 'suggestions') {
    const errors = validateSuggestions(data, s.model);
    if (errors.length) return { errors };
    saveDoc(dir, 'suggestions', data);
    changed();
    if (session.phase === 'review') docs.suggestionsRevised = true;
    return { errors, path: docPath(dir, 'suggestions'), survivors: data.survivors.length, questions: data.questions.length };
  }
  if (doc === 'discussion') {
    const { errors, discussion } = mergeDiscussion(s.discussion, data, s.model);
    if (errors.length) return { errors };
    saveDoc(dir, 'discussion', discussion);
    changed();
    // Saving the minutes again once they have been reviewed is the one revision they get.
    if (session.phase === 'review') docs.revised = true;
    const gaps = discussionGaps(discussion, s.model);
    return { errors, path: docPath(dir, 'discussion'), chapters: discussion.chapters.length, of: s.model.ideas.length, complete: !gaps.length, stillMissing: gaps };
  }
  if (doc === 'review-fidelity' || doc === 'review-critic') {
    if (session.phase !== 'review') return { errors: ['The minutes are reviewed once they are complete and printed (the review phase)'] };
    const kind = doc.slice('review-'.length);
    const errors = validateReview(data, kind, { discussion: s.discussion });
    if (errors.length) return { errors };
    saveDoc(dir, doc, { ...data, reviewedAt: new Date().toISOString() });
    const by = (sev) => data.issues.filter((i) => i.severity === sev).length;
    return { errors, path: docPath(dir, doc), issues: { high: by('high'), medium: by('medium'), low: by('low') } };
  }
  const layout = /^layout-(suggestions|discussion)$/.exec(doc ?? '')?.[1];
  if (layout) {
    if (!s.pdf[layout]) return { errors: [`${layout}.pdf has not been printed, so there is no layout to review`] };
    const pages = pdfPageCount(s.pdf[layout]);
    const errors = validateLayout(data, { doc: layout, pages });
    if (errors.length) return { errors };
    saveDoc(dir, doc, { ...data, pages, render: docs.rendered, reviewedAt: new Date().toISOString() });
    const by = (sev) => data.defects.filter((d) => d.severity === sev).length;
    // A reviewer that could not see the pages found nothing because it looked at nothing: that is not a clean review.
    const unseen = data.pagesSeen === 0 ? { reviewed: false, warning: `The layout of ${layout} was not reviewed: the reviewer could not view the pages. Tell the person, and do not report it as free of defects.` } : { reviewed: true };
    return { errors, path: docPath(dir, doc), pages, ...unseen, defects: { high: by('high'), medium: by('medium'), low: by('low') }, byCause: { template: data.defects.filter((d) => d.cause === 'template').length, content: data.defects.filter((d) => d.cause === 'content').length } };
  }
  return { errors: [`Unknown or missing --doc "${doc ?? ''}". Valid: suggestions, discussion, review-fidelity, review-critic, layout-suggestions, layout-discussion`] };
}

// The session is finished when both documents exist as printed and every reviewer has had a turn.
export function closeSession(ctx, root, { force = false } = {}) {
  const { dir, session } = ctx;
  if (session.phase === 'done') return { errors: [], already: true };
  if (session.phase !== 'review') return { errors: [`A session is closed after its documents are reviewed; it is in the ${session.phase} phase. To stop it here instead, set it aside with --abandon.`] };
  const s = docState(ctx, root);
  const errors = [];
  for (const d of DOCS) if (!has(dir, `${d}.html`)) errors.push(`${d} has not been rendered`);
  if (s.docs.stale) errors.push('A document changed after it was printed: run "render" first');
  const waiting = docTurns(ctx, root).filter((t) => !t.done);
  if (waiting.length && !force) errors.push(`${waiting.map((t) => t.name).join('; ')} ${waiting.length > 1 ? 'have' : 'has'} not had ${waiting.length > 1 ? 'their' : 'a'} turn. Start ${waiting.length > 1 ? 'them' : 'it'}, or pass --force to close without.`);
  if (errors.length) return { errors };
  session.phase = 'done';
  session.closedAt = new Date().toISOString();
  const open = DOCS.flatMap((d) => (s.layouts[d]?.defects ?? []).filter((x) => x.severity === 'high').map((x) => `${d}, page ${x.page}: ${x.what}`));
  const notReviewed = DOCS.filter((d) => s.pdf[d] && (!s.layouts[d] || s.layouts[d].pagesSeen === 0));
  return { errors, documents: Object.fromEntries(DOCS.map((d) => [d, s.pdf[d] ?? file(dir, `${d}.html`)])), highLayoutDefects: open, layoutNotReviewed: notReviewed, skipped: waiting.map((t) => t.role) };
}

// ---- What each writer and reviewer is given ----

const statementView = (s) => {
  const { at, ...rest } = s;
  return rest;
};
const ideaView = (i) => ({
  thread: i.thread, id: i.id, title: i.title, originalTitle: i.originalTitle, proposedBy: i.proposerRole, verdict: i.verdict, strength: i.strength, effort: i.effort,
  hypothesis: i.hypothesis, ...(i.verdict === 'narrowed' ? { asFirstProposed: i.originalHypothesis } : {}), test: i.test, ruling: i.ruling,
  ...(i.closed ? { howTheDebateEnded: i.closed.reason } : {}), ...(i.alsoCovers.length ? { alsoCovers: i.alsoCovers } : {}),
  statements: i.statements.map(statementView), evidence: i.evidence,
});

export function docTurn(ctx, role, root) {
  const { dir, session } = ctx;
  const s = docState(ctx, root);
  const cmd = (doc) => `node "${SCRIPT}" save --doc ${doc} --root "${root}" --session ${session.id}`;
  const turn = docTurns(ctx, root).find((t) => t.role === role);
  if (!turn) throw new Error(`It is not ${role}'s turn in the ${session.phase} phase. See the status command for whose turn it is.`);
  const m = s.model;
  const extra = [];

  if (role === 'narrator') {
    const input = {
      goal: m.session.goal, counts: m.counts,
      cast: m.cast.map(({ role: r, name, title, temper }) => ({ role: r, name, title, temper })),
      // A chapter opens with the idea as it was put to the house, so that is what the narrator is given as the idea;
      // what the judge narrowed it to is in the ruling.
      ideas: m.ideas.map((i) => { const { asFirstProposed, hypothesis, title, originalTitle, ...rest } = ideaView(i); return { ...rest, title: originalTitle, asProposed: i.originalHypothesis }; }),
      notAdmitted: { refused: m.refused, merged: m.merged }, questions: m.questions,
    };
    if (s.discussion) extra.push(`- The minutes as they stand, to go on from or to revise: ${docPath(dir, 'discussion')}${s.gaps.length ? ` (${s.gaps.join('; ')})` : ''}`);
    if (session.phase === 'review') {
      extra.push(`- The fidelity review, every issue of which you apply or answer: ${docPath(dir, 'review-fidelity')}`, `- The critic's review, every issue of which you apply or answer: ${docPath(dir, 'review-critic')}`);
    }
    return { prompts: ['narrator.md'], input: { name: 'discussion-model', data: input }, extra, cmd: cmd('discussion'), shape: '{ "title": "…", "opening": "…", "chapters": [ { "thread": "T5", "line": "…", "pullQuote": "…", "scenes": [ … ] } ] }', okLine: 'minutes: ok, 14 chapters', badLine: 'minutes: invalid — <first error>' };
  }
  if (role === 'writer') {
    const input = {
      goal: m.session.goal, counts: m.counts, lacked: m.missing, grades: m.grades,
      survivors: m.survivors.map(ideaView), setNotes: m.setNotes,
      questions: m.questions.map(({ n, idea, text, for: forWhom }) => ({ n, idea, for: forWhom, text })),
      notSurvivors: { killed: m.killed.map((i) => ({ title: i.title, causeOfDeath: i.ruling.causeOfDeath })), undecided: m.undecided.map((i) => ({ title: i.title, wouldDecide: i.ruling.wouldDecide })) },
    };
    if (s.suggestions) extra.push(`- The suggestions as they stand, to revise: ${docPath(dir, 'suggestions')}`);
    if (s.layouts.suggestions?.defects.some((d) => d.cause === 'content')) extra.push(`- The layout review, whose "content" defects you fix (a text too long for its place, a broken character): ${docPath(dir, 'layout-suggestions')}`);
    return { prompts: ['writer.md'], input: { name: 'suggestions-model', data: input }, extra, cmd: cmd('suggestions'), shape: '{ "summary": "…", "plan": [ { "text": "…", "ideas": ["I21"] } ], "survivors": [ { "idea": "I21", … } ], "questions": [ { "refs": [41], "text": "…" } ] }', okLine: 'suggestions: ok, 8 survivors', badLine: 'suggestions: invalid — <first error>' };
  }
  if (role === 'fidelity') {
    writeJson(file(dir, path.join('in', 'discussion-model.json')), { ideas: m.ideas.map(ideaView), cast: m.cast.map(({ role: r, name, title }) => ({ role: r, name, title })) });
    return { prompts: ['fidelity-review.md'], extra: [`- The minutes: ${docPath(dir, 'discussion')}`, `- The record of the debate, idea by idea, with every statement and the evidence it cites: ${file(dir, path.join('in', 'discussion-model.json'))}`], cmd: cmd('review-fidelity'), shape: '{ "verdict": "…", "issues": [ … ] }', okLine: 'fidelity: 1 high, 3 medium', badLine: 'fidelity: invalid — <first error>' };
  }
  if (role === 'critic') {
    const rendered = s.pdf.discussion ?? file(dir, 'discussion.html');
    const chapters = (s.discussion?.chapters ?? []).map((c, i) => ({ chapter: i + 1, thread: c.thread, title: m.ideas.find((x) => x.thread === c.thread)?.originalTitle }));
    return { prompts: ['critic.md'], input: { name: 'critic', data: { chapters } }, extra: [`- The document to read, from the first page to the last: ${rendered}${s.pdf.discussion ? ` (${pdfPageCount(s.pdf.discussion)} pages; with the Read tool, pass \`pages\` in ranges of at most 20)` : ''}`, `- Its text as data, for quoting a passage exactly: ${docPath(dir, 'discussion')}`], cmd: cmd('review-critic'), shape: '{ "verdict": "…", "issues": [ … ] }', okLine: 'critic: 2 high, 5 medium', badLine: 'critic: invalid — <first error>' };
  }
  const doc = role.slice('layout-'.length);
  const pages = pdfPageCount(s.pdf[doc]);
  return {
    prompts: ['layout-review.md'], replace: ['<doc>', doc],
    extra: [`- Document: ${s.pdf[doc]} (${pages} pages)`, `- Its HTML, for checking the markup of a block: ${file(dir, `${doc}.html`)}`, `- The company or project name the document should show: ${m.brand.name}`],
    cmd: cmd(`layout-${doc}`), shape: `{ "doc": "${doc}", "pagesSeen": ${pages}, "defects": [ ... ], "notes": [ ... ] }`, okLine: `layout ${doc}: 0 defects`, badLine: `layout ${doc}: 3 high, 2 medium`,
  };
}

export const loadLayout = (dir, doc) => readJson(docPath(dir, `layout-${doc}`), null);
