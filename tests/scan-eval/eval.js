/* How well the course scan does on real courses that OpenStreetMap has mapped hole by hole: fetch the
   mapped holes (the answer), scan the satellite photo without them, and count holes whose green and
   tee the scan got right. Courses marked "held back" weren't used for training.
   Run: node tests/scan-eval/eval.js */
const scan = require('../../lib/scan.js');
const { mosaic } = require('../../api/scan.js');
const osm = require('./osm.js');
const COURSES = require('./courses.js');

const centroid = ll => ({ lat: ll.reduce((s, p) => s + p.lat, 0) / ll.length, lon: ll.reduce((s, p) => s + p.lon, 0) / ll.length });
const lineYds = ll => ll.slice(1).reduce((s, p, i) => s + scan.yardsBetween(ll[i], p), 0);

(async () => {
  const rows = [], tot = { held: [0, 0, 0, 0], train: [0, 0, 0, 0] };
  for (let k = 0; k < COURSES.length; k++) {
    const [name, lat, lon] = COURSES[k], held = k % 3 === 2;
    try {
      const { features, holes: ways } = await osm.features(lat, lon, 1500);
      const greens = features.filter(f => f.type === 'green').map(f => centroid(f.ll)), tees = features.filter(f => f.type === 'tee').map(f => centroid(f.ll));
      const holes = {};
      ways.forEach(w => {
        if (!w.ref || w.ref > 18 || w.ll.length < 2) return;
        const d = scan.yardsBetween(w.ll[Math.floor(w.ll.length / 2)], { lat, lon });
        if (!holes[w.ref] || d < holes[w.ref].d) holes[w.ref] = { d, par: w.par, tee: w.ll[0], green: w.ll[w.ll.length - 1], yards: Math.round(lineYds(w.ll)) };
      });
      Object.values(holes).forEach(h => { const g = greens.map(x => [scan.yardsBetween(x, h.green), x]).sort((a, b) => a[0] - b[0])[0]; if (g && g[0] < 40) h.green = g[1]; });
      const nums = Object.keys(holes).map(Number).sort((a, b) => a - b);
      if (nums.length < 9) { rows.push(`${name}: only ${nums.length} holes on OpenStreetMap, skipped`); continue; }
      const n = nums[nums.length - 1] >= 18 ? 18 : 9, pars = [], yards = [];
      for (let i = 1; i <= n; i++) { const h = holes[i]; pars.push(h && h.par || 4); yards.push(h ? h.yards : null); }
      const c = centroid(nums.flatMap(i => [holes[i].tee, holes[i].green]));
      const t0 = Date.now(), plan = scan.tilePlan(c, 1300, 17, 144), img = await mosaic(plan), tf = Date.now() - t0;
      const res = scan.scanCourse(img.rgb, plan, { pars, yards }, {});
      const ms = Date.now() - t0;
      const near = greens.filter(g => scan.yardsBetween(g, c) < 1300 * 1.0936);
      const recall = near.filter(g => res.greens.some(x => scan.yardsBetween(x, g) < 15)).length;
      let ok = 0, wrong = 0, skip = 0, greenOk = 0;
      for (let i = 1; i <= n; i++) {
        const t = holes[i], got = res.holes[i]; if (!t) continue;
        if (!got) { skip++; continue; }
        const dg = scan.yardsBetween(got.green, t.green), dt = Math.min(scan.yardsBetween(got.tee, t.tee), ...tees.filter(x => scan.yardsBetween(x, t.tee) < 60).map(x => scan.yardsBetween(got.tee, x)));
        if (dg < 20) greenOk++;
        if (dg < 20 && dt < 45) ok++; else wrong++;
      }
      const T = tot[held ? 'held' : 'train']; T[0] += ok; T[1] += wrong; T[2] += skip; T[3] += nums.filter(i => i <= n).length;
      rows.push(`${name}${held ? ' (held back)' : ''}: ${ok}/${nums.length} right, ${wrong} wrong (${greenOk} right green), ${skip} left out | greens found ${recall}/${near.length} among ${res.found.greens}, ${res.found.tees} tees, ${res.found.bunkers} bunkers, ${res.found.water} water | ${img.tiles} tiles, fetch ${tf} ms, total ${ms} ms`);
    } catch (e) { rows.push(`${name}: error ${e.message}`); }
    await new Promise(r => setTimeout(r, 1500));
  }
  console.log('\n=== Course scan check ===\n' + rows.join('\n'));
  const f = (l, T) => `${l}: ${T[0]}/${T[3]} holes right, ${T[1]} wrong, ${T[2]} left out`;
  console.log('\n' + f('HELD BACK', tot.held) + '\n' + f('TRAINING', tot.train));
})();
