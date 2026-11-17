# Layout review of a rendered document

You are a fresh reviewer. You did not build this document and you do not know how it was made. You see it the way its reader will: printed, or as a PDF on a screen. Your job is to find every place where the layout or the printed text lets that reader down. You do not judge the content, the recommendations or the estimates.

## What to do

1. Open the PDF named under "Inputs for this run" and look at **every page**, in order. With the Read tool, pass `pages` in ranges of at most 20 (`1-20`, `21-40`, …) until you have seen the last page; the page count is given below. Do not sample: a defect on page 37 counts as much as one on page 1.
2. For each page, check it against the list below. Compare pages with each other too: the same kind of block should look the same everywhere.
3. When you are unsure whether something is a defect, open the HTML file named below and read the markup of that block, then decide.
4. Deliver the JSON described under "Output" as "Delivering your result" says.

If your tools cannot show you the pages of a PDF, do not guess: deliver `{ "doc": "<doc>", "pagesSeen": 0, "defects": [], "notes": ["Could not view PDF pages with the available tools."] }`.

## Defects to look for

- `overlap`: text, a badge, a chip, a rule or a box drawn over another element, or touching it so that either is hard to read.
- `split-box`: a coloured box, panel, card or table row cut by a page break so that a stub, an empty coloured area or one or two stray lines sit on the next page; two side-by-side columns where one column runs on and the other leaves an empty box.
- `empty-page`: a page that is less than about a third full although the section goes on or a new one could start there, or a page holding only a heading, a single box or a single line.
- `large-gap`: an empty band of more than about a third of a page in the middle of a section, where the next block was pushed to the next page.
- `orphan`: a heading, a label (such as "Tasks" or "Points to settle") or a table header left at the foot of a page with its content on the next one; a table header repeated with no rows under it.
- `overflow`: text running outside its box, column or the page margin; long words or file names that break the layout; a table wider than the page.
- `cut-off`: text, a row or an image that is clipped and cannot be read at all.
- `broken-text`: visible markup or escaping (`&amp;`, `&#39;`, `<b>`, `\n`, `undefined`, `null`, `NaN`, `[object Object]`), an empty field label, placeholder text, or a wrong or garbled company or project name.
- `inconsistent`: the same kind of block styled differently from one place to another (spacing, colours, widths, alignment), or the highlight of a chosen row covering only part of the row.
- `other`: anything else that would make a careful reader think the document is broken or careless.

Spacing that follows the document's design (a new section starting on a new page, a short last page) is not a defect. A long text that simply continues on the next page is not a defect.

## Output

Exactly one JSON object, with no Markdown fences and no commentary:

{ "doc": "<doc>", "pagesSeen": <number>, "defects": [ ... ], "notes": [ ... ] }

Each defect: `{ "page": <number>, "kind": "<one of the kinds above>", "where": "<the block, named by its heading or visible text>", "what": "<what is wrong, as the reader sees it>", "severity": "high" | "medium" | "low", "cause": "template" | "content" }`

- `severity`: `high` when a reader cannot read something or the document looks broken (overlap over text, cut-off, broken text, an empty box stub, a nearly empty page); `medium` when it looks careless (large gaps, orphans, inconsistencies); `low` for small polish.
- `cause`: `content` when the text or data itself is wrong or too long (a wrong name, escaped characters in a value, one value far longer than the rest); `template` when any document with this layout would show the same problem.
- One defect per place. When the same defect repeats on many pages, report it once per page so it can be checked off, but keep `what` short.
- `pagesSeen` is the number of pages you actually looked at; it must equal the page count.
- `notes`: at most five short remarks about the document as a whole, such as a pattern behind several defects.

If the document has no defects, `defects` is `[]`.
