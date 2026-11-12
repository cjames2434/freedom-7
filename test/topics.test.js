import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTopic, urlSection, urlTopic } from "../pipeline/topics.js";

test("URL sections map to topics, the most specific one winning", () => {
  assert.equal(urlTopic("https://www.nytimes.com/2026/11/11/us/politics/senate-vote.html"), "politics");
  assert.equal(urlTopic("https://thehill.com/policy/defense/5551234-army-budget/"), "military");
  assert.equal(urlTopic("https://www.foxnews.com/outkick-sports/bengals-coach-trade"), "sports");
  assert.equal(urlTopic("https://www.theguardian.com/world/2026/nov/11/pope-peru"), "world");
  assert.equal(urlTopic("https://www.huffpost.com/entry/some-story_n_123"), null);
  assert.equal(urlTopic("not a url"), null);
});

test("catch-all sections count for less than specific ones", () => {
  assert.deepEqual(urlSection("https://www.theguardian.com/us-news/2026/nov/11/x"), { topic: "us", broad: true });
  assert.deepEqual(urlSection("https://www.nbcnews.com/politics/congress/x"), { topic: "politics", broad: false });
});

test("crime and accident stories land in U.S., not Politics", () => {
  const story = [
    { title: "Gunman dead after killing one, injuring 4 others in Washington, D.C.", snippet: "Police said the suspect was shot by officers.", url: "https://e.com/a" },
    { title: "Washington DC shooting leaves one dead and four injured", snippet: "The mayor praised responders.", url: "https://e.com/b" },
  ];
  assert.equal(classifyTopic(story), "us");
});

test("a political story filed under a catch-all section stays in Politics", () => {
  const story = [
    { title: "Marco Rubio spent $1.2m of taxpayer money on travel, report says", snippet: "The secretary of state's trips drew criticism from Democrats in Congress.", url: "https://www.theguardian.com/us-news/2026/nov/11/rubio" },
    { title: "Rubio travel costs questioned by Senate Democrats", snippet: "Lawmakers asked the administration for records.", url: "https://www.dailywire.com/news/rubio-travel" },
  ];
  assert.equal(classifyTopic(story), "politics");
});
