import { readFileSync } from "node:fs";
import { LEANS } from "./util.js";

export const FEED_KINDS = ["news", "opinion"];

/** Feeds may be written as a bare URL (news) or { url, kind }. Normalise to objects. */
function normalizeFeed(feed, sourceId) {
  const f = typeof feed === "string" ? { url: feed, kind: "news" } : { kind: "news", ...feed };
  if (!f.url) throw new Error(`Source "${sourceId}" has a feed with no url`);
  if (!FEED_KINDS.includes(f.kind)) throw new Error(`Source "${sourceId}" feed kind "${f.kind}" must be one of: ${FEED_KINDS.join(", ")}`);
  return f;
}

export function loadSources(path = "config/sources.json") {
  const { sources } = JSON.parse(readFileSync(path, "utf8"));
  const ids = new Set();
  for (const s of sources) {
    if (!s.id || !s.name || !Array.isArray(s.feeds) || !s.feeds.length) {
      throw new Error(`Source entry is missing id, name or feeds: ${JSON.stringify(s)}`);
    }
    if (!LEANS.includes(s.lean)) throw new Error(`Source "${s.id}" has unknown lean "${s.lean}". Use one of: ${LEANS.join(", ")}`);
    if (ids.has(s.id)) throw new Error(`Duplicate source id "${s.id}"`);
    ids.add(s.id);
    s.feeds = s.feeds.map((f) => normalizeFeed(f, s.id));
  }
  return sources;
}

export const hasKind = (source, kind) => source.feeds.some((f) => f.kind === kind);

function countByLean(sources) {
  const counts = Object.fromEntries(LEANS.map((l) => [l, 0]));
  for (const s of sources) counts[s.lean]++;
  return counts;
}

function mirrorProblems(counts, label) {
  const problems = [];
  if (counts.left !== counts.right) problems.push(`${label}: left (${counts.left}) and right (${counts.right}) differ`);
  if (counts["lean-left"] !== counts["lean-right"])
    problems.push(`${label}: lean-left (${counts["lean-left"]}) and lean-right (${counts["lean-right"]}) differ`);
  return problems;
}

/**
 * Two rosters must each mirror themselves: outlets with a news feed, and
 * outlets with an opinion feed. Otherwise coverage counts, blindspots and
 * Perspectives would tilt toward whichever side has more outlets.
 * `counts` (news) is kept for backwards compatibility.
 */
export function checkBalance(sources) {
  const news = countByLean(sources.filter((s) => hasKind(s, "news")));
  const opinion = countByLean(sources.filter((s) => hasKind(s, "opinion")));
  const problems = [...mirrorProblems(news, "news outlets"), ...mirrorProblems(opinion, "opinion outlets")];
  return { ok: problems.length === 0, counts: news, news, opinion, problems };
}
