const fs = require("fs");
const path = require("path");

const siteDir = path.join(__dirname, "..", "_site");
const documents = require("../src/_data/resourceDocuments.json");
const maxPagesAssetSize = 25 * 1024 * 1024;

for (const doc of documents) {
  if (!doc.cloudflarePagesOmitLocal || !doc.localPath) continue;

  const localFile = path.join(siteDir, doc.localPath.replace(/^\//, ""));
  if (fs.existsSync(localFile)) {
    fs.rmSync(localFile);
    console.log(`Removed oversized Cloudflare Pages asset: ${doc.localPath}`);
  }
}

const oversized = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(filePath);
      continue;
    }

    const stats = fs.statSync(filePath);
    if (stats.size > maxPagesAssetSize) {
      oversized.push({
        path: path.relative(siteDir, filePath),
        sizeMiB: (stats.size / 1024 / 1024).toFixed(1),
      });
    }
  }
}

walk(siteDir);

if (oversized.length) {
  console.error("Cloudflare Pages assets must be 25 MiB or smaller. Oversized files remain:");
  for (const file of oversized) {
    console.error(`- ${file.path} (${file.sizeMiB} MiB)`);
  }
  process.exit(1);
}

console.log("Cloudflare Pages output is within the 25 MiB per-asset limit.");
