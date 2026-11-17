import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpDir, hasGit, SKILL_DIR } from '../helpers.mjs';
import { makeStaticHtmlRepo, FAKE_AWS_KEY } from '../fixtures/make-static-html-repo.mjs';

const PH = path.join(SKILL_DIR, 'scripts', 'ph.mjs');

function ph(root, ...args) {
  const r = spawnSync(process.execPath, [PH, ...args, '--root', root], { encoding: 'utf8' });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* context prints Markdown */ }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

const SEO = {
  rule: 'seo.noindex-production', subject: 'site', area: 'seo', kind: 'issue',
  title: 'The home page tells search engines not to index it',
  why: 'A noindex tag keeps the site out of search results, so nobody finds it through search.',
  severity: 'critical', confidence: 'high',
  evidence: [{ type: 'file', ref: 'index.html:5', excerpt: '<meta name="robots" content="noindex">' }], verified: true,
};
const SEC = {
  rule: 'security.env-file-committed', subject: '.env.production', area: 'security', kind: 'issue',
  title: 'A production .env file is committed to the repository',
  why: 'Anyone with access to the repository, including former contractors, can read the credentials.',
  severity: 'critical', confidence: 'high', evidence: [{ type: 'file', ref: '.env.production:1', excerpt: 'AKIA…LE (20 chars)' }], verified: true,
};
const FACT = { key: 'seo.titlePattern', value: '<Page> | Acme Studio', source: 'index.html', confidence: 'medium' };

test('full pipeline with canned subagent outputs, then a second run', { skip: !hasGit && 'git not installed' }, () => {
  const root = makeStaticHtmlRepo(path.join(tmpDir(), 'site'));

  const init = ph(root, 'init', '--only', 'seo,security');
  assert.equal(init.code, 0, init.stderr);
  assert.deepEqual(init.json.applicableAreas, ['seo', 'security']);
  const run = init.json.run;
  const runDir = path.join(root, '.project-health', 'runs', run);

  const collect = ph(root, 'collect', '--run', run);
  assert.equal(collect.code, 0, collect.stderr);
  assert.ok(collect.json.secretsInFiles >= 1);
  assert.ok(!fs.readFileSync(path.join(runDir, 'collect.json'), 'utf8').includes(FAKE_AWS_KEY));

  const ctx = ph(root, 'context', '--run', run, '--area', 'seo');
  assert.equal(ctx.code, 0, ctx.stderr);
  assert.match(ctx.stdout, /# Contract for every analysis area/);
  assert.match(ctx.stdout, /# Area: SEO and discoverability/);
  assert.match(ctx.stdout, /Live site data: none/);
  assert.match(ctx.stdout, /stacks[\\/]static-html\.md/);

  fs.writeFileSync(path.join(runDir, 'areas', 'security.json'), '{"findings":[{"rule":"x"}],"facts":[]}');
  const bad = ph(root, 'validate-area', '--run', run, '--area', 'security');
  assert.equal(bad.code, 1);
  assert.equal(bad.json.ok, false);
  assert.ok(bad.json.errors.length > 0);

  fs.writeFileSync(path.join(runDir, 'areas', 'security.json'), `\`\`\`json\n${JSON.stringify({ findings: [SEC], facts: [] })}\n\`\`\``);
  assert.equal(ph(root, 'validate-area', '--run', run, '--area', 'security').code, 0);
  fs.writeFileSync(path.join(runDir, 'areas', 'seo.json'), JSON.stringify({ findings: [SEO], facts: [FACT] }));

  const merge = ph(root, 'merge', '--run', run);
  assert.equal(merge.code, 0, merge.stderr);
  const doc = JSON.parse(fs.readFileSync(path.join(runDir, 'findings.json'), 'utf8'));
  assert.equal(doc.findings.length, 2);
  assert.equal(doc.areas['ai-setup'].reason, 'not selected');
  assert.ok(doc.notVerified.some((n) => n.includes('No live site address was given')));
  const kb = JSON.parse(fs.readFileSync(path.join(root, '.project-health', 'kb', 'facts.json'), 'utf8'));
  assert.equal(kb.facts[0].key, 'seo.titlePattern');
  assert.ok(kb.facts[0].sourceHash);

  assert.equal(ph(root, 'checklist', '--run', run).code, 0);
  const md = fs.readFileSync(path.join(runDir, 'checklist.md'), 'utf8');
  for (const f of doc.findings) assert.ok(md.includes(`- [x] **${f.id}**`), f.id);

  const render = ph(root, 'render', '--run', run);
  assert.equal(render.code, 0, render.stderr);
  assert.ok(fs.readFileSync(path.join(runDir, 'report.html'), 'utf8').includes('Acme Studio'));

  const sel = ph(root, 'selected', '--run', run);
  assert.equal(sel.json.findings.length, 2);

  fs.writeFileSync(path.join(runDir, 'backlog.json'), JSON.stringify({
    items: doc.findings.map((f, i) => ({
      id: `BL-00${i + 1}`, findingIds: [f.id], outcome: `The problem behind ${f.id} no longer exists.`,
      acceptanceCriteria: [`A re-run of project-health no longer reports ${f.id}.`], dependsOn: [], priority: f.severity,
    })),
  }));
  const bl = ph(root, 'backlog-render', '--run', run);
  assert.equal(bl.code, 0, bl.stderr + bl.stdout);
  assert.ok(fs.existsSync(path.join(runDir, 'backlog.md')));

  // Second run analyses only SEO and finds nothing: only the SEO finding is fixed (review focus 2).
  const init2 = ph(root, 'init', '--only', 'seo');
  assert.equal(init2.code, 0, init2.stderr);
  const run2 = init2.json.run;
  fs.writeFileSync(path.join(root, '.project-health', 'runs', run2, 'areas', 'seo.json'), JSON.stringify({ findings: [], facts: [] }));
  assert.equal(ph(root, 'merge', '--run', run2).code, 0);
  const doc2 = JSON.parse(fs.readFileSync(path.join(root, '.project-health', 'runs', run2, 'findings.json'), 'utf8'));
  assert.deepEqual(doc2.fixed.map((f) => f.area), ['seo']);
  assert.equal(ph(root, 'latest').json.run, run2);

  // Third run covers every area again and still finds the security issue: security is compared with run 1
  // (run 2 did not analyse it), so the finding stays persisting and nothing is reported fixed again.
  const init3 = ph(root, 'init');
  assert.equal(init3.code, 0, init3.stderr);
  const run3Dir = path.join(root, '.project-health', 'runs', init3.json.run);
  fs.writeFileSync(path.join(run3Dir, 'areas', 'seo.json'), JSON.stringify({ findings: [], facts: [] }));
  fs.writeFileSync(path.join(run3Dir, 'areas', 'security.json'), JSON.stringify({ findings: [SEC], facts: [] }));
  assert.equal(ph(root, 'merge', '--run', init3.json.run).code, 0);
  const doc3 = JSON.parse(fs.readFileSync(path.join(run3Dir, 'findings.json'), 'utf8'));
  assert.deepEqual(doc3.findings.map((f) => [f.area, f.status]), [['security', 'persisting']]);
  assert.deepEqual(doc3.fixed, []);
});

test('bad input is rejected with clear messages', () => {
  const root = tmpDir();
  const unknown = ph(root, 'frobnicate');
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /Usage: ph </);
  const noRun = ph(root, 'render');
  assert.equal(noRun.code, 1);
  assert.match(noRun.stderr, /No analysis run found/);
  assert.equal(ph(root, 'init').code, 0);
  const traversal = ph(root, 'render', '--run', '../../evil');
  assert.equal(traversal.code, 1);
  assert.match(traversal.stderr, /Invalid run id/);
  const option = ph(root, 'init', '--bogus');
  assert.equal(option.code, 1);
  assert.match(option.stderr, /bogus/);
  const url = ph(root, 'init', '--url', 'example.com');
  assert.equal(url.code, 1);
  assert.match(url.stderr, /Invalid URL/);
  const area = ph(root, 'context', '--area', 'speed');
  assert.equal(area.code, 1);
  assert.match(area.stderr, /Unknown or missing --area/);
  const missing = ph(path.join(root, 'nope'), 'init');
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /Project folder not found/);
});

test('fact stores human facts that later runs do not overwrite', () => {
  const root = tmpDir();
  const r = ph(root, 'fact', '--key', 'business.goal', '--value', 'Demo requests');
  assert.equal(r.code, 0, r.stderr);
  const kb = JSON.parse(fs.readFileSync(path.join(root, '.project-health', 'kb', 'facts.json'), 'utf8'));
  assert.deepEqual([kb.facts[0].key, kb.facts[0].value, kb.facts[0].source], ['business.goal', 'Demo requests', 'human']);
  assert.equal(ph(root, 'fact', '--key', 'Bad Key', '--value', 'x').code, 1);
});

test('the ai-setup context includes facts recorded by every area; other areas see only their own', () => {
  const root = tmpDir();
  assert.equal(ph(root, 'init').code, 0);
  const kbFile = path.join(root, '.project-health', 'kb', 'facts.json');
  fs.mkdirSync(path.dirname(kbFile), { recursive: true });
  fs.writeFileSync(kbFile, JSON.stringify({ facts: [{ ...FACT, observedAt: '2026-10-11', by: 'seo', history: [] }] }));
  const ai = ph(root, 'context', '--area', 'ai-setup');
  assert.equal(ai.code, 0, ai.stderr);
  assert.match(ai.stdout, /"key": "seo\.titlePattern"/);
  assert.doesNotMatch(ph(root, 'context', '--area', 'security').stdout, /seo\.titlePattern/);
});

test('context warns when the live site was unreachable or blocked', () => {
  const root = tmpDir();
  const init = ph(root, 'init');
  assert.equal(init.code, 0, init.stderr);
  const liveFile = path.join(root, '.project-health', 'runs', init.json.run, 'live.json');
  fs.writeFileSync(liveFile, JSON.stringify({ url: 'https://a.test/', reachable: false, errors: ['home: fetch failed'], skippedChecks: [] }));
  const down = ph(root, 'context', '--area', 'seo');
  assert.equal(down.code, 0, down.stderr);
  assert.ok(down.stdout.includes(`- Live site data: ${liveFile} — the site was unreachable or blocked (home: fetch failed); treat rules that need live page content as "verified": false.`), down.stdout);
  fs.writeFileSync(liveFile, JSON.stringify({ url: 'https://a.test/', reachable: true, blocked: true, home: { status: 403 }, errors: [], skippedChecks: [] }));
  assert.match(ph(root, 'context', '--area', 'seo').stdout, /unreachable or blocked \(the home page returned HTTP 403\)/);
});

function phInput(root, input, ...args) {
  const r = spawnSync(process.execPath, [PH, ...args, '--root', root], { encoding: 'utf8', input });
  return { code: r.status, stderr: r.stderr, json: JSON.parse(r.stdout || 'null') };
}

test('subagents save through save-area, see earlier findings, and dismissals carry over', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'index.html'), '<title>Acme</title>');
  const init = ph(root, 'init', '--only', 'seo');
  assert.equal(init.code, 0, init.stderr);
  const run = init.json.run;

  const saving = ph(root, 'context', '--run', run, '--area', 'seo', '--save');
  assert.match(saving.stdout, /## Delivering your result/);
  assert.match(saving.stdout, /save-area --root ".+" --run \S+ --area seo <<'PH_JSON'/);
  assert.match(saving.stdout, /reply with one line only/);
  assert.match(ph(root, 'context', '--run', run, '--area', 'seo').stdout, /Reply with the JSON object only/);
  assert.match(saving.stdout, /### Findings from the previous run\n\nNone/);

  const bad = phInput(root, 'not json at all', 'save-area', '--run', run, '--area', 'seo');
  assert.equal(bad.code, 1);
  assert.match(bad.json.errors[0], /invalid JSON/);
  const good = phInput(root, `Here it is:\n${JSON.stringify({ findings: [SEO], facts: [] })}`, 'save-area', '--run', run, '--area', 'seo');
  assert.equal(good.code, 0, JSON.stringify(good.json));
  assert.equal(good.json.findings, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.project-health', 'runs', run, 'areas', 'seo.json'), 'utf8')).findings[0].rule, SEO.rule);

  assert.equal(ph(root, 'merge', '--run', run).code, 0);
  assert.equal(ph(root, 'checklist', '--run', run).code, 0);
  const runDir = path.join(root, '.project-health', 'runs', run);
  const id = JSON.parse(fs.readFileSync(path.join(runDir, 'findings.json'), 'utf8')).findings[0].id;
  const md = fs.readFileSync(path.join(runDir, 'checklist.md'), 'utf8');
  fs.writeFileSync(path.join(runDir, 'checklist.md'), md.replace(`- [x] **${id}**`, `- [-] **${id}**`));
  const render = ph(root, 'render', '--run', run);
  assert.equal(render.json.dismissed, 1);
  assert.match(fs.readFileSync(path.join(runDir, 'report.html'), 'utf8'), /<td>SEO and discoverability<\/td><td class="bar-cell"><span class="bar"><span class="bar-fill" style="width:100%">/, 'a dismissed issue does not lower the score');

  const init2 = ph(root, 'init', '--only', 'seo');
  const run2 = init2.json.run;
  assert.match(ph(root, 'context', '--run', run2, '--area', 'seo').stdout, /- `seo\.noindex-production` · subject `site` · The home page tells search engines not to index it/);
  assert.equal(phInput(root, JSON.stringify({ findings: [SEO], facts: [] }), 'save-area', '--run', run2, '--area', 'seo').code, 0);
  assert.equal(ph(root, 'merge', '--run', run2).code, 0);
  const cl = ph(root, 'checklist', '--run', run2);
  assert.equal(cl.json.dismissedEarlier, 1);
  assert.ok(fs.readFileSync(path.join(root, '.project-health', 'runs', run2, 'checklist.md'), 'utf8').includes(`- [-] **${id}**`));
});

test('the report is written by a synthesis stage and a plain-language edit stage before rendering', () => {
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'index.html'), '<title>Acme</title>');
  const run = ph(root, 'init', '--only', 'seo').json.run;
  const runDir = path.join(root, '.project-health', 'runs', run);
  assert.equal(phInput(root, JSON.stringify({ findings: [SEO], facts: [] }), 'save-area', '--run', run, '--area', 'seo').code, 0);
  assert.equal(ph(root, 'merge', '--run', run).code, 0);
  assert.equal(ph(root, 'checklist', '--run', run).code, 0);
  const id = JSON.parse(fs.readFileSync(path.join(runDir, 'findings.json'), 'utf8')).findings[0].id;

  assert.match(ph(root, 'report-context', '--run', run).stderr, /Unknown or missing --stage/);
  const brief = ph(root, 'report-context', '--run', run, '--stage', 'synthesis', '--save');
  assert.equal(brief.code, 0, brief.stderr);
  assert.match(brief.stdout, /^# Report synthesis/);
  assert.match(brief.stdout, /Ticked findings: .+selected\.json \(1: 1 critical/);
  assert.match(brief.stdout, /save-report --root ".+" --run \S+ --stage synthesis <<'PH_JSON'/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(runDir, 'selected.json'), 'utf8')).findings[0].id, id);

  const syn = {
    summary: { verdict: 'The site is invisible to search engines, which is the one problem that matters right now.', strengths: [] },
    decisions: [],
    themes: [{ id: 'T1', title: 'Search engines are told to stay away', findingIds: [id], summary: 'One setting on the home page keeps the whole site out of search results.' }],
    wording: { [id]: { title: 'The home page is hidden from Google' } },
    glossary: [],
  };
  const saved = phInput(root, JSON.stringify(syn), 'save-report', '--run', run, '--stage', 'synthesis');
  assert.equal(saved.code, 0, JSON.stringify(saved.json));
  assert.equal(saved.json.themes, 1);
  assert.ok(fs.existsSync(path.join(runDir, 'synthesis.draft.json')));

  const edit = ph(root, 'report-context', '--run', run, '--stage', 'edit');
  assert.match(edit.stdout, /^# Plain-language editor/);
  assert.match(edit.stdout, /`themes\.T1\.title`: Search engines are told to stay away/);
  assert.match(edit.stdout, /### Readability check/);
  assert.match(edit.stdout, /Reply with the JSON object only/);

  const regrouped = phInput(root, JSON.stringify({ ...syn, themes: [], review: { readable: true, notes: [] } }), 'save-report', '--run', run, '--stage', 'edit');
  assert.equal(regrouped.code, 1);
  assert.ok(regrouped.json.errors.some((e) => e.includes('must keep the same ids')));
  const edited = { ...syn, themes: [{ ...syn.themes[0], title: 'Google is told to ignore the site' }], review: { readable: true, notes: ['Shortened the theme title.'] } };
  assert.equal(phInput(root, JSON.stringify(edited), 'save-report', '--run', run, '--stage', 'edit').code, 0);

  const render = ph(root, 'render', '--run', run);
  assert.equal(render.code, 0, render.stderr);
  assert.equal(render.json.synthesis, true);
  const html = fs.readFileSync(path.join(runDir, 'report.html'), 'utf8');
  assert.ok(html.includes('Google is told to ignore the site'));
  assert.ok(html.includes('The home page is hidden from Google'));
});
