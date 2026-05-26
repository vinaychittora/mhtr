# MHTR Source Materials

This directory keeps project inputs separate from files served directly by the website.

## Folders

- `documents/official/` - Official PDFs and planning documents used for reference or archiving.
- `documents/research/` - Research papers and technical references used for ecology, biodiversity and corridor context.
- `field-report-inputs/` - Draft documents, photographs and source inputs used while preparing field reports.
- `gis/` - Source notes, intermediate GIS inputs and cached public map tiles used by `scripts/build-gis-maps.py`.
- `search-console/` - Google Search Console exports for site maintenance and SEO review.
- `user-uploads/` - One-off uploads or screenshots kept as project context.

## Website-ready Outputs

Files used directly by the website live under `src/assets/`, especially:

- `src/assets/assets/imgs/` for public images.
- `src/assets/assets/imgs/maps/` for generated GIS map PNGs.
- `src/assets/docs/resources/` for archived PDFs shown on the resources page.

GIS maps can be rebuilt with:

```sh
python3 scripts/build-gis-maps.py
```

The generated maps are public interpretation maps, not legal survey demarcations, and they intentionally avoid exact wildlife-use coordinates.
