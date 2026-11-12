// Health check for every feed in config/sources.json.
// Usage: npm run check:feeds

import { fetchFeed } from "../pipeline/fetch.js";
import { loadSources } from "../pipeline/sources.js";
import { mapLimit } from "../pipeline/util.js";

const sources = loadSources();
const jobs = sources.flatMap((s) => s.feeds.map((feed) => ({ s, feed })));
const results = await mapLimit(jobs, 8, async ({ s, feed }) => ({ s, feed, r: await fetchFeed(feed.url, { timeoutMs: 15000, maxItems: 500 }) }));

let bad = 0;
for (const { s, feed, r } of results) {
  const label = `${s.lean.padEnd(10)} ${(s.name + (feed.kind === "opinion" ? " (opinion)" : "")).padEnd(32)}`;
  if (!r.ok) {
    bad++;
    console.log(`FAIL  ${label} ${r.error}\n      ${feed.url}`);
    continue;
  }
  const dates = r.items.map((i) => Date.parse(i.isoDate || i.pubDate || "")).filter(Number.isFinite);
  const newestH = dates.length ? (Date.now() - Math.max(...dates)) / 36e5 : NaN;
  const stale = !Number.isFinite(newestH) || newestH > 48;
  if (stale) bad++;
  console.log(`${stale ? "STALE" : "ok   "} ${label} ${String(r.items.length).padStart(3)} items, newest ${Number.isFinite(newestH) ? newestH.toFixed(1) + "h" : "?"} ago`);
}
console.log(bad ? `\n${bad} feed(s) need attention.` : "\nAll feeds healthy.");
process.exitCode = bad ? 1 : 0;
