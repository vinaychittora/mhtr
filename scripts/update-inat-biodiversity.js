#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const PROJECT_SLUG = "biodiversity-of-mhtr";
const PROJECT_URL = `https://www.inaturalist.org/projects/${PROJECT_SLUG}`;
const API_ROOT = "https://api.inaturalist.org/v1";
const OUTPUT_PATH = path.join(__dirname, "..", "src", "_data", "inatBiodiversity.json");
const PAGE_SIZE = 200;

const HELP_URLS = {
  qualityGrade: "https://help.inaturalist.org/en/support/solutions/articles/151000169936",
  geoprivacy: "https://help.inaturalist.org/en/support/solutions/articles/151000169938-what-is-geoprivacy-what-does-it-mean-for-an-observation-to-be-obscured-",
  licensing: "https://help.inaturalist.org/en/support/solutions/articles/151000173511-how-do-licenses-work-on-inaturalist-should-i-change-my-licenses-",
  apiPractices: "https://www.inaturalist.org/pages/api%2Brecommended%2Bpractices",
};

const groupMap = {
  Plantae: { domain: "Flora", group: "Plants" },
  Aves: { domain: "Fauna", group: "Birds" },
  Mammalia: { domain: "Fauna", group: "Mammals" },
  Reptilia: { domain: "Fauna", group: "Reptiles" },
  Amphibia: { domain: "Fauna", group: "Amphibians" },
  Insecta: { domain: "Fauna", group: "Insects" },
  Arachnida: { domain: "Fauna", group: "Arachnids" },
  Fungi: { domain: "Fungi", group: "Fungi" },
};

const groupOrder = ["Plants", "Birds", "Mammals", "Reptiles", "Amphibians", "Insects", "Arachnids", "Fungi"];

function readAsOfDate() {
  const argument = process.argv.find((value) => value.startsWith("--as-of="));
  const value = argument ? argument.slice("--as-of=".length) : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`Invalid --as-of date: ${value}`);
  }
  return value;
}

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchJSON(url, attempt = 1) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "MHTR.in biodiversity snapshot (hello@caneandcamera.com)",
    },
  });

  if ((response.status === 429 || response.status >= 500) && attempt < 4) {
    await pause(750 * attempt);
    return fetchJSON(url, attempt + 1);
  }

  if (!response.ok) {
    throw new Error(`iNaturalist request failed (${response.status}): ${url}`);
  }

  return response.json();
}

async function getSpeciesCounts() {
  const firstUrl = `${API_ROOT}/observations/species_counts?project_id=${PROJECT_SLUG}&quality_grade=research&per_page=${PAGE_SIZE}&page=1&locale=en`;
  const first = await fetchJSON(firstUrl);
  const pages = Math.ceil(first.total_results / PAGE_SIZE);
  const results = [...(first.results || [])];

  for (let page = 2; page <= pages; page += 1) {
    const url = `${API_ROOT}/observations/species_counts?project_id=${PROJECT_SLUG}&quality_grade=research&per_page=${PAGE_SIZE}&page=${page}&locale=en`;
    const response = await fetchJSON(url);
    results.push(...(response.results || []));
    await pause(250);
  }

  if (results.length !== first.total_results) {
    throw new Error(`Expected ${first.total_results} taxon entries; received ${results.length}. Run the snapshot again.`);
  }

  return { totalResults: first.total_results, results, sourceUrl: firstUrl };
}

async function getObservationEndpoint(params) {
  const url = `${API_ROOT}/observations?${new URLSearchParams({
    project_id: PROJECT_SLUG,
    quality_grade: "research",
    per_page: "1",
    ...params,
  })}`;
  return { data: await fetchJSON(url), url };
}

function mapTaxon(result) {
  const taxon = result.taxon || {};
  const classification = groupMap[taxon.iconic_taxon_name];
  if (!classification) {
    throw new Error(`Unmapped iconic taxon ${taxon.iconic_taxon_name || "(missing)"} for taxon ${taxon.id}`);
  }

  if (!Number.isInteger(taxon.id) || !taxon.name || !taxon.rank || !Number.isInteger(result.count)) {
    throw new Error(`Incomplete species-count record for taxon ${taxon.id || "(missing)"}`);
  }

  return {
    taxonId: taxon.id,
    scientificName: taxon.name,
    commonName: taxon.preferred_common_name || "",
    rank: taxon.rank,
    active: Boolean(taxon.is_active),
    iconicTaxon: taxon.iconic_taxon_name,
    domain: classification.domain,
    group: classification.group,
    researchGradeObservationCount: result.count,
  };
}

function sortTaxa(a, b) {
  const groupDifference = groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group);
  return groupDifference || a.scientificName.localeCompare(b.scientificName, "en");
}

async function main() {
  const asOfDate = readAsOfDate();
  const projectResponse = await fetchJSON(`${API_ROOT}/projects/${PROJECT_SLUG}`);
  const project = projectResponse.results?.[0];
  if (!project || !project.place_id) throw new Error("The iNaturalist project or its collection-place rule was not available.");

  const speciesCounts = await getSpeciesCounts();
  const [{ data: observationTotal, url: observationQuery }, { data: earliest }, { data: latest }] = await Promise.all([
    getObservationEndpoint({ per_page: "0" }),
    getObservationEndpoint({ order_by: "observed_on", order: "asc" }),
    getObservationEndpoint({ order_by: "observed_on", order: "desc" }),
  ]);

  const taxa = speciesCounts.results.map(mapTaxon).sort(sortTaxa);
  const taxonIds = new Set(taxa.map((taxon) => taxon.taxonId));
  if (taxonIds.size !== taxa.length) throw new Error("The snapshot contains duplicate iNaturalist taxon IDs.");

  const summedObservations = taxa.reduce((sum, taxon) => sum + taxon.researchGradeObservationCount, 0);
  if (summedObservations !== observationTotal.total_results) {
    throw new Error(
      `Species-count total (${summedObservations}) does not match Research Grade observation total (${observationTotal.total_results}). Run the snapshot again.`,
    );
  }

  const countsByGroup = Object.fromEntries(
    groupOrder.map((group) => [group, taxa.filter((taxon) => taxon.group === group).length]),
  );
  const countsByRank = taxa.reduce((counts, taxon) => {
    counts[taxon.rank] = (counts[taxon.rank] || 0) + 1;
    return counts;
  }, {});
  const observationStartYear = String(earliest.results?.[0]?.observed_on || "").slice(0, 4);
  const observationEndYear = String(latest.results?.[0]?.observed_on || asOfDate).slice(0, 4);

  const distributionPath = `/assets/data/biodiversity-inaturalist-research-grade-${asOfDate}.json`;
  const output = {
    schemaVersion: 1,
    dataset: {
      name: `Biodiversity of MHTR iNaturalist Research Grade taxon snapshot - ${asOfDate}`,
      description:
        "Taxon identifiers, accepted names and aggregate Research Grade observation counts from the public Biodiversity of MHTR iNaturalist collection project. The project covers its custom MHTR Kota place, which includes the reserve landscape and surrounding urban-rural areas; records are not asserted to fall inside the notified tiger-reserve boundary.",
      creator: "MHTR.in",
      creatorUrl: "https://mhtr.in/",
      license: "https://creativecommons.org/licenses/by/4.0/",
      asOfDate,
      datePublished: asOfDate,
      dateModified: asOfDate,
      temporalCoverage: `${observationStartYear}/${observationEndYear}`,
      spatialCoverage:
        "Biodiversity of MHTR project custom place 'MHTR Kota' (iNaturalist place 231112): the Mukundara Hills Tiger Reserve landscape and surrounding urban-rural areas of Kota, Rajasthan, India; not a notified-boundary-only dataset.",
      distributionPath,
    },
    project: {
      id: project.id,
      slug: PROJECT_SLUG,
      title: project.title,
      url: PROJECT_URL,
      placeId: project.place_id,
      placeName: "MHTR Kota",
      placeUrl: `https://www.inaturalist.org/places/${project.place_id}`,
      scope:
        "Collection-project records meeting the iNaturalist rules for the custom MHTR Kota place. The project description includes MHTR and surrounding urban-rural areas of Kota.",
    },
    methodology: {
      qualityGrade: "research",
      interpretation:
        "Research Grade is an iNaturalist data-quality category based on the platform's date, location, media, wild/captive and community-identification criteria. It is not independent verification by MHTR.in.",
      countCaveat:
        "Observation counts describe records submitted to this project. They do not measure population size, abundance, density or distribution within the notified tiger reserve.",
      privacy:
        "The published snapshot contains no coordinates, observation dates, observer names, observation IDs or photographs. MHTR.in does not reproduce recent-observation sequences for any taxon.",
      media:
        "Photographs are not included in this dataset. The website may display an iNaturalist taxon reference image only when the API marks it CC0, CC BY or CC BY-SA, with creator, licence and source links.",
      sourceQueries: [speciesCounts.sourceUrl, observationQuery],
      references: [PROJECT_URL, HELP_URLS.qualityGrade, HELP_URLS.geoprivacy, HELP_URLS.licensing, HELP_URLS.apiPractices],
    },
    summary: {
      researchGradeObservations: observationTotal.total_results,
      taxonEntries: taxa.length,
      speciesEntries: countsByRank.species || 0,
      nonSpeciesEntries: taxa.length - (countsByRank.species || 0),
      countsByRank,
      countsByGroup,
      observationYearRange: {
        start: observationStartYear,
        end: observationEndYear,
      },
    },
    taxa,
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(
    `Wrote ${path.relative(process.cwd(), OUTPUT_PATH)}: ${taxa.length} taxon entries and ${observationTotal.total_results} Research Grade observations as of ${asOfDate}.`,
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
