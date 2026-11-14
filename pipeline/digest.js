// "What's being reported": a few sentences quoted from the outlets' own feed
// excerpts, so a story page says more than one headline and one blurb.
//
// No AI and no rewriting. Each sentence is an outlet's own words, shown with
// its name and a link. The picking is mechanical:
//   - split every outlet's excerpt into sentences and drop the unusable ones
//     (cut off, promotional, questions, no context, too short or too long)
//   - prefer sentences that add facts not already on the page, especially
//     figures, and that use plain wording (the same word lists that pick the
//     headline, which are side-neutral)
//   - never repeat what another picked sentence already says
//
// Neutrality rules:
//   - at most one sentence per outlet
//   - when both the left and the right covered the story, they get the same
//     number of sentences (extras are dropped, as with Perspectives)
//   - sides take turns picking, and which side picks first alternates from
//     story to story, so neither always gets the freshest facts
//   - the result is listed Left, Center, Right, in that order

import { tokenize } from "./cluster.js";
import { analyzeHeadline } from "./language.js";
import { leanDistance, leanGroup } from "./util.js";

const SIDES = ["left", "center", "right"];
const MIN_LEN = 60;
const MAX_LEN = 300;

// A full stop after one of these does not end a sentence.
const ABBREVIATIONS = new Set(
  `mr mrs ms dr prof sen sens rep reps gov govs pres gen lt col sgt capt cmdr adm rev hon st jr sr inc corp co ltd bros
  no vs etc jan feb mar apr jun jul aug sep sept oct nov dec mon tue tues wed thu thur thurs fri sat sun ave blvd rd mt ft
  u.s u.k u.n e.u d.c a.m p.m`.split(/\s+/)
);

// Sentences that point at the article instead of saying something.
const PROMO =
  /\b(has more|have more|has the latest|have the latest|joins? .{0,60}to discuss|read more|sign up|subscribe|newsletter|click here|watch (the|live|here|this)|listen (to|here)|tune in|follow (us|live)|this is a developing story|check back|here'?s what (to|you|we) know|what (to|you need to) know|see (the|more) (photos|video)|special report)\b/i;

// Openers that lean on a sentence we may not be showing.
const NEEDS_CONTEXT = /^(he|she|they|it|that|this|these|those|but|and|or|so|however|meanwhile|still|also|instead|both|neither|such|there|then|his|her|their|its)\b/i;

function endsWithAbbreviation(piece) {
  const m = piece.match(/([A-Za-z][A-Za-z.-]*)\.["'”’)\]]*$/);
  if (!m) return false;
  const word = m[1];
  if (ABBREVIATIONS.has(word.toLowerCase())) return true;
  if (/^[A-Z]$/.test(word)) return true; // an initial: "John F. Kennedy"
  if (/^(?:[A-Za-z]\.)+[A-Za-z]$/.test(word)) return true; // U.S, N.Y
  if (/^[A-Z]-[A-Z][A-Za-z.]{0,4}$/.test(word)) return true; // D-Md, R-N.Y
  return false;
}

/** Split text into sentences, keeping abbreviations and decimals whole. */
export function splitSentences(text) {
  const pieces = String(text || "").match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/g) || [];
  const out = [];
  let carry = "";
  for (let i = 0; i < pieces.length; i++) {
    const piece = carry + pieces[i];
    const next = pieces[i + 1];
    const endsInStop = /\.["'”’)\]]*$/.test(piece.trimEnd());
    const joinsNext =
      next !== undefined &&
      endsInStop &&
      (!/^\s/.test(next) || // "3.5 million", "example.com"
        endsWithAbbreviation(piece.trimEnd()) ||
        /^\s+[a-z]/.test(next)); // a new sentence starts with a capital, a digit or a quote
    if (joinsNext) {
      carry = piece;
      continue;
    }
    carry = "";
    if (piece.trim()) out.push(piece.trim());
  }
  if (carry.trim()) out.push(carry.trim());
  return out;
}

/** Remove a leading dateline such as "WASHINGTON (AP) —" or "(The Center Square) –". */
export function stripDateline(text) {
  return String(text || "")
    .replace(/^\s*\([^)]{2,40}\)\s*[—–-]+\s*/, "")
    .replace(/^\s*[A-Z][A-Za-z .,']{1,40}\s*\([^)]{2,30}\)\s*[—–-]+\s*/, "")
    .replace(/^\s*[A-Z]{3,}(?:[ ,.][A-Za-z.]+){0,3}\s*[—–]\s*/, "")
    .trim();
}

function balancedQuotes(s) {
  const open = (s.match(/“/g) || []).length;
  const close = (s.match(/”/g) || []).length;
  const straight = (s.match(/"/g) || []).length;
  return open === close && straight % 2 === 0;
}

/** Usable, self-contained sentences from one feed excerpt. */
export function usableSentences(snippet, title = "") {
  const text = stripDateline(snippet);
  if (!text) return [];
  const cutOff = /(…|\.\.\.|\[…\]|\[\.\.\.\])\s*$/.test(text);
  let sentences = splitSentences(text);
  if (cutOff) sentences = sentences.slice(0, -1);
  const titleKey = tokenize(title).join(" ");
  return sentences.filter((s, i) => {
    if (s.length < MIN_LEN || s.length > MAX_LEN) return false;
    if (!/[.!]["'”’)\]]*$/.test(s) || /(\.\.|…)["'”’)\]]*$/.test(s)) return false; // unfinished, or a question
    if (!/^["“‘'(]?[A-Z0-9]/.test(s)) return false;
    if (PROMO.test(s)) return false;
    if (i > 0 && NEEDS_CONTEXT.test(s)) return false;
    if (!balancedQuotes(s)) return false;
    if (titleKey && tokenize(s).join(" ") === titleKey) return false; // the headline again
    return true;
  });
}

function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / Math.min(a.size, b.size);
}

/**
 * Pick the digest for one story.
 *
 * items: [{ article: { sourceId, title, snippet, url }, lean, source: { name } }]
 * shown: text already on the page (headline, blurb), so the digest adds to it.
 * seed:  any stable string for the story; decides which side picks first.
 */
export function buildDigest(items, { shown = [], seed = "", maxPerSide = 2, minNewWords = 3 } = {}) {
  // Words used by two or more outlets mark what the story is about.
  const outletWords = new Map();
  for (const it of items) {
    const set = outletWords.get(it.article.sourceId) || new Set();
    for (const t of tokenize(`${it.article.title} ${it.article.snippet || ""}`)) set.add(t);
    outletWords.set(it.article.sourceId, set);
  }
  const outletCount = new Map();
  for (const set of outletWords.values()) for (const t of set) outletCount.set(t, (outletCount.get(t) || 0) + 1);

  const candidates = [];
  for (const it of items) {
    for (const text of usableSentences(it.article.snippet, it.article.title)) {
      const tokens = new Set(tokenize(text));
      if (tokens.size < 5) continue;
      const onTopic = [...tokens].filter((t) => (outletCount.get(t) || 0) >= 2).length / tokens.size;
      if (outletWords.size >= 3 && onTopic < 0.25) continue; // about something else
      candidates.push({
        text,
        tokens,
        side: leanGroup(it.lean),
        lean: it.lean,
        sourceId: it.article.sourceId,
        sourceName: it.source.name,
        url: it.article.url,
        heat: analyzeHeadline(text).heat,
        figures: (text.match(/\d[\d,.]*/g) || []).length,
      });
    }
  }
  if (!candidates.length) return [];

  const covered = new Set(shown.flatMap((s) => tokenize(s || "")));
  const picked = [];
  const usedOutlets = new Set();

  const value = (c) => {
    const fresh = [...c.tokens].filter((t) => !covered.has(t)).length;
    if (fresh < minNewWords) return -Infinity;
    if (picked.some((p) => overlap(p.tokens, c.tokens) >= 0.6)) return -Infinity;
    return Math.min(fresh, 12) + Math.min(c.figures, 2) * 1.5 - c.heat * 2 - leanDistance(c.lean) * 0.3;
  };

  // Sides take turns. Left or right goes first depending on the story, center in between.
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const order = h % 2 === 0 ? ["left", "center", "right"] : ["right", "center", "left"];

  for (let round = 0; round < maxPerSide; round++) {
    for (const side of order) {
      let best = null;
      for (const c of candidates) {
        if (c.side !== side || usedOutlets.has(c.sourceId)) continue;
        const v = value(c);
        if (v === -Infinity) continue;
        if (!best || v > best.v) best = { c, v };
      }
      if (!best) continue;
      picked.push({ ...best.c, round });
      usedOutlets.add(best.c.sourceId);
      for (const t of best.c.tokens) covered.add(t);
    }
  }

  // Both sides covered it: same number of sentences from each.
  const outletsOn = (side) => items.some((it) => leanGroup(it.lean) === side);
  let result = picked;
  if (outletsOn("left") && outletsOn("right")) {
    const n = Math.min(picked.filter((p) => p.side === "left").length, picked.filter((p) => p.side === "right").length);
    const kept = { left: 0, right: 0 };
    result = picked.filter((p) => p.side === "center" || kept[p.side]++ < n);
  }

  // Left, Center, Right, in that order, a round at a time.
  result.sort((a, b) => a.round - b.round || SIDES.indexOf(a.side) - SIDES.indexOf(b.side));
  return result.map(({ text, sourceId, sourceName, lean, url }) => ({ text, sourceId, sourceName, lean, url }));
}
