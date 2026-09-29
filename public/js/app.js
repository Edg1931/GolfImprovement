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
    document.getElementById('themeBtn').addEventListener('click', () => { this.state.settings.theme = this.effectiveTheme() === 'dark' ? 'light' : 'dark'; Store.save(); this.applyTheme(); this.render(); });
    this._darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    if (this._darkQuery && this._darkQuery.addEventListener) this._darkQuery.addEventListener('change', () => { if (!this.state.settings.theme) { this.applyTheme(); this.render(); } });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && this._wantAwake) this.keepAwake(true); });
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { /* offline support unavailable */ });
    window.addEventListener('resize', () => { clearTimeout(this._rz); this._rz = setTimeout(() => this.runAfter(), 150); });
    Store.onSave = () => Cloud.schedulePush();
    // is the optional Claude debrief switched on for this site? (the built-in coach always works)
    if (location.protocol !== 'file:') fetch('api/summary').then(r => r.ok ? r.json() : null).then(b => { this.aiAvailable = !!(b && b.configured); }).catch(() => {});
    Cloud.init().catch(e => console.warn('Cloud sync unavailable', e));
    if (!location.hash) location.hash = '#/dashboard';
    this.render();
    if (!this.state.profile.onboarded) this.modal(onboardingModal());
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.runAfter());   // redraw charts in the web font
  },

  /* ---------- derived data ---------- */
  rounds() {
    return this.state.rounds.map(r => ({ ...r, diff: r.holesPlayed === 9 ? (r.diff18 != null ? r.diff18 : null) : scoreDifferential(r.score, r.rating, r.slope) }))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  },
  /* 18-hole rounds only, for per-round averages and score charts. */
  fullRounds() { return this.rounds().filter(r => r.holesPlayed !== 9); },
  /* Handicap Index: WHS calculation with caps; before 3 scores, the starting index the player entered. */
  indexInfo() {
    const key = Store.rev + ':' + this.state.rounds.length + ':' + this.state.profile.startIndex;
    if (this._idxKey !== key) {
      const info = cappedIndex(this.rounds());
      if (info.index == null && this.state.profile.startIndex != null) { info.index = this.state.profile.startIndex; info.starting = true; }
      this._idxKey = key; this._idx = info;
    }
    return this._idx;
  },
  index() { return this.indexInfo().index; },
  countedDiffs() {
    const rs = this.rounds().filter(r => r.diff != null).slice(0, 20); const rule = whsRule(rs.length); if (!rule) return [];
    return rs.slice().sort((a, b) => a.diff - b.diff).slice(0, rule.use).map(r => r.id);
  },
  /* Focus areas for the plan: the biggest stroke-loss areas, or the weakest Skills Test areas when there are no round stats. */
  focusAreas() {
    const st = roundStats(this.rounds(), 10);
    const areas = strokeLossAnalysis(st, this.targetHcp()).filter(a => a.loss >= 0.5).slice(0, 2);
    if (areas.length) return areas.map(a => ({ key: a.key, label: a.label, loss: a.loss, source: 'stats' }));
    const tests = this.state.assessments.slice().sort((a, b) => b.date.localeCompare(a.date)); if (!tests.length) return [];
    const toKey = { putting: 'putting', chipping: 'scrambling', pitching: 'scrambling', bunker: 'scrambling', wedges: 'approach', irons: 'approach', driver: 'driving' };
    const tier = this.tier(); const seen = new Set();
    return ASSESSMENT_TESTS.map(t => ({ t, gap: tests[0].results[t.id] - t.benchmarks[tier.id] })).filter(x => x.gap < 0).sort((a, b) => a.gap - b.gap)
      .map(x => ({ key: toKey[x.t.area], label: x.t.name, loss: null, source: 'test' })).filter(f => f.key && !seen.has(f.key) && seen.add(f.key)).slice(0, 2);
  },
  /* This week's plan for the player's tier and time budget, adapted to their focus areas unless switched off. */
  weekPlan() {
    const base = weeklyPlan(this.tier().id, this.state.profile.budget);
    if (this.state.profile.adaptive === false) return { plan: base, focus: [], swaps: 0 };
    return adaptPlan(base, this.focusAreas(), this.tier().id);
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
    const changed = route !== this._lastRoute; this._lastRoute = route;
    if (route !== 'play' && route !== 'gps') { this.keepAwake(false); if (this.ui.liveYds) { this.ui.liveYds = false; this.watchGps(false); } }
    if (route !== 'gps' && typeof HoleView !== 'undefined') { HoleView.leave(); this.ui.hvSheet = null; }
    document.body.classList.toggle('hv-mode', route === 'gps');
    if (!changed) host.classList.remove('enter');   // only animate real page changes, not in-page updates
    try { host.innerHTML = view(); } catch (e) { console.error(e); host.innerHTML = `<div class="callout warn">Something went wrong rendering this page: ${escapeHtml(e.message)}</div>`; }
    document.querySelectorAll('[data-route]').forEach(a => { const on = a.dataset.route === route || (a.dataset.also || '').split(' ').includes(route); a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    const idx = this.index(); document.getElementById('topIndex').innerHTML = `<small>HI</small> ${idx != null ? fmt1(idx) : '—'}`;
    document.getElementById('liveDot').classList.toggle('hidden', !this.state.liveRound);
    document.getElementById('sidebarFoot').innerHTML = Cloud.user
      ? `<a class="acct-chip" href="#/account"><svg class="ico"><use href="#i-user"/></svg><span><strong>${escapeHtml((Cloud.profile && Cloud.profile.display_name) || Cloud.user.email)}</strong><span id="syncStatus" class="sync-status ${Cloud.status}"></span></span></a>`
      : `<p class="muted small mb0">Your data is only on this device. <a href="#/account">Create a free account</a> to back it up and sync.</p>`;
    Cloud.renderStatus();
    if (changed) {
      this.toggleMenu(false);
      window.scrollTo({ top: 0 });
      host.classList.remove('enter'); void host.offsetWidth; host.classList.add('enter');
      const h1 = host.querySelector('h1'); document.title = (h1 && route !== 'dashboard' ? h1.textContent + ' · ' : '') + 'Fairway Lab';
    }
    this.runAfter();
  },
  renderKeepFocus(el) {
    const sel = '[data-change="' + el.dataset.change + '"]'; const pos = el.selectionStart;
    this.render(); const n = document.querySelector(sel); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* not a text input */ } }
  },
  after(fn) { this.afterHooks.push(fn); },
  runAfter() { this.afterHooks.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); },
  effectiveTheme() { return this.state.settings.theme || (this._darkQuery && this._darkQuery.matches ? 'dark' : 'light'); },
  applyTheme() {
    const t = this.effectiveTheme(); document.documentElement.setAttribute('data-theme', t);
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', t === 'dark' ? '#0c120e' : '#12352a');
  },
  /* Keep the screen on while a live round is open (where supported). */
  keepAwake(on) {
    this._wantAwake = on;
    if (!on) { if (this._lock) { this._lock.release().catch(() => {}); this._lock = null; } return; }
    if (this._lock || !navigator.wakeLock || document.visibilityState !== 'visible') return;
    navigator.wakeLock.request('screen').then(l => { this._lock = l; l.addEventListener('release', () => { this._lock = null; }); }).catch(() => {});
  },
  /* Continuous GPS for live green yardages. */
  watchGps(on) {
    if (this._watchId != null) { navigator.geolocation.clearWatch(this._watchId); this._watchId = null; }
    if (!on || !navigator.geolocation) return;
    this._watchId = navigator.geolocation.watchPosition(p => { this._lastPos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }; this._lastPosAt = Date.now(); updateGreenYards(); if (typeof HoleView !== 'undefined') HoleView.onPos(); },
      e => {
        // only a refused permission is fatal; timeouts and lost signal are normal on a course, so keep watching
        if (e.code === 1) { this.toast('Allow location access for live yardage'); this.ui.liveYds = false; this.watchGps(false); this.render(); return; }
        const acc = document.getElementById('greenAcc'); if (acc) acc.textContent = 'Weak GPS signal… showing your last position';
      }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  },
  locate(cb) {
    if (!navigator.geolocation) { this.toast('GPS is not available on this device'); return; }
    // live yardage already has a fresh fix: use it straight away
    if (this._watchId != null && this._lastPos && Date.now() - this._lastPosAt < 5000) { cb(this._lastPos); return; }
    this.toast('Getting your position…');
    navigator.geolocation.getCurrentPosition(p => cb({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
      e => this.toast(e.code === 1 ? 'Allow location access to measure shots' : 'Could not get a GPS fix. Try again in open sky.'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  },
  toggleMenu(force) { const open = force != null ? force : !document.getElementById('sidebar').classList.contains('open'); document.getElementById('sidebar').classList.toggle('open', open); document.getElementById('scrim').classList.toggle('open', open); },
  toast(msg) { const h = document.getElementById('toastHost'); while (h.children.length >= 3) h.firstChild.remove(); const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; h.appendChild(t); setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, 2600); },
  modal(html) { this.closeModal(); this._modalReturn = document.activeElement; const m = document.createElement('div'); m.className = 'modal-host'; m.id = 'modalHost'; m.innerHTML = `<div class="modal" role="dialog" aria-modal="true" tabindex="-1"><button class="btn sm ghost close" data-action="closeModal" aria-label="Close">✕</button>${html}</div>`; m.addEventListener('click', e => { if (e.target === m) this.closeModal(); }); document.body.appendChild(m); document.body.classList.add('modal-open'); m.querySelector('.modal').focus(); },
  closeModal() { const m = document.getElementById('modalHost'); if (!m) return; m.remove(); document.body.classList.remove('modal-open'); if (this._modalReturn && document.body.contains(this._modalReturn)) this._modalReturn.focus(); },
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
  goto(el) { App.closeModal(); location.hash = el.dataset.href; },
  /* Opens the debrief for a round (the built-in coach needs nothing); inside an open debrief, asks Claude. */
  async aiSummary(el) {
    const r = App.state.rounds.find(x => x.id === el.dataset.id); if (!r) return;
    if (!document.getElementById('aiBox')) { App.modal(`<p class="eyebrow">${fmtDate(r.date)}</p><h2>${escapeHtml(r.course || 'Round')}</h2>${aiBox(App.rounds().find(x => x.id === r.id) || r)}`); return; }
    if (!Cloud.user) { App.closeModal(); location.hash = '#/account'; App.toast('Sign in to ask Claude for a deeper debrief'); return; }
    const box = document.getElementById('aiBox');
    const show = html => { const b = document.getElementById('aiBox'); if (b) b.outerHTML = html; else App.modal(html); };
    if (box) box.innerHTML = '<p class="small muted mb0"><span class="spinner"></span> Your coach is reviewing the round…</p>';
    const full = App.rounds().find(x => x.id === r.id);
    try {
      const res = await fetch('api/summary', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await Cloud.accessToken() }, body: JSON.stringify(aiPayload(full)) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error({ not_configured: 'AI summaries are not switched on yet (the site needs an Anthropic API key).', daily_limit: `You've used today's ${body.limit || 10} summaries. More tomorrow!`, sign_in_required: 'Please sign in again.', refused: 'The coach could not write a summary for this round.', busy: 'The coach is busy. Try again in a minute.' }[body.error] || 'Could not write the summary. Try again shortly.');
      r.aiSummary = body.summary; Store.save(); show(aiBox(r));
    } catch (e) { show(aiBox(r)); App.toast(e.message); }
  },
  startTodaySession(el) { const day = App.weekPlan().plan.find(d => d.session && d.session.id === el.dataset.sid); const s = day && day.session; if (!s) return; App.ui.sessionDrills = s.drills.map(([id]) => ({ id, result: '' })); App.ui.sessionType = s.type; location.hash = '#/sessions'; App.toast(s.name + ': drills loaded. Log scores as you go.'); },
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
  _captureResults() {
    (App.ui.sessionDrills || []).forEach((d, i) => {
      const val = document.querySelector(`[name="value_${i}"]`), txt = document.querySelector(`[name="result_${i}"]`);
      if (val) { const n = parseFloat(val.value); d.value = isNaN(n) ? null : n; }
      if (txt) d.result = txt.value;
    });
  },
  deleteRound(el) { if (!confirm('Delete this round?')) return; App.state.rounds = App.state.rounds.filter(r => r.id !== el.dataset.id); Store.tombstone(el.dataset.id); Store.save(); App.render(); },
  deleteSession(el) { if (!confirm('Delete this session?')) return; App.state.sessions = App.state.sessions.filter(r => r.id !== el.dataset.id); Store.tombstone(el.dataset.id); Store.save(); App.render(); },
  deleteAssessment(el) { if (!confirm('Delete this test?')) return; App.state.assessments = App.state.assessments.filter(r => r.id !== el.dataset.id); Store.tombstone(el.dataset.id); Store.save(); App.render(); },
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
  useMeasured(el) { const c = App.state.clubs.find(x => x.club === el.dataset.club); if (!c) return; c.carry = parseInt(el.dataset.yds, 10); Store.save(); App.render(); App.toast(`${c.club} set to ${c.carry} yds`); },
  addClub() { App.state.clubs.push({ club: 'New', carry: 100 }); Store.save(); App.render(); },
  removeClub(el) { App.state.clubs.splice(parseInt(el.dataset.i, 10), 1); Store.save(); App.render(); },
  randomDrill() { const cat = document.getElementById('randCat').value; App.ui.randCat = cat; const pool = cat === 'all' ? DRILLS : drillsByCategory(cat); App.ui.randDrill = pool[Math.floor(Math.random() * pool.length)].id; App.render(); },
  exportData() { const blob = new Blob([Store.export()], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'fairway-lab-backup-' + todayISO() + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); },
  resetData() { if (!confirm('Delete ALL rounds, sessions, tests and settings? This cannot be undone.')) return; Store.reset(); App.state = Store.state; App.ui = {}; App.render(); App.toast('All data deleted'); },
  skipOnboarding() { App.state.profile.onboarded = true; Store.save(); App.closeModal(); App.render(); },
  onboardDemo() { App.state.profile.onboarded = true; loadDemoData(); Store.save(); App.closeModal(); App.render(); App.toast('Demo data loaded. Clear it any time in Tools.'); },
  loadDemo() { if (App.state.rounds.length && !confirm('This adds demo rounds, sessions and a skills test alongside your existing data. Continue?')) return; loadDemoData(); Store.save(); App.render(); App.toast('Demo data loaded'); },
};

/* ---------- form handlers ---------- */
const Forms = {
  round(form, v) {
    const r = { id: uid(), date: v.date, course: v.course.trim(), tees: v.tees.trim(), par: num(v.par, 72), rating: num(v.rating), slope: num(v.slope), score: num(v.score), notes: v.notes.trim() };
    if (v.holesPlayed === '9') {
      // Nine holes: the card's 18-hole rating is halved (slope stays the same) and par is for the nine played.
      const idx = App.index(); r.holesPlayed = 9; r.rating = Math.round(r.rating / 2 * 10) / 10;
      r.diff18 = nineHoleDifferential(r.score, r.rating, r.slope, idx);
      if (r.diff18 == null) App.toast('Nine-hole rounds count toward your index once you have one (3 full rounds).');
    }
    ['putts', 'firHit', 'firPossible', 'gir', 'penalties', 'udAtt', 'udMade', 'sandAtt', 'sandMade', 'threePutts', 'doubles'].forEach(k => { const n = parseFloat(v[k]); r[k] = isNaN(n) ? null : n; });
    if (r.firHit == null) r.firPossible = null;
    if (!(r.slope >= 55 && r.slope <= 155)) { App.toast('Slope must be between 55 and 155'); return; }
    const before = unlockedIds();
    App.state.rounds.push(r); App.ui.roundCourse = null; Store.save(); App.render(); announceAchievements(before);
    const idx = App.index(); App.toast(idx != null ? 'Round saved. Index: ' + fmt1(idx) : 'Round saved (' + App.state.rounds.length + '/3 for an index)');
  },
  session(form, v) {
    Actions._captureResults();
    const s = { id: uid(), date: v.date, minutes: num(v.minutes, 0), type: v.type, notes: v.notes.trim(), drills: (App.ui.sessionDrills || []).map(d => {
      const m = drillMetric(getDrill(d.id)); const e = { id: d.id, result: (d.result || '').trim() };
      if (d.value != null) { e.value = d.value; e.result = m.outOf ? `${d.value}/${m.outOf}` : `${d.value}${m.unit ? ' ' + m.unit : ''}`; }
      return e;
    }) };
    const pbs = s.drills.filter(e => e.value != null && isPersonalBest(e.id, e.value)).map(e => getDrill(e.id).name);
    const before = unlockedIds();
    App.state.sessions.push(s); App.ui.sessionDrills = []; App.ui.sessionType = null; Store.save(); App.render(); App.toast('Session saved. Nice work.'); pbs.forEach((n, i) => setTimeout(() => App.toast('🏅 Personal best: ' + n), 500 + i * 900)); announceAchievements(before);
  },
  assessment(form, v) {
    const results = {}; ASSESSMENT_TESTS.forEach(t => { results[t.id] = Math.max(0, Math.min(10, num(v[t.id], 0))); });
    const before = unlockedIds();
    App.state.assessments.push({ id: uid(), date: v.date, results }); Store.save(); App.render(); App.toast('Skills test saved'); announceAchievements(before);
  },
  goals(form, v) {
    const p = App.state.profile; p.name = v.name.trim(); p.homeCourse = v.homeCourse.trim(); p.targetIndex = num(v.targetIndex, null); p.targetDate = v.targetDate; p.startIndex = num(v.startIndex, null); Store.save(); App.render(); App.toast('Goal saved');
  },
  onboard(form, v) {
    const p = App.state.profile;
    p.name = (v.name || '').trim(); p.startIndex = num(v.startIndex, null); p.budget = v.budget || 'standard'; p.onboarded = true;
    const t = num(v.targetIndex, null); p.targetIndex = t != null ? t : (p.startIndex != null ? Math.max(0, Math.round((p.startIndex - 4) * 10) / 10) : null);
    if (p.targetIndex != null && !p.targetDate) { const d = new Date(); d.setMonth(d.getMonth() + 6); p.targetDate = d.toISOString().slice(0, 10); }
    Store.save(); App.closeModal(); App.render();
    App.toast(p.startIndex != null ? `Welcome${p.name ? ', ' + p.name : ''}! Starting at ${fmt1(p.startIndex)}.` : 'Welcome! Log 3 rounds to get your index.');
  },
  /* Download an .ics calendar with the weekly plan, repeating weekly, each with a 30-minute alert. */
  calendar(form, v) {
    const p = App.state.profile; p.reminders = { time: v.time || '18:00', weeks: parseInt(v.weeks, 10) || 8 }; Store.save();
    const [hh, mm] = p.reminders.time.split(':').map(Number);
    const pad = n => String(n).padStart(2, '0');
    const stamp = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    const esc = s => String(s).replace(/\\/g, '\\\\').replace(/[,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
    const now = new Date(); const utc = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Fairway Lab//Practice Plan//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Fairway Lab practice'];
    App.weekPlan().plan.forEach((d, i) => {
      if (!d.session) return;
      const start = new Date(now); start.setHours(hh, mm, 0, 0);
      const offset = (i - ((now.getDay() + 6) % 7) + 7) % 7; start.setDate(start.getDate() + offset);
      if (start < now) start.setDate(start.getDate() + 7);
      const end = new Date(start.getTime() + d.session.minutes * 60000);
      const drills = d.session.drills.map(([id, m]) => `• ${(getDrill(id) || { name: id }).name} (${m} min)`).join('\n');
      lines.push('BEGIN:VEVENT', `UID:fairwaylab-${d.session.id}-${i}@fairwaylab`, `DTSTAMP:${utc}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
        `RRULE:FREQ=WEEKLY;COUNT=${p.reminders.weeks}`, `SUMMARY:${esc('⛳ ' + d.session.name)}`, `DESCRIPTION:${esc(drills + '\n\nLog your scores in Fairway Lab.')}`,
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(d.session.name + ' in 30 minutes')}`, 'TRIGGER:-PT30M', 'END:VALARM', 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    // RFC 5545: fold long lines (kept well under 75 octets since the text includes multi-byte characters)
    const fold = l => { const out = []; while (l.length > 60) { out.push(l.slice(0, 60)); l = ' ' + l.slice(60); } out.push(l); return out.join('\r\n'); };
    const blob = new Blob([lines.map(fold).join('\r\n') + '\r\n'], { type: 'text/calendar' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'fairway-lab-practice.ics'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    App.toast('Calendar file ready: open it to add your sessions');
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
  adaptive(el) { App.state.profile.adaptive = el.checked; Store.save(); App.render(); },
  tierOverride(el) { App.state.profile.tierOverride = el.value; Store.save(); App.render(); },
  budget(el) { App.state.profile.budget = el.value; Store.save(); App.render(); },
  routineStep(el) { App.state.routine[parseInt(el.dataset.i, 10)] = el.value; Store.save(); },
  clubName(el) { App.state.clubs[parseInt(el.dataset.i, 10)].club = el.value.trim() || '?'; Store.save(); App.render(); },
  clubCarry(el) { App.state.clubs[parseInt(el.dataset.i, 10)].carry = num(el.value, 0); Store.save(); App.render(); },
  wedge(el) { const n = parseFloat(el.value); if (isNaN(n)) delete App.state.wedgeMatrix[el.dataset.key]; else App.state.wedgeMatrix[el.dataset.key] = n; Store.save(); },
  commit(el) { App.state.commitments[el.dataset.key] = el.checked; Store.save(); App.render(); },
  importFile(el) {
    const f = el.files[0]; if (!f) return; const rd = new FileReader();
    rd.onload = () => { try { Store.import(rd.result); App.state = Store.state; Store.save(); App.applyTheme(); App.render(); App.toast('Backup imported'); } catch (e) { App.toast('Import failed: ' + e.message); } };
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
  // Earlier sessions repeating a few drills, so drill progress has trends to show.
  [[30, 'putting', [['ladder-lag', 11], ['par-18-putting', 24]]], [27, 'shortgame', [['towel-landing', 11], ['up-and-down-10', 2]]], [25, 'putting', [['ladder-lag', 13], ['par-18-putting', 23]]],
   [21, 'shortgame', [['towel-landing', 13], ['up-and-down-10', 3]]], [19, 'fullswing', [['fairway-gate', 4], ['towel-behind-ball', 14]]], [12, 'fullswing', [['fairway-gate', 5], ['towel-behind-ball', 15]]]]
    .forEach(([ago, type, drills], i) => s.sessions.push({ id: uid() + 'p' + i, date: d(ago), minutes: 40, type, notes: '', drills: drills.map(([id, value]) => { const m = drillMetric(getDrill(id)); return { id, value, result: m.outOf ? value + '/' + m.outOf : String(value) }; }) }));
  // The four most recent demo rounds get hole-by-hole cards so the scoring breakdown has data.
  s.rounds.slice(-4).forEach((r, n) => {
    const over = r.score - 72; const holes = DEFAULT_PARS.map(() => ({ strokes: 0, putts: 2, fir: null, pen: 0, sand: false }));
    // spread strokes over par onto the hardest holes first, with a birdie or two on easy holes
    const bySi = DEFAULT_SI.map((si, i) => [si, i]).sort((x, y) => x[0] - y[0]).map(x => x[1]);
    // a realistic mix: a few doubles on the hardest holes, bogeys next, pars and a birdie or two on the easiest
    const extra = Array(18).fill(0); let left = over + 2, k = 0;
    const doubles = Math.min(3, Math.floor(over / 5)); for (; k < doubles; k++) { extra[bySi[k]] = 2; left -= 2; }
    for (let j = 0; left > 0; j++) { extra[bySi[(k + j * 2 + n) % 18]]++; left--; }
    extra[bySi[17 - n]]--; extra[bySi[15 - n]]--;
    holes.forEach((h, i) => {
      h.strokes = DEFAULT_PARS[i] + extra[i];
      h.putts = extra[i] < 0 ? 1 : (i + n) % 7 === 0 ? 3 : (extra[i] === 0 && (i + n) % 3 === 0) || (i + n) % 4 === 0 ? 1 : 2;
      if (h.putts >= h.strokes) h.putts = h.strokes - 1;
      if (DEFAULT_PARS[i] >= 4) h.fir = ['hit', 'right', 'hit', 'left', 'right', 'hit'][(i + n) % 6];
      h.pen = extra[i] >= 3 && i % 2 ? 1 : 0; h.sand = i === 6 || i === 13;
    });
    const st = statsFromHoles(holes, DEFAULT_PARS);
    Object.assign(r, st, { holes, pars: DEFAULT_PARS.slice(), si: DEFAULT_SI.slice(), grossScore: st.gross, score: adjustedGross(holes, DEFAULT_PARS, DEFAULT_SI, 18) });
    delete r.gross;
  });
  if (!s.courses.some(c => c.name === 'Home course')) s.courses.push({ id: uid() + 'c', name: 'Home course', tees: 'White', rating: 71.4, slope: 128, pars: DEFAULT_PARS.slice(), si: DEFAULT_SI.slice() });
  s.assessments.push({ id: uid() + 'a', date: d(42), results: { putt3: 8, putt6: 3, lag30: 4, chip15: 4, pitch40: 3, bunker: 3, wedge80: 3, iron7: 3, driver: 4 } });
  s.assessments.push({ id: uid() + 'b', date: d(3), results: { putt3: 9, putt6: 5, lag30: 6, chip15: 5, pitch40: 4, bunker: 4, wedge80: 4, iron7: 4, driver: 5 } });
  if (s.profile.targetIndex == null) { s.profile.targetIndex = 9.9; const t = new Date(today); t.setMonth(t.getMonth() + 9); s.profile.targetDate = t.toISOString().slice(0, 10); }
  if (!s.programStart) s.programStart = d(16);
  const wk = isoWeekKey(today); s.planChecks[wk] = { Mon: true, Wed: true };
}

document.addEventListener('DOMContentLoaded', () => App.init());
