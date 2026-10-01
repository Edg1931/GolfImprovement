/* How well the course scan does on real courses that OpenStreetMap already has mapped hole by hole.
   For each course: fetch the mapped holes (the answer), scan the satellite photo without them, and
   count holes whose green and tee the scan got right. Run: node tests/scan-eval/eval.js */
const scan = require('../../lib/scan.js');
const { mosaic } = require('../../api/scan.js');

const COURSES = [
  ['Pebble Beach', 36.5680, -121.9480], ['Torrey Pines South', 32.8990, -117.2520], ['TPC Sawgrass', 30.1980, -81.3960],
  ['Pinehurst No. 2', 35.1900, -79.4680], ['Augusta National', 33.5030, -82.0220], ['Chambers Bay', 47.2010, -122.5730],
  ['TPC Harding Park', 37.7240, -122.4940], ['Old Course St Andrews', 56.3430, -2.8040], ['Bethpage Black', 40.7450, -73.4560],
  ['Kiawah Ocean', 32.6100, -80.0300], ['Whistling Straits', 43.8510, -87.7330], ['Erin Hills', 43.2350, -88.3760],
];
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

async function overpass(q) {
  for (let a = 0; a < 3; a++) for (const url of OVERPASS) {
    try { const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'FairwayLab scan eval' } }); if (r.ok) return await r.json(); } catch (e) { /* next */ }
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('overpass unavailable');
}
const centroid = ll => ({ lat: ll.reduce((s, p) => s + p.lat, 0) / ll.length, lon: ll.reduce((s, p) => s + p.lon, 0) / ll.length });
const lineYds = ll => ll.slice(1).reduce((s, p, i) => s + scan.yardsBetween(ll[i], p), 0);

async function truth(lat, lon) {
  const j = await overpass(`[out:json][timeout:60];(way["golf"="hole"](around:1400,${lat},${lon});way["golf"="green"](around:1700,${lat},${lon});way["golf"="tee"](around:1700,${lat},${lon}););out geom;`);
  const holes = {}, greens = [], tees = [];
  (j.elements || []).forEach(el => {
    const t = el.tags || {}, ll = (el.geometry || []).map(p => ({ lat: p.lat, lon: p.lon }));
    if (!ll.length) return;
    if (t.golf === 'green') greens.push(centroid(ll));
    else if (t.golf === 'tee') tees.push(centroid(ll));
    else if (t.golf === 'hole') {
      const n = parseInt(t.ref, 10); if (!n || n > 18 || ll.length < 2) return;
      const mid = ll[Math.floor(ll.length / 2)], d = scan.yardsBetween(mid, { lat, lon });
      if (!holes[n] || d < holes[n].d) holes[n] = { d, par: parseInt(t.par, 10) || null, tee: ll[0], green: ll[ll.length - 1], yards: Math.round(lineYds(ll)) };
    }
  });
  // snap each hole's ends to the mapped green and tee
  Object.values(holes).forEach(h => {
    const g = greens.map(x => [scan.yardsBetween(x, h.green), x]).sort((a, b) => a[0] - b[0])[0]; if (g && g[0] < 40) h.green = g[1];
  });
  return { holes, greens, tees };
}

(async () => {
  const rows = []; let allOk = 0, allWrong = 0, allSkip = 0, allN = 0;
  for (const [name, lat, lon] of COURSES) {
    try {
      const T = await truth(lat, lon), nums = Object.keys(T.holes).map(Number).sort((a, b) => a - b);
      if (nums.length < 9) { rows.push(`${name}: only ${nums.length} holes on OpenStreetMap, skipped`); continue; }
      const n = nums.length === 18 ? 18 : nums[nums.length - 1] >= 18 ? 18 : 9;
      const pars = [], yards = [];
      for (let k = 1; k <= n; k++) { const h = T.holes[k]; pars.push(h && h.par || 4); yards.push(h ? h.yards : null); }
      const pts = nums.flatMap(k => [T.holes[k].tee, T.holes[k].green]), c = centroid(pts);
      const t0 = Date.now();
      const plan = scan.tilePlan(c, 1300, 17, 144);
      const img = await mosaic(plan);
      const tf = Date.now() - t0;
      const res = scan.scanCourse(img.rgb, plan, { pars, yards }, {});
      const ms = Date.now() - t0;
      const greenRecall = T.greens.filter(g => res.greens.some(x => scan.yardsBetween(x, g) < 15)).length;
      let ok = 0, wrong = 0, skip = 0, greenOnly = 0;
      for (let k = 1; k <= n; k++) {
        const t = T.holes[k], got = res.holes[k]; if (!t) continue;
        if (!got) { skip++; continue; }
        const dg = scan.yardsBetween(got.green, t.green), dt = Math.min(scan.yardsBetween(got.tee, t.tee), ...T.tees.filter(x => scan.yardsBetween(x, t.tee) < 60).map(x => scan.yardsBetween(got.tee, x)));
        if (dg < 20 && dt < 45) ok++; else if (dg < 20) { greenOnly++; wrong++; } else wrong++;
      }
      allOk += ok; allWrong += wrong; allSkip += skip; allN += nums.filter(k => k <= n).length;
      rows.push(`${name}: ${ok}/${nums.length} right, ${wrong} wrong (${greenOnly} right green, wrong tee), ${skip} left out | greens found ${greenRecall}/${T.greens.length} among ${res.found.greens} candidates, ${res.found.tees} tee candidates, ${res.found.bunkers} bunkers, ${res.found.water} water | tiles ${img.tiles} (${img.missing} missing) fetch ${tf} ms, total ${ms} ms`);
    } catch (e) { rows.push(`${name}: error ${e.message}`); }
    await new Promise(r => setTimeout(r, 1500));
  }
  console.log('\n=== Course scan check ===\n' + rows.join('\n'));
  console.log(`\nALL: ${allOk}/${allN} holes right, ${allWrong} wrong, ${allSkip} left out`);
})();
