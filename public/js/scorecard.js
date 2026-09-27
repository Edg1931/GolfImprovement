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
    const rec = lr.ch != null ? strokesOnHole(lr.ch, lr.si[i], lr.holes.length) : 0;
    net += h.strokes - rec; pts += stablefordPoints(h.strokes, lr.pars[i], rec);
  });
  return { strokes, par, putts, thru, pts, net, toPar: strokes - par, netToPar: net - par };
}

/* ---------- Achievements (derived from data, nothing extra stored) ---------- */
const ACHIEVEMENTS = [
  { id: 'first-round', icon: '⛳', name: 'First Card', desc: 'Log your first round', test: c => c.rounds.length >= 1 },
  { id: 'index', icon: '📇', name: 'Established', desc: 'Log 3 rounds to earn a Handicap Index', test: c => c.index != null },
  { id: 'live', icon: '📱', name: 'On the Card', desc: 'Finish a round on the live scorecard', test: c => c.rounds.some(r => r.holes) },
  { id: 'break100', icon: '💯', name: 'Broke 100', desc: 'Shoot 99 or better', test: c => c.gross.some(g => g < 100) },
  { id: 'break90', icon: '🎯', name: 'Broke 90', desc: 'Shoot 89 or better', test: c => c.gross.some(g => g < 90) },
  { id: 'break80', icon: '🔥', name: 'Broke 80', desc: 'Shoot 79 or better', test: c => c.gross.some(g => g < 80) },
  { id: 'single', icon: '⭐', name: 'Single Digits', desc: 'Reach a Handicap Index under 10', test: c => c.index != null && c.index < 10 },
  { id: 'birdie', icon: '🐦', name: 'Birdie!', desc: 'Record a birdie on the live scorecard', test: c => c.rounds.some(r => r.holes && r.holes.some((h, i) => h.strokes != null && h.strokes < r.pars[i])) },
  { id: 'putts30', icon: '🏁', name: 'Putting Clinic', desc: '30 putts or fewer in a round', test: c => c.full.some(r => r.putts != null && r.putts <= 30) },
  { id: 'no3putt', icon: '🧊', name: 'Ice Cold', desc: 'A full round with no three-putts', test: c => c.full.some(r => r.threePutts === 0) },
  { id: 'clean', icon: '🛡️', name: 'Clean Card', desc: 'A round with zero penalty strokes', test: c => c.full.some(r => r.penalties === 0) },
  { id: 'gir9', icon: '🟢', name: 'Green Machine', desc: 'Hit 9+ greens in regulation', test: c => c.full.some(r => r.gir >= 9) },
  { id: 'streak4', icon: '📅', name: 'Habit Formed', desc: '4-week practice streak (2+ sessions a week)', test: c => c.streak >= 4 },
  { id: 'sessions25', icon: '💪', name: 'Grinder', desc: 'Log 25 practice sessions', test: c => c.sessions >= 25 },
  { id: 'test-up', icon: '📈', name: 'Measured Progress', desc: 'Beat your previous Skills Test total', test: c => c.testUp },
];
function achievementContext() {
  const s = App.state; const tests = s.assessments.slice().sort((a, b) => a.date.localeCompare(b.date));
  return {
    rounds: s.rounds, full: s.rounds.filter(r => r.holesPlayed !== 9), index: App.index(),
    get gross() { return this.full.map(r => r.grossScore != null ? r.grossScore : r.score); },
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

/* Course search state lives in App.ui.cs: {q, loading, results, error, open}. */
function courseSearchCard() {
  const cs = App.ui.cs || {};
  let body = '';
  if (cs.loading) body = '<p class="small muted mt mb0"><span class="spinner"></span> Searching courses…</p>';
  else if (cs.error === 'not_configured') body = `<div class="callout warn small mt mb0"><strong>Course search isn't switched on yet.</strong> Add a free <a href="https://golfcourseapi.com" target="_blank" rel="noopener">GolfCourseAPI</a> key to your Vercel project as <code>GOLF_COURSE_API_KEY</code> and redeploy. You can still enter a course by hand below.</div>`;
  else if (cs.error === 'offline') body = '<div class="callout warn small mt mb0">Course search needs a connection. Courses already in your library work offline.</div>';
  else if (cs.error === 'rate_limited') body = '<div class="callout warn small mt mb0">Too many searches today. Try again tomorrow, or enter the course by hand.</div>';
  else if (cs.error) body = '<div class="callout warn small mt mb0">Course search is unavailable right now. Try again shortly, or enter the course by hand.</div>';
  else if (cs.results && !cs.results.length) body = `<p class="small muted mt mb0">No courses found for “${escapeHtml(cs.q)}”. Try the club name or town.</p>`;
  else if (cs.results) body = `<ul class="course-results">${cs.results.map((c, ci) => `<li class="${cs.open === ci ? 'open' : ''}">
      <button class="course-hit" data-action="courseOpen" data-i="${ci}"><div><strong>${escapeHtml(c.name)}</strong><div class="tiny muted">${escapeHtml([c.city, c.state, c.country].filter(Boolean).join(', '))} · ${c.tees.length} tee${c.tees.length === 1 ? '' : 's'}</div></div><span class="chev" aria-hidden="true"></span></button>
      ${cs.open === ci ? `<div class="tee-list">${c.tees.length ? c.tees.map((t, ti) => `<button class="tee-opt" data-action="importTee" data-c="${ci}" data-t="${ti}"><span class="tee-swatch" style="background:${teeColor(t.name)}"></span><span><strong>${escapeHtml(t.name)}</strong>${t.gender === 'F' ? ' <span class="tiny muted">(W)</span>' : ''}<span class="tiny muted"> · ${t.rating ?? '—'}/${t.slope ?? '—'} · par ${t.par ?? sum(t.holes.map(h => h.par))}${t.yards ? ' · ' + t.yards + ' yds' : ''}${t.holes.length === 9 ? ' · 9 holes' : ''}</span></span><span class="btn sm primary">Use</span></button>`).join('') : '<p class="small muted">No scorecard data for this course.</p>'}</div>` : ''}
    </li>`).join('')}</ul>`;
  return `<div class="card"><div class="card-head"><h2>Step 2 · Find your course</h2><span class="tag">Auto-fill</span></div>
    <p class="small muted">Search any course: rating, slope, par, stroke index and yardages fill in automatically.</p>
    <form class="search-row" data-form="courseSearch"><input type="search" name="q" value="${escapeHtml(cs.q || '')}" placeholder="Course or club name, e.g. Pebble Beach" aria-label="Search courses" minlength="3" required><button class="btn primary" type="submit">Search</button></form>
    ${body}</div>`;
}

function teeColor(name) {
  const n = (name || '').toLowerCase();
  const map = [['black', '#1b1b1b'], ['blue', '#2f6db0'], ['white', '#f4f4f0'], ['red', '#c2473a'], ['gold', '#c39a2b'], ['yellow', '#e3c229'], ['green', '#2a7a52'], ['silver', '#b8bdc2'], ['grey', '#9aa0a6'], ['gray', '#9aa0a6'], ['orange', '#e0802a'], ['purple', '#6b3fa0'], ['champ', '#1b1b1b'], ['tips', '#1b1b1b']];
  const m = map.find(([k]) => n.includes(k)); return m ? m[1] : 'var(--border-strong)';
}

/* Rating and slope for the nine being played. Falls back to half the 18-hole rating and the same slope. */
function nineRating(course, which) {
  const r = which === 'back' ? course.backRating : course.frontRating, sl = which === 'back' ? course.backSlope : course.frontSlope;
  if (r && sl) return { rating: r, slope: sl };
  if (course.pars.length === 9) return { rating: course.rating > 50 ? Math.round(course.rating / 2 * 10) / 10 : course.rating, slope: course.slope };
  return { rating: Math.round(course.rating / 2 * 10) / 10, slope: course.slope };
}

function playSetup() {
  const courses = App.state.courses; const sel = App.ui.playCourse ? courses.find(c => c.id === App.ui.playCourse) : null;
  const last = App.rounds()[0] || {};
  const c = sel || { name: last.course || App.state.profile.homeCourse || '', tees: last.tees || '', rating: last.rating || '', slope: last.slope || '', pars: DEFAULT_PARS, si: DEFAULT_SI };
  const nineOnly = c.pars.length === 9;
  let mode = App.ui.playHoles || '18'; if (nineOnly) mode = 'nine'; else if (mode === 'nine') mode = '18';
  const idx = App.index();
  let html = `<div class="page-head"><div><p class="eyebrow">Live scorecard</p><h1>Play a round</h1><p class="muted">Choose 9 or 18, find your course, and tap in each hole. Fairways, greens, scrambling and your handicap-adjusted score are worked out for you.</p></div></div>`;
  html += `<div class="card holes-pick"><div class="entry-label">Step 1 · How many holes today?</div>
    <div class="holes-tiles">
      <button type="button" class="holes-tile ${mode === '18' ? 'active' : ''}" data-action="playHoles" data-v="18" ${nineOnly ? 'disabled' : ''}><span class="holes-num">18</span><span>Full round</span></button>
      <button type="button" class="holes-tile ${mode !== '18' ? 'active' : ''}" data-action="playHoles" data-v="${mode === 'back' ? 'back' : 'front'}"><span class="holes-num">9</span><span>Quick nine</span></button>
    </div>
    ${mode === 'front' || mode === 'back' ? `<div class="seg mt">${[['front', 'Front 9 (holes 1–9)'], ['back', 'Back 9 (holes 10–18)']].map(([v, l]) => `<button type="button" class="${mode === v ? 'active' : ''}" data-action="playHoles" data-v="${v}">${l}</button>`).join('')}</div>` : ''}
    ${nineOnly ? '<p class="small muted mt mb0">This is a 9-hole course.</p>' : ''}
    ${mode !== '18' ? '<p class="tiny muted mt mb0">Nine-hole scores count toward your handicap using the official expected-score rule.</p>' : ''}
  </div>
  <div class="grid grid-2 mt"><div>${courseSearchCard()}
  <div class="card mt"><h2>Step 3 · Tee it up</h2><form class="form" data-form="startRound">
    ${courses.length ? `<div class="field"><label>Course</label><select data-change="playCourse"><option value="">Enter a course by hand…</option>${courses.map(x => `<option value="${x.id}" ${sel && sel.id === x.id ? 'selected' : ''}>${escapeHtml(x.name)}${x.tees ? ' · ' + escapeHtml(x.tees) : ''}${x.pars.length === 9 ? ' (9 holes)' : ''}</option>`).join('')}</select></div>` : ''}
    ${sel ? `<div class="course-summary"><span class="tee-swatch lg" style="background:${teeColor(sel.tees)}"></span><div><strong>${escapeHtml(sel.name)}</strong><div class="small muted">${escapeHtml(sel.tees || 'Tees')} · rating ${sel.rating ?? '—'} · slope ${sel.slope ?? '—'} · par ${sum(sel.pars)}${sel.yards ? ' · ' + sum(sel.yards) + ' yds' : ''}</div></div></div>` : ''}
    <input type="hidden" name="holesMode" value="${mode}">
    <div class="form-row">
      <div class="field"><label>Date</label><input type="date" name="date" value="${todayISO()}" required></div>
      ${sel ? '' : `<div class="field"><label>Course name</label><input name="course" value="${escapeHtml(c.name)}" placeholder="Course name" required></div>
      <div class="field"><label>Tees</label><input name="tees" value="${escapeHtml(c.tees)}" placeholder="White"></div>`}
    </div>
    ${sel ? '' : `<div class="form-row">
      <div class="field"><label>Course rating (18 holes)</label><input type="number" step="0.1" name="rating" value="${c.rating}" placeholder="71.2" required></div>
      <div class="field"><label>Slope</label><input type="number" name="slope" value="${c.slope}" placeholder="128" min="55" max="155" required></div>
    </div>`}
    ${sel && !(sel.rating && sel.slope) ? '<div class="callout warn small mb0">This scorecard is missing its rating or slope. Add them below from the card at the course.</div>' : ''}
    <details class="accordion" ${sel && sel.rating && sel.slope ? '' : 'open'}><summary>${sel ? 'Check or edit the scorecard' : 'Par &amp; stroke index for each hole'} <span class="small muted">(par ${sum(c.pars)})</span></summary><div class="acc-body">
      ${sel ? `<div class="form-row mb"><div class="field"><label>Course rating</label><input type="number" step="0.1" name="ratingEdit" value="${c.rating ?? ''}" required></div><div class="field"><label>Slope</label><input type="number" name="slopeEdit" value="${c.slope ?? ''}" min="55" max="155" required></div></div>` : ''}
      <p class="tiny muted">Stroke index (SI) ranks holes 1 (hardest) to ${c.pars.length} and decides where your handicap strokes fall.</p>
      <div class="hole-grid">${c.pars.map((p, i) => `<div class="hole-cell"><span>${i + 1}</span><input type="number" name="par_${i}" value="${p}" min="3" max="6" aria-label="Hole ${i + 1} par"><input type="number" name="si_${i}" value="${c.si[i]}" min="1" max="18" aria-label="Hole ${i + 1} stroke index"></div>`).join('')}</div>
      <div class="tiny muted mt">Top row: par · bottom row: stroke index</div>
    </div></details>
    ${sel ? '' : '<label class="field inline"><input type="checkbox" name="saveCourse" checked> Save this course to my library</label>'}
    <button class="btn primary lg" type="submit">Start ${mode === '18' ? '18-hole' : mode === 'front' ? 'front-nine' : mode === 'back' ? 'back-nine' : '9-hole'} round →</button>
    ${idx != null ? `<p class="tiny muted mb0">Your index ${fmt1(idx)} is used for net scoring and the net-double-bogey cap.${mode !== '18' ? ' Nine-hole scores count toward your index using the World Handicap System’s expected-score rule.' : ''}</p>` : `<p class="tiny muted mb0">No index yet: holes are capped at par + 5 until you have 3 rounds.${mode !== '18' ? ' Nine-hole rounds start counting once you have an index.' : ''}</p>`}
  </form></div></div>
  <div><div class="card"><div class="card-head"><h3>Course library</h3><span class="small muted">${courses.length}</span></div>
      ${courses.length ? `<ul class="list compact">${courses.map(x => `<li class="row-between"><div><span class="tee-swatch" style="background:${teeColor(x.tees)}"></span> <strong>${escapeHtml(x.name)}</strong> <span class="small muted">${escapeHtml(x.tees || '')} · ${x.rating}/${x.slope} · par ${sum(x.pars)}${x.pars.length === 9 ? ' · 9 holes' : ''}</span></div><button class="btn sm ghost danger" data-action="deleteCourse" data-id="${x.id}" aria-label="Delete course">✕</button></li>`).join('')}</ul>` : '<div class="empty small">Courses you find or enter are saved here, and they work offline.</div>'}
    </div>
    <div class="card mt"><h3>Why score hole by hole?</h3><ul class="small tick-list">
    <li><strong>Correct handicap score.</strong> Every hole is capped at net double bogey automatically, as the World Handicap System requires.</li>
    <li><strong>Nine holes count too.</strong> A front or back nine becomes an 18-hole differential using the official expected-score rule.</li>
    <li><strong>Deeper stats.</strong> Birdie/par/bogey mix, par-3/4/5 scoring, front vs back nine and which side you miss fairways.</li>
    <li><strong>GPS shot distance.</strong> Mark your ball, walk to it, see the yardage.</li></ul></div>
  </div></div>`;
  return html;
}

function playLive(lr) {
  const i = lr.cur; const h = lr.holes[i]; const par = lr.pars[i]; const t = liveTotals(lr);
  const n = lr.holes.length, first = lr.first || 0, last = n - 1; const no = k => first + k + 1;
  const rec = lr.ch != null ? strokesOnHole(lr.ch, lr.si[i], n) : 0;
  const cardSi = lr.siCard || lr.si;
  const complete = lr.holes.every(x => x.strokes != null);
  const gps = App.ui.gps || {};
  App.after(() => {
    App.keepAwake(true);
    const strip = document.querySelector('.hole-strip'), pill = strip && strip.querySelector('.cur');
    if (pill) strip.scrollLeft = pill.offsetLeft - strip.clientWidth / 2 + pill.clientWidth / 2;
  });
  let html = lr.editingId ? `<div class="callout info row-between"><span><strong>Editing a saved round.</strong> Change any hole, then save.</span><button class="btn sm" data-action="cancelEdit">Cancel</button></div>` : '';
  html += `<div class="live-head card accent">
    <div class="row-between"><div><p class="eyebrow light">${escapeHtml(lr.course)}${lr.tees ? ' · ' + escapeHtml(lr.tees) : ''}${n === 9 ? ' · ' + (lr.mode === 'back' ? 'Back 9' : lr.mode === 'front' ? 'Front 9' : '9 holes') : ''}</p><div class="live-score"><span class="big">${t.thru ? toPar(t.toPar) : 'E'}</span><span class="muted">${t.strokes} strokes · thru ${t.thru}</span></div></div>
    <div class="live-mini">${lr.ch != null ? `<div><span>${toPar(t.netToPar)}</span>net</div><div><span>${t.pts}</span>pts</div>` : ''}<div><span>${t.putts}</span>putts</div></div></div>
    <div class="hole-strip" role="tablist" aria-label="Holes" style="grid-template-columns:repeat(${n}, minmax(34px, 1fr))">${lr.holes.map((x, k) => `<button class="hole-pill ${k === i ? 'cur' : ''} ${scoreClass(x.strokes, lr.pars[k])}" data-action="holeGo" data-i="${k}" aria-label="Hole ${no(k)}${x.strokes != null ? ', ' + x.strokes : ''}"><small>${no(k)}</small>${x.strokes != null ? x.strokes : '·'}</button>`).join('')}</div>
  </div>`;

  const quick = [-1, 0, 1, 2, 3].map(d => par + d).filter(v => v > 0);
  html += `<div class="grid grid-2 mt"><div class="card hole-card">
    <div class="row-between"><div><p class="eyebrow">Hole ${no(i)}${n === 9 ? ` · ${i + 1} of 9` : ' of 18'}</p><h2 class="hole-title">Par ${par} <span class="muted">· ${lr.yards && lr.yards[i] ? lr.yards[i] + ' yds · ' : ''}SI ${cardSi[i]}</span></h2></div>${rec > 0 ? `<span class="badge">${'●'.repeat(Math.min(rec, 3))} ${rec} stroke${rec > 1 ? 's' : ''}</span>` : ''}</div>

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
      ${i < last ? `<button class="btn primary lg grow" data-action="holeGo" data-i="${i + 1}">Next hole ›</button>` : `<button class="btn primary lg grow" data-action="finishRound" ${complete ? '' : 'disabled'}>${lr.editingId ? 'Save changes ✓' : 'Finish round ✓'}</button>`}</div>
    ${i === last && !complete ? `<p class="tiny muted mb0">Enter a score on every hole to finish. Missing: ${lr.holes.map((x, k) => x.strokes == null ? no(k) : null).filter(Boolean).join(', ')}.</p>` : ''}
  </div>

  <div><div class="card"><div class="card-head"><h3>Shot distance</h3><span class="tag">GPS</span></div>
      <p class="small muted">Tap <em>Mark</em> where you hit from, walk to your ball, then tap <em>Measure</em>.</p>
      <div class="gps-read">${gps.last != null ? `<span class="big">${gps.last}</span> yds` : gps.start ? '<span class="muted">Marked. Walk to your ball…</span>' : '<span class="muted">—</span>'}</div>
      <div class="btn-row"><button class="btn primary" data-action="gpsMark">📍 Mark</button><button class="btn" data-action="gpsMeasure" ${gps.start ? '' : 'disabled'}>📏 Measure</button></div>
      ${gps.shots && gps.shots.length ? `<p class="small mt mb0">This round: ${gps.shots.slice(-6).map(s => `<span class="badge neutral">${s} yds</span>`).join(' ')}</p>` : ''}
      <p class="tiny muted mt mb0">Phone GPS is accurate to about 3–5 yds in open sky.</p></div>
    <div class="card mt"><h3>Scorecard</h3>${scorecardTable(lr.holes, lr.pars, cardSi, first)}</div>
    <div class="card mt"><h3>Round notes</h3><textarea class="notes-box" rows="3" data-change="liveNotes" placeholder="Conditions, what worked, what cost you strokes…">${escapeHtml(lr.notes || '')}</textarea></div>
    ${lr.editingId ? '' : '<div class="btn-row mt"><button class="btn ghost danger sm" data-action="discardRound">Discard round</button></div>'}
  </div></div>`;
  return html;
}

/* Compact scorecard table: two nines for 18 holes, one for a nine-hole round (first = 0 or 9). */
function scorecardTable(holes, pars, si, first) {
  first = first || 0;
  const nine = (from) => {
    const idx = [...Array(9)].map((_, k) => from + k);
    const sc = idx.map(k => holes[k].strokes); const played = sc.every(v => v != null);
    return `<table class="scorecard"><thead><tr><th>Hole</th>${idx.map(k => `<th>${first + k + 1}</th>`).join('')}<th>${first + from ? 'In' : 'Out'}</th></tr></thead><tbody>
      <tr class="muted"><td>Par</td>${idx.map(k => `<td>${pars[k]}</td>`).join('')}<td>${sum(idx.map(k => pars[k]))}</td></tr>
      ${si ? `<tr class="muted tiny"><td>SI</td>${idx.map(k => `<td>${si[k]}</td>`).join('')}<td></td></tr>` : ''}
      <tr><td><strong>Score</strong></td>${idx.map(k => `<td><span class="sc ${scoreClass(holes[k].strokes, pars[k])}">${holes[k].strokes ?? ''}</span></td>`).join('')}<td><strong>${played ? sum(sc) : ''}</strong></td></tr>
      <tr class="muted"><td>Putts</td>${idx.map(k => `<td>${holes[k].putts ?? ''}</td>`).join('')}<td>${sum(idx.map(k => holes[k].putts))}</td></tr></tbody></table>`;
  };
  return `<div class="table-wrap">${nine(0)}${holes.length > 9 ? nine(9) : ''}</div><p class="tiny muted mb0 sc-legend"><span class="sc sc-under">3</span> under par <span class="sc sc-bogey">5</span> bogey <span class="sc sc-double">6</span> double+</p>`;
}

/* ---------- AI round summary ---------- */
function aiBox(r) {
  if (r.aiSummary) return `<div class="ai-box" id="aiBox"><div class="ai-head">✨ Coach's debrief</div>${escapeHtml(r.aiSummary).split(/\n+/).map(p => `<p>${p}</p>`).join('')}</div>`;
  return `<div class="ai-box empty" id="aiBox"><div><div class="ai-head">✨ Coach's debrief</div><p class="small muted mb0">A plain-English breakdown of where the strokes went and what to practise this week.${Cloud.user ? '' : ' Needs a free account.'}</p></div><button class="btn primary sm" data-action="aiSummary" data-id="${r.id}">Write it</button></div>`;
}

/* What the coach sees: this round, the player's level and benchmark, and drills to choose from. */
function aiPayload(r) {
  const idx = r.indexUsed ?? App.index(); const target = App.targetHcp(); const b = benchmarkFor(target);
  const nine = r.holesPlayed === 9;
  const st = nine ? null : roundStats([{ ...r, diff: null }], 1);
  const areas = st ? strokeLossAnalysis(st, target) : strokeLossAnalysis(roundStats(App.rounds(), 10), target);
  const drills = recommendDrills(areas, 3).flatMap(x => x.drills.map(d => ({ name: d.name, area: x.area.label, goal: d.goal })));
  return {
    round: { date: r.date, course: r.course, holesPlayed: nine ? 9 : 18, nine: r.nine || null, par: r.par, grossScore: r.grossScore ?? r.score, adjustedScore: r.score,
      differential: r.diff != null ? r.diff : null, putts: r.putts, greensInRegulation: r.gir, fairwaysHit: r.firHit, fairwaysPossible: r.firPossible, penalties: r.penalties,
      threePutts: r.threePutts, doublesOrWorse: r.doubles, upAndDowns: r.udAtt ? `${r.udMade}/${r.udAtt}` : null, sandSaves: r.sandAtt ? `${r.sandMade}/${r.sandAtt}` : null, notes: r.notes || null,
      holes: r.holes ? r.holes.map((h, i) => ({ hole: (r.firstHole || 0) + i + 1, par: r.pars[i], strokes: h.strokes, putts: h.putts, teeShot: h.fir, penalties: h.pen || 0, bunker: !!h.sand })) : null },
    player: { handicapIndex: idx, targetHandicap: target, level: App.tier().label },
    benchmarkForTarget: { handicap: b.label, putts: b.putts, girPercent: b.gir, fairwayPercent: b.fir, scramblingPercent: b.scrambling, threePutts: b.threePutts, penalties: b.penalties, doubles: b.doubles },
    estimatedStrokesLost: areas.filter(a => a.loss > 0).map(a => ({ area: a.label, strokes: a.loss })),
    drillsToChooseFrom: drills.length ? drills : DRILLS.slice(0, 6).map(d => ({ name: d.name, area: categoryLabel(d.category), goal: d.goal })),
  };
}

/* Edit form for a quick-logged (totals only) round. */
function editRoundForm(r) {
  const f = (name, label, v, attrs) => `<div class="field"><label>${label}</label><input name="${name}" value="${v == null ? '' : escapeHtml(v)}" ${attrs || 'type="number" min="0"'}></div>`;
  const nine = r.holesPlayed === 9;
  return `<h2>Edit round</h2><form class="form" data-form="editRound"><input type="hidden" name="id" value="${r.id}">
    <div class="form-row">${f('date', 'Date', r.date, 'type="date" required')}${f('course', 'Course', r.course, 'type="text"')}${f('tees', 'Tees', r.tees, 'type="text"')}</div>
    <div class="form-row">${f('par', 'Par', r.par, 'type="number" required')}${f('rating', nine ? 'Rating (18-hole card)' : 'Course rating', nine ? Math.round(r.rating * 2 * 10) / 10 : r.rating, 'type="number" step="0.1" required')}${f('slope', 'Slope', r.slope, 'type="number" min="55" max="155" required')}${f('score', 'Score (adjusted)', r.score, 'type="number" required')}</div>
    <div class="form-row">${f('putts', 'Putts', r.putts)}${f('firHit', 'Fairways hit', r.firHit)}${f('firPossible', 'Fairways possible', r.firPossible)}${f('gir', 'GIR', r.gir)}${f('penalties', 'Penalties', r.penalties)}</div>
    <div class="form-row">${f('udAtt', 'U&D attempts', r.udAtt)}${f('udMade', 'U&D made', r.udMade)}${f('sandAtt', 'Sand att.', r.sandAtt)}${f('sandMade', 'Sand saves', r.sandMade)}${f('threePutts', '3-putts', r.threePutts)}${f('doubles', 'Doubles+', r.doubles)}</div>
    <div class="field"><label>Notes</label><textarea name="notes" rows="2">${escapeHtml(r.notes || '')}</textarea></div>
    <div class="btn-row"><button class="btn primary" type="submit">Save changes</button><button type="button" class="btn" data-action="closeModal">Cancel</button></div></form>`;
}

function roundCardModal(r) {
  const s = holeBreakdown([r]);
  return `<p class="eyebrow">${fmtDate(r.date)}</p><h2>${escapeHtml(r.course || 'Round')}</h2>
    <div class="stat-row mb">${statBox('Gross', r.grossScore ?? r.score, r.holesPlayed === 9 ? (r.nine === 'back' ? 'back nine' : 'front nine') : '')}${statBox('Adjusted', r.score, 'for handicap')}${statBox('Differential', fmt1(r.diff), r.holesPlayed === 9 ? '18-hole equivalent' : '')}${r.putts != null ? statBox('Putts', r.putts) : ''}</div>
    ${scorecardTable(r.holes, r.pars, r.si, r.firstHole)}
    ${s ? `<p class="small mt mb0">${s.dist.eagle + s.dist.birdie} birdies or better · ${s.dist.par} pars · ${s.dist.bogey} bogeys · ${s.dist.double + s.dist.triple} doubles+</p>` : ''}
    ${r.notes ? `<p class="small mt mb0"><strong>Notes:</strong> ${escapeHtml(r.notes)}</p>` : ''}
    ${aiBox(r)}
    <div class="btn-row mt"><button class="btn" data-action="editRound" data-id="${r.id}">✎ Edit round</button></div>`;
}

/* ---------- Actions for the scorecard ---------- */
Object.assign(Actions, {
  holeGo(el) { const lr = App.state.liveRound; const i = parseInt(el.dataset.i, 10); if (i < 0 || i >= lr.holes.length) return; lr.cur = i; Store.save(); App.render(); document.querySelector('.hole-card')?.scrollIntoView({ block: 'nearest' }); },
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
    const editing = lr.editingId ? App.state.rounds.find(x => x.id === lr.editingId) : null;
    const before = unlockedIds(); const prevIdx = editing ? (editing.indexUsed ?? App.index()) : App.index();
    const st = statsFromHoles(lr.holes, lr.pars); const par = sum(lr.pars); const nine = lr.holes.length === 9;
    const r = { id: editing ? editing.id : uid(), date: lr.date, course: lr.course, tees: lr.tees, par, rating: lr.rating, slope: lr.slope,
      score: adjustedGross(lr.holes, lr.pars, lr.si, lr.ch), grossScore: st.gross, holes: lr.holes.map(h => ({ ...h })), pars: lr.pars.slice(), si: (lr.siCard || lr.si).slice(),
      putts: st.putts, firHit: st.firHit, firPossible: st.firPossible, gir: st.gir, penalties: st.penalties, udAtt: st.udAtt, udMade: st.udMade,
      sandAtt: st.sandAtt, sandMade: st.sandMade, threePutts: st.threePutts, doubles: st.doubles, notes: (lr.notes || '').trim(),
      ch: lr.ch, indexUsed: prevIdx, courseId: lr.courseId || null, mode: lr.mode, yards: lr.yards || null, siRank: lr.si.slice() };
    if (nine) { r.holesPlayed = 9; r.nine = lr.mode === 'back' ? 'back' : lr.mode === 'front' ? 'front' : null; r.firstHole = lr.first || 0; r.diff18 = nineHoleDifferential(r.score, r.rating, r.slope, prevIdx); }
    if (editing) App.state.rounds[App.state.rounds.indexOf(editing)] = r; else App.state.rounds.push(r);
    App.state.liveRound = null; App.ui.gps = null; App.keepAwake(false); Store.save();
    location.hash = '#/rounds'; App.render();
    if (editing) { App.closeModal(); App.toast('Round updated'); return; }
    const idx = App.index(); r.diff = nine ? r.diff18 : scoreDifferential(r.score, r.rating, r.slope);
    App.modal(`<div class="finish-hero"><span class="eyebrow">Round complete</span><div class="finish-score">${r.grossScore}</div><p class="muted">${toPar(r.grossScore - par)} · ${escapeHtml(r.course)}${nine ? ' · ' + (r.nine === 'back' ? 'back nine' : r.nine === 'front' ? 'front nine' : '9 holes') : ''}</p></div>
      ${nine ? `<div class="callout small">${r.diff18 != null ? `Nine-hole score converted to an 18-hole differential of <strong>${fmt1(r.diff18)}</strong> using your expected score for the other nine.` : 'Nine-hole rounds count toward your index once you have one (3 full rounds).'}</div>` : ''}
      ${r.score !== r.grossScore ? `<div class="callout info small">Adjusted to <strong>${r.score}</strong> for handicap (holes capped at net double bogey).</div>` : ''}
      <div class="stat-row mb">${statBox('Differential', fmt1(r.diff))}${statBox('Index', idx != null ? fmt1(idx) : '—', prevIdx != null && idx != null && idx !== prevIdx ? (idx < prevIdx ? '▼ ' : '▲ ') + fmt1(Math.abs(idx - prevIdx)) : '')}${statBox('Putts', r.putts ?? '—')}${statBox('GIR', r.gir ?? '—')}</div>
      ${scorecardTable(r.holes, r.pars, r.si, r.firstHole)}
      ${aiBox(r)}
      <div class="btn-row mt"><button class="btn primary" data-action="closeModal">Done</button><button class="btn" data-action="goto" data-href="#/stats">See stats</button></div>`);
    announceAchievements(before);
  },
  /* Reopen a saved round: hole-by-hole rounds go back into the scorecard, quick-logged ones get a form. */
  editRound(el) {
    const r = App.state.rounds.find(x => x.id === el.dataset.id); if (!r) return;
    if (!r.holes) { App.modal(editRoundForm(r)); return; }
    if (App.state.liveRound && !confirm('You have a round in progress. Replace it with this round for editing?')) return;
    const n = r.holes.length;
    App.state.liveRound = { id: uid(), editingId: r.id, date: r.date, courseId: r.courseId || null, course: r.course, tees: r.tees, rating: r.rating, slope: r.slope,
      mode: r.mode || (n === 9 ? (r.nine || 'nine') : '18'), first: r.firstHole || 0, pars: r.pars.slice(), siCard: r.si.slice(),
      si: r.siRank ? r.siRank.slice() : (n === 9 ? rankStrokeIndex(r.si) : r.si.slice()),
      ch: r.ch !== undefined ? r.ch : (App.index() != null ? (n === 9 ? courseHandicap9(App.index(), r.slope, r.rating, sum(r.pars)) : courseHandicap(App.index(), r.slope, r.rating, sum(r.pars))) : null),
      yards: r.yards || null, notes: r.notes || '', cur: 0, holes: r.holes.map(h => ({ ...h })) };
    Store.save(); App.closeModal(); location.hash = '#/play'; App.render(); App.toast('Editing round. Tap any hole to change it, then save.');
  },
  cancelEdit() { if (!confirm('Discard your changes to this round?')) return; App.state.liveRound = null; Store.save(); location.hash = '#/rounds'; App.render(); },
  playHoles(el) { App.ui.playHoles = el.dataset.v; App.render(); },
  courseOpen(el) { const cs = App.ui.cs; const i = parseInt(el.dataset.i, 10); cs.open = cs.open === i ? null : i; App.render(); },
  importTee(el) {
    const c = App.ui.cs.results[parseInt(el.dataset.c, 10)]; const t = c.tees[parseInt(el.dataset.t, 10)];
    const course = courseFromTee(c, t);
    const existing = App.state.courses.find(x => x.extId === course.extId && x.tees === course.tees);
    if (existing) Object.assign(existing, course, { id: existing.id }); else App.state.courses.push(course);
    App.ui.playCourse = (existing || course).id; App.ui.cs = null; Store.save(); App.render();
    App.toast(`${course.name} (${course.tees}) added to your library`);
  },
  deleteCourse(el) { if (!confirm('Remove this course from your library?')) return; App.state.courses = App.state.courses.filter(c => c.id !== el.dataset.id); Store.tombstone(el.dataset.id); if (App.ui.playCourse === el.dataset.id) App.ui.playCourse = null; Store.save(); App.render(); },
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
    const saved = App.ui.playCourse ? App.state.courses.find(c => c.id === App.ui.playCourse) : null;
    const len = saved ? saved.pars.length : 18;
    const pars = [...Array(len)].map((_, i) => Math.max(3, Math.min(6, parseInt(v['par_' + i], 10) || DEFAULT_PARS[i])));
    const si = [...Array(len)].map((_, i) => Math.max(1, Math.min(18, parseInt(v['si_' + i], 10) || DEFAULT_SI[i])));
    const rating = num(saved ? v.ratingEdit : v.rating), slope = num(saved ? v.slopeEdit : v.slope);
    if (!(slope >= 55 && slope <= 155)) { App.toast('Slope must be between 55 and 155'); return; }
    if (!(rating > 20 && rating < 90)) { App.toast('Enter the course rating from the scorecard'); return; }
    if (new Set(si).size !== len) { App.toast(`Each stroke index must be used exactly once`); return; }
    let courseId = saved ? saved.id : null;
    const course = saved ? { rating, slope, pars, si } : { name: v.course.trim(), tees: v.tees.trim(), rating, slope, pars, si };
    if (saved) Object.assign(saved, course);
    else if (v.saveCourse) { courseId = uid(); App.state.courses.push({ id: courseId, ...course }); }
    const full = saved || course;
    // Which holes are being played: all of them, or one nine of an 18-hole card.
    const mode = len === 9 ? 'nine' : (v.holesMode === 'front' || v.holesMode === 'back' ? v.holesMode : '18');
    const first = mode === 'back' ? 9 : 0, n = mode === '18' ? 18 : 9;
    const take = arr => arr ? arr.slice(first, first + n) : null;
    const idx = App.index(); const lpars = take(pars), lsiCard = take(si);
    let lr;
    if (n === 18) {
      lr = { rating, slope, pars: lpars, si: lsiCard, ch: idx != null ? courseHandicap(idx, slope, rating, sum(lpars)) : null };
    } else {
      const r9 = nineRating({ ...full, rating, slope }, mode === 'back' ? 'back' : 'front');
      lr = { rating: r9.rating, slope: r9.slope, pars: lpars, si: rankStrokeIndex(lsiCard), siCard: lsiCard, ch: courseHandicap9(idx, r9.slope, r9.rating, sum(lpars)) };
    }
    App.state.liveRound = Object.assign(lr, { id: uid(), date: v.date, courseId, course: full.name, tees: full.tees, mode, first, yards: take(full.yards), cur: 0,
      holes: lpars.map(() => ({ strokes: null, putts: null, fir: null, pen: 0, sand: false })) });
    App.ui.gps = null; Store.save(); App.render(); App.toast('Round started. Good luck out there!');
  },
});

/* Turn a search result + tee into a library course. Missing stroke indexes fall back to a standard order. */
function courseFromTee(c, t) {
  const n = t.holes.length === 9 ? 9 : 18;
  const holes = t.holes.slice(0, n);
  const pars = holes.map((h, i) => h.par || DEFAULT_PARS[i]);
  let si = holes.map(h => h.si);
  if (si.some(x => !x) || new Set(si).size !== n) si = n === 18 ? DEFAULT_SI.slice() : rankStrokeIndex(DEFAULT_SI.slice(0, 9));
  return { id: uid(), extId: c.id, name: c.name, tees: t.name + (t.gender === 'F' ? ' (W)' : ''), rating: t.rating, slope: t.slope,
    frontRating: t.frontRating, frontSlope: t.frontSlope, backRating: t.backRating, backSlope: t.backSlope,
    pars, si, yards: holes.some(h => h.yards) ? holes.map(h => h.yards || null) : null, location: [c.city, c.state].filter(Boolean).join(', ') };
}

Object.assign(Forms, {
  editRound(form, v) {
    const r = App.state.rounds.find(x => x.id === v.id); if (!r) return;
    const slope = num(v.slope); if (!(slope >= 55 && slope <= 155)) { App.toast('Slope must be between 55 and 155'); return; }
    Object.assign(r, { date: v.date, course: v.course.trim(), tees: v.tees.trim(), par: num(v.par, r.par), slope, score: num(v.score, r.score), notes: v.notes.trim() });
    r.rating = r.holesPlayed === 9 ? Math.round(num(v.rating) / 2 * 10) / 10 : num(v.rating);
    ['putts', 'firHit', 'firPossible', 'gir', 'penalties', 'udAtt', 'udMade', 'sandAtt', 'sandMade', 'threePutts', 'doubles'].forEach(k => { const n = parseFloat(v[k]); r[k] = isNaN(n) ? null : n; });
    if (r.holesPlayed === 9) r.diff18 = nineHoleDifferential(r.score, r.rating, r.slope, r.indexUsed ?? App.index());
    Store.save(); App.closeModal(); App.render(); App.toast('Round updated');
  },
  courseSearch(form, v) {
    const q = (v.q || '').trim(); if (q.length < 3) return;
    const token = (App._csToken || 0) + 1; App._csToken = token;
    App.ui.cs = { q, loading: true }; App.render();
    const done = (patch) => { if (App._csToken !== token) return; App.ui.cs = Object.assign({ q }, patch); App.render(); };
    if (!navigator.onLine) { done({ error: 'offline' }); return; }
    fetch('api/courses?q=' + encodeURIComponent(q), { headers: { Accept: 'application/json' } })
      .then(r => r.json().catch(() => ({ error: r.status === 404 ? 'not_configured' : 'upstream_error' })).then(body => ({ ok: r.ok, status: r.status, body })))
      .then(({ ok, body }) => ok && Array.isArray(body.courses) ? done({ results: body.courses, open: body.courses.length === 1 ? 0 : null }) : done({ error: body.error || 'upstream_error' }))
      .catch(() => done({ error: navigator.onLine ? 'upstream_error' : 'offline' }));
  },
});

Object.assign(Changes, {
  liveNotes(el) { if (App.state.liveRound) { App.state.liveRound.notes = el.value; Store.save(); } },
  playCourse(el) { App.ui.playCourse = el.value || null; App.ui.playHoles = null; App.render(); },
  roundCourse(el) { App.ui.roundCourse = el.value || null; App.render(); },
});
