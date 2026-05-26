#!/usr/bin/env python3
"""Build public-facing GIS map images for Mukundara Hills Tiger Reserve.

The script intentionally uses public, non-sensitive layers:
- OpenStreetMap vectors for boundaries, water, roads and settlements.
- ESA WorldCover WMS for 2021 land-cover context.
- Mapzen/AWS Terrarium elevation tiles for relief and elevation rendering.
- geoBoundaries for district context.
"""

from __future__ import annotations

import io
import json
import hashlib
import math
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "Data" / "source-materials" / "gis"
CACHE_DIR = DATA_DIR / "cache"
OUT_DIR = ROOT / "src" / "assets" / "assets" / "imgs" / "maps"
USER_AGENT = "mhtr.in GIS map builder; contact hello@caneandcamera.com"

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
TERRARIUM_URL = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"
WORLDCOVER_WMS = "https://services.terrascope.be/wms/v2"

FONT_REGULAR = "/System/Library/Fonts/Supplemental/Arial.ttf"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

CANVAS_W = 2400
CANVAS_H = 1600
MAP_RECT = (80, 210, 1750, 1280)
PANEL_RECT = (1865, 210, 455, 1280)

MHTR_RELATION_ID = 9477458
MHTR_NP_RELATION_ID = 9477404
BHAINSRODGARH_WAY_ID = 666625141

IMPORTANT_DISTRICTS = {"Kota", "Bundi", "Jhalawar", "Chittaurgarh"}


def ensure_dirs() -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    path = FONT_BOLD if bold else FONT_REGULAR
    return ImageFont.truetype(path, size=size)


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


def request_bytes(url: str, retries: int = 3, timeout: int = 60) -> bytes:
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


def cached_bytes(name: str, url: str, retries: int = 3, timeout: int = 60) -> bytes:
    path = CACHE_DIR / name
    if path.exists() and path.stat().st_size > 0:
        return path.read_bytes()
    data = request_bytes(url, retries=retries, timeout=timeout)
    path.write_bytes(data)
    return data


def cached_json(name: str, url: str, retries: int = 3, timeout: int = 60) -> dict:
    path = CACHE_DIR / name
    if path.exists() and path.stat().st_size > 0:
        return json.loads(path.read_text())
    data = request_bytes(url, retries=retries, timeout=timeout)
    text = data.decode("utf-8", errors="replace")
    if text.lstrip().startswith("<"):
        raise RuntimeError(f"Expected JSON for {name}, got HTML/XML: {text[:220]}")
    obj = json.loads(text)
    path.write_text(json.dumps(obj, indent=2))
    return obj


def fetch_osm_polygon(relation_id: int, name: str) -> dict:
    url = f"https://polygons.openstreetmap.fr/get_geojson.py?id={relation_id}&params=0"
    geom = cached_json(name, url, retries=4, timeout=90)
    return {"type": "Feature", "properties": {"osm_relation": relation_id}, "geometry": geom}


def overpass_query(name: str, query: str) -> dict:
    url = OVERPASS_URL + "?" + urllib.parse.urlencode({"data": query})
    return cached_json(name, url, retries=4, timeout=120)


def geo_boundaries_adm2() -> dict:
    api = "https://www.geoboundaries.org/api/current/gbOpen/IND/ADM2/"
    meta = cached_json("geoboundaries-ind-adm2-meta.json", api)
    data = cached_json("geoboundaries-ind-adm2-simplified.geojson", meta["simplifiedGeometryGeoJSON"])
    return data


def mercator(lon: float, lat: float) -> tuple[float, float]:
    lat = max(min(lat, 85.05112878), -85.05112878)
    radius = 6378137.0
    x = radius * math.radians(lon)
    y = radius * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    return x, y


def tile_xy(lon: float, lat: float, zoom: int) -> tuple[float, float]:
    lat_rad = math.radians(lat)
    n = 2**zoom
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2.0 * n
    return x, y


def bbox_to_mercator(bbox: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    lon_min, lat_min, lon_max, lat_max = bbox
    x1, y1 = mercator(lon_min, lat_min)
    x2, y2 = mercator(lon_max, lat_max)
    return x1, y1, x2, y2


def make_transform(
    bbox: tuple[float, float, float, float],
    rect: tuple[int, int, int, int] = MAP_RECT,
) -> callable:
    lon_min, lat_min, lon_max, lat_max = bbox
    x1, y1 = mercator(lon_min, lat_min)
    x2, y2 = mercator(lon_max, lat_max)
    rx, ry, rw, rh = rect

    def transform(lon: float, lat: float) -> tuple[float, float]:
        x, y = mercator(lon, lat)
        px = rx + (x - x1) / (x2 - x1) * rw
        py = ry + (1 - (y - y1) / (y2 - y1)) * rh
        return px, py

    return transform


def iter_coords(obj):
    if isinstance(obj, (list, tuple)):
        if len(obj) >= 2 and isinstance(obj[0], (int, float)) and isinstance(obj[1], (int, float)):
            yield (float(obj[0]), float(obj[1]))
        else:
            for item in obj:
                yield from iter_coords(item)


def geometry_bounds(geometry: dict) -> tuple[float, float, float, float]:
    coords = list(iter_coords(geometry.get("coordinates", [])))
    lon_values = [coord[0] for coord in coords]
    lat_values = [coord[1] for coord in coords]
    return min(lon_values), min(lat_values), max(lon_values), max(lat_values)


def combined_bounds(features: list[dict]) -> tuple[float, float, float, float]:
    bounds = [geometry_bounds(feature["geometry"]) for feature in features]
    return (
        min(item[0] for item in bounds),
        min(item[1] for item in bounds),
        max(item[2] for item in bounds),
        max(item[3] for item in bounds),
    )


def expand_bbox(
    bbox: tuple[float, float, float, float],
    lon_pad: float,
    lat_pad: float,
) -> tuple[float, float, float, float]:
    lon_min, lat_min, lon_max, lat_max = bbox
    return lon_min - lon_pad, lat_min - lat_pad, lon_max + lon_pad, lat_max + lat_pad


def iter_polygon_rings(geometry: dict):
    gtype = geometry.get("type")
    coords = geometry.get("coordinates", [])
    if gtype == "Polygon":
        for ring in coords:
            yield ring
    elif gtype == "MultiPolygon":
        for polygon in coords:
            for ring in polygon:
                yield ring


def iter_line_coords(geometry: dict):
    gtype = geometry.get("type")
    coords = geometry.get("coordinates", [])
    if gtype == "LineString":
        yield coords
    elif gtype == "MultiLineString":
        for line in coords:
            yield line


def polygon_centroid(geometry: dict) -> tuple[float, float] | None:
    coords = list(iter_coords(geometry.get("coordinates", [])))
    if not coords:
        return None
    return sum(c[0] for c in coords) / len(coords), sum(c[1] for c in coords) / len(coords)


def draw_text_halo(
    draw: ImageDraw.ImageDraw,
    xy: tuple[float, float],
    text: str,
    fnt: ImageFont.FreeTypeFont,
    fill=(32, 40, 34),
    halo=(255, 255, 246),
    anchor: str = "mm",
    stroke: int = 4,
) -> None:
    draw.text(xy, text, font=fnt, fill=fill, anchor=anchor, stroke_width=stroke, stroke_fill=halo)


def draw_wrapped(
    draw: ImageDraw.ImageDraw,
    text: str,
    xy: tuple[int, int],
    width: int,
    fnt: ImageFont.FreeTypeFont,
    fill=(55, 63, 59),
    line_spacing: int = 8,
) -> int:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
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


def draw_panel_base(draw: ImageDraw.ImageDraw, title: str, subtitle: str) -> None:
    draw.text((80, 60), title, font=FONTS["title"], fill=(24, 42, 35))
    draw.text((82, 124), subtitle, font=FONTS["subtitle"], fill=(78, 88, 82))
    px, py, pw, ph = PANEL_RECT
    draw.rounded_rectangle((px, py, px + pw, py + ph), radius=8, fill=(247, 247, 238), outline=(206, 210, 196))


def draw_map_frame(draw: ImageDraw.ImageDraw) -> None:
    x, y, w, h = MAP_RECT
    draw.rectangle((x, y, x + w, y + h), outline=(84, 93, 83), width=2)


def draw_map_furniture(draw: ImageDraw.ImageDraw, bbox: tuple[float, float, float, float]) -> None:
    draw_map_frame(draw)
    draw_north_arrow(draw)
    draw_scale_bar(draw, bbox)


def with_map_clip(img: Image.Image, callback) -> None:
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay, "RGBA")
    callback(odraw, overlay)
    x, y, w, h = MAP_RECT
    clipped = Image.new("RGBA", img.size, (0, 0, 0, 0))
    clipped.paste(overlay.crop((x, y, x + w, y + h)), (x, y))
    img.alpha_composite(clipped)


def draw_graticule(
    draw: ImageDraw.ImageDraw,
    bbox: tuple[float, float, float, float],
    transform: callable,
    step: float = 0.25,
) -> None:
    lon_min, lat_min, lon_max, lat_max = bbox
    lon = math.ceil(lon_min / step) * step
    while lon <= lon_max:
        pts = [transform(lon, lat_min + (lat_max - lat_min) * i / 60) for i in range(61)]
        draw.line(pts, fill=(210, 215, 207), width=1)
        tx, ty = transform(lon, lat_min)
        draw.text((tx + 5, MAP_RECT[1] + MAP_RECT[3] - 22), f"{lon:.2f}E", font=FONTS["tiny"], fill=(94, 102, 97))
        lon += step
    lat = math.ceil(lat_min / step) * step
    while lat <= lat_max:
        pts = [transform(lon_min + (lon_max - lon_min) * i / 60, lat) for i in range(61)]
        draw.line(pts, fill=(210, 215, 207), width=1)
        tx, ty = transform(lon_min, lat)
        draw.text((MAP_RECT[0] + 6, ty - 18), f"{lat:.2f}N", font=FONTS["tiny"], fill=(94, 102, 97))
        lat += step


def draw_north_arrow(draw: ImageDraw.ImageDraw) -> None:
    x = MAP_RECT[0] + MAP_RECT[2] - 70
    y = MAP_RECT[1] + 82
    draw.polygon([(x, y - 48), (x - 18, y + 16), (x, y + 5), (x + 18, y + 16)], fill=(35, 48, 40))
    draw.text((x, y + 28), "N", font=FONTS["label_small"], fill=(35, 48, 40), anchor="mm")


def haversine_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    radius = 6371.0088
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * radius * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def draw_scale_bar(draw: ImageDraw.ImageDraw, bbox: tuple[float, float, float, float]) -> None:
    lon_min, lat_min, lon_max, lat_max = bbox
    mid_lat = (lat_min + lat_max) / 2
    width_km = haversine_km(lon_min, mid_lat, lon_max, mid_lat)
    km_per_px = width_km / MAP_RECT[2]
    candidates = [5, 10, 20, 25, 50, 75, 100]
    length_km = max(k for k in candidates if k / km_per_px < MAP_RECT[2] * 0.28)
    px_len = length_km / km_per_px
    x0 = MAP_RECT[0] + 56
    y0 = MAP_RECT[1] + MAP_RECT[3] - 62
    draw.line((x0, y0, x0 + px_len, y0), fill=(28, 38, 31), width=6)
    draw.line((x0, y0 - 12, x0, y0 + 12), fill=(28, 38, 31), width=3)
    draw.line((x0 + px_len, y0 - 12, x0 + px_len, y0 + 12), fill=(28, 38, 31), width=3)
    draw.text((x0, y0 + 20), "0", font=FONTS["tiny"], fill=(28, 38, 31), anchor="mt")
    draw.text((x0 + px_len, y0 + 20), f"{length_km} km", font=FONTS["tiny"], fill=(28, 38, 31), anchor="mt")


def draw_dashed_line(draw: ImageDraw.ImageDraw, pts: list[tuple[float, float]], fill, width: int, dash: int = 18, gap: int = 10) -> None:
    for p0, p1 in zip(pts, pts[1:]):
        x0, y0 = p0
        x1, y1 = p1
        dist = math.hypot(x1 - x0, y1 - y0)
        if dist == 0:
            continue
        dx = (x1 - x0) / dist
        dy = (y1 - y0) / dist
        pos = 0.0
        while pos < dist:
            end = min(pos + dash, dist)
            draw.line((x0 + dx * pos, y0 + dy * pos, x0 + dx * end, y0 + dy * end), fill=fill, width=width)
            pos += dash + gap


def draw_feature_polygons(
    base: Image.Image,
    features: list[dict],
    transform: callable,
    fill,
    outline,
    width: int = 3,
    dashed: bool = False,
) -> None:
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)
    for feature in features:
        geom = feature.get("geometry", feature)
        for ring in iter_polygon_rings(geom):
            pts = [transform(lon, lat) for lon, lat in ring]
            if len(pts) < 3:
                continue
            if fill is not None:
                odraw.polygon(pts, fill=fill)
            if dashed:
                draw_dashed_line(odraw, pts, fill=outline, width=width)
            else:
                odraw.line(pts + [pts[0]], fill=outline, width=width, joint="curve")
    base.alpha_composite(overlay)


def overpass_way_lines(osm: dict, tag_key: str | None = None) -> list[dict]:
    features: list[dict] = []
    for element in osm.get("elements", []):
        tags = element.get("tags", {})
        if element.get("type") != "way" or "geometry" not in element:
            continue
        if tag_key and tag_key not in tags:
            continue
        coords = [(pt["lon"], pt["lat"]) for pt in element["geometry"]]
        if len(coords) >= 2:
            features.append({"type": "Feature", "properties": tags, "geometry": {"type": "LineString", "coordinates": coords}})
    return features


def overpass_way_polygons(osm: dict, predicate) -> list[dict]:
    features: list[dict] = []
    for element in osm.get("elements", []):
        tags = element.get("tags", {})
        if element.get("type") != "way" or "geometry" not in element:
            continue
        if not predicate(tags):
            continue
        coords = [(pt["lon"], pt["lat"]) for pt in element["geometry"]]
        if len(coords) >= 4:
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            props = dict(tags)
            props["@id"] = element.get("id")
            features.append({"type": "Feature", "properties": props, "geometry": {"type": "Polygon", "coordinates": [coords]}})
    return features


def overpass_way_polygon_by_id(osm: dict, way_id: int) -> dict:
    matches = overpass_way_polygons(osm, lambda _tags: True)
    for feature in matches:
        # The individual query below returns only the requested way; keep this guard
        # for clarity if the cache is manually replaced later.
        if feature.get("properties", {}).get("@id") == way_id:
            return feature
    if matches:
        return matches[0]
    raise RuntimeError(f"Could not build polygon for OSM way {way_id}")


def relation_member_lines(osm: dict, predicate=None) -> list[dict]:
    features: list[dict] = []
    for element in osm.get("elements", []):
        tags = element.get("tags", {})
        if predicate and not predicate(tags):
            continue
        if element.get("type") == "relation":
            for member in element.get("members", []):
                if "geometry" not in member:
                    continue
                coords = [(pt["lon"], pt["lat"]) for pt in member["geometry"]]
                if len(coords) >= 2:
                    features.append({"type": "Feature", "properties": tags, "geometry": {"type": "LineString", "coordinates": coords}})
    return features


def draw_lines(
    draw: ImageDraw.ImageDraw,
    features: list[dict],
    transform: callable,
    fill,
    width: int = 2,
    dashed: bool = False,
) -> None:
    for feature in features:
        geom = feature.get("geometry", feature)
        for line in iter_line_coords(geom):
            pts = [transform(lon, lat) for lon, lat in line]
            if len(pts) >= 2:
                if dashed:
                    draw_dashed_line(draw, pts, fill=fill, width=width, dash=12, gap=7)
                else:
                    draw.line(pts, fill=fill, width=width, joint="curve")


def draw_osm_water(draw: ImageDraw.ImageDraw, water_osm: dict, transform: callable, labels: bool = True) -> None:
    water_polygons = overpass_way_polygons(
        water_osm,
        lambda tags: tags.get("natural") == "water" or tags.get("water") in {"reservoir", "lake", "pond"} or tags.get("landuse") == "reservoir",
    )
    water_lines = overpass_way_lines(water_osm, "waterway") + relation_member_lines(water_osm, lambda t: "waterway" in t)
    draw_feature_polygons_rgba(draw, water_polygons, transform, fill=(72, 143, 181, 168), outline=(31, 101, 146, 230), width=2)
    draw_lines(draw, water_lines, transform, fill=(35, 111, 163, 215), width=3)

    if not labels:
        return
    seen: set[str] = set()
    important = ("Chambal", "Kali", "Kalisindh", "Ahu", "Parwan", "Barrage", "Sagar", "Dam")
    for feature in water_lines + water_polygons:
        name = feature["properties"].get("name")
        if not name or name in seen or not any(token.lower() in name.lower() for token in important):
            continue
        coord = label_position(feature["geometry"])
        if coord:
            seen.add(name)
            draw_text_halo(draw, transform(*coord), name, FONTS["label_small"], fill=(17, 84, 126), halo=(246, 251, 249), stroke=3)


def draw_feature_polygons_rgba(
    draw: ImageDraw.ImageDraw,
    features: list[dict],
    transform: callable,
    fill,
    outline,
    width: int = 2,
) -> None:
    # ImageDraw attached to an RGBA image already supports translucent fills.
    for feature in features:
        geom = feature.get("geometry", feature)
        for ring in iter_polygon_rings(geom):
            pts = [transform(lon, lat) for lon, lat in ring]
            if len(pts) >= 3:
                draw.polygon(pts, fill=fill)
                draw.line(pts + [pts[0]], fill=outline, width=width, joint="curve")


def label_position(geometry: dict) -> tuple[float, float] | None:
    if geometry["type"] == "LineString":
        coords = geometry["coordinates"]
        if not coords:
            return None
        return coords[len(coords) // 2]
    return polygon_centroid(geometry)


def geometry_length_score(geometry: dict) -> float:
    score = 0.0
    for line in iter_line_coords(geometry):
        for (lon0, lat0), (lon1, lat1) in zip(line, line[1:]):
            score += abs(lon1 - lon0) + abs(lat1 - lat0)
    if not score:
        coords = list(iter_coords(geometry.get("coordinates", [])))
        if coords:
            lon_values = [coord[0] for coord in coords]
            lat_values = [coord[1] for coord in coords]
            score = (max(lon_values) - min(lon_values)) + (max(lat_values) - min(lat_values))
    return score


def draw_named_water_labels(
    draw: ImageDraw.ImageDraw,
    water_osm: dict,
    transform: callable,
    names: list[str],
    manual_positions: dict[str, tuple[float, float]] | None = None,
) -> None:
    water_polygons = overpass_way_polygons(
        water_osm,
        lambda tags: tags.get("natural") == "water" or tags.get("water") in {"reservoir", "lake", "pond", "river"} or tags.get("landuse") == "reservoir",
    )
    water_lines = overpass_way_lines(water_osm, "waterway") + relation_member_lines(water_osm, lambda t: "waterway" in t)
    features_by_name: dict[str, list[dict]] = {}
    for feature in water_lines + water_polygons:
        name = feature.get("properties", {}).get("name")
        if name:
            features_by_name.setdefault(name.lower(), []).append(feature)

    manual_positions = manual_positions or {}
    occupied: list[tuple[float, float, float, float]] = []
    for name in names:
        coord = manual_positions.get(name)
        candidates = features_by_name.get(name.lower(), [])
        if coord is None and candidates:
            candidates.sort(key=lambda feature: geometry_length_score(feature["geometry"]), reverse=True)
            coord = label_position(candidates[0]["geometry"])
        if coord is None:
            continue

        x, y = transform(*coord)
        if not (MAP_RECT[0] + 18 <= x <= MAP_RECT[0] + MAP_RECT[2] - 18 and MAP_RECT[1] + 18 <= y <= MAP_RECT[1] + MAP_RECT[3] - 18):
            continue

        fnt = FONTS["label"] if name in {"Chambal River", "Rana Pratap Sagar"} else FONTS["label_small"]
        bbox = draw.textbbox((x, y), name, font=fnt, anchor="mm", stroke_width=4)
        if any(boxes_overlap(bbox, prior) for prior in occupied):
            y += 30
            bbox = draw.textbbox((x, y), name, font=fnt, anchor="mm", stroke_width=4)
        occupied.append(bbox)
        draw.ellipse((x - 6, y - 6, x + 6, y + 6), fill=(12, 86, 130), outline=(250, 250, 241), width=3)
        draw_text_halo(draw, (x, y - 18), name, fnt, fill=(12, 86, 130), halo=(248, 252, 249), stroke=4)


def draw_roads_and_rail(draw: ImageDraw.ImageDraw, transport_osm: dict, transform: callable) -> None:
    road_features = overpass_way_lines(transport_osm)
    for feature in road_features:
        tags = feature["properties"]
        highway = tags.get("highway")
        railway = tags.get("railway")
        if railway == "rail":
            draw_lines(draw, [feature], transform, fill=(83, 72, 79, 215), width=3, dashed=True)
        elif highway in {"motorway", "trunk", "primary"}:
            draw_lines(draw, [feature], transform, fill=(181, 92, 68, 210), width=5)
        elif highway in {"secondary", "tertiary"}:
            draw_lines(draw, [feature], transform, fill=(205, 140, 93, 185), width=3)


def draw_places(draw: ImageDraw.ImageDraw, places_osm: dict, transform: callable, max_labels: int = 24) -> None:
    priority = {"city": 0, "town": 1, "village": 2}
    places = []
    for element in places_osm.get("elements", []):
        tags = element.get("tags", {})
        if element.get("type") != "node" or "name" not in tags:
            continue
        if "lon" not in element or "lat" not in element:
            continue
        place = tags.get("place", "")
        if place not in priority:
            continue
        places.append((priority[place], tags["name"], place, element["lon"], element["lat"]))
    places.sort(key=lambda row: (row[0], row[1]))
    occupied: list[tuple[float, float, float, float]] = []
    count = 0
    for _, name, place, lon, lat in places:
        x, y = transform(lon, lat)
        if not (MAP_RECT[0] <= x <= MAP_RECT[0] + MAP_RECT[2] and MAP_RECT[1] <= y <= MAP_RECT[1] + MAP_RECT[3]):
            continue
        fnt = FONTS["label_small"] if place in {"city", "town"} else FONTS["tiny"]
        bbox = ImageDraw.Draw(Image.new("RGB", (1, 1))).textbbox((x + 9, y - 2), name, font=fnt, anchor="lm")
        if any(boxes_overlap(bbox, prior) for prior in occupied):
            continue
        occupied.append(bbox)
        draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill=(43, 55, 48), outline=(255, 255, 246), width=2)
        draw_text_halo(draw, (x + 10, y), name, fnt, fill=(46, 53, 50), halo=(250, 250, 241), anchor="lm", stroke=3)
        count += 1
        if count >= max_labels:
            break


def boxes_overlap(a, b) -> bool:
    return not (a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1])


def terrain_array(bbox: tuple[float, float, float, float], zoom: int = 12) -> np.ndarray:
    lon_min, lat_min, lon_max, lat_max = bbox
    x0, y1 = tile_xy(lon_min, lat_min, zoom)
    x1, y0 = tile_xy(lon_max, lat_max, zoom)
    tx0, tx1 = math.floor(min(x0, x1)), math.floor(max(x0, x1))
    ty0, ty1 = math.floor(min(y0, y1)), math.floor(max(y0, y1))

    width_tiles = tx1 - tx0 + 1
    height_tiles = ty1 - ty0 + 1
    mosaic = Image.new("RGB", (width_tiles * 256, height_tiles * 256))

    tile_jobs = [(tx, ty) for tx in range(tx0, tx1 + 1) for ty in range(ty0, ty1 + 1)]

    def load_tile(job: tuple[int, int]) -> tuple[int, int, Image.Image]:
        tx, ty = job
        tile_name = f"terrarium-z{zoom}-{tx}-{ty}.png"
        url = TERRARIUM_URL.format(z=zoom, x=tx, y=ty)
        data = cached_bytes(tile_name, url, retries=4, timeout=30)
        return tx, ty, Image.open(io.BytesIO(data)).convert("RGB")

    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(load_tile, job) for job in tile_jobs]
        for future in as_completed(futures):
            tx, ty, tile = future.result()
            mosaic.paste(tile, ((tx - tx0) * 256, (ty - ty0) * 256))

    left = int((min(x0, x1) - tx0) * 256)
    right = int((max(x0, x1) - tx0) * 256)
    top = int((min(y0, y1) - ty0) * 256)
    bottom = int((max(y0, y1) - ty0) * 256)
    crop = mosaic.crop((left, top, right, bottom))
    arr = np.asarray(crop).astype(np.float32)
    elevation = (arr[:, :, 0] * 256 + arr[:, :, 1] + arr[:, :, 2] / 256) - 32768
    return elevation


def hillshade(elevation: np.ndarray, bbox: tuple[float, float, float, float], azimuth: float = 315, altitude: float = 45) -> np.ndarray:
    lon_min, lat_min, lon_max, lat_max = bbox
    mid_lat = (lat_min + lat_max) / 2
    x_res = haversine_km(lon_min, mid_lat, lon_max, mid_lat) * 1000 / elevation.shape[1]
    y_res = haversine_km((lon_min + lon_max) / 2, lat_min, (lon_min + lon_max) / 2, lat_max) * 1000 / elevation.shape[0]
    gy, gx = np.gradient(elevation, y_res, x_res)
    slope = np.pi / 2 - np.arctan(np.sqrt(gx * gx + gy * gy))
    aspect = np.arctan2(-gx, gy)
    az = math.radians(360 - azimuth + 90)
    alt = math.radians(altitude)
    shaded = np.sin(alt) * np.sin(slope) + np.cos(alt) * np.cos(slope) * np.cos(az - aspect)
    shaded = (shaded - shaded.min()) / max(float(shaded.max() - shaded.min()), 1e-6)
    return shaded


def colorize_elevation(elevation: np.ndarray, shaded: np.ndarray, mode: str = "terrain") -> Image.Image:
    valid = valid_elevation_values(elevation)
    vmin = float(np.nanpercentile(valid, 2))
    vmax = float(np.nanpercentile(valid, 98))
    stops = [
        (vmin, (58, 102, 80)),
        (220, (111, 139, 84)),
        (300, (188, 165, 98)),
        (380, (178, 122, 88)),
        (470, (137, 91, 86)),
        (vmax, (232, 224, 205)),
    ]
    if mode == "elevation":
        stops = [
            (vmin, (40, 92, 112)),
            (220, (78, 130, 94)),
            (300, (157, 158, 93)),
            (380, (202, 151, 87)),
            (470, (172, 104, 82)),
            (520, (205, 158, 119)),
            (vmax, (237, 222, 196)),
        ]
    norm = np.clip(elevation, stops[0][0], stops[-1][0])
    rgb = np.zeros((*elevation.shape, 3), dtype=np.float32)
    for (lo, c0), (hi, c1) in zip(stops[:-1], stops[1:]):
        mask = (norm >= lo) & (norm <= hi)
        t = np.clip((norm - lo) / max(hi - lo, 1e-6), 0, 1)
        for i in range(3):
            rgb[:, :, i] = np.where(mask, c0[i] + (c1[i] - c0[i]) * t, rgb[:, :, i])
    shade = 0.55 + shaded[:, :, None] * 0.55
    rgb = np.clip(rgb * shade, 0, 255).astype(np.uint8)
    return Image.fromarray(rgb, "RGB")


def contour_segments(elevation: np.ndarray, levels: list[int], step: int = 5) -> dict[int, list[tuple[tuple[int, int], tuple[int, int]]]]:
    height, width = elevation.shape
    contours: dict[int, list[tuple[tuple[int, int], tuple[int, int]]]] = {level: [] for level in levels}
    for level in levels:
        segments = contours[level]
        for y in range(0, height - step, step):
            for x in range(0, width - step, step):
                vals = [
                    elevation[y, x],
                    elevation[y, x + step],
                    elevation[y + step, x + step],
                    elevation[y + step, x],
                ]
                pts = [(x, y), (x + step, y), (x + step, y + step), (x, y + step)]
                intersections = []
                for i in range(4):
                    v0, v1 = vals[i], vals[(i + 1) % 4]
                    if (v0 < level <= v1) or (v1 < level <= v0):
                        t = (level - v0) / (v1 - v0) if v1 != v0 else 0
                        p0, p1 = pts[i], pts[(i + 1) % 4]
                        intersections.append((int(p0[0] + (p1[0] - p0[0]) * t), int(p0[1] + (p1[1] - p0[1]) * t)))
                if len(intersections) == 2:
                    segments.append((intersections[0], intersections[1]))
                elif len(intersections) == 4:
                    segments.append((intersections[0], intersections[1]))
                    segments.append((intersections[2], intersections[3]))
    return contours


def dem_summary(elevation: np.ndarray) -> dict[str, int]:
    clean = valid_elevation_values(elevation)
    return {
        "min": int(round(float(np.nanmin(clean)))),
        "p05": int(round(float(np.nanpercentile(clean, 5)))),
        "p50": int(round(float(np.nanpercentile(clean, 50)))),
        "p95": int(round(float(np.nanpercentile(clean, 95)))),
        "max": int(round(float(np.nanmax(clean)))),
    }


def valid_elevation_values(elevation: np.ndarray) -> np.ndarray:
    clean = elevation[np.isfinite(elevation)]
    clean = clean[(clean >= 100) & (clean <= 900)]
    if clean.size:
        return clean
    return elevation[np.isfinite(elevation)]


def draw_elevation_point_labels(
    draw: ImageDraw.ImageDraw,
    elevation_px: np.ndarray,
    labels: list[tuple[str, str]],
) -> None:
    margin = 60
    working = elevation_px[margin:-margin, margin:-margin].copy()
    if working.size == 0:
        return
    valid = (working >= 100) & (working <= 900) & np.isfinite(working)
    if not np.any(valid):
        return
    low_target = float(np.nanpercentile(working[valid], 2))
    high_target = float(np.nanpercentile(working[valid], 98))
    for kind, label in labels:
        if kind == "high":
            target = high_target
        else:
            target = low_target
        score = np.abs(working - target)
        score[~valid] = np.inf
        flat_index = int(np.nanargmin(score))
        row, col = np.unravel_index(flat_index, working.shape)
        row += margin
        col += margin
        value = int(round(float(elevation_px[row, col])))
        x = MAP_RECT[0] + col
        y = MAP_RECT[1] + row
        right_side = x > MAP_RECT[0] + MAP_RECT[2] * 0.62
        if kind == "high":
            tx = max(x - 120, MAP_RECT[0] + 120) if right_side else min(x + 120, MAP_RECT[0] + MAP_RECT[2] - 120)
            ty = max(y - 30, MAP_RECT[1] + 45)
            fill = (86, 55, 45)
        else:
            tx = max(x - 130, MAP_RECT[0] + 120) if right_side else min(x + 130, MAP_RECT[0] + MAP_RECT[2] - 115)
            ty = min(y + 36, MAP_RECT[1] + MAP_RECT[3] - 45)
            fill = (13, 83, 105)
        line_end_x = tx + 12 if right_side else tx - 12
        anchor = "rm" if right_side else "lm"
        draw.line((x, y, line_end_x, ty), fill=(255, 251, 229, 230), width=7)
        draw.line((x, y, line_end_x, ty), fill=fill + (230,), width=3)
        draw.ellipse((x - 8, y - 8, x + 8, y + 8), fill=fill, outline=(255, 251, 229), width=3)
        draw_text_halo(draw, (tx, ty), f"{label} ~{value} m", FONTS["label_small"], fill=fill, halo=(250, 250, 241), anchor=anchor, stroke=4)


def draw_contour_labels(
    draw: ImageDraw.ImageDraw,
    contours: dict[int, list[tuple[tuple[int, int], tuple[int, int]]]],
    levels: list[int],
) -> None:
    used: list[tuple[float, float, float, float]] = []
    for level in levels:
        segments = contours.get(level, [])
        if not segments:
            continue
        for segment in segments[:: max(len(segments) // 30, 1)]:
            (x0, y0), (x1, y1) = segment
            x = MAP_RECT[0] + (x0 + x1) / 2
            y = MAP_RECT[1] + (y0 + y1) / 2
            if not (MAP_RECT[0] + 60 < x < MAP_RECT[0] + MAP_RECT[2] - 60 and MAP_RECT[1] + 60 < y < MAP_RECT[1] + MAP_RECT[3] - 60):
                continue
            bbox = draw.textbbox((x, y), f"{level} m", font=FONTS["tiny"], anchor="mm", stroke_width=3)
            if any(boxes_overlap(bbox, prior) for prior in used):
                continue
            used.append(bbox)
            draw_text_halo(draw, (x, y), f"{level} m", FONTS["tiny"], fill=(74, 50, 41), halo=(250, 250, 241), stroke=3)
            break


def fetch_worldcover_image(bbox: tuple[float, float, float, float], size: tuple[int, int]) -> Image.Image:
    x1, y1, x2, y2 = bbox_to_mercator(bbox)
    params = {
        "SERVICE": "WMS",
        "VERSION": "1.1.1",
        "REQUEST": "GetMap",
        "LAYERS": "WORLDCOVER_2021_MAP",
        "STYLES": "worldcover.txt",
        "SRS": "EPSG:3857",
        "BBOX": f"{x1},{y1},{x2},{y2}",
        "WIDTH": str(size[0]),
        "HEIGHT": str(size[1]),
        "FORMAT": "image/png",
        "TRANSPARENT": "false",
        "TIME": "2021-12-31",
    }
    key_data = json.dumps({"bbox": bbox, "size": size}, sort_keys=True).encode("utf-8")
    key = "worldcover-" + hashlib.sha1(key_data).hexdigest()[:14] + ".png"
    url = WORLDCOVER_WMS + "?" + urllib.parse.urlencode(params)
    data = cached_bytes(key, url, retries=4, timeout=90)
    if data.lstrip().startswith(b"<"):
        raise RuntimeError(data.decode("utf-8", errors="replace")[:300])
    return Image.open(io.BytesIO(data)).convert("RGB")


def clipped_adm2_features(adm2: dict) -> list[dict]:
    return [feature for feature in adm2.get("features", []) if feature.get("properties", {}).get("shapeName") in IMPORTANT_DISTRICTS]


def build_data_layers() -> dict:
    mhtr = fetch_osm_polygon(MHTR_RELATION_ID, "osm-mukundra-tiger-reserve.geojson")
    national_park = fetch_osm_polygon(MHTR_NP_RELATION_ID, "osm-mukundra-hills-national-park.geojson")
    bhains_query = f"""
[out:json][timeout:60];
way({BHAINSRODGARH_WAY_ID});
out tags geom;
"""
    bhainsrodgarh = overpass_way_polygon_by_id(
        overpass_query("osm-bhainsrodgarh-wls.json", bhains_query),
        BHAINSRODGARH_WAY_ID,
    )
    bhainsrodgarh["properties"]["tcp_status"] = "Added to MHTR core by order 4854336 dated 05.10.2023, per MHTR TCP."
    mhtr_units = [mhtr, bhainsrodgarh]
    mhtr_bbox = expand_bbox(combined_bounds(mhtr_units), 0.13, 0.12)
    water_bbox = expand_bbox(combined_bounds(mhtr_units), 0.22, 0.16)
    context_bbox = (74.65, 24.42, 76.55, 25.48)

    overpass_bbox = lambda bbox: f"({bbox[1]},{bbox[0]},{bbox[3]},{bbox[2]})"
    water_query = f"""
[out:json][timeout:60];
(
  way["waterway"~"^(river|stream|canal|drain)$"]{overpass_bbox(water_bbox)};
  relation["waterway"~"^(river|stream|canal|drain)$"]{overpass_bbox(water_bbox)};
  way["natural"="water"]{overpass_bbox(water_bbox)};
  relation["natural"="water"]{overpass_bbox(water_bbox)};
  way["water"~"^(reservoir|lake|pond)$"]{overpass_bbox(water_bbox)};
  relation["water"~"^(reservoir|lake|pond)$"]{overpass_bbox(water_bbox)};
  way["landuse"="reservoir"]{overpass_bbox(water_bbox)};
  relation["landuse"="reservoir"]{overpass_bbox(water_bbox)};
);
out tags center geom;
"""
    context_water_query = f"""
[out:json][timeout:60];
(
  way["waterway"~"^(river|stream|canal)$"]{overpass_bbox(context_bbox)};
  relation["waterway"~"^(river|stream|canal)$"]{overpass_bbox(context_bbox)};
  way["natural"="water"]{overpass_bbox(context_bbox)};
  way["water"~"^(reservoir|lake|pond)$"]{overpass_bbox(context_bbox)};
  way["landuse"="reservoir"]{overpass_bbox(context_bbox)};
);
out tags center geom;
"""
    transport_query = f"""
[out:json][timeout:60];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]{overpass_bbox(context_bbox)};
  way["railway"="rail"]{overpass_bbox(context_bbox)};
);
out tags center geom;
"""
    places_query = f"""
[out:json][timeout:60];
(
  node["place"~"^(city|town|village)$"]{overpass_bbox(context_bbox)};
);
out body;
"""
    pa_query = f"""
[out:json][timeout:60];
(
  relation["boundary"="protected_area"]{overpass_bbox(context_bbox)};
  relation["boundary"="national_park"]{overpass_bbox(context_bbox)};
  way["boundary"="protected_area"]{overpass_bbox(context_bbox)};
  way["boundary"="national_park"]{overpass_bbox(context_bbox)};
  relation["leisure"="nature_reserve"]{overpass_bbox(context_bbox)};
  way["leisure"="nature_reserve"]{overpass_bbox(context_bbox)};
);
out tags center geom;
"""

    return {
        "mhtr": mhtr,
        "bhainsrodgarh": bhainsrodgarh,
        "mhtr_units": mhtr_units,
        "national_park": national_park,
        "mhtr_bbox": mhtr_bbox,
        "water_bbox": water_bbox,
        "context_bbox": context_bbox,
        "water": overpass_query("osm-water-mhtr.json", water_query),
        "context_water": overpass_query("osm-water-context.json", context_water_query),
        "transport": overpass_query("osm-transport-context.json", transport_query),
        "places": overpass_query("osm-places-context-v2.json", places_query),
        "protected_areas": overpass_query("osm-protected-areas-context.json", pa_query),
        "adm2": clipped_adm2_features(geo_boundaries_adm2()),
    }


def draw_admin_boundaries(draw: ImageDraw.ImageDraw, features: list[dict], transform: callable) -> None:
    for feature in features:
        geom = feature.get("geometry", {})
        for ring in iter_polygon_rings(geom):
            pts = [transform(lon, lat) for lon, lat in ring]
            if len(pts) >= 3:
                draw.line(pts + [pts[0]], fill=(117, 112, 97, 120), width=2)
        center = polygon_centroid(geom)
        if center:
            draw_text_halo(draw, transform(*center), feature["properties"]["shapeName"], FONTS["label_small"], fill=(88, 84, 70), halo=(247, 247, 238), stroke=3)


def draw_pa_from_overpass(base: Image.Image, pa_osm: dict, transform: callable) -> None:
    way_polys = overpass_way_polygons(
        pa_osm,
        lambda tags: (
            tags.get("boundary") in {"protected_area", "national_park"}
            or tags.get("leisure") == "nature_reserve"
        )
        and "Mukund" not in tags.get("name", "")
        and "Bhains" not in tags.get("name", "")
        and "Bhens" not in tags.get("name", ""),
    )
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)
    draw_feature_polygons_rgba(odraw, way_polys, transform, fill=(107, 151, 102, 70), outline=(60, 112, 68, 190), width=3)
    for feature in way_polys:
        name = feature["properties"].get("name")
        center = polygon_centroid(feature["geometry"])
        if name and center and "Mukund" not in name:
            draw_text_halo(odraw, transform(*center), name.replace(" WLS", ""), FONTS["label_small"], fill=(42, 92, 54), halo=(247, 247, 238), stroke=3)
    base.alpha_composite(overlay)


def finalize_map(img: Image.Image, path: Path) -> None:
    img = img.convert("RGB")
    img.save(path, quality=94, optimize=True)
    print(path)


def add_standard_map_extras(draw: ImageDraw.ImageDraw, bbox: tuple[float, float, float, float], transform: callable) -> None:
    draw_graticule(draw, bbox, transform)
    draw_map_furniture(draw, bbox)


def panel_heading(draw: ImageDraw.ImageDraw, y: int, title: str) -> int:
    px = PANEL_RECT[0] + 30
    draw.text((px, y), title, font=FONTS["h2"], fill=(34, 50, 41))
    return y + 48


def legend_item(draw: ImageDraw.ImageDraw, y: int, color, title: str, note: str | None = None, line: bool = False) -> int:
    x = PANEL_RECT[0] + 32
    if line:
        draw.line((x, y + 12, x + 42, y + 12), fill=color, width=6)
    else:
        draw.rounded_rectangle((x, y, x + 34, y + 24), radius=3, fill=color, outline=(110, 117, 107))
    draw.text((x + 54, y - 2), title, font=FONTS["body"], fill=(46, 57, 50))
    y += 32
    if note:
        y = draw_wrapped(draw, note, (x + 54, y - 3), PANEL_RECT[2] - 105, FONTS["small"], fill=(83, 91, 86), line_spacing=5)
        y += 12
    return y + 8


def footer_note(draw: ImageDraw.ImageDraw, text: str) -> None:
    draw_wrapped(draw, text, (80, CANVAS_H - 76), CANVAS_W - 160, FONTS["small"], fill=(84, 91, 86), line_spacing=4)


def draw_mhtr_unit_labels(draw: ImageDraw.ImageDraw, layers: dict, transform: callable) -> None:
    center = polygon_centroid(layers["mhtr"]["geometry"])
    if center:
        draw_text_halo(draw, transform(*center), "Mukundra Tiger Reserve", FONTS["label"], fill=(16, 82, 48), halo=(250, 250, 241), stroke=5)
    bhains_center = polygon_centroid(layers["bhainsrodgarh"]["geometry"])
    if bhains_center:
        x, y = transform(*bhains_center)
        draw_text_halo(draw, (x, y - 12), "Bhainsrodgarh WLS", FONTS["label_small"], fill=(16, 82, 48), halo=(250, 250, 241), stroke=4)
        draw_text_halo(draw, (x, y + 12), "MHTR core addition", FONTS["tiny"], fill=(16, 82, 48), halo=(250, 250, 241), stroke=3)


def render_boundary_context(layers: dict) -> Path:
    print("Rendering boundary/context map...", flush=True)
    bbox = layers["context_bbox"]
    transform = make_transform(bbox)
    img = Image.new("RGBA", (CANVAS_W, CANVAS_H), (238, 238, 225, 255))
    draw = ImageDraw.Draw(img, "RGBA")
    draw_panel_base(draw, "MHTR Boundary And Landscape Context", "Mukundara Hills Tiger Reserve in the Kota-Bundi-Chittaurgarh-Jhalawar landscape")
    draw.rectangle((MAP_RECT[0], MAP_RECT[1], MAP_RECT[0] + MAP_RECT[2], MAP_RECT[1] + MAP_RECT[3]), fill=(247, 247, 238))
    draw_graticule(draw, bbox, transform)

    def geos(odraw, oimg):
        draw_admin_boundaries(odraw, layers["adm2"], transform)
        draw_osm_water(odraw, layers["context_water"], transform)
        draw_roads_and_rail(odraw, layers["transport"], transform)
        draw_pa_from_overpass(oimg, layers["protected_areas"], transform)
        draw_feature_polygons(oimg, layers["mhtr_units"], transform, fill=(36, 107, 63, 94), outline=(18, 86, 49, 255), width=6)
        draw_feature_polygons(oimg, [layers["national_park"]], transform, fill=None, outline=(247, 247, 238, 255), width=4, dashed=True)
        draw_places(odraw, layers["places"], transform, max_labels=20)
        draw_mhtr_unit_labels(odraw, layers, transform)

    with_map_clip(img, geos)
    draw_map_furniture(draw, bbox)

    y = PANEL_RECT[1] + 34
    y = panel_heading(draw, y, "Map Layers")
    y = legend_item(draw, y, (36, 107, 63, 120), "MHTR core / public boundary", "Includes Bhainsrodgarh WLS as a 05 Oct 2023 core addition per the MHTR TCP; broad public orientation, not a legal survey.")
    y = legend_item(draw, y, (107, 151, 102, 90), "Other protected areas", "Nearby sanctuary and national-park context from OSM.")
    y = legend_item(draw, y, (35, 111, 163, 220), "Rivers and reservoirs", "Chambal-linked river and reservoir network from OSM.", line=True)
    y = legend_item(draw, y, (181, 92, 68, 230), "Major roads", "Trunk, primary, secondary and tertiary road context.", line=True)
    y = legend_item(draw, y, (83, 72, 79, 230), "Railway", "Rail corridors shown as dashed lines.", line=True)
    y = panel_heading(draw, y + 22, "Reading The Map")
    draw_wrapped(draw, "This map is for education and landscape planning context. It deliberately avoids exact wildlife-use sites, nests, dens, roosts and sensitive observation points.", (PANEL_RECT[0] + 32, y), PANEL_RECT[2] - 64, FONTS["body"])
    footer_note(draw, "Sources: MHTR Tiger Conservation Plan for Bhainsrodgarh core-addition status; OpenStreetMap contributors (ODbL), geoBoundaries ADM2 (ODbL). Public education map, not an official boundary demarcation.")
    path = OUT_DIR / "mhtr-boundary-context-map.png"
    finalize_map(img, path)
    return path


def render_terrain(layers: dict) -> Path:
    print("Rendering terrain relief map...", flush=True)
    bbox = layers["mhtr_bbox"]
    transform = make_transform(bbox)
    img = Image.new("RGBA", (CANVAS_W, CANVAS_H), (238, 238, 225, 255))
    draw = ImageDraw.Draw(img, "RGBA")
    draw_panel_base(draw, "MHTR Terrain And Ridge-Relief Map", "Shaded terrain view of Mukundara's ridge-to-valley geography")
    elevation = terrain_array(bbox, zoom=12)
    stats = dem_summary(elevation)
    shaded = hillshade(elevation, bbox)
    terrain = colorize_elevation(elevation, shaded, mode="terrain").resize((MAP_RECT[2], MAP_RECT[3]), Image.Resampling.LANCZOS)
    img.paste(terrain, (MAP_RECT[0], MAP_RECT[1]))
    resized_elev = np.array(Image.fromarray(elevation.astype(np.float32), mode="F").resize((MAP_RECT[2], MAP_RECT[3]), Image.Resampling.BILINEAR))
    draw_graticule(draw, bbox, transform)

    def geos(odraw, oimg):
        draw_osm_water(odraw, layers["water"], transform)
        draw_feature_polygons(oimg, layers["mhtr_units"], transform, fill=(0, 0, 0, 0), outline=(255, 251, 229, 255), width=8)
        draw_feature_polygons(oimg, layers["mhtr_units"], transform, fill=(0, 0, 0, 0), outline=(24, 73, 48, 255), width=4)
        draw_mhtr_unit_labels(odraw, layers, transform)

    with_map_clip(img, geos)
    draw_elevation_point_labels(draw, resized_elev, [("high", "High ridge"), ("low", "Valley floor")])
    draw_map_furniture(draw, bbox)

    y = PANEL_RECT[1] + 34
    y = panel_heading(draw, y, "Terrain Reading")
    y = draw_wrapped(draw, "The long ridge and valley pattern is visible as alternating raised bands and drainage floors. These broad forms shape access, water retention, visibility and habitat edges.", (PANEL_RECT[0] + 32, y), PANEL_RECT[2] - 64, FONTS["body"])
    y = panel_heading(draw, y + 28, "Elevation Tint")
    y = draw_wrapped(draw, f"DEM range in this map window: about {stats['min']} m to {stats['max']} m above mean sea level. White/tan ridges are higher; green valley floors are lower.", (PANEL_RECT[0] + 32, y), PANEL_RECT[2] - 64, FONTS["small"], line_spacing=5)
    y += 14
    for color, title in [
        ((58, 102, 80), "< 220 m: lower valleys"),
        ((111, 139, 84), "220-300 m: low hills"),
        ((188, 165, 98), "300-380 m: plateau slopes"),
        ((178, 122, 88), "380-470 m: higher ridges"),
        ((232, 224, 205), "> 470 m: highest local relief"),
    ]:
        y = legend_item(draw, y, color, title)
    y = panel_heading(draw, y + 12, "Overlay")
    y = legend_item(draw, y, (24, 73, 48, 255), "MHTR core boundary", "Includes Bhainsrodgarh WLS addition per TCP.", line=True)
    y = legend_item(draw, y, (35, 111, 163, 220), "Waterways", line=True)
    footer_note(draw, "Sources: MHTR Tiger Conservation Plan for Bhainsrodgarh status; Mapzen/AWS Terrarium elevation tiles; OpenStreetMap contributors (ODbL). Built for MHTR.in.")
    path = OUT_DIR / "mhtr-terrain-relief-map.png"
    finalize_map(img, path)
    return path


def render_water(layers: dict) -> Path:
    print("Rendering water systems map...", flush=True)
    bbox = layers["water_bbox"]
    transform = make_transform(bbox)
    img = Image.new("RGBA", (CANVAS_W, CANVAS_H), (238, 238, 225, 255))
    draw = ImageDraw.Draw(img, "RGBA")
    draw_panel_base(draw, "MHTR Water Systems Map", "Chambal-linked river, reservoir and drainage context around Mukundara")
    elevation = terrain_array(bbox, zoom=11)
    shaded = hillshade(elevation, bbox, azimuth=300, altitude=38)
    gray = np.clip(222 - shaded * 58, 150, 232).astype(np.uint8)
    relief = Image.fromarray(np.dstack([gray, gray, (gray * 0.94).astype(np.uint8)]), "RGB").resize((MAP_RECT[2], MAP_RECT[3]), Image.Resampling.LANCZOS)
    img.paste(relief, (MAP_RECT[0], MAP_RECT[1]))
    draw_graticule(draw, bbox, transform)

    def geos(odraw, oimg):
        draw_roads_and_rail(odraw, layers["transport"], transform)
        draw_osm_water(odraw, layers["water"], transform, labels=False)
        draw_feature_polygons(oimg, layers["mhtr_units"], transform, fill=(32, 91, 56, 32), outline=(23, 84, 51, 245), width=5)
        draw_mhtr_unit_labels(odraw, layers, transform)
        draw_places(odraw, layers["places"], transform, max_labels=14)
        draw_named_water_labels(
            odraw,
            layers["water"],
            transform,
            [
                "Chambal River",
                "Rana Pratap Sagar",
                "Gandhi Sagar",
                "Kali Sindh",
                "Ahu",
                "Parvan",
                "Chambal Right Branch Main Canal",
                "Kishore Sagar",
            ],
            manual_positions={
                "Rana Pratap Sagar": (75.46, 24.90),
                "Gandhi Sagar": (75.50, 24.67),
                "Kishore Sagar": (75.85, 25.18),
            },
        )

    with_map_clip(img, geos)
    draw_map_furniture(draw, bbox)

    y = PANEL_RECT[1] + 34
    y = panel_heading(draw, y, "Hydrology")
    y = legend_item(draw, y, (72, 143, 181, 168), "Reservoirs / water bodies", "Large water features and mapped reservoirs from OSM.")
    y = legend_item(draw, y, (35, 111, 163, 220), "Rivers, streams, canals", "Named and unnamed mapped drainage lines.", line=True)
    y = legend_item(draw, y, (23, 84, 51, 245), "MHTR core boundary", "Includes Bhainsrodgarh WLS addition per TCP.", line=True)
    y = panel_heading(draw, y + 24, "Key Names Shown")
    y = draw_wrapped(draw, "Chambal River, Rana Pratap Sagar, Gandhi Sagar, Kali Sindh, Ahu, Parvan and Chambal Right Branch Main Canal are labelled where public OSM geometry or broad reference placement allows.", (PANEL_RECT[0] + 32, y), PANEL_RECT[2] - 64, FONTS["small"], line_spacing=5)
    y = panel_heading(draw, y + 24, "Why It Matters")
    draw_wrapped(draw, "Water concentrates wildlife activity in dry months, supports riparian vegetation, and creates the ridge-to-river ecological connection that defines the wider Mukundara landscape.", (PANEL_RECT[0] + 32, y), PANEL_RECT[2] - 64, FONTS["body"])
    footer_note(draw, "Sources: MHTR Tiger Conservation Plan for Bhainsrodgarh status; OpenStreetMap contributors (ODbL); Mapzen/AWS Terrarium elevation tiles. Sensitive wildlife locations are not shown.")
    path = OUT_DIR / "mhtr-water-systems-map.png"
    finalize_map(img, path)
    return path


def render_elevation(layers: dict) -> Path:
    print("Rendering elevation zones map...", flush=True)
    bbox = layers["mhtr_bbox"]
    transform = make_transform(bbox)
    img = Image.new("RGBA", (CANVAS_W, CANVAS_H), (238, 238, 225, 255))
    draw = ImageDraw.Draw(img, "RGBA")
    draw_panel_base(draw, "MHTR Elevation Zones And Contours", "DEM-derived elevation bands for understanding ridges, slopes and valley floors")
    elevation = terrain_array(bbox, zoom=12)
    stats = dem_summary(elevation)
    shaded = hillshade(elevation, bbox, azimuth=315, altitude=44)
    elevation_img = colorize_elevation(elevation, shaded, mode="elevation").resize((MAP_RECT[2], MAP_RECT[3]), Image.Resampling.LANCZOS)
    img.paste(elevation_img, (MAP_RECT[0], MAP_RECT[1]))
    resized_elev = np.array(Image.fromarray(elevation.astype(np.float32), mode="F").resize((MAP_RECT[2], MAP_RECT[3]), Image.Resampling.BILINEAR))
    levels = list(range(200, 601, 50))
    contours = contour_segments(resized_elev, levels, step=6)
    contour_overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    cdraw = ImageDraw.Draw(contour_overlay, "RGBA")
    for level, segments in contours.items():
        color = (84, 62, 50, 90 if level % 100 else 138)
        width = 1 if level % 100 else 2
        for (x0, y0), (x1, y1) in segments:
            cdraw.line((MAP_RECT[0] + x0, MAP_RECT[1] + y0, MAP_RECT[0] + x1, MAP_RECT[1] + y1), fill=color, width=width)
    img.alpha_composite(contour_overlay)
    draw_contour_labels(draw, contours, [250, 300, 350, 400, 450, 500])
    draw_graticule(draw, bbox, transform)

    def geos(odraw, oimg):
        draw_osm_water(odraw, layers["water"], transform, labels=False)
        draw_feature_polygons(oimg, layers["mhtr_units"], transform, fill=(0, 0, 0, 0), outline=(34, 72, 50, 255), width=5)
        draw_mhtr_unit_labels(odraw, layers, transform)

    with_map_clip(img, geos)
    draw_elevation_point_labels(draw, resized_elev, [("high", "Highest local ridge"), ("low", "Lower valley floor")])
    draw_map_furniture(draw, bbox)

    y = PANEL_RECT[1] + 34
    y = panel_heading(draw, y, "Elevation Bands")
    y = draw_wrapped(draw, f"All values are metres above mean sea level from DEM tiles. This map window ranges about {stats['min']} m to {stats['max']} m; middle terrain is around {stats['p50']} m.", (PANEL_RECT[0] + 32, y), PANEL_RECT[2] - 64, FONTS["small"], line_spacing=5)
    y += 14
    for color, title, note in [
        ((40, 92, 112), "< 220 m", "Lowest valleys and water-linked lowlands."),
        ((78, 130, 94), "220-300 m", "Lower slopes and valley edges."),
        ((157, 158, 93), "300-380 m", "Mid slopes and plateau transitions."),
        ((202, 151, 87), "380-470 m", "Upper slopes and ridge shoulders."),
        ((172, 104, 82), "470-520 m", "High ridges."),
        ((237, 222, 196), "> 520 m", "Highest local relief in this map window."),
    ]:
        y = legend_item(draw, y, color, title, note)
    y = panel_heading(draw, y + 8, "Contours")
    y = legend_item(draw, y, (84, 62, 50, 160), "50 m contours", "Bold lines mark 100 m intervals.", line=True)
    footer_note(draw, "Sources: MHTR Tiger Conservation Plan for Bhainsrodgarh status; Mapzen/AWS Terrarium elevation tiles; OpenStreetMap contributors (ODbL). Elevation is DEM-derived, not engineering survey.")
    path = OUT_DIR / "mhtr-elevation-zones-map.png"
    finalize_map(img, path)
    return path


def render_landcover(layers: dict) -> Path:
    print("Rendering land-cover/habitat map...", flush=True)
    bbox = layers["mhtr_bbox"]
    transform = make_transform(bbox)
    img = Image.new("RGBA", (CANVAS_W, CANVAS_H), (238, 238, 225, 255))
    draw = ImageDraw.Draw(img, "RGBA")
    draw_panel_base(draw, "MHTR Land-Cover And Habitat Context", "ESA WorldCover 2021 classes around Mukundara Hills Tiger Reserve")
    worldcover = fetch_worldcover_image(bbox, (MAP_RECT[2], MAP_RECT[3]))
    img.paste(worldcover, (MAP_RECT[0], MAP_RECT[1]))
    draw_graticule(draw, bbox, transform)

    def geos(odraw, oimg):
        draw_osm_water(odraw, layers["water"], transform, labels=False)
        draw_feature_polygons(oimg, layers["mhtr_units"], transform, fill=(0, 0, 0, 0), outline=(255, 251, 229, 255), width=8)
        draw_feature_polygons(oimg, layers["mhtr_units"], transform, fill=(0, 0, 0, 0), outline=(21, 71, 47, 255), width=4)
        draw_mhtr_unit_labels(odraw, layers, transform)

    with_map_clip(img, geos)
    draw_map_furniture(draw, bbox)

    y = PANEL_RECT[1] + 34
    y = panel_heading(draw, y, "WorldCover Classes")
    landcover_items = [
        ((0, 100, 0), "Tree cover", "Dry deciduous forest and wooded slopes where mapped as tree cover."),
        ((255, 187, 34), "Shrubland", "Scrub and thorn-dominated broad cover."),
        ((255, 255, 76), "Grassland", "Open grassy patches and herbaceous cover."),
        ((240, 150, 255), "Cropland", "Agricultural matrix around the reserve."),
        ((250, 0, 0), "Built-up", "Settlements and urban surfaces."),
        ((180, 180, 180), "Bare / sparse vegetation", "Rocky or sparsely vegetated areas."),
        ((0, 100, 200), "Permanent water", "Reservoirs, river water and larger mapped water bodies."),
        ((0, 150, 160), "Herbaceous wetland", "Wetland-like herbaceous cover where classified."),
    ]
    for color, title, note in landcover_items:
        y = legend_item(draw, y, color, title, note)
    y = panel_heading(draw, y + 6, "Interpretation")
    draw_wrapped(draw, "Treat this as a broad habitat base layer. Field surveys and forest working records are still needed for fine habitat labels such as invasive patches, riparian belts or grass restoration sites.", (PANEL_RECT[0] + 32, y), PANEL_RECT[2] - 64, FONTS["small"])
    footer_note(draw, "Sources: MHTR Tiger Conservation Plan for Bhainsrodgarh status; ESA WorldCover 2021 via Terrascope WMS (CC BY 4.0); OpenStreetMap contributors (ODbL). Public habitat context only.")
    path = OUT_DIR / "mhtr-land-cover-habitat-map.png"
    finalize_map(img, path)
    return path


def write_source_notes(paths: list[Path]) -> None:
    lines = [
        "# MHTR GIS Map Source Notes",
        "",
        "Generated by `scripts/build-gis-maps.py`.",
        "",
        "Outputs:",
    ]
    for path in paths:
        lines.append(f"- `{path.relative_to(ROOT)}`")
    lines += [
        "",
        "Public source layers:",
        "- OpenStreetMap contributors: protected-area boundaries, roads, rail, rivers, reservoirs and settlements. ODbL.",
        "- ESA WorldCover 2021 through Terrascope WMS: broad land-cover classes. CC BY 4.0.",
        "- Mapzen/AWS Terrarium elevation tiles: DEM-derived shaded relief and elevation bands.",
        "- geoBoundaries India ADM2: district boundaries. ODbL.",
        "- MHTR Tiger Conservation Plan (`Data/source-materials/documents/official/MHTR_TCP.pdf`): Bhainsrodgarh Sanctuary status as a 05 Oct 2023 core addition to MHTR.",
        "",
        "Editorial rule: these maps intentionally avoid exact wildlife observation, nest, den, roost, carcass or breeding-site locations.",
        "Boundary note: OSM geometries are public orientation layers and should not be treated as official cadastral or legal survey demarcations.",
    ]
    (DATA_DIR / "README.md").write_text("\n".join(lines) + "\n")


def main() -> None:
    ensure_dirs()
    layers = build_data_layers()
    paths = [
        render_boundary_context(layers),
        render_terrain(layers),
        render_water(layers),
        render_elevation(layers),
        render_landcover(layers),
    ]
    write_source_notes(paths)


if __name__ == "__main__":
    main()
