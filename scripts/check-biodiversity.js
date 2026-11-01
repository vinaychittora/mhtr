const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "src", "_data", "inatBiodiversity.json");
const referencePath = path.join(root, "src", "_data", "bioReference.json");
const taxaPath = path.join(root, "src", "_data", "bioTaxa.json");
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

// --- Community snapshot ---------------------------------------------------------
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

// --- Official records -----------------------------------------------------------
const reference = JSON.parse(read(referencePath));
const rows = reference.rows || [];
if (!rows.length) fail("The official-record species list is empty.");
const seenReference = new Set();
rows.forEach((row, index) => {
  const label = row.scientific || `row ${index + 1}`;
  if (!row.domain || !row.group || !row.scientific) fail(`Official-record ${label} is missing domain, group or name.`);
  const key = `${row.domain}|${row.scientific.toLowerCase()}`;
  if (seenReference.has(key)) fail(`Official-record species listed twice: ${row.scientific}`);
  seenReference.add(key);
  if (!Array.isArray(row.refs) || !row.refs.length) fail(`Official-record ${label} has no source.`);
  for (const ref of row.refs || []) {
    if (!reference.sources?.[ref.source]) fail(`Official-record ${label} cites an unknown source: ${ref.source}`);
    if (!Number.isInteger(ref.page) || ref.page < 1) fail(`Official-record ${label} has no printed page.`);
  }
});
if (!template.includes("bioReference.rows")) fail("The biodiversity table is not built from bioReference.json.");
for (const required of ["Panthera tigris", "Gyps indicus", "Naja naja", "Mastacembelus armatus", "Leptadenia reticulata"]) {
  if (!seenReference.has(`${required.startsWith("Leptadenia") ? "Flora" : "Fauna"}|${required.toLowerCase()}`)) {
    fail(`Expected official-record species is missing: ${required}`);
  }
}

// --- Taxon reference file (Red List, photos, summaries) ---------------------------
// Only taxon-level fields are allowed. Nothing that describes an observation, an
// observer or a place may be stored, and photos must carry a reusable licence.
const allowedTaxonEntryKeys = new Set([
  "taxonId", "name", "rank", "active", "checkedAt", "commonName", "iconicTaxon", "family", "observationsCount",
  "photo", "redList", "indiaStatus", "establishment", "wikipedia", "matchedVia",
]);
const allowedPhotoKeys = new Set(["id", "url", "licence", "licenceLabel", "licenceUrl", "by", "width", "height"]);
const allowedLicences = new Set(["cc0", "cc-by", "cc-by-sa"]);
const allowedRedListCodes = new Set(["EX", "EW", "CR", "EN", "VU", "NT", "LC", "DD"]);
const prohibitedKeyPattern = /observ(?!ationsCount)|observer|user|uuid|geo|lat|lng|longitude|latitude|place_guess|location|date|positional/i;
let taxaFile = null;
if (fs.existsSync(taxaPath)) {
  taxaFile = JSON.parse(read(taxaPath));
  if (taxaFile.schemaVersion !== 1) fail("bioTaxa.json has an unexpected schema version.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(taxaFile.fetchedAt || "")) fail("bioTaxa.json must record the fetch date.");
  if (!taxaFile.sources?.iucn?.url || !taxaFile.sources?.wikipedia?.licenceUrl) fail("bioTaxa.json is missing its source notes.");
  const entries = Object.entries(taxaFile.taxa || {});
  if (!entries.length) fail("bioTaxa.json has no taxa.");
  for (const [name, entry] of entries) {
    const extra = Object.keys(entry).filter((key) => !allowedTaxonEntryKeys.has(key));
    if (extra.length) fail(`bioTaxa ${name} has unapproved fields: ${extra.join(", ")}`);
    for (const key of Object.keys(entry)) {
      if (prohibitedKeyPattern.test(key)) fail(`bioTaxa ${name} has a prohibited field: ${key}`);
    }
    if (!Number.isInteger(entry.taxonId) || entry.taxonId <= 0) fail(`bioTaxa ${name} has an invalid taxon id.`);
    if (entry.photo) {
      const photoExtra = Object.keys(entry.photo).filter((key) => !allowedPhotoKeys.has(key));
      if (photoExtra.length) fail(`bioTaxa ${name} photo has unapproved fields: ${photoExtra.join(", ")}`);
      if (!allowedLicences.has(entry.photo.licence)) fail(`bioTaxa ${name} photo licence is not reusable: ${entry.photo.licence}`);
      if (!/^https:\/\//.test(entry.photo.url || "")) fail(`bioTaxa ${name} photo URL must be HTTPS.`);
      if (!entry.photo.by) fail(`bioTaxa ${name} photo has no photographer credit.`);
    }
    if (entry.redList && !allowedRedListCodes.has(entry.redList.code)) fail(`bioTaxa ${name} has an unknown Red List code: ${entry.redList.code}`);
    if (entry.wikipedia) {
      if (!/^https:\/\/[a-z]+\.wikipedia\.org\//.test(entry.wikipedia.url || "")) fail(`bioTaxa ${name} Wikipedia link is not a Wikipedia URL.`);
      if ((entry.wikipedia.summary || "").length > 400) fail(`bioTaxa ${name} Wikipedia summary is too long to count as a short excerpt.`);
    }
  }
  const matchedOfficial = rows.filter((row) => taxaFile.taxa[row.scientific]).length;
  if (matchedOfficial < rows.length * 0.8) {
    fail(`Only ${matchedOfficial} of ${rows.length} official-record species are matched in bioTaxa.json; rerun scripts/build-bio-taxa.py.`);
  }
} else {
  console.warn("Note: src/_data/bioTaxa.json is absent; cards will show icons and official data only.");
}

// --- Client script safeguards -----------------------------------------------------
for (const unsafePattern of [
  "order_by=observed_on",
  "observation.observed_on",
  "observation.photos",
  "recentObservations",
  "Recent MHTR project observations",
  "/v2/observations",
  "/v1/observations",
  "api.inaturalist.org",
]) {
  if (clientScript.includes(unsafePattern)) fail(`Client script requests or exposes observation data: ${unsafePattern}`);
}
if (!clientScript.includes('"cc-by-sa"') || !clientScript.includes('"cc-by"') || !clientScript.includes("cc0")) {
  fail("Reusable iNaturalist photo licence whitelist is incomplete.");
}
if (clientScript.includes("cc-by-nc")) fail("Non-commercial iNaturalist photos must not be whitelisted.");
for (const requiredPattern of [
  "reusablePhotoLicenses",
  "const reusablePhoto = (photo)",
  "https://www.inaturalist.org/taxa/${Number(item.taxonId)}",
  "project_id=${inatProjectSlug}&taxon_id=${Number(item.taxonId)}",
  'rel="license noopener"',
  "aria-expanded",
  "bio-card-panel",
  "data-iucn",
]) {
  if (!clientScript.includes(requiredPattern)) fail(`Card code is missing a required piece: ${requiredPattern}`);
}
if (clientScript.includes("inat-modal")) fail("The species modal has been replaced by in-place cards; remove the modal code.");

// --- Built page --------------------------------------------------------------------
if (fs.existsSync(builtPagePath)) {
  const builtPage = read(builtPagePath);
  const distributionPath = snapshot.dataset.distributionPath.replace(/^\//, "");
  const builtDatasetPath = path.join(builtSiteDir, distributionPath);
  if (!fs.existsSync(builtDatasetPath)) fail(`Built snapshot distribution is missing: ${snapshot.dataset.distributionPath}`);
  else if (read(builtDatasetPath) !== read(sourcePath)) fail("Built snapshot distribution differs from its source data.");
  if (!builtPage.includes('"@type": "Dataset"')) fail("Biodiversity page is missing Dataset structured data.");
  if (!builtPage.includes(snapshot.dataset.distributionPath)) fail("Biodiversity page does not link its versioned snapshot.");
  if ((builtPage.match(/<h1[\s>]/g) || []).length !== 1) fail("Biodiversity page must have exactly one h1.");
  if (!builtPage.includes("<th scope=\"col\">IUCN Red List</th>")) fail("Biodiversity table is missing the IUCN Red List column.");
  if (taxaFile) {
    const clientFile = path.join(builtSiteDir, "assets", "data", `biodiversity-taxa-${taxaFile.fetchedAt}.json`);
    if (!fs.existsSync(clientFile)) fail(`Built taxon reference file is missing: ${clientFile}`);
    else {
      const client = JSON.parse(read(clientFile));
      for (const [name, entry] of Object.entries(client.taxa || {})) {
        for (const key of Object.keys(entry)) {
          if (prohibitedKeyPattern.test(key)) fail(`Published taxon file ${name} has a prohibited field: ${key}`);
        }
      }
    }
    if (!builtPage.includes(`biodiversity-taxa-${taxaFile.fetchedAt}.json`)) fail("Biodiversity page does not reference the taxon file.");
  }
}

if (failures.length) {
  console.error("Biodiversity checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const taxaNote = taxaFile
  ? ` ${Object.keys(taxaFile.taxa).length} taxon entries (${taxaFile.counts?.withRedList ?? "?"} with a Red List category, ${taxaFile.counts?.withPhoto ?? "?"} with a reusable photo).`
  : "";
console.log(
  `Biodiversity checks passed: ${rows.length} official-record species with sources; ${taxa.length} community taxon entries; ${summedObservations} Research Grade observations.${taxaNote}`,
);
