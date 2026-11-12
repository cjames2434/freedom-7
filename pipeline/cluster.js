// Groups articles from different outlets that describe the same event.
//
// Method (no paid APIs, no ML models):
//   1. Each article becomes a TF-IDF vector built from its headline (weighted
//      double), headline word pairs, and the first part of its feed excerpt.
//      Proper nouns get a boost because names and places identify a story.
//   2. Cosine similarity between every pair that shares a distinctive word.
//   3. Average-linkage agglomerative clustering: repeatedly merge the two
//      groups whose *average* pairwise similarity is highest, stopping at a
//      threshold. Average linkage resists "chaining" unrelated stories
//      together through one ambiguous headline.

const STOPWORDS = new Set(
  `a about above after again against ago all also am amid among an and any are aren't as at be because been before
  being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each
  few for from further get gets got had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers
  herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself just let's like make
  makes me more most mustn't my myself new news no nor not now of off on once one only or other ought our ours ourselves
  out over own per same says said say shan't she she'd she'll she's should shouldn't so some such than that that's
  the their theirs them themselves then there there's these they they'd they'll they're they've this those through to
  too two under until up upon us very via vs was wasn't we we'd we'll we're we've were weren't what what's when when's
  where where's which while who who's whom why why's will with won't would wouldn't you you'd you'll you're you've your
  yours yourself yourselves amid report reports reported update updates latest live watch video photos breaking
  exclusive first last year years day days week weeks month months today tonight yesterday tomorrow time times people
  could may might back know here according told tells tell want wants going may still even many much another way ways
  look looks take takes come comes know see sees seen show shows set sets mr mrs ms dr`.split(/\s+/)
);

export function stem(word) {
  let w = word.replace(/['’]s$/, "");
  if (w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (/(ss|us|is|ous)$/.test(w)) return w;
  if (/(sh|ch|x|z)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s")) return w.slice(0, -1);
  return w;
}

function rawWords(text) {
  return (
    text
      .replace(/\b([A-Za-z])\.([A-Za-z])\.(?:([A-Za-z])\.)?/g, (m, a, b, c) => a + b + (c || "")) // U.S. -> US
      .replace(/[‘’]/g, "'")
      .match(/[A-Za-z0-9][A-Za-z0-9'&]*/g) || []
  );
}

/** Lowercased, stemmed content words. */
export function tokenize(text) {
  const out = [];
  for (const w of rawWords(text)) {
    const lw = w.toLowerCase();
    if (STOPWORDS.has(lw)) continue;
    if (/^\d+$/.test(lw) && lw.length < 2) continue;
    if (lw.length < 2) continue;
    out.push(stem(lw));
  }
  return out;
}

/**
 * Stems of words that look like proper nouns (capitalised mid-sentence).
 * Skipped for Title Case headlines, where every word is capitalised.
 */
export function entityTokens(text) {
  const words = rawWords(text);
  const long = words.filter((w) => w.length > 3);
  const capRatio = long.length ? long.filter((w) => /^[A-Z]/.test(w)).length / long.length : 0;
  if (long.length >= 4 && capRatio >= 0.7) return new Set();
  const ents = new Set();
  const sentenceStarts = new Set();
  // Mark words that begin a sentence so they don't count as names.
  let idx = 0;
  for (const m of text.matchAll(/(^|[.!?:]\s+|["“]\s*)([A-Za-z0-9]+)/g)) sentenceStarts.add(m[2]);
  for (const w of words) {
    idx++;
    if (!/^[A-Z]/.test(w)) continue;
    const lw = w.toLowerCase();
    if (STOPWORDS.has(lw) || lw.length < 2) continue;
    if (idx === 1 || sentenceStarts.has(w)) {
      // still count all-caps acronyms (NATO, FBI) at sentence start
      if (!/^[A-Z]{2,}$/.test(w)) continue;
    }
    ents.add(stem(lw));
  }
  return ents;
}

const TITLE_WEIGHT = 2;
const BIGRAM_WEIGHT = 1.5;
const SNIPPET_WEIGHT = 1;
const ENTITY_BOOST = 1.6;
const SNIPPET_CHARS = 300;

function termCounts(article) {
  const counts = new Map();
  const add = (tok, w) => counts.set(tok, (counts.get(tok) || 0) + w);
  const snippet = (article.snippet || "").slice(0, SNIPPET_CHARS);
  const ents = new Set([...entityTokens(article.title), ...entityTokens(snippet)]);

  const titleToks = tokenize(article.title);
  for (const t of titleToks) add(t, TITLE_WEIGHT * (ents.has(t) ? ENTITY_BOOST : 1));
  for (let i = 0; i + 1 < titleToks.length; i++) add(`${titleToks[i]}_${titleToks[i + 1]}`, BIGRAM_WEIGHT);
  for (const t of tokenize(snippet)) add(t, SNIPPET_WEIGHT * (ents.has(t) ? ENTITY_BOOST : 1));
  return counts;
}

/** Build L2-normalised TF-IDF vectors (Map token -> weight) for all articles. */
export function buildVectors(articles) {
  const counts = articles.map(termCounts);
  const df = new Map();
  for (const c of counts) for (const t of c.keys()) df.set(t, (df.get(t) || 0) + 1);
  const n = articles.length;
  const vectors = counts.map((c) => {
    const v = new Map();
    let norm = 0;
    for (const [t, tf] of c) {
      const idf = Math.log((n + 1) / (df.get(t) + 0.5));
      if (idf <= 0) continue;
      const w = (1 + Math.log(tf)) * idf;
      v.set(t, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of v) v.set(t, w / norm);
    return v;
  });
  return { vectors, df };
}

export function cosine(a, b) {
  if (a.size > b.size) [a, b] = [b, a];
  let dot = 0;
  for (const [t, w] of a) {
    const o = b.get(t);
    if (o) dot += w * o;
  }
  return dot;
}

class MaxHeap {
  constructor() {
    this.a = [];
  }
  get size() {
    return this.a.length;
  }
  push(item) {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] >= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] > a[m][0]) m = l;
        if (r < a.length && a[r][0] > a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Cluster articles. Returns an array of clusters; each cluster is an array of
 * { index, centrality } where index points into `articles` and centrality is
 * the article's similarity to the cluster's centre (0..1).
 */
export function clusterArticles(articles, { threshold = 0.2, maxHoursApart = 36, sameSourcePenalty = 0.8, minEdge = 0.06 } = {}) {
  const n = articles.length;
  if (n === 0) return [];
  const { vectors, df } = buildVectors(articles);
  const times = articles.map((a) => new Date(a.published).getTime());

  // Candidate pairs: articles sharing at least one reasonably distinctive term.
  const maxDf = Math.max(25, Math.floor(n * 0.04));
  const postings = new Map();
  vectors.forEach((v, i) => {
    for (const t of v.keys()) {
      if (df.get(t) < 2 || df.get(t) > maxDf) continue;
      if (!postings.has(t)) postings.set(t, []);
      postings.get(t).push(i);
    }
  });

  // adjacency: cluster id -> Map(neighbour cluster id -> summed similarity)
  const adj = Array.from({ length: n }, () => new Map());
  const seen = new Set();
  for (const list of postings.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const i = list[x];
        const j = list[y];
        const key = i * n + j;
        if (seen.has(key)) continue;
        seen.add(key);
        if (Math.abs(times[i] - times[j]) / 36e5 > maxHoursApart) continue;
        let s = cosine(vectors[i], vectors[j]);
        if (articles[i].sourceId === articles[j].sourceId) s *= sameSourcePenalty;
        if (s < minEdge) continue;
        adj[i].set(j, s);
        adj[j].set(i, s);
      }
    }
  }

  const size = new Array(n).fill(1);
  const members = Array.from({ length: n }, (_, i) => [i]);
  const version = new Array(n).fill(0);
  const alive = new Array(n).fill(true);
  const heap = new MaxHeap();
  for (let i = 0; i < n; i++) {
    for (const [j, s] of adj[i]) if (i < j && s >= threshold) heap.push([s, i, j, 0, 0]);
  }

  while (heap.size) {
    const [avg, a, b, va, vb] = heap.pop();
    if (avg < threshold) break;
    if (!alive[a] || !alive[b] || version[a] !== va || version[b] !== vb) continue;
    // merge b into a
    for (const [c, s] of adj[b]) {
      if (c === a) continue;
      const merged = (adj[a].get(c) || 0) + s;
      adj[a].set(c, merged);
      adj[c].set(a, merged);
      adj[c].delete(b);
    }
    adj[a].delete(b);
    adj[b] = new Map();
    alive[b] = false;
    members[a] = members[a].concat(members[b]);
    members[b] = [];
    size[a] += size[b];
    version[a]++;
    for (const [c, sum] of adj[a]) {
      const cavg = sum / (size[a] * size[c]);
      if (cavg >= threshold) heap.push([cavg, a, c, version[a], version[c]]);
    }
  }

  const clusters = [];
  for (let i = 0; i < n; i++) {
    if (!alive[i]) continue;
    const idxs = members[i];
    const centroid = new Map();
    for (const k of idxs) for (const [t, w] of vectors[k]) centroid.set(t, (centroid.get(t) || 0) + w);
    let norm = 0;
    for (const w of centroid.values()) norm += w * w;
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of centroid) centroid.set(t, w / norm);
    clusters.push(idxs.map((k) => ({ index: k, centrality: cosine(vectors[k], centroid) })));
  }
  return clusters;
}
