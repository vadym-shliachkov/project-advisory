// What the no-contact hook refuses: a tool call that would submit a form, send a message or a post, notify someone or
// otherwise send something to a site. Reading is never refused: opening and fetching pages, searching, taking
// pictures, reading files and running the plugin's own scripts. The checks read a command the way a shell does
// (quotes, separators, heredocs, `sh -c`), so a search for the text "git push" is not a push. They are a guard, not a
// sandbox: a program written to a file and run later is not read.

const WRITE_METHOD = /^(post|put|patch|delete)$/i;
const OUR_SCRIPT = /(^|[\\/])(council|venture|lab|ph)\.mjs$/;
const GUARD_FILE = /(\.project-advisory|\.project-health)[\\/]+guard\.json/;
const CONTACT_SCHEME = /^['"]?(mailto|tel|sms|callto|sip|skype|whatsapp|tg|viber|facetime|msteams|slack|fb-messenger):/i;

// ---- Reading a command line ----------------------------------------------------------------------------------------

// Splits a command line into simple commands: { argv, stdin, subs } with quotes removed, heredoc bodies attached to
// the command they feed, and the text of every $( … ) and ` … ` kept in `subs` to be read as commands too.
export function parseCommands(text, { escapes = true } = {}) {
  const commands = [];
  const fresh = () => ({ argv: [], stdin: [], subs: [] });
  let cur = fresh(), tok = null, hereNext = false, pending = [];
  const push = () => {
    if (tok === null) return;
    if (hereNext) { cur.stdin.push(tok); hereNext = false; } else cur.argv.push(tok);
    tok = null;
  };
  const end = () => { push(); if (cur.argv.length || cur.stdin.length || cur.subs.length) commands.push(cur); cur = fresh(); };
  const add = (c) => { tok = (tok ?? '') + c; };
  const n = text.length;
  let i = 0;
  // i is just after an opening bracket; returns the text up to its matching close and moves past it.
  const readBalanced = (open, close) => {
    let depth = 1, q = null;
    const start = i;
    for (; i < n; i++) {
      const c = text[i];
      if (q) { if (c === q) q = null; else if (c === '\\' && q === '"') i++; continue; }
      if (c === "'" || c === '"') q = c;
      else if (c === open) depth++;
      else if (c === close && --depth === 0) { const inner = text.slice(start, i); i++; return inner; }
    }
    return text.slice(start);
  };
  const backtick = () => { const j = text.indexOf('`', i + 1); const inner = text.slice(i + 1, j < 0 ? n : j); cur.subs.push(inner); i = j < 0 ? n : j + 1; return inner; };
  while (i < n) {
    const c = text[i];
    if (c === '\n') {
      end(); i++;
      // The bodies of the heredocs opened on that line follow it, each fed to the command that opened it.
      for (const { delim, tabs, owner } of pending) {
        const body = [];
        while (i < n) {
          let j = text.indexOf('\n', i); if (j < 0) j = n;
          const line = text.slice(i, j); i = j + 1;
          if ((tabs ? line.replace(/^\t+/, '') : line).trim() === delim) break;
          body.push(line);
        }
        owner.stdin.push(body.join('\n'));
      }
      pending = [];
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') { push(); i++; continue; }
    if (escapes && c === '\\' && i + 1 < n) { if (text[i + 1] === '\n') { i += 2; continue; } add(text[i + 1]); i += 2; continue; }
    if (c === "'") { const j = text.indexOf("'", i + 1); add(text.slice(i + 1, j < 0 ? n : j)); i = j < 0 ? n : j + 1; continue; }
    if (c === '"') {
      i++; let s = '';
      while (i < n && text[i] !== '"') {
        if (escapes && text[i] === '\\' && i + 1 < n) { s += text[i + 1]; i += 2; continue; }
        if (text[i] === '$' && text[i + 1] === '(') { i += 2; const inner = readBalanced('(', ')'); cur.subs.push(inner); s += inner; continue; }
        if (text[i] === '`') { s += backtick(); continue; }
        s += text[i++];
      }
      i++; add(s); continue;
    }
    if (c === '$' && text[i + 1] === '(') { i += 2; const inner = readBalanced('(', ')'); cur.subs.push(inner); add(inner); continue; }
    if (c === '`') { add(backtick()); continue; }
    if (c === '<' && text[i + 1] === '<' && text[i + 2] === '<') { push(); hereNext = true; i += 3; continue; }
    if (c === '<' && text[i + 1] === '<') {
      push(); i += 2;
      let tabs = false;
      if (text[i] === '-') { tabs = true; i++; }
      while (text[i] === ' ') i++;
      let d = '';
      while (i < n && !/[\s;|&<>()]/.test(text[i])) d += text[i++];
      pending.push({ delim: d.replace(/^['"]|['"]$/g, ''), tabs, owner: cur });
      continue;
    }
    if ((c === '{' || c === '}') && tok !== null) { add(c); i++; continue; }
    if (';|&(){}'.includes(c)) { end(); i++; continue; }
    // A redirection (>, >>, 2>&1, <): its file is a word of the command, its descriptor is not.
    if ((c === '>' || c === '<') && (tok === null || /^\d+$/.test(tok))) { tok = null; i++; if (text[i] === '>' || text[i] === '&') i++; while (/\d/.test(text[i] ?? '')) i++; continue; }
    add(c); i++;
  }
  end();
  return commands.map((m) => ({ ...m, stdin: m.stdin.join('\n') }));
}

const base = (word) => word.replace(/^.*[\\/]/, '').replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();

// Skips what runs another command: environment assignments and wrappers like env, sudo, time, xargs, npx.
function unwrap(argv) {
  let a = [...argv];
  for (;;) {
    while (a.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(a[0])) a.shift();
    const b = a.length ? base(a[0]) : '';
    if (['env', 'sudo', 'nohup', 'time', 'command', 'exec', 'nice', 'stdbuf', 'npx', 'bunx', 'pnpx', 'call', '&'].includes(b)) {
      a.shift();
      while (a.length && (a[0].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(a[0]))) a.shift();
      continue;
    }
    if (b === 'timeout') { a.shift(); while (a.length && (a[0].startsWith('-') || /^\d/.test(a[0]))) a.shift(); continue; }
    if (b === 'xargs') { a.shift(); while (a.length && a[0].startsWith('-')) { const f = a.shift(); if (/^-[IEdLnPs]$/.test(f)) a.shift(); } continue; }
    return a;
  }
}

// ---- What a command may not do -------------------------------------------------------------------------------------

// Code an interpreter is given on its command line or on standard input.
const CODE_RULES = [
  [/\b(requests|httpx|session|client|axios|got|ky|superagent|needle|urllib3|aiohttp|\$http|http|https)\s*\.\s*(post|put|patch|delete)\s*\(/i, 'sends data to a site'],
  [/\bmethod\s*[:=]\s*['"`](post|put|patch|delete)['"`]/i, 'sends data to a site'],
  [/\.open\(\s*['"](post|put|patch|delete)['"]/i, 'sends data to a site'],
  [/\b(urlopen|Request)\s*\([^)]*\bdata\s*=/, 'sends data to a site'],
  [/\bsendBeacon\b|\bnew\s+FormData\b|\bURLSearchParams\b[^\n]*\bbody\b/, 'sends data to a site'],
  [/-Method\s+['"]?(post|put|patch|delete)\b|\bUpload(String|Data|Values|File)\b/i, 'sends data to a site'],
  [/\b(smtplib|nodemailer|SmtpClient|MailMessage|Send-MailMessage|sendgrid|mailgun|twilio|slack_sdk|Outlook\.Application)\b/i, 'sends a message'],
  [/hooks\.slack\.com|discord(app)?\.com\/api\/webhooks|api\.telegram\.org\/bot|api\.twilio\.com|gmail\.googleapis\.com|graph\.microsoft\.com\/\S*send/i, 'sends a message'],
];
const AUTOMATION = /\b(playwright|puppeteer|selenium|webdriver|chromium\.launch|firefox\.launch|webkit\.launch)\b/i;
const AUTOMATION_ACTS = /\.(fill|click|dblclick|submit|type|press|tap|check|selectOption|setInputFiles|sendKeys|send_keys|dispatchEvent|keyboard|mouse)\b/;

const INTERPRETERS = /^(node|nodejs|deno|bun|python\d*(\.\d+)?|py|pypy\d*|ruby|perl|php|osascript|jshell)$/;
const SHELLS = /^(bash|sh|zsh|dash|ksh|fish|cmd)$/;
const POWERSHELL = /^(pwsh|powershell)$/;

function codeOf(argv, stdin) {
  const b = base(argv[0]);
  const parts = [];
  for (let k = 1; k < argv.length; k++) {
    if (/^(-e|--eval|-p|--print|-c|-r|-x|eval)$/.test(argv[k]) && k + 1 < argv.length) parts.push(argv[++k]);
    else if (/^-(e|c|p)./.test(argv[k]) && !argv[k].startsWith('--')) parts.push(argv[k].slice(2));
  }
  if (b === 'deno' && argv[1] === 'eval') parts.push(argv.slice(2).join(' '));
  if (stdin) parts.push(stdin);
  return parts.join('\n');
}

export function codeReason(code) {
  if (!code) return null;
  for (const [re, why] of CODE_RULES) if (re.test(code)) return `the code it runs ${why}`;
  if (AUTOMATION.test(code) && AUTOMATION_ACTS.test(code)) return 'the code it runs drives a browser to click, type or submit';
  return null;
}

function curlReason(a) {
  for (let k = 1; k < a.length; k++) {
    const t = a[k];
    if (/^(-d|--data(-\w+)?|--json|-F|--form(-string)?|-T|--upload-file|--mail-rcpt|--mail-from)$/.test(t) || /^(-d|-F|-T).+/.test(t) || /^--(data(-\w+)?|json|form(-string)?|upload-file)=/.test(t)) return 'curl that sends data';
    if ((t === '-X' || t === '--request') && WRITE_METHOD.test(a[k + 1] ?? '')) return `curl with ${a[k + 1].toUpperCase()}`;
    if (/^-X(.+)$/.test(t) && WRITE_METHOD.test(t.slice(2))) return `curl with ${t.slice(2).toUpperCase()}`;
    if (/^--request=(.+)$/.test(t) && WRITE_METHOD.test(t.split('=')[1])) return 'curl with a method that sends data';
    if (/^smtps?:\/\//i.test(t)) return 'curl to a mail server';
    // PowerShell's curl and wget are Invoke-WebRequest.
    if (/^-(me|met|meth|metho|method)$/i.test(t) && WRITE_METHOD.test(a[k + 1] ?? '')) return 'a web request that sends data';
    if (/^-(body|infile|form)$/i.test(t)) return 'a web request that sends data';
  }
  return null;
}

function wgetReason(a) {
  for (let k = 1; k < a.length; k++) {
    const t = a[k];
    if (/^--(post-data|post-file|body-data|body-file)(=|$)/.test(t)) return 'wget that sends data';
    if (/^--method=/.test(t) && WRITE_METHOD.test(t.split('=')[1])) return 'wget with a method that sends data';
    if (t === '--method' && WRITE_METHOD.test(a[k + 1] ?? '')) return 'wget with a method that sends data';
    if (/^-(body|infile|form)$/i.test(t) || (/^-(me|met|meth|metho|method)$/i.test(t) && WRITE_METHOD.test(a[k + 1] ?? ''))) return 'a web request that sends data';
  }
  return null;
}

function webRequestReason(a) {
  for (let k = 1; k < a.length; k++) {
    const t = a[k];
    if (/^-(m|me|met|meth|metho|method)(:|$)/i.test(t)) {
      const v = t.includes(':') ? t.split(':')[1] : a[k + 1];
      if (WRITE_METHOD.test(v ?? '')) return 'a web request that sends data';
    }
    if (/^-(b|bo|bod|body|inf|infi|infil|infile|f|fo|for|form)(:|$)/i.test(t)) return 'a web request that sends data';
  }
  return null;
}

function gitReason(a) {
  let k = 1;
  while (k < a.length && a[k].startsWith('-')) { if (/^-(C|c)$|^--(git-dir|work-tree|namespace|exec-path)$/.test(a[k])) k++; k++; }
  const sub = a[k];
  if (['push', 'send-email', 'imap-send'].includes(sub)) return `git ${sub}`;
  return null;
}

const GH_READ = new Set(['list', 'view', 'status', 'diff', 'checks', 'clone', 'download', 'search', 'watch', 'logs', 'ls']);
const GH_GROUPS = new Set(['issue', 'pr', 'gist', 'release', 'discussion', 'repo', 'label', 'project', 'secret', 'variable', 'workflow', 'run', 'cache', 'ruleset', 'codespace', 'ssh-key', 'gpg-key', 'org', 'mr', 'snippet']);
function ghReason(a) {
  const tool = base(a[0]);
  const sub = a[1];
  if (sub === 'api') {
    for (let k = 2; k < a.length; k++) {
      const t = a[k];
      if ((t === '-X' || t === '--method') && !/^(get|head)$/i.test(a[k + 1] ?? '')) return `${tool} api with ${a[k + 1]}`;
      if (/^--method=/.test(t) && !/^(get|head)$/i.test(t.split('=')[1])) return `${tool} api with a method that changes something`;
      if (/^(-f|-F|--field|--raw-field|--input)(=|$)/.test(t) || /^-[fF].+/.test(t)) return `${tool} api with fields (it posts them)`;
    }
    return null;
  }
  if (GH_GROUPS.has(sub) && !GH_READ.has(a[2] ?? 'list')) return `${tool} ${sub} ${a[2]}`;
  return null;
}

// Finds why one simple command is refused, or null.
function commandReason({ argv, stdin, subs }, depth) {
  for (const s of subs) { const r = textReason(s, depth + 1); if (r) return r; }
  const a = unwrap(argv);
  if (!a.length) return null;
  const b = base(a[0]);
  const all = a.join(' ');

  // The guard itself: an agent may not lift it.
  if (b === 'node' && a.some((t) => /(^|[\\/])guard\.mjs$/.test(t)) && a.includes('off')) return 'it would lift the no-contact guard';
  if (GUARD_FILE.test(all) && !['cat', 'type', 'get-content', 'gc', 'head', 'tail', 'ls', 'dir', 'stat', 'test'].includes(b)) return 'it would change the no-contact guard';

  // The plugin's own scripts read and save session files; what they are given on standard input is the result of a
  // turn, which may quote anything.
  if (INTERPRETERS.test(b) && a.slice(1).some((t) => OUR_SCRIPT.test(t))) return null;

  if (b === 'curl') return curlReason(a);
  if (b === 'wget' || b === 'wget2') return wgetReason(a);
  if (['invoke-webrequest', 'invoke-restmethod', 'iwr', 'irm'].includes(b)) return webRequestReason(a);
  if (['send-mailmessage', 'sendmail', 'mail', 'mailx', 'mutt', 'neomutt', 'msmtp', 'swaks', 'ssmtp', 'blat', 'mpack'].includes(b)) return `${b} sends an email`;
  if (['nc', 'ncat', 'netcat', 'telnet', 'socat'].includes(b)) return `${b} opens a raw connection that can send anything`;
  if (b === 'git') return gitReason(a);
  if (b === 'gh' || b === 'glab' || b === 'hub') return ghReason(a);
  if (['http', 'https', 'xh', 'xhs'].includes(b) && (WRITE_METHOD.test(a[1] ?? '') || a.some((t) => /^(-f|--form|--raw)$/.test(t) || /^[^=:\s]+(:=|=@|=)[^=]/.test(t) && !t.includes('://')))) return `${b} that sends data`;
  if (['start', 'open', 'xdg-open', 'start-process', 'saps', 'explorer', 'rundll32', 'gio', 'wslview'].includes(b) && a.slice(1).some((t) => CONTACT_SCHEME.test(t))) return 'it opens a mail, phone or chat link';
  if (a.slice(1).some((t) => CONTACT_SCHEME.test(t)) && /^(chrome|msedge|firefox|brave|opera|safari|google-chrome.*|chromium.*)$/.test(b)) return 'it opens a mail, phone or chat link';

  if (SHELLS.test(b)) {
    for (let k = 1; k < a.length; k++) if (/^(-c|\/c|\/k|-lc|-ic)$/i.test(a[k]) && a[k + 1] != null) return textReason(a.slice(k + 1).join(' '), depth + 1);
    if (stdin) return textReason(stdin, depth + 1);
    return null;
  }
  if (POWERSHELL.test(b)) {
    if (a.some((t) => /^-(e|ec|en|enc|enco|encod|encode|encoded|encodedc\w*)$/i.test(t))) return 'an encoded PowerShell command, which cannot be read';
    for (let k = 1; k < a.length; k++) if (/^-(c|co|com|comm|comma|comman|command)$/i.test(a[k]) && a[k + 1] != null) return textReason(a.slice(k + 1).join(' '), depth + 1) ?? codeReason(a.slice(k + 1).join(' '));
    if (stdin) return textReason(stdin, depth + 1) ?? codeReason(stdin);
    return null;
  }
  if (INTERPRETERS.test(b)) return codeReason(codeOf(a, stdin));
  if (b === 'invoke-expression' || b === 'iex') return textReason(a.slice(1).join(' '), depth + 1);
  return null;
}

// Finds why a command line is refused, or null.
export function textReason(text, depth = 0, { escapes = true } = {}) {
  if (depth > 4 || !text) return null;
  // The guard's own files, however the path is written.
  if (GUARD_FILE.test(String(text)) && !/^\s*(cat|type|get-content|gc|head|tail|ls|dir|stat|test)\b/i.test(String(text))) return 'it would change the no-contact guard';
  for (const c of parseCommands(String(text), { escapes })) {
    const r = commandReason(c, depth);
    if (r) return r;
  }
  return null;
}

// ---- Tools ---------------------------------------------------------------------------------------------------------

// An MCP tool is let through only when its name says it reads: get, list, read, search, find, navigate, a snapshot or
// a screenshot. Anything that clicks, types, fills, uploads, sends, posts, creates or changes something is refused.
const READ_VERBS = new Set(['get', 'list', 'read', 'search', 'query', 'find', 'fetch', 'navigate', 'tabs', 'console', 'network', 'whoami', 'wait', 'resize', 'close', 'hover', 'scroll', 'emulate', 'describe', 'view', 'show', 'lookup', 'download', 'export', 'snapshot', 'screenshot', 'zoom', 'cursor', 'status', 'check', 'inspect', 'preview', 'resolve', 'count', 'summarize', 'fetch']);
export function mcpReason(name) {
  const tool = String(name).split('__').pop() ?? '';
  const words = tool.toLowerCase().split(/[_-]+/).filter(Boolean);
  if (words[0] === 'browser' || words[0] === 'page' || words[0] === 'tab') words.shift();
  if (words.some((w) => w === 'screenshot' || w === 'snapshot')) return null;
  if (words.length && READ_VERBS.has(words[0])) return null;
  return `the ${tool} tool acts rather than reads`;
}

// A page fetched with an address that carries someone's details or a sign-up is a form sent by its address.
export function urlReason(url) {
  const u = String(url ?? '');
  if (CONTACT_SCHEME.test(u)) return 'it opens a mail, phone or chat link';
  const query = u.split('?')[1] ?? '';
  if (/(^|&)(e-?mail|email_?address|phone|tel|mobile|message|comment|subscribe|newsletter|signup|sign_up|contact)=/i.test(query)) return 'its address carries form fields (a GET form being sent)';
  if (/[^=&]+=[^&]*(%40|@)[^&]*\.[a-z]{2,}/i.test(query)) return 'its address carries an email address';
  return null;
}

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

// Decides one tool call: the reason it is refused, or null to let it through.
export function toolReason(name, input = {}) {
  if (name === 'Bash') return textReason(input.command);
  // In PowerShell a backslash is part of a path, not an escape.
  if (name === 'PowerShell') return textReason(input.command, 0, { escapes: false });
  if (name === 'WebFetch') return urlReason(input.url);
  if (FILE_TOOLS.has(name)) return GUARD_FILE.test(String(input.file_path ?? input.notebook_path ?? '')) ? 'it would change the no-contact guard' : null;
  if (String(name).startsWith('mcp__')) {
    const r = mcpReason(name);
    if (r) return r;
    // A reading tool still may not be pointed at a contact link or a form's address.
    return input.url ? urlReason(input.url) : null;
  }
  return null;
}

// The plugin's own subagents are guarded always; a plugin agent arrives as "project-advisory:<name>".
export const OUR_AGENTS = ['member', 'area-analyst', 'writer'];
export const isOurAgent = (type) => {
  const t = String(type ?? '');
  return t.startsWith('project-advisory:') || OUR_AGENTS.includes(t);
};
