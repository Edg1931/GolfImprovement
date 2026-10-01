/* Teach the course scan what greens, fairways, tees, bunkers and water look like on the satellite photo,
   from courses that OpenStreetMap has traced by hand. Writes lib/scan-model.json.
   Run: node tests/scan-eval/train.js */
const fs = require('fs'), path = require('path');
const scan = require('../../lib/scan.js');
const { mosaic } = require('../../api/scan.js');
const osm = require('./osm.js');
const COURSES = require('./courses.js');

const C = scan.CLASSES, NF = scan.NF, PER_CLASS = 3500;
const rnd = (() => { let s = 12345; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();

/* Fill polygons onto the cell grid. */
function rasterize(feats, plan, w, h) {
  const lab = new Uint8Array(w * h), order = ['water', 'fairway', 'bunker', 'tee', 'green'];
  order.forEach(type => feats.filter(f => f.type === type).forEach(f => {
    const pts = f.ll.map(p => { const q = scan.toPx(plan, p); return { x: q.x / 2, y: q.y / 2 }; });
    const y0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p.y)))), y1 = Math.min(h - 1, Math.ceil(Math.max(...pts.map(p => p.y))));
    for (let y = y0; y <= y1; y++) {
      const xs = [], yc = y + 0.5;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i], b = pts[j];
        if ((a.y > yc) !== (b.y > yc)) xs.push(a.x + (yc - a.y) / (b.y - a.y) * (b.x - a.x));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(w - 1, Math.floor(xs[k + 1] - 0.5)); x++) lab[y * w + x] = C.indexOf(type);
    }
  }));
  return lab;
}

async function courseSamples(name, lat, lon) {
  const { features } = await osm.features(lat, lon, 1300);
  const counts = {}; features.forEach(f => { counts[f.type] = (counts[f.type] || 0) + 1; });
  if ((counts.green || 0) < 9 || (counts.fairway || 0) < 5) return { name, skip: `only ${counts.green || 0} greens and ${counts.fairway || 0} fairways traced` };
  const plan = scan.tilePlan({ lat, lon }, 1300, 17, 144);
  const img = await mosaic(plan);
  const feat = scan.features(img.rgb, plan.W, plan.H, plan.m);
  const { w, h } = feat, n = w * h, lab = rasterize(features, plan, w, h);
  // "other" only near the golf: within ~40 m of something traced
  const golf = new Float32Array(n); for (let i = 0; i < n; i++) golf[i] = lab[i] ? 1 : 0;
  const near = scan.boxMean(golf, w, h, Math.round(40 / feat.m));
  const byClass = C.map(() => []);
  for (let i = 0; i < n; i++) { if (lab[i] || near[i] > 0) byClass[lab[i]].push(i); }
  const X = [], Y = [];
  byClass.forEach((list, c) => {
    for (let k = 0; k < Math.min(PER_CLASS, list.length); k++) {
      const i = list[Math.floor(rnd() * list.length)], x = new Float32Array(NF);
      for (let q = 0; q < NF; q++) x[q] = feat.f[q * n + i];
      X.push(x); Y.push(c);
    }
  });
  return { name, X, Y, counts, sizes: byClass.map(l => l.length) };
}

function train(X, Y, opts) {
  const H = opts.hidden, K = C.length, N = X.length;
  const mean = new Float32Array(NF), std = new Float32Array(NF);
  X.forEach(x => { for (let q = 0; q < NF; q++) mean[q] += x[q] / N; });
  X.forEach(x => { for (let q = 0; q < NF; q++) std[q] += (x[q] - mean[q]) ** 2 / N; });
  for (let q = 0; q < NF; q++) std[q] = Math.sqrt(std[q]) || 1;
  const Z = X.map(x => x.map((v, q) => (v - mean[q]) / std[q]));
  const counts = C.map((_, c) => Y.filter(y => y === c).length), cw = counts.map(k => k ? N / (K * k) : 0);
  const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const m = { W1: Float32Array.from({ length: H * NF }, () => gauss() * Math.sqrt(2 / NF)), b1: new Float32Array(H), W2: Float32Array.from({ length: K * H }, () => gauss() * Math.sqrt(1 / H)), b2: new Float32Array(K), mean, std };
  const P = ['W1', 'b1', 'W2', 'b2'], mom = {}, vel = {};
  P.forEach(k => { mom[k] = new Float32Array(m[k].length); vel[k] = new Float32Array(m[k].length); });
  const lr = opts.lr, b1 = 0.9, b2 = 0.999; let t = 0;
  const idx = [...Array(N).keys()];
  for (let ep = 0; ep < opts.epochs; ep++) {
    for (let i = N - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    let loss = 0;
    for (let s = 0; s < N; s += opts.batch) {
      const g = {}; P.forEach(k => { g[k] = new Float32Array(m[k].length); });
      const end = Math.min(N, s + opts.batch), bs = end - s;
      for (let r = s; r < end; r++) {
        const i = idx[r], x = Z[i], y = Y[i], wgt = cw[y] / bs;
        const { hid, p } = scan.forward(m, x);
        loss -= Math.log(Math.max(1e-9, p[y])) * cw[y];
        const dz = new Float32Array(K); for (let c = 0; c < K; c++) dz[c] = (p[c] - (c === y ? 1 : 0)) * wgt;
        const dh = new Float32Array(H);
        for (let c = 0; c < K; c++) { g.b2[c] += dz[c]; for (let j = 0; j < H; j++) { g.W2[c * H + j] += dz[c] * hid[j]; dh[j] += dz[c] * m.W2[c * H + j]; } }
        for (let j = 0; j < H; j++) { if (hid[j] <= 0) continue; g.b1[j] += dh[j]; for (let q = 0; q < NF; q++) g.W1[j * NF + q] += dh[j] * x[q]; }
      }
      t++;
      P.forEach(k => { const a = m[k], gm = g[k], mo = mom[k], ve = vel[k]; for (let q = 0; q < a.length; q++) { const gq = gm[q] + (k[0] === 'W' ? 1e-4 * a[q] : 0); mo[q] = b1 * mo[q] + (1 - b1) * gq; ve[q] = b2 * ve[q] + (1 - b2) * gq * gq; a[q] -= lr * (mo[q] / (1 - b1 ** t)) / (Math.sqrt(ve[q] / (1 - b2 ** t)) + 1e-8); } });
    }
    console.log(`epoch ${ep + 1}: loss ${(loss / N).toFixed(4)}`);
  }
  return m;
}

function confusion(m, X, Y) {
  const K = C.length, M = C.map(() => new Array(K).fill(0));
  X.forEach((x, i) => { const z = x.map((v, q) => (v - m.mean[q]) / m.std[q]); const { p } = scan.forward(m, z); let best = 0; for (let c = 1; c < K; c++) if (p[c] > p[best]) best = c; M[Y[i]][best]++; });
  return C.map((c, i) => { const tot = M[i].reduce((a, b) => a + b, 0), col = M.reduce((a, r) => a + r[i], 0); return `${c}: found ${tot ? Math.round(100 * M[i][i] / tot) : 0}% of them, right ${col ? Math.round(100 * M[i][i] / col) : 0}% of the time`; }).join('\n');
}

async function main() {
  const trainX = [], trainY = [], testX = [], testY = [];
  for (let k = 0; k < COURSES.length; k++) {
    const [name, lat, lon] = COURSES[k];
    try {
      const s = await courseSamples(name, lat, lon);
      if (s.skip) { console.log(`${name}: skipped, ${s.skip}`); continue; }
      const held = k % 3 === 2;
      (held ? testX : trainX).push(...s.X); (held ? testY : trainY).push(...s.Y);
      console.log(`${name}${held ? ' (held back)' : ''}: ${s.X.length} samples, traced ${JSON.stringify(s.counts)}`);
    } catch (e) { console.log(`${name}: error ${e.message}`); }
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log(`training on ${trainX.length} samples, checking on ${testX.length}`);
  const m = train(trainX, trainY, { hidden: 24, lr: 0.003, epochs: 14, batch: 256 });
  console.log('\n=== Held-back courses ===\n' + confusion(m, testX, testY));
  console.log('\n=== Training courses ===\n' + confusion(m, trainX.slice(0, 40000), trainY.slice(0, 40000)));
  const r = a => Array.from(a, v => Math.round(v * 1e5) / 1e5);
  const out = { classes: C, nf: NF, trained: new Date().toISOString().slice(0, 10), samples: trainX.length, W1: r(m.W1), b1: r(m.b1), W2: r(m.W2), b2: r(m.b2), mean: r(m.mean), std: r(m.std) };
  fs.writeFileSync(path.join(__dirname, '..', '..', 'lib', 'scan-model.json'), JSON.stringify(out) + '\n');
  console.log('wrote lib/scan-model.json');
}
module.exports = { train, confusion, rasterize };
if (require.main === module) main();
