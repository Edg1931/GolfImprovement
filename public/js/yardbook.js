/* Yardage book: one page per mapped hole, drawn like a printed yardage book. The hole is turned so the
   tee is at the bottom, with carry and reach numbers for hazards from the tee, 100/150/200 markers to the
   middle of the green, green depth, the player's shot plan and tee tip, and room for notes.
   Print it (or save as PDF from the print dialog), or share the pages as images. */

const Yardbook = {
  W: 900, H: 1200,
  FILL: { green: '#6cc47f', fairway: '#8fca72', bunker: '#efe2b8', water: '#4b93d9', trees: '#2f5a33', tee: '#8fd18f', ob: 'rgba(0,0,0,0.08)' },

  /* A picture of hole n. */
  page(course, n) {
    const info = CourseMap.holeInfo(course, n); if (!info.tee || !info.green) return null;
    const c = document.createElement('canvas'); c.width = this.W; c.height = this.H;
    const ctx = c.getContext('2d'), W = this.W, H = this.H;
    const par = course.pars[n - 1], si = (course.si || [])[n - 1], yds = (course.yards && course.yards[n - 1]) || Math.round(yardsBetween(info.tee, info.green));
    const plan = (course.plans && course.plans[n]) || [];
    const shapes = CourseMap.holeShapes(course, n), path = CourseMap.holePath(course, n);
    // paper
    ctx.fillStyle = '#fbf8ef'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#12352a'; ctx.fillRect(0, 0, W, 104);
    ctx.fillStyle = '#e6cf85'; ctx.font = '700 22px Inter, system-ui, sans-serif'; ctx.fillText(String(course.name || '').toUpperCase().slice(0, 40), 36, 40);
    ctx.fillStyle = '#fff'; ctx.font = '600 50px Fraunces, Georgia, serif'; ctx.fillText(`Hole ${n}`, 36, 88);
    ctx.textAlign = 'right'; ctx.font = '600 30px Inter, system-ui, sans-serif';
    ctx.fillText(`Par ${par}  ·  ${yds} yds${course.tees ? ' ' + String(course.tees).split(' ')[0] : ''}${si ? '  ·  Hcp ' + si : ''}`, W - 36, 84); ctx.textAlign = 'left';

    // drawing area, turned so the line of play runs up the page
    const box = { x: 36, y: 128, w: W - 72, h: 830 };
    const proj = Caddie.projector(info.green), t0 = proj.toXY(info.tee), phi = Math.atan2(-t0.x, -t0.y), cs = Math.cos(phi), sn = Math.sin(phi);
    const uv = p => { const q = proj.toXY(p); return { u: q.x * cs - q.y * sn, v: q.x * sn + q.y * cs }; };
    const core = path.concat(plan.flatMap(p => [p.land || p.aim])).map(uv);
    const u0 = Math.min(...core.map(p => p.u)) - 55, u1 = Math.max(...core.map(p => p.u)) + 55, v0 = Math.min(...core.map(p => p.v)) - 18, v1 = Math.max(...core.map(p => p.v)) + 30;
    const k = Math.min(box.w / (u1 - u0), box.h / (v1 - v0));
    const cx = box.x + box.w / 2 - (u0 + u1) / 2 * k, cy = box.y + box.h / 2 + (v0 + v1) / 2 * k;
    const S = p => { const q = uv(p); return [cx + q.u * k, cy - q.v * k]; };
    ctx.save(); this.round(ctx, box.x, box.y, box.w, box.h, 18); ctx.clip();
    ctx.fillStyle = '#b9d7a3'; ctx.fillRect(box.x, box.y, box.w, box.h);   // rough
    ctx.strokeStyle = this.FILL.fairway; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 50 * k;
    ctx.beginPath(); path.forEach((p, j) => { const [x, y] = S(p); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
    const order = { trees: 0, ob: 0, fairway: 1, tee: 2, water: 3, bunker: 4, green: 5 };
    shapes.slice().sort((a, b) => (order[a.type] || 0) - (order[b.type] || 0)).forEach(f => {
      ctx.fillStyle = this.FILL[f.type] || 'rgba(0,0,0,0.1)'; ctx.beginPath(); f.ll.forEach((p, j) => { const [x, y] = S(p); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); ctx.fill();
      if (f.type === 'bunker' || f.type === 'water' || f.type === 'green') { ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1.5; ctx.stroke(); }
    });
    if (!shapes.some(f => f.type === 'green')) { const [x, y] = S(info.green); ctx.fillStyle = this.FILL.green; ctx.beginPath(); ctx.ellipse(x, y, 15 * k, 13 * k, 0, 0, Math.PI * 2); ctx.fill(); }
    // layup markers to the middle of the green
    const line = path.map(proj.toXY).reverse(); let total = 0; for (let i = 1; i < line.length; i++) total += Caddie.dist(line[i - 1], line[i]);
    ctx.font = '700 20px Inter, system-ui, sans-serif';
    [100, 150, 200, 250].forEach(d => {
      if (d > total - 25) return;
      const [x, y] = S(proj.toLL(Caddie.alongPolyline(line, d)));
      ctx.strokeStyle = '#12352a'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(x - 32 * k, y); ctx.lineTo(x + 32 * k, y); ctx.stroke(); ctx.setLineDash([]);
      this.pill(ctx, String(d), x + 32 * k + 8, y, '#12352a', '#fff');
    });
    // hazard numbers from the tee: carry over the top, reach at the bottom
    const tp = Caddie.projector(info.tee), gXY = tp.toXY(info.green);
    shapes.filter(f => f.type === 'water' || f.type === 'bunker').forEach(f => {
      const xy = f.ll.map(tp.toXY), ds = xy.map(q => Math.hypot(q.x, q.y));
      const reach = Math.round(Math.min(...ds)), carry = Math.round(Math.max(...ds));
      const cen = Caddie.centroid(xy), o = Caddie.offsets({ x: 0, y: 0 }, gXY, cen);
      if (o.along < 20) return;
      const [x, y] = S(tp.toLL(cen));
      this.pill(ctx, `${reach}–${carry}`, x + (o.lat < 0 ? -12 : 12), y, f.type === 'water' ? '#1f5f9e' : '#8a6d1d', '#fff', o.lat < 0 ? 'right' : 'left');
    });
    // the plan
    plan.forEach(st => {   // lines first, so no line crosses a shot number
      const [x0, y0] = S(st.start), [x1, y1] = S(st.land || st.aim);
      ctx.strokeStyle = '#c39a2b'; ctx.lineWidth = 4; ctx.setLineDash([12, 8]); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.setLineDash([]);
    });
    plan.forEach((st, i) => {
      const [x1, y1] = S(st.land || st.aim);
      ctx.fillStyle = '#c39a2b'; ctx.beginPath(); ctx.arc(x1, y1, 16, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = '800 18px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(i + 1), x1, y1 + 6); ctx.textAlign = 'left';
    });
    // flag and tee
    { const [x, y] = S(info.green); ctx.strokeStyle = '#222'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 40); ctx.stroke(); ctx.fillStyle = '#e2513f'; ctx.beginPath(); ctx.moveTo(x, y - 40); ctx.lineTo(x + 26, y - 32); ctx.lineTo(x, y - 24); ctx.fill(); }
    { const [x, y] = S(info.tee); ctx.fillStyle = '#12352a'; ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 2; this.round(ctx, box.x, box.y, box.w, box.h, 18); ctx.stroke();

    // notes
    let y = 1000; ctx.fillStyle = '#12352a'; ctx.font = '700 22px Inter, system-ui, sans-serif';
    const depth = info.front && info.back ? Math.round(yardsBetween(info.front, info.back)) : null;
    const facts = [depth ? `Green ${depth} yds deep` : null, plan.length ? 'Plan: ' + plan.map(p => `${p.club} ${Math.round(yardsBetween(p.start, p.land || p.aim))}`).join(' → ') : 'No plan yet'].filter(Boolean);
    ctx.fillText(facts.join('   ·   ').slice(0, 70), 36, y); y += 34;
    let tip = null; try { tip = smartTip(course, n, null, null); } catch (e) { /* optional */ }
    ctx.font = '500 20px Inter, system-ui, sans-serif'; ctx.fillStyle = '#4a3a0a';
    if (tip) { this.wrap(ctx, '💡 ' + tip, 36, y, W - 72, 26, 2); y += 58; }
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1.5;
    for (; y < H - 60; y += 40) { ctx.beginPath(); ctx.moveTo(36, y + 14); ctx.lineTo(W - 36, y + 14); ctx.stroke(); }
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.font = '500 16px Inter, system-ui, sans-serif';
    ctx.fillText('Hazard numbers: reach–carry from the tee · markers: yards to the middle of the green · Fairway Lab', 36, H - 24);
    return c;
  },
  round(ctx, x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); },
  pill(ctx, text, x, y, bg, fg, align) {
    ctx.font = '700 19px Inter, system-ui, sans-serif'; const w = ctx.measureText(text).width + 16;
    const left = align === 'right' ? x - w : x;
    ctx.fillStyle = bg; this.round(ctx, left, y - 14, w, 28, 14); ctx.fill();
    ctx.fillStyle = fg; ctx.fillText(text, left + 8, y + 7);
  },
  wrap(ctx, text, x, y, max, lh, lines) {
    const words = text.split(' '); let line = '', n = 0;
    for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > max && line) { ctx.fillText(line, x, y + n * lh); line = w; if (++n >= lines) return; } else line = t; }
    if (line) ctx.fillText(line, x, y + n * lh);
  },
};

Views.yardbook = function () {
  const courses = App.state.courses;
  const c = courses.find(x => x.id === App.ui.ybCourse) || courses.find(x => x.map && Object.keys(x.map.holes || {}).length) || courses[0];
  if (!c) return `<div class="empty">Add a course first: search for it on the <a href="#/play">Play</a> page.</div>`;
  App.ui.ybCourse = c.id;
  const holes = c.pars.map((_, i) => i + 1), mapped = holes.filter(n => { const h = CourseMap.holeInfo(c, n); return h.tee && h.green; });
  App.after(() => {
    mapped.forEach(n => { const img = document.getElementById('yb' + n); if (!img || img.src) return; const cv = Yardbook.page(c, n); if (cv) img.src = cv.toDataURL('image/png'); });
  });
  return `<div class="page-head no-print"><div><p class="eyebrow">Course notes</p><h1>Yardage book</h1><p class="muted">One page per hole: carries over hazards, layup yardages, green depth and your shot plan. Print it or save it as a PDF to keep in your bag.</p></div>
      <div class="btn-row"><button class="btn primary" data-action="ybPrint" ${mapped.length ? '' : 'disabled'}>🖨 Print or save PDF</button><button class="btn" data-action="ybShare" ${mapped.length ? '' : 'disabled'}>↗ Share pages</button></div></div>
    <div class="map-bar no-print"><select data-change="ybCourse" aria-label="Course">${courses.map(x => `<option value="${x.id}" ${x.id === c.id ? 'selected' : ''}>${escapeHtml(x.name)}${x.tees ? ' · ' + escapeHtml(x.tees) : ''}</option>`).join('')}</select></div>
    ${mapped.length < holes.length ? `<div class="callout info small mt no-print">${mapped.length ? `${holes.length - mapped.length} hole${holes.length - mapped.length === 1 ? ' isn’t' : 's aren’t'} mapped yet (${holes.filter(n => !mapped.includes(n)).join(', ')}).` : 'This course isn’t mapped yet.'} <a href="#" data-action="openHoleView" data-id="${c.id}" data-hole="${holes.find(n => !mapped.includes(n)) || 1}">Map ${mapped.length ? 'them' : 'it'} in the hole view</a>: find the course, then tap each tee and green.</div>` : ''}
    <div class="yb-pages">${mapped.map(n => `<div class="yb-page"><img id="yb${n}" alt="Hole ${n} yardage page"></div>`).join('')}</div>`;
};

Object.assign(Actions, {
  openYardbook(el) { App.ui.ybCourse = (el && el.dataset.id) || (typeof HoleView !== 'undefined' && HoleView.s.courseId) || App.ui.ybCourse; App.ui.hvSheet = null; location.hash = '#/yardbook'; },
  ybPrint() { window.print(); },
  async ybShare() {
    const c = App.state.courses.find(x => x.id === App.ui.ybCourse); if (!c) return;
    const pages = c.pars.map((_, i) => i + 1).map(n => ({ n, cv: Yardbook.page(c, n) })).filter(p => p.cv);
    const files = await Promise.all(pages.map(p => new Promise(res => p.cv.toBlob(b => res(new File([b], `${c.name.replace(/\W+/g, '-')}-hole-${p.n}.png`, { type: 'image/png' })), 'image/png'))));
    if (navigator.canShare && navigator.canShare({ files })) { try { await navigator.share({ files, text: `${c.name} yardage book` }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    files.forEach(f => { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); });
    App.toast(`${files.length} page${files.length === 1 ? '' : 's'} saved`);
  },
});
Object.assign(Changes, { ybCourse(el) { App.ui.ybCourse = el.value; App.render(); } });
