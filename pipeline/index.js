// Build pipeline: fetch feeds -> clean -> sort news / opinion -> cluster news ->
// rank -> attach balanced Perspectives -> (optional) AI briefs ->
// write public/data/*.json for the front end.
//
// Run: npm run build

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fetchAllSources } from "./fetch.js";
import { normalizeItem } from "./normalize.js";
import { nonNewsKind } from "./opinion.js";
import { clusterArticles } from "./cluster.js";
import { buildStories } from "./stories.js";
import { attachPerspectives } from "./perspectives.js";
import { addSummaries, aiEnabled } from "./summarize.js";
import { checkBalance, hasKind, loadSources } from "./sources.js";
import { TOPICS } from "./topics.js";
import { leanGroup } from "./util.js";

const STORE_PATH = "data/store.json";
const OUT_DIR = "public/data";

if (existsSync(".env")) process.loadEnvFile(".env");

function loadStore() {
  if (!existsSync(STORE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(STORE_PATH, "utf8")).articles || {};
  } catch {
    return {};
  }
}

/** "news", "opinion", or null (drop). Re-evaluated every run so rule changes apply to stored items. */
function kindOf(article) {
  const nn = nonNewsKind(article);
  if (nn?.kind === "other") return null;
  if (article.feedKind === "opinion") return "opinion";
  return nn?.kind === "opinion" ? "opinion" : "news";
}

function fail(message) {
  console.error(`\nBuild stopped: ${message}`);
  console.error("Nothing was written, so the last good version of the site stays up.");
  process.exit(1);
}

async function main() {
  const t0 = Date.now();
  const settings = JSON.parse(readFileSync("config/settings.json", "utf8"));
  const sources = loadSources();
  const sourcesById = new Map(sources.map((s) => [s.id, s]));

  const balance = checkBalance(sources);
  if (!balance.ok && !process.argv.includes("--allow-unbalanced")) {
    console.error(`Source roster is unbalanced: ${balance.problems.join("; ")}.`);
    console.error("Fix config/sources.json (or pass --allow-unbalanced to build anyway).");
    process.exit(1);
  }

  mkdirSync("data", { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  const now = new Date();

  // 1. Fetch
  console.log(`Fetching ${sources.reduce((n, s) => n + s.feeds.length, 0)} feeds from ${sources.length} outlets...`);
  const results = await fetchAllSources(sources, {
    concurrency: settings.fetchConcurrency,
    timeoutMs: settings.fetchTimeoutMs,
    maxItems: settings.maxItemsPerFeed,
  });
  const feedHealth = {};
  for (const r of results) {
    const h = (feedHealth[r.source.id] ??= { ok: 0, failed: 0, items: 0, newsOk: 0 });
    if (r.ok) {
      h.ok++;
      if (r.kind === "news") h.newsOk++;
    } else {
      h.failed++;
      console.warn(`  ! ${r.source.name} (${r.kind}): ${r.error}`);
    }
    h.items += r.items.length;
  }

  // Safety: a network outage shouldn't publish an empty or one-sided site.
  const newsOutlets = sources.filter((s) => hasKind(s, "news"));
  const reporting = newsOutlets.filter((s) => feedHealth[s.id]?.newsOk > 0);
  const minShare = settings.safety?.minOutletShare ?? 0.5;
  if (reporting.length < newsOutlets.length * minShare) {
    fail(`only ${reporting.length} of ${newsOutlets.length} news outlets responded (need ${Math.round(minShare * 100)}%).`);
  }

  // 2. Normalize and merge into the rolling store
  const store = loadStore();
  let fresh = 0;
  for (const { source, kind, items } of results) {
    for (const item of items) {
      const article = normalizeItem(item, source, { now, windowHours: settings.windowHours });
      if (!article) continue;
      article.feedKind = kind;
      const prev = store[article.id];
      if (!prev) fresh++;
      store[article.id] = prev
        ? {
            ...article,
            published: prev.published, // keep the original first-seen time
            feedKind: prev.feedKind === "news" || kind === "news" ? "news" : "opinion", // news wins if any news feed carried it
          }
        : article;
    }
  }

  // 3. Prune to the window and the current roster, and sort into news / opinion
  const cutoff = now.getTime() - settings.windowHours * 36e5;
  const news = [];
  const opinion = [];
  let dropped = 0;
  for (const [id, a] of Object.entries(store)) {
    const kind = kindOf(a);
    if (new Date(a.published).getTime() < cutoff || !sourcesById.has(a.sourceId) || !kind) {
      delete store[id];
      if (!kind) dropped++;
      continue;
    }
    (kind === "news" ? news : opinion).push(a);
  }
  if (news.length < (settings.safety?.minArticles ?? 30)) {
    fail(`only ${news.length} news articles in the window, which looks like a fetch problem.`);
  }
  writeFileSync(STORE_PATH, JSON.stringify({ savedAt: now.toISOString(), articles: store }));
  console.log(
    `In the ${settings.windowHours}h window: ${news.length} news + ${opinion.length} opinion articles (${fresh} new this run; ${dropped} podcasts/newsletters/live blogs dropped)`
  );

  // 4. Cluster news into stories
  const clusters = clusterArticles(news, settings.cluster);
  const stories = buildStories(clusters, news, sourcesById, settings, now);
  console.log(`Clusters: ${clusters.length}; stories with ${settings.minSourcesForStory}+ outlets: ${stories.length}`);

  // 5. Balanced opinion
  const withPerspectives = attachPerspectives(stories, news, opinion, sourcesById, settings.perspectives);
  console.log(`Perspectives (opinion from both sides): ${withPerspectives} stories`);

  // 6. Optional AI briefs
  const ai = await addSummaries(stories, settings);
  if (ai.enabled) {
    console.log(`AI briefs: ${ai.generated} new, ${ai.cached} cached, ${ai.failed} failed (${ai.inputTokens} in / ${ai.outputTokens} out tokens)`);
  } else {
    console.log(`AI briefs: off (set ANTHROPIC_API_KEY to enable). ${ai.cached} cached briefs reused.`);
  }

  // 7. Balance this run: outlets that went down can tilt coverage, so say so.
  const downNews = newsOutlets.filter((s) => !(feedHealth[s.id]?.newsOk > 0));
  const downBySide = { left: 0, center: 0, right: 0 };
  for (const s of downNews) downBySide[leanGroup(s.lean)]++;
  const balanceWarning =
    downBySide.left !== downBySide.right
      ? `${downBySide.left} left-leaning and ${downBySide.right} right-leaning news outlets were unreachable this update, so coverage counts may tilt slightly.`
      : null;
  if (balanceWarning) console.warn(`  ! ${balanceWarning}`);

  // 8. Write output
  const out = {
    version: 1,
    generatedAt: now.toISOString(),
    site: { name: settings.siteName, tagline: settings.tagline },
    topics: TOPICS,
    stats: {
      outlets: newsOutlets.length,
      outletsReporting: reporting.length,
      opinionOutlets: sources.filter((s) => hasKind(s, "opinion")).length,
      articlesInWindow: news.length,
      opinionInWindow: opinion.length,
      windowHours: settings.windowHours,
      stories: stories.length,
      aiBriefs: stories.filter((s) => s.ai).length,
      outletsDown: downNews.map((s) => s.name),
      balanceWarning,
    },
    stories,
    blindspots: stories.filter((s) => s.mostlyCoveredBy).map((s) => s.id),
    developing: stories
      .filter((s) => s.developing)
      .sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated))
      .map((s) => s.id),
    perspectives: stories.filter((s) => s.perspectives).map((s) => s.id),
  };
  writeFileSync(`${OUT_DIR}/news.json`, JSON.stringify(out));

  const sourcesOut = {
    version: 1,
    generatedAt: now.toISOString(),
    balance: balance.news,
    opinionBalance: balance.opinion,
    sources: sources.map((s) => ({
      id: s.id,
      name: s.name,
      lean: s.lean,
      homepage: s.homepage,
      notes: s.notes || null,
      roles: [...new Set(s.feeds.map((f) => f.kind))],
      status: feedHealth[s.id]?.ok ? "ok" : "down",
      itemsThisRun: feedHealth[s.id]?.items ?? 0,
    })),
  };
  writeFileSync(`${OUT_DIR}/sources.json`, JSON.stringify(sourcesOut, null, 2));

  if (downNews.length) console.warn(`News outlets with no working feed this run: ${downNews.map((s) => s.name).join(", ")}`);
  console.log(`Wrote ${OUT_DIR}/news.json and ${OUT_DIR}/sources.json in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!aiEnabled() && ai.cached === 0) console.log("Tip: the site works without AI; headlines shown are the least-loaded real ones.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
