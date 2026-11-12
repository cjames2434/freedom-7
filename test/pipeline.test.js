import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalUrl, cleanText, leanGroup } from "../pipeline/util.js";
import { analyzeHeadline } from "../pipeline/language.js";
import { opinionReason } from "../pipeline/opinion.js";
import { clusterArticles, stem } from "../pipeline/cluster.js";
import { mostlyCoveredBy, pickHeadline, storyScore } from "../pipeline/stories.js";
import { checkBalance, loadSources } from "../pipeline/sources.js";

test("canonicalUrl strips tracking params, fragments and www", () => {
  assert.equal(
    canonicalUrl("http://www.example.com/story/123/?utm_source=rss&id=7#top"),
    "https://example.com/story/123/?id=7"
  );
});

test("cleanText removes tags, entities and WordPress footers", () => {
  assert.equal(
    cleanText("<p>Senate votes &amp; adjourns</p> The post Senate votes appeared first on Example News."),
    "Senate votes & adjourns"
  );
});

test("leanGroup collapses five leans to three", () => {
  assert.deepEqual(["left", "lean-left", "center", "lean-right", "right"].map(leanGroup), [
    "left", "left", "center", "right", "right",
  ]);
});

test("loaded language is flagged regardless of which side it targets", () => {
  const a = analyzeHeadline("Senator slams Republicans in fiery speech");
  const b = analyzeHeadline("Senator slams Democrats in fiery speech");
  assert.deepEqual(a.loaded, ["slams"]);
  assert.deepEqual(b.loaded, ["slams"]);
  assert.equal(a.heat, b.heat);
  assert.equal(analyzeHeadline("Senate passes budget bill 52-48").heat, 0);
});

test("contested terms are flagged symmetrically", () => {
  assert.equal(analyzeHeadline("Pro-life group sues state").contested[0].codedAs, "right");
  assert.equal(analyzeHeadline("Pro-choice group sues state").contested[0].codedAs, "left");
});

test("opinion pieces are detected by URL, title and category", () => {
  assert.ok(opinionReason({ url: "https://x.com/opinion/2026/foo", title: "Foo", categories: [] }));
  assert.ok(opinionReason({ url: "https://x.com/a", title: "Opinion: We must act", categories: [] }));
  assert.ok(opinionReason({ url: "https://x.com/a", title: "Foo", categories: ["Commentary"] }));
  assert.equal(opinionReason({ url: "https://x.com/politics/a", title: "House passes bill", categories: ["Politics"] }), null);
});

test("stem handles simple plurals", () => {
  assert.equal(stem("tariffs"), "tariff");
  assert.equal(stem("policies"), "policy");
  assert.equal(stem("congress"), "congress");
});

test("clustering groups the same event across outlets and keeps others apart", () => {
  const now = new Date().toISOString();
  const mk = (id, sourceId, title, snippet = "") => ({ id, sourceId, title, snippet, published: now, url: `https://e.com/${id}` });
  const articles = [
    mk("1", "a", "Supreme Court strikes down Texas redistricting map", "The Supreme Court ruled the Texas congressional map unconstitutional."),
    mk("2", "b", "Justices reject Texas congressional map in redistricting case", "The Supreme Court ruled against Texas on its redistricting map."),
    mk("3", "c", "Texas redistricting map struck down by Supreme Court", "In a 6-3 ruling the Supreme Court rejected the Texas map."),
    mk("4", "a", "Hurricane Delta makes landfall in Louisiana", "The storm brought heavy rain to the Gulf Coast."),
    mk("5", "d", "Hurricane Delta slams Louisiana coast with heavy rain", "Delta made landfall in Louisiana on Tuesday."),
    mk("6", "e", "Apple unveils new iPhone with satellite messaging", "Apple announced its latest phone."),
  ];
  const clusters = clusterArticles(articles, { threshold: 0.2 }).map((c) => c.map((m) => articles[m.index].id).sort());
  const find = (id) => clusters.find((c) => c.includes(id));
  assert.deepEqual(find("1"), ["1", "2", "3"]);
  assert.deepEqual(find("4"), ["4", "5"]);
  assert.deepEqual(find("6"), ["6"]);
});

test("blindspot detection is symmetric", () => {
  assert.equal(mostlyCoveredBy({ left: 5, center: 1, right: 0 }), "left");
  assert.equal(mostlyCoveredBy({ left: 0, center: 1, right: 5 }), "right");
  assert.equal(mostlyCoveredBy({ left: 3, center: 2, right: 3 }), null);
  assert.equal(mostlyCoveredBy({ left: 2, center: 4, right: 0 }), null); // too few partisan outlets to call it
});

test("ranking rewards reach, spectrum breadth and recency", () => {
  const base = { sourceCount: 6, breadth: 3, hoursSinceUpdate: 1 };
  assert.ok(storyScore(base) > storyScore({ ...base, sourceCount: 3 }));
  assert.ok(storyScore(base) > storyScore({ ...base, breadth: 1 }));
  assert.ok(storyScore(base) > storyScore({ ...base, hoursSinceUpdate: 20 }));
});

test("headline pick prefers plain wording over loaded wording", () => {
  const item = (title, lean, centrality = 0.8) => ({
    article: { title },
    lean,
    centrality,
    analysis: analyzeHeadline(title),
  });
  const chosen = pickHeadline([
    item("Senator SLAMS colleagues in bombshell hearing on budget", "center"),
    item("Senators clash over budget during committee hearing", "lean-left"),
  ]);
  assert.equal(chosen.article.title, "Senators clash over budget during committee hearing");
});

test("the shipped source roster is balanced", () => {
  const result = checkBalance(loadSources("config/sources.json"));
  assert.ok(result.ok, result.problems.join("; "));
});
