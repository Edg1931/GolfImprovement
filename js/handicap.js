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
  const diffs = rounds.slice(0, 20).map(r => r.diff).filter(d => d != null);
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
  const rs = rounds.slice(0, n);
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
