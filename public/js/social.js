/* Account and Friends pages (on top of cloud.js). */

Views.account = function () {
  let html = `<div class="page-head"><div><h1>${Cloud.user ? 'Account' : 'Sign in to sync'}</h1><p class="muted">Back up your data and use it on every device.</p></div></div>`;
  if (!Cloud.available()) return html + '<div class="callout warn">Accounts are not available in this build.</div>';
  const busy = App.ui.authBusy ? 'disabled' : '';
  if (Cloud.recovery) {
    return html + `<div class="card narrow"><h2>Choose a new password</h2><form class="form" data-form="newPassword"><div class="field"><label>New password</label><input type="password" name="password" minlength="8" autocomplete="new-password" required></div><button class="btn primary" type="submit" ${busy}>Save password</button></form></div>`;
  }
  if (!Cloud.user) {
    const tab = App.ui.authTab || 'signin';
    html += `<div class="grid grid-2"><div class="card"><div class="tabs">${[['signin', 'Sign in'], ['signup', 'Create account'], ['forgot', 'Forgot password']].map(([k, l]) => `<button class="${tab === k ? 'active' : ''}" data-action="authTab" data-tab="${k}">${l}</button>`).join('')}</div>
      ${App.ui.authMsg ? `<div class="callout ${App.ui.authMsgType === 'error' ? 'warn' : ''} small">${escapeHtml(App.ui.authMsg)}</div>` : ''}
      ${tab === 'signin' ? `<form class="form" data-form="signIn"><div class="field"><label>Email</label><input type="email" name="email" autocomplete="email" required></div><div class="field"><label>Password</label><input type="password" name="password" autocomplete="current-password" required></div><button class="btn primary lg" type="submit" ${busy}>Sign in</button></form>`
      : tab === 'signup' ? `<form class="form" data-form="signUp"><div class="field"><label>Name friends will see</label><input name="name" maxlength="40" value="${escapeHtml(App.state.profile.name || '')}" required></div><div class="field"><label>Email</label><input type="email" name="email" autocomplete="email" required></div><div class="field"><label>Password</label><input type="password" name="password" minlength="8" autocomplete="new-password" required><span class="hint">At least 8 characters.</span></div><button class="btn primary lg" type="submit" ${busy}>Create account</button><p class="tiny muted mb0">Everything already on this device is uploaded to your new account.</p></form>`
      : `<form class="form" data-form="forgot"><div class="field"><label>Email</label><input type="email" name="email" autocomplete="email" required></div><button class="btn primary" type="submit" ${busy}>Email me a reset link</button></form>`}
    </div>
    <div class="card"><h3>What an account adds</h3><ul class="small tick-list">
      <li><strong>Never lose a round.</strong> Everything is backed up, even if you clear your browser or change phones.</li>
      <li><strong>Every device in step.</strong> Score on your phone, review on your laptop.</li>
      <li><strong>Friends and leaderboards.</strong> Weekly practice minutes, handicap and best score.</li>
      <li><strong>AI round summaries.</strong> A plain-English debrief after each round.</li>
      <li><strong>Still works offline.</strong> Changes sync when you're back in signal.</li></ul></div></div>`;
    return html;
  }
  const p = Cloud.profile || {};
  html += `<div class="grid grid-2"><div class="card"><h2>Profile</h2>
      <div class="kv mb"><dt>Email</dt><dd>${escapeHtml(Cloud.user.email || '')}</dd><dt>Friend code</dt><dd><span class="code-pill">${escapeHtml(p.friend_code || '…')}</span></dd></div>
      <form class="form" data-form="displayName"><div class="field"><label>Name friends see</label><input name="name" maxlength="40" value="${escapeHtml(p.display_name || '')}" required></div><button class="btn" type="submit">Save name</button></form></div>
    <div class="card"><h2>Sync</h2>
      <p><span id="syncStatus" class="sync-status ${Cloud.status}"></span></p>
      <p class="small muted">${Cloud.lastSync ? 'Last synced at ' + Cloud.lastSync.toLocaleTimeString() + '.' : 'Syncing happens automatically after every change.'}${Cloud.error ? ' <span class="badge warn">' + escapeHtml(Cloud.error) + '</span>' : ''}</p>
      <div class="btn-row"><button class="btn primary" data-action="syncNow">Sync now</button><a class="btn" href="#/friends">Friends &amp; leaderboard</a><button class="btn danger" data-action="signOut">Sign out</button></div>
      <p class="tiny muted mt mb0">Signing out keeps a copy on this device. Your data is private: friends only see your name, handicap, weekly practice minutes and best recent score.</p></div></div>`;
  App.after(() => Cloud.renderStatus());
  return html;
};

Views.friends = function () {
  let html = `<div class="page-head"><div><h1>Friends</h1><p class="muted">Add friends with their code and compare.</p></div></div>`;
  if (!Cloud.user) return html + `<div class="empty">Friends need an account. <a href="#/account">Sign in or create one</a>. It's free.</div>`;
  const lb = App.ui.lb; const tab = App.ui.lbTab || 'practice'; const me = Cloud.user.id; const p = Cloud.profile || {};
  if (!lb && !App.ui.lbLoading) App.after(() => Actions.loadLeaderboard());
  const monday = mondayOf(new Date());
  const metric = {
    practice: { label: 'Practice this week', val: r => r.week_start === monday ? r.week_minutes : 0, fmt: v => v >= 60 ? (Math.floor(v / 60) + 'h ' + (v % 60) + 'm') : v + ' min', desc: true },
    index: { label: 'Handicap Index', val: r => r.handicap_index, fmt: v => fmt1(v), desc: false },
    best: { label: 'Best score (30 days)', val: r => r.best_score_30d, fmt: v => v, desc: false },
    rounds: { label: 'Rounds (30 days)', val: r => r.rounds_30d, fmt: v => v, desc: true },
  }[tab];
  const rows = (lb || []).map(r => ({ r, v: metric.val(r) })).sort((a, b) => (a.v == null) - (b.v == null) || (metric.desc ? b.v - a.v : a.v - b.v));
  html += `<div class="grid grid-2"><div class="card"><div class="card-head"><h2>Leaderboard</h2><button class="btn sm ghost" data-action="loadLeaderboard">↻ Refresh</button></div>
      <div class="chip-row mb">${[['practice', 'Practice'], ['index', 'Handicap'], ['best', 'Best score'], ['rounds', 'Rounds']].map(([k, l]) => `<button class="chip ${tab === k ? 'active' : ''}" data-action="lbTab" data-tab="${k}">${l}</button>`).join('')}</div>
      ${App.ui.lbLoading && !lb ? '<p class="small muted"><span class="spinner"></span> Loading…</p>' : App.ui.lbError ? `<div class="callout warn small">${escapeHtml(App.ui.lbError)}</div>`
      : rows.length <= 1 ? `<div class="empty small">Add a friend to start a leaderboard. Share your code: <strong>${escapeHtml(p.friend_code || '')}</strong></div>`
      : `<ol class="leaderboard">${rows.map(({ r, v }, i) => `<li class="${r.user_id === me ? 'me' : ''}"><span class="lb-rank ${i < 3 && v != null ? 'top' + (i + 1) : ''}">${i + 1}</span><span class="lb-name">${escapeHtml(r.display_name)}${r.user_id === me ? ' <span class="tiny muted">(you)</span>' : ''}</span><span class="lb-val">${v == null ? '—' : metric.fmt(v)}</span>${r.user_id !== me ? `<button class="btn sm ghost danger" data-action="removeFriend" data-id="${r.user_id}" aria-label="Remove ${escapeHtml(r.display_name)}">✕</button>` : '<span></span>'}</li>`).join('')}</ol>`}
      <p class="tiny muted mt mb0">${metric.label}. ${tab === 'index' || tab === 'best' ? 'Lower is better.' : 'Higher is better.'}</p></div>
    <div><div class="card"><h2>Your friend code</h2><div class="code-big">${escapeHtml(p.friend_code || '…')}</div>
      <div class="btn-row"><button class="btn primary" data-action="shareCode">Share invite</button><button class="btn" data-action="copyCode">Copy code</button></div></div>
      <div class="card mt"><h2>Add a friend</h2><form class="search-row" data-form="addFriend"><input name="code" placeholder="Their 8-character code" maxlength="12" autocapitalize="characters" required aria-label="Friend code"><button class="btn primary" type="submit">Add</button></form>
      <p class="tiny muted mt mb0">Friendships are two-way: they'll see you on their leaderboard too.</p></div></div></div>`;
  return html;
};

Object.assign(Actions, {
  authTab(el) { App.ui.authTab = el.dataset.tab; App.ui.authMsg = ''; App.render(); },
  async syncNow() { await Cloud.sync(); App.toast(Cloud.status === 'synced' ? 'All synced' : 'Sync problem: ' + Cloud.error); },
  async signOut() { if (!confirm('Sign out? Your data stays on this device.')) return; await Cloud.signOut(); App.ui.lb = null; App.render(); App.toast('Signed out'); },
  async loadLeaderboard() {
    App.ui.lbLoading = true; App.ui.lbError = '';
    try { App.ui.lb = await Cloud.leaderboard(); } catch (e) { App.ui.lbError = 'Could not load the leaderboard: ' + e.message; }
    App.ui.lbLoading = false; App.render();
  },
  lbTab(el) { App.ui.lbTab = el.dataset.tab; App.render(); },
  async removeFriend(el) { if (!confirm('Remove this friend?')) return; try { await Cloud.removeFriend(el.dataset.id); App.ui.lb = null; App.render(); } catch (e) { App.toast(e.message); } },
  copyCode() { const c = (Cloud.profile || {}).friend_code; if (!c) return; (navigator.clipboard ? navigator.clipboard.writeText(c) : Promise.reject()).then(() => App.toast('Code copied'), () => App.toast('Your code: ' + c)); },
  shareCode() {
    const c = (Cloud.profile || {}).friend_code; if (!c) return;
    const text = `Join me on Fairway Lab and let's see who practises more. Add me with code ${c}.`;
    if (navigator.share) navigator.share({ title: 'Fairway Lab', text, url: location.origin }).catch(() => {}); else Actions.copyCode();
  },
});

/* Run an auth call with a busy state and an inline message. */
async function authStep(fn, okMsg) {
  App.ui.authBusy = true; App.ui.authMsg = ''; App.render();
  try { const msg = await fn(); App.ui.authMsg = msg || okMsg || ''; App.ui.authMsgType = 'ok'; }
  catch (e) { App.ui.authMsg = e.message || String(e); App.ui.authMsgType = 'error'; }
  App.ui.authBusy = false; App.render();
}

Object.assign(Forms, {
  signIn(form, v) { authStep(async () => { await Cloud.signIn(v.email.trim(), v.password); App.toast('Signed in. Syncing your data…'); return ''; }); },
  signUp(form, v) {
    authStep(async () => {
      const r = await Cloud.signUp(v.email.trim(), v.password, v.name.trim());
      if (r.session) { App.toast('Account created'); return ''; }
      App.ui.authTab = 'signin'; return 'Check your email and tap the confirmation link, then sign in here.';
    });
  },
  forgot(form, v) { authStep(async () => { await Cloud.resetPassword(v.email.trim()); return 'If that email has an account, a reset link is on its way.'; }); },
  newPassword(form, v) { authStep(async () => { await Cloud.setPassword(v.password); App.toast('Password updated'); return ''; }); },
  async displayName(form, v) { try { await Cloud.setDisplayName(v.name.trim()); App.render(); App.toast('Name saved'); } catch (e) { App.toast(e.message); } },
  async addFriend(form, v) {
    try { const f = await Cloud.addFriend(v.code.trim()); App.ui.lb = null; App.render(); App.toast(`${f ? f.display_name : 'Friend'} added`); }
    catch (e) { App.toast(/No golfer/.test(e.message) ? 'No golfer with that code' : /own code/.test(e.message) ? "That's your own code" : e.message); }
  },
});
