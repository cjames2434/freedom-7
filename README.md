# Freedom 7

(Formerly "Even Keel". The site name and tagline live in `config/settings.json`.)

A free news site that tries to be as close to unbiased as possible. Instead
of telling you what to think, it shows you every story the way outlets
across the political spectrum reported it, side by side, with the plainest
version on top.

Built for a few friends: no ads, no accounts, no tracking, and it costs
nothing to run.

## How it stays neutral

- **Balanced roster.** 39 news outlets: 7 left, 8 lean-left, 9 center, 8
  lean-right, 7 right ([`config/sources.json`](config/sources.json)). The
  roster must mirror itself; the build refuses to run if it doesn't.
- **Opinion kept separate.** Op-eds, columns, editorials and commentary
  never count as news coverage. Outlets whose feeds are mostly commentary
  (National Review's main feed, The Free Press, The Atlantic's Ideas
  section, The New Republic, Slate) are marked as opinion feeds. Podcasts,
  newsletters and live blogs are dropped.
- **Perspectives, always in pairs.** Opinion pieces are matched to the news
  story they're about and shown only when both the left and the right wrote
  about it, in equal numbers. The opinion roster is mirrored too.
- **Same event, every side.** Articles about the same event are grouped
  into one story, so you can see who covered it and how each side headlined it.
  Two outlets have to share more than a name to count as one story.
- **Plainest headline wins.** The headline shown is the one with the least
  loaded wording ("slams", "destroys", "bombshell"), preferring outlets nearer
  the center. The word lists are side-neutral and symmetric
  ([`pipeline/language.js`](pipeline/language.js)).
- **Left and right take turns.** When a left-leaning and a right-leaning
  outlet both have an equally plain headline for a story, each new story goes
  to whichever side has had fewer headlines shown, so on stories both sides
  covered the two come out as even as possible. A turn never swaps in a more
  loaded headline or replaces a center outlet's.
- **More than a headline, still in their words.** Each story page has a short
  "What's being reported" list: sentences quoted from the outlets' own
  excerpts that add facts, picked by a fixed rule (no AI), the same number
  from the left and the right. Every outlet's full excerpt is one click away
  ("Show excerpts"), and each outlet is listed once, with its other articles
  on the story folded under it.
- **Ranking without outrage.** Stories rank by how many outlets cover them,
  how much of the spectrum covers them, and recency. Never by clicks.
- **Who owns the outlets.** The Sources page lists each outlet's owner
  (checked November 2026) and groups owners with more than one outlet here,
  such as News Corp or Paramount Skydance.
- **Yours, on your device only.** Saved stories, followed searches (they show
  on your front page), "new since your last visit" markers, recently viewed
  stories and your reading balance (which sides' outlets you've opened
  articles from) live in your browser and are never sent anywhere. None of it
  changes the order of the news.
- **Links that preview.** Sharing a story shares a small page of its own, so
  messaging apps show its headline and coverage. Old links still open the
  site after a story rolls off.
- **Listen.** Any story, or the top stories as a short briefing, can be read
  aloud by the browser's own voice.
- **Markets.** Stock-market news, plus every story about the companies the
  site follows (NVIDIA and SpaceX; change them under `markets.watch` in
  [`config/settings.json`](config/settings.json)). It only picks which stories
  to list: they keep the same ranking and balance rules. News only, no prices.
- **Blindspots.** Stories covered mostly by one side are called out, so you
  can see what the other side's readers are hearing about. When a subject is
  split across several related stories, it only counts if the whole subject
  is one-sided.
- **Developing.** Stories that several outlets published on in the last 3
  hours are flagged, for a Live-style view.
- **No AI needed.** Everything above runs on fixed rules. (Code for optional
  AI-written briefs is still in the repo, switched off; see "AI briefs and
  cost".)

## Run it on your PC

Needs [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
```

```bash
npm run build
```

```bash
npm run dev
```

Then open http://localhost:8080. While `npm run dev` is running, the news
keeps itself fresh: whenever someone loads the site and the news is more
than 15 minutes old, a refresh starts in the background (visitors never
wait for it), and an open page checks every couple of minutes and offers
the new stories. Set `REFRESH_MINUTES` to change the 15, or to `0` to turn
it off. `npm run build` still pulls the latest news by hand.

The preview only answers on your own PC. To open it from another device on
your network (a phone, say), start it with `HOST=0.0.0.0`.

| Command | What it does |
|---|---|
| `npm run build` | Fetch all feeds, group stories, write `public/data/` (news, sources, RSS feed) |
| `npm run dev` | Serve the site at http://localhost:8080, refreshing the news on visits |
| `npm start` | Build, then serve |
| `npm test` | Run the tests |
| `npm run check:feeds` | Check every outlet's feed is alive and fresh |
| `npm run check:balance` | Show the roster by lean and confirm it's mirrored |
| `npm run sample` | Refresh the sample data in `docs/` for design work |
| `npm run report` | Show how balanced the site is today, with the daily trend |

## How it works

```
config/sources.json ─► fetch RSS ─► clean ─► split news / opinion ─► group same-event news
                                                                          │
public/data/news.json ◄─ (optional AI briefs) ◄─ match opinion in pairs ◄─ rank ◄─ pick plainest headline
```

| Path | Purpose |
|---|---|
| `config/sources.json` | Outlets, their lean, and feed URLs |
| `config/settings.json` | Site name, time window, clustering threshold, AI settings |
| `pipeline/` | The build: `fetch`, `normalize`, `opinion`, `cluster`, `stories`, `perspectives`, `language`, `topics`, `summarize` |
| `public/` | The website (the Freedom 7 newspaper design) plus generated `data/` |
| `docs/` | Data contract, Claude Design brief, sample data |
| `.github/workflows/update.yml` | Rebuild and deploy to GitHub Pages |
| `.github/workflows/tick.yml` | Starts an update about every 15 minutes (each run starts the next) |
| `data/` | Local working state (last 48h of articles, whose turn each story got, AI brief cache). Not committed. |

The site is fully static: the build writes JSON, and the front end only reads
JSON. That's what makes it free to host.

## Designing the UI with Claude Design

The UI in `public/` came from a Claude Design session. To redesign it:

1. Run `npm run build` then `npm run sample` so the sample data is fresh.
2. Open [`docs/DESIGN_BRIEF.md`](docs/DESIGN_BRIEF.md), paste it into Claude
   Design, and attach `docs/sample-news.json`, `docs/sample-sources.json`,
   `docs/sample-ai-story.json` and `docs/DATA_CONTRACT.md`.
3. Hand the result off to Claude Code in this folder. It replaces
   `public/index.html`, `public/css/styles.css` and `public/js/app.js`; the
   pipeline doesn't change.

## Put it online (free)

GitHub Pages hosts it and GitHub Actions rebuilds it every 15 minutes.

1. Create a **public** GitHub repository (Pages is free for public repos) and
   push this folder to its `main` branch.
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Actions → Update news → Run workflow** for the first build.
4. Make it update on time. GitHub's own scheduler is best-effort: here it
   started the 15-minute update only a couple of times a day. So the updates
   start each other instead:
   - **Settings → Environments → New environment**, name it `tick`, tick
     **Wait timer**, enter `13` minutes, and save.
   - **Actions → Keep updates on time → Run workflow**, once. Each run waits 13
     minutes (using no computing time), starts an update, and starts the next
     run. A schedule in the same file restarts the chain if it ever breaks.
   Keep the repository public: on a private one, runs this often would use up
   the free monthly Actions minutes in about two weeks.
5. Your site is at `https://<your-username>.github.io/<repo-name>/`.

Notes:
- GitHub pauses workflows in public repos after 60 days with no commits.
  Every run of "Keep updates on time" re-enables both workflows to prevent
  that. If updates ever stop anyway (the page says "updates are delayed"),
  open **Actions → Keep updates on time → Run workflow**.
- To get AI briefs online, add your key under **Settings → Secrets and
  variables → Actions → New repository secret** named `ANTHROPIC_API_KEY`.
  Optionally add a variable `SUMMARY_MODEL` to change the model.

## Checking that it stays balanced

Every build measures the site itself: whose headlines get shown (left,
center, right), how often each side's outlets appear, blindspots on each
side, and which side covered shared stories first. It keeps a daily history
for 30 days. Run `npm run report` to read it; the build also prints a one-line
summary and warns when something looks lopsided, for example one side's
headlines being shown far more than the other's. The same numbers are shown
on the site's "How it works" page (from `data/balance.json`).

## Follow it in a news-reader app

Every build also writes an RSS feed of the site: `data/feed.xml` (for example
`https://<your-username>.github.io/<repo-name>/data/feed.xml` once it's
online, or http://localhost:8080/data/feed.xml locally). Add that address to
any feed reader. It has one item per subject, in the site's order, each
linking back to the story page with every outlet's headline. Set `SITE_URL`
(or `siteUrl` in `config/settings.json`) if the site lives somewhere other
than GitHub Pages.

## AI briefs and cost

Off, and staying off: you decided not to pay for an API (2026-11-13), so the
site runs entirely free. This section is kept only for reference.

To turn them on locally, copy `.env.example` to `.env` and set
`ANTHROPIC_API_KEY` (get one at https://console.anthropic.com). Briefs are
written only for stories covered by 3+ outlets, at most 12 new ones per
build, and cached so each story is paid for once (refreshed only if coverage
grows a lot).

Rough cost, assuming ~30 new briefs a day (estimates, depends on news volume):

| Model (`SUMMARY_MODEL`) | Per brief | Per month |
|---|---|---|
| `claude-opus-5-5` (default) | ~2 cents | ~$10–25 |
| `claude-haiku-5-5` | ~0.05 cents | under $1 |

The default is Opus 5.5 for the best writing quality; Haiku 5.5 is the
budget option and is fine for short summaries. Requests opt in to
server-side fallback, so if a model ever declines a story the API retries it
on a fallback model automatically.

The brief only sees headlines and short excerpts, not full articles, and is
told to use nothing else. The prompt is in
[`pipeline/summarize.js`](pipeline/summarize.js).

## Editing the outlets

Each outlet also lists its `owner`. Owners change (sales, spin-offs), so
re-check them now and then and update `ownersAsOf` at the top of the file.

Edit [`config/sources.json`](config/sources.json). Each outlet has a `lean`:
`left`, `lean-left`, `center`, `lean-right` or `right`. The starting leans
approximate the consensus of public media-bias raters (AllSides, Ad Fontes
Media, Media Bias/Fact Check). They're judgment calls: review them with your
friends and change what you disagree with.

A feed is either a plain URL (news) or `{ "url": "...", "kind": "opinion" }`
for a feed that is mostly commentary. Opinion feeds never count as coverage;
they only supply Perspectives.

Keep both rosters mirrored (outlets with a news feed, and outlets with an
opinion feed: same count of `left` and `right`, and of `lean-left` and
`lean-right`), then run `npm run check:balance` and `npm run check:feeds`.

AP and Reuters are not included because they don't offer public RSS feeds;
their stories arrive through the outlets that run them.

## Tuning

[`config/settings.json`](config/settings.json):

- `windowHours`: how long stories stay (default 48).
- `cluster.threshold`: how similar articles must be to count as one story.
  Lower merges more (risk: unrelated stories grouped); higher splits more.
  0.22 was tuned on live data.
- `minSourcesForStory`: outlets needed before a story appears (default 2).
- `minSharedWordsForPair`: how many distinct words two outlets' articles must
  share to count as one story when only two outlets cover it (default 3).
- `headline`: `takeTurns` turns the left/right turn-taking on or off;
  `turnMargin` is how much less on-topic the other side's headline may be and
  still count as equally good (it may never be more loaded).
- `markets`: the companies the Markets section follows (`watch`: an id, a
  display name, and the words that identify it in headlines), and how many
  outlets (`minOutlets`) and what share of them (`minShare`) must report on
  markets for a story to count as market news.
- `minPartisanSourcesForBlindspot`, `blindspotShare`: when a story counts
  as a blindspot (default: 3+ partisan outlets, 80% from one side).
- `developing`: how many outlets in how many hours flags a story as developing.
- `related`: how similar two stories must be to count as the same ongoing
  subject (they must also share a person, place or company name, unless very
  similar). Related stories are listed together, and share Perspectives.
- `perspectives.threshold`: how closely an opinion piece must match a story.
  Pieces must also name a person, place or company from the story.
- `safety`: the build stops without publishing if fewer than half the news
  outlets respond or there are under 30 articles, so an outage never
  replaces the live site with an empty one.

## Etiquette and limits

- The site shows headlines, short feed excerpts and links. It never copies
  full articles; readers click through to the publisher. "What's being
  reported" quotes at most one sentence per outlet, taken from the excerpt or
  the opening paragraphs the outlet's own feed carries.
- Feeds are fetched every 15 minutes with an honest user agent, which is what
  RSS is for. Keep it non-commercial.
- Story grouping is automatic and sometimes wrong (it may split one event
  or merge two related ones). Every outlet's headline is listed so readers
  can see for themselves.
