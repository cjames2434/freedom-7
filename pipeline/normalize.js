import { canonicalUrl, cleanText, shortHash, truncate } from "./util.js";

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
  const snippet = truncate(cleanText(snippetSource), 400);

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
