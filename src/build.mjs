// Builds the site from content/ into docs/ (served by GitHub Pages).
// Usage: node src/build.mjs            -> published content only
//        node src/build.mjs --drafts   -> also includes content/_drafts (local preview; never commit that output)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import * as yaml from "js-yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT = path.join(ROOT, "content");
const DRAFTS = process.argv.includes("--drafts");
const OUT = path.join(ROOT, DRAFTS ? "preview" : "docs");

const site = readJson("site.json");
const catalog = readJson("products.json");
const products = catalog.products;
const bySlug = Object.fromEntries(products.map((p) => [p.slug, p]));

const QUESTIONS = [
  { id: "discover", name: "Discover", ask: "Can a first-time user find out what the AI can do for them?" },
  { id: "direct", name: "Direct", ask: "Can they tell it what they want, and adjust when the first result misses?" },
  { id: "verify", name: "Verify", ask: "Can they check whether the output is right before they rely on it?" },
  { id: "recover", name: "Recover", ask: "When the AI is wrong, can they correct it or start over without losing their work?" },
];
const Q = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));

const TRACKS = {
  shopping: "AI in shopping",
  multimodal: "Multimodal AI",
  accessibility: "AI for accessibility",
};

const STATUSES = {
  observed: { name: "Observed", text: "Seen in the products listed. Not yet tested with users." },
  tested: { name: "Tested", text: "Tested with users. Results are on this page." },
  withdrawn: { name: "Withdrawn", text: "Failed in later use. Kept here with the reason." },
};

const PATTERN_SECTIONS = ["Problem", "Interaction", "Where it fails", "Accessibility requirements", "How to test it"];

// Start from an empty output folder so removed content does not linger.
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const problems = [];
const warn = (msg) => problems.push(msg);

// ---------- helpers ----------

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(CONTENT, name), "utf8"));
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function md(s) {
  return marked.parse(String(s ?? ""), { mangle: false, headerIds: false });
}

function mdInline(s) {
  return marked.parseInline(String(s ?? ""));
}

function fmtDate(d) {
  if (!d) return "";
  const iso = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  const [y, m, day] = iso.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${months[m - 1]} ${day}, ${y}`;
}

function isoDate(d) {
  if (!d) return "";
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

function readEntries(dir) {
  const dirs = [path.join(CONTENT, dir)];
  if (DRAFTS) dirs.push(path.join(CONTENT, "_drafts", dir));
  const out = [];
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const file of fs.readdirSync(d).filter((f) => f.endsWith(".md")).sort()) {
      const raw = fs.readFileSync(path.join(d, file), "utf8");
      const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
      if (!m) {
        warn(`${dir}/${file}: missing front matter`);
        continue;
      }
      out.push({ file, slug: file.replace(/\.md$/, ""), data: yaml.load(m[1]) || {}, body: m[2], draft: d.includes("_drafts") });
    }
  }
  return out;
}

function shape(id, filled, size = 14) {
  const fill = filled ? "currentColor" : "none";
  const common = `fill="${fill}" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"`;
  const paths = {
    discover: `<circle cx="8" cy="8" r="6" ${common}/>`,
    direct: `<path d="M8 2.2 14.2 13.4H1.8Z" ${common}/>`,
    verify: `<rect x="2.4" y="2.4" width="11.2" height="11.2" ${common}/>`,
    recover: `<path d="M8 1.4 14.6 8 8 14.6 1.4 8Z" ${common}/>`,
  };
  return `<svg class="shape q-${id}" width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${paths[id]}</svg>`;
}

function qTag(id) {
  return `<span class="tag q-${id}">${shape(id, true, 12)}${esc(Q[id].name)}</span>`;
}

// ---------- images ----------

let sharp = null;
try {
  sharp = (await import("sharp")).default;
} catch {
  warn("sharp is not installed: screenshots are copied without resizing");
}

async function processShot(productSlug, file) {
  const candidates = [path.join(CONTENT, "shots", productSlug, file)];
  if (DRAFTS) candidates.push(path.join(CONTENT, "_drafts", "shots", productSlug, file));
  const src = candidates.find((c) => fs.existsSync(c));
  if (!src) {
    warn(`screenshot not found: shots/${productSlug}/${file}`);
    return null;
  }
  const outDir = path.join(OUT, "shots", productSlug);
  fs.mkdirSync(outDir, { recursive: true });
  const base = file.replace(/\.[^.]+$/, "");
  if (sharp && !/\.(gif|svg)$/i.test(file)) {
    const img = sharp(src).rotate();
    const meta = await img.metadata();
    const width = Math.min(meta.width || 1600, 1600);
    const outName = `${base}.webp`;
    const info = await img.resize({ width, withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(outDir, outName));
    return { path: `shots/${productSlug}/${outName}`, width: info.width, height: info.height };
  }
  fs.copyFileSync(src, path.join(outDir, file));
  return { path: `shots/${productSlug}/${file}`, width: null, height: null };
}

// ---------- load content ----------

const teardowns = [];
for (const e of readEntries("teardowns")) {
  const d = e.data;
  const slug = d.product || e.slug;
  const product = bySlug[slug];
  if (!product) {
    warn(`teardowns/${e.file}: unknown product "${slug}"`);
    continue;
  }
  const shots = [];
  for (const [i, s] of (d.shots || []).entries()) {
    if (!s.alt || !String(s.alt).trim()) warn(`teardowns/${e.file}: screenshot ${i + 1} (${s.file}) has no alt text`);
    if (!Q[s.question]) warn(`teardowns/${e.file}: screenshot ${i + 1} (${s.file}) needs question: discover | direct | verify | recover`);
    const img = await processShot(slug, s.file);
    if (img) shots.push({ ...s, img });
  }
  teardowns.push({ ...d, slug, product, shots, body: e.body, draft: e.draft });
}
const teardownBySlug = Object.fromEntries(teardowns.map((t) => [t.slug, t]));

const patterns = [];
for (const e of readEntries("patterns")) {
  const d = e.data;
  if (!d.title) warn(`patterns/${e.file}: missing title`);
  if (!Q[d.question]) warn(`patterns/${e.file}: question must be discover | direct | verify | recover`);
  if (!STATUSES[d.status || "observed"]) warn(`patterns/${e.file}: status must be observed | tested | withdrawn`);
  for (const t of d.tracks || []) if (!TRACKS[t]) warn(`patterns/${e.file}: unknown track "${t}"`);
  for (const h of PATTERN_SECTIONS) {
    if (!new RegExp(`^##\\s+${h}\\s*$`, "mi").test(e.body)) warn(`patterns/${e.file}: missing section "## ${h}"`);
  }
  const seen = [];
  for (const s of d.seen_in || []) {
    const product = bySlug[s.product];
    if (!product) {
      warn(`patterns/${e.file}: unknown product "${s.product}" in seen_in`);
      continue;
    }
    let img = null;
    let alt = s.alt;
    if (s.shot) {
      img = await processShot(s.product, s.shot);
      const fromTeardown = teardownBySlug[s.product]?.shots.find((x) => x.file === s.shot);
      alt = alt || fromTeardown?.alt;
      if (!alt) warn(`patterns/${e.file}: screenshot ${s.shot} has no alt text`);
    }
    seen.push({ ...s, product, img, alt });
  }
  patterns.push({ ...d, status: d.status || "observed", tracks: d.tracks || [], slug: e.slug, seen, body: e.body, draft: e.draft });
}
patterns.sort((a, b) => isoDate(b.published).localeCompare(isoDate(a.published)) || a.title.localeCompare(b.title));

function patternsFor(productSlug) {
  return patterns.filter((p) => p.seen.some((s) => s.product.slug === productSlug));
}

function coverage(productSlug) {
  const t = teardownBySlug[productSlug];
  const counts = { discover: 0, direct: 0, verify: 0, recover: 0 };
  if (t) for (const s of t.shots) if (counts[s.question] !== undefined) counts[s.question]++;
  return counts;
}

// ---------- layout ----------

function page({ depth, title, description, current, body, pathFromRoot }) {
  const r = depth === 0 ? "" : "../".repeat(depth);
  const full = title ? `${title} | ${site.title}` : `${site.title}, by ${site.author}`;
  const canonical = site.url + (pathFromRoot || "");
  const nav = [
    ["patterns/", "Patterns", "patterns"],
    ["products/", "Products", "products"],
    ["method/", "Method", "method"],
    ["about/", "About", "about"],
  ]
    .map(([href, label, id]) => `<a href="${r}${href}"${current === id ? ' aria-current="page"' : ""}>${label}</a>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(description || site.description)}">
<meta name="author" content="${esc(site.author)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(full)}">
<meta property="og:description" content="${esc(description || site.description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(canonical)}">
<link rel="icon" href="${r}assets/favicon.svg" type="image/svg+xml">
<link rel="preload" href="${r}assets/fonts/atkinson-hyperlegible-next-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${r}assets/styles.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-row">
    <a class="brand" href="${r || "./"}"><span class="brand-title">${esc(site.title)}</span><span class="brand-by">by ${esc(site.author)}</span></a>
    <nav aria-label="Main">${nav}</nav>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="wrap footer-row">
    <p>© ${new Date().getFullYear()} ${esc(site.author)}. Written from my own use of each product. The views are mine.</p>
    <p>Screenshots belong to the products shown and appear here for commentary.</p>
  </div>
</footer>
<script src="${r}assets/site.js" defer></script>
</body>
</html>
`;
}

function write(rel, html) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}

// ---------- components ----------

function questionsBand() {
  return `<ul class="questions" role="list">
${QUESTIONS.map(
  (q) => `  <li class="question q-${q.id}">
    ${shape(q.id, true, 28)}
    <h3>${q.name}</h3>
    <p>${q.ask}</p>
  </li>`
).join("\n")}
</ul>`;
}

function ledger(rows, r, { caption }) {
  const head = QUESTIONS.map((q) => `<th scope="col" class="cell-q"><span class="q-head q-${q.id}">${shape(q.id, true, 11)}<span>${q.name}</span></span></th>`).join("");
  const body = rows
    .map((p) => {
      const t = teardownBySlug[p.slug];
      const c = coverage(p.slug);
      const cells = QUESTIONS.map((q) => {
        const n = c[q.id];
        const label = n ? `${n} ${n === 1 ? "note" : "notes"}` : "Not yet examined";
        return `<td class="cell-q"><span class="mark q-${q.id}${n ? " is-on" : ""}" title="${q.name}: ${label}">${shape(q.id, n > 0, 15)}<span class="vh">${q.name}: ${label}</span></span></td>`;
      }).join("");
      const name = t ? `<a href="${r}products/${p.slug}/">${esc(p.name)}</a>` : esc(p.name);
      const examine = p.examine ? `<span class="examine">${esc(p.examine)}</span>` : "";
      const n = patternsFor(p.slug).length;
      return `<tr data-group="${p.group}">
  <td class="cell-rank">${p.rank}</td>
  <th scope="row" class="cell-name">${name}${examine}</th>
  <td class="cell-cat">${esc(p.category)}</td>
  ${cells}
  <td class="cell-n">${n ? `${n}` : ""}</td>
</tr>`;
    })
    .join("\n");
  return `<div class="ledger-scroll">
<table class="ledger">
<caption class="vh">${esc(caption)}</caption>
<thead><tr>
  <th scope="col" class="cell-rank">Rank</th>
  <th scope="col" class="cell-name">Product</th>
  <th scope="col" class="cell-cat">Category</th>
  ${head}
  <th scope="col" class="cell-n">Patterns</th>
</tr></thead>
<tbody>
${body}
</tbody>
</table>
</div>`;
}

function patternItem(p, r) {
  const seenIn = p.seen.map((s) => s.product.name);
  const unique = [...new Set(seenIn)];
  return `<li class="pattern-item" data-question="${p.question}" data-tracks="${p.tracks.join(" ")}">
  <a class="pattern-link" href="${r}patterns/${p.slug}/">
    <span class="pattern-q q-${p.question}">${shape(p.question, true, 18)}<span>${Q[p.question]?.name || ""}</span></span>
    <span class="pattern-main">
      <span class="pattern-title">${esc(p.title)}</span>
      <span class="pattern-summary">${esc(p.summary || "")}</span>
    </span>
    <span class="pattern-seen">${unique.length ? `Seen in ${esc(unique.join(", "))}` : ""}</span>
  </a>
</li>`;
}

function figure(img, alt, captionHtml, r) {
  if (!img) return "";
  const dims = img.width ? ` width="${img.width}" height="${img.height}"` : "";
  const portrait = img.width && img.height > img.width * 1.2;
  return `<figure class="shot${portrait ? " is-portrait" : ""}">
  <a href="${r}${img.path}"><img src="${r}${img.path}" alt="${esc(alt || "")}" loading="lazy"${dims}></a>
  ${captionHtml ? `<figcaption>${captionHtml}</figcaption>` : ""}
</figure>`;
}

function progressLine() {
  const examined = teardowns.length;
  const p = patterns.length;
  return `${examined} of ${products.length} products examined, ${p} ${p === 1 ? "pattern" : "patterns"} published`;
}

// ---------- pages ----------

function buildHome() {
  const r = "";
  const latest = patterns.slice(0, 6);
  const patternsBlock = latest.length
    ? `<ul class="pattern-list" role="list">${latest.map((p) => patternItem(p, r)).join("\n")}</ul>
       <p class="more"><a href="patterns/">All ${patterns.length} patterns</a></p>`
    : `<div class="empty">
         <p>No patterns are published yet. I am working down the list from the top, and each pattern goes up once I have used the products it comes from.</p>
         <p><a href="method/">Read how the study works</a></p>
       </div>`;
  const updates = [...site.updates]
    .concat(teardowns.filter((t) => t.used).map((t) => ({ date: isoDate(t.used), text: `Notes on ${t.product.name} added.`, href: `products/${t.slug}/` })))
    .concat(patterns.filter((p) => p.published).map((p) => ({ date: isoDate(p.published), text: `Pattern published: ${p.title}.`, href: `patterns/${p.slug}/` })))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);
  const body = `<section class="hero">
  <div class="wrap">
    <h1>How the AI products people pay for are designed to be used</h1>
    <p class="lede">I am using the 50 consumer AI products with the highest observed spending in the United States, one at a time, and writing down the interaction patterns that make them usable by people with no technical training. Each pattern states the problem it solves, where it fails, what it requires for accessibility, and how to test it.</p>
    <p class="progress">${progressLine()}</p>
  </div>
</section>

<section class="band" aria-labelledby="h-questions">
  <div class="wrap">
    <h2 id="h-questions">Every product is examined on four questions</h2>
    ${questionsBand()}
  </div>
</section>

<section class="section" aria-labelledby="h-patterns">
  <div class="wrap">
    <h2 id="h-patterns">Patterns</h2>
    ${patternsBlock}
  </div>
</section>

<section class="section" aria-labelledby="h-ledger">
  <div class="wrap">
    <h2 id="h-ledger">The 50 products</h2>
    <p class="section-intro">A shape fills in when I have used the product and recorded what it does on that question. The order follows spending by U.S. consumers, as reported by Andreessen Horowitz from YipitData panels.</p>
    ${ledger(products.slice(0, 12), r, { caption: "The first 12 of 50 products, with the questions examined so far" })}
    <p class="more"><a href="products/">All 50 products and the source of the ranking</a></p>
  </div>
</section>

<section class="section" aria-labelledby="h-updates">
  <div class="wrap">
    <h2 id="h-updates">Updates</h2>
    <ul class="updates" role="list">
      ${updates.map((u) => `<li><time datetime="${u.date}">${fmtDate(u.date)}</time><span>${u.href ? `<a href="${u.href}">${esc(u.text)}</a>` : esc(u.text)}</span></li>`).join("\n      ")}
    </ul>
  </div>
</section>`;
  write("index.html", page({ depth: 0, title: "", current: "home", body, pathFromRoot: "" }));
}

function filterBar(label, attr, options) {
  return `<div class="filters" role="group" aria-label="${esc(label)}" data-filter="${attr}">
  <button type="button" aria-pressed="true" data-value="">All</button>
  ${options.map(([value, name]) => `<button type="button" aria-pressed="false" data-value="${value}">${esc(name)}</button>`).join("\n  ")}
</div>`;
}

function buildPatternsIndex() {
  const r = "../";
  const list = patterns.length
    ? `${filterBar("Filter by question", "question", QUESTIONS.map((q) => [q.id, q.name]))}
       ${filterBar("Filter by track", "tracks", Object.entries(TRACKS))}
       <ul class="pattern-list" role="list" data-filter-target>${patterns.map((p) => patternItem(p, r)).join("\n")}</ul>
       <p class="empty filter-empty" hidden>No patterns match these filters yet.</p>`
    : `<div class="empty">
         <p>No patterns are published yet. The first ones will appear here as I work through the products.</p>
         <p><a href="${r}products/">See which products come first</a></p>
       </div>`;
  const body = `<section class="page-head">
  <div class="wrap">
    <h1>Patterns</h1>
    <p class="lede">Each pattern answers one of the four questions. It states the problem, the interaction, where it fails, what it requires for accessibility, and how to test it.</p>
  </div>
</section>
<section class="section">
  <div class="wrap">
    ${list}
  </div>
</section>
<section class="section" aria-labelledby="h-status">
  <div class="wrap narrow-left">
    <h2 id="h-status">What the status on a pattern means</h2>
    <dl class="defs">
      ${Object.values(STATUSES).map((s) => `<div><dt>${s.name}</dt><dd>${s.text}</dd></div>`).join("\n      ")}
    </dl>
  </div>
</section>`;
  write("patterns/index.html", page({ depth: 1, title: "Patterns", current: "patterns", body, pathFromRoot: "patterns/" }));
}

function buildPattern(p) {
  const r = "../../";
  const seen = p.seen
    .map((s) => {
      const hasPage = !!teardownBySlug[s.product.slug];
      const name = hasPage ? `<a href="${r}products/${s.product.slug}/">${esc(s.product.name)}</a>` : esc(s.product.name);
      const cap = `<strong>${name}</strong>${s.note ? ` ${mdInline(s.note)}` : ""}`;
      return s.img ? figure(s.img, s.alt, cap, r) : `<p class="seen-text">${cap}</p>`;
    })
    .join("\n");
  const status = STATUSES[p.status];
  const body = `<article>
<section class="page-head">
  <div class="wrap">
    <p class="crumb"><a href="${r}patterns/">Patterns</a></p>
    <h1>${esc(p.title)}</h1>
    ${p.summary ? `<p class="lede">${esc(p.summary)}</p>` : ""}
    <ul class="meta" role="list">
      <li>${qTag(p.question)}</li>
      ${p.tracks.map((t) => `<li><span class="tag">${esc(TRACKS[t])}</span></li>`).join("")}
      <li><span class="tag status-${p.status}" title="${esc(status.text)}">${status.name}</span></li>
      ${p.published ? `<li class="meta-date">Published <time datetime="${isoDate(p.published)}">${fmtDate(p.published)}</time></li>` : ""}
      ${p.updated ? `<li class="meta-date">Updated <time datetime="${isoDate(p.updated)}">${fmtDate(p.updated)}</time></li>` : ""}
    </ul>
  </div>
</section>
<section class="section">
  <div class="wrap two-col">
    <div class="prose">
      ${md(p.body)}
    </div>
    <aside class="seen" aria-labelledby="h-seen">
      <h2 id="h-seen">Seen in</h2>
      ${seen || "<p>No examples recorded yet.</p>"}
    </aside>
  </div>
</section>
</article>`;
  write(`patterns/${p.slug}/index.html`, page({ depth: 2, title: p.title, description: p.summary, current: "patterns", body, pathFromRoot: `patterns/${p.slug}/` }));
}

function buildProductsIndex() {
  const r = "../";
  const s = catalog.source;
  const body = `<section class="page-head">
  <div class="wrap">
    <h1>The 50 products</h1>
    <p class="lede">These are the consumer AI products that people in the United States spend the most on. I am using them in order. A product's name becomes a link once my notes on it are up.</p>
    <p class="progress">${progressLine()}</p>
  </div>
</section>
<section class="section">
  <div class="wrap">
    ${filterBar("Filter by kind of product", "group", Object.entries(catalog.groups))}
    <div data-filter-target>
    ${ledger(products, r, { caption: "All 50 products, with the questions examined so far" })}
    </div>
  </div>
</section>
<section class="section" aria-labelledby="h-source">
  <div class="wrap narrow-left prose">
    <h2 id="h-source">Where the ranking comes from</h2>
    <p>The list is the spending ranking in <a href="${esc(s.url)}">${esc(s.title)}</a>, published by ${esc(s.publisher)} on ${fmtDate(s.published)} and written by ${esc(s.author)}. It ranks companies by ${esc(s.basis.charAt(0).toLowerCase() + s.basis.slice(1))}.</p>
    <p>The report shows the ranking as a chart. I took the order from the transcription in <a href="${esc(s.rankOrderFrom.url)}">${esc(s.rankOrderFrom.title)}</a> by ${esc(s.rankOrderFrom.publisher)}, and checked that its 50 names match the 50 companies the report lists.</p>
    <h3>What the ranking does not show</h3>
    <ul>
      <li>It is not company revenue. It leaves out spending outside the United States and most business contracts.</li>
      <li>It ranks companies. Where a company sells several products, the table names the one I examine.</li>
      <li>The categories are the transcription's. The seven kinds used in the filter are my own grouping.</li>
    </ul>
  </div>
</section>`;
  write("products/index.html", page({ depth: 1, title: "The 50 products", current: "products", body, pathFromRoot: "products/" }));
}

function buildProduct(t) {
  const r = "../../";
  const p = t.product;
  const facts = [
    ["Rank", `${p.rank} of ${products.length}`],
    ["Category", p.category],
    p.examine ? ["Product examined", p.examine] : null,
    t.used ? ["Used on", fmtDate(t.used)] : null,
    t.platform ? ["Platform", t.platform] : null,
    t.plan ? ["Plan", t.plan] : null,
  ].filter(Boolean);
  const groups = QUESTIONS.map((q) => {
    const shots = t.shots.filter((s) => s.question === q.id);
    if (!shots.length) return "";
    return `<section class="q-section" aria-labelledby="h-${q.id}">
  <div class="q-section-head q-${q.id}">
    ${shape(q.id, true, 22)}
    <div><h2 id="h-${q.id}">${q.name}</h2><p>${q.ask}</p></div>
  </div>
  <div class="shots">
    ${shots.map((s) => figure(s.img, s.alt, s.note ? mdInline(s.note) : "", r)).join("\n    ")}
  </div>
</section>`;
  }).join("\n");
  const related = patternsFor(p.slug);
  const body = `<article>
<section class="page-head">
  <div class="wrap">
    <p class="crumb"><a href="${r}products/">Products</a></p>
    <h1>${esc(p.examine || p.name)}</h1>
    ${t.summary ? `<p class="lede">${esc(t.summary)}</p>` : ""}
    <dl class="facts">
      ${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("\n      ")}
    </dl>
  </div>
</section>
<section class="section">
  <div class="wrap">
    ${groups}
  </div>
</section>
${t.body.trim() ? `<section class="section"><div class="wrap narrow-left prose">${md(t.body)}</div></section>` : ""}
${related.length ? `<section class="section" aria-labelledby="h-related"><div class="wrap"><h2 id="h-related">Patterns seen in ${esc(p.examine || p.name)}</h2><ul class="pattern-list" role="list">${related.map((x) => patternItem(x, r)).join("\n")}</ul></div></section>` : ""}
</article>`;
  write(`products/${p.slug}/index.html`, page({ depth: 2, title: p.examine || p.name, description: t.summary, current: "products", body, pathFromRoot: `products/${p.slug}/` }));
}

function buildStatic(name, title) {
  const raw = fs.readFileSync(path.join(CONTENT, "pages", `${name}.md`), "utf8");
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const data = m ? yaml.load(m[1]) : {};
  let content = md(m ? m[2] : raw);
  content = content.replace("<p>{{questions}}</p>", questionsBand());
  const body = `<section class="page-head">
  <div class="wrap">
    <h1>${esc(data.title || title)}</h1>
    ${data.lede ? `<p class="lede">${esc(data.lede)}</p>` : ""}
  </div>
</section>
<section class="section">
  <div class="wrap narrow-left prose">
    ${content}
  </div>
</section>`;
  write(`${name}/index.html`, page({ depth: 1, title: data.title || title, description: data.lede, current: name, body, pathFromRoot: `${name}/` }));
}

function build404() {
  // GitHub Pages serves this file for any missing path, so its links must be absolute.
  let html = page({
    depth: 0,
    title: "Page not found",
    current: "",
    pathFromRoot: "404.html",
    body: `<section class="page-head"><div class="wrap"><h1>This page does not exist</h1><p class="lede">The address may have changed. The patterns and the list of products are still where they were.</p><p><a href="patterns/">Patterns</a> or <a href="products/">the 50 products</a></p></div></section>`,
  });
  html = html.replace(/(href|src)="(?!https?:|#|\/)([^"]*)"/g, (_, attr, url) => `${attr}="${site.basePath}${url === "./" ? "" : url}"`);
  write("404.html", html);
}

function buildSitemap() {
  const urls = ["", "patterns/", "products/", "method/", "about/"]
    .concat(patterns.map((p) => `patterns/${p.slug}/`))
    .concat(teardowns.map((t) => `products/${t.slug}/`));
  write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${site.url}${u}</loc></url>`).join("\n")}\n</urlset>\n`);
}

function copyAssets() {
  const assets = path.join(OUT, "assets");
  fs.mkdirSync(path.join(assets, "fonts"), { recursive: true });
  for (const f of ["styles.css", "site.js", "favicon.svg"]) fs.copyFileSync(path.join(ROOT, "src", f), path.join(assets, f));
  const fontDir = path.join(ROOT, "node_modules", "@fontsource-variable", "atkinson-hyperlegible-next", "files");
  for (const f of ["atkinson-hyperlegible-next-latin-wght-normal.woff2", "atkinson-hyperlegible-next-latin-wght-italic.woff2"]) {
    fs.copyFileSync(path.join(fontDir, f), path.join(assets, "fonts", f));
  }
  fs.writeFileSync(path.join(OUT, ".nojekyll"), "");
}

// ---------- run ----------

copyAssets();
buildHome();
buildPatternsIndex();
patterns.forEach(buildPattern);
buildProductsIndex();
teardowns.forEach(buildProduct);
buildStatic("method", "Method");
buildStatic("about", "About");
build404();
buildSitemap();

if (problems.length) {
  console.error(`\n${problems.length} problem(s) to fix:`);
  for (const p of problems) console.error(`  - ${p}`);
  if (!DRAFTS) process.exitCode = 1;
}
console.log(`Built ${path.relative(ROOT, OUT)}/: ${teardowns.length} product notes, ${patterns.length} patterns${DRAFTS ? " (with drafts)" : ""}`);
