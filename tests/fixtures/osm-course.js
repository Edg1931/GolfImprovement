/* Fake Overpass response: a 2-hole course around ORIGIN (Pebble-ish coordinates), built in yards. */
const C = require('../../public/js/caddie.js');
const ORIGIN = { lat: 36.568, lon: -121.95 };
const proj = C.projector(ORIGIN);
const ll = (x, y) => { const p = proj.toLL({ x, y }); return { lat: +p.lat.toFixed(7), lon: +p.lon.toFixed(7) }; };
const box = (x0, y0, x1, y1) => [ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1), ll(x0, y0)];
let id = 1;
const way = (tags, geometry) => ({ type: 'way', id: id++, tags, geometry });
const elements = [
  // Hole 1: par 4 north, 380 yds; water left of the landing zone, bunker short-right of the green
  way({ golf: 'hole', ref: '1', par: '4' }, [ll(0, 0), ll(0, 230), ll(0, 380)]),
  way({ golf: 'tee' }, box(-6, -6, 6, 6)),
  way({ golf: 'fairway' }, box(-18, 150, 18, 352)),
  way({ natural: 'water' }, box(-60, 170, -20, 270)),
  way({ golf: 'green' }, box(-14, 366, 14, 394)),
  way({ golf: 'bunker' }, box(15, 355, 30, 372)),
  // Hole 2: par 3 east, 165 yds, water short
  way({ golf: 'hole', ref: '2', par: '3' }, [ll(60, 400), ll(225, 400)]),
  way({ golf: 'green' }, box(212, 388, 238, 412)),
  way({ golf: 'water_hazard' }, box(150, 380, 205, 420)),
];
module.exports = { ORIGIN, ll, json: { version: 0.6, elements } };
