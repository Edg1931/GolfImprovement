/* OpenStreetMap golf features around a point, for training and checking the course scan. */
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
async function overpass(q) {
  for (let a = 0; a < 3; a++) for (const url of OVERPASS) {
    try { const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'FairwayLab scan training' } }); if (r.ok) return await r.json(); } catch (e) { /* next */ }
    await new Promise(r => setTimeout(r, 4000));
  }
  throw new Error('overpass unavailable');
}
const TYPE = t => t.golf === 'green' ? 'green' : t.golf === 'fairway' ? 'fairway' : t.golf === 'tee' ? 'tee' : t.golf === 'bunker' ? 'bunker'
  : (t.golf === 'water_hazard' || t.golf === 'lateral_water_hazard' || t.natural === 'water') ? 'water' : null;
async function features(lat, lon, radius) {
  const a = `(around:${radius},${lat},${lon})`;
  const j = await overpass(`[out:json][timeout:90];(way["golf"]${a};relation["golf"]${a};way["natural"="water"]${a};relation["natural"="water"]${a};);out geom;`);
  const out = [], holes = [];
  (j.elements || []).forEach(el => {
    const t = el.tags || {};
    if (t.golf === 'hole' && el.geometry) { holes.push({ ref: parseInt(t.ref, 10), par: parseInt(t.par, 10) || null, ll: el.geometry.map(p => ({ lat: p.lat, lon: p.lon })) }); return; }
    const type = TYPE(t); if (!type) return;
    const rings = el.type === 'relation' ? (el.members || []).filter(m => m.role !== 'inner' && m.geometry).map(m => m.geometry) : [el.geometry || []];
    rings.forEach(g => { const ll = g.filter(p => p && p.lat != null).map(p => ({ lat: p.lat, lon: p.lon })); if (ll.length >= 3) out.push({ type, ll }); });
  });
  return { features: out, holes };
}
module.exports = { features, overpass };
