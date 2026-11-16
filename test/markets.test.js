import { test } from "node:test";
import assert from "node:assert/strict";
import { aboutCompany, mentionsMarkets, tagMarkets } from "../pipeline/markets.js";

const WATCH = [
  { id: "nvidia", name: "NVIDIA", terms: ["nvidia", "jensen huang"] },
  { id: "spacex", name: "SpaceX", terms: ["spacex", "space x", "starship", "starlink", "starshield", "falcon 9"] },
];

const story = (id, headline, articles, topic = "us") => ({
  id,
  headline,
  topic,
  sourceCount: new Set(articles.map((a) => a.sourceId)).size,
  articles: articles.map(([sourceId, title, snippet = ""]) => ({ sourceId, title, snippet })),
});

test("market wording is recognised, and everyday uses of the same words are not", () => {
  for (const text of [
    "Stocks fell sharply on Monday",
    "The S&P 500 closed at a record",
    "Nasdaq slides as tech sells off",
    "Shares of the chipmaker fell 6%",
    "The Fed signalled another rate cut",
    "Inflation cooled in October",
    "The company plans an IPO next year",
    "How the slide could hit your 401(k)",
  ]) {
    assert.ok(mentionsMarkets(text), text);
  }
  for (const text of [
    "The comedian shares a message from prison",
    "Thousands attend a campaign rally in Ohio",
    "Storm leaves shelves out of stock in Florida",
    "The federal government denies reimbursements",
  ]) {
    assert.equal(mentionsMarkets(text), false, text);
  }
});

test("a company counts only when the story is about it, not when one article mentions it", () => {
  const re = /(?<![a-z0-9])(?:nvidia|jensen huang)(?![a-z0-9])/i;
  // Named in the headline.
  assert.ok(aboutCompany(story("a", "Nvidia names an interim CEO", [["x", "Nvidia names an interim CEO"], ["y", "Chipmaker picks interim leader"]]), re));
  // Named in two outlets' headlines.
  assert.ok(
    aboutCompany(story("b", "Senate asks executives to testify", [["x", "Senate wants Jensen Huang to testify"], ["y", "Nvidia chief asked to appear"], ["z", "Senate hearing set"]]), re)
  );
  // One article's excerpt mentions it in passing: not about the company.
  assert.equal(
    aboutCompany(
      story("c", "Leaders to meet in Asia next week", [
        ["x", "Leaders to meet in Asia", "Talks will cover trade, Taiwan and the Nvidia chip rules."],
        ["y", "Summit planned for next week"],
        ["z", "Three leaders to meet"],
      ]),
      re
    ),
    false
  );
});

test("tagMarkets marks market stories and followed companies, in rank order", () => {
  const stories = [
    story("s1", "SpaceX catches Starship booster at the tower", [["x", "SpaceX catches Starship booster"], ["y", "Starship flight test succeeds"]], "tech"),
    story("s2", "Stocks slide as chipmakers fall", [["x", "Stocks slide on Wall Street", "The Nasdaq fell 2%."], ["y", "Dow drops 400 points", "Stocks fell broadly."], ["z", "Markets close lower"]]),
    story("s3", "Senate passes the budget bill", [["x", "Senate passes budget"], ["y", "Budget bill clears Senate"]], "politics"),
    story("s4", "Nvidia shares fall after CEO resigns", [["x", "Nvidia shares fall after CEO resigns"], ["y", "Chipmaker's stock drops"]], "business"),
    story("s5", "Oil prices rise on supply worries", [["x", "Oil prices rise", "Brent crude gained 3%."], ["y", "Crude climbs on supply fears"]], "business"),
  ];
  const result = tagMarkets(stories, { watch: WATCH });
  assert.deepEqual(result.companies, [
    { id: "nvidia", name: "NVIDIA" },
    { id: "spacex", name: "SpaceX" },
  ]);
  assert.deepEqual(result.stories, ["s1", "s2", "s4", "s5"]);
  assert.deepEqual(
    stories.map((s) => [s.id, s.market, s.companies]),
    [
      ["s1", true, ["spacex"]],
      ["s2", true, []],
      ["s3", false, []],
      ["s4", true, ["nvidia"]],
      ["s5", true, []],
    ]
  );
});

test("with no companies followed, only market news is tagged", () => {
  const stories = [story("s1", "SpaceX launches Starship", [["x", "SpaceX launches Starship"], ["y", "Starship lifts off"]], "tech")];
  const result = tagMarkets(stories);
  assert.deepEqual(result, { companies: [], stories: [] });
  assert.deepEqual(stories[0].companies, []);
});
