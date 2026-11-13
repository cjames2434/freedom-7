// Freedom 7 front end (newspaper design) for the Even Keel data pipeline.
// The site name and tagline come from config/settings.json via news.json.
// Reads data/news.json and data/sources.json (shape: docs/DATA_CONTRACT.md)
// and renders with escaped DOM strings. No dependencies, no tracking.
//
// Routes: #/  #/topic/<id>  #/story/<id>  #/live  #/blindspots
//         #/perspectives  #/sources  #/about  #/saved

const app = document.getElementById("app");

const GROUPS = ["left", "center", "right"];
const GROUP_LABEL = { left: "Left", center: "Center", right: "Right" };
const GROUP_LONG = { left: "left-leaning", center: "center", right: "right-leaning" };
const LEANS = ["left", "lean-left", "center", "lean-right", "right"];
const LEAN_LABEL = { left: "Left", "lean-left": "Lean left", center: "Center", "lean-right": "Lean right", right: "Right" };
const LEAN_GROUP = { left: "left", "lean-left": "left", center: "center", "lean-right": "right", right: "right" };
const SAVED_KEY = "evenkeel:saved";
const RUNDOWN_PAGE = 12;
const SECTION_MAX = 6; // topic columns under the Rundown
const SECTION_SIZE = 3; // stories per topic column
const TIMELINE_MAX = 20;

let news = null;
let sources = null;
let balance = null; // data/balance.json: how balanced the site itself is (optional)
let byId = new Map();
let families = new Map(); // familyId -> stories in that related group, rank order
let showAllRundown = false;
let speakingId = null;
let firstRender = true;

// ---------- helpers ----------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const isHttp = (u) => typeof u === "string" && /^https?:\/\//i.test(u);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const storyHref = (s) => `#/story/${encodeURIComponent(s.id)}`;
const topicHref = (id) => `#/topic/${encodeURIComponent(id)}`;
const blurb = (s) => s.summary || s.snippet || "";
const topicLabel = (id) => news?.topics.find((t) => t.id === id)?.label ?? id;
const fromIds = (list) => (list || []).map((id) => byId.get(id)).filter(Boolean);

// Related stories: several updates on one subject share a familyId (the id of
// the group's top-ranked story). Lists show one card per family so the same
// subject doesn't fill the page with near-duplicates.
const familyOf = (s) => s.familyId || s.id;
function indexFamilies() {
  families = new Map();
  for (const s of news.stories) {
    const f = familyOf(s);
    if (!families.has(f)) families.set(f, []);
    families.get(f).push(s);
  }
}
const familyMembers = (s) => families.get(familyOf(s)) || [s];
const relatedCount = (s) => familyMembers(s).length - 1;
function onePerFamily(list) {
  const seen = new Set();
  return list.filter((s) => {
    const f = familyOf(s);
    if (seen.has(f)) return false;
    seen.add(f);
    return true;
  });
}

function timeAgo(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function clock(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  if (d.toDateString() === today.toDateString()) return time;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

// External link, or plain text when the URL isn't http(s).
function outLink(url, html, cls) {
  if (!isHttp(url)) return `<span class="${cls}">${html}</span>`;
  return `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${html}${ICON.ext}<span class="sr-only"> (opens in a new tab)</span></a>`;
}

// The round "7" mission-patch mark that sits beside the wordmark. Its colours
// come from CSS (.mark-*), so it flips for dark mode and the footer. The same
// markup is in index.html so the logo shows before the data loads.
const MARK =
  `<svg class="mark" viewBox="3 3 58 58" aria-hidden="true" focusable="false">` +
  `<circle class="mark-disc" cx="32" cy="32" r="27"/>` +
  `<path class="mark-seven" d="M17 13h30v8L34.5 45H24l12-22.5H17z" transform="translate(32 32) scale(0.78) translate(-32 -29)"/>` +
  `<circle class="mark-back" cx="51" cy="13" r="7.8"/>` +
  `<polygon class="mark-star" points="51,7.5 52.23,11.3 56.23,11.3 53,13.65 54.23,17.45 51,15.1 47.77,17.45 49,13.65 45.77,11.3 49.77,11.3"/>` +
  `</svg>`;
const brandHtml = (name) => `${MARK}<span class="wm-text">${wordmarkHtml(name)}</span>`;

function wordmarkHtml(name) {
  const parts = String(name || "").trim().split(/\s+/);
  if (parts.length < 2) return esc(name);
  const last = parts.pop();
  return `${esc(parts.join(" "))} <span class="wm-accent">${esc(last)}</span>`;
}

const svg = (body, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
const ICON = {
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  ext: svg('<path d="M9 6h9v9M18 6L7 17"/>', "ext"),
  listen: svg('<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3.5" y="14" width="4" height="6" rx="1"/><rect x="16.5" y="14" width="4" height="6" rx="1"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="1"/>'),
  save: svg('<path d="M6.5 4h11v16l-5.5-4-5.5 4z"/>'),
  share: svg('<path d="M12 3.5v11M7.5 8L12 3.5 16.5 8M5 13v7h14v-7"/>'),
  source: svg('<path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5"/>'),
  ai: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>'),
  refresh: svg('<path d="M20 11a8 8 0 1 0-2.34 5.66"/><path d="M20 4v7h-7"/>'),
  stack: svg('<path d="M4 8l8-4 8 4-8 4z"/><path d="M4 12l8 4 8-4"/><path d="M4 16l8 4 8-4"/>'),
};

// ---------- saved stories (this device only) ----------
function readSaved() {
  try {
    const list = JSON.parse(localStorage.getItem(SAVED_KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function writeSaved(list) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: saving silently does nothing */
  }
  updateSavedCount();
}
const isSaved = (id) => readSaved().some((x) => x.id === id);
function toggleSaved(id) {
  const list = readSaved();
  const i = list.findIndex((x) => x.id === id);
  if (i >= 0) list.splice(i, 1);
  else {
    const s = byId.get(id);
    if (!s) return;
    list.unshift({
      id: s.id,
      headline: s.headline,
      topic: s.topic,
      savedAt: new Date().toISOString(),
      links: s.articles.slice(0, 4).filter((a) => isHttp(a.url)).map((a) => ({ sourceName: a.sourceName, url: a.url })),
    });
  }
  writeSaved(list);
}
function updateSavedCount() {
  const n = readSaved().length;
  document.querySelectorAll(".saved-count").forEach((el) => (el.textContent = n ? String(n) : ""));
}

// ---------- listen (Web Speech API, free in the browser) ----------
const canSpeak = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
function toggleListen(id) {
  if (!canSpeak) return;
  if (speakingId === id) {
    window.speechSynthesis.cancel();
    speakingId = null;
    syncActionButtons();
    return;
  }
  const s = byId.get(id);
  if (!s) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(`${s.headline}. ${blurb(s)}`);
  u.onend = u.onerror = () => {
    if (speakingId === id) {
      speakingId = null;
      syncActionButtons();
    }
  };
  speakingId = id;
  window.speechSynthesis.speak(u);
  syncActionButtons();
}

async function shareStory(id, btn) {
  const s = byId.get(id);
  if (!s) return;
  const url = `${location.href.split("#")[0]}#/story/${encodeURIComponent(id)}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: s.headline, url });
    } catch {
      /* cancelled */
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    flashLabel(btn, "Link copied");
  } catch {
    flashLabel(btn, "Copy failed");
  }
}

function flashLabel(btn, text) {
  const label = btn?.querySelector("[data-label]");
  if (!label) return;
  const before = label.textContent;
  label.textContent = text;
  setTimeout(() => (label.textContent = before), 1800);
}

function actionButtons(s) {
  return `
    <div class="actions">
      ${canSpeak ? `<button type="button" class="btn" data-action="listen" data-id="${esc(s.id)}" aria-pressed="false">${ICON.listen}<span data-label>Listen</span></button>` : ""}
      <button type="button" class="btn" data-action="save" data-id="${esc(s.id)}" aria-pressed="false">${ICON.save}<span data-label>Save</span></button>
      <button type="button" class="btn" data-action="share" data-id="${esc(s.id)}">${ICON.share}<span data-label>Share</span></button>
    </div>`;
}

function syncActionButtons() {
  app.querySelectorAll('[data-action="listen"]').forEach((b) => {
    const on = b.dataset.id === speakingId;
    b.setAttribute("aria-pressed", String(on));
    b.querySelector("svg").outerHTML = on ? ICON.stop : ICON.listen;
    b.querySelector("[data-label]").textContent = on ? "Stop" : "Listen";
  });
  const saved = new Set(readSaved().map((x) => x.id));
  app.querySelectorAll('[data-action="save"]').forEach((b) => {
    const on = saved.has(b.dataset.id);
    b.setAttribute("aria-pressed", String(on));
    b.querySelector("[data-label]").textContent = on ? "Saved" : "Save";
  });
}

// ---------- building blocks ----------
function coverageBar(c, size = "sm") {
  const segs = GROUPS.map((g) => (c[g] > 0 ? `<span class="seg seg-${g}" style="flex:${Number(c[g])}"></span>` : "")).join("");
  return `
    <div class="coverage coverage-${size}">
      <div class="coverage-bar" role="img" aria-label="Covered by ${plural(c.left, "left-leaning outlet")}, ${plural(c.center, "center outlet")} and ${plural(c.right, "right-leaning outlet")}">${segs}</div>
      <div class="coverage-legend" aria-hidden="true">
        ${GROUPS.map((g) => `<span><i class="key key-${g}"></i>${GROUP_LABEL[g]} <b>${Number(c[g])}</b></span>`).join("")}
      </div>
    </div>`;
}

// A subject is the whole group of related stories, with each outlet counted
// once across them (story.subject). Lists show one card per subject, so a
// grouped card carries the subject's numbers ("22 outlets across 4 stories").
// The story page keeps the story's own numbers.
const groupOf = (s) => (s.subject && s.subject.storyCount > 1 && s.subject.coverage ? s.subject : null);
// A blindspot card keeps its own numbers too: the skew is the point of it.
const subjectFor = (s) => (s.mostlyCoveredBy ? null : groupOf(s));
const outletsLine = (sub) => `${plural(Number(sub.sourceCount), "outlet")} across ${Number(sub.storyCount)} stories`;

// list: true on cards that stand for a whole subject.
function kicker(s, { list = false } = {}) {
  const sub = list ? subjectFor(s) : null;
  return `
    <div class="kicker">
      <a class="tag" href="${topicHref(s.topic)}">${esc(topicLabel(s.topic))}</a>
      ${s.developing ? `<span class="dev"><i class="dot"></i>Developing</span>` : ""}
      <span>${sub ? outletsLine(sub) : plural(s.sourceCount, "outlet")}</span>
      <span>${esc(timeAgo(sub ? sub.lastUpdated : s.lastUpdated))}</span>
      ${s.ai ? `<span class="ai-tag" title="Neutral summary written by AI from the outlets' headlines and excerpts">AI brief</span>` : ""}
    </div>`;
}

function provenance(s) {
  if (s.headlineFrom?.kind === "ai") return { icon: ICON.ai, text: "Neutral headline written by AI" };
  const name = s.articles.find((a) => a.sourceId === s.headlineFrom?.sourceId)?.sourceName;
  return { icon: ICON.source, text: name ? `Plainest headline, from ${name}` : "Plainest headline among the outlets" };
}
function provenanceLine(s) {
  const p = provenance(s);
  return `<p class="provenance">${p.icon}${esc(p.text)}</p>`;
}

function blindspotBadge(s) {
  if (!s.mostlyCoveredBy) return "";
  const other = s.mostlyCoveredBy === "left" ? "right" : "left";
  return `<p class="blindspot"><span class="blindspot-label">Blindspot</span>Mostly covered by ${GROUP_LONG[s.mostlyCoveredBy]} outlets, little from the ${other}.</p>`;
}

function media(s) {
  const img = isHttp(s.image)
    ? `<img src="${esc(s.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-fallback>`
    : "";
  return `<div class="media${img ? "" : " media-empty"}"><span class="media-fallback" aria-hidden="true">${esc(topicLabel(s.topic))}</span>${img}</div>`;
}

// One-line coverage for compact lists (Most covered, topic columns), which
// show no blindspot badge, so they always use the subject's numbers.
function coverageMeta(s) {
  const sub = groupOf(s);
  const c = sub ? sub.coverage : s.coverage;
  return `${sub ? outletsLine(sub) : plural(s.sourceCount, "outlet")} · L ${Number(c.left)} · C ${Number(c.center)} · R ${Number(c.right)}`;
}

// Shown only where the kicker doesn't already say "across N stories".
function relatedNote(s) {
  const n = relatedCount(s);
  return n > 0 && !subjectFor(s) ? `<p class="related-note">${ICON.stack}${plural(n, "related update")}</p>` : "";
}

function card(s, { num = null, image = false, dek = true } = {}) {
  const text = blurb(s);
  return `
    <article class="card${image ? " has-media" : ""}">
      ${image ? `<a class="card-media" href="${storyHref(s)}" tabindex="-1" aria-hidden="true">${media(s)}</a>` : ""}
      ${num != null ? `<span class="card-num" aria-hidden="true">${String(num).padStart(2, "0")}</span>` : ""}
      <div class="card-body">
        ${kicker(s, { list: true })}
        <h3 class="card-hed"><a href="${storyHref(s)}">${esc(s.headline)}</a></h3>
        ${dek && text ? `<p class="card-dek">${esc(text)}</p>` : ""}
        ${relatedNote(s)}
        ${blindspotBadge(s)}
        ${coverageBar(subjectFor(s)?.coverage ?? s.coverage)}
      </div>
    </article>`;
}

function cardGrid(stories, opts = {}) {
  return `<div class="card-grid">${stories.map((s, i) => card(s, { ...opts, num: opts.startNum != null ? opts.startNum + i : null })).join("")}</div>`;
}

function emptyState(title, text, { heading = "h2", action = "" } = {}) {
  return `<div class="empty"><${heading}>${esc(title)}</${heading}><p>${text}</p>${action}</div>`;
}

function pageHead(kickerText, title, intro) {
  return `
    <header class="page-head">
      <p class="page-kicker">${esc(kickerText)}</p>
      <h1 class="page-title">${esc(title)}</h1>
      ${intro ? `<p class="page-intro">${intro}</p>` : ""}
    </header>`;
}

function articleItem(a) {
  const flags = [
    ...(a.flags?.loaded || []).map((w) => `<span class="flag" title="Loaded or sensational wording">Loaded: <b>${esc(w)}</b></span>`),
    ...(a.flags?.contested || []).map(
      (c) =>
        `<span class="flag" title="A term one side tends to prefer">Contested: <b>${esc(c.term)}</b>${c.plain ? ` · plainer: ${esc(c.plain)}` : ""}</span>`
    ),
    ...(a.flags?.clickbait ? [`<span class="flag" title="Clickbait phrasing">Clickbait phrasing</span>`] : []),
  ];
  return `
    <div class="art">
      <div class="art-src"><span class="art-name">${esc(a.sourceName)}</span><span class="art-lean">${esc(LEAN_LABEL[a.lean] || a.lean)} · ${esc(timeAgo(a.published))}</span></div>
      ${outLink(a.url, esc(a.title), "art-title")}
      ${flags.length ? `<div class="flags">${flags.join("")}</div>` : ""}
    </div>`;
}

function spectrumColumns(groups, emptyText, { opinion = false } = {}) {
  return `
    <div class="spectrum${opinion ? " opinion" : ""}">
      ${GROUPS.map(
        (g) => `
        <section class="spec-col spec-${g}" aria-label="${GROUP_LABEL[g]}">
          <h3 class="spec-head">${GROUP_LABEL[g]}<span>${groups[g].length}</span></h3>
          ${groups[g].length ? groups[g].map(articleItem).join("") : `<p class="spec-empty">${esc(emptyText(g))}</p>`}
        </section>`
      ).join("")}
    </div>`;
}

const perspectiveColumns = (p) =>
  spectrumColumns({ left: p.left || [], center: p.center || [], right: p.right || [] }, (g) => `No ${GROUP_LONG[g]} opinion on this.`, { opinion: true });

// ---------- views ----------
function developingStrip() {
  const dev = onePerFamily(fromIds(news.developing));
  if (!dev.length) return "";
  const s = dev[0];
  return `
    <div class="wrap">
      <a class="dev-strip" href="#/live">
        <span class="dev-strip-label"><i class="dot"></i>Developing</span>
        <span class="dev-strip-hed">${esc(s.headline)}</span>
        <span class="dev-strip-more">${dev.length > 1 ? `${dev.length - 1} more · ` : ""}See the timeline ${ICON.arrow}</span>
      </a>
    </div>`;
}

function viewHome() {
  const stories = onePerFamily(news.stories);
  if (!stories.length) {
    return `<div class="wrap">${emptyState("No stories right now", "The next hourly update will fill this page.")}</div>`;
  }
  const [lead, ...rest] = stories;
  const secondary = rest.slice(0, 3);
  const rundown = rest.slice(3);
  const shown = showAllRundown ? rundown : rundown.slice(0, RUNDOWN_PAGE);
  // Subjects (shown by their lead story) with the most outlets, counted across
  // all of a subject's stories. Ties keep rank order.
  const outletCount = (s) => Number(groupOf(s)?.sourceCount ?? s.sourceCount);
  const mostCovered = [...stories].sort((a, b) => outletCount(b) - outletCount(a)).slice(0, 5);

  return `
    ${news.stats.balanceWarning ? `<div class="wrap"><p class="notice">${esc(news.stats.balanceWarning)}</p></div>` : ""}
    ${developingStrip()}
    <div class="wrap front">
      <article class="lead">
        <a class="lead-media" href="${storyHref(lead)}" tabindex="-1" aria-hidden="true">${media(lead)}</a>
        ${kicker(lead, { list: true })}
        <h1 class="lead-hed"><a href="${storyHref(lead)}">${esc(lead.headline)}</a></h1>
        ${blurb(lead) ? `<p class="lead-dek">${esc(blurb(lead))}</p>` : ""}
        ${provenanceLine(lead)}
        ${relatedNote(lead)}
        ${blindspotBadge(lead)}
        ${coverageBar(subjectFor(lead)?.coverage ?? lead.coverage, "md")}
      </article>
      <div class="front-secondary">
        ${secondary.map((s, i) => card(s, { image: i === 0 })).join("")}
      </div>
      <aside class="most-covered" aria-labelledby="mc-h">
        <div class="section-head"><h2 id="mc-h" class="label">Most covered</h2><span class="mono-note">By outlets</span></div>
        <ol class="mc-list">
          ${mostCovered
            .map(
              (s, i) => `
            <li>
              <span class="mc-num" aria-hidden="true">${i + 1}</span>
              <div>
                <a href="${storyHref(s)}">${esc(s.headline)}</a>
                <span class="mc-meta">${coverageMeta(s)}</span>
              </div>
            </li>`
            )
            .join("")}
        </ol>
      </aside>
    </div>
    ${blindspotBand()}
    ${
      rundown.length
        ? `
    <section class="wrap rundown" aria-labelledby="rd-h">
      <div class="section-head"><h2 id="rd-h" class="label">The Rundown</h2><span class="mono-note">Ranked by coverage and recency, never clicks</span></div>
      ${cardGrid(shown, { startNum: 5 })}
      ${!showAllRundown && rundown.length > RUNDOWN_PAGE ? `<button type="button" class="btn show-all" data-action="show-all">Show all ${rundown.length} stories</button>` : ""}
    </section>`
        : ""
    }
    ${showAllRundown ? "" : topicSections(rundown.slice(RUNDOWN_PAGE))}
    ${perspectivesTeaser()}`;
}

// Newspaper-style section columns under the Rundown: the next stories in rank
// order, grouped by topic. Only stories not already shown above.
function topicSections(pool) {
  const ready = news.topics.map((t) => ({ t, list: pool.filter((s) => s.topic === t.id) })).filter((c) => c.list.length >= 2);
  // Whole rows of three on a desktop: six columns, or three, or whatever there is.
  const cols = ready.slice(0, ready.length >= SECTION_MAX ? SECTION_MAX : ready.length >= 3 ? 3 : ready.length);
  if (!cols.length) return "";
  return `
    <section class="wrap sections" aria-label="More stories by topic">
      <div class="section-grid">
        ${cols
          .map(({ t, list }) => {
            const [first, ...rest] = list.slice(0, SECTION_SIZE);
            return `
          <section class="sec-col" aria-labelledby="sec-${esc(t.id)}">
            <div class="section-head"><h2 id="sec-${esc(t.id)}" class="label">${esc(t.label)}</h2><a class="sec-more" href="${topicHref(t.id)}">All ${esc(t.label)} ${ICON.arrow}</a></div>
            <article class="sec-lead">
              <h3><a href="${storyHref(first)}">${esc(first.headline)}</a></h3>
              ${blurb(first) ? `<p>${esc(blurb(first))}</p>` : ""}
              <span class="mc-meta">${coverageMeta(first)} · ${esc(timeAgo(first.lastUpdated))}</span>
            </article>
            ${rest
              .map(
                (s) => `
            <div class="sec-item">
              <a href="${storyHref(s)}">${esc(s.headline)}</a>
              <span class="mc-meta">${coverageMeta(s)} · ${esc(timeAgo(s.lastUpdated))}</span>
            </div>`
              )
              .join("")}
          </section>`;
          })
          .join("")}
      </div>
    </section>`;
}

function blindspotBand() {
  const items = onePerFamily(fromIds(news.blindspots));
  if (!items.length) return "";
  const col = (side) => {
    const list = items.filter((s) => s.mostlyCoveredBy === side).slice(0, 2);
    return `
      <div>
        <div class="band-col-head"><i class="key key-${side}"></i><h3>Mostly covered by ${GROUP_LONG[side]} outlets</h3></div>
        ${list.length ? list.map((s) => card(s, { dek: false })).join("") : `<p class="spec-empty">None right now.</p>`}
      </div>`;
  };
  return `
    <section class="band on-night" aria-labelledby="bs-h">
      <div class="wrap band-inner">
        <div class="band-head">
          <div>
            <span class="band-kicker">What the other side is reading</span>
            <h2 id="bs-h" class="band-title">Blindspots</h2>
          </div>
          <div class="band-intro">
            <p>Stories one side is covering and the other mostly isn't.</p>
            <a class="btn" href="#/blindspots">See all ${items.length} ${ICON.arrow}</a>
          </div>
        </div>
        <div class="band-cols">${col("left")}${col("right")}</div>
      </div>
    </section>`;
}

function perspectivesTeaser() {
  const items = fromIds(news.perspectives);
  if (!items.length) return "";
  const s = items[0];
  return `
    <section class="wrap persp-teaser" aria-labelledby="pp-h">
      <div class="section-head"><h2 id="pp-h" class="label">Perspectives</h2><span class="mono-note">Arguments, not reporting</span></div>
      <h3 class="story-persp"><a href="${storyHref(s)}">${esc(s.headline)}</a></h3>
      ${perspectiveColumns(s.perspectives)}
      <a class="more-link" href="#/perspectives">All perspectives ${ICON.arrow}</a>
    </section>`;
}

function viewTopic(id) {
  const known = news.topics.some((t) => t.id === id);
  const list = onePerFamily(news.stories.filter((s) => s.topic === id));
  return `
    <div class="wrap">
      ${pageHead("Topic", known ? topicLabel(id) : "Unknown topic", known ? `${plural(list.length, "story", "stories")}, ranked by how widely they're covered.` : "")}
      ${
        list.length
          ? `<section class="list-section">${cardGrid(list)}</section>`
          : emptyState("Nothing here right now", "No stories in this topic at the moment. Check back after the next update.", { action: `<a class="btn" href="#/">Back to top stories</a>` })
      }
    </div>`;
}

function viewStory(id) {
  const s = byId.get(id);
  if (!s) {
    const saved = readSaved().find((x) => x.id === id);
    return `
      <div class="wrap">
        <a class="back" href="#/">${ICON.back}Top stories</a>
        ${emptyState(
          "This story has rolled off",
          `Stories stay for about ${Number(news.stats.windowHours)} hours.${saved ? " You saved it, so the original links are on your Saved page." : ""}`,
          { heading: "h1", action: `<a class="btn" href="${saved ? "#/saved" : "#/"}">${saved ? "Go to Saved" : "Back to top stories"}</a>` }
        )}
      </div>`;
  }
  const groups = { left: [], center: [], right: [] };
  for (const a of s.articles) groups[LEAN_GROUP[a.lean] || "center"].push(a);

  return `
    <article class="wrap story">
      <a class="back" href="#/">${ICON.back}Top stories</a>
      <div class="story-top">
        <div class="story-main">
          <header class="story-head">
            ${kicker(s)}
            <h1 class="story-hed">${esc(s.headline)}</h1>
            ${provenanceLine(s)}
            ${blurb(s) ? `<p class="story-dek">${esc(blurb(s))}</p>` : ""}
            <p class="story-meta">First reported ${esc(timeAgo(s.firstSeen))} · Updated ${esc(timeAgo(s.lastUpdated))} · ${plural(s.articleCount, "article")} from ${plural(s.sourceCount, "outlet")}</p>
            ${actionButtons(s)}
            ${blindspotBadge(s)}
          </header>
          ${isHttp(s.image) ? `<figure class="story-figure">${media(s)}<figcaption>Image from a publisher's feed</figcaption></figure>` : ""}
          ${aiBrief(s)}
        </div>
        <aside class="story-side" aria-label="Coverage and related updates">
          <section class="panel coverage-panel" aria-labelledby="cov-h">
            <div class="section-head"><h2 id="cov-h" class="label">Who covered it</h2><span class="mono-note">Distinct outlets</span></div>
            ${coverageBar(s.coverage, "lg")}
            <dl class="bylean">
              ${LEANS.map((l) => `<div><dt>${LEAN_LABEL[l]}</dt><dd>${Number(s.coverage.byLean?.[l] ?? 0)}</dd></div>`).join("")}
            </dl>
          </section>
          ${relatedSection(s)}
        </aside>
      </div>
      <section class="spectrum-section" aria-labelledby="hl-h">
        <div class="section-head"><h2 id="hl-h" class="label">Headlines across the spectrum</h2><span class="mono-note">Each outlet's own words</span></div>
        ${spectrumColumns(groups, (g) => `No ${GROUP_LONG[g]} outlets in our roster covered this.`)}
      </section>
      ${
        s.perspectives
          ? `
      <section class="spectrum-section" aria-labelledby="op-h">
        <div class="section-head"><h2 id="op-h" class="label">Perspectives</h2><span class="mono-note">Arguments, not reporting</span></div>
        <p class="note">${relatedCount(s) > 0 ? "Opinion pieces about this ongoing story and its related updates" : "Opinion pieces about this story"}, the same number from each side. They never count as coverage.</p>
        ${perspectiveColumns(s.perspectives)}
      </section>`
          : ""
      }
    </article>`;
}

function relatedSection(s) {
  const rel = fromIds(s.related);
  if (!rel.length) return "";
  return `
    <section class="panel related-panel" aria-labelledby="rel-h">
      <div class="section-head"><h2 id="rel-h" class="label">More on this story</h2><span class="mono-note">${groupOf(s) ? outletsLine(groupOf(s)) : plural(rel.length, "related update")}</span></div>
      <ul class="related-list">
        ${rel
          .map(
            (r) => `
          <li>
            <a href="${storyHref(r)}">${esc(r.headline)}</a>
            <span class="related-meta">${esc(timeAgo(r.lastUpdated))} · ${plural(r.sourceCount, "outlet")}${r.developing ? " · Developing" : ""}</span>
          </li>`
          )
          .join("")}
      </ul>
    </section>`;
}

function aiBrief(s) {
  if (!s.ai) return "";
  return `
    <section class="brief" aria-labelledby="brief-h">
      <h2 id="brief-h" class="label">The short version</h2>
      ${s.keyFacts.length ? `<ul class="facts">${s.keyFacts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
      ${
        s.framing
          ? `
        <h3 class="sub">How each side framed it</h3>
        <div class="framing">
          ${GROUPS.map(
            (g) => `
            <div class="frame frame-${g}">
              <span class="frame-label"><i class="key key-${g}"></i>${GROUP_LABEL[g]}</span>
              <p>${esc(s.framing[g] || `No ${GROUP_LONG[g]} coverage.`)}</p>
            </div>`
          ).join("")}
        </div>`
          : ""
      }
      ${s.disputed.length ? `<h3 class="sub">Disputed or unclear</h3><ul class="facts">${s.disputed.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}
      <p class="note">Written by AI (${esc(s.ai.model)}) from the headlines and excerpts of ${plural(Number(s.ai.basedOnSources), "outlet")}. Read the originals below.</p>
    </section>`;
}

function viewLive() {
  // One timeline per subject: updates in the same related group are merged.
  const dev = onePerFamily(fromIds(news.developing)).map(familyMembers);
  return `
    <div class="wrap">
      ${pageHead("Developing", "Developing stories", "Stories that several outlets have published on in the last few hours. Each timeline is the outlets' own headlines, newest first, with related updates on the same subject merged.")}
      ${
        dev.length
          ? dev.map(timelinePanel).join("")
          : emptyState("Nothing developing right now", "A story shows up here when 3 or more outlets publish on it within 3 hours.", { action: `<a class="btn" href="#/">Back to top stories</a>` })
      }
    </div>`;
}

function timelinePanel(fam) {
  const s = fam[0]; // the group's top-ranked story names the subject
  const seen = new Set();
  const arts = fam
    .flatMap((x) => x.articles)
    .filter((a) => {
      const key = a.url || a.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.published) - new Date(a.published));
  const cutoff = new Date(news.generatedAt).getTime() - 3 * 3600 * 1000;
  const recentOutlets = new Set(arts.filter((a) => new Date(a.published).getTime() >= cutoff).map((a) => a.sourceId)).size;
  const shown = arts.slice(0, TIMELINE_MAX);
  const more = arts.length - shown.length;
  return `
    <section class="timeline-panel on-night" aria-label="${esc(s.headline)}">
      <span class="tp-kicker"><i class="dot"></i>${plural(recentOutlets, "outlet")} in the last 3 hours · ${esc(topicLabel(s.topic))}${fam.length > 1 ? ` · ${plural(fam.length, "update")} merged` : ""}</span>
      <h2 class="tp-hed"><a href="${storyHref(s)}">${esc(s.headline)}</a></h2>
      ${coverageBar(groupOf(s)?.coverage ?? s.coverage)}
      <ol class="timeline">
        ${shown
          .map(
            (a) => `
          <li class="tl-item">
            <time class="tl-time" datetime="${esc(a.published)}">${esc(clock(a.published))}</time>
            <span class="tl-rail" aria-hidden="true"></span>
            <div class="tl-body">
              <span class="tl-src">${esc(a.sourceName)} · ${esc(LEAN_LABEL[a.lean] || a.lean)}</span>
              ${outLink(a.url, esc(a.title), "tl-title")}
            </div>
          </li>`
          )
          .join("")}
      </ol>
      ${more > 0 ? `<p class="tl-more">${plural(more, "earlier headline")} on <a href="${storyHref(s)}">the story page</a>${fam.length > 1 ? " and its related updates" : ""}.</p>` : ""}
    </section>`;
}

function viewBlindspots() {
  const items = onePerFamily(fromIds(news.blindspots));
  const section = (side) => {
    const list = items.filter((s) => s.mostlyCoveredBy === side);
    return `
      <section class="list-section" aria-labelledby="bs-${side}">
        <div class="section-head"><h2 id="bs-${side}" class="label">Mostly covered by ${GROUP_LONG[side]} outlets</h2><span class="mono-note">${plural(list.length, "story", "stories")}</span></div>
        ${list.length ? cardGrid(list) : `<p class="spec-empty">No stories like this right now.</p>`}
      </section>`;
  };
  return `
    <div class="wrap">
      ${pageHead("What the other side is reading", "Blindspots", "Stories one side is covering and the other mostly isn't. Reading these is the fastest way to see what the other side's readers are hearing about.")}
      ${items.length ? section("left") + section("right") : emptyState("No blindspots right now", "Every big story is being covered across the spectrum at the moment. That's a good day.")}
    </div>`;
}

function viewPerspectives() {
  const items = fromIds(news.perspectives);
  return `
    <div class="wrap">
      ${pageHead("Arguments, not reporting", "Perspectives", "Opinion writing about today's stories, always in equal numbers from the left and the right (and the center when there is some). Opinion never counts toward a story's coverage.")}
      ${
        items.length
          ? items
              .map(
                (s) => `
        <article class="persp-item">
          <div class="section-head">${kicker(s, { list: true })}</div>
          <h2 class="story-persp"><a href="${storyHref(s)}">${esc(s.headline)}</a></h2>
          ${perspectiveColumns(s.perspectives)}
        </article>`
              )
              .join("")
          : emptyState("No paired opinion yet", "A story appears here once both the left and the right have written opinion about it. Check back after the next update.")
      }
    </div>`;
}

function viewSources() {
  if (!sources) {
    return `<div class="wrap">${pageHead("Who we read", "Sources", "")}${emptyState("Source list unavailable", "Run <code>npm run build</code> to generate it.")}</div>`;
  }
  const bal = sources.balance || {};
  return `
    <div class="wrap">
      ${pageHead(
        "Who we read",
        "Sources",
        "The outlets we read, with the political lean we assign each one. The news roster is mirrored so neither side outnumbers the other. Opinion-only outlets feed Perspectives and are mirrored the same way. Leans approximate the consensus of public media-bias raters and are open to correction."
      )}
      <p class="balance-label">News outlets</p>
      <dl class="balance">
        ${LEANS.map((l) => `<div class="b-${l}"><dt>${LEAN_LABEL[l]}</dt><dd>${Number(bal[l] ?? 0)}</dd></div>`).join("")}
      </dl>
      ${
        sources.opinionBalance
          ? `
      <p class="balance-label">Opinion outlets, used only for Perspectives</p>
      <dl class="balance">
        ${LEANS.map((l) => `<div class="b-${l}"><dt>${LEAN_LABEL[l]}</dt><dd>${Number(sources.opinionBalance[l] ?? 0)}</dd></div>`).join("")}
      </dl>`
          : ""
      }
      ${LEANS.map((lean) => {
        const list = sources.sources.filter((s) => s.lean === lean);
        if (!list.length) return "";
        return `
        <section class="source-group" aria-labelledby="src-${lean}">
          <div class="section-head"><h2 id="src-${lean}" class="label">${LEAN_LABEL[lean]}</h2><span class="mono-note">${plural(list.length, "outlet")}</span></div>
          <ul class="source-list">
            ${list
              .map((s) => {
                const roles = s.roles || ["news"];
                const role = roles.includes("news") ? (roles.includes("opinion") ? "News + opinion" : "") : "Opinion only";
                return `
              <li>
                <span>
                  ${isHttp(s.homepage) ? `<a class="source-name" href="${esc(s.homepage)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}<span class="sr-only"> (opens in a new tab)</span></a>` : `<span class="source-name">${esc(s.name)}</span>`}
                  ${role ? `<span class="source-role">${role}</span>` : ""}
                  ${s.notes ? `<span class="source-note">${esc(s.notes)}</span>` : ""}
                </span>
                <span class="status ${s.status === "ok" ? "status-ok" : "status-down"}">${s.status === "ok" ? "Feed OK" : "Feed down"}</span>
              </li>`;
              })
              .join("")}
          </ul>
        </section>`;
      }).join("")}
    </div>`;
}

function viewAbout() {
  const html = document.getElementById("about-template").innerHTML;
  const t = balance?.today;
  if (!t?.headlinePicks) return html;
  const n = (v) => Number(v ?? 0);
  const hp = t.headlinePicks, sc = t.storiesCovered || {}, bs = t.blindspots || {}, ft = t.firstToCover || {};
  const section = `
        <h2 id="balance-today">Today's balance check</h2>
        <p>The site measures itself on every update. Of the ${plural(n(t.stories), "story", "stories")} on it right now, the headline shown came from outlets rated:</p>
        <dl class="balance">
          ${LEANS.map((l) => `<div class="b-${l}"><dt>${LEAN_LABEL[l]}</dt><dd>${n(hp[l])}</dd></div>`).join("")}
        </dl>
        <ul>
          <li>Covered by both left and right: ${n(sc.bothSides)}. Only by the left: ${n(sc.leftOnly)}. Only by the right: ${n(sc.rightOnly)}.</li>
          <li>Blindspots: ${n(bs.left)} covered mostly by the left, ${n(bs.right)} mostly by the right.</li>
          <li>On stories both sides covered, the left published first ${n(ft.left)} times and the right ${n(ft.right)} times; ${n(ft.tie)} were within half an hour.</li>
        </ul>
        ${(t.warnings || []).map((w) => `<p class="notice">${esc(w)}</p>`).join("")}
        <p class="note">These are counts, not verdicts on any outlet. They move with the day's news.</p>`;
  return html
    .replace("<!--balance-link-->", `<p><button type="button" class="text-link" data-action="see-balance">See today's balance check</button></p>`)
    .replace("<!--balance-section-->", section);
}

function viewSaved() {
  const list = readSaved();
  return `
    <div class="wrap">
      ${pageHead("On this device", "Saved", "Stories you saved are kept in this browser only. Nothing is sent anywhere. Stories roll off the site after a couple of days, so we keep the original links for you.")}
      ${
        list.length
          ? `<section class="list-section">${list
              .map((x) => {
                const live = byId.get(x.id);
                return `
          <article class="saved-item">
            <div class="kicker"><span class="tag">${esc(topicLabel(x.topic))}</span><span>Saved ${esc(timeAgo(x.savedAt))}</span>${live ? "" : `<span>No longer on the front page</span>`}</div>
            <h2 class="card-hed">${live ? `<a href="${storyHref(live)}">${esc(x.headline)}</a>` : esc(x.headline)}</h2>
            ${(x.links || []).length ? `<div class="saved-links">${x.links.map((l) => outLink(l.url, esc(l.sourceName), "")).join("")}</div>` : ""}
            <div class="saved-actions"><button type="button" class="btn" data-action="unsave" data-id="${esc(x.id)}">Remove</button></div>
          </article>`;
              })
              .join("")}</section>`
          : emptyState("Nothing saved yet", "Open a story and press Save to keep it here.", { action: `<a class="btn" href="#/">Browse top stories</a>` })
      }
    </div>`;
}

// ---------- router ----------
function setActiveNav(key, topic) {
  document.querySelectorAll("[data-nav]").forEach((a) =>
    a.dataset.nav === key ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")
  );
  document.querySelectorAll("#topic-row a").forEach((c) =>
    c.dataset.topic === (topic || (key === "home" ? "all" : "")) ? c.setAttribute("aria-current", "page") : c.removeAttribute("aria-current")
  );
}

// inPlace: re-render the current page with new data, without jumping to the
// top or moving focus (used when fresh news arrives).
function route({ inPlace = false } = {}) {
  if (!inPlace && speakingId && canSpeak) {
    window.speechSynthesis.cancel();
    speakingId = null;
  }
  const [page, arg] = location.hash
    .replace(/^#\/?/, "")
    .split("/")
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });

  let html;
  let nav = null;
  let topic = null;
  let title = null;
  if (page !== "") showAllRundown = false;

  switch (page) {
    case "story": {
      html = viewStory(arg);
      title = byId.get(arg)?.headline || "Story not found";
      break;
    }
    case "topic":
      html = viewTopic(arg);
      topic = arg;
      title = topicLabel(arg);
      break;
    case "live":
      html = viewLive();
      nav = "live";
      title = "Developing";
      break;
    case "blindspots":
      html = viewBlindspots();
      nav = "blindspots";
      title = "Blindspots";
      break;
    case "perspectives":
      html = viewPerspectives();
      nav = "perspectives";
      title = "Perspectives";
      break;
    case "sources":
      html = viewSources();
      nav = "sources";
      title = "Sources";
      break;
    case "about":
      html = viewAbout();
      nav = "about";
      title = "How it works";
      break;
    case "saved":
      html = viewSaved();
      nav = "saved";
      title = "Saved";
      break;
    default:
      html = viewHome();
      nav = "home";
  }

  app.innerHTML = html;
  setActiveNav(nav, topic);
  syncActionButtons();
  // The full masthead is for the front page; other pages get a compact one.
  document.body.classList.toggle("is-inner", nav !== "home");
  document.body.classList.toggle("show-topics", nav === "home" || page === "topic");
  document.title = title ? `${title} · ${news.site.name}` : `${news.site.name}: ${news.site.tagline}`;
  if (!firstRender && !inPlace) {
    window.scrollTo(0, 0);
    app.focus({ preventScroll: true });
    // Restart the short fade-in for the new page.
    app.classList.remove("route-in");
    void app.offsetWidth;
    app.classList.add("route-in");
  }
  firstRender = false;
}

// ---------- events ----------
app.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const { action, id } = btn.dataset;
  if (action === "listen") toggleListen(id);
  else if (action === "save") {
    toggleSaved(id);
    syncActionButtons();
  } else if (action === "unsave") {
    toggleSaved(id);
    route();
  } else if (action === "share") shareStory(id, btn);
  else if (action === "see-balance") document.getElementById("balance-today")?.scrollIntoView({ behavior: "smooth", block: "start" });
  else if (action === "show-all") {
    showAllRundown = true;
    const y = window.scrollY;
    app.innerHTML = viewHome();
    syncActionButtons();
    window.scrollTo(0, y);
  }
});

// Publisher images can fail (hotlink limits): fall back to the halftone panel.
document.addEventListener(
  "error",
  (e) => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.hasAttribute("data-fallback")) img.closest(".media")?.classList.add("media-empty");
  },
  true
);

// Keep other tabs' saves in sync.
window.addEventListener("storage", (e) => {
  if (e.key === SAVED_KEY) {
    updateSavedCount();
    syncActionButtons();
  }
});

// ---------- start ----------
function renderChrome() {
  const name = news.site.name;
  const wm = document.getElementById("wordmark");
  wm.innerHTML = brandHtml(name);
  wm.setAttribute("aria-label", `${name}, top stories`);
  document.getElementById("footer-wordmark").innerHTML = brandHtml(name);
  document.getElementById("nav-wordmark").innerHTML = brandHtml(name);
  document.getElementById("site-tagline").textContent = news.site.tagline;
  document.getElementById("footer-tagline").textContent = news.site.tagline;
  document.getElementById("topic-row").innerHTML =
    `<a data-topic="all" href="#/">All</a>` +
    news.topics
      .filter((t) => news.stories.some((s) => s.topic === t.id))
      .map((t) => `<a data-topic="${esc(t.id)}" href="${topicHref(t.id)}">${esc(t.label)}</a>`)
      .join("");
  renderStamps();
}

// "Updated X ago" lines; refreshed on every check so they don't go stale.
function renderStamps() {
  document.getElementById("updated").textContent = `Updated ${timeAgo(news.generatedAt)}`;
  const st = news.stats;
  document.getElementById("footer-stats").textContent =
    `Updated ${timeAgo(news.generatedAt)} · ${plural(st.stories, "story", "stories")} from ${st.outletsReporting} of ${plural(st.outlets, "outlet")} over the last ${st.windowHours} hours.` +
    (st.balanceWarning ? ` Note: ${st.balanceWarning}` : "");
}

// ---------- staying current ----------
// While the tab is visible the page re-checks data/news.json every 2 minutes
// and whenever the tab comes back into view. New stories never re-render under
// the reader: a "New stories · Update" pill appears instead, except on the
// front page at the very top, where the update is applied quietly. On the
// local server each check also counts as a visit (scripts/refresh.js).
const POLL_MS = 2 * 60 * 1000;
const FIRST_RUN_POLL_MS = 10 * 1000;
const updateBar = document.getElementById("update-bar");
let pending = null; // { news, sources } waiting for the reader
let pollInFlight = false;
let started = false;

async function fetchNews() {
  const r = await fetch("data/news.json", { cache: "no-cache" });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

async function fetchSources() {
  try {
    const r = await fetch("data/sources.json", { cache: "no-cache" });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

// Optional: the site's own balance numbers, shown on the How it works page.
async function fetchBalance() {
  try {
    const r = await fetch("data/balance.json", { cache: "no-cache" });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

function setData(n, s, b) {
  news = n;
  if (s) sources = s;
  if (b) balance = b;
  byId = new Map(news.stories.map((x) => [x.id, x]));
  indexFamilies();
  renderChrome();
}

function start() {
  if (started) return;
  started = true;
  window.addEventListener("hashchange", () => route());
  route();
}

const onFrontPage = () => location.hash.replace(/^#\/?/, "") === "";

async function poll() {
  if (pollInFlight || document.visibilityState !== "visible") return;
  pollInFlight = true;
  try {
    const n = await fetchNews();
    if (!news) {
      // First run: the data just appeared.
      setData(n, await fetchSources(), await fetchBalance());
      start();
      return;
    }
    const latest = pending?.news.generatedAt ?? news.generatedAt;
    if (n.generatedAt !== latest) {
      pending = { news: n, sources: await fetchSources(), balance: await fetchBalance() };
      if (onFrontPage() && window.scrollY < 80 && !speakingId) applyUpdate();
      else showUpdatePill();
    }
  } catch {
    /* offline, or no data yet: try again on the next check */
  } finally {
    pollInFlight = false;
    if (news) renderStamps();
  }
}

function applyUpdate() {
  if (!pending) return;
  const { news: n, sources: s, balance: b } = pending;
  pending = null;
  hideUpdatePill();
  const y = window.scrollY;
  const home = onFrontPage();
  setData(n, s, b);
  route({ inPlace: true });
  // The front page reorders, so start it from the top; elsewhere stay put.
  window.scrollTo(0, home ? 0 : y);
}

function showUpdatePill() {
  updateBar.innerHTML = `
    <button type="button" class="update-pill" data-action="apply-update">
      ${ICON.refresh}<span class="up-label">New stories</span><span class="up-sep" aria-hidden="true">·</span><span>Update</span>
    </button>`;
}

function hideUpdatePill() {
  updateBar.innerHTML = "";
}

updateBar.addEventListener("click", (e) => {
  if (e.target.closest('[data-action="apply-update"]')) applyUpdate();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") poll();
});
setInterval(poll, POLL_MS);

// ---------- page chrome: sticky nav and masthead clocks ----------
// The nav bar gets a small wordmark and a shadow once it sticks to the top.
function watchStickyNav() {
  const sentinel = document.getElementById("nav-sentinel");
  const bar = document.getElementById("nav-bar");
  if (!sentinel || !bar || !("IntersectionObserver" in window)) return;
  new IntersectionObserver(([entry]) => {
    bar.classList.toggle("is-stuck", !entry.isIntersecting && entry.boundingClientRect.top < 0);
  }).observe(sentinel);
}

// U.S. time zones under the masthead, like a row of mission-control clocks.
const CLOCK_ZONES = [
  ["ET", "America/New_York"],
  ["CT", "America/Chicago"],
  ["MT", "America/Denver"],
  ["PT", "America/Los_Angeles"],
  ["AK", "America/Anchorage"],
  ["HI", "Pacific/Honolulu"],
];
function renderClocks() {
  const el = document.getElementById("clocks");
  if (!el) return;
  const now = new Date();
  try {
    el.innerHTML = CLOCK_ZONES.map(([label, timeZone]) => {
      const t = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(now);
      return `<span><b>${label}</b>${esc(t)}</span>`;
    }).join("");
  } catch {
    el.textContent = ""; // a browser without time-zone data just shows no clocks
  }
}

async function init() {
  const narrow = window.matchMedia("(max-width: 600px)").matches;
  document.getElementById("dateline").textContent = new Date().toLocaleDateString([], {
    weekday: narrow ? "short" : "long",
    month: narrow ? "short" : "long",
    day: "numeric",
    year: "numeric",
  });
  updateSavedCount();
  watchStickyNav();
  renderClocks();
  setInterval(renderClocks, 30 * 1000);
  try {
    const [n, s, b] = await Promise.all([fetchNews(), fetchSources(), fetchBalance()]);
    setData(n, s, b);
  } catch {
    app.innerHTML = `<div class="wrap">${emptyState(
      "Getting the first batch of news",
      "This page fills in by itself as soon as the news is ready, usually within a minute. If nothing happens, run <code>npm run build</code>.",
      { heading: "h1" }
    )}</div>`;
    // Check more often until the first data arrives, then fall back to the normal pace.
    const firstRun = setInterval(() => (news ? clearInterval(firstRun) : poll()), FIRST_RUN_POLL_MS);
    return;
  }
  start();
}

init();
