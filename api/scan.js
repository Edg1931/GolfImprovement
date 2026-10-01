/* Course scan: read the satellite photo around a course and find its greens, tees, bunkers and water,
   then match tees to greens with the scorecard.
     POST /api/scan  { lat, lon, radius?, pars:[…], yards:[…]?, known:{ "3": {tee, green} }? }
       -> { holes: { "1": {tee, green, cost} }, features: [ {type, ll} ], found: {…}, ms }
   The photo tiles come from Esri World Imagery, the same imagery the app's maps show. */

const jpeg = require('jpeg-js');
const scan = require('../lib/scan.js');

const TILE = (z, y, x) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

async function fetchTile(z, x, y) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(TILE(z, y, x), { headers: { 'User-Agent': 'FairwayLab course scan' } });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      return jpeg.decode(buf, { useTArray: true, formatAsRGBA: false, maxMemoryUsageInMB: 64 });
    } catch (e) { /* try once more */ }
  }
  return null;
}

/* Fetch the tiles in the plan, a few at a time, into one RGB picture. */
async function mosaic(plan) {
  const rgb = new Uint8Array(plan.W * plan.H * 3), jobs = [];
  for (let j = 0; j < plan.ny; j++) for (let i = 0; i < plan.nx; i++) jobs.push([i, j]);
  let missing = 0, next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const [i, j] = jobs[next++];
      const img = await fetchTile(plan.z, plan.tx0 + i, plan.ty0 + j);
      if (!img || img.width !== 256 || img.height !== 256) { missing++; continue; }
      const d = img.data, ch = d.length / (256 * 256);
      for (let y = 0; y < 256; y++) {
        const row = ((j * 256 + y) * plan.W + i * 256) * 3;
        for (let x = 0; x < 256; x++) { const s = (y * 256 + x) * ch, t = row + x * 3; rgb[t] = d[s]; rgb[t + 1] = d[s + 1]; rgb[t + 2] = d[s + 2]; }
      }
    }
  };
  await Promise.all(Array.from({ length: 16 }, worker));
  return { rgb, missing, tiles: jobs.length };
}

const num = v => { const n = parseFloat(v); return isFinite(n) ? n : null; };
const ll = p => p && num(p.lat) != null && num(p.lon) != null ? { lat: num(p.lat), lon: num(p.lon) } : null;

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = []; for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8'); return text ? JSON.parse(text) : {};
}

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  const send = (code, body) => { res.statusCode = code; res.end(JSON.stringify(body)); };
  let input;
  try {
    if (req.method === 'POST') input = await readBody(req);
    else { const u = new URL(req.url, 'http://x'); input = Object.fromEntries(u.searchParams); if (input.pars) input.pars = input.pars.split(',').map(Number); if (input.yards) input.yards = input.yards.split(',').map(Number); }
  } catch (e) { return send(400, { error: 'bad_request' }); }
  const lat = num(input.lat), lon = num(input.lon);
  if (lat == null || lon == null || Math.abs(lat) > 80 || Math.abs(lon) > 180) return send(400, { error: 'bad_location' });
  const radius = Math.min(1600, Math.max(400, num(input.radius) || 1300));
  const pars = Array.isArray(input.pars) ? input.pars.slice(0, 27).map(p => Math.round(num(p)) || 4) : [];
  const yards = Array.isArray(input.yards) ? input.yards.slice(0, pars.length).map(y => num(y) || null) : null;
  const known = {};
  if (input.known && typeof input.known === 'object') Object.entries(input.known).slice(0, 27).forEach(([k, h]) => { if (h && ll(h.tee) && ll(h.green)) known[k] = { tee: ll(h.tee), green: ll(h.green) }; });

  const t0 = Date.now();
  try {
    const plan = scan.tilePlan({ lat, lon }, radius, 17, 144);
    const { rgb, missing, tiles } = await mosaic(plan);
    if (missing > tiles / 2) return send(502, { error: 'imagery_unavailable' });
    const tFetch = Date.now() - t0;
    const out = scan.scanCourse(rgb, plan, { pars, yards }, known);
    res.setHeader('Cache-Control', 'public, s-maxage=604800');   // the photo rarely changes
    send(200, { holes: out.holes, features: out.features, found: out.found, tiles, missing, ms: { fetch: tFetch, total: Date.now() - t0 } });
  } catch (e) {
    console.error('Course scan failed', e && e.message);
    send(500, { error: 'scan_failed' });
  }
}

module.exports = handler;
module.exports.mosaic = mosaic;
