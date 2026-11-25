import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function browserCandidates(env = process.env, platform = process.platform) {
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    return roots.flatMap((r) => [
      path.win32.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.win32.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.win32.join(r, 'Chromium', 'Application', 'chrome.exe'),
    ]);
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge'];
}

export function findBrowser(env = process.env, platform = process.platform, exists = fs.existsSync) {
  // For hosts where printing must not be tried (and for tests): the documents are then written as HTML.
  if (env.COUNCIL_NO_BROWSER) return null;
  if (env.CHROME_PATH && exists(env.CHROME_PATH)) return env.CHROME_PATH;
  return browserCandidates(env, platform).find((p) => exists(p)) ?? null;
}

// Loads the page and returns its DOM after its scripts ran, for measurements a page writes into itself.
export function dumpDom(browser, htmlPath, { timeoutMs = 60000 } = {}) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-chrome-'));
  try {
    const r = spawnSync(browser, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${profileDir}`, '--dump-dom', '--virtual-time-budget=10000', pathToFileURL(htmlPath).href,
    ], { timeout: timeoutMs, stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
    return String(r.stdout ?? '');
  } finally {
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* browser may still hold files on Windows */ }
  }
}

export function printPdf(browser, htmlPath, pdfPath, { timeoutMs = 120000 } = {}) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-chrome-'));
  try {
    const r = spawnSync(browser, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${profileDir}`, '--no-pdf-header-footer', '--print-to-pdf-no-header',
      `--print-to-pdf=${pdfPath}`, '--virtual-time-budget=10000', pathToFileURL(htmlPath).href,
    ], { timeout: timeoutMs, stdio: 'pipe' });
    if (!fs.existsSync(pdfPath) || fs.statSync(pdfPath).size === 0) {
      throw new Error(`The browser did not produce a PDF (exit ${r.status ?? 'timeout'}). ${String(r.stderr ?? '').slice(0, 300)}`);
    }
  } finally {
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* browser may still hold files on Windows */ }
  }
}

// What a visitor sees: the page as a picture at one window size. Members read the site as text otherwise, and from
// text alone nobody can say that a site looks dated, crowded or as good as a rival's.
// Headless Chrome lays a page out at least 500 pixels wide: a narrower window crops the page instead of narrowing it,
// which would show a member a broken phone layout that does not exist. The narrow view is therefore 500 wide.
export const VIEWS = { desktop: [1440, 900], narrow: [500, 900], 'desktop-long': [1440, 3000] };

// The file name of a picture of a page, the same for the look command and the documents that show it.
export const lookSlug = (url) => { const u = new URL(url); return `${u.hostname}${u.pathname}`.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 80) || 'page'; };

export function screenshot(browser, url, file, [width, height], { timeoutMs = 60000 } = {}) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-chrome-'));
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) fs.rmSync(file);
    const r = spawnSync(browser, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
      `--user-data-dir=${profileDir}`, `--window-size=${width},${height}`, '--force-device-scale-factor=1',
      '--virtual-time-budget=8000', `--screenshot=${file}`, url,
    ], { timeout: timeoutMs, stdio: 'pipe' });
    if (!fs.existsSync(file) || fs.statSync(file).size === 0) throw new Error(`The browser took no picture of ${url} (exit ${r.status ?? 'timeout'}). ${String(r.stderr ?? '').slice(0, 300)}`);
    return file;
  } finally {
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* browser may still hold files on Windows */ }
  }
}

// The page count of a PDF printed by Chrome: the largest /Count is the root of the page tree.
export function pdfPageCount(file) {
  const text = fs.readFileSync(file).toString('latin1');
  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  return counts.length ? Math.max(...counts) : (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}
