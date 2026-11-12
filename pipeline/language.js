// Headline tone checks. Two lists, both deliberately side-neutral:
//
// 1. LOADED: sensational or emotional wording. "Slams", "destroys",
//    "bombshell" are used by outlets on every side; they signal heat, not
//    information. Flagging them says nothing about which party is right.
// 2. CONTESTED: terms where each side has its own preferred word. Every entry
//    has a counterpart from the other side, plus the plainer wording used by
//    wire-service style guides. Keep this list symmetric when you edit it.
//
// The flags lower a headline's chance of being shown as the story's main
// headline and are surfaced to readers as small chips.

// Words with common literal news uses ("storm hammers coast", "wildfire rages",
// "explosive device", "disaster relief") are left out on purpose.
const LOADED = [
  "slams?", "slammed", "slamming", "blasts?", "blasted", "rips into", "ripped into", "rips apart",
  "destroys?", "destroyed", "eviscerates?", "eviscerated", "torches?", "torched", "shreds?", "shredded",
  "obliterates?", "annihilates?", "humiliates?", "humiliated", "humiliating", "scorches?", "scorched",
  "lashes out", "lashed out", "fuming", "meltdown", "melts down", "freaks? out", "freaked out",
  "unhinged", "bombshell", "shocking", "stunning", "outrage", "outraged", "outrageous", "furious",
  "disgusting", "disgraceful", "insane", "crazy", "chaos", "chaotic", "savage", "savagely", "epic",
  "jaw-dropping", "mind-blowing", "nightmare", "horrifying", "terrifying",
  "dunks on", "claps back", "goes off", "sounds the alarm", "fires back", "doubles down",
  "smackdown", "takedown", "mocks?", "mocked", "mocking", "trashes", "trashed",
  "lambasts?", "lambasted", "skewers?", "skewered", "cringe", "deranged", "lunatic",
  "radical", "extremist", "extremists", "woke", "far-left", "far-right", "ultra-maga",
  "regime", "puppet", "propaganda", "witch hunt", "hoax", "sham",
];

// [term regex, coded-as, plainer alternative]
const CONTESTED = [
  ["illegal aliens?", "right", "immigrants in the country illegally"],
  ["undocumented (immigrants?|migrants?|people)", "left", "immigrants in the country illegally"],
  ["pro-life", "right", "anti-abortion"],
  ["pro-choice", "left", "abortion-rights"],
  ["death tax", "right", "estate tax"],
  ["tax cuts? for the (rich|wealthy)", "left", "tax cuts"],
  ["gun-grabb(ers?|ing)", "right", "gun-control advocates"],
  ["gun lobby", "left", "gun-rights groups"],
  ["climate alarmists?", "right", "climate activists"],
  ["climate deniers?", "left", "climate skeptics"],
  ["open borders?", "right", "immigration policy"],
  ["mass deportations?", "left", "deportations"],
  ["(fascists?|fascism)", "left", null],
  ["(communists?|marxists?)", "right", null],
];

const LOADED_RE = new RegExp(`\\b(${LOADED.join("|")})\\b`, "gi");
const CONTESTED_RES = CONTESTED.map(([re, codedAs, plain]) => ({
  re: new RegExp(`\\b${re}\\b`, "i"),
  codedAs,
  plain,
}));

const CLICKBAIT_RES = [
  /you won'?t believe/i,
  /\bhere'?s (why|what|how)\b/i,
  /\bthis is (why|what|how)\b/i,
  /\bwhat happens next\b/i,
  /\bis this the\b/i,
  /\bthe internet (is|can'?t)\b/i,
  /\bfor (1|one) \w+ reason\b/i,
  /\b(spicy|wild|bizarre|jaw-dropping) (reason|moment|reaction|claim)\b/i,
  /!{1,}/,
];

/**
 * Analyse a headline. Returns { loaded: string[], contested: [{term, codedAs, plain}],
 * clickbait: boolean, allCapsWords: number, heat: number }.
 * heat is a rough 0+ score: 0 = plain, higher = more loaded.
 */
export function analyzeHeadline(title) {
  const loaded = [...new Set((title.match(LOADED_RE) || []).map((w) => w.toLowerCase()))];

  const contested = [];
  for (const { re, codedAs, plain } of CONTESTED_RES) {
    const m = title.match(re);
    if (m) contested.push({ term: m[0].toLowerCase(), codedAs, plain });
  }

  const clickbait = CLICKBAIT_RES.some((re) => re.test(title));
  // ALL-CAPS words of 4+ letters, ignoring common acronyms.
  const allCapsWords = (title.match(/\b[A-Z]{4,}\b/g) || []).filter(
    (w) => !/^(NATO|NASA|ICE|FEMA|USDA|NCAA|NFL|NBA|MLB|NHL|UFC|COVID|OPEC|AIDS|HIV|IRS|FBI|CIA|DOJ|DHS|SNAP|WNBA|AMA|AARP|UNESCO|UNICEF|IMF|ASEAN|GOP|USPS|CDC|NIH|FDA|EPA|SEC|FTC|FCC|NTSB|FAA|TSA|ATF|DEA|NSA|DOGE|MAGA|ACLU|NAACP|LGBTQ|CEO|NYPD|LAPD|BBC|CNN|NPR|PBS|AP|UPI)$/.test(w)
  ).length;
  const quoteMarks = (title.match(/["“”]/g) || []).length;

  const heat =
    loaded.length * 2 + contested.length * 1.5 + (clickbait ? 1.5 : 0) + allCapsWords * 1 + (quoteMarks >= 2 ? 0.25 : 0);
  return { loaded, contested, clickbait, allCapsWords, heat };
}
