# CLAUDE.md

Guidance for Claude Code in this repository.

## What this is

Even Keel: a free, static, balanced news site for a small group of friends.
A Node build (`pipeline/`) reads RSS feeds from a mirrored roster of outlets
(left to right), drops opinion pieces, groups articles about the same event,
picks the least loaded headline, optionally adds a neutral Claude-written
brief, and writes `public/data/news.json` + `public/data/sources.json`. The
front end in `public/` only reads those two files. Hosted on GitHub Pages,
rebuilt hourly by `.github/workflows/update.yml`.

## Commands

- `npm run build`: fetch feeds and regenerate `public/data/*.json`
- `npm run dev`: serve `public/` at http://localhost:8080
- `npm test`: node:test suite in `test/`
- `npm run check:feeds` / `npm run check:balance`

## Rules that protect neutrality (don't break these)

- The roster in `config/sources.json` must stay mirrored: equal `left` and
  `right`, equal `lean-left` and `lean-right`. A test and the build enforce it.
- Word lists in `pipeline/language.js` must stay side-neutral; every
  contested term needs a counterpart from the other side.
- Ranking (`pipeline/stories.js`) must not use engagement signals.
- UI: no red/blue party colours for the spectrum; Left, Center, Right always
  in that order with equal weight; always show where a headline came from.

## Front end

`public/` is a placeholder meant to be replaced by a Claude Design export.
The contract it must honour is `docs/DATA_CONTRACT.md`; the design brief is
`docs/DESIGN_BRIEF.md`. Keep hash routes (`#/`, `#/topic/<id>`,
`#/story/<id>`, `#/blindspots`, `#/sources`, `#/about`), escape all feed text,
and only render http(s) links.

## AI briefs

`pipeline/summarize.js` uses `@anthropic-ai/sdk` (`client.beta.messages.create`
with structured JSON output and server-side refusal fallbacks). Off unless
`ANTHROPIC_API_KEY` is set. Model from `SUMMARY_MODEL` or
`config/settings.json` (`claude-opus-5-5`). Cached in `data/ai-cache.json`.
