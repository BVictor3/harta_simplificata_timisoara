// Harta simplificată a Timișoarei — toate datele vin din data/harta.json (generat din OSM de tools/fetch_osm.py).
(async function () {
  const D = await fetch("data/harta.json").then((r) => r.json());
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const ll = ([lon, lat]) => [lat, lon];
  const lines = (arr) => arr.map((l) => l.map(ll));

  const map = L.map("map", { preferCanvas: true, zoomSnap: 0.5, zoomControl: true, minZoom: 11, maxZoom: 18 });
  map.attributionControl.setPrefix(false).addAttribution('© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>');

  // ordinea desenării: cartiere < străzi < bulevarde < căi < Bega < etichete
  [["cart", 300], ["strazi", 350], ["bd", 400], ["cai", 420], ["bega", 440], ["ceas", 450]].forEach(([n, z]) => {
    map.createPane(n).style.zIndex = z;
  });

  const label = (p, html, cls, opts = {}) =>
    L.marker(ll(p), {
      icon: L.divIcon({ className: "", html: `<div class="lbl ${cls}" style="transform:translate(-50%,-50%)">${html}</div>`, iconSize: [0, 0] }),
      interactive: false, keyboard: false, ...opts,
    });

  // ---------- utilitare geometrice ----------
  const centru = D.ale_mele.find((m) => m.id === "centru").p;
  const KX = 111.32 * Math.cos((centru[1] * Math.PI) / 180), KY = 110.57;
  const km = (a, b) => Math.hypot((a[0] - b[0]) * KX, (a[1] - b[1]) * KY);
  const azimut = (a, b) => ((Math.atan2((b[0] - a[0]) * KX, (b[1] - a[1]) * KY) * 180) / Math.PI + 360) % 360;
  // ceasul e rotit ca să cadă Calea Aradului fix la ora 12 (vezi mai jos, după ce știm capătul ei)
  let rot = 0;
  const oraDin = (az) => {
    const h = Math.round(((((az - rot) % 360) + 360) % 360 / 30) * 2) / 2 % 12;
    const n = Math.floor(h) || 12;
    return h % 1 ? `${n}½` : `${n}`;
  };
  const destPunct = (az, r) => [
    centru[0] + (Math.sin((az * Math.PI) / 180) * r) / KX,
    centru[1] + (Math.cos((az * Math.PI) / 180) * r) / KY,
  ];
  const segDist = (p, a, b) => {
    const ax = (a[0] - p[0]) * KX, ay = (a[1] - p[1]) * KY, bx = (b[0] - p[0]) * KX, by = (b[1] - p[1]) * KY;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
    return Math.hypot(ax + t * dx, ay + t * dy);
  };
  const distLaLinii = (p, ls) => {
    let best = Infinity;
    for (const l of ls) for (let i = 1; i < l.length; i++) best = Math.min(best, segDist(p, l[i - 1], l[i]));
    return best;
  };
  const inRing = (p, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const ringArea = (r) => Math.abs(r.reduce((s, [x1, y1], i) => { const [x2, y2] = r[(i + 1) % r.length]; return s + x1 * y2 - x2 * y1; }, 0)) / 2;
  const centroid = (r) => {
    let x = 0, y = 0;
    r.forEach((p) => { x += p[0]; y += p[1]; });
    return [x / r.length, y / r.length];
  };

  // ---------- fundal: limite + străzi mărunte ----------
  const tm = D.limite.find((l) => l.nume === "Timișoara");
  const fundal = L.layerGroup().addTo(map);
  D.limite.forEach((l) =>
    L.polygon(l.inele.map((r) => r.map(ll)), {
      pane: "cart", color: "#9aa3ad", weight: 1.2, dashArray: "6 5", fill: l.nume !== "Timișoara",
      fillColor: "#e9c46a", fillOpacity: 0.07, interactive: false,
    }).addTo(fundal)
  );
  L.polyline(lines(D.strazi), { pane: "strazi", color: "#c9c4b8", weight: 0.7, interactive: false }).addTo(fundal);
  L.polyline(lines(D.drumuri_mari), { pane: "strazi", color: "#b3ad9f", weight: 1.3, interactive: false }).addTo(fundal);
  const dumb = D.limite.find((l) => l.nume === "Dumbrăvița");

  // ---------- strat 1: centrul, Bega, căile ----------
  const s1 = L.layerGroup();
  const accent = css("--accent"), water = css("--water");
  L.polyline(lines(D.bega), { pane: "bega", color: water, weight: 5, opacity: 0.9, lineCap: "round" })
    .bindTooltip("Bega — axa vest–est a ceasului", { sticky: true }).addTo(s1);
  // eticheta Begăi: pe cel mai lung segment, spre vest și spre est de centru
  const begaPts = D.bega.flat();
  const vest = begaPts.reduce((a, b) => (b[0] < a[0] ? b : a));
  const est = begaPts.reduce((a, b) => (b[0] > a[0] ? b : a));
  [vest, est].forEach((p, i) => {
    const q = begaPts.reduce((a, b) => (Math.abs(b[0] - (centru[0] + (p[0] - centru[0]) * 0.55)) < Math.abs(a[0] - (centru[0] + (p[0] - centru[0]) * 0.55)) ? b : a));
    label([q[0], q[1] - 0.0025], i ? "Bega → est (ora 3)" : "Bega ← vest (ora 9)", "lbl-bega").addTo(s1);
  });

  L.circle(ll(centru), { pane: "cai", radius: 450, color: accent, weight: 2, fillColor: accent, fillOpacity: 0.12 })
    .bindTooltip("Centrul — mijlocul ceasului", { sticky: true }).addTo(s1);

  const orasPeCale = Object.fromEntries(D.orase.map((o) => [o.cale, o]));
  // căile mari (spre orașe) sunt în stratul 1; cele spre comunele din jur intră la stratul 3
  const ORASE_MARI = ["Arad", "Lipova", "Lugoj", "Buziaș", "Șag", "Sânnicolau Mare"];
  const MARI = new Set(D.orase.filter((o) => ORASE_MARI.includes(o.oras)).map((o) => o.cale));
  const caiInfo = Object.entries(D.cai).filter(([n]) => orasPeCale[n]).map(([nume, ls]) => {
    const pts = ls.flat();
    const max = Math.max(...pts.map((p) => km(p, centru)));
    const capat = pts.find((p) => km(p, centru) === max);
    // „ora” unei căi = direcția orașului spre care duce
    return { nume, ls, capat, az: orasPeCale[nume].azimut, oras: orasPeCale[nume], mare: MARI.has(nume) };
  });
  const arad = D.orase.find((o) => o.oras === "Arad");
  if (arad) rot = arad.azimut;

  // cadranul: 12 gradații + spițe spre orașele reale (poziția lor din OSM)
  const ceas = L.layerGroup();
  const R = 7.6;
  L.circle(ll(centru), { pane: "ceas", radius: R * 1000, color: "#8a94a0", weight: 1, dashArray: "2 6", fill: false, interactive: false }).addTo(ceas);
  for (let h = 1; h <= 12; h++) {
    const az = h * 30 + rot;
    L.polyline([ll(destPunct(az, R - 0.25)), ll(destPunct(az, R + 0.25))], { pane: "ceas", color: "#8a94a0", weight: h % 3 ? 1.5 : 3, interactive: false }).addTo(ceas);
    label(destPunct(az, R + 0.65), String(h), "lbl-ora").addTo(ceas);
  }
  D.orase.forEach((o) => {
    if (!ORASE_MARI.includes(o.oras)) return;
    L.polyline([ll(destPunct(o.azimut, 0.6)), ll(destPunct(o.azimut, R))], { pane: "ceas", color: accent, weight: 1, opacity: 0.45, dashArray: "1 5", interactive: false }).addTo(ceas);
    label(destPunct(o.azimut, R + 1.7), `${o.oras}<small>${o.km} km</small>`, "lbl-cale lbl-dest").addTo(ceas);
  });

  // ---------- strat 3: bulevardele și inelele ----------
  const s3 = L.layerGroup();

  caiInfo.forEach((c) => {
    const ora = oraDin(c.az);
    const fosta = c.oras.fosta ? ` (fosta ${c.oras.fosta})` : "";
    L.polyline(lines(c.ls), { pane: "cai", color: accent, weight: c.mare ? 5 : 3, opacity: c.mare ? 0.95 : 0.7, lineCap: "round" })
      .bindTooltip(`${c.nume}${fosta} → ${c.oras.oras} · ora ${ora}`, { sticky: true }).addTo(c.mare ? s1 : s3);
    label(c.capat, `${c.nume}<small>${c.oras.fosta ? "fosta " + c.oras.fosta + " · " : ""}→ ${c.oras.oras} · ora ${ora}</small>`,
      c.mare ? "lbl-cale" : "lbl-cale lbl-cale-mica").addTo(c.mare ? s1 : s3);
  });

  // ---------- strat 2: cartierele ----------
  const s2 = L.layerGroup();
  const PALETA = ["#f4a261", "#8ecae6", "#b5e48c", "#e9c46a", "#cdb4db", "#ffafcc", "#90dbf4", "#f9c74f", "#a3c4f3", "#c7f9cc", "#ffd6a5", "#bde0fe"];
  const cuPoligon = D.cartiere.filter((c) => c.inele.length).sort((a, b) => ringArea(b.inele[0]) - ringArea(a.inele[0]));
  cuPoligon.forEach((c, i) => {
    L.polygon(c.inele.map((r) => r.map(ll)), {
      pane: "cart", color: PALETA[i % PALETA.length], weight: 1, opacity: 0.8,
      fillColor: PALETA[i % PALETA.length], fillOpacity: 0.32,
    }).bindTooltip(c.nume, { sticky: true }).addTo(s2);
  });
  D.cartiere.forEach((c) => {
    const p = c.eticheta || (c.inele.length && centroid(c.inele[0]));
    if (p) label(p, c.nume, "lbl-cart" + (c.tip === "neighbourhood" ? " lbl-mic" : "")).addTo(s2);
  });

  const bd = css("--bd"), ring = css("--ring");
  const etichetaPeLinie = (ls) => {
    const l = ls.reduce((a, b) => (b.length > a.length ? b : a));
    return l[Math.floor(l.length / 2)];
  };
  const alteCai = Object.entries(D.cai).filter(([n]) => !orasPeCale[n]);
  [...Object.entries(D.bulevarde), ...alteCai].forEach(([nume, ls]) => {
    L.polyline(lines(ls), { pane: "bd", color: bd, weight: 2.4, opacity: 0.85 }).bindTooltip(nume, { sticky: true }).addTo(s3);
    label(etichetaPeLinie(ls), nume.replace(/^Bulevardul /, "Bd. ").replace(/^Splaiul /, "Spl. "), "lbl-bd").addTo(s3);
  });
  Object.entries(D.inele).forEach(([nume, ls]) => {
    L.polyline(lines(ls), { pane: "bd", color: ring, weight: 3.5, opacity: 0.85, dashArray: "8 5" }).bindTooltip(nume, { sticky: true }).addTo(s3);
    label(etichetaPeLinie(ls), nume, "lbl-bd lbl-inel").addTo(s3);
  });

  // ---------- strat 4: reperele ----------
  const s4 = L.layerGroup();
  const CAT = {
    gara: ["#1d4ed8", "Gară"], mall: ["#db2777", "Mall"], catedrala: ["#7c2d12", "Catedrală"], spital: ["#dc2626", "Spital"],
    universitate: ["#0f766e", "Universitate"], stadion: ["#15803d", "Stadion"], piata: ["#a16207", "Piață"],
    parc: ["#4d7c0f", "Parc"], aeroport: ["#475569", "Aeroport"],
  };
  D.repere.forEach((r) => {
    const [col, cat] = CAT[r.cat] || ["#555", r.cat];
    L.circleMarker(ll(r.p), { radius: 6, color: "#fff", weight: 2, fillColor: col, fillOpacity: 1 })
      .bindPopup(`<b>${r.nume}</b><br>${cat}`).addTo(s4);
    L.marker(ll(r.p), {
      icon: L.divIcon({ className: "", html: `<div class="lbl lbl-rep" style="color:${col};transform:translate(10px,-50%)">${r.nume}</div>`, iconSize: [0, 0] }),
      interactive: false, keyboard: false,
    }).addTo(s4);
  });

  // ---------- locurile mele ----------
  const mine = L.layerGroup();
  const ul = document.querySelector("#mine-list ul");
  D.ale_mele.forEach((m) => {
    const az = azimut(centru, m.p), d = km(centru, m.p);
    const unde = m.id === "centru" ? "mijlocul ceasului" : `ora ${oraDin(az)}, la ${d.toFixed(1)} km de centru`;
    const scurt = m.nume.split(" — ")[0].split(" (")[0];
    L.marker(ll(m.p), {
      icon: L.divIcon({ className: "mine-icon", html: `★<span class="lbl lbl-mine">${scurt}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
      zIndexOffset: 1000,
    })
      .bindPopup(`<b>${m.nume}</b><br>${unde}<br><a href="https://www.openstreetmap.org/${m.osm}" target="_blank" rel="noopener">vezi în OSM</a>`)
      .addTo(mine);
    const li = document.createElement("li");
    li.innerHTML = `★ ${m.nume} <small>— ${unde}</small>`;
    li.onclick = () => map.flyTo(ll(m.p), 15);
    ul.appendChild(li);
  });

  // ---------- comenzi ----------
  const straturi = { 1: s1, 2: s2, 3: s3, 4: s4 };
  const boxes = [...document.querySelectorAll("#layers input")];
  const store = {
    get: () => { try { return JSON.parse(localStorage.getItem("tm-straturi")); } catch { return null; } },
    set: (v) => { try { localStorage.setItem("tm-straturi", JSON.stringify(v)); } catch {} },
  };
  const salvat = store.get();
  if (Array.isArray(salvat)) boxes.forEach((b) => (b.checked = salvat.includes(b.dataset.layer)));
  const sync = () => {
    boxes.forEach((b) => (b.checked ? straturi[b.dataset.layer].addTo(map) : straturi[b.dataset.layer].remove()));
    store.set(boxes.filter((b) => b.checked).map((b) => b.dataset.layer));
    document.getElementById("next").disabled = boxes.every((b) => b.checked);
  };
  boxes.forEach((b) => b.addEventListener("change", sync));
  document.getElementById("next").onclick = () => {
    const b = boxes.find((x) => !x.checked);
    if (b) { b.checked = true; sync(); }
  };
  document.getElementById("reset").onclick = () => {
    boxes.forEach((b, i) => (b.checked = i === 0));
    sync();
    map.fitBounds(L.polygon(tm.inele.map((r) => r.map(ll))).getBounds(), { padding: [10, 10] });
  };
  const toggle = (id, layer) => {
    const el = document.getElementById(id);
    const f = () => (el.checked ? layer.addTo(map) : layer.remove());
    el.addEventListener("change", f);
    f();
  };
  toggle("t-clock", ceas);
  toggle("t-mine", mine);
  sync();

  const panel = document.getElementById("panel"), col = document.getElementById("collapse");
  col.onclick = () => {
    const c = panel.classList.toggle("collapsed");
    col.setAttribute("aria-expanded", String(!c));
  };
  if (innerWidth <= 640) col.onclick();

  // etichetele mărunte apar doar la zoom mai mare
  const zoomCls = () => {
    const z = map.getZoom(), c = map.getContainer().classList;
    c.toggle("z13", z >= 13); c.toggle("z14", z >= 14); c.toggle("z15", z >= 15);
  };
  map.on("zoomend", zoomCls);

  document.getElementById("gen").textContent = `extras ${D.generat}`;
  const bTm = L.polygon(tm.inele.map((r) => r.map(ll))).getBounds();
  map.setMaxBounds(bTm.pad(0.6));
  map.fitBounds(bTm, { padding: [10, 10] });
  zoomCls();

  // ---------- Unde sunt acum? ----------
  let meMarker;
  const where = document.getElementById("where");
  const descrie = (p) => {
    const inCart = D.cartiere
      .filter((c) => c.inele.some((r) => inRing(p, r)))
      .sort((a, b) => ringArea(a.inele[0]) - ringArea(b.inele[0]));
    let cart;
    // unele cartiere (Dacia, Cetate, Bucovina…) au în OSM doar un punct, nu un contur
    const zona = D.cartiere
      .filter((c) => !c.inele.length && c.eticheta)
      .map((c) => ({ c, d: km(p, c.eticheta) }))
      .sort((a, b) => a.d - b.d)[0];
    const zonaTxt = zona && zona.d < 0.8 ? ` (zona <b>${zona.c.nume}</b>)` : "";
    if (inCart.length) cart = `Ești în cartierul <b>${inCart[0].nume}</b>${zonaTxt}`;
    else if (zonaTxt) cart = `Ești în zona <b>${zona.c.nume}</b>`;
    else {
      const aproape = D.cartiere
        .map((c) => ({ c, d: km(p, c.eticheta || centroid(c.inele[0])) }))
        .sort((a, b) => a.d - b.d)[0];
      cart = aproape.d < 2 ? `Ești lângă <b>${aproape.c.nume}</b> (${aproape.d.toFixed(1)} km)` : "Nu ești într-un cartier din hartă";
    }
    const inOras = tm.inele.some((r) => inRing(p, r)) ? "" : " (în afara municipiului Timișoara)";
    const cale = caiInfo.map((c) => ({ c, d: distLaLinii(p, c.ls) })).sort((a, b) => a.d - b.d)[0];
    const d = km(centru, p);
    return `${cart}${inOras}.<br>Cea mai apropiată cale: <b>${cale.c.nume}</b> → ${cale.c.oras.oras}, la ${
      cale.d < 1 ? Math.round(cale.d * 1000) + " m" : cale.d.toFixed(1) + " km"}.<br>Pe ceas: <b>ora ${oraDin(azimut(centru, p))}</b>, la ${d.toFixed(1)} km de centru.`;
  };
  document.getElementById("locate").onclick = () => {
    where.hidden = false;
    if (!navigator.geolocation) { where.textContent = "Browserul nu oferă localizare."; return; }
    where.textContent = "Caut poziția…";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = [pos.coords.longitude, pos.coords.latitude];
        if (meMarker) meMarker.remove();
        meMarker = L.marker(ll(p), { icon: L.divIcon({ className: "me-icon", iconSize: [18, 18] }) }).addTo(map);
        if (km(centru, p) > 40) { where.innerHTML = `Ești la ${km(centru, p).toFixed(0)} km de Timișoara — prea departe pentru hartă.`; return; }
        where.innerHTML = descrie(p);
        map.flyTo(ll(p), 15);
      },
      (err) => { where.textContent = err.code === 1 ? "Ai refuzat accesul la locație." : "Nu am putut afla poziția."; },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  };
})();
