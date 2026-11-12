// Placeholder front end. Reads data/news.json and data/sources.json (shape
// documented in docs/DATA_CONTRACT.md) and renders with plain DOM strings.
// Routes: #/  #/topic/<id>  #/blindspots  #/story/<id>  #/sources  #/about

const app = document.getElementById("app");
const GROUP_LABEL = { left: "Left", center: "Center", right: "Right" };
const LEAN_LABEL = { left: "Left", "lean-left": "Lean left", center: "Center", "lean-right": "Lean right", right: "Right" };
const LEAN_GROUP = { left: "left", "lean-left": "left", center: "center", "lean-right": "right", right: "right" };

let news = null;
let sources = null;

// ---------- helpers ----------
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");

function timeAgo(iso) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const topicLabel = (id) => news.topics.find((t) => t.id === id)?.label ?? id;

function coverageBar(c) {
  const total = c.left + c.center + c.right || 1;
  const pct = (n) => ((n / total) * 100).toFixed(1);
  return `
    <div class="coverage">
      <div class="coverage-bar" role="img" aria-label="${c.left} left, ${c.center} center, ${c.right} right-leaning outlets">
        <span class="seg-left" style="width:${pct(c.left)}%"></span>
        <span class="seg-center" style="width:${pct(c.center)}%"></span>
        <span class="seg-right" style="width:${pct(c.right)}%"></span>
      </div>
      <div class="coverage-legend">
        <span><span class="dot seg-left"></span>Left <b>${c.left}</b></span>
        <span><span class="dot seg-center"></span>Center <b>${c.center}</b></span>
        <span><span class="dot seg-right"></span>Right <b>${c.right}</b></span>
      </div>
    </div>`;
}

function blindspotBadge(story) {
  if (!story.mostlyCoveredBy) return "";
  const other = story.mostlyCoveredBy === "left" ? "right" : "left";
  return `<span class="blindspot-badge">Blindspot: covered mostly by the ${story.mostlyCoveredBy}, little from the ${other}</span>`;
}

function storyCard(story, lead = false) {
  const blurb = story.summary || story.snippet;
  return `
    <article class="story-card${lead ? " lead" : ""}">
      <div class="story-meta">
        <span class="topic-label">${esc(topicLabel(story.topic))}</span>
        <span>&middot;</span>
        <span>${story.sourceCount} outlets</span>
        <span>&middot;</span>
        <span>updated ${timeAgo(story.lastUpdated)}</span>
        ${story.ai ? `<span class="ai-tag" title="Neutral summary written by AI from the outlets' headlines and excerpts">AI brief</span>` : ""}
      </div>
      <h2 class="story-headline"><a href="#/story/${encodeURIComponent(story.id)}">${esc(story.headline)}</a></h2>
      ${blurb ? `<p class="story-snippet">${esc(blurb)}</p>` : ""}
      ${blindspotBadge(story)}
      ${coverageBar(story.coverage)}
    </article>`;
}

function storyList(stories, { leadFirst = true } = {}) {
  if (!stories.length) return `<p class="empty">No stories here right now. Check back after the next update.</p>`;
  return `<div class="story-list">${stories.map((s, i) => storyCard(s, leadFirst && i === 0)).join("")}</div>`;
}

// ---------- views ----------
function viewHome(topic) {
  const list = topic ? news.stories.filter((s) => s.topic === topic) : news.stories;
  const title = topic ? topicLabel(topic) : "Top stories";
  return `
    <h1 class="page-title">${esc(title)}</h1>
    <p class="page-intro">Ranked by how many outlets cover a story, how much of the spectrum covers it, and how recent it is. Never by clicks.</p>
    ${storyList(list)}`;
}

function viewBlindspots() {
  const byId = new Map(news.stories.map((s) => [s.id, s]));
  const items = news.blindspots.map((id) => byId.get(id)).filter(Boolean);
  const left = items.filter((s) => s.mostlyCoveredBy === "left");
  const right = items.filter((s) => s.mostlyCoveredBy === "right");
  return `
    <h1 class="page-title">Blindspots</h1>
    <p class="page-intro">Stories one side is covering and the other mostly isn't. Reading these is the fastest way to see what the other side's readers are hearing about.</p>
    <h2>Mostly covered by left-leaning outlets</h2>
    ${storyList(left, { leadFirst: false })}
    <h2 style="margin-top:32px">Mostly covered by right-leaning outlets</h2>
    ${storyList(right, { leadFirst: false })}`;
}

function articleItem(a) {
  const flags = [
    ...a.flags.loaded.map((w) => `<span class="flag" title="Loaded or sensational wording">${esc(w)}</span>`),
    ...a.flags.contested.map(
      (c) => `<span class="flag" title="Term preferred by the ${esc(c.codedAs)}${c.plain ? `; plainer: ${esc(c.plain)}` : ""}">${esc(c.term)}</span>`
    ),
    ...(a.flags.clickbait ? [`<span class="flag" title="Clickbait phrasing">clickbait</span>`] : []),
  ];
  return `
    <div class="article">
      <div class="article-source"><span>${esc(a.sourceName)}</span><span>${esc(LEAN_LABEL[a.lean])} &middot; ${timeAgo(a.published)}</span></div>
      <a href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a>
      ${flags.length ? `<div class="flags">${flags.join("")}</div>` : ""}
    </div>`;
}

function viewStory(id) {
  const story = news.stories.find((s) => s.id === id);
  if (!story) return `<a class="back" href="#/">&larr; Back</a><p class="empty">That story has rolled off the front page. Stories stay for about ${news.stats.windowHours} hours.</p>`;

  const groups = { left: [], center: [], right: [] };
  for (const a of story.articles) groups[LEAN_GROUP[a.lean]].push(a);

  const brief = story.ai
    ? `
      <section class="brief">
        <h2>Key facts</h2>
        <ul>${story.keyFacts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
      </section>
      ${story.framing ? `
      <section class="brief">
        <h2>How each side framed it</h2>
        <div class="framing">
          ${["left", "center", "right"].map((g) => `<div class="f-${g}"><strong>${GROUP_LABEL[g]}</strong>${esc(story.framing[g] || "No coverage from this side.")}</div>`).join("")}
        </div>
      </section>` : ""}
      ${story.disputed.length ? `
      <section class="brief">
        <h2>Disputed or unclear</h2>
        <ul>${story.disputed.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>
      </section>` : ""}
      <p class="ai-note">Brief written by AI (${esc(story.ai.model)}) from the headlines and excerpts of ${story.ai.basedOnSources} outlets. Read the originals below.</p>`
    : "";

  const headlineNote =
    story.headlineFrom.kind === "selected"
      ? `<p class="ai-note">Headline shown is the plainest-worded one among the outlets below (from ${esc(story.articles.find((a) => a.sourceId === story.headlineFrom.sourceId)?.sourceName ?? "an outlet")}).</p>`
      : "";

  return `
    <a class="back" href="#/">&larr; All stories</a>
    <article class="story-page">
      <div class="story-meta">
        <span class="topic-label">${esc(topicLabel(story.topic))}</span><span>&middot;</span>
        <span>first reported ${timeAgo(story.firstSeen)}</span><span>&middot;</span>
        <span>updated ${timeAgo(story.lastUpdated)}</span>
      </div>
      <h1>${esc(story.headline)}</h1>
      ${story.summary ? `<p class="summary">${esc(story.summary)}</p>` : story.snippet ? `<p class="summary">${esc(story.snippet)}</p>` : ""}
      ${headlineNote}
      ${blindspotBadge(story)}
      <div style="max-width:420px;margin-top:12px">${coverageBar(story.coverage)}</div>
      ${brief}
      <h2 style="margin-top:28px">Headlines across the spectrum</h2>
      <div class="spectrum">
        ${["left", "center", "right"].map((g) => `
          <section class="spectrum-col c-${g}">
            <h2>${GROUP_LABEL[g]} (${groups[g].length})</h2>
            ${groups[g].length ? groups[g].map(articleItem).join("") : `<p class="col-empty">No ${g === "center" ? "center" : g + "-leaning"} outlets in our roster covered this.</p>`}
          </section>`).join("")}
      </div>
    </article>`;
}

function viewSources() {
  if (!sources) return `<p class="empty">Source list unavailable.</p>`;
  const order = ["left", "lean-left", "center", "lean-right", "right"];
  return `
    <h1 class="page-title">Sources</h1>
    <p class="page-intro">The outlets we read, with the political lean we assign each one. The roster is mirrored so neither side outnumbers the other: ${order.map((l) => `${sources.balance[l]} ${LEAN_LABEL[l].toLowerCase()}`).join(", ")}. Leans approximate the consensus of public media-bias raters and are open to correction.</p>
    ${order.map((lean) => `
      <section class="source-group">
        <h2><span class="dot seg-${LEAN_GROUP[lean]}"></span>${LEAN_LABEL[lean]}</h2>
        <table class="source-table"><tbody>
          ${sources.sources.filter((s) => s.lean === lean).map((s) => `
            <tr>
              <td><a href="${esc(safeUrl(s.homepage))}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a>${s.notes ? `<br><small>${esc(s.notes)}</small>` : ""}</td>
              <td class="${s.status === "ok" ? "status-ok" : "status-down"}" style="text-align:right">${s.status === "ok" ? "Feed OK" : "Feed down"}</td>
            </tr>`).join("")}
        </tbody></table>
      </section>`).join("")}`;
}

function viewAbout() {
  return document.getElementById("about-template").innerHTML;
}

// ---------- router ----------
function setActiveNav(key, topic) {
  document.querySelectorAll("[data-nav]").forEach((a) => a.dataset.nav === key ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  document.querySelectorAll("#topic-row .chip").forEach((c) =>
    c.dataset.topic === (topic || (key === "home" ? "all" : "")) ? c.setAttribute("aria-current", "page") : c.removeAttribute("aria-current")
  );
}

function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  const [page, arg] = parts;
  let html;
  if (page === "story") { html = viewStory(arg); setActiveNav(null); }
  else if (page === "topic") { html = viewHome(arg); setActiveNav(null, arg); }
  else if (page === "blindspots") { html = viewBlindspots(); setActiveNav("blindspots"); }
  else if (page === "sources") { html = viewSources(); setActiveNav("sources"); }
  else if (page === "about") { html = viewAbout(); setActiveNav("about"); }
  else { html = viewHome(null); setActiveNav("home"); }
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

async function init() {
  try {
    const [n, s] = await Promise.all([
      fetch("data/news.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
      fetch("data/sources.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    news = n;
    sources = s;
  } catch {
    app.innerHTML = `<p class="empty">No news data yet. Run <code>npm run build</code> to fetch the latest stories, then reload.</p>`;
    return;
  }
  document.getElementById("site-name").textContent = news.site.name;
  document.getElementById("site-tagline").textContent = news.site.tagline;
  document.title = news.site.name;
  document.getElementById("topic-row").innerHTML =
    `<a class="chip" data-topic="all" href="#/">All</a>` +
    news.topics
      .filter((t) => news.stories.some((s) => s.topic === t.id))
      .map((t) => `<a class="chip" data-topic="${esc(t.id)}" href="#/topic/${esc(t.id)}">${esc(t.label)}</a>`)
      .join("");
  document.getElementById("footer-stats").textContent =
    `Updated ${timeAgo(news.generatedAt)} · ${news.stats.stories} stories from ${news.stats.outletsReporting} of ${news.stats.outlets} outlets over the last ${news.stats.windowHours} hours.`;
  window.addEventListener("hashchange", route);
  route();
}

init();
