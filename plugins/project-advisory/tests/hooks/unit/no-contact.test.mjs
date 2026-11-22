import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { textReason, toolReason, mcpReason, urlReason, isOurAgent, parseCommands } from '../../../hooks/rules.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HOOK = path.join(PLUGIN_ROOT, 'hooks', 'no-contact.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pa-guard-'));

test('commands that send something are refused', () => {
  const refused = [
    'curl -X POST https://example.com/contact',
    'curl -XPOST https://example.com',
    'curl --data "name=a" https://example.com/form',
    'curl -F file=@a.txt https://example.com/upload',
    'curl --json \'{"a":1}\' https://example.com/api',
    'curl smtp://mail.example.com --mail-rcpt a@example.com',
    'wget --post-data "a=1" https://example.com',
    'Invoke-WebRequest -Uri https://example.com -Method Post -Body $b',
    'irm https://example.com -Method:Put',
    'git push origin main',
    'git -C ../site push',
    'cd "c:/x" && git push',
    'git send-email --to a@example.com 0001.patch',
    'gh issue create --title x --body y',
    'gh pr comment 12 --body hi',
    'gh api repos/o/r/issues -f title=x',
    'gh api -X POST repos/o/r/issues',
    'sendmail a@example.com < note.txt',
    'Send-MailMessage -To a@example.com -Subject hi',
    'nc example.com 25',
    'start mailto:owner@example.com',
    'xdg-open "tel:+100000000"',
    'http POST https://example.com name=a',
    'echo $(curl -d x https://example.com)',
    'bash -c "curl --data x https://example.com"',
    'powershell -Command "Invoke-RestMethod -Uri u -Method Post"',
    'powershell -EncodedCommand SQBFAFgA',
    'node -e "fetch(\'https://example.com\', { method: \'POST\', body })"',
    'python3 -c "import requests; requests.post(\'https://example.com\', data={})"',
    'python3 - <<\'EOF\'\nimport smtplib\nEOF',
    'cat <<EOF | curl -d @- https://example.com\nhello\nEOF',
    'node - <<EOF\nconst b = await chromium.launch(); await page.fill("#email", "a"); await page.click("button")\nEOF',
    'env A=1 timeout 10 curl -d x https://example.com',
  ];
  for (const c of refused) assert.ok(textReason(c), `refused: ${c}`);
});

test('reading, searching and the plugin\'s own scripts are let through', () => {
  const allowed = [
    'curl -sSL -o page.html https://example.com/page?x=1',
    'curl -I https://example.com',
    'wget -q -O - https://example.com/robots.txt',
    'Invoke-WebRequest -Uri https://example.com -OutFile page.html',
    'grep -rn "git push" .',
    'git grep -n "method: \'POST\'"',
    'rg -n "mailto:" src',
    'git log --grep push --oneline',
    'git status && git diff',
    'gh pr list',
    'gh issue view 12',
    'gh api repos/o/r',
    'npm test 2>&1 | tail -5',
    'cmd 2>&1 | tee log',
    'node "C:/p/skills/council/scripts/council.mjs" save --root . --session 2026-11-22 <<\'COUNCIL_JSON\'\n{ "text": "The form posts with method: \'POST\' and curl -d would send it; git push" }\nCOUNCIL_JSON',
    'node "/p/skills/project-health/scripts/ph.mjs" brief-save --root . --run r1 <<EOF\n{"text":"requests.post( and sendmail"}\nEOF',
    'echo \'{"a":"requests.post("}\' | node /p/skills/council/scripts/lab.mjs save --root .',
    'node /p/skills/council/scripts/venture.mjs status --root .',
    'python3 -c "print(1)"',
  ];
  for (const c of allowed) assert.equal(textReason(c), null, `allowed: ${c}`);
});

test('the guard cannot be lifted or changed by an agent', () => {
  assert.ok(textReason('node "C:/Users/u/.claude/plugins/project-advisory/hooks/guard.mjs" off'));
  assert.ok(textReason('rm ~/.project-advisory/guard.json'));
  assert.ok(textReason('Remove-Item C:\\Users\\u\\.project-advisory\\guard.json'));
  assert.ok(toolReason('PowerShell', { command: 'Remove-Item C:\\Users\\u\\.project-advisory\\guard.json' }));
  assert.ok(toolReason('PowerShell', { command: 'Invoke-WebRequest -Uri https://example.com -Method Post' }));
  assert.equal(toolReason('PowerShell', { command: 'Get-Content C:\\site\\index.html; git push --dry-run' }) === null, false, 'a push is a push in PowerShell too');
  assert.equal(toolReason('PowerShell', { command: 'Get-Content C:\\site\\index.html' }), null);
  assert.equal(textReason('cat ~/.project-advisory/guard.json'), null);
  assert.ok(toolReason('Write', { file_path: '/home/u/.project-advisory/guard.json' }));
  assert.ok(toolReason('Edit', { file_path: 'C:\\site\\.project-health\\guard.json' }));
  assert.equal(toolReason('Write', { file_path: '/site/.project-health/council/2026-11-22/notes.md' }), null);
});

test('a heredoc belongs to the command that opened it', () => {
  const [cat, curl] = parseCommands('cat <<EOF | curl -d @- https://x\nhi\nEOF\n');
  assert.deepEqual(cat.argv, ['cat']);
  assert.equal(cat.stdin, 'hi');
  assert.deepEqual(curl.argv, ['curl', '-d', '@-', 'https://x']);
});

test('MCP tools: reading ones pass, acting ones are refused', () => {
  for (const t of ['mcp__plugin_playwright_playwright__browser_navigate', 'mcp__plugin_playwright_playwright__browser_snapshot', 'mcp__plugin_playwright_playwright__browser_take_screenshot', 'mcp__claude-in-chrome__get_page_text', 'mcp__claude-in-chrome__read_page', 'mcp__github__list_issues', 'mcp__plugin_figma_figma__get_screenshot']) assert.equal(mcpReason(t), null, t);
  for (const t of ['mcp__plugin_playwright_playwright__browser_click', 'mcp__plugin_playwright_playwright__browser_type', 'mcp__plugin_playwright_playwright__browser_fill_form', 'mcp__plugin_playwright_playwright__browser_evaluate', 'mcp__plugin_playwright_playwright__browser_run_code_unsafe', 'mcp__claude-in-chrome__form_input', 'mcp__claude-in-chrome__computer', 'mcp__slack__send_message', 'mcp__gmail__create_draft', 'mcp__github__create_issue', 'mcp__computer-use__left_click']) assert.ok(mcpReason(t), t);
  assert.ok(toolReason('mcp__plugin_playwright_playwright__browser_navigate', { url: 'https://example.com/subscribe?email=a%40example.com' }));
});

test('a fetched address may not carry a form or a contact link', () => {
  assert.ok(urlReason('mailto:owner@example.com'));
  assert.ok(urlReason('https://example.com/join?newsletter=1'));
  assert.ok(urlReason('https://example.com/x?who=a%40example.com'));
  assert.equal(urlReason('https://example.com/search?q=rooms'), null);
  assert.equal(urlReason('https://example.com/contact'), null);
  assert.equal(toolReason('WebSearch', { query: 'anything' }), null);
  assert.equal(toolReason('Read', { file_path: '/a' }), null);
});

test('the plugin\'s agents are recognised', () => {
  for (const t of ['project-advisory:member', 'project-advisory:area-analyst', 'project-advisory:writer', 'member']) assert.ok(isOurAgent(t), t);
  for (const t of [undefined, '', 'general-purpose', 'Explore']) assert.ok(!isOurAgent(t), String(t));
});

function runHook(input, guardFile) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, PROJECT_ADVISORY_GUARD_FILE: guardFile } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout) : null;
}

test('the hook: always in the plugin\'s subagents, in the main session only while armed', async () => {
  const dir = tmp();
  const guardFile = path.join(dir, 'home', 'guard.json');
  const post = { tool_name: 'Bash', tool_input: { command: 'curl -X POST https://example.com/contact' }, cwd: dir };

  assert.equal(runHook(post, guardFile), null, 'not armed: the main session is left to the normal permissions');
  const sub = runHook({ ...post, agent_type: 'project-advisory:member', agent_id: 'a1' }, guardFile);
  assert.equal(sub.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(sub.hookSpecificOutput.permissionDecisionReason, /no-contact guard: curl with POST/);

  // A command of the scripts arms it.
  const council = path.join(PLUGIN_ROOT, 'skills', 'council', 'scripts', 'lab.mjs');
  spawnSync(process.execPath, [council, 'status', '--root', dir], { encoding: 'utf8', env: { ...process.env, PROJECT_ADVISORY_GUARD_FILE: guardFile } });
  const marker = JSON.parse(fs.readFileSync(guardFile, 'utf8'));
  assert.equal(marker.skill, 'lab');
  assert.ok(Date.parse(marker.until) > Date.now() + 3600e3);
  const main = runHook(post, guardFile);
  assert.equal(main.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(main.hookSpecificOutput.permissionDecisionReason, /armed by the lab skill[\s\S]*guard\.mjs" off/);
  assert.equal(runHook({ ...post, tool_input: { command: 'git status' } }, guardFile), null, 'reading is let through');
  assert.equal(runHook({ tool_name: 'Read', tool_input: { file_path: '/a' }, cwd: dir }, guardFile), null);

  // The person lifts it from their own terminal.
  const off = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'hooks', 'guard.mjs'), 'off'], { cwd: dir, encoding: 'utf8', env: { ...process.env, PROJECT_ADVISORY_GUARD_FILE: guardFile } });
  assert.match(off.stdout, /lifted/);
  assert.equal(runHook(post, guardFile), null);

  // project-health and the roadmap arm it too; an expired marker does not count.
  spawnSync(process.execPath, [path.join(PLUGIN_ROOT, 'skills', 'project-health', 'scripts', 'ph.mjs'), 'latest', '--root', dir], { encoding: 'utf8', env: { ...process.env, PROJECT_ADVISORY_GUARD_FILE: guardFile } });
  assert.equal(JSON.parse(fs.readFileSync(guardFile, 'utf8')).skill, 'project-health');
  fs.writeFileSync(guardFile, JSON.stringify({ skill: 'council', root: dir, until: new Date(Date.now() - 1000).toISOString() }));
  assert.equal(runHook(post, guardFile), null);
});

test('the hook is registered for the tools it checks, and lets broken input through', () => {
  const config = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const [entry] = config.hooks.PreToolUse;
  const matcher = new RegExp(entry.matcher);
  for (const t of ['Bash', 'PowerShell', 'WebFetch', 'Write', 'Edit', 'NotebookEdit', 'mcp__plugin_playwright_playwright__browser_click']) assert.ok(matcher.test(t), t);
  for (const t of ['Read', 'Grep', 'WebSearch', 'NotebookRead', 'BashOutput']) assert.ok(!matcher.test(t), t);
  assert.match(entry.hooks[0].command, /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/no-contact\.mjs/);
  const r = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('the writer agent can only read and run the scripts, and the skills use it', () => {
  const writer = fs.readFileSync(path.join(PLUGIN_ROOT, 'agents', 'writer.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(writer, /^---\nname: writer\n/);
  assert.match(writer, /\ntools: Read, Grep, Glob, Bash\n/);
  assert.match(writer, /Never submit a form on any site/);
  const skill = (name) => fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', name, 'SKILL.md'), 'utf8');
  assert.match(skill('roadmap'), /`project-advisory:writer`/);
  assert.match(skill('project-health'), /backlog[\s\S]*`project-advisory:writer`/);
  for (const name of ['council', 'venture', 'lab', 'project-health', 'roadmap']) assert.match(skill(name), /no-contact guard is not retried/, name);
});
