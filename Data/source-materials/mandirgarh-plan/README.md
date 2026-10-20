# Mandirgarh plan — working data (not published)

These files hold the trail lines, site points (forest posts, potential homestays,
trailheads) and the derived eBird route track used to plan the Mandirgarh
community nature-stay proposal.

They are kept in the repository for when the proposal is accepted and the plan is
executed, but they are **deliberately excluded from the website build**:

- Nothing in this folder is passthrough-copied in `.eleventy.js`.
- `Data/` sits outside the Eleventy input directory (`src/`).
- Do not link, embed or iframe `mandirgarh-trails-map.html` from any page.

| File | Contents |
| --- | --- |
| `mandirgarh-trails-map.html` | Interactive Leaflet planning map (routes + site markers) |
| `mandirgarh-trails-and-sites.geojson` / `.kml` | Trail lines and site points |
| `ebird-track-S372254238-map-derived.*` | Route track derived from eBird checklist S372254238 |

Share these only directly with the Forest Department / partners during review.
Note: the repository is public on GitHub, so these files remain visible in the
repository and its history even though they are not served on mhtr.in. Move them
to a private store if that matters.
