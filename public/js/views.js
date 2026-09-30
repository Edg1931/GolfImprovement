/* View renderers. Each returns an HTML string; post-render work is queued with App.after(fn). */
const Views = {};

/* ---------- shared fragments ---------- */
function dots(n) { return '<span class="dots">' + [1, 2, 3].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('') + '</span>'; }
function drillCard(d, compact) {
  const fav = App.state.favorites.includes(d.id);
  return `<div class="card tight drill-card" data-action="openDrill" data-id="${d.id}" role="button" tabindex="0">
    <button class="fav-btn ${fav ? 'on' : ''}" data-action="toggleFav" data-id="${d.id}" title="Favourite" aria-label="Toggle favourite">★</button>
    <span class="tag ${d.category}">${categoryLabel(d.category)}</span>
    <h3>${escapeHtml(d.name)}</h3>
    ${compact ? '' : `<p class="small muted mb0">${escapeHtml(d.summary)}</p>`}
    <div class="drill-meta"><span>⏱ ${d.minutes} min</span><span>Difficulty ${dots(d.difficulty)}</span></div>
  </div>`;
}
/* Subtitle under the Handicap Index: how it was worked out. */
function indexSub(rounds, trendText) {
  const info = App.indexInfo(); const valid = rounds.filter(r => r.diff != null).length;
  if (info.index == null) return `${valid}/3 scores needed`;
  if (info.starting) return `Starting index · ${valid}/3 scores to calculate`;
  const rule = whsRule(Math.min(valid, 20));
  let t = trendText || ('best ' + rule.use + ' of last ' + Math.min(valid, 20));
  if (info.cap) t += ` · ${info.cap} cap (low ${fmt1(info.lhi)}, uncapped ${fmt1(info.raw)})`;
  return t;
}
function lowDiff(rounds) { const d = rounds.map(r => r.diff).filter(x => x != null).slice(0, 20); return d.length ? fmt1(Math.min(...d)) : '—'; }
function holesLabel(r) { return r.holesPlayed === 9 ? ` <span class="badge neutral" title="Nine-hole round">${r.nine === 'back' ? 'B9' : r.nine === 'front' ? 'F9' : '9'}</span>` : ''; }
function drillLink(id) { const d = getDrill(id); return d ? `<a href="#" data-action="openDrill" data-id="${d.id}">${escapeHtml(d.name)}</a>` : escapeHtml(id); }
function statBox(label, value, sub, cls) { return `<div class="stat ${cls || ''}"><span class="label">${label}</span><span class="value">${value}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</div>`; }
function onboardingModal() {
  return `<div class="welcome"><img src="icons/icon.svg" alt="" width="56" height="56"><p class="eyebrow">Welcome to Fairway Lab</p><h2>Let's set up your game</h2>
    <p class="small muted">Thirty seconds now means your plan, targets and stats make sense from day one.</p></div>
    <form class="form" data-form="onboard">
      <div class="field"><label>Your first name</label><input name="name" autocomplete="given-name" placeholder="Optional"></div>
      <div class="form-row">
        <div class="field"><label>Current Handicap Index</label><input type="number" step="0.1" min="-10" max="54" name="startIndex" placeholder="e.g. 14.2" inputmode="decimal"><span class="hint">From your club or golf app. Leave blank if you don't have one.</span></div>
        <div class="field"><label>Target index</label><input type="number" step="0.1" min="-10" max="54" name="targetIndex" placeholder="e.g. 9.9" inputmode="decimal"><span class="hint">Blank = 4 shots better in 6 months.</span></div>
      </div>
      <div class="field"><label>Time for practice each week</label><div class="seg">${TIME_BUDGETS.map(b => `<label class="seg-opt"><input type="radio" name="budget" value="${b.id}" ${b.id === 'standard' ? 'checked' : ''}><span>${b.label}<small>${b.hours}</small></span></label>`).join('')}</div></div>
      <button class="btn primary lg" type="submit">Start improving →</button>
      <div class="btn-row" style="justify-content:center"><button type="button" class="btn ghost sm" data-action="onboardDemo">Explore with demo data</button><button type="button" class="btn ghost sm" data-action="skipOnboarding">Skip</button></div>
    </form>`;
}
function onboarding() {
  return `<div class="card accent"><h2>Welcome to Fairway Lab</h2>
    <p>A complete system for lowering your handicap: track rounds, find where you lose strokes, follow a schedule of measurable drills, and test your skills every few weeks.</p>
    <ol class="mb0" style="padding-left:1.2rem">
      <li><a href="#/goals">Set a target handicap</a> and a date.</li>
      <li><a href="#/rounds">Log your last few rounds</a> with stats (3 rounds gives you a handicap index).</li>
      <li><a href="#/assessment">Run the Skills Test</a> to find your weakest areas.</li>
      <li><a href="#/plan">Follow your practice schedule</a> and log sessions.</li>
    </ol></div>`;
}

/* ---------- Dashboard ---------- */
Views.dashboard = function () {
  const rounds = App.rounds(); const idx = App.index(); const p = App.state.profile;
  const st5 = roundStats(rounds, 5); const stAll = roundStats(rounds, 20);
  const hist = indexHistory(rounds);
  const prev = hist.length > 5 ? hist[hist.length - 6].index : null;
  const trend = (idx != null && prev != null) ? idx - prev : null;
  const tier = App.tier();
  const plan = App.weekPlan().plan;
  const wk = isoWeekKey(new Date()); const checks = App.state.planChecks[wk] || {};
  const planned = plan.filter(d => d.session); const done = planned.filter(d => checks[d.day]).length;
  const analysis = strokeLossAnalysis(stAll, App.targetHcp());
  const recs = recommendDrills(analysis, 2);
  const prog = App.programWeek();

  const hour = new Date().getHours(); const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const todayName = DAYS[(new Date().getDay() + 6) % 7]; const today = plan.find(d => d.day === todayName);
  const ach = achievements(); const achDone = ach.filter(a => a.done);
  const lr = App.state.liveRound;
  let html = `<div class="page-head"><div><p class="eyebrow">${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p><h1>${greet}${p.name ? ', ' + escapeHtml(p.name) : ''}</h1><p class="muted">${rounds.length ? rounds.length + ' round' + (rounds.length > 1 ? 's' : '') + ' logged · ' + achDone.length + '/' + ach.length + ' achievements' : 'Your golf improvement hub.'}</p></div>
    <div class="btn-row"><a class="btn primary" href="#/play">⛳ Play a round</a><a class="btn" href="#/rounds">+ Log round</a><a class="btn" href="#/sessions">+ Log practice</a></div></div>`;
  if (lr) { const t = liveTotals(lr); html += `<a class="resume card" href="#/play"><span class="pulse" aria-hidden="true"></span><div><strong>Round in progress · ${escapeHtml(lr.course)}</strong><div class="small muted">Thru ${t.thru} · ${t.thru ? toPar(t.toPar) : 'E'} · tap to resume on hole ${lr.cur + 1}</div></div><span class="btn primary sm">Resume ›</span></a>`; }
  if (!rounds.length) html += onboarding();

  html += `<div class="hero">
    <div class="card accent"><div class="stat-row">
      ${statBox('Handicap Index', idx != null ? fmt1(idx) : '—', indexSub(rounds, trend != null ? (trend <= 0 ? '▼ ' : '▲ ') + fmt1(Math.abs(trend)) + ' vs 5 rounds ago' : null))}
      ${statBox('Target', p.targetIndex != null ? fmt1(p.targetIndex) : '—', p.targetDate ? 'by ' + fmtDate(p.targetDate) : '<a href="#/goals">Set a goal</a>')}
      ${statBox('Avg score (last 5)', st5 ? Math.round(st5.score) : '—', st5 ? 'best ' + Math.min(...App.fullRounds().slice(0, 5).map(r => r.grossScore ?? r.score)) : '')}
    </div>
    ${(idx != null && p.targetIndex != null) ? App.goalProgressBar(idx) : ''}
    ${rounds.length ? `<div class="kv mt small"><dt>Rounds counting</dt><dd>${App.countedDiffs().length} best of last ${Math.min(rounds.length, 20)}</dd><dt>Low differential</dt><dd>${lowDiff(rounds)}</dd><dt>Level</dt><dd>${tier.label} (${tier.range})</dd>${prog ? `<dt>Program</dt><dd>Week ${prog.week} of 12</dd>` : ''}</div>` : ''}
    </div>
    <div class="card"><div class="card-head"><h3>Index trend</h3><a class="small" href="#/rounds">All rounds</a></div><canvas class="chart" id="dashIndexChart"></canvas></div>
  </div>`;

  html += `<div class="grid grid-2 mt"><div class="card today"><div class="card-head"><h3>Today · ${todayName}</h3><a class="small" href="#/plan">Schedule</a></div>
      ${today && today.session ? `<div class="today-body"><div><div class="today-title">${escapeHtml(today.session.name)}</div><p class="small muted mb0">${today.session.minutes} min · ${today.session.drills.map(([id, m]) => drillLink(id) + ` <span class="muted">${m}′</span>`).join(' · ')}</p></div>
        <div class="btn-row">${checks[todayName] ? '<span class="badge good">✓ Done</span>' : `<button class="btn primary sm" data-action="startTodaySession" data-sid="${today.session.id}">Start session</button>`}</div></div>`
      : `<p class="muted mb0">Rest day. Ten minutes of putting on the carpet or a mobility flow keeps the feel alive.</p>`}
      ${prog ? `<p class="tiny muted mt mb0">Program week ${prog.week}: ${escapeHtml(PROGRAM.weekThemes[prog.week])}</p>` : ''}</div>
    <div class="card"><div class="card-head"><h3>Achievements</h3><a class="small" href="#/goals">All ${ach.length}</a></div>
      <div class="ach-strip">${ach.slice().sort((a, b) => b.done - a.done).slice(0, 8).map(a => `<span class="ach-chip ${a.done ? 'on' : ''}" title="${escapeHtml(a.name + ': ' + a.desc)}">${a.icon}</span>`).join('')}</div>
      <p class="small muted mb0 mt">${achDone.length ? `${achDone.length} unlocked. Next up: <strong>${escapeHtml((ach.find(a => !a.done) || { name: 'all done!' }).name)}</strong> ${escapeHtml((ach.find(a => !a.done) || { desc: '' }).desc.toLowerCase())}.` : 'Log a round to unlock your first badge.'}</p></div>
  </div>`;

  html += `<div class="grid grid-4 mt">
    <div class="card tight">${statBox('Putts / round', st5 ? fmt1(st5.putts) : '—', 'last 5 rounds')}</div>
    <div class="card tight">${statBox('Greens in reg.', st5 && st5.gir != null ? fmt1(st5.gir) : '—', st5 && st5.girPct != null ? Math.round(st5.girPct) + '% of 18' : '')}</div>
    <div class="card tight">${statBox('Fairways', st5 && st5.firPct != null ? Math.round(st5.firPct) + '%' : '—', 'last 5 rounds')}</div>
    <div class="card tight">${statBox('Scrambling', st5 && st5.scrambling != null ? Math.round(st5.scrambling) + '%' : '—', 'up-and-down rate')}</div>
  </div>`;

  html += `<div class="grid grid-2 mt">
    <div class="card"><div class="card-head"><h3>This week's practice</h3><a class="small" href="#/plan">Full schedule</a></div>
      <p class="muted small">${tier.label} plan · ${TIME_BUDGETS.find(b => b.id === p.budget).hours} · ${done}/${planned.length} sessions done</p>
      <div class="progress mb"><span style="width:${pct(done, planned.length)}%"></span></div>
      <ul class="checklist">${plan.filter(d => d.session).map(d => `<li><input type="checkbox" data-change="planCheck" data-week="${wk}" data-day="${d.day}" ${checks[d.day] ? 'checked' : ''}><div><strong class="${checks[d.day] ? 'done' : ''}">${d.day} · ${escapeHtml(d.session.name)}</strong><div class="small muted">${d.session.minutes} min · ${d.session.drills.map(([id]) => drillLink(id)).join(', ')}</div></div></li>`).join('')}</ul>
    </div>
    <div class="card"><div class="card-head"><h3>Where you lose strokes</h3><a class="small" href="#/stats">Full analysis</a></div>
      ${analysis.length ? recs.length ? recs.map((r, i) => `<div class="rank"><div class="n ${['', 'two', 'three'][i]}">${i + 1}</div><div><h3>${r.area.label}</h3><p class="small muted mb0">You: ${r.area.yours} · Benchmark (${App.targetHcp()} hcp): ${r.area.bench} · ≈ <strong>${fmt1(r.area.loss)} strokes/round</strong></p><p class="small mb0">Drills: ${r.drills.map(d => drillLink(d.id)).join(' · ')}</p></div></div>`).join('') : '<div class="callout">Your stats already match your target benchmark in every area. Time to raise the target!</div>' : '<div class="empty">Log rounds with putts, greens and fairways to see your stroke-loss analysis.</div>'}
    </div>
  </div>`;

  html += `<div class="grid grid-2 mt">
    <div class="card"><div class="card-head"><h3>12-week program</h3><a class="small" href="#/plan">Details</a></div>
      ${prog ? `<p><strong>Week ${prog.week} of 12</strong> · ${escapeHtml(prog.phase.name)}</p><div class="phase-bar">${[...Array(12)].map((_, i) => `<span class="${i < 4 ? 'p1' : i < 8 ? 'p2' : 'p3'} ${i + 1 === prog.week ? 'current' : ''}"></span>`).join('')}</div><p class="small muted mb0">This week: ${escapeHtml(PROGRAM.weekThemes[prog.week])}</p>` : `<p class="muted">Not started. The program structures 12 weeks into Foundation, Build and Perform phases.</p><button class="btn primary sm" data-action="startProgram">Start the 12-week program</button>`}
    </div>
    <div class="card"><div class="card-head"><h3>Recent rounds</h3><a class="small" href="#/rounds">All</a></div>
      ${rounds.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Course</th><th class="num">Score</th><th class="num">Diff</th><th class="num">Putts</th></tr></thead><tbody>${rounds.slice(0, 5).map(r => `<tr><td>${fmtDate(r.date)}</td><td>${escapeHtml(r.course || '—')}${holesLabel(r)}</td><td class="num">${r.grossScore ?? r.score}</td><td class="num">${fmt1(r.diff)}</td><td class="num">${r.putts != null ? r.putts : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No rounds yet.</div>'}
    </div>
  </div>`;

  App.after(() => {
    const c = document.getElementById('dashIndexChart'); if (!c) return;
    const withIdx = hist.filter(h => h.index != null);
    Charts.line(c, withIdx.map(h => fmtDate(h.date)), [{ label: 'Index', values: withIdx.map(h => h.index) }], { target: p.targetIndex != null ? p.targetIndex : undefined, emptyMsg: 'Log 3 rounds to see your index trend' });
  });
  return html;
};

/* ---------- Rounds ---------- */
Views.rounds = function () {
  const rounds = App.rounds(); const idx = App.index(); const p = App.state.profile;
  const saved = App.ui.roundCourse ? App.state.courses.find(c => c.id === App.ui.roundCourse) : null;
  const last = saved ? { course: saved.name, tees: saved.tees, rating: saved.rating, slope: saved.slope, par: sum(saved.pars) } : (rounds[0] || {});
  const hist = indexHistory(rounds);
  let html = `<div class="page-head"><div><h1>Rounds &amp; Handicap</h1><p class="muted">Log every round with stats. Your Handicap Index follows the World Handicap System (best 8 of your last 20 differentials).</p></div></div>`;
  html += `<div class="grid grid-3">
    <div class="card accent">${statBox('Handicap Index', idx != null ? fmt1(idx) : '—', indexSub(rounds))}</div>
    <div class="card">${statBox('Low differential', lowDiff(rounds), 'last 20 scores')}</div>
    <div class="card">${statBox('Avg score', App.fullRounds().length ? fmt1(avg(App.fullRounds().slice(0, 20).map(r => r.grossScore ?? r.score))) : '—', 'last 20 full rounds')}</div>
  </div>`;

  html += `<div class="grid grid-2 mt"><div class="card"><div class="card-head"><h2>Log a round</h2><a class="btn sm" href="#/play">⛳ Score hole by hole</a></div>
  <form class="form" data-form="round">
    ${App.state.courses.length ? `<div class="field"><label>Saved course</label><select data-change="roundCourse"><option value="">Type it in…</option>${App.state.courses.map(c => `<option value="${c.id}" ${saved && saved.id === c.id ? 'selected' : ''}>${escapeHtml(c.name)}${c.tees ? ' · ' + escapeHtml(c.tees) : ''}</option>`).join('')}</select></div>` : ''}
    <div class="form-row">
      <div class="field"><label>Date</label><input type="date" name="date" value="${todayISO()}" required></div>
      <div class="field"><label>Course</label><input name="course" value="${escapeHtml(last.course || p.homeCourse || '')}" placeholder="Course name"></div>
      <div class="field"><label>Tees</label><input name="tees" value="${escapeHtml(last.tees || '')}" placeholder="White"></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Holes</label><select name="holesPlayed"><option value="18">18 holes</option><option value="9">9 holes</option></select></div>
      <div class="field"><label>Par (holes played)</label><input type="number" name="par" value="${last.par || 72}" min="27" max="80" required></div>
      <div class="field"><label>Course rating</label><input type="number" step="0.1" name="rating" value="${last.rating || ''}" placeholder="71.2" required><span class="hint">On the scorecard</span></div>
      <div class="field"><label>Slope</label><input type="number" name="slope" value="${last.slope || ''}" placeholder="128" min="55" max="155" required></div>
      <div class="field"><label>Score (adjusted gross)</label><input type="number" name="score" placeholder="88" min="25" max="150" required><span class="hint">Cap any hole at net double bogey. For 9 holes, enter the card's 18-hole rating and slope.</span></div>
    </div>
    <fieldset><legend>Stats (optional but powerful)</legend>
    <div class="form-row">
      <div class="field"><label>Putts</label><input type="number" name="putts" min="15" max="60" placeholder="34"></div>
      <div class="field"><label>Fairways hit</label><input type="number" name="firHit" min="0" max="18" placeholder="6"></div>
      <div class="field"><label>Fairways possible</label><input type="number" name="firPossible" min="0" max="18" value="14"></div>
      <div class="field"><label>Greens in reg.</label><input type="number" name="gir" min="0" max="18" placeholder="5"></div>
      <div class="field"><label>Penalty strokes</label><input type="number" name="penalties" min="0" max="20" placeholder="1"></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Up &amp; down attempts</label><input type="number" name="udAtt" min="0" max="18" placeholder="12"></div>
      <div class="field"><label>Up &amp; downs made</label><input type="number" name="udMade" min="0" max="18" placeholder="4"></div>
      <div class="field"><label>Sand attempts</label><input type="number" name="sandAtt" min="0" max="18" placeholder="2"></div>
      <div class="field"><label>Sand saves</label><input type="number" name="sandMade" min="0" max="18" placeholder="1"></div>
      <div class="field"><label>Three-putts</label><input type="number" name="threePutts" min="0" max="18" placeholder="2"></div>
      <div class="field"><label>Doubles or worse</label><input type="number" name="doubles" min="0" max="18" placeholder="3"></div>
    </div></fieldset>
    <div class="field"><label>Notes</label><textarea name="notes" rows="2" placeholder="What went well, what cost you strokes, conditions…"></textarea></div>
    <div class="btn-row"><button class="btn primary" type="submit">Save round</button><span class="small muted">Differential is calculated automatically.</span></div>
  </form></div>
  <div class="card"><div class="card-head"><h3>Scores &amp; index</h3></div><canvas class="chart tall" id="roundsChart"></canvas>
  <div class="callout info mt small"><strong>How the index works.</strong> Each round produces a differential: (113 ÷ slope) × (score − rating). With 3 rounds your index is your best differential minus 2; with 20 rounds it is the average of your best 8. A great round lowers it immediately; a bad round only matters if it pushes a good one out of your last 20.</div></div></div>`;

  html += `<div class="card mt"><div class="card-head"><h2>Round history</h2><span class="muted small">${rounds.length} rounds</span></div>
    ${rounds.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Course</th><th class="num">Score</th><th class="num">Rating/Slope</th><th class="num">Diff</th><th class="num">Putts</th><th class="num">FIR</th><th class="num">GIR</th><th class="num">Pen</th><th class="num">U&amp;D</th><th></th></tr></thead><tbody>
    ${rounds.map((r, i) => `<tr class="${i < 20 && App.countedDiffs().includes(r.id) ? 'highlight' : ''}"><td class="nowrap">${fmtDate(r.date)}</td><td>${escapeHtml(r.course || '—')}${holesLabel(r)}${r.notes ? `<div class="tiny muted">${escapeHtml(r.notes)}</div>` : ''}</td><td class="num"><strong>${r.grossScore ?? r.score}</strong>${r.grossScore != null && r.grossScore !== r.score ? `<div class="tiny muted" title="Adjusted gross score used for handicap">adj ${r.score}</div>` : ''}</td><td class="num">${r.rating}/${r.slope}</td><td class="num" ${r.holesPlayed === 9 ? 'title="18-hole equivalent (WHS nine-hole rule)"' : ''}>${fmt1(r.diff)}</td><td class="num">${r.putts ?? '—'}</td><td class="num">${r.firHit != null ? r.firHit + '/' + r.firPossible : '—'}</td><td class="num">${r.gir ?? '—'}</td><td class="num">${r.penalties ?? '—'}</td><td class="num">${r.udAtt ? r.udMade + '/' + r.udAtt : '—'}</td><td class="nowrap">${r.holes ? `<button class="btn sm" data-action="viewCard" data-id="${r.id}">Card</button>` : `<button class="btn sm ghost" data-action="editRound" data-id="${r.id}" title="Edit" aria-label="Edit round">✎</button><button class="btn sm ghost" data-action="aiSummary" data-id="${r.id}" title="Coach's debrief" aria-label="Coach's debrief">📋</button>`}<button class="btn sm ghost danger" data-action="deleteRound" data-id="${r.id}" title="Delete" aria-label="Delete round">✕</button></td></tr>`).join('')}
    </tbody></table></div><p class="tiny muted mt mb0">Highlighted rows are the differentials currently counting toward your index.</p>` : '<div class="empty">No rounds logged yet. Add your first round above.</div>'}
  </div>`;

  App.after(() => {
    const c = document.getElementById('roundsChart'); if (!c) return;
    const asc = hist.slice(-20);
    Charts.line(c, asc.map(h => fmtDate(h.date)), [{ label: 'Score (18 holes)', values: asc.map((h, i) => { const r = rounds.slice().reverse().slice(-20)[i]; return r.holesPlayed === 9 ? null : h.score; }), color: 'blue' }, { label: 'Differential', values: asc.map((h, i) => rounds.slice().reverse().slice(-20)[i].diff), color: 'accent' }], { emptyMsg: 'Log rounds to see the chart' });
  });
  return html;
};

/* ---------- Stats ---------- */
Views.stats = function () {
  const rounds = App.rounds(); const n = App.ui.statsWindow || 10;
  const st = roundStats(rounds, n); const target = App.targetHcp(); const b = benchmarkFor(target);
  const analysis = strokeLossAnalysis(st, target); const recs = recommendDrills(analysis, 3);
  let html = `<div class="page-head"><div><h1>Stats &amp; Stroke Loss</h1><p class="muted">Compare your averages to a benchmark golfer at your target handicap and see where the strokes go.</p></div>
    <div class="chip-row">${[5, 10, 20].map(k => `<button class="chip ${n === k ? 'active' : ''}" data-action="statsWindow" data-n="${k}">Last ${k}</button>`).join('')}</div></div>`;
  if (!st) return html + '<div class="empty">Log some rounds with stats first. <a href="#/rounds">Go to Rounds</a></div>';

  const rows = [
    ['Score', fmt1(st.score), b.score, 'lower'], ['Putts per round', fmt1(st.putts), fmt1(b.putts), 'lower'],
    ['Greens in regulation', st.girPct != null ? Math.round(st.girPct) + '%' : '—', b.gir + '%', 'higher'],
    ['Fairways hit', st.firPct != null ? Math.round(st.firPct) + '%' : '—', b.fir + '%', 'higher'],
    ['Scrambling', st.scrambling != null ? Math.round(st.scrambling) + '%' : '—', b.scrambling + '%', 'higher'],
    ['Sand saves', st.sandSave != null ? Math.round(st.sandSave) + '%' : '—', '—', 'higher'],
    ['Three-putts', fmt1(st.threePutts), fmt1(b.threePutts), 'lower'], ['Penalties', fmt1(st.penalties), fmt1(b.penalties), 'lower'],
    ['Doubles or worse', fmt1(st.doubles), fmt1(b.doubles), 'lower'],
  ];
  const judge = (yours, bench, dir) => { const y = parseFloat(yours), bb = parseFloat(bench); if (isNaN(y) || isNaN(bb)) return ''; const ok = dir === 'lower' ? y <= bb : y >= bb; return `<span class="badge ${ok ? 'good' : 'warn'}">${ok ? 'on track' : 'gap'}</span>`; };

  html += `<div class="grid grid-2">
    <div class="card"><div class="card-head"><h3>You vs a ${b.label} handicap</h3><span class="small muted">last ${st.n} rounds</span></div>
      <div class="table-wrap"><table><thead><tr><th>Stat</th><th class="num">You</th><th class="num">Benchmark</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${r[0]}</td><td class="num"><strong>${r[1]}</strong></td><td class="num">${r[2]}</td><td>${judge(r[1], r[2], r[3])}</td></tr>`).join('')}</tbody></table></div>
      <p class="tiny muted mt mb0">Benchmarks are approximate averages from shot-tracking data for each handicap level. Change your target on the <a href="#/goals">Goals</a> page.</p>
    </div>
    <div class="card"><div class="card-head"><h3>Estimated strokes lost per round</h3></div><canvas class="chart" id="lossChart"></canvas>
      <p class="tiny muted mt mb0">Positive bars are areas where you give up strokes to the benchmark. Estimates, not strokes-gained calculations, but the ranking is what matters.</p></div>
  </div>`;

  html += sgCard(rounds, n);
  html += PlanReview.card(rounds, n);
  html += `<div class="card mt"><h2>Priority focus areas</h2>
    ${recs.length ? recs.map((r, i) => `<div class="rank"><div class="n ${['', 'two', 'three'][i]}">${i + 1}</div><div>
      <h3>${r.area.label} <span class="badge ${r.area.loss > 2 ? 'bad' : 'warn'}">≈ ${fmt1(r.area.loss)} strokes</span></h3>
      <p class="small muted">You: <strong>${r.area.yours}</strong> · Benchmark: <strong>${r.area.bench}</strong>. ${r.area.note}</p>
      <div class="grid grid-3">${r.drills.map(d => drillCard(d, true)).join('')}</div></div></div>`).join('')
      : '<div class="callout">You are at or better than the benchmark in every area we measure. Raise your target handicap on the Goals page to find the next gap.</div>'}
  </div>`;

  const hb = holeBreakdown(rounds.slice(0, n));
  if (hb) {
    const missT = hb.miss.hit + hb.miss.left + hb.miss.right;
    const side = missT ? (hb.miss.left > hb.miss.right * 1.5 ? 'left' : hb.miss.right > hb.miss.left * 1.5 ? 'right' : null) : null;
    html += `<div class="card mt"><div class="card-head"><h2>Scoring breakdown</h2><span class="small muted">${hb.rounds} hole-by-hole round${hb.rounds > 1 ? 's' : ''} · ${hb.holes} holes</span></div>
      <div class="grid grid-2"><div><canvas class="chart" id="distChart"></canvas></div>
      <div><div class="stat-row">${statBox('Par 3s', hb.par3 != null ? toPar(Math.round(hb.par3 * 100) / 100) : '—', 'avg vs par')}${statBox('Par 4s', hb.par4 != null ? toPar(Math.round(hb.par4 * 100) / 100) : '—', 'avg vs par')}${statBox('Par 5s', hb.par5 != null ? toPar(Math.round(hb.par5 * 100) / 100) : '—', 'avg vs par')}</div>
        ${hb.front != null ? `<div class="kv mt"><dt>Front nine</dt><dd>${toPar(Math.round(hb.front * 10) / 10)} avg</dd><dt>Back nine</dt><dd>${toPar(Math.round(hb.back * 10) / 10)} avg${hb.back - hb.front >= 1.5 ? ' <span class="badge warn">fades late</span>' : ''}</dd></div>` : ''}
        ${missT ? `<h3 class="mt">Tee shot pattern</h3><div class="miss-bar"><span class="l" style="flex:${hb.miss.left || 0.001}">${pct(hb.miss.left, missT)}% L</span><span class="h" style="flex:${hb.miss.hit || 0.001}">${pct(hb.miss.hit, missT)}% hit</span><span class="r" style="flex:${hb.miss.right || 0.001}">${pct(hb.miss.right, missT)}% R</span></div>
          <p class="small muted mt mb0">${side ? `Your misses go <strong>${side}</strong>. Aim down the ${side} edge of the fairway so a miss finishes in play, and see <a href="#" data-action="openDrill" data-id="fairway-gate">Fairway Gate</a>.` : 'Misses are balanced left and right: work on start line and strike, not aim.'}</p>` : ''}
      </div></div></div>`;
    App.after(() => { const c = document.getElementById('distChart'); if (c) Charts.bar(c, [['Birdie+', hb.dist.eagle + hb.dist.birdie, 'accent'], ['Par', hb.dist.par, 'accent'], ['Bogey', hb.dist.bogey, 'gold'], ['Double', hb.dist.double, 'red'], ['Triple+', hb.dist.triple, 'red']].map(([label, v, color]) => ({ label, value: Math.round(100 * v / hb.holes), color })), { suffix: '%' }); });
  } else {
    html += `<div class="callout info mt small"><strong>Want deeper stats?</strong> Rounds scored on the <a href="#/play">live scorecard</a> add a birdie/par/bogey breakdown, par-3/4/5 scoring, front vs back nine and your tee-shot miss pattern.</div>`;
  }

  html += `<div class="grid grid-2 mt">
    <div class="card"><h3>Putts per round</h3><canvas class="chart" id="puttsChart"></canvas></div>
    <div class="card"><h3>Greens &amp; fairways</h3><canvas class="chart" id="girChart"></canvas></div>
  </div>`;

  App.after(() => {
    const lc = document.getElementById('lossChart'); if (lc) Charts.bar(lc, analysis.map(a => ({ label: a.label.split(' ')[0], value: Math.max(0, a.loss), color: a.loss > 2 ? 'red' : a.loss > 0.8 ? 'gold' : 'accent' })), { emptyMsg: 'Add stats to rounds' });
    const asc = App.fullRounds().slice(0, n).reverse(); const labels = asc.map(r => fmtDate(r.date));
    const pc = document.getElementById('puttsChart'); if (pc) Charts.line(pc, labels, [{ label: 'Putts', values: asc.map(r => r.putts ?? null) }], { target: b.putts, emptyMsg: 'Log putts per round' });
    const gc = document.getElementById('girChart'); if (gc) Charts.line(gc, labels, [{ label: 'GIR', values: asc.map(r => r.gir ?? null), color: 'accent' }, { label: 'FIR', values: asc.map(r => r.firHit ?? null), color: 'blue' }], { emptyMsg: 'Log greens and fairways' });
  });
  return html;
};

/* ---------- Sessions ---------- */
const SESSION_TYPES = [['putting', 'Putting'], ['shortgame', 'Short game'], ['fullswing', 'Full swing / range'], ['course', 'On course'], ['fitness', 'Fitness'], ['mental', 'Mental']];
Views.sessions = function () {
  const sessions = App.state.sessions.slice().sort((a, b) => b.date.localeCompare(a.date));
  const tier = App.tier();
  const since = new Date(); since.setDate(since.getDate() - 28); const sinceIso = since.toISOString().slice(0, 10);
  const recent = sessions.filter(s => s.date >= sinceIso);
  const byType = {}; recent.forEach(s => { byType[s.type] = (byType[s.type] || 0) + (s.minutes || 0); });
  const total = Object.values(byType).reduce((a, b) => a + b, 0);
  const streak = practiceStreak(sessions);
  const pending = App.ui.sessionDrills || [];

  let html = `<div class="page-head"><div><h1>Practice Log</h1><p class="muted">Log every session with the drill scores you hit. Numbers you track are numbers that improve.</p></div></div>`;
  html += `<div class="grid grid-4">
    <div class="card tight">${statBox('Sessions (28 days)', recent.length, Math.round(total / 60 * 10) / 10 + ' hours')}</div>
    <div class="card tight">${statBox('Weekly streak', streak, 'weeks with 2+ sessions')}</div>
    <div class="card tight">${statBox('Total sessions', sessions.length, 'all time')}</div>
    <div class="card tight">${statBox('Avg length', sessions.length ? Math.round(avg(sessions.map(s => s.minutes))) + ' min' : '—', '')}</div>
  </div>`;

  html += `<div class="grid grid-2 mt"><div class="card"><h2>Log a session</h2>
    <form class="form" data-form="session">
      <div class="form-row">
        <div class="field"><label>Date</label><input type="date" name="date" value="${todayISO()}" required></div>
        <div class="field"><label>Minutes</label><input type="number" name="minutes" min="5" max="600" value="${pending.reduce((a, d) => a + (getDrill(d.id)?.minutes || 0), 0) || 45}" required></div>
        <div class="field"><label>Type</label><select name="type">${SESSION_TYPES.map(([v, l]) => `<option value="${v}" ${App.ui.sessionType === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <fieldset><legend>Drills done</legend>
        <div class="form-row"><div class="field"><label>Add a drill</label><select id="drillPicker">${DRILL_CATEGORIES.map(c => `<optgroup label="${c.label}">${drillsByCategory(c.id).map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('')}</optgroup>`).join('')}</select></div>
        <div class="field"><label>&nbsp;</label><button type="button" class="btn" data-action="addSessionDrill">+ Add</button></div></div>
        ${pending.length ? `<ul class="list compact mt">${pending.map((d, i) => `<li><div class="form-row" style="align-items:end"><div><strong>${escapeHtml(getDrill(d.id).name)}</strong><div class="tiny muted">${escapeHtml(getDrill(d.id).goal)}</div></div>${drillScoreInput(d, i)}<button type="button" class="btn sm ghost danger" data-action="removeSessionDrill" data-i="${i}">✕</button></div></li>`).join('')}</ul>` : '<p class="small muted mb0 mt">No drills added yet. Use the picker, or just log the time.</p>'}
      </fieldset>
      <div class="field"><label>Notes</label><textarea name="notes" rows="2" placeholder="What clicked, what to work on next time…"></textarea></div>
      <button class="btn primary" type="submit">Save session</button>
    </form></div>
    <div class="card"><div class="card-head"><h3>Practice balance (28 days)</h3></div><canvas class="chart" id="balanceChart"></canvas>
      <p class="small muted mt">Recommended split for a ${tier.label} golfer: putting ${tier.split.putting}%, short game ${tier.split.shortgame}%, full swing ${tier.split.fullswing}%, fitness ${tier.split.fitness}%. Most amateurs spend 80% of practice on the range and 20% on the shots that produce 60% of their strokes.</p>
      ${total ? `<div class="table-wrap"><table><thead><tr><th>Area</th><th class="num">Minutes</th><th class="num">Share</th><th class="num">Target</th></tr></thead><tbody>${[['putting', 'Putting', tier.split.putting], ['shortgame', 'Short game', tier.split.shortgame], ['fullswing', 'Full swing', tier.split.fullswing], ['fitness', 'Fitness', tier.split.fitness], ['course', 'On course', null], ['mental', 'Mental', null]].map(([k, l, t]) => `<tr><td>${l}</td><td class="num">${byType[k] || 0}</td><td class="num">${pct(byType[k] || 0, total)}%</td><td class="num">${t != null ? t + '%' : '—'}</td></tr>`).join('')}</tbody></table></div>` : ''}
    </div></div>`;

  const progress = [...new Set(sessions.flatMap(s => (s.drills || []).map(e => e.id)))].map(drillProgress).filter(pr => pr && pr.h.length >= 2)
    .sort((a, b) => b.h[b.h.length - 1].date.localeCompare(a.h[a.h.length - 1].date));
  if (progress.length) {
    html += `<div class="card mt"><div class="card-head"><h2>Drill progress</h2><span class="small muted">${progress.length} drills with 2+ scores</span></div>
      <div class="progress-list">${progress.slice(0, 12).map((pr, i) => `<button class="prog-row" data-action="openDrill" data-id="${pr.d.id}">
        <span class="prog-name"><strong>${escapeHtml(pr.d.name)}</strong><span class="tiny muted">${pr.h.length} sessions · best ${pr.fmt(pr.best)}</span></span>
        <canvas class="spark" id="spark${i}" aria-hidden="true"></canvas>
        <span class="prog-val">${pr.fmt(pr.first)} → <strong>${pr.fmt(pr.last)}</strong> <span class="badge ${pr.improved ? 'good' : pr.change === 0 ? 'neutral' : 'warn'}">${pr.improved ? '▲' : pr.change === 0 ? '＝' : '▼'}</span></span></button>`).join('')}</div></div>`;
    App.after(() => progress.slice(0, 12).forEach((pr, i) => { const c = document.getElementById('spark' + i); if (c) Charts.spark(c, pr.h.map(x => x.value), pr.m.better === 'lower'); }));
  }
  html += `<div class="card mt"><div class="card-head"><h2>Session history</h2></div>
    ${sessions.length ? `<ul class="list">${sessions.slice(0, 40).map(s => `<li><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><div><strong>${fmtDate(s.date)}</strong> · ${SESSION_TYPES.find(t => t[0] === s.type)?.[1] || s.type} · ${s.minutes} min
      ${s.drills && s.drills.length ? `<div class="small">${s.drills.map(d => `${drillLink(d.id)}${d.result ? ` <span class="badge neutral">${escapeHtml(d.result)}</span>` : ''}`).join(' · ')}</div>` : ''}
      ${s.notes ? `<div class="small muted">${escapeHtml(s.notes)}</div>` : ''}</div><button class="btn sm ghost danger" data-action="deleteSession" data-id="${s.id}">✕</button></div></li>`).join('')}</ul>` : '<div class="empty">No sessions logged yet.</div>'}
  </div>`;

  App.after(() => { const c = document.getElementById('balanceChart'); if (c) Charts.bar(c, SESSION_TYPES.map(([k, l]) => ({ label: l.split(' ')[0], value: byType[k] || 0 })), { emptyMsg: 'Log sessions to see your practice balance', suffix: '' }); });
  return html;
};

/* ---------- Assessment ---------- */
Views.assessment = function () {
  const tier = App.tier(); const list = App.state.assessments.slice().sort((a, b) => b.date.localeCompare(a.date));
  const latest = list[0]; const prev = list[1];
  let html = `<div class="page-head"><div><h1>Skills Test</h1><p class="muted">Nine tests, ten balls each, about 90 minutes. Run it in week 1, 6 and 12 of a program. Benchmarks shown for the <strong>${tier.label}</strong> tier (${tier.range}).</p></div></div>`;

  html += `<div class="grid grid-2"><div class="card"><h2>Run the test</h2><form class="form" data-form="assessment">
    <div class="field"><label>Date</label><input type="date" name="date" value="${todayISO()}" required></div>
    ${ASSESSMENT_TESTS.map(t => `<div class="field"><label>${escapeHtml(t.name)} <span class="tag ${t.area}">${categoryLabel(t.area)}</span></label><input type="number" name="${t.id}" min="0" max="10" placeholder="0–10" required><span class="hint">${escapeHtml(t.how)} Benchmark: ${t.benchmarks[tier.id]}/10.</span></div>`).join('')}
    <button class="btn primary" type="submit">Save results</button></form></div>
    <div>
      <div class="card"><div class="card-head"><h3>Skills profile</h3>${latest ? `<span class="small muted">${fmtDate(latest.date)}</span>` : ''}</div><canvas class="chart tall" id="radarChart"></canvas><p class="tiny muted mb0">Green = you. Gold = benchmark for your tier.</p></div>
      ${latest ? `<div class="card mt"><h3>Results vs benchmark</h3><div class="table-wrap"><table><thead><tr><th>Test</th><th class="num">You</th><th class="num">Bench</th><th class="num">Prev</th><th></th></tr></thead><tbody>
        ${ASSESSMENT_TESTS.map(t => { const v = latest.results[t.id]; const bm = t.benchmarks[tier.id]; const pv = prev ? prev.results[t.id] : null; const gap = v - bm; return `<tr><td>${escapeHtml(t.name)}</td><td class="num"><strong>${v}</strong></td><td class="num">${bm}</td><td class="num">${pv != null ? pv + (v > pv ? ' ▲' : v < pv ? ' ▼' : '') : '—'}</td><td><span class="badge ${gap >= 0 ? 'good' : gap >= -2 ? 'warn' : 'bad'}">${gap >= 0 ? 'met' : gap + ''}</span></td></tr>`; }).join('')}
        <tr><td><strong>Total</strong></td><td class="num"><strong>${App.assessmentTotal(latest)}</strong></td><td class="num">${ASSESSMENT_TESTS.reduce((a, t) => a + t.benchmarks[tier.id], 0)}</td><td class="num">${prev ? App.assessmentTotal(prev) : '—'}</td><td></td></tr></tbody></table></div></div>` : ''}
    </div></div>`;

  if (latest) {
    const weak = ASSESSMENT_TESTS.map(t => ({ t, gap: latest.results[t.id] - t.benchmarks[tier.id] })).sort((a, b) => a.gap - b.gap).filter(x => x.gap < 0).slice(0, 3);
    html += `<div class="card mt"><h2>What to work on</h2>${weak.length ? weak.map((w, i) => `<div class="rank"><div class="n ${['', 'two', 'three'][i]}">${i + 1}</div><div><h3>${escapeHtml(w.t.name)} <span class="badge bad">${w.gap} vs benchmark</span></h3><div class="grid grid-3 mt">${w.t.drills.map(id => drillCard(getDrill(id), true)).join('')}</div></div></div>`).join('') : '<div class="callout">You met every benchmark for your tier. You are ready for the next tier\'s plan: set a lower target on the Goals page.</div>'}</div>`;
  }

  html += `<div class="card mt"><div class="card-head"><h2>History</h2></div>${list.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th>${ASSESSMENT_TESTS.map(t => `<th class="num">${escapeHtml(t.name.split(' ')[0])}</th>`).join('')}<th class="num">Total</th><th></th></tr></thead><tbody>${list.map(a => `<tr><td class="nowrap">${fmtDate(a.date)}</td>${ASSESSMENT_TESTS.map(t => `<td class="num">${a.results[t.id] ?? '—'}</td>`).join('')}<td class="num"><strong>${App.assessmentTotal(a)}</strong></td><td><button class="btn sm ghost danger" data-action="deleteAssessment" data-id="${a.id}">✕</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No tests yet. Block 90 minutes and set your baseline.</div>'}</div>`;

  App.after(() => { const c = document.getElementById('radarChart'); if (!c) return; Charts.radar(c, ASSESSMENT_TESTS.map(t => ({ label: t.name.replace(' putts', '').replace(' accuracy', ''), value: latest ? (latest.results[t.id] || 0) / 10 : 0, bench: t.benchmarks[tier.id] / 10 })), { emptyMsg: 'Run the test' }); });
  return html;
};

/* ---------- Practice plan ---------- */
Views.plan = function () {
  const p = App.state.profile; const tier = App.tier(); const budget = TIME_BUDGETS.find(b => b.id === p.budget) || TIME_BUDGETS[1];
  const adapted = App.weekPlan(); const plan = adapted.plan;
  const wk = App.ui.planWeek || isoWeekKey(new Date()); const checks = App.state.planChecks[wk] || {};
  const totalMin = plan.reduce((a, d) => a + (d.session ? d.session.minutes : 0), 0);
  const prog = App.programWeek();
  let html = `<div class="page-head"><div><h1>Practice Schedule</h1><p class="muted">A weekly plan built for your level and the time you have. Tick sessions off as you go; the plan rotates drill focus through the 12-week program.</p></div></div>`;

  html += `<div class="card"><div class="form-row">
    <div class="field"><label>Level</label><select data-change="tierOverride"><option value="" ${!p.tierOverride ? 'selected' : ''}>Auto from index (${App.index() != null ? fmt1(App.index()) : 'no index yet'})</option>${TIERS.map(t => `<option value="${t.id}" ${p.tierOverride === t.id ? 'selected' : ''}>${t.label} (${t.range})</option>`).join('')}</select></div>
    <div class="field"><label>Time available</label><select data-change="budget">${TIME_BUDGETS.map(b => `<option value="${b.id}" ${budget.id === b.id ? 'selected' : ''}>${b.label} · ${b.hours}</option>`).join('')}</select></div>
    <div class="field"><label>Week</label><div class="btn-row"><button class="btn sm" data-action="planWeek" data-dir="-1">‹</button><strong class="mono">${wk}</strong><button class="btn sm" data-action="planWeek" data-dir="1">›</button><button class="btn sm ghost" data-action="planWeek" data-dir="0">today</button></div></div>
  </div>
  <div class="callout mt"><strong>${tier.label} focus:</strong> ${tier.focus}</div>
  <div class="adapt-box ${adapted.focus.length ? 'on' : ''}"><label class="field inline"><input type="checkbox" data-change="adaptive" ${p.adaptive === false ? '' : 'checked'}> Adapt my plan to my weaknesses</label>
    ${p.adaptive === false ? '<p class="tiny muted mb0">Off: you get the standard plan for your level.</p>'
      : adapted.focus.length ? `<p class="small mb0">This week leans toward <strong>${adapted.focus.map(f => escapeHtml(f.label) + (f.loss != null ? ` (≈${fmt1(f.loss)} strokes)` : '')).join('</strong> and <strong>')}</strong> ${adapted.focus[0].source === 'sg' ? 'from your strokes gained' : adapted.focus[0].source === 'stats' ? 'from your last 10 rounds' : 'from your latest Skills Test'}. ${adapted.swaps} drill${adapted.swaps === 1 ? '' : 's'} swapped in, marked <span class="focus-tag">Focus</span>.</p>`
      : '<p class="tiny muted mb0">Log rounds with stats or run the Skills Test and the plan will shift toward where you lose the most strokes.</p>'}</div>
  <p class="small muted mb0">${plan.filter(d => d.session).length} sessions · ${Math.round(totalMin / 60 * 10) / 10} hours this week · ${plan.filter(d => d.session && checks[d.day]).length} done</p></div>`;

  html += `<div class="week mt">${plan.map(d => d.session ? `<div class="day ${checks[d.day] ? 'done' : ''}"><div class="dname">${d.day}</div><div class="dtitle">${escapeHtml(d.session.name)}</div><div class="dmin">${d.session.minutes} min · ${escapeHtml(d.session.type)}</div>
    <ul>${d.session.drills.map(([id, m, why]) => `<li>${drillLink(id)} <span class="muted">${m}′</span>${why ? ` <span class="focus-tag" title="Swapped in for ${escapeHtml(why)}">Focus</span>` : ''}</li>`).join('')}</ul>
    <label><input type="checkbox" data-change="planCheck" data-week="${wk}" data-day="${d.day}" ${checks[d.day] ? 'checked' : ''}> Done</label></div>`
    : `<div class="day rest"><div class="dname">${d.day}</div><div class="dtitle">Rest</div><div class="dmin">Mobility, a walk, or 10 minutes of putting on the carpet.</div></div>`).join('')}</div>`;

  const rem = p.reminders || { time: '18:00', weeks: 8 };
  html += `<div class="card mt"><div class="card-head"><h2>Practice reminders</h2><span class="tag">Calendar</span></div>
    <p class="small muted">Put this schedule in your phone's calendar with an alert 30 minutes before each session. Works with Apple, Google and Outlook calendars.</p>
    <form class="form-row" data-form="calendar" style="align-items:end">
      <div class="field"><label>Session time</label><input type="time" name="time" value="${escapeHtml(rem.time)}" required></div>
      <div class="field"><label>For the next</label><select name="weeks">${[4, 8, 12].map(w => `<option value="${w}" ${rem.weeks == w ? 'selected' : ''}>${w} weeks</option>`).join('')}</select></div>
      <div class="field"><button class="btn primary" type="submit">📅 Add to my calendar</button></div>
    </form>
    <p class="tiny muted mt mb0">Your plan adapts as your stats change, so re-add it every month or two to keep the drills current.</p></div>`;
  html += `<div class="card mt"><div class="card-head"><h2>12-week program</h2>${prog ? `<button class="btn sm ghost danger" data-action="resetProgram">Reset</button>` : `<button class="btn primary sm" data-action="startProgram">Start today</button>`}</div>
    ${prog ? `<p><strong>Week ${prog.week} of 12</strong> · started ${fmtDate(App.state.programStart)} · <strong>${escapeHtml(PROGRAM.weekThemes[prog.week])}</strong></p><div class="phase-bar">${[...Array(12)].map((_, i) => `<span class="${i < 4 ? 'p1' : i < 8 ? 'p2' : 'p3'} ${i + 1 === prog.week ? 'current' : ''}" title="Week ${i + 1}"></span>`).join('')}</div>` : '<p class="muted">Three 4-week phases. Start it and the dashboard tracks your week and theme.</p>'}
    <div class="grid grid-3 mt">${PROGRAM.phases.map(ph => `<div class="card tight ${prog && ph.weeks.includes(prog.week) ? '' : ''}" style="${prog && ph.weeks.includes(prog.week) ? 'border-color:var(--accent)' : ''}"><h3>${escapeHtml(ph.name)}</h3><p class="small muted">${escapeHtml(ph.goal)}</p><ul class="small" style="padding-left:1.1rem;margin:0">${ph.keys.map(k => `<li>${escapeHtml(k)}</li>`).join('')}</ul><div class="mt small">${ph.weeks.map(w => `<div><strong>Wk ${w}:</strong> ${escapeHtml(PROGRAM.weekThemes[w])}</div>`).join('')}</div></div>`).join('')}</div>
  </div>`;

  html += `<div class="card mt"><h2>How to practise so it sticks</h2><div class="grid grid-2">
    <div><h3>Every session</h3><ul class="small" style="padding-left:1.1rem"><li>Start with the 8-minute warm-up. Injuries end more golf seasons than bad swings.</li><li>Every drill has a score. Write it in the Practice Log. No score, no progress.</li><li>Finish with something game-like and a consequence putt so your last memory is competitive.</li><li>Use your full pre-shot routine on at least half the balls.</li></ul></div>
    <div><h3>Every week</h3><ul class="small" style="padding-left:1.1rem"><li>At least one session on the practice green. Putting is 40% of your strokes.</li><li>Blocked practice (repeat the same drill) early in a program; random practice (games, changing clubs) later.</li><li>Play. Practice only matters if it transfers, and only playing tests transfer.</li><li>Review: which numbers moved? Adjust next week's focus with the Stats page.</li></ul></div>
  </div></div>`;
  return html;
};

/* ---------- Drill library ---------- */
Views.drills = function () {
  const ui = App.ui; ui.drillCat = ui.drillCat || 'all'; ui.drillQ = ui.drillQ || ''; ui.drillMax = ui.drillMax || 0; ui.drillDiff = ui.drillDiff || 0;
  let list = DRILLS.filter(d => (ui.drillCat === 'all' || d.category === ui.drillCat) && (!ui.drillFav || App.state.favorites.includes(d.id)) && (!ui.drillMax || d.minutes <= ui.drillMax) && (!ui.drillDiff || d.difficulty === ui.drillDiff));
  if (ui.drillQ) { const q = ui.drillQ.toLowerCase(); list = list.filter(d => (d.name + ' ' + d.summary + ' ' + d.skills.join(' ')).toLowerCase().includes(q)); }
  let html = `<div class="page-head"><div><h1>Drill Library</h1><p class="muted">${DRILLS.length} drills, every one with a measurable goal. Click a drill for setup, steps and a pro tip.</p></div>
    <div class="field" style="min-width:220px"><input type="search" placeholder="Search drills…" value="${escapeHtml(ui.drillQ)}" data-change="drillQ" aria-label="Search drills"></div></div>`;
  html += `<div class="card tight"><div class="chip-row"><button class="chip ${ui.drillCat === 'all' ? 'active' : ''}" data-action="drillCat" data-cat="all">All</button>${DRILL_CATEGORIES.map(c => `<button class="chip ${ui.drillCat === c.id ? 'active' : ''}" data-action="drillCat" data-cat="${c.id}">${c.label}</button>`).join('')}<button class="chip ${ui.drillFav ? 'active' : ''}" data-action="drillFav">★ Favourites</button></div>
    <div class="chip-row mt"><span class="small muted">Time:</span>${[0, 10, 15, 30].map(m => `<button class="chip ${ui.drillMax === m ? 'active' : ''}" data-action="drillMax" data-m="${m}">${m ? '≤ ' + m + ' min' : 'Any'}</button>`).join('')}<span class="small muted" style="margin-left:10px">Difficulty:</span>${[0, 1, 2, 3].map(k => `<button class="chip ${ui.drillDiff === k ? 'active' : ''}" data-action="drillDiff" data-k="${k}">${k ? ['', 'Easy', 'Medium', 'Hard'][k] : 'Any'}</button>`).join('')}</div></div>`;
  html += list.length ? `<div class="grid grid-auto mt">${list.map(d => drillCard(d)).join('')}</div>` : '<div class="empty mt">No drills match those filters.</div>';
  return html;
};

/* Score input for a drill in the session form: a number (with "/ N" or unit) when the drill has one, text otherwise. */
function drillScoreInput(d, i) {
  const m = drillMetric(getDrill(d.id));
  if (m.kind === 'none') return `<div class="field"><label>Result / notes</label><input name="result_${i}" value="${escapeHtml(d.result || '')}" placeholder="e.g. felt solid"></div>`;
  const hint = m.outOf ? `/ ${m.outOf}` : m.kind === 'score' ? (m.par ? `par ${m.par}` : 'vs par') : m.unit;
  return `<div class="field"><label>Score${m.target != null ? ` <span class="muted">(target ${m.better === 'lower' ? '≤' : '≥'} ${m.target})</span>` : ''}</label><div class="score-input"><input type="number" step="any" inputmode="decimal" name="value_${i}" value="${d.value != null ? d.value : ''}" ${m.outOf ? `min="0" max="${m.outOf}"` : ''}><span>${escapeHtml(hint)}</span></div></div>`;
}

/* Is this value better than every earlier score for the drill? */
function isPersonalBest(id, value) {
  // called before the new session is stored, so the history holds only earlier scores
  const m = drillMetric(getDrill(id)); const prev = drillHistory(App.state.sessions, id).map(x => x.value);
  if (!prev.length) return false;
  return m.better === 'lower' ? value < Math.min(...prev) : value > Math.max(...prev);
}

/* Progress summary for the drill modal and practice log. */
function drillProgress(id) {
  const d = getDrill(id); const m = drillMetric(d); const h = drillHistory(App.state.sessions, id);
  if (m.kind === 'none' || !h.length) return null;
  const vals = h.map(x => x.value); const first = vals[0], last = vals[vals.length - 1];
  const best = m.better === 'lower' ? Math.min(...vals) : Math.max(...vals);
  const change = last - first; const improved = m.better === 'lower' ? change < 0 : change > 0;
  return { d, m, h, first, last, best, change, improved, fmt: v => m.outOf ? `${v}/${m.outOf}` : `${v}${m.unit && m.unit !== 'vs par' ? ' ' + m.unit : ''}` };
}

/* Club distances measured with the scorecard's GPS shot tool. */
function measuredClubs() {
  const by = {}; (App.state.shotLog || []).forEach(s => { (by[s.club] = by[s.club] || []).push(s.yards); });
  return Object.entries(by).map(([club, ys]) => {
    const sorted = ys.slice().sort((a, b) => a - b);
    // typical distance: average of the middle 80% so a topped shot or a freak bounce doesn't skew it
    const trim = Math.floor(sorted.length * 0.1); const mid = sorted.slice(trim, sorted.length - trim || undefined);
    return { club, n: ys.length, typical: Math.round(avg(mid)), longest: sorted[sorted.length - 1] };
  }).sort((a, b) => b.typical - a.typical);
}
function measuredClubsCard() {
  const m = measuredClubs();
  return `<div class="mt"><h3>Measured on the course</h3>${m.length ? `<div class="table-wrap"><table><thead><tr><th>Club</th><th class="num">Shots</th><th class="num">Typical</th><th class="num">Longest</th><th class="num">Your chart</th><th></th></tr></thead><tbody>${m.map(r => { const c = App.state.clubs.find(x => x.club === r.club); return `<tr><td><strong>${escapeHtml(r.club)}</strong></td><td class="num">${r.n}</td><td class="num"><strong>${r.typical}</strong></td><td class="num">${r.longest}</td><td class="num">${c ? c.carry : '—'}</td><td>${c && r.n >= 3 && Math.abs(c.carry - r.typical) >= 5 ? `<button class="btn sm" data-action="useMeasured" data-club="${escapeHtml(r.club)}" data-yds="${r.typical}">Use ${r.typical}</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>
    <p class="tiny muted mb0">From GPS shots on the live scorecard. These include roll, so they run a little longer than carry; after 3+ shots you can copy the typical number to your chart.</p>`
    : '<p class="small muted mb0">On the live scorecard, pick a club before measuring a shot and your real distances build up here.</p>'}</div>`;
}

function drillModal(d) {
  const fav = App.state.favorites.includes(d.id);
  return `<div class="drill-detail"><span class="tag ${d.category}">${categoryLabel(d.category)}</span><h2 class="mt">${escapeHtml(d.name)}</h2>
    <div class="drill-meta mb"><span>⏱ ${d.minutes} min</span><span>Difficulty ${dots(d.difficulty)}</span><span>Skills: ${d.skills.map(escapeHtml).join(', ')}</span></div>
    <p>${escapeHtml(d.summary)}</p>
    <h3>Setup</h3><p>${escapeHtml(d.setup)}</p><p class="small muted">Equipment: ${d.equipment.map(escapeHtml).join(', ')}</p>
    <h3>Steps</h3><ol>${d.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
    <div class="callout"><strong>Goal / score:</strong> ${escapeHtml(d.goal)}</div>
    <div class="callout info"><strong>Pro tip:</strong> ${escapeHtml(d.proTip)}</div>
    ${(() => { const pr = drillProgress(d.id); if (!pr) return ''; App.after(() => { const c = document.getElementById('drillHistChart'); if (c) Charts.line(c, pr.h.map(x => fmtDate(x.date)), [{ label: 'Score', values: pr.h.map(x => x.value) }], { target: pr.m.target != null ? pr.m.target : undefined, invert: pr.m.better === 'lower' }); });
      return `<h3 class="mt">Your progress</h3><div class="stat-row mb">${statBox('Latest', pr.fmt(pr.last))}${statBox('Best', pr.fmt(pr.best))}${statBox('Sessions', pr.h.length)}${pr.h.length > 1 ? statBox('Change', (pr.change > 0 ? '+' : '') + Math.round(pr.change * 10) / 10, pr.improved ? 'improving' : pr.change === 0 ? 'steady' : 'slipped') : ''}</div>${pr.h.length > 1 ? '<canvas class="chart" id="drillHistChart"></canvas>' : '<p class="small muted">Log this drill again to see a trend.</p>'}`; })()}
    <div class="btn-row mt"><button class="btn primary" data-action="timerFor" data-min="${d.minutes}" data-name="${escapeHtml(d.name)}">Start ${d.minutes}-min timer</button><button class="btn" data-action="logDrill" data-id="${d.id}">Log this drill</button><button class="btn ${fav ? 'primary' : ''}" data-action="toggleFav" data-id="${d.id}">${fav ? '★ Favourited' : '☆ Favourite'}</button></div></div>`;
}

/* ---------- Playbook ---------- */
Views.playbook = function () {
  const tab = App.ui.playbookTab || 'strategy';
  const tabs = [['strategy', 'Course Strategy'], ['mental', 'Mental Game'], ['warmup', 'Pre-Round Warm-Up'], ['fitness', 'Fitness'], ['glossary', 'Glossary']];
  let html = `<div class="page-head"><div><h1>Playbook</h1><p class="muted">Strategy, mindset, warm-up and fitness: the knowledge that lowers scores without changing your swing.</p></div></div>
    <div class="tabs">${tabs.map(([id, l]) => `<button class="${tab === id ? 'active' : ''}" data-action="playbookTab" data-tab="${id}">${l}</button>`).join('')}</div>`;
  const acc = (sections) => sections.map((s, i) => `<details class="accordion" ${i === 0 ? 'open' : ''}><summary>${escapeHtml(s.title)}</summary><div class="acc-body"><ul>${s.items.map(it => `<li>${escapeHtml(it)}</li>`).join('')}</ul></div></details>`).join('');
  if (tab === 'strategy') {
    const idx = App.index(); const ch = idx != null ? Math.round(idx) : null;
    html += `<div class="grid grid-2"><div>${acc(STRATEGY)}</div><div>
      <div class="card"><h3>Your scoring targets</h3>${ch != null ? `<p class="small">With a course handicap of about <strong>${ch}</strong>, your personal par on a par-72 is <strong>${72 + ch}</strong>. That is ${ch >= 18 ? 'bogey on every hole' + (ch > 18 ? ' plus double on the ' + (ch - 18) + ' hardest' : '') : ch + ' bogeys and ' + (18 - ch) + ' pars'}. You do not need a single birdie.</p>
        <div class="kv"><dt>To break ${Math.floor((72 + ch) / 10) * 10}</dt><dd>${(72 + ch) - Math.floor((72 + ch) / 10) * 10 + 1} fewer strokes than personal par</dd><dt>Doubles allowed</dt><dd>${benchmarkFor(idx).doubles} per round at your level</dd><dt>Penalties allowed</dt><dd>${benchmarkFor(idx).penalties} per round</dd></div>` : '<p class="muted small">Log 3 rounds to see your personal par and scoring targets.</p>'}</div>
      <div class="card mt"><h3>Shot decision tree (around the green)</h3><ol class="small" style="padding-left:1.1rem"><li>Can I putt it? Putt. Even from the fringe or short fringe-grass.</li><li>Can I land it on the green in the first third and run it? Bump-and-run with an 8-iron to PW.</li><li>Must I carry rough or a bunker? Pitch with a sand wedge, land 2–3 paces on.</li><li>Must I stop it fast with no green to work with? Flop or bunker-style shot. Accept a 30% success rate.</li></ol></div>
      <div class="card mt"><h3>Club-up rules of thumb</h3><ul class="small" style="padding-left:1.1rem"><li>Into wind: +1 club per 10 mph. Downwind: −1 club per 15 mph.</li><li>Uphill: +1 club per 10 yds of elevation. Downhill: −1.</li><li>Cold (under 10°C / 50°F): +1 club. Wet ground: +1 for the lack of roll.</li><li>Ball above feet: draws, aim right. Below feet: fades, aim left. Both: take an extra club and swing easy.</li><li>Rough: expect a flyer with mid-irons (ball goes further, less spin). Take less club or aim for the front.</li></ul></div>
    </div></div>`;
  } else if (tab === 'mental') {
    const routine = App.state.routine;
    html += `<div class="grid grid-2"><div>${acc(MENTAL)}</div><div>
      <div class="card"><div class="card-head"><h3>My pre-shot routine</h3><button class="btn sm ghost" data-action="resetRoutine">Reset</button></div><p class="small muted">Edit the steps to match your own. Rehearse it on the range until it takes the same time every shot.</p>
        ${routine.map((s, i) => `<div class="routine-step"><span class="badge">${i + 1}</span><input value="${escapeHtml(s)}" data-change="routineStep" data-i="${i}"><button class="btn sm ghost danger" data-action="removeRoutineStep" data-i="${i}">✕</button></div>`).join('')}
        <button class="btn sm mt" data-action="addRoutineStep">+ Add step</button>
        <div class="callout mt small"><strong>Test it:</strong> time your routine on 10 range balls with a stopwatch. Target spread under 3 seconds. The <a href="#" data-action="openDrill" data-id="tee-shot-routine">Tee Shot Routine Commitment</a> drill does exactly this.</div></div>
      <div class="card mt"><h3>On-course reset card</h3><p class="small">Screenshot this or write it on your glove.</p><ol class="small" style="padding-left:1.1rem"><li>Breathe: 4 in, 4 hold, 4 out, 4 hold.</li><li>"Next shot" — the last one is history.</li><li>Pick the smallest target you can see.</li><li>What is the smart shot? Play it, at 85% speed.</li><li>Full routine. Go within 8 seconds.</li></ol></div>
    </div></div>`;
  } else if (tab === 'warmup') {
    html += `<div class="grid grid-2"><div class="card"><h2>45-minute tournament warm-up</h2><p class="small muted">Short on time? Do the Body section and the last 5 minutes of putting. Never skip the body warm-up.</p>${WARMUP.map(w => `<h3 class="mt">${escapeHtml(w.phase)}</h3><ul class="checklist">${w.items.map((it, i) => `<li><input type="checkbox" id="wu-${w.phase.replace(/\W/g, '')}-${i}"><label for="wu-${w.phase.replace(/\W/g, '')}-${i}">${escapeHtml(it)}</label></li>`).join('')}</ul>`).join('')}<div class="btn-row mt"><button class="btn primary" data-action="timerFor" data-min="45" data-name="Warm-up">Start 45-min timer</button><button class="btn" data-action="timerFor" data-min="8" data-name="Body warm-up">8-min body only</button></div></div>
      <div><div class="card"><h3>Why it matters</h3><p class="small">Most amateurs make their worst swings on holes 1–3 and their worst decisions on holes 15–18. A warm-up fixes the first; fitness and a snack at the turn fix the second.</p><ul class="small" style="padding-left:1.1rem"><li>Warm muscles rotate further: 10–15% more shoulder turn on the first tee.</li><li>The range portion is for rhythm, never for technique. If it is going badly, hit half shots and find the centre of the face.</li><li>Finishing with made 3-footers loads your last memory with success.</li></ul></div>
      <div class="card mt"><h3>Bag checklist</h3><ul class="checklist">${['Balls (6+), tees, marker, pitch repairer', 'Glove plus a spare for rain', 'Yardage book / GPS charged', 'Water and a snack for the turn (nuts, banana, bar)', 'Rain gear, towel, umbrella', 'Sunscreen, cap', 'This week\'s process goals written on the card'].map((it, i) => `<li><input type="checkbox" id="bag-${i}"><label for="bag-${i}">${escapeHtml(it)}</label></li>`).join('')}</ul></div></div></div>`;
  } else if (tab === 'fitness') {
    html += `<div class="grid grid-2">${FITNESS.map(f => `<div class="card"><h3>${escapeHtml(f.title)}</h3><p class="small muted">${escapeHtml(f.when)}</p><ul class="small" style="padding-left:1.1rem">${f.items.map(it => `<li>${escapeHtml(it)}</li>`).join('')}</ul></div>`).join('')}
      <div class="card"><h3>Related drills</h3><div class="grid">${drillsByCategory('fitness').map(d => drillCard(d, true)).join('')}</div></div>
      <div class="card"><h3>Speed maths</h3><p class="small">Each 1 mph of clubhead speed is worth roughly 2.5–3 yards of driver carry. Adding 5 mph over a winter of speed and strength work is realistic for most amateurs and turns a 7-iron approach into a 9-iron. But accuracy first: a centre strike adds more than any speed gain.</p><p class="small mb0"><strong>Safety:</strong> build load gradually, stop with sharp pain, and see a professional for any existing back, hip or shoulder issues before starting the strength program.</p></div></div>`;
  } else {
    html += `<div class="card"><div class="table-wrap"><table><tbody>${GLOSSARY.map(([t, d]) => `<tr><td class="nowrap"><strong>${escapeHtml(t)}</strong></td><td>${escapeHtml(d)}</td></tr>`).join('')}</tbody></table></div></div>`;
  }
  return html;
};

/* ---------- Clubs ---------- */
Views.clubs = function () {
  const clubs = App.state.clubs; const wm = App.state.wedgeMatrix;
  const sorted = clubs.slice().sort((a, b) => b.carry - a.carry); const max = Math.max(...sorted.map(c => c.carry), 1);
  const q = App.ui.clubQuery || {};
  let html = `<div class="page-head"><div><h1>My Clubs</h1><p class="muted">Know your real carry distances (average, not best ever). Use a launch monitor, a range with accurate markers, or the Three-Club Distance Windows drill.</p></div></div>`;
  html += `<div class="grid grid-2"><div class="card"><div class="card-head"><h3>Carry distances</h3><button class="btn sm" data-action="addClub">+ Club</button></div>
    ${sorted.map((c) => { const i = clubs.indexOf(c); const next = sorted[sorted.indexOf(c) + 1]; const gap = next ? c.carry - next.carry : null; return `<div class="gap-row"><input class="club" value="${escapeHtml(c.club)}" data-change="clubName" data-i="${i}" style="width:60px;font:inherit;font-weight:700;border:0;background:transparent;color:inherit"><div class="bar"><span style="width:${pct(c.carry, max)}%"></span></div><input class="yds" type="number" value="${c.carry}" data-change="clubCarry" data-i="${i}" style="width:64px;font:inherit;border:1px solid var(--border);border-radius:6px;padding:2px 4px;background:var(--surface);color:inherit"><span class="gap ${gap != null && (gap > 15 || gap < 6) ? 'warn' : ''}">${gap != null ? 'gap ' + gap : ''}</span><button class="btn sm ghost danger" data-action="removeClub" data-i="${i}">✕</button></div>`; }).join('')}
    <p class="tiny muted mt mb0">Gaps of 10–15 yds between clubs are ideal. A gap over 15 yds (highlighted) means a distance you cannot hit with a full swing; a gap under 6 means two clubs doing the same job.</p>
    ${measuredClubsCard()}</div>
  <div><div class="card"><h3>Club selector</h3><form class="form" data-form="clubQuery"><div class="form-row">
      <div class="field"><label>Distance to target (yds)</label><input type="number" name="dist" value="${q.dist || 150}" required></div>
      <div class="field"><label>Wind (mph, + into / − down)</label><input type="number" name="wind" value="${q.wind || 0}"></div>
      <div class="field"><label>Elevation (yds, + up / − down)</label><input type="number" name="elev" value="${q.elev || 0}"></div>
      <div class="field"><label>Conditions</label><select name="cond"><option value="0" ${!q.cond ? 'selected' : ''}>Normal</option><option value="1" ${q.cond == 1 ? 'selected' : ''}>Cold / wet (+1 club)</option><option value="-1" ${q.cond == -1 ? 'selected' : ''}>Hot / firm (−½ club)</option></select></div>
    </div><button class="btn primary" type="submit">Recommend a club</button></form>
    ${q.result ? `<div class="callout mt"><strong>Plays like ${q.result.plays} yds.</strong> Hit your <strong>${escapeHtml(q.result.club)}</strong> (${q.result.carry} carry)${q.result.alt ? `, or a smooth ${escapeHtml(q.result.alt.club)} (${q.result.alt.carry})` : ''}. ${q.result.plays > q.result.carry ? 'Aim for the front-centre of the green; a full swing gets there.' : 'Grip down slightly or swing at 85%.'}</div>` : ''}</div>
    <div class="card mt"><h3>Wedge distance matrix</h3><p class="small muted">Carry in yards for three backswing lengths. Fill it in with the <a href="#" data-action="openDrill" data-id="clock-system">Clock System</a> drill.</p>
      <div class="table-wrap"><table><thead><tr><th>Wedge</th><th class="num">7:30 (hip)</th><th class="num">9:00 (arm parallel)</th><th class="num">10:30 (shoulder)</th><th class="num">Full</th></tr></thead><tbody>
      ${['PW', 'GW', 'SW', 'LW'].map(w => `<tr><td><strong>${w}</strong></td>${['7:30', '9:00', '10:30', 'full'].map(k => `<td class="num"><input type="number" value="${wm[w + '-' + k] ?? ''}" data-change="wedge" data-key="${w}-${k}" style="width:64px;font:inherit;border:1px solid var(--border);border-radius:6px;padding:2px 4px;background:var(--surface);color:inherit;text-align:right"></td>`).join('')}</tr>`).join('')}</tbody></table></div></div></div></div>`;
  html += dispersionCard();
  html += `<div class="card mt"><h3>Equipment and fitting checklist</h3><div class="grid grid-2"><ul class="small" style="padding-left:1.1rem"><li><strong>Driver loft:</strong> most amateurs need 10.5–12°. More loft = more carry and less curve for swing speeds under 100 mph.</li><li><strong>Shaft flex:</strong> under 85 mph driver speed → regular or senior; 85–100 → regular/stiff; over 100 → stiff. Too stiff is the common error.</li><li><strong>Wedges:</strong> three wedges with 4–6° gaps (e.g. 46/52/58). Bounce: high (10°+) for soft sand and steep swings, low for firm turf and shallow swings.</li><li><strong>Lie angle:</strong> toe-side marks on the sole mean too flat (shots go right); heel-side mean too upright (left). Get it checked.</li></ul>
    <ul class="small" style="padding-left:1.1rem"><li><strong>Grips:</strong> replace every 40 rounds or yearly. Worn grips cause tight hands and slices.</li><li><strong>Ball:</strong> pick one model and stick with it so short-game spin and feel are consistent. A softer ball is fine for most amateurs.</li><li><strong>Putter:</strong> length to eyes over the ball, loft 3–4°. Face-balanced for straight-back-straight-through strokes, toe hang for arcing strokes.</li><li><strong>Hybrids:</strong> replace any iron you cannot hit 7/10 times cleanly (for many players, the 4- and 5-iron).</li></ul></div></div>`;
  return html;
};

/* ---------- Goals ---------- */
Views.goals = function () {
  const p = App.state.profile; const idx = App.index(); const rounds = App.rounds();
  const target = p.targetIndex; const date = p.targetDate;
  const first = rounds.length ? indexHistory(rounds).find(h => h.index != null) : null;
  let plan = null;
  if (idx != null && target != null && date) {
    const days = daysBetween(todayISO(), date); const months = Math.max(0.1, days / 30.4);
    plan = { days, months, drop: idx - target, perMonth: (idx - target) / months };
  }
  const commits = App.state.commitments;
  const commitList = ['Log every round with full stats within 24 hours', 'Practise putting at least once every week', 'Do the warm-up before every round', 'Aim for the centre of the green from 150+ yards', 'Use my full pre-shot routine on every shot', 'Run the Skills Test every 6 weeks', 'Two strength or mobility sessions each week', 'Never hit a shot with a penalty as the likely outcome', 'Take a lesson from a PGA professional this quarter', 'Play in a competition this month'];
  const b = target != null ? benchmarkFor(target) : null; const st = roundStats(rounds, 10);
  let html = `<div class="page-head"><div><h1>Goals</h1><p class="muted">A target, a date, and the habits that get you there. Realistic pace: 1–2 index points per quarter for most golfers who practise with purpose.</p></div></div>`;
  html += `<div class="grid grid-2"><div class="card"><h2>Set your target</h2><form class="form" data-form="goals">
    <div class="form-row"><div class="field"><label>Your name</label><input name="name" value="${escapeHtml(p.name)}" placeholder="Optional"></div><div class="field"><label>Home course</label><input name="homeCourse" value="${escapeHtml(p.homeCourse)}" placeholder="Optional"></div></div>
    <div class="form-row"><div class="field"><label>Starting Handicap Index</label><input type="number" step="0.1" name="startIndex" value="${p.startIndex != null ? p.startIndex : ''}" placeholder="Optional"><span class="hint">Used until you've logged 3 rounds.</span></div></div>
    <div class="form-row"><div class="field"><label>Target Handicap Index</label><input type="number" step="0.1" name="targetIndex" value="${target != null ? target : ''}" placeholder="${idx != null ? fmt1(Math.max(0, idx - 3)) : '12.0'}" required></div><div class="field"><label>Target date</label><input type="date" name="targetDate" value="${date}" required></div></div>
    <button class="btn primary" type="submit">Save goal</button></form>
    ${idx == null ? '<div class="callout warn mt small">Log at least 3 rounds so we can measure the gap from your current index.</div>' : ''}</div>
    <div class="card accent"><h2>Pace check</h2>${plan ? `<div class="stat-row">${statBox('Current', fmt1(idx))}${statBox('Target', fmt1(target))}${statBox('To drop', fmt1(plan.drop))}${statBox('Days left', plan.days)}</div>
      <p class="mt">Required pace: <strong>${fmt1(plan.perMonth)} points per month</strong>. ${plan.perMonth <= 0 ? 'You are already there. Set a new target!' : plan.perMonth <= 0.5 ? 'Very achievable with consistent practice.' : plan.perMonth <= 1 ? 'Ambitious but realistic with 4+ hours a week and a coach.' : 'That is a steep pace. Consider a later date, or commit to the Serious schedule.'}</p>
      ${App.goalProgressBar(idx)}
      ${first && first.index != null ? `<p class="small mt mb0">Since your first index (${fmt1(first.index)} on ${fmtDate(first.date)}): <strong>${fmt1(first.index - idx)}</strong> points gained.</p>` : ''}` : '<p class="muted">Set a target and a date to see your required pace.</p>'}</div></div>`;
  if (plan && plan.drop > 0) {
    const ms = []; const step = plan.drop > 6 ? 2 : 1; for (let v = Math.floor(idx) - (Number.isInteger(idx) ? step : 0); v > target; v -= step) ms.push(v); ms.push(target);
    html += `<div class="card mt"><h2>Milestones</h2><div class="table-wrap"><table><thead><tr><th>Index</th><th>By</th><th>What it typically takes</th></tr></thead><tbody>${ms.map((m, i) => { const frac = (idx - m) / plan.drop; const d = new Date(); d.setDate(d.getDate() + Math.round(plan.days * frac)); const bm = benchmarkFor(m); return `<tr><td><strong>${fmt1(m)}</strong></td><td>${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</td><td class="small">Avg ~${bm.score}, ${fmt1(bm.putts)} putts, ${bm.gir}% GIR, ${bm.scrambling}% scrambling, ${fmt1(bm.doubles)} doubles</td></tr>`; }).join('')}</tbody></table></div></div>`;
  }
  if (b && st) html += `<div class="card mt"><h2>What a ${b.label} handicap looks like vs you</h2><div class="grid grid-4">${[['Putts', fmt1(st.putts), fmt1(b.putts)], ['GIR', st.girPct != null ? Math.round(st.girPct) + '%' : '—', b.gir + '%'], ['Scrambling', st.scrambling != null ? Math.round(st.scrambling) + '%' : '—', b.scrambling + '%'], ['Doubles+', fmt1(st.doubles), fmt1(b.doubles)]].map(([l, y, t]) => `<div class="card tight"><div class="stat"><span class="label">${l}</span><span class="value" style="font-size:1.3rem">${y} <span class="muted">→ ${t}</span></span></div></div>`).join('')}</div></div>`;
  const ach = achievements();
  html += `<div class="card mt"><div class="card-head"><h2>Achievements</h2><span class="small muted">${ach.filter(a => a.done).length}/${ach.length} unlocked</span></div>${achievementGrid(ach)}</div>`;
  html += `<div class="card mt"><div class="card-head"><h2>Commitments</h2><span class="small muted">${commitList.filter((_, i) => commits['c' + i]).length}/${commitList.length}</span></div><ul class="checklist">${commitList.map((c, i) => `<li><input type="checkbox" id="c${i}" data-change="commit" data-key="c${i}" ${commits['c' + i] ? 'checked' : ''}><label for="c${i}" class="${commits['c' + i] ? 'done' : ''}">${escapeHtml(c)}</label></li>`).join('')}</ul></div>`;
  return html;
};

/* ---------- Tools ---------- */
Views.tools = function () {
  const t = App.timer; const idx = App.index(); const ch = App.ui.chCalc || {}; const sf = App.ui.stableford || {};
  let html = `<div class="page-head"><div><h1>Tools</h1><p class="muted">Timer, random drill picker, handicap calculators, and your data.</p></div></div>`;
  html += `<div class="grid grid-2">
    <div class="card"><h2>Practice timer</h2><p class="small muted mb0">${t.label ? escapeHtml(t.label) : 'Pick a preset or set minutes.'}</p><div class="timer-display ${t.remaining === 0 && t.total ? 'done' : ''}" id="timerDisplay">${App.fmtTimer(t.remaining)}</div>
      <div class="btn-row" style="justify-content:center">${[5, 10, 15, 20, 30].map(m => `<button class="btn sm" data-action="timerSet" data-min="${m}">${m}</button>`).join('')}<input type="number" id="timerCustom" min="1" max="180" placeholder="min" style="width:70px;font:inherit;padding:5px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:inherit"><button class="btn sm" data-action="timerSetCustom">Set</button></div>
      <div class="btn-row mt" style="justify-content:center"><button class="btn primary" data-action="timerToggle">${t.running ? 'Pause' : 'Start'}</button><button class="btn" data-action="timerReset">Reset</button></div></div>
    <div class="card"><h2>Random drill</h2><p class="small muted">Stuck for what to practise? Roll the dice.</p><div class="form-row"><div class="field"><label>Category</label><select id="randCat"><option value="all">Any</option>${DRILL_CATEGORIES.map(c => `<option value="${c.id}" ${App.ui.randCat === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}</select></div><div class="field"><label>&nbsp;</label><button class="btn primary" data-action="randomDrill">🎲 Pick a drill</button></div></div>
      ${App.ui.randDrill ? `<div class="mt">${drillCard(getDrill(App.ui.randDrill))}</div>` : ''}</div>
  </div>`;
  html += `<div class="grid grid-2 mt">
    <div class="card"><h2>Course handicap calculator</h2><form class="form" data-form="chCalc"><div class="form-row"><div class="field"><label>Handicap Index</label><input type="number" step="0.1" name="index" value="${ch.index ?? (idx != null ? fmt1(idx) : '')}" required></div><div class="field"><label>Slope</label><input type="number" name="slope" value="${ch.slope || 128}" required></div><div class="field"><label>Course rating</label><input type="number" step="0.1" name="rating" value="${ch.rating || 71.5}" required></div><div class="field"><label>Par</label><input type="number" name="par" value="${ch.par || 72}" required></div></div><button class="btn primary" type="submit">Calculate</button></form>
      ${ch.result != null ? `<div class="callout mt"><strong>Course handicap: ${ch.result}</strong>. Playing to your handicap means shooting ${ch.par + ch.result} (net ${ch.par}). In Stableford that is 36 points.</div>` : ''}
      <p class="tiny muted mb0">Formula: Index × (Slope ÷ 113) + (Course Rating − Par), rounded.</p></div>
    <div class="card"><h2>Stableford &amp; net score</h2><form class="form" data-form="stableford"><div class="form-row"><div class="field"><label>Course handicap</label><input type="number" name="ch" value="${sf.ch ?? (ch.result ?? 18)}" required></div><div class="field"><label>Gross score</label><input type="number" name="gross" value="${sf.gross || 90}" required></div><div class="field"><label>Par</label><input type="number" name="par" value="${sf.par || 72}" required></div></div><button class="btn primary" type="submit">Calculate</button></form>
      ${sf.result ? `<div class="callout mt"><strong>Net ${sf.result.net}</strong> (${sf.result.net - sf.par >= 0 ? '+' : ''}${sf.result.net - sf.par} vs par). Approximate Stableford: <strong>${sf.result.pts} points</strong>. ${sf.result.pts >= 36 ? 'You played to your handicap or better.' : 'Under 36: a normal day. Expect to play to your handicap about 1 round in 5.'}</div>` : ''}
      <p class="tiny muted mb0">Stableford estimated from net score (36 + par − net); exact points depend on hole-by-hole scoring.</p></div>
  </div>`;
  html += `<div class="card mt"><h2>Your data</h2><p class="small muted">Everything is stored in this browser's local storage. Export a backup before clearing your browser data or switching devices, then import it on the other device.</p>
    <div class="btn-row"><button class="btn primary" data-action="exportData">⬇ Export backup (JSON)</button><label class="btn" for="importFile">⬆ Import backup</label><input type="file" id="importFile" accept="application/json" class="hidden" data-change="importFile"><button class="btn" data-action="loadDemo">Load demo data</button><button class="btn danger" data-action="resetData">Delete all data</button></div>
    <div class="kv mt small"><dt>Rounds</dt><dd>${App.state.rounds.length}</dd><dt>Sessions</dt><dd>${App.state.sessions.length}</dd><dt>Skills tests</dt><dd>${App.state.assessments.length}</dd></div></div>`;
  return html;
};
