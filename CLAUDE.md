# CLAUDE.md

Guidance for Claude Code in this repository.

## What this is

Freedom 7 (formerly Even Keel; the name comes from `siteName` in
`config/settings.json`): a free, static, balanced news site for a small
group of friends.
A Node build (`pipeline/`) reads RSS feeds from a mirrored roster of outlets
(left to right), keeps opinion separate from news, groups articles about the same event,
picks the least loaded headline, optionally adds a neutral Claude-written
brief, and writes `public/data/news.json` + `public/data/sources.json`. The
front end in `public/` only reads those two files. Hosted on GitHub Pages,
rebuilt every 15 minutes by `.github/workflows/update.yml`.

## Commands

- `npm run build`: fetch feeds and regenerate `public/data/*.json`
- `npm run dev`: serve `public/` at http://localhost:8080
- `npm test`: node:test suite in `test/`
- `npm run check:feeds` / `npm run check:balance`

## Rules that protect neutrality (don't break these)

- Two rosters in `config/sources.json` must stay mirrored (outlets with a
  news feed, and outlets with an opinion feed): equal `left` and `right`,
  equal `lean-left` and `lean-right`. A test and the build enforce it.
- Opinion never counts as coverage. It is only shown via `perspectives`
  (`pipeline/perspectives.js`), which requires both sides and trims them to
  equal counts.
- Word lists in `pipeline/language.js` must stay side-neutral; every
  contested term needs a counterpart from the other side.
- Ranking (`pipeline/stories.js`) must not use engagement signals.
- Headline picks: plainest wording first. When a left and a right outlet have
  equally plain headlines, the sides take turns (`assignTurns`), evening out
  the count on stories both covered. A turn must never swap in a more loaded
  headline or replace a center outlet's, and the rule must stay a mirror
  image for left and right. Turns are remembered in `data/headline-turns.json`.
- The story digest (`pipeline/digest.js`) only quotes outlets' own sentences,
  one per outlet, with equal counts from left and right when both covered
  the story. Never paraphrase or merge them, and always show the outlet.
- UI: no red/blue party colours for the spectrum; Left, Center, Right always
  in that order with equal weight; always show where a headline came from.

## Front end

`public/` is a placeholder meant to be replaced by a Claude Design export.
The contract it must honour is `docs/DATA_CONTRACT.md`; the design brief is
`docs/DESIGN_BRIEF.md` (its "Fitting an existing design" table maps
newspaper-style designs onto this data). Keep hash routes (`#/`,
`#/topic/<id>`, `#/story/<id>`, `#/blindspots`, `#/perspectives`,
`#/sources`, `#/about`), escape all feed text, and only render http(s) links.

The front end in `public/` is now the Freedom 7 newspaper design (from the
"USA Patriot news app" design session), ported onto this data with the
mapping table: no staff-written articles, "Most covered" instead of "Most
read", opinion only via Perspectives, "Developing" instead of a red Live
banner. Brand colours (navy, red) are for the wordmark only; the spectrum
uses teal / stone / ochre tokens (`--left`, `--center`, `--right`). Fonts
are self-hosted in `public/fonts/` (OFL). Extra routes beyond the list
above: `#/live` (developing timelines) and `#/saved` (localStorage).

The design session keeps `public/` in step with the Freedom 7 design canvas:
it checks the canvas for edits every few hours while it's open, and a canvas
comment that mentions @claude reaches it directly. Local preview for that
session runs on port 8081 (`news-site-8081` in `.claude/launch.json`) so it
doesn't collide with `npm run dev` on 8080. Routine build/test/read-only git
commands are pre-approved in `.claude/settings.local.json` (git-ignored).

Layout notes: the front page has the full masthead; other pages get a compact
one (`body.is-inner`). The main nav sticks to the top on wider screens, and
phones (700px and under) get a bottom tab bar instead. The site name is also
hard-coded in `public/manifest.webmanifest` and drawn into `public/icons/`
and `favicon.svg`, so a rename needs those updated too. The logo is the
"mission patch": a round mark with a 7 and one star, beside the wordmark. The
mark's markup is in `index.html` (three places) and `MARK` in `app.js`; its
colours come from the `.mark-*` rules, and it also shows a 7 whatever the name.

## Two sessions work in this folder

The user runs two Claude Code sessions here at once and wants them to talk
to each other directly, without the user relaying or approving messages:

- **Data/pipeline session** ("Unbiased news application") owns `pipeline/`,
  `config/sources.json`, `config/settings.json` (except `siteName` and
  `tagline`), `test/`, `scripts/` (except `serve.js`), `docs/DATA_CONTRACT.md`,
  `docs/sample-*.json`, `.github/workflows/`.
- **Design/UI session** ("USA Patriot news app") owns `public/`,
  `scripts/serve.js`, `docs/DESIGN_BRIEF.md`, `.claude/launch.json`, and the
  `siteName`/`tagline` lines.
- Shared (`README.md`, this file): re-read right before editing, change only
  your own sections, and tell the other session what you changed.

To change something the other session owns, or to need a new data field,
send it a message (`ListAgents`, then `SendMessage`; reply by copying the
`from` attribute). Never `git add -A`: stage only your own paths, and commit
only when the user has OK'd it. Ask the user only for product decisions
(names, look, cost), not to pass messages along.

## AI briefs

The user has decided not to pay for AI summaries (2026-11-13): keep the site
free to run, don't suggest API keys or paid services, and design every
feature to work without briefs. The code below stays in place, off.

`pipeline/summarize.js` uses `@anthropic-ai/sdk` (`client.beta.messages.create`
with structured JSON output and server-side refusal fallbacks). Off unless
`ANTHROPIC_API_KEY` is set. Model from `SUMMARY_MODEL` or
`config/settings.json` (`claude-opus-5-5`). Cached in `data/ai-cache.json`.
