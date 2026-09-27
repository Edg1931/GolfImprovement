// Minimal in-page stand-in for supabase-js used by cloud.js tests.
var supabase = { createClient: function () {
  const db = window.__db = window.__db || { golf_profiles: [], golf_user_data: [], friends: [] };
  let session = null; const listeners = [];
  const emit = (ev) => listeners.forEach(fn => fn(ev, session));
  function q(table) {
    let rows = () => db[table]; const filters = []; let op = 'select', payload = null, single = false, maybe = false;
    const api = {
      select() { return api; }, eq(k, v) { filters.push(r => r[k] === v); return api; },
      insert(p) { op = 'insert'; payload = p; return api; }, update(p) { op = 'update'; payload = p; return api; }, upsert(p) { op = 'upsert'; payload = p; return api; },
      single() { single = true; return api; }, maybeSingle() { maybe = true; return api; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    function run() {
      const uid = session && session.user.id;
      if (op === 'insert') { const r = Object.assign({ friend_code: 'ABCD1234' }, payload); db[table].push(r); return { data: r, error: null }; }
      if (op === 'upsert') { const i = db[table].findIndex(r => r.user_id === payload.user_id); const r = JSON.parse(JSON.stringify(payload)); if (i >= 0) db[table][i] = r; else db[table].push(r); window.__pushes = (window.__pushes || 0) + 1; return { data: r, error: null }; }
      let res = rows().filter(r => filters.every(f => f(r)));
      if (table === 'golf_profiles' && op === 'select' && !filters.length) res = rows();
      if (op === 'update') { res.forEach(r => Object.assign(r, payload)); }
      if (single || maybe) return { data: res[0] ? JSON.parse(JSON.stringify(res[0])) : null, error: null };
      return { data: JSON.parse(JSON.stringify(res)), error: null };
    }
    return api;
  }
  return {
    auth: {
      onAuthStateChange(fn) { listeners.push(fn); setTimeout(() => fn('INITIAL_SESSION', session), 0); return { data: { subscription: { unsubscribe() {} } } }; },
      async getSession() { return { data: { session } }; },
      async signInWithPassword({ email }) { session = { user: { id: 'u-' + email, email, user_metadata: {} }, access_token: 'tok' }; emit('SIGNED_IN'); return { error: null }; },
      async signUp({ email, options }) { session = { user: { id: 'u-' + email, email, user_metadata: options.data }, access_token: 'tok' }; emit('SIGNED_IN'); return { data: { session }, error: null }; },
      async signOut() { session = null; emit('SIGNED_OUT'); return { error: null }; },
      async resetPasswordForEmail() { return { error: null }; }, async updateUser() { return { error: null }; },
    },
    from: q,
    async rpc(name, args) {
      if (name === 'golf_add_friend') { if (args.code !== 'FRIEND01') return { data: null, error: { message: 'No golfer with that code' } }; db.golf_profiles.push({ user_id: 'u-friend', display_name: 'Pat', week_start: mondayOf(new Date()), week_minutes: 300, handicap_index: 9.4, best_score_30d: 79, rounds_30d: 4 }); return { data: [{ friend_id: 'u-friend', display_name: 'Pat' }], error: null }; }
      return { data: null, error: null };
    },
  };
} };
