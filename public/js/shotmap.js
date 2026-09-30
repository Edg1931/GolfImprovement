/* Post-round shot map: every tracked shot of a saved round drawn on the hole's satellite map, coloured by
   strokes gained, with a shareable image of any hole. */

const SG_COLORS = { good: '#57c26f', ok: '#f3e3b1', bad: '#e2513f' };
const sgColor = v => v == null ? '#ffffff' : v >= 0.1 ? SG_COLORS.good : v <= -0.1 ? SG_COLORS.bad : SG_COLORS.ok;
const LIE_NAME = Object.fromEntries(SG.LIES);

function shotMapButton(r) {
  return r.holes && r.holes.some(h => h.shots && h.shots.length) ? `<button class="btn" data-action="openShotMap" data-id="${r.id}">🗺 Shot map</button>` : '';
}

const ShotMap = {
  el: null, map: null, layer: null,
  ensureMap() {
    if (this.map || typeof L === 'undefined') return !!this.map;
    this.el = document.createElement('div'); this.el.className = 'hole-map sm-map';
    this.map = L.map(this.el, { zoomControl: true, attributionControl: true, maxZoom: 20, zoomSnap: 0.5 });
    L.tileLayer(ESRI_TILES, { maxZoom: 20, maxNativeZoom: 19, attribution: ESRI_ATTR, crossOrigin: true }).addTo(this.map);
    this.layer = L.layerGroup().addTo(this.map);
    return true;
  },
  /* Everything needed to draw hole n of round r. */
  data(r, i) {
    const n = (r.firstHole || 0) + i + 1, h = r.holes[i];
    const course = App.state.courses.find(c => c.id === r.courseId);
    const info = course ? CourseMap.holeInfo(course, n) : {};
    const flag = (r.pins && r.pins[n]) || info.green || null;
    const sg = SG.hole(h, r.pars[i], App.targetHcp());
    const shots = (h.shots || []).map(s => ({ ...s, sg: sg && (sg.shots.find(x => x.id === s.id) || {}).sg, yards: Math.round(yardsBetween(s.from, s.to)) }));
    return { n, h, par: r.pars[i], course, info, flag, shots, sg, shapes: course ? CourseMap.holeShapes(course, n) : [] };
  },
  mount(r, i) {
    const slot = document.getElementById('smSlot'); if (!slot || !this.ensureMap()) return;
    slot.appendChild(this.el);
    const d = this.data(r, i), ll = p => [p.lat, p.lon];
    this.layer.clearLayers();
    d.shapes.forEach(f => L.polygon(f.ll.map(ll), Object.assign({ interactive: false }, FEATURE_STYLE[f.type] || {})).addTo(this.layer));
    if (d.info.tee) L.circleMarker(ll(d.info.tee), { radius: 6, color: '#fff', weight: 2, fillColor: '#2a7a52', fillOpacity: 1, interactive: false }).addTo(this.layer);
    if (d.flag) L.marker(ll(d.flag), { interactive: false, icon: L.divIcon({ className: 'map-flag cur', html: `<span>${d.n}</span>`, iconSize: [22, 22], iconAnchor: [4, 20] }) }).addTo(this.layer);
    d.shots.forEach((s, k) => {
      L.polyline([ll(s.from), ll(s.to)], { color: sgColor(s.sg), weight: 4, opacity: 0.95, interactive: false }).addTo(this.layer);
      L.marker(ll(s.to), { interactive: false, icon: L.divIcon({ className: 'map-step', html: `<span>${k + 1}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] }) }).addTo(this.layer);
    });
    const pts = [d.info.tee, d.flag, ...d.shots.flatMap(s => [s.from, s.to])].filter(Boolean);
    setTimeout(() => {
      this.map.invalidateSize();
      if (pts.length >= 2) this.map.fitBounds(pts.map(ll), { padding: [30, 30], maxZoom: 18, animate: false });
      else if (pts.length === 1) this.map.setView(ll(pts[0]), 17, { animate: false });
    }, 0);
  },

  /* A shareable picture of one hole: the hole drawn as a map with the shots on it, and the shot list. */
  async image(r, i) {
    await Share.fonts();
    const c = Share.canvas(), ctx = c.getContext('2d'), { W, H } = Share; const d = this.data(r, i);
    Share.background(ctx);
    Share.label(ctx, `${new Date(r.date + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'long' })} · ${r.course || ''}`.slice(0, 60), 80, 220);
    ctx.fillStyle = '#fff'; ctx.font = '600 72px Fraunces, Georgia, serif';
    ctx.fillText(`Hole ${d.n} · Par ${d.par}`, 80, 300);
    const rel = d.h.strokes - d.par;
    ctx.font = '600 72px Fraunces, Georgia, serif'; ctx.fillStyle = rel < 0 ? '#e2513f' : '#e6cf85'; ctx.textAlign = 'right';
    ctx.fillText(`${d.h.strokes} · ${scoreName(d.h.strokes, d.par)}`, W - 80, 300); ctx.textAlign = 'left';
    // map panel, turned so the tee is at the bottom
    const box = { x: 80, y: 340, w: W - 160, h: 640 };
    ctx.fillStyle = '#23402a'; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(box.x, box.y, box.w, box.h, 28); else ctx.rect(box.x, box.y, box.w, box.h); ctx.fill();
    const start = d.info.tee || (d.shots[0] && d.shots[0].from), end = d.flag || (d.shots.length && d.shots[d.shots.length - 1].to);
    if (start && end) {
      const proj = Caddie.projector(end), v0 = proj.toXY(start), phi = Math.atan2(-v0.x, -v0.y);
      const cs = Math.cos(phi), sn = Math.sin(phi);
      const uv = p => { const q = proj.toXY(p); return { u: q.x * cs - q.y * sn, v: q.x * sn + q.y * cs }; };
      const core = [start, end, ...d.shots.flatMap(s => [s.from, s.to])].map(uv);
      const u0 = Math.min(...core.map(p => p.u)) - 40, u1 = Math.max(...core.map(p => p.u)) + 40, vv0 = Math.min(...core.map(p => p.v)) - 20, vv1 = Math.max(...core.map(p => p.v)) + 30;
      const k = Math.min(box.w / (u1 - u0), box.h / (vv1 - vv0));
      const cx = box.x + box.w / 2 - (u0 + u1) / 2 * k, cy = box.y + box.h / 2 + (vv0 + vv1) / 2 * k;
      const S = p => { const q = uv(p); return [cx + q.u * k, cy - q.v * k]; };
      ctx.save(); ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(box.x, box.y, box.w, box.h, 28); else ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
      // a fairway-coloured corridor along the line of play, then the mapped shapes
      const path = d.course ? CourseMap.holePath(d.course, d.n) : [start, end];
      ctx.strokeStyle = 'rgba(120, 180, 95, 0.35)'; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 55 * k;
      ctx.beginPath(); path.filter(Boolean).forEach((p, j) => { const [x, y] = S(p); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
      const fill = { green: '#5bbf73', fairway: 'rgba(125,190,100,0.55)', bunker: '#eadcb0', water: '#3a86d6', trees: 'rgba(20,50,25,0.7)', tee: '#6fbf6f', ob: 'rgba(255,255,255,0.15)' };
      d.shapes.slice().sort((a, b) => (a.type === 'fairway' ? -1 : 0) - (b.type === 'fairway' ? -1 : 0)).forEach(f => {
        ctx.fillStyle = fill[f.type] || 'rgba(255,255,255,0.2)'; ctx.beginPath(); f.ll.forEach((p, j) => { const [x, y] = S(p); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); ctx.fill();
      });
      if (d.flag) { const [x, y] = S(d.flag); ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 44); ctx.stroke(); ctx.fillStyle = '#e2513f'; ctx.beginPath(); ctx.moveTo(x, y - 44); ctx.lineTo(x + 28, y - 35); ctx.lineTo(x, y - 26); ctx.fill(); }
      d.shots.forEach((s, j) => {
        const [x0, y0] = S(s.from), [x1, y1] = S(s.to);
        ctx.strokeStyle = sgColor(s.sg); ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x1) / 2 + (y1 - y0) * 0.08, (y0 + y1) / 2 - Math.abs(x1 - x0) * 0.05 - 20, x1, y1); ctx.stroke();
        ctx.fillStyle = '#12352a'; ctx.beginPath(); ctx.arc(x1, y1, 22, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = sgColor(s.sg); ctx.lineWidth = 4; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = '700 24px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(j + 1), x1, y1 + 8); ctx.textAlign = 'left';
      });
      if (start) { const [x, y] = S(start); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    // shot list
    let y = 1040;
    d.shots.slice(0, 4).forEach((s, j) => {
      ctx.fillStyle = sgColor(s.sg); ctx.beginPath(); ctx.arc(100, y - 10, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '600 32px Inter, system-ui, sans-serif'; ctx.fillText(`${s.club || 'Shot'} · ${s.yards} yds`, 130, y);
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '500 28px Inter, system-ui, sans-serif'; ctx.fillText(`${LIE_NAME[s.fromLie] || ''} → ${LIE_NAME[s.toLie] || ''}`, 520, y);
      if (s.sg != null) { ctx.textAlign = 'right'; ctx.fillStyle = sgColor(s.sg); ctx.fillText(fmtSG(s.sg), W - 80, y); ctx.textAlign = 'left'; }
      y += 46;
    });
    if (d.shots.length > 4) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '500 26px Inter, system-ui, sans-serif'; ctx.fillText(`+ ${d.shots.length - 4} more`, 130, y); }
    Share.footer(ctx);
    return c;
  },
};

Views.shotmap = function () {
  const r = App.rounds().find(x => x.id === App.ui.shotRound);
  if (!r || !r.holes) return `<div class="empty">Pick a round from your <a href="#/rounds">rounds</a> to see its shot map.</div>`;
  const with_ = r.holes.map((h, i) => (h.shots && h.shots.length ? i : -1)).filter(i => i >= 0);
  let i = App.ui.smHole != null ? App.ui.smHole : (with_[0] || 0); if (i >= r.holes.length) i = 0;
  const d = ShotMap.data(r, i);
  App.after(() => ShotMap.mount(r, i));
  return `<div class="page-head"><div><p class="eyebrow">${fmtDate(r.date)} · ${escapeHtml(r.course || '')}</p><h1>Shot map</h1><p class="muted">Every shot you tracked, coloured by strokes gained against a ${App.targetHcp()} handicap: <span class="sg-pos">green</span> gained, <span class="sg-neg">red</span> lost.</p></div>
      <div class="btn-row"><button class="btn primary" data-action="shareShotHole">↗ Share this hole</button><a class="btn" href="#/rounds">‹ Rounds</a></div></div>
    <div class="hole-strip light">${r.holes.map((h, k) => `<button class="hole-pill ${k === i ? 'cur' : ''} ${scoreClass(h.strokes, r.pars[k])} ${h.shots && h.shots.length ? 'mapped' : ''}" data-action="smHole" data-i="${k}"><small>${(r.firstHole || 0) + k + 1}</small>${h.strokes ?? '·'}</button>`).join('')}</div>
    <div class="map-layout mt"><div class="map-slot" id="smSlot"></div>
    <div class="map-panel"><div class="card"><div class="card-head"><h3>Hole ${d.n} · Par ${d.par}</h3><span class="badge ${scoreClass(d.h.strokes, d.par)}">${d.h.strokes} · ${scoreName(d.h.strokes, d.par)}</span></div>
      ${d.shots.length ? `<ol class="shot-list">${d.shots.map((s, k) => `<li><span class="dot" style="background:${sgColor(s.sg)}"></span><div><strong>${escapeHtml(s.club || 'Shot')}</strong> · ${s.yards} yds<div class="tiny muted">${LIE_NAME[s.fromLie] || ''} → ${LIE_NAME[s.toLie] || ''}${s.d1 != null && s.toLie === 'green' ? ` · ${Math.round(s.d1 * 3)} ft from the flag` : s.d1 != null ? ` · ${Math.round(s.d1)} yds to go` : ''}</div></div><span class="${sgClass(s.sg)}">${fmtSG(s.sg)}</span></li>`).join('')}</ol>` : '<p class="small muted">No shots tracked on this hole. Use <strong>Track shot</strong> in the hole view next time.</p>'}
      ${(() => { const pl = PlanReview.plansFor(r, d.course)[d.n]; return pl && pl.length ? `<p class="small mt mb0"><strong>Your plan:</strong> ${escapeHtml(pl.map(p => p.club).join(' → '))}${d.shots.length ? ` · <strong>played:</strong> ${escapeHtml(d.shots.map(s => s.club || '?').join(' → '))}` : ''}</p>` : ''; })()}
      <div class="kv mt"><dt>Putts</dt><dd>${d.h.putts ?? '—'}${d.h.firstPutt != null && d.h.putts ? ` · first from ${d.h.firstPutt} ft` : ''}</dd>${d.sg ? `<dt>Strokes gained</dt><dd class="${sgClass(d.sg.total)}">${fmtSG(d.sg.total)}${d.sg.putt != null ? ` <span class="tiny muted">(putting ${fmtSG(d.sg.putt)})</span>` : ''}</dd>` : ''}</div>
    </div></div></div>`;
};

Object.assign(Actions, {
  openShotMap(el) { App.ui.shotRound = el.dataset.id; App.ui.smHole = null; App.closeModal(); location.hash = '#/shotmap'; },
  smHole(el) { App.ui.smHole = +el.dataset.i; App.render(); },
  async shareShotHole() {
    const r = App.rounds().find(x => x.id === App.ui.shotRound); if (!r) return;
    const i = App.ui.smHole != null ? App.ui.smHole : Math.max(0, r.holes.findIndex(h => h.shots && h.shots.length));
    const c = await ShotMap.image(r, i); const how = await Share.send(c, `hole-${(r.firstHole || 0) + i + 1}-${r.date}`, `Hole ${(r.firstHole || 0) + i + 1} at ${r.course || 'the course'} ⛳`);
    if (how === 'downloaded') App.toast('Image saved. Share it from your photos.');
  },
});
