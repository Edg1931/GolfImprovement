/* Reference content: benchmarks, skills tests, strategy, mental game, warm-up, fitness, glossary. */

/* Approximate per-round averages by handicap, drawn from published shot-tracking data.
   score = typical score on a par 72 course of average difficulty. */
const BENCHMARKS = [
  { hcp: 0,  label: 'Scratch', score: 73,  fir: 60, gir: 63, putts: 29.5, scrambling: 58, threePutts: 0.5, penalties: 0.3, doubles: 0.3 },
  { hcp: 5,  label: '5',       score: 78,  fir: 55, gir: 50, putts: 31.0, scrambling: 45, threePutts: 0.9, penalties: 0.6, doubles: 0.8 },
  { hcp: 10, label: '10',      score: 83,  fir: 50, gir: 38, putts: 32.5, scrambling: 35, threePutts: 1.4, penalties: 1.0, doubles: 1.5 },
  { hcp: 15, label: '15',      score: 88,  fir: 45, gir: 27, putts: 34.0, scrambling: 27, threePutts: 2.0, penalties: 1.5, doubles: 2.5 },
  { hcp: 20, label: '20',      score: 93,  fir: 40, gir: 18, putts: 35.5, scrambling: 20, threePutts: 2.6, penalties: 2.0, doubles: 3.6 },
  { hcp: 25, label: '25',      score: 98,  fir: 35, gir: 12, putts: 37.0, scrambling: 15, threePutts: 3.2, penalties: 2.6, doubles: 4.8 },
  { hcp: 30, label: '30+',     score: 104, fir: 30, gir: 7,  putts: 38.5, scrambling: 11, threePutts: 4.0, penalties: 3.2, doubles: 6.0 },
];

function benchmarkFor(hcp) {
  if (hcp == null || isNaN(hcp)) return BENCHMARKS[3];
  let best = BENCHMARKS[0];
  for (const b of BENCHMARKS) if (Math.abs(b.hcp - hcp) < Math.abs(best.hcp - hcp)) best = b;
  return best;
}

/* Skills test. Each test scores out of 10; benchmarks are "makes out of 10" per tier. */
const ASSESSMENT_TESTS = [
  { id: 'putt3',   name: '3 ft putts',            area: 'putting',   how: '10 putts from 3 ft, mixed slopes. Count makes.',
    benchmarks: { beginner: 7, improver: 8, intermediate: 9, advanced: 10 }, drills: ['clock-drill', 'gate-drill', '100-three-footers'] },
  { id: 'putt6',   name: '6 ft putts',            area: 'putting',   how: '10 putts from 6 ft, mixed slopes. Count makes.',
    benchmarks: { beginner: 3, improver: 4, intermediate: 5, advanced: 7 }, drills: ['around-the-world-6', '3-6-9', 'green-reading'] },
  { id: 'lag30',   name: '30 ft lag putts',       area: 'putting',   how: '10 putts from 30 ft. Count balls finishing within 3 ft (a "gimme" circle).',
    benchmarks: { beginner: 4, improver: 5, intermediate: 7, advanced: 8 }, drills: ['ladder-lag', 'leapfrog', 'eyes-closed-speed'] },
  { id: 'chip15',  name: '15 yd chips',           area: 'chipping',  how: '10 chips from 15 yds off a good lie. Count balls finishing within 6 ft.',
    benchmarks: { beginner: 3, improver: 4, intermediate: 6, advanced: 7 }, drills: ['towel-landing', 'bump-and-run-ladder', 'coin-under-foot'] },
  { id: 'pitch40', name: '40 yd pitches',         area: 'pitching',  how: '10 pitches from 40 yds. Count balls finishing within 15 ft.',
    benchmarks: { beginner: 2, improver: 3, intermediate: 5, advanced: 7 }, drills: ['pitch-ladder', 'clock-system', 'wedge-par-3'] },
  { id: 'bunker',  name: 'Greenside bunker',      area: 'bunker',    how: '10 shots from a normal lie, 10 yds to the flag. Count balls finishing on the green within 20 ft.',
    benchmarks: { beginner: 3, improver: 4, intermediate: 6, advanced: 7 }, drills: ['line-in-sand', 'dollar-bill', 'bunker-lies'] },
  { id: 'wedge80', name: '80 yd wedge',           area: 'wedges',    how: '10 full or partial wedges from 80 yds. Count balls finishing within 10 yds (30 ft) of the target.',
    benchmarks: { beginner: 2, improver: 3, intermediate: 5, advanced: 7 }, drills: ['clock-system', 'pitch-ladder', 'wedge-par-3'] },
  { id: 'iron7',   name: '7-iron accuracy',       area: 'irons',     how: '10 shots with a 7-iron to a target. Count balls finishing within 15 yds of the target (a green-sized circle).',
    benchmarks: { beginner: 2, improver: 3, intermediate: 5, advanced: 7 }, drills: ['towel-behind-ball', 'divot-line', 'three-club-distance'] },
  { id: 'driver',  name: 'Driver accuracy',       area: 'driver',    how: '10 drives at a 30 yd wide fairway. Count balls finishing inside it.',
    benchmarks: { beginner: 3, improver: 4, intermediate: 5, advanced: 6 }, drills: ['fairway-gate', 'stock-shot', 'face-tape'] },
];

const STRATEGY = [
  { title: 'The handicap maths that changes everything', items: [
    'Your "personal par" is par plus your course handicap spread over the holes. A 18-handicap\'s personal par is bogey on every hole. Play for it and let pars happen.',
    'Breaking 100 needs 5 bogeys and 13 doubles. Breaking 90 needs 18 bogeys. Breaking 80 needs 10 pars and 8 bogeys. You do not need birdies for any of them.',
    'The difference between a 15 and a 10 handicap is almost never the good shots. It is the number of double bogeys or worse: 2.5 per round vs 1.5.',
    'The cheapest strokes to save, in order: penalties (OB, water), three-putts, short-side chips, then greens in regulation.',
  ]},
  { title: 'Tee shots', items: [
    'Priority one is playing the next shot from the short grass, not distance. If driver hits 4 of 10 fairways and 3-wood hits 7, use 3-wood on any hole with trouble.',
    'Aim for the widest part of the fairway at your carry distance, not the flag line. Know where trouble is at 220 vs 250 yds.',
    'Play your stock shape. Tee up on the side of the tee box nearest the trouble and hit away from it.',
    'On par 5s, the tee shot decides whether the hole is a birdie chance or a scramble. Take the club that keeps you in play; a 3-wood + 7-iron + wedge is a fine par.',
    'Never hit driver just because it is a par 4 or 5. Ask: "Where does this need to land to give me a comfortable next shot?"',
  ]},
  { title: 'Approach shots', items: [
    'Aim at the centre of the green unless the pin is in the middle third. A tucked pin behind a bunker is a sucker pin at every handicap.',
    'Take enough club. Amateurs miss short 70% of the time. Play for your average carry, not your best, and club up into wind, uphill, or when cold.',
    'Know the "safe miss" for every green: usually the front or the side away from bunkers. Choose a club whose miss lands there.',
    'From 150+ yds, your goal is "on the green anywhere". From 100 yds in, the goal is inside 30 ft. Only inside 60 yds should you think about the flag.',
    'Trouble long is usually worse than trouble short. If the green slopes back to front, being short is the smart miss.',
  ]},
  { title: 'Around the green', items: [
    'Choose the lowest-risk shot that can finish inside 6 ft: putt if you can, chip (bump and run) if you cannot putt, pitch only if you must carry something, flop only in desperation.',
    'Landing spot first, club second. Pick where the ball should land on the green, then pick the club that rolls out the right distance.',
    'From the short side, the goal is "on the green, two-putt". Do not try the miracle shot.',
    'Bunker: commit to speed. The most common amateur bunker miss is decelerating and leaving it in.',
    'Downhill lie, downwind, downhill green: land it short and let it run. Uphill everything: be aggressive.',
  ]},
  { title: 'Putting', items: [
    'From 30 ft, tour pros make 7%. Your goal from 20 ft or more is a 3 ft circle, not the hole.',
    'Read from the low side of the hole and behind the ball. Feel the slope through your feet walking to the ball.',
    'Speed beats line. A putt hit at the right speed has a 4-inch-wide hole; a hard putt has a 1-inch hole.',
    'Short putts: firm and straight at the hole. Mid-range: die it in. Long: lag to a circle.',
    'Have a routine and do not change it under pressure: read, one practice stroke for feel, set up, one look, go.',
  ]},
  { title: 'Trouble and recovery', items: [
    'When in trouble, take your medicine: the punch-out that leaves a full wedge is nearly always the right play. Turn a 6 into a 5 by not trying for a 4.',
    'Ask "What is the worst that can happen with this shot?" If the answer is a penalty, choose a different shot.',
    'From the trees, the gap needs to be twice as wide as you think, and the shot lower than you think.',
    'After a penalty, reset your target for the hole: the new goal is double bogey, and it is a fine score.',
  ]},
  { title: 'Weather and conditions', items: [
    'Wind: club up more than you think into it (1 club per 10 mph), swing at 80% to reduce spin. Downwind, spin drops and the ball runs; land it shorter.',
    'Cold and wet: the ball flies shorter (10–15 yds for a driver at 5°C vs 25°C) and stops faster on landing.',
    'Firm and fast: land approach shots short of the green and run them on; use the bump and run around greens.',
    'Rain: grip pressure light, wipe grips every shot, expect less roll and fewer flyer lies.',
  ]},
];

const MENTAL = [
  { title: 'Pre-shot routine (the one thing you control)', items: [
    'See it: from behind the ball, pick a precise target (a branch, not "the fairway") and visualise the flight.',
    'Feel it: one rehearsal swing with your single swing thought.',
    'Trust it: step in, aim the face, set the body, one look at the target, exhale.',
    'Go: swing within 8 seconds of stepping in. Longer than that and doubt creeps in.',
    'Build yours in the editor below and take it to the range. Same routine for a 3-footer and a driver.',
  ]},
  { title: 'Between shots', items: [
    'Use the 10-second rule: react for 10 seconds, then a physical reset (club in bag, deep breath) and a neutral cue: "next shot".',
    'Walk at an even pace. Rushing after a bad hole is the fastest way to another one.',
    'Think about anything except swing mechanics between shots. Talk to your partners, look at the scenery.',
    'Play the shot in front of you. Adding up your score mid-round pulls you into the future where you cannot swing a club.',
  ]},
  { title: 'Handling pressure', items: [
    'Pressure raises heart rate and grip pressure, which speeds up your tempo. Counter with box breathing (4-4-4-4) and a deliberately slower walk.',
    'Narrow the target under pressure. A precise small target calms the mind; "just get it in play" makes the brain search for trouble.',
    'Expect nerves; they mean you care. Say "I\'m excited" rather than "I\'m nervous". The physiology is the same, the label changes the effect.',
    'Practise pressure: end every session with a consequence putt or a 3-6-9 drill. Play money games. Enter club competitions.',
  ]},
  { title: 'Self-talk and confidence', items: [
    'Confidence comes from evidence. Keep a "win log" of good shots and good decisions; read it before a competition round.',
    'Replace "don\'t hit it in the water" with "land it on the left half". The brain does not process negatives.',
    'Rate each shot on decision and execution, not result. A well-struck shot that takes a bad bounce is a good shot.',
    'Accept the bell curve: even tour players hit 3–4 poor shots a round. Yours will be 8–10. Budget for them.',
  ]},
  { title: 'Tournament and first-tee preparation', items: [
    'Arrive 60 minutes early. Do the 8-minute warm-up, then 20 minutes of range (short game to long, finishing with the first tee club), then 15 minutes on the practice green with lag putts and 3-footers.',
    'Have a plan for every hole written on a yardage book or card before the round. Follow the plan; do not renegotiate on the tee.',
    'Set 2–3 process goals for the round (e.g. full routine every shot, centre of green from 150+, no hero shots). Score those, not just strokes.',
    'On the first tee, pick the shot you have hit the most times in your life. A 3-wood to the fat side of the fairway is a great start.',
  ]},
];

const WARMUP = [
  { phase: 'Body (8 min)', items: ['1 min brisk walk with arm swings', '10 leg swings each leg, each direction', '10 hip circles each way and 10 squats', '10 thoracic rotations each side, club across shoulders', '10 arm circles each way, 10 shoulder rolls', '10 swings with two clubs, building speed'] },
  { phase: 'Short game (10 min)', items: ['10 chips to a landing spot with a sand wedge', '10 pitches at 30–40 yds', '5 bunker shots if available'] },
  { phase: 'Range (15 min)', items: ['10 half-swing wedges: find the centre of the face', '8 × 9-iron, 8 × 7-iron, 5 × hybrid, 5 × driver', 'Finish with the club you will hit on the first tee, with full routine', 'Never work on technique during a warm-up. Rhythm and target only.'] },
  { phase: 'Putting green (12 min)', items: ['10 lag putts to 30–40 ft for speed', '10 × 6 ft putts', 'Finish by making 5 × 3-footers in a row so your last memory is the ball going in'] },
];

const FITNESS = [
  { title: 'Daily mobility (10 min)', when: 'Every day, ideally morning', items: [
    '90/90 hip switches × 10 and 30 s hold each side',
    'Cat-camel × 10; open-book thoracic rotation × 10 each side',
    'World\'s greatest stretch × 5 each side',
    'Wall shoulder slides × 10; wrist circles and forearm stretch 30 s each',
    'Single-leg balance 30 s each leg (eyes closed once easy)',
  ]},
  { title: 'Strength (2 × per week, 35–45 min)', when: 'Mon and Thu, or any two non-consecutive days', items: [
    'Goblet squat 3 × 10',
    'Romanian deadlift 3 × 10',
    'Push-ups or dumbbell bench press 3 × 10',
    'Single-arm row 3 × 10 each side',
    'Pallof press 3 × 12 each side (anti-rotation)',
    'Cable or band rotation in golf posture 3 × 12 each side',
    'Side plank 3 × 30 s each side; farmer carry 3 × 40 m',
    'Progress by adding 2–5% load or 1–2 reps each week; deload every 4th week',
  ]},
  { title: 'Speed and power (2 × per week, 15 min, when fresh)', when: 'Before a range session or on strength days', items: [
    'Rotational med ball throws 3 × 8 each side',
    'Scoop throws 2 × 6 each side',
    'Overspeed swings: 3 sets of 5 with a light club or a driver held by the head (swing the grip end), then 5 with the driver as fast as possible',
    'Step-change drill × 10 balls on the range',
    'Rest fully between sets: power training is about intent, not fatigue',
  ]},
  { title: 'Cardio and walking (2–3 × per week)', when: 'Any day', items: [
    '30–45 min brisk walk or easy bike/run to build the endurance to stay sharp on holes 14–18',
    'Walk the course with a push cart whenever possible: 8–10 km per round',
  ]},
];

const GLOSSARY = [
  ['Handicap Index', 'A measure of your demonstrated ability, calculated from the best 8 of your last 20 score differentials under the World Handicap System.'],
  ['Course Handicap', 'Your Handicap Index converted for a specific course and tee: Index × (Slope ÷ 113) + (Course Rating − Par).'],
  ['Score Differential', '(113 ÷ Slope) × (Adjusted Gross Score − Course Rating). The number each round contributes to your index.'],
  ['Course Rating', 'The expected score for a scratch golfer on a set of tees.'],
  ['Slope Rating', 'How much harder the course is for a bogey golfer than a scratch golfer. 113 is average; range 55–155.'],
  ['Adjusted Gross Score', 'Your score after applying net double bogey as the maximum on any hole (par + 2 + any handicap strokes on that hole).'],
  ['GIR', 'Green in Regulation: reaching the green in par minus two strokes (1 on a par 3, 2 on a par 4, 3 on a par 5).'],
  ['FIR', 'Fairway in Regulation: tee shot finishes in the fairway on a par 4 or par 5 (14 chances on a typical course).'],
  ['Scrambling', 'Percentage of holes where you missed the green but still made par or better.'],
  ['Up and down', 'Getting the ball in the hole in two strokes from off the green.'],
  ['Sand save', 'An up and down from a greenside bunker.'],
  ['Proximity', 'Average distance from the hole after an approach shot. The best measure of iron and wedge quality.'],
  ['Strokes gained', 'How many strokes better or worse you were than a benchmark player from each position. Positive is good.'],
  ['Short side', 'Missing the green on the same side as the flag, leaving very little green to work with.'],
  ['Stock shot', 'Your default, most repeatable shot shape and trajectory.'],
  ['Low point', 'The bottom of the swing arc. For irons it must be in front of the ball for ball-then-turf contact.'],
  ['Smash factor', 'Ball speed ÷ clubhead speed. 1.48–1.50 is a centre strike with a driver.'],
  ['Blocked practice', 'Repeating the same shot many times. Good for learning technique, poor for transfer to the course.'],
  ['Random practice', 'Changing club, target and shot every ball. Harder, but transfers much better to real golf.'],
  ['Stableford', 'A points system: bogey 1, par 2, birdie 3, eagle 4 (net of handicap strokes). 36 points is playing to your handicap.'],
];

/* Default clubs for a new bag. Carry distances are placeholders to be overwritten. */
const DEFAULT_CLUBS = [
  { club: 'Driver', carry: 230 }, { club: '3W', carry: 210 }, { club: '5W', carry: 195 }, { club: '4H', carry: 185 },
  { club: '5i', carry: 175 }, { club: '6i', carry: 165 }, { club: '7i', carry: 155 }, { club: '8i', carry: 145 },
  { club: '9i', carry: 135 }, { club: 'PW', carry: 122 }, { club: 'GW', carry: 108 }, { club: 'SW', carry: 95 }, { club: 'LW', carry: 80 },
];

const DEFAULT_ROUTINE = [
  'Stand behind the ball, pick a precise target',
  'Visualise the shot shape and landing spot',
  'One rehearsal swing with my swing feel',
  'Step in: face to target, then feet and body',
  'One look at the target, exhale',
  'Swing within 8 seconds',
];
