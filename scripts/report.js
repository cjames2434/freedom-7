// Prints the latest balance report (from the last `npm run build`) in plain
// words, with the daily trend. Usage: npm run report

import { existsSync, readFileSync } from "node:fs";

const path = "public/data/balance.json";
if (!existsSync(path)) {
  console.log("No balance report yet. Run `npm run build` first.");
  process.exit(1);
}
const { today: t, history } = JSON.parse(readFileSync(path, "utf8"));
const hp = t.headlinePicks;
const L = hp.left + hp["lean-left"];
const R = hp.right + hp["lean-right"];
const share = (a, b) => (a + b ? `${Math.round((a / (a + b)) * 100)}% / ${Math.round((b / (a + b)) * 100)}%` : "n/a");

console.log(`Balance report, ${t.date} (${t.stories} stories in the window)\n`);
console.log("Whose headline is shown on each story");
console.log(`  left-leaning ${L}  ·  center ${hp.center}  ·  right-leaning ${R}${hp.ai ? `  ·  AI-written ${hp.ai}` : ""}`);
console.log(`  left vs right share: ${share(L, R)}\n`);
console.log("How often each side's outlets appear in stories");
console.log(`  left ${t.coverage.left}  ·  center ${t.coverage.center}  ·  right ${t.coverage.right}   (left vs right ${share(t.coverage.left, t.coverage.right)})\n`);
console.log("Who covered what");
console.log(`  both sides ${t.storiesCovered.bothSides}  ·  left only ${t.storiesCovered.leftOnly}  ·  right only ${t.storiesCovered.rightOnly}  ·  center only ${t.storiesCovered.centerOnly}`);
console.log(`  blindspots: mostly covered by the left ${t.blindspots.left}, mostly by the right ${t.blindspots.right}\n`);
console.log("On stories both sides covered, who published first (ties within 30 min)");
console.log(`  left first ${t.firstToCover.left}  ·  right first ${t.firstToCover.right}  ·  about the same time ${t.firstToCover.tie}\n`);
console.log("Perspectives (opinion, always paired)");
console.log(`  ${t.perspectives.subjects} subjects  ·  pieces: left ${t.perspectives.left}, center ${t.perspectives.center}, right ${t.perspectives.right}\n`);

if (history.length > 1) {
  console.log("Daily trend (headlines shown, left / right)");
  for (const d of history.slice(-14)) {
    const l = d.headlinePicks.left + d.headlinePicks["lean-left"];
    const r = d.headlinePicks.right + d.headlinePicks["lean-right"];
    console.log(`  ${d.date}  ${String(l).padStart(3)} / ${String(r).padEnd(3)}  ${share(l, r)}${d.warnings.length ? "  (warnings)" : ""}`);
  }
  console.log("");
}

if (t.warnings.length) {
  console.log("Worth a look:");
  for (const w of t.warnings) console.log(`  - ${w}`);
} else {
  console.log("Nothing lopsided enough to flag today.");
}
