// Tiny zero-dependency static server for local development.
// Usage: npm run dev   (then open http://localhost:8080)
//
// Visiting the page (or the page checking data/news.json) starts a background
// news build when the data is stale; see scripts/refresh.js.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { createRefresher } from "./refresh.js";

const refresher = createRefresher();
const VISIT_PATHS = new Set(["/", "/index.html", "/data/news.json"]);

const ROOT = resolve("public");
const PORT = Number(process.env.PORT || 8080);
// Only this PC can reach the preview. Set HOST=0.0.0.0 to open it to other
// devices on your network (for example to try it on a phone).
const HOST = process.env.HOST || "127.0.0.1";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/rss+xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    // Never awaited: the visitor gets the current files straight away.
    if (VISIT_PATHS.has(urlPath)) refresher.onVisit().catch(() => {});
    let file = normalize(join(ROOT, urlPath));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
}).listen(PORT, HOST, () => {
  console.log(`Serving ./public at http://localhost:${PORT}  (Ctrl+C to stop)`);
  console.log(
    refresher.enabled
      ? `News refreshes when someone visits and it's over ${Number(process.env.REFRESH_MINUTES ?? 15)} minutes old (REFRESH_MINUTES=0 turns this off)`
      : "Refresh on visit is off"
  );
});
