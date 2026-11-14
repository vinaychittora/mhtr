#!/usr/bin/env node
/*
 * Makes the pictures of the FALCON node for /falcon/ from the 3D model, and records where the
 * numbered callouts sit on each picture.
 *
 *   npm run build:site && node scripts/render-falcon-stills.js && npm run build
 *
 * Run it again whenever src/assets/assets/js/falcon/falcon-node-model.js or the stage colours in
 * falcon-project.css change. It opens the built page in a headless browser, switches the viewer to
 * 3D and photographs each view, so the stills always match what the live model shows.
 *
 * Needs Playwright with Chromium (npm i -D playwright && npx playwright install chromium).
 * Playwright is deliberately not a dependency of the site: the pictures are committed, and a
 * normal build never runs this script.
 *
 * Writes: src/assets/assets/imgs/falcon/node-<view>-<wide|tall>-<width>.webp
 *         src/assets/assets/imgs/falcon/falcon-node-hero-<width>.webp
 *         src/assets/assets/imgs/falcon/falcon-node-social.jpg
 *         src/_data/falconNodeLayout.json
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const siteDir = path.join(root, "_site");
const imgDir = path.join(root, "src", "assets", "assets", "imgs", "falcon");
const layoutFile = path.join(root, "src", "_data", "falconNodeLayout.json");
const project = require("../src/_data/falconProject.json");

// One stage per layout: `wide` is the 4:3 picture, `tall` the 4:5 picture phones get.
// `stage` is the size the stage is pinned to while it is photographed, in CSS pixels.
const variants = {
  wide: { viewport: { width: 1280, height: 1000 }, stage: { width: 700, height: 525 }, sizes: [1400, 800] },
  tall: { viewport: { width: 600, height: 1100 }, stage: { width: 600, height: 750 }, sizes: [1200, 720] },
};
// Two extra poses that are not tabs on the page.
const heroPose = { t: [4, 44, 6], th: -0.5, ph: 1.3, d: 930 };
const socialPose = { t: [2, 46, 6], th: 0.55, ph: 1.3, d: 900 };

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon" };

function serve() {
  const server = http.createServer((req, res) => {
    let file = path.join(siteDir, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file.startsWith(siteDir)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// The stage is pinned to the top left corner at a whole-pixel size, so every picture comes out at
// exactly the size the page's width and height attributes state.
const captureCss = ({ width, height }) => `
  .falcon-view { display: block !important; }
  .falcon-stage { position: fixed !important; left: 0 !important; top: 0 !important; z-index: 2147483647 !important; width: ${width}px !important; height: ${height}px !important; max-width: none !important; margin: 0 !important; aspect-ratio: auto !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
  .falcon-leaders, .falcon-markers, .falcon-controls, .falcon-status, .falcon-chip, .falcon-hint { display: none !important; }
  .site-header { display: none !important; }
`;

async function main() {
  if (!fs.existsSync(path.join(siteDir, "falcon", "index.html"))) throw new Error("Build the site first: npm run build:site");
  const { chromium } = require("playwright");
  fs.mkdirSync(imgDir, { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const layout = { note: "Written by scripts/render-falcon-stills.js. Positions are percentages of the stage, from its top left corner.", views: {} };
  let social = null;

  try {
    for (const [key, spec] of Object.entries(variants)) {
      const page = await browser.newPage({ viewport: spec.viewport, deviceScaleFactor: 2 });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error));
      await page.goto(`${base}/falcon/`, { waitUntil: "load" });
      await page.addStyleTag({ content: captureCss(spec.stage) });
      const viewer = await page.evaluateHandle(() => document.querySelector("[data-falcon-viewer]").falconViewer);
      await viewer.evaluate((v) => v.ready());
      const seen = await viewer.evaluate((v) => v.variant());
      if (seen !== key) throw new Error(`Expected the ${key} layout at ${spec.viewport.width}px, the page chose ${seen}`);

      const shoot = async (name) => {
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
        const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: spec.stage.width, height: spec.stage.height } });
        for (const width of spec.sizes) {
          const file = path.join(imgDir, `${name}-${width}.webp`);
          await sharp(png).resize({ width }).webp({ quality: 84, effort: 6 }).toFile(file);
          console.log(`  ${path.relative(root, file)}  ${(fs.statSync(file).size / 1024).toFixed(0)} kB`);
        }
      };

      for (const view of project.views) {
        await viewer.evaluate((v, id) => v.show(id), view.id);
        const marks = await viewer.evaluate((v) => v.layout());
        const ids = view.callouts.map((c) => c.id).join(",");
        if (marks.map((m) => m.id).join(",") !== ids) throw new Error(`Callouts of "${view.id}" differ between falconProject.json (${ids}) and the model`);
        layout.views[view.id] = layout.views[view.id] || {};
        layout.views[view.id][key] = Object.fromEntries(marks.map(({ id, ...at }) => [id, at]));
        await shoot(`node-${view.id}-${key}`);
      }

      if (key === "tall") {
        await viewer.evaluate((v, id) => v.show(id), project.views[0].id);
        await viewer.evaluate((v, pose) => v.look(pose, "outside"), heroPose);
        const saved = spec.sizes; spec.sizes = [1000, 600];
        await shoot("falcon-node-hero");
        spec.sizes = saved;
        await viewer.evaluate((v, pose) => v.look(pose, "outside"), socialPose);
        social = await viewer.evaluate((v) => v.snapshot());
      }
      await page.close();
      if (errors.length) throw errors[0];
    }

    // The picture shown when the page is shared: the node on the site's green, with the title.
    const font = fs.readFileSync(path.join(__dirname, "fonts", "LiberationSans-Bold.ttf")).toString("base64");
    const card = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await card.setContent(`<!doctype html><meta charset="utf-8"><style>
      @font-face { font-family: Card; src: url(data:font/ttf;base64,${font}); font-weight: 700; }
      html, body { margin: 0; }
      body { width: 1200px; height: 630px; display: grid; grid-template-columns: 1fr 440px; font-family: Card, sans-serif; background: #123d2c; color: #fff8e8; }
      .text { padding: 78px 30px 0 78px; }
      .site { font-size: 26px; letter-spacing: 3px; text-transform: uppercase; color: #d8bd68; }
      h1 { margin: 26px 0 22px; font-size: 96px; line-height: 0.98; letter-spacing: -2px; }
      p { margin: 0; font-size: 34px; line-height: 1.28; color: #dce8db; max-width: 600px; }
      .node { background: radial-gradient(120% 95% at 50% 38%, #f7f8f2 0%, #cfd9c8 100%); display: grid; place-items: center; overflow: hidden; }
      .node img { height: 700px; margin-top: 10px; }
    </style><div class="text"><div class="site">MHTR.in · Projects</div><h1>FALCON field node</h1><p>An open-source prototype that watches, listens and measures one water bowl.</p></div><div class="node"><img src="${social}"></div>`);
    await card.evaluate(() => document.fonts.ready);
    const jpg = path.join(imgDir, "falcon-node-social.jpg");
    await sharp(await card.screenshot({ type: "png" })).jpeg({ quality: 88, mozjpeg: true }).toFile(jpg);
    console.log(`  ${path.relative(root, jpg)}  ${(fs.statSync(jpg).size / 1024).toFixed(0)} kB`);
  } finally {
    await browser.close();
    server.close();
  }

  fs.writeFileSync(layoutFile, `${JSON.stringify(layout, null, 2)}\n`);
  console.log(`  ${path.relative(root, layoutFile)}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
