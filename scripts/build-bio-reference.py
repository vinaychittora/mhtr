#!/usr/bin/env python3
"""Build the "Published reference" species list for the biodiversity page.

Every row comes from an official document kept in the site's Resources archive, and every row
keeps the source and printed page it came from:

- Tiger Conservation Plan 2025-26 to 2035-36, Part I Core Area (Rajasthan Forest Department):
  Annexure 5 (flora, printed pp. 244-257) and Annexure 6 (fauna, printed pp. 258-267).
- A Preliminary Bird Guide of Mukandra Hills Tiger Reserve (WII and Rajasthan Forest
  Department, 2025): 219 species accounts.
- Amphibians & Reptiles of Mukandra Hills Tiger Reserve (WII and Rajasthan Forest Department,
  2025): species accounts and checklist.
- A few species named only in the plan's Chapter 2 text, or in the 2020 eco-sensitive zone
  notification (Gazette of India), listed in TEXT_MENTIONS with the exact printed text.

Names are kept as printed. Where a printed scientific name has a plain spelling error, the row
shows the corrected spelling and keeps the printed form in `printedAs`, so the change can be
checked against the page. Nothing is added from memory: a species that is not in one of these
documents is not in the list.

Bird families follow the IOC World Bird List v15.2 (CC BY 3.0); they are looked up by
scientific name from a local copy of the IOC-based species table and are left blank when the
guide uses a name the IOC list does not.

Requires poppler's `pdftotext` and `pip install pdfplumber`.

Usage:
    python3 scripts/build-bio-reference.py [--ioc path/to/species.csv]
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import subprocess
import sys
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "src" / "assets" / "docs" / "resources"
OUT = ROOT / "src" / "_data" / "bioReference.json"

TCP = "mhtr-tiger-conservation-plan-bhainsrodgarh-core-addition"
BIRDS = "wii-rajasthan-mhtr-preliminary-bird-guide-2025"
HERPS = "rajasthan-reptiles-amphibians-mhtr-field-guide"

SOURCES = {
    "tcp": {
        "slug": TCP,
        "short": "Tiger Conservation Plan 2025–36",
        "title": "Tiger Conservation Plan 2025-26 to 2035-36, Part I: Core Area, Mukandra Hills Tiger Reserve",
        "publisher": "Rajasthan Forest Department",
        "pageOffset": 18,  # printed page = PDF page - 18 in the archived copy
    },
    "wiiBirds": {
        "slug": BIRDS,
        "short": "WII bird guide 2025",
        "title": "A Preliminary Bird Guide of Mukandra Hills Tiger Reserve",
        "publisher": "Wildlife Institute of India and Rajasthan Forest Department",
        "pageOffset": 2,
    },
    "esz2020": {
        "slug": "moefcc-mukundara-notification-2020",
        "short": "ESZ notification 2020",
        "title": "Mukundara Hills Tiger Reserve eco-sensitive zone notification (Gazette of India, 2020)",
        "publisher": "Ministry of Environment, Forest and Climate Change",
        "pageOffset": 0,
    },
    "wiiHerps": {
        "slug": HERPS,
        "short": "WII amphibian & reptile guide 2025",
        "title": "Amphibians & Reptiles of Mukandra Hills Tiger Reserve",
        "publisher": "Wildlife Institute of India and Rajasthan Forest Department",
        "pageOffset": 2,
    },
}

# Plain spelling errors in the printed lists. Left: as printed. Right: corrected spelling.
# Only misspellings are fixed here; older names (synonyms) are kept as printed.
SPELLING = {
    "Malivora capensis": "Mellivora capensis",
    "Mehursus ursinus": "Melursus ursinus",
    "Boselaphum tragocamelus": "Boselaphus tragocamelus",
    "Vivaricula indica": "Viverricula indica",
    "Sus scorfa": "Sus scrofa",
    "Macaca mullata": "Macaca mulatta",
    "Pyeropus giganteus": "Pteropus giganteus",
    "Rousttus leschenaultia": "Rousettus leschenaultii",
    "Hardell thurqii": "Hardella thurjii",
    "Plantanista gangetica": "Platanista gangetica",
    "lutrogale perspicillata": "Lutrogale perspicillata",
    "Kachuga kachunga": "Kachuga kachuga",
    "Prosops juliflora": "Prosopis juliflora",
    "Annona sequamosa": "Annona squamosa",
    "Ziphius mauritiana": "Ziziphus mauritiana",
    "Achyranospermum aspera": "Achyranthes aspera",
    "Amarania hybridus": "Amaranthus hybridus",
    "Amarania spinosus": "Amaranthus spinosus",
    "Amarania tricolor": "Amaranthus tricolor",
    "Baccopa bipinnata": "Bacopa bipinnata",
    "Chenopodipum album": "Chenopodium album",
    "Cleome viscose": "Cleome viscosa",
    "Haplanthus tentaculatus": "Haplanthodes tentaculatus",
    "Haplanthus verticillatus": "Haplanthodes verticillatus",
    "Cayratia camosa": "Cayratia carnosa",
    "Tringa tetanus": "Tringa totanus",
    "Perdicula argoundha": "Perdicula argoondah",
    "Mareca Penelope": "Mareca penelope",
    "Alcedo athis": "Alcedo atthis",
    "Anhinga Melanogaster": "Anhinga melanogaster",
    "Gadusia chapra": "Gudusia chapra",
    "Notopterus chittala": "Notopterus chitala",
    "Barilus bola": "Barilius bola",
    "Esomus denrica": "Esomus danrica",
    "Puntinus conchonius": "Puntius conchonius",
    "Puntinus sarana": "Puntius sarana",
    "Hilsa hisha": "Hilsa ilisha",
    "Labeo baga": "Labeo boga",
    "Earropuchthys yacha": "Eutropiichthys vacha",
    "Pangasius paneasius": "Pangasius pangasius",
    "Salonia Silondra": "Silonia silondia",
    "Heteropnustes fossillis": "Heteropneustes fossilis",
    "Mysius aop": "Mystus aor",
    "Mytus cavasius": "Mystus cavasius",
    "Mytus seenghala": "Mystus seenghala",
    "Zenentodon cancila": "Xenentodon cancila",
    "Gambusia affinil": "Gambusia affinis",
    "Moll neista formosa": "Mollienesia formosa",
    "Rhinomugil carsula": "Rhinomugil corsula",
    "Ophicephalus guchua": "Ophicephalus gachua",
    "Amphipnous cuchta": "Amphipnous cuchia",
    "F lueggea leucopyrus": "Flueggea leucopyrus",
    "Aloe barbadensis miller": "Aloe barbadensis",
    "Alysicarpus rotundifolia": "Alysicarpus rotundifolius",
    "Alysicarpus tetragonoloba": "Alysicarpus tetragonolobus",
    "Ammania gracilis": "Ammannia gracilis",
    "Blepharis liniriaefolia": "Blepharis linariifolia",
    "Commelina haskami": "Commelina hasskarlii",
    "Desmodium neomaxicum": "Desmodium neomexicanum",
    "Cirrhina mrigala": "Cirrhinus mrigala",
    "Cirrhina rebu": "Cirrhinus reba",
    "Crenopharyugodon idella": "Ctenopharyngodon idella",
    "Labeo gouius": "Labeo gonius",
    "Labeo bogguj": "Labeo boggut",
    "Trichogaster asciatus": "Trichogaster fasciata",
    "Mastacembelus puncalus": "Mastacembelus pancalus",
    "Galloperdix lunulate": "Galloperdix lunulata",
    "Ansa acuta": "Anas acuta",
    "A. creeca": "Anas crecca",
    "Calotes versicolar": "Calotes versicolor",
    "Cyrtopodion arravalensis": "Cyrtopodion aravallensis",
}

# Same species printed under an older or different name in another list. Rows are merged under
# the newer name and the printed name is kept on the source reference.
SYNONYMS = {
    "Presbytis entellus": "Semnopithecus entellus",
    "Xenochrophis piscator": "Fowlea piscator",
    "Aspideretes gangeticus": "Nilssonia gangetica",
    "Kachuga tentoria": "Pangshura tentoria",
    "Sitana ponticeriana": "Sitana spinocephalus",
    "Accipiter badius": "Tachyspiza badia",
    "Streptopelia senegalensis": "Spilopelia senegalensis",
    "Himalayapsitta cyanocephala": "Psittacula cyanocephala",
    "Saxicoloides fulicatus": "Copsychus fulicatus",
    "Mirafra erythroptera": "Plocealauda erythroptera",
    "Phaenicophaeus leschenaultii": "Taccocua leschenaultii",
    "Eudynamys scolopacea": "Eudynamys scolopaceus",
    "Charadrius dubius": "Thinornis dubius",
    "Bubulcus ibis": "Ardea coromanda",
    "Tyto alba": "Tyto javanica",
    "Bufo melanostictus": "Duttaphrynus melanostictus",
}

# Notes where a printed name cannot stand as it is. Each says only what the documents show.
NAME_NOTES = {
    "Canis pardus": "Printed as Canis pardus with the local name Bhediya (wolf). Canis pardus is not a valid species name; the wolf is Canis lupus.",
    "Gazella gazella": "Printed as Gazella gazella with the local name Chinkara. The Indian chinkara is Gazella bennettii; Gazella gazella is the mountain gazelle of West Asia.",
    "Saxicola rubicola": "The WII bird guide (2025) lists the stonechat of MHTR as Siberian Stonechat, Saxicola maurus.",
    "Burhinus oedicnemus": "The WII bird guide (2025) lists Indian Thick-knee, Burhinus indicus.",
    "Bacopa bipinnata": "Printed as Baccopa bipinnata with the local name Brahmi. No species of that name is known; the herb called Brahmi is usually Bacopa monnieri.",
    "Carassius carassius": "Printed with the local name Gold fish. Goldfish is Carassius auratus; Carassius carassius is the crucian carp.",
    "Mollienesia formosa": "Printed as \"Moll neista formosa\" with the local name Black Moily. Mollienesia (now Poecilia) formosa is the Amazon molly, an aquarium fish not native to India.",
    "Sitana spinocephalus": "The Tiger Conservation Plan prints Sitana ponticeriana; the WII guide (2025) names the MHTR fan-throated lizard Sitana spinocephalus.",
}

REPTILE_FAMILY = {
    "Gavialis": "Gavialidae", "Crocodylus": "Crocodylidae", "Chitra": "Trionychidae",
    "Nilssonia": "Trionychidae", "Lissemys": "Trionychidae", "Kachuga": "Geoemydidae",
    "Pangshura": "Geoemydidae", "Hardella": "Geoemydidae",
}

# Mammal families (printed lists do not give them).
MAMMAL_FAMILY = {
    "Panthera": "Felidae", "Felis": "Felidae", "Caracal": "Felidae",
    "Sus": "Suidae", "Mellivora": "Mustelidae", "Lutrogale": "Mustelidae",
    "Semnopithecus": "Cercopithecidae", "Presbytis": "Cercopithecidae", "Macaca": "Cercopithecidae",
    "Hyaena": "Hyaenidae", "Herpestes": "Herpestidae", "Melursus": "Ursidae",
    "Boselaphus": "Bovidae", "Tetracerus": "Bovidae", "Gazella": "Bovidae", "Antilope": "Bovidae",
    "Lepus": "Leporidae", "Hystrix": "Hystricidae", "Canis": "Canidae", "Vulpes": "Canidae",
    "Viverricula": "Viverridae", "Cervus": "Cervidae", "Axis": "Cervidae",
    "Funambulus": "Sciuridae", "Bandicota": "Muridae", "Rattus": "Muridae", "Mus": "Muridae",
    "Pteropus": "Pteropodidae", "Rousettus": "Pteropodidae", "Manis": "Manidae",
    "Platanista": "Platanistidae",
}

# Species named in the plan's text (Chapter 2) or in the 2020 eco-sensitive zone Gazette notification
# but not in the annexure lists. "find" is the exact printed text the page lookup searches for.
TEXT_MENTIONS = [
    # Tiger Conservation Plan, Chapter 2
    {"source": "tcp", "find": "Anogeissus pendula (Kala Dhok) is the predominant species", "domain": "Flora", "group": "Trees", "scientific": "Anogeissus pendula", "local": "Kala Dhok, Dhok", "status": "predominant species of the plan's main forest type"},
    {"source": "tcp", "find": "Flacourtia indica (Kakan)", "domain": "Flora", "group": "Trees", "scientific": "Flacourtia indica", "local": "Kakan"},
    {"source": "tcp", "find": "Ziziphus glaberrima", "domain": "Flora", "group": "Trees", "scientific": "Ziziphus glaberrima"},
    {"source": "tcp", "find": "Tridax procumbens", "domain": "Flora", "group": "Herbs", "scientific": "Tridax procumbens"},
    {"source": "tcp", "find": "Urginea indica", "domain": "Flora", "group": "Herbs", "scientific": "Urginea indica"},
    {"source": "tcp", "find": "2.5.2.3 Lantana camara", "domain": "Flora", "group": "Shrubs", "scientific": "Lantana camara", "status": "named by the plan as an invasive weed"},
    {"source": "tcp", "find": "2.5.2.4 Parthenium", "domain": "Flora", "group": "Herbs", "scientific": "Parthenium", "status": "named by the plan as an invasive weed", "nameNote": "The plan names only the genus, Parthenium (\"Parthenium weed\")."},
    {"source": "tcp", "find": "Hoplobatrachus tigerinus, Sphaerotheca breviceps", "domain": "Fauna", "group": "Amphibians", "scientific": "Hoplobatrachus tigerinus"},
    {"source": "tcp", "find": "Hoplobatrachus tigerinus, Sphaerotheca breviceps", "domain": "Fauna", "group": "Amphibians", "scientific": "Sphaerotheca breviceps"},
    {"source": "tcp", "find": "Hoplobatrachus tigerinus, Sphaerotheca breviceps", "domain": "Fauna", "group": "Amphibians", "scientific": "Euphlyctis cyanophlyctis"},
    {"source": "tcp", "find": "Hoplobatrachus tigerinus, Sphaerotheca breviceps", "domain": "Fauna", "group": "Amphibians", "scientific": "Bufo andersoni"},
    {"source": "tcp", "find": "Hoplobatrachus tigerinus, Sphaerotheca breviceps", "domain": "Fauna", "group": "Amphibians", "scientific": "Bufo melanostictus"},
    {"source": "tcp", "find": "Hoplobatrachus tigerinus, Sphaerotheca breviceps", "domain": "Fauna", "group": "Amphibians", "scientific": "Microhyla ornata"},
    {"source": "tcp", "find": "Hoplobatrachus tigerinus, Sphaerotheca breviceps", "domain": "Fauna", "group": "Amphibians", "scientific": "Uperodon systoma"},
    # Table 2.2, avifauna with IUCN status as printed
    {"source": "tcp", "find": "Table-2.2: Avifauna with IUCN status", "domain": "Fauna", "group": "Birds", "scientific": "Pericrocotus erythropygius", "common": "White bellied Minivet", "status": "IUCN Least concern (Table 2.2)"},
    {"source": "tcp", "find": "Table-2.2: Avifauna with IUCN status", "domain": "Fauna", "group": "Birds", "scientific": "Anser indicus", "common": "Bar headed Goose", "status": "IUCN Least concern (Table 2.2)"},
    {"source": "tcp", "find": "Table-2.2: Avifauna with IUCN status", "domain": "Fauna", "group": "Birds", "scientific": "Mycteria leucocephala", "common": "Painted Stork", "status": "IUCN Least concern (Table 2.2)"},
    {"source": "tcp", "find": "Table-2.2: Avifauna with IUCN status", "domain": "Fauna", "group": "Birds", "scientific": "Anastomus oscitans", "common": "Asian Openbill", "status": "IUCN Least concern (Table 2.2)"},
    {"source": "tcp", "find": "Table-2.2: Avifauna with IUCN status", "domain": "Fauna", "group": "Birds", "scientific": "Platalea leucorodia", "common": "Eurasian Spoonbill", "status": "IUCN Least concern (Table 2.2)"},
    # Gazette of India, MHTR eco-sensitive zone notification (2020)
    {"source": "esz2020", "find": "Commiphora wightii", "domain": "Flora", "group": "Shrubs", "scientific": "Commiphora wightii", "status": "named among rare, endangered and threatened species"},
    {"source": "esz2020", "find": "Bauhinia vahlii", "domain": "Flora", "group": "Climbers", "scientific": "Bauhinia vahlii", "status": "named among rare, endangered and threatened species"},
    {"source": "esz2020", "find": "Tribulus rajasthanensis", "domain": "Flora", "group": "Herbs", "scientific": "Tribulus rajasthanensis", "status": "named among rare, endangered and threatened species"},
    {"source": "esz2020", "find": "Amorphallus paeonifolius", "domain": "Flora", "group": "Herbs", "scientific": "Amorphophallus paeoniifolius", "printedAs": "Amorphallus paeonifolius", "status": "named among rare, endangered and threatened species"},
]

STATUS_WORDS = {"A": "Abundant", "C": "Common", "L": "Less common", "R": "Rare", "I": "Introduced"}

# Species-account headings in the WII herp guide that break over an extra line the text
# extraction does not pick up; the full printed name is on the same page.
HERP_NAME_FIXES = {
    "Spiny-headed Fan-throated": "Spiny-headed Fan-throated Lizard",
}


def clean(text: str | None) -> str:
    if not text:
        return ""
    # Re-join words that the PDF table broke over two lines ("Scrophulariacea\ne").
    text = re.sub(r"(\w)\n(\w{1,2})\b", r"\1\2", text)
    text = re.sub(r"\s+", " ", text).strip()
    return "" if text in {"--", "—", "–", "-"} else text


def binomial(name: str) -> str:
    name = clean(name)
    m = re.match(r"^([A-Z]?[a-z]+(?:\s+[a-z\-]+){1,2}(?:\s+sp\.)?)", name[0:1].upper() + name[1:])
    return m.group(1) if m else name


def fix(name: str) -> tuple[str, str]:
    """Return (scientific name to show, printed form if it differs)."""
    printed = clean(name)
    corrected = SPELLING.get(printed, printed)
    corrected = re.sub(r"\s*\(.*\)\s*$", "", corrected)  # "Phyllanthus emblica (Emblica officinalis)"
    parts = corrected.split()
    if len(parts) >= 2:  # "Ciconia Ciconia" -> "Ciconia ciconia"
        corrected = " ".join([parts[0][:1].upper() + parts[0][1:]] + [p.lower() for p in parts[1:]])
    corrected = SYNONYMS.get(corrected, corrected)
    return corrected, (printed if corrected != printed else "")


def tcp_tables():
    with pdfplumber.open(DOCS / f"{TCP}.pdf") as pdf:
        return {n: pdf.pages[n - 1].extract_tables() for n in range(262, 287)}


def numbered(rows):
    for row in rows:
        if row and row[0] and re.match(r"^\d+\.?$", clean(row[0])):
            yield [clean(c) for c in row]


def tcp_page(pdf_page: int) -> int:
    return pdf_page - SOURCES["tcp"]["pageOffset"]


def build_flora(tables, rows):
    plan = [
        ("Trees", [(262, 0), (263, 0)]),
        ("Shrubs", [(266, 1)]),
        ("Climbers", [(267, 0), (268, 0)]),
        ("Herbs", [(268, 1), (269, 0), (270, 0), (271, 0), (272, 0)]),
        ("Grasses", [(273, 0), (274, 0)]),
        ("Parasites", [(275, 0)]),
        ("Pteridophytes", [(275, 1)]),
    ]
    for group, parts in plan:
        for pdf_page, index in parts:
            for _, bot, common, family, status in numbered(tables[pdf_page][index]):
                sci, printed = fix(bot)
                rows.append({
                    "domain": "Flora", "group": group, "common": common, "local": "",
                    "scientific": sci, "printedAs": printed, "family": family,
                    "refs": [{"source": "tcp", "page": tcp_page(pdf_page), "status": status}],
                })


def build_mammals(tables, rows):
    # Annexure 6, first mammal list (printed p. 258).
    for _, local, english, sci_raw, status in numbered(tables[276][0]):
        sci, printed = fix(sci_raw)
        rows.append({
            "domain": "Fauna", "group": "Mammals", "common": english, "local": local,
            "scientific": sci, "printedAs": printed,
            "refs": [{"source": "tcp", "page": 258, "status": status}],
        })
    # Annexure 6, "Terrestrial" (printed pp. 264-265) and "Aquatic" (p. 264) lists.
    for pdf_page, index, kind in [(282, 1, "terrestrial"), (283, 0, "terrestrial"), (282, 0, "aquatic")]:
        for _, sci_raw, common in numbered(tables[pdf_page][index]):
            sci, printed = fix(sci_raw)
            genus = sci.split()[0]
            if kind == "aquatic" and genus not in MAMMAL_FAMILY:
                group = "Reptiles"
            else:
                group = "Mammals"
            rows.append({
                "domain": "Fauna", "group": group, "common": "", "local": common,
                "scientific": sci, "printedAs": printed,
                "refs": [{"source": "tcp", "page": tcp_page(pdf_page), "status": ""}],
            })


def split_numbered(cell: str) -> list[str]:
    parts = re.split(r"(?:^|\n)\s*\d+\.\s*", cell or "")
    return [clean(p) for p in parts if clean(p)]


def split_sci(cell: str) -> list[tuple[str, str]]:
    names: list[str] = []
    for line in (cell or "").split("\n"):
        line = line.strip()
        if not line:
            continue
        if names and (line[0].islower() or line.startswith("(") or names[-1].count("(") > names[-1].count(")")):
            names[-1] += " " + line
        else:
            names.append(line)
    out = []
    expanded = []
    for n in names:
        # "Halcyon smyrnensis ceryle rudis": two names printed on one line.
        m = re.fullmatch(r"([A-Z][a-z]+ [a-z]+) ([a-z]+ [a-z]+)", n.strip())
        expanded.extend([m.group(1), m.group(2).capitalize()] if m else [n])
    for n in expanded:
        m = re.match(r"^(.*?)\s*\((.*)\)\s*$", n)
        out.append((clean(m.group(1)), clean(m.group(2))) if m else (clean(n), ""))
    return out


def build_tcp_birds(tables):
    """Annexure 6 bird list, printed pp. 259-262. Returns {scientific: row}."""
    cells = []
    for pdf_page, indexes in [(277, [1, 2]), (278, [0, 1]), (279, [0]), (280, [0])]:
        for index in indexes:
            for row in tables[pdf_page][index]:
                if len(row) == 4:
                    _, eng, sci, status = row
                else:
                    continue
                if clean(eng) == "English Name":
                    continue
                cells.append((pdf_page, eng, sci, status))
    birds = []
    pending: list[str] = []
    for pdf_page, eng, sci, status in cells:
        sci_list = split_sci(sci)
        if eng is None:
            eng_list = pending[:len(sci_list)]
            pending = pending[len(sci_list):]
        elif re.search(r"\d+\.", eng or ""):
            eng_list = split_numbered(eng)
        else:
            lines = [clean(x) for x in (eng or "").split("\n") if clean(x)]
            # A bracketed second line belongs to the name above it.
            merged: list[str] = []
            for line in lines:
                if merged and (line.startswith("(") or merged[-1].endswith("-")):
                    merged[-1] = (merged[-1] + ("" if merged[-1].endswith("-") else " ") + line)
                else:
                    merged.append(line)
            # Two names in one cell with one scientific name: the second waits for the next row.
            if len(merged) > len(sci_list) and len(sci_list) == 1 and all(not m.startswith("(") for m in merged[1:]):
                merged = [merged[0]] + [m for m in merged[1:]]
                eng_list, pending = merged[:1], merged[1:]
            else:
                eng_list = [" ".join(merged)] if len(sci_list) == 1 else merged
        statuses = [clean(s) for s in (status or "").split("\n") if clean(s)]
        aligned = len(statuses) == len(sci_list)
        for i, (sci_name, sci_note) in enumerate(sci_list):
            name, printed = fix(sci_name)
            birds.append({
                "common": eng_list[i] if i < len(eng_list) else "",
                "scientific": name, "printedAs": printed, "sciNote": sci_note,
                "page": tcp_page(pdf_page),
                "status": statuses[i] if aligned else "",
                "statusMisaligned": not aligned,
            })
    return birds


def pdftotext(slug: str) -> list[str]:
    out = subprocess.run(["pdftotext", str(DOCS / f"{slug}.pdf"), "-"], capture_output=True, text=True, check=True)
    return out.stdout.split("\f")


def title_case(name: str) -> str:
    words = []
    for word in name.lower().split():
        parts = word.split("-")
        parts[0] = parts[0][:1].upper() + parts[0][1:]
        words.append("-".join(parts))
    return " ".join(words).replace("’S ", "’s ").replace("'S ", "'s ")


def build_wii_birds():
    pages = pdftotext(BIRDS)
    out = []
    field_re = re.compile(r"^(Schedule|IUCN Status|Feeding Guild|Migratory Status|Habitat|Population Trend Locally)\s*-\s*(.*)$")
    for i, page in enumerate(pages):
        lines = [l.strip() for l in page.split("\n") if l.strip()]
        for j, line in enumerate(lines):
            if not re.match(r"^Schedule\s*-", line):
                continue
            fields = {}
            for k in range(j, min(j + 12, len(lines))):
                m = field_re.match(lines[k])
                if m and m.group(1) not in fields:
                    fields[m.group(1)] = m.group(2).strip()
            sci, printed = fix(lines[j - 1])
            out.append({
                "common": title_case(lines[j - 2]),
                "scientific": sci, "printedAs": printed,
                "page": i + 1 - SOURCES["wiiBirds"]["pageOffset"],
                **fields,
            })
    if len(out) != 219:
        sys.exit(f"Expected 219 species accounts in the WII bird guide, found {len(out)}")
    return out


def build_wii_herps():
    pages = pdftotext(HERPS)
    out = []
    for i, page in enumerate(pages):
        if "Local Status" not in page or "Distribution" not in page:
            continue
        lines = [l.strip() for l in page.split("\n") if l.strip()]
        caps = [k for k, l in enumerate(lines) if re.fullmatch(r"[A-Z’'\- ]{3,}", l) and "AMPHIBIANS" not in l]
        if not caps:
            continue
        # The English name may run over two capital-letter lines.
        name_lines = [lines[caps[0]]]
        if len(caps) > 1 and caps[1] == caps[0] + 1:
            name_lines.append(lines[caps[1]])
        sci_line = next(l for l in lines[caps[0] + 1:] if re.match(r"^[A-Z][a-z]+ [a-z]+", l))
        sci = " ".join(sci_line.split()[:2])
        flat = " ".join(lines)
        if re.search(r"Not listed in Wildlife", flat):
            sched = "Not listed"
        else:
            m = re.search(r"Schedule[- ]?(IV|I{1,2})\b", flat)
            sched = m.group(1) if m else ""
        m = re.search(r"IUCN Status\s*:\s*(Least [Cc]oncern|Near [Tt]hreatened|Vulnerable|Endangered|Critically [Ee]ndangered|Data [Dd]eficient|Not [Aa]ssessed|Not [Ee]valuated)", flat)
        iucn = m.group(1).capitalize() if m else ""
        m = re.search(r"Local Status\s*:\s*(Common|Uncommon|Rare|Abundant|Very rare)", flat, re.I)
        local = m.group(1).lower() if m else ""
        common = title_case(" ".join(name_lines)).replace("- ", "-")
        out.append({
            "common": HERP_NAME_FIXES.get(common, common),
            "scientific": SYNONYMS.get(sci, sci),
            "page": i + 1 - SOURCES["wiiHerps"]["pageOffset"],
            "schedule": sched, "iucn": iucn, "local": local,
        })
    # Families, classes and species without a full account, from the checklist.
    index = next(k for k, p in enumerate(pages) if "CHECKLIST OF HERPETOFAUNA" in p)
    family, klass = "", "Amphibians"
    seen = {rec["scientific"] for rec in out}
    for k in range(index, min(index + 5, len(pages))):
        lines = [l.strip() for l in pages[k].split("\n") if l.strip()]
        for j, line in enumerate(lines):
            if line.startswith("AMPHIBIA"):
                klass = "Amphibians"
            elif line.startswith(("TESTUDINES", "CROCODYLIA", "SQUAMATA", "REPTILIA", "A. LIZARDS", "B. SNAKES")):
                klass = "Reptiles"
            if re.fullmatch(r"[A-Z][a-z]+idae", line):
                family = line
                continue
            m = re.match(r"^(?:\d+\.\s*)?([A-Z][a-z]+ [a-z]+)(?:\s+[a-z]+)?\s*(.*)$", line)
            if not m or (j and not re.match(r"^\d+\.", lines[j - 1]) and not re.match(r"^\d+\.", line)):
                continue
            sci = fix(m.group(1))[0]
            for rec in out:
                if rec["scientific"] == sci:
                    rec["family"], rec["group"] = family, klass
            if sci not in seen:
                seen.add(sci)
                common = m.group(2) or (lines[j + 1] if j + 1 < len(lines) else "")
                out.append({"common": common, "scientific": sci, "family": family, "group": klass,
                            "page": k + 1 - SOURCES["wiiHerps"]["pageOffset"],
                            "schedule": "", "iucn": "", "local": "", "checklistOnly": True})
    for rec in out:
        rec.setdefault("family", "")
        rec.setdefault("group", "Reptiles")
    return out


_TEXT_CACHE: dict[str, list[str]] = {}


def find_page(source: str, needle: str) -> tuple[int, int]:
    """Find the PDF page that prints `needle` and read the printed page number in its footer."""
    slug = SOURCES[source]["slug"]
    if slug not in _TEXT_CACHE:
        out = subprocess.run(["pdftotext", "-layout", str(DOCS / f"{slug}.pdf"), "-"], capture_output=True, text=True, check=True)
        _TEXT_CACHE[slug] = out.stdout.split("\f")
    flat_needle = " ".join(needle.split())
    for index, page in enumerate(_TEXT_CACHE[slug]):
        if flat_needle in " ".join(page.split()):
            lines = [l.strip() for l in page.split("\n") if l.strip()]
            numbers = [l for l in lines[-3:] if re.fullmatch(r"\d{1,3}", l)]
            if source == "esz2020":
                head = re.match(r"^(\d{1,3})\s", lines[0])
                printed = int(head.group(1)) if head else index + 1
            else:
                printed = int(numbers[-1]) if numbers else index + 1 - SOURCES[source]["pageOffset"]
            return index + 1, printed
    sys.exit(f"Could not find {needle!r} in {slug}")


def load_ioc(path: Path | None):
    if not path or not path.exists():
        return {}
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        sci_col = next(c for c in reader.fieldnames if c in {"scientificName", "scientific_name"})
        fam_col = next(c for c in reader.fieldnames if c in {"family", "taxonomy.family"})
        return {row[sci_col]: row[fam_col] for row in reader}


def status_text(ref) -> str:
    code = ref.get("status", "")
    return f"{code} ({STATUS_WORDS[code]})" if code in STATUS_WORDS else code


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ioc", type=Path, help="IOC-based species.csv with scientificName and family columns")
    args = parser.parse_args()
    ioc = load_ioc(args.ioc)

    tables = tcp_tables()
    rows: list[dict] = []
    build_flora(tables, rows)
    build_mammals(tables, rows)

    for _, common, sci_raw, national, local in numbered(tables[281][0]):
        sci, printed = fix(sci_raw)
        rows.append({
            "domain": "Fauna", "group": "Reptiles", "common": common, "local": "",
            "scientific": sci, "printedAs": printed,
            "refs": [{"source": "tcp", "page": 263, "status": local}],
        })
    for pdf_page, index in [(283, 1), (284, 0), (284, 1), (285, 0)]:
        for _, sci_raw, local in numbered(tables[pdf_page][index]):
            sci, printed = fix(sci_raw)
            rows.append({
                "domain": "Fauna", "group": "Fishes", "common": "", "local": local,
                "scientific": sci, "printedAs": printed,
                "refs": [{"source": "tcp", "page": tcp_page(pdf_page), "status": ""}],
            })

    # Merge rows that name the same species in more than one TCP list.
    merged: dict[tuple, dict] = {}
    for row in rows:
        key = (row["domain"], row["scientific"].lower())
        if key in merged:
            old = merged[key]
            for field in ("common", "local", "family", "printedAs"):
                old[field] = old.get(field) or row.get(field, "")
            if row["refs"][0]["page"] not in [r["page"] for r in old["refs"]]:
                old["refs"].append(row["refs"][0])
        else:
            merged[key] = row

    # Birds: WII guide first, then TCP-only species.
    for bird in build_wii_birds():
        key = ("Fauna", bird["scientific"].lower())
        detail = [f"Locally {bird.get('Population Trend Locally', '').lower()}" if bird.get("Population Trend Locally") else "",
                  {"WV": "Winter visitor", "SV": "Summer visitor", "PM": "Passage migrant"}.get(bird.get("Migratory Status", ""), bird.get("Migratory Status", "")),
                  f"IUCN {bird['IUCN Status']}" if bird.get("IUCN Status") else "",
                  f"WPA Schedule {bird['Schedule']}" if bird.get("Schedule") else ""]
        merged[key] = {
            "domain": "Fauna", "group": "Birds", "common": bird["common"], "local": "",
            "scientific": bird["scientific"], "printedAs": bird["printedAs"],
            "family": ioc.get(bird["scientific"], ""),
            "habitat": bird.get("Habitat", ""),
            "refs": [{"source": "wiiBirds", "page": bird["page"], "status": " · ".join(d for d in detail if d)}],
        }
    for bird in build_tcp_birds(tables):
        key = ("Fauna", bird["scientific"].lower())
        ref = {"source": "tcp", "page": bird["page"], "status": bird["status"]}
        if bird["statusMisaligned"]:
            ref["note"] = "status column misaligned in the printed table"
        if key in merged:
            merged[key]["refs"].append(ref)
        else:
            merged[key] = {
                "domain": "Fauna", "group": "Birds", "common": bird["common"], "local": "",
                "scientific": bird["scientific"], "printedAs": bird["printedAs"],
                "family": ioc.get(bird["scientific"], ""),
                "sourceNote": bird["sciNote"],
                "refs": [ref],
            }

    for herp in build_wii_herps():
        key = ("Fauna", herp["scientific"].lower())
        detail = [f"Locally {herp['local'].lower()}" if herp["local"] else "",
                  f"IUCN {herp['iucn']}" if herp["iucn"] else "",
                  ("Not in WPA schedules" if herp["schedule"] == "Not listed" else f"WPA Schedule {herp['schedule']}") if herp["schedule"] else ""]
        ref = {"source": "wiiHerps", "page": herp["page"], "status": " · ".join(d for d in detail if d)}
        if herp.get("checklistOnly"):
            ref["note"] = "checklist only"
        if key in merged:
            row = merged[key]
            row["refs"].insert(0, ref)
            row["family"] = row.get("family") or herp["family"]
            row["group"] = herp["group"]
            row["common"] = herp["common"]
        else:
            merged[key] = {
                "domain": "Fauna", "group": herp["group"], "common": herp["common"], "local": "",
                "scientific": herp["scientific"], "printedAs": "", "family": herp["family"],
                "refs": [ref],
            }

    for mention in TEXT_MENTIONS:
        pdf_page, printed_page = find_page(mention["source"], mention["find"])
        sci, printed = fix(mention["scientific"])
        printed = mention.get("printedAs", printed)
        ref = {"source": mention["source"], "page": printed_page, "pdfPage": pdf_page, "status": mention.get("status", "")}
        key = (mention["domain"], sci.lower())
        if key in merged and printed:
            ref["note"] = f"printed as {printed}"
        if key in merged:
            if (ref["source"], ref["page"]) not in [(r["source"], r["page"]) for r in merged[key]["refs"]]:
                merged[key]["refs"].append(ref)
            continue
        merged[key] = {
            "domain": mention["domain"], "group": mention["group"], "common": mention.get("common", ""),
            "local": mention.get("local", ""), "scientific": sci, "printedAs": printed,
            "family": ioc.get(sci, "") if mention["group"] == "Birds" else "",
            "nameNote": mention.get("nameNote", ""), "refs": [ref],
        }

    final = []
    for row in merged.values():
        genus = row["scientific"].split()[0]
        if row["domain"] == "Fauna" and row["group"] == "Mammals":
            row["family"] = MAMMAL_FAMILY.get(genus, "")
        if row["domain"] == "Fauna" and row["group"] == "Reptiles" and not row.get("family"):
            row["family"] = REPTILE_FAMILY.get(genus, "")
        printed_note = row.get("printedAs") or ""
        note = NAME_NOTES.get(printed_note) or NAME_NOTES.get(row["scientific"])
        if note:
            row["nameNote"] = note
        for ref in row["refs"]:
            if ref["source"] == "tcp":
                ref["status"] = status_text(ref)
        parts = []
        for ref in row["refs"]:
            if not ref.get("status"):
                continue
            label = f"{SOURCES[ref['source']]['short']}: " if len(row["refs"]) > 1 else ""
            parts.append(label + ref["status"] + (f" ({ref['note']})" if ref.get("note") else ""))
        row["statusText"] = "; ".join(parts)
        notes = []
        if row.get("local"):
            notes.append(f"Local name: {row['local']}")
        if row.get("printedAs"):
            notes.append(f"Printed as {row['printedAs']}")
        if row.get("sourceNote"):
            notes.append(f"The plan adds: {row['sourceNote']}")
        if row.get("habitat"):
            notes.append(f"Habitat (WII): {row['habitat']}")
        if row.get("nameNote"):
            notes.append(row["nameNote"])
        row["notes"] = "; ".join(notes)
        final.append({k: v for k, v in row.items() if v not in ("", None)})

    order = ["Trees", "Shrubs", "Climbers", "Herbs", "Grasses", "Parasites", "Pteridophytes",
             "Mammals", "Birds", "Reptiles", "Amphibians", "Fishes"]
    final.sort(key=lambda r: (order.index(r["group"]), r["refs"][0]["source"] != "wiiBirds" if r["group"] == "Birds" else 0))

    data = {
        "schemaVersion": 1,
        "about": "Species named in official records of Mukundara Hills Tiger Reserve, with source and printed page for every row. Built by scripts/build-bio-reference.py.",
        "sources": {key: {k: v for k, v in src.items() if k != "pageOffset"} | {"localPath": f"/assets/docs/resources/{src['slug']}.pdf", "pageOffset": src["pageOffset"]} for key, src in SOURCES.items()},
        "familyNote": "Bird families follow the IOC World Bird List v15.2 (Gill, Donsker & Rasmussen, CC BY 3.0).",
        "rows": final,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    from collections import Counter
    print(len(final), Counter(r["group"] for r in final))


if __name__ == "__main__":
    main()
