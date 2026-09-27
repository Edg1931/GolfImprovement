/* Live hole-by-hole scorecard, course library, GPS shot measuring and achievements. */

const DEFAULT_PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 4, 5];
const DEFAULT_SI = [7, 11, 15, 1, 5, 13, 17, 3, 9, 8, 16, 12, 2, 6, 14, 18, 4, 10];
const FAIRWAY_OPTS = [['left', '← Left'], ['hit', 'Hit'], ['right', 'Right →']];

function sum(arr) { return arr.reduce((a, b) => a + (b || 0), 0); }
function toPar(n) { return n === 0 ? 'E' : (n > 0 ? '+' + n : String(n)); }
function scoreClass(strokes, par) { if (strokes == null) return ''; const d = strokes - par; return d <= -1 ? 'sc-under' : d === 0 ? 'sc-par' : d === 1 ? 'sc-bogey' : 'sc-double'; }

/* Weeks in a row (counting back from this week) with 2+ practice sessions. */
function practiceStreak(sessions) {
  const weeks = {}; sessions.forEach(s => { const k = isoWeekKey(new Date(s.date + 'T00:00:00')); weeks[k] = (weeks[k] || 0) + 1; });
  let streak = 0; const d = new Date();
  for (let i = 0; i < 52; i++) { const k = isoWeekKey(d); if (weeks[k] >= 2) streak++; else if (i > 0) break; d.setDate(d.getDate() - 7); }
  return streak;
}

/* Live round totals for the header. */
function liveTotals(lr) {
  let strokes = 0, par = 0, putts = 0, thru = 0, pts = 0, net = 0;
  lr.holes.forEach((h, i) => {
    if (h.strokes == null) return;
    thru++; strokes += h.strokes; par += lr.pars[i]; putts += h.putts || 0;
    const rec = lr.ch != null ? strokesOnHole(lr.ch, lr.si[i]) : 0;
    net += h.strokes - rec; pts += stablefordPoints(h.strokes, lr.pars[i], rec);
  });
  return { strokes, par, putts, thru, pts, net, toPar: strokes - par, netToPar: net - par };
}

/* ---------- Achievements (derived from data, nothing extra stored) ---------- */
const ACHIEVEMENTS = [
  { id: 'first-round', icon: '⛳', name: 'First Card', desc: 'Log your first round', test: c => c.rounds.length >= 1 },
  { id: 'index', icon: '📇', name: 'Established', desc: 'Log 3 rounds to earn a Handicap Index', test: c => c.rounds.length >= 3 },
  { id: 'live', icon: '📱', name: 'On the Card', desc: 'Finish a round on the live scorecard', test: c => c.rounds.some(r => r.holes) },
  { id: 'break100', icon: '💯', name: 'Broke 100', desc: 'Shoot 99 or better', test: c => c.gross.some(g => g < 100) },
  { id: 'break90', icon: '🎯', name: 'Broke 90', desc: 'Shoot 89 or better', test: c => c.gross.some(g => g < 90) },
  { id: 'break80', icon: '🔥', name: 'Broke 80', desc: 'Shoot 79 or better', test: c => c.gross.some(g => g < 80) },
  { id: 'single', icon: '⭐', name: 'Single Digits', desc: 'Reach a Handicap Index under 10', test: c => c.index != null && c.index < 10 },
  { id: 'birdie', icon: '🐦', name: 'Birdie!', desc: 'Record a birdie on the live scorecard', test: c => c.rounds.some(r => r.holes && r.holes.some((h, i) => h.strokes != null && h.strokes < r.pars[i])) },
  { id: 'putts30', icon: '🏁', name: 'Putting Clinic', desc: '30 putts or fewer in a round', test: c => c.rounds.some(r => r.putts != null && r.putts <= 30) },
  { id: 'no3putt', icon: '🧊', name: 'Ice Cold', desc: 'A full round with no three-putts', test: c => c.rounds.some(r => r.threePutts === 0) },
  { id: 'clean', icon: '🛡️', name: 'Clean Card', desc: 'A round with zero penalty strokes', test: c => c.rounds.some(r => r.penalties === 0) },
  { id: 'gir9', icon: '🟢', name: 'Green Machine', desc: 'Hit 9+ greens in regulation', test: c => c.rounds.some(r => r.gir >= 9) },
  { id: 'streak4', icon: '📅', name: 'Habit Formed', desc: '4-week practice streak (2+ sessions a week)', test: c => c.streak >= 4 },
  { id: 'sessions25', icon: '💪', name: 'Grinder', desc: 'Log 25 practice sessions', test: c => c.sessions >= 25 },
  { id: 'test-up', icon: '📈', name: 'Measured Progress', desc: 'Beat your previous Skills Test total', test: c => c.testUp },
];
function achievementContext() {
  const s = App.state; const tests = s.assessments.slice().sort((a, b) => a.date.localeCompare(b.date));
  return {
    rounds: s.rounds, gross: s.rounds.map(r => r.grossScore != null ? r.grossScore : r.score), index: App.index(),
    streak: practiceStreak(s.sessions), sessions: s.sessions.length,
    testUp: tests.length >= 2 && App.assessmentTotal(tests[tests.length - 1]) > App.assessmentTotal(tests[tests.length - 2]),
  };
}
function achievements() { const c = achievementContext(); return ACHIEVEMENTS.map(a => ({ ...a, done: !!a.test(c) })); }
function unlockedIds() { return achievements().filter(a => a.done).map(a => a.id); }
/* Toast any achievements unlocked by a change. Call with the ids from before the change. */
function announceAchievements(before) {
  achievements().filter(a => a.done && !before.includes(a.id)).forEach((a, i) => setTimeout(() => App.toast(a.icon + ' Achievement: ' + a.name), 400 + i * 900));
}
function achievementGrid(list) {
  return `<div class="badge-grid">${list.map(a => `<div class="ach ${a.done ? 'on' : ''}" title="${escapeHtml(a.desc)}"><span class="ach-ico" aria-hidden="true">${a.icon}</span><div><strong>${escapeHtml(a.name)}</strong><div class="tiny muted">${escapeHtml(a.desc)}</div></div></div>`).join('')}</div>`;
}

/* ---------- Play view ---------- */
Views.play = function () {
  const lr = App.state.liveRound;
  return lr ? playLive(lr) : playSetup();
};

function playSetup() {
  const courses = App.state.courses; const sel = App.ui.playCourse ? courses.find(c => c.id === App.ui.playCourse) : null;
  const last = App.rounds()[0] || {};
  const c = sel || { name: last.course || App.state.profile.homeCourse || '', tees: last.tees || '', rating: last.rating || '', slope: last.slope || '', pars: DEFAULT_PARS, si: DEFAULT_SI };
  const idx = App.index();
  let html = `<div class="page-head"><div><p class="eyebrow">Live scorecard</p><h1>Play a round</h1><p class="muted">Tap in each hole as you play. Fairways, greens, scrambling and your handicap-adjusted score are worked out for you.</p></div></div>`;
  html += `<div class="grid grid-2"><div class="card"><h2>Tee it up</h2><form class="form" data-form="startRound">
    ${courses.length ? `<div class="field"><label>Saved course</label><select data-change="playCourse"><option value="">New course…</option>${courses.map(x => `<option value="${x.id}" ${sel && sel.id === x.id ? 'selected' : ''}>${escapeHtml(x.name)}${x.tees ? ' · ' + escapeHtml(x.tees) : ''}</option>`).join('')}</select></div>` : ''}
    <div class="form-row">
      <div class="field"><label>Date</label><input type="date" name="date" value="${todayISO()}" required></div>
      <div class="field"><label>Course</label><input name="course" value="${escapeHtml(c.name)}" placeholder="Course name" required></div>
      <div class="field"><label>Tees</label><input name="tees" value="${escapeHtml(c.tees)}" placeholder="White"></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Course rating</label><input type="number" step="0.1" name="rating" value="${c.rating}" placeholder="71.2" required></div>
      <div class="field"><label>Slope</label><input type="number" name="slope" value="${c.slope}" placeholder="128" min="55" max="155" required></div>
    </div>
    <details class="accordion" ${sel ? '' : 'open'}><summary>Par &amp; stroke index for each hole <span class="small muted">(par ${sum(c.pars)})</span></summary><div class="acc-body">
      <p class="tiny muted">From the scorecard. Stroke index (SI) ranks holes 1 (hardest) to 18 and decides where your handicap strokes fall.</p>
      <div class="hole-grid">${c.pars.map((p, i) => `<div class="hole-cell"><span>${i + 1}</span><input type="number" name="par_${i}" value="${p}" min="3" max="6" aria-label="Hole ${i + 1} par"><input type="number" name="si_${i}" value="${c.si[i]}" min="1" max="18" aria-label="Hole ${i + 1} stroke index"></div>`).join('')}</div>
      <div class="tiny muted mt">Top row: par · bottom row: stroke index</div>
    </div></details>
    <label class="field inline"><input type="checkbox" name="saveCourse" ${sel ? '' : 'checked'}> Save this course to my library</label>
    <button class="btn primary lg" type="submit">Start round →</button>
    ${idx != null ? `<p class="tiny muted mb0">Your index ${fmt1(idx)} is used for net scoring and the net-double-bogey cap.</p>` : '<p class="tiny muted mb0">No index yet: holes are capped at par + 5 for handicap purposes until you have 3 rounds.</p>'}
  </form></div>
  <div><div class="card"><h3>Why score hole by hole?</h3><ul class="small tick-list">
    <li><strong>Correct handicap score.</strong> Every hole is capped at net double bogey automatically, as the World Handicap System requires.</li>
    <li><strong>Deeper stats.</strong> Birdie/par/bogey mix, par-3/4/5 scoring, front vs back nine and which side you miss fairways.</li>
    <li><strong>Net and Stableford live</strong> so you always know where you stand against your handicap.</li>
    <li><strong>GPS shot distance.</strong> Mark your ball, walk to it, see the yardage.</li></ul></div>
    <div class="card mt"><div class="card-head"><h3>Course library</h3><span class="small muted">${courses.length}</span></div>
      ${courses.length ? `<ul class="list compact">${courses.map(x => `<li class="row-between"><div><strong>${escapeHtml(x.name)}</strong> <span class="small muted">${escapeHtml(x.tees || '')} · ${x.rating}/${x.slope} · par ${sum(x.pars)}</span></div><button class="btn sm ghost danger" data-action="deleteCourse" data-id="${x.id}" aria-label="Delete course">✕</button></li>`).join('')}</ul>` : '<div class="empty small">Courses you play are saved here so you never retype a scorecard.</div>'}
    </div></div></div>`;
  return html;
}

function playLive(lr) {
  const i = lr.cur; const h = lr.holes[i]; const par = lr.pars[i]; const t = liveTotals(lr);
  const rec = lr.ch != null ? strokesOnHole(lr.ch, lr.si[i]) : 0;
  const complete = lr.holes.every(x => x.strokes != null);
  const gps = App.ui.gps || {};
  App.after(() => {
    App.keepAwake(true);
    const strip = document.querySelector('.hole-strip'), pill = strip && strip.querySelector('.cur');
    if (pill) strip.scrollLeft = pill.offsetLeft - strip.clientWidth / 2 + pill.clientWidth / 2;
  });
  let html = `<div class="live-head card accent">
    <div class="row-between"><div><p class="eyebrow light">${escapeHtml(lr.course)}${lr.tees ? ' · ' + escapeHtml(lr.tees) : ''}</p><div class="live-score"><span class="big">${t.thru ? toPar(t.toPar) : 'E'}</span><span class="muted">${t.strokes} strokes · thru ${t.thru}</span></div></div>
    <div class="live-mini">${lr.ch != null ? `<div><span>${toPar(t.netToPar)}</span>net</div><div><span>${t.pts}</span>pts</div>` : ''}<div><span>${t.putts}</span>putts</div></div></div>
    <div class="hole-strip" role="tablist" aria-label="Holes">${lr.holes.map((x, k) => `<button class="hole-pill ${k === i ? 'cur' : ''} ${scoreClass(x.strokes, lr.pars[k])}" data-action="holeGo" data-i="${k}" aria-label="Hole ${k + 1}${x.strokes != null ? ', ' + x.strokes : ''}"><small>${k + 1}</small>${x.strokes != null ? x.strokes : '·'}</button>`).join('')}</div>
  </div>`;

  const quick = [-1, 0, 1, 2, 3].map(d => par + d).filter(v => v > 0);
  html += `<div class="grid grid-2 mt"><div class="card hole-card">
    <div class="row-between"><div><p class="eyebrow">Hole ${i + 1} of 18</p><h2 class="hole-title">Par ${par} <span class="muted">· SI ${lr.si[i]}</span></h2></div>${rec > 0 ? `<span class="badge">${'●'.repeat(Math.min(rec, 3))} ${rec} stroke${rec > 1 ? 's' : ''}</span>` : ''}</div>

    <div class="entry"><div class="entry-label">Score</div>
      <div class="stepper"><button class="step" data-action="holeStep" data-k="strokes" data-d="-1" aria-label="One fewer stroke">−</button><output class="step-val ${scoreClass(h.strokes, par)}">${h.strokes != null ? h.strokes : '–'}</output><button class="step" data-action="holeStep" data-k="strokes" data-d="1" aria-label="One more stroke">+</button></div>
      <div class="chip-row">${quick.map(v => `<button class="chip ${h.strokes === v ? 'active' : ''}" data-action="holeSet" data-k="strokes" data-v="${v}">${scoreName(v, par)}</button>`).join('')}</div></div>

    <div class="entry"><div class="entry-label">Putts</div>
      <div class="seg">${[0, 1, 2, 3, 4].map(v => `<button class="${h.putts === v ? 'active' : ''}" data-action="holeSet" data-k="putts" data-v="${v}">${v}${v === 4 ? '+' : ''}</button>`).join('')}</div></div>

    ${par >= 4 ? `<div class="entry"><div class="entry-label">Tee shot</div>
      <div class="seg">${FAIRWAY_OPTS.map(([v, l]) => `<button class="${h.fir === v ? 'active' : ''}" data-action="holeSet" data-k="fir" data-v="${v}">${l}</button>`).join('')}</div></div>` : ''}

    <div class="entry two"><div><div class="entry-label">Penalties</div>
      <div class="stepper sm"><button class="step" data-action="holeStep" data-k="pen" data-d="-1" aria-label="Remove penalty">−</button><output class="step-val">${h.pen || 0}</output><button class="step" data-action="holeStep" data-k="pen" data-d="1" aria-label="Add penalty">+</button></div></div>
      <div><div class="entry-label">Greenside bunker</div><button class="toggle ${h.sand ? 'on' : ''}" data-action="holeToggleSand" aria-pressed="${!!h.sand}"><span></span>${h.sand ? 'Yes' : 'No'}</button></div></div>

    <div class="btn-row nav-row"><button class="btn" data-action="holeGo" data-i="${i - 1}" ${i === 0 ? 'disabled' : ''}>‹ Prev</button>
      ${i < 17 ? `<button class="btn primary lg grow" data-action="holeGo" data-i="${i + 1}">Next hole ›</button>` : `<button class="btn primary lg grow" data-action="finishRound" ${complete ? '' : 'disabled'}>Finish round ✓</button>`}</div>
    ${i === 17 && !complete ? `<p class="tiny muted mb0">Enter a score on every hole to finish. Missing: ${lr.holes.map((x, k) => x.strokes == null ? k + 1 : null).filter(Boolean).join(', ')}.</p>` : ''}
  </div>

  <div><div class="card"><div class="card-head"><h3>Shot distance</h3><span class="tag">GPS</span></div>
      <p class="small muted">Tap <em>Mark</em> where you hit from, walk to your ball, then tap <em>Measure</em>.</p>
      <div class="gps-read">${gps.last != null ? `<span class="big">${gps.last}</span> yds` : gps.start ? '<span class="muted">Marked. Walk to your ball…</span>' : '<span class="muted">—</span>'}</div>
      <div class="btn-row"><button class="btn primary" data-action="gpsMark">📍 Mark</button><button class="btn" data-action="gpsMeasure" ${gps.start ? '' : 'disabled'}>📏 Measure</button></div>
      ${gps.shots && gps.shots.length ? `<p class="small mt mb0">This round: ${gps.shots.slice(-6).map(s => `<span class="badge neutral">${s} yds</span>`).join(' ')}</p>` : ''}
      <p class="tiny muted mt mb0">Phone GPS is accurate to about 3–5 yds in open sky.</p></div>
    <div class="card mt"><h3>Scorecard</h3>${scorecardTable(lr.holes, lr.pars, lr.si)}</div>
    <div class="btn-row mt"><button class="btn ghost danger sm" data-action="discardRound">Discard round</button></div>
  </div></div>`;
  return html;
}

/* Compact 18-hole scorecard table (front/back nines). */
function scorecardTable(holes, pars, si) {
  const nine = (from) => {
    const idx = [...Array(9)].map((_, k) => from + k);
    const sc = idx.map(k => holes[k].strokes); const played = sc.every(v => v != null);
    return `<table class="scorecard"><thead><tr><th>Hole</th>${idx.map(k => `<th>${k + 1}</th>`).join('')}<th>${from ? 'In' : 'Out'}</th></tr></thead><tbody>
      <tr class="muted"><td>Par</td>${idx.map(k => `<td>${pars[k]}</td>`).join('')}<td>${sum(idx.map(k => pars[k]))}</td></tr>
      ${si ? `<tr class="muted tiny"><td>SI</td>${idx.map(k => `<td>${si[k]}</td>`).join('')}<td></td></tr>` : ''}
      <tr><td><strong>Score</strong></td>${idx.map(k => `<td><span class="sc ${scoreClass(holes[k].strokes, pars[k])}">${holes[k].strokes ?? ''}</span></td>`).join('')}<td><strong>${played ? sum(sc) : ''}</strong></td></tr>
      <tr class="muted"><td>Putts</td>${idx.map(k => `<td>${holes[k].putts ?? ''}</td>`).join('')}<td>${sum(idx.map(k => holes[k].putts))}</td></tr></tbody></table>`;
  };
  return `<div class="table-wrap">${nine(0)}${nine(9)}</div><p class="tiny muted mb0 sc-legend"><span class="sc sc-under">3</span> under par <span class="sc sc-bogey">5</span> bogey <span class="sc sc-double">6</span> double+</p>`;
}

function roundCardModal(r) {
  const s = holeBreakdown([r]);
  return `<p class="eyebrow">${fmtDate(r.date)}</p><h2>${escapeHtml(r.course || 'Round')}</h2>
    <div class="stat-row mb">${statBox('Gross', r.grossScore ?? r.score)}${statBox('Adjusted', r.score, 'for handicap')}${statBox('Differential', fmt1(r.diff))}${r.putts != null ? statBox('Putts', r.putts) : ''}</div>
    ${scorecardTable(r.holes, r.pars, r.si)}
    ${s ? `<p class="small mt mb0">${s.dist.eagle + s.dist.birdie} birdies or better · ${s.dist.par} pars · ${s.dist.bogey} bogeys · ${s.dist.double + s.dist.triple} doubles+</p>` : ''}`;
}

/* ---------- Actions for the scorecard ---------- */
Object.assign(Actions, {
  holeGo(el) { const lr = App.state.liveRound; const i = parseInt(el.dataset.i, 10); if (i < 0 || i > 17) return; lr.cur = i; Store.save(); App.render(); document.querySelector('.hole-card')?.scrollIntoView({ block: 'nearest' }); },
  holeSet(el) {
    const lr = App.state.liveRound; const h = lr.holes[lr.cur]; const k = el.dataset.k;
    const v = k === 'fir' ? el.dataset.v : parseInt(el.dataset.v, 10);
    h[k] = h[k] === v && k !== 'strokes' ? null : v;
    if (k === 'putts' && h.strokes != null && h.putts != null && h.putts >= h.strokes) h.strokes = h.putts + 1;
    Store.save(); App.render();
  },
  holeStep(el) {
    const lr = App.state.liveRound; const h = lr.holes[lr.cur]; const k = el.dataset.k; const d = parseInt(el.dataset.d, 10);
    if (k === 'strokes') h.strokes = h.strokes == null ? lr.pars[lr.cur] : Math.max(1, Math.min(15, h.strokes + d));
    else h[k] = Math.max(0, Math.min(9, (h[k] || 0) + d));
    Store.save(); App.render();
  },
  holeToggleSand() { const lr = App.state.liveRound; const h = lr.holes[lr.cur]; h.sand = !h.sand; Store.save(); App.render(); },
  discardRound() { if (!confirm('Discard this round? Scores entered so far will be lost.')) return; App.state.liveRound = null; App.ui.gps = null; App.keepAwake(false); Store.save(); App.render(); },
  finishRound() {
    const lr = App.state.liveRound; if (!lr || lr.holes.some(h => h.strokes == null)) return;
    const before = unlockedIds(); const prevIdx = App.index();
    const st = statsFromHoles(lr.holes, lr.pars); const par = sum(lr.pars);
    const r = { id: uid(), date: lr.date, course: lr.course, tees: lr.tees, par, rating: lr.rating, slope: lr.slope,
      score: adjustedGross(lr.holes, lr.pars, lr.si, lr.ch), grossScore: st.gross, holes: lr.holes.map(h => ({ ...h })), pars: lr.pars.slice(), si: lr.si.slice(),
      putts: st.putts, firHit: st.firHit, firPossible: st.firPossible, gir: st.gir, penalties: st.penalties, udAtt: st.udAtt, udMade: st.udMade,
      sandAtt: st.sandAtt, sandMade: st.sandMade, threePutts: st.threePutts, doubles: st.doubles, notes: '' };
    App.state.rounds.push(r); App.state.liveRound = null; App.ui.gps = null; App.keepAwake(false); Store.save();
    location.hash = '#/rounds'; App.render();
    const idx = App.index(); r.diff = scoreDifferential(r.score, r.rating, r.slope);
    App.modal(`<div class="finish-hero"><span class="eyebrow">Round complete</span><div class="finish-score">${r.grossScore}</div><p class="muted">${toPar(r.grossScore - par)} · ${escapeHtml(r.course)}</p></div>
      ${r.score !== r.grossScore ? `<div class="callout info small">Adjusted to <strong>${r.score}</strong> for handicap (holes capped at net double bogey).</div>` : ''}
      <div class="stat-row mb">${statBox('Differential', fmt1(r.diff))}${statBox('Index', idx != null ? fmt1(idx) : '—', prevIdx != null && idx != null && idx !== prevIdx ? (idx < prevIdx ? '▼ ' : '▲ ') + fmt1(Math.abs(idx - prevIdx)) : '')}${statBox('Putts', r.putts ?? '—')}${statBox('GIR', r.gir ?? '—')}</div>
      ${scorecardTable(r.holes, r.pars, r.si)}
      <div class="btn-row mt"><button class="btn primary" data-action="closeModal">Done</button><button class="btn" data-action="goto" data-href="#/stats">See stats</button></div>`);
    announceAchievements(before);
  },
  deleteCourse(el) { if (!confirm('Remove this course from your library?')) return; App.state.courses = App.state.courses.filter(c => c.id !== el.dataset.id); if (App.ui.playCourse === el.dataset.id) App.ui.playCourse = null; Store.save(); App.render(); },
  viewCard(el) { const r = App.rounds().find(x => x.id === el.dataset.id); if (r) App.modal(roundCardModal(r)); },
  gpsMark() {
    App.locate(pos => { App.ui.gps = Object.assign(App.ui.gps || {}, { start: pos, last: null }); App.render(); App.toast('Position marked (±' + Math.round(pos.acc * 1.09) + ' yds)'); });
  },
  gpsMeasure() {
    const g = App.ui.gps; if (!g || !g.start) return;
    App.locate(pos => { const y = Math.round(yardsBetween(g.start, pos)); g.last = y; g.shots = (g.shots || []).concat(y); g.start = pos; App.render(); });
  },
});

Object.assign(Forms, {
  startRound(form, v) {
    const pars = [...Array(18)].map((_, i) => Math.max(3, Math.min(6, parseInt(v['par_' + i], 10) || DEFAULT_PARS[i])));
    const si = [...Array(18)].map((_, i) => Math.max(1, Math.min(18, parseInt(v['si_' + i], 10) || DEFAULT_SI[i])));
    const rating = num(v.rating), slope = num(v.slope);
    if (!(slope >= 55 && slope <= 155)) { App.toast('Slope must be between 55 and 155'); return; }
    if (new Set(si).size !== 18) { App.toast('Each stroke index 1–18 must be used exactly once'); return; }
    let courseId = App.ui.playCourse || null;
    const course = { name: v.course.trim(), tees: v.tees.trim(), rating, slope, pars, si };
    if (courseId) Object.assign(App.state.courses.find(c => c.id === courseId) || {}, course);
    else if (v.saveCourse) { courseId = uid(); App.state.courses.push({ id: courseId, ...course }); }
    const idx = App.index();
    App.state.liveRound = { id: uid(), date: v.date, courseId, course: course.name, tees: course.tees, rating, slope, pars, si,
      ch: idx != null ? courseHandicap(idx, slope, rating, sum(pars)) : null, cur: 0,
      holes: pars.map(() => ({ strokes: null, putts: null, fir: null, pen: 0, sand: false })) };
    App.ui.gps = null; Store.save(); App.render(); App.toast('Round started. Good luck out there!');
  },
});

Object.assign(Changes, {
  playCourse(el) { App.ui.playCourse = el.value || null; App.render(); },
  roundCourse(el) { App.ui.roundCourse = el.value || null; App.render(); },
});
