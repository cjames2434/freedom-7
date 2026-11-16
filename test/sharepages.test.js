import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { notFoundPage, sharePage, writeSharePages } from "../pipeline/sharepages.js";

const SITE = { siteUrl: "https://example.github.io/freedom-7/", siteName: "Freedom 7" };
const story = (over = {}) => ({
  id: "s_abc123",
  headline: 'Senate passes "budget" bill <after> talks & votes',
  snippet: "The Senate voted 52-48 on Tuesday.",
  coverage: { left: 3, center: 2, right: 4 },
  image: "https://img.example.com/photo.jpg",
  ...over,
});

test("a share page previews the story and sends readers on to it", () => {
  const html = sharePage(story(), SITE);
  // Feed text is escaped everywhere it appears.
  assert.ok(html.includes('content="Senate passes &quot;budget&quot; bill &lt;after&gt; talks &amp; votes"'));
  assert.ok(!html.includes("<after>"));
  assert.ok(html.includes("Covered by 9 outlets: 3 left-leaning, 2 center, 4 right-leaning. The Senate voted 52-48 on Tuesday."));
  assert.ok(html.includes('<meta property="og:image" content="https://img.example.com/photo.jpg">'));
  assert.ok(html.includes('<meta http-equiv="refresh" content="0; url=../#/story/s_abc123">'));
  assert.ok(html.includes('<meta name="robots" content="noindex, nofollow">'));
  // No publisher image (or not https): the site's own icon.
  assert.ok(sharePage(story({ image: "http://img.example.com/x.jpg" }), SITE).includes(`content="${SITE.siteUrl}icons/icon-512.png"`));
  assert.ok(sharePage(story({ image: null }), SITE).includes(`content="${SITE.siteUrl}icons/icon-512.png"`));
});

test("the 404 page sends old story links to the story view, and anything else home", () => {
  const html = notFoundPage(SITE);
  assert.ok(html.includes('var base = "/freedom-7/";'));
  assert.ok(html.includes('"#/story/" + m[1]'));
  assert.ok(notFoundPage({ siteUrl: "https://example.github.io/", siteName: "X" }).includes('var base = "/";'));
});

test("writeSharePages replaces the old pages and skips ids that aren't safe file names", () => {
  const dir = mkdtempSync(join(tmpdir(), "share-"));
  try {
    mkdirSync(join(dir, "s"));
    writeFileSync(join(dir, "s", "s_old.html"), "old");
    const written = writeSharePages([story(), story({ id: "s_def_2" }), story({ id: "../evil" })], { outDir: dir, ...SITE });
    assert.equal(written, 2);
    assert.deepEqual(readdirSync(join(dir, "s")).sort(), ["s_abc123.html", "s_def_2.html"]);
    assert.ok(readFileSync(join(dir, "404.html"), "utf8").includes("location.replace"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
