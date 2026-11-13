// The site's own RSS feed (public/data/feed.xml), so friends can follow it in
// any news-reader app. One item per subject (the lead story of each group of
// related stories), in the site's own order, linking to the story page here,
// where every outlet's headline is listed.

const escapeXml = (s) =>
  String(s ?? "").replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);

/**
 * Where the site lives, for absolute links in the feed:
 * SITE_URL env > settings.siteUrl > GitHub Pages address in GitHub Actions > local dev server.
 */
export function resolveSiteUrl(settings = {}, env = process.env) {
  let url = env.SITE_URL || settings.siteUrl || "";
  if (!url && env.GITHUB_REPOSITORY) {
    const [owner, repo] = env.GITHUB_REPOSITORY.split("/");
    url = repo.toLowerCase() === `${owner.toLowerCase()}.github.io` ? `https://${owner}.github.io/` : `https://${owner}.github.io/${repo}/`;
  }
  if (!url) url = `http://localhost:${env.PORT || 8080}/`;
  return url.endsWith("/") ? url : `${url}/`;
}

function coverageLine(c, storyCount) {
  const across = storyCount > 1 ? ` across ${storyCount} related stories` : "";
  return `Covered by ${c.left + c.center + c.right} outlets${across}: ${c.left} left-leaning, ${c.center} center, ${c.right} right-leaning.`;
}

/** Build RSS 2.0 XML from the news.json object. */
export function buildFeed(news, { siteUrl, maxItems = 30 } = {}) {
  const seen = new Set();
  const items = [];
  for (const s of news.stories) {
    const key = s.familyId ?? s.id;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(s);
    if (items.length >= maxItems) break;
  }
  const link = (s) => `${siteUrl}#/story/${encodeURIComponent(s.id)}`;
  const body = items
    .map((s) => {
      const subject = s.subject ?? { coverage: s.coverage, storyCount: 1 };
      const text = [s.summary || s.snippet || "", coverageLine(subject.coverage, subject.storyCount)].filter(Boolean).join(" ");
      return `    <item>
      <title>${escapeXml(s.headline)}</title>
      <link>${escapeXml(link(s))}</link>
      <guid isPermaLink="false">${escapeXml(s.id)}</guid>
      <pubDate>${new Date(subject.lastUpdated ?? s.lastUpdated).toUTCString()}</pubDate>
      <category>${escapeXml(news.topics.find((t) => t.id === s.topic)?.label ?? s.topic)}</category>
      <description>${escapeXml(text)}</description>
    </item>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(news.site.name)}</title>
    <link>${escapeXml(siteUrl)}</link>
    <atom:link href="${escapeXml(`${siteUrl}data/feed.xml`)}" rel="self" type="application/rss+xml"/>
    <description>${escapeXml(news.site.tagline)}</description>
    <language>en-us</language>
    <lastBuildDate>${new Date(news.generatedAt).toUTCString()}</lastBuildDate>
    <ttl>15</ttl>
${body}
  </channel>
</rss>
`;
}
