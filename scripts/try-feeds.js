// Try feed URLs that aren't in the roster yet, with the same fetcher the build uses.
// Usage: node scripts/try-feeds.js <url> [<url> ...]   (or FEED_URLS="url url" in the environment)
// Some publishers block requests from hosting providers, so a feed that works at
// home can fail on GitHub. The "Check feeds" workflow runs this from GitHub's servers.

import { fetchFeed } from "../pipeline/fetch.js";
import { mapLimit } from "../pipeline/util.js";

const urls = [...process.argv.slice(2), ...(process.env.FEED_URLS || "").split(/\s+/)].filter((u) => /^https?:\/\//i.test(u));
if (!urls.length) {
  console.log("No feed URLs given.");
  process.exit(0);
}
const results = await mapLimit(urls, 6, async (url) => ({ url, r: await fetchFeed(url, { timeoutMs: 15000, maxItems: 500 }) }));
for (const { url, r } of results) {
  if (!r.ok) {
    console.log(`FAIL  ${r.error}\n      ${url}`);
    continue;
  }
  const dates = r.items.map((i) => Date.parse(i.isoDate || i.pubDate || "")).filter(Number.isFinite);
  const newestH = dates.length ? (Date.now() - Math.max(...dates)) / 36e5 : NaN;
  const dayAgo = dates.filter((d) => Date.now() - d < 864e5).length;
  console.log(`ok    ${String(r.items.length).padStart(3)} items, ${String(dayAgo).padStart(3)} in 24h, newest ${Number.isFinite(newestH) ? newestH.toFixed(1) + "h" : "?"} ago\n      ${url}\n      e.g. ${(r.items[0]?.title || "").slice(0, 90)}`);
}
