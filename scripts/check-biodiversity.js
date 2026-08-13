const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "src", "_data", "inatBiodiversity.json");
const templatePath = path.join(root, "src", "_includes", "content", "biodiversity.html");
const scriptPath = path.join(root, "src", "assets", "assets", "js", "main.js");
const builtSiteDir = process.env.MHTR_SITE_DIR ? path.resolve(root, process.env.MHTR_SITE_DIR) : path.join(root, "_site");
const builtPagePath = path.join(builtSiteDir, "biodiversity", "index.html");
const failures = [];

function fail(message) {
  failures.push(message);
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

const snapshot = JSON.parse(read(sourcePath));
const template = read(templatePath);
const clientScript = read(scriptPath);

if (snapshot.schemaVersion !== 1) fail("Unexpected biodiversity snapshot schema version.");
if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.dataset?.asOfDate || "")) fail("The snapshot has an invalid version date.");
if (!snapshot.dataset?.distributionPath?.includes(snapshot.dataset.asOfDate)) {
  fail("The versioned distribution filename must include the snapshot date.");
}
if (snapshot.methodology?.qualityGrade !== "research") fail("The community snapshot must contain Research Grade records only.");
if (!/^\d{4}\/\d{4}$/.test(snapshot.dataset?.temporalCoverage || "")) {
  fail("Dataset temporal coverage must use year-only values.");
}
if (
  !/^\d{4}$/.test(snapshot.summary?.observationYearRange?.start || "") ||
  !/^\d{4}$/.test(snapshot.summary?.observationYearRange?.end || "") ||
  snapshot.summary?.observationDateRange
) {
  fail("Observation coverage summary must contain years only.");
}
if (!snapshot.project?.url || !snapshot.project?.placeUrl) fail("The snapshot is missing project or place provenance links.");
if (!snapshot.methodology?.references?.every((url) => /^https:\/\//.test(url))) {
  fail("Every methodology reference must be an absolute HTTPS URL.");
}

const taxa = snapshot.taxa || [];
const taxonIds = new Set();
const allowedTaxonKeys = new Set([
  "taxonId",
  "scientificName",
  "commonName",
  "rank",
  "active",
  "iconicTaxon",
  "domain",
  "group",
  "researchGradeObservationCount",
]);

for (const [index, taxon] of taxa.entries()) {
  const extraKeys = Object.keys(taxon).filter((key) => !allowedTaxonKeys.has(key));
  if (extraKeys.length) fail(`Taxon ${index} contains unapproved fields: ${extraKeys.join(", ")}`);
  if (!Number.isInteger(taxon.taxonId) || taxon.taxonId <= 0) fail(`Taxon ${index} has an invalid taxon ID.`);
  if (taxonIds.has(taxon.taxonId)) fail(`Duplicate taxon ID: ${taxon.taxonId}`);
  taxonIds.add(taxon.taxonId);
  if (!taxon.scientificName || !taxon.rank || !taxon.domain || !taxon.group) {
    fail(`Taxon ${taxon.taxonId || index} is missing required taxonomy fields.`);
  }
  if (!Number.isInteger(taxon.researchGradeObservationCount) || taxon.researchGradeObservationCount < 1) {
    fail(`Taxon ${taxon.taxonId || index} has an invalid observation count.`);
  }
}

const summedObservations = taxa.reduce((sum, taxon) => sum + taxon.researchGradeObservationCount, 0);
const rankCounts = taxa.reduce((counts, taxon) => {
  counts[taxon.rank] = (counts[taxon.rank] || 0) + 1;
  return counts;
}, {});
const groupCounts = taxa.reduce((counts, taxon) => {
  counts[taxon.group] = (counts[taxon.group] || 0) + 1;
  return counts;
}, {});

if (taxa.length !== snapshot.summary?.taxonEntries) fail("Snapshot taxon-entry summary does not match its records.");
if (summedObservations !== snapshot.summary?.researchGradeObservations) {
  fail("Snapshot observation summary does not match the sum of its taxon counts.");
}
if (JSON.stringify(rankCounts) !== JSON.stringify(snapshot.summary?.countsByRank)) {
  fail("Snapshot rank summary does not match its records.");
}
for (const [group, count] of Object.entries(snapshot.summary?.countsByGroup || {})) {
  if (groupCounts[group] !== count) fail(`Snapshot group summary is incorrect for ${group}.`);
}
for (const requiredGroup of ["Amphibians", "Insects", "Arachnids", "Fungi"]) {
  if (!groupCounts[requiredGroup]) fail(`Community snapshot is missing ${requiredGroup}.`);
}

const tableBody = template.match(/<table class="table" id="bioTable">[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/)?.[1] || "";
const rows = Array.from(tableBody.matchAll(/<tr>([\s\S]*?)<\/tr>/g), (match) => match[1]);
if (!rows.length) fail("Published-reference biodiversity table could not be parsed.");
rows.forEach((row, index) => {
  const cellCount = (row.match(/<td(?:\s|>)/g) || []).length;
  if (cellCount !== 7) fail(`Published-reference row ${index + 1} has ${cellCount} cells; expected 7.`);
  if ((row.match(/<em>/g) || []).length !== (row.match(/<\/em>/g) || []).length) {
    fail(`Published-reference row ${index + 1} has unbalanced scientific-name markup.`);
  }
});
if (!template.includes("<em>Leptadenia reticulata</em>")) fail("The repaired Nani dodi source row is missing.");
if (!template.includes("<em>Mastacembelus armatus</em>")) fail("The repaired zig-zag eel source row is missing.");

for (const unsafePattern of [
  "order_by=observed_on",
  "observation.observed_on",
  "observation.photos",
  "recentObservations",
  "Recent MHTR project observations",
]) {
  if (clientScript.includes(unsafePattern)) fail(`Client script still exposes recent observation data: ${unsafePattern}`);
}
if (!clientScript.includes('"cc-by-sa"') || !clientScript.includes('"cc-by"') || !clientScript.includes("cc0")) {
  fail("Reusable iNaturalist photo licence whitelist is incomplete.");
}
if (clientScript.includes("cc-by-nc")) fail("Non-commercial iNaturalist photos must not be whitelisted.");
if (!clientScript.includes("taxa/${Number(item.taxonId)}")) fail("Stable iNaturalist taxon-ID lookup is missing.");
if (!clientScript.includes("inatTitle.textContent = modalTitle")) fail("Stable modal scientific-name heading is missing.");
for (const requiredPhotoSafetyPattern of [
  'https://api.inaturalist.org/v2/observations?${params}',
  'quality_grade: "research"',
  'photo_license: "cc0,cc-by,cc-by-sa"',
  'fields:',
  "photos.id",
  "photos.url",
  "photos.license_code",
  "photos.attribution",
  "normalizeReusablePhoto",
  "chooseReusableObservationPhoto",
  "Number(observation?.taxon?.id) !== Number(requestedTaxonId)",
  "renderablePhotoMetadata",
  "photo?.hidden === true",
  "Creator not supplied by iNaturalist",
  "Global identification reference; not evidence of an MHTR record.",
  "Source photo on iNaturalist",
  'rel="license noopener"',
]) {
  if (!clientScript.includes(requiredPhotoSafetyPattern)) {
    fail(`Reusable-photo safety requirement is missing: ${requiredPhotoSafetyPattern}`);
  }
}
if (/fields:\s*["`'][^"`']*(?:observed_on|location|geojson|user|place_guess)/.test(clientScript)) {
  fail("Reusable-photo lookup requests sensitive observation fields.");
}
if (clientScript.includes("observation.uri") || clientScript.includes("observation.id")) {
  fail("Reusable-photo code must not retain observation identifiers or URLs.");
}
const normalizedPhotoReturn = clientScript.match(/function renderablePhotoMetadata\(photo\) \{[\s\S]*?\n  \}/)?.[0] || "";
for (const prohibitedMetadataField of ["observation", "uuid", "observed", "location", "user", "place"]) {
  if (normalizedPhotoReturn.toLowerCase().includes(prohibitedMetadataField)) {
    fail(`Normalized photo metadata retains a prohibited field: ${prohibitedMetadataField}`);
  }
}

if (fs.existsSync(builtPagePath)) {
  const builtPage = read(builtPagePath);
  const distributionPath = snapshot.dataset.distributionPath.replace(/^\//, "");
  const builtDatasetPath = path.join(builtSiteDir, distributionPath);
  if (!fs.existsSync(builtDatasetPath)) fail(`Built snapshot distribution is missing: ${snapshot.dataset.distributionPath}`);
  else if (read(builtDatasetPath) !== read(sourcePath)) fail("Built snapshot distribution differs from its source data.");
  if (!builtPage.includes('"@type": "Dataset"')) fail("Biodiversity page is missing Dataset structured data.");
  if (!builtPage.includes(snapshot.dataset.distributionPath)) fail("Biodiversity page does not link its versioned snapshot.");
}

if (failures.length) {
  console.error("Biodiversity checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Biodiversity checks passed: ${rows.length} complete reference rows; ${taxa.length} community taxon entries; ${summedObservations} Research Grade observations.`,
);
