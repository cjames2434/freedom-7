// Perspectives: balanced opinion attached to news stories.
//
// Opinion pieces never count as coverage. Instead, each one is matched to the
// news story it is most similar to, and only if its headline names someone or
// something the story's reporting names (a person, place, company). Opinion
// headlines are short and oblique, so similarity alone makes bad matches.
//
// Matches are pooled across a family of related stories (see related.js): an
// ongoing subject is often split into several stories, and the left's columns
// might match one sibling while the right's match another.
//
// A family only gets Perspectives when both the left and the right have
// written about it, and then every side shows the same number of pieces (at
// most one per outlet). One-sided opinion is never shown, so the section
// can't become a megaphone for either side.

import { cosine, tokenize } from "./cluster.js";
import { analyzeHeadline } from "./language.js";
import { buildStoryIndex } from "./storyindex.js";
import { leanGroup, truncate } from "./util.js";

function toOutput({ op, source }) {
  return {
    id: op.id,
    sourceId: op.sourceId,
    sourceName: source.name,
    lean: source.lean,
    title: op.title,
    url: op.url,
    published: op.published,
    snippet: truncate(op.snippet, 220) || null,
    flags: (({ loaded, contested, clickbait }) => ({ loaded, contested, clickbait }))(analyzeHeadline(op.title)),
  };
}

/** Keep each outlet's best-matching piece only, best matches first. */
function bestPerOutlet(list) {
  const byOutlet = new Map();
  for (const m of list) {
    const cur = byOutlet.get(m.op.sourceId);
    if (!cur || m.sim > cur.sim) byOutlet.set(m.op.sourceId, m);
  }
  return [...byOutlet.values()].sort((a, b) => b.sim - a.sim);
}

/**
 * Mutates `stories`, setting `story.perspectives` to { left, center, right }
 * arrays (left and right always the same length) or null. Stories in the same
 * family (`story.familyId`, from related.js) share one set. Returns the ids of
 * family lead stories that have Perspectives, in rank order.
 *
 * Pass a prebuilt `index` from buildStoryIndex(stories, newsArticles, opinionArticles)
 * to avoid rebuilding vectors; otherwise one is built here.
 */
export function attachPerspectives(
  stories,
  newsArticles,
  opinionArticles,
  sourcesById,
  { threshold = 0.12, maxPerSide = 2, maxEntityShare = 0.08, index = null } = {}
) {
  for (const s of stories) s.perspectives = null;
  if (!stories.length || !opinionArticles.length) return [];

  const idx = index ?? buildStoryIndex(stories, newsArticles, opinionArticles, { maxEntityShare });
  const familyKey = (story) => story.familyId ?? story.id;
  const pools = new Map(); // familyId -> { left, center, right }

  opinionArticles.forEach((op, k) => {
    const v = idx.vectors[idx.extraOffset + k];
    const titleTokens = tokenize(op.title);
    let best = -1;
    let bestSim = 0;
    for (let si = 0; si < idx.centroids.length; si++) {
      if (!titleTokens.some((t) => idx.names[si].has(t))) continue;
      const s = cosine(v, idx.centroids[si]);
      if (s > bestSim) {
        bestSim = s;
        best = si;
      }
    }
    if (best < 0 || bestSim < threshold) return;
    const source = sourcesById.get(op.sourceId);
    if (!source) return;
    const key = familyKey(stories[best]);
    if (!pools.has(key)) pools.set(key, { left: [], center: [], right: [] });
    pools.get(key)[leanGroup(source.lean)].push({ op, source, sim: bestSim });
  });

  const balanced = new Map(); // familyId -> perspectives
  for (const [key, pool] of pools) {
    const left = bestPerOutlet(pool.left);
    const center = bestPerOutlet(pool.center);
    const right = bestPerOutlet(pool.right);
    const n = Math.min(left.length, right.length, maxPerSide);
    if (n === 0) continue;
    balanced.set(key, {
      left: left.slice(0, n).map(toOutput),
      center: center.slice(0, n).map(toOutput),
      right: right.slice(0, n).map(toOutput),
    });
  }

  const leads = [];
  for (const story of stories) {
    const p = balanced.get(familyKey(story));
    if (!p) continue;
    story.perspectives = p;
    if (familyKey(story) === story.id) leads.push(story.id);
  }
  return leads;
}
