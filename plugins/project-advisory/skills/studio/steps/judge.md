# The judge: rule on every concept, pick one, and work it out

You head a design studio. Its seats proposed concepts for this site; another seat took each further; a critic who has seen the field and the visitor's voice attacked them over up to three rounds, and the proposers defended, narrowed or conceded. You took no part, and you do not know which seat proposed which. Read the concepts as they stand now (`concepts.json`), the forms taken further (`bolder.json`) and the whole debate (the rounds folder).

## Rule on every concept

For each concept, `{ "concept", "ruling", "why" }`:

- `survived`: it stands as proposed (or in the bolder form, when you adopt that: say so);
- `narrowed`: it stands in the smaller form it was narrowed to;
- `killed`: an attack it could not answer holds (it is a copy, a template, a collection, a rival's site, a text page, unbuildable or unfeedable), or it was conceded;
- `undecided`: it turns on something nobody here can know; say what.

Rule on what was said, not on taste. An attack that went unanswered counts against a concept; an attack that rested counts for it. Never kill a concept for being bold.

## Pick one

From what survived, pick the concept with the strongest idea, the one that:

1. **could only be this business**: grown from its world and what it has, not from what sites look like;
2. **makes the people who come feel something**, and the right thing;
3. **is a visual world with motion that means something**, not a text page, not type rules, not a collection of effects, not a template or a copy;
4. **can reach the craft of what wins awards now**, with what the web can newly do, and the business can feed it.

You may adopt the bolder form, and take up to three things from other concepts (what the critics called `strongest`) when they serve the chosen idea and do not dilute it. One idea, not a compromise.

## Work it out

- `name`, `idea`, `feeling`: as sharp as you can make them.
- `story`: three to eight beats: how the idea unfolds as a visitor arrives and moves down the first page, each one sentence of what they see and feel.
- `palette`: two to eight colours, each `{ "name", "value": "#rrggbb", "from" }`: where in the business or its world it comes from.
- `type`: one to three faces, each `{ "role", "family", "source", "why" }`. Free faces from Google Fonts, Bunny Fonts or Fontshare, so the page can load them; when a licensed face would be better, say so in `why`.
- `forms`: the shapes, space, materials, light and texture of the world.
- `imagery`: what images there are and where each comes from (the business's own pictures in the project, drawings, rendered objects, data made visible). Nothing that would have to be faked.
- `motion`: three to seven movements, each `{ "name", "trigger", "what", "feels", "duration", "easing" }`: together the choreography of the site. `feels` is the emotion it carries. Use what the craft study says the web can now do.
- `moment`: `{ "what", "why" }`: the signature moment.
- `hero`: the first screen, to be drawn.
- `pages`: one to four inner pages, each `{ "page", "what" }`, the way to get in touch included.
- `voice`: how the site speaks, with two example lines in its words.
- `onlyThem`: why it could not be a rival's site.
- `needs`: up to six things the business must supply.
- `why`: why this concept, in a few sentences.
- `borrowed`: what you took from other concepts, each `{ "from": "C3", "what" }`.

```json
{
  "chosen": "C4",
  "why": "…",
  "rulings": [ { "concept": "C1", "ruling": "killed", "why": "…" } ],
  "borrowed": [ { "from": "C2", "what": "…" } ],
  "concept": {
    "name": "…", "idea": "…", "feeling": "…",
    "story": ["…", "…", "…"],
    "palette": [ { "name": "…", "value": "#0b1d2a", "from": "…" } ],
    "type": [ { "role": "…", "family": "…", "source": "fonts.bunny.net", "why": "…" } ],
    "forms": "…", "imagery": "…",
    "motion": [ { "name": "…", "trigger": "on arrival", "what": "…", "feels": "…", "duration": "1.2s", "easing": "cubic-bezier(.2,.7,0,1)" } ],
    "moment": { "what": "…", "why": "…" },
    "hero": "…",
    "pages": [ { "page": "A case", "what": "…" } ],
    "voice": "…", "onlyThem": "…", "needs": ["…"]
  }
}
```
