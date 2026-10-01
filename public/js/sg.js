/* Strokes gained. Every shot is scored against the average number of strokes a golfer at the player's
   target handicap needs to hole out from where it started, minus the same from where it finished, minus
   one. Baselines are approximate tables for a scratch and a bogey golfer (from published amateur and tour
   shot data), blended by handicap.

   Data comes from the live round: the hole's length (tee to flag), shots tracked with GPS (start, finish,
   the lie of each worked out from the course map), and the first-putt distance (from the approach's GPS
   finish, or tapped in). Any strokes that weren't tracked are reported as "untracked" rather than guessed. */

const SG = {
  // [distance, strokes to hole out]; yards, except the green which is in feet
  BASE: {
    scratch: {
      tee: [[100, 2.92], [150, 3.08], [200, 3.28], [250, 3.55], [300, 3.78], [350, 3.98], [400, 4.12], [450, 4.3], [500, 4.6], [550, 4.8], [600, 5.0]],
      fairway: [[5, 2.2], [20, 2.5], [50, 2.68], [100, 2.9], [150, 3.05], [200, 3.28], [250, 3.55], [300, 3.8]],
      rough: [[5, 2.35], [20, 2.62], [50, 2.85], [100, 3.1], [150, 3.3], [200, 3.55], [250, 3.8], [300, 4.0]],
      bunker: [[5, 2.4], [20, 2.55], [50, 2.95], [100, 3.25], [150, 3.45], [200, 3.7], [250, 3.95]],
      trees: [[20, 3.1], [50, 3.35], [100, 3.6], [150, 3.85], [200, 4.1], [250, 4.35]],
      green: [[1, 1.0], [2, 1.02], [3, 1.05], [5, 1.2], [8, 1.45], [10, 1.55], [15, 1.75], [20, 1.87], [30, 2.0], [40, 2.08], [60, 2.2], [90, 2.35]],
    },
    bogey: {
      tee: [[100, 3.3], [150, 3.55], [200, 3.9], [250, 4.25], [300, 4.55], [350, 4.8], [400, 5.05], [450, 5.35], [500, 5.75], [550, 6.0], [600, 6.25]],
      fairway: [[5, 2.4], [20, 2.65], [50, 2.95], [100, 3.25], [150, 3.6], [200, 3.95], [250, 4.3], [300, 4.6]],
      rough: [[5, 2.55], [20, 2.85], [50, 3.15], [100, 3.5], [150, 3.85], [200, 4.2], [250, 4.5], [300, 4.8]],
      bunker: [[5, 2.8], [20, 3.0], [50, 3.4], [100, 3.75], [150, 4.0], [200, 4.3], [250, 4.6]],
      trees: [[20, 3.35], [50, 3.65], [100, 4.0], [150, 4.35], [200, 4.7], [250, 5.0]],
      green: [[1, 1.0], [2, 1.04], [3, 1.1], [5, 1.3], [8, 1.58], [10, 1.7], [15, 1.9], [20, 2.02], [30, 2.15], [40, 2.25], [60, 2.4], [90, 2.6]],
    },
  },
  LIES: [['tee', 'Tee'], ['fairway', 'Fairway'], ['rough', 'Rough'], ['bunker', 'Sand'], ['trees', 'Trees'], ['green', 'Green'], ['water', 'Water'], ['ob', 'Out of bounds']],
  CATS: [['ott', 'Off the tee', 'driving'], ['app', 'Approach', 'approach'], ['arg', 'Around the green', 'scrambling'], ['putt', 'Putting', 'putting']],

  interp(tbl, v) {
    if (v <= tbl[0][0]) return tbl[0][1];
    for (let i = 1; i < tbl.length; i++) if (v <= tbl[i][0]) { const [x0, y0] = tbl[i - 1], [x1, y1] = tbl[i]; return y0 + (y1 - y0) * (v - x0) / (x1 - x0); }
    const [xa, ya] = tbl[tbl.length - 2], [xb, yb] = tbl[tbl.length - 1]; return yb + (yb - ya) * (v - xb) / (xb - xa);
  },
  /* Average strokes to hole out from `yards` in `lie`, for a golfer of handicap `hcp`. */
  expected(lie, yards, hcp) {
    if (yards <= 0.4) return 0;
    const L = lie === 'sand' ? 'bunker' : lie === 'water' || lie === 'ob' ? 'rough' : this.BASE.scratch[lie] ? lie : 'rough';
    const v = L === 'green' ? yards * 3 : yards;
    const w = Math.max(-0.3, Math.min(1.8, (hcp == null ? 15 : hcp) / 18));
    const a = this.interp(this.BASE.scratch[L], v), b = this.interp(this.BASE.bogey[L], v);
    return a + (b - a) * w;
  },

  /* A tracked shot on the live round's current hole, with its lies. */
  record(lr, course, holeNo, club, from, to, flag) {
    if (!lr) return null;
    const h = lr.holes[holeNo - (lr.first || 0) - 1]; if (!h) return null;
    h.shots = h.shots || [];
    const prev = h.shots[h.shots.length - 1];
    const tee = course && CourseMap.holeInfo(course, holeNo).tee;
    let fromLie;
    if (!prev && (!tee || yardsBetween(from, tee) < 40)) fromLie = 'tee';
    else if (prev && yardsBetween(prev.to, from) < 15 && prev.toLie !== 'water' && prev.toLie !== 'ob') fromLie = prev.toLie;
    else fromLie = course ? CourseMap.lieAt(course, holeNo, from, flag) : 'fairway';
    const toLie = course ? CourseMap.lieAt(course, holeNo, to, flag) : 'fairway';
    const s = { id: uid(), club: club || '', from: CourseMap.pt(from), to: CourseMap.pt(to), fromLie, toLie };
    h.shots.push(s);
    // an approach that finishes on the green gives the first-putt distance
    if (toLie === 'green' && flag && (h.firstPutt == null || h.fpAuto)) { h.firstPutt = Math.max(1, Math.round(yardsBetween(to, flag) * 3)); h.fpAuto = true; }
    return s;
  },

  /* Fill in the hole's stats from its tracked shots, so they needn't be entered: the tee shot (fairway
     hit, or missed left or right), green in regulation (which shot reached the green), putts (score
     minus the shots to reach the green), penalties (shots into water or out of bounds) and a
     greenside bunker. Anything the player set by hand (h.set) is left alone; h.auto marks what was
     filled in. Returns the hole. */
  autoFill(lr, i) {
    const h = lr && lr.holes[i]; if (!h) return h;
    const shots = h.shots || [];
    const set = h.set || {}, auto = h.auto = {}, par = lr.pars[i];
    if (!shots.length) { h.girShots = null; return h; }
    const holeNo = (lr.first || 0) + i + 1, course = lr.courseId && App.state.courses.find(c => c.id === lr.courseId);
    const info = course ? CourseMap.holeInfo(course, holeNo) : {}, flag = (lr.pins && lr.pins[holeNo]) || info.green;
    const pen = s => (s.toLie === 'water' || s.toLie === 'ob' ? 1 : 0);
    if (!set.pen) { const p = shots.reduce((a, s) => a + pen(s), 0); if (p || h.pen) { h.pen = p; auto.pen = true; } }
    // the shot that reached the green (shots from the green are putts)
    const k = shots.findIndex(s => s.toLie === 'green' && s.fromLie !== 'green');
    if (k >= 0) {
      const toGreen = k + 1 + shots.slice(0, k + 1).reduce((a, s) => a + pen(s), 0);
      h.toGreen = toGreen; h.girShots = toGreen <= par - 2;
      if (!set.putts && h.strokes != null) { h.putts = Math.max(0, Math.min(6, h.strokes - toGreen)); auto.putts = true; }
    } else { h.toGreen = null; h.girShots = null; }
    // the tee shot
    const t = shots[0];
    if (par >= 4 && !set.fir && t && t.fromLie === 'tee' && t.toLie && t.toLie !== 'tee') {
      if (t.toLie === 'fairway' || t.toLie === 'green') h.fir = 'hit';
      else {
        const end = flag || info.green, side = end ? Caddie.offsets({ x: 0, y: 0 }, Caddie.projector(t.from).toXY(end), Caddie.projector(t.from).toXY(t.to)).lat : 0;
        h.fir = side < 0 ? 'left' : 'right';
      }
      auto.fir = true;
    }
    // a bunker shot near the green
    if (!set.sand && flag) {
      const gs = shots.some(s => s.fromLie === 'sand' && yardsBetween(s.from, flag) < 50);
      if (gs || h.sand) { h.sand = gs; auto.sand = true; }
    }
    return h;
  },

  /* Fill in the numbers strokes gained needs when a round is saved: hole length and each shot's distances. */
  prepare(r, course) {
    if (!r.holes) return;
    r.holes.forEach((h, i) => {
      const n = (r.firstHole || 0) + i + 1;
      const info = course ? CourseMap.holeInfo(course, n) : {};
      const flag = (r.pins && r.pins[n]) || info.green;
      if (info.tee && flag) h.len = Math.round(yardsBetween(info.tee, flag));
      else if (r.yards && r.yards[i]) h.len = r.yards[i];
      (h.shots || []).forEach(s => { if (flag) { s.d0 = Math.round(yardsBetween(s.from, flag) * 10) / 10; s.d1 = Math.round(yardsBetween(s.to, flag) * 10) / 10; } });
    });
  },

  /* Strokes gained for one hole: total, per category, and what's left untracked. */
  hole(h, par, hcp) {
    if (h.strokes == null || !h.len) return null;
    const E = (lie, d) => this.expected(lie, d, hcp);
    const out = { total: E('tee', h.len) - h.strokes, ott: 0, app: 0, arg: 0, putt: null, other: 0, shots: [] };
    let tracked = 0;
    (h.shots || []).forEach((s, k) => {
      if (s.d0 == null || s.fromLie === 'green') return;
      const e0 = E(s.fromLie === 'tee' && k === 0 ? 'tee' : s.fromLie, s.d0);
      const e1 = s.toLie === 'ob' ? e0 + 1 : s.toLie === 'water' ? E('rough', s.d1) + 1 : E(s.toLie, s.d1);
      const sg = e0 - e1 - 1;
      const cat = s.fromLie === 'tee' && par >= 4 ? 'ott' : s.d0 <= 30 && s.fromLie !== 'tee' ? 'arg' : 'app';
      out[cat] += sg; tracked += sg; out.shots.push({ id: s.id, sg, cat });
    });
    if (h.putts === 0) out.putt = 0;
    else if (h.putts != null && h.firstPutt != null) out.putt = E('green', h.firstPutt / 3) - h.putts;
    out.other = out.total - tracked - (out.putt || 0);
    out.tracked = (h.shots || []).length;
    return out;
  },

  /* Totals for a round (null when it has no hole lengths). */
  round(r, hcp) {
    if (!r.holes || !r.pars) return null;
    const t = { total: 0, ott: 0, app: 0, arg: 0, putt: 0, other: 0, holes: 0, puttHoles: 0, shots: 0, prox: [] };
    r.holes.forEach((h, i) => {
      const x = this.hole(h, r.pars[i], hcp); if (!x) return;
      t.holes++; t.total += x.total; t.ott += x.ott; t.app += x.app; t.arg += x.arg; t.other += x.other; t.shots += x.tracked;
      if (x.putt != null) { t.putt += x.putt; t.puttHoles++; }
      (h.shots || []).forEach(s => { if (s.toLie === 'green' && s.fromLie !== 'green' && s.d0 > 30 && s.d1 != null) t.prox.push(s.d1 * 3); });
    });
    return t.holes ? t : null;
  },

  /* Per-round averages over the last n rounds that have strokes-gained data. */
  summary(rounds, hcp, n) {
    const list = rounds.map(r => ({ r, sg: this.round(r, hcp) })).filter(x => x.sg).slice(0, n || 10);
    if (!list.length) return null;
    const avg = k => list.reduce((s, x) => s + x.sg[k], 0) / list.length;   // per round, over the holes that could be measured
    const prox = list.flatMap(x => x.sg.prox);
    return { rounds: list.length, total: avg('total'), ott: avg('ott'), app: avg('app'), arg: avg('arg'), putt: avg('putt'), other: avg('other'),
      shots: list.reduce((s, x) => s + x.sg.shots, 0), puttHoles: list.reduce((s, x) => s + x.sg.puttHoles, 0), holes: list.reduce((s, x) => s + x.sg.holes, 0),
      prox: prox.length ? prox.reduce((a, b) => a + b, 0) / prox.length : null, proxN: prox.length };
  },

  /* Focus areas for the practice plan once there's enough measured data: categories losing half a stroke or more. */
  focus() {
    const s = this.summary(App.rounds(), App.targetHcp(), 10); if (!s || s.rounds < 3) return [];
    return this.CATS.filter(([k]) => (k === 'putt' ? s.puttHoles >= 18 : s.shots >= 20)).map(([k, label, key]) => ({ key, label, loss: -s[k], source: 'sg' }))
      .filter(a => a.loss >= 0.5).sort((a, b) => b.loss - a.loss).slice(0, 2);
  },
};

function fmtSG(v) { if (v == null || isNaN(v)) return '—'; const x = Math.round(v * 100) / 100; return (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(2); }
function sgClass(v) { return v == null ? '' : v >= 0.1 ? 'sg-pos' : v <= -0.1 ? 'sg-neg' : ''; }

/* Strokes-gained card for the Stats page. */
function sgCard(rounds, n) {
  const hcp = App.targetHcp(), s = SG.summary(rounds, hcp, n);
  if (!s) return `<div class="card mt"><div class="card-head"><h2>Strokes gained</h2><span class="tag">GPS</span></div>
    <p class="small muted mb0">Track shots in the hole view at a mapped course to see where you gain and lose strokes.</p></div>`;
  const rows = SG.CATS.map(([k, label]) => [label, s[k]]).concat(s.other && Math.abs(s.other) >= 0.05 ? [['Untracked shots', s.other]] : []);
  const max = Math.max(1, ...rows.map(r => Math.abs(r[1])));
  return `<div class="card mt"><div class="card-head"><h2>Strokes gained</h2><span class="small muted">vs a ${hcp} handicap · average per round · ${s.rounds} round${s.rounds > 1 ? 's' : ''}, ${s.holes} holes measured</span></div>
    <div class="grid grid-2"><div>
      <div class="sg-total ${sgClass(s.total)}"><span>${fmtSG(s.total)}</span> strokes per round</div>
      <div class="sg-bars">${rows.map(([l, v]) => `<div class="sg-row"><span class="sg-lbl">${l}</span><span class="sg-bar"><i class="${v >= 0 ? 'pos' : 'neg'}" style="width:${Math.round(50 * Math.abs(v) / max)}%;${v >= 0 ? 'left:50%' : `right:50%`}"></i></span><span class="sg-val ${sgClass(v)}">${fmtSG(v)}</span></div>`).join('')}</div>
    </div><div>
      <div class="stat-row">${statBox('Tracked shots', s.shots, 'with GPS')}${statBox('Putting holes', s.puttHoles, 'first putt known')}${statBox('Approach proximity', s.prox != null ? Math.round(s.prox) + ' ft' : '—', s.proxN ? s.proxN + ' greens hit' : 'hit greens to see')}</div>
      <p class="small mt mb0">${(() => { const worst = SG.CATS.map(([k, l]) => [l, s[k]]).sort((a, b) => a[1] - b[1])[0]; return worst[1] < -0.3 ? `Your biggest loss is <strong>${worst[0].toLowerCase()}</strong> (${fmtSG(worst[1])} a round). ${s.rounds >= 3 ? 'Your weekly plan uses this.' : 'After 3 rounds your weekly plan will use this.'}` : 'No category is costing you more than a third of a stroke against your target. Nice.'; })()}</p>
    </div></div>
    <p class="tiny muted mt mb0">Positive = better than a ${hcp} handicap. Only holes with a known length count (mapped tee and green, or yardage on the scorecard). “Untracked” is the difference for shots you didn't track with GPS. Baselines are approximate.</p></div>`;
}

/* A compact strokes-gained line for a round's card. */
function sgRoundHtml(r) {
  const s = SG.round(r, App.targetHcp()); if (!s) return '';
  return `<div class="sg-mini mt"><div class="entry-label">Strokes gained vs a ${App.targetHcp()} handicap</div><div class="sg-chips">
    <span class="${sgClass(s.total)}"><b>${fmtSG(s.total)}</b> total</span>${SG.CATS.map(([k, l]) => (k === 'putt' ? s.puttHoles : s.shots) ? `<span class="${sgClass(s[k])}"><b>${fmtSG(s[k])}</b> ${l.toLowerCase()}</span>` : '').join('')}${Math.abs(s.other) >= 0.05 && s.shots ? `<span><b>${fmtSG(s.other)}</b> untracked</span>` : ''}</div></div>`;
}
if (typeof module !== 'undefined' && module.exports) module.exports = { SG, fmtSG };
