# Data contract

The build (`npm run build`) writes two static JSON files. The front end only
ever reads these; it never talks to news sites or APIs directly. Any UI (the
placeholder in `public/`, or the Claude Design version) just needs to read
these two files.

| File | What it is |
|---|---|
| `public/data/news.json` | Stories for the front page, story pages, topics and blindspots |
| `public/data/sources.json` | The outlet roster with each outlet's lean and feed status |

Realistic samples to design against: [`sample-news.json`](sample-news.json),
[`sample-sources.json`](sample-sources.json), and
[`sample-ai-story.json`](sample-ai-story.json) (one fictional story showing
the AI brief fields filled in).

All times are ISO 8601 UTC strings. Arrays are never `null` (they may be empty).

---

## `news.json`

```jsonc
{
  "version": 1,
  "generatedAt": "2026-11-12T02:05:00.000Z",
  "site": { "name": "Even Keel", "tagline": "Every side of the story, side by side." },
  "topics": [ { "id": "politics", "label": "Politics" }, ... ],
  "stats": {
    "outlets": 29,            // outlets in the roster
    "outletsReporting": 29,   // outlets whose feeds worked this build
    "articlesInWindow": 583,  // articles considered
    "windowHours": 48,        // how far back stories go
    "stories": 51,
    "aiBriefs": 0             // stories that have an AI brief
  },
  "stories": [ Story, ... ],  // already sorted by rank, best first
  "blindspots": [ "s_abc123", ... ]  // ids of stories in `stories` that are blindspots
}
```

Topic ids: `politics`, `world`, `us` (general U.S. news), `business`, `tech`,
`science-health`, `sports`, `culture`.

### Story

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable while the story is live. Use in URLs (`#/story/<id>`). |
| `headline` | string | The headline to show. Either the AI-written neutral headline or the plainest real headline from the outlets. |
| `headlineFrom` | object | `{ "kind": "selected", "sourceId": "npr" }` (a real outlet's headline) or `{ "kind": "ai", "model": "..." }`. Show which, for transparency. |
| `snippet` | string \| null | Short excerpt from the outlet whose headline was picked. Use when there's no `summary`. |
| `summary` | string \| null | AI brief, 2 to 4 sentences. `null` when AI is off or the story is small. |
| `keyFacts` | string[] | AI: facts outlets on different sides agree on. Empty without AI. |
| `framing` | object \| null | AI: `{ "left": string\|null, "center": string\|null, "right": string\|null }`, one sentence each on what that side emphasised. `null` without AI; individual sides are `null` when that side didn't cover it. |
| `disputed` | string[] | AI: points where accounts conflict. Often empty. |
| `ai` | object \| null | `{ "model", "generatedAt", "basedOnSources" }` when the brief is AI-written, else `null`. |
| `topic` | string | One of the topic ids. |
| `firstSeen` / `lastUpdated` | string | Earliest and latest article times in the story. |
| `sourceCount` | number | Distinct outlets covering it. |
| `articleCount` | number | Articles (an outlet can have more than one). |
| `coverage` | object | `{ "left": n, "center": n, "right": n, "byLean": { "left", "lean-left", "center", "lean-right", "right" } }`. Counts of distinct outlets. `left` = left + lean-left; `right` = right + lean-right. |
| `mostlyCoveredBy` | `"left"` \| `"right"` \| null | Set when it's a blindspot: the side doing most of the covering. |
| `score` | number | Rank score. Already applied to ordering; usually don't show it. |
| `image` | string \| null | Publisher's image from the feed. Optional; may fail to load (hotlink). |
| `articles` | Article[] | Every outlet's version, most on-topic first. |

### Article

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `sourceId` / `sourceName` | string | |
| `lean` | string | `left`, `lean-left`, `center`, `lean-right`, `right` |
| `title` | string | The outlet's own headline, unchanged. |
| `url` | string | Link to the original article. Open in a new tab. |
| `published` | string | |
| `snippet` | string \| null | Short feed excerpt. |
| `flags.loaded` | string[] | Sensational words in the headline, e.g. `["slams"]`. Side-neutral list. |
| `flags.contested` | object[] | `{ "term", "codedAs": "left"\|"right", "plain": string\|null }`: a word one side prefers, with the plainer wording. |
| `flags.clickbait` | boolean | Clickbait phrasing ("you won't believe", "here's why", "!"). |

---

## `sources.json`

```jsonc
{
  "version": 1,
  "generatedAt": "...",
  "balance": { "left": 5, "lean-left": 6, "center": 7, "lean-right": 6, "right": 5 },
  "sources": [
    {
      "id": "npr",
      "name": "NPR",
      "lean": "lean-left",
      "homepage": "https://www.npr.org",
      "notes": null,            // or a short note, e.g. "Formerly MSNBC."
      "status": "ok",           // "ok" | "down" (feed failed this build)
      "itemsThisRun": 10
    }
  ]
}
```

---

## Rules for any front end

- Escape all text from the JSON before inserting it into HTML. It comes from
  third-party feeds.
- Only link to `url`/`homepage` values that start with `http://` or `https://`.
- Open outlet links in a new tab with `rel="noopener noreferrer"`.
- Handle every optional state: no AI brief, no image, a side with zero
  coverage, an empty blindspot list, a story id that no longer exists
  (stories roll off after `windowHours`), and a missing `news.json` (first run).
