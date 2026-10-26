module.exports = function (eleventyConfig) {
  const deploymentTarget = process.env.MHTR_DEPLOY_TARGET || "default";
  const docsArchiveBaseUrl = (process.env.MHTR_DOCS_BASE_URL || "").replace(/\/$/, "");
  const inatSnapshot = require("./src/_data/inatBiodiversity.json");
  // Measured-vs-notified areas, written by scripts/build-boundary-layers.py.
  const boundaryAreas = require("./Data/source-materials/gis/derived/mhtr-boundary-areas-2023.json");
  const gisSources = require("./Data/source-materials/gis/official/sources.json");

  eleventyConfig.addGlobalData("deployment", {
    target: deploymentTarget,
    docsArchiveBaseUrl,
  });
  const authors = require("./src/_data/authors.json");
  eleventyConfig.addGlobalData("boundaryAreas", boundaryAreas);
  eleventyConfig.addGlobalData("gisSources", gisSources);

  eleventyConfig.addFilter("htmlDateString", (dateObj) => {
    return new Date(dateObj).toISOString().slice(0, 10);
  });

  eleventyConfig.addFilter("sitemapDate", (value) => {
    if (!value) return "";
    const calendarDate = String(value).match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/)?.[1];
    if (calendarDate) return calendarDate;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
  });

  eleventyConfig.addFilter("absoluteUrl", (value, baseUrl = "https://mhtr.in") => {
    if (!value) return "";
    try {
      return new URL(value, `${String(baseUrl).replace(/\/$/, "")}/`).href;
    } catch {
      return "";
    }
  });

  eleventyConfig.addFilter("km2", (value) => {
    if (value === null || value === undefined || value === "") return "—";
    return Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  });

  eleventyConfig.addFilter("jsonLd", (value) => {
    return JSON.stringify(value).replace(/</g, "\\u003c");
  });

  eleventyConfig.addFilter("archiveDocumentUrl", (localPath) => {
    if (!localPath) return "";
    return docsArchiveBaseUrl ? `${docsArchiveBaseUrl}${localPath.startsWith("/") ? localPath : `/${localPath}`}` : localPath;
  });

  // Person nodes for the people who make the site, referenced by @id from WebSite, pages and images.
  const personId = (siteUrl, key) => `${siteUrl}/about/#${key}`;
  const personNode = (siteUrl, key) => {
    const person = authors[key];
    if (!person) return null;
    return {
      "@type": "Person",
      "@id": personId(siteUrl, key),
      name: person.name,
      ...(person.role ? { jobTitle: person.role } : {}),
      ...(person.bio ? { description: person.bio } : {}),
      ...(person.url ? { url: person.url } : {}),
      ...(Array.isArray(person.sameAs) && person.sameAs.length ? { sameAs: person.sameAs } : {}),
      worksFor: { "@id": `${siteUrl}#publisher` },
    };
  };
  const authorRef = (siteUrl, name) => {
    const key = Object.keys(authors).find((k) => authors[k].name === name);
    return key ? { "@id": personId(siteUrl, key) } : { "@type": "Person", name };
  };

  eleventyConfig.addShortcode("seoJsonLd", (payload) => {
    const site = payload.site || {};
    const siteUrl = (site.url || "https://mhtr.in").replace(/\/$/, "");
    const creatorKeys = Array.isArray(site.creators) ? site.creators : [];
    const creatorNodes = creatorKeys.map((key) => personNode(siteUrl, key)).filter(Boolean);
    const canonical = payload.pageCanonical || `${siteUrl}${payload.pageUrl || "/"}`;
    const pageType = payload.pageSchemaType || "WebPage";
    const language = payload.pageLang || site.locale || "en-IN";
    const imageUrl = payload.pageImage || site.ogImage;
    const keywords = (payload.keywords || site.keywords || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    const image = imageUrl
      ? {
          "@type": "ImageObject",
          url: imageUrl,
          ...(payload.pageImageAlt ? { caption: payload.pageImageAlt } : {}),
          ...(payload.pageImageWidth ? { width: Number(payload.pageImageWidth) } : {}),
          ...(payload.pageImageHeight ? { height: Number(payload.pageImageHeight) } : {}),
        }
      : undefined;

    const graph = [
      {
        "@type": "Organization",
        "@id": `${siteUrl}#publisher`,
        name: site.publisherName || "MHTR.in",
        alternateName: site.alternateName || ["MHTR", "Mukundara Hills Tiger Reserve"],
        url: site.publisherUrl || siteUrl,
        logo: {
          "@type": "ImageObject",
          url: `${siteUrl}/assets/imgs/mhtr-logo-512.png`,
          width: 512,
          height: 512,
        },
        ...(site.contactEmail ? { email: site.contactEmail } : {}),
        ...(creatorNodes.length ? { founder: { "@id": creatorNodes[0]["@id"] }, member: creatorNodes.map((node) => ({ "@id": node["@id"] })) } : {}),
      },
      ...creatorNodes,
      {
        "@type": "WebSite",
        "@id": `${siteUrl}#website`,
        name: site.name || "MHTR.in",
        alternateName: site.alternateName || [
          "Mukundara Hills Tiger Reserve",
          "Mukundra Hills Tiger Reserve",
          "Mukandra Hills Tiger Reserve",
        ],
        url: siteUrl,
        description: site.description,
        inLanguage: language,
        publisher: { "@id": `${siteUrl}#publisher` },
        ...(creatorNodes.length ? { author: creatorNodes.map((node) => ({ "@id": node["@id"] })), creator: creatorNodes.map((node) => ({ "@id": node["@id"] })) } : {}),
        potentialAction: {
          "@type": "SearchAction",
          target: `${siteUrl}/search/?q={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      },
    ];

    const pagePath = new URL(canonical).pathname;
    let breadcrumb;
    if (pagePath !== "/") {
      const segmentLabels = {
        about: "About",
        biodiversity: "Biodiversity",
        "field-reports": "Field Reports",
        "gis-maps": "GIS Maps",
        "boundaries-and-notifications": "Boundary and Notifications",
        conservation: "Conservation Evidence",
        landscape: "Landscape",
        "mandirgarh-homestay": "Mandirgarh Homestay Pilot",
        resources: "Resources",
        documents: "Documents",
        inaturalist: "iNaturalist",
        callback: "Callback",
        search: "Search",
      };
      const segments = pagePath.replace(/^\/|\/$/g, "").split("/");
      const itemListElement = [
        {
          "@type": "ListItem",
          position: 1,
          name: "MHTR.in",
          item: `${siteUrl}/`,
        },
      ];
      let path = "";
      segments.forEach((segment, index) => {
        path += `/${segment}`;
        const isLast = index === segments.length - 1;
        const name =
          isLast && (payload.breadcrumbLabel || payload.pageTitle)
            ? (payload.breadcrumbLabel || payload.pageTitle).replace(/\s+\|\s+.*$/, "")
            : segmentLabels[segment] || segment.replace(/-/g, " ");
        itemListElement.push({
          "@type": "ListItem",
          position: index + 2,
          name,
          item: `${siteUrl}${path}/`,
        });
      });

      breadcrumb = {
        "@type": "BreadcrumbList",
        "@id": `${canonical}#breadcrumb`,
        itemListElement,
      };
    }

    graph.push({
      "@type": pageType,
      "@id": `${canonical}#webpage`,
      url: canonical,
      name: payload.pageTitle,
      description: payload.pageDescription,
      isPartOf: { "@id": `${siteUrl}#website` },
      inLanguage: language,
      publisher: { "@id": `${siteUrl}#publisher` },
      ...(breadcrumb ? { breadcrumb: { "@id": `${canonical}#breadcrumb` } } : {}),
      ...(image ? { primaryImageOfPage: image, image } : {}),
      ...(keywords.length ? { keywords } : {}),
      ...(payload.author
        ? {
            author: authors[Object.keys(authors).find((k) => authors[k].name === payload.author)]
              ? authorRef(siteUrl, payload.author)
              : {
                  "@type": "Person",
                  name: payload.author,
                  ...(payload.authorUrl ? { url: payload.authorUrl } : {}),
                },
          }
        : {}),
      ...(payload.publishedTime ? { datePublished: payload.publishedTime } : {}),
      ...(payload.modifiedTime ? { dateModified: payload.modifiedTime } : {}),
    });

    if (breadcrumb) graph.push(breadcrumb);

    return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 2).replace(/</g, "\\u003c");
  });

  // Responsive photo prepared by `npm run images:web` (WebP 480/800/1200[/1600] + 1200px JPEG fallback).
  eleventyConfig.addShortcode("photo", (slug, alt, ratio = "3/2", sizes = "(max-width: 760px) calc(100vw - 30px), 760px", loading = "lazy") => {
    const fs = require("fs");
    const base = `/assets/imgs/landscape/${slug}`;
    const widths = [480, 800, 1200, 1600].filter((w) => fs.existsSync(`src/assets/assets/imgs/landscape/${slug}-${w}.webp`));
    const [rw, rh] = String(ratio).split("/").map(Number);
    const height = Math.round((1200 * rh) / rw);
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    return `<picture><source type="image/webp" srcset="${widths.map((w) => `${base}-${w}.webp ${w}w`).join(", ")}" sizes="${sizes}"><img src="${base}-1200.jpg" alt="${esc(alt)}" width="1200" height="${height}" loading="${loading}" decoding="async"></picture>`;
  });

  eleventyConfig.addShortcode("documentJsonLd", (site, page, doc, archiveAvailable, archiveUrl, basis) => {
    const siteUrl = (site.url || "https://mhtr.in").replace(/\/$/, "");
    const payload = {
      "@context": "https://schema.org",
      "@type": "DigitalDocument",
      "@id": `${siteUrl}${page.url}#document`,
      name: doc.title,
      description: doc.summary,
      url: `${siteUrl}${page.url}`,
      inLanguage: "en-IN",
      publisher: {
        "@type": "Organization",
        name: doc.source,
      },
      isPartOf: {
        "@id": `${siteUrl}${page.url}#webpage`,
      },
      about: ["Mukundara Hills Tiger Reserve", "Rajasthan wildlife conservation", doc.category],
      citation: doc.sourceUrl,
      dateModified: doc.archivedAt,
      ...(doc.credit ? { creditText: doc.credit } : {}),
      ...(basis && basis.url && doc.reuseBasis && doc.reuseBasis.startsWith("cc") ? { license: basis.url } : {}),
    };

    if (archiveAvailable) {
      payload.encoding = {
        "@type": "MediaObject",
        contentUrl: archiveUrl && /^https?:\/\//.test(archiveUrl) ? archiveUrl : `${siteUrl}${archiveUrl || doc.localPath}`,
        encodingFormat: "application/pdf",
        name: doc.fileName,
        contentSize: doc.fileSize,
      };
    }

    return JSON.stringify(payload, null, 2).replace(/</g, "\\u003c");
  });

  eleventyConfig.addShortcode("datasetJsonLd", (site, page, dataset, person) => {
    const siteUrl = (site.url || "https://mhtr.in").replace(/\/$/, "");
    const pageUrl = `${siteUrl}${page.url}`;
    const payload = {
      "@context": "https://schema.org",
      "@type": "Dataset",
      "@id": `${pageUrl}#dataset`,
      name: dataset.name,
      description: dataset.description,
      url: pageUrl,
      inLanguage: dataset.inLanguage || "en-IN",
      creator: person
        ? { "@type": "Person", name: person.name, url: person.url, sameAs: person.sameAs }
        : {
            "@type": "Organization",
            name: dataset.creator || site.publisherName || "MHTR.in",
            url: dataset.creatorUrl || site.publisherUrl || siteUrl,
          },
      publisher: { "@type": "Organization", name: site.publisherName || "MHTR.in", url: site.publisherUrl || siteUrl },
      ...(dataset.license ? { license: dataset.license } : {}),
      ...(dataset.datePublished ? { datePublished: dataset.datePublished } : {}),
      ...(dataset.dateModified ? { dateModified: dataset.dateModified } : {}),
      ...(dataset.temporalCoverage ? { temporalCoverage: dataset.temporalCoverage } : {}),
      ...(dataset.spatialCoverage
        ? {
            spatialCoverage: {
              "@type": "Place",
              name: dataset.spatialCoverage,
            },
          }
        : {}),
      ...(Array.isArray(dataset.citation) && dataset.citation.length
        ? { citation: dataset.citation }
        : dataset.citation
          ? { citation: dataset.citation }
          : {}),
      ...(Array.isArray(dataset.distribution) && dataset.distribution.length
        ? {
            distribution: dataset.distribution.map((item) => ({
              "@type": "DataDownload",
              name: item.name,
              contentUrl: new URL(item.contentUrl, `${siteUrl}/`).href,
              encodingFormat: item.encodingFormat,
            })),
          }
        : {}),
      isPartOf: { "@id": `${pageUrl}#webpage` },
    };

    return JSON.stringify(payload, null, 2).replace(/</g, "\\u003c");
  });

  eleventyConfig.addShortcode("mapJsonLd", (site, page, map) => {
    const siteUrl = (site.url || "https://mhtr.in").replace(/\/$/, "");
    const pageUrl = `${siteUrl}${page.url}`;
    const payload = {
      "@context": "https://schema.org",
      "@type": "Map",
      "@id": `${pageUrl}#map`,
      name: map.name,
      description: map.description,
      url: pageUrl,
      inLanguage: map.inLanguage || "en-IN",
      ...(map.image ? { image: new URL(map.image, `${siteUrl}/`).href } : {}),
      ...(map.dateModified ? { dateModified: map.dateModified } : {}),
      ...(map.spatialCoverage
        ? {
            spatialCoverage: {
              "@type": "Place",
              name: map.spatialCoverage,
            },
          }
        : {}),
      ...(Array.isArray(map.citation) && map.citation.length
        ? { citation: map.citation }
        : map.citation
          ? { citation: map.citation }
          : {}),
      ...(map.downloadUrl
        ? {
            associatedMedia: {
              "@type": "MediaObject",
              contentUrl: new URL(map.downloadUrl, `${siteUrl}/`).href,
              encodingFormat: map.encodingFormat || "image/png",
            },
          }
        : {}),
      isPartOf: { "@id": `${pageUrl}#webpage` },
    };

    return JSON.stringify(payload, null, 2).replace(/</g, "\\u003c");
  });

  // One ImageObject per GIS map, with the creator, credit and licence fields that image search reads.
  eleventyConfig.addShortcode("mapGalleryJsonLd", (site, page, maps, person) => {
    const siteUrl = (site.url || "https://mhtr.in").replace(/\/$/, "");
    const pageUrl = `${siteUrl}${page.url}`;
    const creator = { "@type": "Person", name: person.name, url: person.url, ...(person.sameAs ? { sameAs: person.sameAs } : {}) };
    const items = (maps || []).map((map, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": ["ImageObject", "Map"],
        "@id": `${pageUrl}#${map.slug}`,
        name: map.title,
        headline: map.title,
        description: map.summary,
        caption: map.alt,
        contentUrl: `${siteUrl}${map.image}`,
        url: `${pageUrl}#${map.slug}`,
        thumbnailUrl: `${siteUrl}${map.preview || map.image}`,
        encodingFormat: "image/png",
        width: map.width,
        height: map.height,
        inLanguage: "en-IN",
        creator,
        author: creator,
        copyrightHolder: creator,
        copyrightNotice: `© ${person.name} / MHTR.in`,
        creditText: `Map: ${person.name}, mhtr.in`,
        acquireLicensePage: `${pageUrl}#gis-source-heading`,
        license: `${pageUrl}#gis-source-heading`,
        publisher: { "@id": `${siteUrl}#publisher` },
        ...(map.dateModified ? { dateModified: map.dateModified } : {}),
        ...(map.sources ? { citation: map.sources } : {}),
        spatialCoverage: { "@type": "Place", name: "Mukundara Hills Tiger Reserve, Rajasthan, India" },
        representativeOfPage: index === 0,
        isPartOf: { "@id": `${pageUrl}#webpage` },
      },
    }));
    const payload = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      "@id": `${pageUrl}#maps`,
      name: "Mukundara Hills Tiger Reserve GIS maps",
      numberOfItems: items.length,
      itemListElement: items,
    };
    return JSON.stringify(payload, null, 2).replace(/</g, "\\u003c");
  });

  // Copy only web-ready assets, not OS/browser metadata sidecar files.
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/css/style.css": "assets/css/style.css" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/css/mandirgarh-proposal.css": "assets/css/mandirgarh-proposal.css" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/js/main.js": "assets/js/main.js" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/js/resource-browser.js": "assets/js/resource-browser.js" });
  eleventyConfig.addPassthroughCopy({
    "src/_data/inatBiodiversity.json": inatSnapshot.dataset.distributionPath.replace(/^\//, ""),
  });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/*.jpg": "assets/imgs" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/*.jpeg": "assets/imgs" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/*.png": "assets/imgs" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/*.svg": "assets/imgs" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/*.webp": "assets/imgs" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/home/plain-guide/*.jpg": "assets/imgs/home/plain-guide" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/home/routes/*.jpg": "assets/imgs/home/routes" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/home/routes/*.webp": "assets/imgs/home/routes" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/landscape/*.jpg": "assets/imgs/landscape" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/landscape/*.webp": "assets/imgs/landscape" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/maps/*.png": "assets/imgs/maps" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/maps/*.jpg": "assets/imgs/maps" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/maps/*.webp": "assets/imgs/maps" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/field-reports/*.jpg": "assets/imgs/field-reports" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/field-reports/*.png": "assets/imgs/field-reports" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/mandirgarh/*.jpg": "assets/imgs/mandirgarh" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/mandirgarh/*.webp": "assets/imgs/mandirgarh" });
  eleventyConfig.addPassthroughCopy({
    "src/assets/assets/imgs/field-reports/indian-gray-wolf-sighting-alania/alania-*.jpg":
      "assets/imgs/field-reports/indian-gray-wolf-sighting-alania",
  });
  eleventyConfig.addPassthroughCopy({ "src/assets/docs/field-reports/*.pdf": "assets/docs/field-reports" });
  eleventyConfig.addPassthroughCopy({ "src/assets/docs/resources/*.pdf": "assets/docs/resources" });
  eleventyConfig.addPassthroughCopy({
    "Data/source-materials/gis/mhtr-esz-outer-limit-2026-06-01.kmz": "assets/data/gis/mhtr-esz-outer-limit-2026-06-01.kmz",
  });
  // Boundary layers built by scripts/build-boundary-layers.py, and local copies of the
  // Forest Department files they are built from (district block files stay in the repo only).
  eleventyConfig.addPassthroughCopy({ "Data/source-materials/gis/derived/*.{kml,geojson,csv,json}": "assets/data/gis" });
  eleventyConfig.addPassthroughCopy({
    "Data/source-materials/gis/official/{mukundara,darrah,jawahar,bhainsrorgarh}-*.kmz": "assets/data/gis/official",
  });
  eleventyConfig.addPassthroughCopy({ "Data/source-materials/gis/official/sources.json": "assets/data/gis/official/sources.json" });
  eleventyConfig.addPassthroughCopy({ "src/_redirects": "_redirects" });
  eleventyConfig.addPassthroughCopy({ "src/_headers": "_headers" });
  eleventyConfig.addPassthroughCopy({ "src/favicon.ico": "favicon.ico" });
  // Mandirgarh trail maps, site points and route tracks are working data for the
  // proposal. They live in Data/source-materials/mandirgarh-plan/ and are never
  // copied into the published build.

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    templateFormats: ["njk", "md", "html"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
  };
};
