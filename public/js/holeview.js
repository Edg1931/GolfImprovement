/* Full-screen hole view for use on the course: satellite map turned so the hole runs up the screen,
   a draggable target with yardages to it and on to the green, club advice from the player's own
   dispersion, shot tracking and score entry.

   The Leaflet map sits in an oversized square that is rotated with CSS (Leaflet can't rotate), and the
   map's own dragging and zooming are switched off. Everything drawn on top (lines, target, yardage
   bubbles) lives in a screen-space layer, so it stays upright and crisp. toScreen/fromScreen convert
   between the two.

   Also here: the pin position of the day, live wind and slope for plays-like yardages, moving to the next
   hole automatically, a big-number glance mode, and saving a course's imagery for use offline. */

const HoleView = {
  el: null, map: null, layers: null,
  s: { courseId: null, hole: 1, target: null, zoom: 'hole', club: null, key: null, advice: null, mode: 'aim', pins: {}, tipHidden: {}, from: null },
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
    const hi = CourseMap.holeInfo(c, n);
    const k = lr ? lr.cur : n - 1;
    const pin = (lr ? lr.pins && lr.pins[n] : this.s.pins[c.id + ':' + n]) || null;
    return {
      c, n, lr, tee: hi.tee, green: hi.green, front: hi.front, back: hi.back, pin, flag: pin || hi.green,
      line: hi.line, par: lr ? lr.pars[k] : c.pars[n - 1], si: lr ? (lr.siCard || lr.si)[k] : (c.si || [])[n - 1],
      yards: lr ? lr.yards && lr.yards[k] : c.yards && c.yards[n - 1], tees: lr ? lr.tees : c.tees, holes: lr ? lr.holes.length : c.pars.length,
    };
  },
  /* Where the ball is: the player's GPS position when it's fresh and on this hole, otherwise the tee. */
  ball(h) {
    if (this.s.from) return { pos: this.s.from, gps: false, custom: true };   // planning: the ball is wherever it was put
    const p = App._lastPos, fresh = p && Date.now() - (App._lastPosAt || 0) < 60000;
    const ref = h.green || h.tee;
    if (fresh && ref && yardsBetween(p, ref) < 650) return { pos: p, gps: true };
    return h.tee ? { pos: h.tee, gps: false } : (fresh ? { pos: p, gps: true } : null);
  },
  models() { return Caddie.bagModels(App.state.clubs, App.state.shotLog, App.index()); },
  /* Plays-like inputs for a shot from `start` to `tgt`: live wind and ground height unless the player
     typed their own numbers in Tools. adj = extra yards it plays; drift = yards the wind moves it (+ right). */
  cond(start, tgt) {
    const mw = +Planner.s.wind || 0, me = +Planner.s.elev || 0;
    const out = { head: 0, cross: 0, rise: 0, adj: 0, drift: 0, windSrc: '', elevSrc: '' };
    if (!start || !tgt) return out;
    const d = yardsBetween(start, tgt), w = Weather.wind;
    if (mw) { out.head = mw; out.windSrc = 'manual'; }
    else if (w) { const c = windComponents(w.from, w.speed, bearingDeg(start, tgt)); out.head = c.head; out.cross = c.cross; out.windSrc = 'live'; }
    if (me) { out.rise = me; out.elevSrc = 'manual'; }
    else { const e0 = Weather.elevOf(start), e1 = Weather.elevOf(tgt); if (e0 != null && e1 != null) { out.rise = Math.round((e1 - e0) / 0.9144); out.elevSrc = 'live'; } }
    out.adj = playsLikeYards(d, out.head, out.rise); out.drift = Math.round(driftYards(d, out.cross));
    return out;
  },
  cur() { const h = this.info(); const b = h && this.ball(h); return this.cond(b && b.pos, h && (this.s.target || h.flag)); },
  adjust() { return this.cur().adj; },
  drift() { return this.cur().drift; },
  /* The club whose typical distance best matches `yards` (plays-like). */
  clubFor(yards, models, adj) {
    const d = yards + (adj == null ? this.adjust() : adj); let best = null;
    models.forEach(m => { if (!best || Math.abs(m.along - d) < Math.abs(best.along - d)) best = m; });
    return best;
  },
  /* Default target: the green if the longest club can reach, otherwise one tee-shot down the hole's line. */
  defaultTarget(h, start, models) {
    if (!h.flag) return null;
    const longest = models.reduce((a, m) => (!a || m.along > a.along ? m : a), null);
    const reach = longest ? longest.along : 230;
    const toGreen = yardsBetween(start, h.flag);
    if (toGreen <= reach + 15 || h.par === 3) return null;
    const proj = Caddie.projector(start);
    const pts = this.path(h, start).map(proj.toXY);
    let total = 0; for (let i = 1; i < pts.length; i++) total += Caddie.dist(pts[i - 1], pts[i]);
    let pick = null;
    for (let d = 0; d <= total; d += 3) { const q = Caddie.alongPolyline(pts, d); if (Math.hypot(q.x, q.y) >= reach) { pick = q; break; } }
    // leave at least a short pitch
    if (!pick || toGreen - reach < 30) return null;
    return proj.toLL(pick);
  },

  path(h, start) { const p = CourseMap.holePath(h.c, h.n, start || h.tee); if (h.pin && p.length) p[p.length - 1] = h.pin; return p; },
  holeFeatures(h) { return CourseMap.holeShapes(h.c, h.n); },

  /* ---------- map ---------- */
  ensureMap() {
    if (this.map || typeof L === 'undefined') return !!this.map;
    this.el = document.createElement('div'); this.el.className = 'hv-map';
    this.map = L.map(this.el, { zoomControl: false, attributionControl: false, dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, zoomSnap: 0, maxZoom: 20, fadeAnimation: false, zoomAnimation: false, inertia: false });
    L.tileLayer(ESRI_TILES, { maxZoom: 20, maxNativeZoom: 19, crossOrigin: true }).addTo(this.map);
    this.layers = { features: L.layerGroup().addTo(this.map), setup: L.layerGroup().addTo(this.map) };
    this.map.on('click', e => this.onSetupTap({ lat: e.latlng.lat, lon: e.latlng.lng }));
    this.map.setView([39.5, -98.35], 4);
    return true;
  },
  /* Panning and zooming are only on while finding a hole on the satellite image. */
  setInteractive(on) {
    ['dragging', 'touchZoom', 'scrollWheelZoom', 'doubleClickZoom'].forEach(k => { if (this.map[k]) this.map[k][on ? 'enable' : 'disable'](); });
  },

  /* ---------- setting up a hole that isn't mapped: tap its tee, then its green ---------- */
  needsSetup(h) { return !h.tee || !h.green; },
  /* Somewhere to start looking for the hole: the last hole's green, the course, or the player. */
  setupCenter(h) {
    const c = h.c;
    for (let n = h.n - 1; n >= 1; n--) { const p = CourseMap.holeInfo(c, n); if (p.green || p.tee) return { at: p.green || p.tee, z: 17 }; }
    if (h.tee) return { at: h.tee, z: 17 };
    if (c.map && c.map.center) return { at: c.map.center, z: 16 };
    if (c.geo) return { at: c.geo, z: 16 };
    return null;   // ask where the course is ("I'm at the course" uses GPS)
  },
  setupMount(slot, h) {
    const W = slot.clientWidth, H = slot.clientHeight;
    Object.assign(this.el.style, { width: W + 'px', height: H + 'px', transform: 'translate(-50%, -50%)' });
    this.g = null;
    this.map.invalidateSize({ animate: false, pan: false });
    this.setInteractive(true);
    const key = h.c.id + ':' + h.n;
    if (this.s.setupView !== key) { const c = this.setupCenter(h); if (c) { this.map.setView([c.at.lat, c.at.lon], c.z, { animate: false }); this.s.setupView = key; } }
    // every mapped shape, so greens and tees already known are easy to spot
    this.layers.features.clearLayers(); this.layers.setup.clearLayers();
    ((h.c.map && h.c.map.features) || []).forEach(f => L.polygon(f.ll.map(p => [p.lat, p.lon]), Object.assign({}, FEATURE_STYLE[f.type] || {}, { interactive: false })).addTo(this.layers.features));
    Object.entries((h.c.map && h.c.map.holes) || {}).forEach(([n, x]) => {
      if (x.tee) L.circleMarker([x.tee.lat, x.tee.lon], { radius: +n === h.n ? 8 : 5, color: '#fff', weight: 2, fillColor: +n === h.n ? '#e6cf85' : '#2a7a52', fillOpacity: 1, interactive: false }).addTo(this.layers.setup);
      if (x.green) L.marker([x.green.lat, x.green.lon], { interactive: false, icon: L.divIcon({ className: 'map-flag' + (+n === h.n ? ' cur' : ''), html: `<span>${n}</span>`, iconSize: [22, 22], iconAnchor: [4, 20] }) }).addTo(this.layers.setup);
    });
    const box = document.getElementById('hvOver'); if (box) box.innerHTML = '';
  },
  onSetupTap(p) {
    if (App.route() !== 'gps') return;
    const h = this.info(); if (!h || !this.needsSetup(h)) return;
    const c = h.c;
    c.map = c.map || { holes: {}, features: [], source: 'manual' };
    const mh = c.map.holes[h.n] = c.map.holes[h.n] || {};
    if (!mh.tee) { mh.tee = CourseMap.pt(p); if (!c.map.center) c.map.center = CourseMap.pt(p); Store.save(); App.render(); App.toast(`Tee set for hole ${h.n}. Now tap the middle of the green.`); return; }
    // on a mapped green, use its middle
    const inside = (c.map.features || []).filter(f => f.type === 'green').find(f => { const pr = Caddie.projector(p); return Caddie.pointInPolygon({ x: 0, y: 0 }, f.ll.map(pr.toXY)); });
    const g = inside ? CourseMap.pt(CourseMap.centroidLL(inside.ll)) : CourseMap.pt(p);
    if (yardsBetween(mh.tee, g) < 60) { App.toast('That’s very close to the tee. Tap the middle of this hole’s green.'); return; }
    mh.green = g; mh.line = [mh.tee, g];
    if (!mh.par) mh.par = c.pars[h.n - 1];
    c.greens = c.greens || {};
    const old = c.greens[h.n - 1]; if (!old || !old.manual) c.greens[h.n - 1] = Object.assign({}, CourseMap.greenPins(c, h.n) || { center: g }, { fromMap: true });
    Store.save(); this.s.key = null; App.render();
    App.toast(`Hole ${h.n} mapped: ${Math.round(yardsBetween(mh.tee, g))} yds. Tap › for the next hole.`);
  },
  /* Put the tee and green of this hole back to "not set", to mark them again. */
  unmap(h) {
    const c = h.c; const mh = c.map && c.map.holes[h.n]; if (mh) { delete mh.tee; delete mh.green; delete mh.line; }
    if (c.greens && c.greens[h.n - 1] && !c.greens[h.n - 1].manual) delete c.greens[h.n - 1];
    this.s.setupView = null; Store.save();
  },

  mount() {
    if (!this._watching) { this._watching = true; App.watchGps(true); }
    if (this.live()) App.keepAwake(true);
    if (App.ui.hvGlance) { this.glance(); return; }
    const slot = document.getElementById('hvSlot'); if (!slot || !this.ensureMap()) return;
    slot.prepend(this.el);
    const h = this.info();
    const key = h ? h.c.id + ':' + h.n : null;
    if (key !== this.s.key) { this.s.key = key; this.s.target = undefined; this.s.club = null; this.s.zoom = 'hole'; this.s.advice = null; this.s.mode = 'aim'; this.s.from = null; }
    if (h && this.needsSetup(h)) { this.setupMount(slot, h); return; }
    this.setInteractive(false); this.layers.setup.clearLayers();
    const ref = h && (h.flag || h.tee || h.c.geo);
    if (ref && !(Weather.wind && Date.now() - Weather.wind.at < 15 * 60000)) Weather.loadWind(ref).then(w => { if (w && App.route() === 'gps') { this.overlay(); this.advise(); } });
    this.layout();
    this.drawFeatures();
    this.overlay();
    if (!this.s.advice || this.s.adviceKey !== this.adviceKey()) this.afterMove();
    this.bindPointer(slot);
  },
  leave() { if (this._watching) { this._watching = false; if (!App.ui.liveYds) App.watchGps(false); } },

  /* Size and turn the map so the hole (or the green) fills the space between the top and bottom bars. */
  layout() {
    const slot = document.getElementById('hvSlot'), h = this.info(); if (!slot || !h) return;
    const W = slot.clientWidth, H = slot.clientHeight;
    const banner = slot.querySelector('.hv-tip, .hv-hint'), lie = slot.querySelector('.hv-lie');
    const top = 118 + (banner ? banner.offsetHeight + 10 : 0), bottom = (W < 700 ? 196 : 150) + (lie ? lie.offsetHeight + 8 : 0), side = 16;
    const b = this.ball(h), start = b ? b.pos : null;
    const models = this.models();
    if (this.s.target === undefined) this.s.target = start ? this.defaultTarget(h, start, models) : null;
    const ref = h.flag || h.tee || start;
    if (!ref) { this.g = null; const c = h.c; const at = (c.map && c.map.center) || c.geo; if (at) { this.el.style.transform = 'translate(-50%, -50%)'; this.map.invalidateSize(); this.map.setView([at.lat, at.lon], 16, { animate: false }); } return; }
    // turn so the ball-to-green direction points up
    let phi = 0;
    const from = start || h.tee, to = h.flag || (h.line && h.line[h.line.length - 1]);
    if (from && to && yardsBetween(from, to) > 5) { const proj = Caddie.projector(from), v = proj.toXY(to); phi = Math.atan2(v.x, v.y); }
    const proj = Caddie.projector(ref);
    let pts;
    if (this.s.zoom === 'green' && h.green) pts = [h.front, h.back, h.green, h.pin].filter(Boolean).map(proj.toXY).flatMap(p => [{ x: p.x - 28, y: p.y - 28 }, { x: p.x + 28, y: p.y + 28 }]);
    else pts = [start, h.flag, this.s.target, ...(h.line || [])].filter(Boolean).map(proj.toXY);
    if (pts.length === 1) pts.push({ x: pts[0].x + 40, y: pts[0].y + 40 }, { x: pts[0].x - 40, y: pts[0].y - 40 });
    const cs = Math.cos(phi), sn = Math.sin(phi);
    const uv = pts.map(p => ({ u: p.x * cs - p.y * sn, v: p.x * sn + p.y * cs }));
    let u0 = Math.min(...uv.map(p => p.u)), u1 = Math.max(...uv.map(p => p.u)), v0 = Math.min(...uv.map(p => p.v)), v1 = Math.max(...uv.map(p => p.v));
    // frame just this hole: its corridor, a little behind the tee and past the green
    if (this.s.zoom !== 'green') { u0 -= 32; u1 += 32; v0 -= 12; v1 += 22; }
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
    this.g = { W, H, D, dy, theta: -phi, ppy: Math.pow(2, z) * 0.9144 / (156543.03 * Math.cos(lat)) };
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
    const h = this.info(); if (!h) return;
    this.holeFeatures(h).forEach(f => {
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
    const tgt = this.s.target || h.flag;
    const S = p => this.toScreen(p);
    const bs = S(start), ts = S(tgt), gs = S(h.flag);
    const cd = this.cond(start, tgt); this._condKey = cd.adj + ':' + cd.drift;
    let svg = this.spotlight(h, start), html = '';
    html += this.yardageBook(h, start);
    const d1 = start && tgt ? yardsBetween(start, tgt) : null;
    const d2 = this.s.target && h.flag ? yardsBetween(this.s.target, h.flag) : null;
    const club = d1 != null && models.length ? (this.s.club && models.find(m => m.club === this.s.club)) || this.clubFor(d1, models, cd.adj) : null;
    // the chosen club's pattern: where about 3 in 4 of the player's shots with it finish
    if (club && start && tgt) {
      const proj = Caddie.projector(start), s0 = { x: 0, y: 0 }, t0 = proj.toXY(tgt);
      const pts = Caddie.ellipse(s0, t0, club, cd.adj, 40, cd.drift).map(q => S(proj.toLL(q)));
      svg += `<polygon class="hv-ellipse" points="${pts.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ')}"/>`;
    }
    if (bs && ts) svg += `<line class="hv-line" x1="${bs.x}" y1="${bs.y}" x2="${ts.x}" y2="${ts.y}"/>`;
    if (this.s.target && ts && gs) svg += `<line class="hv-line" x1="${ts.x}" y1="${ts.y}" x2="${gs.x}" y2="${gs.y}"/>`;
    if (gs) html += h.pin ? `<div class="hv-flag" style="left:${gs.x}px;top:${gs.y}px"><i></i></div>` : `<div class="hv-pin" style="left:${gs.x}px;top:${gs.y}px"></div>`;
    html += this.planHtml(h);
    if (bs) html += `<div class="${b.gps ? 'hv-me' : b.custom ? 'hv-ball' : 'hv-tee'}" id="hvBall" style="left:${bs.x}px;top:${bs.y}px" aria-label="Your ball: drag to move"></div>`;
    if (this.s.target && ts) html += `<div class="hv-target" id="hvTarget" style="left:${ts.x}px;top:${ts.y}px" aria-label="Target: drag to move"><i></i></div>`;
    // yardage bubbles beside each leg
    const bubble = (a, z, cls, inner) => {
      if (!a || !z) return '';
      const mx = (a.x + z.x) / 2, my = (a.y + z.y) / 2;
      if (my < 150 || my > this.g.H - 240) return '';   // off the visible part of the map (e.g. zoomed to the green)
      // keep bubbles clear of the line and of the buttons down the right-hand side
      const bw = cls === 'main' ? 222 : 120, room = this.g.W - 70;
      const fitsR = mx + 18 + bw <= room, fitsL = mx - 18 - bw >= 4;
      const left = fitsR && fitsL ? mx > this.g.W * 0.55 : fitsL || (!fitsR && mx - 18 > room - mx - 18);   // neither fits: the roomier side
      const x = Math.max(4, Math.min(room - bw, left ? mx - 18 - bw : mx + 18));
      return `<div class="hv-bubble ${cls}" style="left:${x}px;top:${my - 30}px">${inner}</div>`;
    };
    if (d1 != null && bs && ts) {
      const bits = [];
      if (Math.abs(cd.adj) >= 2) bits.push(`plays ${Math.round(d1 + cd.adj)}`);
      if (Math.abs(cd.drift) >= 3) bits.push(`aim ${Math.abs(cd.drift)} ${cd.drift > 0 ? 'L' : 'R'}`);
      const plays = bits.length ? `<small class="hv-plays">${bits.join(' · ')}</small>` : '';
      const adv = this.s.advice;
      const risk = adv && this.s.adviceKey === this.adviceKey() ? (adv.green != null && !this.s.target ? `${Math.round(adv.green * 100)}% green` : adv.trouble >= 0.05 ? `${Math.round(adv.trouble * 100)}% trouble` : adv.fairway != null ? `${Math.round(adv.fairway * 100)}% fairway` : '') : '';
      html += bubble(bs, ts, 'main', `<span class="hv-yds">${Math.round(d1)}<small>y</small></span><button class="hv-club" data-action="hvSheet" data-v="caddie"><strong>${club ? escapeHtml(club.club) : 'Caddie'}</strong><small>${risk || (club && club.learned ? 'your pattern' : 'tap for advice')}</small>${plays}<span class="hv-chev">›</span></button>`);
    }
    if (d2 != null && ts && gs) {
      const c2 = models.length ? this.clubFor(d2, models, playsLikeYards(d2, cd.head, 0)) : null;
      html += bubble(ts, gs, 'second', `<span class="hv-yds">${Math.round(d2)}<small>y</small></span>${c2 ? `<span class="hv-club2">${escapeHtml(c2.club)}</span>` : ''}`);
    }
    box.innerHTML = `<svg class="hv-svg" width="${this.g.W}" height="${this.g.H}">${svg}</svg>${html}`;
    this.header(h, start);
    this.windChip();
  },
  /* The saved plan for this hole: each shot's line and where it finishes, with the club. */
  planHtml(h) {
    const plan = (h.c.plans && h.c.plans[h.n]) || []; if (!plan.length) return '';
    let html = '';
    plan.forEach((st, i) => {
      const a = this.toScreen(st.start), z = this.toScreen(st.land || st.aim); if (!a || !z) return;
      const len = Math.hypot(z.x - a.x, z.y - a.y), ang = Math.atan2(z.y - a.y, z.x - a.x);
      html += `<div class="hv-plan-line" style="left:${a.x}px;top:${a.y}px;width:${len}px;transform:rotate(${ang}rad)"></div>`;
      html += `<div class="hv-step" style="left:${z.x}px;top:${z.y}px"><b>${i + 1}</b><span>${escapeHtml(st.club)}</span></div>`;
    });
    return html;
  },
  /* The club the caddie would hit to the current target from the current ball. */
  planClub(h) {
    const b = this.ball(h), tgt = this.s.target || h.flag, models = this.models();
    if (!b || !tgt || !models.length) return null;
    const cd = this.cond(b.pos, tgt);
    return (this.s.club && models.find(m => m.club === this.s.club)) || this.clubFor(yardsBetween(b.pos, tgt), models, cd.adj);
  },

  /* Wind arrow in the corner, turned to match the map: it points the way the wind is blowing. */
  windChip() {
    const el = document.getElementById('hvWind'); if (!el) return;
    const w = Weather.wind, mw = +Planner.s.wind || 0;
    if (mw) { el.innerHTML = `<i style="transform:rotate(${mw > 0 ? 180 : 0}deg)">↑</i><small>${Math.abs(mw)} mph</small>`; el.hidden = false; return; }
    if (!w || !this.g) { el.hidden = true; return; }
    const screenUp = -this.g.theta * 180 / Math.PI;
    el.hidden = false;
    el.title = `Wind ${Math.round(w.speed)} mph from the ${compass(w.from)}${w.gust ? `, gusting ${Math.round(w.gust)}` : ''}`;
    el.innerHTML = `<i style="transform:rotate(${Math.round(w.from + 180 - screenUp)}deg)">↑</i><small>${Math.round(w.speed)} mph</small>`;
  },
  /* Darken everything but this hole: a soft-edged corridor along the line of play, plus the green. */
  spotlight(h, start) {
    const g = this.g, S = p => this.toScreen(p);
    const k = g.ppy, green = S(h.green);
    let cut = '';
    if (this.s.zoom === 'green') { if (green) cut = `<circle cx="${green.x}" cy="${green.y}" r="${48 * k}"/>`; }
    else {
      // the whole hole stays lit from the tee, plus a pool of light where the ball is
      const pts = this.path(h, h.tee || start).map(S).filter(Boolean);
      const bs = start && start !== h.tee && S(start); if (bs) cut += `<circle cx="${bs.x}" cy="${bs.y}" r="${22 * k}"/>`;
      if (pts.length >= 2) cut += `<polyline points="${pts.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ')}" fill="none" stroke="#000" stroke-width="${64 * k}" stroke-linecap="round" stroke-linejoin="round"/>`;
      if (green) cut += `<circle cx="${green.x}" cy="${green.y}" r="${34 * k}"/>`;
    }
    if (!cut) return '';
    const blur = Math.max(8, 14 * k);
    return `<defs><filter id="hvSoft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${blur.toFixed(1)}"/></filter>
      <mask id="hvMask" maskUnits="userSpaceOnUse" x="0" y="0" width="${g.W}" height="${g.H}"><rect width="${g.W}" height="${g.H}" fill="#fff"/><g filter="url(#hvSoft)" fill="#000">${cut}</g></mask></defs>
      <rect class="hv-dim" width="${g.W}" height="${g.H}" mask="url(#hvMask)"/>`;
  },
  /* Yardage-book details: reach and carry for hazards ahead, 100/150/200 markers to the green, and the
     front and back of the green when zoomed in. */
  yardageBook(h, start) {
    if (!start || !h.flag) return '';
    const S = p => this.toScreen(p), W = this.g.W;
    const proj = Caddie.projector(start), gXY = proj.toXY(h.flag), toGreen = Math.hypot(gXY.x, gXY.y);
    let html = '';
    const labels = [];
    this.holeFeatures(h).filter(f => f.type === 'water' || f.type === 'bunker').forEach(f => {
      const xy = f.ll.map(proj.toXY);
      const ahead = xy.map(q => ({ q, o: Caddie.offsets({ x: 0, y: 0 }, gXY, q) })).filter(v => v.o.along > 15);
      if (!ahead.length) return;
      const ds = ahead.map(v => Math.hypot(v.q.x, v.q.y));
      const reach = Math.round(Math.min(...ds)), carry = Math.round(Math.max(...ds));
      if (reach > toGreen + 15) return;
      const cen = Caddie.centroid(xy), lat = Caddie.offsets({ x: 0, y: 0 }, gXY, cen).lat;
      if (Math.abs(lat) > 60) return;
      labels.push({ f, reach, carry, cen: proj.toLL(cen), lat });
    });
    labels.sort((a, b) => a.reach - b.reach).slice(0, 6).forEach(l => {
      const p = S(l.cen); if (!p) return;
      const x = Math.max(4, Math.min(W - 58, p.x + (l.lat < 0 ? -62 : 14))), y = p.y - 22;
      html += `<div class="hv-haz ${l.f.type}" style="left:${x}px;top:${y}px" title="${l.f.type === 'water' ? 'Water' : 'Bunker'}: reach ${l.reach}, carry ${l.carry}"><b>${l.carry}</b><span>${l.reach}</span></div>`;
    });
    if (this.s.zoom === 'green') {
      [['front', 'F'], ['back', 'B']].forEach(([k, t]) => { const q = h[k] && S(h[k]); if (q) html += `<div class="hv-fbl" style="left:${q.x}px;top:${q.y}px">${t} ${Math.round(yardsBetween(start, h[k]))}</div>`; });
      return html;
    }
    // layup markers measured back from the flag along the line of play
    const line = this.path(h, start).map(proj.toXY).reverse();
    let total = 0; for (let i = 1; i < line.length; i++) total += Caddie.dist(line[i - 1], line[i]);
    [100, 150, 200].forEach(d => {
      if (d > total - 25) return;
      const q = S(proj.toLL(Caddie.alongPolyline(line, d))); if (!q) return;
      const t = this.s.target && S(this.s.target); if (t && Math.hypot(q.x - t.x, q.y - t.y) < 44) return;   // don't sit under the target
      html += `<div class="hv-mark" style="left:${q.x}px;top:${q.y}px"><span>${d}</span></div>`;
    });
    return html;
  },

  /* Numbers in the top bar change as the player walks, so they're updated in place. */
  header(h, start) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const y = p => (start && p ? Math.round(yardsBetween(start, p)) : '—');
    set('hvMid', y(h.flag));
    set('hvFB', h.front || h.back ? `F ${y(h.front)} · B ${y(h.back)}` : '');
  },
  /* The flag for this hole: kept with the live round, or for this session when just looking. */
  setPin(p) {
    const h = this.info(); if (!h) return;
    if (h.lr) { h.lr.pins = h.lr.pins || {}; if (p) h.lr.pins[h.n] = CourseMap.pt(p); else delete h.lr.pins[h.n]; Store.save(); }
    else { const k = h.c.id + ':' + h.n; if (p) this.s.pins[k] = CourseMap.pt(p); else delete this.s.pins[k]; }
    this.s.target = undefined; this.s.mode = 'aim';
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
      drag = e.target.closest('#hvTarget') ? 'target' : e.target.closest('#hvBall') && !(this.ball(this.info()) || {}).gps ? 'ball' : false;
      if (drag) { over.setPointerCapture(e.pointerId); e.preventDefault(); }
    });
    over.addEventListener('pointermove', e => {
      if (!drag) return; const p = pos(e); moved = true;
      if (drag === 'ball') this.s.from = this.fromScreen(p.x, p.y); else this.s.target = this.fromScreen(p.x, p.y);
      this.s.advice = null; this.overlay();
    });
    over.addEventListener('pointerup', e => {
      const p = pos(e);
      if (drag) { const was = drag; drag = false; if (was === 'ball') this.s.club = null; this.afterMove(); if (was === 'ball') App.render(); return; }
      if (e.target.closest('button, .hv-bubble, a')) return;
      const dx = p.x - sx, dy = p.y - sy;
      if (Math.abs(dx) > 70 && Math.abs(dy) < 60) { Actions.hvHole({ dataset: { d: dx < 0 ? '1' : '-1' } }); return; }   // swipe between holes
      if (Math.hypot(dx, dy) > 10) return;   // a scroll, not a tap
      const h = this.info(); if (!h || !this.g) return;
      const t = this.fromScreen(p.x, p.y);
      if (this.s.mode === 'bend') {
        const mh = h.c.map.holes[h.n], line = (mh.line && mh.line.length >= 2 ? mh.line : [mh.tee, mh.green]).slice();
        const q = CourseMap.pt(t), d = yardsBetween(mh.tee, q);
        let k = 1; while (k < line.length - 1 && yardsBetween(mh.tee, line[k]) < d) k++;
        line.splice(k, 0, q); mh.line = line; this.s.mode = 'aim'; this.s.target = undefined; Store.save(); App.render();
        App.toast('Bend added: the line of play and yardages follow it'); return;
      }
      if (this.s.mode === 'pin') {
        if (h.green && yardsBetween(t, h.green) > 45) { App.toast('Tap on the green to place the flag'); return; }
        this.setPin(t); App.render(); App.toast(`Flag set: ${Math.round(yardsBetween((this.ball(h) || {}).pos || t, t))} yds`); return;
      }
      // a tap on the green aims at the flag
      this.s.target = h.green && yardsBetween(t, h.flag || h.green) < 12 ? null : t;
      this.s.club = null; this.afterMove();
    });
  },
  afterMove() {
    this.s.advice = null; this.overlay(); clearTimeout(this._advT); this._advT = setTimeout(() => this.advise(), 30);
    // ground height for the ball and target, for uphill and downhill (once per spot)
    const h = this.info(), b = h && this.ball(h); const tgt = h && (this.s.target || h.flag);
    if (b && tgt && !+Planner.s.elev) {
      const before = this._condKey;
      Weather.loadElevations([b.pos, tgt]).then(() => { if (App.route() !== 'gps') return; this.overlay(); if (this._condKey !== before) this.advise(); });
    }
  },

  /* What the advice depends on: ball, target and club. */
  adviceKey() {
    const h = this.info(), b = h && this.ball(h), t = h && (this.s.target || h.flag), f = p => p ? p.lat.toFixed(6) + ',' + p.lon.toFixed(6) : '';
    return [f(b && b.pos), f(t), this.s.club || ''].join('|');
  },
  /* Caddie numbers for the current club and target: chance of the green, fairway and trouble. */
  advise() {
    const h = this.info(); if (!h) return; const b = this.ball(h); if (!b) return;
    const tgt = this.s.target || h.flag; if (!tgt) return;
    const models = this.models(); if (!models.length) return;
    const g = CourseMap.holeGeometry(h.c, h.n, b.pos, h.pin); if (!g || !g.features.length) return;
    const d1 = yardsBetween(b.pos, tgt), cd = this.cond(b.pos, tgt);
    const club = (this.s.club && models.find(m => m.club === this.s.club)) || this.clubFor(d1, models, cd.adj);
    const sim = Caddie.simulate(g.start, g.proj.toXY(tgt), club, { features: g.features, green: g.green }, { adjust: cd.adj, drift: cd.drift, samples: 200, seed: 3 });
    const sh = sim.shares;
    this.s.adviceKey = this.adviceKey();
    this.s.advice = { green: sh.green || 0, fairway: g.features.some(f => f.type === 'fairway') ? (sh.fairway || 0) : null, trouble: (sh.water || 0) + (sh.ob || 0) + (sh.bunker || 0) + (sh.trees || 0) };
    this.overlay();
  },
  /* Full comparison for the sheet: every sensible club for this target, best expected score first. */
  compare() {
    const h = this.info(); if (!h) return null; const b = this.ball(h); if (!b) return null;
    const tgt = this.s.target || h.flag; if (!tgt) return null;
    const g = CourseMap.holeGeometry(h.c, h.n, b.pos, h.pin); if (!g) return null;
    const cd = this.cond(b.pos, tgt);
    const recs = Caddie.recommend(g.start, g.proj.toXY(tgt), this.models(), { features: g.features, green: g.green }, { adjust: cd.adj, drift: cd.drift, samples: 180, seed: 11 });
    return { recs: recs.slice(0, 6), mapped: g.features.length > 0, d: yardsBetween(b.pos, tgt), cd };
  },

  /* GPS update: redraw only if the ball is following the player. */
  onPos() {
    if (App.route() !== 'gps') return;
    const h = this.info(); if (!h) return;
    if (App._lastPos && this.autoHole(h, App._lastPos)) return;
    if (App.ui.hvGlance) { this.glance(); return; }
    const b = this.ball(h);
    if (b && b.gps) { if (!this._gpsFit) { this._gpsFit = true; this.s.target = undefined; this.layout(); } this.overlay(); }
    const t = document.getElementById('hvTrack'); const gps = App.ui.gps;
    if (t && gps && gps.start && App._lastPos) { const el = t.querySelector('small'); if (el) el.textContent = Math.round(yardsBetween(gps.start, App._lastPos)) + ' yds so far'; }
  },
};

/* ---------- moving between holes on their own ---------- */
/* On a live round: walking off a green without a score asks for it, and standing on the next tee moves
   the view there. Returns true when it changed the page. */
HoleView.autoHole = function (h, p) {
  const lr = h.lr; if (!lr || App.state.settings.autoHole === false || App.ui.hvSheet) return false;
  const cur = lr.holes[lr.cur];
  const ask = msg => { if (this._asked === h.n) return false; this._asked = h.n; App.ui.hvSheet = 'score'; App.render(); App.toast(msg); return true; };
  if (h.green) {
    const dg = yardsBetween(p, h.green);
    if (dg < 22) this._onGreen = h.n;
    else if (this._onGreen === h.n && dg > 45 && cur.strokes == null) return ask(`Finished hole ${h.n}? Enter your score`);
  }
  if (lr.cur + 1 < lr.holes.length) {
    const nt = CourseMap.holeInfo(h.c, h.n + 1).tee;
    if (nt && yardsBetween(p, nt) < 25 && (!h.green || yardsBetween(p, h.green) > 35)) {
      if (cur.strokes == null) return ask(`On the ${h.n + 1}${ordinalSuffix(h.n + 1)} tee: enter your score for hole ${h.n}`);
      lr.cur++; Store.save(); this._gpsFit = false; App.render(); App.toast(`Hole ${h.n + 1}`); return true;
    }
  }
  return false;
};
function ordinalSuffix(n) { const t = n % 100; return t >= 11 && t <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'); }
function compass(deg) { return ['north', 'north-northeast', 'northeast', 'east-northeast', 'east', 'east-southeast', 'southeast', 'south-southeast', 'south', 'south-southwest', 'southwest', 'west-southwest', 'west', 'west-northwest', 'northwest', 'north-northwest'][Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]; }

/* ---------- glance mode: just the numbers, big ---------- */
HoleView.glance = function () {
  const h = this.info(); if (!h) return;
  const b = this.ball(h), p = b && b.pos;
  const y = q => (p && q ? Math.round(yardsBetween(p, q)) : '—');
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('glF', y(h.front)); set('glM', y(h.flag)); set('glB', y(h.back));
  const cd = this.cond(p, h.flag);
  set('glPlays', p && h.flag && Math.abs(cd.adj) >= 2 ? `plays ${Math.round(yardsBetween(p, h.flag) + cd.adj)}` : '');
  set('glFrom', b ? (b.gps ? `from you${App._lastPos && App._lastPos.acc ? ' · ±' + Math.round(App._lastPos.acc * 1.09) + ' yds' : ''}` : 'from the tee') : '');
};
function glanceHtml(h) {
  const lr = h.lr, cur = lr ? lr.holes[lr.cur] : null, last = lr ? (lr.first || 0) + lr.holes.length : h.holes;
  return `<div class="hv glance" id="hvSlot">
    <div class="gl-top"><button class="hv-back" data-action="hvGlance" aria-label="Back to the map">‹</button>
      <div class="gl-hole"><b>Hole ${h.n}</b><span>Par ${h.par || '—'}${h.si ? ' · Hcp ' + h.si : ''}</span></div>
      <button class="hv-round" data-action="hvHole" data-d="-1" aria-label="Previous hole" ${h.n <= (lr ? (lr.first || 0) + 1 : 1) ? 'disabled' : ''}>‹</button><button class="hv-round" data-action="hvHole" data-d="1" aria-label="Next hole" ${h.n >= last ? 'disabled' : ''}>›</button></div>
    <div class="gl-nums">
      <div class="gl-row"><span>Back</span><b id="glB">—</b></div>
      <div class="gl-row mid"><span>${h.pin ? 'Pin' : 'Middle'}</span><b id="glM">—</b><em id="glPlays"></em></div>
      <div class="gl-row"><span>Front</span><b id="glF">—</b></div>
    </div>
    <p class="gl-from" id="glFrom"></p>
    ${lr ? `<button class="hv-score gl-score ${cur.strokes != null ? 'done' : ''}" data-action="hvSheet" data-v="score"><strong>Hole ${h.n}</strong><small>${cur.strokes != null ? `${cur.strokes} · ${scoreName(cur.strokes, h.par)}` : 'Enter score'}</small></button>` : ''}
  </div>`;
}

/* ---------- saving a course for offline use ---------- */
const Offline = {
  CACHE: 'fairwaylab-tiles',
  tile(lat, lon, z) {
    const n = Math.pow(2, z), r = lat * Math.PI / 180;
    return { x: Math.floor((lon + 180) / 360 * n), y: Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n) };
  },
  /* Tile addresses covering every mapped hole (with room around it), plus close-ups of the greens. */
  urls(course) {
    const set = new Set();
    const add = (pts, pad, z0, z1) => {
      if (!pts.length) return;
      const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon);
      const dLat = pad * 0.9144 / 110574, dLon = pad * 0.9144 / (111320 * Math.cos(lats[0] * Math.PI / 180));
      for (let z = z0; z <= z1; z++) {
        const a = this.tile(Math.max(...lats) + dLat, Math.min(...lons) - dLon, z), b = this.tile(Math.min(...lats) - dLat, Math.max(...lons) + dLon, z);
        for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) set.add(ESRI_TILES.replace('{z}', z).replace('{y}', y).replace('{x}', x));
      }
    };
    let any = false;
    for (let n = 1; n <= course.pars.length; n++) {
      const h = CourseMap.holeInfo(course, n), pts = [h.tee, h.green, h.front, h.back, ...(h.line || [])].filter(Boolean);
      if (!pts.length) continue; any = true;
      add(pts, 140, 15, 18);
      if (h.green) add([h.green], 60, 19, 19);
    }
    const c = (course.map && course.map.center) || course.geo;
    if (!any && c) add([c], 700, 15, 17);
    return [...set];
  },
  async download(course, progress) {
    if (typeof caches === 'undefined') throw new Error('This browser can’t save maps for offline use.');
    const urls = this.urls(course); if (!urls.length) throw new Error('Map this course first, then save it.');
    const cache = await caches.open(this.CACHE);
    let done = 0, fail = 0, i = 0;
    const worker = async () => {
      while (i < urls.length) {
        const url = urls[i++];
        try {
          if (!(await cache.match(url))) { const res = await fetch(url, { mode: 'cors' }); if (res.ok) await cache.put(url, res); else fail++; }
        } catch (e) { fail++; }
        done++; progress(done, urls.length, fail);
      }
    };
    await Promise.all([...Array(6)].map(worker));
    course.offline = { at: todayISO(), tiles: urls.length - fail };
    Store.save();
    return { total: urls.length, fail };
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
  const sheetHtml = sheet ? `<div class="hv-scrim" data-action="hvSheet" data-v=""></div><div class="hv-sheet" role="dialog" aria-label="${sheet}">${hvSheetHtml(sheet, h)}</div>` : '';
  if (App.ui.hvGlance) return glanceHtml(h) + sheetHtml;
  // a strategy tip on the tee
  const bl = HoleView.ball(h), onTee = bl && (!bl.gps || (h.tee && yardsBetween(bl.pos, h.tee) < 40));
  const tipKey = h.c.id + ':' + h.n, tip = onTee && s.zoom !== 'green' && !s.tipHidden[tipKey] && s.mode !== 'pin' ? smartTip(h.c, h.n, h.pin, HoleView.cond(h.tee, h.flag)) : null;
  const lastShot = gps.lastShot && hlr ? hlr.holes.flatMap(x => x.shots || []).find(x => x.id === gps.lastShot) : null;
  const mapped = h.green && h.tee, setup = !mapped;
  const back = hlr ? '#/play' : '#/map';
  let html = `<div class="hv ${setup ? 'setup' : ''}" id="hvSlot"><div class="hv-over" id="hvOver"></div>
    <div class="hv-top">
      <a class="hv-back" href="${back}" aria-label="Back">‹</a>
      <div class="hv-card">
        <button class="hv-hole" data-action="hvSheet" data-v="holes" aria-label="Choose hole"><span>${h.n}</span><small>▾</small></button>
        <div class="hv-cell hv-main"><small>${h.pin ? 'To the pin' : 'Mid green'}</small><strong><span id="hvMid">—</span><em>yds</em></strong><span class="hv-fb" id="hvFB"></span></div>
        <div class="hv-cell"><small>Par</small><strong>${h.par || '—'}</strong></div>
        <div class="hv-cell"><small>${escapeHtml((h.tees || 'Tee').split(/[ ·(]/)[0])}</small><strong>${h.yards || (h.tee && h.green ? Math.round(yardsBetween(h.tee, h.green)) : '—')}</strong></div>
        <div class="hv-cell"><small>Hcp</small><strong>${h.si || '—'}</strong></div>
      </div>
    </div>
    ${setup ? '' : s.mode === 'bend' ? '<div class="hv-hint">Tap the corner of the dogleg, where the hole bends <button class="btn sm ghost" data-action="hvBendMode">Cancel</button></div>' : s.mode === 'pin' ? '<div class="hv-hint">Tap where the flag is on the green <button class="btn sm ghost" data-action="hvPinMode">Cancel</button></div>' : tip ? `<button class="hv-tip" data-action="hvTipHide" aria-label="Caddie tip, tap to hide">💡 ${escapeHtml(tip)}</button>` : ''}
    ${setup ? setupHtml(h) : ''}
    <div class="hv-side">
      <button class="hv-round hv-wind" id="hvWind" data-action="hvSheet" data-v="tools" aria-label="Wind" hidden></button>
      <button class="hv-round ${h.pin ? 'on' : ''} ${s.mode === 'pin' ? 'active' : ''}" data-action="hvPinMode" aria-label="${h.pin ? 'Move the flag' : 'Set today’s flag position'}">⚑</button>
      <button class="hv-round" data-action="hvGlance" aria-label="Big numbers">123</button>
      <button class="hv-round" data-action="hvZoom" aria-label="${HoleView.s.zoom === 'green' ? 'Show the whole hole' : 'Zoom to the green'}">${HoleView.s.zoom === 'green' ? '⤢' : '⚲'}</button>
      <button class="hv-round" data-action="hvLocate" aria-label="Use my position">◎</button>
    </div>
    <div class="hv-bottom">
      ${lastShot && !gps.start ? `<button class="hv-lie" data-action="hvSheet" data-v="lie">Last shot: ${escapeHtml(lastShot.club || 'shot')} · ${Math.round(yardsBetween(lastShot.from, lastShot.to))} yds · <b>${SG.LIES.find(l => l[0] === lastShot.toLie)?.[1] || lastShot.toLie}</b> ✎</button>` : ''}
      ${hlr || setup ? '' : planStripHtml(h)}
      ${hlr ? `<button class="hv-track ${gps.start ? 'on' : ''}" id="hvTrack" data-action="${gps.start ? 'hvMeasure' : 'hvSheet'}" data-v="club">${gps.start ? `📏 Measure ${gps.club ? escapeHtml(gps.club) : 'shot'} <small>${App._lastPos ? Math.round(yardsBetween(gps.start, App._lastPos)) + ' yds so far' : 'walk to your ball'}</small>` : `📍 Track shot${gps.last != null ? ` <small>last: ${gps.last} yds${gps.lastClub ? ' ' + escapeHtml(gps.lastClub) : ''}${gps.lastLat != null && Math.abs(gps.lastLat) >= 2 ? ', ' + Math.abs(Math.round(gps.lastLat)) + (gps.lastLat > 0 ? ' R' : ' L') : ''}</small>` : ''}`}</button>` : ''}
      <div class="hv-row">
        ${hlr ? '<a class="hv-btn" href="#/play"><span>Scorecard</span><small>›</small></a>' : '<button class="hv-btn" data-action="hvPlan"><span>Planner</span><small>›</small></button>'}
        ${hlr ? `<button class="hv-score ${cur.strokes != null ? 'done' : ''}" data-action="hvSheet" data-v="score"><strong>Hole ${h.n}</strong><small>${cur.strokes != null ? `${cur.strokes} · ${scoreName(cur.strokes, h.par)}` : 'Enter score'}</small></button>`
          : setup ? `<button class="hv-score" disabled><strong>Hole ${h.n}</strong><small>${h.tee ? 'tap the green' : 'tap the tee'}</small></button>`
          : (() => { const pc = mapped && HoleView.planClub(h); return `<button class="hv-score plan" data-action="hvAddShot" ${pc ? '' : 'disabled'}><strong>＋ ${pc ? escapeHtml(pc.club) : 'Add shot'}</strong><small>add to hole ${h.n} plan</small></button>`; })()}
        <button class="hv-next" data-action="hvHole" data-d="1" aria-label="Next hole" ${h.n >= (hlr ? (hlr.first || 0) + hlr.holes.length : h.holes) ? 'disabled' : ''}>›</button>
        <button class="hv-btn" data-action="hvSheet" data-v="tools"><span>Tools</span><small>›</small></button>
      </div>
    </div>
    <div class="hv-attr">Imagery © Esri, Maxar, Earthstar Geographics</div>
  </div>`;
  return html + sheetHtml;
};

/* Setting up an unmapped hole: find the course, then tap the tee and the green on the satellite image. */
function setupHtml(h) {
  const c = h.c;
  if (!HoleView.setupCenter(h)) {
    const res = App.ui.hvPlaces;
    return `<div class="hv-setup card find"><h3>Where is ${escapeHtml(c.name)}?</h3><p class="small">Search for it to see the course on the satellite map. You only do this once.</p>
      <form data-form="hvPlace" class="hv-search"><input name="q" aria-label="Course or town" value="${escapeHtml(App.ui.hvPlaceQ || [c.name, c.location].filter(Boolean).join(' '))}" required><button class="btn primary" type="submit">Search</button></form>
      ${res ? (res.length ? `<ul class="hv-places">${res.map((r, i) => `<li><button data-action="hvPlacePick" data-i="${i}"><strong>${escapeHtml(r.name)}</strong><small>${escapeHtml(r.detail)}</small></button></li>`).join('')}</ul>` : '<p class="small muted">Nothing found. Try the course name with its town.</p>') : ''}
      <button class="btn sm ghost mt" data-action="hvPlaceMe">📍 I'm at the course</button></div>`;
  }
  const none = !(c.map && Object.keys(c.map.holes || {}).length);
  return `<div class="hv-setup"><div class="hv-setup-txt"><b>Hole ${h.n}${h.par ? ' · Par ' + h.par : ''}${h.yards ? ' · ' + h.yards + ' yds' : ''}</b>
      <span>${h.tee ? '2 · Now tap the middle of the green' : '1 · Find this hole’s tee on the satellite image and tap it'}</span><small>Drag to move the map, pinch to zoom in.</small></div>
    <div class="hv-setup-btns">${none ? '<button data-action="hvImport">Try auto-map</button>' : ''}${h.tee ? '<button data-action="hvRemap">Redo tee</button>' : ''}</div></div>`;
}

/* Planning away from the course: what's in this hole's plan, and how to change it. */
function planStripHtml(h) {
  const plan = (h.c.plans && h.c.plans[h.n]) || [], s = HoleView.s;
  const done = plan.length && h.flag && yardsBetween(plan[plan.length - 1].land || plan[plan.length - 1].aim, h.flag) < 25;
  return `<div class="hv-planstrip">
    <div class="hv-plan-txt">${plan.length ? `<b>Plan:</b> ${plan.map(st => escapeHtml(st.club)).join(' → ')}${done ? ' ✓' : ''}` : '<b>Plan this hole:</b> tap where you want to hit it, then add the shot'}${s.from ? ' · <em>ball moved</em>' : ''}</div>
    <div class="hv-plan-btns">${s.from ? '<button data-action="hvBallReset">Tee</button>' : ''}${plan.length ? '<button data-action="hvPlanUndo">Undo</button><button data-action="hvPlanClear">Clear</button>' : ''}</div></div>`;
}

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
      ${firstPuttEntry(hh)}
      ${par >= 4 ? `<div class="entry"><div class="entry-label">Tee shot</div><div class="seg">${FAIRWAY_OPTS.map(([v, l]) => `<button class="${hh.fir === v ? 'active' : ''}" data-action="holeSet" data-k="fir" data-v="${v}">${l}</button>`).join('')}</div></div>` : ''}
      <div class="entry"><div class="entry-label">Penalties</div><div class="stepper sm"><button class="step" data-action="holeStep" data-k="pen" data-d="-1" aria-label="Remove penalty">−</button><output class="step-val">${hh.pen || 0}</output><button class="step" data-action="holeStep" data-k="pen" data-d="1" aria-label="Add penalty">+</button></div></div>
      ${lr.players && lr.players.length ? `<div class="entry"><div class="entry-label">Group</div>${Group.inputs(lr)}</div>` : ''}
      <div class="btn-row mt">${last ? `<button class="btn primary lg grow" data-action="hvFinish">Review &amp; finish ›</button>` : `<button class="btn primary lg grow" data-action="hvHole" data-d="1" ${hh.strokes == null ? 'disabled' : ''}>Save · next hole ›</button>`}</div>
      <p class="tiny muted mb0">Greenside bunkers and notes are on the full <a href="#/play">scorecard</a>.</p>`;
  }
  if (sheet === 'lie' && lr) {
    const gps = App.ui.gps || {}, shot = lr.holes.flatMap(x => x.shots || []).find(x => x.id === gps.lastShot);
    if (!shot) return close + '<p class="small mb0">No tracked shot to edit.</p>';
    return `${close}<h3>Where did it finish?</h3><p class="small muted">Worked out from the course map. Fix it if it's wrong, since strokes gained depends on it.</p>
      <div class="hv-clubs">${SG.LIES.filter(([k]) => k !== 'tee').map(([k, l]) => `<button class="chip ${shot.toLie === k ? 'active' : ''}" data-action="hvLie" data-v="${k}">${l}</button>`).join('')}</div>`;
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
    const pick = (sug && sug.club) || gps.club || '';
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
    const cd = cmp.cd;
    return `${close}<h3>Caddie · ${Math.round(cmp.d)} yds${Math.abs(cd.adj) >= 2 ? ` (plays ${Math.round(cmp.d + cd.adj)})` : ''}</h3>
      ${condLine(cd)}
      <p class="small">${cmp.mapped ? `<strong>${escapeHtml(r0.club)}</strong>, aim ${aim(r0)}. ${r0.model.learned ? `Based on your ${r0.model.nLat} tracked shots.` : 'Estimated from your chart distance until you track a few shots.'}` : 'Map this hole to see hazard risk. Clubs by distance:'}</p>
      <table class="caddie-table"><thead><tr><th>Club</th>${cmp.mapped ? '<th class="num">Exp.</th><th class="num">Green</th><th class="num">Trouble</th>' : '<th class="num">Typical</th><th class="num">vs target</th>'}<th class="num">Aim</th></tr></thead><tbody>
      ${cmp.recs.map(r => `<tr class="${(s.club || HoleView.clubFor(cmp.d, HoleView.models(), cd.adj).club) === r.club ? 'sel' : ''}" data-action="hvClub" data-club="${escapeHtml(r.club)}"><td><strong>${escapeHtml(r.club)}</strong></td>${cmp.mapped ? `<td class="num">${r.expected.toFixed(2)}</td><td class="num">${pc(r.shares.green)}</td><td class="num">${pc((r.shares.water || 0) + (r.shares.ob || 0) + (r.shares.bunker || 0) + (r.shares.trees || 0))}</td>` : `<td class="num">${Math.round(r.model.along)}</td><td class="num">${r.gap >= 0 ? '+' : ''}${Math.round(r.gap)}</td>`}<td class="num">${cmp.mapped ? (r.aimShift ? Math.abs(Math.round(r.aimShift)) + (r.aimShift < 0 ? 'L' : 'R') : '—') : ''}</td></tr>`).join('')}</tbody></table>
      <p class="tiny muted mb0">Tap a club to show its shot pattern on the map. Exp. = average strokes to hole out.</p>
      ${hvWindHtml()}`;
  }
  if (sheet === 'tools') {
    const dl = App.ui.dl, off = h.c.offline;
    return `${close}<h3>Tools</h3>${condLine(HoleView.cur())}${hvWindHtml()}
      <div class="entry"><div class="entry-label">Hole map</div><div class="btn-row"><button class="btn sm" data-action="hvBendMode">↪ Mark a dogleg bend</button><button class="btn sm" data-action="hvRemap">↺ Re-mark tee &amp; green</button></div></div>
      <div class="entry"><div class="entry-label">Flag</div><div class="btn-row"><button class="btn sm" data-action="hvPinMode">⚑ ${h.pin ? 'Move' : 'Set'} today's flag</button><button class="btn sm" data-action="hvPinHere">📍 I'm at the flag</button>${h.pin ? '<button class="btn sm ghost danger" data-action="hvPinClear">Clear</button>' : ''}</div></div>
      <div class="entry"><div class="entry-label">Offline</div>
        ${dl && dl.running ? `<div class="progress"><span id="dlBar" style="width:${Math.round(100 * dl.done / Math.max(1, dl.total))}%"></span></div><p class="tiny muted mb0" id="dlText">Saving ${dl.done} of ${dl.total} map tiles…</p>`
          : `<button class="btn sm" data-action="hvDownload">⬇ ${off ? 'Update offline maps' : 'Save this course for offline'}</button><p class="tiny muted mt mb0">${off ? `Saved ${fmtDate(off.at)} (${off.tiles} tiles).` : `Stores the satellite images for every mapped hole (about ${Math.max(1, Math.round(Offline.urls(h.c).length * 0.02))} MB) so the map works with no signal.`}</p>`}</div>
      <label class="field inline"><input type="checkbox" data-change="hvAutoHole" ${App.state.settings.autoHole === false ? '' : 'checked'}> Move to the next hole when I reach its tee</label>
      <div class="btn-row mt"><button class="btn" data-action="hvResetTarget">↺ Reset target</button><button class="btn" data-action="hvGlance">123 Big numbers</button><button class="btn" data-action="openFinder">📏 Rangefinder</button><button class="btn" data-action="openYardbook">📖 Yardage book</button><button class="btn" data-action="hvPlan">🗺 Shot planner</button>${lr ? '<a class="btn" href="#/play">📋 Full scorecard</a>' : ''}</div>
      <p class="tiny muted mt mb0">Tap the map to move the target, or drag it. Tap the green to aim at the flag. The ring shows where about 3 in 4 of your shots with that club finish.</p>`;
  }
  return '';
}
function hvWindHtml() {
  return `<details class="accordion mt"${+Planner.s.wind || +Planner.s.elev ? ' open' : ''}><summary>Enter wind or slope yourself</summary><div class="acc-body"><div class="form-row plays-like"><div class="field"><label>Wind (mph, + into, − behind)</label><input type="number" value="${+Planner.s.wind || ''}" placeholder="live" data-change="mapWind"></div><div class="field"><label>Rise (yds, + uphill)</label><input type="number" value="${+Planner.s.elev || ''}" placeholder="live" data-change="mapElev"></div></div><p class="tiny muted mb0">Leave blank to use live wind and the map's ground height.</p></div></details>`;
}
/* What the plays-like yardage is made of, in words. */
function condLine(cd) {
  const w = Weather.wind, bits = [];
  if (cd.windSrc === 'live' && w) bits.push(`Wind ${Math.round(w.speed)} mph from the ${compass(w.from)}${w.gust && w.gust - w.speed >= 5 ? ` (gusts ${Math.round(w.gust)})` : ''}: ${Math.abs(cd.head) < 1 ? 'across' : Math.round(Math.abs(cd.head)) + ' mph ' + (cd.head > 0 ? 'into you' : 'helping')}${Math.abs(cd.cross) >= 2 ? `, ${Math.round(Math.abs(cd.cross))} mph from the ${cd.cross > 0 ? 'right' : 'left'}` : ''}`);
  else if (cd.windSrc === 'manual') bits.push(`Wind ${Math.abs(cd.head)} mph ${cd.head > 0 ? 'into you' : 'helping'} (yours)`);
  if (cd.elevSrc && Math.abs(cd.rise) >= 2) bits.push(`${Math.abs(cd.rise)} yds ${cd.rise > 0 ? 'uphill' : 'downhill'}${cd.elevSrc === 'manual' ? ' (yours)' : ''}`);
  if (!bits.length) return `<p class="tiny muted">${navigator.onLine ? 'No wind or slope worth adjusting for.' : 'Offline: live wind and slope are unavailable.'}</p>`;
  return `<p class="small hv-cond">🌬 ${bits.join(' · ')}${Math.abs(cd.adj) >= 2 ? ` → plays <strong>${cd.adj > 0 ? '+' : '−'}${Math.abs(cd.adj)} yds</strong>` : ''}${Math.abs(cd.drift) >= 3 ? `, aim ${Math.abs(cd.drift)} yds ${cd.drift > 0 ? 'left' : 'right'}` : ''}.</p>`;
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
    HoleView._asked = null; HoleView._onGreen = null;
    const to = el.dataset.to ? +el.dataset.to : h.n + (+el.dataset.d || 0);
    if (lr) { const i = to - (lr.first || 0) - 1; if (i < 0 || i >= lr.holes.length) return; lr.cur = i; Store.save(); }
    else { if (to < 1 || to > h.holes) return; HoleView.s.hole = to; }
    App.ui.hvSheet = null; HoleView._gpsFit = false; App.render();
  },
  hvFinish() { App.ui.hvSheet = null; App.ui.hvGlance = false; location.hash = '#/play'; },
  /* Add a shot to this hole's plan: from the ball to the target with the club shown; the next shot
     starts where this one finishes, until the plan reaches the green. */
  hvAddShot() {
    const h = HoleView.info(); if (!h) return; const b = HoleView.ball(h), club = HoleView.planClub(h);
    const tgt = HoleView.s.target || h.flag; if (!b || !tgt || !club) return;
    let aimShift = 0, expected = null;
    try { const cmp = HoleView.compare(); const r = cmp && cmp.recs.find(x => x.club === club.club); if (r && cmp.mapped) { aimShift = Math.round(r.aimShift || 0); expected = r.expected; } } catch (e) { /* advice is optional */ }
    const c = h.c; c.plans = c.plans || {}; const plan = c.plans[h.n] = c.plans[h.n] || [];
    plan.push({ club: club.club, start: CourseMap.pt(b.pos), aim: CourseMap.pt(tgt), land: CourseMap.pt(tgt), aimShift, expected });
    Store.save();
    const s = HoleView.s; s.club = null;
    if (!s.target || yardsBetween(tgt, h.flag) < 25) { s.from = null; s.target = undefined; App.render(); App.toast(`Hole ${h.n} planned: ${plan.map(p => p.club).join(' → ')}`); return; }
    s.from = CourseMap.pt(tgt); s.target = undefined; App.render();
    App.toast(`Shot ${plan.length} added. ${Math.round(yardsBetween(tgt, h.flag))} yds left: tap the next target, or the green.`);
  },
  hvPlanUndo() {
    const h = HoleView.info(); const plan = h && h.c.plans && h.c.plans[h.n]; if (!plan || !plan.length) return;
    const last = plan.pop(); if (!plan.length) delete h.c.plans[h.n];
    HoleView.s.from = plan.length ? CourseMap.pt(last.start) : null; HoleView.s.target = undefined; Store.save(); App.render();
  },
  hvPlanClear() { const h = HoleView.info(); if (!h || !h.c.plans) return; delete h.c.plans[h.n]; HoleView.s.from = null; HoleView.s.target = undefined; Store.save(); App.render(); },
  hvBallReset() { HoleView.s.from = null; HoleView.s.target = undefined; App.render(); },
  async hvImport() {
    const h = HoleView.info(); if (!h) return; const c = h.c;
    const center = c.geo || (c.map && c.map.center);
    if (!center) { App.toast('This course has no location. Find it on the course map first.'); Actions.hvPlan(); return; }
    App.toast('Looking for golf features…');
    try {
      const data = CourseMap.parseOSM(await CourseMap.fetchOSM(center, 1600));
      if (!data.features.length && !Object.keys(data.holes).length) { App.toast('No golf features are mapped here yet. Draw them on the course map.'); return; }
      const res = CourseMap.apply(c, data, 'osm'); if (!c.map.center) c.map.center = CourseMap.pt(center);
      Store.save(); HoleView.s.key = null; App.render(); App.toast(`Loaded ${res.holes} holes and ${res.features} shapes`);
    } catch (e) { App.toast(navigator.onLine ? 'The map service is busy. Try again in a minute.' : 'You are offline.'); }
  },
  hvBendMode() { const s = HoleView.s; s.mode = s.mode === 'bend' ? 'aim' : 'bend'; s.zoom = 'hole'; App.ui.hvSheet = null; App.render(); },
  hvRemap() { const h = HoleView.info(); if (!h) return; HoleView.unmap(h); HoleView.s.from = null; HoleView.s.target = undefined; App.ui.hvSheet = null; App.render(); },
  hvPlacePick(el) {
    const r = (App.ui.hvPlaces || [])[+el.dataset.i], h = HoleView.info(); if (!r || !h) return;
    h.c.geo = { lat: r.lat, lon: r.lon }; App.ui.hvPlaces = null; HoleView.s.setupView = null; Store.save(); App.render();
  },
  hvPlaceMe() { App.locate(p => { const h = HoleView.info(); if (!h) return; h.c.geo = CourseMap.pt(p); HoleView.s.setupView = null; Store.save(); App.render(); }); },
  hvGlance() { App.ui.hvGlance = !App.ui.hvGlance; App.ui.hvSheet = null; App.render(); },
  hvPinMode() { const s = HoleView.s; s.mode = s.mode === 'pin' ? 'aim' : 'pin'; if (s.mode === 'pin') s.zoom = 'green'; App.ui.hvSheet = null; App.render(); },
  hvPinHere() {
    App.locate(p => { const h = HoleView.info(); if (!h) return; if (h.green && yardsBetween(p, h.green) > 45) { App.toast('You need to be on the green to mark the flag'); return; } HoleView.setPin(p); App.ui.hvSheet = null; App.render(); App.toast('Flag saved for this hole'); });
  },
  hvPinClear() { HoleView.setPin(null); App.ui.hvSheet = null; App.render(); },
  hvTipHide() { const h = HoleView.info(); if (h) HoleView.s.tipHidden[h.c.id + ':' + h.n] = true; App.render(); },
  hvLie(el) {
    const lr = App.state.liveRound, gps = App.ui.gps || {}; if (!lr) return;
    lr.holes.forEach(h => (h.shots || []).forEach(s => { if (s.id === gps.lastShot) s.toLie = el.dataset.v; }));
    gps.lastLie = el.dataset.v; Store.save(); App.ui.hvSheet = null; App.render();
  },
  async hvDownload() {
    const h = HoleView.info(); if (!h) return;
    App.ui.dl = { running: true, done: 0, total: Offline.urls(h.c).length, fail: 0 }; App.render();
    try {
      const res = await Offline.download(h.c, (done, total, fail) => {
        Object.assign(App.ui.dl, { done, total, fail });
        const bar = document.getElementById('dlBar'), txt = document.getElementById('dlText');
        if (bar) bar.style.width = Math.round(100 * done / total) + '%'; if (txt) txt.textContent = `Saving ${done} of ${total} map tiles…`;
      });
      App.toast(res.fail ? `Saved ${res.total - res.fail} of ${res.total} map tiles. Try again on better signal for the rest.` : 'Course saved for offline use');
    } catch (e) { App.toast(e.message || 'Could not save the maps'); }
    App.ui.dl = null; App.render();
  },
  hvZoom() { HoleView.s.zoom = HoleView.s.zoom === 'green' ? 'hole' : 'green'; App.render(); },
  hvLocate() { App.locate(p => { App._lastPos = p; App._lastPosAt = Date.now(); const h = HoleView.info();
    if (h && HoleView.needsSetup(h)) { HoleView.map.setView([p.lat, p.lon], 17); return; } if (h && !(HoleView.ball(h) || {}).gps) App.toast('You’re not on this hole, so distances are from the tee'); HoleView.s.target = undefined; HoleView.layout(); HoleView.overlay(); }); },
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

Object.assign(Changes, {
  hvAutoHole(el) { App.state.settings.autoHole = el.checked; Store.save(); },
});

Object.assign(Forms, {
  /* Find a course's location by name (OpenStreetMap's free place search). */
  async hvPlace(form, v) {
    const q = (v.q || '').trim(); if (q.length < 3) return;
    App.ui.hvPlaceQ = q;
    try {
      const res = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=' + encodeURIComponent(q), { headers: { Accept: 'application/json' } }).then(r => r.json());
      App.ui.hvPlaces = (res || []).map(r => { const parts = String(r.display_name || '').split(', '); return { name: parts[0], detail: parts.slice(1, 4).join(', '), lat: +r.lat, lon: +r.lon }; });
    } catch (e) { App.toast(navigator.onLine ? 'Place search is busy. Try again in a moment.' : 'You are offline.'); return; }
    App.render();
  },
});
