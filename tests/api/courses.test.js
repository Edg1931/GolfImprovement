const test = require('node:test'); const assert = require('node:assert');
const handler = require('../../api/courses.js');
const res = () => ({ h: {}, setHeader(k, v) { this.h[k] = v; }, end(b) { this.body = JSON.parse(b); } });
const call = async (url) => { const r = res(); await handler({ url }, r); return r; };
const sample = { id: 7, club_name: 'Club', course_name: 'North', location: { city: 'Town' }, tees: { male: [{ tee_name: 'Blue', course_rating: '72.1', slope_rating: 130, holes: [{ par: 4, yardage: 380, handicap: 1 }] }], female: [{ tee_name: 'Red', holes: [] }] } };

test('normalizes course data', () => {
  const c = handler.normalizeCourse(sample);
  assert.equal(c.name, 'Club – North'); assert.equal(c.tees.length, 1);
  assert.deepEqual(c.tees[0].holes[0], { par: 4, yards: 380, si: 1 }); assert.equal(c.tees[0].rating, 72.1);
});
test('501 without a key, 400 for short queries, maps upstream errors', async () => {
  delete process.env.GOLF_COURSE_API_KEY; assert.equal((await call('/api/courses?q=pebble')).statusCode, 501);
  process.env.GOLF_COURSE_API_KEY = 'k';
  assert.equal((await call('/api/courses?q=pe')).statusCode, 400);
  global.fetch = async () => new Response(JSON.stringify({ courses: [sample] }), { status: 200 });
  const ok = await call('/api/courses?q=pebble'); assert.equal(ok.statusCode, 200); assert.equal(ok.body.courses[0].id, 7);
  global.fetch = async () => new Response('{"message":"Invalid key"}', { status: 401 }); assert.equal((await call('/api/courses?q=pebble')).body.error, 'bad_key');
  global.fetch = async () => new Response('slow down', { status: 429 }); assert.equal((await call('/api/courses?q=pebble')).statusCode, 429);
  process.env.GOLF_COURSE_API_KEY = ' "k"\n'; let sentAuth = null;
  global.fetch = async (u, o) => { sentAuth = o.headers.Authorization; return new Response(JSON.stringify({ courses: [] }), { status: 200 }); };
  await call('/api/courses?q=pebble'); assert.equal(sentAuth, 'Key k');
});
