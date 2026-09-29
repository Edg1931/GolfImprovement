const { test, expect } = require('@playwright/test');
const { withDemo, fakeSupabase, trackErrors } = require('./helpers');

test('every page renders without errors @phone', async ({ page }) => {
  const errs = trackErrors(page); await withDemo(page);
  for (const r of ['dashboard', 'rounds', 'stats', 'sessions', 'assessment', 'plan', 'drills', 'playbook', 'clubs', 'goals', 'tools', 'play', 'account', 'friends']) {
    await page.goto('/#/' + r);
    await expect(page.locator('#view h1')).toBeVisible();
    await expect(page.locator('#view')).not.toContainText('Something went wrong');
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errs).toEqual([]);
});

test('onboarding sets a starting index and target', async ({ page }) => {
  const errs = trackErrors(page); await page.goto('/');
  await page.fill('form[data-form=onboard] [name=name]', 'Sam');
  await page.fill('form[data-form=onboard] [name=startIndex]', '14.2');
  await page.click('form[data-form=onboard] button[type=submit]');
  await expect(page.locator('#topIndex')).toContainText('14.2');
  expect(await page.evaluate(() => App.state.profile.targetIndex)).toBe(10.2);
  expect(errs).toEqual([]);
});

test('live 18-hole round saves adjusted score, stats and differential', async ({ page }) => {
  const errs = trackErrors(page); await page.goto('/'); await page.click('[data-action=skipOnboarding]');
  await page.goto('/#/play');
  await page.fill('[name=course]', 'Test GC'); await page.fill('[name=rating]', '72'); await page.fill('[name=slope]', '113');
  await page.click('form[data-form=startRound] button[type=submit]');
  for (let h = 0; h < 18; h++) {
    await page.click('[data-action=holeStep][data-k=strokes][data-d="1"]');            // par
    if (h === 3) for (let k = 0; k < 6; k++) await page.click('[data-action=holeStep][data-k=strokes][data-d="1"]'); // a 10 on a par 5
    await page.click('[data-action=holeSet][data-k=putts][data-v="2"]');
    if (h < 17) await page.click('[data-action=holeGo].primary');
  }
  await page.click('[data-action=finishRound]');
  const r = await page.evaluate(() => App.state.rounds[0]);
  expect(r.grossScore).toBe(78);
  expect(r.score).toBe(77);            // no index yet: capped at par + 5 on the 10
  expect(r.putts).toBe(36); expect(r.gir).toBe(17);
  await expect(page.locator('.modal')).toContainText('Round complete');
  expect(errs).toEqual([]);
});

test('back nine counts as an 18-hole differential with an index', async ({ page }) => {
  const errs = trackErrors(page); await withDemo(page);
  const idx = await page.evaluate(() => App.index());
  await page.goto('/#/play');
  await page.click('.holes-tile >> nth=1'); await page.click('.seg button:has-text("Back 9")');
  await page.fill('[name=course]', 'Nine GC'); await page.fill('[name=rating]', '72'); await page.fill('[name=slope]', '130');
  await page.click('form[data-form=startRound] button[type=submit]');
  await expect(page.locator('.hole-card .eyebrow')).toContainText('Hole 10');
  for (let h = 0; h < 9; h++) { await page.click('[data-action=holeStep][data-k=strokes][data-d="1"]'); await page.click('[data-action=holeStep][data-k=strokes][data-d="1"]'); if (h < 8) await page.click('[data-action=holeGo].primary'); }
  await page.click('[data-action=finishRound]');
  const r = await page.evaluate(() => App.state.rounds.find(x => x.course === 'Nine GC'));
  expect(r.holesPlayed).toBe(9); expect(r.firstHole).toBe(9); expect(r.rating).toBe(36);
  const expected = Math.round(((113 / 130) * (r.score - 36) + idx * 0.52 + 1.2) * 10) / 10;
  expect(r.diff18).toBe(expected);
  expect(errs).toEqual([]);
});

test('editing a saved round keeps its id', async ({ page }) => {
  const errs = trackErrors(page); await withDemo(page);
  await page.goto('/#/rounds'); await page.click('[data-action=viewCard]');
  const id = await page.evaluate(() => App.rounds().find(r => r.holes).id);
  await page.click('.modal [data-action=editRound]');
  await expect(page.locator('text=Editing a saved round')).toBeVisible();
  const before = await page.evaluate(i => App.state.rounds.find(r => r.id === i).grossScore, id);
  await page.click('[data-action=holeStep][data-k=strokes][data-d="1"]');
  await page.click('.hole-pill >> nth=17'); await page.click('[data-action=finishRound]');
  const after = await page.evaluate(i => App.state.rounds.filter(r => r.id === i).map(r => r.grossScore), id);
  expect(after).toEqual([before + 1]);
  expect(errs).toEqual([]);
});

test('drill scores chart progress and flag personal bests', async ({ page }) => {
  const errs = trackErrors(page); await withDemo(page);
  await page.goto('/#/sessions');
  await expect(page.locator('.prog-row').first()).toBeVisible();
  await page.selectOption('#drillPicker', 'ladder-lag'); await page.click('[data-action=addSessionDrill]');
  await page.fill('[name=value_0]', '19'); await page.click('form[data-form=session] button[type=submit]');
  await expect(page.locator('.toast', { hasText: 'Personal best: Lag Ladder' })).toBeVisible();
  expect(errs).toEqual([]);
});

test('adaptive plan swaps in focus drills and can be switched off', async ({ page }) => {
  const errs = trackErrors(page); await withDemo(page);
  await page.goto('/#/plan');
  const swaps = await page.evaluate(() => App.weekPlan().swaps);
  expect(swaps).toBeGreaterThan(0);
  await expect(page.locator('.day .focus-tag').first()).toBeVisible();
  await page.click('[data-change=adaptive]');
  await expect(page.locator('.day .focus-tag')).toHaveCount(0);
  expect(errs).toEqual([]);
});

test('handicap caps apply after 20 scores', async ({ page }) => {
  await page.goto('/'); await page.click('[data-action=skipOnboarding]');
  const info = await page.evaluate(() => { const d = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); const rs = [];
    for (let i = 0; i < 25; i++) rs.push({ id: 'g' + i, date: d(200 - i), score: 80, rating: 72, slope: 113, par: 72 });
    for (let i = 0; i < 20; i++) rs.push({ id: 'b' + i, date: d(100 - i), score: 100, rating: 72, slope: 113, par: 72 });
    App.state.rounds = rs; Store.save(); return App.indexInfo(); });
  expect(info).toMatchObject({ raw: 28, lhi: 8, cap: 'hard', index: 13 });
});

test('course search imports a tee and fills the scorecard', async ({ page, context }) => {
  const errs = trackErrors(page);
  const api = require('../../api/courses.js');
  const course = { id: 1, club_name: 'Pebble Beach Golf Links', location: { city: 'Pebble Beach', state: 'CA' }, tees: { male: [{ tee_name: 'Blue', course_rating: 74.9, slope_rating: 144, back_course_rating: 37.7, back_slope_rating: 147, total_yards: 6828, par_total: 72, number_of_holes: 18, holes: Array.from({ length: 18 }, (_, i) => ({ par: 4, yardage: 400, handicap: i + 1 })) }] } };
  // like the real API: search returns tee counts only, the scorecard comes from ?id=
  const summary = { ...course, id: 'ab12cd34', tees: { male: 1, female: 0 } };
  await context.route('**/api/courses*', r => {
    const u = new URL(r.request().url());
    const body = u.searchParams.get('id') ? { course: api.normalizeCourse({ ...course, id: 'ab12cd34' }) } : { courses: [api.normalizeCourse(summary)] };
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/'); await page.click('[data-action=skipOnboarding]'); await page.goto('/#/play');
  await page.fill('input[name=q]', 'pebble'); await page.click('.search-row button');
  await page.click('.tee-opt');
  await expect(page.locator('.course-summary')).toContainText('rating 74.9');
  await page.click('.holes-tile >> nth=1'); await page.click('.seg button:has-text("Back 9")');
  await page.click('form[data-form=startRound] button[type=submit]');
  const lr = await page.evaluate(() => App.state.liveRound);
  expect([lr.rating, lr.slope, lr.first, lr.holes.length]).toEqual([37.7, 147, 9, 9]);
  expect(errs).toEqual([]);
});

test('sign up uploads data; merge keeps both devices and honours deletions', async ({ page, context }) => {
  const errs = trackErrors(page); await fakeSupabase(context); await withDemo(page);
  await page.goto('/#/account');
  await page.click('[data-action=authTab][data-tab=signup]');
  await page.fill('form[data-form=signUp] [name=name]', 'Eddie'); await page.fill('form[data-form=signUp] [name=email]', 'e@x.com'); await page.fill('form[data-form=signUp] [name=password]', 'longpassword');
  await page.click('form[data-form=signUp] button[type=submit]');
  await expect(page.locator('#sidebarFoot')).toContainText('Synced');
  const gone = await page.evaluate(() => { const d = window.__db.golf_user_data[0].data; const del = d.rounds[0].id; d.rounds = d.rounds.slice(1); d.deleted[del] = '2026-01-01';
    d.rounds.push({ id: 'phone-round', date: '2026-09-26', course: 'Phone GC', par: 72, rating: 72, slope: 120, score: 88 }); d.meta.updatedAt = new Date(Date.now() + 60000).toISOString(); return del; });
  await page.evaluate(() => { App.state.sessions.push({ id: 'laptop-session', date: '2026-09-27', minutes: 30, type: 'putting', drills: [], notes: '' }); Store.save(); });
  await page.evaluate(() => Cloud.sync());
  const s = await page.evaluate(g => ({ phone: App.state.rounds.some(r => r.id === 'phone-round'), gone: !App.state.rounds.some(r => r.id === g), laptopUp: window.__db.golf_user_data[0].data.sessions.some(x => x.id === 'laptop-session') }), gone);
  expect(s).toEqual({ phone: true, gone: true, laptopUp: true });
  await page.goto('/#/friends');
  await page.fill('form[data-form=addFriend] [name=code]', 'FRIEND01'); await page.click('form[data-form=addFriend] button');
  await expect(page.locator('.leaderboard li')).toHaveCount(2);
  expect(errs).toEqual([]);
});

test('share card downloads a PNG and the plan exports to a calendar', async ({ page }) => {
  const errs = trackErrors(page); await withDemo(page);
  await page.goto('/#/rounds'); await page.click('[data-action=viewCard]');
  const [png] = await Promise.all([page.waitForEvent('download'), page.click('.modal [data-action=shareRound]')]);
  expect(png.suggestedFilename()).toMatch(/\.png$/);
  await page.keyboard.press('Escape'); await page.goto('/#/plan');
  const [ics] = await Promise.all([page.waitForEvent('download'), page.click('form[data-form=calendar] button')]);
  const text = require('fs').readFileSync(await ics.path(), 'utf8');
  expect(text).toContain('BEGIN:VCALENDAR'); expect((text.match(/BEGIN:VEVENT/g) || []).length).toBeGreaterThan(0); expect(text).toContain('TRIGGER:-PT30M');
  expect(Math.max(...text.split('\r\n').map(l => Buffer.byteLength(l)))).toBeLessThanOrEqual(75);
  expect(errs).toEqual([]);
});

test('green yardages from saved pins @phone', async ({ page, context }) => {
  const errs = trackErrors(page);
  await context.grantPermissions(['geolocation']); await context.setGeolocation({ latitude: 36.568, longitude: -121.95, accuracy: 4 });
  await withDemo(page); await page.goto('/#/play');
  await page.selectOption('[data-change=playCourse]', { label: 'Home course · White' });
  await page.click('form[data-form=startRound] button[type=submit]');
  const yd = 0.9144 / 111320;
  for (const [spot, y] of [['front', 150], ['center', 160], ['back', 170]]) {
    await context.setGeolocation({ latitude: 36.568 + y * yd, longitude: -121.95, accuracy: 3 });
    await page.locator(`[data-action=greenPin][data-spot=${spot}]:visible`).first().click();
    await expect(page.locator('.toast').last()).toContainText('Saved');
  }
  await context.setGeolocation({ latitude: 36.568, longitude: -121.95, accuracy: 4 });
  await page.click('[data-action=liveYardage]');
  await expect(page.locator('.yds-num')).toHaveText(['150', '160', '170']);
  expect(errs).toEqual([]);
});

test('built-in coach writes a debrief with no account or AI key', async ({ page }) => {
  const errs = trackErrors(page); await withDemo(page);
  await page.goto('/#/rounds'); await page.click('[data-action=viewCard]');
  const box = page.locator('.modal #aiBox');
  await expect(box).toContainText("Coach's debrief");
  await expect(box).toContainText('Where the strokes went');
  await expect(box).toContainText('This week');
  await expect(box.locator('[data-action=aiSummary]')).toHaveCount(0);   // no Claude key on the test server
  // every drill named in the debrief is a real drill from the library
  const text = await box.innerText();
  const names = await page.evaluate(() => DRILLS.map(d => d.name));
  const named = names.filter(n => text.includes(n));
  expect(named.length).toBeGreaterThan(0);
  // totals-only rounds open the debrief from the history table
  await page.keyboard.press('Escape');
  await page.locator('tr:has([data-action=editRound]) [data-action=aiSummary]').first().click();
  await expect(page.locator('.modal #aiBox')).toContainText('This week');
  expect(errs).toEqual([]);
});
