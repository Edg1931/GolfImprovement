const test = require('node:test');
const assert = require('node:assert');
Object.assign(global, { Views: {}, Actions: {}, Forms: {}, Changes: {} });   // the page's registries, which finder.js adds to
const { cameraYards, cameraK } = require('../../public/js/finder.js');
const C = require('../../public/js/caddie.js');

test('camera rangefinder: a 7 ft flag that fills fewer pixels is further away', () => {
  const g = { ew: 400, eh: 800, vw: 1080, vh: 1920, zoom: 1, ft: 7 };
  const near = cameraYards({ ...g, span: 80 }), far = cameraYards({ ...g, span: 40 });
  assert.ok(Math.abs(far / near - 2) < 1e-9);
  // 2x zoom doubles the on-screen size for the same distance
  assert.ok(Math.abs(cameraYards({ ...g, span: 160, zoom: 2 }) - near) < 1e-9);
  assert.strictEqual(cameraYards({ ...g, span: 0 }), null);
});

test('calibration makes a known distance read exactly', () => {
  const g = { ew: 400, eh: 800, vw: 1080, vh: 1920, zoom: 1, ft: 7, span: 50 };
  const k = cameraK({ ...g, yards: 150 });
  assert.ok(Math.abs(cameraYards({ ...g, k }) - 150) < 1e-9);
});

test('range shots count half as much as course shots', () => {
  const course = [{ along: 170, lat: 10 }, { along: 170, lat: 10 }, { along: 170, lat: 10 }, { along: 170, lat: 10 }];
  const range = course.map(s => ({ ...s, source: 'range' }));
  const mc = C.clubModel('7i', 150, course, 10), mr = C.clubModel('7i', 150, range, 10);
  assert.ok(mc.lat > mr.lat && mr.lat > 0, 'course shots pull harder');
  assert.strictEqual(mr.nRange, 4); assert.strictEqual(mc.nCourse, 4);
});
