import { esc, rich, readerText, page, countChips, tag, stamp } from './html.mjs';

// ---- The decision brief ----
// For whoever decides, with minutes to spare: every idea the council looked at, each in a few lines, and nothing
// ranked. The survivors carry what to decide on (the first step, what to expect, what it is worth if it works, when to
// drop it, what it needs from you); the bold ideas that fell say what would make them worth trying; every killed idea
// says what it was and why it fell. The full case for each idea is in the suggestions and on the idea's own page.
// The same sections are the first page of the session's site.

const row = (label, html) => (html ? `<div><dt>${esc(label)}</dt><dd>${html}</dd></div>` : '');
const list = (items) => (items?.length ? `<ul>${items.map((x) => `<li>${rich(x)}</li>`).join('')}</ul>` : '');

// Whose session this is: the council's or the invention lab's.
export const labelOf = (model) => (model.session.kind === 'lab' ? 'Invention lab' : 'Council');

// In the brief a survivor is "idea 3", its number in the list; any other idea is named by its title.
export function namer(model) {
  const numberOf = new Map(model.survivors.map((idea, i) => [idea.thread, i + 1]));
  return (text) => readerText(text, (id) => (numberOf.has(id) ? `idea ${numberOf.get(id)}` : model.ideas.find((i) => i.thread === id) ? `“${model.ideas.find((i) => i.thread === id).title}”` : null));
}

export const ideaTags = (idea) => `${idea.scale ? tag(idea.scale, `scale-${idea.scale}`) : ''}${idea.novelty === 'fresh' ? tag('fresh', 'fresh') : ''}${idea.strength ? tag(`${idea.strength} support`, idea.strength) : ''}${idea.effort ? tag(`${idea.effort} effort`) : ''}`;

// The analysis of a killed idea, or the judge's cause of death when the writer gave none (an older session). For a
// bet the sentence above it already says what it was, and what would make it worth trying says whether it could return.
export function killedRows(idea, analysis, plain, { bet = false } = {}) {
  if (!analysis) return row('Why it fell', `<p>${rich(plain(idea.ruling.causeOfDeath))}</p>`);
  return [
    bet ? '' : row('What it was', `<p>${rich(analysis.what)}</p>`),
    row('Its strongest point', `<p>${rich(analysis.strongestPoint)}</p>`),
    row('Killed by', `<p>${rich(analysis.killedBy)}</p>`),
    bet ? '' : row('Could it return', `<p>${rich(analysis.couldReturn)}</p>`),
  ].join('');
}

// `ideaHref` links each idea to its own page (on the session's site); without it the titles are plain text.
export function briefSections({ model, suggestions, ideaHref = null, more = '' }) {
  const plain = namer(model);
  const noOfId = new Map(model.survivors.map((idea, i) => [idea.id, i + 1]));
  const titleOf = (idea) => (ideaHref ? `<a class="idea-link" href="${esc(ideaHref(idea))}">${esc(plain(idea.title))}</a>` : `<b>${esc(plain(idea.title))}</b>`);
  const written = new Map((suggestions.survivors ?? []).map((s) => [s.idea, s]));
  const dead = new Map((suggestions.killed ?? []).map((k) => [k.idea, k]));
  const betText = new Map((suggestions.bets ?? []).map((b) => [b.idea, b]));
  const head = (idea, n = null) => `<p class="b-head">${n ? `<span class="b-no">${n}</span>` : ''}<span class="b-title">${titleOf(idea)} ${stamp(idea.verdict)}</span></p>\n<p class="tags">${ideaTags(idea)}</p>`;

  const plan = (suggestions.plan ?? []).filter((p) => p.ideas.some((id) => noOfId.has(id)));
  const steps = plan.map((p) => `<li>${rich(plain(p.text))} <span class="refs">${p.ideas.filter((id) => noOfId.has(id)).map((id) => noOfId.get(id)).sort((a, b) => a - b).map((n) => `idea ${n}`).join(', ')}</span></li>`);
  const glance = `<section class="glance b-glance">
<p class="eyebrow">The goal</p>
<p class="goal">${esc(model.session.goal)}</p>
<p class="verdict">${rich(suggestions.summary)}</p>
${countChips(model)}
${steps.length ? `<div class="start"><h2>Where to start</h2><ol>${steps.join('')}</ol></div>` : ''}
</section>`;

  const n = model.survivors.length;
  const survivors = `<section class="b-part"><h2>${model.session.kind === 'lab' ? 'The bets worth a first step' : 'The ideas that survived'}</h2>
${n ? `<p class="lead">${n === 1 ? 'The one idea' : `All ${n} ideas`} that survived the debate, none ranked above another: new things first, then remakes, additions and adjustments. Each is a test to run, not a result.</p>
${model.survivors.map((idea, i) => {
    const s = written.get(idea.id) ?? {};
    const fromYou = s.fromYou === undefined ? '' : s.fromYou.length ? list(s.fromYou) : '<p>Nothing beyond the go-ahead.</p>';
    return `<article class="b-idea" id="b-${esc(idea.id)}">
${head(idea, i + 1)}
${s.sentence ? `<p class="b-lede">${rich(s.sentence)}</p>` : ''}
<dl class="decide b-facts">${row('First step', s.firstStep ? `<p>${rich(s.firstStep)}</p>` : '')}${s.upside ? '' : row('Expect', s.expected ? `<p>${rich(s.expected)}</p>` : '')}${row('If it works', s.upside ? `<p>${rich(s.upside)}</p>` : '')}${row('Drop it if', s.killCondition ? `<p>${rich(s.killCondition)}</p>` : '')}${row('Needs from you', fromYou)}</dl>
</article>`;
  }).join('\n')}` : '<p class="lead">No idea survived this session. What fell, and why, is below.</p>'}
</section>`;

  const betsList = model.bets ?? [];
  const lab = model.session.kind === 'lab';
  const bets = betsList.length ? `<section class="b-part"><h2>${lab ? 'Bets the lab could not prove' : 'Bold ideas the council could not prove'}</h2>
<p class="lead">Each reaches beyond what the business does today. A bet often falls for want of evidence that only trying it would give.</p>
${betsList.map((idea) => {
    const b = betText.get(idea.id);
    // What would make an undecided bet worth trying already says what would decide it; the judge's line is the fallback.
    const fate = idea.verdict === 'killed' ? killedRows(idea, dead.get(idea.id), plain, { bet: Boolean(b) }) : b ? '' : row('What would decide it', `<p>${rich(plain(idea.ruling.wouldDecide))}</p>`);
    return `<article class="b-idea b-other">
${head(idea)}
${b ? `<p class="b-lede">${rich(b.sentence)}</p>` : ''}
<dl class="decide b-facts">${b ? row('Worth trying if', `<p>${rich(b.worthIt)}</p>`) : ''}${fate}</dl>
</article>`;
  }).join('\n')}
</section>` : '';

  const undecided = model.undecided.filter((i) => !betsList.includes(i));
  const open = undecided.length ? `<section class="b-part"><h2>${lab ? 'Not now' : 'Undecided'}</h2>
<p class="lead">The debate could not settle these: each turns on something nobody present could know.</p>
${undecided.map((idea) => `<article class="b-idea b-other">
${head(idea)}
<p class="b-lede">${rich(plain(idea.hypothesis.change))}</p>
<dl class="decide b-facts">${row('What would decide it', `<p>${rich(plain(idea.ruling.wouldDecide))}</p>`)}</dl>
</article>`).join('\n')}
</section>` : '';

  const killed = model.killed.filter((i) => !betsList.includes(i));
  const graves = killed.length ? `<section class="b-part"><h2>Killed</h2>
<p class="lead">Every other idea the council looked at and turned down, with the best that could be said for it.</p>
${killed.map((idea) => `<article class="b-idea b-other">
${head(idea)}
<dl class="decide b-facts">${killedRows(idea, dead.get(idea.id), plain)}</dl>
</article>`).join('\n')}
</section>` : '';

  const questions = suggestions.questions ?? [];
  const asks = questions.length ? `<section class="b-part" id="questions"><h2>Questions only you can answer</h2>
<p class="lead">Nobody in the session could answer these. An answer lets the next session take the idea up again.</p>
<ol class="questions">${questions.map((q) => `<li>${rich(q.text)}</li>`).join('')}</ol></section>` : '';
  return [glance, survivors, bets, open, graves, asks, more].filter(Boolean).join('\n');
}

export function buildBriefHtml({ model, suggestions }) {
  const more = `<section class="b-part b-more"><h2>Where the rest is</h2>
<p class="lead">In the session folder, beside this brief:</p>
<ul>
${model.session.kind === 'lab' ? '<li><b>bets.pdf</b>: each bet in full: the press release from the day it worked, what would have to be true, the first step; the frame and the provocation wall.</li>' : '<li><b>suggestions.pdf</b>: the full case for each idea that survived: why it should work, how to test it, what it survived.</li>\n<li><b>discussion.pdf</b>: the debate, idea by idea.</li>'}
<li><b>site/index.html</b>: all of it as linked pages, one page per idea, with its argument and the evidence it rests on.</li>
</ul></section>`;
  return page({ title: `${labelOf(model)} · Decision brief`, kind: 'decision-brief', model, body: briefSections({ model, suggestions, more }) });
}
