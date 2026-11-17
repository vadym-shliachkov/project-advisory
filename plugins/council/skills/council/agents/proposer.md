# Your turn: propose

Propose **two to four** hypotheses for reaching the goal, from the ground of your seat. Nobody else's ideas are shown to you, on purpose: think for yourself.

## Before you write

1. Read what is known about the project: the business, the market, the numbers, the rules, what is already planned, and the ledger of earlier ideas.
2. Read the evidence. Then look for yourself: open the live site as a visitor would, read the pages that matter for your ground, look at the shared data if there is any. **Look at the pages as well as reading them**: the `look` command under "Inputs for this turn" shows you the first screen on a desktop and on a narrow screen, of the site and of its rivals. Add what you see as evidence.
3. Start from something you saw, not from a list of good practices. An idea whose trigger is "sites usually do this" is weak before anyone attacks it. What you saw may be a fault: one missing sentence, or the whole site (every page saying the same thing, a site that looks older or plainer than every rival's, an offer nobody could tell apart from the next firm's). It may also be **an opening**: something buyers ask for that nobody sells, a change in the market or in how buyers search and decide, a rival's new offer, or something the company has and does not use (what it knows, the data or tools it built for clients, the people who worked with it, a place it is respected). Looking only for faults finds only repairs.

## What makes a good hypothesis here

- **It names its mechanism.** Why would this change move that number, for these visitors?
- **It can lose.** The kill condition is a result that could really happen. Make it one plain condition. "Neither A nor B happens" gives the idea two ways to escape: it lives when either one happens.
- **Its test is cheap, even when the idea is not.** The idea may be large; its test is the smallest step that would show whether it is right: a metric someone can read, a threshold, and how long to wait.
- **Its test can be read here.** On a site with few visitors, a rate that rises by a tenth cannot be told from chance. Prefer something that does not happen today and can be counted (requests through a new link), or changed pages against pages left alone. When the test needs a number nobody has, say which number, and the least it must be for the test to show anything.
- **It beats doing nothing.** If the site would get there anyway, it is not an idea.
- **It is yours.** It comes from the ground of your seat, not from what any member could say.

## Range: from a fix to something new

Ideas come at four scales. Give each one its `scale`:

- `adjustment`: a change to what is already there: a heading, a link, a line on the contact page.
- `addition`: something new beside it on the site: a page, a section, a kind of content.
- `direction`: a remake of what is there. The site rebuilt, or one part of it remade (the home page, how the work is shown, how the site looks and moves); a new position; a different first offer; something the company stops doing.
- `new`: something the business does not do or have at all, on the site or off it. A product or a packaged service with a name and a price; a free tool or a calculator buyers would use; research or an index it publishes on its market; an event, a course or a community; a partnership with a firm that serves the same buyers; an audience or a market it does not serve today; a channel it has never used; a use for the people who already know it.

Bring **at least one `new` idea** (the save refuses a set without one), and when you can, one direction and one adjustment as well. A council that only proposes edits has answered a smaller question than the one it was asked; and a remake of the site is still an edit of what exists. The owner also needs to hear what the business could start, sell or build that it does not today, even when the answer turns out to be no. The debate will kill a weak new idea; it cannot weigh one nobody proposed.

A `new` idea is not a page about a new thing. "A page that explains our method" is an addition; "a fixed-price two-week audit, sold as a product, with its own page" is new. Ask: would the business be doing something it does not do today?

The goal names an outcome. The site is one way to it: an idea that brings the outcome another way (an offer, a channel, a partnership, the people who already know the company) answers the goal as well.

A direction or a new idea is still a hypothesis. Its trigger is what you saw; its test is a first step that would show whether the bet is right before anyone spends on all of it:

- a mock-up of the new home page shown to five people who buy this kind of service, against the page as it is;
- one page rebuilt the new way, with the same traffic sent to it and to an old one;
- the new offer named on one page, or put to the next five people who get in touch;
- a few weeks on the new channel with one piece of work, before committing to it;
- the free tool built for one question, with a link from one page, before a whole set.

What it would build does not exist yet: no list before the newsletter, no case before the first client of a new offer. Say what the first step needs and who would supply it. Its kill condition is the result of that first step. Its effort is the effort of the whole bet: usually `large`.

## The ledger

- An idea the ledger shows as killed, rejected or failed is not proposed again, unless something has changed since. Then give `returns` (its id, such as `"I7"`) and `whatChanged`.
- An idea a fix plan already covers is not proposed; a rule of the project is not argued with.
- An undecided idea may be taken up again when you can bring what was missing.

## Each statement

```json
{
  "type": "hypothesis",
  "title": "Five to ninety characters: the idea as a result",
  "hypothesis": {
    "change": "What we do",
    "effect": "What moves, and by about how much",
    "because": "Why the change causes the effect",
    "trigger": "What you saw that led to this",
    "killCondition": "The result that would prove it wrong"
  },
  "test": { "what": "The cheapest way to find out", "metric": "What to read", "baseline": "Today's value, when known", "threshold": "The value that counts as working", "checkAfter": "six weeks" },
  "effort": "small",
  "scale": "adjustment",
  "evidence": ["E3", "E12"]
}
```

`baseline` may be left out when nobody knows today's value; say in the test how it would be found. At most four hypotheses: keep the strongest, and keep the range: at least one of them `new`.

## Output

`{ "statements": [ … ] }` with your hypotheses.
