/* Course scan: from "what each patch of ground is" to greens, tees, bunkers, water and holes, on a
   drawn course of four holes in woods (2 m cells). The trained model is checked on real courses by
   tests/scan-eval. */
const test = require('node:test');
const assert = require('node:assert');
const scan = require('../../lib/scan.js');

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/* Probability grids for a drawn course, with noise, plus a matching tile plan. */
function drawCourse() {
  const w = 550, h = 550, cm = 2, rnd = rng(3), C = scan.CLASSES;
  const lab = new Uint8Array(w * h);
  const segDist = (px, py, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy))); return Math.hypot(px - a.x - t * dx, py - a.y - t * dy); };
  const holes = [   // in cells
    { tee: { x: 75, y: 475 }, green: { x: 75, y: 300 } },
    { tee: { x: 115, y: 280 }, green: { x: 190, y: 210 } },
    { tee: { x: 225, y: 200 }, green: { x: 450, y: 200 } },
    { tee: { x: 460, y: 235 }, green: { x: 350, y: 425 } },
  ];
  const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < w && y < h) lab[y * w + x] = c; };
  holes.forEach(hh => {
    const a = hh.tee, b = hh.green, len = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    const fa = { x: a.x + ux * 30, y: a.y + uy * 30 }, fb = { x: b.x - ux * 12, y: b.y - uy * 12 };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dG = Math.hypot(x - b.x, y - b.y), dT = Math.max(Math.abs((x - a.x) * ux + (y - a.y) * uy) - 6, Math.abs(-(x - a.x) * uy + (y - a.y) * ux) - 3);
      if (dG < 7.5) set(x, y, C.indexOf('green'));
      else if (dT < 0) set(x, y, C.indexOf('tee'));
      else if (segDist(x, y, fa, fb) < 9 && !lab[y * w + x]) set(x, y, C.indexOf('fairway'));
    }
    const bx = Math.round(b.x - uy * 12), by = Math.round(b.y + ux * 12);
    for (let y = by - 3; y <= by + 3; y++) for (let x = bx - 3; x <= bx + 3; x++) if (Math.hypot(x - bx, y - by) < 3) set(x, y, C.indexOf('bunker'));
  });
  for (let y = 350; y < 390; y++) for (let x = 190; x < 240; x++) if (((x - 215) / 25) ** 2 + ((y - 370) / 20) ** 2 < 1) set(x, y, C.indexOf('water'));
  const probs = C.map(() => new Float32Array(w * h));
  for (let i = 0; i < w * h; i++) {
    let z = 0; const p = C.map((_, c) => { const v = (c === lab[i] ? 0.8 : 0.04) + rnd() * 0.15; z += v; return v; });
    p.forEach((v, c) => { probs[c][i] = v / z; });
  }
  // a tile plan where 1 px = 1 m, so a 2 px cell = 2 m
  const center = { lat: 35, lon: -80 }, z = 17, world = 256 * 2 ** z, mpp = scan.metresPerPx(center.lat, z);
  const s = Math.sin(center.lat * Math.PI / 180);
  const plan = { z, W: 2 * w, H: 2 * h, m: 1, cx: w, cy: h, r: 1400, ox: (center.lon + 180) / 360 * world - w, oy: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world - h };
  return { probs, w, h, cm, plan, holes, mpp };
}

test('turns ground types into greens, tees, bunkers, water and the holes of the course', () => {
  const { probs, w, h, cm, plan, holes, mpp } = drawCourse();
  const toLL = p => scan.toLL(plan, p.x * 2 + 1, p.y * 2 + 1);
  const yds = hh => Math.round(Math.hypot(hh.green.x - hh.tee.x, hh.green.y - hh.tee.y) * 2 * mpp * 1.09361);
  const course = { pars: [4, 3, 5, 4], yards: holes.map(yds) };
  const res = scan.fromProbs(probs, w, h, cm, plan, course, {});
  assert.ok(res.found.bunkers >= 4, 'bunkers: ' + res.found.bunkers);
  assert.ok(res.found.water >= 1, 'water: ' + res.found.water);
  holes.forEach((hh, i) => {
    const got = res.holes[i + 1]; assert.ok(got, 'hole ' + (i + 1) + ' mapped');
    const dg = scan.yardsBetween(got.green, toLL(hh.green)), dt = scan.yardsBetween(got.tee, toLL(hh.tee));
    assert.ok(dg < 12, `hole ${i + 1} green off by ${dg.toFixed(1)} yds`);
    assert.ok(dt < 20, `hole ${i + 1} tee off by ${dt.toFixed(1)} yds`);
  });
  assert.ok(res.features.filter(f => f.type === 'green').length === 4);
});

test('a hole already mapped is kept and the rest are filled in around it', () => {
  const { probs, w, h, cm, plan, holes, mpp } = drawCourse();
  const toLL = p => scan.toLL(plan, p.x * 2 + 1, p.y * 2 + 1);
  const course = { pars: [4, 3, 5, 4], yards: holes.map(hh => Math.round(Math.hypot(hh.green.x - hh.tee.x, hh.green.y - hh.tee.y) * 2 * mpp * 1.09361)) };
  const res = scan.fromProbs(probs, w, h, cm, plan, course, { 2: { tee: toLL(holes[1].tee), green: toLL(holes[1].green) } });
  assert.ok(!res.holes[2], 'known hole left alone');
  assert.ok(res.holes[1] && res.holes[3] && res.holes[4]);
});

test('reading the photo: features and the network give a probability for every cell', () => {
  const W = 64, H = 64, rgb = new Uint8Array(W * H * 3).map((_, i) => (i * 37) % 255);
  const f = scan.features(rgb, W, H, 1);
  assert.strictEqual(f.w, 32); assert.strictEqual(f.f.length, scan.NF * 32 * 32);
  assert.ok(Array.from(f.f).every(Number.isFinite));
  const Hn = 4, K = scan.CLASSES.length, m = { W1: new Float32Array(Hn * scan.NF).fill(0.01), b1: new Float32Array(Hn), W2: new Float32Array(K * Hn).fill(0.1), b2: new Float32Array(K), mean: new Float32Array(scan.NF), std: new Float32Array(scan.NF).fill(1) };
  const probs = scan.classify(f, m);
  const sum = probs.reduce((s, p) => s + p[100], 0);
  assert.ok(Math.abs(sum - 1) < 1e-5);
});

test('tile plan covers the circle and stays under the tile limit', () => {
  const p = scan.tilePlan({ lat: 36.57, lon: -121.95 }, 1300, 17, 144);
  assert.ok(p.nx * p.ny <= 144);
  const back = scan.toLL(p, p.cx, p.cy);
  assert.ok(Math.abs(back.lat - 36.57) < 1e-5 && Math.abs(back.lon + 121.95) < 1e-5);
});
