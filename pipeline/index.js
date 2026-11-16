// Build pipeline: fetch feeds -> clean -> sort news / opinion -> cluster news ->
// rank -> attach balanced Perspectives -> (optional) AI briefs ->
// write public/data/*.json for the front end.
//
// Run: npm run build

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { fetchAllSources } from "./fetch.js";
import { normalizeItem, tidySnippet } from "./normalize.js";
import { nonNewsKind } from "./opinion.js";
import { clusterArticles } from "./cluster.js";
import { buildStories, settleBlindspots } from "./stories.js";
import { attachPerspectives } from "./perspectives.js";
import { tagMarkets } from "./markets.js";
import { linkRelated, rankSubjects } from "./related.js";
import { buildStoryIndex } from "./storyindex.js";
import { addSummaries, aiEnabled } from "./summarize.js";
import { checkBalance, hasKind, loadSources } from "./sources.js";
import { TOPICS } from "./topics.js";
import { buildFeed, resolveSiteUrl } from "./feed.js";
import { balanceReport, updateHistory } from "./balance.js";
import { leanGroup } from "./util.js";

const STORE_PATH = "data/store.json";
const BALANCE_HISTORY_PATH = "data/balance-history.json";
const MEMORY_PATH = "data/story-memory.json";
const OLD_TURNS_PATH = "data/headline-turns.json"; // before story-memory.json existed
const OUT_DIR = "public/data";
const LOCK_PATH = "data/.build.lock";
const LOCK_STALE_MINUTES = 10;
/** Exit code when another build already holds the lock (EX_TEMPFAIL). scripts/refresh.js relies on it. */
const EXIT_BUSY = 75;

if (existsSync(".env")) process.loadEnvFile(".env");

/**
 * Only one build at a time across all processes (two local servers, a server
 * plus a manual `npm run build`): they share data/store.json and public/data.
 * A lock older than LOCK_STALE_MINUTES is assumed to be left over from a
 * crashed build and is taken over.
 */
function acquireLock() {
  mkdirSync("data", { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(LOCK_PATH, `${process.pid} ${new Date().toISOString()}`, { flag: "wx" });
      process.on("exit", () => {
        try {
          unlinkSync(LOCK_PATH);
        } catch {}
      });
      // Ctrl+C or a kill skips the "exit" event unless we turn it into a normal exit.
      for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => process.exit(130));
      return true;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      let ageMinutes = Infinity;
      try {
        ageMinutes = (Date.now() - statSync(LOCK_PATH).mtimeMs) / 60000;
      } catch {}
      if (ageMinutes < LOCK_STALE_MINUTES) return false;
      try {
        unlinkSync(LOCK_PATH);
      } catch {}
    }
  }
  return false;
}

/**
 * Write via a temp file + rename so a server reading the file mid-build never
 * sees half of it. Windows can briefly refuse the rename while the old file is
 * being read, so retry a few times before falling back to a plain write.
 */
function writeAtomic(path, data) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      renameSync(tmp, path);
      return;
    } catch (err) {
      if (err.code !== "EPERM" && err.code !== "EBUSY" && err.code !== "EACCES") throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); // sleep 50ms
    }
  }
  writeFileSync(path, data);
  try {
    unlinkSync(tmp);
  } catch {}
}

/**
 * What the last build remembered about stories: their ids (so links keep
 * working as a story's articles change) and whose turn each got (so headlines
 * don't flip between builds).
 */
function loadMemory() {
  const read = (path) => {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return null;
    }
  };
  const memory = read(MEMORY_PATH);
  if (memory) return { turns: memory.turns || {}, ids: memory.ids || {}, aliases: memory.aliases || {} };
  return { turns: read(OLD_TURNS_PATH)?.turns || {}, ids: {}, aliases: {} };
}

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

  if (!acquireLock()) {
    console.log("Another build is already running, so this one is skipping. Its results will show up shortly.");
    process.exit(EXIT_BUSY);
  }
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
    a.snippet = tidySnippet(a.snippet); // applies excerpt clean-up rules to articles stored before a rule existed
    (kind === "news" ? news : opinion).push(a);
  }
  if (news.length < (settings.safety?.minArticles ?? 30)) {
    fail(`only ${news.length} news articles in the window, which looks like a fetch problem.`);
  }
  writeAtomic(STORE_PATH, JSON.stringify({ savedAt: now.toISOString(), articles: store }));
  console.log(
    `In the ${settings.windowHours}h window: ${news.length} news + ${opinion.length} opinion articles (${fresh} new this run; ${dropped} podcasts/newsletters/live blogs dropped)`
  );

  // 4. Cluster news into stories
  const clusters = clusterArticles(news, settings.cluster);
  const memory = loadMemory();
  const stories = buildStories(clusters, news, sourcesById, settings, now, memory);
  writeAtomic(MEMORY_PATH, JSON.stringify(memory.next));
  console.log(`Clusters: ${clusters.length}; stories with ${settings.minSourcesForStory}+ outlets: ${stories.length}`);

  // 5. Related stories (one subject split across several stories), then
  //    balanced opinion pooled across each group of related stories
  const storyIndex = buildStoryIndex(stories, news, opinion, { maxEntityShare: settings.perspectives?.maxEntityShare });
  const families = linkRelated(stories, storyIndex, settings.related);
  const grouped = families.filter((f) => f.length > 1);
  console.log(`Related: ${grouped.length} groups covering ${grouped.reduce((n, f) => n + f.length, 0)} stories`);
  // Rank whole subjects by their combined coverage (re-sorts `stories`; `families` indices are pre-sort).
  rankSubjects(stories, families, { recencyHalfLifeHours: settings.recencyHalfLifeHours, now });
  settleBlindspots(stories, settings); // not a blindspot if the other side covered the subject in a sibling story
  const perspectiveLeads = attachPerspectives(stories, news, opinion, sourcesById, { ...settings.perspectives, index: storyIndex });
  const markets = tagMarkets(stories, settings.markets);
  console.log(
    `Markets: ${markets.stories.length} stories; ` +
      markets.companies.map((c) => `${c.name} ${stories.filter((s) => s.companies.includes(c.id)).length}`).join(", ")
  );
  console.log(`Perspectives (opinion from both sides): ${perspectiveLeads.length} subjects`);

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
  const downParts = ["left", "right"].filter((g) => downBySide[g] > 0).map((g) => `${downBySide[g]} ${g}-leaning`);
  const downTotal = downBySide.left + downBySide.right;
  const balanceWarning =
    downBySide.left !== downBySide.right
      ? `${downParts.join(" and ")} news ${downTotal === 1 ? "outlet was" : "outlets were"} unreachable this update, so coverage counts may tilt slightly.`
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
    perspectives: perspectiveLeads, // one id per group of related stories
    markets, // { companies: [{ id, name }], stories: [ids] }: stock-market news and followed companies
    aliases: memory.next.aliases, // ids of stories that merged into another: old id -> current id
  };
  writeAtomic(`${OUT_DIR}/news.json`, JSON.stringify(out));
  writeAtomic(`${OUT_DIR}/feed.xml`, buildFeed(out, { siteUrl: resolveSiteUrl(settings) }));

  // Balance report: today's snapshot plus a 30-day daily history.
  const report = balanceReport(stories, { perspectiveLeads, now });
  const history = updateHistory(BALANCE_HISTORY_PATH, report);
  writeAtomic(BALANCE_HISTORY_PATH, JSON.stringify({ days: history }));
  writeAtomic(`${OUT_DIR}/balance.json`, JSON.stringify({ version: 1, generatedAt: now.toISOString(), today: report, history }));
  const hp = report.headlinePicks;
  console.log(
    `Balance: headlines shown from left ${hp.left + hp["lean-left"]} / center ${hp.center} / right ${hp.right + hp["lean-right"]}; ` +
      `blindspots left ${report.blindspots.left} / right ${report.blindspots.right}; ` +
      `first to cover left ${report.firstToCover.left} / right ${report.firstToCover.right} / tie ${report.firstToCover.tie}`
  );
  for (const w of report.warnings) console.warn(`  ! Balance: ${w}`);

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
  writeAtomic(`${OUT_DIR}/sources.json`, JSON.stringify(sourcesOut, null, 2));

  if (downNews.length) console.warn(`News outlets with no working feed this run: ${downNews.map((s) => s.name).join(", ")}`);
  console.log(`Wrote ${OUT_DIR}/news.json, sources.json, balance.json and feed.xml in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!aiEnabled() && ai.cached === 0) console.log("Tip: the site works without AI; headlines shown are the least-loaded real ones.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
