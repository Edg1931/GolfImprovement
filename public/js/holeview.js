/* Full-screen hole view for use on the course: satellite map turned so the hole runs up the screen,
   a draggable target with yardages to it and on to the green, club advice from the player's own
   dispersion, shot tracking and score entry.

   The Leaflet map sits in an oversized square that is rotated with CSS (Leaflet can't rotate), and the
   map's own dragging and zooming are switched off. Everything drawn on top (lines, target, yardage
   bubbles) lives in a screen-space layer, so it stays upright and crisp. toScreen/fromScreen convert
   between the two. */

const HoleView = {
  el: null, map: null, layers: null,
  s: { courseId: null, hole: 1, target: null, zoom: 'hole', club: null, key: null, advice: null },
  g: null,   // layout of the last fit: {W, H, D, dy, theta}

  /* ---------- context ---------- */
  live() {
    const lr = App.state.liveRound;
    return lr && lr.courseId && lr.courseId === this.s.courseId ? lr : null;
  },
  course() { return App.state.courses.find(c => c.id === this.s.courseId) || null; },
  holeNo() { const lr = this.live(); return lr ? (lr.first || 0) + lr.cur + 1 : this.s.hole; },
  info() {
    const c = this.course(); if (!c) return null;
    const n = this.holeNo(), lr = this.live();
    const mh = (c.map && c.map.holes && c.map.holes[n]) || {};
    const pins = (c.greens && c.greens[n - 1]) || {};
    const k = lr ? lr.cur : n - 1;
    return {
      c, n, lr, tee: mh.tee || null, green: pins.center || mh.green || null, front: pins.front || null, back: pins.back || null,
      line: mh.line || null, par: lr ? lr.pars[k] : c.pars[n - 1], si: lr ? (lr.siCard || lr.si)[k] : (c.si || [])[n - 1],
      yards: lr ? lr.yards && lr.yards[k] : c.yards && c.yards[n - 1], tees: lr ? lr.tees : c.tees, holes: lr ? lr.holes.length : c.pars.length,
    };
  },
  /* Where the ball is: the player's GPS position when it's fresh and on this hole, otherwise the tee. */
  ball(h) {
    const p = App._lastPos, fresh = p && Date.now() - (App._lastPosAt || 0) < 60000;
    const ref = h.green || h.tee;
    if (fresh && ref && yardsBetween(p, ref) < 650) return { pos: p, gps: true };
    return h.tee ? { pos: h.tee, gps: false } : (fresh ? { pos: p, gps: true } : null);
  },
  models() { return Caddie.bagModels(App.state.clubs, App.state.shotLog, App.index()); },
  adjust() { return (+Planner.s.wind || 0) + (+Planner.s.elev || 0); },
  /* The club whose typical distance best matches `yards` (plays-like). */
  clubFor(yards, models) {
    const d = yards + this.adjust(); let best = null;
    models.forEach(m => { if (!best || Math.abs(m.along - d) < Math.abs(best.along - d)) best = m; });
    return best;
  },
  /* Default target: the green if the longest club can reach, otherwise one tee-shot down the hole's line. */
  defaultTarget(h, start, models) {
    if (!h.green) return null;
    const longest = models.reduce((a, m) => (!a || m.along > a.along ? m : a), null);
    const reach = longest ? longest.along - this.adjust() : 230;
    const toGreen = yardsBetween(start, h.green);
    if (toGreen <= reach + 15 || h.par === 3) return null;
    const proj = Caddie.projector(start);
    const pts = [start, ...((h.line || []).slice(1, -1).filter(p => yardsBetween(p, h.green) < toGreen - 10)), h.green].map(proj.toXY);
    let total = 0; for (let i = 1; i < pts.length; i++) total += Caddie.dist(pts[i - 1], pts[i]);
    let pick = null;
    for (let d = 0; d <= total; d += 3) { const q = Caddie.alongPolyline(pts, d); if (Math.hypot(q.x, q.y) >= reach) { pick = q; break; } }
    // leave at least a short pitch
    if (!pick || toGreen - reach < 30) return null;
    return proj.toLL(pick);
  },

  /* ---------- map ---------- */
  ensureMap() {
    if (this.map || typeof L === 'undefined') return !!this.map;
    this.el = document.createElement('div'); this.el.className = 'hv-map';
    this.map = L.map(this.el, { zoomControl: false, attributionControl: false, dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, zoomSnap: 0, maxZoom: 20, fadeAnimation: false, zoomAnimation: false, inertia: false });
    L.tileLayer(ESRI_TILES, { maxZoom: 20, maxNativeZoom: 19, crossOrigin: true }).addTo(this.map);
    this.layers = { features: L.layerGroup().addTo(this.map) };
    this.map.setView([39.5, -98.35], 4);
    return true;
  },

  mount() {
    const slot = document.getElementById('hvSlot'); if (!slot || !this.ensureMap()) return;
    slot.prepend(this.el);
    const h = this.info();
    const key = h ? h.c.id + ':' + h.n : null;
    if (key !== this.s.key) { this.s.key = key; this.s.target = undefined; this.s.club = null; this.s.zoom = 'hole'; this.s.advice = null; }
    this.layout();
    this.drawFeatures();
    this.overlay();
    if (!this.s.advice) this.afterMove();
    this.bindPointer(slot);
    if (!this._watching) { this._watching = true; App.watchGps(true); }
    if (this.live()) App.keepAwake(true);
  },
  leave() { if (this._watching) { this._watching = false; if (!App.ui.liveYds) App.watchGps(false); } },

  /* Size and turn the map so the hole (or the green) fills the space between the top and bottom bars. */
  layout() {
    const slot = document.getElementById('hvSlot'), h = this.info(); if (!slot || !h) return;
    const W = slot.clientWidth, H = slot.clientHeight;
    const top = 118, bottom = W < 700 ? 196 : 150, side = 36;
    const b = this.ball(h), start = b ? b.pos : null;
    const models = this.models();
    if (this.s.target === undefined) this.s.target = start ? this.defaultTarget(h, start, models) : null;
    const ref = h.green || h.tee || start;
    if (!ref) { this.g = null; const c = h.c; const at = (c.map && c.map.center) || c.geo; if (at) { this.el.style.transform = 'translate(-50%, -50%)'; this.map.invalidateSize(); this.map.setView([at.lat, at.lon], 16, { animate: false }); } return; }
    // turn so the ball-to-green direction points up
    let phi = 0;
    const from = start || h.tee, to = h.green || (h.line && h.line[h.line.length - 1]);
    if (from && to && yardsBetween(from, to) > 5) { const proj = Caddie.projector(from), v = proj.toXY(to); phi = Math.atan2(v.x, v.y); }
    const proj = Caddie.projector(ref);
    let pts;
    if (this.s.zoom === 'green' && h.green) pts = [h.front, h.back, h.green].filter(Boolean).map(proj.toXY).flatMap(p => [{ x: p.x - 28, y: p.y - 28 }, { x: p.x + 28, y: p.y + 28 }]);
    else pts = [start, h.green, this.s.target, ...(h.line || [])].filter(Boolean).map(proj.toXY);
    if (pts.length === 1) pts.push({ x: pts[0].x + 40, y: pts[0].y + 40 }, { x: pts[0].x - 40, y: pts[0].y - 40 });
    const cs = Math.cos(phi), sn = Math.sin(phi);
    const uv = pts.map(p => ({ u: p.x * cs - p.y * sn, v: p.x * sn + p.y * cs }));
    const u0 = Math.min(...uv.map(p => p.u)), u1 = Math.max(...uv.map(p => p.u)), v0 = Math.min(...uv.map(p => p.v)), v1 = Math.max(...uv.map(p => p.v));
    const aw = Math.max(80, W - 2 * side), ah = Math.max(120, H - top - bottom);
    const ppy = Math.min(aw / Math.max(20, u1 - u0), ah / Math.max(20, v1 - v0));   // pixels per yard
    const lat = ref.lat * Math.PI / 180;
    let z = Math.log2(156543.03 * Math.cos(lat) * ppy / 0.9144);
    z = Math.max(13, Math.min(19.5, z));
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    const center = proj.toLL({ x: cu * cs + cv * sn, y: -cu * sn + cv * cs });
    const dy = (top - bottom) / 2;
    const D = Math.ceil(Math.hypot(W, H + 2 * Math.abs(dy))) + 24;
    Object.assign(this.el.style, { width: D + 'px', height: D + 'px', transform: `translate(-50%, -50%) translate(0px, ${dy}px) rotate(${-phi}rad)` });
    this.map.invalidateSize({ animate: false, pan: false });
    this.map.setView([center.lat, center.lon], z, { animate: false });
    this.g = { W, H, D, dy, theta: -phi };
  },

  toScreen(p) {
    const g = this.g; if (!g || !p) return null;
    const cp = this.map.latLngToContainerPoint([p.lat, p.lon]);
    const vx = cp.x - g.D / 2, vy = cp.y - g.D / 2, c = Math.cos(g.theta), s = Math.sin(g.theta);
    return { x: g.W / 2 + vx * c - vy * s, y: g.H / 2 + g.dy + vx * s + vy * c };
  },
  fromScreen(x, y) {
    const g = this.g; if (!g) return null;
    const ax = x - g.W / 2, ay = y - g.H / 2 - g.dy, c = Math.cos(g.theta), s = Math.sin(g.theta);
    const ll = this.map.containerPointToLatLng([ax * c + ay * s + g.D / 2, -ax * s + ay * c + g.D / 2]);
    return { lat: ll.lat, lon: ll.lng };
  },

  drawFeatures() {
    const c = this.course(); this.layers.features.clearLayers(); if (!c || !c.map) return;
    (c.map.features || []).forEach(f => {
      if (f.type === 'fairway' || f.type === 'tee' || f.type === 'trees') return;   // the imagery already shows these
      const st = Object.assign({}, FEATURE_STYLE[f.type] || {}, { interactive: false, weight: 1.2 });
      st.fillOpacity = (st.fillOpacity || 0) * 0.6;
      L.polygon(f.ll.map(p => [p.lat, p.lon]), st).addTo(this.layers.features);
    });
  },

  /* ---------- the layer on top ---------- */
  overlay() {
    const box = document.getElementById('hvOver'), h = this.info(); if (!box || !h || !this.g) { if (box) box.innerHTML = ''; return; }
    const b = this.ball(h), start = b && b.pos;
    const models = this.models();
    const tgt = this.s.target || h.green;
    const S = p => this.toScreen(p);
    const bs = S(start), ts = S(tgt), gs = S(h.green);
    let svg = '', html = '';
    const d1 = start && tgt ? yardsBetween(start, tgt) : null;
    const d2 = this.s.target && h.green ? yardsBetween(this.s.target, h.green) : null;
    const club = d1 != null && models.length ? (this.s.club && models.find(m => m.club === this.s.club)) || this.clubFor(d1, models) : null;
    // the chosen club's pattern: where about 3 in 4 of the player's shots with it finish
    if (club && start && tgt) {
      const proj = Caddie.projector(start), s0 = { x: 0, y: 0 }, t0 = proj.toXY(tgt);
      const pts = Caddie.ellipse(s0, t0, club, this.adjust(), 40).map(q => S(proj.toLL(q)));
      svg += `<polygon class="hv-ellipse" points="${pts.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ')}"/>`;
    }
    if (bs && ts) svg += `<line class="hv-line" x1="${bs.x}" y1="${bs.y}" x2="${ts.x}" y2="${ts.y}"/>`;
    if (this.s.target && ts && gs) svg += `<line class="hv-line" x1="${ts.x}" y1="${ts.y}" x2="${gs.x}" y2="${gs.y}"/>`;
    if (gs) html += `<div class="hv-pin" style="left:${gs.x}px;top:${gs.y}px"></div>`;
    if (bs) html += b.gps ? `<div class="hv-me" style="left:${bs.x}px;top:${bs.y}px"></div>` : `<div class="hv-tee" style="left:${bs.x}px;top:${bs.y}px"></div>`;
    if (this.s.target && ts) html += `<div class="hv-target" id="hvTarget" style="left:${ts.x}px;top:${ts.y}px" aria-label="Target: drag to move"><i></i></div>`;
    // yardage bubbles beside each leg
    const bubble = (a, z, cls, inner) => {
      if (!a || !z) return '';
      const mx = (a.x + z.x) / 2, my = (a.y + z.y) / 2;
      const left = mx > this.g.W * 0.55;   // keep bubbles on the open side of the line
      const x = Math.max(8, Math.min(this.g.W - 180, left ? mx - 168 : mx + 18));
      return `<div class="hv-bubble ${cls}" style="left:${x}px;top:${my - 30}px">${inner}</div>`;
    };
    if (d1 != null && bs && ts) {
      const plays = this.adjust() ? `<small>plays ${Math.round(d1 + this.adjust())}</small>` : '';
      const adv = this.s.advice;
      const risk = adv ? (adv.green != null && !this.s.target ? `${Math.round(adv.green * 100)}% green` : adv.trouble >= 0.05 ? `${Math.round(adv.trouble * 100)}% trouble` : adv.fairway != null ? `${Math.round(adv.fairway * 100)}% fairway` : '') : '';
      html += bubble(bs, ts, 'main', `<span class="hv-yds">${Math.round(d1)}<small>y</small></span><button class="hv-club" data-action="hvSheet" data-v="caddie"><strong>${club ? escapeHtml(club.club) : 'Caddie'}</strong><small>${risk || (club && club.learned ? 'your pattern' : 'tap for advice')}</small>${plays}<span class="hv-chev">›</span></button>`);
    }
    if (d2 != null && ts && gs) {
      const c2 = models.length ? this.clubFor(d2, models) : null;
      html += bubble(ts, gs, 'second', `<span class="hv-yds">${Math.round(d2)}<small>y</small></span>${c2 ? `<span class="hv-club2">${escapeHtml(c2.club)}</span>` : ''}`);
    }
    box.innerHTML = `<svg class="hv-svg" width="${this.g.W}" height="${this.g.H}">${svg}</svg>${html}`;
    this.header(h, start);
  },
  /* Numbers in the top bar change as the player walks, so they're updated in place. */
  header(h, start) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const y = p => (start && p ? Math.round(yardsBetween(start, p)) : '—');
    set('hvMid', y(h.green));
    set('hvFB', h.front || h.back ? `F ${y(h.front)} · B ${y(h.back)}` : '');
  },

  /* Tap anywhere to move the target there; drag the target to fine-tune. */
  bindPointer(slot) {
    if (slot._hvBound) return; slot._hvBound = true;
    const over = slot.querySelector('.hv-over') || slot;
    let drag = false, moved = false, sx = 0, sy = 0;
    const pos = e => { const r = slot.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    over.addEventListener('pointerdown', e => {
      if (e.target.closest('button, .hv-bubble')) return;
      const p = pos(e); sx = p.x; sy = p.y; moved = false;
      drag = !!e.target.closest('#hvTarget');
      if (drag) { over.setPointerCapture(e.pointerId); e.preventDefault(); }
    });
    over.addEventListener('pointermove', e => {
      if (!drag) return; const p = pos(e); moved = true;
      this.s.target = this.fromScreen(p.x, p.y); this.s.advice = null; this.overlay();
    });
    over.addEventListener('pointerup', e => {
      const p = pos(e);
      if (drag) { drag = false; this.afterMove(); return; }
      if (e.target.closest('button, .hv-bubble, a')) return;
      if (Math.hypot(p.x - sx, p.y - sy) > 10) return;   // a scroll or swipe, not a tap
      const h = this.info(); if (!h || !this.g) return;
      const t = this.fromScreen(p.x, p.y);
      // a tap on the green aims at the green
      this.s.target = h.green && yardsBetween(t, h.green) < 12 ? null : t;
      this.s.club = null; this.afterMove();
    });
  },
  afterMove() { this.s.advice = null; this.overlay(); clearTimeout(this._advT); this._advT = setTimeout(() => this.advise(), 30); },

  /* Caddie numbers for the current club and target: chance of the green, fairway and trouble. */
  advise() {
    const h = this.info(); if (!h) return; const b = this.ball(h); if (!b) return;
    const tgt = this.s.target || h.green; if (!tgt) return;
    const models = this.models(); if (!models.length) return;
    const g = CourseMap.holeGeometry(h.c, h.n, b.pos); if (!g || !g.features.length) return;
    const d1 = yardsBetween(b.pos, tgt);
    const club = (this.s.club && models.find(m => m.club === this.s.club)) || this.clubFor(d1, models);
    const sim = Caddie.simulate(g.start, g.proj.toXY(tgt), club, { features: g.features, green: g.green }, { adjust: this.adjust(), samples: 200, seed: 3 });
    const sh = sim.shares;
    this.s.advice = { green: sh.green || 0, fairway: g.features.some(f => f.type === 'fairway') ? (sh.fairway || 0) : null, trouble: (sh.water || 0) + (sh.ob || 0) + (sh.bunker || 0) + (sh.trees || 0) };
    this.overlay();
  },
  /* Full comparison for the sheet: every sensible club for this target, best expected score first. */
  compare() {
    const h = this.info(); if (!h) return null; const b = this.ball(h); if (!b) return null;
    const tgt = this.s.target || h.green; if (!tgt) return null;
    const g = CourseMap.holeGeometry(h.c, h.n, b.pos); if (!g) return null;
    const recs = Caddie.recommend(g.start, g.proj.toXY(tgt), this.models(), { features: g.features, green: g.green }, { adjust: this.adjust(), samples: 180, seed: 11 });
    return { recs: recs.slice(0, 6), mapped: g.features.length > 0, d: yardsBetween(b.pos, tgt) };
  },

  /* GPS update: redraw only if the ball is following the player. */
  onPos() {
    if (App.route() !== 'gps') return;
    const h = this.info(); if (!h) return;
    const b = this.ball(h);
    if (b && b.gps) { if (!this._gpsFit) { this._gpsFit = true; this.s.target = undefined; this.layout(); } this.overlay(); }
    const t = document.getElementById('hvTrack'); const gps = App.ui.gps;
    if (t && gps && gps.start && App._lastPos) { const el = t.querySelector('small'); if (el) el.textContent = Math.round(yardsBetween(gps.start, App._lastPos)) + ' yds so far'; }
  },
};

/* ---------- page ---------- */
Views.gps = function () {
  const s = HoleView.s, lr = App.state.liveRound;
  if (App.ui.hv) { Object.assign(s, App.ui.hv); App.ui.hv = null; s.key = null; }
  if (!s.courseId && lr && lr.courseId) s.courseId = lr.courseId;
  if (!s.courseId || !App.state.courses.some(c => c.id === s.courseId)) s.courseId = (lr && lr.courseId) || (App.state.courses[0] && App.state.courses[0].id) || null;
  const h = HoleView.info();
  if (!h) return `<div class="empty">Add a course first: search for it on the <a href="#/play">Play</a> page.</div>`;
  const sheet = App.ui.hvSheet || null;
  const hlr = h.lr, cur = hlr ? hlr.holes[hlr.cur] : null;
  const gps = App.ui.gps || {};
  App.after(() => HoleView.mount());
  const mapped = h.green || h.tee;
  const back = hlr ? '#/play' : '#/map';
  let html = `<div class="hv" id="hvSlot"><div class="hv-over" id="hvOver"></div>
    <div class="hv-top">
      <a class="hv-back" href="${back}" aria-label="Back">‹</a>
      <div class="hv-card">
        <button class="hv-hole" data-action="hvSheet" data-v="holes" aria-label="Choose hole"><span>${h.n}</span><small>▾</small></button>
        <div class="hv-cell hv-main"><small>Mid green</small><strong><span id="hvMid">—</span><em>yds</em></strong><span class="hv-fb" id="hvFB"></span></div>
        <div class="hv-cell"><small>Par</small><strong>${h.par || '—'}</strong></div>
        <div class="hv-cell"><small>${escapeHtml((h.tees || 'Tee').split(/[ ·(]/)[0])}</small><strong>${h.yards || (h.tee && h.green ? Math.round(yardsBetween(h.tee, h.green)) : '—')}</strong></div>
        <div class="hv-cell"><small>Hcp</small><strong>${h.si || '—'}</strong></div>
      </div>
    </div>
    ${mapped ? '' : `<div class="hv-empty card"><h3>Hole ${h.n} isn't mapped yet</h3><p class="small">Load the course's greens and hazards from OpenStreetMap, upload a map file, or set the tee and green yourself.</p><button class="btn primary" data-action="hvPlan">🗺 Map this course</button></div>`}
    <div class="hv-side">
      <button class="hv-round" data-action="hvZoom" aria-label="${HoleView.s.zoom === 'green' ? 'Show the whole hole' : 'Zoom to the green'}">${HoleView.s.zoom === 'green' ? '⤢' : '⚲'}</button>
      <button class="hv-round" data-action="hvLocate" aria-label="Use my position">◎</button>
    </div>
    <div class="hv-bottom">
      <button class="hv-track ${gps.start ? 'on' : ''}" id="hvTrack" data-action="${gps.start ? 'hvMeasure' : 'hvSheet'}" data-v="club">${gps.start ? `📏 Measure ${gps.club ? escapeHtml(gps.club) : 'shot'} <small>${App._lastPos ? Math.round(yardsBetween(gps.start, App._lastPos)) + ' yds so far' : 'walk to your ball'}</small>` : `📍 Track shot${gps.last != null ? ` <small>last: ${gps.last} yds${gps.lastClub ? ' ' + escapeHtml(gps.lastClub) : ''}${gps.lastLat != null && Math.abs(gps.lastLat) >= 2 ? ', ' + Math.abs(Math.round(gps.lastLat)) + (gps.lastLat > 0 ? ' R' : ' L') : ''}</small>` : ''}`}</button>
      <div class="hv-row">
        ${hlr ? '<a class="hv-btn" href="#/play"><span>Scorecard</span><small>›</small></a>' : '<button class="hv-btn" data-action="hvPlan"><span>Planner</span><small>›</small></button>'}
        ${hlr ? `<button class="hv-score ${cur.strokes != null ? 'done' : ''}" data-action="hvSheet" data-v="score"><strong>Hole ${h.n}</strong><small>${cur.strokes != null ? `${cur.strokes} · ${scoreName(cur.strokes, h.par)}` : 'Enter score'}</small></button>`
          : `<button class="hv-score" data-action="hvPlan"><strong>Hole ${h.n}</strong><small>Plan this hole</small></button>`}
        <button class="hv-next" data-action="hvHole" data-d="1" aria-label="Next hole" ${h.n >= (hlr ? (hlr.first || 0) + hlr.holes.length : h.holes) ? 'disabled' : ''}>›</button>
        <button class="hv-btn" data-action="hvSheet" data-v="tools"><span>Tools</span><small>›</small></button>
      </div>
    </div>
    <div class="hv-attr">Imagery © Esri, Maxar, Earthstar Geographics</div>
  </div>`;
  if (sheet) html += `<div class="hv-scrim" data-action="hvSheet" data-v=""></div><div class="hv-sheet" role="dialog" aria-label="${sheet}">${hvSheetHtml(sheet, h)}</div>`;
  return html;
};

function hvSheetHtml(sheet, h) {
  const lr = h.lr, s = HoleView.s;
  const close = '<button class="btn sm ghost hv-close" data-action="hvSheet" data-v="" aria-label="Close">✕</button>';
  if (sheet === 'score' && lr) {
    const hh = lr.holes[lr.cur], par = h.par, quick = [-1, 0, 1, 2, 3].map(d => par + d).filter(v => v > 0);
    const last = lr.cur >= lr.holes.length - 1;
    return `${close}<h3>Hole ${h.n} · Par ${par}</h3>
      <div class="entry"><div class="entry-label">Score</div>
        <div class="stepper"><button class="step" data-action="holeStep" data-k="strokes" data-d="-1" aria-label="One fewer stroke">−</button><output class="step-val ${scoreClass(hh.strokes, par)}">${hh.strokes != null ? hh.strokes : '–'}</output><button class="step" data-action="holeStep" data-k="strokes" data-d="1" aria-label="One more stroke">+</button></div>
        <div class="chip-row">${quick.map(v => `<button class="chip ${hh.strokes === v ? 'active' : ''}" data-action="holeSet" data-k="strokes" data-v="${v}">${scoreName(v, par)}</button>`).join('')}</div></div>
      <div class="entry"><div class="entry-label">Putts</div><div class="seg">${[0, 1, 2, 3, 4].map(v => `<button class="${hh.putts === v ? 'active' : ''}" data-action="holeSet" data-k="putts" data-v="${v}">${v}${v === 4 ? '+' : ''}</button>`).join('')}</div></div>
      ${par >= 4 ? `<div class="entry"><div class="entry-label">Tee shot</div><div class="seg">${FAIRWAY_OPTS.map(([v, l]) => `<button class="${hh.fir === v ? 'active' : ''}" data-action="holeSet" data-k="fir" data-v="${v}">${l}</button>`).join('')}</div></div>` : ''}
      <div class="btn-row mt">${last ? `<button class="btn primary lg grow" data-action="hvFinish">Review &amp; finish ›</button>` : `<button class="btn primary lg grow" data-action="hvHole" data-d="1" ${hh.strokes == null ? 'disabled' : ''}>Save · next hole ›</button>`}</div>
      <p class="tiny muted mb0">Penalties, bunkers and notes are on the full <a href="#/play">scorecard</a>.</p>`;
  }
  if (sheet === 'holes') {
    const n = lr ? lr.holes.length : h.holes, first = lr ? lr.first || 0 : 0;
    return `${close}<h3>Go to hole</h3><div class="hv-holes">${[...Array(n)].map((_, k) => {
      const no = first + k + 1, x = lr && lr.holes[k];
      return `<button class="hole-pill ${no === h.n ? 'cur' : ''} ${x ? scoreClass(x.strokes, lr.pars[k]) : ''}" data-action="hvHole" data-to="${no}"><small>${no}</small>${x && x.strokes != null ? x.strokes : lr ? '·' : h.c.pars[no - 1]}</button>`;
    }).join('')}</div>`;
  }
  if (sheet === 'club') {
    const models = HoleView.models(), gps = App.ui.gps || {};
    const b = HoleView.ball(h), tgt = s.target || h.green;
    const sug = b && tgt && models.length ? (s.club && models.find(m => m.club === s.club)) || HoleView.clubFor(yardsBetween(b.pos, tgt), models) : null;
    const pick = gps.club || (sug && sug.club) || '';
    return `${close}<h3>Track a shot</h3><p class="small muted">Pick the club, hit, then walk to your ball and tap <strong>Measure</strong>. The distance and your left/right miss teach the caddie your pattern.</p>
      <div class="hv-clubs">${App.state.clubs.map(c => `<button class="chip ${pick === c.club ? 'active' : ''}" data-action="hvMark" data-club="${escapeHtml(c.club)}">${escapeHtml(c.club)}</button>`).join('')}</div>
      <button class="btn ghost sm mt" data-action="hvMark" data-club="">Track without a club</button>`;
  }
  if (sheet === 'caddie') {
    let cmp; try { cmp = HoleView.compare(); } catch (e) { console.warn(e); }
    if (!cmp || !cmp.recs.length) return `${close}<h3>Caddie</h3><p class="small mb0">Add your club distances in <a href="#/clubs">My Clubs</a> for club advice.</p>`;
    const pc = v => Math.round((v || 0) * 100) + '%';
    const r0 = cmp.recs[0];
    const aim = r => !r.aimShift ? 'straight at it' : `${Math.abs(Math.round(r.aimShift))} yds ${r.aimShift < 0 ? 'left' : 'right'}`;
    return `${close}<h3>Caddie · ${Math.round(cmp.d)} yds${HoleView.adjust() ? ` (plays ${Math.round(cmp.d + HoleView.adjust())})` : ''}</h3>
      <p class="small">${cmp.mapped ? `<strong>${escapeHtml(r0.club)}</strong>, aim ${aim(r0)}. ${r0.model.learned ? `Based on your ${r0.model.nLat} tracked shots.` : 'Estimated from your chart distance until you track a few shots.'}` : 'Map this hole to see hazard risk. Clubs by distance:'}</p>
      <table class="caddie-table"><thead><tr><th>Club</th>${cmp.mapped ? '<th class="num">Exp.</th><th class="num">Green</th><th class="num">Trouble</th>' : '<th class="num">Typical</th><th class="num">vs target</th>'}<th class="num">Aim</th></tr></thead><tbody>
      ${cmp.recs.map(r => `<tr class="${(s.club || HoleView.clubFor(cmp.d, HoleView.models()).club) === r.club ? 'sel' : ''}" data-action="hvClub" data-club="${escapeHtml(r.club)}"><td><strong>${escapeHtml(r.club)}</strong></td>${cmp.mapped ? `<td class="num">${r.expected.toFixed(2)}</td><td class="num">${pc(r.shares.green)}</td><td class="num">${pc((r.shares.water || 0) + (r.shares.ob || 0) + (r.shares.bunker || 0) + (r.shares.trees || 0))}</td>` : `<td class="num">${Math.round(r.model.along)}</td><td class="num">${r.gap >= 0 ? '+' : ''}${Math.round(r.gap)}</td>`}<td class="num">${cmp.mapped ? (r.aimShift ? Math.abs(Math.round(r.aimShift)) + (r.aimShift < 0 ? 'L' : 'R') : '—') : ''}</td></tr>`).join('')}</tbody></table>
      <p class="tiny muted mb0">Tap a club to show its shot pattern on the map. Exp. = average strokes to hole out.</p>
      ${hvWindHtml()}`;
  }
  if (sheet === 'tools') {
    return `${close}<h3>Tools</h3>${hvWindHtml()}
      <div class="btn-row mt"><button class="btn" data-action="hvResetTarget">↺ Reset target</button><button class="btn" data-action="hvPlan">🗺 Shot planner</button>${lr ? '<a class="btn" href="#/play">📋 Full scorecard</a>' : ''}</div>
      <p class="tiny muted mt mb0">Tap the map to move the target, or drag it. Tap the green to aim at the flag. The ring shows where about 3 in 4 of your shots with that club finish.</p>`;
  }
  return '';
}
function hvWindHtml() {
  return `<div class="form-row plays-like mt"><div class="field"><label>Wind (mph, + into)</label><input type="number" value="${Planner.s.wind}" data-change="mapWind"></div><div class="field"><label>Elevation (yds, + up)</label><input type="number" value="${Planner.s.elev}" data-change="mapElev"></div></div>`;
}

Object.assign(Actions, {
  openHoleView(el) {
    const lr = App.state.liveRound;
    const id = (el && el.dataset.id) || (lr && lr.courseId) || Planner.s.courseId;
    App.ui.hv = { courseId: id, hole: el && el.dataset.hole ? +el.dataset.hole : (App.route() === 'map' ? Planner.s.hole : 1) };
    location.hash = '#/gps';
  },
  hvSheet(el) { App.ui.hvSheet = el.dataset.v || null; App.render(); },
  hvHole(el) {
    const lr = HoleView.live(), h = HoleView.info(); if (!h) return;
    const to = el.dataset.to ? +el.dataset.to : h.n + (+el.dataset.d || 0);
    if (lr) { const i = to - (lr.first || 0) - 1; if (i < 0 || i >= lr.holes.length) return; lr.cur = i; Store.save(); }
    else { if (to < 1 || to > h.holes) return; HoleView.s.hole = to; }
    App.ui.hvSheet = null; HoleView._gpsFit = false; App.render();
  },
  hvFinish() { App.ui.hvSheet = null; location.hash = '#/play'; },
  hvZoom() { HoleView.s.zoom = HoleView.s.zoom === 'green' ? 'hole' : 'green'; App.render(); },
  hvLocate() { App.locate(p => { App._lastPos = p; App._lastPosAt = Date.now(); const h = HoleView.info(); if (h && !(HoleView.ball(h) || {}).gps) App.toast('You’re not on this hole, so distances are from the tee'); HoleView.s.target = undefined; HoleView.layout(); HoleView.overlay(); }); },
  hvClub(el) { HoleView.s.club = el.dataset.club; App.ui.hvSheet = null; App.render(); HoleView.afterMove(); },
  hvResetTarget() { HoleView.s.target = undefined; HoleView.s.club = null; App.ui.hvSheet = null; App.render(); },
  hvPlan() { const h = HoleView.info(); App.ui.plan = { courseId: HoleView.s.courseId, hole: h ? h.n : 1, startMode: h && (HoleView.ball(h) || {}).gps ? 'gps' : 'tee', fitted: null }; App.ui.hvSheet = null; location.hash = '#/map'; },
  hvMark(el) {
    App.ui.gps = Object.assign(App.ui.gps || {}, { club: el.dataset.club || '' });
    App.ui.hvSheet = null;
    Actions.gpsMark();
  },
  hvMeasure() { if (App.ui.gps) App.ui.gps.once = true; Actions.gpsMeasure(); },
});
