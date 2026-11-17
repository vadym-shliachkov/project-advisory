import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpDir, readJson, SKILL_DIR } from '../helpers.mjs';
import { pdfPageCount, validateLayoutReview } from '../../skills/project-health/scripts/commands.mjs';

const PH = path.join(SKILL_DIR, 'scripts', 'ph.mjs');
const RUN = '2026-10-31T1200';
const ph = (root, input, ...args) => spawnSync(process.execPath, [PH, ...args, '--root', root], { encoding: 'utf8', input });

// A run with a rendered report: a minimal PDF whose page tree counts three pages.
function runWithPdf() {
  const root = tmpDir();
  const dir = path.join(root, '.project-health', 'runs', RUN);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify({ brand: { name: 'Acme Studio' } }));
  fs.writeFileSync(path.join(dir, 'report.pdf'), '%PDF-1.4\n1 0 obj << /Type /Pages /Kids [] /Count 3 >> endobj\n2 0 obj << /Type /Pages /Count 1 >> endobj\n');
  return { root, dir };
}

const defect = (over = {}) => ({ page: 2, kind: 'split-box', where: 'The problem panel of S5', what: 'An empty grey box sits at the top of the page', severity: 'high', cause: 'template', ...over });

test('the page count of a printed PDF is the root of its page tree', () => {
  const { dir } = runWithPdf();
  assert.equal(pdfPageCount(path.join(dir, 'report.pdf')), 3);
});

test('a layout review must cover every page and describe each defect', () => {
  assert.deepEqual(validateLayoutReview({ doc: 'report', pagesSeen: 3, defects: [defect()], notes: [] }, { doc: 'report', pages: 3 }), []);
  const errors = validateLayoutReview({ doc: 'plan', pagesSeen: 2, defects: [defect({ page: 9, kind: 'ugly', severity: 'urgent', cause: 'css', what: '' })] }, { doc: 'report', pages: 3 });
  for (const re of [/\$\.doc/, /pagesSeen.*look at every page/, /page: a page number from 1 to 3/, /kind: one of/, /severity/, /cause/, /what: a short description/]) {
    assert.ok(errors.some((e) => re.test(e)), `expected an error matching ${re}: ${errors.join(' | ')}`);
  }
  assert.deepEqual(validateLayoutReview({ doc: 'report', pagesSeen: 0, defects: [], notes: ['Could not view PDF pages with the available tools.'] }, { doc: 'report', pages: 3 }), [], 'a reviewer that cannot see pages says so instead of guessing');
});

test('layout-context gives a fresh reviewer the PDF, its page count and how to save; save-layout stores the review', () => {
  const { root, dir } = runWithPdf();
  const brief = ph(root, '', 'layout-context', '--run', RUN, '--doc', 'report', '--save');
  assert.equal(brief.status, 0, brief.stderr);
  assert.match(brief.stdout, /look at \*\*every page\*\*/);
  assert.match(brief.stdout, /report\.pdf \(3 pages\)/);
  assert.match(brief.stdout, /name on the document: "Acme Studio", taken from the name of the project folder\. It is a guess unless the user said it/);
  assert.match(brief.stdout, /save-layout --root .* --doc report <<'PH_JSON'/);

  assert.match(ph(root, '', 'layout-context', '--run', RUN, '--doc', 'deck').stderr, /Unknown or missing --doc/);
  assert.match(ph(root, '', 'layout-context', '--run', RUN, '--doc', 'plan').stderr, /has no plan\.pdf — render it first/);

  const bad = ph(root, JSON.stringify({ doc: 'report', pagesSeen: 1, defects: [] }), 'save-layout', '--run', RUN, '--doc', 'report');
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /look at every page/);

  const good = ph(root, JSON.stringify({ doc: 'report', pagesSeen: 3, defects: [defect(), defect({ page: 3, kind: 'broken-text', severity: 'medium', cause: 'content' })], notes: [] }), 'save-layout', '--run', RUN, '--doc', 'report');
  assert.equal(good.status, 0, good.stdout + good.stderr);
  const out = JSON.parse(good.stdout);
  assert.deepEqual(out.defects, { high: 1, medium: 1, low: 0 });
  assert.deepEqual(out.byCause, { template: 1, content: 1 });
  const saved = readJson(path.join(dir, 'layout-report.json'));
  assert.equal(saved.pages, 3);
  assert.equal(saved.defects.length, 2);
  assert.equal(out.reviewed, true);

  const blind = JSON.parse(ph(root, JSON.stringify({ doc: 'report', pagesSeen: 0, defects: [], notes: ['Could not view PDF pages with the available tools.'] }), 'save-layout', '--run', RUN, '--doc', 'report').stdout);
  assert.equal(blind.reviewed, false, 'a review that saw no page is not a clean one');
  assert.match(blind.warning, /was not reviewed/);
});

test('a PDF the last render could not replace is not given to the layout reviewer', () => {
  const { root, dir } = runWithPdf();
  const pdf = path.join(dir, 'report.pdf');
  fs.writeFileSync(path.join(dir, 'report.html'), '<html></html>');
  fs.utimesSync(pdf, new Date(Date.now() - 60000), new Date(Date.now() - 60000));
  const stale = ph(root, '', 'layout-context', '--run', RUN, '--doc', 'report');
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /report\.pdf is older than report\.html: the last render could not replace it/);
  fs.utimesSync(pdf, new Date(), new Date(Date.now() + 1000));
  assert.equal(ph(root, '', 'layout-context', '--run', RUN, '--doc', 'report').status, 0, 'a PDF printed after its page is reviewed');
});

test('a brand name the user gives after the run is the one every document and reviewer gets', () => {
  const { root } = runWithPdf();
  assert.equal(ph(root, '', 'fact', '--key', 'brand.name', '--value', 'Acme Joinery Ltd').status, 0);
  const brief = ph(root, '', 'layout-context', '--run', RUN, '--doc', 'report');
  assert.match(brief.stdout, /name on the document: "Acme Joinery Ltd", taken from what the user said/);
});

test('both skills run the layout review in a new agent after rendering', () => {
  const ph = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  assert.match(ph, /## Layout review/);
  assert.match(ph, /start one \*\*new\*\* subagent/);
  assert.match(ph, /layout-context --root "<ROOT>" --run <run> --doc <doc> --save/);
  const roadmap = fs.readFileSync(path.join(SKILL_DIR, '..', 'roadmap', 'SKILL.md'), 'utf8');
  assert.match(roadmap, /layout-context --doc roadmap --save/);
  assert.match(roadmap, /Do not hand over the roadmap before this is done/);
});
