import { escapeHtml as esc } from './html.mjs';
import { findPerson } from './knowledge.mjs';
import { replaceMarks, personWork, participants } from './brief.mjs';
import { estimateText, sumOf } from './roadmap-html.mjs';

const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
  + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400&family=IBM+Plex+Sans:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Serif:wght@600&display=swap">';

// What the cards, the first-page table and the closing line are called for each kind of reader.
export const LABELS = {
  owner: { cards: ['The problem', 'To decide', 'Recommendation'], glance: ['Decision', 'Recommendation', 'What we need from you', 'When'], next: 'After you decide:', doc: 'Decisions' },
  technical: { cards: ['The problem', 'To agree', 'Proposal'], glance: ['Topic', 'Proposal', 'What we need from you', 'When'], next: 'After we agree:', doc: 'Topics to agree' },
  developer: { cards: ['The problem', 'To do', 'Done when'], glance: ['Work', 'What to do', 'Needs first', 'When'], next: 'Then:', doc: 'Work plan' },
};

const cssString = (s) => `"${String(s).replace(/["\\]/g, '\\$&').replace(/\n/g, ' ')}"`;

// Escapes the text, then turns the brief's markup into its marks: bold, answer squares, gaps and item numbers.
export function inline(text, numbers) {
  return replaceMarks(esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'), (tok) => {
      if (tok.startsWith('#')) {
        const [id, key] = tok.slice(1).split('.');
        return `${numbers.get(id) ?? id}${key ?? ''}`;
      }
      if (tok.startsWith('?')) return `<span class="ph">[${tok.slice(1).trim()}]</span>`;
      if (tok.startsWith('~')) return `<span class="todo">[${tok.slice(1).trim()}]</span>`;
      if (tok.startsWith('+')) return `<span class="chg">${tok.slice(1).trim()}</span>`;
      const [key, rest] = [tok[0], tok.slice(2).trim()];
      return `<span class="fb">${key}</span>${rest ? `<span class="ph">${rest}</span>` : ''}`;
    });
}

function block(b, x) {
  const t = (s) => inline(s, x.numbers);
  const h = b.title && !['template', 'document'].includes(b.type) ? `<h3>${t(b.title)}</h3>` : '';
  const table = (head, rows, pick) => `<table${pick !== undefined ? ' class="picks"' : ''}>${head?.length ? `<thead><tr>${head.map((c) => `<th>${t(c)}</th>`).join('')}</tr></thead>` : ''}<tbody>${rows.map((r, i) => `<tr${i === pick ? ' class="pick"' : ''}>${r.map((c) => `<td>${t(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  switch (b.type) {
    case 'text': return h + b.text.split(/\n{2,}/).map((p) => `<p${h ? '' : ' style="margin-top:3mm"'}>${t(p)}</p>`).join('');
    case 'list': return `${h}<ul>${b.items.map((i) => `<li>${t(i)}</li>`).join('')}</ul>`;
    case 'note': return `<div class="note${b.tone === 'warn' ? ' warn' : ''}">${b.title ? `<b>${t(b.title)}:</b> ` : ''}${t(b.text)}</div>`;
    case 'flow': return `${h}<div class="flow">${b.steps.map((s) => `<div class="node ${s.tone && s.tone !== 'neutral' ? s.tone : ''}"><b>${t(s.label)}</b>${t(s.text)}</div>`).join('<div class="arrow">→</div>')}</div>`;
    case 'table': return h + table(b.head, b.rows, b.pick);
    case 'questions': return `${h || '<h3>The questions</h3>'}<table><thead><tr><th></th><th>Question</th><th>Why it is needed</th></tr></thead><tbody>${b.questions.map((q) => `<tr><td class="qkey"><span class="fb">${q.key}</span></td><td>${t(q.question)}</td><td>${t(q.why)}</td></tr>`).join('')}</tbody></table>`;
    // The script counts each group, so a count the writer put in the title is dropped.
    case 'groups': return `${h}<div class="groups" style="--cols:${Math.min(b.groups.length, 3)}">${b.groups.map((g) => `<div class="group${g.first ? ' first' : ''}"><b class="l">${t(g.title.replace(/\s*\(\d+\)\s*$/, ''))} (${g.items.length})</b>${g.items.map(t).join(', ')}${g.note ? `<p>${t(g.note)}</p>` : ''}</div>`).join('')}</div>`;
    case 'variants': return h + b.variants.map((v, i) => `<div class="variant"><b>${String.fromCharCode(65 + i)}. ${t(v.label.replace(/^[A-Z][.:)]\s+/, ''))}${v.recommended ? ' (recommended)' : ''}</b>`
      + `<div class="screen">${v.kicker ? `<div class="eyebrow">${t(v.kicker)}</div>` : ''}<div class="h">${t(v.heading)}</div>${v.text ? `<div class="s">${t(v.text)}</div>` : ''}</div>`
      + `${v.note ? `<p class="muted">${t(v.note)}</p>` : ''}</div>`).join('');
    case 'template': return `<div class="mail"><b>${t(b.title)}</b>\n${t(b.text)}</div>`;
    case 'document': return `<div class="attach"><h2>${t(b.title)}</h2>${b.text ? `<p>${t(b.text)}</p>` : ''}<div class="doc">${b.sections.map((s) => `<h4>${t(s.heading)}</h4>`
      + (s.paragraphs ?? []).map((p) => `<p>${t(p)}</p>`).join('')
      + (s.rows?.length ? table(s.head, s.rows) : '')
      + (s.notes ?? []).map((n) => `<div class="pnote"><b>Note for ${t(n.for)}, not part of the text:</b> ${t(n.text)}</div>`).join('')).join('')}</div></div>`;
    case 'tasks': {
      const rows = b.tasks.map((id) => x.tasks.get(id)).filter(Boolean);
      // Compact: the full detail of the reader's tasks is in the table at the end of the brief.
      return `${h || '<h3>The tasks</h3>'}<table class="tasks"><thead><tr><th>Task</th><th>What</th><th>Who</th><th class="nw">Estimate</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="nw">${esc(r.id)}</td><td>${esc(r.title)}</td><td>${esc(r.assignee ?? '')}</td><td class="est">${esc(estimateText(r.estimate))}</td></tr>`).join('')}</tbody></table>`;
    }
    default: return '';
  }
}

function item(it, n, x) {
  const t = (s) => inline(s, x.numbers);
  const tags = [`<span class="tag">${t(it.when)}</span>`, ...(it.tags ?? []).map((g) => `<span class="tag ${g.tone && g.tone !== 'neutral' ? g.tone : ''}">${t(g.text)}</span>`)].join('');
  const [p, d, r] = x.labels.cards;
  return `<section class="item"><h2>${n}. ${t(it.title)}</h2><div class="tags">${tags}</div>`
    + `<div class="strip"><div class="cell bad"><b class="l">${p}</b>${t(it.problem)}</div><div class="cell ask"><b class="l">${d}</b>${t(it.ask)}</div><div class="cell good"><b class="l">${r}</b>${t(it.recommendation)}</div></div>`
    + (it.blocks ?? []).filter((b) => b.type !== 'document').map((b) => block(b, x)).join('')
    + (it.next ? `<p class="next"><b>${x.labels.next}</b> ${t(it.next)}</p>` : '')
    // Long documents to fill or pass on, such as a policy draft, follow their item on pages of their own.
    + (it.blocks ?? []).filter((b) => b.type === 'document').map((b) => block(b, x)).join('')
    + '</section>';
}

// The reader's own tasks with their agreed estimates, for everyone whose work is estimated.
function reference(work, labels) {
  const all = work.flatMap((w) => w.tasks);
  if (!all.length) return '';
  // The tasks stand under their plan, so the plan's title is said once.
  const groups = work.filter((w) => w.tasks.length).map((w) => `<tbody class="plan"><tr class="plan"><td colspan="3"><b>${esc(w.solution.id)} · ${esc(w.solution.title)}</b></td></tr>`
    + w.tasks.map((r) => `<tr><td class="nw">${esc(r.id)}</td><td><b>${esc(r.title)}</b>${r.route ? ` <span class="tag">${esc(r.route)} only</span>` : ''}<br><span class="muted">${esc(r.detail)}</span></td><td class="est">${esc(estimateText(r.estimate))}</td></tr>`).join('') + '</tbody>').join('');
  return `<section class="reference"><h2>Your tasks and estimates</h2><p>Every task of yours in the agreed roadmap, in plan order. Estimates are agreed ranges of working time.</p>`
    + `<table class="tasks ref"><thead><tr><th>Task</th><th>What</th><th class="nw">Estimate</th></tr></thead>${groups}`
    + `<tbody><tr><td></td><td><b>Total</b></td><td class="est"><b>${esc(sumOf(all))}</b></td></tr></tbody></table></section>`;
}

// Run in the browser before saving: how many A4 pages the first page and each item take at the printed width,
// leaving out the attached documents, which may run over. The result is written into the page as #ph-fit.
const FIT_SCRIPT = `(async () => {
  await document.fonts.ready;
  const page = 259 * 96 / 25.4;
  document.body.style.width = '170mm';
  const top = (e) => e.getBoundingClientRect().top;
  const items = [...document.querySelectorAll('section.item')];
  const out = items.length ? [{ part: 'the first page', pages: (top(items[0]) - top(document.body)) / page }] : [];
  items.forEach((s, i) => {
    const own = [...s.children].filter((c) => !c.classList.contains('attach'));
    out.push({ part: 'item ' + (i + 1), pages: (own[own.length - 1].getBoundingClientRect().bottom - top(s)) / page });
  });
  const pre = document.createElement('pre');
  pre.id = 'ph-fit';
  pre.textContent = JSON.stringify(out);
  document.body.append(pre);
})();`;

// The measurements FIT_SCRIPT left in a page's DOM, or null when it did not run.
export function readFit(dom) {
  const m = /<pre id="ph-fit">([^<]*)<\/pre>/.exec(dom);
  try { return m ? JSON.parse(m[1].replace(/&amp;/g, '&')) : null; } catch { return null; }
}

export function buildBriefHtml({ brief, roadmap, knowledge, project, css, generatedAt = new Date(), measure = false }) {
  const labels = LABELS[brief.audience];
  const numbers = new Map(brief.items.map((it, i) => [it.id, String(i + 1)]));
  const tasks = new Map((roadmap.solutions ?? []).flatMap((s) => (s.tasks ?? []).map((t) => [t.id, t])));
  const x = { labels, numbers, tasks };
  const t = (s) => inline(s, numbers);
  const person = findPerson(knowledge, brief.person);
  // Who the others are, in one line, so names in the text are never a riddle.
  const others = participants(roadmap, knowledge).filter((p) => p.person.name !== person.name).map((p) => `${p.person.name} (${p.person.role})`);
  const date = generatedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const glance = `<table class="glance"><thead><tr><th>#</th>${labels.glance.map((g) => `<th>${g}</th>`).join('')}</tr></thead><tbody>`
    + brief.items.map((it, i) => `<tr><td>${i + 1}</td><td><b>${t(it.short)}</b></td><td>${t(it.summary)}</td><td>${t(it.need)}</td><td>${t(it.when)}</td></tr>`).join('') + '</tbody></table>';
  const context = (brief.context ?? []).length ? `<section class="context"><h2>For context</h2>${brief.context.map((c) => `<h3>${t(c.title)}</h3><table class="rows"><tbody>${c.rows.map((r) => `<tr><td><b>${t(r.label)}</b></td><td>${t(r.text)}</td></tr>`).join('')}</tbody></table>`).join('')}</section>` : '';
  const ref = brief.audience === 'owner' || person.notEstimated ? '' : reference(personWork(roadmap, knowledge, person), labels);
  const foot = `${project} · ${labels.doc} for ${brief.person}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(`${labels.doc} for ${brief.person} — ${project}`)}</title>${FONTS}`
    + `<style>${css.replace(/<\/style/gi, '')}</style><style>@page { @bottom-left { content: ${cssString(foot)}; } }</style></head><body>`
    + `<header class="top"><div class="kicker">${esc(project)} · ${esc(labels.doc)} · For ${esc(brief.person)}</div><h1>${t(brief.title)}</h1><p class="sub">${t(brief.intro)}</p>`
    // A run id means nothing to an owner; the others can look the run up.
    + `<p class="meta">${esc(date)} · ${brief.audience === 'owner' ? 'From the agreed website roadmap' : `From the agreed roadmap of run ${esc(roadmap.run)}`}${others.length ? ` · Also in this work: ${esc(others.join(', '))}` : ''}</p></header>`
    + `<h3 style="margin-top:9mm">At a glance</h3>${glance}`
    + (brief.reply ? `<div class="note" style="margin-top:5mm">${t(brief.reply)}</div>` : '')
    + brief.items.map((it, i) => item(it, i + 1, x)).join('') + context + ref
    + (measure ? `<script>${FIT_SCRIPT}</script>` : '')
    + '</body></html>';
}
