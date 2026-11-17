import fs from 'node:fs';
import path from 'node:path';
import { SKILL_DIR } from './paths.mjs';

// The two documents as HTML, printed to PDF by a browser. Everything an agent wrote is escaped; the only markup a
// text may carry is **bold**, *italic* and a link to a web page, [words](https://…), which the save checks.

const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => MAP[c]);
export const rich = (value) => esc(String(value ?? '').replace(/\s+/g, ' ').trim())
  .replace(/\[([^\]\n]{1,160})\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g, '$1<em>$2</em>');

// A longer text of the librarian's: a blank line starts a new paragraph.
export const paras = (value) => String(value ?? '').split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${rich(p)}</p>`).join('');

const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
  + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Serif:ital,wght@0,400;0,600;1,400&display=swap">';
const DEFAULT_BAND = '#1f2937';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function channel(c) { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }
function luminance(hex) { const n = parseInt(hex.slice(1), 16); return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255); }
function contrast(a, b) { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); }

export function longDate(id) {
  const [, y, m, d] = /^(\d{4})-(\d{2})-(\d{2})/.exec(id) ?? [];
  return y ? `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}` : id;
}

const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
export function roman(n) {
  let out = '';
  for (const [value, sign] of ROMAN) while (n >= value) { out += sign; n -= value; }
  return out;
}

const css = () => fs.readFileSync(path.join(SKILL_DIR, 'templates', 'document.css'), 'utf8');

function page({ title, kind, model, body }) {
  const bg = model.brand.color ?? DEFAULT_BAND;
  const fg = contrast(bg, '#ffffff') >= contrast(bg, '#111111') ? '#ffffff' : '#111111';
  // The brand colour is the one accent when it is dark enough to read as text on white; otherwise a neutral ink.
  const accent = contrast(bg, '#ffffff') >= 4.5 ? bg : DEFAULT_BAND;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
${FONTS}
<style>${css().replace(/<\/style/gi, '')}</style>
<style>:root { --accent: ${accent}; } .band { --band-bg: ${bg}; --band-fg: ${fg}; }</style>
</head>
<body class="${kind}">
<header class="band"><h1 class="band-name">${esc(model.brand.name)}</h1><p class="band-meta"><span>${esc(title)}</span><span>${esc(longDate(model.session.id))}</span></p></header>
${body}
</body>
</html>
`;
}

// The judge and the red team write for each other, with the ids of the debate: "T12", "(E96, E118)", "question 95".
// A reader has none of those. Ideas are named the way this document names them; the other references are dropped.
export function readerText(text, nameOf) {
  return String(text ?? '')
    .replace(/\s*\((?:\s*E\d+\s*(?:,|and)?\s*)+\)/g, '')
    .replace(/,\s*E\d+(?=\s*\))/g, '')
    .replace(/\s*\((?:question|statement|attack)s?\s+\d+(?:\s*(?:,|and)\s*\d+)*\)/gi, '')
    .replace(/,\s*(?:question|statement)s?\s+\d+(?=\s*\))/gi, '')
    .replace(/([.!?]\s+)?\bT\d+\b/g, (match, lead, offset) => {
      const name = nameOf(match.slice((lead ?? '').length));
      if (!name) return match;
      // A name that opens a sentence takes a capital.
      return (lead ?? '') + (lead !== undefined || offset === 0 ? name.charAt(0).toUpperCase() + name.slice(1) : name);
    });
}

const STAMPS = { survived: 'Survived', narrowed: 'Survived, smaller', killed: 'Killed', undecided: 'Undecided' };
const stamp = (verdict) => `<span class="stamp stamp-${verdict}">${STAMPS[verdict] ?? esc(verdict)}</span>`;
const tag = (text, kind = '') => `<span class="tag${kind ? ` tag-${kind}` : ''}">${esc(text)}</span>`;
const STRENGTH_NOTE = {
  strong: 'Rests on a number that was measured.',
  fair: 'Rests on something that was seen: on the site, in the project, at a competitor.',
  speculative: 'Rests on argument alone. Worth a cheap test, nothing more.',
};
const SCALE_NOTE = { new: 'Something the business does not do or have at all: an offer, a tool, a channel, a partnership, an audience. A decision for you; its test is a first step.', direction: 'A remake of what is there: the site or a part of it, the position, the first offer. A decision for you; its test is a first step.', addition: 'Something new beside what is there on the site: a page, a section, a kind of content.', adjustment: 'A change to what is already there.' };
const EFFORT_NOTE = { small: 'A change to what is already there.', medium: 'New content or a new part of the site.', large: 'Work across the site, or something the company has to supply.' };
const chips = (pairs) => `<div class="counts">${pairs.filter(([n]) => n !== null).map(([n, label, kind]) => `<span class="count${kind ? ` count-${kind}` : ''}"><b>${esc(n)}</b> ${esc(label)}</span>`).join('')}</div>`;
const table = (cls, head, rows) => (rows.length ? `<table class="${cls}"><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>` : '');
const seatLine = (s) => (s ? `${esc(s.name)}, ${esc(s.title.replace(/^The /, 'the '))}` : '');
// A long address or file path may break anywhere rather than push a table off the page.
const source = (s) => esc(s ?? '').replace(/([^:/])\/(?=[^/])/g, '$1/<wbr>').replace(/(\?|&amp;)/g, '<wbr>$1');
// It may also have been cut short in the middle of a sentence: then it ends at the last whole one.
function evidenceText(e) {
  let text = String(e.text ?? '');
  let note = '';
  if (String(e.source ?? '').startsWith('finding ')) {
    // "(seo, high)" is filing; what follows it ("planned as S3", what the people decided) is for the reader.
    const tail = /\s*\(([a-z][a-z-]*), (?:critical|high|medium|low)(?:, ([^]*?))?\)?…?$/.exec(text);
    if (tail) { text = text.slice(0, tail.index); note = tail[2] ? ` (${tail[2].replace(/\)$/, '')})` : ''; }
  }
  if (text.endsWith('…')) text = text.slice(0, text.lastIndexOf('. ') + 1) || text;
  return (/[.!?…"”')]$/.test(text) ? text : `${text}.`) + note;
}
const evidenceItem = (e, plain = (t) => t) => `<li><span class="ev-id">${esc(e.id)}</span> ${esc(plain(evidenceText(e)))} <span class="ev-src">${esc(e.grade)}${e.source ? ` · ${sourceLink(e.source)}` : ''}</span></li>`;

function countChips(model) {
  const c = model.counts;
  return chips([
    [c.proposed, 'proposed'], [c.admitted, 'debated'],
    [c.survived, 'survived', 'good'], [c.narrowed, 'survived smaller', 'good'],
    [c.killed, 'killed', 'bad'], [c.undecided, 'undecided', 'check'],
    // How many ideas the judge found fresh: ones that could only come from this project, not from any adviser's list.
    [typeof model.fresh === 'number' ? model.fresh : null, 'fresh', 'fresh'],
  ]);
}

function methodSection(model, key = '') {
  const seats = model.cast.filter((s) => s.role !== 'librarian');
  const rows = seats.map((s) => `<tr><td><b>${esc(s.title)}</b></td><td>${esc(s.ground)}</td><td>${esc(s.model === 'strongest' ? 'Strongest model' : 'Standard model')}</td></tr>`);
  const g = model.grades;
  const limits = [
    ...model.missing,
    ...(model.cutOff.length ? [`The budget of agent runs ran out before ${model.cutOff.length === 1 ? 'one debate was' : `${model.cutOff.length} debates were`} finished: ${model.cutOff.map((i) => `"${i.title}"`).join(', ')}.`] : []),
    ...(model.setSkipped ? ['The survivors were not looked at together, because that step failed.'] : []),
  ];
  return `<section class="method" id="method"><h2>Method and limits</h2>
<p class="lead">${model.ideas.some((i) => i.pass === 2) ? 'Before anyone proposed, one member looked at the rivals and another scanned what is changing around the business, outside its site. Ideas came in two passes: each seat alone first, then each seat saw the themes already on the table and brought one on ground none of them covered. ' : ''}Each idea was written as a hypothesis that can be proved wrong, attacked by a red team and by the other seats, answered by its proposer over at most three rounds, and ruled on by a judge who took no part and did not know who had said what.${typeof model.fresh === 'number' ? ' Before the debate the judge marked each idea fresh, when it could only come from looking at this project, or familiar, when any adviser would give it to any firm of this kind.' : ''}</p>
<h4>What the session had to go on</h4>
<p>${esc(model.evidenceCount)} pieces of evidence: ${esc(g.measured)} measured (a number from shared data), ${esc(g.observed)} observed (seen on the site, in the project or at a competitor), ${esc(g.argued)} argued. ${esc(model.session.runs)} of ${esc(model.session.budget)} agent runs were used.</p>
${limits.length ? `<h4>What it lacked</h4><ul class="limits">${limits.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
<h4>The seats</h4>
${table('seats', ['Seat', 'What it looks at', 'Ran on'], rows)}
${key}
<p class="meta">Session ${esc(model.session.id)}. The full record of the debate, statement by statement, is kept with the session.</p>
</section>`;
}

// ---- The suggestions ----
// Read by two people: the owner, who has minutes and wants to know what to decide, what is asked of them and where to
// start (the first two pages, and the decision box at the top of each idea); and whoever runs the tests (the case for
// each idea, below its box). The order inside an idea follows that: the decision first, the reasoning after.

const isWeb = (s) => /^https?:\/\//i.test(String(s ?? ''));
// A source the reader can open is a link; its text is the address itself, so it says where it goes.
const sourceLink = (s) => (isWeb(s) ? `<a href="${esc(s)}">${source(s)}</a>` : source(s));
const shortAddress = (url) => { try { const u = new URL(url); return `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`; } catch { return url; } };
const ideaLinks = (nums) => nums.map((n) => `<a href="#idea-${esc(n.id)}">idea ${n.no}</a>`).join(', ');

// Where an idea applies: each place as a link the reader can open and, when it was photographed, the part of the page
// with an outline around it. A place that could not be found says so under the top of its page.
function whereBlock(places, { heading = true } = {}) {
  if (!places.length) return '';
  const item = (p) => {
    const link = `<a href="${esc(p.url)}">${esc(shortAddress(p.url))}</a>`;
    const caption = `${link} · ${esc(p.part)}${p.file ? `, seen ${esc(longDate(p.taken))}` : ''}${p.file && !p.found ? '. <span class="not-found">This part was not found on the page when it was photographed; the top of the page is shown.</span>' : ''}`;
    return p.file
      ? `<figure class="part${p.found ? '' : ' part-missing'}"><a href="${esc(p.url)}"><img src="${esc(p.file)}" alt="${esc(p.found ? `${p.part}, outlined, on ${shortAddress(p.url)}` : `The top of ${shortAddress(p.url)}`)}"></a><figcaption>${caption}</figcaption></figure>`
      : `<p class="part-link">${caption}</p>`;
  };
  return `<div class="where">${heading ? '<h5>Where</h5>' : ''}${places.map(item).join('')}</div>`;
}

function ideaArticle(model, idea, s, n, chapterNo, plain, picture, parts = () => []) {
  const places = parts(idea.thread);
  // An idea with no picture yet still links its places.
  const placesHtml = whereBlock(places.length ? places : (idea.where ?? []).map((w) => ({ ...w, file: null })));
  // A field whose table already labels it keeps its heading for screen readers only: two labels stacked read as noise.
  const field = (title, html, long = false, hidden = false) => (html ? `<div class="field${long ? ' field-long' : ''}"><h5${hidden ? ' class="sr"' : ''}>${esc(title)}</h5>${html}</div>` : '');
  const list = (items) => (items?.length ? `<ul>${items.map((x) => `<li>${rich(x)}</li>`).join('')}</ul>` : '');
  const shown = idea.proposerEvidence.slice(0, 3);
  const more = idea.proposerEvidence.length - shown.length;
  // At most two pictures, of the first pages the proposer cited that a member looked at.
  const seen = new Set();
  // Only for an idea that names no place of its own: the places are the pictures that matter.
  const shots = placesHtml ? [] : idea.proposerEvidence.filter((e) => isWeb(e.source)).map((e) => ({ url: e.source, pic: picture(e.source) }))
    .filter((x) => x.pic && !seen.has(x.pic.src) && seen.add(x.pic.src)).slice(0, 2);
  const figures = shots.length ? `<div class="shots${shots.length === 1 ? ' shots-one' : ''}">${shots.map(({ url, pic }) => `<figure class="shot"><a href="${esc(url)}"><img src="${esc(pic.src)}" alt="The first screen of ${esc(shortAddress(url))} on a desktop, as a member of the council saw it"></a><figcaption><a href="${esc(url)}">${esc(shortAddress(url))}</a>, seen ${esc(longDate(pic.taken))}</figcaption></figure>`).join('')}</div>` : '';
  const smaller = idea.verdict === 'narrowed' ? `<p class="smaller">A smaller form of the idea as it was proposed: “${esc(idea.originalTitle)}”.</p>` : '';
  const row = (label, html) => (html ? `<div><dt>${esc(label)}</dt><dd>${html}</dd></div>` : '');
  const fromYou = s.fromYou === undefined ? '' : s.fromYou.length ? list(s.fromYou) : '<p>Nothing beyond the go-ahead.</p>';
  const effortNote = (EFFORT_NOTE[idea.effort] ?? '').replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase());
  const box = `<dl class="decide">
${row('First step', `<p>${rich(s.firstStep)}</p>`)}
${row('Needs from you', fromYou)}
${row('Also needs', list(s.needs))}
${row('Expect', `<p>${rich(s.expected)}</p>`)}
${row('Drop it if', `<p>${rich(s.killCondition)}</p>`)}
${row('Effort', `<p><b>${esc(idea.effort.charAt(0).toUpperCase() + idea.effort.slice(1))}</b>${effortNote ? `: ${esc(effortNote)}` : ''}.</p>`)}
${row('Fits with', s.fitsWith ? `<p>${rich(plain(s.fitsWith))}</p>` : '')}
</dl>`;
  const where = [`Proposed from the seat of ${esc(idea.proposer.title.replace(/^The /, 'the '))}`, chapterNo ? `debated in chapter ${roman(chapterNo)} of the discussion` : '', `idea ${esc(idea.id.slice(1))} in the ledger`].filter(Boolean).join(' · ');
  return `<article class="idea" id="idea-${esc(idea.id)}">
<header class="idea-head"><p class="idea-no">${n}</p><div><h3>${esc(plain(idea.title))}</h3>
<p class="tags">${idea.scale ? tag(idea.scale, `scale-${idea.scale}`) : ''}${idea.novelty === 'fresh' ? tag('fresh', 'fresh') : ''}${tag(`${idea.strength} support`, idea.strength)}${tag(`${idea.effort} effort`)}</p></div></header>
<p class="lede">${rich(s.sentence)}</p>
${smaller}
${placesHtml}
${box}
<h4 class="case">The case for it</h4>
${field('Why it should work', `<p>${rich(s.why)}</p>`)}
${field('How to test it', `<p>${rich(s.test)}</p>`)}
${field('What is still uncertain', list(s.uncertain))}
${field('Where it comes from', `<p>${rich(s.comesFrom)}</p>${figures}${shown.length ? `<ul class="evidence">${shown.map((e) => evidenceItem(e, plain)).join('')}</ul>${more > 0 ? `<p class="meta">And ${more} more in the record.</p>` : ''}` : ''}`, true)}
${field('What it survived', table('survived', ['The attack', 'How it was answered'], s.survived.map((x) => `<tr><td>${rich(x.attack)}</td><td>${rich(x.answer)}</td></tr>`)), true, true)}
${field('Why not leave things as they are', `<p>${rich(plain(idea.ruling.vsDoNothing))}</p><p class="meta">The judge's ruling.</p>`)}
<p class="meta idea-foot">${where}.</p>
</article>`;
}

export function buildSuggestionsHtml({ model, suggestions, discussion = null, picture = () => null, parts = () => [] }) {
  const chapterNo = (thread) => { const at = (discussion?.chapters ?? []).findIndex((c) => c.thread === thread); return at >= 0 ? at + 1 : null; };
  const written = new Map(suggestions.survivors.map((s) => [s.idea, s]));
  const lived = model.survivors.length;
  // In this document a survivor is "idea 3", its number in the list; any other idea is named by its title.
  const numberOf = new Map(model.survivors.map((idea, i) => [idea.thread, i + 1]));
  const noOfId = new Map(model.survivors.map((idea, i) => [idea.id, i + 1]));
  const plain = (text) => readerText(text, (id) => (numberOf.has(id) ? `idea ${numberOf.get(id)}` : model.ideas.find((i) => i.thread === id) ? `“${model.ideas.find((i) => i.thread === id).title}”` : null));
  const r = model.trackRecord;
  const tried = r.worked + r.failed + r.inconclusive;
  const questions = suggestions.questions ?? [];

  // Page 1: the goal, what came of it, and where to start. Short by design: the first page has no side margins of its
  // own (the band runs edge to edge), so whatever ran over onto a second page would be squeezed into a narrow column.
  const plan = (suggestions.plan ?? []).filter((p) => p.ideas.some((id) => noOfId.has(id)));
  const steps = plan.map((p) => `<li>${rich(plain(p.text))} <span class="refs">${ideaLinks(p.ideas.filter((id) => noOfId.has(id)).map((id) => ({ id, no: noOfId.get(id) })).sort((a, b) => a.no - b.no))}</span></li>`);
  const glance = `<section class="glance">
<p class="eyebrow">The goal</p>
<p class="goal">${esc(model.session.goal)}</p>
<p class="verdict">${rich(suggestions.summary)}</p>
${countChips(model)}
${steps.length ? `<div class="start"><h2>Where to start</h2><ol>${steps.join('')}</ol></div>` : ''}
</section>`;

  // Page 2: everything the owner is asked for, and the list of the ideas.
  const asks = model.survivors.flatMap((idea, i) => (written.get(idea.id)?.fromYou ?? []).map((text) => ({ text, id: idea.id, no: i + 1 })));
  const scaled = model.survivors.some((i) => i.scale);
  const supports = new Set(model.survivors.map((i) => i.strength));
  // The owner answers each survivor with yes, later or no, and the next session starts from those answers: so the page
  // asks for them in so many words, gives the council's advice and leaves a place to mark each answer.
  const head = ['No.', 'Idea', ...(scaled ? ['Scale'] : []), ...(supports.size > 1 ? ['Support'] : []), 'Effort', 'Your answer'];
  const answer = `<span class="answer">${['Yes', 'Later', 'No'].map((a) => `<span><i class="box" aria-hidden="true"></i>${a}</span>`).join(' ')}</span>`;
  const rows = model.survivors.map((idea, i) => `<tr><td class="no">${i + 1}</td><td><a class="idea-link" href="#idea-${esc(idea.id)}">${esc(plain(idea.title))}</a></td>${scaled ? `<td>${esc(idea.scale ?? '')}</td>` : ''}${supports.size > 1 ? `<td>${tag(idea.strength, idea.strength)}</td>` : ''}<td>${esc(idea.effort)}</td><td class="answer-cell">${answer}</td></tr>`);
  const one = supports.size === 1 ? model.survivors[0].strength : null;
  const ask = `<div class="ask-decide"><p><b>What you decide:</b> for each idea, <b>yes</b> (test it), <b>later</b>, or <b>no</b> with a reason, so that it does not come back. ${lived === 1 ? 'The council advises yes: the idea survived the attacks on it' : 'The council advises yes for each: every idea here survived the attacks on it'}, and a test can be stopped when it does not work. The support says how sure that advice is.</p>
<p>Mark your answers in the table and give them to whoever runs the council for you. The next session starts from them; an idea without an answer waits.</p></div>`;
  const decisions = `<section class="decisions"><h2>Your decisions</h2>
${lived ? `<p class="lead">${lived === 1 ? 'One idea survived' : `${lived} ideas survived`} the debate. None has been tried yet: each is a test to run, not a result.</p>
${ask}` : '<p class="lead">No idea survived this session. The graveyard says what killed each one, and the undecided ideas say what would settle them.</p>'}
${lived ? `<h3>The ideas</h3>
<p class="meta">${scaled ? 'New things first, then remakes of what is there, then additions, then adjustments; within each, by how well supported, then by effort.' : 'By how well supported, then by effort.'}</p>
${table(`survivors${scaled ? '' : ' unscaled'}${supports.size > 1 ? '' : ' one-support'}`, head, rows)}
<p class="key-line">${one ? `Every idea here has ${tag(one, one)} support: ${esc(STRENGTH_NOTE[one].replace(/^./, (c) => c.toLowerCase()))} ` : ''}Support, scale and effort are explained under <a href="#method">Method and limits</a>.</p>` : ''}
${asks.length || questions.length ? '<h3>What we need from you</h3>' : ''}
${asks.length ? `<ul class="asks">${asks.map((a) => `<li><span class="ask-idea"><a href="#idea-${esc(a.id)}">Idea ${a.no}</a></span><span>${rich(plain(a.text))}</span></li>`).join('')}</ul>` : ''}
${questions.length ? `<p class="ask-more">${asks.length ? 'And there' : 'There'} ${questions.length === 1 ? 'is one question' : `are ${questions.length} questions`} only you can answer: see <a href="#questions">Questions for you</a>.</p>` : ''}
${tried ? `<h3>Results since the earlier sessions</h3><p>Of the ${esc(r.survived)} ideas that survived earlier sessions, ${esc(r.worked)} worked, ${esc(r.failed)} failed and ${esc(r.inconclusive)} could not be told; ${esc(r.testing)} are being tested.</p>` : ''}
</section>`;

  // The survivors in two groups: what the business could start or remake, then what improves what is there. A reader who
  // wants new ideas finds them first and sees at once how many there are.
  const article = (idea, i) => ideaArticle(model, idea, written.get(idea.id), i + 1, chapterNo(idea.thread), plain, picture, parts);
  const isBold = (idea) => ['new', 'direction'].includes(idea.scale);
  const groups = scaled ? [
    ['New directions', 'Things the business does not do yet, and remakes of what it has. Each is a decision for you; its test is a first step.', model.survivors.map((idea, i) => [idea, i]).filter(([idea]) => isBold(idea))],
    ['Improvements to what is there', 'Changes to the site and the profiles as they are.', model.survivors.map((idea, i) => [idea, i]).filter(([idea]) => !isBold(idea))],
  ].filter(([, , list]) => list.length) : [[null, null, model.survivors.map((idea, i) => [idea, i])]];
  const ideas = lived ? `<section class="ideas"><h2 class="sr">The ideas that survived</h2>
${groups.map(([title, lead, list]) => `${title ? `<h2 class="group">${esc(title)}</h2><p class="lead group-lead">${esc(lead)}</p>` : ''}${list.map(([idea, i]) => article(idea, i)).join('\n')}`).join('\n')}
</section>` : '';

  // The bold ideas that did not survive, with what would make each worth trying: the debate killed them on what could be
  // shown today, which is not the same as showing they are wrong.
  const betText = new Map((suggestions.bets ?? []).map((b) => [b.idea, b]));
  const bets = (model.bets ?? []).length ? `<section class="bets"><h2>Bold ideas the council could not prove</h2>
<p class="lead">${(model.bets ?? []).length === 1 ? 'This idea reaches' : 'These ideas reach'} beyond what the business does today and did not survive the debate. A bet often falls for want of evidence that only trying it would give, so each is shown with what would make it worth trying.</p>
${(model.bets ?? []).map((i) => { const b = betText.get(i.id); const places = parts(i.thread); return `<div class="bet"><p class="bet-head"><b>${esc(plain(i.title))}</b> ${tag(i.scale, `scale-${i.scale}`)}${i.novelty === 'fresh' ? tag('fresh', 'fresh') : ''} ${stamp(i.verdict)}</p>
${b ? `<p>${rich(b.sentence)}</p>` : `<p>${rich(plain(i.hypothesis.change))}</p>`}
<dl class="decide">${b ? `<div><dt>Worth trying if</dt><dd><p>${rich(b.worthIt)}</p></dd></div>` : ''}<div><dt>${i.verdict === 'killed' ? 'Why it fell' : 'What would decide it'}</dt><dd><p>${rich(plain(i.verdict === 'killed' ? i.ruling.causeOfDeath : i.ruling.wouldDecide))}</p></dd></div></dl>
${places.length ? whereBlock(places) : ''}</div>`; }).join('\n')}
</section>` : '';

  const KIND = { conflict: 'Conflict', 'shared-assumption': 'Shared assumption', order: 'Order', other: 'Note' };
  const ideaRef = (id) => (numberOf.has(id) ? `<a href="#idea-${esc(model.survivors[numberOf.get(id) - 1].id)}">Idea ${numberOf.get(id)}</a>` : esc(id));
  const set = model.setNotes.length ? `<section class="set"><h2>The survivors as a set</h2>
<p class="lead">After the verdicts the red team looked at the survivors together, as the list the project would act on.</p>
${model.setNotes.map((n) => `<div class="set-note"><p class="set-head">${tag(KIND[n.kind] ?? n.kind, n.kind)}<span class="set-ideas">${[...n.threads].sort((a, b) => (numberOf.get(a) ?? 99) - (numberOf.get(b) ?? 99)).map(ideaRef).join(' · ')}</span></p><p>${rich(plain(n.text))}</p></div>`).join('\n')}
${model.setChanges.length ? `<p class="meta">On these notes the judge looked again at ${model.setChanges.length === 1 ? 'one verdict' : `${model.setChanges.length} verdicts`}; the verdicts shown in this document are the final ones.</p>` : ''}
</section>` : '';

  // An idea shown among the bold ones is not listed again below.
  const undecided = model.undecided.filter((i) => !(model.bets ?? []).includes(i));
  const killed = model.killed.filter((i) => !(model.bets ?? []).includes(i));
  const both = undecided.length && questions.length;
  const openTitle = both ? 'Undecided, and questions for you' : undecided.length ? 'Undecided ideas' : 'Questions for you';
  const open = undecided.length || questions.length ? `<section class="open" id="questions"><h2>${openTitle}</h2>
${undecided.length ? `${both ? '<h3>Undecided ideas</h3>' : ''}${table('undecided', ['Idea', 'What would decide it'], undecided.map((i) => `<tr><td><b>${esc(plain(i.title))}</b></td><td>${rich(plain(i.ruling.wouldDecide))}</td></tr>`))}` : ''}
${questions.length ? `${both ? '<h3>Questions only you can answer</h3>' : ''}<p class="lead">Nobody in the session could answer these. An answer lets the next session take the idea up again.</p><ol class="questions">${questions.map((q) => `<li>${rich(q.text)}</li>`).join('')}</ol>` : ''}
</section>` : '';

  const graveyard = killed.length || model.refused.length || model.merged.length ? `<section class="graveyard"><h2>The graveyard</h2>
${killed.length ? table('killed', ['Idea', 'Cause of death'], killed.map((i) => `<tr><td><b>${esc(plain(i.title))}</b></td><td>${rich(plain(i.ruling.causeOfDeath))}</td></tr>`)) : ''}
${model.refused.length ? `<h3>Turned away before the debate</h3>${table('refused', ['Idea', 'Why'], model.refused.map((x) => `<tr><td><b>${esc(x.title)}</b></td><td>${rich(x.reason)}</td></tr>`))}` : ''}
${model.merged.length ? `<h3>Merged into another idea</h3>${table('merged', ['Idea', 'Debated as'], model.merged.map((x) => `<tr><td>${esc(x.title)}</td><td>${esc(x.into)}</td></tr>`))}` : ''}
</section>` : '';

  const key = `<h4>How well an idea is supported</h4>
<table class="key"><thead class="sr"><tr><th scope="col">Support</th><th scope="col">What it means</th></tr></thead><tbody>${Object.entries(STRENGTH_NOTE).map(([k, v]) => `<tr><td>${tag(k, k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
<h4>How far an idea reaches</h4>
<table class="key"><thead class="sr"><tr><th scope="col">Scale</th><th scope="col">What it means</th></tr></thead><tbody>${Object.entries(SCALE_NOTE).map(([k, v]) => `<tr><td>${tag(k, `scale-${k}`)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
<p class="key-line">Effort is ${Object.entries(EFFORT_NOTE).map(([k, v]) => `<b>${esc(k)}</b> (${esc(v.replace(/\.$/, '').toLowerCase())})`).join(', ')}.</p>`;

  return page({ title: 'Council · Suggestions', kind: 'suggestions', model, body: [glance, decisions, ideas, set, bets, open, graveyard, methodSection(model, key)].join('\n') });
}

// ---- The discussion ----

function chapterHtml(model, chapter, n, usedEvidence, plain, placesOf = () => []) {
  const idea = model.ideas.find((i) => i.thread === chapter.thread);
  // The seat stands beside the name: the reader should not have to remember who speaks for what.
  const speaker = (role) => { const s = model.cast.find((x) => x.role === role); return s ? `${esc(s.name)}<span class="seat">, ${esc(s.title)}</span>` : esc(role); };
  const scenes = chapter.scenes.map((scene, at) => {
    if (scene.speaker === undefined) return `<p class="aside">${rich(scene.aside)}</p>`;
    // The same speaker going straight on is one voice: the name is printed once.
    const goesOn = chapter.scenes[at - 1]?.speaker === scene.speaker;
    const evidenceOf = (sc) => [...new Set(idea.statements.filter((s) => sc.refs.includes(s.n)).flatMap((s) => s.evidence ?? []))];
    const ids = evidenceOf(scene);
    ids.forEach((id) => usedEvidence.add(id));
    // When the speaker goes on from the same statement, its evidence is named once, under the last of its speeches.
    const after = chapter.scenes[at + 1];
    const repeated = after?.speaker === scene.speaker && evidenceOf(after).join() === ids.join();
    return `<div class="speech${goesOn ? ' speech-on' : ''}">${goesOn ? '' : `<p class="speaker">${speaker(scene.speaker)}</p>`}<p class="said">${rich(scene.text)}</p>${ids.length && !repeated ? `<p class="cites">Evidence: ${ids.map(esc).join(', ')}</p>` : ''}</div>`;
  }).join('\n');
  const ruling = idea.ruling;
  // Each part of the ruling on a line of its own, its label above it: run together they read as one long sentence.
  const parts = ruling.verdict === 'killed' ? [['Cause of death', rich(plain(ruling.causeOfDeath))]]
    : ruling.verdict === 'undecided' ? [['What would decide it', rich(plain(ruling.wouldDecide))]]
      : [
        ...(ruling.verdict === 'narrowed' ? [['What stands', esc(plain(ruling.narrowed.title))]] : []),
        ['Support', tag(ruling.strength, ruling.strength)],
        ['Against leaving things as they are', rich(plain(ruling.vsDoNothing))],
      ];
  const detail = `<dl class="ruling-parts">${parts.map(([label, html]) => `<div><dt>${esc(label)}</dt><dd>${html}</dd></div>`).join('')}</dl>`;
  return `<article class="chapter">
<header class="chapter-head"><p class="chapter-no">Chapter ${roman(n)}</p><h3>${esc(idea.originalTitle)}</h3>
<p class="chapter-by">Proposed by ${seatLine(idea.proposer)} ${stamp(ruling.verdict)}</p></header>
<blockquote class="pull">${rich(chapter.pullQuote)}</blockquote>
${whereBlock(placesOf(idea.thread).length ? placesOf(idea.thread) : (idea.where ?? []).map((w) => ({ ...w, file: null })), { heading: false })}
${scenes}
<div class="ruling ruling-${esc(ruling.verdict)}"><p class="ruling-head">The ruling ${stamp(ruling.verdict)}</p>${detail}</div>
</article>`;
}

export function buildDiscussionHtml({ model, discussion, parts = () => [] }) {
  const usedEvidence = new Set();
  const ordered = discussion.chapters.filter((c) => model.ideas.some((i) => i.thread === c.thread));
  // In the minutes an idea is "chapter IV": short enough to stand inside a sentence, and the reader can turn to it.
  const plain = (text) => readerText(text, (id) => { const at = ordered.findIndex((c) => c.thread === id); return at >= 0 ? `chapter ${roman(at + 1)}` : null; });
  const chapters = ordered.map((c, i) => chapterHtml(model, c, i + 1, usedEvidence, plain, parts)).join('\n');
  const ideaOf = (thread) => model.ideas.find((i) => i.thread === thread);
  const present = model.cast.map((s) => `<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.title)}</td><td>${esc(s.temper ?? '')}</td></tr>`);

  const first = `<section class="glance">
<p class="eyebrow">Minutes of the library</p>
<h2 class="evening">${esc(discussion.title)}</h2>
<p class="goal-line"><b>The question before the house:</b> ${esc(model.session.goal)}</p>
<div class="opening">${paras(discussion.opening)}</div>
<p class="note">These minutes are an edit of the record of a council session. Each character speaks for one seat at the table; the characters are invented, and what they say is what was said from that seat. Facts and numbers are those of the record.</p>
</section>`;

  // The front gives the outcome in a few lines; the idea-by-idea list is the résumé at the end, after the story.
  const brief = `<section class="brief"><h2>The evening in brief</h2>
${countChips(model)}
${discussion.brief ? `<div class="opening brief-text">${paras(plain(discussion.brief))}</div>` : ''}
<h3>Present</h3>
${table('present', ['Name', 'Seat', 'Manner'], present)}
</section>`;

  const resume = `<section class="resume"><h2>The evening in sum</h2>
<p class="lead">Every idea that was heard, in the order of the chapters, with what became of it.</p>
${table('brief-table', ['Chapter', 'The idea', 'Proposed by', 'Verdict'], ordered.map((c, i) => { const idea = ideaOf(c.thread); return `<tr><td class="no">${roman(i + 1)}</td><td><b>${esc(idea.originalTitle)}</b><span class="sub">${rich(c.line)}</span></td><td>${esc(idea.proposer.name)}<span class="sub">${esc(idea.proposer.title)}</span></td><td>${stamp(idea.verdict)}</td></tr>`; }))}
${model.refused.length || model.merged.length ? `<h3>Not admitted to the table</h3>${table('refused', ['Idea', 'Why'], [...model.refused.map((x) => `<tr><td>${esc(x.title)}</td><td>${rich(x.reason)}</td></tr>`), ...model.merged.map((x) => `<tr><td>${esc(x.title)}</td><td>The same idea as “${esc(x.into)}”, and debated with it.</td></tr>`)])}` : ''}
</section>`;

  const memoriam = model.killed.length ? `<section class="memoriam"><h2>In memoriam</h2>
${discussion.memoriam ? `<div class="opening">${paras(discussion.memoriam)}</div>` : ''}
${table('killed', ['Idea', 'Cause of death'], model.killed.map((i) => `<tr><td><b>${esc(i.originalTitle)}</b></td><td>${rich(plain(i.ruling.causeOfDeath))}</td></tr>`))}
</section>` : '';

  const before = model.undecided.length || model.questions.length ? `<section class="before"><h2>Still before the house</h2>
${model.undecided.length ? table('undecided', ['Undecided', 'What would decide it'], model.undecided.map((i) => `<tr><td><b>${esc(i.originalTitle)}</b></td><td>${rich(plain(i.ruling.wouldDecide))}</td></tr>`)) : ''}
${model.questions.length ? `<h3>Questions nobody in the room could answer</h3><ol class="questions">${model.questions.map((q) => `<li>${rich(plain(q.text))} <span class="sub">Raised on “${esc(model.ideas.find((i) => i.thread === q.thread)?.originalTitle ?? q.idea)}”.</span></li>`).join('')}</ol>` : ''}
</section>` : '';

  const closing = `<section class="closing"><h2>The house rises</h2><div class="opening">${paras(discussion.closing)}</div></section>`;

  const cited = model.ideas.flatMap((i) => i.evidence).filter((e, i, all) => usedEvidence.has(e.id) && all.findIndex((x) => x.id === e.id) === i).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  const appendix = cited.length ? `<section class="appendix"><h2>The evidence cited</h2>
<p class="lead">What the speakers pointed to, by its number in the record.</p>
${table('evidence-table', ['No.', 'What was seen or measured', 'Source'], cited.map((e) => `<tr><td class="ev-id">${esc(e.id)}</td><td>${esc(plain(evidenceText(e)))}</td><td class="ev-src">${esc(e.grade)}${e.source ? `<br>${sourceLink(e.source)}` : ''}</td></tr>`))}
</section>` : '';

  return page({ title: 'Council · The discussion', kind: 'discussion', model, body: [first, brief, `<section class="chapters">${chapters}</section>`, memoriam, before, closing, resume, appendix].join('\n') });
}
