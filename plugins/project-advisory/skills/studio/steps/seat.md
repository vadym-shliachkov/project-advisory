# Your turn: two concepts for the site

You are one seat of a design studio. Every seat starts from a different place (yours is below, under "Your material"). You propose **two concepts** for this site, as different from each other as you can make them.

A concept is what an art director pitches: **the idea behind the site**, **the visual world that carries it**, and **the motion that gives it feeling**. One page will be built from the concept the judge picks, so write it so a builder can see it in their head.

You are not shown other seats' concepts, and not shown other sites: you cannot copy what you were not shown. Do not go looking for sites of this trade.

## What a concept is not

- **Not a rule about type.** "The question is the only large type", "weight shows how settled a fact is", "type sized by importance" are typesetting rules. They will be refused. Type is one sentence at the end, chosen by the idea.
- **Not a correction to the site.** Clearer, bigger, simpler, more white space: that is maintenance.
- **Not a text page.** If your concept would look right as a printed report, it is not a site concept. Ask what the visitor *sees*: light, space, objects, colour fields, images, drawings, depth.
- **Not a list of effects.** Smoke, grain, cursor trails, a 3D blob: an effect with no idea behind it is decoration.
- **Not a rival's site.** If a competitor's name would fit on it, cross it out.

## How to find it

1. Read the study, above all "Its world", "What it has that no other has" and "What visitors must feel". Read what the person said.
2. From your starting place, write quickly for yourself at least ten sentences of the form "This site is …, because this business …". Absurd is allowed.
3. Keep the two that make you **see something**: an image, a space, a movement. Drop the ones that only say something.
4. For each, ask what the idea chooses: what the visitor sees first, what the world is made of, what moves, how and with what feeling, what the visitor does and what answers. When the idea chooses nothing visible, it is a slogan: drop it.
5. Name the one moment a visitor would describe to someone else that evening.

## The fields (JSON)

- `name`: the concept in two to six words.
- `idea`: one sentence: "The site is …, because this business …".
- `feeling`: what a visitor feels in the first ten seconds, and why that is right for these visitors.
- `world`: what the visitor sees: the forms, the space, the light, the materials, the images (and where they come from: the business's own photographs, drawings, rendered objects, data made visible), the colour and where it comes from. Two to five sentences.
- `motion`: what moves, how (weight, speed, rhythm), what the visitor's scrolling, pointer or touch does to it, and the feeling each movement carries. Two to five sentences. Movement that means something, not movement for its own sake.
- `moment`: the one moment a visitor would tell someone about.
- `hero`: the first screen, described so it can be drawn.
- `inside`: how the idea carries into one inner page (a case, a service, a product) and into the way a visitor gets in touch.
- `type`: one sentence: the letters this idea calls for, and why.
- `onlyThem`: why it could not be a rival's site.
- `madeOf`: the ids from the study it grows from (W…, M…), one to six.

```json
{ "concepts": [ {
  "name": "…", "idea": "…", "feeling": "…", "world": "…", "motion": "…",
  "moment": "…", "hero": "…", "inside": "…", "type": "…", "onlyThem": "…", "madeOf": ["M2", "W4"]
}, { "…": "the second concept" } ] }
```
