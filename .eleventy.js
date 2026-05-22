module.exports = function (eleventyConfig) {
  eleventyConfig.addFilter("htmlDateString", (dateObj) => {
    return new Date(dateObj).toISOString().slice(0, 10);
  });

  // Copy only web-ready assets, not OS/browser metadata sidecar files.
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/css/style.css": "assets/css/style.css" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/js/main.js": "assets/js/main.js" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/*.jpg": "assets/imgs" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/*.jpeg": "assets/imgs" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/*.png": "assets/imgs" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/*.svg": "assets/imgs" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/*.webp": "assets/imgs" });
  eleventyConfig.addPassthroughCopy({ "src/assets/assets/imgs/field-reports/*.jpg": "assets/imgs/field-reports" });
  eleventyConfig.addPassthroughCopy({ "src/assets/docs/resources/*.pdf": "assets/docs/resources" });
  eleventyConfig.addPassthroughCopy({ "src/_redirects": "_redirects" });

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
