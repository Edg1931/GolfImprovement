/* Range mode: log range shots by tapping where each ball finished: on the satellite photo of the range
   (no yardage signs needed: your phone knows where you're standing), on a target pad (distance up and
   down, left and right across), or by typing the numbers. They feed the same shot pattern as on-course GPS
   shots, at half weight, since range balls and mats aren't quite the course. Finishing the session adds
   it to the practice log. */

const Range = {
  SPAN_Y: 45, SPAN_X: 40,   // the pad covers typical ±45 yds deep and ±40 yds wide
  ui() {
    if (!App.ui.rng) App.ui.rng = { id: uid(), club: (App.state.clubs.find(c => c.club === '7i') || App.state.clubs[0] || {}).club, unit: 'carry', balls: true, start: Date.now(), view: 'map', bay: null, aim: null, setting: null };
    return App.ui.rng;
  },
  model(club) {
    const c = App.state.clubs.find(x => x.club === club); if (!c) return null;
    return Caddie.clubModel(c.club, c.carry, (App.state.shotLog || []).filter(s => s.club === c.club), App.index());
  },
  /* On-course total distance for a reading: carry readings get the club's normal roll; range balls fly about 5% short. */
  toTotal(read, club, r) { const roll = Caddie.prior(club, 100).along / 100; return read * (r.unit === 'carry' ? roll : 1) * (r.balls ? 1.05 : 1); },
  toRead(total, club, r) { const roll = Caddie.prior(club, 100).along / 100; return total / (r.unit === 'carry' ? roll : 1) / (r.balls ? 1.05 : 1); },
  session(r) { return (App.state.shotLog || []).filter(s => s.source === 'range' && s.session === r.id); },
  add(read, lat) {
    const r = this.ui(); if (!r.club || !(read > 0)) return;
    // on the map, keep where the ball finished so it can be drawn
    let pt = null;
    if (r.view === 'map' && r.bay && r.aim) { const proj = Caddie.projector(r.bay), a = proj.toXY(r.aim), L0 = Math.hypot(a.x, a.y) || 1, u = { x: a.x / L0, y: a.y / L0 }; pt = CourseMap.pt(proj.toLL({ x: u.x * read + u.y * lat, y: u.y * read - u.x * lat })); }
    App.state.shotLog.push({ id: uid(), date: todayISO(), club: r.club, source: 'range', session: r.id, read: Math.round(read), yards: Math.round(read), along: Math.round(this.toTotal(read, r.club, r)), lat: Math.round(lat * 10) / 10, pt });
    Store.save(); App.render();
  },

  /* The pad: the target line up the middle, the club's typical distance across, your shots and pattern. */
  draw(canvas) {
    const r = this.ui(), m = this.model(r.club); if (!m) return;
    const { ctx, w, h, colors } = Charts._prep(canvas);
    const mid = this.toRead(m.along, r.club, r), Y0 = mid - this.SPAN_Y, Y1 = mid + this.SPAN_Y;
    const X = v => w / 2 + v / this.SPAN_X * (w / 2 - 14), Y = v => h - 14 - (v - Y0) / (Y1 - Y0) * (h - 28);
    this.map = { mid, X, Y, w, h, Y0, Y1 };
    ctx.fillStyle = colors.surface2 || 'rgba(0,0,0,0.03)';
    ctx.strokeStyle = colors.grid; ctx.lineWidth = 1; ctx.font = '500 11px Inter, system-ui, sans-serif'; ctx.fillStyle = colors.text;
    for (let v = Math.ceil(Y0 / 10) * 10; v <= Y1; v += 10) { ctx.beginPath(); ctx.moveTo(8, Y(v)); ctx.lineTo(w - 8, Y(v)); ctx.stroke(); ctx.textAlign = 'left'; ctx.fillText(v + (r.unit === 'carry' ? ' carry' : ' yds'), 10, Y(v) - 3); }
    for (let v = -30; v <= 30; v += 10) { if (!v) continue; ctx.beginPath(); ctx.setLineDash([2, 5]); ctx.moveTo(X(v), 8); ctx.lineTo(X(v), h - 8); ctx.stroke(); ctx.setLineDash([]); ctx.textAlign = 'center'; ctx.fillText(Math.abs(v) + (v < 0 ? ' L' : ' R'), X(v), h - 3); }
    ctx.strokeStyle = colors.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(0), 8); ctx.lineTo(X(0), h - 16); ctx.stroke();
    // learned pattern for this club (about 3 in 4 shots), in the same units as the pad
    const k = 1.665, scale = this.toRead(100, r.club, r) / 100;
    ctx.beginPath(); ctx.ellipse(X(m.lat), Y(this.toRead(m.along, r.club, r)), Math.abs(X(m.latSD * k) - X(0)), Math.abs(Y(mid + m.alongSD * k * scale) - Y(mid)), 0, 0, Math.PI * 2);
    ctx.fillStyle = Charts._alpha(colors.gold, 0.14); ctx.fill(); ctx.strokeStyle = colors.gold; ctx.lineWidth = 1.5; ctx.stroke();
    const shots = this.session(r).filter(s => s.club === r.club);
    shots.forEach((s, i) => {
      const last = i === shots.length - 1;
      ctx.beginPath(); ctx.arc(X(Math.max(-this.SPAN_X, Math.min(this.SPAN_X, s.lat))), Y(Math.max(Y0, Math.min(Y1, s.read))), last ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = last ? colors.red || '#c2473a' : colors.accent; ctx.fill(); ctx.strokeStyle = colors.surface; ctx.lineWidth = 2; ctx.stroke();
    });
  },
  /* Where a tap on the pad lands, in yards. */
  fromPad(x, y) {
    const p = this.map; if (!p) return null;
    const lat = (x - p.w / 2) / (p.w / 2 - 14) * this.SPAN_X;
    const read = p.Y0 + (p.h - 14 - y) / (p.h - 28) * (p.Y1 - p.Y0);
    return { read, lat };
  },

  /* ---------- the map: the range from above ---------- */
  lmap: null, el: null, layer: null,
  ensureMap() {
    if (this.lmap || typeof L === 'undefined') return !!this.lmap;
    this.el = document.createElement('div'); this.el.className = 'rng-map';
    Object.assign(this.el.style, { position: 'absolute', inset: '0' });   // before Leaflet, which otherwise makes it relative (zero height)
    this.lmap = L.map(this.el, { zoomControl: false, attributionControl: false, maxZoom: 20, zoomSnap: 0.5 });
    L.tileLayer(ESRI_TILES, { maxZoom: 20, maxNativeZoom: 19, crossOrigin: true }).addTo(this.lmap);
    this.layer = L.layerGroup().addTo(this.lmap);
    this.lmap.on('click', e => this.tap({ lat: e.latlng.lat, lon: e.latlng.lng }));
    return true;
  },
  mountMap() {
    const slot = document.getElementById('rangeMapSlot'); if (!slot || !this.ensureMap()) return;
    slot.prepend(this.el);
    const r = this.ui();
    setTimeout(() => {
      this.lmap.invalidateSize();
      if (!this._centered) {
        const p = r.bay || App._lastPos || (App.state.courses.find(c => c.geo) || {}).geo;
        if (p) { this.lmap.setView([p.lat, p.lon], 17.5); this._centered = true; } else this.lmap.setView([39.5, -98.35], 4);
      }
      this.drawMap();
    }, 0);
    // where you're hitting from: your phone's position, once
    if (!r.bay && !this._locating) {
      this._locating = true;
      const got = pos => { this._locating = false; if (r.bay || !pos) return; r.bay = CourseMap.pt(pos); this.lmap.setView([pos.lat, pos.lon], 17.5); this._centered = true; this.drawMap(); if (App.route() === 'range') App.render(); };
      if (App._lastPos && Date.now() - (App._lastPosAt || 0) < 60000) got(App._lastPos);
      else if (navigator.geolocation) navigator.geolocation.getCurrentPosition(p => got({ lat: p.coords.latitude, lon: p.coords.longitude }), () => { this._locating = false; }, { enableHighAccuracy: true, timeout: 15000 });   // quietly: you can also tap your spot
    }
  },
  /* A tap: your spot, then the target, then where each ball finished. */
  tap(p) {
    const r = this.ui(); p = CourseMap.pt(p);
    if (!r.bay || r.setting === 'bay') { r.bay = p; r.setting = null; }
    else if (!r.aim || r.setting === 'aim') { r.aim = p; r.setting = null; }
    else {
      const proj = Caddie.projector(r.bay), o = Caddie.offsets({ x: 0, y: 0 }, proj.toXY(r.aim), proj.toXY(p));
      if (o.along < 5) { App.toast('Tap past your spot, where the ball finished'); return; }
      this.add(o.along, o.lat); return;
    }
    App.render();
  },
  drawMap() {
    if (!this.lmap) return; const r = this.ui(); this.layer.clearLayers();
    const ll = p => [p.lat, p.lon], tag = (p, html, cls) => L.marker(ll(p), { interactive: false, icon: L.divIcon({ className: 'rng-tag ' + (cls || ''), html, iconSize: null }) }).addTo(this.layer);
    if (!r.bay) return;
    const proj = Caddie.projector(r.bay), dir = r.aim ? proj.toXY(r.aim) : { x: 0, y: 1 }, Ld = Math.hypot(dir.x, dir.y) || 1, u = { x: dir.x / Ld, y: dir.y / Ld };
    // distance rings every 50 yds, labelled along the target line
    for (let d = 50; d <= 300; d += 50) {
      L.circle(ll(r.bay), { radius: d * 0.9144, color: '#fff', weight: 1, opacity: 0.55, fill: false, dashArray: d % 100 ? '3 6' : null, interactive: false }).addTo(this.layer);
      tag(proj.toLL({ x: u.x * d + u.y * 6, y: u.y * d - u.x * 6 }), `<span>${d}</span>`, 'ring');
    }
    if (r.aim) {
      L.polyline([ll(r.bay), ll(proj.toLL({ x: u.x * 320, y: u.y * 320 }))], { color: '#f4e8c3', weight: 2, dashArray: '6 6', interactive: false }).addTo(this.layer);
      L.circleMarker(ll(r.aim), { radius: 9, color: '#f4e8c3', weight: 3, fill: false, interactive: false }).addTo(this.layer);
      tag(r.aim, `<span>${Math.round(yardsBetween(r.bay, r.aim))} yds</span>`, 'aim');
    }
    // this session's balls: this club solid, the latest in red
    const shots = this.session(r).filter(s => s.pt);
    shots.forEach((s, i) => {
      const mine = s.club === r.club, last = i === shots.length - 1;
      L.circleMarker(ll(s.pt), { radius: last ? 7 : 5, color: '#fff', weight: 2, fillColor: last ? '#c2473a' : mine ? '#1d5c41' : '#8a8f8b', fillOpacity: mine ? 1 : 0.6, interactive: false }).addTo(this.layer);
    });
    L.circleMarker(ll(r.bay), { radius: 8, color: '#fff', weight: 3, fillColor: '#3b8cff', fillOpacity: 1, interactive: false }).addTo(this.layer);
  },

  /* Per-club summary of this session. */
  summary(r) {
    const by = {};
    this.session(r).forEach(s => { (by[s.club] = by[s.club] || []).push(s); });
    return Object.entries(by).map(([club, ss]) => {
      const avg = ss.reduce((a, s) => a + s.read, 0) / ss.length, lat = ss.reduce((a, s) => a + s.lat, 0) / ss.length;
      const sd = Math.sqrt(ss.reduce((a, s) => a + (s.lat - lat) ** 2, 0) / ss.length);
      return { club, n: ss.length, avg, lat, sd };
    });
  },
};

Views.range = function () {
  const r = Range.ui(), m = Range.model(r.club), sum = Range.summary(r), onMap = r.view === 'map';
  App.after(() => {
    if (onMap) { Range.mountMap(); return; }
    const cv = document.getElementById('rangePad'); if (!cv) return;
    Range.draw(cv);
    cv.onclick = e => { const b = cv.getBoundingClientRect(), p = Range.fromPad(e.clientX - b.left, e.clientY - b.top); if (p) Range.add(p.read, p.lat); };
  });
  const seg = (k, opts) => `<div class="seg">${opts.map(([v, l]) => `<button class="${String(r[k]) === String(v) ? 'active' : ''}" data-action="rangeSet" data-k="${k}" data-v="${v}">${l}</button>`).join('')}</div>`;
  const shots = Range.session(r);
  const step = !r.bay || r.setting === 'bay' ? 'Tap where you’re hitting from (or wait for your position)'
    : !r.aim || r.setting === 'aim' ? 'Tap the flag or target you’re aiming at'
    : `After each shot, tap where the ball ${r.unit === 'carry' ? 'landed' : 'stopped'}`;
  const pad = onMap
    ? `<div class="rng-step"><b>${escapeHtml(step)}</b>${r.bay && r.aim ? `<span>Target ${Math.round(yardsBetween(r.bay, r.aim))} yds · rings every 50 yds</span>` : ''}</div>
      <div class="rng-slot" id="rangeMapSlot"></div>
      <div class="btn-row mt"><button class="btn sm ${r.setting === 'bay' ? 'primary' : ''}" data-action="rangeSet" data-k="setting" data-v="bay">Move my spot</button><button class="btn sm ${r.setting === 'aim' ? 'primary' : ''}" data-action="rangeSet" data-k="setting" data-v="aim" ${r.bay ? '' : 'disabled'}>Change target</button><button class="btn sm ghost" data-action="rangeUndo" ${shots.length ? '' : 'disabled'}>Undo</button></div>
      <p class="tiny muted mt mb0">No yardage signs needed: distances come from where you’re standing. Zoom in so you can see the balls on the photo.</p>`
    : `<canvas id="rangePad" class="range-pad" aria-label="Target pad: tap where the ball finished"></canvas>
      <div class="row-between mt"><span class="small muted">${m ? `Centre: your usual ${escapeHtml(r.club)} (${Math.round(Range.toRead(m.along, r.club, r))} ${r.unit}). Gold ring: your pattern so far.` : ''}</span><button class="btn sm ghost" data-action="rangeUndo" ${shots.length ? '' : 'disabled'}>Undo</button></div>
      <form class="form range-type mt" data-form="rangeShot"><div class="form-row"><div class="field"><label>Or type it: ${r.unit} (yds)</label><input type="number" name="read" inputmode="numeric" min="1" max="400" required></div><div class="field"><label>Miss (yds, − left / + right)</label><input type="number" name="lat" inputmode="numeric" value="0"></div></div><button class="btn" type="submit">Add shot</button></form>`;
  return `<div class="page-head"><div><h1>Range mode</h1><p class="muted">Pick a club, hit, and tap where the ball finished.</p></div></div>
  <div class="grid grid-2">
    <div class="card"><div class="field mb"><label>Distances from</label>${seg('view', [['map', 'Satellite map'], ['pad', 'Yardage signs']])}</div>
      <div class="chip-row mb">${App.state.clubs.map(c => `<button class="chip ${r.club === c.club ? 'active' : ''}" data-action="rangeClub" data-club="${escapeHtml(c.club)}">${escapeHtml(c.club)}</button>`).join('')}</div>
      <div class="form-row range-opts"><div class="field"><label>${onMap ? 'I tap where it' : 'I’m reading'}</label>${seg('unit', onMap ? [['carry', 'Landed'], ['total', 'Stopped']] : [['carry', 'Carry'], ['total', 'Total']])}</div><div class="field"><label>Balls</label>${seg('balls', [['true', 'Range balls'], ['false', 'Real balls']])}</div></div>
      ${pad}
    </div>
    <div class="card"><div class="card-head"><h3>This session</h3><span class="small muted">${shots.length} ball${shots.length === 1 ? '' : 's'} · ${Math.max(1, Math.round((Date.now() - r.start) / 60000))} min</span></div>
      ${sum.length ? `<div class="table-wrap"><table><thead><tr><th>Club</th><th class="num">Balls</th><th class="num">Avg ${r.unit}</th><th class="num">Avg miss</th><th class="num">Spread</th></tr></thead><tbody>
        ${sum.map(x => `<tr><td><strong>${escapeHtml(x.club)}</strong></td><td class="num">${x.n}</td><td class="num">${Math.round(x.avg)}</td><td class="num">${Math.abs(x.lat) < 1.5 ? 'straight' : Math.abs(Math.round(x.lat)) + (x.lat > 0 ? ' R' : ' L')}</td><td class="num">±${Math.round(x.sd * 1.665)}</td></tr>`).join('')}</tbody></table></div>` : `<p class="small muted">No balls yet. ${onMap ? 'Tap the map where each ball finishes.' : 'Tap the pad after each shot.'}</p>`}
      <div class="btn-row mt"><button class="btn primary" data-action="rangeFinish" ${shots.length ? '' : 'disabled'}>Finish session</button><a class="btn ghost" href="#/clubs">My Clubs ›</a></div>
      <p class="tiny muted mt mb0">Range shots count half as much as shots on the course. Real balls on grass are best; range balls usually fly about 5% short, which is allowed for.</p></div>
  </div>`;
};

Object.assign(Actions, {
  rangeClub(el) { Range.ui().club = el.dataset.club; App.render(); },
  rangeSet(el) {
    const r = Range.ui(), k = el.dataset.k;
    r[k] = k === 'balls' ? el.dataset.v === 'true' : k === 'setting' && r.setting === el.dataset.v ? null : el.dataset.v;
    App.render();
  },
  rangeUndo() {
    const r = Range.ui(), ss = Range.session(r); if (!ss.length) return;
    const last = ss[ss.length - 1]; App.state.shotLog = App.state.shotLog.filter(s => s.id !== last.id); Store.tombstone(last.id); Store.save(); App.render();
  },
  rangeFinish() {
    const r = Range.ui(), sum = Range.summary(r); if (!sum.length) return;
    const minutes = Math.max(5, Math.round((Date.now() - r.start) / 60000));
    App.state.sessions.push({ id: uid(), date: todayISO(), minutes, type: 'fullswing', drills: [],
      notes: 'Range mode: ' + sum.map(x => `${x.club} ×${x.n} (${Math.round(x.avg)} ${r.unit}${Math.abs(x.lat) >= 1.5 ? ', ' + Math.abs(Math.round(x.lat)) + (x.lat > 0 ? ' R' : ' L') : ''})`).join(', ') });
    App.ui.rng = null; Store.save(); location.hash = '#/clubs'; App.render();
    const balls = sum.reduce((a, x) => a + x.n, 0); App.toast(`Range session saved: ${balls} ball${balls === 1 ? '' : 's'}, ${minutes} min`);
  },
});
Object.assign(Forms, {
  rangeShot(form, v) { const read = parseFloat(v.read), lat = parseFloat(v.lat) || 0; if (read > 0) Range.add(read, lat); },
});
