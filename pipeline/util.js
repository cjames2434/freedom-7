import { createHash } from "node:crypto";

export const LEANS = ["left", "lean-left", "center", "lean-right", "right"];

/** Collapse the 5-point lean into the 3 groups the UI shows. */
export function leanGroup(lean) {
  if (lean === "left" || lean === "lean-left") return "left";
  if (lean === "right" || lean === "lean-right") return "right";
  return "center";
}

/** How far from center a lean is: 0 center, 1 lean, 2 full. */
export function leanDistance(lean) {
  return { center: 0, "lean-left": 1, "lean-right": 1, left: 2, right: 2 }[lean] ?? 1;
}

/**
 * Whose turn it is on a story: "left" or "right", fixed by the story's id so
 * it doesn't change between builds and comes out about half and half.
 */
export function sideTurn(seed) {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 2 === 0 ? "left" : "right";
}

export function shortHash(str, len = 10) {
  return createHash("sha1").update(str).digest("hex").slice(0, len);
}

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  mdash: "—", ndash: "–", hellip: "…", eacute: "é",
  aacute: "á", iacute: "í", oacute: "ó", uacute: "ú",
  ntilde: "ñ", uuml: "ü", ouml: "ö", auml: "ä", ccedil: "ç",
};

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Strip HTML tags, decode entities, collapse whitespace, drop common feed boilerplate. */
export function cleanText(s) {
  if (!s) return "";
  let t = String(s)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  t = decodeEntities(decodeEntities(t)); // some feeds double-encode
  t = t
    .replace(/The post .{1,300}? appeared first on .{1,120}?\.?\s*$/i, "")
    .replace(/\b(Continue reading|Read more|Click here to read more)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return t;
}

/** Shorten at a word boundary. */
export function truncate(s, max) {
  if (!s || s.length <= max) return s || "";
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.-]+$/, "") + "…";
}

const TRACKING_PARAMS = /^(utm_|cmpid|cmp|ncid|ref|src|smid|partner|mod|taid|sr_share|ito|traffic_source|dicbo|fbclid|gclid|mc_cid|mc_eid|rss|feed|yptr)/i;

/** Canonical form of an article URL, used for de-duplication. */
export function canonicalUrl(raw) {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    }
    let out = u.toString();
    if (out.endsWith("/")) out = out.slice(0, -1);
    return out.replace(/^http:/, "https:");
  } catch {
    return raw.trim();
  }
}

export function hoursBetween(a, b) {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 36e5;
}

/** Run async tasks with a concurrency limit, preserving input order in the result. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
