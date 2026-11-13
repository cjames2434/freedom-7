import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStoryIndex } from "../pipeline/storyindex.js";
import { linkRelated } from "../pipeline/related.js";

let n = 0;
const art = (title, snippet) => ({ id: `a${++n}`, sourceId: "x", title, snippet, url: `https://e.com/${n}`, published: new Date().toISOString() });
const story = (id, ...articles) => ({ id, articles });

test("stories about the same subject are linked and grouped under the top-ranked one", () => {
  const a1 = art("Acme Robotics CEO Dana Whitlock resigns amid fraud probe", "Dana Whitlock stepped down as Acme Robotics chief executive on Monday.");
  const a2 = art("Acme Robotics shares fall after CEO Whitlock quits", "Acme Robotics stock dropped after Dana Whitlock resigned.");
  const b1 = art("Acme Robotics names interim chief after Whitlock exit", "The board of Acme Robotics appointed an interim CEO after Dana Whitlock left.");
  const c1 = art("Heavy snow closes mountain passes in Colorado", "Snowfall closed roads across the Rockies on Tuesday.");
  const c2 = art("Colorado storm shuts highways as snow piles up", "Highways in the Rockies were closed by heavy snow.");
  const stories = [story("s1", a1, a2), story("s2", b1), story("s3", c1, c2)];
  const index = buildStoryIndex(stories, [a1, a2, b1, c1, c2]);
  const families = linkRelated(stories, index, { minSimilarity: 0.1, strongSimilarity: 0.6 });
  assert.deepEqual(stories[0].related, ["s2"]);
  assert.deepEqual(stories[1].related, ["s1"]);
  assert.equal(stories[1].familyId, "s1", "family is named after its top-ranked story");
  assert.deepEqual(stories[2].related, []);
  assert.equal(stories[2].familyId, "s3");
  assert.equal(families.filter((f) => f.length > 1).length, 1);
});

test("similar wording without a shared name isn't enough", () => {
  const a = art("Senate passes spending bill after late-night vote", "Lawmakers approved the bill.");
  const b = art("House passes spending bill after late-night vote", "Lawmakers approved the measure.");
  const stories = [story("s1", a), story("s2", b)];
  const index = buildStoryIndex(stories, [a, b]);
  linkRelated(stories, index, { minSimilarity: 0.1, strongSimilarity: 0.99 });
  assert.deepEqual(stories[0].related, [], "Senate and House are generic institutions, not names");
});

test("a subject split across several small stories ranks by its combined coverage", async () => {
  const { rankSubjects } = await import("../pipeline/related.js");
  const now = new Date();
  const t = now.toISOString();
  const mk = (id, sources, score) => ({
    id,
    score,
    lastUpdated: t,
    articles: sources.map(([sourceId, lean]) => ({ sourceId, lean })),
  });
  // Ranked by single-story score: big (5 outlets) beats each part of the split subject (3 outlets each)...
  const stories = [
    mk("big", [["a", "left"], ["b", "center"], ["c", "right"], ["d", "lean-left"], ["e", "lean-right"]], 3),
    mk("partA", [["f", "left"], ["g", "center"], ["h", "right"]], 2),
    mk("partB", [["i", "lean-left"], ["j", "center"], ["k", "lean-right"]], 1.9),
    mk("partC", [["l", "left"], ["m", "right"], ["n", "center"]], 1.8),
  ];
  for (const s of stories) s.familyId = s.id === "big" ? "big" : "partA";
  const families = [[0], [1, 2, 3]];
  rankSubjects(stories, families, { now });
  // ...but the split subject has 9 distinct outlets in total, so it ranks first, lead story first.
  assert.deepEqual(stories.map((s) => s.id), ["partA", "partB", "partC", "big"]);
  assert.equal(stories[0].subject.sourceCount, 9);
  assert.equal(stories[0].subject.storyCount, 3);
  assert.deepEqual([stories[0].subject.coverage.left, stories[0].subject.coverage.center, stories[0].subject.coverage.right], [3, 3, 3]);
  assert.equal(stories[1].subject, stories[0].subject, "family members share one subject object");
  assert.equal(stories[3].subject.sourceCount, 5);
});
