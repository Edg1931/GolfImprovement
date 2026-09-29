/* Built-in coach: writes a short post-round debrief from the round's own numbers. Free, offline and
   deterministic: every figure it quotes comes from the scorecard, the benchmark for the player's
   target handicap, or the drill library. */

const Coach = {
  plural(n, word, many) { return n + ' ' + (n === 1 ? word : (many || word + 's')); },
  list(items) { return items.length <= 1 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1]; },
  holeNo(r, i) { return (r.firstHole || 0) + i + 1; },
  /* An area's numbers with context, e.g. "25% up-and-downs", "3.0 per round". */
  unit: { scrambling: ' up-and-downs', approach: ' greens', driving: ' fairways' },
  fmt(a, v) { return String(v).replace(' / round', ' per round') + (this.unit[a.key] && /%$/.test(v) ? this.unit[a.key] : ''); },
  name(a) { return a.label.toLowerCase().replace(/ \(.*\)/, ''); },

  /* Stats for the analysis. A nine is scaled to an 18-hole pace so it can be compared with the benchmark. */
  stats(r) {
    const nine = r.holesPlayed === 9, k = nine ? 2 : 1;
    const x = { ...r, holesPlayed: 18, diff: null };
    if (nine) ['putts', 'gir', 'firHit', 'firPossible', 'penalties', 'udAtt', 'udMade', 'sandAtt', 'sandMade', 'threePutts', 'doubles'].forEach(f => { if (x[f] != null) x[f] *= k; });
    return roundStats([x], 1);
  },

  /* 1. How it went, against the player's handicap (or recent average when there is no index). */
  overall(r) {
    const gross = r.grossScore ?? r.score, nine = r.holesPlayed === 9;
    const idx = r.indexUsed ?? App.index();
    const where = nine ? (r.nine === 'back' ? 'the back nine' : r.nine === 'front' ? 'the front nine' : 'nine holes') : '';
    let line = `${gross}${where ? ' on ' + where : ''} at ${r.course || 'the course'}`;
    if (idx != null && r.slope && r.rating) {
      const ch = nine ? courseHandicap9(idx, r.slope, r.rating, r.par) : courseHandicap(idx, r.slope, r.rating, r.par);
      const expected = r.par + ch, d = gross - expected;
      line += d <= -3 ? `: a cracking round, ${this.plural(-d, 'shot')} better than your handicap.`
        : d < 0 ? `: ${this.plural(-d, 'shot')} better than your handicap. Well played.`
        : d === 0 ? ': right on your handicap.'
        : d <= 3 ? `: ${this.plural(d, 'shot')} over your handicap, a normal day.`
        : `: ${this.plural(d, 'shot')} over your handicap, so there's plenty to learn from this one.`;
    } else line += '.';
    const full = App.rounds().filter(x => x.holesPlayed === r.holesPlayed || (!nine && x.holesPlayed !== 9));
    const others = full.filter(x => x.id !== r.id).map(x => x.grossScore ?? x.score);
    if (others.length >= 3 && gross < Math.min(...others)) line += ` It's your best ${nine ? 'nine' : 'score'} in ${this.plural(others.length + 1, 'round')}.`;
    return line;
  },

  /* 2. The two biggest leaks, with the real numbers, plus blow-up holes and the tee-shot pattern. */
  leaks(r, areas, bench) {
    const top = areas.filter(a => a.loss >= 0.4).slice(0, 2);
    const nine = r.holesPlayed === 9;
    const bits = [];
    if (top.length) {
      const phrase = a => `${this.name(a)} (${this.fmt(a, a.yours)} against ${this.fmt(a, a.bench)} for a ${bench.label} handicap, about ${this.plural(Math.round(a.loss * 10) / 10, 'stroke')}${nine ? ' on an 18-hole pace' : ''})`;
      bits.push(`Where the strokes went: ${phrase(top[0])}${top[1] ? `, then ${phrase(top[1])}` : ''}.`);
    } else bits.push(`You matched a ${bench.label} handicap in every area we measure, so the next step is sharpening your strengths.`);
    if (r.holes) {
      const blow = r.holes.map((h, i) => ({ n: this.holeNo(r, i), over: h.strokes - r.pars[i] })).filter(h => h.over >= 2).sort((a, b) => b.over - a.over);
      if (blow.length) bits.push(`${blow.length === 1 ? 'The costly hole was' : 'The costly holes were'} ${this.list(blow.slice(0, 3).map(h => h.n + ` (+${h.over})`))}; turning ${blow.length === 1 ? 'that into a bogey' : 'those into bogeys'} saves ${this.plural(blow.slice(0, 3).reduce((s, h) => s + h.over - 1, 0), 'shot')}.`);
      const tee = r.holes.filter((h, i) => r.pars[i] >= 4 && h.fir);
      const left = tee.filter(h => h.fir === 'left').length, right = tee.filter(h => h.fir === 'right').length;
      if (left + right >= 3 && (left >= 2 * right || right >= 2 * left)) bits.push(`Your tee-shot misses went ${left > right ? 'left' : 'right'} (${Math.max(left, right)} of ${left + right}), so aim down the ${left > right ? 'right' : 'left'}-hand side to keep misses in play.`);
    }
    return bits.join(' ');
  },

  /* 3. One genuine positive, from the best of several candidates. */
  positive(r, areas) {
    const c = [];
    if (r.holes) {
      const birdies = r.holes.filter((h, i) => h.strokes < r.pars[i]).length;
      if (birdies) c.push(`${birdies === 1 ? 'A birdie' : this.plural(birdies, 'birdie')} on the card.`);
      let run = 0, best = 0; r.holes.forEach((h, i) => { run = h.strokes <= r.pars[i] ? run + 1 : 0; best = Math.max(best, run); });
      if (best >= 3) c.push(`${best} holes in a row at par or better shows what your game looks like when it clicks.`);
    }
    const strong = areas.filter(a => a.loss <= -0.4).sort((a, b) => a.loss - b.loss)[0];
    if (strong) c.push(`${strong.label.replace(/ \(.*\)/, '')} was a real strength: ${this.fmt(strong, strong.yours)} against ${this.fmt(strong, strong.bench)} for your target.`);
    if (r.threePutts === 0) c.push('Not a single three-putt, so your speed control was spot on.');
    if (r.penalties === 0) c.push('No penalty strokes all round: smart, disciplined golf.');
    if (r.firHit != null && r.firPossible && r.firHit / r.firPossible >= 0.6) c.push(`You found ${r.firHit} of ${r.firPossible} fairways.`);
    if (r.gir != null && r.gir >= (r.holesPlayed === 9 ? 4 : 8)) c.push(`${r.gir} greens in regulation gave you plenty of chances.`);
    return c[0] || (r.holes ? 'You logged every hole, and that data is exactly what makes the next round better.' : 'You logged the round with its stats, and that data is exactly what makes the next round better.');
  },

  /* 4. Two drills for this week, matched to the leaks. */
  practice(areas) {
    // the same leaks named in the debrief; with none, the biggest remaining gaps
    const named = areas.filter(a => a.loss >= 0.4).slice(0, 2);
    const recs = recommendDrills(named.length ? named : areas, 4);
    // one practice drill (an hour or less) per leak, plus an on-course game when a leak is about decisions
    const drills = [], games = [];
    recs.forEach(x => x.drills.forEach(d => {
      const why = this.name(x.area);
      if (d.minutes > 60) { if (!games.length) games.push({ d, why }); }
      else if (drills.length < 2 && !drills.some(p => p.d.id === d.id) && !drills.some(p => p.why === why)) drills.push({ d, why });
    }));
    if (!drills.length && !games.length) return 'This week: keep your routine going and play a Worst-Ball nine to put your game under pressure.';
    let t = drills.length ? 'This week: ' + this.list(drills.map(p => `${p.d.name} for your ${p.why} (${p.d.minutes} min)`)) + '.' : '';
    if (games.length) t += `${t ? ' ' : ''}On your next round, play the ${games[0].d.name} game to cut the ${games[0].why}.`;
    return t + ' Log the scores so you can see them move.';
  },

  debrief(round) {
    const r = App.rounds().find(x => x.id === round.id) || round;
    const target = App.targetHcp(); const bench = benchmarkFor(target);
    const st = this.stats(r); const areas = st ? strokeLossAnalysis(st, target) : [];
    return [this.overall(r), this.leaks(r, areas, bench), this.positive(r, areas), this.practice(areas)].join('\n');
  },
};
