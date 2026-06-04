const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const bucketArgIndex = args.indexOf("--bucket");
const sourceArgIndex = args.indexOf("--source");

const bucket = bucketArgIndex >= 0 ? args[bucketArgIndex + 1] : process.env.MHTR_R2_BUCKET || "mhtr-docs";
const sourceDir = path.resolve(
  sourceArgIndex >= 0 ? args[sourceArgIndex + 1] : process.env.MHTR_DOCS_SOURCE_DIR || "src/assets/docs"
);
const repoRoot = path.resolve(__dirname, "..");
const cacheControl = process.env.MHTR_R2_CACHE_CONTROL || "public, max-age=604800, must-revalidate";

if (!bucket) {
  console.error("Missing R2 bucket. Set MHTR_R2_BUCKET or pass --bucket <name>.");
  process.exit(1);
}

if (!fs.existsSync(sourceDir)) {
  console.error(`Document source directory not found: ${sourceDir}`);
  process.exit(1);
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(filePath);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
      yield filePath;
    }
  }
}

const files = [...walk(sourceDir)].sort();

if (!files.length) {
  console.log(`No PDF files found in ${sourceDir}`);
  process.exit(0);
}

let uploaded = 0;
let totalBytes = 0;

for (const filePath of files) {
  const key = path.relative(path.join(repoRoot, "src"), filePath).split(path.sep).join("/");
  const size = fs.statSync(filePath).size;
  totalBytes += size;

  const command = [
    "wrangler",
    "r2",
    "object",
    "put",
    `${bucket}/${key}`,
    "--file",
    filePath,
    "--content-type",
    "application/pdf",
    "--cache-control",
    cacheControl,
    "--storage-class",
    "Standard",
    "--remote",
  ];

  if (dryRun) {
    console.log(`[dry-run] npx ${command.join(" ")}`);
    continue;
  }

  console.log(`Uploading ${key} (${(size / 1024 / 1024).toFixed(2)} MiB)`);
  const result = spawnSync("npx", ["--yes", ...command], {
    cwd: repoRoot,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    console.error(`Failed to upload ${key}`);
    process.exit(result.status || 1);
  }

  uploaded += 1;
}

const totalMiB = (totalBytes / 1024 / 1024).toFixed(2);
console.log(`${dryRun ? "Prepared" : "Uploaded"} ${files.length} PDF files (${totalMiB} MiB) to R2 bucket ${bucket}.`);
