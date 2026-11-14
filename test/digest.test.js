import test from "node:test";
import assert from "node:assert/strict";
import { buildDigest, splitSentences, stripDateline, usableSentences } from "../pipeline/digest.js";

const item = (sourceId, lean, snippet, title = "Agency grounds flights nationwide") => ({
  article: { sourceId, title, snippet, url: `https://example.com/${sourceId}` },
  lean,
  source: { name: sourceId.toUpperCase() },
});

test("sentences split on real endings, not abbreviations or decimals", () => {
  assert.deepEqual(splitSentences("The FAA halted flights at all U.S. airports on Friday. Sen. Jane Doe, D-Md., asked for a review."), [
    "The FAA halted flights at all U.S. airports on Friday.",
    "Sen. Jane Doe, D-Md., asked for a review.",
  ]);
  assert.deepEqual(splitSentences("Prices rose 3.5 percent in October. Economists expected less."), [
    "Prices rose 3.5 percent in October.",
    "Economists expected less.",
  ]);
});

test("datelines are removed", () => {
  assert.equal(stripDateline("(The Center Square) – All flights were grounded."), "All flights were grounded.");
  assert.equal(stripDateline("WASHINGTON (AP) — All flights were grounded."), "All flights were grounded.");
});

test("cut-off, promotional and question sentences are not used", () => {
  const out = usableSentences(
    "The Federal Aviation Administration grounded every departing flight in the country on Friday afternoon. " +
      "What does it mean for travelers who are already at the airport this weekend? " +
      "Our correspondent has more on the delays and what airlines are telling passengers tonight. " +
      "Officials said the outage began shortly after a planned software update and that technicians were still…"
  );
  assert.deepEqual(out, ["The Federal Aviation Administration grounded every departing flight in the country on Friday afternoon."]);
});

test("an excerpt that only repeats the headline adds nothing", () => {
  const title = "Agency Grounds All Departing Flights Nationwide After Communications Outage Hits Centers.";
  assert.deepEqual(usableSentences(title, title), []);
});

// Like real coverage, every outlet mentions the shared subject (the agency grounding flights nationwide).
const LEFT_A = "Airlines canceled more than 1,200 flights nationwide by early evening after the agency grounded departures, FlightAware data showed.";
const LEFT_B = "Union leaders for controllers said staffing shortages at the agency left little margin when flights were grounded nationwide.";
const RIGHT_A = "The agency said backup radio systems at 22 regional centers failed to switch on, forcing it to ground flights nationwide.";
const RIGHT_B = "Republican lawmakers scheduled a Tuesday hearing to question agency managers about why flights were grounded nationwide.";
const CENTER_A = "Flights already airborne were allowed to land while the agency kept departures grounded nationwide, and international arrivals continued.";

test("both sides covered it: the same number of sentences from each, one per outlet", () => {
  const items = [
    item("l1", "lean-left", LEFT_A),
    item("l2", "left", LEFT_B),
    item("c1", "center", CENTER_A),
    item("r1", "lean-right", RIGHT_A),
    item("r2", "right", "Agency grounds flights nationwide"), // nothing usable
  ];
  for (const seed of ["a", "b", "c", "d"]) {
    const d = buildDigest(items, { seed });
    const count = (side) => d.filter((x) => x.lean.includes(side)).length;
    assert.equal(count("left"), 1, "left is trimmed to match the right");
    assert.equal(count("right"), 1);
    assert.equal(new Set(d.map((x) => x.sourceId)).size, d.length);
  }
});

test("swapping left and right gives the mirror image", () => {
  const leans = { left: "right", "lean-left": "lean-right", center: "center", "lean-right": "lean-left", right: "left" };
  const items = [
    item("a", "lean-left", LEFT_A),
    item("b", "left", LEFT_B),
    item("c", "center", CENTER_A),
    item("d", "lean-right", RIGHT_A),
    item("e", "right", RIGHT_B),
  ];
  const mirrored = items.map((it) => ({ ...it, lean: leans[it.lean] }));
  const sides = (d) => d.map((x) => (x.lean.includes("left") ? "L" : x.lean.includes("right") ? "R" : "C")).join("");
  const d1 = buildDigest(items, { seed: "x" });
  const d2 = buildDigest(mirrored, { seed: "x" });
  assert.equal(sides(d1), "LCRLR");
  assert.equal(sides(d2), "LCRLR");
  assert.equal(d1.filter((x) => x.lean.includes("left")).length, d2.filter((x) => x.lean.includes("right")).length);
});

test("listed Left, Center, Right, and never repeats what the page already says", () => {
  const items = [item("r1", "right", RIGHT_A), item("c1", "center", CENTER_A), item("l1", "left", LEFT_A)];
  const d = buildDigest(items, { seed: "s" });
  assert.deepEqual(d.map((x) => x.sourceId), ["l1", "c1", "r1"]);
  assert.equal(d[0].text, LEFT_A);
  const again = buildDigest(items, { seed: "s", shown: [LEFT_A, CENTER_A, RIGHT_A] });
  assert.deepEqual(again, []);
});

test("two outlets running the same wire sentence are quoted once", () => {
  const items = [item("c1", "center", CENTER_A), item("c2", "center", CENTER_A)];
  assert.equal(buildDigest(items, { seed: "s" }).length, 1);
});

test("the digest can quote from an article's opening paragraphs when the feed carries them", () => {
  const mk = (sourceId, lean, title, snippet, lead) => ({
    article: { sourceId, title, snippet, lead, url: `https://e.com/${sourceId}` },
    lean,
    source: { name: sourceId.toUpperCase() },
  });
  const items = [
    mk("l1", "lean-left", "City council approves the downtown transit budget", "Short dek.", "The city council approved a 40 million dollar downtown transit budget on Tuesday after a six hour meeting."),
    mk("r1", "lean-right", "Council passes downtown transit budget after long meeting", "Another dek.", "The city council passed the downtown transit budget 7 to 2, with two members objecting to its cost."),
    mk("c1", "center", "Downtown transit budget wins city council approval", "", ""),
  ];
  const d = buildDigest(items, { seed: "s" });
  assert.deepEqual(d.map((x) => x.sourceId).sort(), ["l1", "r1"]);
  assert.ok(d.every((x) => /transit budget/.test(x.text)));
});
