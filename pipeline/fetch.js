import Parser from "rss-parser";
import { mapLimit } from "./util.js";

const USER_AGENT =
  "Mozilla/5.0 (compatible; EvenKeelNewsReader/0.1; personal non-commercial RSS reader)";

const parser = new Parser({
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: true }],
      ["media:group", "mediaGroup"],
      ["dc:date", "dcDate"],
    ],
  },
});

async function fetchText(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch and parse one feed. Never throws: failures come back as { ok: false }
 * so one broken outlet can't take down the whole build.
 */
export async function fetchFeed(url, { timeoutMs = 15000, maxItems = 40 } = {}) {
  const started = Date.now();
  try {
    const xml = await fetchText(url, timeoutMs);
    const feed = await parser.parseString(xml);
    const items = (feed.items || []).slice(0, maxItems);
    return { url, ok: true, items, ms: Date.now() - started };
  } catch (err) {
    const reason = err.name === "AbortError" ? `timed out after ${timeoutMs}ms` : err.message;
    return { url, ok: false, items: [], error: reason, ms: Date.now() - started };
  }
}

/** Fetch every feed of every source. Returns [{ source, url, ok, items, error }]. */
export async function fetchAllSources(sources, { concurrency = 6, timeoutMs, maxItems } = {}) {
  const jobs = sources.flatMap((source) => source.feeds.map((url) => ({ source, url })));
  return mapLimit(jobs, concurrency, async ({ source, url }) => ({
    source,
    ...(await fetchFeed(url, { timeoutMs, maxItems })),
  }));
}
