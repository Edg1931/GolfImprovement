/* Hole map, shot planner and caddie. Uses Leaflet with Esri World Imagery.
   The Leaflet map lives in one persistent element that is moved into each render of the page,
   so taps and overlays don't rebuild the map. */

const ESRI_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTR = 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community';
const FEATURE_STYLE = {
  green: { color: '#7ee08f', fillColor: '#57c26f', fillOpacity: 0.35, weight: 1.5 },
  tee: { color: '#b8f0b8', fillColor: '#8fd18f', fillOpacity: 0.25, weight: 1 },
  fairway: { color: '#c8f2a8', fillColor: '#9bd48a', fillOpacity: 0.12, weight: 1 },
  bunker: { color: '#fff1c4', fillColor: '#f3e3b1', fillOpacity: 0.55, weight: 1 },
  water: { color: '#8cc4ff', fillColor: '#3a86d6', fillOpacity: 0.4, weight: 1.5 },
  ob: { color: '#ffffff', fillColor: '#ffffff', fillOpacity: 0.08, weight: 2, dashArray: '6 6' },
  trees: { color: '#9fd49f', fillColor: '#2f5b2f', fillOpacity: 0.3, weight: 1 },
};
const DRAW_TYPES = [['bunker', 'Bunker'], ['water', 'Water'], ['ob', 'Out of bounds'], ['trees', 'Trees'], ['green', 'Green'], ['fairway', 'Fairway']];

const Planner = {
  el: null, map: null, layers: null,
  s: { courseId: null, hole: 1, start: null, startMode: 'tee', target: null, recs: null, pick: 0, mode: 'plan', draw: [], drawType: 'bunker', wind: 0, elev: 0, fitted: null },

  course() { return App.state.courses.find(c => c.id === this.s.courseId) || null; },

  ensureMap() {
    if (this.map || typeof L === 'undefined') return !!this.map;
    this.el = document.createElement('div'); this.el.className = 'hole-map'; this.el.id = 'holeMap';
    this.map = L.map(this.el, { zoomControl: true, attributionControl: true, maxZoom: 20, zoomSnap: 0.5, tap: true });
    L.tileLayer(ESRI_TILES, { maxZoom: 20, maxNativeZoom: 19, attribution: ESRI_ATTR, crossOrigin: true }).addTo(this.map);
    this.layers = { features: L.layerGroup().addTo(this.map), plan: L.layerGroup().addTo(this.map), live: L.layerGroup().addTo(this.map) };
    this.map.on('click', e => this.onTap({ lat: e.latlng.lat, lon: e.latlng.lng }));
    this.map.setView([39.5, -98.35], 4);
    return true;
  },

  /* Called after each render of the map page: re-attach the map and redraw. */
  mount() {
    const slot = document.getElementById('mapSlot'); if (!slot || !this.ensureMap()) return;
    slot.appendChild(this.el);
    setTimeout(() => { this.map.invalidateSize(); this.fit(); this.drawAll(); }, 0);
  },

  /* Zoom to the hole (tee to green), or to the course. Only when the hole changes. */
  fit(force) {
    const c = this.course(); const key = (c && c.id) + ':' + this.s.hole;
    if (!force && this.s.fitted === key) return; this.s.fitted = key;
    if (!c) return;
    const h = c.map && c.map.holes[this.s.hole];
    const pts = h ? [h.tee, h.green, ...(h.line || [])].filter(Boolean) : [];
    const pins = c.greens && c.greens[this.s.hole - 1];
    if (pins && pins.center) pts.push(pins.center);
    const now = { animate: false };   // snap to the new hole
    if (pts.length >= 2) this.map.fitBounds(pts.map(p => [p.lat, p.lon]), { padding: [30, 30], maxZoom: 18, animate: false });
    else if (pts.length === 1) this.map.setView([pts[0].lat, pts[0].lon], 17, now);
    else if (c.map && c.map.center) this.map.setView([c.map.center.lat, c.map.center.lon], 16, now);
    else if (c.geo) this.map.setView([c.geo.lat, c.geo.lon], 16, now);
  },

  holeData() { const c = this.course(); return c && c.map && c.map.holes[this.s.hole] || {}; },
  startPoint() {
    if (this.s.startMode === 'custom' && this.s.start) return this.s.start;
    if (this.s.startMode === 'gps' && App._lastPos) return App._lastPos;
    // while building a plan, the next shot starts where the last one lands (until it reaches the green)
    const plan = this.plan(), last = plan[plan.length - 1];
    const green = this.holeData().green || ((this.course().greens || {})[this.s.hole - 1] || {}).center;
    if (this.s.chain && last && last.land && !(green && yardsBetween(last.land, green) < 25)) return last.land;
    return this.holeData().tee || null;
  },
  plan() { const c = this.course(); return (c && c.plans && c.plans[this.s.hole]) || []; },
  adjust() { return (+this.s.wind || 0) + (+this.s.elev || 0); },

  onTap(p) {
    const c = this.course(); if (!c) return;
    const s = this.s;
    if (s.mode === 'draw') { s.draw.push(p); this.drawAll(); this.renderPanel(); return; }
    if (s.mode === 'tee' || s.mode === 'green') {
      c.map = c.map || { holes: {}, features: [] };
      const h = c.map.holes[s.hole] = c.map.holes[s.hole] || {};
      h[s.mode] = CourseMap.pt(p);
      if (s.mode === 'green') { c.greens = c.greens || {}; const g = c.greens[s.hole - 1]; if (!g || !g.manual) c.greens[s.hole - 1] = Object.assign({}, CourseMap.greenPins(c, s.hole) || { center: h.green }, { fromMap: true }); }
      if (!c.map.center) c.map.center = CourseMap.pt(p);
      Store.save(); App.toast(`${s.mode === 'tee' ? 'Tee' : 'Green'} set for hole ${s.hole}`); s.mode = 'plan'; this.fit(true); this.drawAll(); this.renderPanel(); return;
    }
    if (s.mode === 'start') { s.start = p; s.startMode = 'custom'; s.mode = 'plan'; if (s.target) this.compute(); this.drawAll(); this.renderPanel(); return; }
    s.target = p; s.pick = 0; this.compute(); this.drawAll(); this.renderPanel();
  },

  compute() {
    const c = this.course(), start = this.startPoint(), s = this.s;
    if (!c || !start || !s.target) { s.recs = null; return; }
    const g = CourseMap.holeGeometry(c, s.hole, start);
    const models = Caddie.bagModels(App.state.clubs, App.state.shotLog, App.index());
    const t = g.proj.toXY(s.target);
    const recs = Caddie.recommend(g.start, t, models, { features: g.features, green: g.green }, { adjust: this.adjust(), samples: 250, seed: 11 });
    s.recs = recs.slice(0, 5).map(r => ({ ...r, aimLL: g.proj.toLL(r.aim), ellipseLL: Caddie.ellipse(g.start, r.aim, r.model, this.adjust()).map(g.proj.toLL),
      landLL: g.proj.toLL(Caddie.landing(g.start, r.aim, r.model.along - this.adjust(), r.model.lat)) }));
    s.toTarget = Caddie.dist(g.start, t); s.toGreen = g.green ? Caddie.dist(g.start, g.green) : null;
    s.mapped = g.features.length > 0;
  },

  drawAll() {
    if (!this.map) return;
    const c = this.course(), s = this.s, L_ = this.layers;
    L_.features.clearLayers(); L_.plan.clearLayers();
    if (!c) return;
    const ll = p => [p.lat, p.lon];
    ((c.map && c.map.features) || []).forEach(f => L.polygon(f.ll.map(ll), Object.assign({ interactive: false }, FEATURE_STYLE[f.type] || {})).addTo(L_.features));
    Object.entries((c.map && c.map.holes) || {}).forEach(([n, h]) => {
      const cur = +n === s.hole;
      if (h.line) L.polyline(h.line.map(ll), { color: '#fff', weight: cur ? 2.5 : 1, opacity: cur ? 0.9 : 0.35, dashArray: '4 6', interactive: false }).addTo(L_.features);
      if (h.tee) L.circleMarker(ll(h.tee), { radius: cur ? 6 : 3, color: '#fff', weight: 2, fillColor: '#2a7a52', fillOpacity: 1, interactive: false }).addTo(L_.features);
      if (h.green) L.marker(ll(h.green), { interactive: false, icon: L.divIcon({ className: 'map-flag' + (cur ? ' cur' : ''), html: `<span>${n}</span>`, iconSize: [22, 22], iconAnchor: [4, 20] }) }).addTo(L_.features);
    });
    const pins = c.greens && c.greens[s.hole - 1];
    if (pins && pins.center && !(c.map && c.map.holes[s.hole] && c.map.holes[s.hole].green)) L.marker(ll(pins.center), { interactive: false, icon: L.divIcon({ className: 'map-flag cur', html: `<span>${s.hole}</span>`, iconSize: [22, 22], iconAnchor: [4, 20] }) }).addTo(L_.features);
    // saved plan for this hole
    this.plan().forEach((st, i) => {
      L.polyline([ll(st.start), ll(st.land || st.aim)], { color: '#e6cf85', weight: 3, opacity: 0.9, interactive: false }).addTo(L_.plan);
      L.marker(ll(st.land || st.aim), { interactive: false, icon: L.divIcon({ className: 'map-step', html: `<span>${i + 1}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] }) }).addTo(L_.plan);
    });
    const start = this.startPoint();
    if (start) L.circleMarker(ll(start), { radius: 7, color: '#12352a', weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(L_.plan);
    if (s.recs && s.recs.length && start) {
      s.recs.forEach((r, i) => { if (i !== s.pick && i < 3) L.polygon(r.ellipseLL.map(ll), { color: '#ffffff', weight: 1, opacity: 0.5, fill: false, dashArray: '3 5', interactive: false }).addTo(L_.plan); });
      const r = s.recs[s.pick];
      L.polygon(r.ellipseLL.map(ll), { color: '#e6cf85', weight: 2.5, fillColor: '#e6cf85', fillOpacity: 0.18, interactive: false }).addTo(L_.plan);
      L.polyline([ll(start), ll(r.aimLL)], { color: '#e6cf85', weight: 2, dashArray: '6 6', interactive: false }).addTo(L_.plan);
      L.circleMarker(ll(r.aimLL), { radius: 5, color: '#e6cf85', weight: 2, fillColor: '#12352a', fillOpacity: 1, interactive: false }).addTo(L_.plan);
    }
    if (s.target) L.circleMarker(ll(s.target), { radius: 4, color: '#fff', weight: 1.5, fillColor: '#e2513f', fillOpacity: 1, interactive: false }).addTo(L_.plan);
    if (s.draw.length) L.polyline(s.draw.map(ll).concat(s.draw.length > 2 ? [ll(s.draw[0])] : []), Object.assign({}, FEATURE_STYLE[s.drawType], { interactive: false })).addTo(L_.plan);
  },

  /* Side panel: set-up, targets, club advice, plan, editing. */
  renderPanel() {
    const box = document.getElementById('mapPanel'); if (box) box.innerHTML = this.panelHtml();
  },

  panelHtml() {
    const c = this.course(), s = this.s;
    if (!c) return `<div class="card"><h3>Choose a course</h3><p class="small muted mb0">Pick a course from your library above. Courses come from the course search on the Play page.</p></div>`;
    const mapped = c.map && (c.map.features.length || Object.keys(c.map.holes).length);
    const h = this.holeData(); const i = s.hole - 1;
    const par = c.pars[i], yds = c.yards && c.yards[i];
    let html = '';
    if (!mapped) html += `<div class="card"><h3>Load this course's map</h3>
      <p class="small">Greens, bunkers, water and fairways from OpenStreetMap, where volunteers have mapped the course.</p>
      <div class="btn-row"><button class="btn primary" data-action="mapImportOSM">🗺 Find golf features</button><label class="btn" for="mapFile">⬆ Upload a map file</label></div>
      <p class="tiny muted mt mb0">${c.geo ? 'Searches around the course location.' : 'Pan the map to the course first (or tap “My location” when you’re there), then search.'} Files: GeoJSON or KML from Google Earth. No data? Use the edit tools below to set tees and greens and draw hazards.</p></div>`;
    html += `<div class="card ${mapped ? '' : 'mt'}"><div class="card-head"><h3>Hole ${s.hole}${par ? ' · Par ' + par : ''}${yds ? ' · ' + yds + ' yds' : ''}</h3>${h.tee && h.green ? `<span class="small muted">${Math.round(yardsBetween(h.tee, h.green))} yds tee to green</span>` : ''}</div>
      <div class="seg mb">${[['tee', 'From the tee'], ['gps', 'From my ball'], ['start', 'Move ball']].map(([k, l]) => `<button class="${(k === 'start' ? s.mode === 'start' : s.startMode === k && s.mode !== 'start') ? 'active' : ''}" data-action="mapStart" data-v="${k}">${l}</button>`).join('')}</div>
      ${s.mode === 'start' ? '<p class="small">Tap the map where your ball is.</p>' : !this.startPoint() ? '<p class="small">Set the tee for this hole (edit tools below) or use “From my ball”.</p>' : !s.target ? '<p class="small"><strong>Tap the map where you want to hit it.</strong> Your caddie compares every club.</p>' : ''}
      <div class="form-row plays-like"><div class="field"><label>Wind (mph, + into)</label><input type="number" value="${s.wind}" data-change="mapWind"></div><div class="field"><label>Elevation (yds, + up)</label><input type="number" value="${s.elev}" data-change="mapElev"></div></div>
    </div>`;
    if (s.recs && s.recs.length) {
      const best = s.recs[s.pick];
      const aimTxt = r => !r.aimShift ? 'aim at your target' : `aim ${Math.abs(Math.round(r.aimShift))} yds ${r.aimShift < 0 ? 'left' : 'right'} of it`;
      const pctf = v => Math.round((v || 0) * 100) + '%';
      html += `<div class="card mt caddie-card"><div class="card-head"><h3>Caddie</h3><span class="small muted">${Math.round(s.toTarget)} yds to target${s.toGreen != null ? ' · ' + Math.round(s.toGreen) + ' to green' : ''}${this.adjust() ? ` · plays ${Math.round(s.toTarget + this.adjust())}` : ''}</span></div>
        <div class="caddie-best"><div class="caddie-club ${best.club.length > 3 ? 'long' : ''}">${escapeHtml(best.club)}</div><div><strong>${aimTxt(best)}</strong><div class="small muted">${best.model.learned ? `Your ${escapeHtml(best.club)}: ${Math.round(best.model.along)} yds, misses ${Math.abs(Math.round(best.model.lat))} yds ${best.model.lat >= 0 ? 'right' : 'left'} on average (${best.model.nLat} shots)` : `Estimated from your chart distance (${Math.round(best.model.along)} yds). Track shots to learn your pattern.`}</div></div></div>
        ${s.mapped ? `<div class="risk-row">${[['green', 'Green'], ['fairway', 'Fairway'], ['rough', 'Rough'], ['bunker', 'Sand'], ['water', 'Water'], ['ob', 'OB'], ['trees', 'Trees']].filter(([k]) => best.shares[k]).map(([k, l]) => `<span class="risk ${k}">${l} ${pctf(best.shares[k])}</span>`).join('')}</div>` : '<p class="tiny muted">Load the course map to see hazard risk.</p>'}
        <table class="caddie-table"><thead><tr><th>Club</th>${s.mapped ? '<th class="num">Exp. score</th><th class="num">Green</th><th class="num">Trouble</th>' : '<th class="num">Typical</th><th class="num">vs target</th>'}</tr></thead><tbody>
        ${s.recs.map((r, k) => `<tr class="${k === s.pick ? 'sel' : ''}" data-action="mapPick" data-i="${k}"><td><strong>${escapeHtml(r.club)}</strong>${k === 0 ? ' <span class="badge good">best</span>' : ''}</td>${s.mapped ? `<td class="num">${r.expected.toFixed(2)}</td><td class="num">${pctf(r.shares.green)}</td><td class="num">${pctf((r.shares.water || 0) + (r.shares.ob || 0) + (r.shares.bunker || 0))}</td>` : `<td class="num">${Math.round(r.model.along)}</td><td class="num">${r.gap >= 0 ? '+' : ''}${Math.round(r.gap)}</td>`}</tr>`).join('')}</tbody></table>
        <div class="btn-row mt"><button class="btn primary" data-action="mapAddStep">＋ Add ${escapeHtml(best.club)} to my plan</button><button class="btn ghost sm" data-action="mapClearTarget">Clear</button></div>
        <p class="tiny muted mb0">Expected score = average strokes to hole out from where this club's shots finish. Dashed rings: other clubs. Gold ring: about 3 in 4 of your shots.</p></div>`;
    }
    const plan = this.plan();
    if (plan.length) html += `<div class="card mt"><div class="card-head"><h3>My plan for hole ${s.hole}</h3><button class="btn sm ghost danger" data-action="mapClearPlan">Clear plan</button></div><ol class="plan-list">${plan.map((st, k) => `<li><strong>${escapeHtml(st.club)}</strong> · ${Math.round(yardsBetween(st.start, st.land || st.aim))} yds${st.aimShift ? ` · aim ${Math.abs(Math.round(st.aimShift))} ${st.aimShift < 0 ? 'L' : 'R'}` : ''}${st.expected ? ` <span class="muted small">(${st.expected.toFixed(2)})</span>` : ''}</li>`).join('')}</ol><p class="tiny muted mb0">The next shot starts where this one lands. Your plan shows on the live scorecard for this hole.</p></div>`;
    html += `<details class="accordion mt"${s.mode === 'draw' || s.mode === 'tee' || s.mode === 'green' ? ' open' : ''}><summary>Edit this course's map</summary><div class="acc-body">
      <div class="btn-row"><button class="btn sm ${s.mode === 'tee' ? 'primary' : ''}" data-action="mapMode" data-v="tee">Set tee (tap)</button><button class="btn sm ${s.mode === 'green' ? 'primary' : ''}" data-action="mapMode" data-v="green">Set green centre (tap)</button></div>
      <div class="field mt"><label>Draw a shape</label><div class="btn-row"><select data-change="mapDrawType">${DRAW_TYPES.map(([k, l]) => `<option value="${k}" ${s.drawType === k ? 'selected' : ''}>${l}</option>`).join('')}</select>${s.mode === 'draw' ? `<button class="btn sm primary" data-action="mapDrawFinish" ${s.draw.length >= 3 ? '' : 'disabled'}>Finish (${s.draw.length} pts)</button><button class="btn sm" data-action="mapDrawUndo">Undo point</button><button class="btn sm ghost" data-action="mapMode" data-v="plan">Cancel</button>` : '<button class="btn sm" data-action="mapMode" data-v="draw">Start drawing</button>'}</div></div>
      ${s.mode === 'draw' ? '<p class="tiny muted">Tap around the edge of the shape, then Finish.</p>' : ''}
      <div class="btn-row mt"><button class="btn sm" data-action="mapImportOSM">↻ Reload from OpenStreetMap</button><label class="btn sm" for="mapFile">⬆ Upload GeoJSON / KML</label><button class="btn sm ghost danger" data-action="mapUndoShape" ${(c.map && c.map.features.some(f => f.source === 'manual')) ? '' : 'disabled'}>Remove last drawn shape</button></div>
      <p class="tiny muted mt mb0">${c.map ? `${c.map.features.length} shapes, ${Object.keys(c.map.holes).length} holes mapped${c.map.source ? ' · source: ' + (c.map.source === 'osm' ? 'OpenStreetMap' : c.map.source) : ''}.` : 'Nothing mapped yet.'}</p>
    </div></details>`;
    return html;
  },
};

/* ---------- page ---------- */
Views.map = function () {
  const courses = App.state.courses; const s = Planner.s;
  if (App.ui.plan) { Object.assign(s, App.ui.plan, { target: null, recs: null, mode: 'plan' }); App.ui.plan = null; }
  if (!s.courseId || !courses.some(c => c.id === s.courseId)) s.courseId = courses[0] ? courses[0].id : null;
  const c = Planner.course(); const n = c ? c.pars.length : 18;
  if (s.hole > n) s.hole = 1;
  App.after(() => { Planner.mount(); Planner.renderPanel(); });
  return `<div class="page-head"><div><p class="eyebrow">Caddie</p><h1>Course map &amp; shot planner</h1><p class="muted">Tap where you want to hit it. Your caddie uses your real shot pattern to pick the club and the aim.</p></div>
      <div class="btn-row"><button class="btn sm" data-action="mapMyLocation">📍 My location</button></div></div>
    ${courses.length ? `<div class="map-bar"><select data-change="mapCourse" aria-label="Course">${courses.map(x => `<option value="${x.id}" ${x.id === s.courseId ? 'selected' : ''}>${escapeHtml(x.name)}${x.tees ? ' · ' + escapeHtml(x.tees) : ''}</option>`).join('')}</select>
      <div class="hole-strip light">${[...Array(n)].map((_, k) => `<button class="hole-pill ${k + 1 === s.hole ? 'cur' : ''} ${c && c.map && c.map.holes[k + 1] ? 'mapped' : ''}" data-action="mapHole" data-h="${k + 1}"><small>${k + 1}</small>${c ? c.pars[k] : ''}</button>`).join('')}</div></div>`
      : `<div class="empty">Add a course first: search for it on the <a href="#/play">Play</a> page.</div>`}
    <div class="map-layout mt"><div class="map-slot" id="mapSlot"></div><div class="map-panel" id="mapPanel"></div></div>
    <input type="file" id="mapFile" accept=".geojson,.json,.kml,application/geo+json,application/vnd.google-earth.kml+xml" class="hidden" data-change="mapFile">`;
};

Object.assign(Actions, {
  mapHole(el) { Planner.s.hole = +el.dataset.h; Planner.s.chain = false; Planner.s.target = null; Planner.s.recs = null; Planner.s.startMode = Planner.s.startMode === 'custom' ? 'tee' : Planner.s.startMode; App.render(); },
  mapStart(el) {
    const v = el.dataset.v, s = Planner.s;
    if (v === 'start') { s.mode = 'start'; }
    else if (v === 'gps') { s.mode = 'plan'; App.locate(p => { App._lastPos = p; App._lastPosAt = Date.now(); s.startMode = 'gps'; Planner.map && Planner.map.panTo([p.lat, p.lon]); if (s.target) Planner.compute(); Planner.drawAll(); Planner.renderPanel(); }); return; }
    else { s.startMode = 'tee'; s.chain = false; s.mode = 'plan'; if (s.target) Planner.compute(); }
    Planner.drawAll(); Planner.renderPanel();
  },
  mapPick(el) { Planner.s.pick = +el.dataset.i; Planner.drawAll(); Planner.renderPanel(); },
  mapClearTarget() { Planner.s.target = null; Planner.s.recs = null; Planner.drawAll(); Planner.renderPanel(); },
  mapAddStep() {
    const s = Planner.s, c = Planner.course(), r = s.recs && s.recs[s.pick], start = Planner.startPoint(); if (!c || !r || !start) return;
    c.plans = c.plans || {}; const plan = c.plans[s.hole] = c.plans[s.hole] || [];
    plan.push({ club: r.club, start: CourseMap.pt(start), aim: CourseMap.pt(r.aimLL), land: CourseMap.pt(r.landLL), aimShift: Math.round(r.aimShift || 0), expected: r.expected || null });
    if (s.startMode === 'custom') s.startMode = 'tee';
    s.chain = true; s.target = null; s.recs = null; Store.save(); Planner.drawAll(); Planner.renderPanel();
    App.toast(`Shot ${plan.length} added. Tap the next target.`);
  },
  mapClearPlan() { const c = Planner.course(); if (!c || !c.plans) return; Planner.s.chain = false; delete c.plans[Planner.s.hole]; Store.save(); Planner.drawAll(); Planner.renderPanel(); },
  mapMode(el) { const s = Planner.s; s.mode = el.dataset.v; if (s.mode !== 'draw') s.draw = []; Planner.drawAll(); Planner.renderPanel(); if (s.mode === 'tee' || s.mode === 'green') App.toast(`Tap the map to place the ${s.mode === 'tee' ? 'tee' : 'middle of the green'} for hole ${s.hole}`); },
  mapDrawUndo() { Planner.s.draw.pop(); Planner.drawAll(); Planner.renderPanel(); },
  mapDrawFinish() {
    const s = Planner.s, c = Planner.course(); if (!c || s.draw.length < 3) return;
    c.map = c.map || { holes: {}, features: [] };
    c.map.features.push({ type: s.drawType, ll: s.draw.map(p => CourseMap.pt(p)), source: 'manual' });
    if (!c.map.center) c.map.center = CourseMap.pt(s.draw[0]);
    s.draw = []; s.mode = 'plan'; Store.save(); if (s.target) Planner.compute(); Planner.drawAll(); Planner.renderPanel(); App.toast(FEATURE_LABEL[s.drawType] + ' added');
  },
  mapUndoShape() { const c = Planner.course(); if (!c || !c.map) return; for (let k = c.map.features.length - 1; k >= 0; k--) if (c.map.features[k].source === 'manual') { c.map.features.splice(k, 1); break; } Store.save(); Planner.drawAll(); Planner.renderPanel(); },
  mapMyLocation() { App.locate(p => { App._lastPos = p; App._lastPosAt = Date.now(); Planner.map && Planner.map.setView([p.lat, p.lon], 17); }); },
  async mapImportOSM() {
    const c = Planner.course(); if (!c) return;
    const m = Planner.map; const center = c.geo || (c.map && c.map.center) || (m && m.getZoom() >= 13 ? { lat: m.getCenter().lat, lon: m.getCenter().lng } : null);
    if (!center) { App.toast('Pan the map to the course first, or tap My location when you’re there'); return; }
    App.toast('Looking for golf features…');
    try {
      const data = CourseMap.parseOSM(await CourseMap.fetchOSM(center, 1600));
      if (!data.features.length && !Object.keys(data.holes).length) { App.toast('No golf features are mapped here yet. Use the edit tools to add them.'); return; }
      const res = CourseMap.apply(c, data, 'osm'); if (!c.map.center) c.map.center = CourseMap.pt(center);
      Store.save(); Planner.fit(true); Planner.drawAll(); Planner.renderPanel();
      App.toast(`Loaded ${res.holes} holes and ${res.features} shapes`);
    } catch (e) { App.toast(navigator.onLine ? 'The map service is busy. Try again in a minute.' : 'You are offline.'); }
  },
});

Object.assign(Changes, {
  mapCourse(el) { Planner.s.courseId = el.value; Planner.s.hole = 1; Planner.s.target = null; Planner.s.recs = null; Planner.s.fitted = null; App.render(); },
  mapWind(el) { Planner.s.wind = num(el.value, 0); if (Planner.s.target) { Planner.compute(); Planner.drawAll(); } Planner.renderPanel(); },
  mapElev(el) { Planner.s.elev = num(el.value, 0); if (Planner.s.target) { Planner.compute(); Planner.drawAll(); } Planner.renderPanel(); },
  mapDrawType(el) { Planner.s.drawType = el.value; Planner.drawAll(); },
  mapFile(el) {
    const f = el.files[0]; const c = Planner.course(); if (!f || !c) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const text = String(rd.result);
        const data = /<kml[\s>]/i.test(text) ? CourseMap.parseKML(text) : CourseMap.parseGeoJSON(JSON.parse(text));
        const res = CourseMap.apply(c, data, 'file'); Store.save(); Planner.fit(true); Planner.drawAll(); Planner.renderPanel();
        App.toast(`Imported ${res.holes} holes and ${res.features} shapes`);
      } catch (e) { App.toast(e instanceof SyntaxError ? 'That file isn’t valid GeoJSON or KML.' : e.message); }
      el.value = '';
    };
    rd.readAsText(f);
  },
});

/* ---------- caddie on the live scorecard ---------- */
/* Club advice for the current hole from the player's position (fresh GPS) or the tee. */
function caddieHint(lr) {
  const c = lr.courseId && App.state.courses.find(x => x.id === lr.courseId); if (!c) return null;
  const holeNo = (lr.first || 0) + lr.cur + 1;
  const fresh = App._lastPos && Date.now() - (App._lastPosAt || 0) < 60000;
  const g = CourseMap.holeGeometry(c, holeNo, fresh ? App._lastPos : null);
  if (!g || !g.green) return null;
  const models = Caddie.bagModels(App.state.clubs, App.state.shotLog, App.index());
  const plan = (c.plans && c.plans[holeNo]) || [];
  const d = Caddie.dist(g.start, g.green);
  if (d < 15) return null;
  const recs = Caddie.recommend(g.start, g.green, models, { features: g.features, green: g.green }, { samples: 150, seed: 5 });
  const r = recs[0]; if (!r) return null;
  return { holeNo, from: fresh ? 'your ball' : 'the tee', toGreen: Math.round(d), club: r.club, aimShift: Math.round(r.aimShift || 0), green: r.shares.green || 0, trouble: (r.shares.water || 0) + (r.shares.ob || 0), mapped: g.features.length > 0, reach: r.model.along >= d - 25, leaves: Math.max(0, Math.round(d - r.model.along)), plan };
}
function caddieHintHtml(lr) {
  let h; try { h = caddieHint(lr); } catch (e) { console.warn('caddie', e); return ''; }
  const openBtn = (label) => `<button class="btn sm" data-action="openHoleMap">${label}</button>`;
  if (!h) return lr.courseId ? `<div class="caddie-mini"><span class="small muted">Map this hole for club advice.</span>${openBtn('🗺 Map')}</div>` : '';
  const plan = h.plan.length ? `<div class="tiny muted">Your plan: ${h.plan.map(p => escapeHtml(p.club)).join(' → ')}</div>` : '';
  return `<div class="caddie-mini"><div><div class="entry-label">Caddie · ${h.toGreen} yds to green from ${h.from}</div>
    <strong>${escapeHtml(h.club)}</strong>${h.aimShift ? ` · aim ${Math.abs(h.aimShift)} yds ${h.aimShift < 0 ? 'left' : 'right'}` : ''}${h.mapped ? ` <span class="small muted">· ${h.reach ? Math.round(h.green * 100) + '% green' : 'leaves about ' + h.leaves + ' yds'}${h.trouble >= 0.05 ? ` · ${Math.round(h.trouble * 100)}% trouble` : ''}</span>` : ''}${plan}</div>${openBtn('🗺 Plan')}</div>`;
}
Actions.openCourseMap = function (el) { App.ui.plan = { courseId: el.dataset.id, hole: 1, startMode: 'tee', fitted: null }; location.hash = '#/map'; };
Actions.openHoleMap = function () {
  const lr = App.state.liveRound; if (!lr || !lr.courseId) return;
  const fresh = App._lastPos && Date.now() - (App._lastPosAt || 0) < 60000;
  App.ui.plan = { courseId: lr.courseId, hole: (lr.first || 0) + lr.cur + 1, startMode: fresh ? 'gps' : 'tee', fitted: null };
  location.hash = '#/map';
};

/* ---------- learning dispersion from GPS shots ---------- */
/* What the player was aiming at for a shot from `start`: their plan, the green, or down the hole. */
function shotTarget(course, holeNo, start, club) {
  if (!course) return null;
  const plan = (course.plans && course.plans[holeNo]) || [];
  const step = plan.find(p => p.club === club && yardsBetween(p.start, start) < 35);
  if (step) return step.aim;
  const g = CourseMap.holeGeometry(course, holeNo, start); if (!g) return null;
  const model = Caddie.clubModel(club, (App.state.clubs.find(c => c.club === club) || { carry: 150 }).carry, [], App.index());
  if (g.green && Caddie.dist(g.start, g.green) <= model.along + 40) return g.proj.toLL(g.green);
  if (g.line && g.line.length >= 2) {
    // follow the hole's line of play: the point on it about one club-length from the ball
    let bestI = 0, bd = Infinity; const pts = [];
    for (let d = 0, total = g.line.reduce((s, p, k) => s + (k ? Caddie.dist(g.line[k - 1], p) : 0), 0); d <= total; d += 5) pts.push(Caddie.alongPolyline(g.line, d));
    pts.forEach((p, k) => { const dd = Caddie.dist(p, g.start); if (dd < bd) { bd = dd; bestI = k; } });
    let pick = null, pd = Infinity;
    pts.slice(bestI).forEach(p => { const e = Math.abs(Caddie.dist(p, g.start) - model.along); if (e < pd) { pd = e; pick = p; } });
    return pick ? g.proj.toLL(pick) : null;
  }
  return null;
}
/* Distance and sideways miss of a finished shot relative to what the player aimed at. */
function measureShot(course, holeNo, club, start, end) {
  const target = shotTarget(course, holeNo, start, club);
  const proj = Caddie.projector(start), e = proj.toXY(end);
  if (!target) return { along: Math.round(Math.hypot(e.x, e.y)), lat: null };
  const o = Caddie.offsets({ x: 0, y: 0 }, proj.toXY(target), e);
  return { along: Math.round(o.along), lat: Math.round(o.lat * 10) / 10 };
}

/* ---------- dispersion on My Clubs ---------- */
function dispersionCard() {
  const models = Caddie.bagModels(App.state.clubs, App.state.shotLog, App.index());
  if (!models.length) return '';
  const sel = App.ui.dispClub && models.some(m => m.club === App.ui.dispClub) ? App.ui.dispClub : (models.find(m => m.learned) || models.find(m => m.kind !== 'driver' && /7/.test(m.club)) || models[0]).club;
  const m = models.find(x => x.club === sel);
  const shots = (App.state.shotLog || []).filter(s => s.club === sel && s.lat != null);
  App.after(() => { const cv = document.getElementById('dispChart'); if (cv) drawDispersion(cv, m, shots); });
  const w = v => Math.round(v * 1.665);
  return `<div class="card mt"><div class="card-head"><h2>Shot dispersion</h2><a class="small" href="#/map">Plan a hole ›</a></div>
    <p class="small muted">Learned from GPS shots on the live scorecard. Until a club has 3 tracked shots, the pattern is estimated from your chart distance and handicap.</p>
    <div class="chip-row mb">${models.map(x => `<button class="chip ${x.club === sel ? 'active' : ''}" data-action="dispClub" data-club="${escapeHtml(x.club)}">${escapeHtml(x.club)}${x.learned ? ' ✓' : ''}</button>`).join('')}</div>
    <div class="grid grid-2"><div><canvas id="dispChart" class="chart tall"></canvas></div>
    <div><div class="stat-row">${statBox('Typical', Math.round(m.along) + ' yds', m.n ? m.n + ' GPS shots' : 'estimate')}${statBox('Average miss', Math.abs(m.lat) < 1 ? 'Straight' : Math.abs(Math.round(m.lat)) + ' yds ' + (m.lat > 0 ? 'R' : 'L'), m.learned ? 'learned' : 'estimate')}${statBox('Width', '±' + w(m.latSD) + ' yds', '3 in 4 shots')}${statBox('Depth', '±' + w(m.alongSD) + ' yds', 'short / long')}</div>
      <p class="small mt mb0">${m.learned ? (Math.abs(m.lat) >= 4 ? `Your ${escapeHtml(sel)} leaks ${m.lat > 0 ? 'right' : 'left'}: the caddie aims you ${Math.abs(Math.round(m.lat))} yds ${m.lat > 0 ? 'left' : 'right'} to compensate.` : `Your ${escapeHtml(sel)} is centred on your target. Good.`) : 'Track a few shots with this club on the course and this becomes your real pattern.'}</p></div></div>
    <div class="table-wrap mt"><table><thead><tr><th>Club</th><th class="num">Shots</th><th class="num">Typical</th><th class="num">Avg miss</th><th class="num">Width</th><th></th></tr></thead><tbody>
    ${models.map(x => `<tr><td><strong>${escapeHtml(x.club)}</strong></td><td class="num">${x.nLat}</td><td class="num">${Math.round(x.along)}</td><td class="num">${Math.abs(x.lat) < 1 ? '—' : Math.abs(Math.round(x.lat)) + (x.lat > 0 ? ' R' : ' L')}</td><td class="num">±${w(x.latSD)}</td><td>${x.learned ? '<span class="badge good">learned</span>' : '<span class="badge neutral">estimate</span>'}</td></tr>`).join('')}</tbody></table></div></div>`;
}
Actions.dispClub = function (el) { App.ui.dispClub = el.dataset.club; App.render(); };

/* Scatter of shots around the target line (x: left/right, y: distance) with the learned ellipse. */
function drawDispersion(canvas, m, shots) {
  const { ctx, w, h, colors } = Charts._prep(canvas);
  const k = 1.665, span = Math.max(25, Math.abs(m.lat) + m.latSD * k * 1.4, ...shots.map(s => Math.abs(s.lat) + 5));
  const dmin = Math.min(m.along - m.alongSD * k * 1.4, ...shots.map(s => s.along - 5)), dmax = Math.max(m.along + m.alongSD * k * 1.4, ...shots.map(s => s.along + 5));
  const X = v => w / 2 + v / span * (w / 2 - 20), Y = v => h - 24 - (v - dmin) / (dmax - dmin) * (h - 40);
  ctx.strokeStyle = colors.grid; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(X(0), 8); ctx.lineTo(X(0), h - 24); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = colors.text; ctx.font = '500 11px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('target line', X(0), h - 8); ctx.textAlign = 'left'; ctx.fillText('← left', 6, h - 8); ctx.textAlign = 'right'; ctx.fillText('right →', w - 6, h - 8);
  ctx.textAlign = 'left'; [Math.round(dmin / 10) * 10 + 10, Math.round(m.along / 10) * 10, Math.round(dmax / 10) * 10 - 10].forEach(v => { ctx.fillText(v + ' yds', 4, Y(v) + 4); });
  ctx.beginPath(); ctx.ellipse(X(m.lat), Y(m.along), Math.abs(X(m.latSD * k) - X(0)), Math.abs(Y(m.along + m.alongSD * k) - Y(m.along)), 0, 0, Math.PI * 2);
  ctx.fillStyle = Charts._alpha(colors.gold, 0.18); ctx.fill(); ctx.strokeStyle = colors.gold; ctx.lineWidth = 2; ctx.stroke();
  shots.forEach(s => { ctx.beginPath(); ctx.arc(X(s.lat), Y(s.along), 4, 0, Math.PI * 2); ctx.fillStyle = colors.accent; ctx.fill(); ctx.strokeStyle = colors.surface; ctx.lineWidth = 1.5; ctx.stroke(); });
  ctx.beginPath(); ctx.arc(X(m.lat), Y(m.along), 3, 0, Math.PI * 2); ctx.fillStyle = colors.gold; ctx.fill();
}
