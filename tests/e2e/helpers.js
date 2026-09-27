const fs = require('fs'), path = require('path');
/* Fresh app with demo data loaded (skips the welcome screen). */
async function withDemo(page) {
  await page.goto('/');
  await page.click('[data-action=onboardDemo]');
  await page.waitForFunction(() => App.state.rounds.length > 0);
}
/* Swap the bundled Supabase library for an in-page stand-in. */
async function fakeSupabase(context) {
  await context.route('**/js/vendor/supabase.js', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'fake-supabase.js'), 'utf8') }));
}
/* Collect page errors so every test can assert there were none. */
function trackErrors(page) { const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept()); return errs; }
module.exports = { withDemo, fakeSupabase, trackErrors };
