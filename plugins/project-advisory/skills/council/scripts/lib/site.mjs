import fs from 'node:fs';
import path from 'node:path';
import { projectDir } from './paths.mjs';
import { today } from './bank.mjs';
import { loadIdeas } from './ideas.mjs';
import { brandOf, shownSource } from './documents.mjs';
import { ATTACK_KINDS } from './record.mjs';
import { esc, rich, paras, page, css, readerText, stamp, tag, table, evidenceText, sourceLink, methodSection, ideaArticle, chapterHtml, whereBlock, longDate, roman, STRENGTH_NOTE, SCALE_NOTE } from './html.mjs';
import { briefSections, namer, ideaTags, killedRows, labelOf } from './brief.mjs';
import { betArticle, originLine } from './labdoc.mjs';
import { loadCards } from './lab.mjs';

// The session as linked pages, in `<session>/site/`: the brief and a table of every idea on the first page, one page
// per idea (the full write-up of a survivor, the analysis of a killed idea, the plain record of its debate and the
// evidence it rests on), the chapters of the discussion, every piece of evidence, and the method. The pages are plain
// files: they open from disk, load nothing from the web, and link the pictures already in the session folder. Beside
// the sessions, `.project-health/ideas.html` lists every idea of every session with its history.

const SITE = 'site';
const write = (file, html) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, html); };
const ideaFile = (idea) => `ideas/${idea.id}.html`;

// What each kind of statement is called on the plain record of a debate.
const STATEMENT = {
  hypothesis: () => 'Proposed',
  steelman: () => 'Restated at its strongest',
  'steelman-reply': (s) => (s.accepts ? 'The restatement accepted' : 'The restatement corrected'),
  attack: (s) => `Attack: ${ATTACK_KINDS[s.kind] ?? s.kind}`,
  client: (s) => `The customer's voice: ${({ yes: 'would care', no: 'would not care', unsure: 'not sure a customer would care' })[s.cares] ?? s.cares}`,
  reply: (s) => `Reply: ${({ refute: 'refuted', narrow: 'narrowed the idea', concede: 'conceded' })[s.stance] ?? s.stance}`,
  question: (s) => `Question for ${s.for === 'data' ? 'the data' : 'the person'}`,
  ruling: (s) => `Ruling: ${({ survived: 'survived', narrowed: 'survived in a smaller form', killed: 'killed', undecided: 'undecided' })[s.verdict] ?? s.verdict}`,
  'set-note': () => 'Note on the survivors as a set',
};
const HYPOTHESIS_LABELS = [['change', 'Change'], ['effect', 'Effect'], ['because', 'Because'], ['trigger', 'What was seen'], ['killCondition', 'Drop it if']];

function nav(up, current, { discussion }) {
  const items = [['index.html', 'Brief'], ['index.html#all', 'All ideas'], ...(discussion ? [['discussion/index.html', 'Discussion']] : []), ['evidence.html', 'Evidence'], ['method.html', 'Method'], ['../../../ideas.html', 'Every session']];
  return `<nav class="site-nav" aria-label="Session pages"><ul>${items.map(([href, label]) => `<li><a href="${up}${href}"${href === current ? ' aria-current="page"' : ''}>${esc(label)}</a></li>`).join('')}</ul></nav>`;
}

// Evidence and idea ids in the words of the debate become links: on these pages the reader can look them up.
function linked(text, { up, evidenceIds, threadPage }) {
  return rich(text)
    .replace(/\bE(\d{1,4})\b/g, (m) => (evidenceIds.has(m) ? `<a href="${up}evidence.html#${m}">${m}</a>` : m))
    .replace(/\bT(\d{1,3})\b/g, (m) => (threadPage(m) ? `<a href="${up}${threadPage(m)}">${m}</a>` : m));
}

export function buildSite({ ctx, root, frame = null, model, suggestions, discussion = null, picture = () => null, parts = () => [] }) {
  const { dir, session, evidence } = ctx;
  const out = path.join(dir, SITE);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'style.css'), `${css('document.css')}\n${css('site.css')}`);

  const chapters = (discussion?.chapters ?? []).filter((c) => model.ideas.some((i) => i.thread === c.thread));
  const chapterNo = (thread) => { const at = chapters.findIndex((c) => c.thread === thread); return at >= 0 ? at + 1 : null; };
  const evidenceIds = new Set(evidence.entries.map((e) => e.id));
  const pageOfThread = (id) => { const idea = model.ideas.find((i) => i.thread === id); return idea ? ideaFile(idea) : null; };
  const plain = namer(model);
  const written = new Map((suggestions?.survivors ?? []).map((s) => [s.idea, s]));
  const dead = new Map((suggestions?.killed ?? []).map((k) => [k.idea, k]));
  const betText = new Map((suggestions?.bets ?? []).map((b) => [b.idea, b]));
  const numberOf = new Map(model.survivors.map((idea, i) => [idea.id, i + 1]));
  const seatOf = (role) => model.cast.find((s) => s.role === role)?.title ?? ({ judge: 'The judge', primer: 'The domain primer', horizon: 'The horizon scan', 'project-health': 'The health check', roadmap: 'The roadmap' })[role] ?? role;
  // Pictures live in the session folder, one level above the site.
  const fromSession = (up, rel) => (rel ? `${up}../${rel}` : rel);
  const partsAt = (up) => (thread) => parts(thread).map((p) => ({ ...p, file: fromSession(up, p.file) }));
  const pictureAt = (up) => (url) => { const pic = picture(url); return pic ? { ...pic, src: fromSession(up, pic.src) } : null; };
  const label = labelOf(model);
  const cards = model.session.kind === 'lab' ? loadCards() : [];
  const shell = (up, current, title, body, kind = 'site') => page({ title: `${title} · ${label} ${session.id}`, bandTitle: title, kind, model, body, stylesheet: `${up}style.css`, nav: nav(up, current, { discussion: chapters.length }) });
  const files = [];
  const put = (rel, html) => { write(path.join(out, rel), html); files.push(rel); };

  // ---- The first page: the brief, then every idea in one table ----
  const VERDICTS = ['survived', 'narrowed', 'killed', 'undecided'];
  const VERDICT_WORD = { survived: 'Survived', narrowed: 'Survived, smaller', killed: 'Killed', undecided: 'Undecided' };
  const rows = model.ideas.map((idea) => `<tr data-verdict="${esc(idea.verdict)}" data-scale="${esc(idea.scale ?? '')}">
<td class="no" data-sort="${numberOf.get(idea.id) ?? 999}">${numberOf.get(idea.id) ?? ''}</td>
<td data-sort="${esc(plain(idea.title).toLowerCase())}"><a class="idea-link" href="${ideaFile(idea)}">${esc(plain(idea.title))}</a><span class="sub">From the seat of ${esc(seatOf(idea.proposerRole))}</span></td>
<td data-sort="${VERDICTS.indexOf(idea.verdict)}">${stamp(idea.verdict)}</td>
<td data-sort="${esc(idea.scale ?? '')}">${esc(idea.scale ?? '')}</td>
<td data-sort="${['strong', 'fair', 'speculative'].indexOf(idea.strength)}">${idea.strength ? tag(idea.strength, idea.strength) : '<span class="meta">none</span>'}</td>
<td data-sort="${['small', 'medium', 'large'].indexOf(idea.effort)}">${esc(idea.effort)}</td>
<td data-sort="${idea.novelty === 'fresh' ? 0 : 1}">${idea.novelty === 'fresh' ? tag('fresh', 'fresh') : esc(idea.novelty ?? '')}</td>
</tr>`);
  const head = [['No.', 'number'], ['Idea', 'text'], ['Verdict', 'number'], ['Scale', 'text'], ['Support', 'number'], ['Effort', 'number'], ['Fresh', 'number']];
  const options = (values, word) => values.map((v) => `<option value="${esc(v)}">${esc(word(v))}</option>`).join('');
  const scales = [...new Set(model.ideas.map((i) => i.scale).filter(Boolean))];
  const all = `<section class="b-part" id="all"><h2>Every idea the council looked at</h2>
<p class="lead">Open an idea for its full write-up, the plain record of its debate and the evidence it rests on.</p>
<form class="filters" role="search" aria-label="Filter the ideas" onsubmit="return false">
<label for="f-verdict">Verdict<select id="f-verdict"><option value="">All</option>${options(VERDICTS.filter((v) => model.ideas.some((i) => i.verdict === v)), (v) => VERDICT_WORD[v])}</select></label>
${scales.length ? `<label for="f-scale">Scale<select id="f-scale"><option value="">All</option>${options(scales, (v) => v)}</select></label>` : ''}
<label for="f-text">Words in the title<input id="f-text" type="search" autocomplete="off"></label>
<output id="f-count" role="status" aria-live="polite">${model.ideas.length} ideas shown</output>
</form>
<div class="table-box"><table class="all-ideas"><caption>All ${model.ideas.length} ideas debated in this session. Select a column heading to sort.</caption>
<thead><tr>${head.map(([h, type]) => `<th scope="col" data-type="${type}"><button type="button">${esc(h)}</button></th>`).join('')}</tr></thead>
<tbody>${rows.join('\n')}</tbody></table></div>
${model.refused.length || model.merged.length ? `<h3>Not debated</h3>${table('refused', ['Idea', 'Why'], [...model.refused.map((x) => `<tr><td>${esc(x.title)}</td><td>${rich(x.reason)}</td></tr>`), ...model.merged.map((x) => `<tr><td>${esc(x.title)}</td><td>The same idea as “${esc(x.into)}”, and debated with it.</td></tr>`)])}` : ''}
</section>
<script>
(() => {
  const body = document.querySelector('table.all-ideas tbody');
  const rows = [...body.rows];
  const verdict = document.getElementById('f-verdict');
  const scale = document.getElementById('f-scale');
  const words = document.getElementById('f-text');
  const count = document.getElementById('f-count');
  const filter = () => {
    const v = verdict.value, s = scale ? scale.value : '', w = words.value.trim().toLowerCase();
    let shown = 0;
    for (const r of rows) {
      const ok = (!v || r.dataset.verdict === v) && (!s || r.dataset.scale === s) && (!w || r.cells[1].textContent.toLowerCase().includes(w));
      r.hidden = !ok;
      if (ok) shown += 1;
    }
    count.textContent = shown + (shown === 1 ? ' idea shown' : ' ideas shown');
  };
  for (const el of [verdict, scale, words]) if (el) el.addEventListener('input', filter);
  document.querySelectorAll('table.all-ideas th').forEach((th, col) => {
    th.querySelector('button').addEventListener('click', () => {
      const asc = th.getAttribute('aria-sort') !== 'ascending';
      document.querySelectorAll('table.all-ideas th').forEach((x) => x.removeAttribute('aria-sort'));
      th.setAttribute('aria-sort', asc ? 'ascending' : 'descending');
      const key = (r) => r.cells[col].dataset.sort ?? r.cells[col].textContent;
      const number = th.dataset.type === 'number';
      rows.sort((a, b) => { const x = key(a), y = key(b); const d = number ? Number(x) - Number(y) : x.localeCompare(y); return asc ? d : -d; });
      for (const r of rows) body.appendChild(r);
    });
  });
})();
</script>`;
  put('index.html', shell('', 'index.html', `${label} · Decision brief`, briefSections({ model, suggestions: suggestions ?? {}, ideaHref: ideaFile, more: all }), 'site decision-brief'));

  // ---- One page per idea ----
  model.ideas.forEach((idea, at) => {
    const up = '../';
    const n = chapterNo(idea.thread);
    const debate = n ? `<p><a href="${up}discussion/${n}.html">Chapter ${roman(n)} of the discussion</a> tells the debate on this idea as a conversation; the plain record of what was said is below.</p>` : '';
    let body;
    if (written.has(idea.id) && idea.bet) {
      body = betArticle(idea, written.get(idea.id), numberOf.get(idea.id), { frame, cards, parts: partsAt(up), plain });
    } else if (written.has(idea.id)) {
      body = ideaArticle(model, idea, written.get(idea.id), numberOf.get(idea.id), n, plain, pictureAt(up), partsAt(up));
      const s = written.get(idea.id);
      if (s.upside) body = body.replace('<dl class="decide">', `<dl class="decide"><div><dt>If it works</dt><dd><p>${rich(s.upside)}</p></dd></div>`);
    } else {
      const h = idea.originalHypothesis;
      const b = betText.get(idea.id);
      const fate = idea.verdict === 'killed' ? killedRows(idea, dead.get(idea.id), plain) : `<div><dt>What would decide it</dt><dd><p>${rich(plain(idea.ruling.wouldDecide))}</p></dd></div>`;
      const places = partsAt(up)(idea.thread);
      body = `<article class="idea">
<header class="idea-page-head"><h2>${esc(plain(idea.originalTitle))} ${stamp(idea.verdict)}</h2><p class="tags">${ideaTags(idea)}</p></header>
<p class="lede">${rich(b?.sentence ?? h.change)}</p>
${whereBlock(places.length ? places : (idea.where ?? []).map((w) => ({ ...w, file: null })))}
<dl class="decide">${b ? `<div><dt>Worth trying if</dt><dd><p>${rich(b.worthIt)}</p></dd></div>` : ''}${fate}</dl>
${idea.bet ? `<p class="meta">${esc(originLine(idea, frame, cards))}</p>` : ''}
<h4 class="case">As it was proposed</h4>
<dl class="decide">${HYPOTHESIS_LABELS.filter(([k]) => h[k]).map(([k, label]) => `<div><dt>${esc(label)}</dt><dd><p>${rich(h[k])}</p></dd></div>`).join('')}</dl>
</article>`;
    }
    const pa = idea.priorArt;
    const prior = pa ? `<section class="prior-art"><h3>Looked for elsewhere first</h3>
<p><b>${esc({ yes: 'It exists already', partly: 'Something close exists', no: 'Nothing like it was found' }[pa.exists] ?? pa.exists)}.</b>${pa.who ? ` ${rich(pa.who)}.` : ''}${pa.outcome ? ` ${rich(pa.outcome)}` : ''}</p>
${pa.difference ? `<p><b>How this differs:</b> ${rich(pa.difference)}</p>` : ''}
<p class="meta">How it was looked for: ${rich(pa.searched)}</p></section>` : '';
    const opts = { up, evidenceIds, threadPage: pageOfThread };
    const record = [...idea.statements].sort((a, b) => a.n - b.n).map((s) => {
      const what = (STATEMENT[s.type] ?? (() => s.type))(s);
      const by = s.type === 'ruling' ? 'The judge' : seatOf(s.by);
      const text = s.type === 'hypothesis'
        ? `<dl class="hyp">${HYPOTHESIS_LABELS.filter(([k]) => s.hypothesis?.[k]).map(([k, label]) => `<dt>${esc(label)}</dt><dd>${linked(s.hypothesis[k], opts)}</dd>`).join('')}</dl>`
        : `<p class="said">${linked(s.text, opts)}</p>${s.narrowed ? `<p class="said"><b>Narrowed to:</b> ${linked(s.narrowed.change, opts)} ${linked(s.narrowed.effect, opts)}</p>` : ''}`;
      const cites = (s.evidence ?? []).length ? `<p class="cites">Evidence: ${s.evidence.map((id) => (evidenceIds.has(id) ? `<a href="${up}evidence.html#${esc(id)}">${esc(id)}</a>` : esc(id))).join(', ')}</p>` : '';
      return `<li class="record-${esc(s.type)}" id="s${s.n}"><p class="what"><b>${esc(by)}</b> · ${esc(what)}${s.round ? ` · round ${s.round}` : ''}</p>${text}${cites}</li>`;
    }).join('\n');
    const cited = idea.evidence.length ? `<section><h3>The evidence it rests on</h3><ul class="ev-list">${idea.evidence.map((e) => `<li><a href="${up}evidence.html#${esc(e.id)}">${esc(e.id)}</a> ${esc(evidenceText(e))} <span class="ev-src">${esc(e.grade)}${e.source ? ` · ${sourceLink(e.source)}` : ''}</span></li>`).join('')}</ul></section>` : '';
    const prev = model.ideas[at - 1];
    const next = model.ideas[at + 1];
    const pager = `<nav class="pager" aria-label="Ideas">${prev ? `<a href="${prev.id}.html" rel="prev">Previous: ${esc(plain(prev.title))}</a>` : '<span></span>'}${next ? `<a href="${next.id}.html" rel="next">Next: ${esc(plain(next.title))}</a>` : ''}</nav>`;
    const html = `<p class="crumb"><a href="${up}index.html#all">Every idea</a> · idea ${esc(idea.id.slice(1))} in the ledger</p>
${body}
${prior}
<section><h3>How it was argued</h3>${debate}<ol class="record">${record}</ol></section>
${cited}
${pager}`;
    put(ideaFile(idea), shell(up, null, plain(idea.title), html, 'site suggestions'));
  });

  // ---- The discussion ----
  if (chapters.length) {
    const up = '../';
    const used = new Set();
    // In the minutes an idea is "chapter IV", as in the printed discussion.
    const chapterPlain = (text) => readerText(text, (id) => { const at = chapters.findIndex((c) => c.thread === id); return at >= 0 ? `chapter ${roman(at + 1)}` : null; });
    const list = chapters.map((c, i) => { const idea = model.ideas.find((x) => x.thread === c.thread); return `<tr><td class="no">${roman(i + 1)}</td><td><a class="idea-link" href="${i + 1}.html">${esc(idea.originalTitle)}</a><span class="sub">${rich(c.line)}</span></td><td>${stamp(idea.verdict)}</td></tr>`; });
    put('discussion/index.html', shell(up, 'discussion/index.html', `${label} · The discussion`, `<section class="glance">
<p class="eyebrow">Minutes of the library</p>
<h2 class="evening">${esc(discussion.title)}</h2>
<p class="goal-line"><b>The question before the house:</b> ${esc(model.session.goal)}</p>
<div class="opening">${paras(discussion.opening)}</div>
<p class="note">These minutes are an edit of the record of a council session. The characters are invented; what they say is what was said from their seat. Each idea's own page has the plain record.</p>
</section>
<section class="b-part"><h2>The chapters</h2>${table('brief-table', ['Chapter', 'The idea', 'Verdict'], list)}</section>
<section class="b-part"><h2>The house rises</h2><div class="opening">${paras(discussion.closing)}</div></section>`, 'site discussion'));
    chapters.forEach((c, i) => {
      const idea = model.ideas.find((x) => x.thread === c.thread);
      const html = chapterHtml(model, c, i + 1, used, chapterPlain, partsAt(up))
        .replace(/<p class="cites">Evidence: ([^<]+)<\/p>/g, (m, ids) => `<p class="cites">Evidence: ${ids.split(/,\s*/).map((id) => (evidenceIds.has(id) ? `<a href="${up}evidence.html#${id}">${id}</a>` : id)).join(', ')}</p>`);
      const pager = `<nav class="pager" aria-label="Chapters">${i ? `<a href="${i}.html" rel="prev">Chapter ${roman(i)}</a>` : '<a href="index.html">The opening</a>'}${chapters[i + 1] ? `<a href="${i + 2}.html" rel="next">Chapter ${roman(i + 2)}</a>` : '<a href="index.html">The house rises</a>'}</nav>`;
      put(`discussion/${i + 1}.html`, shell(up, null, `Chapter ${roman(i + 1)}`, `<p class="crumb"><a href="${up}${ideaFile(idea)}">This idea's own page</a>: its write-up, the plain record and the evidence.</p>\n${html}\n${pager}`, 'site discussion'));
    });
  }

  // ---- Every piece of evidence ----
  const evRows = evidence.entries.map((e) => `<tr id="${esc(e.id)}"><td class="ev-id">${esc(e.id)}</td><td>${esc(evidenceText(e))}${e.reusedFrom ? `<span class="sub">Reused from ${esc(e.reusedFrom)}</span>` : ''}</td><td class="ev-src">${esc(e.grade)} · ${esc(seatOf(e.by))}${e.date ? ` · ${esc(e.date)}` : ''}${e.source ? `<br>${sourceLink(shownSource(e.source, root, session.data))}` : ''}</td></tr>`);
  put('evidence.html', shell('', 'evidence.html', `${label} · Evidence`, `<section class="b-part"><h2>The evidence</h2>
<p class="lead">Everything the members could cite, by its number. Measured: a number from shared data. Observed: seen on the site, in the project, at a competitor or in a dated public source. Argued: reasoning, with no source.</p>
<div class="table-box">${table('evidence-table', ['No.', 'What was seen or measured', 'Grade, who, source'], evRows)}</div></section>`, 'site discussion'));

  // ---- The method ----
  const key = `<h4>How well an idea is supported</h4>${table('key', ['Support', 'What it means'], Object.entries(STRENGTH_NOTE).map(([k, v]) => `<tr><td>${tag(k, k)}</td><td>${esc(v)}</td></tr>`))}
<h4>How far an idea reaches</h4>${table('key', ['Scale', 'What it means'], Object.entries(SCALE_NOTE).map(([k, v]) => `<tr><td>${tag(k, `scale-${k}`)}</td><td>${esc(v)}</td></tr>`))}`;
  put('method.html', shell('', 'method.html', `${label} · Method`, methodSection(model, key), 'site suggestions'));

  const history = buildHistory(root);
  return { dir: out, index: path.join(out, 'index.html'), pages: files.length, history };
}

// ---- Every idea of every session ----

const SESSION_RE = /^\d{4}-\d{2}-\d{2}(-\d+)?$/;
function sessionsOf(root) {
  return ['council', 'lab'].flatMap((skill) => {
    const base = path.join(projectDir(root), skill);
    if (!fs.existsSync(base)) return [];
    return fs.readdirSync(base).filter((d) => SESSION_RE.test(d) && fs.existsSync(path.join(base, d, 'session.json'))).map((id) => ({ skill, id }));
  }).sort((a, b) => a.id.localeCompare(b.id));
}

const STATUS_WORD = {
  proposed: 'Proposed', killed: 'Killed', undecided: 'Undecided', survived: 'Survived, waiting for you', accepted: 'Accepted', rejected: 'Rejected', later: 'Kept for later',
  planned: 'Planned', testing: 'Being tested', worked: 'Worked', failed: 'Failed', inconclusive: 'Inconclusive',
};

// Written beside the sessions, at `.project-health/ideas.html`: one table of every idea in the ledger, its status, the
// session it came from with a link to its page there, and its history. Ideas changed in the latest session come first.
export function buildHistory(root, { date = today() } = {}) {
  const ideas = loadIdeas(root);
  const sessions = sessionsOf(root);
  const latest = sessions.at(-1);
  const sessionOf = (idea) => { const s = idea.history.find((h) => h.session)?.session; return sessions.find((x) => x.id === s) ?? (s ? { skill: idea.origin ?? 'council', id: s } : null); };
  const pageOf = (idea) => { const s = sessionOf(idea); if (!s) return null; const rel = `${s.skill}/${s.id}/${SITE}/ideas/${idea.id}.html`; return fs.existsSync(path.join(projectDir(root), rel)) ? rel : null; };
  const changedLatest = (idea) => latest && idea.history.some((h) => h.session === latest.id);
  const row = (idea) => {
    const s = sessionOf(idea);
    const link = pageOf(idea);
    const title = link ? `<a class="idea-link" href="${esc(link)}">${esc(idea.title)}</a>` : `<b>${esc(idea.title)}</b>`;
    const timeline = `<details><summary>${idea.history.length} ${idea.history.length === 1 ? 'event' : 'events'}</summary><ol class="timeline">${idea.history.map((h) => `<li>${esc(h.date)}: ${esc(STATUS_WORD[h.event] ?? h.event)}${h.by ? ` (${esc(h.by)})` : ''}${h.note ? `: ${esc(h.note)}` : ''}</li>`).join('')}</ol></details>`;
    return `<tr><td class="no">${esc(idea.id)}</td><td>${title}${idea.parent ? `<span class="sub">A smaller form of ${esc(idea.parent)}</span>` : ''}</td><td>${esc(STATUS_WORD[idea.status] ?? idea.status)}</td><td>${s ? `${esc(s.skill === 'lab' ? 'Invention lab' : 'Council')}, ${esc(longDate(s.id))}` : ''}</td><td>${timeline}</td></tr>`;
  };
  const head = ['Idea', 'Title', 'Status', 'From', 'History'];
  const recent = ideas.filter(changedLatest);
  const rest = ideas.filter((i) => !changedLatest(i));
  const list = sessions.length ? `<ul>${[...sessions].reverse().map((s) => { const rel = `${s.skill}/${s.id}/${SITE}/index.html`; const has = fs.existsSync(path.join(projectDir(root), rel)); return `<li>${has ? `<a href="${esc(rel)}">` : ''}${esc(s.skill === 'lab' ? 'Invention lab' : 'Council')}, ${esc(longDate(s.id))}${has ? '</a>' : ''}</li>`; }).join('')}</ul>` : '<p>No session yet.</p>';
  const body = `<section class="glance"><p class="eyebrow">Every session</p><p class="goal">Every idea the council and the invention lab have looked at, and what became of it.</p></section>
${recent.length ? `<section class="b-part"><h2>Changed in the latest session</h2><p class="lead">${esc(latest.skill === 'lab' ? 'The invention lab' : 'The council')}, ${esc(longDate(latest.id))}.</p><div class="table-box">${table('history', head, recent.map(row))}</div></section>` : ''}
<section class="b-part"><h2>${recent.length ? 'All the other ideas' : 'All ideas'}</h2>${rest.length ? `<div class="table-box">${table('history', head, rest.map(row))}</div>` : '<p class="lead">None.</p>'}</section>
<section class="b-part"><h2>The sessions</h2>${list}</section>`;
  const file = path.join(projectDir(root), 'ideas.html');
  const model = { brand: brandOf(root), session: { id: date } };
  // The page sits beside the sessions, so it carries its styles itself rather than link a session's.
  const html = page({ title: 'Every idea, every session', kind: 'site', model, body, stylesheet: 'cache/site.css' });
  fs.mkdirSync(path.join(projectDir(root), 'cache'), { recursive: true });
  fs.writeFileSync(path.join(projectDir(root), 'cache', 'site.css'), `${css('document.css')}\n${css('site.css')}`);
  write(file, html);
  return file;
}
