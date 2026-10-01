/* Course scan: find greens, tees, bunkers and water on a satellite photo, then work out which tee and
   green make each hole from the scorecard (each hole's length and par, the line of the hole running
   over golf ground, and each green being a short walk from the next tee).

   Works on a mosaic of map tiles in Web Mercator pixels. A small neural network (lib/scan-model.json)
   says what each 2 m patch of ground is. It is trained on courses that OpenStreetMap has traced by
   hand (tests/scan-eval/train.js). No outside libraries apart from the JPEG decoder the caller uses. */

const YD = 1.09361;   // yards per metre

/* ---------- map tile maths (Web Mercator, 256 px tiles) ---------- */
const worldPx = z => 256 * 2 ** z;
const lonToPx = (lon, z) => (lon + 180) / 360 * worldPx(z);
const latToPx = (lat, z) => { const s = Math.sin(lat * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldPx(z); };
const pxToLon = (px, z) => px / worldPx(z) * 360 - 180;
const pxToLat = (py, z) => 180 / Math.PI * Math.atan(Math.sinh(Math.PI - 2 * Math.PI * py / worldPx(z)));
const metresPerPx = (lat, z) => 156543.03392 * Math.cos(lat * Math.PI / 180) / 2 ** z;

/* Which tiles cover a circle around the course, at most `maxTiles` of them. */
function tilePlan(center, radiusM, z, maxTiles) {
  z = z || 17; maxTiles = maxTiles || 144;
  const m = metresPerPx(center.lat, z);
  let r = radiusM / m;
  const cx = lonToPx(center.lon, z), cy = latToPx(center.lat, z);
  const span = rr => (Math.floor((cx + rr) / 256) - Math.floor((cx - rr) / 256) + 1) * (Math.floor((cy + rr) / 256) - Math.floor((cy - rr) / 256) + 1);
  while (span(r) > maxTiles) r *= 0.92;
  const tx0 = Math.floor((cx - r) / 256), ty0 = Math.floor((cy - r) / 256);
  const nx = Math.floor((cx + r) / 256) - tx0 + 1, ny = Math.floor((cy + r) / 256) - ty0 + 1;
  return { z, tx0, ty0, nx, ny, W: nx * 256, H: ny * 256, ox: tx0 * 256, oy: ty0 * 256, cx: cx - tx0 * 256, cy: cy - ty0 * 256, r, m };
}
function toLL(plan, x, y) { return { lat: round6(pxToLat(plan.oy + y, plan.z)), lon: round6(pxToLon(plan.ox + x, plan.z)) }; }
function toPx(plan, p) { return { x: lonToPx(p.lon, plan.z) - plan.ox, y: latToPx(p.lat, plan.z) - plan.oy }; }
const round6 = v => Math.round(v * 1e6) / 1e6;

function yardsBetween(a, b) {
  const R = 6371008.8, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)) * YD;
}

/* ---------- image helpers ---------- */
/* Mean of `src` over a (2k+1)² square around each pixel (edges use what's there). */
function boxMean(src, W, H, k) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H), P = new Float64Array(Math.max(W, H) + 1);
  for (let y = 0; y < H; y++) {
    const o = y * W; P[0] = 0;
    for (let x = 0; x < W; x++) P[x + 1] = P[x] + src[o + x];
    for (let x = 0; x < W; x++) { const a = Math.max(0, x - k), b = Math.min(W, x + k + 1); tmp[o + x] = (P[b] - P[a]) / (b - a); }
  }
  for (let x = 0; x < W; x++) {
    P[0] = 0;
    for (let y = 0; y < H; y++) P[y + 1] = P[y] + tmp[y * W + x];
    for (let y = 0; y < H; y++) { const a = Math.max(0, y - k), b = Math.min(H, y + k + 1); out[y * W + x] = (P[b] - P[a]) / (b - a); }
  }
  return out;
}
/* Morphological opening of a 0/1 mask with a (2k+1)² square: removes specks and thin strips. */
function open(mask, W, H, k) {
  if (k < 1) return mask;
  const m1 = boxMean(mask, W, H, k), er = new Uint8Array(W * H);
  for (let i = 0; i < er.length; i++) er[i] = m1[i] > 0.999 ? 1 : 0;
  const m2 = boxMean(er, W, H, k), out = new Uint8Array(W * H);
  for (let i = 0; i < out.length; i++) out[i] = m2[i] > 0.001 ? 1 : 0;
  return out;
}
/* Percentile of a typed array over the pixels where `keep` is set, from a sample. */
function percentile(arr, keep, ps) {
  const s = [];
  for (let i = 0; i < arr.length; i += 7) if (!keep || keep[i]) s.push(arr[i]);
  s.sort((a, b) => a - b);
  return ps.map(p => s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0);
}

/* Connected regions of a mask (8-neighbour), with area, centre and shape. */
function components(mask, W, H, minPx, maxPx) {
  const lab = new Int32Array(W * H), out = [], stack = new Int32Array(W * H);
  let id = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || lab[i]) continue;
    id++; let sp = 0; stack[sp++] = i; lab[i] = id;
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, x0 = W, x1 = 0, y0 = H, y1 = 0;
    while (sp) {
      const p = stack[--sp], x = p % W, y = (p - x) / W;
      n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const q = yy * W + xx; if (mask[q] && !lab[q]) { lab[q] = id; stack[sp++] = q; }
      }
    }
    if (n < minPx || n > maxPx) continue;
    const mx = sx / n, my = sy / n, vx = sxx / n - mx * mx, vy = syy / n - my * my, cv = sxy / n - mx * my;
    const tr = vx + vy, det = vx * vy - cv * cv, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = Math.max(1e-6, tr / 2 - disc);
    out.push({ id, n, x: mx, y: my, elong: Math.sqrt(l1 / l2), fill: n / (Math.PI * 4 * Math.sqrt(l1 * l2)), angle: Math.atan2(l1 - vx, cv || 1e-9), bbox: [x0, y0, x1, y1] });
  }
  return { lab, comps: out };
}

/* Outline of a region as a polygon: from its centre, how far it reaches in 32 directions. */
function outline(lab, W, H, c, steps) {
  steps = steps || 32;
  const pts = [], maxR = Math.max(c.bbox[2] - c.bbox[0], c.bbox[3] - c.bbox[1]) + 2;
  for (let s = 0; s < steps; s++) {
    const a = s / steps * Math.PI * 2, ux = Math.cos(a), uy = Math.sin(a);
    let last = 0;
    for (let r = 0; r <= maxR; r += 0.5) {
      const x = Math.round(c.x + ux * r), y = Math.round(c.y + uy * r);
      if (x < 0 || y < 0 || x >= W || y >= H) break;
      if (lab[y * W + x] === c.id) last = r;
    }
    pts.push({ x: c.x + ux * (last + 0.5), y: c.y + uy * (last + 0.5) });
  }
  return pts;
}

/* Mean of `arr` around a region: a ring `r0`..`r1` pixels beyond its edge, in 24 directions. */
function ringMean(arr, W, H, c, lab, r0, r1) {
  let s = 0, n = 0;
  const maxR = Math.max(c.bbox[2] - c.bbox[0], c.bbox[3] - c.bbox[1]) + 2;
  for (let k = 0; k < 24; k++) {
    const a = k / 24 * Math.PI * 2, ux = Math.cos(a), uy = Math.sin(a);
    let edge = 0;
    for (let r = 0; r <= maxR; r += 1) { const x = Math.round(c.x + ux * r), y = Math.round(c.y + uy * r); if (x < 0 || y < 0 || x >= W || y >= H) break; if (lab[y * W + x] === c.id) edge = r; }
    for (let r = edge + r0; r <= edge + r1; r += 1) {
      const x = Math.round(c.x + ux * r), y = Math.round(c.y + uy * r);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      s += arr[y * W + x]; n++;
    }
  }
  return n ? s / n : 0;
}
function regionMean(arr, W, c, lab) {
  let s = 0, n = 0;
  for (let y = c.bbox[1]; y <= c.bbox[3]; y++) for (let x = c.bbox[0]; x <= c.bbox[2]; x++) { const i = y * W + x; if (lab[i] === c.id) { s += arr[i]; n++; } }
  return n ? s / n : 0;
}

/* ---------- what each patch of ground is ---------- */
/* The photo is read on a grid of 2×2 pixel cells (about 2 m). For each cell: its colour, how smooth
   the ground is at 1 m (mown turf is smooth, rough and trees aren't), and the same over the 15 m and
   35 m around it. A small neural network, trained on courses that OpenStreetMap has traced by hand
   (tests/scan-eval/train.js), turns those into how likely the cell is green, fairway, tee, bunker,
   water or anything else. */
const CLASSES = ['other', 'green', 'fairway', 'tee', 'bunker', 'water'];
const NF = 20;

/* rgb: W×H×3 at m metres per pixel → { f: Float32Array(NF × w × h) feature-major, w, h, m: cell size } */
function features(rgb, W, H, m) {
  const N = W * H, L = new Float32Array(N), L2 = new Float32Array(N);
  for (let i = 0, j = 0; i < N; i++, j += 3) { const l = 0.299 * rgb[j] + 0.587 * rgb[j + 1] + 0.114 * rgb[j + 2]; L[i] = l; L2[i] = l * l; }
  const mu = boxMean(L, W, H, 1), mu2 = boxMean(L2, W, H, 1), fine = new Float32Array(N);   // 3×3 px texture
  for (let i = 0; i < N; i++) fine[i] = Math.sqrt(Math.max(0, mu2[i] - mu[i] * mu[i]));
  const w = W >> 1, h = H >> 1, n = w * h;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), Lc = new Float32Array(n), Lc2 = new Float32Array(n), T = new Float32Array(n), E = new Float32Array(n), S = new Float32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, t = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const p = (2 * y + dy) * W + 2 * x + dx, j = p * 3; r += rgb[j]; g += rgb[j + 1]; b += rgb[j + 2]; t += fine[p]; }
    const c = y * w + x; r /= 4; g /= 4; b /= 4;
    R[c] = r; G[c] = g; B[c] = b; T[c] = t / 4; E[c] = 2 * g - r - b; S[c] = Math.max(r, g, b) - Math.min(r, g, b);
    const l = 0.299 * r + 0.587 * g + 0.114 * b; Lc[c] = l; Lc2[c] = l * l;
  }
  const cm = 2 * m, k1 = Math.max(1, Math.round(7 / cm)), k2 = Math.max(2, Math.round(17 / cm));
  const R1 = boxMean(R, w, h, k1), G1 = boxMean(G, w, h, k1), B1 = boxMean(B, w, h, k1), T1 = boxMean(T, w, h, k1);
  const L1 = boxMean(Lc, w, h, k1), L1b = boxMean(Lc2, w, h, k1);
  const E2 = boxMean(E, w, h, k2), L2m = boxMean(Lc, w, h, k2), T2 = boxMean(T, w, h, k2);
  // where this photo sits overall (brightness and greenness vary between photos)
  const med = (a) => { const s = []; for (let i = 0; i < n; i += 13) s.push(a[i]); s.sort((p, q) => p - q); return s[s.length >> 1] || 0; };
  const mL = med(Lc), mE = med(E), mT = med(T);
  const f = new Float32Array(NF * n);
  for (let c = 0; c < n; c++) {
    const sd1 = Math.sqrt(Math.max(0, L1b[c] - L1[c] * L1[c]));
    const v = [R[c] / 255, G[c] / 255, B[c] / 255, E[c] / 128, S[c] / 128, Lc[c] / 255, T[c] / 24,
      R1[c] / 255, G1[c] / 255, B1[c] / 255, sd1 / 32, T1[c] / 24,
      E2[c] / 128, L2m[c] / 255, T2[c] / 24, (Lc[c] - L2m[c]) / 64,
      (Lc[c] - mL) / 64, (E[c] - mE) / 64, (T[c] - mT) / 16, (T1[c] - T2[c]) / 16];
    for (let k = 0; k < NF; k++) f[k * n + c] = v[k];
  }
  return { f, w, h, m: cm };
}

/* One hidden layer: x → relu(W1·x + b1) → W2·h + b2 → softmax. */
function forward(model, x, out) {
  const H = model.b1.length, C = model.b2.length, hid = out && out.hid || new Float32Array(H), p = out && out.p || new Float32Array(C);
  for (let j = 0; j < H; j++) { let s = model.b1[j]; const row = j * NF; for (let k = 0; k < NF; k++) s += model.W1[row + k] * x[k]; hid[j] = s > 0 ? s : 0; }
  let mx = -Infinity;
  for (let c = 0; c < C; c++) { let s = model.b2[c]; const row = c * H; for (let j = 0; j < H; j++) s += model.W2[row + j] * hid[j]; p[c] = s; if (s > mx) mx = s; }
  let z = 0; for (let c = 0; c < C; c++) { p[c] = Math.exp(p[c] - mx); z += p[c]; }
  for (let c = 0; c < C; c++) p[c] /= z;
  return { hid, p };
}
/* Probability of each class for every cell: Float32Array per class. Cells outside `area` (the circle
   around the course) are skipped and count as "other". */
function classify(feat, model, area) {
  const n = feat.w * feat.h, C = CLASSES.length, probs = CLASSES.map(() => new Float32Array(n));
  const x = new Float32Array(NF), buf = { hid: new Float32Array(model.b1.length), p: new Float32Array(C) };
  for (let c = 0; c < n; c++) {
    if (area) { const cx = c % feat.w - area.cx, cy = (c - c % feat.w) / feat.w - area.cy; if (cx * cx + cy * cy > area.r * area.r) { probs[0][c] = 1; continue; } }
    for (let k = 0; k < NF; k++) x[k] = (feat.f[k * n + c] - model.mean[k]) / model.std[k];
    forward(model, x, buf);
    for (let q = 0; q < C; q++) probs[q][c] = buf.p[q];
  }
  return probs;
}

/* ---------- finding greens, tees, bunkers and water ---------- */
/* probs: per-class probability grids (w × h cells of cm metres); area: { cx, cy, r } in cells.
   Returns candidate greens and tees with a cost (lower is more likely), bunkers, water, and a map of
   how playable each cell is (for checking the line of a hole). */
function detect(probs, w, h, cm, area) {
  const n = w * h, P = Object.fromEntries(CLASSES.map((c, i) => [c, probs[i]]));
  const inside = i => { if (!area) return true; const x = i % w, y = (i - x) / w; return (x - area.cx) ** 2 + (y - area.cy) ** 2 <= area.r * area.r; };
  const cells = a => a / (cm * cm);
  const blobs = (pr, t, minA, maxA, openK) => {
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = pr[i] >= t && inside(i) ? 1 : 0;
    const { lab, comps } = components(openK ? open(mask, w, h, openK) : mask, w, h, cells(minA), cells(maxA));
    comps.forEach(c => { c.p = regionMean(pr, w, c, lab); c.lab = lab; });
    return comps;
  };
  const greens = [], tees = [];
  [0.35, 0.5, 0.65].forEach(t => {
    blobs(P.green, t, 150, 2600, 1).forEach(c => {
      if (c.elong > 3 || c.fill < 0.5) return;
      const a = c.n * cm * cm;
      greens.push({ x: c.x, y: c.y, n: c.n, cost: (1 - c.p) * 4 + Math.abs(Math.log(a / 600)) * 0.6 + (c.elong - 1) * 0.4 + Math.max(0, 0.8 - c.fill) * 2, poly: outline(c.lab, w, h, c, 24) });
    });
    blobs(P.tee, t * 0.8, 25, 1500, 0).forEach(c => {
      if (c.elong > 6) return;
      const a = c.n * cm * cm;
      tees.push({ x: c.x, y: c.y, n: c.n, cost: (1 - c.p) * 3 + Math.abs(Math.log(a / 250)) * 0.4 });
    });
  });
  const dedupe = (list, d, max) => {
    const out = [];
    list.sort((a, b) => a.cost - b.cost).forEach(g => { if (!out.some(o => Math.hypot(o.x - g.x, o.y - g.y) < d)) out.push(g); });
    return out.slice(0, max);
  };
  const bunkers = blobs(P.bunker, 0.5, 12, 3000, 0).map(c => ({ x: c.x, y: c.y, n: c.n, poly: outline(c.lab, w, h, c, 16) }));
  const ponds = blobs(P.water, 0.5, 250, 400000, 1).filter(c => c.fill > 0.2).map(c => ({ x: c.x, y: c.y, n: c.n, poly: outline(c.lab, w, h, c, 32) }));
  const play = new Float32Array(n);
  for (let i = 0; i < n; i++) play[i] = P.fairway[i] + P.green[i] + P.tee[i] + P.bunker[i] + P.water[i];
  return { greens: dedupe(greens, 16 / cm, 90), tees: dedupe(tees, 8 / cm, 200), bunkers, ponds, play, pw: w, ph: h, m: cm };
}

/* How much of the straight line between two cells is not golf ground (trees, houses, roads). */
function offShare(a, b, scan) {
  const d = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(4, Math.round(d * scan.m / 4));
  let t = 0, n = 0;
  for (let s = 1; s < steps; s++) {
    const x = Math.round(a.x + (b.x - a.x) * s / steps), y = Math.round(a.y + (b.y - a.y) * s / steps);
    if (x < 0 || y < 0 || x >= scan.pw || y >= scan.ph) continue;
    t += scan.play[y * scan.pw + x] < 0.25 ? 1 : 0; n++;
  }
  return n ? t / n : 0;
}

/* ---------- which tee and green make each hole ---------- */
/* course: { pars:[…], yards:[…]? }, known: { "3": {tee, green} } (lat/lon, already mapped holes).
   greens/tees: [{lat, lon, cost, x, y}]. Returns { holes: { n: {tee, green, cost} } }. */
function pairHoles(course, greens, tees, known, scan) {
  known = known || {};
  const n = course.pars.length;
  const isKnown = k => known[k] && known[k].tee && known[k].green;
  const knownGreens = Object.values(known).filter(h => h && h.green).map(h => h.green);
  greens = greens.filter(g => !knownGreens.some(k => yardsBetween(k, g) < 25));
  const want = k => {
    const y = course.yards && course.yards[k - 1], par = course.pars[k - 1];
    if (y) return { y, lo: y * 0.78 - 10, hi: y + 25 };   // doglegs measure longer than the straight line
    return par === 3 ? { y: 165, lo: 90, hi: 250 } : par === 5 ? { y: 510, lo: 400, hi: 640 } : { y: 380, lo: 250, hi: 490 };
  };
  const cands = {};
  for (let k = 1; k <= n; k++) {
    if (isKnown(k)) { cands[k] = [{ fixed: true, tee: known[k].tee, green: known[k].green, gi: -1, ti: -1, cost: 0 }]; continue; }
    const w = want(k), list = [];
    tees.forEach((t, ti) => greens.forEach((g, gi) => {
      const d = yardsBetween(t, g); if (d < w.lo || d > w.hi) return;
      list.push({ tee: t, green: g, gi, ti, cost: Math.abs(d - w.y) / w.y * 8 + g.cost * 0.8 + t.cost * 0.5 });
    }));
    list.sort((a, b) => a.cost - b.cost);
    const top = list.slice(0, 120);
    if (scan) top.forEach(c => { c.cost += Math.max(0, offShare(c.tee, c.green, scan) - 0.15) * 6; });
    cands[k] = top.sort((a, b) => a.cost - b.cost).slice(0, 40);
  }
  const SKIP = 7;
  let beam = [{ cost: 0, used: new Set(), last: null, path: [] }];
  for (let k = 1; k <= n; k++) {
    const next = [];
    beam.forEach(st => {
      cands[k].forEach(c => {
        if (c.gi >= 0 && (st.used.has('g' + c.gi) || st.used.has('t' + c.ti))) return;
        const walk = st.last ? yardsBetween(st.last, c.tee) : 0;
        const used = new Set(st.used); if (c.gi >= 0) { used.add('g' + c.gi); used.add('t' + c.ti); }
        next.push({ cost: st.cost + c.cost + Math.max(0, walk - 120) / 50, used, last: c.green, path: st.path.concat(c) });
      });
      next.push({ cost: st.cost + SKIP, used: st.used, last: null, path: st.path.concat(null) });   // leave this hole unmapped
    });
    beam = next.sort((a, b) => a.cost - b.cost).slice(0, 250);
  }
  const holes = {};
  beam[0].path.forEach((c, i) => {
    if (!c || c.fixed) return;
    holes[i + 1] = { tee: { lat: c.tee.lat, lon: c.tee.lon }, green: { lat: c.green.lat, lon: c.green.lon }, cost: Math.round(c.cost * 100) / 100, gi: c.gi };
  });
  return { holes };
}

/* ---------- the whole scan ---------- */
let MODEL = null;
function model() { if (!MODEL) { try { MODEL = require('./scan-model.json'); } catch (e) { MODEL = null; } } return MODEL; }

/* rgb mosaic + plan from tilePlan → features and holes, in lat/lon. */
function scanCourse(rgb, plan, course, known, mdl) {
  mdl = mdl || model(); if (!mdl) throw new Error('no scan model');
  const feat = features(rgb, plan.W, plan.H, plan.m);
  const probs = classify(feat, mdl, { cx: plan.cx / 2, cy: plan.cy / 2, r: plan.r / 2 });
  return fromProbs(probs, feat.w, feat.h, feat.m, plan, course, known);
}
/* Cells (2 px each) → lat/lon via the tile plan. */
function fromProbs(probs, w, h, cm, plan, course, known) {
  const scan = detect(probs, w, h, cm, { cx: plan.cx / 2, cy: plan.cy / 2, r: plan.r / 2 });
  const ll = p => toLL(plan, p.x * 2 + 1, p.y * 2 + 1);
  const greens = scan.greens.map(g => Object.assign(ll(g), { x: g.x, y: g.y, cost: g.cost }));
  const tees = scan.tees.map(t => Object.assign(ll(t), { x: t.x, y: t.y, cost: t.cost }));
  const res = course && course.pars && course.pars.length ? pairHoles(course, greens, tees, known, scan) : { holes: {} };
  const usedGreens = new Set(Object.values(res.holes).map(h => h.gi));
  const features = [];
  scan.greens.forEach((g, i) => { if (usedGreens.has(i)) features.push({ type: 'green', ll: g.poly.map(ll) }); });
  scan.bunkers.forEach(b => features.push({ type: 'bunker', ll: b.poly.map(ll) }));
  scan.ponds.forEach(w => features.push({ type: 'water', ll: w.poly.map(ll) }));
  Object.values(res.holes).forEach(h => { delete h.gi; });
  return { holes: res.holes, features, found: { greens: greens.length, tees: tees.length, bunkers: scan.bunkers.length, water: scan.ponds.length }, greens, tees };
}

module.exports = { ready: () => !!model(), CLASSES, NF, tilePlan, toLL, toPx, metresPerPx, features, forward, classify, detect, pairHoles, scanCourse, fromProbs, yardsBetween, boxMean, components };
