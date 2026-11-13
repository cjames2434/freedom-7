// Balance report: is the site itself staying even-handed?
//
// Every build measures, over the current window:
//   - whose headline gets shown (by the outlet's lean), and how many are AI-written
//   - how often each side's outlets appear in stories
//   - how many stories each side covers alone, and blindspots by side
//   - for stories both sides covered, which side published first
//   - Perspectives pieces per side (equal by construction; checked anyway)
// It keeps one snapshot per day for 30 days (data/balance-history.json) and
// publishes public/data/balance.json. Warnings flag drift worth a look, e.g.
// one side's headlines being shown far more than the other's.
//
// These are descriptive counts, not verdicts on any outlet. They depend on the
// roster and on what happened in the news that day.

import { existsSync, readFileSync } from "node:fs";

const TIE_MINUTES = 30;

const pct = (a, b) => (a + b === 0 ? 0.5 : a / (a + b));

/** Build today's report from the final stories (after AI briefs and Perspectives). */
export function balanceReport(stories, { perspectiveLeads = [], now = new Date() } = {}) {
  const headlinePicks = { left: 0, "lean-left": 0, center: 0, "lean-right": 0, right: 0, ai: 0 };
  const coverage = { left: 0, center: 0, right: 0 };
  const storiesCovered = { bothSides: 0, leftOnly: 0, rightOnly: 0, centerOnly: 0 };
  const blindspots = { left: 0, right: 0 };
  const firstToCover = { left: 0, right: 0, tie: 0 };

  for (const s of stories) {
    if (s.headlineFrom?.kind === "ai") headlinePicks.ai++;
    else {
      const a = s.articles.find((x) => x.sourceId === s.headlineFrom?.sourceId);
      if (a) headlinePicks[a.lean]++;
    }
    for (const g of ["left", "center", "right"]) coverage[g] += s.coverage[g];
    const { left, center, right } = s.coverage;
    if (left && right) storiesCovered.bothSides++;
    else if (left) storiesCovered.leftOnly++;
    else if (right) storiesCovered.rightOnly++;
    else if (center) storiesCovered.centerOnly++;
    if (s.mostlyCoveredBy) blindspots[s.mostlyCoveredBy]++;

    const fl = s.firstBySide?.left ? Date.parse(s.firstBySide.left) : null;
    const fr = s.firstBySide?.right ? Date.parse(s.firstBySide.right) : null;
    if (fl && fr) {
      const gapMin = (fr - fl) / 60000;
      if (Math.abs(gapMin) <= TIE_MINUTES) firstToCover.tie++;
      else firstToCover[gapMin > 0 ? "left" : "right"]++;
    }
  }

  const seen = new Set();
  const perspectives = { subjects: 0, left: 0, center: 0, right: 0 };
  for (const s of stories) {
    if (!s.perspectives || seen.has(s.familyId ?? s.id) || !perspectiveLeads.includes(s.id)) continue;
    seen.add(s.familyId ?? s.id);
    perspectives.subjects++;
    for (const g of ["left", "center", "right"]) perspectives[g] += s.perspectives[g].length;
  }

  const report = {
    date: now.toISOString().slice(0, 10),
    generatedAt: now.toISOString(),
    stories: stories.length,
    headlinePicks,
    coverage,
    storiesCovered,
    blindspots,
    firstToCover,
    perspectives,
  };
  report.warnings = balanceWarnings(report);
  return report;
}

/**
 * Plain-language notes when something looks lopsided. Thresholds are loose on
 * purpose: day-to-day news is uneven, and these are prompts to look, not alarms.
 */
export function balanceWarnings(r) {
  const out = [];
  const hl = r.headlinePicks;
  const leftPicks = hl.left + hl["lean-left"];
  const rightPicks = hl.right + hl["lean-right"];
  if (leftPicks + rightPicks >= 10) {
    const share = pct(leftPicks, rightPicks);
    if (share > 0.65 || share < 0.35) {
      const [more, fewer, a, b] = share > 0.5 ? ["left", "right", leftPicks, rightPicks] : ["right", "left", rightPicks, leftPicks];
      out.push(`Shown headlines came from ${more}-leaning outlets ${a} times vs ${b} from ${fewer}-leaning ones.`);
    }
  }
  const cov = r.coverage;
  if (cov.left + cov.right >= 20) {
    const share = pct(cov.left, cov.right);
    if (share > 0.62 || share < 0.38) {
      const more = share > 0.5 ? "Left" : "Right";
      out.push(`${more}-leaning outlets account for ${Math.round(Math.max(share, 1 - share) * 100)}% of partisan coverage; check for outlets whose feeds are down or thin.`);
    }
  }
  const bs = r.blindspots;
  if (bs.left + bs.right >= 6 && (bs.left >= 3 * Math.max(1, bs.right) || bs.right >= 3 * Math.max(1, bs.left))) {
    out.push(`Blindspots are lopsided today: ${bs.left} covered mostly by the left, ${bs.right} mostly by the right.`);
  }
  const p = r.perspectives;
  if (p.left !== p.right) out.push(`Perspectives pieces are uneven (${p.left} left, ${p.right} right); this should never happen.`);
  return out;
}

/** Merge today's report into the rolling daily history (one entry per date, newest last). */
export function updateHistory(historyPath, report, { keepDays = 30 } = {}) {
  let days = [];
  if (existsSync(historyPath)) {
    try {
      days = JSON.parse(readFileSync(historyPath, "utf8")).days || [];
    } catch {
      days = [];
    }
  }
  days = days.filter((d) => d.date !== report.date);
  days.push(report);
  days.sort((a, b) => a.date.localeCompare(b.date));
  return days.slice(-keepDays);
}
