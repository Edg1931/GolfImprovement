/* Playing partners: up to three more players on the live scorecard, each with their own handicap
   strokes, plus a group leaderboard for stroke play (gross and net), Stableford and net skins. */

const Group = {
  MAX: 3,
  /* Add partners from the start-round form (fields pname_k / pidx_k). `r` has the rating and slope in play. */
  attach(lr, v, r) {
    const n = lr.holes.length, par = sum(lr.pars);
    const players = [];
    for (let k = 0; k < this.MAX; k++) {
      const name = (v['pname_' + k] || '').trim(); if (!name) continue;
      const idx = v['pidx_' + k] === '' || v['pidx_' + k] == null ? null : parseFloat(v['pidx_' + k]);
      const ch = idx == null || isNaN(idx) ? null : (n === 9 ? courseHandicap9(idx, r.slope, r.rating, par) : courseHandicap(idx, r.slope, r.rating, par));
      players.push({ id: uid(), name: name.slice(0, 24), index: idx == null || isNaN(idx) ? null : idx, ch, scores: Array(n).fill(null) });
    }
    if (players.length) lr.players = players;
  },

  /* Everyone in the group, you first, as {name, ch, scores}. */
  everyone(lr) {
    return [{ id: 'me', name: 'You', ch: lr.ch, scores: lr.holes.map(h => h.strokes) }].concat((lr.players || []).map(p => ({ id: p.id, name: p.name, ch: p.ch, scores: p.scores })));
  },
  rec(ch, lr, i) { return ch != null ? strokesOnHole(ch, lr.si[i], lr.holes.length) : 0; },

  /* Totals for each player: gross, net to par (holes played), Stableford points and skins won. */
  table(lr) {
    const ps = this.everyone(lr);
    const rows = ps.map(p => {
      let gross = 0, par = 0, net = 0, pts = 0, thru = 0;
      p.scores.forEach((s, i) => {
        if (s == null) return;
        const rec = this.rec(p.ch, lr, i);
        thru++; gross += s; par += lr.pars[i]; net += s - rec; pts += stablefordPoints(s, lr.pars[i], rec);
      });
      return { ...p, gross, toPar: gross - par, netToPar: net - par, pts, thru, skins: 0 };
    });
    // net skins: the lowest net score on a hole wins it outright; ties carry the skin to the next hole
    let carry = 0;
    lr.holes.forEach((_, i) => {
      if (ps.some(p => p.scores[i] == null)) return;
      const nets = ps.map(p => p.scores[i] - this.rec(p.ch, lr, i));
      const low = Math.min(...nets), winners = nets.map((v, k) => v === low ? k : -1).filter(k => k >= 0);
      if (winners.length === 1) { rows[winners[0]].skins += 1 + carry; carry = 0; } else carry++;
    });
    rows.carry = carry;
    return rows;
  },

  card(lr) {
    if (!lr.players || !lr.players.length) return '';
    const i = lr.cur, par = lr.pars[i], no = (lr.first || 0) + i + 1;
    const rows = this.table(lr);
    const lead = key => Math.max(...rows.map(r => r[key]));
    return `<div class="card mt group-card"><div class="card-head"><h3>Group · hole ${no}</h3><span class="small muted">net skins${rows.carry ? ` · ${rows.carry} carried` : ''}</span></div>
      ${this.inputs(lr)}
      <div class="table-wrap mt"><table class="group-table"><thead><tr><th>Player</th><th class="num">Thru</th><th class="num">Gross</th><th class="num">Net</th><th class="num">Pts</th><th class="num">Skins</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><strong>${escapeHtml(r.name)}</strong>${r.ch != null ? ` <span class="tiny muted">(${r.ch})</span>` : ''}</td><td class="num">${r.thru}</td><td class="num">${r.thru ? r.gross + ' <span class="tiny muted">' + toPar(r.toPar) + '</span>' : '—'}</td><td class="num">${r.thru ? toPar(r.netToPar) : '—'}</td><td class="num ${r.thru && r.pts === lead('pts') ? 'lead' : ''}">${r.pts}</td><td class="num ${r.skins && r.skins === lead('skins') ? 'lead' : ''}">${r.skins}</td></tr>`).join('')}</tbody></table></div></div>`;
  },

  /* Score steppers for the partners on the current hole (you enter your own score above). */
  inputs(lr) {
    const i = lr.cur, par = lr.pars[i];
    return `<div class="group-inputs">${lr.players.map((p, k) => {
      const s = p.scores[i], rec = this.rec(p.ch, lr, i);
      return `<div class="group-in"><span class="gi-name">${escapeHtml(p.name)}${rec > 0 ? ` <span class="tiny muted">${'•'.repeat(Math.min(rec, 3))}</span>` : ''}</span>
        <div class="stepper sm"><button class="step" data-action="partnerStep" data-p="${k}" data-d="-1" aria-label="${escapeHtml(p.name)}: one fewer">−</button><output class="step-val ${scoreClass(s, par)}">${s != null ? s : '–'}</output><button class="step" data-action="partnerStep" data-p="${k}" data-d="1" aria-label="${escapeHtml(p.name)}: one more">+</button></div></div>`;
    }).join('')}</div>`;
  },

  /* Results kept with the saved round. */
  results(lr) { return lr.players && lr.players.length ? this.table(lr).map(r => ({ id: r.id, name: r.name, ch: r.ch, gross: r.gross, netToPar: r.netToPar, pts: r.pts, skins: r.skins, thru: r.thru, scores: r.scores })) : null; },
  resultsHtml(r) {
    if (!r.players || !r.players.length) return '';
    return `<div class="table-wrap mt"><table class="group-table"><thead><tr><th>Group</th><th class="num">Gross</th><th class="num">Net</th><th class="num">Pts</th><th class="num">Skins</th></tr></thead><tbody>
      ${r.players.map(p => `<tr><td><strong>${escapeHtml(p.name)}</strong></td><td class="num">${p.thru ? p.gross : '—'}</td><td class="num">${p.thru ? toPar(p.netToPar) : '—'}</td><td class="num">${p.pts}</td><td class="num">${p.skins}</td></tr>`).join('')}</tbody></table></div>`;
  },

  /* Fields on the start-round form. */
  formHtml() {
    return `<details class="accordion"><summary>Playing partners <span class="small muted">(optional, up to 3)</span></summary><div class="acc-body">
      <p class="tiny muted">Add names and handicap indexes to keep their scores too, with a net leaderboard, Stableford points and skins.</p>
      ${[0, 1, 2].map(k => `<div class="form-row"><div class="field"><label>Player ${k + 2}</label><input name="pname_${k}" maxlength="24" placeholder="Name"></div><div class="field"><label>Index</label><input type="number" step="0.1" name="pidx_${k}" placeholder="e.g. 14.2"></div></div>`).join('')}
    </div></details>`;
  },
};

Object.assign(Actions, {
  partnerStep(el) {
    App.haptic();
    const lr = App.state.liveRound; if (!lr || !lr.players) return;
    const p = lr.players[+el.dataset.p]; if (!p) return; const i = lr.cur, d = +el.dataset.d;
    p.scores[i] = p.scores[i] == null ? lr.pars[i] : Math.max(1, Math.min(15, p.scores[i] + d));
    Store.save(); App.render();
  },
});
