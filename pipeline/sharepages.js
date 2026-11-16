// Share pages: one tiny static page per story, so a link shared in a
// messaging app shows the story's headline and coverage instead of just the
// site name. Link previews come from Open Graph tags, and the apps that read
// them never run the site's JavaScript (which is what turns #/story/<id> into
// a story page), so each story needs a real page of its own.
//
// Each page sends people straight on to the story. A 404 page catches links
// to stories that have since rolled off and opens the site's own "this story
// has rolled off" view, so old links never dead-end.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { truncate } from "./util.js";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

const escHtml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

function coverageLine(c) {
  const total = c.left + c.center + c.right;
  return `Covered by ${total} outlet${total === 1 ? "" : "s"}: ${c.left} left-leaning, ${c.center} center, ${c.right} right-leaning.`;
}

/** The HTML for one story's share page. */
export function sharePage(story, { siteUrl, siteName }) {
  const target = `../#/story/${story.id}`;
  const description = [coverageLine(story.coverage), truncate(story.snippet || "", 200)].filter(Boolean).join(" ");
  const image = /^https:\/\//i.test(story.image || "") ? story.image : `${siteUrl}icons/icon-512.png`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(story.headline)} · ${escHtml(siteName)}</title>
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="description" content="${escHtml(description)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${escHtml(siteName)}">
<meta property="og:title" content="${escHtml(story.headline)}">
<meta property="og:description" content="${escHtml(description)}">
<meta property="og:image" content="${escHtml(image)}">
<meta property="og:url" content="${escHtml(`${siteUrl}s/${story.id}.html`)}">
<meta name="twitter:card" content="summary">
<link rel="canonical" href="${escHtml(`${siteUrl}#/story/${story.id}`)}">
<meta http-equiv="refresh" content="0; url=${escHtml(target)}">
<style>body{margin:0;padding:32px 20px;font:17px/1.5 system-ui,sans-serif;background:#0B1630;color:#EEF1F6}a{color:#EEF1F6}</style>
</head>
<body>
<p><a href="${escHtml(target)}">Open this story on ${escHtml(siteName)}</a></p>
</body>
</html>
`;
}

/** GitHub Pages serves 404.html for any missing address: send it to the right place in the site. */
export function notFoundPage({ siteUrl, siteName }) {
  const base = new URL(siteUrl).pathname;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(siteName)}</title>
<meta name="robots" content="noindex, nofollow">
<script>
(function () {
  var base = ${JSON.stringify(base)};
  var m = location.pathname.match(/\\/s\\/([A-Za-z0-9_-]+)\\.html$/);
  location.replace(base + (m ? "#/story/" + m[1] : "#/"));
})();
</script>
<style>body{margin:0;padding:32px 20px;font:17px/1.5 system-ui,sans-serif;background:#0B1630;color:#EEF1F6}a{color:#EEF1F6}</style>
</head>
<body>
<p><a href="${escHtml(base)}">Go to ${escHtml(siteName)}</a></p>
</body>
</html>
`;
}

/** Write public/s/<id>.html for every story, and public/404.html. Old pages are cleared first. */
export function writeSharePages(stories, { outDir = "public", siteUrl, siteName }) {
  const dir = `${outDir}/s`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let written = 0;
  for (const story of stories) {
    if (!SAFE_ID.test(story.id)) continue;
    writeFileSync(`${dir}/${story.id}.html`, sharePage(story, { siteUrl, siteName }));
    written++;
  }
  writeFileSync(`${outDir}/404.html`, notFoundPage({ siteUrl, siteName }));
  return written;
}
