"""Descarcă datele hărții din OpenStreetMap (Overpass API) și scrie data/harta.json.

Rulare:  python tools/fetch_osm.py
Nimic din hartă nu e scris de mână: geometriile, numele și pozițiile vin din OSM.
Scriptul doar alege ce se arată (filtre după tag-uri și nume) și simplifică liniile.
"""
import json, math, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
OUT = Path(__file__).resolve().parent.parent / "data" / "harta.json"
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
# Timișoara + Dumbrăvița + zona Flex de pe Calea Torontalului
BBOX = "45.70,21.11,45.83,21.33"


def overpass(query):
    body = urllib.parse.urlencode({"data": "[out:json][timeout:180];" + query}).encode()
    for attempt in range(3):
        for ep in ENDPOINTS:
            try:
                req = urllib.request.Request(ep, data=body, headers={"User-Agent": "harta-simplificata-timisoara/1.0"})
                with urllib.request.urlopen(req, timeout=300) as r:
                    return json.load(r)["elements"]
            except Exception as ex:
                print(f"  ! {ep}: {ex}", file=sys.stderr)
        time.sleep(10)
    raise SystemExit("Overpass indisponibil")


# ---------- geometrie ----------

def simplify(pts, tol):
    """Douglas–Peucker pe coordonate [lon, lat] (toleranța în grade)."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]; bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        L = dx * dx + dy * dy
        best, idx = 0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if L == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
                d = math.hypot(px - ax - t * dx, py - ay - t * dy)
            if d > best:
                best, idx = d, i
        if best > tol:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(pts, keep) if k]


def line(geom, tol=0.00002):
    pts = [[round(p["lon"], 5), round(p["lat"], 5)] for p in geom if p]
    return simplify(pts, tol)


def join_rings(ways):
    """Unește căile unui multipoligon în inele închise."""
    segs = [[(p["lon"], p["lat"]) for p in w["geometry"]] for w in ways]
    rings = []
    while segs:
        ring = segs.pop(0)
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == ring[-1]:
                    ring += s[1:]
                elif s[-1] == ring[-1]:
                    ring += s[::-1][1:]
                elif s[-1] == ring[0]:
                    ring = s + ring[1:]
                elif s[0] == ring[0]:
                    ring = s[::-1] + ring[1:]
                else:
                    continue
                segs.pop(i)
                changed = True
                break
        if len(ring) > 3:
            rings.append(simplify([[round(x, 5), round(y, 5)] for x, y in ring], 0.00008))
    return rings


def center(e):
    if "center" in e:
        return [round(e["center"]["lon"], 5), round(e["center"]["lat"], 5)]
    return [round(e["lon"], 5), round(e["lat"], 5)]


def area_deg2(ring):
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:]))) / 2


def bearing(a, b):
    lat1, lat2 = math.radians(a[1]), math.radians(b[1])
    dl = math.radians(b[0] - a[0])
    y = math.sin(dl) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def dist_km(a, b):
    return math.hypot((a[0] - b[0]) * 111.32 * math.cos(math.radians(a[1])), (a[1] - b[1]) * 110.57)


# ---------- descărcare ----------
data = {"sursa": "© OpenStreetMap contributors (ODbL), extras prin Overpass API",
        "generat": time.strftime("%Y-%m-%d")}

print("Limite administrative (Timișoara, Dumbrăvița)…")
data["limite"] = []
for e in overpass('rel["boundary"="administrative"]["admin_level"="8"]["name"~"^(Timișoara|Dumbrăvița)$"];out geom;'):
    outers = [m for m in e["members"] if m["type"] == "way" and m.get("role") in ("outer", "") and "geometry" in m]
    data["limite"].append({"nume": e["tags"]["name"], "inele": join_rings(outers)})

print("Bega…")
data["bega"] = [line(w["geometry"], 0.00003) for w in overpass(f'way["waterway"~"canal|river"]["name"="Bega"]({BBOX});out geom;')]

print("Străzi mărunte…")
minor_q = (f'way["highway"~"^(residential|unclassified|living_street|tertiary|secondary|primary|trunk|motorway|'
           f'tertiary_link|secondary_link|primary_link|trunk_link|motorway_link)$"]({BBOX});out geom;')
roads = overpass(minor_q)
data["strazi"] = [line(w["geometry"]) for w in roads if w["tags"]["highway"] not in ("primary", "trunk", "motorway")]
data["drumuri_mari"] = [line(w["geometry"]) for w in roads if w["tags"]["highway"] in ("primary", "trunk", "motorway")]

DRIVABLE = re.compile(r"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential)(_link)?$")

def named_group(pattern):
    groups = {}
    for w in roads:
        n = w["tags"].get("name", "")
        if re.match(pattern, n) and DRIVABLE.match(w["tags"]["highway"]):
            groups.setdefault(n, []).append(line(w["geometry"]))
    return groups

print("Căile, bulevardele, centurile…")
data["cai"] = named_group(r"^Calea ")
data["bulevarde"] = named_group(r"^(Bulevardul|Splaiul) ")
data["inele"] = named_group(r"^(Centura Timișoara|Inelul|Calea Circumvalațiunii$)")
# Centura sud e parțial trunk/motorway în afara bbox-ului principal → luată separat pe relații
for e in overpass('rel["type"="route"]["route"="road"]["name"~"Centura Timi"];way(r);out geom;'):
    n = e["tags"].get("name") or "Centura Timișoara"
    if n.startswith("Centura Timi"):
        data["inele"].setdefault(n, [])
        ln = line(e["geometry"])
        if ln not in data["inele"][n]:
            data["inele"][n].append(ln)

print("Cartiere…")
cart = {}
for e in overpass(f'(way["place"~"suburb|quarter|neighbourhood"]({BBOX});rel["place"~"suburb|quarter|neighbourhood"]({BBOX}););out geom;'):
    n = e["tags"]["name"]
    if e["type"] == "way":
        rings = [simplify([[round(p["lon"], 5), round(p["lat"], 5)] for p in e["geometry"]], 0.00008)]
    else:
        rings = join_rings([m for m in e["members"] if m["type"] == "way" and m.get("role") == "outer"])
    cart.setdefault(n, {"nume": n, "inele": [], "tip": e["tags"]["place"]})["inele"] += rings
labels = overpass(f'node["place"~"suburb|quarter|neighbourhood"]({BBOX});out;')
for e in labels:
    n = e["tags"]["name"]
    # nodul are uneori alt nume decât poligonul („Braytim-Timișoara Sud” vs „Braytim - Timișoara Sud”)
    key = next((k for k in cart if re.sub(r"\W", "", k) == re.sub(r"\W", "", n)), n)
    c = cart.setdefault(key, {"nume": n, "inele": [], "tip": e["tags"]["place"]})
    c["eticheta"] = center(e)
data["cartiere"] = sorted(cart.values(), key=lambda c: c["nume"])

print("Repere…")
REPERE = [
    ("gara", 'nwr["railway"="station"]["name"~"^Timișoara"]', None),
    ("mall", 'nwr["shop"="mall"]', None),
    ("catedrala", 'nwr["amenity"="place_of_worship"]["name"~"Catedrala|Domul"]', None),
    ("spital", 'nwr["amenity"="hospital"]["name"]', r"Județean|Municipal|Copii|Victor Babeș|Militar|Cardio|Bega|Neuro|CF|Louis"),
    ("universitate", 'nwr["amenity"="university"]["name"]', r"^Universitatea"),
    ("stadion", 'nwr["leisure"="stadium"]["name"]', None),
    ("piata", 'nwr["place"="square"]["name"~"Victoriei|Unirii|Libertății|Dacia|Traian|Operei"]', None),
    ("parc", 'nwr["leisure"="park"]["name"~"Botanic|Rozelor|Central|Copiilor|Catedralei|Civic"]', None),
    ("aeroport", 'nwr["aeroway"="aerodrome"]["iata"]', None),
]
data["repere"] = []
seen = set()
for cat, sel, keep in REPERE:
    big = "45.68,21.08,45.86,21.36" if cat == "aeroport" else BBOX
    for e in overpass(f'{sel}({big});out center tags;'):
        n = e["tags"].get("name")
        if not n or (keep and not re.search(keep, n)):
            continue
        p = center(e)
        # același obiect mapat de două ori (nume ușor diferite, la câțiva metri) → îl păstrăm o dată
        if (cat, n) in seen or any(r["cat"] == cat and dist_km(r["p"], p) < 0.1 for r in data["repere"]):
            continue
        seen.add((cat, n))
        data["repere"].append({"cat": cat, "nume": n, "p": p})

print("Locurile mele…")
def find_one(sel, area=BBOX):
    els = overpass(f'{sel}({area});out center tags;')
    if not els:
        raise SystemExit(f"Nu am găsit în OSM: {sel}")
    return els[0]

flex = find_one('way["landuse"="industrial"]["name"~"^Flex"]', "45.60,20.95,45.95,21.55")
flex_p = center(flex)
# pe ce drum e Flex? cel mai apropiat punct de pe DN6
dn6 = overpass('rel["type"="route"]["route"="road"]["ref"="DN6"];way(r);out geom;')
best = min(((dist_km(flex_p, [p["lon"], p["lat"]]), w["tags"].get("name", "DN6")) for w in dn6 for p in w["geometry"]))
mine = [
    ("acasa", "Acasă — zona Piața Dacia", find_one('nwr["amenity"="marketplace"]["name"="Piața Dacia"]')),
    ("serviciu", f"Serviciu — {flex['tags']['name']} (DN6, {best[1]}, la {best[0]*1000:.0f} m de drum)", flex),
    ("parc", "Parcul Botanic", find_one('nwr["leisure"="park"]["name"~"Botanic"]')),
    ("centru", "Centrul — Piața Victoriei", find_one('nwr["place"="square"]["name"="Piața Victoriei"]')),
    ("dumbravita", "Dumbrăvița", find_one('node["place"="village"]["name"="Dumbrăvița"]')),
    ("mall", "Iulius Mall (Iulius Town)", find_one('nwr["shop"="mall"]["name"~"Iulius"]')),
]
data["ale_mele"] = [{"id": i, "nume": n, "p": center(e), "osm": f"{e['type']}/{e['id']}"} for i, n, e in mine]
print(f"  Flex: cel mai aproape de DN6 pe „{best[1]}” ({best[0]*1000:.0f} m)")

print("Orașele spre care duc căile…")
CENTRU = data["ale_mele"][3]["p"]
# „Calea X” → orașul X (forma de bază e luată din numele străzii, poziția din OSM)
DEST = {
    "Calea Aradului": "Arad", "Calea Lipovei": "Lipova", "Calea Lugojului": "Lugoj",
    "Calea Buziașului": "Buziaș", "Calea Șagului": "Șag", "Calea Torontalului": "Sânnicolau Mare",
    "Calea Moșniței": "Moșnița Nouă", "Calea Ghirodei": "Ghiroda", "Calea Chișodei": "Chișoda",
    "Calea Sânandreiului": "Sânandrei", "Calea Urseni": "Urseni", "Calea Becicherecului": "Becicherecu Mic",
}
names = "|".join(sorted(set(DEST.values())))
towns = {e["tags"]["name"]: center(e) for e in overpass(f'node["place"~"city|town|village"]["name"~"^({names})$"](45.4,20.5,46.3,22.2);out;')}
# unele căi au fost redenumite; OSM păstrează vechiul nume în old_name (Calea Lipovei → Calea Sever Bocu)
old_names = {w["tags"]["old_name"]: w["tags"]["name"] for w in roads if "old_name" in w["tags"] and "name" in w["tags"]}
data["orase"] = []
for cale, oras in DEST.items():
    if oras in towns:
        p = towns[oras]
        b = bearing(CENTRU, p)
        o = {"cale": cale, "oras": oras, "p": p, "azimut": round(b, 1), "km": round(dist_km(CENTRU, p))}
        if cale not in data["cai"] and old_names.get(cale) in data["cai"]:
            o["cale"], o["fosta"] = old_names[cale], cale
        # ora pe ceas o calculează pagina (ceasul e rotit ca Calea Aradului să fie la 12)
        data["orase"].append(o)

# căile care nu apar în OSM nici cu numele actual, nici ca old_name — raportăm, nu inventăm
missing = [c for c in DEST if c not in data["cai"] and c not in old_names]
if missing:
    print("  ! Nu există în OSM cu numele acesta:", ", ".join(missing))

OUT.parent.mkdir(exist_ok=True)
OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"Scris {OUT} ({OUT.stat().st_size/1024:.0f} KB): {len(data['strazi'])} străzi, {len(data['cai'])} căi, "
      f"{len(data['bulevarde'])} bulevarde, {len(data['cartiere'])} cartiere, {len(data['repere'])} repere")
