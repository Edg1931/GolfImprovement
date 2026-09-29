const test = require('node:test'); const assert = require('node:assert');
const C = require('../../public/js/caddie.js');

// A 160-yard par 3 heading north. Green: 30 x 24 yd box centred 160 yds out.
// Water: everything more than 18 yds right of the centre line near the green. Bunker: short-left.
const box = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const course = {
  green: { x: 0, y: 160 },
  features: [
    { type: 'green', xy: box(-15, 148, 15, 172) },
    { type: 'water', xy: box(18, 100, 80, 200) },
    { type: 'bunker', xy: box(-25, 135, -5, 147) },
    { type: 'fairway', xy: box(-20, 40, 17, 147) },
  ],
};
const tee = { x: 0, y: 0 };
const clubs = [{ club: '5i', carry: 175 }, { club: '6i', carry: 165 }, { club: '7i', carry: 155 }, { club: '8i', carry: 145 }, { club: '9i', carry: 135 }];

test('geometry: offsets and landing agree, right is positive', () => {
  const o = C.offsets(tee, { x: 0, y: 100 }, { x: 5, y: 90 });
  assert.ok(Math.abs(o.along - 90) < 1e-9 && Math.abs(o.lat - 5) < 1e-9);
  const p = C.landing(tee, { x: 0, y: 100 }, 90, 5); assert.ok(Math.abs(p.x - 5) < 1e-9 && Math.abs(p.y - 90) < 1e-9);
  const proj = C.projector({ lat: 36.5, lon: -121.9 }); const q = proj.toXY({ lat: 36.5 + 100 / (110574 / 0.9144), lon: -121.9 });
  assert.ok(Math.abs(q.y - 100) < 0.01 && Math.abs(q.x) < 1e-6);
  assert.equal(C.pointInPolygon({ x: 0, y: 160 }, course.features[0].xy), true);
  assert.equal(C.classify({ x: 30, y: 160 }, course.features, true), 'water');
  assert.equal(C.classify({ x: -10, y: 60 }, course.features, true), 'fairway');
  assert.equal(C.classify({ x: -40, y: 60 }, course.features, true), 'rough');
});

test('dispersion learns a slice from GPS shots', () => {
  const shots = [8, 12, 10, 14, 9, 11].map((lat, i) => ({ club: '7i', along: 150 + (i % 3), lat }));
  const m = C.clubModel('7i', 155, shots, 12);
  assert.ok(m.lat > 6, 'mean miss should move right: ' + m.lat);
  assert.ok(m.along < 157 && m.along > 149, 'distance should move toward ~151: ' + m.along);
  assert.equal(m.learned, true);
  const fresh = C.clubModel('7i', 155, [], 12);
  assert.equal(fresh.lat, 0); assert.equal(fresh.learned, false);
});

test('recommends the club that reaches the green and aims away from the water', () => {
  const models = C.bagModels(clubs, [], 12);
  const recs = C.recommend(tee, course.green, models, course, { seed: 7 });
  assert.ok(['6i', '7i'].includes(recs[0].club), 'best club: ' + recs[0].club);
  assert.ok(recs[0].aimShift <= 0, 'should not aim toward the water: ' + recs[0].aimShift);
  assert.ok(recs[0].expected > 2 && recs[0].expected < 4.5, 'expected strokes plausible: ' + recs[0].expected);
  // a slicer should be told to aim further left
  const slicer = C.bagModels(clubs, [9, 12, 11, 10, 13, 12].map(lat => ({ club: recs[0].club, along: recs[0].model.along, lat })), 12);
  const r2 = C.recommend(tee, course.green, slicer, course, { seed: 7 }).find(r => r.club === recs[0].club);
  assert.ok(r2.aimShift < recs[0].aimShift || r2.aimShift <= -6, `slicer aim ${r2.aimShift} vs ${recs[0].aimShift}`);
  // the shares add up
  const s = Object.values(recs[0].shares).reduce((a, b) => a + b, 0); assert.ok(Math.abs(s - 1) < 1e-9);
});

test('into the wind the recommendation clubs up; with no map it matches distance', () => {
  const models = C.bagModels(clubs, [], 12);
  const calm = C.recommend(tee, course.green, models, course, { seed: 3 })[0].club;
  const windy = C.recommend(tee, course.green, models, course, { seed: 3, adjust: 12 })[0].club;
  const order = clubs.map(c => c.club);
  assert.ok(order.indexOf(windy) <= order.indexOf(calm), `windy ${windy} vs calm ${calm}`);
  const plain = C.recommend(tee, { x: 0, y: 140 }, models, { features: [], green: null });
  assert.equal(plain[0].club, '9i');   // 135 carry + a little roll ≈ 138
});

test('strokes baseline is sensible', () => {
  assert.ok(C.strokesFrom('green', 1) < C.strokesFrom('green', 10));
  assert.ok(C.strokesFrom('sand', 20) > C.strokesFrom('fairway', 20));
  assert.ok(C.strokesFrom('fairway', 150) > C.strokesFrom('fairway', 100));
  assert.equal(C.clubKind('Driver'), 'driver'); assert.equal(C.clubKind('4H'), 'hybrid'); assert.equal(C.clubKind('5i'), 'longiron'); assert.equal(C.clubKind('SW'), 'wedge');
});
