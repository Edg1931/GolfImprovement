/* Local persistence. Everything lives in localStorage under one key. */
const STORE_KEY = 'fairwaylab.v1';

const Store = {
  state: null,
  defaults() {
    return {
      profile: { name: '', targetIndex: null, targetDate: '', tierOverride: '', budget: 'standard', homeCourse: '', startIndex: null, onboarded: false },
      rounds: [],        // {id, date, course, tees, par, rating, slope, score, putts, firHit, firPossible, gir, penalties, udAtt, udMade, sandAtt, sandMade, threePutts, doubles, notes}
      sessions: [],      // {id, date, minutes, type, drills:[{id, result}], notes}
      assessments: [],   // {id, date, results:{testId: n}}
      clubs: null,       // [{club, carry}]
      wedgeMatrix: {},   // {"LW-7:30": 45, ...}
      routine: null,     // [string]
      favorites: [],     // drill ids
      planChecks: {},    // {"2026-W12": {"Mon": true}}
      programStart: '',  // ISO date
      commitments: {},   // {key: true}
      courses: [],       // {id, name, tees, rating, slope, pars:[18], si:[18]}
      liveRound: null,   // in-progress hole-by-hole round (see scorecard.js)
      settings: { theme: '' },  // '' follows the system setting
      deleted: {},       // {id: isoDate} tombstones so deletions sync across devices
      meta: { updatedAt: '' },
    };
  },
  load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { s = null; }
    const d = this.defaults();
    this.state = Object.assign(d, s || {});
    this.state.profile = Object.assign(d.profile, (s && s.profile) || {});
    this.state.settings = Object.assign(d.settings, (s && s.settings) || {});
    if (!Array.isArray(this.state.courses)) this.state.courses = [];
    if (s && !s.profile?.onboarded && (this.state.rounds.length || this.state.sessions.length)) this.state.profile.onboarded = true;   // existing users skip the welcome
    if (!this.state.clubs) this.state.clubs = DEFAULT_CLUBS.map(c => ({ ...c }));
    if (!this.state.routine) this.state.routine = DEFAULT_ROUTINE.slice();
    return this.state;
  },
  rev: 0,
  onSave: null,      // set by the cloud sync layer
  save() {
    this.rev++;
    this.state.meta = Object.assign({}, this.state.meta, { updatedAt: new Date().toISOString() });
    if (this.onSave) this.onSave();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.state)); } catch (e) { console.warn('Could not save', e); }
  },
  /* Swap in a whole state (e.g. merged from the cloud) without marking it as a new local edit. */
  replace(next) {
    const d = this.defaults();
    this.state = Object.assign(d, next); this.state.profile = Object.assign(d.profile, next.profile || {}); this.state.settings = Object.assign(d.settings, next.settings || {});
    if (!this.state.clubs) this.state.clubs = DEFAULT_CLUBS.map(c => ({ ...c }));
    if (!this.state.routine) this.state.routine = DEFAULT_ROUTINE.slice();
    this.rev++; if (typeof App !== 'undefined') App.state = this.state;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.state)); } catch (e) { console.warn('Could not save', e); }
  },
  /* Record that an item was deleted, so sync removes it everywhere. */
  tombstone(id) { this.state.deleted = this.state.deleted || {}; this.state.deleted[id] = todayISO(); },
  export() { return JSON.stringify(this.state, null, 2); },
  import(json) {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.rounds)) throw new Error('Not a Fairway Lab backup file.');
    this.state = Object.assign(this.defaults(), parsed);
    this.save();
  },
  reset() {
    // keep tombstones for everything, so a signed-in reset also clears the cloud copy
    const gone = Object.assign({}, this.state.deleted);
    ['rounds', 'sessions', 'assessments', 'courses'].forEach(k => (this.state[k] || []).forEach(x => { gone[x.id] = todayISO(); }));
    localStorage.removeItem(STORE_KEY); this.load(); this.state.deleted = gone; this.save();
  },
};

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function todayISO() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function fmtDate(iso) { if (!iso) return ''; const d = new Date(iso + 'T00:00:00'); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' }); }
function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}
function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function num(v, d) { const n = parseFloat(v); return isNaN(n) ? d : n; }
function fmt1(n) { return (n == null || isNaN(n)) ? '—' : (Math.round(n * 10) / 10).toFixed(1); }
function pct(a, b) { return b ? Math.round(100 * a / b) : 0; }
function avg(arr) { const v = arr.filter(x => x != null && !isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
