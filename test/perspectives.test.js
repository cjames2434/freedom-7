import { test } from "node:test";
import assert from "node:assert/strict";
import { attachPerspectives } from "../pipeline/perspectives.js";
import { nonNewsKind } from "../pipeline/opinion.js";
import { buildStories } from "../pipeline/stories.js";
import { checkBalance } from "../pipeline/sources.js";

const sources = [
  { id: "L1", name: "Left One", lean: "left" },
  { id: "L2", name: "Left Two", lean: "lean-left" },
  { id: "C1", name: "Center One", lean: "center" },
  { id: "R1", name: "Right One", lean: "lean-right" },
  { id: "R2", name: "Right Two", lean: "right" },
];
const sourcesById = new Map(sources.map((s) => [s.id, s]));
const now = new Date();
const iso = (hoursAgo) => new Date(now.getTime() - hoursAgo * 36e5).toISOString();
let n = 0;
const art = (sourceId, title, snippet = "", hoursAgo = 1) => ({
  id: `a${++n}`,
  sourceId,
  title,
  snippet,
  url: `https://e.com/${n}`,
  published: iso(hoursAgo),
});

const settings = {
  minSourcesForStory: 2,
  minPartisanSourcesForBlindspot: 3,
  blindspotShare: 0.8,
  maxStories: 50,
  recencyHalfLifeHours: 12,
  developing: { windowHours: 3, minRecentSources: 3 },
};

function storyFrom(articles) {
  return buildStories([articles.map((_, index) => ({ index, centrality: 0.9 }))], articles, sourcesById, settings, now)[0];
}

const newsArticles = [
  art("L2", "Senate confirms Maria Delgado as Treasury secretary", "The Senate voted 52-48 to confirm Maria Delgado to lead the Treasury Department."),
  art("C1", "Maria Delgado confirmed as Treasury secretary in 52-48 vote", "Delgado was confirmed by the Senate on Tuesday."),
  art("R1", "Senate narrowly confirms Delgado to run Treasury", "Senators confirmed Maria Delgado 52-48."),
];

test("Perspectives: equal numbers from each side, only when both sides wrote", () => {
  const story = storyFrom(newsArticles);
  const opinion = [
    art("L1", "Delgado Is the Wrong Pick for Treasury", "Maria Delgado's record at the Treasury should worry everyone."),
    art("L2", "What Delgado Means for the Treasury", "The Senate's vote to confirm Delgado as Treasury secretary..."),
    art("R2", "Delgado Will Bring Discipline to the Treasury", "Maria Delgado's confirmation by the Senate is good news."),
    art("C1", "Unrelated column about baseball", "The season ended."),
  ];
  // Tiny corpus, so similarities are low; the name requirement does the real filtering here.
  const count = attachPerspectives([story], newsArticles, opinion, sourcesById, { threshold: 0.01 });
  assert.equal(count, 1);
  assert.equal(story.perspectives.left.length, 1, "left is trimmed to match the right");
  assert.equal(story.perspectives.right.length, 1);
  assert.equal(story.perspectives.center.length, 0, "unrelated piece is not attached");
});

test("Perspectives: one-sided opinion is never shown", () => {
  const story = storyFrom(newsArticles);
  const opinion = [
    art("L1", "Delgado Is the Wrong Pick for Treasury", "Maria Delgado's record at the Treasury."),
    art("L2", "Delgado and the Treasury", "Maria Delgado confirmed by the Senate."),
  ];
  assert.equal(attachPerspectives([story], newsArticles, opinion, sourcesById, { threshold: 0.05 }), 0);
  assert.equal(story.perspectives, null);
});

test("Perspectives: a headline must name something from the story", () => {
  const story = storyFrom(newsArticles);
  const opinion = [
    art("L1", "The Senate Has Lost Its Way", "The Senate voted again on Tuesday."),
    art("R2", "Why the Senate Still Matters", "Senators voted on Tuesday."),
  ];
  assert.equal(attachPerspectives([story], newsArticles, opinion, sourcesById, { threshold: 0.01 }), 0);
});

test("developing flag needs several outlets in the last few hours", () => {
  const fresh = storyFrom([art("L2", "Bridge collapses in Springfield", "", 0.5), art("C1", "Springfield bridge collapse", "", 1), art("R1", "Springfield bridge falls", "", 2)]);
  assert.equal(fresh.developing, true);
  assert.equal(fresh.recentSourceCount, 3);
  const old = storyFrom([art("L2", "Bridge collapses in Springfield", "", 10), art("C1", "Springfield bridge collapse", "", 11), art("R1", "Springfield bridge falls", "", 1)]);
  assert.equal(old.developing, false);
});

test("non-news sorting separates opinion from podcasts and newsletters", () => {
  const a = (url, title = "Something happened", categories = []) => ({ url, title, categories });
  assert.equal(nonNewsKind(a("https://reason.com/volokh/2026/11/11/x/")).kind, "opinion");
  assert.equal(nonNewsKind(a("https://www.nationalreview.com/corner/x/")).kind, "opinion");
  assert.equal(nonNewsKind(a("https://www.vox.com/today-explained-newsletter/1/x")).kind, "other");
  assert.equal(nonNewsKind(a("https://x.com/podcasts/ep-1")).kind, "other");
  assert.equal(nonNewsKind(a("https://x.com/a", "The Monthly Mailbag With Jack")).kind, "other");
  assert.equal(nonNewsKind(a("https://x.com/video/storm-hits-coast")), null, "video reports are news");
});

test("opinion roster must mirror itself too", () => {
  const mk = (id, lean, kinds) => ({ id, lean, feeds: kinds.map((kind) => ({ url: `https://e.com/${id}/${kind}`, kind })) });
  const ok = checkBalance([mk("a", "left", ["news"]), mk("b", "right", ["news"]), mk("c", "left", ["opinion"]), mk("d", "right", ["opinion"])]);
  assert.ok(ok.ok);
  const bad = checkBalance([mk("a", "left", ["news"]), mk("b", "right", ["news"]), mk("c", "left", ["opinion"])]);
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join(";"), /opinion outlets/);
});
