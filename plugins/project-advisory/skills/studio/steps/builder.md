# The builder: one page that presents the concept

A design studio picked one concept for this site (`pick.json`). You build **one page that presents it**, the page the person who runs the business opens to see their new site. They must *see* it and *feel* it within ten seconds. They should not have to read about it.

This is an art director's presentation of a new site, built in the browser, not a report. Explanation is at most a few short lines per section; everything else is shown.

## What the page is, top to bottom

1. **The new site's first screen, full size and alive.** The hero exactly as the concept describes it, in the business's own words (from the study and the live site), with its motion running on arrival. No frame and no caption around it: the page opens *as* the new site.
2. **The idea**: the concept's name and its one-sentence idea, and what a visitor should feel. Two or three lines, set the way the concept would set them.
3. **The story**: the beats of `story`, built. Scroll down and the idea unfolds as it would on the real home page: each beat is a section of the new site, with its motion.
4. **The world**: the palette (swatches with values and where each comes from), the type (set in use, not as a specimen sheet), the forms and the image treatment, all shown.
5. **The motion**: each movement of `motion`, live, with its name, what it makes you feel, and a way to play it again (a button, or it replays when it scrolls back into view).
6. **Inside**: one or two inner pages of `pages` (a case, the way to get in touch), in the new design, shown in a desktop frame and a phone frame side by side.
7. **Before and after**: the site as it is today beside the new first screen, small. A picture of the live site is in the study's pictures, or take one with the `look` command and copy it in with `asset`.

## Craft

- **Reach the level of what wins awards now.** Look at the pictures of honoured sites for the level of craft: composition, depth, pace, polish. Take the level, never a layout, an effect or a motif of one site.
- **Motion carries the feeling.** Choreograph it: arrival, scroll, pointer. Use real easing curves, staggered timing and weight. Scroll-linked motion, pinned sections, SVG drawing, canvas, WebGL shaders and 3D are all open to you when the concept calls for them. GSAP (with ScrollTrigger), Three.js, Lenis and similar libraries may be loaded from cdn.jsdelivr.net, unpkg.com or cdnjs.cloudflare.com.
- **Images.** Use the business's own pictures from the project (copy them with `asset`). Draw what can honestly be drawn (diagrams, objects, maps, data, patterns) with SVG, canvas or WebGL. Never fake a photograph of the business's people, places or clients; where the concept needs a photograph the business must supply, draw a frame of its shape with a short line saying what goes there.
- **Type follows the idea.** Load the concept's faces from fonts.googleapis.com, fonts.bunny.net or api.fontshare.com.
- **Not the slop.** No centred-headline-plus-gradient hero, no row of three rounded cards, no everything-fades-up-on-scroll, no default shadows. Check the field study's template tells before you finish, and take out any your page has that the concept did not ask for.
- **It works**: on a phone (390 pixels wide), by keyboard, and for a visitor who asked for less motion (`prefers-reduced-motion`: the page is complete and composed when still). Text has enough contrast.

## The file

`page/index.html`, with its CSS and script inside it or beside it in `page/`. Pictures in `page/assets/`.

The check refuses a page that has: a form, a frame, `fetch`, XMLHttpRequest, `sendBeacon`, a WebSocket, storage or cookies, `<meta http-equiv>`, or any address other than the font hosts and the three script CDNs (no links out, no images from the web). It needs `<meta name="viewport">` and a `prefers-reduced-motion` rule.

Photograph your page with the `shoot` command and look at the pictures before you finish. If it looks like a template, a report, or a page of text, it is not done.

## When you revise

When this brief points you at what the stranger saw (`look.json`), revise the page you made: change what it asks, within the concept. Do not change what the concept is.
