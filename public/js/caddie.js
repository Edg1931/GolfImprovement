/* Caddie engine: dispersion learning and club/aim recommendations.
   Pure functions (no DOM), shared by the browser app and the Node tests.

   Coordinates: positions are {lat, lon}; for maths they are projected to a local flat grid in yards
   ({x: east, y: north}) around an origin, which is accurate to well under a yard across a golf hole.

   Dispersion: for each club we keep the typical total distance ("along" the target line), the
   average sideways miss ("lat", + = right) and the spread of both. It starts from an estimate based on
   the chart distance and the player's handicap, then moves toward the player's real GPS shots.

   Recommendation: for each club, simulate a few hundred landing spots from its dispersion, see where
   they finish (green, fairway, rough, sand, water, out of bounds, trees), and score each spot with the
   average number of strokes a mid-handicapper needs from there. Lowest expected score wins. */
(function (root) {
  const YPM = 1 / 0.9144;   // yards per metre

  /* ---------- geometry ---------- */
  function projector(origin) {
    const k = Math.cos(origin.lat * Math.PI / 180);
    return {
      toXY: p => ({ x: (p.lon - origin.lon) * 111320 * k * YPM, y: (p.lat - origin.lat) * 110574 * YPM }),
      toLL: q => ({ lat: origin.lat + q.y / (110574 * YPM), lon: origin.lon + q.x / (111320 * k * YPM) }),
    };
  }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function pointInPolygon(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  function centroid(poly) { const n = poly.length; return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n }; }
  /* Signed offsets of `end` relative to the line start→target: along the line, and sideways (+ = right). */
  function offsets(start, target, end) {
    const ux = target.x - start.x, uy = target.y - start.y, L = Math.hypot(ux, uy) || 1;
    const dx = end.x - start.x, dy = end.y - start.y;
    return { along: (dx * ux + dy * uy) / L, lat: (dx * uy - dy * ux) / L };
  }
  /* Point reached from `start`, heading toward `target`, `along` yards down the line and `lat` yards right of it. */
  function landing(start, target, along, lat) {
    const ux = target.x - start.x, uy = target.y - start.y, L = Math.hypot(ux, uy) || 1;
    const u = { x: ux / L, y: uy / L }, r = { x: u.y, y: -u.x };
    return { x: start.x + u.x * along + r.x * lat, y: start.y + u.y * along + r.y * lat };
  }
  /* Point `d` yards along a polyline from its start (for following a dogleg). */
  function alongPolyline(line, d) {
    for (let i = 1; i < line.length; i++) {
      const seg = dist(line[i - 1], line[i]);
      if (d <= seg) { const t = d / seg; return { x: line[i - 1].x + (line[i].x - line[i - 1].x) * t, y: line[i - 1].y + (line[i].y - line[i - 1].y) * t }; }
      d -= seg;
    }
    return line[line.length - 1];
  }

  /* ---------- random numbers (seeded, so the same inputs give the same advice) ---------- */
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function gauss(r) { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }

  /* ---------- dispersion model ---------- */
  function clubKind(name) {
    const n = String(name).toLowerCase();
    if (/driver|^d$|^1w/.test(n)) return 'driver';
    if (/^(pw|gw|aw|sw|lw|uw)$|wedge|^\d\d°?$/.test(n)) return 'wedge';   // before woods: "SW" ends in w
    if (/w$|wood/.test(n)) return 'wood';
    if (/h$|hy|rescue/.test(n)) return 'hybrid';
    const m = /(\d)\s*i/.exec(n); if (m) return +m[1] <= 5 ? 'longiron' : 'iron';
    return 'iron';
  }
  const ROLL = { driver: 0.08, wood: 0.05, hybrid: 0.04, longiron: 0.03, iron: 0.02, wedge: 0.0 };
  const WIDTH = { driver: 1.3, wood: 1.2, hybrid: 1.1, longiron: 1.1, iron: 1.0, wedge: 0.9 };
  /* Starting estimate before any shots: typical total distance and spread for this handicap. */
  function prior(club, carry, index) {
    const h = index == null || isNaN(index) ? 18 : Math.max(0, Math.min(36, index));
    const kind = clubKind(club);
    return { club, kind, along: carry * (1 + ROLL[kind]), alongSD: carry * (0.045 + h * 0.0018), lat: 0, latSD: carry * (0.05 + h * 0.0025) * WIDTH[kind], n: 0, nLat: 0 };
  }
  const PRIOR_WEIGHT = 4;   // the estimate counts like 4 shots, so real shots take over quickly
  /* Blend the estimate with real shots ({v, w}: value and weight; range shots count half). */
  function blend(pm, psd, xs) {
    const k = PRIOR_WEIGHT, W = xs.reduce((s, x) => s + x.w, 0);
    if (!xs.length) return { mean: pm, sd: psd };
    const mean = (pm * k + xs.reduce((s, x) => s + x.w * x.v, 0)) / (k + W);
    const ss = xs.reduce((s, x) => s + x.w * (x.v - mean) ** 2, 0) + k * (psd ** 2 + (pm - mean) ** 2);
    return { mean, sd: Math.sqrt(ss / (k + W)) };
  }
  const RANGE_WEIGHT = 0.5;
  /* Model for one club from its chart carry and logged shots ({along|yards, lat, source}). */
  function clubModel(club, carry, shots, index) {
    const p = prior(club, carry, index);
    const w = s => (s.source === 'range' ? RANGE_WEIGHT : 1);
    const along = shots.map(s => ({ v: s.along != null ? s.along : s.yards, w: w(s) })).filter(x => x.v != null && isFinite(x.v));
    const lat = shots.map(s => ({ v: s.lat, w: w(s) })).filter(x => x.v != null && isFinite(x.v));
    const A = blend(p.along, p.alongSD, along), L = blend(0, p.latSD, lat);
    const course = shots.filter(s => s.source !== 'range' && s.lat != null).length;
    return { club, kind: p.kind, carry, along: A.mean, alongSD: Math.max(3, A.sd), lat: L.mean, latSD: Math.max(3, L.sd), n: along.length, nLat: lat.length, nCourse: course, nRange: lat.length - course, learned: lat.length >= 3 };
  }
  function bagModels(clubs, shotLog, index) {
    return clubs.filter(c => c.carry > 0).map(c => clubModel(c.club, c.carry, (shotLog || []).filter(s => s.club === c.club), index));
  }

  /* ---------- where a ball finishes, and what it's worth ---------- */
  const PRIORITY = ['ob', 'water', 'bunker', 'green', 'trees', 'fairway', 'tee'];
  function classify(p, features, fairwaysMapped) {
    let best = null;
    for (const f of features) {
      if (!f.xy || f.xy.length < 3) continue;
      const rank = PRIORITY.indexOf(f.type); if (rank < 0) continue;
      if ((best == null || rank < PRIORITY.indexOf(best)) && pointInPolygon(p, f.xy)) best = f.type;
    }
    if (best === 'tee') best = 'fairway';
    return best || (fairwaysMapped ? 'rough' : 'fairway');
  }
  function interp(tbl, v) {
    if (v <= tbl[0][0]) return tbl[0][1];
    for (let i = 1; i < tbl.length; i++) if (v <= tbl[i][0]) { const [x0, y0] = tbl[i - 1], [x1, y1] = tbl[i]; return y0 + (y1 - y0) * (v - x0) / (x1 - x0); }
    const [xa, ya] = tbl[tbl.length - 2], [xb, yb] = tbl[tbl.length - 1]; return yb + (yb - ya) * (v - xb) / (xb - xa);
  }
  // Average strokes to hole out for a mid-handicap player (approximate, from published amateur shot data).
  const FAIRWAY = [[5, 2.35], [20, 2.5], [50, 2.75], [100, 3.0], [150, 3.3], [200, 3.7], [250, 4.1], [300, 4.4], [400, 5.0], [550, 5.5]];
  const PUTT_FT = [[1, 1.0], [3, 1.05], [6, 1.35], [10, 1.6], [20, 1.87], [30, 2.0], [50, 2.15], [80, 2.35]];
  function strokesFrom(lie, yards) {
    const f = interp(FAIRWAY, yards);
    switch (lie) {
      case 'green': return interp(PUTT_FT, yards * 3);
      case 'rough': return f + (yards > 40 ? 0.25 : 0.15);
      case 'sand': case 'bunker': return f + (yards < 50 ? 0.45 : 0.35);
      case 'trees': return f + 0.6;
      default: return f;
    }
  }

  /* Simulate `n` shots with `model` from start toward target; score where they finish. */
  function simulate(start, target, model, course, opts) {
    opts = opts || {};
    const n = opts.samples || 300, r = rng(opts.seed || 1), adjust = opts.adjust || 0, drift = opts.drift || 0;
    const fairways = course.features.some(f => f.type === 'fairway');
    const shares = {}, side = { left: 0, right: 0 }; let total = 0;
    for (let i = 0; i < n; i++) {
      const along = model.along - adjust + gauss(r) * model.alongSD, lat = model.lat + drift + gauss(r) * model.latSD;
      const p = landing(start, target, along, lat);
      const lie = classify(p, course.features, fairways);
      const d = course.green ? dist(p, course.green) : 0;
      let s;
      if (lie === 'water') s = 1 + strokesFrom('rough', d);                 // penalty drop near where it crossed
      else if (lie === 'ob') s = 1 + (course.green ? strokesFrom('fairway', dist(start, course.green)) : 3);   // stroke and distance
      else s = strokesFrom(lie, d);
      total += s; shares[lie] = (shares[lie] || 0) + 1;
      if (lie === 'water' || lie === 'ob' || lie === 'trees' || lie === 'bunker') side[lat < 0 ? 'left' : 'right']++;
    }
    Object.keys(shares).forEach(k => { shares[k] = shares[k] / n; });
    return { expected: 1 + total / n, shares, trouble: { left: side.left / n, right: side.right / n } };
  }

  /* Best clubs for a shot from `start` toward `target`, with the best aim for each.
     course: {features:[{type, xy:[{x,y}]}], green:{x,y}}; models from bagModels(). */
  function recommend(start, target, models, course, opts) {
    opts = opts || {};
    const toTarget = dist(start, target), toGreen = course.green ? dist(start, course.green) : toTarget;
    const candidates = models.filter(m => m.along - (opts.adjust || 0) <= toGreen + 25 + 2 * m.alongSD && m.along - (opts.adjust || 0) >= Math.min(toTarget, toGreen) * 0.45);
    const pool = candidates.length ? candidates : models.slice().sort((a, b) => Math.abs(a.along - toTarget) - Math.abs(b.along - toTarget)).slice(0, 3);
    const mapped = course.features && course.features.length;
    const results = pool.map(m => {
      if (!mapped) return { club: m.club, model: m, expected: null, shares: {}, aim: target, aimShift: 0, gap: m.along - (opts.adjust || 0) - toTarget };
      // try aiming a little left or right of the target and keep the best
      let best = null;
      const step = Math.max(2, Math.round(m.latSD / 4));
      for (let off = -6 * step; off <= 6 * step; off += step) {
        const aim = landing(start, target, toTarget, off);
        const sim = simulate(start, aim, m, course, opts);
        if (!best || sim.expected < best.expected - 0.005 || (Math.abs(sim.expected - best.expected) <= 0.005 && Math.abs(off) < Math.abs(best.aimShift))) best = { ...sim, aim, aimShift: off };
      }
      return { club: m.club, model: m, gap: m.along - (opts.adjust || 0) - toTarget, ...best };
    });
    if (mapped) results.sort((a, b) => a.expected - b.expected);
    else results.sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap));
    return results;
  }

  /* Ellipse outline (for drawing) covering about three quarters of a club's shots. */
  function ellipse(start, target, model, adjust, points, drift) {
    const k = 1.665, out = [];
    for (let i = 0; i < (points || 36); i++) {
      const t = 2 * Math.PI * i / (points || 36);
      out.push(landing(start, target, model.along - (adjust || 0) + Math.sin(t) * model.alongSD * k, model.lat + (drift || 0) + Math.cos(t) * model.latSD * k));
    }
    return out;
  }

  const Caddie = { projector, dist, pointInPolygon, centroid, offsets, landing, alongPolyline, rng, gauss, clubKind, prior, clubModel, bagModels, classify, strokesFrom, simulate, recommend, ellipse };
  if (typeof module !== 'undefined' && module.exports) module.exports = Caddie; else root.Caddie = Caddie;
})(typeof window !== 'undefined' ? window : globalThis);
