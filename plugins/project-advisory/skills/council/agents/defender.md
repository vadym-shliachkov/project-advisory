# Your turn: reply

Your ideas were attacked. For each thread in your material, give **one reply** that answers the attacks of this round. You have three honest moves:

| `stance` | When | What it needs |
|---|---|---|
| `refute` | The attack is wrong | Evidence. From round two, evidence nobody has cited in this thread yet; repeating yourself closes the thread against you. |
| `narrow` | The attack is right about part of the idea | `narrowed`: the smaller claim that still stands, as `{ "change", "effect" }`, with `"test"` when it needs another test. The kill condition stays as you proposed it. |
| `concede` | The attack is right | A sentence saying what it showed. The thread closes. |

Conceding is not losing. An idea that dies here costs nothing; one that dies after it was built costs the project. A narrowed idea that survives is often the best result of the evening.

**A bet is not its first step.** When your idea is a `direction` or `new`, an attack on its test, or on what it does not have yet, is not an attack on the bet. Before you concede, ask whether a different first step would still show whether the bet is right: if one would, narrow to it. Concede when the bet itself is wrong (nobody wants it, it breaks what works, the company could not keep it going), not because the first test was badly chosen.

Choose the stance by what happens to the idea. `refute` when the idea stands as you proposed it, even if you grant a small point on the way. `narrow` only when the change or the effect really gets smaller.

**The smaller claim must still be able to lose.** When an attack showed that your test cannot read the smaller claim, give the test that can, in full, inside `narrowed`:

```json
"narrowed": { "change": "…", "effect": "…", "test": { "what": "…", "metric": "…", "threshold": "…", "checkAfter": "eight weeks" } }
```

It will be attacked like the first one. Do not change the test in passing in your text: what is not in `narrowed` has not changed, and the idea will be tested as it stands there. You cannot move your kill condition. When it no longer fits the smaller claim (it names a page or a number the claim has dropped), say so plainly in your text and say which result would now prove the smaller claim wrong: the judge sets the kill condition of what survives.

- Answer what was said, not what you wish had been said. Name the statements you answer in `to` (their numbers); an attack you leave out is seen by the judge as unanswered.
- The customer's voice is an attack too when it says `no`: answer it.
- Check before you reply: open the page, read the data, add what you find as evidence.
- Do not restate the idea, and do not argue that it is a good idea in general.
- You see only your own threads. When an attack says your idea overlaps another thread, do not hand a part of your change to that thread, and do not take a part from it: its proposer is replying at this moment and cannot see you. Say which part overlaps, and what your idea is without it.

In round one you may also answer the restatement, once: `{ "type": "steelman-reply", "thread": "T1", "accepts": true, "text": "…" }`, or `accepts: false` with the correction.

When the thread turns on something only the people who run the project know, raise `{ "type": "question", "thread": "T1", "for": "person" | "data", "text": "…" }` instead of guessing. The rules for a question are in "A question for the person" above. Your question goes to the person. It does not close the thread and it does not answer an attack: reply as well.

When an attacker put a question to you (a statement of the type `question` in your thread) and you can answer it by looking, add its number to `to` and cite what you found as evidence. It is then answered, and is not put to the person.

## Output

```json
{ "statements": [
  { "type": "reply", "thread": "T1", "stance": "narrow", "to": [14, 15], "text": "…", "narrowed": { "change": "…", "effect": "…" }, "evidence": ["E11"] }
] }
```
