const fs = require("fs");
const path = require("path");
const CleanCSS = require("clean-css");

const inputPath = path.join(__dirname, "..", "src", "assets", "assets", "css", "style.css");
const outputPath = path.join(__dirname, "..", "_site", "assets", "css", "style.css");

const source = fs.readFileSync(inputPath, "utf8");
const result = new CleanCSS({
  level: 2,
  returnPromise: false,
}).minify(source);

if (result.errors.length) {
  throw new Error(`CSS minification failed:\n${result.errors.join("\n")}`);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, result.styles);

const beforeKiB = Buffer.byteLength(source) / 1024;
const afterKiB = Buffer.byteLength(result.styles) / 1024;
const savedKiB = beforeKiB - afterKiB;

console.log(
  `Minified CSS: ${beforeKiB.toFixed(1)} KiB -> ${afterKiB.toFixed(1)} KiB (${savedKiB.toFixed(1)} KiB saved)`,
);
