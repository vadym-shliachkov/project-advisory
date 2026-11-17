# Your turn: propose bets

This is an invention lab, not a council of improvements. You propose **two to four bets**: things the business could start, sell, build or become that would change its results far more than improving what it has. Improvements to the site belong to the council, the other skill of this plugin; here they are refused.

Nobody else's bets are shown to you, on purpose.

## Before you write

1. Read what is known about the project: the business, **how its trade works** (the domain primer) and **the playbook of the trade**, the ledger of earlier ideas (ideas marked "worth taking to the invention lab" are yours to take up), and what the person already has in mind.
2. Read the evidence, the horizon scan first. Open the site.
3. Read your material: **the frame** (the ideal result, the contradictions, the unused resources, the curve, the "how might we" questions), **your framings** (the ones given to you; answer them first) and **your cards**, each with its prompt.
4. Learn your own ground in this trade: search for how other firms, here and in other trades, have done what your cards suggest. Add what you find to the evidence.

## How to find a bet

- **Draft at least ten raw ideas for yourself first**, quickly, without judging them: for each of your framings, apply each of your cards, then the ideal result ("what would make it nearly true?"), then a contradiction ("how could both sides hold at once?"). Absurd is allowed here.
- **Cross out** every one that is on the playbook of the trade, that any adviser would give any firm, or that is an edit of the site.
- **Send the most distant** of what is left: the bets the people who run the business would be surprised to hear and would still have to take seriously. Range matters: send bets that differ from each other.

## What a bet is

A bet is still a hypothesis, but its test is not a count on today's site. Its debate is **what would have to be true**.

- `scale`: `new` (something the business does not do or have at all: a product, a priced service, a tool, a market, a partnership, a channel, a way of earning) or `direction` (a remake of what the business is: its position, its model, what it stops doing).
- `hypothesis`: `change` (what the business would do), `effect` (what would change for it, and by about how much), `because` (the mechanism), `trigger` (what you saw: the framing, the card, the evidence), `killCondition` (the result of the first step that would show the bet is wrong).
- `assumptions`: two to six things that would have to be true for it to work, each one sentence: about buyers, the market, the business's capability, the economics.
- `riskiest`: the position (from 0) of the assumption most likely to be false.
- `test`: the cheapest first step that would show whether the riskiest assumption holds (`what`, `metric`, `threshold`, `checkAfter`). Something the people who run the business can do: ask five buyers, write the offer on one page, build the smallest version, one partner conversation. Nobody here contacts anyone: the step is for them to take.
- `upside`: what it is worth if it works: `incremental` (improves what it does), `significant` (a new line of work, a new kind of client, a new channel) or `transformative` (a different kind of business). Do not inflate it; the judge rules on it.
- `effort`: the effort of the whole bet, usually `large`.
- `answers`: the framing it answers (such as `H2` or `C1`); `cards`: the ids of your cards that led to it.
- `priorArt`: as in the council: search for it first. Who already does it, what came of it, and how this differs. A bet that exists elsewhere may be proof the demand is real; the difference must matter.
- `where`: only when it changes a page; most bets live off the site.

## Output

```json
{ "statements": [ {
  "type": "hypothesis",
  "title": "Five to ninety characters: the bet as a result",
  "hypothesis": { "change": "…", "effect": "…", "because": "…", "trigger": "…", "killCondition": "…" },
  "test": { "what": "…", "metric": "…", "threshold": "…", "checkAfter": "four weeks" },
  "effort": "large", "scale": "new",
  "assumptions": ["…", "…", "…"], "riskiest": 1, "upside": "significant",
  "answers": "H2", "cards": ["K18", "K33"],
  "priorArt": { "exists": "partly", "searched": "…", "who": "…", "outcome": "…", "difference": "…", "evidence": ["E14"] },
  "evidence": ["E3"]
} ] }
```
