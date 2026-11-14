import { analyzeHeadline } from "./language.js";
import { classifyTopic } from "./topics.js";
import { buildDigest } from "./digest.js";
import { leanDistance, leanGroup, truncate } from "./util.js";

const MEDIA_PREFIX = /^\s*(watch|video|listen|photos?|gallery|in pictures)\s*[:|—–-]/i;

/**
 * Pick the headline to show for a story: the one with the least loaded
 * wording, preferring outlets nearer the center and headlines that read like
 * the cluster as a whole (high centrality). Every outlet's own headline is
 * still listed on the story page.
 */
export function pickHeadline(items) {
  let best = null;
  for (const it of items) {
    const len = it.article.title.length;
    const lengthPenalty = len < 35 ? 0.5 : len > 130 ? 0.75 : 0;
    const cost =
      it.analysis.heat * 1.0 +
      leanDistance(it.lean) * 0.6 +
      (1 - it.centrality) * 1.5 +
      lengthPenalty +
      (it.article.title.endsWith("?") ? 0.5 : 0) +
      // "Watch: ..." / "Video: ..." titles describe a clip, not the news.
      (MEDIA_PREFIX.test(it.article.title) ? 2 : 0);
    if (!best || cost < best.cost) best = { cost, it };
  }
  return best.it;
}

function coverageOf(sourceIds, sourcesById) {
  const byLean = { left: 0, "lean-left": 0, center: 0, "lean-right": 0, right: 0 };
  const groups = { left: 0, center: 0, right: 0 };
  for (const id of sourceIds) {
    const lean = sourcesById.get(id).lean;
    byLean[lean]++;
    groups[leanGroup(lean)]++;
  }
  return { ...groups, byLean };
}

/**
 * "Blindspot": a story that outlets on one side are covering and the other
 * side mostly isn't. Returns "left" | "right" | null (the side doing the covering).
 */
export function mostlyCoveredBy(coverage, { minPartisan = 3, share = 0.8 } = {}) {
  const partisan = coverage.left + coverage.right;
  if (partisan < minPartisan) return null;
  const leftShare = coverage.left / partisan;
  if (leftShare >= share) return "left";
  if (leftShare <= 1 - share) return "right";
  return null;
}

/**
 * Ranking. Deliberately simple and engagement-blind: a story ranks higher when
 * more outlets cover it, when outlets from more of the spectrum cover it, and
 * when it is recent. Nothing about clicks, shares or outrage.
 */
export function storyScore({ sourceCount, breadth, hoursSinceUpdate }, halfLifeHours = 12) {
  const reach = Math.log2(1 + sourceCount);
  const spread = 1 + 0.25 * (breadth - 1);
  const freshness = Math.pow(0.5, hoursSinceUpdate / halfLifeHours);
  return reach * spread * freshness;
}

/** Turn clusters of article indices into story objects for the front end. */
export function buildStories(clusters, articles, sourcesById, settings, now = new Date()) {
  const stories = [];
  for (const cluster of clusters) {
    const items = cluster.map(({ index, centrality }) => {
      const article = articles[index];
      const source = sourcesById.get(article.sourceId);
      return { article, centrality, lean: source.lean, source, analysis: analyzeHeadline(article.title) };
    });
    const sourceIds = new Set(items.map((it) => it.article.sourceId));
    if (sourceIds.size < settings.minSourcesForStory) continue;

    const coverage = coverageOf(sourceIds, sourcesById);
    const breadth = ["left", "center", "right"].filter((g) => coverage[g] > 0).length;
    const times = items.map((it) => new Date(it.article.published).getTime());
    const firstSeen = new Date(Math.min(...times));
    const lastUpdated = new Date(Math.max(...times));

    // When each side first published on it (null if that side didn't cover it).
    const firstBySide = { left: null, center: null, right: null };
    for (const it of items) {
      const g = leanGroup(it.lean);
      if (!firstBySide[g] || it.article.published < firstBySide[g]) firstBySide[g] = it.article.published;
    }
    const hoursSinceUpdate = (now - lastUpdated) / 36e5;

    // "Developing": several outlets have published on it in the last few hours.
    const dev = settings.developing || { windowHours: 3, minRecentSources: 3 };
    const recentCutoff = now.getTime() - dev.windowHours * 36e5;
    const recentSources = new Set(
      items.filter((it) => new Date(it.article.published).getTime() >= recentCutoff).map((it) => it.article.sourceId)
    );

    // Order: most central first so the "primary" article per outlet is the most on-topic one.
    items.sort((a, b) => b.centrality - a.centrality);
    const chosen = pickHeadline(items);
    const earliest = items.reduce((a, b) => (a.article.published <= b.article.published ? a : b));
    const id = `s_${earliest.article.id}`;
    const blurb = truncate(chosen.article.snippet, 280) || null;
    const imageItem =
      items.find((it) => it.article.image && it.lean === "center") || items.find((it) => it.article.image);

    stories.push({
      id,
      headline: chosen.article.title,
      headlineFrom: { sourceId: chosen.article.sourceId, kind: "selected" },
      summary: null,
      keyFacts: [],
      framing: null,
      disputed: [],
      ai: null,
      snippet: blurb,
      // Sentences quoted from the outlets' own excerpts, balanced across sides (pipeline/digest.js).
      digest: buildDigest(items, { shown: [chosen.article.title, blurb], seed: id, ...(settings.digest || {}) }),
      topic: classifyTopic(items.map((it) => it.article)),
      firstSeen: firstSeen.toISOString(),
      firstBySide,
      lastUpdated: lastUpdated.toISOString(),
      sourceCount: sourceIds.size,
      articleCount: items.length,
      coverage,
      developing: recentSources.size >= dev.minRecentSources,
      recentSourceCount: recentSources.size,
      perspectives: null,
      mostlyCoveredBy: mostlyCoveredBy(coverage, {
        minPartisan: settings.minPartisanSourcesForBlindspot,
        share: settings.blindspotShare,
      }),
      score: Number(storyScore({ sourceCount: sourceIds.size, breadth, hoursSinceUpdate }, settings.recencyHalfLifeHours).toFixed(4)),
      image: imageItem?.article.image || null,
      articles: items.map((it) => ({
        id: it.article.id,
        sourceId: it.article.sourceId,
        sourceName: it.source.name,
        lean: it.lean,
        title: it.article.title,
        url: it.article.url,
        published: it.article.published,
        snippet: truncate(it.article.snippet, 300) || null,
        flags: {
          loaded: it.analysis.loaded,
          contested: it.analysis.contested,
          clickbait: it.analysis.clickbait,
        },
      })),
    });
  }
  stories.sort((a, b) => b.score - a.score);
  return stories.slice(0, settings.maxStories);
}
