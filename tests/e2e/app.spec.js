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

/* ---------- course map, shot planner and caddie ---------- */
const fx = require('../fixtures/osm-course.js');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqG+pBwADcgGBmxAt3gAAAABJRU5ErkJggg==', 'base64');
async function mapFixtures(context) {
  await context.route('**/server.arcgisonline.com/**', r => r.fulfill({ contentType: 'image/png', body: PNG }));
  await context.route('**/api/interpreter', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(fx.json) }));
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: fx.ORIGIN.lat, longitude: fx.ORIGIN.lon, accuracy: 4 });
}

test('course map imports OpenStreetMap features and the caddie plans a hole', async ({ page, context }) => {
  const errs = trackErrors(page); await mapFixtures(context); await withDemo(page);
  await page.goto('/#/map');
  await expect(page.locator('#mapSlot .leaflet-container')).toBeVisible();
  await page.click('[data-action=mapMyLocation]');
  await page.locator('#mapPanel [data-action=mapImportOSM]').first().click();
  await expect(page.locator('.toast').last()).toContainText('Loaded 2 holes and 7 shapes');
  const g = await page.evaluate(() => Planner.course().greens[0]);
  expect(g.front && g.back).toBeTruthy();                            // front/back derived from the green outline
  // a real tap on the map at the hole-2 green (par 3 over water)
  await page.click('[data-action=mapHole][data-h="2"]');
  await page.waitForFunction(() => Planner.s.fitted && Planner.s.fitted.endsWith(':2'));
  const pt = await page.evaluate(q => { const cp = Planner.map.latLngToContainerPoint([q.lat, q.lon]); const r = Planner.el.getBoundingClientRect(); return { x: r.left + cp.x, y: r.top + cp.y }; }, fx.ll(225, 400));
  await page.mouse.click(pt.x, pt.y);
  await expect(page.locator('.caddie-card')).toContainText('Exp. score');
  const best = await page.evaluate(() => Planner.s.recs[0]);
  expect(['5i', '6i', '7i']).toContain(best.club);
  expect(best.shares.water || 0).toBeLessThan(0.1);
  await page.click('[data-action=mapAddStep]');
  await expect(page.locator('.plan-list li')).toHaveCount(1);
  expect(errs).toEqual([]);
});

test('GPS shots learn dispersion and the hole card shows caddie advice @phone', async ({ page, context }) => {
  const errs = trackErrors(page); await mapFixtures(context); await withDemo(page);
  // map the demo course from the fixture, then play hole 1
  await page.evaluate(async json => { const c = App.state.courses.find(x => x.name === 'Home course'); CourseMap.apply(c, CourseMap.parseOSM(json), 'osm'); Store.save(); }, fx.json);
  await page.goto('/#/play');
  await page.selectOption('[data-change=playCourse]', { label: 'Home course · White' });
  await page.click('form[data-form=startRound] button[type=submit]');
  await expect(page.locator('.caddie-mini')).toContainText('yds to green');
  await page.selectOption('[data-change=gpsClub]', 'Driver');
  await page.click('[data-action=gpsMark]'); await expect(page.locator('.toast').last()).toContainText('Position marked');
  const end = fx.ll(22, 238); await context.setGeolocation({ latitude: end.lat, longitude: end.lon, accuracy: 4 });
  await page.click('[data-action=gpsMeasure]');
  await expect(page.locator('.gps-read')).toContainText('right');
  const shot = await page.evaluate(() => App.state.shotLog.slice(-1)[0]);
  expect(shot.club).toBe('Driver'); expect(shot.lat).toBeGreaterThan(0); expect(shot.along).toBeGreaterThan(200);
  await page.goto('/#/clubs');
  await expect(page.locator('#dispChart')).toBeVisible();
  expect(errs).toEqual([]);
});

test('a KML file from Google Earth adds a green and hazards', async ({ page, context }) => {
  const errs = trackErrors(page); await mapFixtures(context); await withDemo(page);
  const P = (x, y) => { const q = fx.ll(x, y); return q.lon + ',' + q.lat + ',0'; };
  const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
    <Placemark><name>Hole 1</name><LineString><coordinates>${P(0, 0)} ${P(0, 300)}</coordinates></LineString></Placemark>
    <Placemark><name>Green 1</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${P(-10, 290)} ${P(10, 290)} ${P(10, 310)} ${P(-10, 310)} ${P(-10, 290)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
    <Placemark><name>Pond</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${P(20, 100)} ${P(60, 100)} ${P(60, 200)} ${P(20, 200)} ${P(20, 100)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
  </Document></kml>`;
  await page.goto('/#/map');
  await page.setInputFiles('#mapFile', { name: 'course.kml', mimeType: 'application/vnd.google-earth.kml+xml', buffer: Buffer.from(kml) });
  await expect(page.locator('.toast').last()).toContainText('Imported 1 holes and 2 shapes');
  const c = await page.evaluate(() => ({ types: Planner.course().map.features.map(f => f.type), green: !!Planner.course().greens[0].center }));
  expect(c.types).toEqual(expect.arrayContaining(['green', 'water'])); expect(c.green).toBe(true);
  expect(errs).toEqual([]);
});

test('full-screen hole view: turned map, draggable target, score and shot tracking @phone', async ({ page, context }) => {
  const errs = trackErrors(page); await mapFixtures(context); await withDemo(page);
  await page.evaluate(async json => { const c = App.state.courses.find(x => x.name === 'Home course'); CourseMap.apply(c, CourseMap.parseOSM(json), 'osm'); Store.save(); }, fx.json);
  await page.goto('/#/play');
  await page.selectOption('[data-change=playCourse]', { label: 'Home course · White' });
  await page.click('form[data-form=startRound] button[type=submit]');
  await page.click('[data-action=openHoleView]');
  await expect(page.locator('.hv-card')).toBeVisible();
  await expect(page.locator('.tabbar')).toBeHidden();
  // standing on the tee: 380 yds to the middle, a tee-shot target down the hole with a club
  await expect(page.locator('#hvMid')).toHaveText(/^3[78]\d$/);
  await expect(page.locator('#hvTarget')).toBeVisible();
  await expect(page.locator('.hv-bubble.main .hv-club strong')).not.toBeEmpty();
  const up = await page.evaluate(() => { const h = HoleView.info(); return { g: HoleView.toScreen(h.green), t: HoleView.toScreen(h.tee) }; });
  expect(up.g.y).toBeLessThan(up.t.y - 200);                          // green at the top, tee at the bottom
  expect(Math.abs(up.g.x - up.t.x)).toBeLessThan(10);
  // just this hole: the rest is dimmed, with reach/carry for its hazards and layup markers
  await expect(page.locator('.hv-dim')).toHaveCount(1);
  await expect(page.locator('.hv-haz.water')).toHaveCount(1);
  await expect(page.locator('.hv-haz.bunker')).toHaveCount(1);
  expect(await page.locator('.hv-mark').count()).toBeGreaterThanOrEqual(1);   // ones under the target are hidden
  expect(await page.evaluate(() => HoleView.holeFeatures(HoleView.info()).some(f => f.type === 'green' && f.ll.some(p => p.lon > -121.949)))).toBe(false);   // not hole 2's green
  // drag the target to the right; round trip through the turned map keeps the point under the finger
  const before = await page.evaluate(() => HoleView.s.target);
  const box = await page.locator('#hvTarget').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 - 20, { steps: 4 }); await page.mouse.up();
  const moved = await page.evaluate(b => { const t = HoleView.s.target, s = HoleView.toScreen(t), s0 = HoleView.toScreen(b); return { dx: s.x - s0.x, dy: s.y - s0.y }; }, before);
  expect(moved.dx).toBeGreaterThan(30); expect(moved.dy).toBeLessThan(-10);
  // tap the green: aim at the flag
  const gNow = await page.evaluate(() => HoleView.toScreen(HoleView.info().flag));
  await page.mouse.click(gNow.x, gNow.y);
  expect(await page.evaluate(() => HoleView.s.target)).toBeNull();
  await expect(page.locator('#hvTarget')).toHaveCount(0);
  // caddie sheet
  await page.click('.hv-bubble.main .hv-club');
  await expect(page.locator('.hv-sheet')).toContainText('Caddie');
  await page.locator('.hv-sheet [data-action=hvClub]').first().click();
  await expect(page.locator('.hv-sheet')).toHaveCount(0);
  // track a shot
  await page.click('#hvTrack'); await page.click('.hv-sheet [data-action=hvMark][data-club="Driver"]');
  await expect(page.locator('#hvTrack')).toContainText('Measure');
  const end = fx.ll(-8, 235); await context.setGeolocation({ latitude: end.lat, longitude: end.lon, accuracy: 4 });
  await expect(page.locator('#hvTrack small')).toHaveText(/^2\d\d yds so far$/);   // live as you walk
  await page.click('#hvTrack');
  await expect(page.locator('#hvTrack')).toContainText('last:');
  expect(await page.evaluate(() => App.state.shotLog.slice(-1)[0].club)).toBe('Driver');
  // score the hole and move on
  await page.click('.hv-score'); await page.click('.hv-sheet .chip:has-text("Par")');
  await page.click('.hv-sheet [data-action=hvHole]');
  await expect(page.locator('.hv-hole span')).toHaveText('2');
  // swipe right to go back a hole, and left again
  const sw = async dx => { await page.mouse.move(200, 500); await page.mouse.down(); await page.mouse.move(200 + dx, 505, { steps: 5 }); await page.mouse.up(); };
  await sw(150); await expect(page.locator('.hv-hole span')).toHaveText('1');
  await sw(-150); await expect(page.locator('.hv-hole span')).toHaveText('2');
  expect(await page.evaluate(() => App.state.liveRound.holes[0].strokes)).toBe(4);
  const up2 = await page.evaluate(() => { const h = HoleView.info(), b = HoleView.ball(h); return { g: HoleView.toScreen(h.green), b: HoleView.toScreen(b.pos) }; });
  expect(up2.g.y).toBeLessThan(up2.b.y - 100);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errs).toEqual([]);
});

/* ---------- on-course extras: wind, slope, flag, tips, auto-advance, glance, offline, partners, strokes gained ---------- */
async function weatherFixtures(context) {
  await context.route('**/api.open-meteo.com/v1/forecast**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ current: { wind_speed_10m: 10, wind_direction_10m: 0, wind_gusts_10m: 16 } }) }));
  // ground rises 10 m from the tee (southern point) to anything north of it
  await context.route('**/api.open-meteo.com/v1/elevation**', r => {
    const lats = new URL(r.request().url()).searchParams.get('latitude').split(',').map(Number);
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ elevation: lats.map(l => l > fx.ORIGIN.lat + 0.0005 ? 30 : 20) }) });
  });
}
const at = async (context, x, y) => { const p = fx.ll(x, y); await context.setGeolocation({ latitude: p.lat, longitude: p.lon, accuracy: 4 }); };
async function startMappedRound(page, partners) {
  await page.evaluate(async json => { const c = App.state.courses.find(x => x.name === 'Home course'); CourseMap.apply(c, CourseMap.parseOSM(json), 'osm'); Store.save(); }, fx.json);
  await page.goto('/#/play');
  await page.selectOption('[data-change=playCourse]', { label: 'Home course · White' });
  if (partners) { await page.click('summary:has-text("Playing partners")'); await page.fill('[name=pname_0]', 'Sam'); await page.fill('[name=pidx_0]', '10'); }
  await page.click('form[data-form=startRound] button[type=submit]');
}

test('hole view: live wind and slope, flag of the day, tee tip, auto-advance, glance and offline maps @phone', async ({ page, context }) => {
  const errs = trackErrors(page); await mapFixtures(context); await weatherFixtures(context); await withDemo(page);
  await startMappedRound(page, true);
  await page.click('[data-action=openHoleView]');
  // wind from the north on a hole that runs north: into the player, and uphill
  await expect(page.locator('#hvWind')).toContainText('10 mph');
  await expect(page.locator('.hv-bubble.main')).toContainText('plays');
  const cd = await page.evaluate(() => HoleView.cur());
  expect(cd.head).toBeGreaterThan(9); expect(cd.rise).toBeGreaterThan(8); expect(cd.adj).toBeGreaterThan(20);
  await page.click('.hv-btn:has-text("Tools")');
  await expect(page.locator('.hv-sheet')).toContainText('Wind 10 mph from the north');
  await expect(page.locator('.hv-sheet')).toContainText('uphill');
  await page.click('.hv-sheet .hv-close');
  // a strategy tip on the tee (water left of the landing area)
  await expect(page.locator('.hv-tip')).toBeVisible();
  // flag of the day: tap on the green, 8 yds right and 6 short of the middle
  await page.click('[data-action=hvPinMode]');
  await expect(page.locator('.hv-hint')).toBeVisible();
  const pinPt = await page.evaluate(q => HoleView.toScreen(q), fx.ll(8, 374));
  await page.mouse.click(pinPt.x, pinPt.y);
  await expect(page.locator('.hv-main small')).toHaveText('To the pin');
  const pin = await page.evaluate(() => App.state.liveRound.pins[1]);
  expect(Math.abs(pin.lat - fx.ll(8, 374).lat)).toBeLessThan(0.00003);
  await expect(page.locator('#hvMid')).toHaveText(/^37\d$/);
  await page.click('[data-action=hvZoom]');   // back to the whole hole
  // track the tee shot and the approach: lies come from the map, the first putt from the approach
  await page.click('#hvTrack'); await page.click('.hv-sheet [data-action=hvMark][data-club="Driver"]');
  await at(context, -8, 235); await expect(page.locator('#hvTrack small')).toHaveText(/^2\d\d yds so far$/);
  await page.click('#hvTrack'); await expect(page.locator('.hv-lie')).toContainText('Fairway');
  await page.click('#hvTrack'); await page.click('.hv-sheet [data-action=hvMark][data-club="9i"]');
  await at(context, 4, 371); await expect(page.locator('#hvTrack small')).toHaveText(/^13\d yds so far$/);
  await page.click('#hvTrack'); await expect(page.locator('.hv-lie')).toContainText('Green');
  const h0 = await page.evaluate(() => App.state.liveRound.holes[0]);
  expect(h0.shots.map(s => s.fromLie + '>' + s.toLie)).toEqual(['tee>fairway', 'fairway>green']);
  expect(h0.firstPutt).toBeGreaterThan(8); expect(h0.firstPutt).toBeLessThan(20); expect(h0.fpAuto).toBe(true);
  // walking off the green without a score asks for it; partner scores go in the same sheet
  await at(context, 0, 380); await page.waitForFunction(() => HoleView._onGreen === 1);
  await at(context, 0, 440); await expect(page.locator('.hv-sheet')).toContainText('Hole 1 · Par 4');
  await page.click('.hv-sheet .chip:has-text("Par")'); await page.click('.hv-sheet [data-k=putts][data-v="2"]');
  await page.click('.hv-sheet [data-action=partnerStep][data-d="1"]');
  await page.click('.hv-sheet .hv-close');
  expect(await page.evaluate(() => App.state.liveRound.players[0].scores[0])).toBe(4);
  // standing on the next tee moves the view there
  await at(context, 60, 400); await expect(page.locator('.hv-hole span')).toHaveText('2');
  // glance mode
  await page.click('[data-action=hvGlance]');
  await expect(page.locator('.glance #glM')).toHaveText(/^1[56]\d$/);
  await page.click('.glance [data-action=hvGlance]');
  // save the course's imagery for offline use
  await page.click('.hv-btn:has-text("Tools")'); await page.click('[data-action=hvDownload]');
  await expect(page.locator('.toast').last()).toContainText('saved for offline');
  const n = await page.evaluate(async () => (await (await caches.open('fairwaylab-tiles')).keys()).length);
  expect(n).toBeGreaterThan(20);
  expect(await page.evaluate(() => App.state.courses.find(c => c.name === 'Home course').offline.tiles)).toBe(n);
  expect(errs).toEqual([]);
});

test('strokes gained, shot map, partners and gapping after a round', async ({ page, context }) => {
  const errs = trackErrors(page); await mapFixtures(context); await weatherFixtures(context); await withDemo(page);
  await startMappedRound(page, true);
  // two tracked shots on hole 1 through the same code path as GPS, then score every hole
  await page.evaluate(({ a, b, c }) => {
    const lr = App.state.liveRound, course = App.state.courses.find(x => x.id === lr.courseId);
    const flag = CourseMap.holeInfo(course, 1).green;
    SG.record(lr, course, 1, 'Driver', a, b, flag); SG.record(lr, course, 1, '9i', b, c, flag);
    lr.holes.forEach((h, i) => { h.strokes = lr.pars[i] + (i % 3 === 0 ? 1 : 0); h.putts = 2; });
    lr.holes[0].strokes = 4;
    lr.players[0].scores = lr.holes.map((h, i) => lr.pars[i] + (i % 2));
    Store.save();
  }, { a: fx.ll(0, 0), b: fx.ll(-8, 235), c: fx.ll(4, 371) });
  await page.goto('/#/play'); await page.reload();
  await expect(page.locator('.group-card')).toContainText('Sam');
  await page.click('[data-action=holeGo][data-i="17"]');
  await page.click('[data-action=finishRound]');
  const modal = page.locator('.modal');
  await expect(modal).toContainText('Strokes gained vs a');
  await expect(modal.locator('.group-table')).toContainText('Sam');
  const r = await page.evaluate(() => { const r = App.rounds()[0]; return { sg: SG.round(r, App.targetHcp()), len: r.holes[0].len, d0: r.holes[0].shots[0].d0 }; });
  expect(Math.abs(r.len - 380)).toBeLessThan(4); expect(Math.abs(r.d0 - r.len)).toBeLessThan(1);
  expect(r.sg.ott).not.toBe(0); expect(r.sg.app).not.toBe(0); expect(r.sg.puttHoles).toBe(1);
  expect(Math.abs(r.sg.total - (r.sg.ott + r.sg.app + r.sg.arg + r.sg.putt + r.sg.other))).toBeLessThan(1e-9);
  // shot map and a shareable picture of the hole
  await modal.locator('[data-action=openShotMap]').click();
  await expect(page.locator('.shot-list li')).toHaveCount(2);
  await expect(page.locator('#smSlot .leaflet-container')).toBeVisible();
  const dl = page.waitForEvent('download'); await page.click('[data-action=shareShotHole]');
  expect((await dl).suggestedFilename()).toMatch(/^hole-1-.*\.png$/);
  // stats and clubs
  await page.goto('/#/stats'); await expect(page.locator('.sg-total')).toBeVisible();
  await page.goto('/#/clubs'); await expect(page.locator('.gap-track')).toBeVisible();
  expect(errs).toEqual([]);
});

test('plan a hole shot by shot from home, then see the plan on the course @phone', async ({ page, context }) => {
  const errs = trackErrors(page); await mapFixtures(context); await weatherFixtures(context); await withDemo(page);
  await context.setGeolocation({ latitude: 40.0, longitude: -100.0, accuracy: 10 });   // nowhere near the course
  await page.evaluate(async json => { const c = App.state.courses.find(x => x.name === 'Home course'); CourseMap.apply(c, CourseMap.parseOSM(json), 'osm'); Store.save(); }, fx.json);
  await page.goto('/#/play');
  await page.locator('li', { hasText: 'Home course' }).locator('[data-action=openHoleView]').click();
  await expect(page.locator('.hv-planstrip')).toContainText('Plan this hole');
  await expect(page.locator('#hvTrack')).toHaveCount(0);
  // shot 1: the suggested tee-shot target down the fairway
  await expect(page.locator('.hv-score.plan strong')).not.toHaveText('＋ Add shot');
  await page.click('[data-action=hvAddShot]');
  await expect(page.locator('.hv-planstrip')).toContainText('Plan:');
  expect(await page.evaluate(() => !!HoleView.s.from)).toBe(true);
  // shot 2: tap the green, add it: the plan is complete and the ball goes back to the tee
  const g = await page.evaluate(() => HoleView.toScreen(HoleView.info().flag));
  await page.mouse.click(g.x, g.y);
  await page.click('[data-action=hvAddShot]');
  await expect(page.locator('.toast').last()).toContainText('Hole 1 planned');
  await expect(page.locator('.hv-step')).toHaveCount(2);
  await expect(page.locator('.hv-planstrip')).toContainText('✓');
  const plan = await page.evaluate(() => App.state.courses.find(c => c.name === 'Home course').plans[1]);
  expect(plan).toHaveLength(2); expect(plan[0].club).toBe('Driver');
  // drag the ball somewhere else to see distances from there, then put it back
  await page.waitForFunction(() => HoleView.s.adviceKey === HoleView.adviceKey());
  const b = await page.evaluate(() => HoleView.toScreen(HoleView.ball(HoleView.info()).pos));
  await page.mouse.move(b.x, b.y); await page.mouse.down();
  await page.mouse.move(b.x + 10, b.y - 150, { steps: 5 }); await page.mouse.up();
  await expect(page.locator('.hv-planstrip')).toContainText('ball moved');
  const mid = Number(await page.locator('#hvMid').textContent()); expect(mid).toBeLessThan(330);
  await page.click('[data-action=hvBallReset]'); await expect(page.locator('#hvMid')).toHaveText(/^3[78]\d$/);
  await page.click('[data-action=hvPlanUndo]'); await expect(page.locator('.hv-step')).toHaveCount(1);
  // on the course, the plan shows on the hole card
  await page.goto('/#/play');
  await page.selectOption('[data-change=playCourse]', { label: 'Home course · White' });
  await page.click('form[data-form=startRound] button[type=submit]');
  await expect(page.locator('.caddie-mini')).toContainText('Your plan: Driver');
  expect(errs).toEqual([]);
});
