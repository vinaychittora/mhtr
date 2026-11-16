#!/usr/bin/env node
// Writes creator, credit and copyright into every published picture (IPTC, XMP and EXIF),
// so image search shows who made it, and removes any GPS or place fields.
//
//   npm run build:site && npm run images:credits      (add -- --dry-run to list, -- --force to redo all)
//
// Needs exiftool on the PATH (Ubuntu: sudo apt install libimage-exiftool-perl).
// Who made which picture lives in src/_data/imageCredits.json. Only files that the build
// publishes (present under _site/assets/imgs) are touched; originals that are not
// published stay as they are. Files already stamped with the same credit are skipped.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src", "assets", "assets", "imgs");
const BUILT = path.join(ROOT, "_site", "assets", "imgs");
const MARKER = "MHTR_IMAGE_CREDITS_v2";
const EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const credits = require(path.join(ROOT, "src", "_data", "imageCredits.json"));
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

function fail(message) {
  console.error(message);
  process.exit(1);
}

try {
  execFileSync("exiftool", ["-ver"], { stdio: "ignore" });
} catch {
  fail("exiftool is not installed. On Ubuntu: sudo apt install libimage-exiftool-perl");
}
if (!fs.existsSync(BUILT)) fail("Build the site first: npm run build:site");

const globToRegex = (glob) =>
  new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`);
const rules = credits.rules.map((rule) => ({ ...rule, regex: globToRegex(rule.match) }));
const whoMade = (rel) => (rules.find((rule) => rule.regex.test(rel)) || { by: credits.default }).by;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return EXTENSIONS.has(path.extname(entry.name).toLowerCase()) ? [full] : [];
  });
}

// Published pictures only, as relative paths under /assets/imgs/.
const published = walk(BUILT)
  .map((file) => path.relative(BUILT, file).split(path.sep).join("/"))
  .filter((rel) => fs.existsSync(path.join(SRC, rel)));

const current = JSON.parse(
  execFileSync(
    "exiftool",
    ["-j", "-q", "-XMP-dc:Identifier", "-XMP-dc:Creator", "-XMP-photoshop:Credit", "-GPS:GPSLatitude", "-XMP-exif:GPSLatitude", ...published.map((rel) => path.join(SRC, rel))],
    { maxBuffer: 64 * 1024 * 1024 },
  ).toString() || "[]",
);
const byFile = new Map(current.map((entry) => [path.resolve(entry.SourceFile), entry]));
const asList = (value) => (Array.isArray(value) ? value : value === undefined ? [] : [value]).map(String);

const groups = new Map();
let skipped = 0;
for (const rel of published) {
  const key = whoMade(rel);
  if (key === "thirdParty") continue;
  const person = credits.people[key];
  if (!person) fail(`imageCredits.json: unknown person "${key}" for ${rel}`);
  const file = path.join(SRC, rel);
  const info = byFile.get(file) || {};
  const done =
    !force &&
    asList(info.Identifier).includes(MARKER) &&
    asList(info.Creator).join() === person.name &&
    info.Credit === person.credit &&
    !info.GPSLatitude;
  if (done) {
    skipped += 1;
    continue;
  }
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(rel);
}

const usage = `Do not reuse without written permission. Licence and reuse: ${credits.licensePage}`;
for (const [key, files] of groups) {
  const person = credits.people[key];
  console.log(`${person.name}: ${files.length} picture(s)`);
  if (dryRun) {
    files.forEach((rel) => console.log(`  ${rel}`));
    continue;
  }
  const args = [
    "-overwrite_original",
    "-P",
    "-m",
    // No padding or indenting: the credit block stays about 1.5 KB per picture.
    "-api", "Compact=NoPadding,NoIndent,OneDesc",
    "-XMP-x:XMPToolkit=",
    "-charset", "iptc=UTF8",
    "-codedcharacterset=utf8",
    // Location never goes out with a picture.
    "-gps:all=",
    "-XMP-exif:GPS*=",
    "-XMP-iptcCore:Location=",
    "-XMP-iptcExt:LocationCreated*=",
    "-XMP-iptcExt:LocationShown*=",
    "-XMP-photoshop:City=",
    "-XMP-photoshop:State=",
    "-IPTC:City=",
    "-IPTC:Sub-location=",
    "-IPTC:Province-State=",
    // The plain-text comment of the old rights script.
    "-Comment=",
    `-EXIF:Artist=${person.name}`,
    `-EXIF:Copyright=${person.copyright}`,
    `-IPTC:By-line=${person.name}`,
    `-IPTC:Credit=${person.credit}`,
    `-IPTC:CopyrightNotice=${person.copyright}`,
    "-IPTC:Source=mhtr.in",
    `-XMP-dc:Creator=${person.name}`,
    `-XMP-dc:Rights=${person.copyright}`,
    `-XMP-dc:Publisher=mhtr.in`,
    `-XMP-dc:Identifier=${MARKER}`,
    `-XMP-photoshop:Credit=${person.credit}`,
    "-XMP-photoshop:Source=mhtr.in",
    "-XMP-xmpRights:Marked=True",
    `-XMP-xmpRights:WebStatement=${credits.licensePage}`,
    `-XMP-xmpRights:UsageTerms=${usage}`,
    `-XMP-plus:LicensorName=${person.name}`,
    `-XMP-plus:LicensorURL=${credits.licensePage}`,
    ...(person.url ? [`-XMP-iptcCore:CreatorWorkURL=${person.url}`] : []),
  ];
  // exiftool takes long argument lists from a file, one argument per line.
  const argFile = path.join(require("os").tmpdir(), `mhtr-credits-${key}.args`);
  fs.writeFileSync(argFile, [...args, ...files.map((rel) => path.join(SRC, rel))].join("\n"));
  execFileSync("exiftool", ["-@", argFile], { stdio: "inherit" });
  fs.rmSync(argFile);
}
console.log(`${skipped} picture(s) already carried the right credit.`);
