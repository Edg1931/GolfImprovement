/* Course scan on a drawn course: four holes with fairways, greens, tees, bunkers and a pond in woods. */
const test = require('node:test');
const assert = require('node:assert');
const scan = require('../../lib/scan.js');

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/* Draw a course at 1 m per pixel. Holes go tee → green; returns the image and the true positions. */
function drawCourse() {
  const W = 1100, H = 1100, rgb = new Uint8Array(W * H * 3), rnd = rng(7);
  const put = (x, y, r, g, b, noise) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const n = (rnd() - 0.5) * 2 * noise, i = (y * W + x) * 3;
    rgb[i] = Math.max(0, Math.min(255, r + n)); rgb[i + 1] = Math.max(0, Math.min(255, g + n)); rgb[i + 2] = Math.max(0, Math.min(255, b + n));
  };
  // woods everywhere: dark, blotchy
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const blot = ((x >> 3) * 31 + (y >> 3) * 17) % 7 * 6; put(x, y, 40 + blot, 70 + blot, 35 + blot, 35); }
  const segDist = (px, py, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy))); return Math.hypot(px - a.x - t * dx, py - a.y - t * dy); };
  const holes = [
    { tee: { x: 150, y: 950 }, green: { x: 150, y: 600 } },   // ~383 yds
    { tee: { x: 230, y: 560 }, green: { x: 380, y: 420 } },   // ~224 yds (par 3)
    { tee: { x: 450, y: 400 }, green: { x: 900, y: 400 } },   // ~492 yds (par 5)
    { tee: { x: 920, y: 470 }, green: { x: 700, y: 850 } },   // ~480 yds
  ];
  holes.forEach(h => {
    const a = h.tee, b = h.green, len = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    const fa = { x: a.x + ux * 60, y: a.y + uy * 60 }, fb = { x: b.x - ux * 22, y: b.y - uy * 22 };
    const x0 = Math.min(a.x, b.x) - 60, x1 = Math.max(a.x, b.x) + 60, y0 = Math.min(a.y, b.y) - 60, y1 = Math.max(a.y, b.y) + 60;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const dGreen = Math.hypot(x - b.x, y - b.y), dFair = segDist(x, y, fa, fb), dTee = Math.max(Math.abs((x - a.x) * ux + (y - a.y) * uy) - 12, Math.abs(-(x - a.x) * uy + (y - a.y) * ux) - 6);
      if (dGreen < 15) put(x, y, 95, 175, 80, 3);                    // green: smoothest
      else if (dTee < 0) put(x, y, 100, 170, 85, 4);                 // tee box
      else if (dFair < 18) put(x, y, (x + y) % 16 < 8 ? 105 : 92, 160, 75, 8);   // fairway with mowing stripes
      else if (dFair < 34 || dGreen < 30 || dTee < 14) put(x, y, 110, 150, 80, 22);   // rough
    }
    // a bunker beside the green
    const bx = b.x - uy * 24, by = b.y + ux * 24;
    for (let y = by - 8; y <= by + 8; y++) for (let x = bx - 8; x <= bx + 8; x++) if (Math.hypot(x - bx, y - by) < 7) put(Math.round(x), Math.round(y), 235, 225, 195, 4);
  });
  // a pond
  for (let y = 700; y < 780; y++) for (let x = 380; x < 480; x++) if (((x - 430) / 50) ** 2 + ((y - 740) / 40) ** 2 < 1) put(x, y, 30, 45, 55, 2);
  return { W, H, rgb, holes };
}

test('finds greens, tees, bunkers and water on a drawn course and puts the holes together', () => {
  const { W, H, rgb, holes } = drawCourse();
  const center = { lat: 35, lon: -80 };
  const plan = { z: 17, ox: 0, oy: 0, W, H, m: 1, cx: W / 2, cy: H / 2, r: 760 };
  // place the drawing on the map so pixel → lat/lon works, at 1 m per pixel
  const z = 17, worldPx = 256 * 2 ** z, mpp = scan.metresPerPx(center.lat, z);
  plan.m = 1;
  // convert lat/lon with the true scale, then treat 1 px = 1 m by stretching yards
  plan.ox = (center.lon + 180) / 360 * worldPx - W / 2;
  const s = Math.sin(center.lat * Math.PI / 180);
  plan.oy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldPx - H / 2;
  const toLL = p => scan.toLL(plan, p.x, p.y);
  const yds = h => Math.round(Math.hypot(h.green.x - h.tee.x, h.green.y - h.tee.y) * mpp * 1.09361);
  const course = { pars: [4, 3, 5, 4], yards: holes.map(yds) };

  const t0 = Date.now();
  const res = scan.scanCourse(rgb, plan, course, {});
  assert.ok(Date.now() - t0 < 20000, 'quick enough');
  assert.ok(res.found.bunkers >= 3, 'bunkers: ' + res.found.bunkers);
  assert.ok(res.found.water >= 1, 'water: ' + res.found.water);
  // every true green is among the candidates
  holes.forEach((h, i) => {
    const g = toLL(h.green);
    const best = Math.min(...res.greens.map(c => scan.yardsBetween(c, g)));
    assert.ok(best < 12, `green ${i + 1} found (nearest ${best.toFixed(1)} yds)`);
  });
  // and the holes are put together right
  holes.forEach((h, i) => {
    const got = res.holes[i + 1]; assert.ok(got, 'hole ' + (i + 1) + ' mapped');
    const dg = scan.yardsBetween(got.green, toLL(h.green)) * mpp, dt = scan.yardsBetween(got.tee, toLL(h.tee)) * mpp;
    assert.ok(dg < 15, `hole ${i + 1} green off by ${dg.toFixed(1)}`);
    assert.ok(dt < 25, `hole ${i + 1} tee off by ${dt.toFixed(1)}`);
  });
  assert.ok(res.features.some(f => f.type === 'green' && f.ll.length >= 8));
});

test('tile plan covers the circle and stays under the tile limit', () => {
  const p = scan.tilePlan({ lat: 36.57, lon: -121.95 }, 1300, 17, 144);
  assert.ok(p.nx * p.ny <= 144);
  assert.ok(p.cx > 0 && p.cx < p.W && p.cy > 0 && p.cy < p.H);
  const back = scan.toLL(p, p.cx, p.cy);
  assert.ok(Math.abs(back.lat - 36.57) < 1e-5 && Math.abs(back.lon + 121.95) < 1e-5);
});
