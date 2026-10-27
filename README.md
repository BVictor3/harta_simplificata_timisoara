# Timișoara ca un ceas

Hartă simplificată a Timișoarei, făcută ca să reții mai ușor orașul. Merge pe telefon și pe calculator.

- Centrul e mijlocul ceasului, **Bega** e axa vest–est (ora 9 → ora 3).
- Fiecare **cale** poartă numele orașului spre care duce: **Calea Aradului = ora 12**.
- Straturile se pornesc pe rând: 1) centrul, Bega și căile → 2) cartierele → 3) bulevardele și inelele → 4) reperele.
- Buton **„Unde sunt acum?”**: arată cartierul, cea mai apropiată cale și „ora” la care ești față de centru.

## Date

Toate datele vin din [OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL), extrase prin Overpass API
în `data/harta.json`. Pentru a le reîmprospăta:

```bash
python tools/fetch_osm.py
```

## Rulare locală

Pagina citește `data/harta.json` cu `fetch`, deci trebuie servită (nu deschisă direct din fișier):

```bash
python -m http.server 8000
```

apoi <http://localhost:8000>. Pe GitHub Pages merge direct; „Unde sunt acum?” are nevoie de HTTPS.
