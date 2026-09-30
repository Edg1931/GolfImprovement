/* Plan vs what happened: after a round, each hole's plan is compared with the shots that were tracked.
   When the player hit a different club off the tee than planned, the caddie simulation says what that
   choice cost (or saved) on average from that spot, so the number is about the decision, not the
   bounce the ball happened to take. */

const PlanReview = {
  /* The plans for the holes played, kept with the round so later edits to a plan don't rewrite history. */
  snapshot(course, lr) {
    if (!course || !course.plans) return null;
    const out = {}; lr.holes.forEach((_, i) => { const n = (lr.first || 0) + i + 1; if (course.plans[n] && course.plans[n].length) out[n] = course.plans[n].map(p => ({ ...p })); });
    return Object.keys(out).length ? out : null;
  },
  plansFor(r, course) { return r.plans || (course && course.plans) || {}; },

  hole(r, i, course, models) {
    const n = (r.firstHole || 0) + i + 1, h = r.holes[i], plan = this.plansFor(r, course)[n];
    if (!plan || !plan.length || !h.shots || !h.shots.length) return null;
    const played = h.shots.map(s => s.club || '?');
    const planned = plan.map(p => p.club);
    const out = { n, par: r.pars[i], planned, played, followed: played[0] === planned[0], cost: null, strokes: h.strokes };
    const sg = SG.hole(h, r.pars[i], App.targetHcp());
    if (sg && sg.shots[0]) out.sgTee = sg.shots[0].sg;
    if (!out.followed && course) {
      const mP = models.find(m => m.club === planned[0]), mA = models.find(m => m.club === played[0]);
      const pin = r.pins && r.pins[n];
      const g = mP && mA ? CourseMap.holeGeometry(course, n, h.shots[0].from, pin) : null;
      if (g && g.features.length) {
        const t = g.proj.toXY(plan[0].aim), c = { features: g.features, green: g.green };
        const eP = Caddie.simulate(g.start, t, mP, c, { samples: 400, seed: 13 }).expected;
        const eA = Caddie.simulate(g.start, t, mA, c, { samples: 400, seed: 13 }).expected;
        out.cost = eA - eP;   // + = the club hit was the worse choice on average
      }
    }
    return out;
  },

  round(r) {
    if (!r.holes) return null;
    const course = App.state.courses.find(c => c.id === r.courseId);
    const models = Caddie.bagModels(App.state.clubs, App.state.shotLog, App.index());
    const holes = r.holes.map((_, i) => this.hole(r, i, course, models)).filter(Boolean);
    if (!holes.length) return null;
    const dev = holes.filter(x => !x.followed);
    return { holes, planned: holes.length, followed: holes.length - dev.length, cost: dev.reduce((s, x) => s + (x.cost || 0), 0), costed: dev.filter(x => x.cost != null).length };
  },

  html(r) {
    const x = this.round(r); if (!x) return '';
    const cost = x.cost, sign = v => (v >= 0 ? '' : '−') + Math.abs(v).toFixed(1);
    const lines = x.holes.filter(h => !h.followed).map(h => `<li><strong>Hole ${h.n}:</strong> planned ${escapeHtml(h.planned.join(' → '))}, played ${escapeHtml(h.played.join(' → '))}${h.cost == null ? '' : Math.abs(h.cost) < 0.05 ? '. About the same either way.' : h.cost > 0 ? `. ${escapeHtml(h.played[0])} there costs about <span class="sg-neg">${h.cost.toFixed(1)} strokes</span> on average.` : `. ${escapeHtml(h.played[0])} was the better call, by about <span class="sg-pos">${(-h.cost).toFixed(1)}</span>.`}</li>`);
    return `<div class="plan-check mt"><div class="entry-label">Plan vs what happened</div>
      <p class="small mb0">You stuck to your plan off the tee on <strong>${x.followed} of ${x.planned}</strong> planned hole${x.planned === 1 ? '' : 's'}.${x.costed ? ` Changing clubs ${cost > 0.05 ? `cost about <strong class="sg-neg">${cost.toFixed(1)} strokes</strong>` : cost < -0.05 ? `saved about <strong class="sg-pos">${sign(-cost)} strokes</strong>` : 'made no real difference'} on average.` : ''}</p>
      ${lines.length ? `<ul class="small plan-dev">${lines.join('')}</ul>` : ''}</div>`;
  },

  /* Course management across recent rounds, for the Stats page. */
  card(rounds, n) {
    const list = rounds.slice(0, n).map(r => ({ r, x: this.round(r) })).filter(v => v.x);
    if (!list.length) return '';
    const holes = list.flatMap(v => v.x.holes), dev = holes.filter(h => !h.followed), fol = holes.filter(h => h.followed);
    const avgSG = arr => { const a = arr.filter(h => h.sgTee != null); return a.length ? a.reduce((s, h) => s + h.sgTee, 0) / a.length : null; };
    const toPar = arr => arr.length ? arr.reduce((s, h) => s + h.strokes - h.par, 0) / arr.length : null;
    const cost = dev.reduce((s, h) => s + (h.cost || 0), 0) / list.length;
    const f = v => v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
    return `<div class="card mt"><div class="card-head"><h2>Course management</h2><span class="small muted">planned holes · last ${list.length} round${list.length > 1 ? 's' : ''}</span></div>
      <div class="stat-row">${statBox('Stuck to the plan', Math.round(100 * fol.length / holes.length) + '%', `${fol.length} of ${holes.length} tee shots`)}${statBox('Score vs par', fol.length ? f(toPar(fol)) : '—', 'when you followed it')}${statBox('Score vs par', dev.length ? f(toPar(dev)) : '—', 'when you changed club')}${statBox('Club changes cost', dev.length ? f(cost) : '—', 'strokes per round (average)')}</div>
      <p class="small mt mb0">${dev.length && cost > 0.2 ? 'Going off-plan is costing you. Commit to the club you chose at home: your plan already knows your pattern and the trouble.' : dev.length ? 'Your changes on the day are roughly break-even. Trust whichever you commit to.' : 'You played every planned hole to the plan. That’s good course management.'} Tee-shot strokes gained: ${f(avgSG(fol))} following, ${f(avgSG(dev))} off-plan.</p></div>`;
  },
};
