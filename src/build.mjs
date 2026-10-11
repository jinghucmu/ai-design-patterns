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

// The two halves of every review.
const SIDES = [
  { id: "learn", name: "Worth learning from", intro: "What the product's design does well enough that other teams should study it." },
  { id: "improve", name: "Needs improvement", intro: "Where the design gets in the way, and what I would change." },
];

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
  return marked.parse(String(s ?? ""));
}

function isoDate(d) {
  if (!d) return "";
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

function fmtDate(d) {
  if (!d) return "";
  const [y, m, day] = isoDate(d).split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${months[m - 1]} ${day}, ${y}`;
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
      out.push({ file, slug: file.replace(/\.md$/, ""), data: yaml.load(m[1]) || {}, body: m[2] });
    }
  }
  return out;
}

function sideMark(id, size = 14) {
  // A plus for strengths and a minus for weaknesses, so the two never rely on colour alone.
  const bar = `<path d="M3 8h10" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`;
  const plus = `${bar}<path d="M8 3v10" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`;
  return `<svg class="side-mark" width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${id === "learn" ? plus : bar}</svg>`;
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

const reviews = [];
for (const e of readEntries("reviews")) {
  const d = e.data;
  const slug = d.product || e.slug;
  const product = bySlug[slug];
  if (!product) {
    warn(`reviews/${e.file}: unknown product "${slug}"`);
    continue;
  }
  const review = { ...d, slug, product, body: e.body };
  for (const side of SIDES) {
    const points = [];
    for (const [i, pt] of (d[side.id] || []).entries()) {
      if (!pt.title) warn(`reviews/${e.file}: ${side.id} point ${i + 1} has no title`);
      const shots = [];
      for (const s of pt.shots || []) {
        if (!s.alt || !String(s.alt).trim()) warn(`reviews/${e.file}: screenshot ${s.file} has no alt text`);
        const img = await processShot(slug, s.file);
        if (img) shots.push({ ...s, img });
      }
      points.push({ ...pt, shots });
    }
    review[side.id] = points;
  }
  if (!review.learn.length && !review.improve.length) warn(`reviews/${e.file}: no points under learn or improve`);
  reviews.push(review);
}
reviews.sort((a, b) => isoDate(b.used).localeCompare(isoDate(a.used)) || a.product.rank - b.product.rank);
const reviewBySlug = Object.fromEntries(reviews.map((r) => [r.slug, r]));

// ---------- layout ----------

function page({ depth, title, description, current, body, pathFromRoot }) {
  const r = depth === 0 ? "" : "../".repeat(depth);
  const full = title ? `${title} | ${site.title}` : `${site.title}, by ${site.author}`;
  const canonical = site.url + (pathFromRoot || "");
  const nav = [
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

function productTable(rows, r, { caption }) {
  const body = rows
    .map((p) => {
      const rev = reviewBySlug[p.slug];
      const name = rev ? `<a href="${r}products/${p.slug}/">${esc(p.name)}</a>` : esc(p.name);
      const examine = p.examine ? `<span class="examine">${esc(p.examine)}</span>` : "";
      const status = rev
        ? `Reviewed${rev.used ? ` <time datetime="${isoDate(rev.used)}">${fmtDate(rev.used)}</time>` : ""}`
        : `<span class="pending">Not yet reviewed</span>`;
      return `<tr data-group="${p.group}">
  <td class="cell-rank">${p.rank}</td>
  <th scope="row" class="cell-name">${name}${examine}</th>
  <td class="cell-cat">${esc(p.category)}</td>
  <td class="cell-status">${status}</td>
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
  <th scope="col" class="cell-status">Review</th>
</tr></thead>
<tbody>
${body}
</tbody>
</table>
</div>`;
}

function reviewItem(rev, r) {
  const p = rev.product;
  const line = (side) => {
    const pts = rev[side];
    if (!pts.length) return "";
    const more = pts.length > 1 ? ` <span class="more-count">and ${pts.length - 1} more</span>` : "";
    return `<span class="review-point side-${side}">${sideMark(side, 13)}<span>${esc(pts[0].title)}${more}</span></span>`;
  };
  return `<li class="review-item">
  <a class="review-link" href="${r}products/${p.slug}/">
    <span class="review-name">${esc(p.examine || p.name)}<span class="review-rank">Rank ${p.rank}</span></span>
    <span class="review-points">${line("learn")}${line("improve")}</span>
  </a>
</li>`;
}

function figure(shot, r) {
  const img = shot.img;
  const dims = img.width ? ` width="${img.width}" height="${img.height}"` : "";
  const portrait = img.width && img.height > img.width * 1.2;
  return `<figure class="shot${portrait ? " is-portrait" : ""}">
  <a href="${r}${img.path}"><img src="${r}${img.path}" alt="${esc(shot.alt || "")}" loading="lazy"${dims}></a>
  ${shot.caption ? `<figcaption>${marked.parseInline(String(shot.caption))}</figcaption>` : ""}
</figure>`;
}

function progressLine() {
  return `${reviews.length} of ${products.length} products reviewed`;
}

function filterBar(label, attr, options) {
  return `<div class="filters" role="group" aria-label="${esc(label)}" data-filter="${attr}">
  <button type="button" aria-pressed="true" data-value="">All</button>
  ${options.map(([value, name]) => `<button type="button" aria-pressed="false" data-value="${value}">${esc(name)}</button>`).join("\n  ")}
</div>`;
}

// ---------- pages ----------

function buildHome() {
  const r = "";
  const latest = reviews.slice(0, 6);
  const latestBlock = latest.length
    ? `<ul class="review-list" role="list">${latest.map((x) => reviewItem(x, r)).join("\n")}</ul>`
    : `<div class="empty">
         <p>No reviews are published yet. I am working down the list from the top, and each review goes up after I have used the product.</p>
         <p><a href="method/">Read how the reviews are done</a></p>
       </div>`;
  const updates = [...site.updates]
    .concat(reviews.filter((x) => x.used).map((x) => ({ date: isoDate(x.used), text: `Review of ${x.product.examine || x.product.name} added.`, href: `products/${x.slug}/` })))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);
  const body = `<section class="hero">
  <div class="wrap">
    <h1>What the AI products people pay for get right, and where they fall short</h1>
    <p class="lede">I am using the 50 consumer AI products with the highest observed spending in the United States, one at a time. For each one I write down what its design does well enough that other teams should learn from it, and what it still needs to fix.</p>
    <p class="progress">${progressLine()}</p>
  </div>
</section>

<section class="band" aria-labelledby="h-sides">
  <div class="wrap">
    <h2 id="h-sides">Every review has two parts</h2>
    <ul class="sides" role="list">
      ${SIDES.map((s) => `<li class="side side-${s.id}">${sideMark(s.id, 26)}<h3>${s.name}</h3><p>${s.intro}</p></li>`).join("\n      ")}
    </ul>
  </div>
</section>

<section class="section" aria-labelledby="h-latest">
  <div class="wrap">
    <h2 id="h-latest">Latest reviews</h2>
    ${latestBlock}
  </div>
</section>

<section class="section" aria-labelledby="h-ledger">
  <div class="wrap">
    <h2 id="h-ledger">The 50 products</h2>
    <p class="section-intro">The order follows spending by U.S. consumers, as reported by Andreessen Horowitz from YipitData panels.</p>
    ${productTable(products.slice(0, 12), r, { caption: "The first 12 of 50 products and whether each has been reviewed" })}
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

function buildProductsIndex() {
  const r = "../";
  const s = catalog.source;
  const body = `<section class="page-head">
  <div class="wrap">
    <h1>The 50 products</h1>
    <p class="lede">These are the consumer AI products that people in the United States spend the most on. I am using them in order. A product's name becomes a link once my review of it is up.</p>
    <p class="progress">${progressLine()}</p>
  </div>
</section>
<section class="section">
  <div class="wrap">
    ${filterBar("Filter by kind of product", "group", Object.entries(catalog.groups))}
    <div data-filter-target>
    ${productTable(products, r, { caption: "All 50 products and whether each has been reviewed" })}
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
      <li>It ranks companies. Where a company sells several products, the table names the one I review.</li>
      <li>The categories are the transcription's. The seven kinds used in the filter are my own grouping.</li>
    </ul>
  </div>
</section>`;
  write("products/index.html", page({ depth: 1, title: "The 50 products", current: "products", body, pathFromRoot: "products/" }));
}

function buildProduct(rev) {
  const r = "../../";
  const p = rev.product;
  const facts = [
    ["Rank", `${p.rank} of ${products.length}`],
    ["Category", p.category],
    p.examine ? ["Company", p.name] : null,
    rev.used ? ["Used on", fmtDate(rev.used)] : null,
    rev.platform ? ["Platform", rev.platform] : null,
    rev.plan ? ["Plan", rev.plan] : null,
  ].filter(Boolean);
  const sides = SIDES.map((side) => {
    const points = rev[side.id];
    if (!points.length) return "";
    return `<section class="side-section side-${side.id}" aria-labelledby="h-${side.id}">
  <div class="side-head">
    ${sideMark(side.id, 22)}
    <h2 id="h-${side.id}">${side.name}</h2>
  </div>
  <ul class="points" role="list">
    ${points
      .map(
        (pt) => `<li class="point">
      <div class="point-text">
        <h3>${esc(pt.title)}</h3>
        ${pt.text ? `<div class="prose">${md(pt.text)}</div>` : ""}
      </div>
      ${pt.shots.length ? `<div class="point-shots">${pt.shots.map((s) => figure(s, r)).join("\n")}</div>` : ""}
    </li>`
      )
      .join("\n    ")}
  </ul>
</section>`;
  }).join("\n");
  const body = `<article>
<section class="page-head">
  <div class="wrap">
    <p class="crumb"><a href="${r}products/">Products</a></p>
    <h1>${esc(p.examine || p.name)}</h1>
    ${rev.summary ? `<p class="lede">${esc(rev.summary)}</p>` : ""}
    <dl class="facts">
      ${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("\n      ")}
    </dl>
  </div>
</section>
<section class="section">
  <div class="wrap">
    ${sides}
  </div>
</section>
${rev.body.trim() ? `<section class="section" aria-labelledby="h-notes"><div class="wrap narrow-left prose"><h2 id="h-notes">Other notes</h2>${md(rev.body)}</div></section>` : ""}
</article>`;
  write(`products/${p.slug}/index.html`, page({ depth: 2, title: p.examine || p.name, description: rev.summary, current: "products", body, pathFromRoot: `products/${p.slug}/` }));
}

function buildStatic(name, title) {
  const raw = fs.readFileSync(path.join(CONTENT, "pages", `${name}.md`), "utf8");
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const data = m ? yaml.load(m[1]) : {};
  const body = `<section class="page-head">
  <div class="wrap">
    <h1>${esc(data.title || title)}</h1>
    ${data.lede ? `<p class="lede">${esc(data.lede)}</p>` : ""}
  </div>
</section>
<section class="section">
  <div class="wrap narrow-left prose">
    ${md(m ? m[2] : raw)}
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
    body: `<section class="page-head"><div class="wrap"><h1>This page does not exist</h1><p class="lede">The address may have changed. The list of products is still where it was.</p><p><a href="products/">See the 50 products</a></p></div></section>`,
  });
  html = html.replace(/(href|src)="(?!https?:|#|\/)([^"]*)"/g, (_, attr, url) => `${attr}="${site.basePath}${url === "./" ? "" : url}"`);
  write("404.html", html);
}

function buildSitemap() {
  const urls = ["", "products/", "method/", "about/"].concat(reviews.map((x) => `products/${x.slug}/`));
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
buildProductsIndex();
reviews.forEach(buildProduct);
buildStatic("method", "Method");
buildStatic("about", "About");
build404();
buildSitemap();

if (problems.length) {
  console.error(`\n${problems.length} problem(s) to fix:`);
  for (const p of problems) console.error(`  - ${p}`);
  if (!DRAFTS) process.exitCode = 1;
}
console.log(`Built ${path.relative(ROOT, OUT)}/: ${reviews.length} reviews${DRAFTS ? " (with drafts)" : ""}`);
