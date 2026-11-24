# Your turn: reply

Your directions were attacked. For each thread in your material, give **one reply** that answers the attacks of this round. You have three honest moves:

| `stance` | When | What it needs |
|---|---|---|
| `refute` | The attack is wrong | Evidence. From round two, evidence nobody has cited in this thread yet; repeating yourself closes the thread against you. |
| `narrow` | The attack is right about part of the direction | `narrowed`: the smaller direction that still stands, as `{ "change", "effect" }`, with `"test"` when it needs another one. The kill condition stays as you proposed it. |
| `concede` | The attack is right | A sentence saying what it showed. The thread closes. |

Conceding is not losing. A direction that dies here costs nothing; one that dies after the site was built costs the business a site.

**A `copy` attack** names a site. Look at it (the `look` command), then answer honestly. When it looks and moves the same, concede. When only the principle is shared, refute, and say what is yours: the mechanism, and the reason from this business. When part of your direction is that site's (its gallery, its opening), narrow by giving that part up or giving it a form of its own.

**An `assembled` attack** says nothing holds the direction together. Answer by saying which one idea chose every part, part by part. A part the idea did not choose, give up: narrow. When no idea chose them, concede.

**A `generic` attack** is the swap test. Answer with what in the direction would be wrong for a rival, and show that it is the heart of the design. "Their name is on it" and "it uses their colours" are not answers.

**A `slop` attack** names a tell of a template. Give the reason from this business for that choice, or give the choice up.

**A `signature` attack** is answered for the visitor in a hurry on the tenth visit, not for the first visit of someone with time. Making the moment smaller, or once only, or the visitor's to start, is an honest narrowing; so is dropping it and keeping the direction.

**A `feasibility` attack** is answered from what a browser does today and from what the business has (the anatomy's material, by where it is). When the direction needs photographs or texts the business does not have, say what the smaller direction is that it could feed, or ask the person.

**A direction is not its test.** An attack on the test is not an attack on the direction. Before you concede, ask whether a different first step would still show whether it is right: if one would, narrow to it with the new `test`.

Choose the stance by what happens to the direction: `refute` when it stands as you proposed it, `narrow` only when what it is really gets smaller. **Do not narrow a direction into the usual site of its trade**: that kills it as surely as a concession.

**The smaller direction must still be able to lose.** When you narrow, give the test that can show it, in full, inside `narrowed`:

```json
"narrowed": { "change": "…", "effect": "…", "test": { "what": "…", "metric": "…", "threshold": "…", "checkAfter": "two weeks" } }
```

You cannot move your kill condition. When it no longer fits the smaller direction, say so in your text and say which result would now prove it wrong: the judge sets the kill condition of what survives.

- Answer what was said. Name the statements you answer in `to` (their numbers); an attack you leave out is seen by the judge as unanswered.
- The visitor's voice is an attack too when it says `no`: answer it.
- Check before you reply: open the page, open the material, search; add what you find as evidence.
- You see only your own threads. When an attack says your direction overlaps another thread, say which part overlaps and what yours is without it.

In round one you may also answer the restatement, once: `{ "type": "steelman-reply", "thread": "T1", "accepts": true, "text": "…" }`, or `accepts: false` with the correction.

When the thread turns on something only the people who run the business know, raise `{ "type": "question", "thread": "T1", "for": "person" | "data", "text": "…" }`. It does not close the thread and it does not answer an attack: reply as well. When an attacker put a question to you and you can answer it by looking, add its number to `to` and cite what you found.

## Output

```json
{ "statements": [
  { "type": "reply", "thread": "T1", "stance": "refute", "to": [14, 15], "text": "…", "evidence": ["E11"] }
] }
```
