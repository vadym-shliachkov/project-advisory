import { esc, rich, page, countChips, tag, stamp, whereBlock, table, sourceLink, shortAddress } from './html.mjs';
import { namer, ideaTags, killedRows } from './brief.mjs';
import { originLine } from './venturedoc.mjs';
import { grownFrom, frameSection } from './inventdoc.mjs';
import { OBJECT_WORDS } from './object.mjs';
import { STUDIO_SCALE_WORDS, MADE_WORDS, SIGNATURE_WORDS, SIGNATURE_RULING_WORDS, SWAP_WORDS, STUDIO_NEW_TO_WORDS, STUDIO_FEASIBLE_WORDS } from './direction.mjs';
import { SHARE_WORDS } from './field.mjs';

// The design studio's own document: the directions. Each one that survived opens with a decision box, then the tile
// (a picture of the working page, with where to open it), what a stranger saw in it, the idea, the design it leads to,
// the signature moment and the judge's ruling on it, the values of the tile, the habits of the trade it keeps and
// breaks, what of the business it is made of, how a visitor would live it, why it is not a copy, what it survived and
// what is still uncertain. Then the directions not settled and the killed ones, what the studio found in the field
// (what wins awards now, what the trade's sites do, what a template site looks like), what it understood about the
// business, the frame, and the method.

const UPSIDE_NOTE = {
  incremental: 'The site says what it says today, better.',
  significant: 'The site becomes a reason to choose this business.',
  transformative: 'The site changes what people take this business to be.',
};
const row = (label, html) => (html ? `<div><dt>${esc(label)}</dt><dd>${html}</dd></div>` : '');
const list = (items) => (items?.length ? `<ul>${items.map((x) => `<li>${rich(x)}</li>`).join('')}</ul>` : '');
const PRIOR = { yes: 'Something like it exists', partly: 'Something close to it exists', no: 'Nothing like it was found' };

// The tags of a direction: how far it reaches, how new and how well supported (the council's tags), with what it is
// made from, the swap test, how far the web is from doing it and what it is worth if it works.
export function directionTags(idea) {
  const r = idea.direction?.ruled ?? {};
  const made = r.madeFrom ?? idea.direction?.madeFrom;
  return `${ideaTags(idea)}${made ? tag(`made from: ${made === 'far-field' ? 'a far field' : made === 'material' ? 'its own material' : made === 'idea' ? 'one idea' : 'an assembly'}`, `made-${made}`) : ''}${r.swap ? tag(r.swap === 'own' ? 'its own' : r.swap === 'sector' ? 'fits a rival' : 'fits anyone', `swap-${r.swap}`) : ''}${idea.invention?.feasible ? tag(`feasible: ${idea.invention.feasible}`, `feasible-${idea.invention.feasible}`) : ''}${idea.bet?.upside ? tag(`${idea.bet.upside} if it works`, `upside-${idea.bet.upside}`) : ''}`;
}

// The tile of a direction: its picture on a desktop and on a narrow screen, and where the working page is. `at` turns
// a path in the session folder into one the page can reach (the session's site sits one folder down).
export function tileFigure(tile, pictures, at = (rel) => rel) {
  if (!tile) return '<p class="meta">No tile was built for this direction.</p>';
  const shots = ['desktop', 'narrow'].filter((v) => pictures?.[v]).map((v) => `<a class="tile-shot tile-${v}" href="${esc(at(tile.file))}"><img src="${esc(at(pictures[v]))}" alt="${esc(`The tile on a ${v === 'desktop' ? 'desktop' : 'narrow'} screen: ${tile.caption}`)}"></a>`).join('');
  return `<figure class="tile">${shots ? `<div class="tile-shots">${shots}</div>` : ''}<figcaption>${esc(tile.caption)} <span class="meta">${shots ? 'A still picture: the tile itself moves.' : 'The tile was not photographed.'} Open <a href="${esc(at(tile.file))}">${esc(tile.file)}</a> in a browser to see it. ${rich(tile.shows)} A tile shows whether the idea holds: one screen and one moment, not a finished design.</span></figcaption></figure>`;
}

export function tokensBlock(tile) {
  if (!tile) return '';
  const t = tile.tokens;
  const swatches = t.colours.map((c) => `<li><span class="swatch" style="background:${esc(c.value)}"></span><b>${esc(c.name)}</b> <code>${esc(c.value)}</code><span class="sub">${rich(c.use)}</span></li>`).join('');
  return `<div class="field field-long"><h5>The values of the tile</h5>
<ul class="swatches">${swatches}</ul>
${table('tokens', ['Type', 'Family', 'From', 'Used for'], t.type.map((f) => `<tr><td>${esc(f.role)}</td><td><b>${esc(f.family)}</b></td><td class="meta">${esc(f.source)}</td><td>${rich(f.use)}</td></tr>`))}
${t.motion.length ? table('tokens', ['Movement', 'Duration', 'Easing', 'Used for'], t.motion.map((m) => `<tr><td><b>${esc(m.name)}</b></td><td>${esc(m.duration)}</td><td class="meta">${esc(m.easing)}</td><td>${rich(m.use)}</td></tr>`)) : '<p class="meta">Nothing moves in this direction.</p>'}
<h5>The rules of this direction</h5>${list(t.rules)}</div>`;
}

export function eyeBlock(eye, revised = false) {
  if (!eye) return '';
  const swap = { own: 'With another business\'s name on it, it would be wrong.', sector: 'It would fit any business of this kind.', anyone: 'It would fit almost any business.' }[eye.swap];
  return `<div class="field stranger"><h5>What a stranger saw in the tile</h5>
<p class="meta">A reviewer who was told nothing about the business or the idea looked at the pictures of the tile.${revised ? ' The tile was revised after this look, to answer it, and nobody has looked at the revised tile: the picture above is the revised one.' : ''}</p>
<dl class="decide">
${row('Took it to be for', `<p>${rich(eye.guess)}</p>`)}
${row('The swap test', `<p>${esc(swap)}</p>`)}
${row('It brought to mind', `<p>${rich(eye.remindsOf)}</p>`)}
${row('Read as a template', eye.tells.length ? list(eye.tells) : '<p>Nothing.</p>')}
${row('Its own', `<p>${rich(eye.works)}</p>`)}
${row('To change', eye.issues.length ? list(eye.issues.map((x) => `**${x.severity}**: ${x.what}`)) : '')}
</dl></div>`;
}

// One surviving direction, in full. `n` is its number in this document.
export function directionArticle(idea, s, n, { frame, cards, parts = () => [], plain, anatomy, tiles = [], pictures = () => ({}), eye = null, at = (rel) => rel, handoff = true }) {
  const b = idea.bet ?? { assumptions: [], riskiest: -1 };
  const inv = idea.invention ?? {};
  const dir = idea.direction ?? {};
  const d = dir.design ?? {};
  const ruled = dir.ruled ?? {};
  const g = d.signature ?? {};
  const tile = tiles.find((k) => k.idea === idea.id) ?? null;
  const seen = (eye?.tiles ?? []).find((k) => k.idea === idea.id) ?? null;
  const assumptions = b.assumptions.length ? `<ol class="must">${b.assumptions.map((a, i) => `<li${i === b.riskiest ? ' class="riskiest"' : ''}>${rich(plain(a))}${i === b.riskiest ? ' <span class="tag tag-riskiest">riskiest, as proposed</span>' : ''}</li>`).join('')}</ol>` : '';
  const steps = s.experience ?? inv.experience ?? [];
  const pa = idea.priorArt;
  const places = parts(idea.thread);
  const fromYou = s.fromYou === undefined ? '' : s.fromYou.length ? list(s.fromYou) : '<p>Nothing beyond the go-ahead.</p>';
  const design = [['Type', d.type], ['Colour', d.colour], ['Layout', d.layout], ['Imagery', d.imagery], ['Motion', d.motion], ['Technology', d.technology]].filter(([, v]) => v);
  const made = ruled.madeFrom ?? dir.madeFrom;
  const whole = ruled.whole ?? dir.whole;
  const signature = g.kind === 'none'
    ? `<p><b>None.</b> ${rich(g.why)}</p>`
    : `<p><b>${esc(SIGNATURE_WORDS[g.kind] ?? g.kind)}</b></p><dl class="decide">${row('What happens', `<p>${rich(plain(g.what))}</p>`)}${row('Why this site', `<p>${rich(plain(g.why))}</p>`)}${row('On the tenth visit', `<p>${rich(plain(g.tenth))}</p>`)}</dl>`;
  return `<article class="idea invention direction" id="idea-${esc(idea.id)}">
<header class="idea-head"><p class="idea-no">${n}</p><div><h3>${esc(plain(idea.title))}</h3>
<p class="tags">${directionTags(idea)}</p></div></header>
<p class="lede">${rich(s.sentence)}</p>
${tileFigure(tile, pictures(idea.id), at)}
<dl class="decide">
${row('First step', s.firstStep ? `<p>${rich(s.firstStep)}</p>` : '')}
${row('What to build first', s.prototype ? `<p>${rich(s.prototype)}</p>` : '')}
${row('If it works', s.upside ? `<p>${rich(s.upside)}</p>${b.upside ? `<p class="meta">${esc(UPSIDE_NOTE[b.upside])}</p>` : ''}` : '')}
${row('Riskiest now', b.riskiestNow ? `<p>${rich(plain(b.riskiestNow))}</p>` : '')}
${row('Drop it if', s.killCondition ? `<p>${rich(s.killCondition)}</p>` : '')}
${row('Needs from you', fromYou)}
${row('The business must supply', list(d.needs))}
${row('Also needs', list(s.needs))}
</dl>
${eyeBlock(seen, (eye?.revisedAfter ?? []).includes(idea.id))}
<div class="field"><h5>The idea</h5><p>${rich(plain(idea.hypothesis.change))}</p><p><b>Why this business:</b> ${rich(plain(idea.hypothesis.because))}</p></div>
${grownFrom(idea, anatomy).length ? `<div class="field"><h5>What of the business it is made of</h5>${made ? `<p class="meta">${esc(MADE_WORDS[made])}${whole ? ` ${rich(plain(whole))}` : ''}</p>` : ''}${list(grownFrom(idea, anatomy))}</div>` : ''}
${design.length ? `<div class="field field-long"><h5>The design it leads to</h5>${table('design', ['', 'What the idea chooses'], design.map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${rich(plain(v))}</td></tr>`))}</div>` : ''}
<div class="field"><h5>The signature moment</h5>${signature}${ruled.signature ? `<p class="meta">The judge's ruling: ${esc(SIGNATURE_RULING_WORDS[ruled.signature])}</p>` : ''}</div>
${tokensBlock(tile)}
${d.keeps?.length ? `<div class="field"><h5>What it keeps of how sites of this trade work, and what it breaks</h5><p class="meta">Kept, because visitors rely on it:</p>${list(d.keeps)}<p class="meta">Broken, on purpose:</p>${list((d.breaks ?? []).map((x) => `**${x.what}**: ${x.why}`))}</div>` : ''}
${steps.length ? `<div class="field"><h5>How a visitor would live it</h5><ol class="experience">${steps.map((x) => `<li>${rich(plain(x))}</li>`).join('')}</ol></div>` : ''}
<div class="field"><h5>Why it is not a copy</h5>${s.whyNew ? `<p>${rich(s.whyNew)}</p>` : ''}${inv.newTo ? `<p class="meta">The judge's ruling: ${esc(STUDIO_NEW_TO_WORDS[inv.newTo])}${ruled.swap ? ` ${esc(SWAP_WORDS[ruled.swap])}` : ''}${inv.feasible ? ` ${esc(STUDIO_FEASIBLE_WORDS[inv.feasible])}` : ''}</p>` : ''}${pa ? `<p class="meta">${esc(PRIOR[pa.exists] ?? pa.exists)}${pa.who ? `: ${rich(pa.who)}` : ''}. Looked for: ${rich(pa.searched)}</p>` : ''}</div>
<div class="field"><h5>Why it could work</h5>${s.why ? `<p>${rich(s.why)}</p>` : ''}</div>
<div class="field"><h5>What would have to be true</h5>${assumptions}</div>
${s.survived?.length ? `<div class="field"><h5>What it survived</h5><dl class="survived">${s.survived.map((x) => `<dt>${rich(x.attack)}</dt><dd>${rich(x.answer)}</dd>`).join('')}</dl></div>` : ''}
${s.uncertain?.length ? `<div class="field"><h5>Still uncertain</h5>${list(s.uncertain)}</div>` : ''}
${s.fitsWith ? `<div class="field"><h5>Fits with</h5><p>${rich(s.fitsWith)}</p></div>` : ''}
${places.length ? whereBlock(places) : ''}
<p class="meta idea-foot">${esc(originLine(idea, frame, cards))} Idea ${esc(idea.id.slice(1))} in the ledger.${handoff && tile ? ` For whoever builds it: <a href="${esc(at(`handoff/${idea.id}.md`))}">handoff/${esc(idea.id)}.md</a>.` : ''}</p>
</article>`;
}

// What the studio found in the field before anyone designed.
export function fieldSection({ currents = null, slop = null, genre = null }) {
  const c = currents?.currents;
  const x = slop?.slop;
  const g = genre?.genre;
  if (!c && !x && !g) return '';
  const tally = new Map();
  for (const s of c?.sample ?? []) for (const t of s.technology) tally.set(t, (tally.get(t) ?? 0) + 1);
  const built = [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const order = ['everywhere', 'common', 'rising', 'rare'];
  const patterns = [...(c?.patterns ?? [])].sort((a, b) => order.indexOf(a.share) - order.indexOf(b.share));
  return `<section class="set field-found" id="field"><h2>What the studio found in the field</h2>
<p class="lead">Looked at before anyone designed, to know what visitors have already seen. The designers were given the patterns without the sites: a direction is not made by joining these, and one that turned out to be a site that exists was killed in the debate.</p>
${c ? `<h4>What wins awards now</h4><p>${rich(c.reading)}</p>
${table('patterns', ['The pattern, as what it does for the visitor', 'Kind', 'How common'], patterns.map((p) => `<tr><td>${rich(p.what)}</td><td class="meta">${esc(p.kind)}</td><td>${tag(p.share, `share-${p.share}`)}</td></tr>`))}
<p class="meta">${Object.entries(SHARE_WORDS).map(([k, v]) => `${k}: ${v}`).join(' ')}</p>
${built.length ? `<h4>What the honoured sites are built with</h4><p class="meta">Counted over the ${c.sample.length} sites looked at, from what each page's markup or its credits show. What a site bundles without a trace is not counted.</p>${table('built', ['Technology', 'Sites'], built.map(([name, n]) => `<tr><td>${esc(name)}</td><td>${n}</td></tr>`))}` : ''}
<h4>The sites looked at</h4>${table('sample', ['Site', 'Its one idea', 'Its signature moment'], c.sample.map((s) => `<tr><td><a href="${esc(s.site)}">${esc(shortAddress(s.site))}</a><span class="sub">${esc(s.award)}</span></td><td>${rich(s.idea)}<span class="sub">${rich(s.motion)}</span></td><td>${rich(s.signature)}</td></tr>`))}` : ''}
${g ? `<h4>How sites of this trade work</h4><p class="meta">${rich(g.category)}. What most of them have; a direction keeps what visitors rely on and says what it breaks.</p>${list(g.kit.map((k) => k.text))}
${g.frontier?.length ? `<h4>The most distinctive sites of the trade</h4><ul>${g.frontier.map((f) => `<li>${rich(f.what)} <span class="meta">${esc(f.who)} · ${sourceLink(f.source)}</span></li>`).join('')}</ul>` : ''}` : ''}
${x ? `<h4>What a template or machine-made site looks like now</h4><p>${rich(x.reading)}</p>${table('slop', ['The tell', 'Where', 'Why it reads as nobody\'s choice'], x.tells.map((t) => `<tr><td>${rich(t.what)}</td><td class="meta">${esc(t.where)}</td><td>${rich(t.why)}</td></tr>`))}` : ''}
</section>`;
}

// What the studio understood about the site and the business, as the person saw it at the study.
export function understoodSection(anatomy, model) {
  const a = anatomy?.anatomy;
  if (!a) return '';
  const used = new Set(model.ideas.flatMap((i) => i.invention?.buildsOn ?? []));
  const mark = (id) => (used.has(id) ? ' <span class="tag tag-used">built on</span>' : '');
  return `<section class="set anatomy" id="anatomy"><h2>What the studio understood</h2>
<p class="lead">Before anyone designed, the studio studied the site and the business behind it and showed you this.${anatomy.corrections?.length ? ' What you corrected is listed at the end, and the anatomy was revised from it.' : ''} What a direction is made of is marked.</p>
<p><b>The site:</b> ${esc(OBJECT_WORDS[a.kind] ?? a.kind)}. ${rich(a.what)}</p>
${a.material?.length ? `<h4>What the business has that a design could be made of</h4><ul>${a.material.map((m) => `<li>${rich(m.what)}${mark(m.id)} <span class="meta">${esc(m.where)}</span></li>`).join('')}</ul>` : ''}
<h4>Who comes to it, and for what</h4>${list(a.users.map((u) => `**${u.who}**: ${u.jobs.join('; ')}`))}
<h4>Its parts</h4>${table('parts', ['Part', 'What it does', 'Where'], a.parts.map((p) => `<tr><td><b>${esc(p.name)}</b>${mark(p.id)}</td><td>${rich(p.does)}</td><td class="meta">${esc(p.where)}</td></tr>`))}
${a.knows.length ? `<h4>What it knows</h4><ul>${a.knows.map((k) => `<li>${rich(k.what)}${mark(k.id)} <span class="meta">${esc(k.where)}</span></li>`).join('')}</ul>` : ''}
${a.unused.length ? `<h4>What the web could do for it and it does not use</h4><ul>${a.unused.map((u) => `<li>${rich(u.what)}${mark(u.id)} <span class="meta">${rich(u.why)}</span></li>`).join('')}</ul>` : ''}
${a.weak.length ? `<h4>Weak spots</h4><ul>${a.weak.map((w) => `<li>${rich(w.text)}${mark(w.id)}</li>`).join('')}</ul>` : ''}
${a.rules.length ? `<h4>What it must keep</h4>${list(a.rules)}` : ''}
${anatomy.corrections?.length ? `<h4>What you corrected</h4>${list(anatomy.corrections.map((c) => c.text))}` : ''}
</section>`;
}

const KEY_TAGS = [
  ...Object.entries(STUDIO_SCALE_WORDS).map(([k, v]) => [tag(k, `scale-${k}`), v]),
  ...Object.entries(MADE_WORDS).map(([k, v]) => [tag(`made from: ${k === 'far-field' ? 'a far field' : k === 'material' ? 'its own material' : k === 'idea' ? 'one idea' : 'an assembly'}`, `made-${k}`), v]),
  ...Object.entries(SWAP_WORDS).map(([k, v]) => [tag(k === 'own' ? 'its own' : k === 'sector' ? 'fits a rival' : 'fits anyone', `swap-${k}`), v]),
  ...Object.entries(STUDIO_NEW_TO_WORDS).map(([k, v]) => [tag({ world: 'new to the web', category: 'new to its trade', here: 'its trade has it' }[k], `new-${k}`), v]),
  ...Object.entries(STUDIO_FEASIBLE_WORDS).map(([k, v]) => [tag(`feasible: ${k}`, `feasible-${k}`), v]),
];
export const studioKey = () => table('key', ['Word', 'What it means'], KEY_TAGS.map(([t, v]) => `<tr><td>${t}</td><td>${esc(v)}</td></tr>`));

export function studioMethod(model) {
  const seats = model.cast.filter((s) => s.role !== 'librarian');
  return `<section class="method" id="method"><h2>How the studio works</h2>
<p class="lead">Before anyone designed, an anatomist studied the site and the business behind it, and named what the business has that a design could be made of. Scouts looked at the field: what wins awards now, measured where a page shows what it is built with; how sites of this trade work; what a template or machine-made site looks like; what visitors say; and what the web can now do. You saw what the studio understood and could correct it. A framer set the problem and a provocateur wrote deliberately absurd statements. Each seat then proposed whole directions from cards dealt to it, and was given the field without its sites, so that nothing could be copied. A seat may send one direction made by joining known patterns, and no more: the others are made from what the business has, from one idea about it, or from a field far from the web. Another seat took every direction further before the docket, where the judge turned away what sites of this trade already look like and what is made of the tells of a template. An examiner, who did see the sites, and the other seats then attacked each direction over up to three rounds (is it a copy, an assembly of effects, generic, a template; would the signature moment survive the tenth visit; can it be built, fed and used by everyone), its proposer answered, and a judge who took no part ruled. A working tile was built of each direction that survived, and a stranger looked at it without being told what it was for.</p>
<p>${esc(model.evidenceCount)} pieces of evidence: ${esc(model.grades.measured)} measured, ${esc(model.grades.observed)} observed, ${esc(model.grades.argued)} argued. ${esc(model.session.runs)} of ${esc(model.session.budget)} agent runs were used.</p>
${model.missing.length ? `<h4>What it lacked</h4><ul class="limits">${model.missing.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
<h4>The seats</h4>
${table('seats', ['Seat', 'What it looks at', 'Ran on'], seats.map((s) => `<tr><td><b>${esc(s.title)}</b></td><td>${esc(s.ground)}</td><td>${esc(s.model === 'strongest' ? 'Strongest model' : 'Standard model')}</td></tr>`))}
<h4>The words on each direction</h4>
${studioKey()}
<p class="meta">Session ${esc(model.session.id)}. The full record of the debate, statement by statement, is kept with the session, and the session's pages show it direction by direction.</p></section>`;
}

const FRAME_WORDS = { who: 'studio', did: 'designed', about: 'the site and the business behind it' };

export function buildDirectionsHtml({ model, suggestions, frame, cards = [], parts = () => [], anatomy = null, genre = null, currents = null, slop = null, tiles = [], pictures = () => ({}), eye = null }) {
  const plain = namer(model);
  const written = new Map((suggestions.survivors ?? []).map((s) => [s.idea, s]));
  const dead = new Map((suggestions.killed ?? []).map((k) => [k.idea, k]));
  const noOfId = new Map(model.survivors.map((idea, i) => [idea.id, i + 1]));
  const steps = (suggestions.plan ?? []).filter((p) => p.ideas.some((id) => noOfId.has(id))).map((p) => `<li>${rich(plain(p.text))} <span class="refs">${p.ideas.filter((id) => noOfId.has(id)).map((id) => `<a href="#idea-${esc(id)}">direction ${noOfId.get(id)}</a>`).join(', ')}</span></li>`);
  const a = anatomy?.anatomy;
  const thing = a ? `<p class="goal-line"><b>The site:</b> ${rich(a.what)}${model.session.focus ? ` <b>Looked at first:</b> ${esc(model.session.focus)}.` : ''}</p>` : '';

  const glance = `<section class="glance">
<p class="eyebrow">The question</p>
<p class="goal">${esc(model.session.goal)}</p>
${thing}
<p class="verdict">${rich(suggestions.summary)}</p>
${countChips(model)}
${steps.length ? `<div class="start"><h2>Where to start</h2><ol>${steps.join('')}</ol></div>` : ''}
</section>`;

  const opts = { frame, cards, parts, plain, anatomy, tiles, pictures, eye };
  const directions = model.survivors.length ? `<section class="ideas"><h2>The directions that survived</h2>
<p class="lead">Each is a whole direction for the site: one idea, and the type, colour, layout, imagery and movement that follow from it. Each is made of what this business has, came through a debate that tried to show it was a copy or would fit a rival, and is shown as a working tile. None is ranked above another: choosing between them is yours.</p>
${model.survivors.map((idea, i) => directionArticle(idea, written.get(idea.id) ?? {}, i + 1, opts)).join('\n')}
</section>` : '<section class="ideas"><h2>The directions that survived</h2><p class="lead">No direction survived the debate this time. What fell, and why, is below.</p></section>';

  const other = (idea, rows) => `<div class="bet"><p class="bet-head"><b>${esc(plain(idea.originalTitle ?? idea.title))}</b> ${directionTags(idea)} ${stamp(idea.verdict)}</p>
<p>${rich(plain(idea.hypothesis.change))}</p>
<dl class="decide">${rows}</dl>
<p class="meta">${esc(originLine(idea, frame, cards))}</p></div>`;
  const notNow = model.undecided.length ? `<section class="open"><h2>Not settled</h2>
<p class="lead">The debate could not settle these. Each says what would decide it.</p>
${model.undecided.map((idea) => other(idea, `${row('What would decide it', `<p>${rich(plain(idea.ruling.wouldDecide))}</p>`)}${idea.ruling.riskiest ? row('Riskiest', `<p>${rich(plain(idea.ruling.riskiest))}</p>`) : ''}`)).join('\n')}
</section>` : '';
  const killed = model.killed.length ? `<section class="graveyard"><h2>Killed</h2>
<p class="lead">Every other direction the studio debated and turned down: some were a site that exists, some would fit a rival, some were effects with nothing holding them together, some the business could not feed. Each with the best that could be said for it.</p>
${model.killed.map((idea) => other(idea, killedRows(idea, dead.get(idea.id), plain))).join('\n')}
</section>` : '';
  const refused = model.refused.length || model.merged.length ? `<section class="open"><h2>Not debated</h2>
<p class="lead">Turned away at the docket before the debate, or debated as part of another direction.</p>
${table('refused', ['Direction', 'Why'], [...model.refused.map((x) => `<tr><td>${esc(x.title)}</td><td>${rich(x.reason)}</td></tr>`), ...model.merged.map((x) => `<tr><td>${esc(x.title)}</td><td>The same direction as “${esc(x.into)}”, and debated with it.</td></tr>`)])}</section>` : '';

  const questions = suggestions.questions ?? [];
  const asks = questions.length ? `<section class="open" id="questions"><h2>Questions only you can answer</h2><ol class="questions">${questions.map((q) => `<li>${rich(q.text)}</li>`).join('')}</ol></section>` : '';
  return page({ title: 'Design studio · The directions', kind: 'suggestions inventions-doc directions-doc', model, body: [glance, directions, notNow, killed, refused, fieldSection({ currents, slop, genre }), understoodSection(anatomy, model), frameSection(frame, model, plain, FRAME_WORDS), asks, studioMethod(model)].filter(Boolean).join('\n') });
}

export { FRAME_WORDS };
