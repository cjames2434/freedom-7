import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { balanceReport, balanceWarnings, updateHistory } from "../pipeline/balance.js";

const h = (hoursAgo) => new Date(Date.now() - hoursAgo * 36e5).toISOString();
function story(id, { pickLean, coverage, firstLeft, firstRight, blind = null }) {
  return {
    id,
    familyId: id,
    headlineFrom: { kind: "selected", sourceId: "pick" },
    articles: [{ sourceId: "pick", lean: pickLean }],
    coverage,
    mostlyCoveredBy: blind,
    firstBySide: { left: firstLeft ?? null, center: null, right: firstRight ?? null },
    perspectives: null,
  };
}

test("balance report counts picks, coverage, blindspots and who covered first", () => {
  const stories = [
    story("a", { pickLean: "lean-left", coverage: { left: 3, center: 1, right: 2 }, firstLeft: h(5), firstRight: h(2) }),
    story("b", { pickLean: "right", coverage: { left: 1, center: 0, right: 3 }, firstLeft: h(1), firstRight: h(4) }),
    story("c", { pickLean: "center", coverage: { left: 2, center: 2, right: 2 }, firstLeft: h(3), firstRight: h(3.2) }),
    story("d", { pickLean: "left", coverage: { left: 4, center: 0, right: 0 }, firstLeft: h(1), blind: "left" }),
  ];
  const r = balanceReport(stories);
  assert.deepEqual(r.headlinePicks, { left: 1, "lean-left": 1, center: 1, "lean-right": 0, right: 1, ai: 0 });
  assert.deepEqual(r.coverage, { left: 10, center: 3, right: 7 });
  assert.deepEqual(r.storiesCovered, { bothSides: 3, leftOnly: 1, rightOnly: 0, centerOnly: 0 });
  assert.deepEqual(r.blindspots, { left: 1, right: 0 });
  assert.deepEqual(r.firstToCover, { left: 1, right: 1, tie: 1 });
});

test("warnings flag lopsided headline picks, symmetric for either side", () => {
  const base = { coverage: { left: 10, center: 5, right: 10 }, blindspots: { left: 1, right: 1 }, perspectives: { left: 2, right: 2 } };
  const leftHeavy = balanceWarnings({ ...base, headlinePicks: { left: 5, "lean-left": 10, center: 20, "lean-right": 3, right: 1, ai: 0 } });
  const rightHeavy = balanceWarnings({ ...base, headlinePicks: { left: 1, "lean-left": 3, center: 20, "lean-right": 10, right: 5, ai: 0 } });
  const even = balanceWarnings({ ...base, headlinePicks: { left: 2, "lean-left": 10, center: 20, "lean-right": 9, right: 3, ai: 0 } });
  assert.match(leftHeavy.join(" "), /left-leaning outlets 15 times vs 4/);
  assert.match(rightHeavy.join(" "), /right-leaning outlets 15 times vs 4/);
  assert.deepEqual(even, []);
});

test("daily history keeps one entry per date, newest last, capped", () => {
  const dir = mkdtempSync(join(tmpdir(), "news-balance-"));
  const path = join(dir, "h.json");
  writeFileSync(path, JSON.stringify({ days: [{ date: "2026-11-01" }, { date: "2026-11-02", old: true }] }));
  const days = updateHistory(path, { date: "2026-11-02", old: false }, { keepDays: 2 });
  assert.deepEqual(days, [{ date: "2026-11-01" }, { date: "2026-11-02", old: false }]);
  assert.equal(updateHistory(path, { date: "2026-11-03" }, { keepDays: 2 }).length, 2);
});
