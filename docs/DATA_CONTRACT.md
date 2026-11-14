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
    "outlets": 29,            // news outlets in the roster
    "outletsReporting": 29,   // news outlets whose feeds worked this build
    "opinionOutlets": 17,     // outlets with an opinion feed (Perspectives)
    "articlesInWindow": 661,  // news articles considered
    "opinionInWindow": 214,   // opinion pieces considered for Perspectives
    "windowHours": 48,        // how far back stories go
    "stories": 63,
    "aiBriefs": 0,            // stories that have an AI brief
    "outletsDown": [],        // news outlets whose feed failed this build
    "balanceWarning": null    // a sentence to show when outages tilt one side, else null
  },
  "stories": [ Story, ... ],      // sorted by subject rank (see `subject`); a subject's stories are adjacent, its lead first
  "blindspots": [ "s_abc123" ],   // ids of stories that are blindspots
  "developing": [ "s_def456" ],   // ids of developing stories, most recently updated first
  "perspectives": [ "s_ghi789" ]  // stories with balanced opinion: one id per group of related stories (the group's top story), in rank order
}
```

Topic ids: `politics`, `world`, `us` (general U.S. news), `military`,
`business`, `tech`, `science-health`, `sports`, `culture`.

### Story

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable while the story is live. Use in URLs (`#/story/<id>`). |
| `headline` | string | The headline to show. Either the AI-written neutral headline or the plainest real headline from the outlets. |
| `headlineFrom` | object | `{ "kind": "selected", "sourceId": "npr", "turn": null }` (a real outlet's headline) or `{ "kind": "ai", "model": "..." }`. Show which, for transparency. `turn` is `"left"` or `"right"` when a left-leaning and a right-leaning outlet both had an equally plain headline and the two sides took turns (the value is the side whose turn it was), otherwise `null`. |
| `snippet` | string \| null | Short excerpt from the outlet whose headline was picked. Use when there's no `summary`. |
| `digest` | object[] | "What's being reported": up to 6 sentences quoted word for word from the outlets' feed excerpts, each `{ "text", "sourceId", "sourceName", "lean", "url" }`. One sentence per outlet, chosen to add facts the headline and `snippet` don't already give, never repeating each other. When both the left and the right covered the story they get the same number of sentences. Already in display order (Left, Center, Right, a round at a time). Often short or empty for small stories. Always show the outlet name with each sentence. |
| `summary` | string \| null | AI brief, 2 to 4 sentences. `null` when AI is off or the story is small. |
| `keyFacts` | string[] | AI: facts outlets on different sides agree on. Empty without AI. |
| `framing` | object \| null | AI: `{ "left": string\|null, "center": string\|null, "right": string\|null }`, one sentence each on what that side emphasised. `null` without AI; individual sides are `null` when that side didn't cover it. |
| `disputed` | string[] | AI: points where accounts conflict. Often empty. |
| `ai` | object \| null | `{ "model", "generatedAt", "basedOnSources" }` when the brief is AI-written, else `null`. |
| `topic` | string | One of the topic ids. |
| `firstSeen` / `lastUpdated` | string | Earliest and latest article times in the story. |
| `firstBySide` | object | `{ "left", "center", "right" }`: when each side's outlets first published on the story (ISO string), or `null` for a side that didn't cover it. `left` includes lean-left, `right` includes lean-right. Lets a page say, neutrally, which side picked a story up first and how much later the other did. |
| `sourceCount` | number | Distinct outlets covering it. |
| `articleCount` | number | Articles (an outlet can have more than one). |
| `coverage` | object | `{ "left": n, "center": n, "right": n, "byLean": { "left", "lean-left", "center", "lean-right", "right" } }`. Counts of distinct outlets. `left` = left + lean-left; `right` = right + lean-right. |
| `mostlyCoveredBy` | `"left"` \| `"right"` \| null | Set when it's a blindspot: the side doing most of the covering. |
| `developing` | boolean | 3+ outlets published on it in the last 3 hours. Use for a "Developing" or "Live" treatment. |
| `recentSourceCount` | number | Outlets that published on it in the last 3 hours. |
| `perspectives` | object \| null | Balanced opinion: `{ "left": Article[], "center": Article[], "right": Article[] }`. `left` and `right` always have the same length (1 or 2); `center` has 0 to that many. `null` unless both sides wrote opinion about the subject. Shared by every story in the same related group (same `familyId`), since opinion is about the subject more than one update. These are opinion pieces, never reporting; label them that way. |
| `related` | string[] | Ids of other stories about the same ongoing subject (e.g. several updates on one scandal), most similar first, at most 5. Often empty. Every id is in `stories`. |
| `familyId` | string | Id of the top-ranked story in this story's related group (its own id if it leads the group or has no related stories). A front page can show one card per `familyId` with "N related updates" to avoid near-duplicate cards. |
| `subject` | object | The whole related group: `{ "storyCount", "sourceCount", "coverage", "lastUpdated", "score" }`, where `coverage` has the same shape as the story's but counts distinct outlets across every story in the group. Same object on every member. Stories are ranked by `subject.score`, so a subject split across several small stories ranks by its combined coverage. On a one-card-per-subject front page, show `subject.coverage` / `subject.sourceCount` ("across N stories") on the card; on the story page, the story's own `coverage`. Singletons have `storyCount: 1` and match the story. |
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
| `snippet` | string \| null | The outlet's own feed excerpt, up to about 300 characters. Sometimes it only repeats the headline. |
| `flags.loaded` | string[] | Sensational words in the headline, e.g. `["slams"]`. Side-neutral list. |
| `flags.contested` | object[] | `{ "term", "codedAs": "left"\|"right", "plain": string\|null }`: a word one side prefers, with the plainer wording. |
| `flags.clickbait` | boolean | Clickbait phrasing ("you won't believe", "here's why", "!"). |

---

## `balance.json`

`public/data/balance.json` shows how balanced the site itself is. Counts are
descriptive, not verdicts on outlets:

```jsonc
{
  "version": 1,
  "generatedAt": "...",
  "today": {
    "date": "2026-11-13",
    "stories": 150,
    "headlinePicks": { "left": 6, "lean-left": 31, "center": 79, "lean-right": 29, "right": 5, "ai": 0 }, // whose headline is shown
    "coverage": { "left": 203, "center": 129, "right": 190 },            // outlet appearances in stories
    "storiesCovered": { "bothSides": 71, "leftOnly": 37, "rightOnly": 40, "centerOnly": 2 },
    "blindspots": { "left": 5, "right": 3 },                             // stories covered mostly by that side
    "firstToCover": { "left": 33, "right": 33, "tie": 5 },              // on stories both covered; tie = within 30 min
    "perspectives": { "subjects": 6, "left": 8, "center": 1, "right": 8 },
    "warnings": []                                                       // plain-language notes when something looks lopsided
  },
  "history": [ /* one `today`-shaped entry per day, up to 30, oldest first */ ]
}
```

`npm run report` prints the same thing in plain words.

## `feed.xml`

`public/data/feed.xml` is an RSS 2.0 feed of the site itself for news-reader
apps: up to 30 items, one per subject (lead story), in rank order, each
linking to `#/story/<id>` on the site, with the summary or snippet plus a
coverage line ("Covered by 22 outlets across 4 related stories: 10
left-leaning, 6 center, 6 right-leaning."). Links are absolute: `SITE_URL`,
else `siteUrl` in `config/settings.json`, else the GitHub Pages address when
built by GitHub Actions, else `http://localhost:8080/`. Link it from the page
head with `<link rel="alternate" type="application/rss+xml" href="data/feed.xml">`.

## `sources.json`

```jsonc
{
  "version": 1,
  "generatedAt": "...",
  "balance": { "left": 5, "lean-left": 6, "center": 7, "lean-right": 6, "right": 5 },        // news outlets
  "opinionBalance": { "left": 4, "lean-left": 4, "center": 1, "lean-right": 4, "right": 4 }, // opinion outlets
  "sources": [
    {
      "id": "npr",
      "name": "NPR",
      "lean": "lean-left",
      "homepage": "https://www.npr.org",
      "notes": null,            // or a short note, e.g. "Formerly MSNBC."
      "roles": ["news"],        // "news", "opinion", or both
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
