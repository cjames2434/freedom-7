import { readFileSync } from "node:fs";
import { LEANS } from "./util.js";

export function loadSources(path = "config/sources.json") {
  const { sources } = JSON.parse(readFileSync(path, "utf8"));
  const ids = new Set();
  for (const s of sources) {
    if (!s.id || !s.name || !Array.isArray(s.feeds) || !s.feeds.length) {
      throw new Error(`Source entry is missing id, name or feeds: ${JSON.stringify(s)}`);
    }
    if (!LEANS.includes(s.lean)) throw new Error(`Source "${s.id}" has unknown lean "${s.lean}". Use one of: ${LEANS.join(", ")}`);
    if (ids.has(s.id)) throw new Error(`Duplicate source id "${s.id}"`);
    ids.add(s.id);
  }
  return sources;
}

/**
 * The roster must mirror itself: as many left as right outlets, and as many
 * lean-left as lean-right. Otherwise coverage counts and blindspots would
 * tilt toward whichever side has more outlets.
 */
export function checkBalance(sources) {
  const counts = Object.fromEntries(LEANS.map((l) => [l, 0]));
  for (const s of sources) counts[s.lean]++;
  const problems = [];
  if (counts.left !== counts.right) problems.push(`left (${counts.left}) and right (${counts.right}) differ`);
  if (counts["lean-left"] !== counts["lean-right"])
    problems.push(`lean-left (${counts["lean-left"]}) and lean-right (${counts["lean-right"]}) differ`);
  return { ok: problems.length === 0, counts, problems };
}
