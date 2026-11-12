import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRefresher } from "../scripts/refresh.js";

function setup({ ageMinutes, buildOk = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "news-refresh-"));
  const dataFile = join(dir, "news.json");
  if (ageMinutes !== undefined) {
    writeFileSync(dataFile, "{}");
    const t = new Date(Date.now() - ageMinutes * 60000);
    utimesSync(dataFile, t, t);
  }
  const calls = { builds: 0 };
  let release;
  const gate = new Promise((r) => (release = r));
  const refresher = createRefresher({
    maxAgeMinutes: 15,
    dataFile,
    log: () => {},
    build: async () => {
      calls.builds++;
      await gate;
      return { ok: buildOk, output: buildOk ? "" : "Build stopped: offline" };
    },
  });
  return { refresher, calls, release };
}

test("fresh news: a visit does not trigger a build", async () => {
  const { refresher, calls } = setup({ ageMinutes: 5 });
  assert.equal(await refresher.onVisit(), false);
  assert.equal(calls.builds, 0);
});

test("stale news: a visit starts one background build, without waiting for it", async () => {
  const { refresher, calls, release } = setup({ ageMinutes: 20 });
  assert.equal(await refresher.onVisit(), true); // resolves while the build is still running
  assert.equal(refresher.isRefreshing(), true);
  // Many visitors at once still means one build.
  await Promise.all([refresher.onVisit(), refresher.onVisit(), refresher.onVisit()]);
  assert.equal(calls.builds, 1);
  release();
  assert.equal(await refresher.whenIdle(), true);
  assert.equal(refresher.isRefreshing(), false);
});

test("no data yet: the first visit builds", async () => {
  const { refresher, calls, release } = setup();
  assert.equal(await refresher.onVisit(), true);
  release();
  await refresher.whenIdle();
  assert.equal(calls.builds, 1);
});

test("a failed build is not retried on every visit", async () => {
  const { refresher, calls, release } = setup({ ageMinutes: 30, buildOk: false });
  release();
  await refresher.onVisit();
  assert.equal(await refresher.whenIdle(), false);
  assert.equal(await refresher.onVisit(), false, "backs off after a failure");
  assert.equal(calls.builds, 1);
});

test("REFRESH_MINUTES=0 turns it off", async () => {
  const r = createRefresher({ maxAgeMinutes: 0, dataFile: "nope.json", build: async () => assert.fail("should not build") });
  assert.equal(r.enabled, false);
  assert.equal(await r.onVisit(), false);
});

test("a build skipped because another is running doesn't trigger the failure back-off", async () => {
  const dir = mkdtempSync(join(tmpdir(), "news-refresh-"));
  const dataFile = join(dir, "news.json");
  writeFileSync(dataFile, "{}");
  const old = new Date(Date.now() - 30 * 60000);
  utimesSync(dataFile, old, old);
  let builds = 0;
  const r = createRefresher({ maxAgeMinutes: 15, dataFile, log: () => {}, build: async () => (builds++, { ok: false, busy: true, output: "" }) });
  await r.onVisit();
  await r.whenIdle();
  assert.equal(await r.onVisit(), true, "can try again right away");
  await r.whenIdle();
  assert.equal(builds, 2);
});
