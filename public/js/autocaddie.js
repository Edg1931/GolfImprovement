/* The caddie's homework, done before you get to the course.
   prepare(): as soon as a course is added (or opened), fetch its map from OpenStreetMap, work out holes the
   map is missing from the scorecard, and write a shot-by-shot game plan for every mapped hole from the
   player's own shot pattern. Plans the player made by hand are never overwritten.
   The Game plan page is the pre-round brief: target score, the holes to respect, the birdie chances, the
   club and aim off every tee, and the trouble to know about. */

const GamePlan = {
  MAX_SHOTS: 4,

  /* A point `d` yards along the line of play from `start`. */
  along(course, n, start, d) {
    const g = CourseMap.holeGeometry(course, n, start); if (!g || !g.green) return null;
    const toGreen = Caddie.dist(g.start, g.green);
    const pts = [g.start, ...((g.line || []).slice(1, -1).filter(p => Caddie.dist(p, g.green) < toGreen - 10)), g.green];
    let total = 0; for (let i = 1; i < pts.length; i++) total += Caddie.dist(pts[i - 1], pts[i]);
    for (let x = 0; x <= total; x += 3) { const q = Caddie.alongPolyline(pts, x); if (Caddie.dist(q, g.start) >= d) return g.proj.toLL(q); }
    return g.proj.toLL(g.green);
  },

  /* Shot-by-shot plan for hole n: each shot picks the club (and aim) with the lowest expected score. */
  hole(course, n, models) {
    const info = CourseMap.holeInfo(course, n); if (!info.tee || !info.green || !models.length) return null;
    const longest = models.reduce((a, m) => (m.along > a.along ? m : a));
    const steps = []; let start = info.tee, first = null;
    for (let k = 0; k < this.MAX_SHOTS; k++) {
      const g = CourseMap.holeGeometry(course, n, start); if (!g || !g.green) break;
      const toGreen = Caddie.dist(g.start, g.green); if (toGreen < 25) break;
      const c = { features: g.features, green: g.green };
      let pick = null;
      if (toGreen <= longest.along + 10 || (k === 0 && course.pars[n - 1] === 3)) {
        const r = Caddie.recommend(g.start, g.green, models, c, { samples: 150, seed: 5 })[0];
        if (r) pick = { r, aim: g.proj.toLL(r.aim), land: info.green };
      } else {
        // lay up or go for distance: try each club down the line of play, keep the lowest expected score
        models.filter(m => m.along >= 60 && toGreen - m.along >= 30).forEach(m => {
          const t = this.along(course, n, start, m.along); if (!t) return;
          const r = Caddie.recommend(g.start, g.proj.toXY(t), [m], c, { samples: 120, seed: 5 })[0];
          if (r && r.expected != null && (!pick || r.expected < pick.r.expected - 0.01)) pick = { r, aim: g.proj.toLL(r.aim), land: g.proj.toLL(r.aim) };
        });
        if (!pick) { const t = this.along(course, n, start, longest.along); const r = t && Caddie.recommend(g.start, g.proj.toXY(t), [longest], c, { samples: 120, seed: 5 })[0]; if (r) pick = { r, aim: g.proj.toLL(r.aim), land: g.proj.toLL(r.aim) }; }
      }
      if (!pick) break;
      if (!first) first = pick.r;
      steps.push({ club: pick.r.club, start: CourseMap.pt(start), aim: CourseMap.pt(pick.aim), land: CourseMap.pt(pick.land), aimShift: Math.round(pick.r.aimShift || 0), expected: pick.r.expected, auto: true });
      if (pick.land === info.green) break;
      start = pick.land;
    }
    return steps.length ? { steps, expected: first && first.expected, trouble: first && first.shares ? (first.shares.water || 0) + (first.shares.ob || 0) + (first.shares.trees || 0) + (first.shares.bunker || 0) : 0 } : null;
  },

  isAuto(plan) { return !plan || !plan.length || plan.every(s => s.auto); },

  /* Plan every mapped hole that doesn't have a hand-made plan. Yields between holes so the page stays responsive. */
  async course(course, onHole) {
    const models = Caddie.bagModels(App.state.clubs, App.state.shotLog, App.index());
    course.plans = course.plans || {};
    let planned = 0;
    for (let n = 1; n <= course.pars.length; n++) {
      if (!this.isAuto(course.plans[n])) continue;
      const res = this.hole(course, n, models);
      if (res) { course.plans[n] = res.steps; planned++; } else if (course.plans[n]) delete course.plans[n];
      if (onHole) onHole(n);
      await new Promise(r => setTimeout(r, 0));
    }
    course.planned = { at: todayISO(), shots: App.state.shotLog.length };
    Store.save();
    return planned;
  },

  /* Hazards worth knowing from the tee: what it takes to reach and to carry them. */
  hazards(course, n) {
    const info = CourseMap.holeInfo(course, n); if (!info.tee || !info.green) return [];
    const tp = Caddie.projector(info.tee), gXY = tp.toXY(info.green);
    return CourseMap.holeShapes(course, n).filter(f => f.type === 'water' || f.type === 'bunker' || f.type === 'ob').map(f => {
      const xy = f.ll.map(tp.toXY), ds = xy.map(q => Math.hypot(q.x, q.y)), cen = Caddie.centroid(xy), o = Caddie.offsets({ x: 0, y: 0 }, gXY, cen);
      return { type: f.type, reach: Math.round(Math.min(...ds)), carry: Math.round(Math.max(...ds)), side: Math.abs(o.lat) < 12 ? 'across' : o.lat < 0 ? 'left' : 'right', along: o.along };
    }).filter(h => h.along > 20 && h.reach < Math.hypot(gXY.x, gXY.y) + 20).sort((a, b) => a.reach - b.reach);
  },
};

const AutoCaddie = {
  busy: {},
  mapped(course) { return course.pars.map((_, i) => i + 1).filter(n => { const h = CourseMap.holeInfo(course, n); return h.tee && h.green; }).length; },

  /* Map the course (if it can be found) and plan every hole. Quiet unless asked to report. */
  async prepare(course, opts) {
    opts = opts || {};
    if (!course || this.busy[course.id]) return null;
    this.busy[course.id] = true;
    const say = t => { if (opts.onStatus) opts.onStatus(t); };
    const out = { mapped: 0, inferred: 0, planned: 0, error: null };
    try {
      const center = course.geo || (course.map && course.map.center);
      const need = this.mapped(course) < course.pars.length;
      if (need && center && navigator.onLine && !(course.prep && course.prep.osm && !opts.force)) {
        say('Mapping the course…');
        try {
          const data = CourseMap.parseOSM(await CourseMap.fetchOSM(center, 1800));
          // keep holes the player set by hand
          Object.keys(data.holes).forEach(k => { const mh = course.map && course.map.holes[k]; if (mh && mh.manual) delete data.holes[k]; });
          out.inferred = CourseMap.inferHoles(course, data);
          if (data.features.length || Object.keys(data.holes).length) { CourseMap.apply(course, data, 'osm'); if (!course.map.center) course.map.center = CourseMap.pt(center); }
          course.prep = Object.assign({}, course.prep, { osm: todayISO() });
        } catch (e) { out.error = navigator.onLine ? 'The map service is busy right now.' : 'You are offline.'; }
      }
      out.mapped = this.mapped(course);
      if (out.mapped) { say('Planning every hole…'); out.planned = await GamePlan.course(course, n => say(`Planning hole ${n}…`)); }
      course.prep = Object.assign({}, course.prep, { at: todayISO(), mapped: out.mapped, inferred: (course.prep && course.prep.inferred || 0) + out.inferred });
      Store.save();
    } finally { this.busy[course.id] = false; }
    return out;
  },

  /* After a course is added from search: prepare it in the background and say what happened. */
  async afterAdd(course) {
    const res = await this.prepare(course);
    if (!res) return;
    const n = course.pars.length;
    if (res.mapped) App.toast(`${course.name}: ${res.mapped === n ? 'all ' + n : res.mapped + ' of ' + n} holes mapped, game plan ready`);
    else if (!res.error) App.toast(`${course.name} isn’t on OpenStreetMap yet. Tap Plan to map it yourself in a few minutes.`);
    if (App.route() === 'play' || App.route() === 'gameplan') App.render();
  },
};

/* ---------- the pre-round brief ---------- */
Views.gameplan = function () {
  const courses = App.state.courses;
  const c = courses.find(x => x.id === App.ui.gpCourse) || courses[0];
  if (!c) return `<div class="empty">Add a course first: search for it on the <a href="#/play">Play</a> page.</div>`;
  App.ui.gpCourse = c.id;
  const n = c.pars.length, mapped = AutoCaddie.mapped(c), busy = AutoCaddie.busy[c.id];
  const idx = App.index(), ch = idx != null && c.slope ? courseHandicap(idx, c.slope, c.rating, sum(c.pars)) : null, par = sum(c.pars);
  const stale = c.planned && c.planned.shots !== App.state.shotLog.length;
  const holes = c.pars.map((p, i) => {
    const k = i + 1, plan = (c.plans && c.plans[k]) || [], info = CourseMap.holeInfo(c, k);
    const exp = plan.length && plan[0].expected != null ? plan[0].expected : null;
    return { k, par: p, plan, info, exp, over: exp != null ? exp - p : null, yds: (c.yards && c.yards[i]) || (info.tee && info.green ? Math.round(yardsBetween(info.tee, info.green)) : null) };
  });
  const rated = holes.filter(h => h.over != null);
  const hard = rated.filter(h => h.over >= 0.3).sort((a, b) => b.over - a.over).slice(0, 3);
  const easy = rated.filter(h => h.over < 0.6 && !hard.includes(h)).sort((a, b) => a.over - b.over).slice(0, 3);
  const ov = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);
  const aim = s => s.aimShift ? ` aim ${Math.abs(s.aimShift)} ${s.aimShift < 0 ? 'L' : 'R'}` : '';
  const hz = h => GamePlan.hazards(c, h.k).slice(0, 2).map(z => `${z.type === 'water' ? 'Water' : z.type === 'ob' ? 'OB' : 'Bunker'} ${z.side}: ${z.reach}–${z.carry}`).join(' · ');
  let html = `<div class="page-head"><div><h1>Game plan</h1><p class="muted">Your caddie's plan for every hole, from your own shot pattern.</p></div>
    <div class="btn-row"><button class="btn primary" data-action="gpPrepare" ${busy ? 'disabled' : ''}>${busy ? 'Working…' : mapped ? 'Re-plan' : 'Map and plan'}</button><button class="btn" data-action="openYardbook" data-id="${c.id}" ${mapped ? '' : 'disabled'}>Yardage book</button></div></div>
    <div class="map-bar"><select data-change="gpCourse" aria-label="Course">${courses.map(x => `<option value="${x.id}" ${x.id === c.id ? 'selected' : ''}>${escapeHtml(x.name)}${x.tees ? ' · ' + escapeHtml(x.tees) : ''}</option>`).join('')}</select></div>
    <p class="small muted mt" id="gpStatus">${busy ? 'Working…' : mapped ? `${mapped} of ${n} holes mapped${c.prep && c.prep.inferred ? ` (${c.prep.inferred} worked out from the scorecard)` : ''}.${stale ? ' You’ve tracked shots since this plan: re-plan to use them.' : ''}` : ''}</p>`;
  if (!mapped) {
    return html + `<div class="card mt"><h3>No map yet</h3><p class="small muted">${c.geo || (c.map && c.map.center) ? 'Tap <strong>Map and plan</strong> to load the course from OpenStreetMap.' : 'This course has no location yet.'} If it isn't mapped there, set each hole's tee and green on the satellite image. It takes about 10 seconds a hole.</p>
      <button class="btn" data-action="openHoleView" data-id="${c.id}" data-hole="1">Map it myself</button></div>`;
  }
  html += `<div class="grid grid-3 mt">
    <div class="card">${statBox('Target score', ch != null ? par + ch : par, ch != null ? `par ${par} + your ${ch} shots` : `par ${par}`)}</div>
    <div class="card"><h3>Play safe</h3>${hard.length ? `<ul class="focus-list">${hard.map(h => `<li><span>Hole ${h.k} · par ${h.par}</span><strong>${ov(h.over)}</strong></li>`).join('')}</ul>` : '<p class="small muted mb0">No hole stands out.</p>'}</div>
    <div class="card"><h3>Chances</h3>${easy.length ? `<ul class="focus-list chances">${easy.map(h => `<li><span>Hole ${h.k} · par ${h.par}</span><strong>${ov(h.over)}</strong></li>`).join('')}</ul>` : '<p class="small muted mb0">No easy ones here.</p>'}</div>
  </div>
  <div class="card mt"><div class="card-head"><h3>Hole by hole</h3><span class="small muted">strokes over par the caddie expects</span></div>
    <ul class="gp-list">${holes.map(h => `<li data-action="openHoleView" data-id="${c.id}" data-hole="${h.k}">
      <div class="gp-no"><b>${h.k}</b><span>par ${h.par}</span></div>
      <div class="gp-body">${h.plan.length ? `<strong>${h.plan.map(s => escapeHtml(s.club) + (s === h.plan[0] ? aim(s) : '')).join(' → ')}</strong>${h.plan.some(s => !s.auto) ? ' <span class="badge neutral">yours</span>' : ''}` : `<span class="muted">${h.info.tee && h.info.green ? 'No plan' : 'Not mapped'}</span>`}
        <div class="tiny muted">${[h.yds ? h.yds + ' yds' : '', hz(h)].filter(Boolean).join(' · ')}</div></div>
      <div class="gp-exp ${h.over != null && h.over > 0.9 ? 'hard' : h.over != null && h.over < 0.5 ? 'easy' : ''}">${h.over != null ? ov(h.over) : ''}</div></li>`).join('')}</ul>
    <p class="tiny muted mt mb0">Tap a hole to see the plan on the map or change it. Numbers after hazards: yards from the tee to reach and to carry them.</p></div>`;
  return html;
};

Object.assign(Actions, {
  openGamePlan(el) { App.ui.gpCourse = (el && el.dataset.id) || App.ui.gpCourse; location.hash = '#/gameplan'; },
  async gpPrepare() {
    const c = App.state.courses.find(x => x.id === App.ui.gpCourse); if (!c) return;
    const p = AutoCaddie.prepare(c, { force: AutoCaddie.mapped(c) < c.pars.length, onStatus: t => { const el = document.getElementById('gpStatus'); if (el) el.textContent = t; } });
    App.render();
    const res = await p; App.render();
    if (res && res.error && !res.mapped) App.toast(res.error);
    else if (res) App.toast(res.mapped ? `Planned ${res.planned} hole${res.planned === 1 ? '' : 's'}` : 'Not on OpenStreetMap yet: map it yourself in the hole view');
  },
});
Object.assign(Changes, { gpCourse(el) { App.ui.gpCourse = el.value; App.render(); } });
