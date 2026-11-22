import { esc, rich, page, countChips, tag, stamp, whereBlock, roman } from './html.mjs';
import { namer, ideaTags, killedRows } from './brief.mjs';

// The venture board's own document: the bets. Each surviving bet opens as a press release from the day it worked,
// with the questions a sceptical reader would ask, then what would have to be true (the riskiest marked), the cheapest
// first step that would show whether it is, what it is worth if it works and when to drop it. Then the bets that were
// not proved, the killed ones with the best that could be said for them, the frame the board worked from, and the
// provocation wall: every deliberately absurd statement, with what was harvested from it.

const UPSIDE_NOTE = {
  incremental: 'Improves what the business already does.',
  significant: 'Opens a new line of work, a new kind of client or a new channel.',
  transformative: 'Changes what kind of business this is.',
};
const row = (label, html) => (html ? `<div><dt>${esc(label)}</dt><dd>${html}</dd></div>` : '');
const list = (items) => (items?.length ? `<ul>${items.map((x) => `<li>${rich(x)}</li>`).join('')}</ul>` : '');

// Where a bet came from, in words: the framing it answers, the cards it was dealt, or the provocation it harvests.
export function originLine(idea, frame, cards = []) {
  const b = idea.bet;
  if (!b) return '';
  const byId = new Map(cards.map((c) => [c.id, c]));
  const framing = b.answers ? [...(frame?.frame?.questions ?? []), ...(frame?.frame?.contradictions ?? []).map((c) => ({ id: c.id, text: `${c.want}, but then ${c.butThen}` }))].find((x) => x.id === b.answers) : null;
  const provocation = b.provocation ? (frame?.provocations ?? []).find((p) => p.id === b.provocation) : null;
  const parts = [
    framing ? `It answers “${framing.text}”` : '',
    b.cards?.length ? `with the card${b.cards.length > 1 ? 's' : ''} ${b.cards.map((id) => `“${byId.get(id)?.name ?? id}”`).join(' and ')}` : '',
    provocation ? `It was harvested from the provocation “${provocation.text}”` : '',
    b.amplified ? 'Another seat made it bigger before the debate, and that form was debated' : '',
  ].filter(Boolean);
  return parts.length ? `${parts.join(' ')}.`.replace(/ with /, ', with ') : '';
}

// One surviving bet, in full. `n` is its number in this document.
export function betArticle(idea, s, n, { frame, cards, parts = () => [], plain }) {
  const b = idea.bet ?? { assumptions: [], riskiest: -1 };
  const pr = s.pressRelease ?? null;
  const press = pr ? `<div class="press"><p class="press-kicker">From the future: the day it worked</p><h4 class="press-head">${esc(pr.headline)}</h4><p class="press-sub">${rich(pr.subhead)}</p><p>${rich(pr.body)}</p><blockquote class="press-quote">${rich(pr.quote)}</blockquote></div>` : '';
  const faq = s.faq?.length ? `<div class="faq"><h5>Questions a sceptic would ask</h5><dl>${s.faq.map((f) => `<dt>${rich(f.q)}</dt><dd>${rich(f.a)}</dd>`).join('')}</dl></div>` : '';
  const assumptions = b.assumptions.length ? `<ol class="must">${b.assumptions.map((a, i) => `<li${i === b.riskiest ? ' class="riskiest"' : ''}>${rich(plain(a))}${i === b.riskiest ? ' <span class="tag tag-riskiest">riskiest, as proposed</span>' : ''}</li>`).join('')}</ol>` : '';
  const places = parts(idea.thread);
  return `<article class="idea bet-article" id="idea-${esc(idea.id)}">
<header class="idea-head"><p class="idea-no">${n}</p><div><h3>${esc(plain(idea.title))}</h3>
<p class="tags">${ideaTags(idea)}${b.upside ? tag(`${b.upside} if it works`, `upside-${b.upside}`) : ''}</p></div></header>
<p class="lede">${rich(s.sentence)}</p>
${press}
<dl class="decide">
${row('First step', `<p>${rich(s.firstStep)}</p>`)}
${row('If it works', `<p>${rich(s.upside)}</p>${b.upside ? `<p class="meta">${esc(UPSIDE_NOTE[b.upside])}</p>` : ''}`)}
${row('Riskiest now', b.riskiestNow ? `<p>${rich(plain(b.riskiestNow))}</p>` : '')}
${row('Drop it if', `<p>${rich(s.killCondition)}</p>`)}
${row('Needs from you', s.fromYou === undefined ? '' : s.fromYou.length ? list(s.fromYou) : '<p>Nothing beyond the go-ahead.</p>')}
${row('Also needs', list(s.needs))}
</dl>
<div class="field"><h5>What would have to be true</h5>${assumptions}</div>
<div class="field"><h5>Why it could work</h5><p>${rich(s.why)}</p></div>
${faq}
${places.length ? whereBlock(places) : ''}
<p class="meta idea-foot">${esc(originLine(idea, frame, cards))} Idea ${esc(idea.id.slice(1))} in the ledger.</p>
</article>`;
}

export function buildBetsHtml({ model, suggestions, frame, cards = [], parts = () => [] }) {
  const plain = namer(model);
  const written = new Map((suggestions.survivors ?? []).map((s) => [s.idea, s]));
  const dead = new Map((suggestions.killed ?? []).map((k) => [k.idea, k]));
  const betText = new Map((suggestions.bets ?? []).map((b) => [b.idea, b]));
  const noOfId = new Map(model.survivors.map((idea, i) => [idea.id, i + 1]));
  const steps = (suggestions.plan ?? []).filter((p) => p.ideas.some((id) => noOfId.has(id))).map((p) => `<li>${rich(plain(p.text))} <span class="refs">${p.ideas.filter((id) => noOfId.has(id)).map((id) => `<a href="#idea-${esc(id)}">bet ${noOfId.get(id)}</a>`).join(', ')}</span></li>`);

  const glance = `<section class="glance">
<p class="eyebrow">The question</p>
<p class="goal">${esc(model.session.goal)}</p>
<p class="verdict">${rich(suggestions.summary)}</p>
${countChips(model)}
${steps.length ? `<div class="start"><h2>Where to start</h2><ol>${steps.join('')}</ol></div>` : ''}
</section>`;

  const bets = model.survivors.length ? `<section class="ideas"><h2>The bets worth a first step</h2>
<p class="lead">Each is a bet, not a plan: it says what would have to be true, and the cheapest step that would show whether it is. None is ranked above another.</p>
${model.survivors.map((idea, i) => betArticle(idea, written.get(idea.id) ?? {}, i + 1, { frame, cards, parts, plain })).join('\n')}
</section>` : '<section class="ideas"><h2>The bets worth a first step</h2><p class="lead">No bet survived the sceptic this time. What fell, and what would make it worth trying, is below.</p></section>';

  const other = (idea, rows) => `<div class="bet"><p class="bet-head"><b>${esc(plain(idea.originalTitle ?? idea.title))}</b> ${ideaTags(idea)} ${stamp(idea.verdict)}</p>
${betText.get(idea.id) ? `<p>${rich(betText.get(idea.id).sentence)}</p>` : `<p>${rich(plain(idea.hypothesis.change))}</p>`}
<dl class="decide">${rows}</dl>
<p class="meta">${esc(originLine(idea, frame, cards))}</p></div>`;
  const notNow = model.undecided.length ? `<section class="open"><h2>Not now</h2>
<p class="lead">The debate could not settle these. Each says what would make it worth trying.</p>
${model.undecided.map((idea) => other(idea, `${betText.get(idea.id) ? row('Worth trying if', `<p>${rich(betText.get(idea.id).worthIt)}</p>`) : ''}${row('What would decide it', `<p>${rich(plain(idea.ruling.wouldDecide))}</p>`)}${idea.ruling.riskiest ? row('Riskiest', `<p>${rich(plain(idea.ruling.riskiest))}</p>`) : ''}`)).join('\n')}
</section>` : '';
  const killed = model.killed.length ? `<section class="graveyard"><h2>Killed</h2>
<p class="lead">An assumption each of these rests on was shown false, with the best that could be said for them.</p>
${model.killed.map((idea) => other(idea, `${killedRows(idea, dead.get(idea.id), plain, { bet: Boolean(betText.get(idea.id)) })}${betText.get(idea.id) ? row('Worth trying if', `<p>${rich(betText.get(idea.id).worthIt)}</p>`) : ''}`)).join('\n')}
</section>` : '';

  const f = frame?.frame;
  const picked = new Set(frame?.picked ?? []);
  const framed = f ? `<section class="set"><h2>The frame</h2>
<p class="lead">What the venture board worked from, before anyone proposed.${frame?.picked?.length ? ' The framings you picked are marked.' : ''}</p>
<h4>The ideal result</h4><p>${rich(f.ideal)}</p>
<h4>Where the business is, and the step after</h4><p>${rich(f.curve.now)} ${rich(f.curve.next)}</p>
<h4>Contradictions</h4><ul>${f.contradictions.map((c) => `<li>${picked.has(c.id) ? '<b>Picked.</b> ' : ''}${rich(c.want)}, but then ${rich(c.butThen)}. <span class="meta">Separated: ${rich(c.separate)}</span></li>`).join('')}</ul>
<h4>How might we</h4><ul>${f.questions.map((q) => `<li>${picked.has(q.id) ? '<b>Picked.</b> ' : ''}${rich(q.text)} <span class="meta">${esc(q.altitude)}</span></li>`).join('')}</ul>
<h4>What the business has and does not use</h4>${list(f.resources)}
</section>` : '';

  const harvested = (id) => model.ideas.filter((i) => i.bet?.provocation === id);
  const wall = frame?.provocations?.length ? `<section class="set"><h2>The provocation wall</h2>
<p class="lead">Deliberately absurd statements, written to be mined for what is workable in them, and what was harvested from each.</p>
<table class="wall"><thead><tr><th scope="col">Provocation</th><th scope="col">Harvested</th></tr></thead><tbody>${frame.provocations.map((p) => `<tr><td>${rich(p.text)}<span class="sub">${esc(p.kind)}</span></td><td>${harvested(p.id).map((i) => `${esc(plain(i.title))} ${stamp(i.verdict)}`).join('<br>') || '<span class="meta">Nothing harvested.</span>'}</td></tr>`).join('')}</tbody></table>
</section>` : '';

  const questions = suggestions.questions ?? [];
  const asks = questions.length ? `<section class="open" id="questions"><h2>Questions only you can answer</h2><ol class="questions">${questions.map((q) => `<li>${rich(q.text)}</li>`).join('')}</ol></section>` : '';
  const method = `<section class="method" id="method"><h2>How the venture board works</h2>
<p class="lead">A framer set the problem (the ideal result, the contradictions of the business, what it has and does not use, where it is on its curve, and "how might we" questions, two of which question the goal itself). A provocateur wrote deliberately absurd statements. Each seat answered its framings with cards dealt to it (inventive principles, ways to separate a contradiction, business-model patterns, moves that eliminate, reduce, raise or create, and other trades), then harvested the provocations. Another seat made every bet bigger before anyone attacked it. A sceptic then attacked what each bet assumes, never the bet as a whole, and a judge who took no part ruled on what it is worth if it works and what it rests on.</p>
<p class="meta">Session ${esc(model.session.id)}. ${esc(model.session.runs)} of ${esc(model.session.budget)} agent runs were used. The full record is kept with the session; the session's pages show it bet by bet.</p></section>`;
  return page({ title: 'Venture board · The bets', kind: 'suggestions bets-doc', model, body: [glance, bets, notNow, killed, framed, wall, asks, method].filter(Boolean).join('\n') });
}

export { roman };
