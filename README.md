# MHTR.in

MHTR.in is an open-source, conservation-first public guide to Mukundara Hills Tiger Reserve in south-eastern Rajasthan, India.

The project brings together plain-language landscape context, biodiversity notes, field reports, GIS maps, official documents, research references and carefully reviewed media so that citizens can understand the Mukundara landscape without exposing sensitive wildlife information.

## Purpose

Mukundara Hills Tiger Reserve is often discussed through scattered fragments: tiger updates, tourism, isolated sightings, documents, maps or local observations. This project exists to keep the wider picture together.

We want MHTR.in to help readers understand:

- the landscape, including the Vindhyan hill systems, Chambal-linked water systems, wetlands, forests, grasslands and corridors;
- the biodiversity of the reserve and surrounding landscape, beyond tiger-only narratives;
- the public documents, plans, notifications and research that support conservation decisions;
- local field observations that are useful, respectful and evidence based;
- how to discuss conservation without publishing risky real-time locations, nests, dens, roosts or sensitive coordinates.

The goal is simple: make reliable conservation knowledge easier to find, easier to read and safer to share.

## What Can Be Featured

Images, videos, field notes, documents and other content can be featured on MHTR.in when they are evidence based and submitted with clear context.

Useful contributions may include:

- wildlife observations;
- plant, habitat, landscape or seasonal change records;
- field reports and natural-history notes;
- public documents, research papers or official references;
- conservation-safe maps and spatial context;
- corrections, source improvements and metadata fixes.

Featured material should include proper credits and enough metadata for readers to understand what they are seeing.

## Metadata Requirements

Please include as much of the following as possible with any media or field content:

- contributor name and preferred credit line;
- date and time of the observation or event;
- broad location or landscape context;
- species name, event, habitat or landscape note;
- short description of what the evidence shows;
- source, citation or document link, when relevant;
- camera/device or file metadata, when useful;
- usage permission or license for publishing on MHTR.in.

Do not submit exact coordinates or sensitive site details for nests, dens, roosts, breeding locations, live wildlife movement, rare species risk points or other information that could increase disturbance or harm.

## Contributing

This is an open-source project. Anyone who would like to contribute can raise a pull request.

Contributions are reviewed before publication. After peer review, accepted changes can be published with proper attribution.

Good pull requests are usually:

- evidence based;
- clearly sourced;
- conservation safe;
- written in accessible language;
- respectful of authorship, local knowledge and wildlife ethics;
- small enough to review carefully.

If you are adding field observations, media, biodiversity records or landscape notes, please include the metadata listed above in the pull request description.

## Local Development

This site is built with Eleventy and Pagefind.

Install dependencies:

```sh
npm install
```

Run the local development server:

```sh
npm run dev
```

Build the site and search index:

```sh
npm run build
```

Run project checks:

```sh
npm run check
```

## Cloudflare Pages and R2

Cloudflare Pages builds should set `MHTR_DOCS_BASE_URL` so PDFs are served from R2 instead of being bundled into the Pages output.

Sync local PDFs to the R2 bucket:

```sh
npm run sync:docs:r2
```

Preview the upload commands without changing R2:

```sh
npm run sync:docs:r2 -- --dry-run
```

Deploy the staging alias:

```sh
MHTR_DOCS_BASE_URL=https://pub-4e1957b6823149509c59fa97dc87285d.r2.dev npm run deploy:cloudflare:staging
```

When DNS is fully on Cloudflare, replace the temporary `r2.dev` URL with the custom R2 domain, for example `MHTR_DOCS_BASE_URL=https://docs.mhtr.in`.

## Social Preview Images

When replacing a primary page image, update the matching `og_image` front matter so social previews stay aligned with the visible page.

- Home: `/assets/imgs/mhtr-landscape-1.jpg`
- Landscape: `/assets/imgs/landscape/landscape-ancient-trees.jpg`
- GIS Maps: `/assets/imgs/maps/mhtr-terrain-relief-map-preview.jpg`
- Biodiversity: `/assets/imgs/mhtr-caracal.jpg`
- Field Reports: `/assets/imgs/field-reports/banyan-header-1600.jpg`
- Resources: `/assets/imgs/mhtr-resources.png`
- About: `/assets/imgs/mukundara-hills-tiger-reserve-landscape.png`

Full-resolution GIS map PNGs should be reserved for the fullscreen zoom viewer. Use lightweight JPG/WebP derivatives for cards, thumbnails and social previews.

## Image Rights Metadata

Run `npm run protect:images` after adding or replacing image assets. The script embeds `MHTR_IMAGE_RIGHTS_v1`, creator, credit, copyright and usage terms metadata for Cane & Camera by Vinay Chittora across JPG, PNG, WebP and SVG assets in `src/assets/assets/imgs/`.

## Project Structure

- `src/` - website source files, templates, data and public assets.
- `src/_data/` - structured site data, resources, authors, maps and field report listings.
- `src/assets/docs/resources/` - public PDFs shown in the resources section.
- `Data/source-materials/` - local-only source drops and GIS notes; bulky raw inputs are ignored and website-ready assets live under `src/assets/`.
- `scripts/` - utility scripts for maps, image-rights metadata and SEO checks.
- `docs/` - project documentation and setup notes.

## Editorial Principles

MHTR.in follows a few simple rules:

- Check important claims against documents, research, field evidence or clear editorial notes.
- Keep sensitive wildlife details out of public pages.
- Use plain language without hiding uncertainty.
- Credit contributors, photographers, authors and source institutions properly.
- Treat local observations as valuable, but review them carefully before publication.

## Credits

All featured contributors, photographers, field observers, researchers and source institutions should be credited wherever their work appears.

If you notice missing credit, incorrect metadata, outdated information or a conservation-safety concern, please open an issue or pull request.
