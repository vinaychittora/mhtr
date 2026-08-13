#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "_site");
const siteOrigin = "https://mhtr.in";
const failures = [];

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(fullPath);
    else if (entry.isFile() && entry.name.endsWith(".html")) yield fullPath;
  }
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function routeForFile(filePath) {
  const relative = path.relative(outDir, filePath).split(path.sep).join("/");
  if (relative === "index.html") return "/";
  if (relative.endsWith("/index.html")) return `/${relative.slice(0, -"index.html".length)}`;
  return `/${relative}`;
}

function targetFile(pathname) {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded.replace(/^\/+/, "");
  if (!relative) return path.join(outDir, "index.html");
  if (decoded.endsWith("/")) return path.join(outDir, relative, "index.html");

  const exact = path.join(outDir, relative);
  if (fs.existsSync(exact)) return exact;
  return path.join(exact, "index.html");
}

function idsIn(html) {
  const ids = new Set();
  for (const match of html.matchAll(/\b(?:id|name)="([^"]+)"/g)) ids.add(decodeHtml(match[1]));
  return ids;
}

const pages = new Map();
for (const filePath of walk(outDir)) {
  const html = fs.readFileSync(filePath, "utf8");
  pages.set(filePath, { html, ids: idsIn(html), route: routeForFile(filePath) });
}

for (const [filePath, page] of pages) {
  const attributes = Array.from(page.html.matchAll(/\b(?:href|src)="([^"]+)"/g), (match) => decodeHtml(match[1]));

  for (const rawValue of attributes) {
    if (!rawValue || /^(?:mailto:|tel:|data:|blob:|javascript:)/i.test(rawValue)) continue;

    let url;
    try {
      url = new URL(rawValue, `${siteOrigin}${page.route}`);
    } catch {
      failures.push(`${page.route}: invalid local URL ${rawValue}`);
      continue;
    }

    if (url.origin !== siteOrigin) continue;

    const destination = targetFile(url.pathname);
    if (!fs.existsSync(destination)) {
      failures.push(`${page.route}: missing local target ${url.pathname} (from ${rawValue})`);
      continue;
    }

    if (!url.hash || !destination.endsWith(".html")) continue;
    const fragment = decodeURIComponent(url.hash.slice(1));
    if (!fragment) continue;

    const destinationPage = pages.get(destination);
    if (!destinationPage) {
      failures.push(`${page.route}: cannot inspect fragment target ${url.pathname}${url.hash}`);
    } else if (!destinationPage.ids.has(fragment)) {
      failures.push(`${page.route}: missing fragment #${fragment} on ${url.pathname}`);
    }
  }
}

if (failures.length) {
  console.error("Internal link checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Internal link checks passed for ${pages.size} generated HTML pages.`);
