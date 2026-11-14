import { canonicalUrl, cleanText, shortHash, truncate } from "./util.js";

// Feed excerpts sometimes start with a photo credit ("Jane Doe / Getty Images
// A tanker crashed...") or end with a broadcast sign-off ("Jane Doe reports.").
// Neither is part of the reporting, so they are trimmed. The same rule applies
// to every outlet.
const CREDIT_END = /(?:Getty Images|via REUTERS|via Reuters|via AP|\/Reuters|\/AP|\/AFP|\/Shutterstock)\s+/g;
const SIGN_OFF =
  /([.!?]["”’]?)\s+(?:(?:[A-Z][A-Za-z]+ News|DW)[’']?s?\s+)?(?:[A-Z][\w.'’-]*\s+){0,3}(?:and\s+(?:[A-Z][\w.'’-]*\s+){1,3})?(?:reports?|(?:has|have) more|(?:has|have) the (?:latest|details)|anchors? [^.]{3,60})\.\s*$/;

export function tidySnippet(text) {
  let t = String(text || "");
  CREDIT_END.lastIndex = 0;
  let cut = 0;
  let m;
  while ((m = CREDIT_END.exec(t)) && m.index < 110) {
    const lead = t.slice(0, m.index);
    if (/[.!?]\s/.test(lead)) break; // a real sentence comes first
    if (lead && !/\/|^Photo\b/.test(lead) && !/^via/.test(m[0])) break; // not shaped like a credit
    cut = m.index + m[0].length;
  }
  if (cut && /^["“‘']?[A-Z0-9]/.test(t.slice(cut))) t = t.slice(cut);
  return t.replace(SIGN_OFF, "$1").trim();
}

function pickImage(item) {
  const fromMedia = (arr) => {
    if (!Array.isArray(arr)) return null;
    for (const m of arr) {
      const url = m?.$?.url;
      const medium = m?.$?.medium;
      const type = m?.$?.type || "";
      if (url && (medium === "image" || type.startsWith("image") || /\.(jpe?g|png|webp)(\?|$)/i.test(url))) return url;
    }
    return null;
  };
  return (
    fromMedia(item.mediaContent) ||
    fromMedia(item.mediaThumbnail) ||
    fromMedia(item.mediaGroup?.["media:content"]) ||
    (item.enclosure?.url && /^image\//.test(item.enclosure.type || "image/") ? item.enclosure.url : null) ||
    null
  );
}

function stripSourceSuffix(title, sourceName) {
  // "Headline text - Source Name" / "Headline | Source Name"
  const escaped = sourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return title.replace(new RegExp(`\\s+[-|–—]\\s+${escaped}\\s*$`, "i"), "").trim();
}

function categoriesOf(item) {
  const cats = item.categories || [];
  return cats
    .map((c) => (typeof c === "string" ? c : c?._ || c?.$?.term || ""))
    .map((c) => cleanText(c))
    .filter(Boolean)
    .slice(0, 12);
}

/**
 * Turn a raw feed item into our article shape. Returns null if it is unusable
 * (no title/link) or outside the time window.
 */
export function normalizeItem(item, source, { now = new Date(), windowHours = 48 } = {}) {
  const link = item.link || item.guid;
  const rawTitle = cleanText(item.title);
  if (!link || !rawTitle || !/^https?:\/\//i.test(link)) return null;

  const url = canonicalUrl(link);
  const dateStr = item.isoDate || item.pubDate || item.dcDate;
  let published = dateStr ? new Date(dateStr) : null;
  if (!published || isNaN(published)) published = now; // undated items count as "just seen"
  if (published > now) published = now; // clock skew / future-dated items
  if ((now - published) / 36e5 > windowHours) return null;

  const snippetSource = item.contentSnippet || item.summary || item.content || item["content:encoded"] || "";
  const snippet = truncate(tidySnippet(cleanText(snippetSource)), 400);

  return {
    id: shortHash(url, 12),
    sourceId: source.id,
    title: stripSourceSuffix(rawTitle, source.name),
    url,
    published: published.toISOString(),
    snippet,
    image: pickImage(item),
    categories: categoriesOf(item),
  };
}
