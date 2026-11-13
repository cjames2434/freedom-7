import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFeed, resolveSiteUrl } from "../pipeline/feed.js";

const t = "2026-11-12T10:00:00.000Z";
const news = {
  generatedAt: t,
  site: { name: "Freedom 7", tagline: "Every side of the story, side by side." },
  topics: [{ id: "politics", label: "Politics" }],
  stories: [
    { id: "s1", familyId: "s1", headline: "Senate passes <budget> & adjourns", snippet: "Vote was 52-48.", topic: "politics", lastUpdated: t,
      coverage: { left: 2, center: 1, right: 2 }, subject: { storyCount: 2, lastUpdated: t, coverage: { left: 3, center: 1, right: 2 } } },
    { id: "s2", familyId: "s1", headline: "Sibling update", snippet: "", topic: "politics", lastUpdated: t, coverage: { left: 1, center: 0, right: 0 } },
    { id: "s3", familyId: "s3", headline: "Other story", summary: "A summary.", topic: "politics", lastUpdated: t, coverage: { left: 1, center: 1, right: 1 } },
  ],
};

test("feed has one item per subject, escaped text and absolute links", () => {
  const xml = buildFeed(news, { siteUrl: "https://example.github.io/news/" });
  assert.equal((xml.match(/<item>/g) || []).length, 2, "sibling story is folded into its subject");
  assert.match(xml, /<title>Senate passes &lt;budget&gt; &amp; adjourns<\/title>/);
  assert.match(xml, /<link>https:\/\/example\.github\.io\/news\/#\/story\/s1<\/link>/);
  assert.match(xml, /Covered by 6 outlets across 2 related stories: 3 left-leaning, 1 center, 2 right-leaning\./);
  assert.match(xml, /<description>A summary\. Covered by 3 outlets: 1 left-leaning, 1 center, 1 right-leaning\.<\/description>/);
  assert.doesNotMatch(xml, /Sibling update/);
});

test("site URL comes from SITE_URL, settings, GitHub Actions, or localhost", () => {
  assert.equal(resolveSiteUrl({}, { SITE_URL: "https://news.example.com" }), "https://news.example.com/");
  assert.equal(resolveSiteUrl({ siteUrl: "https://a.b/c/" }, {}), "https://a.b/c/");
  assert.equal(resolveSiteUrl({}, { GITHUB_REPOSITORY: "chris/News" }), "https://chris.github.io/News/");
  assert.equal(resolveSiteUrl({}, { GITHUB_REPOSITORY: "chris/chris.github.io" }), "https://chris.github.io/");
  assert.equal(resolveSiteUrl({}, {}), "http://localhost:8080/");
});
