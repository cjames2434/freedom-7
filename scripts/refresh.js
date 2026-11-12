// Refresh-on-visit for the local server.
//
// When someone loads the site and the news is older than `maxAgeMinutes`, a
// fresh build starts in the background. The visitor gets the current news
// straight away (no waiting), and the page picks up the new batch a few
// seconds later when it next checks. Only one build runs at a time, and a
// failed build (say, the internet is down) isn't retried for a few minutes.
//
// Used by scripts/serve.js. Set REFRESH_MINUTES=0 to turn it off.

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

// pipeline/index.js exits with this when another build (another server, or a
// manual `npm run build`) already holds data/.build.lock.
const EXIT_BUSY = 75;

function runPipeline(cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["pipeline/index.js"], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("error", (err) => resolve({ ok: false, output: err.message }));
    child.on("close", (code) => resolve({ ok: code === 0, busy: code === EXIT_BUSY, output }));
  });
}

/**
 * @param {object} [opts]
 * @param {number} [opts.maxAgeMinutes] rebuild when the data is older than this (0 = never)
 * @param {number} [opts.retryAfterMinutes] wait this long after a failed build before trying again
 * @param {string} [opts.dataFile] the file whose age decides freshness
 * @param {() => Promise<{ok: boolean, output: string}>} [opts.build] injectable for tests
 * @param {(msg: string) => void} [opts.log]
 */
export function createRefresher({
  maxAgeMinutes = Number(process.env.REFRESH_MINUTES ?? 15),
  retryAfterMinutes = 5,
  dataFile = "public/data/news.json",
  build = () => runPipeline(process.cwd()),
  log = (msg) => console.log(msg),
} = {}) {
  let running = null;
  let lastFailure = 0;

  async function ageMinutes() {
    try {
      return (Date.now() - (await stat(dataFile)).mtimeMs) / 60000;
    } catch {
      return Infinity; // no data yet
    }
  }

  function refreshNow(reason = "requested") {
    if (running) return running;
    const started = Date.now();
    log(`[refresh] fetching fresh news (${reason})...`);
    running = build().then(({ ok, busy, output }) => {
      running = null;
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      if (busy) {
        // Not a failure: someone else's build is already fetching the news.
        log("[refresh] another build is already running; skipped this one");
        return false;
      }
      if (ok) {
        lastFailure = 0;
        log(`[refresh] news updated in ${secs}s`);
      } else {
        lastFailure = Date.now();
        const tail = String(output).trim().split("\n").slice(-2).join(" | ");
        log(`[refresh] update failed after ${secs}s; keeping the previous news. ${tail}`);
      }
      return ok;
    });
    return running;
  }

  return {
    enabled: maxAgeMinutes > 0,

    /**
     * Call when a visitor loads the page or its data. Never blocks the
     * response: it only starts a background build when the news is stale.
     * Resolves to true when it started one (useful for tests).
     */
    async onVisit() {
      if (!(maxAgeMinutes > 0) || running) return false;
      if (lastFailure && Date.now() - lastFailure < retryAfterMinutes * 60000) return false;
      const age = await ageMinutes();
      if (age < maxAgeMinutes) return false;
      if (running) return false; // another visit started one while we checked
      refreshNow(Number.isFinite(age) ? `news was ${Math.round(age)} min old` : "no news yet");
      return true;
    },

    refreshNow,
    isRefreshing: () => Boolean(running),
    whenIdle: () => running ?? Promise.resolve(true),
  };
}
