// Shared vectors for comparing whole stories (to each other, and to opinion
// pieces). Used by related.js and perspectives.js.

import { buildVectors, entityTokens, tokenize } from "./cluster.js";

// Capitalised words that name institutions, not stories. Sharing "Senate" or
// "ICE" with a story isn't evidence something is about that story.
export const GENERIC_NAMES = new Set(
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

/**
 * Build vectors over news + extra articles (e.g. opinion) with one shared
 * vocabulary, plus per-story centroids and per-story distinctive names.
 *
 * @returns {{ vectors: Map<string,number>[], centroids: Map<string,number>[], names: Set<string>[], storyIds: string[], extraOffset: number }}
 *   `vectors[extraOffset + k]` is the vector of extraArticles[k]. `centroids[i]`
 *   and `names[i]` belong to the story with id `storyIds[i]`: look stories up
 *   by that id, because the `stories` array may be re-sorted after this runs.
 */
export function buildStoryIndex(stories, newsArticles, extraArticles = [], { maxEntityShare = 0.08 } = {}) {
  const all = [...newsArticles, ...extraArticles];
  const { vectors } = buildVectors(all);
  const indexById = new Map(newsArticles.map((a, i) => [a.id, i]));

  // Names too common to identify a story (e.g. "Trump" this year) don't count.
  const docFreq = new Map();
  for (const a of all) for (const t of new Set(tokenize(`${a.title} ${a.snippet || ""}`))) docFreq.set(t, (docFreq.get(t) || 0) + 1);
  const maxDf = Math.max(10, all.length * maxEntityShare);

  const names = stories.map((story) => {
    const set = new Set();
    for (const a of story.articles) {
      for (const t of entityTokens(a.title)) set.add(t);
      for (const t of entityTokens(a.snippet || "")) set.add(t);
    }
    for (const t of set) if (GENERIC_NAMES.has(t) || (docFreq.get(t) || 0) > maxDf) set.delete(t);
    return set;
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

  return { vectors, centroids, names, storyIds: stories.map((s) => s.id), extraOffset: newsArticles.length };
}
