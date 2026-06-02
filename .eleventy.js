module.exports = function (eleventyConfig) {
  eleventyConfig.addFilter("htmlDateString", (dateObj) => {
    return new Date(dateObj).toISOString().slice(0, 10);
  });

  eleventyConfig.addFilter("jsonLd", (value) => {
    return JSON.stringify(value).replace(/</g, "\\u003c");
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
        landscape: "Landscape",
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

  // Copy only web-ready assets, not OS/browser metadata sidecar files.
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/css/style.css": "assets/css/style.css" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/js/main.js": "assets/js/main.js" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/js/resource-browser.js": "assets/js/resource-browser.js" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/*.jpg": "assets/imgs" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/*.jpeg": "assets/imgs" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/*.png": "assets/imgs" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/*.svg": "assets/imgs" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/*.webp": "assets/imgs" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/home/plain-guide/*.jpg": "assets/imgs/home/plain-guide" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/home/routes/*.jpg": "assets/imgs/home/routes" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/home/routes/*.webp": "assets/imgs/home/routes" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/landscape/*.jpg": "assets/imgs/landscape" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/maps/*.png": "assets/imgs/maps" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/maps/*.jpg": "assets/imgs/maps" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/maps/*.webp": "assets/imgs/maps" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/field-reports/*.jpg": "assets/imgs/field-reports" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/field-reports/*.png": "assets/imgs/field-reports" });
  eleventyConfig.addPassthroughCopy({ "src/assets/docs/field-reports/*.pdf": "assets/docs/field-reports" });
  eleventyConfig.addPassthroughCopy({ "src/assets/docs/resources/*.pdf": "assets/docs/resources" });
  eleventyConfig.addPassthroughCopy({ "src/_redirects": "_redirects" });
  eleventyConfig.addPassthroughCopy({ "src/favicon.ico": "favicon.ico" });

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
