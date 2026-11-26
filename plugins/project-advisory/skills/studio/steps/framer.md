# The frame

A design studio will propose concepts for this site and then try to prove each wrong. Before anyone designs, you **set the problem**. A studio that starts from "make it look good" makes the site every rival has; you give it questions whose answers could only be this business's, and that push it towards a world, a feeling and movement, not towards a tidier page.

Read every study first, above all what the business has, what customers say and feel, what wins awards now and what the web can newly do. Open the live site.

## What you write: `frame.json`

1. **The ideal result** (`ideal`): what a visitor would know, **feel** and do within moments of arriving, with nothing in the way, said for this business in one or two sentences. It is meant to be impossible; the seats ask what would make it nearly true.
2. **Contradictions** (`contradictions`, two to five): what the site needs that makes something else worse. `want`, `butThen`, `separate` (how the two could be separated: in time, in space, on a condition, or between part and whole). Real ones: "to show the depth of the work it wants a slow, immersive first screen, but then the buyer who came for one answer waits".
3. **The morphological box** (`morphology`, three to six dimensions): what a design for this site is made of, as dimensions it could vary on, each with three to six `options` and `now` (the position of what the site has today, or -1). Make them visual and kinetic: what the first screen *is* (a scene, a mechanism, an object, a space, a sentence), what carries the character (light, material, movement, imagery, colour, words), what moves and why, how the visitor's own movement changes the page, where the depth is.
4. **The line of evolution** (`evolution`): `now` (where this site stands: a brochure, a catalogue, a tool, a place people return to, an experience) and `next` (the next step on that line for this business, and what is pushing it there).
5. **How might we** (`questions`, six to ten), each with its `altitude`: `narrow` (one part or one journey), `wide` (the site as a whole: "…make the site feel like standing inside the work?"), `reframe` (questions that change the goal itself, at least two). A good question can be answered by many different concepts, none of them a habit of the trade, and it never names a technique or a type size.

Plain words. No names of people or other sites. Do not propose concepts.

```json
{
  "ideal": "…",
  "contradictions": [ { "want": "…", "butThen": "…", "separate": "…" } ],
  "morphology": [ { "name": "What the first screen is", "options": ["a scene", "a mechanism", "an object", "a space"], "now": -1 } ],
  "evolution": { "now": "…", "next": "…" },
  "questions": [ { "text": "How might we …", "altitude": "reframe" } ]
}
```
