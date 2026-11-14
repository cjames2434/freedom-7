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

test("headline pick avoids 'Watch:' and 'Video:' clip titles when a plain headline exists", () => {
  const item = (title, lean) => ({ article: { title }, lean, centrality: 0.9, analysis: analyzeHeadline(title) });
  const chosen = pickHeadline([
    item("Watch: How a server outage took down Microsoft Outlook across the US", "center"),
    item("Microsoft Outlook outage disrupts email for users across the U.S.", "lean-left"),
  ]);
  assert.equal(chosen.article.title, "Microsoft Outlook outage disrupts email for users across the U.S.");
});

// --- Left and right take turns on equally plain headlines ---

import { assignTurns, headlineChoices } from "../pipeline/stories.js";

const hItem = (title, lean, centrality = 0.8) => ({ article: { title }, lean, centrality, analysis: analyzeHeadline(title) });
const LEFT_PLAIN = "Senate passes the annual budget bill after a long debate";
const RIGHT_PLAIN = "Senate approves annual budget bill following lengthy debate";

test("equally plain left and right headlines take turns, whichever side would have won", () => {
  const items = [hItem(LEFT_PLAIN, "lean-left"), hItem(RIGHT_PLAIN, "right")];
  const { bestSide, rival } = headlineChoices(items);
  assert.equal(bestSide, "left"); // nearer the center, so it wins on cost alone
  assert.equal(rival.article.title, RIGHT_PLAIN);
  assert.equal(pickHeadline(items, { turn: "left" }).article.title, LEFT_PLAIN);
  assert.equal(pickHeadline(items, { turn: "right" }).article.title, RIGHT_PLAIN);

  // Mirror image: the same rule the other way round.
  const mirrored = [hItem(LEFT_PLAIN, "left"), hItem(RIGHT_PLAIN, "lean-right")];
  assert.equal(headlineChoices(mirrored).bestSide, "right");
  assert.equal(pickHeadline(mirrored, { turn: "left" }).article.title, LEFT_PLAIN);
  assert.equal(pickHeadline(mirrored, { turn: "right" }).article.title, RIGHT_PLAIN);
});

test("a turn never swaps in a more loaded headline, or replaces a center outlet's", () => {
  const loaded = "Senator SLAMS colleagues in bombshell budget bill hearing";
  for (const [plainLean, loadedLean, turn] of [["lean-left", "lean-right", "right"], ["lean-right", "lean-left", "left"]]) {
    const items = [hItem(LEFT_PLAIN, plainLean), hItem(loaded, loadedLean)];
    assert.equal(headlineChoices(items).rival, null);
    assert.equal(pickHeadline(items, { turn }).article.title, LEFT_PLAIN);
  }
  const withCenter = [hItem(LEFT_PLAIN, "center"), hItem(RIGHT_PLAIN, "lean-right"), hItem(RIGHT_PLAIN, "lean-left")];
  assert.equal(headlineChoices(withCenter).rival, null);
  assert.equal(pickHeadline(withCenter, { turn: "right" }).lean, "center");
});

test("turns even out left and right across stories and stay put between builds", () => {
  const open = (id, bestSide, firstSeen) => ({ id, firstSeen, bothSides: true, choices: { bestSide, rival: {} } });
  const fixed = (id, bestSide) => ({ id, firstSeen: "2026-01-01T00:00:00Z", bothSides: true, choices: { bestSide, rival: null } });
  const count = (turns) => {
    const n = { left: 0, right: 0 };
    for (const side of turns.values()) n[side]++;
    return n;
  };

  // Ten undecided stories that would all have gone to the left: now five each.
  const ten = Array.from({ length: 10 }, (_, i) => open(`s${i}`, "left", `2026-01-01T0${i}:00:00Z`));
  assert.deepEqual(count(assignTurns(ten)), { left: 5, right: 5 });
  // And the same when they would all have gone to the right.
  assert.deepEqual(count(assignTurns(ten.map((d) => open(d.id, "right", d.firstSeen)))), { left: 5, right: 5 });

  // Stories one side won outright count first; the other side catches up.
  const mixed = [fixed("f1", "left"), fixed("f2", "left"), ...ten.slice(0, 4)];
  assert.deepEqual(count(assignTurns(mixed)), { left: 1, right: 3 });

  // A story keeps the turn it had, even when new stories arrive.
  const before = Object.fromEntries(assignTurns(ten));
  const after = assignTurns([open("new", "left", "2025-12-31T00:00:00Z"), ...ten], before);
  for (const d of ten) assert.equal(after.get(d.id), before[d.id]);
});

// --- Excerpts: photo credits and broadcast sign-offs are trimmed ---

import { tidySnippet } from "../pipeline/normalize.js";

test("excerpts lose leading photo credits and trailing sign-offs, and nothing else", () => {
  const body = "A tanker crashed into a docked cruise ship near the Port of New Orleans on Friday.";
  for (const credit of ["JANE DOE / JANE DOE via REUTERS ", "Jane Doe / Getty Images ", "Getty Images ", "Photo Illustration by Jane Doe/The Outlet/Getty Images "]) {
    assert.equal(tidySnippet(credit + body), body);
  }
  for (const signOff of [" Jane Doe has more.", " CBS News' Jane Van Doe and John Roe report.", " NBC News’ Jane Doe reports.", " Jane Doe anchors a special report.", " DW has the latest."]) {
    assert.equal(tidySnippet(body + signOff), body);
  }
  // Ordinary sentences are left alone.
  for (const keep of [
    body,
    "Getty Images will lay off a tenth of its staff, the company said.",
    "Hiring slowed in October, the Bureau of Labor Statistics reports.",
    "The storm made landfall on Tuesday. Officials said the damage reports are still coming in.",
  ]) {
    assert.equal(tidySnippet(keep), keep);
  }
});

// --- Blindspots look at the whole subject ---

import { settleBlindspots } from "../pipeline/stories.js";

test("a story is not a blindspot when the other side covered the subject in a related story", () => {
  const cov = (left, center, right) => ({ left, center, right });
  const opts = { minPartisanSourcesForBlindspot: 3, blindspotShare: 0.8 };
  const mk = (side, own, subject) => ({ mostlyCoveredBy: side, coverage: own, subject });
  const stories = [
    mk("left", cov(4, 1, 0), { storyCount: 3, coverage: cov(8, 5, 7) }), // the right covered a sibling story
    mk("right", cov(0, 1, 4), { storyCount: 3, coverage: cov(7, 5, 8) }), // mirror image
    mk("left", cov(4, 1, 0), { storyCount: 2, coverage: cov(6, 1, 0) }), // the whole subject is one-sided
    mk("right", cov(0, 0, 3), { storyCount: 1, coverage: cov(0, 0, 3) }), // a story on its own
  ];
  settleBlindspots(stories, opts);
  assert.deepEqual(stories.map((s) => s.mostlyCoveredBy), [null, null, "left", "right"]);
});

// --- The summary under a headline ends on a whole sentence ---

import { blurbOf } from "../pipeline/stories.js";

test("a shortened summary keeps whole sentences and stays the outlet's own words", () => {
  const first = "The nationwide ground stop issued by the Federal Aviation Administration on Friday afternoon has been lifted, Transportation Secretary Sean Duffy confirmed.";
  const cut = first + " “At 8:15 tonight Eastern Time, we’ve opened up the airspace,” Duffy said to reporters in the White House briefing room during…";
  assert.equal(blurbOf(cut), first);
  assert.equal(blurbOf(first), first); // short and complete: untouched
  assert.equal(blurbOf(""), null);
  // One long cut-off sentence has no whole sentence to fall back on, so it is shortened as before.
  const long = "Officials in the capital said on Tuesday that the review, which began last spring and covers dozens of agencies, had found no single cause…";
  assert.ok(blurbOf(long).endsWith("…"));
  // Abbreviations do not end a sentence.
  const abbr = "Sen. Jane Doe of the U.S. Senate said the bill would pass this week after months of talks between the two parties. Critics disagreed with that prediction and promised to slow it down in committee, where several amendments are already waiting for…";
  assert.equal(blurbOf(abbr), "Sen. Jane Doe of the U.S. Senate said the bill would pass this week after months of talks between the two parties.");
});

test("a paragraph break ends a sentence even when the outlet left off the full stop", () => {
  assert.equal(
    cleanText("<p>Officials said a device was found and defused; FBI said it is investigating</p><p>Residents were ordered to leave.</p>"),
    "Officials said a device was found and defused; FBI said it is investigating. Residents were ordered to leave."
  );
  // Paragraphs that already end properly are left alone.
  assert.equal(cleanText("<p>The vote was 52-48.</p><p>It now goes to the House.</p>"), "The vote was 52-48. It now goes to the House.");
  assert.equal(cleanText("<p>Only one paragraph here</p>"), "Only one paragraph here");
});

// --- Round of fixes: tone words, live blogs and polls, clip labels, name-only pairs ---

import { nonNewsKind } from "../pipeline/opinion.js";
import { shareEnoughWords } from "../pipeline/stories.js";

test("insults and sensational words are flagged whoever they are aimed at", () => {
  for (const word of ["goon", "loser", "bloodbath", "brags", "savaged", "humiliation", "brutal"]) {
    const aboutLeft = analyzeHeadline(`Democrat ${word} in the Senate after the vote`);
    const aboutRight = analyzeHeadline(`Republican ${word} in the Senate after the vote`);
    assert.ok(aboutLeft.heat > 0, `${word} should be flagged`);
    assert.equal(aboutLeft.heat, aboutRight.heat);
  }
  assert.equal(analyzeHeadline("Senate passes budget bill after overnight talks").heat, 0);
});

test("live blogs, reader polls and puzzles are not news stories", () => {
  const kind = (title) => nonNewsKind({ url: "https://x.com/news/a", title, categories: [] })?.kind ?? "news";
  assert.equal(kind("Live updates: Air travel recovers from ground stop; court gathers"), "other");
  assert.equal(kind("You Vote: Who is the most likely nominee for 2028?"), "other");
  assert.equal(kind("Mini Crossword: Saturday edition"), "other");
  assert.equal(kind("Air travel recovers after nationwide ground stop"), "news");
  assert.equal(kind("Poll: Voters split on the budget bill"), "news");
});

test("headline pick avoids clip and show labels at the end of a title too", () => {
  const item = (title, lean) => ({ article: { title }, lean, centrality: 0.9, analysis: analyzeHeadline(title) });
  for (const label of ["– video", "| Special Report", "- The Latest"]) {
    const chosen = pickHeadline([
      item(`Nationwide ground stop halts air traffic across the country ${label}`, "center"),
      item("Nationwide ground stop halts air traffic across the country", "lean-right"),
    ]);
    assert.equal(chosen.lean, "lean-right", label);
  }
});

test("two outlets sharing only a name do not make a story", () => {
  const it = (sourceId, title, snippet = "") => ({ article: { sourceId, title, snippet } });
  assert.equal(shareEnoughWords([it("a", "Ben Shapiro's new movie panned by critics"), it("b", "Ben Shapiro warns Democrats about the economy")]), false);
  assert.equal(shareEnoughWords([it("a", "TSA agent finds live snakes in luggage at California airport"), it("b", "Airport security makes discovery in luggage at California airport")]), true);
  // Two articles from the same outlet don't count as agreement.
  assert.equal(shareEnoughWords([it("a", "Senate passes annual budget bill"), it("a", "Senate passes annual budget bill")]), false);
});

// --- Story ids that last ---

import { settleIds } from "../pipeline/stories.js";

test("a story keeps its id as its articles change, and merged stories leave an alias", () => {
  const item = (id, hour) => ({ article: { id, published: `2026-01-01T${String(hour).padStart(2, "0")}:00:00Z` } });
  const draft = (...items) => ({ id: `s_${items[0].article.id}`, items });
  const A = item("a", 1), B = item("b", 2), C = item("c", 3), D = item("d", 4), E = item("e", 5), F = item("f", 6);

  // First build: nothing remembered, so ids are the defaults.
  const first = [draft(A, B, C), draft(D, E)];
  const m1 = settleIds(first);
  assert.deepEqual(first.map((d) => d.id), ["s_a", "s_d"]);
  assert.deepEqual(m1.aliases, {});

  // The earliest article leaves the window and a new one joins: same story, same id.
  const second = [draft(B, C, F), draft(D, E)];
  const m2 = settleIds(second, m1);
  assert.deepEqual(second.map((d) => d.id), ["s_a", "s_d"]);

  // The two stories merge: the bigger one's id survives, the other becomes an alias.
  const merged = [draft(B, C, F, D, E)];
  const m3 = settleIds(merged, m2);
  assert.equal(merged[0].id, "s_a");
  assert.deepEqual(m3.aliases, { s_d: "s_a" });

  // The alias follows the story on later builds, and goes when the story does.
  const m4 = settleIds([draft(C, F, D, E)], m3);
  assert.deepEqual(m4.aliases, { s_d: "s_a" });
  const gone = [draft(item("x", 7), item("y", 8))];
  assert.deepEqual(settleIds(gone, m4).aliases, {});
  assert.equal(gone[0].id, "s_x");
});

test("when a story splits, the bigger part keeps the id and the other gets a new one", () => {
  const item = (id, hour) => ({ article: { id, published: `2026-01-01T${String(hour).padStart(2, "0")}:00:00Z` } });
  const draft = (...items) => ({ id: `s_${items[0].article.id}`, items });
  const A = item("a", 1), B = item("b", 2), C = item("c", 3), D = item("d", 4), E = item("e", 5);
  const m1 = settleIds([draft(A, B, C, D)]);
  // The smaller part even contains the article the id was named after.
  const parts = [draft(A, E), draft(B, C, D)];
  settleIds(parts, m1);
  assert.equal(parts[1].id, "s_a");
  assert.notEqual(parts[0].id, "s_a");
  assert.equal(new Set(parts.map((d) => d.id)).size, 2);
});
