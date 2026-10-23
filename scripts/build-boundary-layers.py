#!/usr/bin/env python3
"""Build MHTR boundary and legal-zone layers from the Forest Department's own map files.

Inputs are the official KMZ files listed in `Data/source-materials/gis/official/sources.json`.
Each file is checked against its recorded SHA-256 before use, so a changed or re-downloaded
file stops the build instead of silently changing the published boundary.

Outputs (written to `Data/source-materials/gis/derived/`):
- `mhtr-reserve-and-esz-outer-boundary-2023.kml` / `.geojson`: one outline of the reserve plus
  both eco-sensitive zones. Single placemark, made for iNaturalist.
- `mhtr-reserve-outer-boundary-2023.kml` / `.geojson`: one outer boundary for the reserve as
  amended on 5 Oct 2023, as far as public files can draw it. Single placemark.
- `mhtr-legal-zones-2023.kml` / `.geojson`: core, buffer, eco-sensitive zones and constituent
  units as separate layers, each with its source, method, measured area and notified area.
- `mhtr-boundary-areas-2023.json` / `.csv`: measured (WGS84 ellipsoid) vs notified areas.

Areas are geodesic on the WGS84 ellipsoid (pyproj.Geod). Nothing here is a legal survey:
the reserve is defined by the schedules and boundary descriptions of the notifications.

Python dependencies: `python -m pip install -r scripts/requirements-gis.txt`.
"""

from __future__ import annotations

import csv
import hashlib
import html
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree
from xml.sax.saxutils import escape

from pyproj import Geod
from shapely import make_valid, set_precision
from shapely.geometry import MultiPolygon, Polygon, mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
GIS_DIR = ROOT / "Data" / "source-materials" / "gis"
OFFICIAL_DIR = GIS_DIR / "official"
DERIVED_DIR = GIS_DIR / "derived"
MANIFEST = OFFICIAL_DIR / "sources.json"

GEOD = Geod(ellps="WGS84")
KML_NS = {"kml": "http://www.opengis.net/kml/2.2"}
# Holes that appear only where two files' edges fail to meet, not in any file itself, are
# digitising gaps. In the reserve outline only slivers are filled; in the reserve-plus-ESZ outline
# the five gaps between the sanctuary and ESZ files (0.002–0.1 km²) are filled too.
SLIVER_HOLE_KM2 = 0.01
ESZ_GAP_KM2 = 0.5
COORD_PRECISION = 1e-6  # degrees, about 0.1 m; the source files carry 6-15 decimals

BUILD_DATE = "2026-10-23"

# Notified figures, km². Sources: F.3(8)Forest/2012 (9 Apr 2013); F.3(22)Forest/2023 (5 Oct 2023);
# MoEFCC S.O. 4268(E) (25 Nov 2020); S.O. 3683(E) (10 Sep 2021).
NOTIFIED = {
    "reserve_2023": 1135.787,
    "core_2023": 690.71,
    "buffer_2023": 445.08,
    "reserve_2013": 759.99,
    "core_2013": 417.17,
    "buffer_2013": 342.82,
    "core_added_2023_forest_blocks": 193.09,
    "core_added_2023_villages": 80.45,
    "buffer_added_2023": 102.25,
    # Barkheda 90.76 ha, Rawtha 45.35 ha and Borabas-B 137.81 ha: the 2023 buffer blocks added whole, which a map file draws.
    "buffer_added_2023_whole_blocks": 2.7392,
    "esz_2020": 248.70,
    "esz_bhainsrorgarh_2021": 304.70,
}

# 2023 buffer additions that are only part of a forest block: the block is drawn in a district
# file, the notified part is not. Block name in the file -> (name in the notification, km², district).
PARTIAL_BLOCK_ADDITIONS = {
    "BAR KALAJI KISHOR SAGAR": ("Bardkalan Kishor Sagar", 30.67, "Kota"),
    "AKHELGARH BLOCK": ("Akelgarh", 27.84, "Kota"),
    "SAKATPUR": ("Sakatpura compartments 17, 20 and 21", 4.10, "Kota"),
    "KARONDI": ("Karondi compartments 10–20", 8.57, "Bundi"),
    "RAMPURIYA": ("Rampuriya compartment 9", 0.27, "Bundi"),
    "DHANESHWAR": ("Dhaneshwar compartment 11", 0.68, "Bundi"),
}

INSTRUMENT_2013 = "Rajasthan Forest Department notification F.3(8)Forest/2012, 9 Apr 2013"
INSTRUMENT_2023 = "Rajasthan Forest Department notification F.3(22)Forest/2023, 5 Oct 2023"
INSTRUMENT_ESZ_2020 = "MoEFCC S.O. 4268(E), 25 Nov 2020"
INSTRUMENT_ESZ_2021 = "MoEFCC S.O. 3683(E), 10 Sep 2021"

DISCLAIMER = (
    "Reconstructed from Rajasthan Forest Department map files for reference. Not a legal or "
    "cadastral boundary: the reserve is defined by the schedules and boundary descriptions in "
    "the notifications. The Forest Department marks its files as for management use, not legal purposes."
)


def area_km2(geom) -> float:
    if geom is None or geom.is_empty:
        return 0.0
    return abs(GEOD.geometry_area_perimeter(geom)[0]) / 1e6


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def polygons(geom) -> list[Polygon]:
    if geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    out: list[Polygon] = []
    for part in getattr(geom, "geoms", []):
        out.extend(polygons(part))
    return out


def as_multipolygon(geom) -> MultiPolygon:
    return MultiPolygon(polygons(geom))


def clean(geom):
    geom = make_valid(geom)
    geom = set_precision(geom, COORD_PRECISION)
    return as_multipolygon(make_valid(geom))


def parse_coords(text: str) -> list[tuple[float, float]]:
    pts = []
    for token in (text or "").split():
        parts = token.split(",")
        if len(parts) >= 2:
            pts.append((float(parts[0]), float(parts[1])))
    return pts


def description_attrs(description: str) -> dict:
    """ArcGIS exports put attributes in an HTML table in <description>: <td>KEY</td><td>VALUE</td>."""
    cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<td>(.*?)</td>", description or "", re.S)]
    return {cells[i]: cells[i + 1] for i in range(1, len(cells) - 1, 2) if cells[i]}


def read_kmz(path: Path) -> list[dict]:
    """Return every placemark in a KMZ as {"name", "attrs", "geometry"}."""
    with zipfile.ZipFile(path) as archive:
        kml_names = [n for n in archive.namelist() if n.lower().endswith(".kml")]
        if len(kml_names) != 1:
            raise RuntimeError(f"{path.name}: expected one KML document, found {kml_names}")
        root = ElementTree.fromstring(archive.read(kml_names[0]))
    placemarks = []
    for pm in root.iter(f"{{{KML_NS['kml']}}}Placemark"):
        name = (pm.findtext("kml:name", default="", namespaces=KML_NS) or "").strip()
        attrs = description_attrs(pm.findtext("kml:description", default="", namespaces=KML_NS))
        for sd in pm.iter(f"{{{KML_NS['kml']}}}SimpleData"):
            attrs[sd.get("name")] = (sd.text or "").strip()
        for d in pm.iter(f"{{{KML_NS['kml']}}}Data"):
            attrs[d.get("name")] = (d.findtext("kml:value", default="", namespaces=KML_NS) or "").strip()
        polys = []
        for poly in pm.iter(f"{{{KML_NS['kml']}}}Polygon"):
            outer = parse_coords(poly.findtext("kml:outerBoundaryIs/kml:LinearRing/kml:coordinates", default="", namespaces=KML_NS))
            inners = [
                parse_coords(node.text)
                for node in poly.findall("kml:innerBoundaryIs/kml:LinearRing/kml:coordinates", KML_NS)
            ]
            if len(outer) >= 4:
                polys.append(Polygon(outer, [r for r in inners if len(r) >= 4]))
        if polys:
            placemarks.append({"name": name, "attrs": attrs, "geometry": make_valid(unary_union(polys))})
    if not placemarks:
        raise RuntimeError(f"{path.name}: no polygon placemarks found")
    return placemarks


def load_sources() -> dict:
    manifest = json.loads(MANIFEST.read_text())
    loaded = {}
    for key, src in manifest["files"].items():
        path = GIS_DIR / src["file"]
        if not path.exists():
            raise RuntimeError(f"Missing official file {path}. See {MANIFEST.relative_to(ROOT)} for its source URL.")
        digest = sha256(path)
        if digest != src["sha256"]:
            raise RuntimeError(f"{path.name}: SHA-256 {digest} does not match the recorded {src['sha256']}")
        placemarks = read_kmz(path)
        select = src.get("select_attr")
        if select:
            field, wanted = select["field"], select["values"]
            chosen = [pm for pm in placemarks if pm["attrs"].get(field, "").strip().upper() in {w.upper() for w in wanted}]
            found = {pm["attrs"].get(field, "").strip().upper() for pm in chosen}
            missing = [w for w in wanted if w.upper() not in found]
            if missing:
                raise RuntimeError(f"{path.name}: placemarks {missing} not found in field {field}")
            placemarks = chosen
        loaded[key] = {
            "src": src,
            "placemarks": placemarks,
            "geometry": clean(unary_union([pm["geometry"] for pm in placemarks])),
        }
    return loaded


def is_source_hole(hole: Polygon, reference_holes: list[Polygon]) -> bool:
    """True when at least half of the hole is a hole that one of the official files itself draws."""
    a = area_km2(hole)
    return any(ref.intersects(hole) and area_km2(ref.intersection(hole)) >= 0.5 * a for ref in reference_holes)


def fill_sliver_holes(geom, reference_holes: list[Polygon], max_gap_km2: float = SLIVER_HOLE_KM2):
    """Keep holes the official files draw; fill gaps under max_gap_km2 that only appear between two files."""
    out = []
    for poly in polygons(geom):
        keep = []
        for ring in poly.interiors:
            hole = Polygon(ring)
            if is_source_hole(hole, reference_holes) or area_km2(hole) >= max_gap_km2:
                keep.append(ring)
        out.append(Polygon(poly.exterior, keep))
    return as_multipolygon(MultiPolygon(out))


def source_line(src: dict) -> str:
    bits = [src["title"], f"listed as on {src['register_date']}"]
    if src.get("last_modified"):
        bits.append(f"server copy {src['last_modified']}")
    bits.append(f"SHA-256 {src['sha256'][:12]}…")
    return "; ".join(bits)


def build(sources: dict) -> tuple[dict, list[dict]]:
    g = {k: v["geometry"] for k, v in sources.items()}
    tr, bh = g["reserve_2013_file"], g["bhainsrorgarh_wls"]
    units = unary_union([g["np"], g["darrah"], g["jawahar_sagar"]])
    buffer_blocks_2023 = g.get("kota_buffer_blocks_2023")

    reference_holes = [Polygon(r) for k in g for p in polygons(g[k]) for r in p.interiors]

    # One outer boundary: the reserve file, the files of the park and sanctuaries it legally
    # contains, Bhainsrorgarh WLS (2023 core) and the whole 2023 buffer blocks that a public file draws.
    parts = [tr, units, bh] + ([buffer_blocks_2023] if buffer_blocks_2023 is not None else [])
    outer = fill_sliver_holes(clean(unary_union(parts)), reference_holes)
    outer_with_esz = fill_sliver_holes(
        clean(unary_union([outer, g["esz_2020_envelope"], g["esz_bhainsrorgarh_2021"]])), reference_holes, ESZ_GAP_KM2
    )

    # The park and sanctuary files are used whole. They also fill holes the reserve file leaves open
    # (Girdharpura, a core village in the Tiger Conservation Plan) and add a piece around Borabas.
    reserve_files = unary_union([tr, units, bh])
    tr_outline = unary_union([Polygon(p.exterior) for p in polygons(tr)])
    units_in_reserve_holes = clean(units.intersection(tr_outline).difference(tr))
    units_outside_reserve = clean(units.difference(tr_outline))
    core_2013 = clean(units)
    buffer_2013 = clean(tr.difference(units))
    core_added = clean(bh.difference(unary_union([tr, units])))
    buffer_added = clean(buffer_blocks_2023.difference(reserve_files)) if buffer_blocks_2023 is not None else MultiPolygon()
    blocks_drawn = area_km2(buffer_blocks_2023)
    # Each ESZ band is its file minus every reserve file, so no land counts as both reserve and ESZ.
    esz_2020 = clean(g["esz_2020_envelope"].difference(reserve_files))
    esz_2021 = clean(g["esz_bhainsrorgarh_2021"].difference(reserve_files))
    not_mapped = NOTIFIED["core_added_2023_villages"] + NOTIFIED["buffer_added_2023"] - (NOTIFIED["buffer_added_2023_whole_blocks"] if buffer_blocks_2023 is not None else 0)

    layers = [
        {
            "id": "outer-boundary",
            "name": "Reserve outer boundary (2023 extent, as far as public files draw it)",
            "zone": "reserve",
            "geometry": outer,
            "notified_km2": NOTIFIED["reserve_2023"],
            "reliability": f"Official files joined; about {not_mapped:.0f} km² of the notified reserve has no public map and is not included.",
            "method": "Union of the Forest Department's reserve file (2013 extent), its national park and sanctuary files, the Bhainsrorgarh WLS file and the whole 2023 buffer blocks drawn in the Kota district file. Holes under 0.01 km² that only appear where two files' edges miss each other are filled.",
            "instrument": f"{INSTRUMENT_2013}; {INSTRUMENT_2023}",
            "sources": ["reserve_2013_file", "np", "darrah", "jawahar_sagar", "bhainsrorgarh_wls"] + (["kota_buffer_blocks_2023"] if buffer_blocks_2023 is not None else []),
        },
        {
            "id": "outer-boundary-with-esz",
            "name": "Reserve and eco-sensitive zones, outer boundary",
            "zone": "landscape",
            "geometry": outer_with_esz,
            "notified_km2": None,
            "reliability": "Official files joined. Covers the reserve outline above plus both notified eco-sensitive zones, which also take in all nine village enclaves inside the Bhainsrorgarh sanctuary file and part of the unmapped 2023 buffer. Some 2023 buffer additions near Kota and in Bundi, and part of the 2023 core villages (the OpenStreetMap point for Kolpura is about 0.5 km outside), may still fall outside.",
            "method": "Reserve outer boundary joined with the MHTR ESZ outer-limit file and the Bhainsrorgarh ESZ file. Holes the official files draw are kept (the 3.5 km² exclusion in the MHTR ESZ file); gaps under 0.5 km² where two files' edges miss each other are filled.",
            "instrument": f"{INSTRUMENT_2013}; {INSTRUMENT_2023}; {INSTRUMENT_ESZ_2020}; {INSTRUMENT_ESZ_2021}",
            "sources": ["reserve_2013_file", "np", "darrah", "jawahar_sagar", "bhainsrorgarh_wls", "esz_2020_envelope", "esz_bhainsrorgarh_2021"] + (["kota_buffer_blocks_2023"] if buffer_blocks_2023 is not None else []),
        },
        {
            "id": "core-2013-approx",
            "name": "Core 2013 (approximate)",
            "zone": "core",
            "geometry": core_2013,
            "notified_km2": NOTIFIED["core_2013"],
            "reliability": (
                "Approximate. No official file draws the core. This layer counts about 18 km² of Jawahar Sagar and Darrah "
                "buffer blocks as core and misses the 7.75 km² National Chambal core part. It also includes "
                f"{area_km2(units_in_reserve_holes):.1f} km² of village holes that the reserve file leaves open (nearly all "
                "Girdharpura, which the Tiger Conservation Plan lists as a core village) and "
                f"{area_km2(units_outside_reserve):.1f} km² around Borabas that only the Jawahar Sagar file draws."
            ),
            "method": "National park, Darrah and Jawahar Sagar files merged and used whole.",
            "instrument": INSTRUMENT_2013,
            "sources": ["reserve_2013_file", "np", "darrah", "jawahar_sagar"],
        },
        {
            "id": "buffer-2013-approx",
            "name": "Buffer 2013 (approximate)",
            "zone": "buffer",
            "geometry": buffer_2013,
            "notified_km2": NOTIFIED["buffer_2013"],
            "reliability": "Approximate, with the same misassignment as the core layer in reverse.",
            "method": "Reserve file minus the core 2013 layer.",
            "instrument": INSTRUMENT_2013,
            "sources": ["reserve_2013_file", "np", "darrah", "jawahar_sagar"],
        },
        {
            "id": "core-added-2023",
            "name": "Core added 2023: Bhainsrorgarh WLS forest blocks",
            "zone": "core",
            "geometry": core_added,
            "notified_km2": NOTIFIED["core_added_2023_forest_blocks"],
            "reliability": "Official sanctuary file (2018). The notification adds 12 forest blocks (193.09 km²); the file draws the whole sanctuary, so the two differ. Sanctuary area is 201.4 km² in the file's attribute but 275.45 km² in the 2021 ESZ notification.",
            "method": "Bhainsrorgarh WLS file, minus its 0.5 km² overlap with the reserve and Jawahar Sagar files.",
            "instrument": INSTRUMENT_2023,
            "sources": ["bhainsrorgarh_wls"],
        },
        {
            "id": "buffer-added-2023-mapped",
            "name": "Buffer added 2023: whole blocks a public file draws, outside the 2013 files",
            "zone": "buffer",
            "geometry": buffer_added,
            "notified_km2": NOTIFIED["buffer_added_2023"],
            "reliability": (
                "Only the three blocks the notification adds whole (Barkheda, Rawtha, Borabas-B; 2.74 km² notified), which "
                f"the Kota file draws at {blocks_drawn:.2f} km². Rawtha and Borabas-B lie almost wholly inside the 2013 files, "
                f"so this layer is the other {area_km2(buffer_added):.2f} km², nearly all Barkheda. The file draws Borabas-B at "
                "0.50 km² against 1.38 km² notified. Part-blocks, compartments, the Bundi additions and the National Chambal "
                "piece have no public map."
            ),
            "method": "Matching blocks from the Kota district forest-block file, minus land already in the reserve, national park or sanctuary files.",
            "instrument": INSTRUMENT_2023,
            "sources": ["kota_buffer_blocks_2023"] if buffer_blocks_2023 is not None else [],
        },
        {
            "id": "esz-2020",
            "name": "Eco-sensitive zone around MHTR (2020)",
            "zone": "esz",
            "geometry": esz_2020,
            "notified_km2": NOTIFIED["esz_2020"],
            "reliability": (
                "Official ESZ file minus the reserve, park and sanctuary files. Notified as 0–1 km but about 5.4 km wide near "
                "Rawatbhata. Drawn around the 2013 reserve; it crosses forest blocks partly added to the buffer in 2023, and no "
                "file shows whether the added parts fall inside it. The Girdharpura village hole in the reserve file is counted "
                "as reserve, not ESZ."
            ),
            "method": "ESZ outer-limit file minus the reserve file and the national park and sanctuary files.",
            "instrument": INSTRUMENT_ESZ_2020,
            "sources": ["esz_2020_envelope", "reserve_2013_file", "np", "darrah", "jawahar_sagar", "bhainsrorgarh_wls"],
        },
        {
            "id": "esz-bhainsrorgarh-2021",
            "name": "Eco-sensitive zone around Bhainsrorgarh WLS (2021)",
            "zone": "esz",
            "geometry": esz_2021,
            "notified_km2": NOTIFIED["esz_bhainsrorgarh_2021"],
            "reliability": "Official ESZ file minus the sanctuary and reserve files. Within 1.5% of the notified 304.70 km². The notification gives a width of 0–9.6 km, zero to the north and north-east where Jawahar Sagar and the national park adjoin. The file's BUFF_DIST attribute (3000) does not describe the drawn band.",
            "method": "Bhainsrorgarh ESZ file minus the sanctuary file and the reserve files.",
            "instrument": INSTRUMENT_ESZ_2021,
            "sources": ["esz_bhainsrorgarh_2021", "bhainsrorgarh_wls"],
        },
    ]
    for key, label in (("np", "Mukundara Hills National Park"), ("darrah", "Darrah Wildlife Sanctuary"), ("jawahar_sagar", "Jawahar Sagar Wildlife Sanctuary"), ("bhainsrorgarh_wls", "Bhainsrorgarh Wildlife Sanctuary")):
        src = sources[key]["src"]
        file_notified = sources[key]["placemarks"][0]["attrs"].get("NOTIFY_ARE")
        layers.append({
            "id": f"unit-{key.replace('_', '-')}",
            "name": f"{label} (constituent unit)",
            "zone": "unit",
            "geometry": g[key],
            "notified_km2": float(file_notified) if file_notified else None,
            "reliability": "Official sanctuary or park file (2018). Outline only; it does not show core or buffer. Notified area is the file's own NOTIFY_ARE attribute.",
            "method": "Forest Department file as supplied.",
            "instrument": src.get("instrument", ""),
            "sources": [key],
        })

    for layer in layers:
        layer["measured_km2"] = round(area_km2(layer["geometry"]), 2)

    stats = {
        "build_date": BUILD_DATE,
        "outer_boundary_km2": layers[0]["measured_km2"],
        "outer_parts": len(polygons(outer)),
        "outer_with_esz_km2": round(area_km2(outer_with_esz), 2),
        "outer_with_esz_parts": len(polygons(outer_with_esz)),
        "outer_with_esz_holes": [round(area_km2(Polygon(r)), 2) for p in polygons(outer_with_esz) for r in p.interiors],
        "outer_holes": sum(len(p.interiors) for p in polygons(outer)),
        # Twelve holes are drawn by a source file (nine Bhainsrorgarh village enclaves, three reserve-file holes). The
        # 6.2 km² hole around Daulatpura is in no reserve file: the reserve and Bhainsrorgarh files close round it, and
        # the 2020 ESZ file covers most of it. Listed so readers can check them.
        "outer_hole_list": sorted(
            (
                {"area_km2": round(area_km2(Polygon(r)), 2), "lon": round(Polygon(r).representative_point().x, 4), "lat": round(Polygon(r).representative_point().y, 4)}
                for p in polygons(outer) for r in p.interiors
            ),
            key=lambda h: -h["area_km2"],
        ),
        "reserve_file_km2": round(area_km2(tr), 2),
        "unit_files_in_reserve_file_holes_km2": round(area_km2(units_in_reserve_holes), 2),
        "unit_files_outside_reserve_file_km2": round(area_km2(units_outside_reserve), 2),
        "buffer_blocks_2023_drawn_km2": round(blocks_drawn, 2),
        "not_mapped_notified_km2": round(not_mapped, 2),
        "notified": NOTIFIED,
    }
    return stats, layers


def ring_kml(coords) -> str:
    return " ".join(f"{x:.6f},{y:.6f},0" for x, y in coords)


def polygon_kml(poly: Polygon) -> str:
    inner = "".join(
        f"<innerBoundaryIs><LinearRing><coordinates>{ring_kml(r.coords)}</coordinates></LinearRing></innerBoundaryIs>"
        for r in poly.interiors
    )
    return f"<Polygon><outerBoundaryIs><LinearRing><coordinates>{ring_kml(poly.exterior.coords)}</coordinates></LinearRing></outerBoundaryIs>{inner}</Polygon>"


def geometry_kml(geom) -> str:
    polys = polygons(geom)
    if len(polys) == 1:
        return polygon_kml(polys[0])
    return "<MultiGeometry>" + "".join(polygon_kml(p) for p in polys) + "</MultiGeometry>"


def extended_data(props: dict) -> str:
    rows = "".join(
        f'<Data name="{escape(str(k))}"><value>{escape(str(v))}</value></Data>'
        for k, v in props.items() if v not in (None, "")
    )
    return f"<ExtendedData>{rows}</ExtendedData>"


STYLES = {
    "reserve": ("ff1f5f2e", "401f8a5c", 3),
    "core": ("ff5c8a1f", "805c8a1f", 2),
    "buffer": ("ffa6c38c", "60a6c38c", 2),
    "esz": ("ff128ac9", "40128ac9", 2),
    "unit": ("ff1b201f", "00000000", 1),
    "landscape": ("ff3c3c3c", "00000000", 2),
}


def layer_props(layer: dict, sources: dict) -> dict:
    return {
        "layer": layer["id"],
        "name": layer["name"],
        "measured_area_km2_wgs84": layer["measured_km2"],
        "notified_area_km2": layer["notified_km2"],
        "reliability": layer["reliability"],
        "method": layer["method"],
        "instrument": layer["instrument"],
        "source_files": " | ".join(source_line(sources[k]["src"]) for k in layer["sources"]),
        "source_urls": " | ".join(sources[k]["src"]["source_url"] for k in layer["sources"]),
        "built": BUILD_DATE,
        "disclaimer": DISCLAIMER,
    }


def write_outputs(stats: dict, layers: list[dict], sources: dict) -> None:
    DERIVED_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Single-polygon outlines, for iNaturalist and other places that need one boundary.
    by_id = {l["id"]: l for l in layers}
    reserve_gaps = (
        "Not included because no public file draws them: the 2023 buffer part-blocks and compartments "
        "in Kota and Bundi, the National Chambal buffer piece, and 21 revenue villages near Rawatbhata "
        f"(about {stats['not_mapped_notified_km2']:.0f} km² of the notified 1,135.79 km²). The village enclaves "
        "inside the Bhainsrorgarh sanctuary file are left open, as that file draws them; OpenStreetMap points for ten "
        "of the 21 villages fall inside them. A 6.2 km² area around Daulatpura that no reserve file includes is also "
        "left open (the 2020 ESZ file covers most of it)."
    )
    esz_gaps = (
        "The eco-sensitive zones take in all nine village enclaves in the Bhainsrorgarh sanctuary file, most of the "
        "2023 core villages and part of the unmapped 2023 buffer. Land with no public map may still fall partly "
        "outside: the 2023 buffer compartments near Kota (Akelgarh, Sakatpura), the National Chambal piece, the Bundi "
        "compartments and at least one 2023 core village (the OpenStreetMap point for Kolpura, 75.4421 E 24.8663 N, "
        "lies about 0.5 km outside this outline). The 2020 ESZ was drawn around the 2013 reserve and crosses forest "
        "blocks partly added to the buffer in 2023."
    )
    outlines = (
        (
            "outer-boundary-with-esz",
            "mhtr-reserve-and-esz-outer-boundary-2023",
            "Mukundara Hills Tiger Reserve with eco-sensitive zones, outer boundary",
            "Mukundara Hills Tiger Reserve and eco-sensitive zones",
            "Outer boundary of Mukundara Hills Tiger Reserve (as amended 5 Oct 2023) together with its 2020 "
            "eco-sensitive zone and the 2021 Bhainsrorgarh eco-sensitive zone, joined from Rajasthan Forest "
            "Department map files.",
            esz_gaps,
        ),
        (
            "outer-boundary",
            "mhtr-reserve-outer-boundary-2023",
            "Mukundara Hills Tiger Reserve outer boundary (2023 extent)",
            "Mukundara Hills Tiger Reserve",
            "Outer boundary of Mukundara Hills Tiger Reserve as amended on 5 Oct 2023, reconstructed from "
            "Rajasthan Forest Department map files. Notified area 1,135.79 km².",
            reserve_gaps,
        ),
    )
    for layer_id, stem, doc_name, pm_name, lead, gaps in outlines:
        layer = by_id[layer_id]
        props = {**layer_props(layer, sources), "gaps": gaps}
        desc = (
            f"{lead} Measured {layer['measured_km2']:.2f} km² (WGS84). {gaps} {DISCLAIMER} "
            f"Built {BUILD_DATE} by mhtr.in; method and sources: https://mhtr.in/gis-maps/"
        )
        feature = {"type": "Feature", "properties": props, "geometry": mapping(layer["geometry"])}
        (DERIVED_DIR / f"{stem}.geojson").write_text(
            json.dumps({"type": "FeatureCollection", "features": [feature]}, separators=(",", ":")) + "\n"
        )
        (DERIVED_DIR / f"{stem}.kml").write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
            f"<name>{escape(doc_name)}</name>"
            f"<description>{escape(desc)}</description>"
            '<Style id="outline"><LineStyle><color>ff1f5f2e</color><width>3</width></LineStyle>'
            "<PolyStyle><color>401f8a5c</color></PolyStyle></Style>"
            f"<Placemark><name>{escape(pm_name)}</name>"
            f"<description>{escape(desc)}</description><styleUrl>#outline</styleUrl>"
            f"{extended_data(props)}{geometry_kml(layer['geometry'])}</Placemark>"
            "</Document></kml>\n"
        )

    # 2. All layers, as separate features / folders.
    features = []
    folders = []
    for layer in layers:
        p = layer_props(layer, sources)
        if layer["geometry"].is_empty:
            continue
        features.append({"type": "Feature", "properties": {**p, "zone": layer["zone"]}, "geometry": mapping(layer["geometry"])})
        line, fill, width = STYLES[layer["zone"]]
        folders.append(
            f"<Folder><name>{escape(layer['name'])}</name>"
            f"<Placemark><name>{escape(layer['name'])}</name>"
            f"<description>{escape(layer['reliability'] + ' ' + layer['method'])}</description>"
            f"<Style><LineStyle><color>{line}</color><width>{width}</width></LineStyle><PolyStyle><color>{fill}</color></PolyStyle></Style>"
            f"{extended_data(p)}{geometry_kml(layer['geometry'])}</Placemark></Folder>"
        )
    # Context only: whole district-file blocks that contain a 2023 buffer addition made by part.
    context = []
    for key in ("kota_blocks_2023_partial", "bundi_blocks_2023_partial"):
        if key not in sources:
            continue
        src = sources[key]["src"]
        for pm in sources[key]["placemarks"]:
            block = pm["attrs"].get("BLOCK", pm["name"]).strip().upper()
            part, part_km2, district = PARTIAL_BLOCK_ADDITIONS[block]
            geom = clean(pm["geometry"])
            p = {
                "layer": "context-partial-block",
                "name": f"{block.title()} block ({district}): contains a 2023 buffer addition",
                "zone": "context",
                "block": block,
                "notified_part": part,
                "notified_part_km2": part_km2,
                "block_area_km2_wgs84": round(area_km2(geom), 2),
                "reliability": "Context only. The whole block is drawn; only the notified part is in the reserve, and no public file shows which part.",
                "source_files": source_line(src),
                "source_urls": src["source_url"],
                "built": BUILD_DATE,
                "disclaimer": DISCLAIMER,
            }
            features.append({"type": "Feature", "properties": p, "geometry": mapping(geom)})
            context.append(
                f"<Placemark><name>{escape(p['name'])}</name>"
                f"<description>{escape(f'Notified part: {part}, {part_km2} km². ' + p['reliability'])}</description>"
                "<Style><LineStyle><color>ff4b31c4</color><width>2</width></LineStyle><PolyStyle><color>00000000</color></PolyStyle></Style>"
                f"{extended_data(p)}{geometry_kml(geom)}</Placemark>"
            )
    if context:
        folders.append(
            "<Folder><name>Context: blocks that contain unmapped 2023 buffer additions (whole blocks shown)</name>"
            + "".join(context) + "</Folder>"
        )
    (DERIVED_DIR / "mhtr-legal-zones-2023.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")) + "\n"
    )
    (DERIVED_DIR / "mhtr-legal-zones-2023.kml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
        "<name>MHTR legal zones (2023), reconstructed</name>"
        f"<description>{escape(DISCLAIMER + ' Built ' + BUILD_DATE + ' by mhtr.in; https://mhtr.in/gis-maps/')}</description>"
        + "".join(folders) + "</Document></kml>\n"
    )

    # 3. Area table.
    rows = [
        {
            "layer": l["id"],
            "name": l["name"],
            "measured_area_km2_wgs84": l["measured_km2"],
            "notified_area_km2": l["notified_km2"],
            "difference_km2": None if l["notified_km2"] in (None, "") else round(l["measured_km2"] - float(l["notified_km2"]), 2),
            "reliability": l["reliability"],
        }
        for l in layers
    ]
    (DERIVED_DIR / "mhtr-boundary-areas-2023.json").write_text(json.dumps({"stats": stats, "layers": rows}, indent=2) + "\n")
    with (DERIVED_DIR / "mhtr-boundary-areas-2023.csv").open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    sources = load_sources()
    stats, layers = build(sources)
    write_outputs(stats, layers, sources)
    for l in layers:
        print(f"{l['id']:28s} {l['measured_km2']:9.2f} km²  notified {l['notified_km2']}")
    print(json.dumps({k: v for k, v in stats.items() if k != "notified"}, indent=1))


if __name__ == "__main__":
    main()
