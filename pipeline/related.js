// Related stories: one ongoing subject often splits into several stories as
// it develops (an Nvidia CEO scandal became "board weighs ousting him", "he
// resigns", "stock falls", "Congress wants answers"). Linking them lets the
// front end show "Related coverage" and lets Perspectives pool opinion across
// the whole subject instead of scattering it over siblings.
//
// Two stories are linked when their reporting is similar enough AND they share
// a distinctive name (a person, company, place), or when they are very
// similar. Families are the connected groups of links, but a story only joins
// a family when it is linked to that family's lead (top-ranked) story, so a
// chain of loose links can't pull unrelated subjects together.

import { cosine } from "./cluster.js";

/**
 * Mutates `stories` (already sorted best first): sets `story.related` to ids
 * of directly linked stories (most similar first) and `story.familyId` to the
 * id of its family's lead story. Returns the families as arrays of indices.
 */
export function linkRelated(stories, index, { minSimilarity = 0.2, strongSimilarity = 0.4, maxRelated = 5 } = {}) {
  const n = stories.length;
  const links = Array.from({ length: n }, () => []);
  const linked = (i, j) => {
    const sim = cosine(index.centroids[i], index.centroids[j]);
    if (sim >= strongSimilarity) return sim;
    if (sim < minSimilarity) return 0;
    for (const t of index.names[i]) if (index.names[j].has(t)) return sim;
    return 0;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sim = linked(i, j);
      if (sim > 0) {
        links[i].push([j, sim]);
        links[j].push([i, sim]);
      }
    }
  }

  // Families: walk stories in rank order; each unassigned story leads a new
  // family and pulls in the unassigned stories it links to directly.
  const familyOf = new Array(n).fill(-1);
  const families = [];
  for (let i = 0; i < n; i++) {
    if (familyOf[i] !== -1) continue;
    const fam = [i];
    familyOf[i] = families.length;
    for (const [j] of links[i]) {
      if (familyOf[j] === -1) {
        familyOf[j] = families.length;
        fam.push(j);
      }
    }
    families.push(fam);
  }

  stories.forEach((story, i) => {
    story.related = links[i]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxRelated)
      .map(([j]) => stories[j].id);
    story.familyId = stories[families[familyOf[i]][0]].id;
  });
  return families;
}
