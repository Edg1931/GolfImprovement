const test = require('node:test');
const assert = require('node:assert');
const { SG } = require('../../public/js/sg.js');
const { playsLikeYards, driftYards, windComponents } = require('../../public/js/weather.js');

test('baselines: a bogey golfer needs more strokes than scratch, and distance adds strokes', () => {
  assert.ok(SG.expected('tee', 400, 18) > SG.expected('tee', 400, 0) + 0.8);
  assert.ok(SG.expected('fairway', 150, 10) < SG.expected('rough', 150, 10));
  assert.ok(SG.expected('rough', 150, 10) < SG.expected('bunker', 150, 10) + 0.2);
  assert.ok(SG.expected('green', 1, 10) > SG.expected('green', 0.5, 10));   // 9 ft vs 4.5 ft
  assert.strictEqual(SG.expected('green', 0, 10), 0);
});

test('a hole splits into categories that add up to the total', () => {
  const h = { strokes: 5, putts: 2, firstPutt: 30, len: 420, shots: [
    { id: 'a', fromLie: 'tee', toLie: 'rough', d0: 420, d1: 170 },
    { id: 'b', fromLie: 'rough', toLie: 'bunker', d0: 170, d1: 20 },
    { id: 'c', fromLie: 'bunker', toLie: 'green', d0: 20, d1: 10 } ] };
  const x = SG.hole(h, 4, 12);
  assert.ok(x.ott < 0.2 && x.app < 0 && x.arg !== 0);
  assert.ok(Math.abs(x.total - (x.ott + x.app + x.arg + x.putt + x.other)) < 1e-9);
  assert.ok(Math.abs(x.other) < 0.05, 'every shot tracked leaves nothing untracked');
});

test('out of bounds costs stroke and distance', () => {
  const x = SG.hole({ strokes: 6, putts: 2, firstPutt: 10, len: 400, shots: [{ id: 'a', fromLie: 'tee', toLie: 'ob', d0: 400, d1: 180 }] }, 4, 10);
  assert.ok(Math.abs(x.ott + 2) < 1e-9);
});

test('plays-like: headwind costs more than tailwind helps, slope adds yards, crosswind drifts', () => {
  assert.strictEqual(playsLikeYards(150, 10, 0), 15);
  assert.strictEqual(playsLikeYards(160, -10, 0), -8);
  assert.strictEqual(playsLikeYards(150, 0, 6), 6);
  assert.strictEqual(playsLikeYards(150, 0, 1), 0);   // under 2 yds of rise is noise
  const w = windComponents(90, 10, 0);                // from the east on a shot going north: from the right
  assert.ok(Math.abs(w.head) < 1e-9 && Math.abs(w.cross - 10) < 1e-9);
  assert.ok(driftYards(150, w.cross) < -8);           // pushed left
});
