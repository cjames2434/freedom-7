// Keyword topic tagging. Cheap and transparent; good enough to filter a front page.
// Each story gets the topic with the most keyword hits across all its articles.

export const TOPICS = [
  { id: "politics", label: "Politics" },
  { id: "world", label: "World" },
  { id: "us", label: "U.S." },
  { id: "military", label: "Military" },
  { id: "business", label: "Business" },
  { id: "tech", label: "Tech" },
  { id: "science-health", label: "Science & Health" },
  { id: "sports", label: "Sports" },
  { id: "culture", label: "Culture" },
];

const KEYWORDS = {
  politics: [
    "congress", "senate", "senator", "house speaker", "speaker johnson", "representative", "lawmaker",
    "lawmakers", "democrat", "democrats", "democratic", "republican", "republicans", "gop", "white house",
    "president trump", "trump administration", "administration", "election", "elections", "midterm",
    "midterms", "campaign", "primary", "ballot", "voter", "voters", "governor", "legislation", "bill",
    "filibuster", "impeach", "cabinet", "secretary", "supreme court", "justice department", "doj",
    "executive order", "veto", "shutdown", "poll", "polls", "redistricting", "gerrymander", "partisan",
    "attorney general", "fbi director", "hegseth", "vance", "mamdani", "newsom", "desantis",
    "pelosi", "schumer", "thune", "jeffries", "mayor", "tariff", "tariffs",
  ],
  world: [
    "ukraine", "russia", "russian", "putin", "zelensky", "kyiv", "moscow", "israel", "israeli", "gaza",
    "hamas", "hezbollah", "netanyahu", "iran", "iranian", "tehran", "china", "chinese", "beijing", "xi jinping",
    "taiwan", "north korea", "south korea", "japan", "india", "pakistan", "afghanistan", "syria", "lebanon",
    "yemen", "houthi", "saudi", "venezuela", "maduro", "mexico", "canada", "canadian", "brazil", "argentina",
    "europe", "european", "eu", "nato", "united nations", "u.n.", "britain", "british", "uk", "france",
    "french", "germany", "german", "italy", "spain", "poland", "turkey", "africa", "nigeria", "sudan",
    "congo", "ethiopia", "australia", "philippines", "indonesia", "prime minister", "parliament", "kremlin",
    "ceasefire", "foreign minister", "embassy", "cuba", "haiti", "colombia",
  ],
  military: [
    "military", "pentagon", "department of war", "secretary of war", "war secretary", "defense secretary",
    "army", "navy", "marines", "marine corps", "air force", "space force", "coast guard", "national guard",
    "troops", "soldier", "soldiers", "sailor", "sailors", "service members", "servicemembers", "veteran",
    "veterans", "veterans affairs", "arlington", "tomb of the unknown", "military base", "deployment",
    "deployed", "warship", "aircraft carrier", "fighter jet", "drone strike", "airstrike", "west point",
  ],
  business: [
    "stocks", "stock market", "dow", "s&p", "nasdaq", "wall street", "economy", "economic", "inflation",
    "interest rate", "interest rates", "federal reserve", "fed", "jobs report", "unemployment", "gdp",
    "earnings", "revenue", "profit", "shares", "investors", "merger", "acquisition", "ceo", "company",
    "companies", "retail", "prices", "consumer", "housing market", "mortgage", "bank", "banks", "crypto",
    "bitcoin", "oil prices", "trade deal", "layoffs", "billion", "startup",
  ],
  tech: [
    "artificial intelligence", " ai ", "openai", "anthropic", "google", "apple", "microsoft", "meta",
    "amazon", "nvidia", "tesla", "musk", "spacex", "tiktok", "chip", "chips", "semiconductor", "software",
    "app", "apps", "cyber", "cyberattack", "hackers", "data breach", "smartphone", "iphone", "social media",
    "algorithm", "robot", "robotics", "silicon valley", "tech",
  ],
  "science-health": [
    "study", "researchers", "scientists", "science", "nasa", "space", "climate", "climate change",
    "weather", "hurricane", "tornado", "earthquake", "wildfire", "flood", "storm", "health",
    "disease", "virus", "vaccine", "vaccines", "covid", "flu", "measles", "cancer", "fda", "cdc", "drug",
    "medicine", "medical", "patients", "doctors", "rfk jr", "kennedy jr", "outbreak", "mental health",
  ],
  sports: [
    "nfl", "nba", "mlb", "nhl", "wnba", "ncaa", "super bowl", "world series", "playoff", "playoffs",
    "quarterback", "coach", "touchdown", "season", "olympic", "olympics", "world cup", "soccer", "football",
    "basketball", "baseball", "hockey", "tennis", "golf", "ufc", "championship", "team", "league",
    "nascar", "daytona", "racing", "formula 1", "f1",
  ],
  culture: [
    "movie", "film", "box office", "actor", "actress", "celebrity", "sitcom", "music", "album", "singer", "concert",
    "tv show", "netflix", "oscars", "grammys", "emmys", "book", "author", "museum", "art",
    "fashion", "royal", "taylor swift", "obituary",
  ],
};

const COMPILED = Object.fromEntries(
  Object.entries(KEYWORDS).map(([topic, words]) => [
    topic,
    words.map((w) => new RegExp(`(^|[^a-z])${w.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z])`, "i")),
  ])
);

function scoreText(text) {
  const scores = {};
  const padded = ` ${text.toLowerCase()} `;
  for (const [topic, regs] of Object.entries(COMPILED)) {
    let n = 0;
    for (const re of regs) if (re.test(padded)) n++;
    if (n) scores[topic] = n;
  }
  return scores;
}

/** Pick a topic for a group of articles. Falls back to "us" (general news). */
export function classifyTopic(articles) {
  const total = {};
  for (const a of articles) {
    const s = scoreText(`${a.title} ${a.title} ${a.snippet || ""} ${(a.categories || []).join(" ")}`);
    for (const [k, v] of Object.entries(s)) total[k] = (total[k] || 0) + v;
  }
  let best = "us";
  let bestScore = 0;
  for (const [k, v] of Object.entries(total)) {
    if (v > bestScore) {
      best = k;
      bestScore = v;
    }
  }
  // Need a few hits across the cluster before committing to a specific topic.
  return bestScore >= Math.max(2, Math.ceil(articles.length * 0.5)) ? best : "us";
}
