# Design brief for Claude Design

Paste everything below the line into Claude Design, and attach these files
from this folder: `sample-news.json`, `sample-sources.json`,
`sample-ai-story.json`, and `DATA_CONTRACT.md`. When the design is done, hand
it off to Claude Code and point it at this project. See "Handing it back"
at the bottom.

---

## What we're building

A free news site for a small group of friends called **Even Keel** (working
name; it comes from `site.name` in the data, so don't hard-code it). Tagline:
"Every side of the story, side by side."

The goal is news that is as close to unbiased as we can get. It doesn't try
to persuade anyone toward any party. It gets there by showing, for every
story, how outlets from the left, center and right each reported it, and by
putting the plainest version on top.

Each story is built automatically from 29 news outlets' RSS feeds (5 left, 6
lean-left, 7 center, 6 lean-right, 5 right). For each story we know which
outlets covered it, each outlet's own headline, whether a headline uses
loaded wording, whether it's developing right now, and optionally a short
AI-written neutral brief. Separately, opinion pieces from a mirrored set of
outlets are matched to stories and shown only in balanced pairs.

The site does not write its own articles. Every headline links out to the
publisher. Design for an aggregator, not a newspaper with staff bylines.

## Design principles (these matter more than style)

1. **Calm, not urgent.** No red "BREAKING" banners, no countdowns, no
   autoplay, no infinite scroll, no "trending" or view counts. It should feel
   like a good newspaper, not a feed.
2. **No party colours.** Don't use red and blue for right and left. The
   spectrum needs three distinguishable colours that carry no partisan
   meaning (the placeholder uses teal / grey / ochre; you can do better).
   Always pair colour with a text label so it works in greyscale and for
   colour-blind readers.
3. **Show the spectrum, don't judge it.** Left, center and right get equal
   visual weight and equal space. Order is always Left, Center, Right. No
   side is styled as "good" or "bad".
4. **Transparency over polish.** Always make it clear where a headline came
   from (an outlet, or AI), how many outlets covered the story, and when it
   was updated. Readers should always be one tap from the original article.
5. **Readable first.** Mobile first, large comfortable text, high contrast,
   light and dark mode, keyboard accessible, and fast on a cheap phone.

## Screens

1. **Front page (Top stories).** Ranked list of stories (already sorted in the
   data). The first story can be larger. Each story card shows: topic, number
   of outlets, how long ago it was updated, headline, a one or two line
   summary (`summary` if present, else `snippet`), a coverage bar showing
   left / center / right outlet counts, a small "AI brief" tag when `ai` is
   set, and a blindspot badge when `mostlyCoveredBy` is set. A row of topic
   filters across the top (only topics that have stories).

2. **Story page.** This is the heart of the product.
   - Headline, topic, first reported / last updated.
   - Where the headline came from: "Plainest headline, from NPR" or
     "Neutral headline written by AI".
   - Summary (AI) or snippet.
   - Coverage bar with counts.
   - When there's an AI brief: **Key facts** (bullets), **How each side
     framed it** (three equal columns: Left / Center / Right, each one
     sentence), and **Disputed or unclear** (bullets, often empty). Plus a
     short note that the brief was written by AI from the outlets' headlines
     and excerpts.
   - **Headlines across the spectrum**: three columns, Left / Center / Right
     (stacked on mobile). Each item: outlet name, its exact lean (e.g. "Lean
     right"), time, the outlet's headline linking out, and small chips for
     flagged words (`flags.loaded`, `flags.contested`, `flags.clickbait`).
     Columns with no coverage say so plainly ("No right-leaning outlets in our
     roster covered this.").
   - Design the page so it also looks complete without the AI brief, which
     is the common case.

   - When `perspectives` is set: a **Perspectives** block below the
     headlines: Left / Center / Right columns of opinion pieces. Label it
     clearly as opinion ("Arguments, not reporting"). Left and right always
     have the same number of pieces.

3. **Perspectives page.** Stories that have opinion from both sides (ids in
   `perspectives`), each with its paired opinion pieces. This replaces a
   typical "Opinion" section: there is never one-sided opinion on the site.

4. **Developing.** Stories in `developing` (several outlets published in the
   last 3 hours). Can be a strip on the front page or a "Live" tab that lists
   the story's articles as a timeline by `published` time, newest first. The
   data has no live-blog entries of its own; the timeline is the outlets'
   headlines.

5. **Blindspots.** Stories covered mostly by one side, split into "Mostly
   covered by left-leaning outlets" and "Mostly covered by right-leaning
   outlets". Same cards as the front page. Framing copy: this is what the
   other side's readers are hearing about. Needs a friendly empty state.

6. **Sources.** The outlet roster grouped by lean (Left, Lean left, Center,
   Lean right, Right) with a link to each homepage and a small feed status
   (OK / down). Show the balance counts at the top.

7. **How it works.** A plain-language methodology page: balanced roster,
   opinion kept separate and only shown in balanced pairs, same event
   grouped, plainest headline wins, ranking
   by coverage breadth and recency (never by clicks), blindspots, and
   honest limits. The current text is in `public/index.html` inside
   `<template id="about-template">`; restyle and tighten it.

Shared: a simple header (name, tagline, nav: Top stories, Blindspots, Perspectives,
Sources, How it works) and a footer with "Updated X ago · N stories from N
outlets" and "Free. No ads, no accounts, no tracking."

## States to cover

Loading; no data yet (first run: "Run npm run build"); story not found (it
rolled off after 48 hours); a topic with no stories; a story where one side
has zero outlets; very long headlines; outlets with 2 or 3 articles in one
story; images missing (most cards should not depend on an image).

## Data

Everything comes from two JSON files: `data/news.json` and
`data/sources.json`. The attached `DATA_CONTRACT.md` describes every field,
and the sample files are real output from the pipeline (plus one fictional
story, `sample-ai-story.json`, showing the AI brief fields filled in). Use
the samples as content; don't invent fields that aren't in the contract.

## Technical constraints for the output

- Static site: plain HTML, CSS and JavaScript. No framework or build step
  required (a single small library is fine if it earns its place). It is
  hosted free on GitHub Pages.
- The site loads `data/news.json` and `data/sources.json` with `fetch` at a
  relative path.
- Hash routing: `#/`, `#/topic/<id>`, `#/story/<id>`, `#/blindspots`,
  `#/perspectives`, `#/sources`, `#/about`.
- Escape all text from the JSON before inserting it as HTML (it comes from
  third-party feeds). Only render links that start with `http://` or `https://`,
  opened in a new tab with `rel="noopener noreferrer"`.
- No analytics, no cookies, no external fonts or scripts that track users.
  System fonts or a self-hostable font are fine.
- Colours as CSS custom properties on `:root`, with a dark-mode set under
  `@media (prefers-color-scheme: dark)`.

## Fitting an existing design to this data

If a design already exists (for example a newspaper-style app with Today,
Live, Listen and Saved tabs), map it like this rather than inventing data:

| Design element | Use from the data |
|---|---|
| Top / Rundown list | `stories` in order (already ranked) |
| Section tabs | `topics` (Politics, World, U.S., Military, Business, ...) |
| Live / breaking strip | `developing` stories; a timeline is the story's `articles` sorted by `published` |
| Opinion section | Perspectives page (`perspectives`), always left and right together |
| "Most read" | Not available, by design (no tracking). Use "Most covered": top stories by `sourceCount` |
| Article page with full text and a staff byline | Not available. The story page is the article page: brief or snippet, coverage bar, every outlet's headline linking out |
| Listen | Free in the browser: read `headline` + `summary` (or `snippet`) aloud with the Web Speech API (`speechSynthesis`) |
| Saved | Store saved story ids in `localStorage` on the device (stories roll off after `windowHours`, so save the headline and links too) |
| Accounts / "You", Follow, reader submissions, newsletter | Need a server or third-party service; leave out for now |

## Handing it back

Export or hand off to Claude Code with: "Replace the placeholder UI in
`public/` (index.html, css/styles.css, js/app.js) with this design. Keep
reading `data/news.json` and `data/sources.json` per `docs/DATA_CONTRACT.md`,
keep the hash routes, and run `npm run build` then `npm run dev` to check it
with live data."
