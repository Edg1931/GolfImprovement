/* Share cards: a round or an achievement drawn to a 1080×1350 image, shared with the phone's share
   sheet where supported, otherwise downloaded. */

const Share = {
  W: 1080, H: 1350,
  async fonts() {
    if (!document.fonts || !document.fonts.load) return;
    await Promise.all(['600 120px Fraunces', 'italic 500 60px Fraunces', '700 40px Inter', '500 32px Inter'].map(f => document.fonts.load(f).catch(() => {})));
  },
  canvas() { const c = document.createElement('canvas'); c.width = this.W; c.height = this.H; return c; },

  /* Green background with contour lines and the brand at the top. */
  background(ctx) {
    const { W, H } = this;
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#1d5c41'); g.addColorStop(0.6, '#12352a'); g.addColorStop(1, '#0a241b');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 3;
    for (let r = 1; r <= 6; r++) { ctx.beginPath(); ctx.ellipse(W * 0.85, H * 0.92, 150 * r, 80 * r, 0, 0, Math.PI * 2); ctx.stroke(); }
    const glow = ctx.createRadialGradient(W, 0, 0, W, 0, W * 0.9); glow.addColorStop(0, 'rgba(230,207,133,0.18)'); glow.addColorStop(1, 'rgba(230,207,133,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff'; ctx.font = '600 52px Fraunces, Georgia, serif'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('Fairway', 80, 130); const w = ctx.measureText('Fairway ').width;
    ctx.fillStyle = '#e6cf85'; ctx.font = 'italic 500 52px Fraunces, Georgia, serif'; ctx.fillText('Lab', 80 + w, 130);
  },
  label(ctx, text, x, y, color) { ctx.fillStyle = color || '#e6cf85'; ctx.font = '800 26px Inter, system-ui, sans-serif'; ctx.fillText(text.toUpperCase().split('').join(String.fromCharCode(8202)), x, y); },

  async round(r) {
    await this.fonts(); const c = this.canvas(), ctx = c.getContext('2d'); const { W } = this;
    this.background(ctx);
    const gross = r.grossScore ?? r.score, par = r.par, rel = gross - par;
    this.label(ctx, (r.holesPlayed === 9 ? (r.nine === 'back' ? 'Back nine · ' : 'Front nine · ') : '') + new Date(r.date + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }), 80, 250);
    ctx.fillStyle = '#fff'; ctx.font = '600 64px Fraunces, Georgia, serif'; ctx.fillText(this.fit(ctx, r.course || 'Round', W - 160), 80, 330);
    ctx.font = '600 300px Fraunces, Georgia, serif'; ctx.fillStyle = '#fff'; ctx.fillText(String(gross), 70, 640);
    const sw = ctx.measureText(String(gross)).width;
    ctx.font = '600 90px Fraunces, Georgia, serif'; ctx.fillStyle = '#e6cf85'; ctx.fillText(rel === 0 ? 'E' : (rel > 0 ? '+' : '') + rel, 100 + sw, 640);
    const stats = [['Putts', r.putts], ['Greens', r.gir], ['Fairways', r.firHit != null && r.firPossible ? r.firHit + '/' + r.firPossible : null], ['Differential', r.diff != null ? fmt1(r.diff) : null]].filter(s => s[1] != null).slice(0, 4);
    stats.forEach(([l, v], i) => { const x = 80 + i * ((W - 160) / stats.length); this.label(ctx, l, x, 760, 'rgba(255,255,255,0.65)'); ctx.fillStyle = '#fff'; ctx.font = '600 72px Fraunces, Georgia, serif'; ctx.fillText(String(v), x, 840); });
    if (r.holes) this.miniCard(ctx, r, 900);
    else { ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '500 34px Inter, system-ui, sans-serif'; const idx = App.index(); if (idx != null) ctx.fillText('Handicap Index ' + fmt1(idx), 80, 960); }
    this.footer(ctx);
    return c;
  },

  /* Hole-by-hole strip: one row per nine with coloured score markers. */
  miniCard(ctx, r, top) {
    const n = r.holes.length, rows = n > 9 ? 2 : 1, cell = (this.W - 160) / 9;
    for (let row = 0; row < rows; row++) {
      for (let k = 0; k < 9; k++) {
        const i = row * 9 + k; if (i >= n) break;
        const x = 80 + k * cell, y = top + row * 150, s = r.holes[i].strokes, d = s - r.pars[i];
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '600 24px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(String((r.firstHole || 0) + i + 1), x + cell / 2, y + 20);
        const cx = x + cell / 2, cy = y + 72;
        ctx.fillStyle = d <= -1 ? '#e2513f' : d === 0 ? 'rgba(255,255,255,0.14)' : d === 1 ? 'rgba(80,140,220,0.55)' : 'rgba(10,20,40,0.6)';
        ctx.beginPath(); if (d <= -1) ctx.arc(cx, cy, 36, 0, Math.PI * 2); else if (ctx.roundRect) ctx.roundRect(cx - 36, cy - 36, 72, 72, 12); else ctx.rect(cx - 36, cy - 36, 72, 72); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '700 38px Inter, system-ui, sans-serif'; ctx.fillText(String(s), cx, cy + 13);
        ctx.textAlign = 'left';
      }
    }
  },

  async achievement(a) {
    await this.fonts(); const c = this.canvas(), ctx = c.getContext('2d'); const { W, H } = this;
    this.background(ctx);
    this.label(ctx, 'Achievement unlocked', 80, 300);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(230,207,133,0.16)'; ctx.beginPath(); ctx.arc(W / 2, 600, 210, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#e6cf85'; ctx.lineWidth = 6; ctx.stroke();
    ctx.font = '220px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(a.icon, W / 2, 680);
    ctx.font = '600 96px Fraunces, Georgia, serif'; ctx.fillText(a.name, W / 2, 940);
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '500 40px Inter, system-ui, sans-serif'; ctx.fillText(a.desc, W / 2, 1010);
    ctx.textAlign = 'left';
    this.footer(ctx);
    return c;
  },

  footer(ctx) {
    const { W, H } = this; const p = App.state.profile;
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(80, H - 150, W - 160, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '500 30px Inter, system-ui, sans-serif';
    ctx.fillText(p.name ? p.name + ' · tracked with Fairway Lab' : 'Tracked with Fairway Lab', 80, H - 90);
  },

  fit(ctx, text, max) { let t = text; while (ctx.measureText(t).width > max && t.length > 4) t = t.slice(0, -2); return t === text ? t : t + '…'; },

  /* Share the image with the system share sheet, or download it. */
  async send(canvas, name, text) {
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    const file = new File([blob], name + '.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000); return 'downloaded';
  },
};

Object.assign(Actions, {
  async shareRound(el) {
    const r = App.rounds().find(x => x.id === el.dataset.id); if (!r) return;
    const c = await Share.round(r); const how = await Share.send(c, 'round-' + r.date, `${r.grossScore ?? r.score} at ${r.course || 'the course'} ⛳`);
    if (how === 'downloaded') App.toast('Image saved. Share it from your photos.');
  },
  async shareAchievement(el) {
    const a = achievements().find(x => x.id === el.dataset.id); if (!a || !a.done) return;
    const c = await Share.achievement(a); const how = await Share.send(c, 'achievement-' + a.id, `${a.icon} ${a.name}: ${a.desc}`);
    if (how === 'downloaded') App.toast('Image saved. Share it from your photos.');
  },
});
