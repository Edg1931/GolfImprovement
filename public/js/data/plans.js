/* Practice schedules by handicap tier and weekly time budget, plus a 12-week program. */

const TIERS = [
  { id: 'beginner',     label: 'Getting Started', range: '25+ handicap',  min: 25, max: 99,
    focus: 'Contact and the short game. Eliminate blow-up holes and three-putts. Aim: break 100 consistently.',
    split: { putting: 30, shortgame: 30, fullswing: 30, fitness: 10 } },
  { id: 'improver',     label: 'Improver',        range: '15–24 handicap', min: 15, max: 24.9,
    focus: 'Reliable tee shot, wedges inside 100 yds, lag putting. Aim: break 90 and stay there.',
    split: { putting: 30, shortgame: 30, fullswing: 30, fitness: 10 } },
  { id: 'intermediate', label: 'Intermediate',    range: '8–14 handicap',  min: 8, max: 14.9,
    focus: 'Hit more greens, sharpen scrambling, build a wedge distance system. Aim: break 80.',
    split: { putting: 30, shortgame: 35, fullswing: 25, fitness: 10 } },
  { id: 'advanced',     label: 'Advanced',        range: '0–7 handicap',   min: -10, max: 7.9,
    focus: 'Margins: 6–15 ft putts, proximity from 100–150 yds, driving accuracy, tournament mindset. Aim: scratch.',
    split: { putting: 35, shortgame: 30, fullswing: 25, fitness: 10 } },
];

const TIME_BUDGETS = [
  { id: 'light',    label: 'Light',    hours: '2–3 hrs / week', sessions: 3 },
  { id: 'standard', label: 'Standard', hours: '4–6 hrs / week', sessions: 4 },
  { id: 'serious',  label: 'Serious',  hours: '8+ hrs / week',  sessions: 6 },
];

/* Session templates per tier. Each session lists drill ids with minutes. */
const SESSION_TEMPLATES = {
  beginner: [
    { id: 'b-putt',  name: 'Putting Basics',       type: 'putting',   minutes: 40, drills: [['gate-drill', 10], ['clock-drill', 15], ['ladder-lag', 15]] },
    { id: 'b-chip',  name: 'Short Game Contact',   type: 'shortgame', minutes: 45, drills: [['coin-under-foot', 10], ['towel-landing', 15], ['bump-and-run-ladder', 10], ['line-in-sand', 10]] },
    { id: 'b-swing', name: 'Strike & Balance',     type: 'fullswing', minutes: 60, drills: [['dynamic-warmup', 8], ['feet-together', 10], ['towel-behind-ball', 12], ['half-speed-feel', 10], ['fairway-gate', 15], ['pressure-putt', 5]] },
    { id: 'b-game',  name: 'Scoring Games',        type: 'shortgame', minutes: 45, drills: [['par-18-putting', 20], ['up-and-down-10', 25]] },
    { id: 'b-fit',   name: 'Mobility & Strength',  type: 'fitness',   minutes: 30, drills: [['hip-90-90', 8], ['single-leg-balance', 6], ['golf-strength-circuit', 16]] },
    { id: 'b-course',name: 'Play 9: Personal Par', type: 'course',    minutes: 120, drills: [['bogey-is-par', 120]] },
  ],
  improver: [
    { id: 'i-putt',  name: 'Putting: Speed & Short', type: 'putting',   minutes: 45, drills: [['metronome-tempo', 10], ['3-6-9', 15], ['ladder-lag', 15], ['pressure-putt', 5]] },
    { id: 'i-chip',  name: 'Chipping & Bunker',      type: 'shortgame', minutes: 45, drills: [['towel-landing', 15], ['one-club-three-shots', 15], ['dollar-bill', 15]] },
    { id: 'i-wedge', name: 'Wedge Distances',        type: 'fullswing', minutes: 45, drills: [['dynamic-warmup', 8], ['pitch-ladder', 20], ['clock-system', 17]] },
    { id: 'i-swing', name: 'Driver & Irons',         type: 'fullswing', minutes: 60, drills: [['dynamic-warmup', 8], ['divot-line', 12], ['three-club-distance', 15], ['stock-shot', 15], ['tee-shot-routine', 10]] },
    { id: 'i-game',  name: 'Scoring Games',          type: 'shortgame', minutes: 50, drills: [['par-18-shortgame', 30], ['par-18-putting', 20]] },
    { id: 'i-fit',   name: 'Strength & Mobility',    type: 'fitness',   minutes: 35, drills: [['golf-strength-circuit', 35]] },
    { id: 'i-course',name: 'Play 9: Centre of Green',type: 'course',    minutes: 120, drills: [['centre-of-green', 120]] },
  ],
  intermediate: [
    { id: 'm-putt',  name: 'Putting: 6–15 ft',       type: 'putting',   minutes: 45, drills: [['around-the-world-6', 15], ['green-reading', 15], ['leapfrog', 10], ['pressure-putt', 5]] },
    { id: 'm-chip',  name: 'Scrambling',             type: 'shortgame', minutes: 50, drills: [['up-and-down-10', 25], ['high-low-pitch', 15], ['bunker-lies', 10]] },
    { id: 'm-wedge', name: 'Wedge System',           type: 'fullswing', minutes: 45, drills: [['dynamic-warmup', 8], ['clock-system', 20], ['wedge-par-3', 17]] },
    { id: 'm-swing', name: 'Approach & Driving',     type: 'fullswing', minutes: 60, drills: [['dynamic-warmup', 8], ['three-club-distance', 15], ['punch-shot', 12], ['virtual-course', 25]] },
    { id: 'm-game',  name: 'Random Practice Games',  type: 'shortgame', minutes: 50, drills: [['par-18-shortgame', 30], ['wedge-par-3', 20]] },
    { id: 'm-fit',   name: 'Power & Strength',       type: 'fitness',   minutes: 40, drills: [['med-ball-throws', 15], ['golf-strength-circuit', 25]] },
    { id: 'm-course',name: 'Play 9: Two-Ball Scenario', type: 'course', minutes: 120, drills: [['two-ball-scenario', 120]] },
  ],
  advanced: [
    { id: 'a-putt',  name: 'Putting Precision',      type: 'putting',   minutes: 50, drills: [['gate-drill', 10], ['around-the-world-6', 15], ['100-three-footers', 20], ['pressure-putt', 5]] },
    { id: 'a-chip',  name: 'Short Game Variety',     type: 'shortgame', minutes: 50, drills: [['one-club-three-shots', 15], ['high-low-pitch', 15], ['long-bunker', 10], ['bunker-lies', 10]] },
    { id: 'a-wedge', name: 'Wedge Proximity',        type: 'fullswing', minutes: 45, drills: [['dynamic-warmup', 8], ['pitch-ladder', 17], ['wedge-par-3', 20]] },
    { id: 'a-swing', name: 'Shot Shaping & Driving', type: 'fullswing', minutes: 60, drills: [['dynamic-warmup', 8], ['nine-shot', 25], ['face-tape', 12], ['fairway-gate', 15]] },
    { id: 'a-speed', name: 'Speed Session',          type: 'fullswing', minutes: 30, drills: [['dynamic-warmup', 8], ['step-change-speed', 15], ['med-ball-throws', 7]] },
    { id: 'a-fit',   name: 'Strength',               type: 'fitness',   minutes: 40, drills: [['golf-strength-circuit', 35], ['hip-90-90', 5]] },
    { id: 'a-course',name: 'Play 9: Worst Ball',     type: 'course',    minutes: 120, drills: [['worst-ball', 120]] },
  ],
};

/* Weekly layout: which session template goes on which day for each tier × budget. null = rest. */
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKLY_LAYOUT = {
  beginner: {
    light:    ['b-putt', null, 'b-chip', null, null, 'b-swing', null],
    standard: ['b-putt', 'b-fit', 'b-chip', null, 'b-swing', 'b-course', null],
    serious:  ['b-putt', 'b-fit', 'b-chip', 'b-swing', 'b-game', 'b-course', 'b-fit'],
  },
  improver: {
    light:    ['i-putt', null, 'i-chip', null, null, 'i-swing', null],
    standard: ['i-putt', 'i-fit', 'i-chip', null, 'i-wedge', 'i-course', null],
    serious:  ['i-putt', 'i-fit', 'i-chip', 'i-wedge', 'i-game', 'i-course', 'i-swing'],
  },
  intermediate: {
    light:    ['m-putt', null, 'm-chip', null, null, 'm-wedge', null],
    standard: ['m-putt', 'm-fit', 'm-chip', null, 'm-wedge', 'm-course', null],
    serious:  ['m-putt', 'm-fit', 'm-chip', 'm-wedge', 'm-game', 'm-course', 'm-swing'],
  },
  advanced: {
    light:    ['a-putt', null, 'a-chip', null, null, 'a-wedge', null],
    standard: ['a-putt', 'a-fit', 'a-chip', null, 'a-wedge', 'a-course', null],
    serious:  ['a-putt', 'a-speed', 'a-chip', 'a-wedge', 'a-swing', 'a-course', 'a-fit'],
  },
};

/* 12-week program: 3 phases of 4 weeks. */
const PROGRAM = {
  phases: [
    { id: 'p1', name: 'Phase 1 — Foundation', weeks: [1, 2, 3, 4],
      goal: 'Establish baselines, fix strike, build a putting routine and a reliable chip.',
      keys: ['Complete the Skills Test in week 1.', 'Log every round with stats.', 'Blocked practice: repeat the same drill until the number improves.', 'Build your pre-shot routine and use it on every shot.'] },
    { id: 'p2', name: 'Phase 2 — Build', weeks: [5, 6, 7, 8],
      goal: 'Add distance control (wedge matrix, lag ladder) and course management habits.',
      keys: ['Re-test skills in week 6 and compare.', 'Play at least one Centre-of-Green round.', 'Move to 50% random practice (games, ladders in random order).', 'Start speed and strength work if not already.'] },
    { id: 'p3', name: 'Phase 3 — Perform', weeks: [9, 10, 11, 12],
      goal: 'Transfer to the course: pressure games, personal-par rounds and tournament simulation.',
      keys: ['Every session ends with a consequence putt.', 'Play a Worst-Ball or Two-Ball scenario nine.', 'Final Skills Test in week 12.', 'Review stats and set the next 12-week target.'] },
  ],
  weekThemes: {
    1: 'Baseline week: Skills Test + log 2 rounds', 2: 'Strike: low point drills daily', 3: 'Short putts: 3–6 ft volume', 4: 'Chipping landing spots',
    5: 'Wedge distance matrix', 6: 'Mid-test: re-run Skills Test', 7: 'Lag putting and green reading', 8: 'Bunker & trouble shots',
    9: 'Pressure games every session', 10: 'Course strategy round(s)', 11: 'Tournament simulation', 12: 'Final test + review',
  },
};

function tierForIndex(idx) {
  if (idx == null || isNaN(idx)) return TIERS[1];
  return TIERS.find(t => idx >= t.min && idx <= t.max) || TIERS[0];
}
function getSessionTemplate(tierId, sessionId) {
  return (SESSION_TEMPLATES[tierId] || []).find(s => s.id === sessionId);
}
function weeklyPlan(tierId, budgetId) {
  const layout = (WEEKLY_LAYOUT[tierId] || WEEKLY_LAYOUT.improver)[budgetId] || WEEKLY_LAYOUT.improver.standard;
  return layout.map((sid, i) => ({ day: DAYS[i], session: sid ? getSessionTemplate(tierId, sid) : null }));
}

/* ---------- Adaptive plan ---------- */
/* For each stroke-loss area: the drill categories that fix it, and the session types it can be slotted into. */
const AREA_FOCUS = {
  putting:    { cats: ['putting'], sessions: ['putting'] },
  lag:        { cats: ['putting'], sessions: ['putting'] },
  scrambling: { cats: ['chipping', 'pitching', 'bunker'], sessions: ['shortgame'] },
  approach:   { cats: ['irons', 'wedges', 'pitching'], sessions: ['fullswing'] },
  driving:    { cats: ['driver'], sessions: ['fullswing'] },
  penalties:  { cats: ['course', 'driver'], sessions: ['fullswing'] },
  blowups:    { cats: ['course', 'mental'], sessions: ['shortgame', 'fullswing'] },
};
/* Drills that are part of a session's structure (warm-up, closing pressure putt) and never swapped out. */
const FIXED_DRILLS = ['dynamic-warmup', 'pressure-putt'];

/* Re-point the weekly plan at the player's weakest areas. focus: [{key, label, loss}] (worst first).
   Each practice session of a matching type gets one drill swapped for a focus drill the week doesn't
   already contain; the swapped-out drill is one outside the focus categories. Returns {plan, focus, swaps}. */
function adaptPlan(plan, focus, tierId) {
  const maxDiff = { beginner: 2, improver: 2, intermediate: 3, advanced: 3 }[tierId] || 3;
  const used = new Set(plan.flatMap(d => d.session ? d.session.drills.map(([id]) => id) : []));
  const specs = focus.map(f => AREA_FOCUS[f.key]).map(a => a && { ...a, pool: DRILLS.filter(dr => a.cats.includes(dr.category) && dr.difficulty <= maxDiff && dr.minutes <= 30) });
  let swaps = 0;
  const out = plan.map(day => {
    if (!day.session) return day;
    const drills = day.session.drills.map(x => x.slice()); let swapped = false;
    focus.forEach((f, fi) => {
      const spec = specs[fi]; if (swapped || !spec || !spec.sessions.includes(day.session.type)) return;
      // replace the last swappable drill that is not already working on this area
      let slot = -1;
      drills.forEach(([id], k) => { if (!FIXED_DRILLS.includes(id) && !spec.cats.includes((getDrill(id) || {}).category)) slot = k; });
      const pick = spec.pool.find(dr => !used.has(dr.id));
      if (slot < 0 || !pick) return;
      used.add(pick.id); drills[slot] = [pick.id, drills[slot][1], f.label]; swapped = true; swaps++;
    });
    return swapped ? { ...day, session: { ...day.session, drills } } : day;
  });
  return { plan: out, focus, swaps };
}
