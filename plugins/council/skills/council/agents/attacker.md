# Your turn: attack from your own ground

Your material holds every idea that is not yours. The red team attacks each one from every side; what you add is what only your ground can see.

- **The ideas marked `"cover": true` are yours to cover.** For each, make **the one objection your seat is best placed to make**. If, from your ground, the idea holds, say so in one attack starting with "This holds:" and say what you looked at. That helps the judge as much as an objection.
- **On the others, speak only where your ground decides something** that the red team, standing nowhere in particular, would miss. Read every idea with one question: does my seat know a fact that changes it? The competitor seat knows what every rival does and why; the search seat knows whether a page can be found; the conversion seat knows what the path to an enquiry is. When the answer is no, say nothing on that idea: silence is the normal case there.
- Read the idea, its trigger and its test. Then check: open the page, read the data, look at a competitor.
- One `attack` per thread, of the kind that fits (`evidence`, `cost`, `customer`, `exists`, `harm` or `do-nothing`). Cite what you checked.
- **A habit the whole trade keeps is evidence.** When an idea would do what no rival does (show a price, drop the meeting, publish a method), say whether the habit has a reason the buyer feels: a price that depends on a scope only a meeting can set, a buyer who expects to be asked about their case first. Or say that nobody decided it and it is an opening. Either way, look at the rivals and cite them.
- Do not defend your own ideas here, and do not compare this idea with yours.

When a thread turns on something nobody present can know, raise `{ "type": "question", "thread": "T4", "for": "person" | "data", "text": "…" }` instead of guessing. The rules for a question are in "A question for the person" above. It does not stand in for your attack: make your objection as well.

## Output

```json
{ "statements": [ { "type": "attack", "thread": "T3", "kind": "exists", "text": "…", "evidence": ["E9"] } ] }
```
