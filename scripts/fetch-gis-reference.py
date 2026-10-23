#!/usr/bin/env python3
"""Snapshot the OpenStreetMap-derived reference layers used by scripts/build-gis-maps.py.

Reads one fixed Overture Maps release straight from its public S3 bucket (HTTP range reads of the
GeoParquet row groups that intersect the map area), keeps only the features the maps draw, and
writes small GeoJSON files to `Data/source-materials/gis/reference/`. The maps are then rebuilt
from these committed snapshots, so a rerun months later draws the same rivers, roads and places.

Overture's base, transportation and divisions themes are derived from OpenStreetMap: © OpenStreetMap
contributors, ODbL 1.0. See https://docs.overturemaps.org/attribution/.

Python dependencies: `python -m pip install -r scripts/requirements-gis.txt`.
"""

from __future__ import annotations

import io
import json
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

import pyarrow.parquet as pq
import requests
import shapely
from shapely.geometry import box, mapping

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "Data" / "source-materials" / "gis" / "reference"
BUCKET = "https://overturemaps-us-west-2.s3.amazonaws.com"
RELEASE = "2026-10-21.0"
# Covers every map window in build-gis-maps.py with a margin.
BBOX = (74.55, 24.30, 76.65, 25.60)
SIMPLIFY_DEG = 0.00015  # about 15 m; the maps draw at roughly 50–110 m per pixel
USER_AGENT = "mhtr.in GIS reference snapshot"

ROAD_CLASSES = {"motorway", "trunk", "primary", "secondary", "tertiary"}
WATER_LINE_SUBTYPES = {"river", "stream", "canal", "drain"}
PLACE_CLASSES = {"city", "town", "village", "hamlet"}


_local = threading.local()


def session() -> requests.Session:
    if not hasattr(_local, "session"):
        _local.session = requests.Session()
        _local.session.headers["User-Agent"] = USER_AGENT
    return _local.session


def http_get(url: str, headers: dict | None = None, params: dict | None = None) -> bytes:
    for attempt in range(6):
        try:
            response = session().get(url, headers=headers, params=params, timeout=120)
            response.raise_for_status()
            return response.content
        except requests.RequestException:
            if attempt == 5:
                raise
            time.sleep(2 ** attempt)


def list_keys(prefix: str) -> list[tuple[str, int]]:
    keys, token = [], None
    while True:
        params = {"list-type": "2", "prefix": prefix}
        if token:
            params["continuation-token"] = token
        text = http_get(BUCKET + "/", params=params).decode()
        keys += [(k, int(s)) for k, s in re.findall(r"<Key>(.*?)</Key>.*?<Size>(\d+)</Size>", text, re.S)]
        match = re.search(r"<NextContinuationToken>(.*?)</NextContinuationToken>", text)
        if not match:
            return [k for k in keys if k[0].endswith(".parquet") or "/part-" in k[0]]
        token = match.group(1)


class RangeFile(io.RawIOBase):
    """Seekable file over HTTP range requests, so pyarrow reads only footers and wanted row groups."""

    def __init__(self, url: str, size: int):
        self.url, self.size, self.pos = url, size, 0

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        self.pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.size + offset
        return self.pos

    def readinto(self, buffer):
        if self.pos >= self.size:
            return 0
        end = min(self.size, self.pos + len(buffer)) - 1
        data = http_get(self.url, {"Range": f"bytes={self.pos}-{end}"})
        buffer[: len(data)] = data
        self.pos += len(data)
        return len(data)


def read_file(key: str, size: int, columns: list[str]) -> list[dict]:
    parquet = pq.ParquetFile(io.BufferedReader(RangeFile(f"{BUCKET}/{key}", size), buffer_size=1 << 20))
    meta = parquet.metadata
    paths = {parquet.schema.column(i).path: i for i in range(meta.num_columns)}
    wanted = []
    for rg in range(meta.num_row_groups):
        stats = {p: meta.row_group(rg).column(i).statistics for p, i in paths.items() if p.startswith("bbox.")}
        xmin, xmax = stats["bbox.xmin"].min, stats["bbox.xmax"].max
        ymin, ymax = stats["bbox.ymin"].min, stats["bbox.ymax"].max
        if xmax >= BBOX[0] and xmin <= BBOX[2] and ymax >= BBOX[1] and ymin <= BBOX[3]:
            wanted.append(rg)
    print(f"{key.split('/theme=')[-1]}: {len(wanted)}/{meta.num_row_groups} row groups", flush=True)
    return parquet.read_row_groups(wanted, columns=columns + ["geometry", "bbox"]).to_pylist() if wanted else []


def read_theme(theme: str, kind: str, columns: list[str]) -> list[dict]:
    keys = list_keys(f"release/{RELEASE}/theme={theme}/type={kind}/")
    with ThreadPoolExecutor(max_workers=8) as pool:
        rows = [row for chunk in pool.map(lambda k: read_file(k[0], k[1], columns), keys) for row in chunk]
    area = box(*BBOX)
    out = []
    for row in rows:
        b = row["bbox"]
        if b["xmax"] < BBOX[0] or b["xmin"] > BBOX[2] or b["ymax"] < BBOX[1] or b["ymin"] > BBOX[3]:
            continue
        geom = shapely.from_wkb(row["geometry"])
        if geom.intersects(area):
            row["geometry"] = geom
            out.append(row)
    return out


def name_of(row: dict) -> str | None:
    names = row.get("names") or {}
    return names.get("primary")


def feature(geom, props: dict, simplify: bool = True) -> dict:
    if simplify and geom.geom_type != "Point":
        geom = geom.simplify(SIMPLIFY_DEG, preserve_topology=True)
    geom = shapely.set_precision(geom, 1e-5)
    return {"type": "Feature", "properties": {k: v for k, v in props.items() if v is not None}, "geometry": mapping(geom)}


def write(name: str, features: list[dict], description: str) -> None:
    path = OUT_DIR / name
    payload = {
        "type": "FeatureCollection",
        "metadata": {
            "source": f"Overture Maps Foundation release {RELEASE} ({BUCKET}/release/{RELEASE}/)",
            "attribution": "© OpenStreetMap contributors (ODbL 1.0), via Overture Maps Foundation",
            "retrieved": date.today().isoformat(),
            "bbox": BBOX,
            "description": description,
        },
        "features": features,
    }
    path.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    print(f"wrote {path.relative_to(ROOT)}: {len(features)} features, {path.stat().st_size / 1e6:.2f} MB", flush=True)


def fetch_water() -> None:
    water_features = []
    for row in read_theme("base", "water", ["subtype", "class", "names", "is_intermittent"]):
        geom, subtype = row["geometry"], row.get("subtype")
        if geom.geom_type in ("LineString", "MultiLineString"):
            if subtype not in WATER_LINE_SUBTYPES and row.get("class") not in WATER_LINE_SUBTYPES:
                continue
        elif geom.geom_type in ("Polygon", "MultiPolygon"):
            if geom.area < 2e-6:  # under about 2 ha; invisible at map scale
                continue
        else:
            continue
        water_features.append(feature(geom, {"subtype": subtype, "class": row.get("class"), "name": name_of(row), "intermittent": row.get("is_intermittent")}))
    write("overture-water.geojson", water_features, "Rivers, streams, canals and water bodies over about 2 ha.")


def fetch_roads() -> None:
    transport = [
        feature(row["geometry"], {"subtype": row["subtype"], "class": row.get("class"), "name": name_of(row)})
        for row in read_theme("transportation", "segment", ["subtype", "class", "names"])
        if (row["subtype"] == "road" and row.get("class") in ROAD_CLASSES) or row["subtype"] == "rail"
    ]
    write("overture-roads-rail.geojson", transport, "Motorway to tertiary roads, and railways.")


def fetch_places() -> None:
    places = [
        feature(row["geometry"], {"class": row["class"], "name": name_of(row), "population": row.get("population")}, simplify=False)
        for row in read_theme("divisions", "division", ["subtype", "class", "names", "population"])
        if row["subtype"] == "locality" and row.get("class") in PLACE_CLASSES and name_of(row)
    ]
    write("overture-places.geojson", places, "Cities, towns, villages and hamlets (OSM place points).")


def fetch_districts() -> None:
    districts = [
        feature(row["geometry"], {"name": name_of(row), "region": row.get("region")})
        for row in read_theme("divisions", "division_area", ["subtype", "class", "names", "country", "region"])
        if row["subtype"] == "county" and row.get("country") == "IN"
    ]
    write("overture-districts.geojson", districts, "District (county-level) areas.")


def fetch_protected() -> None:
    protected = [
        feature(row["geometry"], {"class": row["class"], "name": name_of(row)})
        for row in read_theme("base", "land_use", ["subtype", "class", "names"])
        if row["subtype"] == "protected" and row["geometry"].geom_type in ("Polygon", "MultiPolygon")
    ]
    write("overture-protected-areas.geojson", protected, "OSM protected-area polygons (indicative; not official boundaries).")


LAYERS = {"water": fetch_water, "roads": fetch_roads, "places": fetch_places, "districts": fetch_districts, "protected": fetch_protected}


def main(only: list[str]) -> None:
    """Fetch every layer, or only the named ones: `fetch-gis-reference.py water places`."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name in only or LAYERS:
        LAYERS[name]()


if __name__ == "__main__":
    main(sys.argv[1:])
