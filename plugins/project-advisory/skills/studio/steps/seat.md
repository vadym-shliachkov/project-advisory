# Your turn: two concepts for the site

You are one seat of a design studio. Every seat starts from a different place (yours is below, under "Your material"), and each was dealt different framings and idea cards. You propose **two concepts** for this site, as different from each other as you can make them.

A concept is what an art director pitches: **the idea behind the site**, **the visual world that carries it**, and **the motion that gives it feeling**. One page will be built from the concept the judge picks, so write it so a builder can see it in their head. Your concepts will be attacked over up to three rounds: make them strong, not safe.

You are not shown other seats' concepts, and not shown other sites (only patterns, with no site named): you cannot copy what you were not shown. Do not go looking for sites of this trade before you have written your concepts.

## What a concept is not

- **Not a rule about type.** "The question is the only large type", "weight shows how settled a fact is" are typesetting rules. They will be refused. Type is one sentence at the end, chosen by the idea.
- **Not a correction to the site.** Clearer, bigger, simpler, more white space: that is maintenance.
- **Not a text page.** If your concept would look right as a printed report, it is not a site concept. Ask what the visitor *sees*: light, space, objects, colour fields, images, drawings, depth, mechanism.
- **Not a list of effects.** Smoke, grain, cursor trails, a 3D blob: an effect with no idea behind it is decoration.
- **Not a rival's site.** If a competitor's name would fit on it, cross it out.

## How to find it

1. Read every study, above all what the business has, what customers say and feel, and **what the web can newly do** (the craft scan): the newest openings are where solutions nobody has used come from. Read the frame and what the person said.
2. **Answer your framings with your cards.** For each framing, apply each card to the business's material, and write for yourself one sentence: "This site is …, because this business …". Then read the provocations and mine each for what is workable. At least twelve sentences, quickly, without judging. Absurd is allowed.
3. Keep the ones that make you **see something**: an image, a space, a movement. Drop the ones that only say something.
4. For each, ask what the idea chooses: what the visitor sees first, what the world is made of, what moves, how and with what feeling, what the visitor does and what answers. When the idea chooses nothing visible, it is a slogan: drop it.
5. Name the one moment a visitor would describe to someone else that evening.
6. **Only now, search.** For each concept left, look for the nearest thing that exists: on sites of this trade, on sites elsewhere, outside the web. What exists in this trade, cross out. What exists elsewhere may stay when your mechanism and your reason are your own: say how it differs.
7. Send the two furthest from each other.

## The fields (JSON)

- `name`: the concept in two to six words.
- `idea`: one sentence: "The site is …, because this business …".
- `feeling`: what a visitor feels in the first ten seconds, and why that is right for these visitors.
- `world`: what the visitor sees: the forms, the space, the light, the materials, the images (and where they come from), the colour and where it comes from. Two to five sentences.
- `motion`: what moves, how (weight, speed, rhythm), what the visitor's scrolling, pointer or touch does to it, and the feeling each movement carries. Two to five sentences. Name the web capability it uses when it uses a new one.
- `moment`: the one moment a visitor would tell someone about.
- `hero`: the first screen, described so it can be drawn.
- `inside`: how the idea carries into one inner page (a case, a service, a product) and into the way a visitor gets in touch.
- `type`: one sentence: the letters this idea calls for, and why.
- `onlyThem`: why it could not be a rival's site.
- `madeOf`: the ids or names from the study it grows from, one to six.
- `answers`: the framing it answers (H… or T…); `cards`: the ids of your cards that led to it; `provocation`: the P… id it was mined from, when it was.
- `priorArt`: `exists` (`yes`, `partly` or `no`), `searched` (how and where), and when something was found `nearest` (what and where) and `difference` (why yours is not the same, in mechanism and in reason).

```json
{ "concepts": [ {
  "name": "…", "idea": "…", "feeling": "…", "world": "…", "motion": "…",
  "moment": "…", "hero": "…", "inside": "…", "type": "…", "onlyThem": "…", "madeOf": ["M2"],
  "answers": "H3", "cards": ["K11", "K49"], "provocation": "P4",
  "priorArt": { "exists": "partly", "searched": "…", "nearest": "…", "difference": "…" }
}, { "…": "the second concept" } ] }
```
