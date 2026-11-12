// Build pipeline: fetch feeds -> clean -> drop opinion -> cluster -> rank ->
// (optional) AI briefs -> write public/data/*.json for the front end.
//
// Run: npm run build

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fetchAllSources } from "./fetch.js";
import { normalizeItem } from "./normalize.js";
import { opinionReason } from "./opinion.js";
import { clusterArticles } from "./cluster.js";
import { buildStories } from "./stories.js";
import { addSummaries, aiEnabled } from "./summarize.js";
import { checkBalance, loadSources } from "./sources.js";
import { TOPICS } from "./topics.js";

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
    const h = (feedHealth[r.source.id] ??= { ok: 0, failed: 0, items: 0, errors: [] });
    if (r.ok) h.ok++;
    else {
      h.failed++;
      h.errors.push(`${r.url}: ${r.error}`);
      console.warn(`  ! ${r.source.name}: ${r.error}`);
    }
    h.items += r.items.length;
  }

  // 2. Normalize, de-duplicate, drop opinion
  const store = loadStore();
  let fresh = 0;
  let opinion = 0;
  for (const { source, items } of results) {
    for (const item of items) {
      const article = normalizeItem(item, source, { now, windowHours: settings.windowHours });
      if (!article) continue;
      if (opinionReason(article)) {
        opinion++;
        continue;
      }
      if (!store[article.id]) fresh++;
      // Keep the original first-seen publish time if we've seen it before.
      store[article.id] = store[article.id] ? { ...article, published: store[article.id].published } : article;
    }
  }

  // 3. Prune to the time window and to outlets still in the roster
  const cutoff = now.getTime() - settings.windowHours * 36e5;
  for (const [id, a] of Object.entries(store)) {
    if (new Date(a.published).getTime() < cutoff || !sourcesById.has(a.sourceId) || opinionReason(a)) delete store[id];
  }
  writeFileSync(STORE_PATH, JSON.stringify({ savedAt: now.toISOString(), articles: store }));
  const articles = Object.values(store);
  console.log(`Articles in ${settings.windowHours}h window: ${articles.length} (${fresh} new, ${opinion} opinion/non-news items skipped this run)`);

  // 4. Cluster and build stories
  const clusters = clusterArticles(articles, settings.cluster);
  const stories = buildStories(clusters, articles, sourcesById, settings, now);
  console.log(`Clusters: ${clusters.length}; stories with ${settings.minSourcesForStory}+ outlets: ${stories.length}`);

  // 5. Optional AI briefs
  const ai = await addSummaries(stories, settings);
  if (ai.enabled) {
    console.log(`AI briefs: ${ai.generated} new, ${ai.cached} cached, ${ai.failed} failed (${ai.inputTokens} in / ${ai.outputTokens} out tokens)`);
  } else {
    console.log(`AI briefs: off (set ANTHROPIC_API_KEY to enable). ${ai.cached} cached briefs reused.`);
  }

  // 6. Write output
  const blindspots = stories.filter((s) => s.mostlyCoveredBy).map((s) => s.id);
  const news = {
    version: 1,
    generatedAt: now.toISOString(),
    site: { name: settings.siteName, tagline: settings.tagline },
    topics: TOPICS,
    stats: {
      outlets: sources.length,
      outletsReporting: Object.values(feedHealth).filter((h) => h.ok > 0).length,
      articlesInWindow: articles.length,
      windowHours: settings.windowHours,
      stories: stories.length,
      aiBriefs: stories.filter((s) => s.ai).length,
    },
    stories,
    blindspots,
  };
  writeFileSync(`${OUT_DIR}/news.json`, JSON.stringify(news));

  const sourcesOut = {
    version: 1,
    generatedAt: now.toISOString(),
    balance: balance.counts,
    sources: sources.map((s) => ({
      id: s.id,
      name: s.name,
      lean: s.lean,
      homepage: s.homepage,
      notes: s.notes || null,
      status: feedHealth[s.id]?.ok ? "ok" : "down",
      itemsThisRun: feedHealth[s.id]?.items ?? 0,
    })),
  };
  writeFileSync(`${OUT_DIR}/sources.json`, JSON.stringify(sourcesOut, null, 2));

  const down = sourcesOut.sources.filter((s) => s.status === "down").map((s) => s.name);
  if (down.length) console.warn(`Outlets with no working feed this run: ${down.join(", ")}`);
  console.log(`Wrote ${OUT_DIR}/news.json and ${OUT_DIR}/sources.json in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!aiEnabled() && ai.cached === 0) console.log("Tip: the site works without AI; headlines shown are the least-loaded real ones.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
