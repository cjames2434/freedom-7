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
import { storyScore } from "./stories.js";
import { leanGroup } from "./util.js";

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

/**
 * Coverage and rank for each whole subject (family of related stories).
 *
 * A subject split across several stories (a shooting reported as "gunman
 * kills 1", "suspect identified", "witnesses describe...") would otherwise be
 * ranked by its lead story alone, with only a few outlets each. This counts
 * the distinct outlets across the whole family, scores that with the same
 * engagement-blind formula as a single story, and re-sorts `stories` in place:
 * subjects by score, each subject's stories kept together in their own order
 * (so the family lead still comes first).
 *
 * Sets `story.subject` = { storyCount, sourceCount, coverage, lastUpdated, score }
 * on every story (the same object for all members of a family).
 */
export function rankSubjects(stories, families, { recencyHalfLifeHours = 12, now = new Date() } = {}) {
  const order = new Map(); // story id -> [family index, rank within the old order]
  families.forEach((fam, fi) => {
    const members = fam.map((i) => stories[i]);
    const leanBySource = new Map();
    let last = 0;
    for (const s of members) {
      for (const a of s.articles) leanBySource.set(a.sourceId, a.lean);
      last = Math.max(last, Date.parse(s.lastUpdated));
    }
    const byLean = { left: 0, "lean-left": 0, center: 0, "lean-right": 0, right: 0 };
    const groups = { left: 0, center: 0, right: 0 };
    for (const lean of leanBySource.values()) {
      byLean[lean]++;
      groups[leanGroup(lean)]++;
    }
    const breadth = ["left", "center", "right"].filter((g) => groups[g] > 0).length;
    const score = storyScore(
      { sourceCount: leanBySource.size, breadth, hoursSinceUpdate: (now.getTime() - last) / 36e5 },
      recencyHalfLifeHours
    );
    const subject = {
      storyCount: members.length,
      sourceCount: leanBySource.size,
      coverage: { ...groups, byLean },
      lastUpdated: new Date(last).toISOString(),
      score: Number(score.toFixed(4)),
    };
    for (const i of fam) {
      stories[i].subject = subject;
      order.set(stories[i].id, [fi, i]);
    }
  });
  stories.sort((a, b) => {
    const d = b.subject.score - a.subject.score;
    if (d) return d;
    const [fa, ia] = order.get(a.id);
    const [fb, ib] = order.get(b.id);
    return fa - fb || ia - ib;
  });
  return stories;
}
