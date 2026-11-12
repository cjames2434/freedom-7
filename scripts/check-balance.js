// Verifies both outlet rosters (news and opinion) mirror themselves left/right.
// Usage: npm run check:balance

import { checkBalance, hasKind, loadSources } from "../pipeline/sources.js";

const sources = loadSources();
const { ok, news, opinion, problems } = checkBalance(sources);
for (const [title, kind, counts] of [["News outlets", "news", news], ["Opinion outlets (Perspectives only)", "opinion", opinion]]) {
  console.log(`${title}:`);
  for (const [lean, n] of Object.entries(counts)) {
    const names = sources.filter((s) => s.lean === lean && hasKind(s, kind)).map((s) => s.name).join(", ");
    console.log(`  ${lean.padEnd(10)} ${String(n).padStart(2)}  ${names}`);
  }
  console.log("");
}
if (ok) console.log("Balanced.");
else {
  console.log(`Unbalanced: ${problems.join("; ")}`);
  process.exitCode = 1;
}
