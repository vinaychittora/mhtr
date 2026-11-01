#!/usr/bin/env python3
"""Fetch reference details for the biodiversity page from the iNaturalist API.

Reads the species named in official records (src/_data/bioReference.json) and
the community snapshot (src/_data/inatBiodiversity.json), finds each taxon on
iNaturalist, and writes src/_data/bioTaxa.json with, for each taxon:

- the iNaturalist taxon id, accepted name, rank, English common name, family;
- the IUCN Red List category as recorded on iNaturalist (global assessment);
- any India-specific conservation status recorded on iNaturalist;
- whether iNaturalist lists it as native or introduced in India;
- the curated default photo, only when it carries a CC0, CC BY or CC BY-SA
  licence, with the photographer's name and the licence;
- the first lines of the Wikipedia summary that iNaturalist carries
  (Wikipedia text is CC BY-SA 4.0; the page links back to the article).

Nothing observation-level is requested or stored: no observation ids, dates,
places or observer names. Only taxon-level data from /v1/taxa is used.

Usage (needs internet access to api.inaturalist.org):

    python3 scripts/build-bio-taxa.py            # reuse known ids, refetch details
    python3 scripts/build-bio-taxa.py --refresh  # look every name up again
    python3 scripts/build-bio-taxa.py --limit 20 # quick test run

iNaturalist asks API users to stay under about one request per second; the
script sleeps between calls and batches detail requests 30 taxa at a time.
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REFERENCE_PATH = ROOT / "src" / "_data" / "bioReference.json"
SNAPSHOT_PATH = ROOT / "src" / "_data" / "inatBiodiversity.json"
OUTPUT_PATH = ROOT / "src" / "_data" / "bioTaxa.json"

API = "https://api.inaturalist.org/v1"
USER_AGENT = "MHTR.in biodiversity reference (https://mhtr.in/; vinay.chittora@gmail.com)"
INDIA_PLACE_ID = 6681
PAUSE_SECONDS = 1.05
BATCH_SIZE = 30
SUMMARY_LIMIT = 320

ALLOWED_PHOTO_LICENCES = {
    "cc0": ("CC0 1.0", "https://creativecommons.org/publicdomain/zero/1.0/"),
    "cc-by": ("CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"),
    "cc-by-sa": ("CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"),
}

IUCN_BY_CODE = {
    0: ("NE", "Not Evaluated"),
    5: ("DD", "Data Deficient"),
    10: ("LC", "Least Concern"),
    20: ("NT", "Near Threatened"),
    30: ("VU", "Vulnerable"),
    40: ("EN", "Endangered"),
    50: ("CR", "Critically Endangered"),
    60: ("EW", "Extinct in the Wild"),
    70: ("EX", "Extinct"),
}
IUCN_BY_TEXT = {
    "ne": 0, "not evaluated": 0,
    "dd": 5, "data deficient": 5,
    "lc": 10, "least concern": 10,
    "nt": 20, "near threatened": 20, "lr/nt": 20,
    "vu": 30, "vulnerable": 30,
    "en": 40, "endangered": 40,
    "cr": 50, "critically endangered": 50,
    "ew": 60, "extinct in the wild": 60,
    "ex": 70, "extinct": 70,
}

_last_call = 0.0


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def get_json(path: str, params: dict | None = None, attempt: int = 1) -> dict:
    """GET an iNaturalist API path with polite pacing and retries."""
    global _last_call
    wait = PAUSE_SECONDS - (time.monotonic() - _last_call)
    if wait > 0:
        time.sleep(wait)
    url = f"{API}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            _last_call = time.monotonic()
            return json.load(response)
    except urllib.error.HTTPError as error:
        _last_call = time.monotonic()
        if error.code in (429, 500, 502, 503, 504) and attempt < 5:
            time.sleep(3 * attempt)
            return get_json(path, params, attempt + 1)
        raise
    except (urllib.error.URLError, TimeoutError):
        _last_call = time.monotonic()
        if attempt < 5:
            time.sleep(3 * attempt)
            return get_json(path, params, attempt + 1)
        raise


def norm(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip().lower()


def strip_html(value: str | None) -> str:
    text = re.sub(r"<[^>]+>", " ", value or "")
    text = html.unescape(text)
    text = re.sub(r"\[\d+\]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def shorten(text: str, limit: int = SUMMARY_LIMIT) -> str:
    """Cut a summary at a sentence end at or before `limit` characters."""
    if len(text) <= limit:
        return text
    head = text[:limit]
    cut = max(head.rfind(". "), head.rfind(".”"), head.rfind(".)"))
    if cut < limit // 2:
        cut = head.rfind(" ")
        return head[:cut].rstrip(",;:") + "…"
    return head[: cut + 1].strip()


def choose_match(results: list[dict], wanted: str) -> dict | None:
    """Pick the result whose name (or matched term) equals the name we asked for."""
    target = norm(wanted)
    exact = [r for r in results if norm(r.get("name")) == target]
    if not exact:
        exact = [r for r in results if norm(r.get("matched_term")) == target]
    if not exact:
        return None
    exact.sort(key=lambda r: (not r.get("is_active", True), r.get("rank") != "species", -(r.get("observations_count") or 0)))
    return exact[0]


def lookup_taxon_id(name: str) -> tuple[int | None, str]:
    """Return (taxon id, how it was matched) for a scientific name."""
    for path, params in (
        ("/taxa/autocomplete", {"q": name, "per_page": 10, "locale": "en"}),
        ("/taxa", {"q": name, "per_page": 10, "locale": "en"}),
    ):
        data = get_json(path, params)
        match = choose_match(data.get("results") or [], name)
        if not match:
            continue
        if match.get("is_active") is False:
            synonyms = match.get("current_synonymous_taxon_ids") or []
            if len(synonyms) == 1:
                return int(synonyms[0]), "synonym"
            return None, "inactive"
        return int(match["id"]), "exact"
    return None, "not found"


def parse_attribution_name(photo: dict) -> str:
    name = (photo.get("attribution_name") or "").strip()
    if name:
        return name
    attribution = (photo.get("attribution") or "").strip()
    attribution = re.sub(r"^\s*(?:\(c\)|©)\s*", "", attribution, flags=re.I)
    attribution = re.sub(r",?\s*(?:some rights reserved|no rights reserved|all rights reserved).*$", "", attribution, flags=re.I)
    attribution = re.sub(r",?\s*uploaded by .*$", "", attribution, flags=re.I)
    return attribution.strip()


def reusable_photo(photo: dict | None) -> dict | None:
    if not photo:
        return None
    licence = norm(photo.get("license_code"))
    if licence not in ALLOWED_PHOTO_LICENCES:
        return None
    if photo.get("hidden") or photo.get("flags"):
        return None
    url = photo.get("url") or photo.get("square_url") or ""
    if not url.startswith("https://"):
        return None
    photo_id = photo.get("id")
    if not isinstance(photo_id, int) or photo_id <= 0:
        return None
    name = parse_attribution_name(photo)
    if not name and licence != "cc0":
        return None
    dims = photo.get("original_dimensions") or {}
    entry = {
        "id": photo_id,
        "url": url,
        "licence": licence,
        "licenceLabel": ALLOWED_PHOTO_LICENCES[licence][0],
        "licenceUrl": ALLOWED_PHOTO_LICENCES[licence][1],
        "by": name or "creator not named",
    }
    width, height = dims.get("width"), dims.get("height")
    if isinstance(width, int) and isinstance(height, int) and width > 0 and height > 0:
        entry["width"], entry["height"] = width, height
    return entry


def iucn_code(status: dict) -> int | None:
    code = status.get("iucn")
    if isinstance(code, int) and code in IUCN_BY_CODE:
        return code
    text = norm(status.get("status"))
    return IUCN_BY_TEXT.get(text)


def conservation(taxon: dict) -> tuple[dict | None, list[dict]]:
    """Split the recorded statuses into the global IUCN category and India-specific ones."""
    red_list = None
    india: list[dict] = []
    for status in taxon.get("conservation_statuses") or []:
        place = status.get("place") or {}
        authority = (status.get("authority") or "").strip()
        if not place and "iucn" in authority.lower():
            code = iucn_code(status)
            if code is None or code == 0:
                continue
            candidate = {
                "code": IUCN_BY_CODE[code][0],
                "name": IUCN_BY_CODE[code][1],
                "authority": authority,
            }
            if status.get("url", "").startswith("https://"):
                candidate["url"] = status["url"]
            # Prefer the highest-ranked global IUCN entry if several are present.
            if red_list is None or code > IUCN_BY_TEXT.get(red_list["code"].lower(), -1):
                red_list = candidate
        elif place and (place.get("id") == INDIA_PLACE_ID or norm(place.get("name")) == "india"):
            label = (status.get("status_name") or status.get("status") or "").strip()
            if not label or not authority:
                continue
            entry = {"status": label, "authority": authority}
            if status.get("url", "").startswith("https://"):
                entry["url"] = status["url"]
            india.append(entry)
    return red_list, india[:3]


def establishment(taxon: dict) -> str | None:
    means = taxon.get("establishment_means") or {}
    place = means.get("place") or {}
    value = norm(means.get("establishment_means"))
    if value and (place.get("id") == INDIA_PLACE_ID or norm(place.get("name")) == "india"):
        return value
    return None


def family_of(taxon: dict) -> str | None:
    for ancestor in taxon.get("ancestors") or []:
        if ancestor.get("rank") == "family" and ancestor.get("name"):
            return ancestor["name"]
    return None


def build_entry(taxon: dict, today: str) -> dict:
    red_list, india = conservation(taxon)
    entry: dict = {
        "taxonId": int(taxon["id"]),
        "name": taxon.get("name") or "",
        "rank": taxon.get("rank") or "",
        "active": bool(taxon.get("is_active", True)),
        "checkedAt": today,
    }
    if taxon.get("preferred_common_name"):
        entry["commonName"] = taxon["preferred_common_name"]
    if taxon.get("iconic_taxon_name"):
        entry["iconicTaxon"] = taxon["iconic_taxon_name"]
    family = family_of(taxon)
    if family:
        entry["family"] = family
    if isinstance(taxon.get("observations_count"), int):
        entry["observationsCount"] = taxon["observations_count"]
    photo = reusable_photo(taxon.get("default_photo"))
    if photo:
        entry["photo"] = photo
    if red_list:
        entry["redList"] = red_list
    if india:
        entry["indiaStatus"] = india
    means = establishment(taxon)
    if means:
        entry["establishment"] = means
    # iNaturalist still hands out some Wikipedia links as http://; Wikipedia serves https everywhere.
    wikipedia_url = re.sub(r"^http://", "https://", taxon.get("wikipedia_url") or "")
    summary = shorten(strip_html(taxon.get("wikipedia_summary")))
    if wikipedia_url.startswith("https://") and summary:
        entry["wikipedia"] = {"url": wikipedia_url, "summary": summary}
    return entry


def fetch_details(ids: list[int]) -> dict[int, dict]:
    found: dict[int, dict] = {}
    for start in range(0, len(ids), BATCH_SIZE):
        chunk = ids[start : start + BATCH_SIZE]
        data = get_json(
            "/taxa/" + ",".join(str(i) for i in chunk),
            {"preferred_place_id": INDIA_PLACE_ID, "locale": "en"},
        )
        for taxon in data.get("results") or []:
            found[int(taxon["id"])] = taxon
        log(f"  details {min(start + BATCH_SIZE, len(ids))}/{len(ids)}")
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--refresh", action="store_true", help="look every name up again instead of reusing known taxon ids")
    parser.add_argument("--limit", type=int, default=0, help="only process the first N names (for testing)")
    parser.add_argument("--skip-community", action="store_true", help="only process species from the official records")
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args()

    today = dt.date.today().isoformat()
    reference = json.loads(REFERENCE_PATH.read_text(encoding="utf-8"))
    snapshot = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
    previous: dict = {}
    if args.output.exists() and not args.refresh:
        previous = json.loads(args.output.read_text(encoding="utf-8")).get("taxa", {})

    snapshot_ids = {norm(t["scientificName"]): int(t["taxonId"]) for t in snapshot.get("taxa", [])}

    # Names to resolve: official rows by their scientific name, then community taxa by id.
    names: list[str] = []
    for row in reference.get("rows", []):
        name = (row.get("scientific") or "").strip()
        if name and name not in names:
            names.append(name)
    if args.limit:
        names = names[: args.limit]

    ids_by_name: dict[str, int] = {}
    matched_via: dict[str, str] = {}
    unmatched: dict[str, str] = {}
    for index, name in enumerate(names, 1):
        if name in previous and previous[name].get("taxonId"):
            ids_by_name[name] = int(previous[name]["taxonId"])
            matched_via[name] = previous[name].get("matchedVia", "exact")
            continue
        if norm(name) in snapshot_ids:
            ids_by_name[name] = snapshot_ids[norm(name)]
            matched_via[name] = "project"
            continue
        log(f"[{index}/{len(names)}] looking up {name}")
        try:
            taxon_id, how = lookup_taxon_id(name)
        except Exception as error:  # noqa: BLE001 - report and carry on
            log(f"  failed: {error}")
            unmatched[name] = f"request failed: {error}"
            continue
        if taxon_id:
            ids_by_name[name] = taxon_id
            matched_via[name] = how
        else:
            unmatched[name] = how
            log(f"  no match ({how})")

    community: list[tuple[str, int]] = []
    if not args.skip_community:
        for taxon in snapshot.get("taxa", []):
            name = taxon["scientificName"]
            if name not in ids_by_name:
                community.append((name, int(taxon["taxonId"])))
        if args.limit:
            community = community[: args.limit]
    for name, taxon_id in community:
        ids_by_name[name] = taxon_id
        matched_via[name] = "project"

    unique_ids = sorted(set(ids_by_name.values()))
    log(f"fetching details for {len(unique_ids)} taxa")
    details = fetch_details(unique_ids)

    taxa: dict[str, dict] = {}
    for name, taxon_id in ids_by_name.items():
        taxon = details.get(taxon_id)
        if not taxon:
            unmatched[name] = "details not returned"
            continue
        entry = build_entry(taxon, today)
        entry["matchedVia"] = matched_via.get(name, "exact")
        taxa[name] = entry

    output = {
        "schemaVersion": 1,
        "fetchedAt": today,
        "about": (
            "Taxon-level reference details for the biodiversity page, fetched from the iNaturalist "
            "taxonomy API (/v1/taxa) by scripts/build-bio-taxa.py. Red List categories are the global "
            "IUCN assessments as recorded on iNaturalist; India statuses are those iNaturalist records "
            "for the place India; photos are iNaturalist's curated default photos, kept only when "
            "licensed CC0, CC BY or CC BY-SA; summaries are the opening lines of the Wikipedia article "
            "iNaturalist links to (CC BY-SA 4.0). No observation-level data is included."
        ),
        "sources": {
            "inaturalist": {"name": "iNaturalist taxonomy API", "url": "https://api.inaturalist.org/v1/docs/#!/Taxa/get_taxa_id"},
            "iucn": {"name": "IUCN Red List of Threatened Species", "url": "https://www.iucnredlist.org/"},
            "wikipedia": {
                "name": "Wikipedia",
                "licence": "CC BY-SA 4.0",
                "licenceUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
            },
        },
        "counts": {
            "taxa": len(taxa),
            "withRedList": sum(1 for t in taxa.values() if t.get("redList")),
            "withPhoto": sum(1 for t in taxa.values() if t.get("photo")),
            "withSummary": sum(1 for t in taxa.values() if t.get("wikipedia")),
            "unmatched": len(unmatched),
        },
        "unmatched": dict(sorted(unmatched.items())),
        "taxa": dict(sorted(taxa.items(), key=lambda kv: kv[0].lower())),
    }
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    log(json.dumps(output["counts"]))
    if unmatched:
        log("unmatched: " + ", ".join(f"{k} ({v})" for k, v in sorted(unmatched.items())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
