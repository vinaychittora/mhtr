# MHTR Source Materials

This directory is for local source drops and lightweight notes that should stay separate from files served directly by the website.

Large raw downloads, drafts, screenshots, Search Console exports and research-paper source copies are intentionally ignored by git. Keep website-ready PDFs, images and other public assets under `src/assets/`.

## Folders

- `gis/` - Source notes for generated map assets.
- `documents/`, `field-report-inputs/`, `search-console/` and `user-uploads/` are local-only scratch folders when needed.

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
