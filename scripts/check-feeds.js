// Health check for every feed in config/sources.json.
// Usage: npm run check:feeds

import { fetchFeed } from "../pipeline/fetch.js";
import { loadSources } from "../pipeline/sources.js";
import { mapLimit } from "../pipeline/util.js";

const sources = loadSources();
const jobs = sources.flatMap((s) => s.feeds.map((url) => ({ s, url })));
const results = await mapLimit(jobs, 8, async ({ s, url }) => ({ s, url, r: await fetchFeed(url, { timeoutMs: 15000, maxItems: 500 }) }));

let bad = 0;
for (const { s, url, r } of results) {
  if (!r.ok) {
    bad++;
    console.log(`FAIL  ${s.lean.padEnd(10)} ${s.name.padEnd(30)} ${r.error}\n      ${url}`);
    continue;
  }
  const dates = r.items.map((i) => Date.parse(i.isoDate || i.pubDate || "")).filter(Number.isFinite);
  const newestH = dates.length ? (Date.now() - Math.max(...dates)) / 36e5 : NaN;
  const stale = !Number.isFinite(newestH) || newestH > 48;
  if (stale) bad++;
  console.log(
    `${stale ? "STALE" : "ok   "} ${s.lean.padEnd(10)} ${s.name.padEnd(30)} ${String(r.items.length).padStart(3)} items, newest ${Number.isFinite(newestH) ? newestH.toFixed(1) + "h" : "?"} ago`
  );
}
console.log(bad ? `\n${bad} feed(s) need attention.` : "\nAll feeds healthy.");
process.exitCode = bad ? 1 : 0;
