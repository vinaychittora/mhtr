# MHTR GIS sources and outputs

Built by `scripts/build-boundary-layers.py` (boundary layers) and `scripts/build-gis-maps.py` (map images).
Reference layers are snapshotted by `scripts/fetch-gis-reference.py`.

## Official map files (`official/`, plus the ESZ file in this folder)

Register: https://forest.rajasthan.gov.in/content/raj/forest/en/aboutus/departmental-wings/forest-devlopment/districtwise-forest-blocks-google-earth.html
The register's protected-area table is headed 'Last Updated kml as on 31.07.2018' and its ESZ column 'ESZ KML as on 01.06.2026'. The Forest Department describes these files as for management use, not legal purposes.
Downloaded 2026-10-23. The build stops if a file's SHA-256 changes.

| Key | File | Register date | Server date | SHA-256 | Source |
|---|---|---|---|---|---|
| reserve_2013_file | `official/mukundara-tiger-reserve-2025-02-24.kmz` | 31.07.2018 | 2025-02-24 | `ec3c6d02c14a9cda…` | [link](https://forest.rajasthan.gov.in/content/dam/raj/forest/ForestDepartment/PDFs/Department%20Wing/Forest%20Development/Districtwise%20Forest%20Blocks%20a%20Google%20Earth/tigerreserve/Mukundara%20Tiger%20Reserve.kmz) |
| np | `official/mukundara-hills-national-park-2018-08-07.kmz` | 31.07.2018 | 2018-08-07 | `a23ca5b24f00e702…` | [link](https://forest.rajasthan.gov.in/content/dam/raj/forest/ForestDepartment/PDFs/Department%20Wing/Forest%20Development/Districtwise%20Forest%20Blocks%20a%20Google%20Earth/update/wildlife/Mukundara%20Hills%20National%20Park.kmz) |
| darrah | `official/darrah-wildlife-sanctuary-2018-08-07.kmz` | 31.07.2018 | 2018-08-07 | `cf25d680f872a3d8…` | [link](https://forest.rajasthan.gov.in/content/dam/raj/forest/ForestDepartment/PDFs/Department%20Wing/Forest%20Development/Districtwise%20Forest%20Blocks%20a%20Google%20Earth/update/wildlife/Darrah%20Wildlife%20Sanctuary.kmz) |
| jawahar_sagar | `official/jawahar-sagar-wildlife-sanctuary-2018-08-07.kmz` | 31.07.2018 | 2018-08-07 | `ab6e078d52aac4a5…` | [link](https://forest.rajasthan.gov.in/content/dam/raj/forest/ForestDepartment/PDFs/Department%20Wing/Forest%20Development/Districtwise%20Forest%20Blocks%20a%20Google%20Earth/update/wildlife/Jawahar%20Sagar%20Wildlife%20Sanctuary.kmz) |
| bhainsrorgarh_wls | `official/bhainsrorgarh-wildlife-sanctuary-2018-08-07.kmz` | 31.07.2018 | 2018-08-07 | `b670cf40824541c6…` | [link](https://forest.rajasthan.gov.in/content/dam/raj/forest/ForestDepartment/PDFs/Department%20Wing/Forest%20Development/Districtwise%20Forest%20Blocks%20a%20Google%20Earth/update/wildlife/Bhensrodgarh%20Wildlife%20Sanctuary.kmz) |
| esz_2020_envelope | `mhtr-esz-outer-limit-2026-06-01.kmz` | 01.06.2026 | 2026-06-01 | `fe784add4d17d84f…` | [link](https://forest.rajasthan.gov.in/content/dam/raj/forest/ForestDepartment/PDFs/Department%20Wing/Forest%20Development/Districtwise%20Forest%20Blocks%20a%20Google%20Earth/ESZ/MHTR.kmz) |
| esz_bhainsrorgarh_2021 | `official/bhainsrorgarh-esz-2026-06-01.kmz` | 01.06.2026 | 2026-06-01 | `6e11e297b0c15c7a…` | [link](https://forest.rajasthan.gov.in/content/dam/raj/forest/ForestDepartment/PDFs/Department%20Wing/Forest%20Development/Districtwise%20Forest%20Blocks%20a%20Google%20Earth/ESZ/BHAINSROAD%20ESZ.kmz) |
| kota_buffer_blocks_2023 | `official/kota-forest-blocks-2018-08-07.kmz` | 31.07.2018 | 2018-08-07 | `f27d048338dc656c…` | [link](https://forest.rajasthan.gov.in/content/dam/raj/forest/ForestDepartment/PDFs/Department%20Wing/Forest%20Development/Districtwise%20Forest%20Blocks%20a%20Google%20Earth/update/kota/KOTA.kmz) |
| kota_blocks_2023_partial | `official/kota-forest-blocks-2018-08-07.kmz` | 31.07.2018 | 2018-08-07 | `f27d048338dc656c…` | [link](https://forest.rajasthan.gov.in/content/dam/raj/forest/ForestDepartment/PDFs/Department%20Wing/Forest%20Development/Districtwise%20Forest%20Blocks%20a%20Google%20Earth/update/kota/KOTA.kmz) |
| bundi_blocks_2023_partial | `official/bundi-forest-blocks-2023-04-10.kmz` | 10.04.2023 | 2023-04-10 | `62d5285152ab42dd…` | [link](https://forest.rajasthan.gov.in/content/dam/raj/forest/ForestDepartment/PDFs/Department%20Wing/Forest%20Development/UpdateKML/ccfkota/BUNDI.kmz) |

## Derived layers (`derived/`)

- `mhtr-reserve-and-esz-outer-boundary-2023.kml` / `.geojson`: reserve plus both eco-sensitive zones, one outline, 1514.62 km². Made for iNaturalist.
- `mhtr-reserve-outer-boundary-2023.kml` / `.geojson`: reserve only, 960.75 km² of 1,135.79 km² notified.
- `mhtr-legal-zones-2023.kml` / `.geojson`: approximate 2013 core and buffer, 2023 additions, both ESZ bands, the park and sanctuary outlines, and context blocks.
- `mhtr-boundary-areas-2023.json` / `.csv`: measured (WGS84) against notified areas.
- `mhtr-land-cover-shares-2021.json`: WorldCover class shares inside the reserve and ESZ outlines.

## Known gaps

- About 180 km² of the notified reserve has no outline of its own in any public file: 21 revenue villages added to the core in 2023 (80.45 km²; the Bhainsrorgarh sanctuary file leaves nine unnamed enclaves), the 2023 buffer parts of Bardkalan Kishor Sagar and Sakatpura (Kota) and of Karondi, Rampuriya and Dhaneshwar (Bundi), which the district files draw only as whole blocks, Akelgarh (27.84 km², listed without a part mark; 7.75 km² of the block was core in 2013 and the Kota file draws the rest at about 32 km²), Ambarani-A (Bundi, 3.54 km²) and the National Chambal buffer piece (23.85 km²).
- No official file splits core from buffer. The 2013 split here is approximate and misassigns about 26 km².
- The park and sanctuary files fill 6.7 km² of holes in the reserve file, counted as core (nearly all Girdharpura, which the Tiger Conservation Plan lists as a core village), and add 2.6 km² around Borabas that only the Jawahar Sagar file draws.
- A 6.2 km² area around Daulatpura is enclosed by the reserve and Bhainsrorgarh files but included in neither; the 2020 ESZ file covers 6.1 km² of it.
- The reserve file still draws the 2013 reserve, although the server copy is dated 24 Feb 2025.
- The 2020 ESZ is stated as 0–1 km but reaches about 5.4 km beyond the reserve file near Rawatbhata (5.7 km beyond the Gazette's own Table A reserve coordinates). There its outer limit is the edge of the Bhainsrorgarh sanctuary file, on a stretch Annexure-I gives zero width 'due to Bhainsroadgarh Sanctuary on the other side'. It was drawn around the 2013 reserve.
- The MHTR ESZ file leaves a 3.53 km² hole around Jawara (Jaora) Khurd, which the Gazette's map also draws, but the Gazette's village list (Annexure-IV, S.No. 52) names Jawara Khurd as an ESZ village.
- The ESZ bands cover parts of the forest blocks partly added to the buffer in 2023 (Bardkalan Kishor Sagar about 29 km², Akelgarh about 11 km², Karondi about 8 km², Sakatpura about 3.5 km², Dhaneshwar about 2.2 km², Rampuriya about 1.3 km²). No public file shows where the added parts lie, so how much land is both ESZ and buffer is unknown.
- The Bhainsrorgarh sanctuary area is 201.4 km² in the file attribute and 275.45 km² in the 2021 ESZ notification.

## Reference layers (`reference/`)

- Overture Maps release 2026-10-21.0: rivers and water bodies, roads and rail, places, districts, and OSM protected-area outlines. © OpenStreetMap contributors, ODbL 1.0.
- ESA WorldCover 2021 v200 public AWS COG: land-cover classes. CC BY 4.0. © ESA WorldCover project / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium.
- Mapzen Terrain Tiles on AWS (Terrarium; built from SRTM, GMTED2010, ETOPO1 and other sources): shaded relief and elevation bands (median-filtered for tile artefacts). Attribution: https://github.com/tilezen/joerd/blob/master/docs/attribution.md

## Map images

- `src/assets/assets/imgs/maps/mukundara-hills-tiger-reserve-legal-zones-map.png`
- `src/assets/assets/imgs/maps/mukundara-hills-tiger-reserve-data-gaps-map.png`
- `src/assets/assets/imgs/maps/mukundara-hills-tiger-reserve-esz-outer-limit-map.png`
- `src/assets/assets/imgs/maps/mukundara-hills-tiger-reserve-boundary-context-map.png`
- `src/assets/assets/imgs/maps/mukundara-hills-tiger-reserve-terrain-relief-map.png`
- `src/assets/assets/imgs/maps/mukundara-hills-tiger-reserve-water-systems-map.png`
- `src/assets/assets/imgs/maps/mukundara-hills-tiger-reserve-elevation-zones-map.png`
- `src/assets/assets/imgs/maps/mukundara-hills-tiger-reserve-land-cover-habitat-map.png`

Editorial rule: the maps avoid exact wildlife observation, nest, den, roost, carcass or breeding-site locations.
Boundary note: Not a legal or cadastral boundary: the reserve is defined by the notification schedules. The Forest Department marks its files as for management use, not legal purposes.
