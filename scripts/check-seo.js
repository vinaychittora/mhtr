const fs = require("fs");
const path = require("path");

const siteUrl = "https://mhtr.in";
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "_site");
const failures = [];

function read(filePath) {
  return fs.readFileSync(path.join(root, filePath), "utf8");
}

function readIfExists(filePath) {
  const fullPath = path.join(root, filePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : "";
}

function fail(message) {
  failures.push(message);
}

function extract(html, pattern) {
  return html.match(pattern)?.[1];
}

function extractAll(html, pattern) {
  return Array.from(html.matchAll(pattern), (match) => match[1]);
}

function* walkHtml(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkHtml(filePath);
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      yield filePath;
    }
  }
}

function htmlPathForUrl(url) {
  const parsed = new URL(url);
  if (parsed.origin !== siteUrl) {
    fail(`Non-canonical sitemap origin: ${url}`);
    return null;
  }

  const pathname = parsed.pathname;
  if (pathname.endsWith("/")) {
    return path.join(outDir, pathname, "index.html");
  }

  return path.join(outDir, pathname);
}

const redirects = read("src/_redirects");
const builtRedirects = readIfExists("_site/_redirects");
const requiredRedirects = [
  "http://mhtr.in/* https://mhtr.in/:splat 301!",
  "http://www.mhtr.in/* https://mhtr.in/:splat 301!",
  "https://www.mhtr.in/* https://mhtr.in/:splat 301!",
];

for (const rule of requiredRedirects) {
  if (!redirects.includes(rule)) {
    fail(`Missing redirect rule: ${rule}`);
  }
  const cloudflareRule = rule.replace(/\s(30[1278]|303)!($|\s)/, " $1$2");
  if (!builtRedirects.includes(rule) && !builtRedirects.includes(cloudflareRule)) {
    fail(`Built _site/_redirects is missing rule: ${rule}`);
  }
}

if (redirects.includes("https://mhtr.in/* https://mhtr.in/:splat 200")) {
  fail("Remove self-rewrite for canonical host; canonical pages should be served directly.");
}

const robots = read("_site/robots.txt").trim();
const expectedSitemapLine = `Sitemap: ${siteUrl}/sitemap.xml`;
if (!robots.split(/\r?\n/).includes(expectedSitemapLine)) {
  fail(`robots.txt must advertise ${expectedSitemapLine}`);
}

const sitemap = read("_site/sitemap.xml");
const urls = Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => match[1]);
if (urls.length === 0) {
  fail("Sitemap has no URLs.");
}

if (!sitemap.includes('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"')) {
  fail("Sitemap is missing the Google image sitemap namespace.");
}

if (/<changefreq>|<priority>/.test(sitemap)) {
  fail("Sitemap should not publish unsupported changefreq or priority hints.");
}

for (const block of sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
  const loc = extract(block[1], /<loc>([^<]+)<\/loc>/);
  const lastmod = extract(block[1], /<lastmod>([^<]+)<\/lastmod>/);
  if (lastmod) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lastmod) || Number.isNaN(new Date(`${lastmod}T00:00:00Z`).getTime())) {
      fail(`Invalid sitemap lastmod for ${loc || "unknown URL"}: ${lastmod}`);
    }
    if (new Date(`${lastmod}T23:59:59Z`).getTime() > Date.now() + 24 * 60 * 60 * 1000) {
      fail(`Future sitemap lastmod for ${loc || "unknown URL"}: ${lastmod}`);
    }
  }

  for (const imageUrl of extractAll(block[1], /<image:loc>([^<]+)<\/image:loc>/g)) {
    if (!/^https:\/\//.test(imageUrl)) {
      fail(`Sitemap image URL must be absolute HTTPS for ${loc || "unknown URL"}: ${imageUrl}`);
      continue;
    }
    if (imageUrl.startsWith(`${siteUrl}/`)) {
      const imagePath = path.join(outDir, new URL(imageUrl).pathname);
      if (!fs.existsSync(imagePath)) {
        fail(`Sitemap image does not exist for ${loc || "unknown URL"}: ${imageUrl}`);
      }
    }
  }
}

const seen = new Set();
for (const url of urls) {
  if (seen.has(url)) {
    fail(`Duplicate sitemap URL: ${url}`);
  }
  seen.add(url);

  if (!url.startsWith(`${siteUrl}/`)) {
    fail(`Sitemap URL is not canonical HTTPS/non-www: ${url}`);
  }

  const htmlPath = htmlPathForUrl(url);
  if (!htmlPath || !fs.existsSync(htmlPath)) {
    fail(`Sitemap URL has no generated HTML file: ${url}`);
    continue;
  }

  const html = fs.readFileSync(htmlPath, "utf8");
  const title = extract(html, /<title>([^<]+)<\/title>/);
  const description = extract(html, /<meta name="description" content="([^"]+)" \/>/);
  const canonical = html.match(/<link rel="canonical" href="([^"]+)" \/>/)?.[1];
  const robotsMeta = html.match(/<meta name="robots" content="([^"]+)" \/>/)?.[1];
  const ogUrl = extract(html, /<meta property="og:url" content="([^"]+)" \/>/);
  const ogTitle = extract(html, /<meta property="og:title" content="([^"]+)" \/>/);
  const ogDescription = extract(html, /<meta property="og:description" content="([^"]+)" \/>/);
  const ogImage = extract(html, /<meta property="og:image" content="([^"]+)" \/>/);
  const ogImageAlt = extract(html, /<meta property="og:image:alt" content="([^"]+)" \/>/);
  const twitterCard = extract(html, /<meta name="twitter:card" content="([^"]+)" \/>/);
  const twitterImage = extract(html, /<meta name="twitter:image" content="([^"]+)" \/>/);
  const twitterImageAlt = extract(html, /<meta name="twitter:image:alt" content="([^"]+)" \/>/);
  const h1Count = extractAll(html, /<h1(?:\s|>)/g).length;
  const images = extractAll(html, /<img\b([^>]*?)>/g);

  if (canonical !== url) {
    fail(`Canonical mismatch for ${url}: found ${canonical || "none"}`);
  }

  if (!robotsMeta || robotsMeta.includes("noindex")) {
    fail(`Sitemap URL is not indexable: ${url} has robots=${robotsMeta || "none"}`);
  }

  if (!robotsMeta?.includes("max-image-preview:large")) {
    fail(`Indexable page should allow large image previews: ${url}`);
  }

  if (!title || title.length < 20 || title.length > 95) {
    fail(`Title length looks weak for ${url}: ${title || "none"}`);
  }

  if (!description || description.length < 70 || description.length > 220) {
    fail(`Meta description length looks weak for ${url}: ${description || "none"}`);
  }

  if (h1Count !== 1) {
    fail(`Expected exactly one H1 for ${url}, found ${h1Count}`);
  }

  if (ogUrl !== url) {
    fail(`og:url mismatch for ${url}: found ${ogUrl || "none"}`);
  }

  for (const [name, value] of [
    ["og:title", ogTitle],
    ["og:description", ogDescription],
    ["og:image", ogImage],
    ["og:image:alt", ogImageAlt],
    ["twitter:image", twitterImage],
    ["twitter:image:alt", twitterImageAlt],
  ]) {
    if (!value) {
      fail(`Missing ${name} for ${url}`);
    }
  }

  if (twitterCard !== "summary_large_image") {
    fail(`Expected summary_large_image Twitter card for ${url}`);
  }

  if (ogImage !== twitterImage) {
    fail(`Open Graph and Twitter images differ for ${url}`);
  }

  if (ogImage?.startsWith(`${siteUrl}/`)) {
    const imagePath = path.join(outDir, new URL(ogImage).pathname);
    if (!fs.existsSync(imagePath)) {
      fail(`Social image does not exist for ${url}: ${ogImage}`);
    }
  } else {
    fail(`Social image must use canonical site URL for ${url}: ${ogImage || "none"}`);
  }

  if (!html.includes(`<link rel="alternate" hreflang="en-IN" href="${url}" />`)) {
    fail(`Missing en-IN hreflang for ${url}`);
  }

  const jsonLdBlocks = extractAll(
    html,
    /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g,
  );
  if (jsonLdBlocks.length === 0) {
    fail(`Missing JSON-LD for ${url}`);
  }

  const structuredTypes = new Set();
  for (const block of jsonLdBlocks) {
    try {
      const data = JSON.parse(block);
      const graph = Array.isArray(data["@graph"]) ? data["@graph"] : Array.isArray(data) ? data : [data];
      for (const item of graph) {
        const type = item["@type"];
        if (Array.isArray(type)) {
          for (const value of type) structuredTypes.add(value);
        } else if (type) {
          structuredTypes.add(type);
        }
      }
    } catch (error) {
      fail(`Invalid JSON-LD for ${url}: ${error.message}`);
    }
  }

  if (!structuredTypes.has("WebSite")) {
    fail(`Missing WebSite structured data for ${url}`);
  }

  if (!structuredTypes.has("WebPage") && !structuredTypes.has("AboutPage") && !structuredTypes.has("CollectionPage")) {
    fail(`Missing page-level structured data for ${url}`);
  }

  if (new URL(url).pathname !== "/" && !structuredTypes.has("BreadcrumbList")) {
    fail(`Missing BreadcrumbList structured data for ${url}`);
  }

  if (url.includes("/resources/documents/") && !structuredTypes.has("DigitalDocument")) {
    fail(`Missing DigitalDocument structured data for ${url}`);
  }

  for (const attrs of images) {
    const src = extract(attrs, /\bsrc="([^"]+)"/);
    const alt = extract(attrs, /\balt="([^"]*)"/);
    const className = extract(attrs, /\bclass="([^"]*)"/) || "";
    const isAllowedDecorative = className.split(/\s+/).includes("brand-logo");

    if (alt === undefined) {
      fail(`Image is missing alt text on ${url}: ${src || attrs.trim()}`);
    } else if (!isAllowedDecorative && alt.trim().length === 0) {
      fail(`Content image has empty alt text on ${url}: ${src || attrs.trim()}`);
    } else if (alt.length > 180) {
      fail(`Image alt text is too long on ${url}: ${alt}`);
    }

    if (src?.startsWith("/")) {
      const imagePath = path.join(outDir, src);
      if (!fs.existsSync(imagePath)) {
        fail(`Image source does not exist for ${url}: ${src}`);
      }
    }
  }
}

for (const htmlPath of walkHtml(outDir)) {
  const relativePath = path.relative(outDir, htmlPath).split(path.sep).join("/");
  const html = fs.readFileSync(htmlPath, "utf8");
  const robotsMeta = html.match(/<meta name="robots" content="([^"]+)"\s*\/?>/)?.[1] || "";
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"\s*\/?>/)?.[1] || "";

  if (robotsMeta.includes("noindex")) {
    if (canonical && seen.has(canonical)) {
      fail(`Noindex page is present in sitemap: ${canonical}`);
    }
    continue;
  }

  if (!canonical) {
    fail(`Indexable generated HTML is missing a canonical URL: ${relativePath}`);
    continue;
  }

  if (!canonical.startsWith(`${siteUrl}/`)) {
    fail(`Generated page has a non-site canonical URL: ${relativePath} -> ${canonical}`);
    continue;
  }

  if (!seen.has(canonical)) {
    fail(`Indexable generated page is missing from sitemap: ${canonical}`);
  }
}

if (failures.length > 0) {
  console.error("SEO checks failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`SEO checks passed for ${urls.length} sitemap URLs.`);
