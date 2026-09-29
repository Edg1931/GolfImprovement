/* Course map data: import golf features from OpenStreetMap or a file, keep them on the course, and
   derive what the rest of the app needs (hole tees and greens, green front/middle/back).

   course.map = { center:{lat,lon}, source, updated,
                  holes: { "1": { par, tee:{lat,lon}, green:{lat,lon}, line:[{lat,lon}] } },
                  features: [ { type: 'green'|'tee'|'fairway'|'bunker'|'water'|'ob'|'trees', ll:[{lat,lon}], hole? } ] } */

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const FEATURE_LABEL = { green: 'Green', tee: 'Tee', fairway: 'Fairway', bunker: 'Bunker', water: 'Water', ob: 'Out of bounds', trees: 'Trees' };

const CourseMap = {
  round6: v => Math.round(v * 1e6) / 1e6,
  pt(p) { return { lat: this.round6(p.lat), lon: this.round6(p.lon) }; },

  /* Drop points closer than ~1 yard to the previous one (keeps synced data small). */
  simplify(ll) {
    const out = []; ll.forEach(p => { const q = out[out.length - 1]; if (!q || yardsBetween(q, p) >= 1) out.push(this.pt(p)); });
    if (out.length > 3 && yardsBetween(out[0], out[out.length - 1]) < 1) out.pop();   // closed ring: drop the repeat
    return out;
  },

  /* Map OpenStreetMap tags to our feature types. */
  osmType(t) {
    if (!t) return null;
    const g = t.golf;
    if (g === 'green') return 'green';
    if (g === 'tee') return 'tee';
    if (g === 'fairway') return 'fairway';
    if (g === 'bunker') return 'bunker';
    if (g === 'water_hazard' || g === 'lateral_water_hazard' || t.natural === 'water' || t.water) return 'water';
    if (g === 'out_of_bounds') return 'ob';
    if (t.natural === 'wood' || t.landuse === 'forest' || t.natural === 'tree_row') return 'trees';
    return null;
  },

  /* Overpass query for everything golf within `radius` metres of a point. */
  query(center, radius) {
    const a = `(around:${radius || 1500},${center.lat},${center.lon})`;
    return `[out:json][timeout:30];(way["golf"]${a};relation["golf"]${a};way["natural"="water"]${a};relation["natural"="water"]${a};way["natural"="wood"]${a};way["landuse"="forest"]${a};node["golf"="pin"]${a};);out geom;`;
  },

  async fetchOSM(center, radius) {
    const body = 'data=' + encodeURIComponent(this.query(center, radius));
    let lastErr;
    for (const url of OVERPASS) {
      try {
        const r = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        if (r.ok) return await r.json();
        lastErr = new Error('Map service returned ' + r.status);
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Map service unavailable');
  },

  /* Turn an Overpass response into {holes, features}. */
  parseOSM(json) {
    const features = [], holes = {}, pins = [];
    const ring = geom => (geom || []).filter(p => p && p.lat != null).map(p => ({ lat: p.lat, lon: p.lon }));
    (json.elements || []).forEach(el => {
      const t = el.tags || {};
      if (el.type === 'node' && t.golf === 'pin') { pins.push({ lat: el.lat, lon: el.lon, ref: t.ref }); return; }
      if (t.golf === 'hole' && el.geometry) {
        const n = parseInt(t.ref, 10); if (!n || n < 1 || n > 27) return;
        const line = this.simplify(ring(el.geometry)); if (line.length < 2) return;
        holes[n] = { par: parseInt(t.par, 10) || null, handicap: parseInt(t.handicap, 10) || null, line, tee: line[0], green: line[line.length - 1] };
        return;
      }
      const type = this.osmType(t); if (!type) return;
      const polys = el.type === 'relation' ? (el.members || []).filter(m => m.role !== 'inner' && m.geometry).map(m => ring(m.geometry)) : [ring(el.geometry)];
      polys.forEach(ll => { const s = this.simplify(ll); if (s.length >= 3) features.push({ type, ll: s }); });
    });
    // tie each hole to its green polygon and tee box, so the green centre is the real centre
    Object.values(holes).forEach(h => {
      const end = h.line[h.line.length - 1];
      const green = this.nearest(features.filter(f => f.type === 'green'), end, 60);
      if (green) { h.green = this.pt(this.centroidLL(green.ll)); green.hole = +Object.keys(holes).find(k => holes[k] === h); }
      const tee = this.nearest(features.filter(f => f.type === 'tee'), h.line[0], 40);
      if (tee) h.tee = this.pt(this.centroidLL(tee.ll));
    });
    return { holes, features, pins };
  },

  centroidLL(ll) { return { lat: ll.reduce((s, p) => s + p.lat, 0) / ll.length, lon: ll.reduce((s, p) => s + p.lon, 0) / ll.length }; },
  /* Feature whose centre is nearest to `p` (or that contains it), within `maxYds`. */
  nearest(list, p, maxYds) {
    let best = null, bd = Infinity;
    list.forEach(f => {
      const proj = Caddie.projector(p), xy = f.ll.map(proj.toXY);
      const d = Caddie.pointInPolygon({ x: 0, y: 0 }, xy) ? 0 : Caddie.dist({ x: 0, y: 0 }, Caddie.centroid(xy));
      if (d < bd) { bd = d; best = f; }
    });
    return bd <= maxYds ? best : null;
  },

  /* Front, middle and back of a hole's green, measured along the line of play. */
  greenPins(course, holeNo) {
    const h = course.map && course.map.holes[holeNo]; if (!h || !h.green) return null;
    const green = this.nearest((course.map.features || []).filter(f => f.type === 'green'), h.green, 40);
    const from = h.line && h.line.length >= 2 ? h.line[h.line.length - 2] : h.tee;
    if (!green || !from) return { center: h.green };
    // where the line of play (approach point → green centre) crosses the green's edge: nearest = front, farthest = back
    const proj = Caddie.projector(from), c = proj.toXY(h.green), poly = green.ll.map(proj.toXY);
    const L = Math.hypot(c.x, c.y) || 1, u = { x: c.x / L, y: c.y / L };
    const hits = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], e = { x: b.x - a.x, y: b.y - a.y };
      const den = u.x * e.y - u.y * e.x; if (Math.abs(den) < 1e-9) continue;
      const t = (a.x * e.y - a.y * e.x) / den, s = (a.x * u.y - a.y * u.x) / den;   // ray: t·u, edge: a + s·e
      if (s >= 0 && s <= 1 && t > 0) hits.push(t);
    }
    if (hits.length < 2) return { center: h.green };
    const at = t => this.pt(proj.toLL({ x: u.x * t, y: u.y * t }));
    return { front: at(Math.min(...hits)), center: h.green, back: at(Math.max(...hits)) };
  },

  /* Save map data on a course, and fill in green yardages the player hasn't recorded by hand. */
  apply(course, data, source) {
    const map = course.map || { holes: {}, features: [] };
    Object.entries(data.holes || {}).forEach(([n, h]) => { map.holes[n] = Object.assign({}, map.holes[n], h); });
    map.features = (source === 'osm' ? map.features.filter(f => f.source !== 'osm') : map.features).concat((data.features || []).map(f => ({ ...f, source })));
    map.center = data.center || map.center || this.guessCenter(map);
    map.source = source; map.updated = todayISO();
    course.map = map;
    course.greens = course.greens || {};
    Object.keys(map.holes).forEach(n => {
      const i = +n - 1; if (i < 0 || i >= course.pars.length) return;
      const g = course.greens[i];
      if (!g || !g.manual) { const pins = this.greenPins(course, n); if (pins && pins.center) course.greens[i] = Object.assign({}, pins, { fromMap: true }); }
    });
    return { holes: Object.keys(data.holes || {}).length, features: (data.features || []).length };
  },

  guessCenter(map) {
    const pts = [].concat(...Object.values(map.holes).map(h => [h.tee, h.green].filter(Boolean)), ...map.features.map(f => f.ll));
    return pts.length ? this.pt(this.centroidLL(pts)) : null;
  },

  /* ---------- file import (GeoJSON, KML) ---------- */
  typeFromName(name) {
    const n = String(name || '').toLowerCase();
    if (/green/.test(n)) return 'green';
    if (/tee/.test(n)) return 'tee';
    if (/bunker|sand|trap/.test(n)) return 'bunker';
    if (/water|pond|lake|creek|stream|river|hazard/.test(n)) return 'water';
    if (/fairway/.test(n)) return 'fairway';
    if (/\bob\b|out of bounds|o\.b\./.test(n)) return 'ob';
    if (/tree|wood|forest/.test(n)) return 'trees';
    return null;
  },
  holeFromName(name) { const m = /hole\s*#?\s*(\d{1,2})/i.exec(name || '') || /^\s*(\d{1,2})\s*$/.exec(name || ''); return m ? parseInt(m[1], 10) : null; },

  /* Features from GeoJSON: uses properties.golf (OpenStreetMap style), or type/name keywords. */
  parseGeoJSON(gj) {
    const features = [], holes = {};
    const feats = gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : [];
    feats.forEach(f => {
      const pr = f.properties || {}, g = f.geometry; if (!g) return;
      const name = pr.name || pr.title || pr.description || '';
      const toLL = c => ({ lat: c[1], lon: c[0] });
      if (g.type === 'LineString' && (pr.golf === 'hole' || this.holeFromName(name))) {
        const n = parseInt(pr.ref, 10) || this.holeFromName(name); if (!n) return;
        const line = this.simplify(g.coordinates.map(toLL)); holes[n] = { par: parseInt(pr.par, 10) || null, line, tee: line[0], green: line[line.length - 1] };
        return;
      }
      const type = this.osmType(pr) || this.typeFromName(pr.type || pr.golf || name); if (!type) return;
      const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map(p => p[0]) : [];
      rings.forEach(r => { const ll = this.simplify(r.map(toLL)); if (ll.length >= 3) features.push({ type, ll }); });
    });
    return this.finishImport({ holes, features });
  },

  /* Features from KML (Google Earth): Placemark names decide the type ("Hole 3", "Green 3", "Bunker"). */
  parseKML(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('That KML file could not be read.');
    const features = [], holes = {};
    const coords = el => (el ? el.textContent.trim().split(/\s+/) : []).map(t => t.split(',').map(Number)).filter(c => c.length >= 2 && !isNaN(c[0])).map(c => ({ lat: c[1], lon: c[0] }));
    doc.querySelectorAll('Placemark').forEach(pm => {
      const name = (pm.querySelector('name') || {}).textContent || '';
      const line = pm.querySelector('LineString coordinates'), poly = pm.querySelector('Polygon outerBoundaryIs coordinates, Polygon coordinates');
      const hole = this.holeFromName(name);
      if (line && hole) { const l = this.simplify(coords(line)); if (l.length >= 2) holes[hole] = { par: null, line: l, tee: l[0], green: l[l.length - 1] }; return; }
      const type = this.typeFromName(name);
      if (poly && type) { const ll = this.simplify(coords(poly)); if (ll.length >= 3) features.push({ type, ll, hole: hole || undefined }); }
    });
    return this.finishImport({ holes, features });
  },

  finishImport(data) {
    // greens named "Green 3" etc. set that hole's green centre
    data.features.filter(f => f.type === 'green' && f.hole).forEach(f => { const h = data.holes[f.hole] = data.holes[f.hole] || {}; h.green = this.pt(this.centroidLL(f.ll)); });
    Object.values(data.holes).forEach(h => {
      if (!h.line || !h.green) return;
      const g = this.nearest(data.features.filter(f => f.type === 'green'), h.green, 60); if (g) h.green = this.pt(this.centroidLL(g.ll));
    });
    if (!data.features.length && !Object.keys(data.holes).length) throw new Error('No greens, bunkers, water or holes were found in that file.');
    return data;
  },

  /* ---------- per-hole geometry in yards, for the caddie ---------- */
  holeGeometry(course, holeNo, start) {
    const map = course.map || { holes: {}, features: [] };
    const h = map.holes[holeNo] || {};
    const pins = course.greens && course.greens[holeNo - 1];
    const greenLL = h.green || (pins && pins.center) || null;
    const origin = start || h.tee || greenLL || map.center;
    if (!origin) return null;
    const proj = Caddie.projector(origin);
    const near = f => f.ll.some(p => yardsBetween(p, origin) < 700);
    return {
      proj, origin,
      start: proj.toXY(start || h.tee || origin),
      green: greenLL ? proj.toXY(greenLL) : null,
      line: h.line ? h.line.map(proj.toXY) : null,
      features: (map.features || []).filter(near).map(f => ({ type: f.type, xy: f.ll.map(proj.toXY) })),
    };
  },
};
