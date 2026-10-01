/* World Handicap System calculations and stroke-loss analysis. */

function scoreDifferential(score, rating, slope) {
  if ([score, rating, slope].some(v => v == null || isNaN(v)) || !slope) return null;
  return Math.round((113 / slope) * (score - rating) * 10) / 10;
}

/* WHS table: number of differentials available -> how many to use and adjustment. */
function whsRule(n) {
  if (n < 3) return null;
  if (n === 3) return { use: 1, adj: -2 };
  if (n === 4) return { use: 1, adj: -1 };
  if (n === 5) return { use: 1, adj: 0 };
  if (n === 6) return { use: 2, adj: -1 };
  if (n <= 8) return { use: 2, adj: 0 };
  if (n <= 11) return { use: 3, adj: 0 };
  if (n <= 14) return { use: 4, adj: 0 };
  if (n <= 16) return { use: 5, adj: 0 };
  if (n <= 18) return { use: 6, adj: 0 };
  if (n === 19) return { use: 7, adj: 0 };
  return { use: 8, adj: 0 };
}

/* rounds sorted newest first; uses up to the latest 20 */
function computeIndex(rounds) {
  const diffs = rounds.map(r => r.diff).filter(d => d != null).slice(0, 20);
  const rule = whsRule(diffs.length);
  if (!rule) return null;
  const best = diffs.slice().sort((a, b) => a - b).slice(0, rule.use);
  const idx = best.reduce((a, b) => a + b, 0) / best.length + rule.adj;
  return Math.round(idx * 10) / 10;
}

/* Index history: value after each round, oldest first */
function indexHistory(roundsNewestFirst) {
  const asc = roundsNewestFirst.slice().reverse();
  const out = [];
  for (let i = 0; i < asc.length; i++) {
    const window = asc.slice(0, i + 1).reverse();
    const idx = computeIndex(window);
    out.push({ date: asc[i].date, index: idx, score: asc[i].score });
  }
  return out;
}

function courseHandicap(index, slope, rating, par) {
  if (index == null || isNaN(index)) return null;
  const ch = index * (slope / 113) + ((rating != null && par != null) ? (rating - par) : 0);
  return Math.round(ch);
}

/* Aggregate stats over the last N rounds (newest first). */
function roundStats(rounds, n) {
  const rs = rounds.filter(r => r.holesPlayed !== 9).slice(0, n);
  if (!rs.length) return null;
  const s = {
    n: rs.length,
    score: avg(rs.map(r => r.score)),
    diff: avg(rs.map(r => r.diff)),
    putts: avg(rs.map(r => r.putts)),
    gir: avg(rs.map(r => r.gir)),
    girPct: avg(rs.map(r => r.gir != null ? 100 * r.gir / 18 : null)),
    firPct: avg(rs.map(r => (r.firHit != null && r.firPossible) ? 100 * r.firHit / r.firPossible : null)),
    penalties: avg(rs.map(r => r.penalties)),
    threePutts: avg(rs.map(r => r.threePutts)),
    doubles: avg(rs.map(r => r.doubles)),
    scrambling: null, sandSave: null,
  };
  const udA = rs.reduce((a, r) => a + (r.udAtt || 0), 0), udM = rs.reduce((a, r) => a + (r.udMade || 0), 0);
  if (udA) s.scrambling = 100 * udM / udA;
  const sA = rs.reduce((a, r) => a + (r.sandAtt || 0), 0), sM = rs.reduce((a, r) => a + (r.sandMade || 0), 0);
  if (sA) s.sandSave = 100 * sM / sA;
  return s;
}

/* Estimate strokes lost per round vs a benchmark handicap in each area. Returns sorted areas. */
function strokeLossAnalysis(stats, targetHcp) {
  if (!stats) return [];
  const b = benchmarkFor(targetHcp);
  const missed = 18 - (stats.gir != null ? stats.gir : 18 * b.gir / 100);
  const areas = [];
  if (stats.putts != null) areas.push({
    key: 'putting', label: 'Putting', yours: fmt1(stats.putts) + ' putts', bench: fmt1(b.putts) + ' putts',
    loss: stats.putts - b.putts, cats: ['putting'],
    note: 'Putts per round. Includes both lag speed (3-putts) and short-putt make rate.',
  });
  if (stats.threePutts != null) areas.push({
    key: 'lag', label: 'Lag putting (3-putts)', yours: fmt1(stats.threePutts) + ' / round', bench: fmt1(b.threePutts) + ' / round',
    loss: (stats.threePutts - b.threePutts), cats: ['putting'], drills: ['ladder-lag', 'leapfrog', 'eyes-closed-speed'],
    note: 'Each extra three-putt is one full stroke. Mostly speed, not line.',
  });
  if (stats.scrambling != null) areas.push({
    key: 'scrambling', label: 'Short game (scrambling)', yours: Math.round(stats.scrambling) + '%', bench: b.scrambling + '%',
    loss: ((b.scrambling - stats.scrambling) / 100) * missed, cats: ['chipping', 'pitching', 'bunker'],
    note: 'Up-and-down rate when you miss a green. Multiplied by the number of greens you miss.',
  });
  if (stats.girPct != null) areas.push({
    key: 'approach', label: 'Approach play (GIR)', yours: Math.round(stats.girPct) + '%', bench: b.gir + '%',
    loss: ((b.gir - stats.girPct) / 100) * 18 * 0.6, cats: ['irons', 'wedges'],
    note: 'Each missed green costs roughly 0.6 strokes after scrambling is accounted for.',
  });
  if (stats.firPct != null) areas.push({
    key: 'driving', label: 'Driving accuracy (FIR)', yours: Math.round(stats.firPct) + '%', bench: b.fir + '%',
    loss: ((b.fir - stats.firPct) / 100) * 14 * 0.35, cats: ['driver'],
    note: 'A missed fairway costs about a third of a stroke on average, far more when it finds a hazard.',
  });
  if (stats.penalties != null) areas.push({
    key: 'penalties', label: 'Penalty strokes', yours: fmt1(stats.penalties) + ' / round', bench: fmt1(b.penalties) + ' / round',
    loss: stats.penalties - b.penalties, cats: ['course', 'driver'], drills: ['centre-of-green', 'two-ball-scenario', 'stock-shot'],
    note: 'The most expensive and most avoidable strokes in golf. Almost always a strategy problem, not a swing problem.',
  });
  if (stats.doubles != null) areas.push({
    key: 'blowups', label: 'Double bogeys or worse', yours: fmt1(stats.doubles) + ' / round', bench: fmt1(b.doubles) + ' / round',
    loss: (stats.doubles - b.doubles) * 0.8, cats: ['course', 'mental'], drills: ['bogey-is-par', 'post-shot-10', 'process-goals'],
    note: 'Blow-up holes usually chain a poor decision to a poor shot. Strategy and the 10-second rule fix most of them.',
  });
  areas.forEach(a => { a.loss = Math.round(a.loss * 10) / 10; });
  return areas.sort((x, y) => y.loss - x.loss);
}

/* Practice recommendation: list of {area, drills[]} using the analysis and drill library. */
function recommendDrills(areas, limitPerArea) {
  const out = [];
  for (const a of areas.slice(0, 3)) {
    if (a.loss <= 0) continue;
    let ids = a.drills ? a.drills.slice() : [];
    if (!ids.length) ids = DRILLS.filter(d => a.cats.includes(d.category)).map(d => d.id);
    out.push({ area: a, drills: ids.slice(0, limitPerArea || 3).map(getDrill).filter(Boolean) });
  }
  return out;
}

/* Stableford points for a hole given gross strokes, par, and handicap strokes received. */
function stablefordPoints(gross, par, strokesReceived) {
  const net = gross - strokesReceived;
  const diff = net - par;
  return Math.max(0, 2 - diff);
}

/* ---------- Hole-by-hole scoring ---------- */

/* Handicap strokes received on a hole, given course handicap and the hole's stroke index (1 = hardest).
   n is the number of holes the stroke index runs over (18, or 9 for a nine-hole round). */
function strokesOnHole(ch, si, n) {
  n = n || 18;
  if (ch == null || isNaN(ch) || !si) return 0;
  if (ch >= 0) return Math.floor(ch / n) + (si <= ch % n ? 1 : 0);
  const plus = -ch; return -(Math.floor(plus / n) + (si > n - (plus % n) ? 1 : 0));
}

/* Re-rank a subset of 18-hole stroke indexes to 1..n (used when playing nine holes). */
function rankStrokeIndex(si) {
  const order = si.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = Array(si.length); order.forEach(([, i], rank) => { out[i] = rank + 1; }); return out;
}

/* Nine-hole course handicap: half the index, scaled by the nine's slope, plus rating minus par for that nine. */
function courseHandicap9(index, slope9, rating9, par9) {
  if (index == null || isNaN(index)) return null;
  return Math.round((index / 2) * (slope9 / 113) + (rating9 - par9));
}

/* WHS (2024): a nine-hole score becomes an 18-hole differential by adding the player's expected
   nine-hole differential, (Index × 0.52) + 1.2. Needs an index; returns null otherwise. */
function nineHoleDifferential(score9, rating9, slope9, index) {
  if (index == null || isNaN(index) || [score9, rating9, slope9].some(v => v == null || isNaN(v)) || !slope9) return null;
  const d9 = (113 / slope9) * (score9 - rating9);
  return Math.round((d9 + index * 0.52 + 1.2) * 10) / 10;
}

/* WHS adjusted gross score: each hole capped at net double bogey (par + 2 + strokes received).
   Golfers without an index are capped at par + 5. */
function adjustedGross(holes, pars, si, ch) {
  return holes.reduce((sum, h, i) => {
    if (h.strokes == null) return sum;
    const cap = ch == null ? pars[i] + 5 : pars[i] + 2 + strokesOnHole(ch, si[i], holes.length);
    return sum + Math.min(h.strokes, cap);
  }, 0);
}

/* Derive the round-level stats the rest of the app uses from hole-by-hole entries. */
function statsFromHoles(holes, pars) {
  const played = holes.map((h, i) => ({ ...h, par: pars[i] })).filter(h => h.strokes != null);
  const s = { gross: 0, putts: 0, firHit: 0, firPossible: 0, gir: 0, penalties: 0, udAtt: 0, udMade: 0, sandAtt: 0, sandMade: 0, threePutts: 0, doubles: 0 };
  let puttsKnown = false, girKnown = false;
  played.forEach(h => {
    s.gross += h.strokes; s.penalties += h.pen || 0;
    if (h.strokes >= h.par + 2) s.doubles++;
    if (h.par >= 4 && h.fir) { s.firPossible++; if (h.fir === 'hit') s.firHit++; }
    if (h.putts != null) { puttsKnown = true; s.putts += h.putts; if (h.putts >= 3) s.threePutts++; }
    // green in regulation: from putts, or from tracked shots (which shot reached the green)
    const gir = h.putts != null ? h.strokes - h.putts <= h.par - 2 : h.girShots != null ? h.girShots : null;
    if (gir != null) { girKnown = true; if (gir) s.gir++; else { s.udAtt++; if (h.strokes <= h.par) s.udMade++; } }
    if (h.sand) { s.sandAtt++; if (h.strokes <= h.par) s.sandMade++; }
  });
  if (!puttsKnown) ['putts', 'threePutts'].forEach(k => { s[k] = null; });
  if (!girKnown) ['gir', 'udAtt', 'udMade'].forEach(k => { s[k] = null; });
  if (!s.firPossible) { s.firHit = null; s.firPossible = null; }
  return s;
}

const SCORE_NAMES = [[-3, 'Albatross'], [-2, 'Eagle'], [-1, 'Birdie'], [0, 'Par'], [1, 'Bogey'], [2, 'Double'], [3, 'Triple+']];
function scoreName(strokes, par) { const d = Math.max(-3, Math.min(3, strokes - par)); return SCORE_NAMES.find(n => n[0] === d)[1]; }

/* Scoring breakdown across rounds that have hole data (newest first). */
function holeBreakdown(rounds) {
  const withHoles = rounds.filter(r => Array.isArray(r.holes) && r.pars);
  if (!withHoles.length) return null;
  const dist = { eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0, triple: 0 };
  const byPar = { 3: [], 4: [], 5: [] }; const front = [], back = [];
  const miss = { hit: 0, left: 0, right: 0 };
  let holesN = 0;
  withHoles.forEach(r => {
    let f = 0, b = 0, full = true;
    r.holes.forEach((h, i) => {
      if (h.strokes == null) { full = false; return; }
      const par = r.pars[i], d = h.strokes - par; holesN++;
      if (d <= -2) dist.eagle++; else if (d === -1) dist.birdie++; else if (d === 0) dist.par++; else if (d === 1) dist.bogey++; else if (d === 2) dist.double++; else dist.triple++;
      if (byPar[par]) byPar[par].push(d);
      if (i < 9) f += d; else b += d;
      if (par >= 4 && h.fir && miss[h.fir] != null) miss[h.fir]++;
    });
    if (full && r.holes.length === 18) { front.push(f); back.push(b); }
  });
  return { rounds: withHoles.length, holes: holesN, dist, par3: avg(byPar[3]), par4: avg(byPar[4]), par5: avg(byPar[5]), front: avg(front), back: avg(back), miss };
}

/* Great-circle distance in yards between two {lat, lon} points. */
function yardsBetween(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)) * 1.09361;
}

/* WHS caps. Once 20 scores exist, the Low Handicap Index (LHI) is the lowest index in the
   365 days before the latest score. An increase of more than 3.0 over the LHI is halved
   (soft cap) and the index can never exceed LHI + 5.0 (hard cap). */
function cappedIndex(roundsNewestFirst) {
  const raw = computeIndex(roundsNewestFirst);
  const out = { index: raw, raw, lhi: null, cap: null };
  if (raw == null || roundsNewestFirst.filter(r => r.diff != null).length < 20) return out;
  const hist = indexHistory(roundsNewestFirst);
  const latest = roundsNewestFirst[0].date;
  const from = new Date(new Date(latest + 'T00:00:00').getTime() - 365 * 86400000).toISOString().slice(0, 10);
  // only revisions made once the player had 20 scores (earlier ones carry the small-sample adjustments)
  const lows = hist.slice(19, -1).filter(h => h.index != null && h.date >= from && h.date <= latest).map(h => h.index);
  if (!lows.length) return out;
  const lhi = Math.min(...lows); out.lhi = lhi;
  let idx = raw;
  if (idx - lhi > 3) { idx = lhi + 3 + (idx - lhi - 3) / 2; out.cap = 'soft'; }
  if (idx - lhi > 5) { idx = lhi + 5; out.cap = 'hard'; }
  out.index = Math.round(idx * 10) / 10;
  return out;
}
