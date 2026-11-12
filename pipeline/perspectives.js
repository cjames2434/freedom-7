// Perspectives: balanced opinion attached to news stories.
//
// Opinion pieces never count as coverage. Instead, each one is matched to the
// news story it is most similar to, and only if its headline names someone or
// something the story's reporting names (a person, place, company). Opinion
// headlines are short and oblique, so similarity alone makes bad matches.
// A story only gets Perspectives when both
// the left and the right have written about it, and then every side shows the
// same number of pieces (at most one per outlet). One-sided opinion is never
// shown, so the section can't become a megaphone for either side.

import { buildVectors, cosine, entityTokens, tokenize } from "./cluster.js";
import { analyzeHeadline } from "./language.js";
import { leanGroup, truncate } from "./util.js";

// Capitalised words that name institutions, not stories. Sharing "Senate" or
// "ICE" with a story isn't evidence an opinion piece is about that story.
const GENERIC_NAMES = new Set(
  `senate house congress white court supreme president administration government federal department
  democrat democratic republican gop america american united us state city county national ice fbi doj
  cia dhs irs pentagon trump`.split(/\s+/)
);

function normalize(vec) {
  let norm = 0;
  for (const w of vec.values()) norm += w * w;
  norm = Math.sqrt(norm) || 1;
  for (const [t, w] of vec) vec.set(t, w / norm);
  return vec;
}

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
 * arrays of equal length for left and right, or null. Returns how many stories
 * got Perspectives.
 */
export function attachPerspectives(
  stories,
  newsArticles,
  opinionArticles,
  sourcesById,
  { threshold = 0.12, maxPerSide = 2, maxEntityShare = 0.08 } = {}
) {
  for (const s of stories) s.perspectives = null;
  if (!stories.length || !opinionArticles.length) return 0;

  const all = [...newsArticles, ...opinionArticles];
  const { vectors } = buildVectors(all);
  const indexById = new Map(newsArticles.map((a, i) => [a.id, i]));

  // Names too common to identify a story (e.g. "Trump" this year) don't count.
  const docFreq = new Map();
  for (const a of all) for (const t of new Set(tokenize(`${a.title} ${a.snippet || ""}`))) docFreq.set(t, (docFreq.get(t) || 0) + 1);
  const maxDf = Math.max(10, all.length * maxEntityShare);
  const storyNames = stories.map((story) => {
    const names = new Set();
    for (const a of story.articles) {
      for (const t of entityTokens(a.title)) names.add(t);
      for (const t of entityTokens(a.snippet || "")) names.add(t);
    }
    for (const t of names) if (GENERIC_NAMES.has(t) || (docFreq.get(t) || 0) > maxDf) names.delete(t);
    return names;
  });

  const centroids = stories.map((story) => {
    const c = new Map();
    for (const a of story.articles) {
      const i = indexById.get(a.id);
      if (i === undefined) continue;
      for (const [t, w] of vectors[i]) c.set(t, (c.get(t) || 0) + w);
    }
    return normalize(c);
  });

  const matches = stories.map(() => ({ left: [], center: [], right: [] }));
  opinionArticles.forEach((op, k) => {
    const v = vectors[newsArticles.length + k];
    const titleTokens = tokenize(op.title);
    let best = -1;
    let bestSim = 0;
    for (let si = 0; si < centroids.length; si++) {
      if (!titleTokens.some((t) => storyNames[si].has(t))) continue;
      const s = cosine(v, centroids[si]);
      if (s > bestSim) {
        bestSim = s;
        best = si;
      }
    }
    if (best < 0 || bestSim < threshold) return;
    const source = sourcesById.get(op.sourceId);
    if (!source) return;
    matches[best][leanGroup(source.lean)].push({ op, source, sim: bestSim });
  });

  let count = 0;
  stories.forEach((story, si) => {
    const left = bestPerOutlet(matches[si].left);
    const center = bestPerOutlet(matches[si].center);
    const right = bestPerOutlet(matches[si].right);
    const n = Math.min(left.length, right.length, maxPerSide);
    if (n === 0) return;
    story.perspectives = {
      left: left.slice(0, n).map(toOutput),
      center: center.slice(0, n).map(toOutput),
      right: right.slice(0, n).map(toOutput),
    };
    count++;
  });
  return count;
}
