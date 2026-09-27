/* Minimal canvas charts (no dependencies). Each function takes a canvas element and data. */
const Charts = {
  _prep(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(200, rect.width), h = Math.max(120, rect.height);
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    return { ctx, w, h, colors: {
      text: css.getPropertyValue('--text-muted').trim() || '#666',
      grid: css.getPropertyValue('--border').trim() || '#ddd',
      accent: css.getPropertyValue('--accent').trim() || '#1f5f3f',
      gold: css.getPropertyValue('--gold').trim() || '#c9a227',
      blue: css.getPropertyValue('--blue').trim() || '#2f6fb0',
      red: css.getPropertyValue('--red').trim() || '#c24a3a',
    } };
  },
  empty(canvas, msg) {
    const { ctx, w, h, colors } = this._prep(canvas);
    ctx.fillStyle = colors.text; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(msg || 'No data yet', w / 2, h / 2);
  },
  /* series: [{label, values:[number|null], color}], labels: [] */
  line(canvas, labels, series, opts) {
    opts = opts || {};
    if (!labels.length) return this.empty(canvas, opts.emptyMsg);
    const { ctx, w, h, colors } = this._prep(canvas);
    const padL = 36, padR = 12, padT = 14, padB = 26;
    const all = series.flatMap(s => s.values).filter(v => v != null);
    if (!all.length) return this.empty(canvas, opts.emptyMsg);
    let min = Math.min(...all), max = Math.max(...all);
    if (opts.target != null) { min = Math.min(min, opts.target); max = Math.max(max, opts.target); }
    if (max - min < 2) { min -= 1; max += 1; }
    const pad = (max - min) * 0.1; min -= pad; max += pad;
    if (opts.invert) { /* lower is better: still plotted normally */ }
    const x = i => padL + (labels.length === 1 ? (w - padL - padR) / 2 : (i / (labels.length - 1)) * (w - padL - padR));
    const y = v => padT + (1 - (v - min) / (max - min)) * (h - padT - padB);
    ctx.strokeStyle = colors.grid; ctx.lineWidth = 1; ctx.fillStyle = colors.text; ctx.font = '11px sans-serif'; ctx.textAlign = 'right';
    const ticks = 4;
    for (let t = 0; t <= ticks; t++) {
      const v = min + (max - min) * (t / ticks), yy = y(v);
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
      ctx.fillText(Math.round(v * 10) / 10, padL - 6, yy + 4);
    }
    ctx.textAlign = 'center';
    const step = Math.ceil(labels.length / 6);
    labels.forEach((l, i) => { if (i % step === 0 || i === labels.length - 1) ctx.fillText(l, x(i), h - 8); });
    if (opts.target != null) {
      ctx.setLineDash([5, 4]); ctx.strokeStyle = colors.gold; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(padL, y(opts.target)); ctx.lineTo(w - padR, y(opts.target)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = colors.gold; ctx.textAlign = 'left'; ctx.fillText('target ' + opts.target, padL + 4, y(opts.target) - 4);
    }
    series.forEach(s => {
      const col = colors[s.color] || s.color || colors.accent;
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); let started = false;
      s.values.forEach((v, i) => { if (v == null) { started = false; return; } if (!started) { ctx.moveTo(x(i), y(v)); started = true; } else ctx.lineTo(x(i), y(v)); });
      ctx.stroke();
      ctx.fillStyle = col;
      s.values.forEach((v, i) => { if (v == null) return; ctx.beginPath(); ctx.arc(x(i), y(v), 3, 0, Math.PI * 2); ctx.fill(); });
    });
    if (series.length > 1) {
      ctx.font = '11px sans-serif'; let lx = padL + 4;
      series.forEach(s => { const col = colors[s.color] || s.color || colors.accent; ctx.fillStyle = col; ctx.fillRect(lx, padT - 10, 10, 3); ctx.fillStyle = colors.text; ctx.textAlign = 'left'; ctx.fillText(s.label, lx + 14, padT - 5); lx += 14 + ctx.measureText(s.label).width + 14; });
    }
  },
  /* bars: [{label, value, color}] */
  bar(canvas, bars, opts) {
    opts = opts || {};
    const { ctx, w, h, colors } = this._prep(canvas);
    if (!bars.length || bars.every(b => !b.value)) return this.empty(canvas, opts.emptyMsg);
    const padL = 36, padR = 10, padT = 12, padB = 30;
    const max = Math.max(...bars.map(b => b.value), opts.max || 0) || 1;
    const bw = (w - padL - padR) / bars.length;
    ctx.strokeStyle = colors.grid; ctx.fillStyle = colors.text; ctx.font = '11px sans-serif'; ctx.textAlign = 'right';
    for (let t = 0; t <= 4; t++) { const v = max * t / 4, yy = padT + (1 - t / 4) * (h - padT - padB); ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke(); ctx.fillText(max < 8 ? (Math.round(v * 10) / 10) : Math.round(v), padL - 6, yy + 4); }
    bars.forEach((b, i) => {
      const bh = (b.value / max) * (h - padT - padB);
      const x0 = padL + i * bw + bw * 0.15;
      ctx.fillStyle = colors[b.color] || b.color || colors.accent;
      ctx.fillRect(x0, h - padB - bh, bw * 0.7, bh);
      ctx.fillStyle = colors.text; ctx.textAlign = 'center'; ctx.fillText(b.label, x0 + bw * 0.35, h - 10);
      if (b.value) ctx.fillText(opts.suffix ? b.value + opts.suffix : b.value, x0 + bw * 0.35, h - padB - bh - 4);
    });
  },
  /* radar: axes [{label, value (0..1), bench (0..1)}] */
  radar(canvas, axes, opts) {
    opts = opts || {};
    const { ctx, w, h, colors } = this._prep(canvas);
    if (!axes.length) return this.empty(canvas, opts.emptyMsg);
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 34; const n = axes.length;
    const pt = (i, v) => { const a = -Math.PI / 2 + (i / n) * Math.PI * 2; return [cx + Math.cos(a) * r * v, cy + Math.sin(a) * r * v]; };
    ctx.strokeStyle = colors.grid; ctx.lineWidth = 1;
    for (let ring = 1; ring <= 4; ring++) { ctx.beginPath(); for (let i = 0; i <= n; i++) { const [x, y] = pt(i % n, ring / 4); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
    for (let i = 0; i < n; i++) { const [x, y] = pt(i, 1); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke(); }
    const draw = (key, col, fill) => {
      ctx.beginPath(); axes.forEach((a, i) => { const [x, y] = pt(i, Math.max(0, Math.min(1, a[key] || 0))); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath();
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke(); if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    };
    if (axes.some(a => a.bench != null)) draw('bench', colors.gold, null);
    draw('value', colors.accent, 'rgba(58,154,104,0.25)');
    ctx.fillStyle = colors.text; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    axes.forEach((a, i) => { const [x, y] = pt(i, 1.17); ctx.fillText(a.label, x, y + 4); });
  },
};
