// Sorting feed items into straight news, opinion, and other non-news.
//
// Opinion is where slant lives, so it never counts as news coverage. It is
// kept separately and only shown in the balanced Perspectives section, where
// each side gets the same number of pieces. "Other" (podcasts, newsletters,
// live blogs) is dropped entirely.

const OPINION_URL = [
  /\/opinions?\//i,
  /\/commentary\//i,
  /\/op-?eds?\//i,
  /\/editorials?\//i,
  /\/columns?\//i,
  /\/columnists?\//i,
  /\/blogs?\//i,
  /\/perspectives?\//i,
  /\/voices\//i,
  /\/ideas\//i,
  /\/corner\//i, // National Review's group blog
  /\/volokh\//i, // Reason's Volokh Conspiracy legal blog
];

const OTHER_URL = [
  /\/the-morning-dispatch\//i, // newsletter roundups, not single stories
  /\/podcasts?\//i,
  /\/[a-z-]*newsletters?[a-z-]*\//i, // e.g. /today-explained-newsletter/
  // Video reports are news, so /video/ URLs are kept. Live blogs are not:
  // they change all day and don't describe one event.
  /\/live-news\//i,
  /\/live-updates?\//i,
];

const OPINION_TITLE = [/^(opinion|op-ed|commentary|editorial|column|analysis|perspective|letters?)\s*[:|—–-]/i];

const OTHER_TITLE = [
  /^\s*(the (morning|evening|weekend)|morning|evening) (briefing|dispatch|roundup|report)\b/i,
  /\b(podcast|newsletter)\s*:/i,
  /^(watch live|live|listen)\s*[:|]/i,
  /\bfrom the politics desk\b/i,
  /\bmailbag\b/i,
];

const OPINION_CATEGORY = [/^opinion/i, /^commentary/i, /^op-?ed/i, /^editorial/i, /^columns?$/i, /^columnists?$/i];
const OTHER_CATEGORY = [/^podcasts?$/i, /^mailbag$/i, /^newsletters?$/i];

function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Classify an article that came from a news feed.
 * Returns { kind: "opinion" | "other", reason } or null for straight news.
 */
export function nonNewsKind(article) {
  const path = pathOf(article.url);
  const cats = article.categories || [];
  for (const re of OTHER_URL) if (re.test(path)) return { kind: "other", reason: `url:${re.source}` };
  for (const re of OTHER_TITLE) if (re.test(article.title)) return { kind: "other", reason: `title:${re.source}` };
  for (const c of cats) for (const re of OTHER_CATEGORY) if (re.test(c)) return { kind: "other", reason: `category:${c}` };
  for (const re of OPINION_URL) if (re.test(path)) return { kind: "opinion", reason: `url:${re.source}` };
  for (const re of OPINION_TITLE) if (re.test(article.title)) return { kind: "opinion", reason: `title:${re.source}` };
  for (const c of cats) for (const re of OPINION_CATEGORY) if (re.test(c)) return { kind: "opinion", reason: `category:${c}` };
  return null;
}

/** Back-compat helper: a reason string if the article is not straight news, else null. */
export function opinionReason(article) {
  return nonNewsKind(article)?.reason ?? null;
}
