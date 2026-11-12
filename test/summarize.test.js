import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addSummaries } from "../pipeline/summarize.js";

const settings = {
  ai: { model: "claude-opus-5-5", effort: "low", minSources: 3, maxPerRun: 5, concurrency: 2, regenerateAfterHours: 3 },
};

function story(id, sourceCount) {
  return {
    id,
    headline: "Original headline",
    headlineFrom: { kind: "selected", sourceId: "a" },
    sourceCount,
    summary: null,
    keyFacts: [],
    framing: null,
    disputed: [],
    ai: null,
    articles: [
      { sourceId: "a", sourceName: "Outlet A", lean: "left", title: "A headline", snippet: "A excerpt" },
      { sourceId: "b", sourceName: "Outlet B", lean: "center", title: "B headline", snippet: "B excerpt" },
      { sourceId: "c", sourceName: "Outlet C", lean: "right", title: "C headline", snippet: "C excerpt" },
    ],
  };
}

function fakeClient(calls) {
  return {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return {
            model: params.model,
            stop_reason: "end_turn",
            usage: { input_tokens: 500, output_tokens: 200 },
            content: [
              { type: "thinking", thinking: "" },
              {
                type: "text",
                text: JSON.stringify({
                  headline: "Neutral headline",
                  summary: "Something happened, officials said.",
                  keyFacts: ["Fact one", "Fact two"],
                  framing: { left: "Left emphasis.", center: "", right: "Right emphasis." },
                  disputed: [],
                }),
              },
            ],
          };
        },
      },
    },
  };
}

test("AI briefs: request shape, parsing, and caching", async () => {
  const cachePath = join(mkdtempSync(join(tmpdir(), "news-ai-")), "cache.json");
  const calls = [];
  const stories = [story("s_1", 5), story("s_2", 2)];

  const stats = await addSummaries(stories, settings, { client: fakeClient(calls), cachePath });
  assert.equal(stats.generated, 1, "only stories with enough outlets get a brief");
  assert.equal(calls.length, 1);

  const req = calls[0];
  assert.equal(req.model, "claude-opus-5-5");
  assert.equal(req.output_config.format.type, "json_schema");
  assert.equal(req.output_config.effort, "low");
  assert.ok(req.messages[0].content.includes('outlet="Outlet B" lean="center"'));

  const [s1, s2] = stories;
  assert.equal(s1.headline, "Neutral headline");
  assert.equal(s1.headlineFrom.kind, "ai");
  assert.deepEqual(s1.framing, { left: "Left emphasis.", center: null, right: "Right emphasis." });
  assert.equal(s1.ai.basedOnSources, 5);
  assert.equal(s2.ai, null);
  assert.ok(JSON.parse(readFileSync(cachePath, "utf8")).s_1);

  // Second run reuses the cache instead of calling the API again.
  const again = [story("s_1", 6)];
  const stats2 = await addSummaries(again, settings, { client: fakeClient(calls), cachePath });
  assert.equal(stats2.cached, 1);
  assert.equal(calls.length, 1);
  assert.equal(again[0].headline, "Neutral headline");
});
