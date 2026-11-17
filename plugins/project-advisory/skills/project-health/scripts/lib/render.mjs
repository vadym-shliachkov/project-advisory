import fs from 'node:fs';
import path from 'node:path';
import { readJson } from './io.mjs';
import { parseTicks, resolveSelection } from './checklist.mjs';
import { buildReportHtml, logoSource } from './report-html.mjs';
import { buildPlanHtml } from './plan-html.mjs';
import { findBrowser, printPdf } from './browser.mjs';
import { withoutDismissed } from './score.mjs';
import { validateSynthesis, reportItems, printedFindings } from './synthesis.mjs';
import { lintItems, lintSummary } from './readability.mjs';
import { withBrandFact, NAME_FROM } from './brand.mjs';
import { loadKb } from './kb.mjs';

const TEMPLATES = new URL('../../templates/', import.meta.url);

// The synthesis is written for one selection of findings; after the checklist changes it no longer fits.
function loadSynthesis(runDir, doc, selected, warnings) {
  const syn = readJson(path.join(runDir, 'synthesis.json'), null);
  if (!syn) {
    warnings.push('No synthesis.json — the report shows the problem register only, without decisions or a summary. Run the synthesis and edit stages first.');
    return null;
  }
  const { errors } = validateSynthesis(syn, { doc, selectedIds: selected });
  if (errors.length) {
    warnings.push(`synthesis.json does not match the ticked findings (${errors[0]}) — it was left out. Run the synthesis and edit stages again.`);
    return null;
  }
  if (!syn.review) warnings.push('The plain-language editor has not reviewed this report text yet.');
  else if (!syn.review.readable) warnings.push(`The plain-language editor found the text still hard to read: ${syn.review.notes.join(' ')}`);
  return syn;
}

// Writes the HTML and prints it to PDF next to it. Returns the PDF path, or null with a warning when it cannot print.
export function writeDocument(html, htmlPath, browser, warnings) {
  fs.writeFileSync(htmlPath, html);
  const pdfPath = htmlPath.replace(/\.html$/, '.pdf');
  const name = path.basename(htmlPath);
  try {
    fs.rmSync(pdfPath, { force: true });
  } catch (e) {
    // A PDF open in a viewer on Windows cannot be replaced.
    if (!['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw e;
    warnings.push(`Could not replace ${pdfPath}: it is probably open in a PDF viewer. Close it there and render again; ${name} was written.`);
    return null;
  }
  if (!browser) {
    warnings.push(`No Chrome, Edge or Chromium found — wrote ${name} only. Install one of them or set CHROME_PATH, then render again.`);
    return null;
  }
  try {
    printPdf(browser, htmlPath, pdfPath);
  } catch (e) {
    warnings.push(`PDF printing failed (${e.message.trim()}) — wrote ${name} only.`);
    return null;
  }
  return pdfPath;
}

export function renderReport(root, runDir, { browser = findBrowser() } = {}) {
  const raw = readJson(path.join(runDir, 'findings.json'), null);
  if (!raw) throw new Error('This run has no findings.json — run "project-health analyse" first.');
  const checklistPath = path.join(runDir, 'checklist.md');
  if (!fs.existsSync(checklistPath)) throw new Error('This run has no checklist.md — run "project-health analyse" first.');
  // A brand name the user gave after the run (ph fact --key brand.name) is the one printed.
  const profile = withBrandFact(readJson(path.join(runDir, 'profile.json'), {}), loadKb(root));
  const { selected, dismissed, warnings } = resolveSelection(raw, parseTicks(fs.readFileSync(checklistPath, 'utf8')));
  if (!selected.length) warnings.push('No findings are ticked in the checklist — the report lists the problems without decisions or a plan.');
  const said = profile.brand?.nameFrom === NAME_FROM.human ? profile.brand.name : null;
  const doc = withoutDismissed(said ? { ...raw, project: { ...raw.project, name: said } } : raw, dismissed);
  const synthesis = selected.length ? loadSynthesis(runDir, doc, selected, warnings) : null;
  const readability = lintSummary(lintItems(reportItems(printedFindings(doc, selected), synthesis), (synthesis?.glossary ?? []).map((g) => g.term)));

  const shared = {
    doc,
    profile,
    synthesis,
    template: fs.readFileSync(new URL('report.html', TEMPLATES), 'utf8'),
    css: fs.readFileSync(new URL('report.css', TEMPLATES), 'utf8'),
    logoSrc: logoSource(root, profile.brand?.logo),
  };
  const htmlPath = path.join(runDir, 'report.html');
  const pdf = writeDocument(buildReportHtml({ ...shared, selected }), htmlPath, browser, warnings);
  // The plan is a document of its own, for whoever agrees the work and its order.
  const planPath = path.join(runDir, 'plan.html');
  let plan = null;
  if (synthesis?.plan) {
    plan = { html: planPath, pdf: writeDocument(buildPlanHtml(shared), planPath, browser, warnings) };
  } else {
    for (const p of [planPath, planPath.replace(/\.html$/, '.pdf')]) fs.rmSync(p, { force: true });
    if (synthesis) warnings.push('The synthesis has no plan, so no "Plan and effort" document was written.');
  }
  return { html: htmlPath, pdf, plan, selected: selected.length, dismissed: dismissed.length, synthesis: Boolean(synthesis), readability, warnings: [...new Set(warnings)] };
}
