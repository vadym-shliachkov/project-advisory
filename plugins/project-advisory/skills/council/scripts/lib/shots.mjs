import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

// Pictures of the part of a page an idea is about: the block found on the page, with an outline drawn around it and a
// little of what surrounds it, so a reader recognises the place without remembering the site. The browser is driven
// through the DevTools protocol (Node 22 has WebSocket built in), so nothing is installed. A part that cannot be found
// is said to be missing; the first screen of the page is then shown instead, and the caption says so.

const WIDTH = 1440;
const HEIGHT = 900;
const MARGIN = 72;
const MAX_HEIGHT = 1500;

// The script run in the page: finds the part by selector, then by its words, and returns where it is.
const FIND = (selector, text) => `(() => {
  const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const want = norm(${JSON.stringify(text ?? '')});
  // Cookie and chat banners cover what the picture is about.
  for (const el of document.querySelectorAll('body *')) {
    const st = getComputedStyle(el);
    if ((st.position === 'fixed' || st.position === 'sticky') && /cookie|consent|gdpr|chat|hubspot-messages/i.test((el.id || '') + ' ' + (el.className && el.className.baseVal === undefined ? el.className : '') + ' ' + (el.textContent || '').slice(0, 200)) && el.getBoundingClientRect().top > 100) el.style.setProperty('display', 'none', 'important');
  }
  let el = null;
  let how = null;
  ${selector ? `try { el = document.querySelector(${JSON.stringify(selector)}); if (el) how = 'selector'; } catch (e) {}` : ''}
  if (!el && want) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let best = null;
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(n.tagName)) continue;
      const r = n.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (norm(n.innerText).includes(want) && (!best || norm(n.innerText).length <= norm(best.innerText).length)) best = n;
    }
    if (best) { el = best; how = 'text'; }
    // A heading or a line alone is too small to recognise: take the section it opens when that fits in one picture,
    // else the nearest block of a readable size.
    const section = el && el.closest('section, article, form, aside, footer, [role=region], [class*=section i]');
    const fits = (n) => n && n !== document.body && n.getBoundingClientRect().height <= ${MAX_HEIGHT - 2 * MARGIN};
    if (fits(section)) el = section;
    else while (el && el.parentElement && el.parentElement !== document.body && el.getBoundingClientRect().height < 160) el = el.parentElement;
  }
  if (!el) return { found: false, docHeight: document.documentElement.scrollHeight };
  const r = el.getBoundingClientRect();
  return { found: true, how, top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height, docHeight: document.documentElement.scrollHeight };
})()`;

const OUTLINE = (box) => `(() => {
  const o = document.createElement('div');
  o.setAttribute('data-council-outline', '');
  Object.assign(o.style, { position: 'absolute', zIndex: 2147483647, pointerEvents: 'none', boxSizing: 'border-box',
    left: '${Math.max(0, box.left - 6)}px', top: '${Math.max(0, box.top - 6)}px', width: '${Math.min(box.width + 12, WIDTH - Math.max(0, box.left - 6))}px', height: '${box.height + 12}px',
    border: '4px solid #e4572e', borderRadius: '6px', boxShadow: '0 0 0 9999px rgba(255,255,255,0.18)' });
  document.body.appendChild(o);
  return true;
})()`;

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.waiters = [];
    ws.addEventListener('message', (m) => {
      const msg = JSON.parse(typeof m.data === 'string' ? m.data : Buffer.from(m.data).toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { ok, fail } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) fail(new Error(msg.error.message)); else ok(msg.result);
      } else if (msg.method) {
        this.waiters = this.waiters.filter((w) => !(w.method === msg.method && w.sessionId === msg.sessionId && (w.ok(msg.params), true)));
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((ok, fail) => this.pending.set(id, { ok, fail }));
  }
  once(method, sessionId, ms) {
    return Promise.race([new Promise((ok) => this.waiters.push({ method, sessionId, ok })), wait(ms).then(() => null)]);
  }
}

async function devtoolsUrl(profileDir, child, ms = 20000) {
  const file = path.join(profileDir, 'DevToolsActivePort');
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`The browser stopped before it could be driven (exit ${child.exitCode})`);
    if (fs.existsSync(file)) {
      const [port, rest] = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      if (port && rest) return `ws://127.0.0.1:${port}${rest}`;
    }
    await wait(100);
  }
  throw new Error('The browser did not open its DevTools port in time');
}

// Photographs every part asked for, page by page. `jobs` is [{ url, parts: [{ key, selector, text, file }] }].
// Returns one result per part: { key, file, found, how } or { key, error }.
export async function shootParts(browser, jobs, { pageTimeoutMs = 45000, settleMs = 1500 } = {}) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-shots-'));
  const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, 'about:blank'], { stdio: 'ignore' });
  const results = [];
  let ws;
  try {
    ws = new WebSocket(await devtoolsUrl(profileDir, child));
    await new Promise((ok, fail) => { ws.addEventListener('open', ok, { once: true }); ws.addEventListener('error', () => fail(new Error('Could not connect to the browser')), { once: true }); });
    const cdp = new Cdp(ws);
    for (const job of jobs) {
      for (const part of job.parts) {
        let targetId;
        try {
          ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }));
          const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
          const s = (m, p) => cdp.send(m, p, sessionId);
          await s('Page.enable');
          await s('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
          const loaded = cdp.once('Page.loadEventFired', sessionId, pageTimeoutMs);
          await s('Page.navigate', { url: job.url });
          await loaded;
          await wait(settleMs);
          const evaluate = async (expression) => { const r = await s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(`The page script failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`); return r.result.value; };
          let box = await evaluate(FIND(part.selector, part.text));
          if (box?.found) {
            // Content that appears on scroll is made to appear: scroll past the part and back, then measure again.
            await evaluate(`window.scrollTo(0, ${Math.max(0, box.top - MARGIN)}); true`);
            await wait(900);
            await evaluate('window.scrollTo(0, 0); true');
            await wait(300);
            box = await evaluate(FIND(part.selector, part.text));
          }
          let clip;
          if (box?.found) {
            await evaluate(OUTLINE(box));
            const y = Math.max(0, box.top - MARGIN);
            clip = { x: 0, y, width: WIDTH, height: Math.min(MAX_HEIGHT, Math.max(360, box.height + 2 * MARGIN), box.docHeight - y), scale: 1 };
          } else {
            clip = { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 };
          }
          const { data } = await s('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
          fs.mkdirSync(path.dirname(part.file), { recursive: true });
          fs.writeFileSync(part.file, Buffer.from(data, 'base64'));
          results.push({ key: part.key, file: part.file, found: Boolean(box?.found), how: box?.how ?? null });
        } catch (e) {
          results.push({ key: part.key, error: String(e.message ?? e) });
        } finally {
          if (targetId) await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
        }
      }
    }
  } finally {
    try { ws?.close(); } catch { /* already closed */ }
    child.kill();
    await wait(300);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* browser may still hold files on Windows */ }
  }
  return results;
}
