import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function summarizeLighthouse(report) {
  const audits = report.audits ?? {};
  const metric = (id) => (audits[id]
    ? { value: audits[id].numericValue ?? null, display: audits[id].displayValue ?? null, score: audits[id].score ?? null }
    : null);
  return {
    categories: Object.fromEntries(Object.entries(report.categories ?? {}).map(([k, c]) => [k, c.score == null ? null : Math.round(c.score * 100)])),
    metrics: {
      lcp: metric('largest-contentful-paint'),
      cls: metric('cumulative-layout-shift'),
      tbt: metric('total-blocking-time'),
      fcp: metric('first-contentful-paint'),
      speedIndex: metric('speed-index'),
    },
    failedAudits: Object.values(audits)
      .filter((a) => (a.scoreDisplayMode === 'numeric' && a.score !== null && a.score < 0.5) || (a.scoreDisplayMode === 'binary' && a.score === 0))
      .map((a) => ({ id: a.id, title: a.title, display: a.displayValue ?? null }))
      .slice(0, 40),
  };
}

export function lighthouseCommand(url, outPath, platform = process.platform) {
  const args = [
    '--yes', 'lighthouse@12', url,
    '--output=json', `--output-path=${outPath}`, '--quiet',
    '--only-categories=performance,seo,best-practices', '--form-factor=mobile',
    '--chrome-flags=--headless=new',
  ];
  if (platform !== 'win32') return { command: 'npx', args, shell: false };
  const quoted = args.map((arg) => {
    if (/["%\r\n]/.test(arg)) throw new Error(`Unsafe character for the Windows shell in argument: ${arg}`);
    return `"${arg}"`;
  });
  // The command name stays unquoted: started by a quoted name, npx.cmd looks for its own files in the current folder.
  return { command: ['npx', ...quoted].join(' '), args: [], shell: true };
}

export function runLighthouse(url, { browser = null, timeoutMs = 240000 } = {}) {
  const out = path.join(os.tmpdir(), `ph-lighthouse-${process.pid}-${Date.now()}.json`);
  const cmd = lighthouseCommand(url, out);
  const r = spawnSync(cmd.command, cmd.args, {
    shell: cmd.shell,
    timeout: timeoutMs,
    encoding: 'utf8',
    env: browser ? { ...process.env, CHROME_PATH: browser } : process.env,
  });
  if (r.error?.code === 'ETIMEDOUT') throw new Error(`lighthouse timed out after ${timeoutMs} ms`);
  if (r.error) throw new Error(`lighthouse could not start: ${r.error.message}`);
  if (r.status !== 0 || !fs.existsSync(out)) {
    throw new Error(`lighthouse exited with ${r.status}: ${String(r.stderr ?? '').slice(0, 300)}`);
  }
  try {
    return summarizeLighthouse(JSON.parse(fs.readFileSync(out, 'utf8')));
  } finally {
    fs.rmSync(out, { force: true });
  }
}
