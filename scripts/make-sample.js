// Copies a trimmed snapshot of the latest build into docs/sample-news.json so
// it can be attached to Claude Design (or any designer) as realistic content.
// Usage: npm run build && npm run sample

import { readFileSync, writeFileSync } from "node:fs";

const news = JSON.parse(readFileSync("public/data/news.json", "utf8"));
const sources = JSON.parse(readFileSync("public/data/sources.json", "utf8"));

const keep = new Set(news.stories.slice(0, 18).map((s) => s.id));
for (const id of news.blindspots.slice(0, 4)) keep.add(id);
const sample = {
  ...news,
  stories: news.stories.filter((s) => keep.has(s.id)),
  blindspots: news.blindspots.filter((id) => keep.has(id)),
};
writeFileSync("docs/sample-news.json", JSON.stringify(sample, null, 2));
writeFileSync("docs/sample-sources.json", JSON.stringify(sources, null, 2));
console.log(`Wrote docs/sample-news.json (${sample.stories.length} stories) and docs/sample-sources.json`);
