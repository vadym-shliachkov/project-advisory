import { esc, rich, page, countChips, tag, stamp, whereBlock, table } from './html.mjs';
import { namer, ideaTags, killedRows } from './brief.mjs';
import { originLine } from './venturedoc.mjs';
import { sketchHtml } from './sketch.mjs';
import { NEW_TO_WORDS, FEASIBLE_WORDS, SCALE_WORDS } from './invention.mjs';
import { OBJECT_WORDS } from './object.mjs';

// The invention lab's own document: the inventions. Each one that survived opens with a decision box (the first step,
// the smallest prototype, what it is worth if it works, the riskiest thing it rests on, when to drop it, what it needs
// from you); then a sketch of what it could look like, how a person would live it, why it is new, what of the
// thing it grows from, why it could work, what would have to be true, what it survived and what is still uncertain.
// Then the inventions not proved, the killed ones with the best that could be said for them, what the lab understood
// about the thing before inventing (the anatomy), the frame it worked from, and the provocation wall.

const UPSIDE_NOTE = {
  incremental: 'Makes what the thing already does better.',
  significant: 'Gives the thing a new capability its users would choose it for.',
  transformative: 'Changes what kind of thing it is.',
};
const row = (label, html) => (html ? `<div><dt>${esc(label)}</dt><dd>${html}</dd></div>` : '');
const list = (items) => (items?.length ? `<ul>${items.map((x) => `<li>${rich(x)}</li>`).join('')}</ul>` : '');
const PRIOR = { yes: 'Something like it exists', partly: 'Something close to it exists', no: 'Nothing like it was found' };

// The tags of an invention: the council's (with how new it was ruled), with how far the thing is from doing it and
// what it is worth if it works.
export const inventionTags = (idea) => `${ideaTags(idea)}${idea.invention?.feasible ? tag(`feasible: ${idea.invention.feasible}`, `feasible-${idea.invention.feasible}`) : ''}${idea.bet?.upside ? tag(`${idea.bet.upside} if it works`, `upside-${idea.bet.upside}`) : ''}`;

// What of the thing an invention grows from, by the names the anatomy gives.
export function grownFrom(idea, anatomy) {
  const a = anatomy?.anatomy;
  const by = new Map([...(a?.parts ?? []).map((p) => [p.id, `${p.name}: ${p.does}`]), ...(a?.knows ?? []).map((k) => [k.id, `What it knows: ${k.what}`]), ...(a?.unused ?? []).map((u) => [u.id, `What it could do and does not: ${u.what}`]), ...(a?.journeys ?? []).map((j) => [j.id, `The journey: ${j.text}`]), ...(a?.weak ?? []).map((w) => [w.id, `A weak spot: ${w.text}`])]);
  return (idea.invention?.buildsOn ?? []).map((id) => by.get(id)).filter(Boolean);
}

// One surviving invention, in full. `n` is its number in this document.
export function inventionArticle(idea, s, n, { frame, cards, parts = () => [], plain, anatomy, sketches = [] }) {
  const b = idea.bet ?? { assumptions: [], riskiest: -1 };
  const inv = idea.invention ?? {};
  const sketch = sketches.find((k) => k.idea === idea.id);
  const assumptions = b.assumptions.length ? `<ol class="must">${b.assumptions.map((a, i) => `<li${i === b.riskiest ? ' class="riskiest"' : ''}>${rich(plain(a))}${i === b.riskiest ? ' <span class="tag tag-riskiest">riskiest, as proposed</span>' : ''}</li>`).join('')}</ol>` : '';
  const steps = s.experience ?? inv.experience ?? [];
  const pa = idea.priorArt;
  const places = parts(idea.thread);
  const fromYou = s.fromYou === undefined ? '' : s.fromYou.length ? list(s.fromYou) : '<p>Nothing beyond the go-ahead.</p>';
  return `<article class="idea invention" id="idea-${esc(idea.id)}">
<header class="idea-head"><p class="idea-no">${n}</p><div><h3>${esc(plain(idea.title))}</h3>
<p class="tags">${inventionTags(idea)}</p></div></header>
<p class="lede">${rich(s.sentence)}</p>
<dl class="decide">
${row('First step', s.firstStep ? `<p>${rich(s.firstStep)}</p>` : '')}
${row('Smallest prototype', s.prototype ? `<p>${rich(s.prototype)}</p>` : '')}
${row('If it works', s.upside ? `<p>${rich(s.upside)}</p>${b.upside ? `<p class="meta">${esc(UPSIDE_NOTE[b.upside])}</p>` : ''}` : '')}
${row('Riskiest now', b.riskiestNow ? `<p>${rich(plain(b.riskiestNow))}</p>` : '')}
${row('Drop it if', s.killCondition ? `<p>${rich(s.killCondition)}</p>` : '')}
${row('Needs from you', fromYou)}
${row('Also needs', list(s.needs))}
</dl>
${sketchHtml(sketch, esc)}
${steps.length ? `<div class="field"><h5>How you would live it</h5><ol class="experience">${steps.map((x) => `<li>${rich(plain(x))}</li>`).join('')}</ol></div>` : ''}
<div class="field"><h5>Why it is new</h5>${s.whyNew ? `<p>${rich(s.whyNew)}</p>` : ''}${inv.newTo ? `<p class="meta">The judge's ruling: ${esc(NEW_TO_WORDS[inv.newTo])}${inv.feasible ? ` ${esc(FEASIBLE_WORDS[inv.feasible])}` : ''}</p>` : ''}${pa ? `<p class="meta">${esc(PRIOR[pa.exists] ?? pa.exists)}${pa.who ? `: ${rich(pa.who)}` : ''}. Looked for: ${rich(pa.searched)}</p>` : ''}</div>
${grownFrom(idea, anatomy).length ? `<div class="field"><h5>What of the thing it grows from</h5>${list(grownFrom(idea, anatomy))}</div>` : ''}
<div class="field"><h5>Why it could work</h5>${s.why ? `<p>${rich(s.why)}</p>` : ''}</div>
<div class="field"><h5>What would have to be true</h5>${assumptions}</div>
${s.survived?.length ? `<div class="field"><h5>What it survived</h5><dl class="survived">${s.survived.map((x) => `<dt>${rich(x.attack)}</dt><dd>${rich(x.answer)}</dd>`).join('')}</dl></div>` : ''}
${s.uncertain?.length ? `<div class="field"><h5>Still uncertain</h5>${list(s.uncertain)}</div>` : ''}
${s.fitsWith ? `<div class="field"><h5>Fits with</h5><p>${rich(s.fitsWith)}</p></div>` : ''}
${places.length ? whereBlock(places) : ''}
<p class="meta idea-foot">${esc(originLine(idea, frame, cards))} Idea ${esc(idea.id.slice(1))} in the ledger.</p>
</article>`;
}

// What the lab understood about the thing before anyone invented, as the person saw it at the study.
export function anatomySection(anatomy, genre, model) {
  const a = anatomy?.anatomy;
  if (!a) return '';
  const g = genre?.genre;
  const used = new Set(model.ideas.flatMap((i) => i.invention?.buildsOn ?? []));
  const mark = (id) => (used.has(id) ? ' <span class="tag tag-used">built on</span>' : '');
  return `<section class="set anatomy" id="anatomy"><h2>What the lab understood</h2>
<p class="lead">Before anyone invented, the lab studied the thing and showed you this.${anatomy.corrections?.length ? ' What you corrected is listed at the end, and the anatomy was revised from it.' : ''} The parts an invention grows from are marked.</p>
<p><b>The thing:</b> ${esc(OBJECT_WORDS[a.kind] ?? a.kind)}. ${rich(a.what)}</p>
<h4>Who uses it, and for what</h4>${list(a.users.map((u) => `**${u.who}**: ${u.jobs.join('; ')}`))}
<h4>Its parts</h4>${table('parts', ['Part', 'What it does', 'Where'], a.parts.map((p) => `<tr><td><b>${esc(p.name)}</b>${mark(p.id)}</td><td>${rich(p.does)}</td><td class="meta">${esc(p.where)}</td></tr>`))}
${a.knows.length ? `<h4>What it knows</h4><ul>${a.knows.map((k) => `<li>${rich(k.what)}${mark(k.id)} <span class="meta">${esc(k.where)}</span></li>`).join('')}</ul>` : ''}
${a.unused.length ? `<h4>What its platform could do and it does not</h4><ul>${a.unused.map((u) => `<li>${rich(u.what)}${mark(u.id)} <span class="meta">${rich(u.why)}</span></li>`).join('')}</ul>` : ''}
${a.weak.length ? `<h4>Weak spots</h4><ul>${a.weak.map((w) => `<li>${rich(w.text)}${mark(w.id)}</li>`).join('')}</ul>` : ''}
${g ? `<h4>What things of its kind already have</h4><p class="meta">${rich(g.category)}. An invention on this list is not one.</p>${list(g.kit.map((k) => k.text))}` : ''}
${g?.frontier?.length ? `<h4>The most inventive things of its kind</h4><ul>${g.frontier.map((f) => `<li>${rich(f.what)} <span class="meta">${esc(f.who)}</span></li>`).join('')}</ul>` : ''}
${anatomy.corrections?.length ? `<h4>What you corrected</h4>${list(anatomy.corrections.map((c) => c.text))}` : ''}
</section>`;
}

export function frameSection(frame, model, plain) {
  const f = frame?.frame;
  if (!f) return '';
  const picked = new Set(frame?.picked ?? []);
  const box = f.morphology?.length ? table('morphology', ['What it is made of', 'The options (what it has today in bold)'], f.morphology.map((d) => `<tr><td><b>${esc(d.name)}</b></td><td>${d.options.map((o, i) => (i === d.now ? `<b>${esc(o)}</b>` : esc(o))).join(' · ')}</td></tr>`)) : '';
  const harvested = (id) => model.ideas.filter((i) => i.bet?.provocation === id);
  const wall = frame?.provocations?.length ? `<h4>The provocation wall</h4>
<p class="meta">Deliberately absurd statements about the thing, written to be mined for what is workable in them, and what was harvested from each.</p>
<table class="wall"><thead><tr><th scope="col">Provocation</th><th scope="col">Harvested</th></tr></thead><tbody>${frame.provocations.map((p) => `<tr><td>${rich(p.text)}<span class="sub">${esc(p.kind)}</span></td><td>${harvested(p.id).map((i) => `${esc(plain(i.title))} ${stamp(i.verdict)}`).join('<br>') || '<span class="meta">Nothing harvested.</span>'}</td></tr>`).join('')}</tbody></table>` : '';
  return `<section class="set" id="frame"><h2>The frame</h2>
<p class="lead">What the lab worked from, before anyone invented.${frame?.picked?.length ? ' The framings you picked are marked.' : ''}</p>
<h4>The ideal result</h4><p>${rich(f.ideal)}</p>
${f.evolution ? `<h4>Where it stands on its line of evolution, and the next step</h4><p><b>Now:</b> ${rich(f.evolution.now)}</p><p><b>Next:</b> ${rich(f.evolution.next)}</p>` : ''}
<h4>Contradictions</h4><ul>${f.contradictions.map((c) => `<li>${picked.has(c.id) ? '<b>Picked.</b> ' : ''}${rich(c.want)}, but then ${rich(c.butThen)}. <span class="meta">The way round: ${rich(c.separate)}</span></li>`).join('')}</ul>
${box ? `<h4>The morphological box</h4>${box}` : ''}
<h4>How might we</h4><ul>${f.questions.map((q) => `<li>${picked.has(q.id) ? '<b>Picked.</b> ' : ''}${rich(q.text)} <span class="meta">${esc(q.altitude)}</span></li>`).join('')}</ul>
${wall}
</section>`;
}

export function buildInventionsHtml({ model, suggestions, frame, cards = [], parts = () => [], anatomy = null, genre = null, sketches = [] }) {
  const plain = namer(model);
  const written = new Map((suggestions.survivors ?? []).map((s) => [s.idea, s]));
  const dead = new Map((suggestions.killed ?? []).map((k) => [k.idea, k]));
  const noOfId = new Map(model.survivors.map((idea, i) => [idea.id, i + 1]));
  const steps = (suggestions.plan ?? []).filter((p) => p.ideas.some((id) => noOfId.has(id))).map((p) => `<li>${rich(plain(p.text))} <span class="refs">${p.ideas.filter((id) => noOfId.has(id)).map((id) => `<a href="#idea-${esc(id)}">invention ${noOfId.get(id)}</a>`).join(', ')}</span></li>`);
  const a = anatomy?.anatomy;
  const thing = a ? `<p class="goal-line"><b>The thing:</b> ${esc(OBJECT_WORDS[a.kind] ?? a.kind)}. ${rich(a.what)}${model.session.focus ? ` <b>Looked at first:</b> ${esc(model.session.focus)}.` : ''}</p>` : '';

  const glance = `<section class="glance">
<p class="eyebrow">The question</p>
<p class="goal">${esc(model.session.goal)}</p>
${thing}
<p class="verdict">${rich(suggestions.summary)}</p>
${countChips(model)}
${steps.length ? `<div class="start"><h2>Where to start</h2><ol>${steps.join('')}</ol></div>` : ''}
</section>`;

  const opts = { frame, cards, parts, plain, anatomy, sketches };
  const inventions = model.survivors.length ? `<section class="ideas"><h2>The inventions that survived</h2>
<p class="lead">Each is new to the world or to things of its kind, grows from what this thing already is, and came through the debate. Each is a bet with a cheap first step, not a plan, and none is ranked above another. The sketches show an idea, not a design.</p>
${model.survivors.map((idea, i) => inventionArticle(idea, written.get(idea.id) ?? {}, i + 1, opts)).join('\n')}
</section>` : '<section class="ideas"><h2>The inventions that survived</h2><p class="lead">No invention survived the debate this time. What fell, and why, is below.</p></section>';

  const other = (idea, rows) => `<div class="bet"><p class="bet-head"><b>${esc(plain(idea.originalTitle ?? idea.title))}</b> ${inventionTags(idea)} ${stamp(idea.verdict)}</p>
<p>${rich(plain(idea.hypothesis.change))}</p>
<dl class="decide">${rows}</dl>
<p class="meta">${esc(originLine(idea, frame, cards))}</p></div>`;
  const notNow = model.undecided.length ? `<section class="open"><h2>Not settled</h2>
<p class="lead">The debate could not settle these. Each says what would decide it.</p>
${model.undecided.map((idea) => other(idea, `${row('What would decide it', `<p>${rich(plain(idea.ruling.wouldDecide))}</p>`)}${idea.ruling.riskiest ? row('Riskiest', `<p>${rich(plain(idea.ruling.riskiest))}</p>`) : ''}`)).join('\n')}
</section>` : '';
  const killed = model.killed.length ? `<section class="graveyard"><h2>Killed</h2>
<p class="lead">Every other invention the lab debated and turned down: some exist already, some the thing cannot do, some nobody would want. Each with the best that could be said for it.</p>
${model.killed.map((idea) => other(idea, killedRows(idea, dead.get(idea.id), plain))).join('\n')}
</section>` : '';
  const refused = model.refused.length || model.merged.length ? `<section class="open"><h2>Not debated</h2>
<p class="lead">Turned away at the docket before the debate, or debated as part of another invention.</p>
${table('refused', ['Invention', 'Why'], [...model.refused.map((x) => `<tr><td>${esc(x.title)}</td><td>${rich(x.reason)}</td></tr>`), ...model.merged.map((x) => `<tr><td>${esc(x.title)}</td><td>The same invention as “${esc(x.into)}”, and debated with it.</td></tr>`)])}</section>` : '';

  const questions = suggestions.questions ?? [];
  const asks = questions.length ? `<section class="open" id="questions"><h2>Questions only you can answer</h2><ol class="questions">${questions.map((q) => `<li>${rich(q.text)}</li>`).join('')}</ol></section>` : '';
  const seats = model.cast.filter((s) => s.role !== 'librarian');
  const method = `<section class="method" id="method"><h2>How the lab works</h2>
<p class="lead">Before anyone invented, an anatomist studied the thing from its files and its live pages, a genre scout listed what things of its kind already have, a voice scout gathered what the people who use it say, and a tech scan looked at what has become possible. You saw what the lab understood and could correct it. A framer then set the problem (the ideal result, the contradictions of the thing, a box of what it is made of and the options for each part, where it stands on its line of evolution, and "how might we" questions, two of which question the goal itself), and a provocateur wrote deliberately absurd statements. Each seat answered its framings with idea cards dealt to it, then harvested the provocations, and every invention named the parts of the thing it grows from and what was found when it was looked for elsewhere. Another seat made every invention bigger before the docket, where the judge turned away anything things of its kind already have. A red team and the other seats then attacked each invention over up to three rounds, its proposer answered, and a judge who took no part ruled on what survived, how new it is and how far the thing is from doing it.</p>
<p>${esc(model.evidenceCount)} pieces of evidence: ${esc(model.grades.measured)} measured, ${esc(model.grades.observed)} observed, ${esc(model.grades.argued)} argued. ${esc(model.session.runs)} of ${esc(model.session.budget)} agent runs were used.</p>
${model.missing.length ? `<h4>What it lacked</h4><ul class="limits">${model.missing.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
<h4>The seats</h4>
${table('seats', ['Seat', 'What it looks at', 'Ran on'], seats.map((s) => `<tr><td><b>${esc(s.title)}</b></td><td>${esc(s.ground)}</td><td>${esc(s.model === 'strongest' ? 'Strongest model' : 'Standard model')}</td></tr>`))}
<h4>The words on each invention</h4>
${table('key', ['Word', 'What it means'], [...Object.entries(SCALE_WORDS).map(([k, v]) => `<tr><td>${tag(k, `scale-${k}`)}</td><td>${esc(v)}</td></tr>`), ...Object.entries(NEW_TO_WORDS).map(([k, v]) => `<tr><td>${tag(`new to the ${k === 'here' ? 'thing only' : k}`, `new-${k}`)}</td><td>${esc(v)}</td></tr>`), ...Object.entries(FEASIBLE_WORDS).map(([k, v]) => `<tr><td>${tag(`feasible: ${k}`, `feasible-${k}`)}</td><td>${esc(v)}</td></tr>`)])}
<p class="meta">Session ${esc(model.session.id)}. The full record of the debate, statement by statement, is kept with the session; the minutes tell it as a conversation, and the session's pages show it invention by invention.</p></section>`;
  return page({ title: 'Invention lab · The inventions', kind: 'suggestions inventions-doc', model, body: [glance, inventions, notNow, killed, refused, anatomySection(anatomy, genre, model), frameSection(frame, model, plain), asks, method].filter(Boolean).join('\n') });
}
