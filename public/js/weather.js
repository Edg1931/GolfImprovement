/* Live conditions for plays-like yardages: wind from Open-Meteo (free, no key) and ground height from its
   elevation service, for uphill and downhill shots. Both are cached, and everything still works without them. */

const Weather = {
  wind: null,      // {speed, gust, from (degrees the wind blows from), at, lat, lon}
  _elev: {},       // "lat,lon" (4 dp) -> metres
  _pending: {},

  async loadWind(p) {
    if (!p || !navigator.onLine) return this.wind;
    const w = this.wind;
    if (w && Date.now() - w.at < 15 * 60000 && yardsBetween(w, p) < 5000) return w;
    if (this._windReq) return this._windReq;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat.toFixed(4)}&longitude=${p.lon.toFixed(4)}&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=mph`;
    this._windReq = fetch(url).then(r => r.ok ? r.json() : null).then(b => {
      const c = b && b.current;
      if (c && c.wind_speed_10m != null) this.wind = { speed: c.wind_speed_10m, gust: c.wind_gusts_10m, from: c.wind_direction_10m, at: Date.now(), lat: p.lat, lon: p.lon };
      return this.wind;
    }).catch(() => this.wind).finally(() => { this._windReq = null; });
    return this._windReq;
  },

  key(p) { return p.lat.toFixed(4) + ',' + p.lon.toFixed(4); },
  elevOf(p) { const v = p && this._elev[this.key(p)]; return v == null ? null : v; },
  /* Ground height for several points in one request; resolves once all are known (or the request fails). */
  async loadElevations(points) {
    const need = points.filter(Boolean).filter(p => this._elev[this.key(p)] == null && !this._pending[this.key(p)]);
    if (!need.length || !navigator.onLine) return;
    need.forEach(p => { this._pending[this.key(p)] = true; });
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${need.map(p => p.lat.toFixed(4)).join(',')}&longitude=${need.map(p => p.lon.toFixed(4)).join(',')}`;
    try {
      const b = await fetch(url).then(r => r.ok ? r.json() : null);
      (b && b.elevation || []).forEach((m, i) => { if (m != null && need[i]) this._elev[this.key(need[i])] = m; });
    } catch (e) { /* offline or blocked: plays-like just ignores slope */ }
    need.forEach(p => { delete this._pending[this.key(p)]; });
  },
};

/* Compass bearing (degrees from north) from a to b. */
function bearingDeg(a, b) { const v = Caddie.projector(a).toXY(b); return (Math.atan2(v.x, v.y) * 180 / Math.PI + 360) % 360; }
/* Wind split into head (+ into the player's face) and cross (+ blowing from the right, pushing the ball left). */
function windComponents(fromDeg, speed, shotBearing) {
  const a = (fromDeg - shotBearing) * Math.PI / 180;
  return { head: speed * Math.cos(a), cross: speed * Math.sin(a) };
}
/* Extra yards a shot plays: into the wind costs about 1% per mph, downwind helps about half that;
   each yard of rise adds a yard. */
function playsLikeYards(d, head, rise) {
  const w = head > 0 ? d * 0.01 * head : d * 0.005 * head;
  return Math.round(w + (Math.abs(rise || 0) >= 2 ? rise : 0));
}
/* Sideways drift in yards (+ = right) from a crosswind: about 6 yds per 10 mph on a 100-yd shot. */
function driftYards(d, cross) { return -d * 0.006 * cross; }
if (typeof module !== 'undefined' && module.exports) module.exports = { playsLikeYards, driftYards, windComponents };
