/* App controller: routing, state helpers, event handling. */
const App = {
  state: null,
  ui: {},                 // transient view state (filters, tabs)
  afterHooks: [],
  timer: { total: 0, remaining: 0, running: false, label: '', handle: null },

  init() {
    this.state = Store.load();
    this.applyTheme();
    window.addEventListener('hashchange', () => this.render());
    document.addEventListener('click', e => this.onClick(e));
    document.addEventListener('submit', e => this.onSubmit(e));
    document.addEventListener('change', e => this.onChange(e));
    document.addEventListener('input', e => { const el = e.target.closest('[data-change="drillQ"]'); if (el) { this.ui.drillQ = el.value; this.renderKeepFocus(el); } });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') this.closeModal(); if (e.key === 'Enter' && e.target.matches('.drill-card')) e.target.click(); });
    document.getElementById('menuBtn').addEventListener('click', () => this.toggleMenu());
    document.getElementById('scrim').addEventListener('click', () => this.toggleMenu(false));
    document.getElementById('themeBtn').addEventListener('click', () => { this.state.settings.theme = this.state.settings.theme === 'dark' ? 'light' : 'dark'; Store.save(); this.applyTheme(); this.render(); });
    window.addEventListener('resize', () => { clearTimeout(this._rz); this._rz = setTimeout(() => this.runAfter(), 150); });
    if (!location.hash) location.hash = '#/dashboard';
    this.render();
  },

  /* ---------- derived data ---------- */
  rounds() {
    return this.state.rounds.map(r => ({ ...r, diff: scoreDifferential(r.score, r.rating, r.slope) })).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  },
  index() { return computeIndex(this.rounds()); },
  countedDiffs() {
    const rs = this.rounds().slice(0, 20); const rule = whsRule(rs.length); if (!rule) return [];
    return rs.slice().sort((a, b) => a.diff - b.diff).slice(0, rule.use).map(r => r.id);
  },
  tier() { const o = this.state.profile.tierOverride; return (o && TIERS.find(t => t.id === o)) || tierForIndex(this.index()); },
  targetHcp() {
    const p = this.state.profile; const idx = this.index();
    if (p.targetIndex != null && !isNaN(p.targetIndex)) return Math.round(p.targetIndex);
    if (idx != null) return Math.max(0, Math.round(idx - 5));
    return 15;
  },
  programWeek() {
    const s = this.state.programStart; if (!s) return null;
    const week = Math.floor(daysBetween(s, todayISO()) / 7) + 1;
    if (week < 1 || week > 12) return null;
    return { week, phase: PROGRAM.phases.find(p => p.weeks.includes(week)) };
  },
  assessmentTotal(a) { return ASSESSMENT_TESTS.reduce((s, t) => s + (a.results[t.id] || 0), 0); },
  goalProgressBar(idx) {
    const p = this.state.profile; const hist = indexHistory(this.rounds()).filter(h => h.index != null);
    const start = hist.length ? Math.max(...hist.map(h => h.index)) : idx;
    const total = start - p.targetIndex; const done = start - idx;
    const pc = total > 0 ? Math.max(0, Math.min(100, Math.round(100 * done / total))) : (idx <= p.targetIndex ? 100 : 0);
    return `<div class="mt"><div class="small" style="display:flex;justify-content:space-between"><span>Started ${fmt1(start)}</span><span>${pc}% to target ${fmt1(p.targetIndex)}</span></div><div class="progress gold"><span style="width:${pc}%"></span></div></div>`;
  },

  /* ---------- rendering ---------- */
  route() { return (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?')[0]; },
  render() {
    const route = this.route(); const view = Views[route] || Views.dashboard;
    this.afterHooks = [];
    const host = document.getElementById('view');
    try { host.innerHTML = view(); } catch (e) { console.error(e); host.innerHTML = `<div class="callout warn">Something went wrong rendering this page: ${escapeHtml(e.message)}</div>`; }
    document.querySelectorAll('.nav-list a[data-route]').forEach(a => a.classList.toggle('active', a.dataset.route === route));
    const idx = this.index(); document.getElementById('topIndex').textContent = idx != null ? 'HI ' + fmt1(idx) : 'HI —';
    this.toggleMenu(false);
    window.scrollTo({ top: 0 });
    this.runAfter();
  },
  renderKeepFocus(el) {
    const sel = '[data-change="' + el.dataset.change + '"]'; const pos = el.selectionStart;
    this.render(); const n = document.querySelector(sel); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* not a text input */ } }
  },
  after(fn) { this.afterHooks.push(fn); },
  runAfter() { this.afterHooks.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); },
  applyTheme() { document.documentElement.setAttribute('data-theme', this.state.settings.theme || 'light'); },
  toggleMenu(force) { const open = force != null ? force : !document.getElementById('sidebar').classList.contains('open'); document.getElementById('sidebar').classList.toggle('open', open); document.getElementById('scrim').classList.toggle('open', open); },
  toast(msg) { const h = document.getElementById('toastHost'); const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; h.appendChild(t); setTimeout(() => t.remove(), 2600); },
  modal(html) { this.closeModal(); const m = document.createElement('div'); m.className = 'modal-host'; m.id = 'modalHost'; m.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><button class="btn sm ghost close" data-action="closeModal" aria-label="Close">✕</button>${html}</div>`; m.addEventListener('click', e => { if (e.target === m) this.closeModal(); }); document.body.appendChild(m); },
  closeModal() { const m = document.getElementById('modalHost'); if (m) m.remove(); },
  fmtTimer(s) { s = Math.max(0, Math.round(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); },

  /* ---------- events ---------- */
  onClick(e) {
    const el = e.target.closest('[data-action]'); if (!el) return;
    const act = el.dataset.action; if (!Actions[act]) return;
    if (el.tagName === 'A' || el.closest('.drill-card') && act !== 'openDrill') e.preventDefault();
    if (act === 'toggleFav') e.stopPropagation();
    Actions[act](el, e);
  },
  onSubmit(e) { const f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault(); const fn = Forms[f.dataset.form]; if (fn) fn(f, Object.fromEntries(new FormData(f).entries())); },
  onChange(e) { const el = e.target.closest('[data-change]'); if (!el) return; const fn = Changes[el.dataset.change]; if (fn) fn(el); },

  /* ---------- timer ---------- */
  timerSet(min, label) { this.timerStop(); this.timer.total = this.timer.remaining = min * 60; this.timer.label = label || ''; },
  timerStop() { if (this.timer.handle) clearInterval(this.timer.handle); this.timer.handle = null; this.timer.running = false; },
  timerToggle() {
    const t = this.timer; if (t.running) { this.timerStop(); this.render(); return; }
    if (!t.remaining) return;
    t.running = true; const end = Date.now() + t.remaining * 1000;
    t.handle = setInterval(() => {
      t.remaining = Math.max(0, Math.round((end - Date.now()) / 1000));
      const d = document.getElementById('timerDisplay'); if (d) d.textContent = this.fmtTimer(t.remaining);
      if (t.remaining <= 0) { this.timerStop(); this.beep(); this.toast('Time! Log your score.'); this.render(); }
    }, 250);
    this.render();
  },
  beep() { try { const ac = new (window.AudioContext || window.webkitAudioContext)(); [0, 0.25, 0.5].forEach(t => { const o = ac.createOscillator(), g = ac.createGain(); o.connect(g); g.connect(ac.destination); o.frequency.value = 880; g.gain.setValueAtTime(0.2, ac.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + t + 0.2); o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.2); }); } catch (e) { /* audio not available */ } },
};

/* ---------- click actions ---------- */
const Actions = {
  closeModal() { App.closeModal(); },
  openDrill(el) { const d = getDrill(el.dataset.id); if (d) App.modal(drillModal(d)); },
  toggleFav(el) { const f = App.state.favorites; const i = f.indexOf(el.dataset.id); i >= 0 ? f.splice(i, 1) : f.push(el.dataset.id); Store.save(); if (document.getElementById('modalHost')) Actions.openDrill(el); App.render(); },
  timerFor(el) { App.timerSet(parseInt(el.dataset.min, 10), el.dataset.name); App.closeModal(); location.hash = '#/tools'; App.timerToggle(); },
  timerSet(el) { App.timerSet(parseInt(el.dataset.min, 10)); App.render(); },
  timerSetCustom() { const v = parseInt(document.getElementById('timerCustom').value, 10); if (v > 0) { App.timerSet(v); App.render(); } },
  timerToggle() { App.timerToggle(); },
  timerReset() { App.timerStop(); App.timer.remaining = App.timer.total; App.render(); },
  logDrill(el) { App.ui.sessionDrills = App.ui.sessionDrills || []; App.ui.sessionDrills.push({ id: el.dataset.id, result: '' }); App.closeModal(); location.hash = '#/sessions'; App.render(); App.toast('Drill added to the session form'); },
  addSessionDrill() { const id = document.getElementById('drillPicker').value; App.ui.sessionDrills = App.ui.sessionDrills || []; Actions._captureResults(); App.ui.sessionDrills.push({ id, result: '' }); App.render(); },
  removeSessionDrill(el) { Actions._captureResults(); App.ui.sessionDrills.splice(parseInt(el.dataset.i, 10), 1); App.render(); },
  _captureResults() { (App.ui.sessionDrills || []).forEach((d, i) => { const inp = document.querySelector(`[name="result_${i}"]`); if (inp) d.result = inp.value; }); },
  deleteRound(el) { if (!confirm('Delete this round?')) return; App.state.rounds = App.state.rounds.filter(r => r.id !== el.dataset.id); Store.save(); App.render(); },
  deleteSession(el) { if (!confirm('Delete this session?')) return; App.state.sessions = App.state.sessions.filter(r => r.id !== el.dataset.id); Store.save(); App.render(); },
  deleteAssessment(el) { if (!confirm('Delete this test?')) return; App.state.assessments = App.state.assessments.filter(r => r.id !== el.dataset.id); Store.save(); App.render(); },
  statsWindow(el) { App.ui.statsWindow = parseInt(el.dataset.n, 10); App.render(); },
  drillCat(el) { App.ui.drillCat = el.dataset.cat; App.render(); },
  drillFav() { App.ui.drillFav = !App.ui.drillFav; App.render(); },
  drillMax(el) { App.ui.drillMax = parseInt(el.dataset.m, 10); App.render(); },
  drillDiff(el) { App.ui.drillDiff = parseInt(el.dataset.k, 10); App.render(); },
  playbookTab(el) { App.ui.playbookTab = el.dataset.tab; App.render(); },
  planWeek(el) {
    const dir = parseInt(el.dataset.dir, 10); if (!dir) { App.ui.planWeek = null; App.render(); return; }
    const cur = App.ui.planWeek || isoWeekKey(new Date()); const [y, w] = cur.split('-W').map(Number);
    const d = new Date(Date.UTC(y, 0, 4)); d.setUTCDate(d.getUTCDate() + (w - 1 + dir) * 7);
    App.ui.planWeek = isoWeekKey(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); App.render();
  },
  startProgram() { App.state.programStart = todayISO(); Store.save(); App.render(); App.toast('12-week program started. Week 1: run the Skills Test.'); },
  resetProgram() { if (!confirm('Reset the 12-week program?')) return; App.state.programStart = ''; Store.save(); App.render(); },
  resetRoutine() { App.state.routine = DEFAULT_ROUTINE.slice(); Store.save(); App.render(); },
  addRoutineStep() { App.state.routine.push(''); Store.save(); App.render(); },
  removeRoutineStep(el) { App.state.routine.splice(parseInt(el.dataset.i, 10), 1); Store.save(); App.render(); },
  addClub() { App.state.clubs.push({ club: 'New', carry: 100 }); Store.save(); App.render(); },
  removeClub(el) { App.state.clubs.splice(parseInt(el.dataset.i, 10), 1); Store.save(); App.render(); },
  randomDrill() { const cat = document.getElementById('randCat').value; App.ui.randCat = cat; const pool = cat === 'all' ? DRILLS : drillsByCategory(cat); App.ui.randDrill = pool[Math.floor(Math.random() * pool.length)].id; App.render(); },
  exportData() { const blob = new Blob([Store.export()], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'fairway-lab-backup-' + todayISO() + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); },
  resetData() { if (!confirm('Delete ALL rounds, sessions, tests and settings? This cannot be undone.')) return; Store.reset(); App.state = Store.state; App.ui = {}; App.render(); App.toast('All data deleted'); },
  loadDemo() { if (App.state.rounds.length && !confirm('This adds demo rounds, sessions and a skills test alongside your existing data. Continue?')) return; loadDemoData(); Store.save(); App.render(); App.toast('Demo data loaded'); },
};

/* ---------- form handlers ---------- */
const Forms = {
  round(form, v) {
    const r = { id: uid(), date: v.date, course: v.course.trim(), tees: v.tees.trim(), par: num(v.par, 72), rating: num(v.rating), slope: num(v.slope), score: num(v.score), notes: v.notes.trim() };
    ['putts', 'firHit', 'firPossible', 'gir', 'penalties', 'udAtt', 'udMade', 'sandAtt', 'sandMade', 'threePutts', 'doubles'].forEach(k => { const n = parseFloat(v[k]); r[k] = isNaN(n) ? null : n; });
    if (r.firHit == null) r.firPossible = null;
    if (!(r.slope >= 55 && r.slope <= 155)) { App.toast('Slope must be between 55 and 155'); return; }
    App.state.rounds.push(r); Store.save(); App.render();
    const idx = App.index(); App.toast(idx != null ? 'Round saved. Index: ' + fmt1(idx) : 'Round saved (' + App.state.rounds.length + '/3 for an index)');
  },
  session(form, v) {
    Actions._captureResults();
    const s = { id: uid(), date: v.date, minutes: num(v.minutes, 0), type: v.type, notes: v.notes.trim(), drills: (App.ui.sessionDrills || []).map(d => ({ id: d.id, result: d.result })) };
    App.state.sessions.push(s); App.ui.sessionDrills = []; Store.save(); App.render(); App.toast('Session saved. Nice work.');
  },
  assessment(form, v) {
    const results = {}; ASSESSMENT_TESTS.forEach(t => { results[t.id] = Math.max(0, Math.min(10, num(v[t.id], 0))); });
    App.state.assessments.push({ id: uid(), date: v.date, results }); Store.save(); App.render(); App.toast('Skills test saved');
  },
  goals(form, v) {
    const p = App.state.profile; p.name = v.name.trim(); p.homeCourse = v.homeCourse.trim(); p.targetIndex = num(v.targetIndex, null); p.targetDate = v.targetDate; Store.save(); App.render(); App.toast('Goal saved');
  },
  clubQuery(form, v) {
    const dist = num(v.dist, 150), wind = num(v.wind, 0), elev = num(v.elev, 0), cond = num(v.cond, 0);
    let plays = dist + wind * 1.0 + elev * 1.0 + cond * 8;   // ≈ 1 yd per mph wind, 1 yd per yd elevation, cold ≈ +8
    plays = Math.round(plays);
    const clubs = App.state.clubs.slice().sort((a, b) => a.carry - b.carry);
    let club = clubs.find(c => c.carry >= plays) || clubs[clubs.length - 1];
    const below = clubs.filter(c => c.carry < plays).pop();
    let alt = null; if (club && club.carry - plays > 8 && below) alt = null; if (club && below && plays - below.carry <= 5) { alt = club; club = below; }
    App.ui.clubQuery = { dist, wind, elev, cond, result: { plays, club: club.club, carry: club.carry, alt: alt && alt.club !== club.club ? alt : null } }; App.render();
  },
  chCalc(form, v) { const index = num(v.index), slope = num(v.slope), rating = num(v.rating), par = num(v.par); App.ui.chCalc = { index, slope, rating, par, result: courseHandicap(index, slope, rating, par) }; App.render(); },
  stableford(form, v) { const ch = num(v.ch, 0), gross = num(v.gross, 0), par = num(v.par, 72); const net = gross - ch; App.ui.stableford = { ch, gross, par, result: { net, pts: Math.max(0, 36 + par - net) } }; App.render(); },
};

/* ---------- change handlers ---------- */
const Changes = {
  planCheck(el) { const wk = el.dataset.week; App.state.planChecks[wk] = App.state.planChecks[wk] || {}; App.state.planChecks[wk][el.dataset.day] = el.checked; Store.save(); App.render(); },
  tierOverride(el) { App.state.profile.tierOverride = el.value; Store.save(); App.render(); },
  budget(el) { App.state.profile.budget = el.value; Store.save(); App.render(); },
  routineStep(el) { App.state.routine[parseInt(el.dataset.i, 10)] = el.value; Store.save(); },
  clubName(el) { App.state.clubs[parseInt(el.dataset.i, 10)].club = el.value.trim() || '?'; Store.save(); App.render(); },
  clubCarry(el) { App.state.clubs[parseInt(el.dataset.i, 10)].carry = num(el.value, 0); Store.save(); App.render(); },
  wedge(el) { const n = parseFloat(el.value); if (isNaN(n)) delete App.state.wedgeMatrix[el.dataset.key]; else App.state.wedgeMatrix[el.dataset.key] = n; Store.save(); },
  commit(el) { App.state.commitments[el.dataset.key] = el.checked; Store.save(); App.render(); },
  importFile(el) {
    const f = el.files[0]; if (!f) return; const rd = new FileReader();
    rd.onload = () => { try { Store.import(rd.result); App.state = Store.state; App.applyTheme(); App.render(); App.toast('Backup imported'); } catch (e) { App.toast('Import failed: ' + e.message); } };
    rd.readAsText(f);
  },
};

/* ---------- demo data ---------- */
function loadDemoData() {
  const s = App.state; const today = new Date();
  const d = n => { const x = new Date(today); x.setDate(x.getDate() - n); return x.toISOString().slice(0, 10); };
  const rows = [
    [84, 94, 37, 5, 3, 3, 3, 4, 12, 2], [77, 91, 35, 6, 4, 2, 2, 3, 11, 3], [70, 96, 38, 4, 2, 4, 4, 5, 13, 2], [63, 89, 34, 7, 4, 1, 2, 3, 10, 3],
    [56, 92, 36, 6, 3, 2, 3, 4, 12, 3], [49, 88, 33, 8, 5, 1, 1, 2, 10, 4], [42, 90, 35, 7, 4, 2, 2, 3, 11, 3], [35, 86, 33, 8, 6, 1, 1, 2, 9, 4],
    [28, 89, 34, 7, 5, 2, 2, 3, 10, 4], [21, 85, 32, 9, 6, 0, 1, 2, 9, 4], [14, 87, 33, 8, 5, 1, 1, 2, 10, 5], [7, 84, 32, 9, 7, 1, 0, 1, 8, 4],
  ];
  rows.forEach(([ago, score, putts, fir, gir, pen, tp, dbl, udA, udM], i) => s.rounds.push({ id: uid() + i, date: d(ago), course: i % 3 === 0 ? 'Riverside GC' : 'Home course', tees: 'White', par: 72, rating: 71.4, slope: 128, score, putts, firHit: fir, firPossible: 14, gir, penalties: pen, udAtt: udA, udMade: udM, sandAtt: 2, sandMade: i % 2, threePutts: tp, doubles: dbl, notes: i === 11 ? 'Best round of the year. Centre of green all day.' : '' }));
  [[2, 45, 'putting', [['ladder-lag', '15/20'], ['clock-drill', '4 ft']]], [4, 60, 'fullswing', [['towel-behind-ball', '17/20'], ['fairway-gate', '6/10']]], [6, 40, 'shortgame', [['towel-landing', '16/30'], ['up-and-down-10', '4/10']]], [9, 30, 'fitness', [['golf-strength-circuit', '']]], [11, 45, 'putting', [['3-6-9', '9 min']]], [13, 120, 'course', [['centre-of-green', '9 GIR']]], [16, 45, 'shortgame', [['dollar-bill', '8/10']]], [18, 60, 'fullswing', [['three-club-distance', '9/15']]], [20, 40, 'putting', [['par-18-putting', '21']]], [23, 35, 'fitness', [['med-ball-throws', '']]]]
    .forEach(([ago, minutes, type, drills], i) => s.sessions.push({ id: uid() + 's' + i, date: d(ago), minutes, type, notes: '', drills: drills.map(([id, result]) => ({ id, result })) }));
  s.assessments.push({ id: uid() + 'a', date: d(42), results: { putt3: 8, putt6: 3, lag30: 4, chip15: 4, pitch40: 3, bunker: 3, wedge80: 3, iron7: 3, driver: 4 } });
  s.assessments.push({ id: uid() + 'b', date: d(3), results: { putt3: 9, putt6: 5, lag30: 6, chip15: 5, pitch40: 4, bunker: 4, wedge80: 4, iron7: 4, driver: 5 } });
  if (s.profile.targetIndex == null) { s.profile.targetIndex = 9.9; const t = new Date(today); t.setMonth(t.getMonth() + 9); s.profile.targetDate = t.toISOString().slice(0, 10); }
  if (!s.programStart) s.programStart = d(16);
  const wk = isoWeekKey(today); s.planChecks[wk] = { Mon: true, Wed: true };
}

document.addEventListener('DOMContentLoaded', () => App.init());
