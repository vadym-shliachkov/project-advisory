# Your turn: invent

This is an invention lab, not a council of improvements. You propose **two to four inventions**: new things this thing could do, have or become, that nobody has built into things of its kind. Tidying what is there belongs to the council; marketing, pricing and business models belong to the venture board. Here they are refused.

Nobody else's inventions are shown to you, on purpose.

## Before you write

1. **Read the anatomy**: what the thing is, who uses it and for what, its parts (A…), what it knows (D…), what its platform could do and does not (U…), its journeys (J…) and weak spots (W…), and what the person corrected. Your inventions grow from it.
2. **Read the genre**: the standard kit (G…), which you must go beyond, and the frontier (F…), the most inventive things of its kind, which you must not copy.
3. Read what is known about the project (the ledger of earlier ideas, what the person already has in mind, what is off limits) and the evidence: what its users say (by `voice`) and what has become possible (by `tech`).
4. **Use it.** Open the thing as one of its users would, when it can be seen; read how it is used when it is a tool or a library. The `look` command shows a screen.
5. Read your material: **the frame** (the ideal result, the contradictions, the morphological box, the line of evolution, the "how might we" questions), **your framings** (the ones given to you: answer them first) and **your cards**, each with its prompt.
6. **Learn your own ground**: search for how other things, in this field and far from it, have done what your cards suggest. Add what you find to the evidence.

## How to find an invention

- **Draft at least twelve raw inventions for yourself first**, quickly, without judging them: for each of your framings, apply each of your cards; then the ideal result ("what would make it nearly true?"); then a contradiction ("how could both sides hold at once?"); then an empty cell of the morphological box; then one thing the anatomy says it knows or could do and does not. Absurd is allowed here.
- **Cross out** every one that is on the genre's standard kit, that a rival already has, that any product team would put on its roadmap without looking at this thing, that is a tidy-up of what is there, or that is about selling rather than using.
- **Search for what is left.** For each survivor of your own list, look for it: in things of this kind, on the frontier, and in other fields. What exists in this category is crossed out; what exists only elsewhere may stay, as new to the category, if bringing it here changes something for these users.
- **Send the most distant** of what is left: inventions the people who built the thing would be surprised by and still have to take seriously. Range matters: send inventions that differ from each other in what they grow from and how far they reach.

## What an invention is, field by field

- `title`: five to ninety characters: the invention as what it does ("The search that writes back when the answer exists").
- `hypothesis`: `change` (what the thing would do or have, concretely enough to build), `effect` (what would change for the people who use it), `because` (the mechanism), `trigger` (what you saw: the part, the card, the framing, the evidence), `killCondition` (the result of the first step that would show it is wrong).
- `experience`: three to six steps, how a person would live it, each one sentence in the present tense ("You type a question the site cannot answer." "It says so, and asks whether to write when it can." …). An invention nobody can picture is a slogan.
- `buildsOn`: one to six anatomy ids it grows from, at least one a part (A…), something it knows (D…) or something its platform could do (U…).
- `scale`: `feature` (a new capability inside the thing), `product` (a new thing built from it, beside it: a companion, a widget, an edition, a tool) or `remake` (a new way the whole thing works).
- `newTo`: `world` (nothing like it was found anywhere) or `category` (it exists in other fields, not in things of this kind). Be honest: the judge rules on it, and the examiner will search.
- `priorArt`: what you found when you looked: `exists` (`yes`, `partly` or `no`), `searched` (how and where), and when something was found `who`, `outcome` (what came of it), `difference` (why this is not the same, for these users) and its `evidence`.
- `assumptions`: two to six things that would have to be true for it to work, each one sentence: about the people who use it, what the thing can do, what it would cost to keep.
- `riskiest`: the position (from 0) of the assumption most likely to be false.
- `test`: the smallest prototype or first step that would show whether the riskiest assumption holds: `what` (a clickable mock shown to five users, the feature behind a flag for one page, a script run on last month's data, a paper sketch tested in a café), `metric`, `threshold`, `checkAfter`. Something the people who run the thing can do; nobody here contacts anyone.
- `upside`: what it is worth if it works: `incremental` (makes what the thing does better), `significant` (a capability its users would choose it for) or `transformative` (a different kind of thing). Do not inflate it.
- `effort`: the effort of building the whole invention: `small`, `medium` or `large`.
- `answers`: the framing it answers (such as `H2` or `C1`); `cards`: the ids of your cards that led to it.
- `where`: the places on its live pages it would change, when it changes a page that can be seen, each `{ "url", "part", "text" }` (words shown in that part, so it can be photographed); leave it out otherwise.

## Output

```json
{ "statements": [ {
  "type": "hypothesis",
  "title": "Five to ninety characters: the invention as what it does",
  "hypothesis": { "change": "…", "effect": "…", "because": "…", "trigger": "…", "killCondition": "…" },
  "experience": ["…", "…", "…"],
  "buildsOn": ["A4", "D2"],
  "test": { "what": "…", "metric": "…", "threshold": "…", "checkAfter": "two weeks" },
  "effort": "medium", "scale": "feature", "newTo": "category",
  "assumptions": ["…", "…", "…"], "riskiest": 1, "upside": "significant",
  "answers": "H2", "cards": ["K26", "K37"],
  "priorArt": { "exists": "partly", "searched": "…", "who": "…", "outcome": "…", "difference": "…", "evidence": ["E14"] },
  "evidence": ["E3"]
} ] }
```
