/* Rangefinder, two ways.
   Map: tap anywhere on the satellite map for the distance from you (GPS), or between two points, with
   plays-like from live wind and slope.
   Camera: point the phone at the flag and line up two markers with the top and bottom of the flagstick.
   A flagstick is a known height (7 ft on most courses), so its size in the picture gives the distance:
   distance = height × focal length ÷ size in pixels. The focal length starts from a typical phone main
   camera and can be calibrated once against something at a known distance. */

const FLAG_FT = [[7, '7 ft (standard)'], [8, '8 ft'], [6, '6 ft'], [5.8, 'Person 5′10″']];
const DEFAULT_K = 0.72;   // focal length ÷ long side of the picture for a ~26 mm-equivalent main camera

/* Distance in yards to an object of height `ft` that spans `span` screen pixels in the camera view. */
function cameraYards(o) {
  const cover = Math.max(o.ew / o.vw, o.eh / o.vh) * (o.zoom || 1);   // screen px per video px
  const spanVideo = Math.abs(o.span) / cover;
  if (!(spanVideo > 0.5)) return null;
  const f = (o.k || DEFAULT_K) * Math.max(o.vw, o.vh);
  return (o.ft * 0.3048) * f / spanVideo / 0.9144;
}
/* The focal factor that makes a known object at a known distance measure right. */
function cameraK(o) {
  const cover = Math.max(o.ew / o.vw, o.eh / o.vh) * (o.zoom || 1);
  const spanVideo = Math.abs(o.span) / cover;
  return (o.yards * 0.9144) * spanVideo / ((o.ft * 0.3048) * Math.max(o.vw, o.vh));
}

const Finder = {
  map: null, el: null, layer: null, stream: null,
  ui() {
    if (!App.ui.rf) App.ui.rf = { mode: 'map', p2p: false, a: null, b: null, top: 0.36, bot: 0.62, zoom: 1, ft: 7 };
    return App.ui.rf;
  },
  k() { return App.state.settings.camK || DEFAULT_K; },

  /* ---------- map ---------- */
  ensureMap() {
    if (this.map || typeof L === 'undefined') return !!this.map;
    this.el = document.createElement('div'); this.el.className = 'rf-map';
    Object.assign(this.el.style, { position: 'absolute', inset: '0' });   // before Leaflet, which otherwise makes it relative (zero height)
    this.map = L.map(this.el, { zoomControl: false, attributionControl: false, maxZoom: 20, zoomSnap: 0.5 });
    L.tileLayer(ESRI_TILES, { maxZoom: 20, maxNativeZoom: 19, crossOrigin: true }).addTo(this.map);
    this.layer = L.layerGroup().addTo(this.map);
    this.map.on('click', e => this.tap({ lat: e.latlng.lat, lon: e.latlng.lng }));
    return true;
  },
  from() { const r = this.ui(); return r.p2p ? r.a : (App._lastPos && Date.now() - (App._lastPosAt || 0) < 60000 ? App._lastPos : null); },
  tap(p) {
    const r = this.ui();
    if (r.p2p && (!r.a || r.b)) { r.a = p; r.b = null; } else r.b = p;
    this.draw(); this.readout();
    const f = this.from(); if (f && r.b) Weather.loadElevations([f, r.b]).then(() => this.readout());
  },
  mountMap() {
    const slot = document.getElementById('rfSlot'); if (!slot || !this.ensureMap()) return;
    slot.prepend(this.el);
    setTimeout(() => {
      this.map.invalidateSize();
      if (!this._centered) {
        const p = App._lastPos || (App.state.courses.find(c => c.geo) || {}).geo;
        if (p) { this.map.setView([p.lat, p.lon], 17); this._centered = true; } else this.map.setView([39.5, -98.35], 4);
      }
      this.draw(); this.readout();
    }, 0);
    const p = App._lastPos; if (p) Weather.loadWind(p).then(() => this.readout());
  },
  draw() {
    if (!this.map) return; const r = this.ui(), f = this.from(); this.layer.clearLayers();
    const ll = p => [p.lat, p.lon];
    if (App._lastPos) L.circleMarker(ll(App._lastPos), { radius: 8, color: '#fff', weight: 3, fillColor: '#3b8cff', fillOpacity: 1, interactive: false }).addTo(this.layer);
    if (r.p2p && r.a) L.circleMarker(ll(r.a), { radius: 7, color: '#fff', weight: 2, fillColor: '#e6cf85', fillOpacity: 1, interactive: false }).addTo(this.layer);
    if (f && r.b) {
      L.polyline([ll(f), ll(r.b)], { color: '#fff', weight: 3, dashArray: '8 6', interactive: false }).addTo(this.layer);
      L.circleMarker(ll(r.b), { radius: 8, color: '#fff', weight: 3, fillColor: '#e2513f', fillOpacity: 1, interactive: false }).addTo(this.layer);
      const mid = { lat: (f.lat + r.b.lat) / 2, lon: (f.lon + r.b.lon) / 2 };
      L.marker(ll(mid), { interactive: false, icon: L.divIcon({ className: 'rf-label', html: `<span>${Math.round(yardsBetween(f, r.b))} yds</span>`, iconSize: [80, 28], iconAnchor: [40, 14] }) }).addTo(this.layer);
    }
  },
  readout() {
    const el = document.getElementById('rfRead'); if (!el) return;
    const r = this.ui(), f = this.from();
    if (!f) { el.innerHTML = r.p2p ? '<b>Tap the first point</b>' : `<b>${navigator.geolocation ? 'Waiting for GPS…' : 'No GPS on this device'}</b><small>Or switch to point to point</small>`; return; }
    if (!r.b) { el.innerHTML = `<b>Tap a target</b><small>${r.p2p ? 'Now tap the second point' : 'Distance from where you are' + (App._lastPos && App._lastPos.acc ? ` (±${Math.round(App._lastPos.acc * 1.09)} yds)` : '')}</small>`; return; }
    const d = yardsBetween(f, r.b), w = Weather.wind;
    let head = 0, cross = 0, rise = 0;
    if (w) { const c = windComponents(w.from, w.speed, bearingDeg(f, r.b)); head = c.head; cross = c.cross; }
    const e0 = Weather.elevOf(f), e1 = Weather.elevOf(r.b); if (e0 != null && e1 != null) rise = Math.round((e1 - e0) / 0.9144);
    const adj = playsLikeYards(d, head, rise), drift = Math.round(driftYards(d, cross));
    const bits = []; if (w) bits.push(`wind ${Math.round(Math.abs(head))} mph ${head >= 0 ? 'into' : 'helping'}`); if (Math.abs(rise) >= 2) bits.push(`${Math.abs(rise)} yds ${rise > 0 ? 'up' : 'down'}`); if (Math.abs(drift) >= 3) bits.push(`aim ${Math.abs(drift)} ${drift > 0 ? 'L' : 'R'}`);
    el.innerHTML = `<b id="rfYds">${Math.round(d)}<em>yds</em></b>${Math.abs(adj) >= 2 ? `<span class="rf-plays">plays ${Math.round(d + adj)}</span>` : ''}<small>${bits.join(' · ') || (r.p2p ? 'point to point' : 'from you')}</small>`;
  },

  /* ---------- camera ---------- */
  async startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { App.toast('This browser can’t use the camera'); return; }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      App.render();
    } catch (e) { App.toast(e.name === 'NotAllowedError' ? 'Allow camera access to use the camera rangefinder' : 'Couldn’t start the camera'); }
  },
  stop() { if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; } },
  mountCamera() {
    const v = document.getElementById('rfVideo'); if (!v || !this.stream) return;
    if (v.srcObject !== this.stream) { v.srcObject = this.stream; v.play().catch(() => {}); }
    v.onloadedmetadata = () => this.camRead();
    this.bindLines(); this.camRead();
  },
  camGeom() {
    const v = document.getElementById('rfVideo'), box = document.getElementById('rfCam'); if (!v || !box || !v.videoWidth) return null;
    const r = this.ui(), H = box.clientHeight;
    return { ew: box.clientWidth, eh: H, vw: v.videoWidth, vh: v.videoHeight, zoom: r.zoom, span: (r.bot - r.top) * H };
  },
  camRead() {
    const el = document.getElementById('rfRead'); if (!el) return;
    const g = this.camGeom(), r = this.ui();
    const y = g ? cameraYards({ ...g, ft: r.ft, k: this.k() }) : null;
    el.innerHTML = y ? `<b id="rfYds">${Math.round(y)}<em>yds</em></b><small>${App.state.settings.camK ? 'calibrated' : 'not calibrated: about ±10%'} · ${r.ft} ft flag</small>` : '<b>—</b><small>Line up the markers with the top and bottom of the flagstick</small>';
  },
  bindLines() {
    const box = document.getElementById('rfCam'); if (!box || box._bound) return; box._bound = true;
    let which = null;
    const y = e => { const b = box.getBoundingClientRect(); return Math.max(0.02, Math.min(0.98, (e.clientY - b.top) / b.height)); };
    box.addEventListener('pointerdown', e => { const h = e.target.closest('[data-line]'); if (!h) return; which = h.dataset.line; box.setPointerCapture(e.pointerId); e.preventDefault(); });
    box.addEventListener('pointermove', e => {
      if (!which) return; const r = this.ui(), v = y(e);
      if (which === 'top') r.top = Math.min(v, r.bot - 0.01); else r.bot = Math.max(v, r.top + 0.01);
      const t = document.querySelector('[data-line=top]'), b = document.querySelector('[data-line=bot]');
      if (t) t.style.top = (r.top * 100) + '%'; if (b) b.style.top = (r.bot * 100) + '%';
      const band = document.getElementById('rfBand'); if (band) { band.style.top = (r.top * 100) + '%'; band.style.height = ((r.bot - r.top) * 100) + '%'; }
      this.camRead();
    });
    box.addEventListener('pointerup', () => { which = null; });
  },

  onPos() { if (App.route() !== 'finder') return; const r = this.ui(); if (r.mode === 'map') { this.draw(); this.readout(); } },
};

Views.finder = function () {
  const r = Finder.ui(), cam = r.mode === 'camera';
  App.after(() => { Finder._watching = true; if (App._watchId == null) App.watchGps(true); cam ? Finder.mountCamera() : Finder.mountMap(); });
  if (!cam) Finder.stop();
  const tabs = `<div class="rf-tabs seg"><button class="${cam ? '' : 'active'}" data-action="rfMode" data-v="map">Map</button><button class="${cam ? 'active' : ''}" data-action="rfMode" data-v="camera">Camera</button></div>`;
  let body;
  if (!cam) body = `<div class="rf-bar"><div class="seg"><button class="${r.p2p ? '' : 'active'}" data-action="rfP2p" data-v="0">From me</button><button class="${r.p2p ? 'active' : ''}" data-action="rfP2p" data-v="1">Point to point</button></div><button class="hv-round" data-action="rfCenter" aria-label="Centre on me">◎</button></div>`;
  else if (!Finder.stream) body = `<div class="rf-start card"><h3>Camera rangefinder</h3><p class="small">Point your phone at the flag and slide the two markers to the top and bottom of the flagstick. It works out the distance from the flag's height.</p><button class="btn primary lg" data-action="rfCamera">Start camera</button><p class="tiny muted mt mb0">Accuracy is about ±10% until you calibrate it once (in the camera view). Beyond about 200 yds the flag gets too small to measure well.</p></div>`;
  else body = `<div class="rf-cam" id="rfCam"><video id="rfVideo" playsinline muted autoplay style="transform:scale(${r.zoom})"></video>
      <div class="rf-band" id="rfBand" style="top:${r.top * 100}%;height:${(r.bot - r.top) * 100}%"></div>
      <div class="rf-line top" data-line="top" style="top:${r.top * 100}%"><span>top of flag</span></div>
      <div class="rf-line bot" data-line="bot" style="top:${r.bot * 100}%"><span>bottom (hole)</span></div></div>
    <div class="rf-cambar"><div class="seg">${[1, 2, 4].map(z => `<button class="${r.zoom === z ? 'active' : ''}" data-action="rfZoom" data-v="${z}">${z}×</button>`).join('')}</div>
      <select data-change="rfFt" aria-label="Height of what you're measuring">${FLAG_FT.map(([v, l]) => `<option value="${v}" ${r.ft === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn sm" data-action="rfCalibrate">Calibrate</button></div>`;
  let sheet = '';
  if (App.ui.rfSheet === 'cal') {
    const gps = (() => { try { const h = typeof HoleView !== 'undefined' && HoleView.s.courseId ? HoleView.info() : null; return h && h.flag && App._lastPos ? Math.round(yardsBetween(App._lastPos, h.flag)) : null; } catch (e) { return null; } })();
    sheet = `<div class="hv-scrim" data-action="rfCalibrate" data-v="close"></div><div class="hv-sheet"><button class="btn sm ghost hv-close" data-action="rfCalibrate" data-v="close" aria-label="Close">✕</button><h3>Calibrate the camera</h3>
      <p class="small">Line up the markers on something whose height and distance you know, then enter them. Good choices: a flag on a green with a GPS distance, or a door (6 ft 8 in) you've paced off.</p>
      <form class="form" data-form="rfCal"><div class="form-row"><div class="field"><label>Its height (ft)</label><input type="number" step="0.1" name="ft" value="${r.ft}" required></div><div class="field"><label>Distance (yds)</label><input type="number" step="0.5" name="yards" value="${gps || ''}" required></div></div>
      ${gps ? `<p class="tiny muted">Filled in from GPS: ${gps} yds to the ${HoleView.info().pin ? 'flag' : 'middle of the green'}.</p>` : ''}
      <div class="btn-row"><button class="btn primary" type="submit">Save calibration</button>${App.state.settings.camK ? '<button class="btn ghost" type="button" data-action="rfCalReset">Reset</button>' : ''}</div></form></div>`;
  }
  return `<div class="hv rf" id="rfSlot">
    <div class="rf-top"><a class="hv-back" href="${App.state.liveRound ? '#/gps' : '#/play'}" aria-label="Back">‹</a>${tabs}</div>
    ${body}
    <div class="rf-read" id="rfRead"></div>
    ${cam ? '' : '<div class="hv-attr">Imagery © Esri, Maxar, Earthstar Geographics</div>'}
  </div>${sheet}`;
};

Object.assign(Actions, {
  openFinder() { App.ui.hvSheet = null; location.hash = '#/finder'; },
  rfMode(el) { Finder.ui().mode = el.dataset.v; App.render(); },
  rfP2p(el) { const r = Finder.ui(); r.p2p = el.dataset.v === '1'; r.a = null; r.b = null; App.render(); },
  rfCenter() { App.locate(p => { App._lastPos = p; App._lastPosAt = Date.now(); if (Finder.map) Finder.map.setView([p.lat, p.lon], 17); Finder.draw(); Finder.readout(); }); },
  rfCamera() { Finder.startCamera(); },
  rfZoom(el) { Finder.ui().zoom = +el.dataset.v; App.render(); },
  rfCalibrate(el) { App.ui.rfSheet = el && el.dataset.v === 'close' ? null : 'cal'; App.render(); },
  rfCalReset() { delete App.state.settings.camK; Store.save(); App.ui.rfSheet = null; App.render(); App.toast('Calibration reset'); },
});
Object.assign(Forms, {
  rfCal(form, v) {
    const g = Finder.camGeom(); if (!g) { App.toast('Start the camera and line up the markers first'); return; }
    const k = cameraK({ ...g, ft: parseFloat(v.ft), yards: parseFloat(v.yards) });
    if (!(k > 0.3 && k < 3)) { App.toast('That doesn’t look right. Check the markers and the numbers.'); return; }
    App.state.settings.camK = Math.round(k * 1000) / 1000; Store.save(); App.ui.rfSheet = null; App.render(); App.toast('Camera calibrated');
  },
});
Object.assign(Changes, { rfFt(el) { Finder.ui().ft = parseFloat(el.value); Finder.camRead(); } });

if (typeof module !== 'undefined' && module.exports) module.exports = { cameraYards, cameraK };
