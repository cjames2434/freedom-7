// Markets: stock-market news and the companies the site follows, gathered
// into one section.
//
// A story counts as market news when:
//   - it is about one of the followed companies (config/settings.json,
//     markets.watch): the company is named in the story's headline, in at
//     least two outlets' headlines, or in the reporting of at least half the
//     outlets covering it (a passing mention in one article isn't enough), or
//   - its reporting is about markets (stocks, Wall Street, the Fed, earnings,
//     IPOs...) in at least `minOutlets` outlets and at least `minShare` of
//     the outlets covering it, or
//   - it is filed under Business and at least one outlet's reporting is.
//
// Nothing here changes how stories rank: the section lists them in the
// site's usual order (how widely they're covered, never clicks).

// Market wording. Kept to phrases that mean markets in news copy: "shares"
// alone is usually the verb ("shares a message") and "rally" alone is usually
// political, so both only count in market phrases.
const MOVES =
  "(?:fell|falls?|rose|rises?|jumped|jumps?|slid|slides?|tumbled|tumbles?|surged|surges?|dropped|drops?|climbed|climbs?|gained|gains?|lost|sank|sinks?|soared|soars?|plunged|plunges?|rallied|slumped|slumps?)";
const MARKET_TERMS = [
  // "stock" alone is too often "out of stock", so it counts in market phrases only.
  "stocks", "stock markets?", "stock prices?", "stock exchanges?", "stock slide", `stock ${MOVES}`, "share prices?", "shareholders?",
  `shares (?:of|in|${MOVES.slice(3, -1)})`,
  "(?:stocks?|markets?|shares) rall(?:y|ies|ied)", "wall street", "dow jones", "the dow", "s&p(?: 500)?", "nasdaq",
  "ipos?", "initial public offering", "market value", "market cap(?:italization)?", "valuation", "investors?",
  "earnings", "quarterly (?:results|profits?|revenue|earnings|sales)", "sell-?offs?", "bear market", "bull market",
  "federal reserve", "the fed", "interest rates?", "rate (?:cuts?|hikes?)", "treasury yields?", "bond yields?",
  "inflation", "consumer prices", "jobs report", "recession", "401\\(k\\)s?", "bitcoin", "crypto(?:currency|currencies)?",
  "oil prices", "gold prices", "hedge funds?",
];

/** Case-insensitive match for any of `terms` (regex sources) as whole words. */
function wordsRe(terms) {
  return new RegExp(`(?<![a-z0-9])(?:${terms.join("|")})(?![a-z0-9])`, "i");
}

const MARKET_RE = wordsRe(MARKET_TERMS);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when the text uses market wording. */
export function mentionsMarkets(text) {
  return MARKET_RE.test(String(text || ""));
}

const articleText = (a) => `${a.title} ${a.snippet || ""}`;
const outletsWhere = (story, test) => new Set(story.articles.filter(test).map((a) => a.sourceId));

/** Is the story about the company whose names `re` matches? */
export function aboutCompany(story, re) {
  if (re.test(story.headline)) return true;
  if (outletsWhere(story, (a) => re.test(a.title)).size >= 2) return true;
  const reporting = outletsWhere(story, (a) => re.test(articleText(a))).size;
  return reporting >= 2 && reporting >= story.sourceCount / 2;
}

/**
 * Mutates `stories` (in final rank order): sets `story.market` (boolean) and
 * `story.companies` (ids of followed companies the story is about).
 * Returns { companies: [{ id, name }], stories: [ids of market stories, rank order] }.
 */
export function tagMarkets(stories, { watch = [], minOutlets = 2, minShare = 0.4 } = {}) {
  const companies = watch.map((c) => ({
    id: c.id,
    name: c.name,
    re: wordsRe((c.terms?.length ? c.terms : [c.name]).map((t) => escape(t.toLowerCase()))),
  }));
  const ids = [];
  for (const s of stories) {
    s.companies = companies.filter((c) => aboutCompany(s, c.re)).map((c) => c.id);
    const marketOutlets = outletsWhere(s, (a) => mentionsMarkets(articleText(a))).size;
    s.market =
      s.companies.length > 0 ||
      (marketOutlets >= minOutlets && marketOutlets >= s.sourceCount * minShare) ||
      (s.topic === "business" && marketOutlets >= 1);
    if (s.market) ids.push(s.id);
  }
  return { companies: companies.map(({ id, name }) => ({ id, name })), stories: ids };
}
