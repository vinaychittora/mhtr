module.exports = function (eleventyConfig) {
  const deploymentTarget = process.env.MHTR_DEPLOY_TARGET || "default";
  const docsArchiveBaseUrl = (process.env.MHTR_DOCS_BASE_URL || "").replace(/\/$/, "");
  const inatSnapshot = require("./src/_data/inatBiodiversity.json");

  eleventyConfig.addGlobalData("deployment", {
    target: deploymentTarget,
    docsArchiveBaseUrl,
  });

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

  eleventyConfig.addFilter("jsonLd", (value) => {
    return JSON.stringify(value).replace(/</g, "\\u003c");
  });

  eleventyConfig.addFilter("archiveDocumentUrl", (localPath) => {
    if (!localPath) return "";
    return docsArchiveBaseUrl ? `${docsArchiveBaseUrl}${localPath.startsWith("/") ? localPath : `/${localPath}`}` : localPath;
  });

  eleventyConfig.addShortcode("seoJsonLd", (payload) => {
    const site = payload.site || {};
    const siteUrl = (site.url || "https://mhtr.in").replace(/\/$/, "");
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
      },
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
            author: {
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

  eleventyConfig.addShortcode("documentJsonLd", (site, page, doc, archiveAvailable, archiveUrl) => {
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

  eleventyConfig.addShortcode("datasetJsonLd", (site, page, dataset) => {
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
      creator: {
        "@type": "Organization",
        name: dataset.creator || site.publisherName || "MHTR.in",
        url: dataset.creatorUrl || site.publisherUrl || siteUrl,
      },
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
  eleventyConfig.addPassthroughCopy({ "src/_redirects": "_redirects" });
  eleventyConfig.addPassthroughCopy({ "src/_headers": "_headers" });
  eleventyConfig.addPassthroughCopy({ "src/favicon.ico": "favicon.ico" });
  eleventyConfig.addPassthroughCopy({ "mandirgarh-trails-map.html": "mandirgarh-trails-map.html" });
  // The public interactive map is an indicative planning aid. Downloadable route
  // files and other sensitive working data remain outside the published build.

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
