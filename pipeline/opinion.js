// Opinion and commentary are where slant lives, so they are kept out of the
// news clusters. Detection is by URL path, headline prefix and feed category.

const URL_PATTERNS = [
  /\/opinions?\//i,
  /\/commentary\//i,
  /\/op-?eds?\//i,
  /\/editorials?\//i,
  /\/columns?\//i,
  /\/columnists?\//i,
  /\/blogs?\//i,
  /\/perspectives?\//i,
  /\/voices\//i,
  /\/the-morning-dispatch\//i, // newsletter roundups, not single stories
  /\/podcasts?\//i,
  // Video reports are news, so /video/ URLs are kept. Live blogs are not:
  // they change all day and don't describe one event.
  /\/live-news\//i,
  /\/live-updates?\//i,
  /\/newsletters?\//i,
];

const TITLE_PATTERNS = [
  /^(opinion|op-ed|commentary|editorial|column|analysis|perspective|letters?)\s*[:|—–-]/i,
  /^\s*(the (morning|evening|weekend)|morning|evening) (briefing|dispatch|roundup|report)\b/i,
  /\b(podcast|newsletter)\s*:/i,
  /^(watch live|live|listen)\s*[:|]/i,
  /\bfrom the politics desk\b/i,
];

const CATEGORY_PATTERNS = [/^opinion/i, /^commentary/i, /^op-?ed/i, /^editorial/i, /^columns?$/i, /^columnists?$/i, /^podcasts?$/i];

/** Returns a reason string if the article looks like opinion/non-news, else null. */
export function opinionReason(article) {
  let path = "";
  try {
    path = new URL(article.url).pathname;
  } catch {
    path = article.url;
  }
  for (const re of URL_PATTERNS) if (re.test(path)) return `url:${re.source}`;
  for (const re of TITLE_PATTERNS) if (re.test(article.title)) return `title:${re.source}`;
  for (const cat of article.categories || []) {
    for (const re of CATEGORY_PATTERNS) if (re.test(cat)) return `category:${cat}`;
  }
  return null;
}
