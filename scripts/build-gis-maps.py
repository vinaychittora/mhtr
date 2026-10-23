#!/usr/bin/env python3
"""Build the public GIS map images for Mukundara Hills Tiger Reserve.

Inputs:
- Reserve, zone and unit layers that `scripts/build-boundary-layers.py` builds from the Rajasthan
  Forest Department's own map files (`Data/source-materials/gis/derived/`). Run that first.
- Rivers, roads, rail, places, districts and protected-area outlines from OpenStreetMap, snapshotted
  from one Overture Maps release by `scripts/fetch-gis-reference.py` (`Data/source-materials/gis/reference/`).
- ESA WorldCover 2021 v200 (public AWS COG) for land cover and Mapzen/AWS Terrarium tiles for
  elevation, fetched by URL and cached in `Data/source-materials/gis/cache/` (not committed).

Every map uses one Web Mercator scale for both axes, so shapes keep their true proportions.
The maps deliberately show no wildlife observation, nest, den, roost, carcass or breeding sites.

Python dependencies: `python -m pip install -r scripts/requirements-gis.txt`.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFont
from pyproj import Geod
from scipy.ndimage import median_filter
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Point, Polygon, box, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "Data" / "source-materials" / "gis"
CACHE_DIR = DATA_DIR / "cache"
DERIVED_DIR = DATA_DIR / "derived"
REFERENCE_DIR = DATA_DIR / "reference"
SOURCES_PATH = DATA_DIR / "official" / "sources.json"
ZONES_PATH = DERIVED_DIR / "mhtr-legal-zones-2023.geojson"
AREAS_PATH = DERIVED_DIR / "mhtr-boundary-areas-2023.json"
OUT_DIR = ROOT / "src" / "assets" / "assets" / "imgs" / "maps"
FONT_DIR = Path(__file__).resolve().parent / "fonts"
USER_AGENT = "mhtr.in GIS map builder; contact hello@caneandcamera.com"

TERRARIUM_URL = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"
WORLDCOVER_COG_TEMPLATE = (
    "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
    "ESA_WorldCover_10m_2021_v200_{tile}_Map.tif"
)

CANVAS_W = 2400
CANVAS_H = 1600
MAP_RECT = (80, 210, 1750, 1280)
PANEL_RECT = (1865, 210, 455, 1280)
GEOD = Geod(ellps="WGS84")

# Palette. Hue carries the legal layer (green reserve, amber ESZ); a hatch marks what 2023 added.
PAPER = (238, 238, 225, 255)
MAP_BG = (247, 247, 238, 255)
INK = (24, 42, 35)
MUTED = (83, 91, 86)
CORE = (31, 111, 72)
BUFFER = (150, 194, 128)
ESZ = (201, 138, 18)
RESERVE_LINE = (16, 64, 40)
GAP = (196, 49, 75)
WATER_FILL = (72, 143, 181, 175)
WATER_EDGE = (31, 101, 146, 230)
WATER_LINE = (35, 111, 163, 215)
HALO = (250, 250, 241)
PANEL_BG = (247, 247, 238)

OSM_CREDIT = "OpenStreetMap contributors (ODbL), via Overture Maps release {release}"
FD_CREDIT = "Rajasthan Forest Department map files (checksums in Data/source-materials/gis/official/sources.json)"
NOT_LEGAL = "Not a legal or cadastral boundary: the reserve is defined by the notification schedules."

# Places that 5 Oct 2023 notification adds to the core as revenue land (A23 pp. 2-3), matched to
# OpenStreetMap place names near Rawatbhata. Locations are approximate village points, not boundaries.
CORE_VILLAGES_2023 = {
    "Udpuriya": "Udpuriya", "Bhawanipura": "Bhawanipura", "Khalgaon": "Khalgaon", "Luhariya": "Luhariya",
    "Parajhar": "Padajhar Khurd", "Mortooka": "Mortuka", "Hatholi": "Hatholi", "Suthala": "Suthala",
    "Prempura": "Prempura", "Doodi Talai": "Dudhitalai", "Mandesara": "Mandesara", "Ratanpura": "Ratanpura",
    "Baheliya": "Bahaliya", "Lasana": "Lasana", "Jhoojhala": "Jhujhla", "Nali": "Nali", "Kolpura": "Kolpura",
    "Chenpua": "Chainpura",
}
CORE_VILLAGE_BBOX = (75.35, 24.74, 75.60, 24.98)


def ensure_dirs() -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_DIR / ("LiberationSans-Bold.ttf" if bold else "LiberationSans-Regular.ttf")), size=size)


FONTS = {
    "title": font(48, True),
    "subtitle": font(25),
    "h2": font(28, True),
    "body": font(22),
    "small": font(17),
    "tiny": font(14),
    "label": font(20, True),
    "label_small": font(16, True),
}


# ---------------------------------------------------------------------------------------------
# Data


def request_bytes(url: str, retries: int = 4, timeout: int = 60) -> bytes:
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return response.read()
        except Exception as exc:  # pragma: no cover - network retry path
            last_error = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Could not fetch {url}: {last_error}")


def cached_bytes(name: str, url: str) -> bytes:
    path = CACHE_DIR / name
    if path.exists() and path.stat().st_size > 0:
        return path.read_bytes()
    data = request_bytes(url)
    path.write_bytes(data)
    return data


def read_features(path: Path) -> tuple[list[tuple[dict, object]], dict]:
    if not path.exists():
        raise RuntimeError(f"Missing {path.relative_to(ROOT)}. Run the script named in this file's docstring first.")
    payload = json.loads(path.read_text())
    return [(f["properties"], shape(f["geometry"])) for f in payload["features"]], payload.get("metadata", {})


def area_km2(geom) -> float:
    return abs(GEOD.geometry_area_perimeter(geom)[0]) / 1e6 if not geom.is_empty else 0.0


def block_name(props: dict) -> str:
    """The notification's name for a partly added block ("Sakatpura", not the file's "SAKATPUR")."""
    return props["notified_part"].split(" compartment")[0]


def load_layers() -> dict:
    zones, _ = read_features(ZONES_PATH)
    by_id = {p["layer"]: (p, g) for p, g in zones if p["layer"] != "context-partial-block"}
    partial_blocks = [(p, g) for p, g in zones if p["layer"] == "context-partial-block"]
    areas = json.loads(AREAS_PATH.read_text())

    water, water_meta = read_features(REFERENCE_DIR / "overture-water.geojson")
    roads, _ = read_features(REFERENCE_DIR / "overture-roads-rail.geojson")
    places, _ = read_features(REFERENCE_DIR / "overture-places.geojson")
    districts, _ = read_features(REFERENCE_DIR / "overture-districts.geojson")
    protected, _ = read_features(REFERENCE_DIR / "overture-protected-areas.geojson")
    release = water_meta.get("source", "").split("release ")[-1].split(" ")[0]

    geom = lambda layer_id: by_id[layer_id][1]
    reserve = geom("outer-boundary")
    landscape = geom("outer-boundary-with-esz")
    units = {key: geom(f"unit-{key}") for key in ("np", "darrah", "jawahar-sagar", "bhainsrorgarh-wls")}
    # Holes of the reserve outline that no park or sanctuary file draws: land the reserve files close round but none
    # includes (at this build only the area around Daulatpura, which the 2020 ESZ file covers).
    unit_holes = [Polygon(r) for g in units.values() for p in polygons_of(g) for r in p.interiors]
    file_gaps = [
        Polygon(r) for p in polygons_of(reserve) for r in p.interiors
        if area_km2(Polygon(r)) > 1 and not any(h.intersection(Polygon(r)).area > 0.5 * Polygon(r).area for h in unit_holes)
    ]
    core_villages = []
    for props, point in places:
        name = props.get("name")
        if name in CORE_VILLAGES_2023 and box(*CORE_VILLAGE_BBOX).contains(point):
            core_villages.append((CORE_VILLAGES_2023[name], point))
    outside = [name for name, point in core_villages if not landscape.contains(point)]
    if outside:
        print(f"note: 2023 core village points outside the reserve-and-ESZ outline: {', '.join(outside)}", file=sys.stderr)

    return {
        "zones": by_id,
        "areas": {row["layer"]: row for row in areas["layers"]},
        "stats": areas["stats"],
        "partial_blocks": partial_blocks,
        "reserve": reserve,
        "landscape": landscape,
        "esz_2020": geom("esz-2020"),
        "esz_2021": geom("esz-bhainsrorgarh-2021"),
        "core_2013": geom("core-2013-approx"),
        "buffer_2013": geom("buffer-2013-approx"),
        "core_added": geom("core-added-2023"),
        "buffer_added": geom("buffer-added-2023-mapped"),
        "units": units,
        "file_gaps": file_gaps,
        "core_villages": core_villages,
        "water_polygons": [(p, g) for p, g in water if g.geom_type in ("Polygon", "MultiPolygon")],
        "water_lines": [(p, g) for p, g in water if g.geom_type in ("LineString", "MultiLineString")],
        "roads": roads,
        "places": places,
        "districts": districts,
        "protected": protected,
        "release": release,
        "landscape_bbox": expand_bbox(landscape.bounds, 0.05, 0.04),
        "water_bbox": expand_bbox(landscape.bounds, 0.16, 0.12),
        "context_bbox": (74.65, 24.42, 76.55, 25.48),
    }


# ---------------------------------------------------------------------------------------------
# Projection


def mercator(lon: float, lat: float) -> tuple[float, float]:
    radius = 6378137.0
    return radius * math.radians(lon), radius * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def inverse_mercator(x: float, y: float) -> tuple[float, float]:
    radius = 6378137.0
    return math.degrees(x / radius), math.degrees(2 * math.atan(math.exp(y / radius)) - math.pi / 2)


def expand_bbox(bbox, lon_pad: float, lat_pad: float) -> tuple[float, float, float, float]:
    lon_min, lat_min, lon_max, lat_max = bbox
    return lon_min - lon_pad, lat_min - lat_pad, lon_max + lon_pad, lat_max + lat_pad


class View:
    """A map window: the bbox is widened in one direction so the map rectangle has a single scale."""

    def __init__(self, bbox, rect=MAP_RECT):
        self.rect = rect
        x1, y1 = mercator(bbox[0], bbox[1])
        x2, y2 = mercator(bbox[2], bbox[3])
        want = rect[2] / rect[3]
        if (x2 - x1) / (y2 - y1) < want:
            pad = ((y2 - y1) * want - (x2 - x1)) / 2
            x1, x2 = x1 - pad, x2 + pad
        else:
            pad = ((x2 - x1) / want - (y2 - y1)) / 2
            y1, y2 = y1 - pad, y2 + pad
        self.x1, self.y1, self.x2, self.y2 = x1, y1, x2, y2
        lon1, lat1 = inverse_mercator(x1, y1)
        lon2, lat2 = inverse_mercator(x2, y2)
        self.bbox = (lon1, lat1, lon2, lat2)
        self.scale = rect[2] / (x2 - x1)  # pixels per Mercator metre, both axes

    def __call__(self, lon: float, lat: float) -> tuple[float, float]:
        x, y = mercator(lon, lat)
        rx, ry, rw, rh = self.rect
        return rx + (x - self.x1) * self.scale, ry + (self.y2 - y) * self.scale

    def pts(self, coords) -> list[tuple[float, float]]:
        return [self(c[0], c[1]) for c in coords]

    def lat_at_row(self, row: float) -> float:
        """Latitude at a pixel row counted from the top of the map rectangle."""
        return inverse_mercator(self.x1, self.y2 - row / self.scale)[1]

    def inner_box(self, margin_px: int = 40):
        rx, ry, rw, rh = self.rect
        lon1 = inverse_mercator(self.x1 + margin_px / self.scale, 0)[0]
        lon2 = inverse_mercator(self.x2 - margin_px / self.scale, 0)[0]
        lat1 = self.lat_at_row(rh - margin_px)
        lat2 = self.lat_at_row(margin_px)
        return box(lon1, lat1, lon2, lat2)

    def ground_res(self, shape_: tuple[int, int]) -> tuple[float, float]:
        mid_lat = (self.bbox[1] + self.bbox[3]) / 2
        k = math.cos(math.radians(mid_lat))
        return (self.x2 - self.x1) / shape_[1] * k, (self.y2 - self.y1) / shape_[0] * k

    def km_per_px(self) -> float:
        mid_lat = (self.bbox[1] + self.bbox[3]) / 2
        return math.cos(math.radians(mid_lat)) / self.scale / 1000


def tile_xy(lon: float, lat: float, zoom: int) -> tuple[float, float]:
    lat_rad = math.radians(lat)
    n = 2**zoom
    return (lon + 180.0) / 360.0 * n, (1.0 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2.0 * n


# ---------------------------------------------------------------------------------------------
# Geometry drawing


def polygons_of(geom) -> list[Polygon]:
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    out = []
    for part in getattr(geom, "geoms", []):
        out.extend(polygons_of(part))
    return out


def lines_of(geom) -> list[LineString]:
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, LineString):
        return [geom]
    out = []
    for part in getattr(geom, "geoms", []):
        out.extend(lines_of(part))
    return out


def geom_mask(size, geom, view: View) -> Image.Image:
    """8-bit mask of a (multi)polygon, holes included; each part is drawn separately so islands survive."""
    mask = Image.new("L", size, 0)
    for poly in polygons_of(geom):
        part = Image.new("L", size, 0)
        pdraw = ImageDraw.Draw(part)
        pdraw.polygon(view.pts(poly.exterior.coords), fill=255)
        for ring in poly.interiors:
            pdraw.polygon(view.pts(ring.coords), fill=0)
        mask = ImageChops.lighter(mask, part)
    return mask


def fill_geom(img: Image.Image, geom, rgba, view: View) -> None:
    mask = geom_mask(img.size, geom, view)
    color = Image.new("RGBA", img.size, tuple(rgba[:3]) + (0,))
    color.putalpha(mask.point(lambda v: v * rgba[3] // 255))
    img.alpha_composite(color)


def hatch_geom(img: Image.Image, geom, rgba, view: View, spacing: int = 16, width: int = 3, direction: int = 1) -> None:
    mask = geom_mask(img.size, geom, view)
    pattern = Image.new("L", img.size, 0)
    pdraw = ImageDraw.Draw(pattern)
    w, h = img.size
    for c in range(-h, w + h, spacing):
        if direction > 0:
            pdraw.line((c, h, c + h, 0), fill=255, width=width)
        else:
            pdraw.line((c, 0, c + h, h), fill=255, width=width)
    alpha = ImageChops.multiply(mask, pattern).point(lambda v: v * rgba[3] // 255)
    color = Image.new("RGBA", img.size, tuple(rgba[:3]) + (0,))
    color.putalpha(alpha)
    img.alpha_composite(color)


def draw_dashed_line(draw: ImageDraw.ImageDraw, pts, fill, width: int, dash: int = 18, gap: int = 10) -> None:
    on, remaining = True, float(dash)
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        dist = math.hypot(x1 - x0, y1 - y0)
        if dist == 0:
            continue
        dx, dy = (x1 - x0) / dist, (y1 - y0) / dist
        pos = 0.0
        while dist - pos > 1e-6:
            step = min(remaining, dist - pos)
            if on:
                draw.line((x0 + dx * pos, y0 + dy * pos, x0 + dx * (pos + step), y0 + dy * (pos + step)), fill=fill, width=width)
            pos += step
            remaining -= step
            if remaining <= 1e-6:
                on = not on
                remaining = float(dash if on else gap)


def stroke_geom(draw: ImageDraw.ImageDraw, geom, rgba, width: int, view: View, dashed: bool = False, halo=None) -> None:
    rings = [ring for poly in polygons_of(geom) for ring in (poly.exterior, *poly.interiors)]
    paths = [view.pts(r.coords) for r in rings] + [view.pts(l.coords) for l in lines_of(geom)]
    for pts in paths:
        if len(pts) < 2:
            continue
        if halo:
            draw.line(pts, fill=halo, width=width + 4, joint="curve")
        if dashed:
            draw_dashed_line(draw, pts, rgba, width)
        else:
            draw.line(pts, fill=rgba, width=width, joint="curve")


def with_map_clip(img: Image.Image, callback) -> None:
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay, "RGBA")
    callback(odraw, overlay)
    x, y, w, h = MAP_RECT
    clipped = Image.new("RGBA", img.size, (0, 0, 0, 0))
    clipped.paste(overlay.crop((x, y, x + w, y + h)), (x, y))
    img.alpha_composite(clipped)


# ---------------------------------------------------------------------------------------------
# Labels


def boxes_overlap(a, b) -> bool:
    return not (a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1])


class Labels:
    """Places halo labels inside the map frame without overlapping earlier labels."""

    def __init__(self, draw: ImageDraw.ImageDraw):
        self.draw = draw
        self.boxes: list[tuple[float, float, float, float]] = []

    def reserve(self, bbox) -> None:
        self.boxes.append(bbox)

    def fits(self, bbox) -> bool:
        x, y, w, h = MAP_RECT
        inside = bbox[0] >= x + 6 and bbox[2] <= x + w - 6 and bbox[1] >= y + 6 and bbox[3] <= y + h - 6
        return inside and not any(boxes_overlap(bbox, b) for b in self.boxes)

    def add(self, xy, text, fnt, fill, anchor="mm", stroke=4, offsets=((0, 0), (0, -24), (0, 24), (34, 0), (-34, 0)), halo=HALO) -> bool:
        for dx, dy in offsets:
            pos = (xy[0] + dx, xy[1] + dy)
            bbox = self.draw.textbbox(pos, text, font=fnt, anchor=anchor, stroke_width=stroke)
            if self.fits(bbox):
                self.boxes.append(bbox)
                self.draw.text(pos, text, font=fnt, fill=fill, anchor=anchor, stroke_width=stroke, stroke_fill=halo)
                return True
        return False


def label_point(geom, view: View):
    """A point on the part of a geometry inside the map: mid-length of the longest line or inside the largest area."""
    clipped = geom.intersection(view.inner_box())
    if clipped.is_empty:
        return None
    polys = polygons_of(clipped)
    if polys:
        return max(polys, key=lambda p: p.area).representative_point()
    lines = lines_of(clipped)
    if lines:
        return max(lines, key=lambda l: l.length).interpolate(0.5, normalized=True)
    return None


# ---------------------------------------------------------------------------------------------
# Reference layers


def draw_water(draw, layers: dict, view: View, streams: bool = True) -> None:
    for props, geom in layers["water_polygons"]:
        for poly in polygons_of(geom):
            pts = view.pts(poly.exterior.coords)
            if len(pts) >= 3:
                draw.polygon(pts, fill=WATER_FILL, outline=WATER_EDGE)
    for props, geom in layers["water_lines"]:
        kind = props.get("subtype")
        if kind == "stream" and not streams:
            continue
        width = 3 if kind == "river" else 2
        for line in lines_of(geom):
            draw.line(view.pts(line.coords), fill=WATER_LINE, width=width, joint="curve")


def label_water(labels: Labels, layers: dict, view: View, names: list[str]) -> None:
    for name in names:
        geoms = [g for p, g in layers["water_polygons"] + layers["water_lines"] if (p.get("name") or "").lower() == name.lower()]
        if not geoms:
            continue
        pt = label_point(unary_union(geoms), view)
        if pt is not None:
            labels.add(view(pt.x, pt.y), name, FONTS["label_small"], fill=(12, 86, 130), stroke=4)


ROAD_STYLE = {
    "motorway": ((181, 92, 68, 210), 5),
    "trunk": ((181, 92, 68, 210), 5),
    "primary": ((181, 92, 68, 200), 4),
    "secondary": ((205, 140, 93, 185), 3),
    "tertiary": ((205, 140, 93, 150), 2),
}


def draw_roads(draw, layers: dict, view: View, minor: bool = True, fade: float = 1.0, classes=None) -> None:
    for props, geom in layers["roads"]:
        if classes is not None and props.get("subtype") != "rail" and props.get("class") not in classes:
            continue
        if props.get("subtype") == "rail":
            for line in lines_of(geom):
                draw_dashed_line(draw, view.pts(line.coords), (83, 72, 79, int(215 * fade)), 3, dash=12, gap=7)
            continue
        style = ROAD_STYLE.get(props.get("class"))
        if not style or (not minor and props.get("class") in ("secondary", "tertiary")):
            continue
        (r, g, b, a), width = style
        for line in lines_of(geom):
            draw.line(view.pts(line.coords), fill=(r, g, b, int(a * fade)), width=width, joint="curve")


PLACE_RANK = {"city": 0, "town": 1, "village": 2}


def draw_places(draw, labels: Labels, layers: dict, view: View, max_labels: int = 20, classes=("city", "town")) -> None:
    """Cities first, then towns by population; villages only when asked for."""
    inside = view.inner_box(20)
    ranked = sorted(
        ((p, g) for p, g in layers["places"] if p.get("class") in classes and inside.contains(g)),
        key=lambda pg: (PLACE_RANK.get(pg[0].get("class"), 9), -(pg[0].get("population") or 0), pg[0].get("name", "")),
    )
    count = 0
    for props, point in ranked:
        x, y = view(point.x, point.y)
        fnt = FONTS["label_small"] if props["class"] in ("city", "town") else FONTS["tiny"]
        if labels.add((x + 10, y), props["name"], fnt, fill=(46, 53, 50), anchor="lm", stroke=3, offsets=((0, 0),)):
            draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill=(43, 55, 48), outline=(255, 255, 246), width=2)
            count += 1
            if count >= max_labels:
                break


def draw_districts(draw, labels: Labels, layers: dict, view: View) -> None:
    for props, geom in layers["districts"]:
        stroke_geom(draw, geom, (117, 112, 97, 140), 2, view, dashed=True)
    for props, geom in layers["districts"]:
        pt = label_point(geom, view)
        if pt is not None and props.get("name"):
            labels.add(view(pt.x, pt.y), props["name"].upper(), FONTS["label_small"], fill=(120, 114, 96), stroke=3)


MHTR_OSM_NAMES = ("mukund", "bhains", "bhens", "darrah", "jawahar")


def draw_other_protected_areas(img, draw, labels: Labels, layers: dict, view: View) -> None:
    """OSM outlines of nearby sanctuaries; MHTR's own units come from Forest Department files instead."""
    for props, geom in layers["protected"]:
        name = props.get("name") or ""
        if not name or any(token in name.lower() for token in MHTR_OSM_NAMES):
            continue
        fill_geom(img, geom, (107, 151, 102, 60), view)
        stroke_geom(draw, geom, (60, 112, 68, 190), 2, view)
        pt = label_point(geom, view)
        if pt is not None:
            labels.add(view(pt.x, pt.y), name, FONTS["label_small"], fill=(42, 92, 54), stroke=3)


def draw_reserve_outline(draw, layers: dict, view: View, with_esz: bool = True, width: int = 4) -> None:
    if with_esz:
        stroke_geom(draw, layers["landscape"], ESZ + (235,), 3, view, dashed=True)
    stroke_geom(draw, layers["reserve"], RESERVE_LINE + (255,), width, view, halo=HALO + (230,))


def label_units(labels: Labels, layers: dict, view: View, fill=(16, 82, 48)) -> None:
    names = {
        "np": "Mukundara Hills NP",
        "darrah": "Darrah WLS",
        "jawahar-sagar": "Jawahar Sagar WLS",
        "bhainsrorgarh-wls": "Bhainsrorgarh WLS",
    }
    for key, text in names.items():
        geom = layers["units"][key]
        if key == "np":
            geom = geom.difference(layers["units"]["darrah"]).difference(layers["units"]["jawahar-sagar"])
        pt = label_point(geom, view)
        if pt is not None:
            labels.add(view(pt.x, pt.y), text, FONTS["label_small"], fill=fill, stroke=4)


# ---------------------------------------------------------------------------------------------
# Rasters


def terrain_array(view: View, zoom: int = 12) -> np.ndarray:
    lon_min, lat_min, lon_max, lat_max = view.bbox
    x0, y1 = tile_xy(lon_min, lat_min, zoom)
    x1, y0 = tile_xy(lon_max, lat_max, zoom)
    tx0, tx1, ty0, ty1 = math.floor(x0), math.floor(x1), math.floor(y0), math.floor(y1)
    mosaic = Image.new("RGB", ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))

    def load_tile(job):
        tx, ty = job
        data = cached_bytes(f"terrarium-z{zoom}-{tx}-{ty}.png", TERRARIUM_URL.format(z=zoom, x=tx, y=ty))
        return tx, ty, Image.open(io.BytesIO(data)).convert("RGB")

    with ThreadPoolExecutor(max_workers=8) as pool:
        for tx, ty, tile in pool.map(load_tile, [(tx, ty) for tx in range(tx0, tx1 + 1) for ty in range(ty0, ty1 + 1)]):
            mosaic.paste(tile, ((tx - tx0) * 256, (ty - ty0) * 256))
    crop = mosaic.crop((int((x0 - tx0) * 256), int((y0 - ty0) * 256), int((x1 - tx0) * 256), int((y1 - ty0) * 256)))
    arr = np.asarray(crop).astype(np.float32)
    elevation = (arr[:, :, 0] * 256 + arr[:, :, 1] + arr[:, :, 2] / 256) - 32768
    return despike(elevation)


def despike(elevation: np.ndarray) -> np.ndarray:
    """Replace tile artefacts (isolated spikes and pits, e.g. at Kota Barrage) with the local median."""
    med = median_filter(elevation, size=9)
    bad = ~np.isfinite(elevation) | (np.abs(elevation - med) > 45) | (elevation < 60) | (elevation > 1000)
    return np.where(bad, med, elevation)


def hillshade(elevation: np.ndarray, view: View, azimuth: float = 315, altitude: float = 45) -> np.ndarray:
    """Standard (Horn/ESRI) hillshade, lit from the given compass azimuth; 0 = shadow, 1 = full light."""
    x_res, y_res = view.ground_res(elevation.shape)
    dz_south, dz_east = np.gradient(elevation, y_res, x_res)
    slope = np.arctan(np.hypot(dz_east, dz_south))
    aspect = np.arctan2(dz_south, -dz_east)
    az = math.radians(360 - azimuth + 90)
    zenith = math.radians(90 - altitude)
    shaded = np.cos(zenith) * np.cos(slope) + np.sin(zenith) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(shaded, 0, 1)


TERRAIN_STOPS = [(150, (58, 102, 80)), (220, (111, 139, 84)), (300, (188, 165, 98)), (380, (178, 122, 88)), (470, (137, 91, 86)), (560, (232, 224, 205))]
TERRAIN_STOP_NAMES = {150: "valleys", 220: "low hills", 300: "plateau slopes", 380: "higher ridges", 470: "high ridges", 560: "highest relief"}
# Elevation-zone bands: (upper limit in metres, colour, legend title, note). Each band is one flat colour.
ELEVATION_BANDS = [
    (220, (40, 92, 112), "< 220 m", "Valleys and water-linked lowlands."),
    (300, (78, 130, 94), "220–300 m", "Lower slopes and valley edges."),
    (380, (157, 158, 93), "300–380 m", "Mid slopes and plateau."),
    (470, (202, 151, 87), "380–470 m", "Upper slopes and ridge shoulders."),
    (520, (172, 104, 82), "470–520 m", "High ridges."),
    (math.inf, (237, 222, 196), "> 520 m", "Highest relief in this window."),
]


def colorize_elevation(elevation: np.ndarray, shaded: np.ndarray, stops=None, bands=None) -> Image.Image:
    """Tint a DEM with a continuous ramp (`stops`) or flat bands (`bands`, as in ELEVATION_BANDS), then shade it."""
    rgb = np.zeros((*elevation.shape, 3), dtype=np.float32)
    if bands is not None:
        index = np.digitize(elevation, [upper for upper, *_ in bands[:-1]])
        rgb[:] = np.array([color for _, color, *_ in bands], dtype=np.float32)[index]
    else:
        norm = np.clip(elevation, stops[0][0], stops[-1][0])
        for (lo, c0), (hi, c1) in zip(stops[:-1], stops[1:]):
            mask = (norm >= lo) & (norm <= hi)
            t = np.clip((norm - lo) / max(hi - lo, 1e-6), 0, 1)
            for i in range(3):
                rgb[:, :, i] = np.where(mask, c0[i] + (c1[i] - c0[i]) * t, rgb[:, :, i])
    shade = 0.6 + shaded[:, :, None] * 0.55
    return Image.fromarray(np.clip(rgb * shade, 0, 255).astype(np.uint8), "RGB")


def resample_to_map(elevation: np.ndarray) -> np.ndarray:
    return np.array(Image.fromarray(elevation.astype(np.float32), mode="F").resize((MAP_RECT[2], MAP_RECT[3]), Image.Resampling.BILINEAR))


def dem_summary(elevation: np.ndarray) -> dict[str, int]:
    values = elevation[np.isfinite(elevation)]
    return {k: int(round(float(f(values)))) for k, f in (("min", np.min), ("p50", np.median), ("max", np.max))}


def contour_segments(elevation: np.ndarray, levels: list[int], step: int = 6) -> dict[int, list]:
    height, width = elevation.shape
    contours: dict[int, list] = {level: [] for level in levels}
    for level in levels:
        segments = contours[level]
        for y in range(0, height - step, step):
            for x in range(0, width - step, step):
                vals = [elevation[y, x], elevation[y, x + step], elevation[y + step, x + step], elevation[y + step, x]]
                pts = [(x, y), (x + step, y), (x + step, y + step), (x, y + step)]
                cuts = []
                for i in range(4):
                    v0, v1 = vals[i], vals[(i + 1) % 4]
                    if (v0 < level <= v1) or (v1 < level <= v0):
                        t = (level - v0) / (v1 - v0) if v1 != v0 else 0
                        p0, p1 = pts[i], pts[(i + 1) % 4]
                        cuts.append((int(p0[0] + (p1[0] - p0[0]) * t), int(p0[1] + (p1[1] - p0[1]) * t)))
                if len(cuts) >= 2:
                    segments.append((cuts[0], cuts[1]))
                if len(cuts) == 4:
                    segments.append((cuts[2], cuts[3]))
    return contours


def draw_extreme_callouts(draw, labels: Labels, elevation_px: np.ndarray, inside_mask: np.ndarray, items) -> None:
    """Mark the highest and lowest DEM cell inside the landscape outline."""
    for kind, text in items:
        values = np.where(inside_mask, elevation_px, np.nan)
        flat = int(np.nanargmax(values) if kind == "high" else np.nanargmin(values))
        row, col = np.unravel_index(flat, values.shape)
        x, y = MAP_RECT[0] + col, MAP_RECT[1] + row
        fill = (86, 55, 45) if kind == "high" else (13, 83, 105)
        draw.ellipse((x - 8, y - 8, x + 8, y + 8), fill=fill, outline=(255, 251, 229), width=3)
        label = f"{text} ~{int(round(float(elevation_px[row, col])))} m"
        labels.add((x + 14, y), label, FONTS["label_small"], fill=fill, anchor="lm", offsets=((0, 0), (0, -26), (0, 26), (-28 - draw.textlength(label, font=FONTS["label_small"]), 0)))


WORLDCOVER_CLASSES = [
    (10, (0, 100, 0), "Tree cover", "Dry deciduous forest and wooded slopes."),
    (20, (255, 187, 34), "Shrubland", "Scrub and thorn-dominated cover."),
    (30, (255, 255, 76), "Grassland", "Open grassy and herbaceous cover."),
    (40, (240, 150, 255), "Cropland", "Fields around and inside the reserve."),
    # Built-up is dark grey rather than WorldCover red, which reads like tree cover under protanopia.
    (50, (45, 45, 45), "Built-up", "Settlements and built surfaces."),
    (60, (180, 180, 180), "Bare / sparse", "Rock and sparse vegetation."),
    (80, (0, 100, 200), "Permanent water", "Reservoirs and river water."),
    (90, (0, 150, 160), "Herbaceous wetland", "Wet herbaceous cover where classified."),
]


def worldcover_classes(view: View) -> np.ndarray:
    """WorldCover classes on the map grid. The COG is a lat/lon grid, so rows are re-sampled to Mercator."""
    w, h = MAP_RECT[2], MAP_RECT[3]
    key = hashlib.sha1(json.dumps({"bbox": view.bbox, "size": [w, h], "v": "2021-v200-merc"}).encode()).hexdigest()[:14]
    cache_path = CACHE_DIR / f"worldcover-{key}.npy"
    if cache_path.exists():
        return np.load(cache_path)
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.windows import from_bounds

    lon_min, lat_min, lon_max, lat_max = view.bbox
    tile_lon, tile_lat = math.floor(lon_min / 3) * 3, math.floor(lat_min / 3) * 3
    if lon_max > tile_lon + 3 or lat_max > tile_lat + 3:
        raise RuntimeError("WorldCover window crosses a 3-degree tile; mosaic support is required.")
    tile = f"{'N' if tile_lat >= 0 else 'S'}{abs(tile_lat):02d}{'E' if tile_lon >= 0 else 'W'}{abs(tile_lon):03d}"
    src_rows = h * 2
    with rasterio.open(WORLDCOVER_COG_TEMPLATE.format(tile=tile)) as dataset:
        window = from_bounds(lon_min, lat_min, lon_max, lat_max, transform=dataset.transform)
        grid = dataset.read(1, window=window, out_shape=(src_rows, w), resampling=Resampling.nearest)
    rows = np.array([(lat_max - view.lat_at_row(r + 0.5)) / (lat_max - lat_min) * src_rows for r in range(h)])
    classes = grid[np.clip(rows.astype(int), 0, src_rows - 1), :]
    np.save(cache_path, classes)
    return classes


def map_mask(geom, view: View) -> np.ndarray:
    full = geom_mask((CANVAS_W, CANVAS_H), geom, view)
    x, y, w, h = MAP_RECT
    return np.asarray(full.crop((x, y, x + w, y + h))) > 127


def class_shares(classes: np.ndarray, mask: np.ndarray, view: View) -> dict[int, float]:
    """Share of each class inside a mask, weighting rows by Mercator pixel area (cos² latitude)."""
    weights = np.array([math.cos(math.radians(view.lat_at_row(r + 0.5))) ** 2 for r in range(classes.shape[0])])[:, None]
    weights = np.broadcast_to(weights, classes.shape)
    total = float(weights[mask].sum())
    return {cid: float(weights[mask & (classes == cid)].sum()) / total for cid, *_ in WORLDCOVER_CLASSES}


# ---------------------------------------------------------------------------------------------
# Page furniture


def draw_wrapped(draw, text: str, xy, width: int, fnt, fill=(55, 63, 59), line_spacing: int = 8) -> int:
    lines, current = [], ""
    for word in text.split():
        candidate = (current + " " + word).strip()
        if draw.textlength(candidate, font=fnt) <= width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    x, y = xy
    for line in lines:
        draw.text((x, y), line, font=fnt, fill=fill)
        y += fnt.size + line_spacing
    return y


def new_canvas(title: str, subtitle: str) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGBA", (CANVAS_W, CANVAS_H), PAPER)
    draw = ImageDraw.Draw(img, "RGBA")
    draw.text((80, 60), title, font=FONTS["title"], fill=INK)
    draw.text((82, 124), subtitle, font=FONTS["subtitle"], fill=(78, 88, 82))
    px, py, pw, ph = PANEL_RECT
    draw.rounded_rectangle((px, py, px + pw, py + ph), radius=8, fill=PANEL_BG, outline=(206, 210, 196))
    x, y, w, h = MAP_RECT
    draw.rectangle((x, y, x + w, y + h), fill=MAP_BG)
    return img, draw


def draw_graticule(draw, view: View, step: float = 0.25) -> None:
    lon_min, lat_min, lon_max, lat_max = view.bbox
    x, y, w, h = MAP_RECT
    lon = math.ceil(lon_min / step) * step
    while lon <= lon_max:
        px, _ = view(lon, lat_min)
        draw.line((px, y, px, y + h), fill=(205, 210, 200, 200), width=1)
        draw.text((px + 5, y + h - 22), f"{lon:.2f}°E", font=FONTS["tiny"], fill=(94, 102, 97), stroke_width=2, stroke_fill=HALO)
        lon += step
    lat = math.ceil(lat_min / step) * step
    while lat <= lat_max:
        _, py = view(lon_min, lat)
        draw.line((x, py, x + w, py), fill=(205, 210, 200, 200), width=1)
        if y + 4 < py - 18 and py < y + h - 110:  # clear of the frame top and the scale bar
            draw.text((x + 6, py - 18), f"{lat:.2f}°N", font=FONTS["tiny"], fill=(94, 102, 97), stroke_width=2, stroke_fill=HALO)
        lat += step


def draw_map_furniture(draw, view: View) -> None:
    x, y, w, h = MAP_RECT
    draw.rectangle((x, y, x + w, y + h), outline=(84, 93, 83), width=2)
    nx, ny = x + w - 70, y + 82
    draw.polygon([(nx, ny - 48), (nx - 18, ny + 16), (nx, ny + 5), (nx + 18, ny + 16)], fill=(35, 48, 40))
    draw.text((nx, ny + 28), "N", font=FONTS["label_small"], fill=(35, 48, 40), anchor="mm")
    km_per_px = view.km_per_px()
    length_km = max(k for k in (5, 10, 20, 25, 50, 100) if k / km_per_px < w * 0.28)
    px_len = length_km / km_per_px
    x0, y0 = x + 40, y + h - 70
    draw.rectangle((x0 - 14, y0 - 26, x0 + px_len + 40, y0 + 42), fill=HALO + (215,))
    draw.line((x0, y0, x0 + px_len, y0), fill=(28, 38, 31), width=6)
    for end in (x0, x0 + px_len):
        draw.line((end, y0 - 12, end, y0 + 12), fill=(28, 38, 31), width=3)
    draw.text((x0, y0 + 20), "0", font=FONTS["tiny"], fill=(28, 38, 31), anchor="mt")
    draw.text((x0 + px_len, y0 + 20), f"{length_km} km", font=FONTS["tiny"], fill=(28, 38, 31), anchor="mt")


def panel_heading(draw, y: int, title: str) -> int:
    draw.text((PANEL_RECT[0] + 30, y), title, font=FONTS["h2"], fill=(34, 50, 41))
    return y + 46


def on_panel(color) -> tuple[int, int, int]:
    """Flatten an RGBA colour onto the panel background (ImageDraw does not blend on RGBA canvases)."""
    if len(color) < 4:
        return tuple(color)
    a = color[3] / 255
    return tuple(int(round(c * a + b * (1 - a))) for c, b in zip(color[:3], PANEL_BG))


def legend_item(draw, y: int, color, title: str, note: str | None = None, kind: str = "box", img: Image.Image | None = None, line_width: int = 6, bg=None) -> int:
    x = PANEL_RECT[0] + 32
    if kind == "hatch":
        color = (on_panel(color[0]), on_panel(color[1]))
    else:
        color = on_panel(color)
    if bg is not None:
        draw.rounded_rectangle((x, y, x + 42, y + 24), radius=3, fill=on_panel(bg), outline=(110, 117, 107))
    if kind == "line":
        draw.line((x, y + 12, x + 42, y + 12), fill=color, width=line_width)
    elif kind == "dash":
        draw_dashed_line(draw, [(x, y + 12), (x + 42, y + 12)], color, 4, dash=10, gap=6)
    elif kind == "dot":
        draw.ellipse((x + 12, y + 3, x + 30, y + 21), fill=color, outline=(255, 255, 246), width=2)
    elif kind == "hatch" and img is not None:
        draw.rectangle((x, y, x + 34, y + 24), fill=color[0])
        swatch = Image.new("RGBA", (34, 24), (0, 0, 0, 0))
        sdraw = ImageDraw.Draw(swatch)
        for c in range(-24, 34, 8):
            sdraw.line((c, 24, c + 24, 0), fill=color[1], width=2)
        img.alpha_composite(swatch, (x, y))
        draw.rectangle((x, y, x + 34, y + 24), outline=(110, 117, 107))
    else:
        draw.rounded_rectangle((x, y, x + 34, y + 24), radius=3, fill=color, outline=(110, 117, 107))
    draw.text((x + 54, y - 2), title, font=FONTS["body"], fill=(46, 57, 50))
    y += 30
    if note:
        y = draw_wrapped(draw, note, (x + 54, y - 2), PANEL_RECT[2] - 100, FONTS["small"], fill=MUTED, line_spacing=4) + 8
    return y + 8


def panel_text(draw, y: int, text: str, fnt_key: str = "small") -> int:
    return draw_wrapped(draw, text, (PANEL_RECT[0] + 32, y), PANEL_RECT[2] - 64, FONTS[fnt_key], fill=MUTED if fnt_key != "body" else (55, 63, 59), line_spacing=5) + 10


def footer_note(draw, text: str) -> None:
    draw_wrapped(draw, text, (80, CANVAS_H - 86), CANVAS_W - 160, FONTS["small"], fill=MUTED, line_spacing=4)


def finalize_map(img: Image.Image, slug: str) -> Path:
    path = OUT_DIR / f"mhtr-{slug}-map.png"
    rgb = img.convert("RGB")
    rgb.save(path, optimize=True)
    rgb.resize((960, 640), Image.Resampling.LANCZOS).save(path.with_name(path.stem + "-preview.webp"), format="WEBP", quality=82, method=6)
    print(path.relative_to(ROOT), flush=True)
    return path


def km2(value) -> str:
    return "—" if value in (None, "") else f"{float(value):,.2f}"


# ---------------------------------------------------------------------------------------------
# Maps


def render_legal_zones(layers: dict) -> Path:
    view = View(layers["landscape_bbox"])
    img, draw = new_canvas(
        "MHTR Core, Buffer And Eco-Sensitive Zones",
        "The 2023 reserve as far as the Forest Department's public map files draw it",
    )
    draw_graticule(draw, view, step=0.1)
    a = layers["areas"]

    def geos(odraw, oimg):
        draw_roads(odraw, layers, view, minor=False, fade=0.5)
        fill_geom(oimg, layers["esz_2020"], ESZ + (70,), view)
        fill_geom(oimg, layers["esz_2021"], ESZ + (70,), view)
        fill_geom(oimg, layers["buffer_2013"], BUFFER + (215,), view)
        fill_geom(oimg, layers["buffer_added"], BUFFER + (215,), view)
        fill_geom(oimg, layers["core_2013"], CORE + (225,), view)
        fill_geom(oimg, layers["core_added"], CORE + (225,), view)
        draw_water(odraw, layers, view, streams=False)
        hatch_geom(oimg, layers["esz_2020"], ESZ + (200,), view, spacing=14, width=2)
        hatch_geom(oimg, layers["esz_2021"], ESZ + (200,), view, spacing=14, width=2, direction=-1)
        hatch_geom(oimg, layers["buffer_added"], (255, 255, 255, 200), view, spacing=10, width=2)
        hatch_geom(oimg, layers["core_added"], (255, 255, 255, 150), view, spacing=12, width=2)
        for key, unit in layers["units"].items():
            stroke_geom(odraw, unit, (255, 255, 240, 220), 2, view, dashed=True)
        stroke_geom(odraw, layers["reserve"], RESERVE_LINE + (255,), 4, view)
        stroke_geom(odraw, layers["landscape"], (150, 98, 10, 255), 2, view)
        labels = Labels(odraw)
        label_units(labels, layers, view, fill=(12, 60, 36))
        draw_places(odraw, labels, layers, view, max_labels=10)
        esz_pt = label_point(layers["esz_2021"].difference(layers["units"]["bhainsrorgarh-wls"].buffer(0.02)), view)
        if esz_pt is not None:
            labels.add(view(esz_pt.x, esz_pt.y), "Bhainsrorgarh ESZ (2021)", FONTS["label_small"], fill=(120, 74, 4))
        esz_pt = label_point(layers["esz_2020"].intersection(box(75.9, 24.6, 76.3, 24.95)), view)
        if esz_pt is not None:
            labels.add(view(esz_pt.x, esz_pt.y), "MHTR ESZ (2020)", FONTS["label_small"], fill=(120, 74, 4))

    with_map_clip(img, geos)
    draw_map_furniture(draw, view)

    y = PANEL_RECT[1] + 30
    y = panel_heading(draw, y, "Legal Layers")
    y = legend_item(draw, y, CORE, "Core, 2013 (approx.)", f"{km2(a['core-2013-approx']['measured_area_km2_wgs84'])} km² drawn vs 417.17 notified. The NP, Darrah and Jawahar Sagar files; about 26 km² is misassigned between core and buffer.")
    y = legend_item(draw, y, (CORE + (255,), (255, 255, 255, 200)), "Core added, 2023", f"Bhainsrorgarh WLS file: {km2(a['core-added-2023']['measured_area_km2_wgs84'])} km² vs 193.09 km² of notified forest blocks.", kind="hatch", img=img)
    y = legend_item(draw, y, BUFFER, "Buffer, 2013 (approx.)", f"{km2(a['buffer-2013-approx']['measured_area_km2_wgs84'])} km² vs 342.82 notified. Reserve file minus core.")
    y = legend_item(draw, y, (BUFFER + (255,), (255, 255, 255, 220)), "Buffer added, 2023", f"The Kota file draws three whole blocks, {km2(layers['stats']['buffer_blocks_2023_drawn_km2'])} km² of 102.25 notified. Only the {km2(a['buffer-added-2023-mapped']['measured_area_km2_wgs84'])} km² outside the 2013 files is hatched, nearly all Barkheda.", kind="hatch", img=img)
    y = legend_item(draw, y, (ESZ + (70,), ESZ + (200,)), "Eco-sensitive zones", f"2020 MHTR ESZ {km2(a['esz-2020']['measured_area_km2_wgs84'])} km² (notified 248.70); 2021 Bhainsrorgarh ESZ {km2(a['esz-bhainsrorgarh-2021']['measured_area_km2_wgs84'])} km² (notified 304.70).", kind="hatch", img=img)
    y = legend_item(draw, y, RESERVE_LINE, "Reserve outline", f"{km2(layers['stats']['outer_boundary_km2'])} km² drawn of 1,135.79 notified.", kind="line")
    y = legend_item(draw, y, (255, 255, 240), "Park and sanctuary edges", kind="dash", bg=CORE)
    y = panel_heading(draw, y + 6, "Not Outlined In Any Public File")
    y = panel_text(
        draw,
        y,
        f"About {layers['stats']['not_mapped_notified_km2']:.0f} km² of the notified reserve: 21 revenue villages added to the core in 2023 "
        "and most 2023 buffer additions near Kota and in Bundi, which the district files draw only as whole blocks. See the data-gaps map.",
    )
    footer_note(
        draw,
        f"Sources: {FD_CREDIT}; notifications F.3(8)Forest/2012 (9 Apr 2013) and F.3(22)Forest/2023 (5 Oct 2023); MoEFCC S.O. 4268(E) (2020) and S.O. 3683(E) (2021); "
        f"{OSM_CREDIT.format(release=layers['release'])}. Areas measured on the WGS84 ellipsoid. {NOT_LEGAL}",
    )
    return finalize_map(img, "legal-zones")


def render_data_gaps(layers: dict) -> Path:
    blocks = unary_union([g for _, g in layers["partial_blocks"]])
    view = View(expand_bbox(unary_union([layers["landscape"], blocks]).bounds, 0.04, 0.03))
    img, draw = new_canvas(
        "Where Public MHTR Maps Fall Short",
        "Parts of the 2023 reserve with no outline of their own in public map files, and where the files disagree",
    )
    draw_graticule(draw, view, step=0.1)
    # Only the whole blocks are drawn, so ESZ land inside them may or may not be the notified buffer part.
    esz_in_blocks = unary_union([layers["esz_2020"], layers["esz_2021"]]).intersection(blocks)

    def geos(odraw, oimg):
        fill_geom(oimg, layers["landscape"], ESZ + (45,), view)
        fill_geom(oimg, layers["reserve"], (CORE[0], CORE[1], CORE[2], 70), view)
        draw_water(odraw, layers, view, streams=False)
        hatch_geom(oimg, esz_in_blocks, GAP + (210,), view, spacing=10, width=2)
        for gap in layers["file_gaps"]:
            fill_geom(oimg, gap, GAP + (110,), view)
        for props, geom in layers["partial_blocks"]:
            stroke_geom(odraw, geom, GAP + (255,), 3, view, dashed=True)
        stroke_geom(odraw, layers["reserve"], RESERVE_LINE + (255,), 3, view)
        stroke_geom(odraw, layers["landscape"], (150, 98, 10, 255), 2, view, dashed=True)
        labels = Labels(odraw)
        for name, point in layers["core_villages"]:
            x, y = view(point.x, point.y)
            odraw.ellipse((x - 6, y - 6, x + 6, y + 6), fill=GAP + (255,), outline=(255, 255, 246), width=2)
            labels.reserve((x - 7, y - 7, x + 7, y + 7))
        # East to west, so a label that runs right never covers the dot of a village to its east.
        for name, point in sorted(layers["core_villages"], key=lambda v: -v[1].x):
            x, y = view(point.x, point.y)
            left = -26 - odraw.textlength(name, font=FONTS["tiny"])
            style = dict(fill=(120, 24, 42), stroke=3)
            # Beside the dot, then centred above or below it, then a little higher or lower beside it.
            placed = (labels.add((x + 13, y), name, FONTS["tiny"], anchor="lm", offsets=[(0, 0), (left, 0)], **style)
                      or labels.add((x, y), name, FONTS["tiny"], anchor="mm", offsets=[(0, -19), (0, 19)], **style)
                      or labels.add((x + 13, y), name, FONTS["tiny"], anchor="lm", offsets=[(dx, dy) for dy in (-16, 16, -30, 30) for dx in (0, left)], **style))
            if not placed:
                print(f"warning: no room to label {name} on the data-gaps map", file=sys.stderr)
        for props, geom in layers["partial_blocks"]:
            pt = geom.representative_point()
            labels.add(view(pt.x, pt.y), f"{block_name(props)}: {props['notified_part_km2']:g} km² added", FONTS["label_small"], fill=(120, 24, 42))
        for gap in layers["file_gaps"]:
            pt = gap.representative_point()
            labels.add(view(pt.x, pt.y), f"Enclosed, in no reserve file: {area_km2(gap):.1f} km²", FONTS["label_small"], fill=(120, 24, 42), offsets=((0, 0), (0, -30), (0, 30)))
        draw_places(odraw, labels, layers, view, max_labels=8)

    with_map_clip(img, geos)
    draw_map_furniture(draw, view)

    y = PANEL_RECT[1] + 30
    y = panel_heading(draw, y, "What Is Missing")
    y = legend_item(draw, y, GAP, "2023 core villages", f"21 revenue villages (80.45 km²) added to the core, to become critical habitat after voluntary relocation or acquisition of rights. Dots mark the {len(layers['core_villages'])} matched by name to OSM place points; they are not boundaries.", kind="dot")
    y = legend_item(draw, y, GAP, "Blocks added in part", f"2023 buffer parts of these Kota and Bundi blocks ({sum(p['notified_part_km2'] for p, _ in layers['partial_blocks']):.1f} km²) are listed by area or compartment; only whole blocks can be outlined. Akelgarh has no part mark; 7.75 km² of it was already core.", kind="dash")
    y = legend_item(draw, y, (GAP + (40,), GAP + (255,)), "ESZ inside those blocks", f"About {area_km2(esz_in_blocks):.0f} km² of these blocks is ESZ. No file shows whether the added parts lie there, so some land may be both ESZ and buffer.", kind="hatch", img=img)
    y = legend_item(draw, y, GAP + (140,), "Enclosed, in no reserve file", "Around Daulatpura: the reserve and Bhainsrorgarh files close round it, but none includes it. The 2020 ESZ file covers 6.1 km² of it.")
    y = legend_item(draw, y, ESZ + (45,), "Bhainsrorgarh file enclaves", "Nine holes (25.7 km²) the sanctuary file leaves open, outside the reserve outline and inside the 2021 ESZ; most hold villages.")
    y = panel_heading(draw, y + 4, "Not Drawable At All")
    y = panel_text(draw, y, "National Chambal buffer piece (23.85 km²) and Ambarani-A (3.54 km²): no public file reaches them. No official file splits core from buffer.")
    y = legend_item(draw, y, RESERVE_LINE, "Reserve outline", kind="line")
    y = legend_item(draw, y, (150, 98, 10), "Reserve + ESZ outline", kind="dash")
    footer_note(
        draw,
        f"Sources: {FD_CREDIT}, including the Kota (2018) and Bundi (2023) forest-block files; notification F.3(22)Forest/2023 (5 Oct 2023); "
        f"{OSM_CREDIT.format(release=layers['release'])} for village points. {NOT_LEGAL}",
    )
    return finalize_map(img, "data-gaps")


def render_esz(layers: dict) -> Path:
    view = View(layers["landscape_bbox"])
    img, draw = new_canvas("MHTR Eco-Sensitive Zones", "The 2020 MHTR ESZ and the 2021 Bhainsrorgarh ESZ, from the Forest Department's ESZ files")
    draw_graticule(draw, view, step=0.1)
    a = layers["areas"]

    def geos(odraw, oimg):
        draw_roads(odraw, layers, view, minor=True, fade=0.8)
        fill_geom(oimg, layers["esz_2020"], ESZ + (150,), view)
        fill_geom(oimg, layers["esz_2021"], (214, 104, 40, 150), view)
        fill_geom(oimg, layers["reserve"], (CORE[0], CORE[1], CORE[2], 45), view)
        draw_water(odraw, layers, view, streams=False)
        stroke_geom(odraw, layers["reserve"], RESERVE_LINE + (255,), 4, view)
        stroke_geom(odraw, layers["units"]["bhainsrorgarh-wls"], RESERVE_LINE + (255,), 2, view, dashed=True)
        labels = Labels(odraw)
        for hole in (Polygon(ring) for poly in polygons_of(layers["landscape"]) for ring in poly.interiors):
            if area_km2(hole) > 1:
                stroke_geom(odraw, hole, GAP + (255,), 3, view)
                pt = hole.representative_point()
                labels.add(view(pt.x, pt.y), f"Hole in ESZ file ({area_km2(hole):.1f} km²)", FONTS["label_small"], fill=(120, 24, 42), offsets=((0, -34), (0, 34), (150, 0), (-150, 0)))
        draw_places(odraw, labels, layers, view, max_labels=14)
        label_units(labels, layers, view)

    with_map_clip(img, geos)
    draw_map_furniture(draw, view)
    y = PANEL_RECT[1] + 30
    y = panel_heading(draw, y, "Two Notifications")
    y = legend_item(draw, y, ESZ + (150,), "MHTR ESZ, 2020", f"S.O. 4268(E), 25 Nov 2020: 248.70 km² notified, {km2(a['esz-2020']['measured_area_km2_wgs84'])} km² drawn. Stated as 0–1 km wide, but near Rawatbhata it reaches about 5.4 km from the reserve file, up to the Bhainsrorgarh sanctuary edge.")
    y = legend_item(draw, y, (214, 104, 40, 150), "Bhainsrorgarh ESZ, 2021", f"S.O. 3683(E), 10 Sep 2021: 304.70 km² notified, {km2(a['esz-bhainsrorgarh-2021']['measured_area_km2_wgs84'])} km² drawn; 0–9.6 km, zero to the north and north-east.")
    y = legend_item(draw, y, RESERVE_LINE, "Reserve outline (2023 extent)", kind="line")
    y = panel_heading(draw, y + 6, "Reading The Files")
    y = panel_text(draw, y, "The MHTR ESZ file is an outer envelope (reserve plus zone, 1,003.91 km²); the band is the envelope minus the reserve, park and sanctuary files. The 2020 ESZ was drawn around the 2013 reserve and crosses forest blocks partly added to the buffer in 2023; no file shows whether the added parts fall inside it.")
    y = panel_text(draw, y, "The 3.5 km² hole around Jawara (Jaora) Khurd, outlined in red, is in the official ESZ file itself; the Gazette lists Jawara Khurd as an ESZ village.")
    footer_note(
        draw,
        f"Sources: MoEFCC S.O. 4268(E) (25 Nov 2020) and S.O. 3683(E) (10 Sep 2021); Forest Department ESZ files MHTR.kmz and BHAINSROAD ESZ.kmz (as on 1 Jun 2026); "
        f"{OSM_CREDIT.format(release=layers['release'])}. {NOT_LEGAL}",
    )
    return finalize_map(img, "esz-outer-limit")


def render_boundary_context(layers: dict) -> Path:
    view = View(layers["context_bbox"])
    img, draw = new_canvas("MHTR Boundary And Landscape Context", "Mukundara Hills Tiger Reserve in the Kota–Bundi–Chittorgarh–Jhalawar landscape")
    draw_graticule(draw, view)

    def geos(odraw, oimg):
        draw_roads(odraw, layers, view, fade=0.6, classes=("motorway", "trunk", "primary", "secondary"))
        labels = Labels(odraw)
        draw_districts(odraw, labels, layers, view)
        draw_other_protected_areas(oimg, odraw, labels, layers, view)
        fill_geom(oimg, layers["landscape"], ESZ + (60,), view)
        fill_geom(oimg, layers["reserve"], CORE + (120,), view)
        draw_water(odraw, layers, view, streams=False)
        draw_reserve_outline(odraw, layers, view, width=5)
        pt = label_point(layers["reserve"].intersection(box(75.7, 24.8, 75.95, 24.95)), view)
        if pt is not None:
            labels.add(view(pt.x, pt.y), "Mukundara Hills Tiger Reserve", FONTS["label"], fill=(12, 60, 36), stroke=5)
        draw_places(odraw, labels, layers, view, max_labels=22)
        label_water(labels, layers, view, ["Chambal River", "Rana Pratap Sagar", "Gandhi Sagar", "Kali Sindh", "Parvan", "Banas"])

    with_map_clip(img, geos)
    draw_map_furniture(draw, view)
    y = PANEL_RECT[1] + 30
    y = panel_heading(draw, y, "Map Layers")
    y = legend_item(draw, y, CORE + (130,), "Mukundara Hills Tiger Reserve", "Outline joined from Forest Department files (2023 extent as far as they draw it).")
    y = legend_item(draw, y, ESZ + (70,), "Eco-sensitive zones", "2020 MHTR and 2021 Bhainsrorgarh ESZ files.")
    y = legend_item(draw, y, (107, 151, 102, 80), "Other protected areas", "OpenStreetMap outlines, indicative only.")
    y = legend_item(draw, y, WATER_LINE, "Rivers and reservoirs", kind="line")
    y = legend_item(draw, y, (181, 92, 68, 230), "Major roads", kind="line")
    y = legend_item(draw, y, (83, 72, 79, 230), "Railway", kind="dash")
    y = legend_item(draw, y, (117, 112, 97, 200), "District boundary", kind="dash")
    y = panel_heading(draw, y + 10, "Reading The Map")
    panel_text(draw, y, "For orientation and landscape planning. It shows no wildlife sites, nests, dens, roosts or sensitive observation points.", "body")
    footer_note(draw, f"Sources: {FD_CREDIT}; {OSM_CREDIT.format(release=layers['release'])} for rivers, roads, places, districts and other protected areas. {NOT_LEGAL}")
    return finalize_map(img, "boundary-context")


def landscape_inside_mask(layers: dict, view: View) -> np.ndarray:
    return map_mask(layers["landscape"], view)


def render_terrain(layers: dict) -> Path:
    view = View(layers["landscape_bbox"])
    img, draw = new_canvas("MHTR Terrain And Ridge-Relief Map", "Shaded terrain of Mukundara's ridge-to-valley geography")
    elevation = terrain_array(view, zoom=12)
    shaded = hillshade(elevation, view)
    img.paste(colorize_elevation(elevation, shaded, TERRAIN_STOPS).resize((MAP_RECT[2], MAP_RECT[3]), Image.Resampling.LANCZOS), (MAP_RECT[0], MAP_RECT[1]))
    elev_px = resample_to_map(elevation)
    stats = dem_summary(elev_px[landscape_inside_mask(layers, view)])
    draw_graticule(draw, view, step=0.1)

    def geos(odraw, oimg):
        draw_water(odraw, layers, view)
        draw_reserve_outline(odraw, layers, view)
        labels = Labels(odraw)
        draw_extreme_callouts(odraw, labels, elev_px, landscape_inside_mask(layers, view), [("high", "Highest point"), ("low", "Lowest point")])
        label_units(labels, layers, view, fill=(12, 60, 36))
        label_water(labels, layers, view, ["Chambal River", "Rana Pratap Sagar", "Kali Sindh"])

    with_map_clip(img, geos)
    draw_map_furniture(draw, view)
    y = PANEL_RECT[1] + 30
    y = panel_heading(draw, y, "Terrain Reading")
    y = panel_text(draw, y, "Long ridges and valleys run north-west to south-east. They shape access, water retention, visibility and habitat edges.", "body")
    y = panel_heading(draw, y + 8, "Elevation Tint")
    y = panel_text(draw, y, f"Inside the reserve and ESZ outline the DEM runs from about {stats['min']} m to {stats['max']} m above sea level (median {stats['p50']} m). Light from the north-west. Colours blend between the heights below.")
    for i, (height, color) in enumerate(TERRAIN_STOPS):
        when = f"{height} m or less" if i == 0 else f"{height} m and above" if i == len(TERRAIN_STOPS) - 1 else f"{height} m"
        y = legend_item(draw, y, color, f"{when}: {TERRAIN_STOP_NAMES[height]}")
    y = legend_item(draw, y, RESERVE_LINE, "Reserve outline", kind="line")
    y = legend_item(draw, y, ESZ, "Reserve + ESZ outline", kind="dash")
    footer_note(draw, f"Sources: Mapzen Terrain Tiles on AWS (Terrarium; built from SRTM, GMTED2010, ETOPO1 and other sources; zoom 12, artefacts median-filtered); {FD_CREDIT}; {OSM_CREDIT.format(release=layers['release'])}. Elevation is DEM-derived, not survey. {NOT_LEGAL}")
    return finalize_map(img, "terrain-relief")


def render_water(layers: dict) -> Path:
    view = View(layers["water_bbox"])
    img, draw = new_canvas("MHTR Water Systems Map", "Chambal-linked rivers, reservoirs and drainage around Mukundara")
    elevation = terrain_array(view, zoom=11)
    shaded = hillshade(elevation, view, azimuth=315, altitude=40)
    gray = np.clip(150 + shaded * 90, 150, 240).astype(np.uint8)
    relief = Image.fromarray(np.dstack([gray, gray, (gray * 0.96).astype(np.uint8)]), "RGB").resize((MAP_RECT[2], MAP_RECT[3]), Image.Resampling.LANCZOS)
    img.paste(relief, (MAP_RECT[0], MAP_RECT[1]))
    draw_graticule(draw, view)

    def geos(odraw, oimg):
        draw_roads(odraw, layers, view, minor=False, fade=0.6)
        draw_water(odraw, layers, view)
        fill_geom(oimg, layers["reserve"], CORE + (40,), view)
        draw_reserve_outline(odraw, layers, view)
        labels = Labels(odraw)
        label_water(labels, layers, view, ["Chambal River", "Rana Pratap Sagar", "Gandhi Sagar", "Kali Sindh", "Ahu", "Parvan", "Kishore Sagar", "Banas", "Mej"])
        draw_places(odraw, labels, layers, view, max_labels=12)

    with_map_clip(img, geos)
    draw_map_furniture(draw, view)
    y = PANEL_RECT[1] + 30
    y = panel_heading(draw, y, "Hydrology")
    y = legend_item(draw, y, WATER_FILL, "Reservoirs and water bodies", "Mapped water areas over about 2 ha.")
    y = legend_item(draw, y, WATER_LINE, "Rivers, streams and canals", kind="line")
    y = legend_item(draw, y, RESERVE_LINE, "Reserve outline", kind="line")
    y = legend_item(draw, y, ESZ, "Reserve + ESZ outline", kind="dash")
    y = panel_heading(draw, y + 10, "Why It Matters")
    panel_text(draw, y, "Water concentrates wildlife in the dry months, supports riparian vegetation and links the ridges to the Chambal and Kali Sindh. Labels sit on the mapped feature they name.", "body")
    footer_note(draw, f"Sources: {OSM_CREDIT.format(release=layers['release'])}; Mapzen Terrain Tiles on AWS (Terrarium; built from SRTM, GMTED2010, ETOPO1 and other sources); {FD_CREDIT}. Sensitive wildlife locations are not shown. {NOT_LEGAL}")
    return finalize_map(img, "water-systems")


def render_elevation(layers: dict) -> Path:
    view = View(layers["landscape_bbox"])
    img, draw = new_canvas("MHTR Elevation Zones And Contours", "DEM-derived elevation bands for ridges, slopes and valley floors")
    elevation = terrain_array(view, zoom=12)
    shaded = hillshade(elevation, view, azimuth=315, altitude=44)
    img.paste(colorize_elevation(elevation, shaded, bands=ELEVATION_BANDS).resize((MAP_RECT[2], MAP_RECT[3]), Image.Resampling.LANCZOS), (MAP_RECT[0], MAP_RECT[1]))
    elev_px = resample_to_map(elevation)
    stats = dem_summary(elev_px[landscape_inside_mask(layers, view)])
    contours = contour_segments(elev_px, list(range(200, 601, 50)))
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    cdraw = ImageDraw.Draw(overlay, "RGBA")
    for level, segments in contours.items():
        color = (84, 62, 50, 138 if level % 100 == 0 else 90)
        width = 2 if level % 100 == 0 else 1
        for (x0, y0), (x1, y1) in segments:
            cdraw.line((MAP_RECT[0] + x0, MAP_RECT[1] + y0, MAP_RECT[0] + x1, MAP_RECT[1] + y1), fill=color, width=width)
    img.alpha_composite(overlay)
    draw_graticule(draw, view, step=0.1)

    def geos(odraw, oimg):
        draw_water(odraw, layers, view, streams=False)
        draw_reserve_outline(odraw, layers, view)
        labels = Labels(odraw)
        draw_extreme_callouts(odraw, labels, elev_px, landscape_inside_mask(layers, view), [("high", "Highest point"), ("low", "Lowest point")])
        label_units(labels, layers, view, fill=(12, 60, 36))

    with_map_clip(img, geos)
    draw_map_furniture(draw, view)
    y = PANEL_RECT[1] + 30
    y = panel_heading(draw, y, "Elevation Bands")
    y = panel_text(draw, y, f"Metres above sea level from DEM tiles. Inside the reserve and ESZ outline: about {stats['min']}–{stats['max']} m, median {stats['p50']} m.")
    for _, color, title, note in ELEVATION_BANDS:
        y = legend_item(draw, y, color, title, note)
    y = legend_item(draw, y, (84, 62, 50, 160), "50 m contours", "Bold lines every 100 m.", kind="line", line_width=2)
    footer_note(draw, f"Sources: Mapzen Terrain Tiles on AWS (Terrarium; built from SRTM, GMTED2010, ETOPO1 and other sources; zoom 12, artefacts median-filtered); {FD_CREDIT}; {OSM_CREDIT.format(release=layers['release'])}. Elevation is DEM-derived, not survey. {NOT_LEGAL}")
    return finalize_map(img, "elevation-zones")


def render_landcover(layers: dict) -> Path:
    view = View(layers["landscape_bbox"])
    img, draw = new_canvas("MHTR Land Cover And Habitat Context", "ESA WorldCover 2021 classes in and around Mukundara Hills Tiger Reserve")
    classes = worldcover_classes(view)
    rgb = np.full((*classes.shape, 3), (247, 247, 238), dtype=np.uint8)
    for class_id, color, *_ in WORLDCOVER_CLASSES:
        rgb[classes == class_id] = color
    img.paste(Image.fromarray(rgb, "RGB"), (MAP_RECT[0], MAP_RECT[1]))
    reserve_shares = class_shares(classes, map_mask(layers["reserve"], view), view)
    esz_shares = class_shares(classes, map_mask(unary_union([layers["esz_2020"], layers["esz_2021"]]).difference(layers["reserve"]), view), view)
    draw_graticule(draw, view, step=0.1)

    def geos(odraw, oimg):
        stroke_geom(odraw, layers["landscape"], (255, 251, 229, 255), 7, view)
        stroke_geom(odraw, layers["landscape"], (150, 98, 10, 255), 3, view, dashed=True)
        stroke_geom(odraw, layers["reserve"], (255, 251, 229, 255), 8, view)
        stroke_geom(odraw, layers["reserve"], RESERVE_LINE + (255,), 4, view)
        labels = Labels(odraw)
        label_units(labels, layers, view, fill=(12, 60, 36))

    with_map_clip(img, geos)
    draw_map_furniture(draw, view)
    y = PANEL_RECT[1] + 30
    y = panel_heading(draw, y, "Share Of Area, 2021")
    draw.text((PANEL_RECT[0] + 340, y), "Reserve", font=FONTS["tiny"], fill=MUTED, anchor="ra")
    draw.text((PANEL_RECT[0] + 420, y), "ESZ", font=FONTS["tiny"], fill=MUTED, anchor="ra")
    y += 30
    for class_id, color, title, note in WORLDCOVER_CLASSES:
        x = PANEL_RECT[0] + 32
        draw.rounded_rectangle((x, y, x + 30, y + 22), radius=3, fill=color, outline=(110, 117, 107))
        draw.text((x + 44, y), title, font=FONTS["small"], fill=(46, 57, 50))
        draw.text((PANEL_RECT[0] + 340, y), f"{reserve_shares[class_id] * 100:4.1f}%", font=FONTS["small"], fill=(46, 57, 50), anchor="ra")
        draw.text((PANEL_RECT[0] + 420, y), f"{esz_shares[class_id] * 100:4.1f}%", font=FONTS["small"], fill=(46, 57, 50), anchor="ra")
        y += 34
    y = legend_item(draw, y + 8, RESERVE_LINE, "Reserve outline", kind="line")
    y = legend_item(draw, y, (150, 98, 10), "Reserve + ESZ outline", kind="dash")
    y = panel_heading(draw, y + 6, "Interpretation")
    panel_text(draw, y, "A 10 m satellite classification for 2021: a broad habitat baseline, not a current or field-verified map. Shares are of the outlines drawn here; ESZ excludes the reserve. Built-up is dark grey, not WorldCover red, for colour-blind readers.")
    footer_note(draw, f"Sources: ESA WorldCover 2021 v200 (CC BY 4.0; © ESA WorldCover project / contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium); {FD_CREDIT}. {NOT_LEGAL}")
    path = finalize_map(img, "land-cover-habitat")
    (DERIVED_DIR / "mhtr-land-cover-shares-2021.json").write_text(json.dumps({
        "source": "ESA WorldCover 2021 v200",
        "method": "Map-grid pixels inside each outline, weighted by Mercator pixel area (cos² latitude).",
        "classes": {title: {"reserve": round(reserve_shares[cid], 4), "esz_outside_reserve": round(esz_shares[cid], 4)} for cid, _, title, _ in WORLDCOVER_CLASSES},
    }, indent=2) + "\n")
    return path


def write_source_notes(paths: list[Path], layers: dict) -> None:
    sources = json.loads(SOURCES_PATH.read_text())
    esz = unary_union([layers["esz_2020"], layers["esz_2021"]])
    crossings = sorted(((block_name(p), area_km2(esz.intersection(g))) for p, g in layers["partial_blocks"]), key=lambda c: -c[1])
    esz_in_blocks = ", ".join(f"{name} about {area:.0f} km²" if area >= 5 else f"{name} about {area:.1f} km²" for name, area in crossings if area >= 1)
    lines = [
        "# MHTR GIS sources and outputs",
        "",
        "Built by `scripts/build-boundary-layers.py` (boundary layers) and `scripts/build-gis-maps.py` (map images).",
        "Reference layers are snapshotted by `scripts/fetch-gis-reference.py`.",
        "",
        "## Official map files (`official/`, plus the ESZ file in this folder)",
        "",
        f"Register: {sources['register_page']}",
        f"{sources['register_note']}",
        f"Downloaded {sources['downloaded']}. The build stops if a file's SHA-256 changes.",
        "",
        "| Key | File | Register date | Server date | SHA-256 | Source |",
        "|---|---|---|---|---|---|",
    ]
    for key, src in sources["files"].items():
        lines.append(f"| {key} | `{src['file']}` | {src['register_date']} | {src['last_modified']} | `{src['sha256'][:16]}…` | [link]({src['source_url']}) |")
    stats = layers["stats"]
    lines += [
        "",
        "## Derived layers (`derived/`)",
        "",
        f"- `mhtr-reserve-and-esz-outer-boundary-2023.kml` / `.geojson`: reserve plus both eco-sensitive zones, one outline, {stats['outer_with_esz_km2']:.2f} km². Made for iNaturalist.",
        f"- `mhtr-reserve-outer-boundary-2023.kml` / `.geojson`: reserve only, {stats['outer_boundary_km2']:.2f} km² of 1,135.79 km² notified.",
        "- `mhtr-legal-zones-2023.kml` / `.geojson`: approximate 2013 core and buffer, 2023 additions, both ESZ bands, the park and sanctuary outlines, and context blocks.",
        "- `mhtr-boundary-areas-2023.json` / `.csv`: measured (WGS84) against notified areas.",
        "- `mhtr-land-cover-shares-2021.json`: WorldCover class shares inside the reserve and ESZ outlines.",
        "",
        "## Known gaps",
        "",
        f"- About {stats['not_mapped_notified_km2']:.0f} km² of the notified reserve has no outline of its own in any public file: 21 revenue villages added to the core in 2023 (80.45 km²; the Bhainsrorgarh sanctuary file leaves nine unnamed enclaves), "
        "the 2023 buffer parts of Bardkalan Kishor Sagar and Sakatpura (Kota) and of Karondi, Rampuriya and Dhaneshwar (Bundi), which the district files draw only as whole blocks, "
        "Akelgarh (27.84 km², listed without a part mark; 7.75 km² of the block was core in 2013 and the Kota file draws the rest at about 32 km²), Ambarani-A (Bundi, 3.54 km²) and the National Chambal buffer piece (23.85 km²).",
        "- No official file splits core from buffer. The 2013 split here is approximate and misassigns about 26 km².",
        f"- The park and sanctuary files fill {stats['unit_files_in_reserve_file_holes_km2']:.1f} km² of holes in the reserve file, counted as core "
        f"(nearly all Girdharpura, which the Tiger Conservation Plan lists as a core village), and add {stats['unit_files_outside_reserve_file_km2']:.1f} km² around Borabas that only the Jawahar Sagar file draws.",
        "- A 6.2 km² area around Daulatpura is enclosed by the reserve and Bhainsrorgarh files but included in neither; the 2020 ESZ file covers 6.1 km² of it.",
        "- The reserve file still draws the 2013 reserve, although the server copy is dated 24 Feb 2025.",
        "- The 2020 ESZ is stated as 0–1 km but reaches about 5.4 km beyond the reserve file near Rawatbhata (5.7 km beyond the Gazette's own Table A reserve coordinates). There its outer limit is the edge of the Bhainsrorgarh sanctuary file, on a stretch Annexure-I gives zero width 'due to Bhainsroadgarh Sanctuary on the other side'. It was drawn around the 2013 reserve.",
        "- The MHTR ESZ file leaves a 3.53 km² hole around Jawara (Jaora) Khurd, which the Gazette's map also draws, but the Gazette's village list (Annexure-IV, S.No. 52) names Jawara Khurd as an ESZ village.",
        f"- The ESZ bands cover parts of the forest blocks partly added to the buffer in 2023 ({esz_in_blocks}). "
        "No public file shows where the added parts lie, so how much land is both ESZ and buffer is unknown.",
        "- The Bhainsrorgarh sanctuary area is 201.4 km² in the file attribute and 275.45 km² in the 2021 ESZ notification.",
        "",
        "## Reference layers (`reference/`)",
        "",
        f"- Overture Maps release {layers['release']}: rivers and water bodies, roads and rail, places, districts, and OSM protected-area outlines. © OpenStreetMap contributors, ODbL 1.0.",
        "- ESA WorldCover 2021 v200 public AWS COG: land-cover classes. CC BY 4.0. © ESA WorldCover project / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium.",
        "- Mapzen Terrain Tiles on AWS (Terrarium; built from SRTM, GMTED2010, ETOPO1 and other sources): shaded relief and elevation bands (median-filtered for tile artefacts). Attribution: https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
        "",
        "## Map images",
        "",
    ]
    lines += [f"- `{p.relative_to(ROOT)}`" for p in paths]
    lines += [
        "",
        "Editorial rule: the maps avoid exact wildlife observation, nest, den, roost, carcass or breeding-site locations.",
        f"Boundary note: {NOT_LEGAL} The Forest Department marks its files as for management use, not legal purposes.",
    ]
    (DATA_DIR / "README.md").write_text("\n".join(lines) + "\n")


def main() -> None:
    ensure_dirs()
    layers = load_layers()
    paths = [
        render_legal_zones(layers),
        render_data_gaps(layers),
        render_esz(layers),
        render_boundary_context(layers),
        render_terrain(layers),
        render_water(layers),
        render_elevation(layers),
        render_landcover(layers),
    ]
    write_source_notes(paths, layers)


if __name__ == "__main__":
    main()
