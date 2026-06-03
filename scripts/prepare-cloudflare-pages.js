const fs = require("fs");
const path = require("path");

const siteDir = path.join(__dirname, "..", "_site");
const documents = require("../src/_data/resourceDocuments.json");
const maxPagesAssetSize = 25 * 1024 * 1024;
const docsArchiveBaseUrl = process.env.MHTR_DOCS_BASE_URL || "";
const docsRedirectStatus = process.env.MHTR_DOCS_REDIRECT_STATUS || "302";

for (const doc of documents) {
  if ((!docsArchiveBaseUrl && !doc.cloudflarePagesOmitLocal) || !doc.localPath) continue;

  const localFile = path.join(siteDir, doc.localPath.replace(/^\//, ""));
  if (fs.existsSync(localFile)) {
    fs.rmSync(localFile);
    console.log(`Removed Cloudflare Pages document asset: ${doc.localPath}`);
  }
}

if (docsArchiveBaseUrl) {
  const redirectsFile = path.join(siteDir, "_redirects");
  const archiveBase = docsArchiveBaseUrl.replace(/\/$/, "");
  const docsRedirect = `/assets/docs/* ${archiveBase}/assets/docs/:splat ${docsRedirectStatus}\n`;
  const redirects = fs.existsSync(redirectsFile) ? fs.readFileSync(redirectsFile, "utf8") : "";
  if (!redirects.includes("/assets/docs/*")) {
    fs.writeFileSync(redirectsFile, `${docsRedirect}${redirects}`);
    console.log(`Added document archive redirect to ${archiveBase}`);
  }
}

const redirectsFile = path.join(siteDir, "_redirects");
if (fs.existsSync(redirectsFile)) {
  const redirects = fs.readFileSync(redirectsFile, "utf8");
  const normalizedRedirects = redirects.replace(/\s(30[1278]|303)!($|\s)/g, " $1$2");
  if (normalizedRedirects !== redirects) {
    fs.writeFileSync(redirectsFile, normalizedRedirects);
    console.log("Normalized Netlify force markers in Cloudflare Pages redirects.");
  }
}

if (docsArchiveBaseUrl) {
  const docsDir = path.join(siteDir, "assets", "docs");
  if (fs.existsSync(docsDir)) {
    for (const filePath of walkFiles(docsDir)) {
      if (!filePath.endsWith(".pdf")) continue;
      fs.rmSync(filePath);
      console.log(`Removed Cloudflare Pages document asset: /${path.relative(siteDir, filePath)}`);
    }
  }
}

const oversized = [];

function* walkFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(filePath);
      continue;
    }

    yield filePath;
  }
}

for (const filePath of walkFiles(siteDir)) {
  const stats = fs.statSync(filePath);
  if (stats.size > maxPagesAssetSize) {
    oversized.push({
      path: path.relative(siteDir, filePath),
      sizeMiB: (stats.size / 1024 / 1024).toFixed(1),
    });
  }
}

if (oversized.length) {
  console.error("Cloudflare Pages assets must be 25 MiB or smaller. Oversized files remain:");
  for (const file of oversized) {
    console.error(`- ${file.path} (${file.sizeMiB} MiB)`);
  }
  process.exit(1);
}

console.log("Cloudflare Pages output is within the 25 MiB per-asset limit.");
