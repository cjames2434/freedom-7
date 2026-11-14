import { analyzeHeadline } from "./language.js";
import { classifyTopic } from "./topics.js";
import { buildDigest } from "./digest.js";
import { leanDistance, leanGroup, sideTurn, truncate } from "./util.js";

const MEDIA_PREFIX = /^\s*(watch|video|listen|photos?|gallery|in pictures)\s*[:|—–-]/i;

/**
 * The headline to show for a story is the one with the least loaded wording,
 * preferring outlets nearer the center and headlines that read like the
 * cluster as a whole (high centrality). Every outlet's own headline is still
 * listed on the story page.
 *
 * Taking turns: the left's busiest outlets are rated "lean left" and the
 * right's busiest are rated fully "right", so preferring outlets nearer the
 * center would hand most near-ties to the left. To keep that from adding up,
 * when the winner is a left- or right-leaning outlet and the other side has a
 * headline that is at least as plainly worded and about as on-topic, that
 * headline is returned as the `rival`, and the two sides take turns (see
 * assignTurns). A center outlet's winning headline never has a rival, and a
 * plainer headline is never swapped for a more loaded one.
 *
 * Returns { best, bestSide, rival }: the winner, its side ("left" | "center" |
 * "right"), and the other side's equally plain headline or null.
 */
export function headlineChoices(items, { takeTurns = true, turnMargin = 0.5 } = {}) {
  const scored = items.map((it) => {
    const len = it.article.title.length;
    const lengthPenalty = len < 35 ? 0.5 : len > 130 ? 0.75 : 0;
    // How the headline reads, whoever wrote it.
    const wording =
      it.analysis.heat * 1.0 +
      (1 - it.centrality) * 1.5 +
      lengthPenalty +
      (it.article.title.endsWith("?") ? 0.5 : 0) +
      // "Watch: ..." / "Video: ..." titles describe a clip, not the news.
      (MEDIA_PREFIX.test(it.article.title) ? 2 : 0);
    return { it, wording, cost: wording + leanDistance(it.lean) * 0.6, side: leanGroup(it.lean) };
  });
  const cheapest = (list) => list.reduce((a, b) => (b.cost < a.cost ? b : a));
  const best = cheapest(scored);
  let rival = null;
  if (takeTurns && best.side !== "center") {
    const otherSide = best.side === "left" ? "right" : "left";
    const rivals = scored.filter(
      (s) => s.side === otherSide && s.it.analysis.heat <= best.it.analysis.heat && s.wording <= best.wording + turnMargin
    );
    if (rivals.length) rival = cheapest(rivals).it;
  }
  return { best: best.it, bestSide: best.side, rival };
}

/**
 * Pick one story's headline. `turn` ("left" | "right") says whose turn it is
 * when both sides have an equally plain headline; without it the story's own
 * `seed` decides.
 */
export function pickHeadline(items, { seed = "", turn = null, ...options } = {}) {
  const { best, bestSide, rival } = headlineChoices(items, options);
  if (!rival) return best;
  return (turn || sideTurn(seed)) === bestSide ? best : rival;
}

/**
 * Decide whose turn it is on every story where both sides have an equally
 * plain headline, so that across the stories both sides covered, left- and
 * right-leaning outlets' headlines are shown as close to equally often as
 * possible.
 *
 * drafts:   [{ id, firstSeen, bothSides, choices }] (choices from headlineChoices)
 * previous: { storyId: "left" | "right" } from the last build. A story keeps
 *           the turn it was given, so its headline doesn't flip between builds.
 *
 * Stories where one side's headline is plainer are fixed and counted first.
 * Each new story then goes to whichever side is behind, oldest story first;
 * when the sides are level the story's own id decides.
 */
export function assignTurns(drafts, previous = {}) {
  const tally = { left: 0, right: 0 };
  const turns = new Map();
  const open = [];
  for (const d of drafts) {
    const { bestSide, rival } = d.choices;
    if (bestSide === "center") continue;
    if (!rival) {
      if (d.bothSides) tally[bestSide]++;
      continue;
    }
    const kept = previous[d.id];
    if (kept === "left" || kept === "right") {
      turns.set(d.id, kept);
      tally[kept]++;
    } else {
      open.push(d);
    }
  }
  open.sort((a, b) => new Date(a.firstSeen) - new Date(b.firstSeen) || a.id.localeCompare(b.id));
  for (const d of open) {
    const turn = tally.left < tally.right ? "left" : tally.right < tally.left ? "right" : sideTurn(d.id);
    turns.set(d.id, turn);
    tally[turn]++;
  }
  return turns;
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
 * One subject is often split into several stories (see related.js). A story
 * only stays a blindspot when the whole subject is lopsided the same way:
 * if one side covered the subject under a different story, its readers did
 * hear about it. Run after rankSubjects, which sets `story.subject`.
 */
export function settleBlindspots(stories, { minPartisanSourcesForBlindspot: minPartisan, blindspotShare: share } = {}) {
  for (const s of stories) {
    if (!s.mostlyCoveredBy || !(s.subject?.storyCount > 1) || !s.subject.coverage) continue;
    if (mostlyCoveredBy(s.subject.coverage, { minPartisan, share }) !== s.mostlyCoveredBy) s.mostlyCoveredBy = null;
  }
  return stories;
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

/**
 * Turn clusters of article indices into story objects for the front end.
 * `turns` is the record of whose turn each story got last build (see assignTurns).
 */
export function buildStories(clusters, articles, sourcesById, settings, now = new Date(), { turns: previousTurns = {} } = {}) {
  const drafts = [];
  for (const cluster of clusters) {
    const items = cluster.map(({ index, centrality }) => {
      const article = articles[index];
      const source = sourcesById.get(article.sourceId);
      return { article, centrality, lean: source.lean, source, analysis: analyzeHeadline(article.title) };
    });
    const sourceIds = new Set(items.map((it) => it.article.sourceId));
    if (sourceIds.size < settings.minSourcesForStory) continue;

    // Order: most central first so the "primary" article per outlet is the most on-topic one.
    items.sort((a, b) => b.centrality - a.centrality);
    const earliest = items.reduce((a, b) => (a.article.published <= b.article.published ? a : b));
    const coverage = coverageOf(sourceIds, sourcesById);
    const breadth = ["left", "center", "right"].filter((g) => coverage[g] > 0).length;
    const times = items.map((it) => new Date(it.article.published).getTime());
    const firstSeen = new Date(Math.min(...times));
    const lastUpdated = new Date(Math.max(...times));
    const hoursSinceUpdate = (now - lastUpdated) / 36e5;
    drafts.push({
      items,
      sourceIds,
      id: `s_${earliest.article.id}`,
      coverage,
      firstSeen,
      lastUpdated,
      score: Number(storyScore({ sourceCount: sourceIds.size, breadth, hoursSinceUpdate }, settings.recencyHalfLifeHours).toFixed(4)),
      bothSides: coverage.left > 0 && coverage.right > 0,
      choices: headlineChoices(items, settings.headline),
    });
  }
  // Only the stories that will be shown take part in the turn-taking.
  drafts.sort((a, b) => b.score - a.score);
  const shown = drafts.slice(0, settings.maxStories);
  const turns = assignTurns(shown, previousTurns);

  const stories = [];
  for (const { items, sourceIds, id, coverage, firstSeen, lastUpdated, score, choices } of shown) {

    // When each side first published on it (null if that side didn't cover it).
    const firstBySide = { left: null, center: null, right: null };
    for (const it of items) {
      const g = leanGroup(it.lean);
      if (!firstBySide[g] || it.article.published < firstBySide[g]) firstBySide[g] = it.article.published;
    }

    // "Developing": several outlets have published on it in the last few hours.
    const dev = settings.developing || { windowHours: 3, minRecentSources: 3 };
    const recentCutoff = now.getTime() - dev.windowHours * 36e5;
    const recentSources = new Set(
      items.filter((it) => new Date(it.article.published).getTime() >= recentCutoff).map((it) => it.article.sourceId)
    );

    const turn = turns.get(id) || null;
    const chosen = turn && turn !== choices.bestSide ? choices.rival : choices.best;
    const chosenSide = leanGroup(chosen.lean);
    const blurb = truncate(chosen.article.snippet, 280) || null;
    const imageItem =
      items.find((it) => it.article.image && it.lean === "center") || items.find((it) => it.article.image);

    stories.push({
      id,
      headline: chosen.article.title,
      // `turn` is set when both sides had an equally plain headline and they took turns.
      headlineFrom: { sourceId: chosen.article.sourceId, kind: "selected", turn },
      summary: null,
      keyFacts: [],
      framing: null,
      disputed: [],
      ai: null,
      snippet: blurb,
      // Sentences quoted from the outlets' own excerpts, balanced across sides (pipeline/digest.js).
      // The side whose headline isn't shown picks its sentence first.
      digest: buildDigest(items, {
        shown: [chosen.article.title, blurb],
        seed: id,
        first: chosenSide === "left" ? "right" : chosenSide === "right" ? "left" : null,
        ...(settings.digest || {}),
      }),
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
      score,
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
  return stories;
}
