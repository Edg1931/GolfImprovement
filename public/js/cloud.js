/* Accounts and cloud sync (Supabase). The whole app state is stored as one JSON document per user.
   Local data stays the source of truth while offline; changes are pushed a moment after each save and
   merged with the cloud copy when both sides changed, so nothing is lost across devices. */

const SYNC_ARRAYS = ['rounds', 'sessions', 'assessments', 'courses'];

/* Merge two app states. Items in the synced arrays are unioned by id (the newer document wins a clash),
   deletions are carried as tombstones in `deleted`, and everything else comes from the newer document. */
function mergeStates(local, remote) {
  const lt = (local.meta && local.meta.updatedAt) || '', rt = (remote.meta && remote.meta.updatedAt) || '';
  const newer = rt > lt ? remote : local, older = newer === remote ? local : remote;
  const out = JSON.parse(JSON.stringify(newer));
  out.deleted = Object.assign({}, older.deleted || {}, newer.deleted || {});
  SYNC_ARRAYS.forEach(k => {
    const byId = new Map();
    (older[k] || []).forEach(x => byId.set(x.id, x));
    (newer[k] || []).forEach(x => byId.set(x.id, x));
    out[k] = [...byId.values()].filter(x => !out.deleted[x.id]);
  });
  out.favorites = [...new Set([...(older.favorites || []), ...(newer.favorites || [])])];
  out.planChecks = Object.assign({}, older.planChecks || {});
  Object.entries(newer.planChecks || {}).forEach(([wk, days]) => { out.planChecks[wk] = Object.assign({}, out.planChecks[wk] || {}, days); });
  out.commitments = Object.assign({}, older.commitments || {}, newer.commitments || {});
  out.meta = Object.assign({}, newer.meta, { updatedAt: lt > rt ? lt : rt });
  return out;
}

const Cloud = {
  client: null, user: null, profile: null, status: 'off', lastSync: null, error: '',
  _pushTimer: null, _pushing: false, _dirty: false, recovery: false,

  available() { return typeof CONFIG !== 'undefined' && !!CONFIG.supabaseUrl && typeof supabase !== 'undefined' && supabase.createClient; },

  async init() {
    if (!this.available()) return;
    this.client = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    this.client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') { this.recovery = true; location.hash = '#/account'; }
      this.user = session ? session.user : null;
      if (this.user) setTimeout(() => this.afterSignIn(), 0);
      else { this.profile = null; this.status = 'off'; this._syncedFor = null; }
      App.render();
    });
    const { data } = await this.client.auth.getSession();
    this.user = data.session ? data.session.user : null;
    if (this.user) this.afterSignIn();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && this.user) this.sync(); });
    window.addEventListener('online', () => { if (this.user) this.sync(); });
  },

  async afterSignIn() {
    if (!this.user || this._syncedFor === this.user.id) return;   // once per signed-in user
    this._syncedFor = this.user.id;
    await this.ensureProfile();
    await this.sync();
  },

  async ensureProfile() {
    if (!this.user) return;
    const { data, error } = await this.client.from('golf_profiles').select('*').eq('user_id', this.user.id).maybeSingle();
    if (error) { this.error = error.message; return; }
    if (data) { this.profile = data; return; }
    const name = (this.user.user_metadata && this.user.user_metadata.display_name) || App.state.profile.name || (this.user.email || 'Golfer').split('@')[0];
    const ins = await this.client.from('golf_profiles').insert({ user_id: this.user.id, display_name: name.slice(0, 40) }).select().single();
    if (!ins.error) this.profile = ins.data; else this.error = ins.error.message;
  },

  /* Pull the cloud copy, merge it with local data, then push the result. */
  async sync() {
    if (!this.user || !navigator.onLine) { if (this.user) this.status = 'offline'; return; }
    this.status = 'syncing'; this.renderStatus();
    try {
      const { data, error } = await this.client.from('golf_user_data').select('data, updated_at').eq('user_id', this.user.id).maybeSingle();
      if (error) throw error;
      if (data && data.data && Object.keys(data.data).length) {
        const merged = mergeStates(Store.state, data.data);
        Store.replace(merged);
      }
      await this.push(true);
      this.status = 'synced'; this.lastSync = new Date(); this.error = '';
    } catch (e) { this.status = 'error'; this.error = e.message || String(e); }
    this.renderStatus(); App.render();
  },

  /* Called after every local save; batches changes into one upload. */
  schedulePush() {
    if (!this.user) return;
    this._dirty = true; clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => this.push(), 1500);
  },

  async push(fromSync) {
    if (!this.user || !navigator.onLine) return;
    if (this._pushing) { this._dirty = true; return; }
    this._pushing = true; this._dirty = false;
    if (!fromSync) { this.status = 'syncing'; this.renderStatus(); }
    try {
      const { error } = await this.client.from('golf_user_data').upsert({ user_id: this.user.id, data: Store.state, updated_at: new Date().toISOString() });
      if (error) throw error;
      await this.pushProfileStats();
      if (!fromSync) { this.status = 'synced'; this.lastSync = new Date(); }
    } catch (e) { this.status = 'error'; this.error = e.message || String(e); }
    this._pushing = false; this.renderStatus();
    if (this._dirty) this.schedulePush();
  },

  /* Numbers friends can see on the leaderboard. */
  leaderboardStats() {
    const s = App.state; const wk = isoWeekKey(new Date());
    const weekMinutes = s.sessions.filter(x => isoWeekKey(new Date(x.date + 'T00:00:00')) === wk).reduce((a, x) => a + (x.minutes || 0), 0);
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const full = s.rounds.filter(r => r.holesPlayed !== 9 && r.date >= since);
    const idx = App.index();
    return { handicap_index: idx != null ? Math.round(idx * 10) / 10 : null, week_start: wk ? mondayOf(new Date()) : null, week_minutes: weekMinutes,
      rounds_30d: full.length, best_score_30d: full.length ? Math.min(...full.map(r => r.grossScore != null ? r.grossScore : r.score)) : null };
  },
  async pushProfileStats() {
    if (!this.profile) return;
    const stats = this.leaderboardStats();
    const { data, error } = await this.client.from('golf_profiles').update(Object.assign(stats, { updated_at: new Date().toISOString() })).eq('user_id', this.user.id).select().single();
    if (!error && data) this.profile = data;
  },

  async signUp(email, password, name) {
    const { data, error } = await this.client.auth.signUp({ email, password, options: { data: { display_name: name }, emailRedirectTo: location.origin + location.pathname } });
    if (error) throw error;
    return data;
  },
  async signIn(email, password) { const { error } = await this.client.auth.signInWithPassword({ email, password }); if (error) throw error; },
  async signOut() { await this.client.auth.signOut(); this.user = null; this.profile = null; this.status = 'off'; this._syncedFor = null; },
  async resetPassword(email) { const { error } = await this.client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); if (error) throw error; },
  async setPassword(password) { const { error } = await this.client.auth.updateUser({ password }); if (error) throw error; this.recovery = false; },
  async setDisplayName(name) {
    const { data, error } = await this.client.from('golf_profiles').update({ display_name: name.slice(0, 40) }).eq('user_id', this.user.id).select().single();
    if (error) throw error; this.profile = data;
  },

  /* ---------- friends ---------- */
  async addFriend(code) { const { data, error } = await this.client.rpc('golf_add_friend', { code }); if (error) throw error; return data && data[0]; },
  async removeFriend(id) { const { error } = await this.client.rpc('golf_remove_friend', { other: id }); if (error) throw error; },
  /* Your profile plus your friends' (row-level security returns exactly those rows). */
  async leaderboard() { const { data, error } = await this.client.from('golf_profiles').select('user_id, display_name, handicap_index, week_start, week_minutes, rounds_30d, best_score_30d, updated_at'); if (error) throw error; return data; },

  async accessToken() { if (!this.client) return null; const { data } = await this.client.auth.getSession(); return data.session ? data.session.access_token : null; },

  renderStatus() {
    const el = document.getElementById('syncStatus'); if (!el) return;
    const t = { off: '', syncing: 'Syncing…', synced: 'Synced', offline: 'Offline · will sync later', error: 'Sync problem' }[this.status] || '';
    el.textContent = t; el.className = 'sync-status ' + this.status; el.title = this.error || (this.lastSync ? 'Last synced ' + this.lastSync.toLocaleTimeString() : '');
  },
};

function mondayOf(d) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
