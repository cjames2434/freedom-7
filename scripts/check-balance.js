// Verifies the outlet roster mirrors itself left/right.
// Usage: npm run check:balance

import { checkBalance, loadSources } from "../pipeline/sources.js";

const sources = loadSources();
const { ok, counts, problems } = checkBalance(sources);
console.log("Outlets per lean:");
for (const [lean, n] of Object.entries(counts)) {
  const names = sources.filter((s) => s.lean === lean).map((s) => s.name).join(", ");
  console.log(`  ${lean.padEnd(10)} ${String(n).padStart(2)}  ${names}`);
}
if (ok) console.log("\nBalanced.");
else {
  console.log(`\nUnbalanced: ${problems.join("; ")}`);
  process.exitCode = 1;
}
