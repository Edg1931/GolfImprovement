/* Course scan: find greens, tees, bunkers and water on a satellite photo, then work out which tee and
   green make each hole from the scorecard (each hole's length and par, and each green being a short
   walk from the next tee).

   Everything works on a mosaic of map tiles in Web Mercator pixels. No outside libraries apart from the
   JPEG decoder the caller uses, so it runs the same on Vercel and in tests.

   How the pieces are told apart:
   - mown turf (fairways, greens, tees) is smooth: little change in brightness from metre to metre;
     rough is a little rougher and trees are rough and dark
   - greens are the smoothest turf, compact and roundish (200 to 1,600 m²), smoother than what's
     around them, and usually have sand nearby
   - tees are small smooth patches, roundish or rectangular (40 to 900 m²)
   - bunkers are the brightest, least green patches next to turf; water is dark and smooth */

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

/* ---------- finding things on the photo ---------- */
/* rgb: Uint8Array of W×H×3; m: metres per pixel; cx, cy, r: the circle to look in (pixels).
   Returns candidate greens and tees (with a cost: lower looks more like one), bunkers, water and a
   coarse tree mask for checking the line of a hole. */
function analyze(rgb, W, H, m, area) {
  const N = W * H, inCircle = new Uint8Array(N);
  const L = new Float32Array(N), L2 = new Float32Array(N), exg = new Float32Array(N), sat = new Float32Array(N);
  for (let i = 0, j = 0; i < N; i++, j += 3) {
    const r = rgb[j], g = rgb[j + 1], b = rgb[j + 2], l = 0.299 * r + 0.587 * g + 0.114 * b;
    L[i] = l; L2[i] = l * l; exg[i] = 2 * g - r - b; sat[i] = Math.max(r, g, b) - Math.min(r, g, b);
    const x = i % W, y = (i - x) / W;
    inCircle[i] = (r | g | b) && (!area || (x - area.cx) ** 2 + (y - area.cy) ** 2 <= area.r * area.r) ? 1 : 0;
  }
  // texture: standard deviation of brightness over about 5 m
  const k = Math.max(1, Math.round(2.5 / m));
  const mu = boxMean(L, W, H, k), mu2 = boxMean(L2, W, H, k), sd = new Float32Array(N);
  for (let i = 0; i < N; i++) sd[i] = Math.sqrt(Math.max(0, mu2[i] - mu[i] * mu[i]));
  const [lP10, lP40, lP97] = percentile(L, inCircle, [0.10, 0.40, 0.97]);
  const [sdP35, sdP40, sdP60] = percentile(sd, inCircle, [0.35, 0.40, 0.60]);
  const [eP50] = percentile(exg, inCircle, [0.50]);

  // the main surfaces
  const sand = new Uint8Array(N), water = new Uint8Array(N), turf = new Uint8Array(N), trees = new Uint8Array(N), grass = new Uint8Array(N);
  const exgMin = Math.max(4, eP50 * 0.5);
  for (let i = 0; i < N; i++) {
    if (!inCircle[i]) continue;
    const l = L[i];
    if (l >= Math.max(150, lP97 * 0.97) && exg[i] < 0.12 * l && sat[i] < 90) sand[i] = 1;   // bright, pale, not green
    else if (l < lP10 && sd[i] < sdP40 && exg[i] < 18) water[i] = 1;
    else if (sd[i] <= sdP35 && l >= lP10 && exg[i] >= exgMin) turf[i] = 1;
    if (l < lP40 && sd[i] > sdP60 && exg[i] > 0) trees[i] = 1;
    else if (exg[i] >= exgMin && l >= lP10) grass[i] = 1;
  }

  // bunkers: bright patches 15–2,000 m² with turf around them
  const px = a => a / (m * m);
  const sandC = components(open(sand, W, H, Math.round(1 / m)), W, H, px(15), px(2000));
  const bunkers = sandC.comps.filter(c => ringMean(grass, W, H, c, sandC.lab, 1, Math.max(3, 8 / m)) > 0.3)
    .map(c => ({ x: c.x, y: c.y, n: c.n, poly: outline(sandC.lab, W, H, c, 16) }));
  const waterC = components(open(water, W, H, Math.round(3 / m)), W, H, px(300), px(400000));
  const ponds = waterC.comps.filter(c => c.fill > 0.25).map(c => ({ x: c.x, y: c.y, n: c.n, poly: outline(waterC.lab, W, H, c, 32) }));

  // greens and tees: smooth turf at several smoothness levels, so a green still shows up as its own
  // patch when it's only a little smoother than the fairway around it
  const levels = percentile(sd, turf, [0.02, 0.04, 0.07, 0.12, 0.2, 0.35, 0.6]);
  const greens = [], tees = [];
  const near = (list, c, d) => list.some(b => Math.hypot(b.x - c.x, b.y - c.y) < d);
  levels.forEach(t => {
    const mask = new Uint8Array(N);
    for (let i = 0; i < N; i++) mask[i] = turf[i] && sd[i] <= t ? 1 : 0;
    const { lab, comps } = components(open(mask, W, H, Math.max(1, Math.round(1.5 / m))), W, H, px(40), px(1600));
    comps.forEach(c => {
      const areaM = c.n * m * m;
      if (c.elong > 5 || c.fill < 0.55) return;
      const ring = ringMean(sd, W, H, c, lab, Math.max(2, 3 / m), Math.max(4, 12 / m)), inside = regionMean(sd, W, c, lab) || 0.5;
      const contrast = ring / Math.max(0.5, inside);
      const ringTurf = ringMean(turf, W, H, c, lab, Math.max(2, 3 / m), Math.max(4, 10 / m));
      const sandNear = near(bunkers, c, (Math.sqrt(c.n / Math.PI) + 30 / m));
      const shape = (c.elong - 1) * 0.5 + Math.max(0, 0.85 - c.fill) * 3;
      if (areaM >= 200 && c.elong < 2.4) {
        const cost = 2 * Math.max(0, 1.7 - contrast) + (sandNear ? 0 : 0.8) + Math.abs(Math.log(areaM / 550)) * 0.8 + shape + ringTurf * 0.8;
        greens.push({ x: c.x, y: c.y, n: c.n, cost, poly: outline(lab, W, H, c, 24) });
      }
      if (areaM <= 900) {
        const cost = 2 * Math.max(0, 1.5 - contrast) + Math.abs(Math.log(areaM / 250)) * 0.6 + Math.max(0, 0.8 - c.fill) * 3 + ringTurf * 0.6;
        tees.push({ x: c.x, y: c.y, n: c.n, cost });
      }
    });
  });
  // the same patch found at several levels: keep the best version
  const dedupe = (list, d, max) => {
    const out = [];
    list.sort((a, b) => a.cost - b.cost).forEach(g => { if (!out.some(o => Math.hypot(o.x - g.x, o.y - g.y) < d)) out.push(g); });
    return out.slice(0, max);
  };
  const G = dedupe(greens, 14 / m, 70);
  const T = dedupe(tees, 9 / m, 180).map(t => ({ x: t.x, y: t.y, n: t.n, cost: t.cost }));

  // coarse tree mask (every 2 px) for the line of each hole
  const tw = Math.ceil(W / 2), th = Math.ceil(H / 2), treeMap = new Uint8Array(tw * th);
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) treeMap[(y >> 1) * tw + (x >> 1)] = trees[y * W + x];
  return { greens: G, tees: T, bunkers, ponds, treeMap, tw, th, m };
}

/* Share of the straight line between two pixel points that runs over trees. */
function treeShare(a, b, scan) {
  const d = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(4, Math.round(d * scan.m / 4));
  let t = 0, n = 0;
  for (let s = 1; s < steps; s++) {
    const x = (a.x + (b.x - a.x) * s / steps) >> 1, y = (a.y + (b.y - a.y) * s / steps) >> 1;
    if (x < 0 || y < 0 || x >= scan.tw || y >= scan.th) continue;
    t += scan.treeMap[y * scan.tw + x]; n++;
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
    if (scan) top.forEach(c => { c.cost += Math.max(0, treeShare(c.tee, c.green, scan) - 0.15) * 6; });
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
/* rgb mosaic + plan from tilePlan → features and holes, in lat/lon. */
function scanCourse(rgb, plan, course, known) {
  const scan = analyze(rgb, plan.W, plan.H, plan.m, { cx: plan.cx, cy: plan.cy, r: plan.r });
  const ll = p => toLL(plan, p.x, p.y);
  const greens = scan.greens.map(g => Object.assign(ll(g), { x: g.x, y: g.y, cost: g.cost }));
  const tees = scan.tees.map(t => Object.assign(ll(t), { x: t.x, y: t.y, cost: t.cost }));
  const res = course && course.pars && course.pars.length ? pairHoles(course, greens, tees, known, scan) : { holes: {} };
  // features: greens used by a hole, plus bunkers and water
  const usedGreens = new Set(Object.values(res.holes).map(h => h.gi));
  const features = [];
  scan.greens.forEach((g, i) => { if (usedGreens.has(i)) features.push({ type: 'green', ll: g.poly.map(ll) }); });
  scan.bunkers.forEach(b => features.push({ type: 'bunker', ll: b.poly.map(ll) }));
  scan.ponds.forEach(w => features.push({ type: 'water', ll: w.poly.map(ll) }));
  Object.values(res.holes).forEach(h => { delete h.gi; });
  return { holes: res.holes, features, found: { greens: greens.length, tees: tees.length, bunkers: scan.bunkers.length, water: scan.ponds.length }, greens, tees };
}

module.exports = { tilePlan, toLL, toPx, metresPerPx, analyze, pairHoles, scanCourse, yardsBetween, boxMean, components };
