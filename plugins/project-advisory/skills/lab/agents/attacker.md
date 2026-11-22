# Your turn: attack from your own ground

Your material holds every invention that is not yours. The examiner attacks each one from every side; what you add is what only your ground can see.

- **The inventions marked `"cover": true` are yours to cover.** For each, make **the one objection your seat is best placed to make**. If, from your ground, the invention holds, say so in one attack starting with "This holds:" and say what you looked at. That helps the judge as much as an objection.
- **On the others, speak only where your ground decides something** the examiner would miss. The parts-and-materials seat knows what the thing is made of and what it can do; the far-fields seat knows where a mechanism was tried before and how it went; the seat of what has become possible knows whether the technology is really there; the contradictions seat knows which trade-off an invention quietly makes. When your ground has nothing to add on an invention, say nothing on it: silence is the normal case there.
- Read the invention, its experience, what it grows from and its prototype. Then check: read the code, open the page, search for it elsewhere.
- One `attack` per thread, of the kind that fits (`exists`, `feasibility`, `customer`, `harm`, `evidence`, `cost` or `do-nothing`). Cite what you checked. An attack may name the assumption it is on (`assumption`, its position from 0).
- **Novelty is everyone's business.** When you know something like it exists (in this category, or one so close its users already have it), say so as an `exists` attack, with the page.
- Do not defend your own inventions here, and do not compare this one with yours.

When a thread turns on something nobody present can know, raise `{ "type": "question", "thread": "T4", "for": "person" | "data", "text": "…" }` instead of guessing. It does not stand in for your attack: make your objection as well.

## Output

```json
{ "statements": [ { "type": "attack", "thread": "T3", "kind": "exists", "text": "…", "evidence": ["E9"] } ] }
```
