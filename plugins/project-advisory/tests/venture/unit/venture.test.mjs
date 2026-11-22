import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir, readJson, PLUGIN_ROOT } from '../../council/helpers.mjs';
import { init, status, next, evidence, frame, context, say, verdict, save, close, digest } from '../../../skills/council/scripts/commands.mjs';
import { resolveSession } from '../../../skills/council/scripts/lib/session.mjs';
import { loadIdeas } from '../../../skills/council/scripts/lib/ideas.mjs';
import { deal, validateFrame, assignAmplifiers, loadCards } from '../../../skills/council/scripts/lib/frame.mjs';

process.env.COUNCIL_NO_BROWSER = '1';
const stdin = (data) => ({ stdin: () => JSON.stringify(data) });
const LONG = 'which is said here at enough length to be a real statement';
const errorOf = (r) => (r.errors ?? []).join('\n');
const LAB = { kind: 'venture' };

const FRAME = {
  ideal: 'The right buyers arrive already convinced, with a budget, and the firm spends nothing to bring them in.',
  contradictions: [
    { want: 'To be trusted it must show named clients', butThen: 'its clients do not want to be named', separate: 'Separate in time: name them after a year' },
    { want: 'To grow it must sell more work', butThen: 'its hours do not grow', separate: 'Separate the part from the whole: productise one part' },
  ],
  resources: ['Code built for a law-firm client that others could use', 'Contacts from five years of client work', 'Discovery notes from sales calls that were lost'],
  curve: { now: 'A service sold project by project, priced by the scope of each one', next: 'A packaged service with a fixed scope, and then a product built from it' },
  questions: [
    { text: 'How might we win a buyer before they start looking?', altitude: 'wide' },
    { text: 'How might we earn from what we know without selling hours?', altitude: 'reframe' },
    { text: 'How might we make buyers come to us without the site at all?', altitude: 'reframe' },
    { text: 'How might we make the first step cost the buyer nothing?', altitude: 'narrow' },
    { text: 'How might we turn lost sales calls into something of value?', altitude: 'narrow' },
    { text: 'How might we be the firm a whole trade cannot do without?', altitude: 'wide' },
  ],
};
const PROVOCATIONS = ['Clients pay us nothing.', 'We never meet a client.', 'Our competitor sells our service.', 'Every project takes one day.', 'Buyers know us before they need us.']
  .map((text, i) => ({ text, kind: ['reversal', 'escape', 'distortion', 'exaggeration', 'wishful'][i] }));

const bet = (n, extra = {}) => ({
  type: 'hypothesis', title: `Bet ${n}: sell the intake connector as a product`, effort: 'large', scale: 'new',
  hypothesis: {
    change: `Package the intake tool built for one client as product number ${n}, sold to firms of the same kind`,
    effect: 'A line of revenue that does not depend on hours sold',
    because: 'Firms of this kind all have the same intake problem and buy tools more easily than projects',
    trigger: 'The firm has built the tool once already and owns what it learned',
    killCondition: 'Fewer than two of five firms shown the offer ask for a price',
  },
  test: { what: 'Show a one-page offer to five firms that would use it', metric: 'firms asking for a price', threshold: 'two of five', checkAfter: 'four weeks' },
  assumptions: ['Firms of this kind have the same intake problem', 'They would buy a tool from a services firm'], riskiest: 1, upside: 'significant',
  priorArt: { exists: 'no', searched: 'Searched for intake tools sold to firms of this kind' },
  ...extra,
});

function atFrame() {
  const root = tmpDir();
  const o = { root, ...LAB };
  const r = init({ root, url: 'https://acme.test', ...LAB });
  assert.equal(r.goalSource, 'default');
  assert.match(r.goal, /could start, sell, build or become/);
  assert.match(r.dir, /[\\/]\.project-health[\\/]venture[\\/]\d{4}-\d{2}-\d{2}$/);
  assert.equal(next(o).to.phase, 'evidence');
  evidence({ ...o, collect: true });
  const moved = next(o);
  assert.deepEqual([moved.to.phase, moved.to.step], ['frame', 'frame'], 'the lab has no track record step: it frames the problem first');
  return o;
}

test('a venture session is its own: its folder, its goal, its cast, and the council knows nothing of it', () => {
  const o = atFrame();
  const { session } = resolveSession(o.root, undefined, 'venture');
  assert.equal(session.kind, 'venture');
  assert.deepEqual(session.cast.filter((s) => s.proposes).map((s) => s.role), ['client', 'provocateur', 'contradictions', 'business-model', 'analogist', 'futurist']);
  assert.throws(() => status({ root: o.root }), /No council session is under way/);
  assert.equal(init({ root: o.root }).ok, true, 'a council session can start while a venture session runs');
});

test('the frame: the framer sets the problem, the provocateur provokes, the person picks, then cards are dealt', () => {
  const o = atFrame();
  assert.deepEqual(status(o).turns.map((t) => t.role), ['framer']);
  const text = context({ ...o, role: 'framer', save: true });
  assert.ok(text.startsWith('# The frame'));
  assert.match(text, /venture\.mjs" frame --role framer/);
  assert.match(errorOf(frame({ ...o, role: 'framer' }, stdin({ frame: { ...FRAME, questions: FRAME.questions.map((q) => ({ ...q, altitude: 'narrow' })) } }))), /at least two at the altitude "reframe"/);
  assert.equal(frame({ ...o, role: 'framer' }, stdin({ frame: FRAME })).ok, true);
  assert.equal(next(o).to.step, 'provoke');
  assert.ok(context({ ...o, role: 'provocateur', save: true }).startsWith('# The provocations'));
  assert.match(errorOf(frame({ ...o, role: 'provocateur' }, stdin({ provocations: PROVOCATIONS.slice(0, 3) }))), /five to twelve/);
  assert.equal(frame({ ...o, role: 'provocateur' }, stdin({ provocations: PROVOCATIONS })).ok, true);
  const shown = frame({ ...o, show: true });
  assert.deepEqual([shown.questions.length, shown.contradictions.map((c) => c.id), shown.provocations], [6, ['C1', 'C2'], 5]);
  assert.match(errorOf(frame({ ...o, pick: 'H9' })), /Unknown framings: H9/);
  assert.deepEqual(frame({ ...o, pick: 'H2,H3,C1' }).picked, ['H2', 'H3', 'C1']);
  assert.match(status(o).next, /frame --show/);
  const moved = next(o);
  assert.deepEqual([moved.to.phase, moved.to.step], ['propose', 'first']);
  const { session } = resolveSession(o.root, undefined, 'venture');
  for (const [role, cards] of Object.entries(session.dealt.cards)) {
    const families = cards.map((id) => loadCards().find((c) => c.id === id).family);
    assert.equal(new Set(families).size, 3, `${role} gets cards from three families`);
    assert.ok(session.dealt.framings[role].every((id) => ['H2', 'H3', 'C1'].includes(id)), 'only the framings the person picked are dealt');
  }
  assert.deepEqual(deal(session, { frame: { questions: [], contradictions: [] } }).cards, session.dealt.cards, 'the same session deals the same cards');
});

// A lab session past the frame, every seat with one bet; returns at the amplify phase.
function atAmplify() {
  const o = atFrame();
  frame({ ...o, role: 'framer' }, stdin({ frame: FRAME }));
  next(o);
  frame({ ...o, role: 'provocateur' }, stdin({ provocations: PROVOCATIONS }));
  next(o);
  const dealt = () => resolveSession(o.root, undefined, 'venture').session.dealt;
  let n = 0;
  for (const role of Object.keys(dealt().cards)) {
    const r = say({ ...o, role }, stdin({ statements: [bet(++n, { cards: [dealt().cards[role][0]], answers: dealt().framings[role][0] })] }));
    assert.equal(r.ok, true, `${role}: ${errorOf(r)}`);
  }
  assert.equal(next(o).to.step, 'second');
  const r = say({ ...o, role: 'analogist' }, stdin({ statements: [bet(++n, { provocation: 'P1' })] }));
  assert.equal(r.ok, true, errorOf(r));
  const moved = next({ ...o, force: true });
  assert.equal(moved.to.phase, 'amplify');
  return o;
}

test('bets: no edits of the site, what they assume, the cards dealt, the framing or provocation they come from', () => {
  const o = atFrame();
  frame({ ...o, role: 'framer' }, stdin({ frame: FRAME }));
  next(o);
  frame({ ...o, role: 'provocateur' }, stdin({ provocations: PROVOCATIONS }));
  next(o);
  const { session } = resolveSession(o.root, undefined, 'venture');
  const mine = session.dealt.cards.contradictions;
  const material = context({ ...o, role: 'contradictions', save: true });
  assert.ok(material.includes('# Your turn: propose bets'));
  assert.ok(material.includes('**Your ground: the contradictions of the business.**'));
  const dealt = readJson(path.join(resolveSession(o.root, undefined, 'venture').dir, 'in', 'propose-contradictions.json'));
  assert.deepEqual(dealt.yourCards.map((c) => c.id), mine);
  const errors = errorOf(say({ ...o, role: 'contradictions' }, stdin({ statements: [bet(1, { scale: 'adjustment', assumptions: ['Only one'], riskiest: 3, upside: 'huge', cards: ['K999'], answers: 'H42' })] })));
  for (const part of [/the venture board does not propose edits/, /two to six things that would have to be true/, /\.riskiest: the position/, /\.upside: what it is worth if it works/, /K999 was not dealt to you/, /\.answers: the framing this bet answers/]) assert.match(errors, part);
  assert.equal(say({ ...o, role: 'contradictions' }, stdin({ statements: [bet(1, { cards: [mine[0]], answers: session.dealt.framings.contradictions[0] })] })).ok, true, 'a bet need not say where on the site: most live off it');
});

test('every bet is built on by another seat before the docket, and the judge may adopt the bigger form', () => {
  const o = atAmplify();
  const { session, dir } = resolveSession(o.root, undefined, 'venture');
  const record = readJson(path.join(dir, 'record.json'));
  assert.deepEqual(Object.keys(session.assignments).sort(), record.threads.map((t) => t.id).sort());
  for (const [id, role] of Object.entries(session.assignments)) assert.notEqual(role, record.threads.find((t) => t.id === id).by, 'never its own proposer');
  const [first, role] = Object.entries(session.assignments)[0];
  const other = Object.values(session.assignments).find((r) => r !== role);
  assert.match(errorOf(say({ ...o, role: other }, stdin({ statements: [{ type: 'amplify', thread: first, text: `Make it a product for the whole trade, ${LONG}`, bigger: { change: 'Sell it to every firm in the trade', effect: 'A product line', because: 'They share the problem' } }] }))), /was not given to you to build on/);
  assert.ok(context({ ...o, role, save: true }).includes('# Your turn: make it bigger'));
  for (const [id, r] of Object.entries(session.assignments)) {
    const saved = say({ ...o, role: r }, stdin({ statements: [{ type: 'amplify', thread: id, text: `Make it a product for the whole trade, ${LONG}`, bigger: { change: 'Sell it to every firm in the trade as a subscription', effect: 'A product line larger than the services', because: 'Every firm of the kind shares the problem' } }] }));
    assert.equal(saved.ok, true, errorOf(saved));
  }
  assert.equal(next(o).to.phase, 'docket');
  context({ ...o, role: 'judge', save: true });
  const docketInput = readJson(path.join(dir, 'in', 'docket.json'));
  assert.ok(docketInput.ideas[0].statements.some((s) => s.type === 'amplify' && s.bigger), 'the judge sees the amplifications');
  const amp = readJson(path.join(dir, 'record.json')).statements.find((s) => s.type === 'amplify' && s.thread === first);
  const all = record.threads.map((t) => ({ thread: t.id, novelty: 'fresh', ...(t.id === first ? { adopt: amp.n } : {}) }));
  assert.match(errorOf(verdict({ ...o, stage: 'docket' }, stdin({ admitted: all.map((a) => (a.thread === first ? { ...a, adopt: 1 } : a)) }))), /is not an amplification of/);
  assert.equal(verdict({ ...o, stage: 'docket' }, stdin({ admitted: all })).ok, true);
  const ledger = loadIdeas(o.root);
  assert.ok(ledger.every((i) => i.origin === 'venture'));
  assert.equal(ledger.find((i) => i.title.startsWith('Bet 1')).hypothesis.change, 'Sell it to every firm in the trade as a subscription', 'the adopted form is what is debated');
});

test('the sceptic attacks what a bet assumes; the judge rules on what it is worth; the bets are written and printed', () => {
  const o = atAmplify();
  next({ ...o, force: true });
  const { dir } = resolveSession(o.root, undefined, 'venture');
  const record = () => readJson(path.join(dir, 'record.json'));
  verdict({ ...o, stage: 'docket' }, stdin({ admitted: record().threads.map((t) => ({ thread: t.id, novelty: 'fresh' })) }));
  assert.deepEqual([next(o).to.phase, status(o).round], ['examine', 1]);
  assert.deepEqual(status(o).turns.map((t) => t.role), ['red-team', 'client'], 'only the sceptic and the customer attack');
  assert.ok(context({ ...o, role: 'red-team', save: true }).includes('# Your turn: the sceptic'));
  const steel = { type: 'steelman', thread: 'T1', text: `At its strongest the bet turns one client's tool into a product, ${LONG}` };
  assert.match(errorOf(say({ ...o, role: 'red-team' }, stdin({ statements: [steel, { type: 'attack', thread: 'T1', kind: 'customer', text: `Firms do not buy tools from services firms, ${LONG}` }] }))), /\.assumption: the position \(from 0\) of the assumption this attack is on/);
  assert.equal(say({ ...o, role: 'red-team' }, stdin({ statements: [steel, { type: 'attack', thread: 'T1', kind: 'customer', assumption: 1, text: `Firms do not buy tools from services firms, ${LONG}` }] })).ok, true);
  next({ ...o, force: true });
  next({ ...o, force: true });
  next({ ...o, force: true });
  assert.equal(status(o).phase, 'verdict');
  context({ ...o, role: 'judge', save: true });
  const ids = record().threads.filter((t) => t.status === 'admitted').map((t) => t.id);
  const vs = 'Nothing the business does today earns outside of hours sold';
  const rulings = ids.map((thread, i) => (i === 0
    ? { thread, verdict: 'killed', causeOfDeath: 'Firms of this kind do not buy tools from services firms', reason: `The attack on the second assumption stood, ${LONG}` }
    : i === 1 ? { thread, verdict: 'undecided', upside: 'transformative', riskiest: 'Whether firms would pay for a tool at all', wouldDecide: 'Five firms shown the offer', reason: `Nobody could tell, ${LONG}` }
      : { thread, verdict: 'survived', strength: 'speculative', upside: 'significant', riskiest: 'That firms of this kind share the problem', vsDoNothing: vs, reason: `No attack stood, ${LONG}` }));
  assert.match(errorOf(verdict({ ...o, stage: 'verdict' }, stdin({ rulings: rulings.map((r) => ({ ...r, upside: undefined })) }))), /\.upside: what it is worth if it works/);
  assert.match(errorOf(verdict({ ...o, stage: 'verdict' }, stdin({ rulings: rulings.map((r) => (r.verdict === 'survived' ? { ...r, verdict: 'narrowed', narrowed: { title: 'One page for it', change: 'Add a page about the tool', effect: 'One more enquiry', scale: 'adjustment' } } : r)) }))), /does not narrow a bet into an edit/);
  assert.equal(verdict({ ...o, stage: 'verdict' }, stdin({ rulings })).ok, true);
  assert.equal(next(o).to.phase, 'write', 'the lab has no set phase');
  assert.deepEqual(status(o).turns.map((t) => t.role), ['writer'], 'no minutes in the lab');
  const writer = context({ ...o, role: 'writer', save: true });
  assert.ok(writer.startsWith('# The bets'));
  const ledger = loadIdeas(o.root);
  const survivors = ledger.filter((i) => i.status === 'survived');
  assert.ok(survivors.every((i) => i.verdict.upside === 'significant' && /share the problem/.test(i.verdict.riskiest)));
  const killed = ledger.find((i) => i.status === 'killed');
  const undecided = ledger.find((i) => i.status === 'undecided');
  const doc = {
    summary: 'The lab looked for what the business could become. Several bets are worth a first step, each a significant change if it works, and none is proven: each first step is cheap.',
    plan: [{ text: 'Show the one-page offer to five firms first: every other step reads from it.', ideas: [survivors[0].id] }],
    survivors: survivors.map((i) => ({
      idea: i.id, sentence: 'Sell the intake tool built for one client as a product to firms of the same kind.',
      pressRelease: { headline: 'A services firm now sells the intake tool it built', subhead: 'Firms of this kind can buy a tested intake tool instead of commissioning their own.', body: 'The firm built an intake tool for one client and now offers it to every firm of the same kind, as a product with a fixed price and a setup it runs itself. Buyers who would never commission a project can try a tool that already works, and the firm earns from what it built instead of from hours. '.repeat(1), quote: 'A buyer at a firm like yours: we wanted the tool, not a project.' },
      faq: [{ q: 'Why would a firm buy a tool from a services firm?', a: 'Because the tool already works for one firm of the same kind, which the debate did not dispute.' }, { q: 'What if they all differ?', a: 'Then the first step shows it: fewer than two of five ask for a price.' }],
      why: 'Firms of this kind share the intake problem and buy tools more easily than projects.',
      firstStep: 'Show a one-page offer to five firms that would use it.', killCondition: 'Fewer than two of five firms ask for a price.',
      upside: 'A line of revenue that does not depend on hours sold.', fromYou: ['Decide whether the client allows the tool to be reused.'],
    })),
    killed: [{ idea: killed.id, what: 'Package the intake tool as a product for firms of the same kind.', strongestPoint: 'The tool already works for one firm of that kind.', killedBy: 'Firms of this kind do not buy tools from services firms.', couldReturn: 'Only if a partner who sells tools to these firms carries it.' }],
    bets: [killed, undecided].map((i) => ({ idea: i.id, sentence: 'Sell the intake tool built for one client as a product.', worthIt: 'Worth a first step if five firms shown the offer ask for a price.' })),
    questions: [],
  };
  const saved = save({ ...o, doc: 'suggestions' }, stdin(doc));
  assert.equal(saved.ok, true, errorOf(saved));
  const printed = next(o);
  assert.equal(printed.to.phase, 'review', errorOf(printed));
  const bets = fs.readFileSync(path.join(dir, 'bets.html'), 'utf8');
  for (const part of ['Venture board · The bets', 'From the future: the day it worked', 'A services firm now sells the intake tool it built', 'Questions a sceptic would ask', 'What would have to be true', 'riskiest, as proposed', 'significant if it works', 'The frame', 'The provocation wall', 'Clients pay us nothing.', 'Not now', 'Killed', 'How the venture board works']) assert.ok(bets.includes(part), part);
  const brief = fs.readFileSync(path.join(dir, 'brief.html'), 'utf8');
  for (const part of ['Venture board · Decision brief', 'The bets worth a first step', 'Bets the venture board could not prove', 'bets.pdf']) assert.ok(brief.includes(part), part);
  assert.ok(!fs.existsSync(path.join(dir, 'discussion.html')));
  const page = fs.readFileSync(path.join(dir, 'site', 'ideas', `${survivors[0].id}.html`), 'utf8');
  assert.ok(page.includes('From the future: the day it worked') && page.includes('How it was argued') && page.includes('Attack: the customer does not care') === false);
  assert.match(fs.readFileSync(path.join(o.root, '.project-health', 'ideas.html'), 'utf8'), /Venture board, /);
  assert.equal(close({ ...o, force: true }).ok, true);
  assert.match(digest({ root: o.root }), /\{from the venture board\}/);
});

test('the venture skill is registered, its prompts exist, and it names no real person', () => {
  const lab = path.join(PLUGIN_ROOT, 'skills', 'venture');
  const skill = fs.readFileSync(path.join(lab, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: venture\ndescription: /);
  assert.match(skill, /venture\.mjs/);
  for (const f of ['framer', 'provocateur', 'proposer', 'proposer-second', 'amplifier', 'red-team', 'docket', 'judge', 'writer']) assert.ok(fs.existsSync(path.join(lab, 'agents', `${f}.md`)), f);
  const cast = readJson(path.join(lab, 'references', 'cast.json'));
  for (const s of cast.seats.filter((x) => x.proposes && x.role !== 'client')) assert.ok(fs.existsSync(path.join(lab, 'agents', 'roles', `${s.role}.md`)), s.role);
  assert.equal(validateFrame({}).length > 0, true);
  assert.equal(typeof assignAmplifiers, 'function');
});
