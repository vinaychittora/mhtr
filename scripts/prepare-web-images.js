const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const args = process.argv.slice(2);

function valueFor(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : "";
}

function usage() {
  console.log(`Prepare responsive, metadata-safe web images.

Usage:
  npm run images:web -- --input <photo> --output <directory> --name <slug> --metadata <json> [--force]

Required metadata fields:
  title, alt, credit, license, source, capturedAt, sensitiveLocationReviewed

The command creates AVIF, WebP and JPEG variants at 480, 800, 1200 and
1600 pixels when the source is large enough, plus a 1200 x 630 social JPEG.
Camera and GPS metadata are removed from every derivative.`);
}

if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}

const input = path.resolve(valueFor("--input"));
const output = path.resolve(valueFor("--output"));
const name = valueFor("--name");
const metadataPath = path.resolve(valueFor("--metadata"));
const force = args.includes("--force");
const widths = [480, 800, 1200, 1600];
const requiredTextFields = ["title", "alt", "credit", "license", "source", "capturedAt"];

function fail(message) {
  console.error(message);
  usage();
  process.exit(1);
}

if (!valueFor("--input") || !valueFor("--output") || !name || !valueFor("--metadata")) {
  fail("Missing one or more required arguments.");
}

if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
  fail("--name must be a lowercase, hyphen-separated filename slug.");
}

if (!fs.existsSync(input) || !fs.statSync(input).isFile()) {
  fail(`Input image not found: ${input}`);
}

if (!fs.existsSync(metadataPath) || !fs.statSync(metadataPath).isFile()) {
  fail(`Metadata JSON not found: ${metadataPath}`);
}

let publishingMetadata;
try {
  publishingMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
} catch (error) {
  fail(`Metadata JSON is invalid: ${error.message}`);
}

for (const field of requiredTextFields) {
  if (typeof publishingMetadata[field] !== "string" || !publishingMetadata[field].trim()) {
    fail(`Metadata field "${field}" is required.`);
  }
}

if (publishingMetadata.sensitiveLocationReviewed !== true) {
  fail('Metadata field "sensitiveLocationReviewed" must be true before publication.');
}

const capturedAt = new Date(publishingMetadata.capturedAt);
if (Number.isNaN(capturedAt.getTime())) {
  fail('Metadata field "capturedAt" must contain a valid date or date-time.');
}

const focalPoint = publishingMetadata.focalPoint || "attention";
const allowedFocalPoints = new Set([
  "attention",
  "centre",
  "center",
  "north",
  "south",
  "east",
  "west",
  "northeast",
  "northwest",
  "southeast",
  "southwest",
]);
if (!allowedFocalPoints.has(focalPoint)) {
  fail(`Unsupported focalPoint "${focalPoint}".`);
}

function assertWritable(filePath) {
  if (!force && fs.existsSync(filePath)) {
    fail(`Output already exists: ${filePath}. Pass --force to replace reviewed derivatives.`);
  }
}

async function main() {
  fs.mkdirSync(output, { recursive: true });

  const oriented = sharp(input, { failOn: "warning" }).rotate();
  const sourceMetadata = await oriented.metadata();
  const sourceWidth = sourceMetadata.width || 0;
  const sourceHeight = sourceMetadata.height || 0;
  if (!sourceWidth || !sourceHeight) fail("The source image dimensions could not be read.");

  const availableWidths = widths.filter((width) => width <= sourceWidth);
  if (!availableWidths.length) availableWidths.push(sourceWidth);

  const derivatives = [];
  for (const width of availableWidths) {
    const resized = oriented.clone().resize({ width, withoutEnlargement: true });
    const outputs = [
      { extension: "avif", pipeline: resized.clone().avif({ quality: 58, effort: 5 }) },
      { extension: "webp", pipeline: resized.clone().webp({ quality: 82, effort: 5 }) },
      { extension: "jpg", pipeline: resized.clone().jpeg({ quality: 84, progressive: true, mozjpeg: true }) },
    ];

    for (const variant of outputs) {
      const fileName = `${name}-${width}.${variant.extension}`;
      const filePath = path.join(output, fileName);
      assertWritable(filePath);
      const result = await variant.pipeline.toFile(filePath);
      derivatives.push({
        file: fileName,
        width: result.width,
        height: result.height,
        format: variant.extension === "jpg" ? "jpeg" : variant.extension,
        bytes: result.size,
      });
    }
  }

  if (sourceWidth >= 1200 && sourceHeight >= 630) {
    const socialName = `${name}-social.jpg`;
    const socialPath = path.join(output, socialName);
    assertWritable(socialPath);
    const result = await oriented
      .clone()
      .resize(1200, 630, { fit: "cover", position: focalPoint })
      .jpeg({ quality: 86, progressive: true, mozjpeg: true })
      .toFile(socialPath);
    derivatives.push({
      file: socialName,
      width: result.width,
      height: result.height,
      format: "jpeg",
      purpose: "social-preview",
      bytes: result.size,
    });
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      fileName: path.basename(input),
      width: sourceWidth,
      height: sourceHeight,
      metadataRemoved: ["GPS", "camera", "device", "software", "embedded-thumbnail"],
    },
    publishing: {
      title: publishingMetadata.title.trim(),
      alt: publishingMetadata.alt.trim(),
      credit: publishingMetadata.credit.trim(),
      license: publishingMetadata.license.trim(),
      source: publishingMetadata.source.trim(),
      capturedAt: publishingMetadata.capturedAt.trim(),
      sensitiveLocationReviewed: true,
    },
    derivatives,
  };

  const manifestPath = path.join(output, `${name}.image.json`);
  assertWritable(manifestPath);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const inputBytes = fs.statSync(input).size;
  const outputBytes = derivatives.reduce((sum, item) => sum + item.bytes, 0);
  console.log(
    `Prepared ${derivatives.length} derivatives for ${path.basename(input)} ` +
      `(${(inputBytes / 1024 / 1024).toFixed(2)} MiB source; ${(outputBytes / 1024 / 1024).toFixed(2)} MiB total derivatives).`,
  );
  console.log(`Publishing manifest: ${manifestPath}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
