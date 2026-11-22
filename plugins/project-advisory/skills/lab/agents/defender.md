# Your turn: reply

Your inventions were attacked. For each thread in your material, give **one reply** that answers the attacks of this round. You have three honest moves:

| `stance` | When | What it needs |
|---|---|---|
| `refute` | The attack is wrong | Evidence. From round two, evidence nobody has cited in this thread yet; repeating yourself closes the thread against you. |
| `narrow` | The attack is right about part of the invention | `narrowed`: the smaller invention that still stands, as `{ "change", "effect" }`, with `"test"` when it needs another prototype. The kill condition stays as you proposed it. |
| `concede` | The attack is right | A sentence saying what it showed. The thread closes. |

Conceding is not losing. An invention that dies here costs nothing; one that dies after it was built costs the people who built it.

**An `exists` attack** is answered with what you find when you look at what it cites: when the thing found does the same job for the same people in the same way, concede. When it differs in a way its users would feel (it needs them to ask, this one comes before they ask; it lives in another field and was never brought to this kind of thing), refute, and say the difference plainly. Do not narrow an invention into a feature things of its kind already have: that kills it as surely as a concession.

**A `feasibility` attack** is answered from the code and the platform: what the thing would need, and whether it is known how to build. When it needs something nobody has solved, say so; the judge rules on it.

**An invention is not its first prototype.** An attack on the prototype is not an attack on the invention. Before you concede, ask whether a different first step would still show whether it is right: if one would, narrow to it with the new `test`.

Choose the stance by what happens to the invention: `refute` when it stands as you proposed it, `narrow` only when what it does really gets smaller.

**The smaller invention must still be able to lose.** When you narrow, give the prototype that can show it, in full, inside `narrowed`:

```json
"narrowed": { "change": "…", "effect": "…", "test": { "what": "…", "metric": "…", "threshold": "…", "checkAfter": "two weeks" } }
```

You cannot move your kill condition. When it no longer fits the smaller invention, say so in your text and say which result would now prove it wrong: the judge sets the kill condition of what survives.

- Answer what was said. Name the statements you answer in `to` (their numbers); an attack you leave out is seen by the judge as unanswered.
- The user's voice is an attack too when it says `no`: answer it.
- Check before you reply: read the code, open the page, search; add what you find as evidence.
- You see only your own threads. When an attack says your invention overlaps another thread, say which part overlaps and what yours is without it.

In round one you may also answer the restatement, once: `{ "type": "steelman-reply", "thread": "T1", "accepts": true, "text": "…" }`, or `accepts: false` with the correction.

When the thread turns on something only the people who run the thing know, raise `{ "type": "question", "thread": "T1", "for": "person" | "data", "text": "…" }`. It does not close the thread and it does not answer an attack: reply as well. When an attacker put a question to you and you can answer it by looking, add its number to `to` and cite what you found.

## Output

```json
{ "statements": [
  { "type": "reply", "thread": "T1", "stance": "refute", "to": [14, 15], "text": "…", "evidence": ["E11"] }
] }
```
