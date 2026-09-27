# Fairway Lab: product review and roadmap

This review compares Fairway Lab with the leading golf apps: Arccos, Shot Scope, 18Birdies, Golfshot, TheGrint, Hole19, Clippd, DECADE, V1 Golf and Garmin Golf.

## Where Fairway Lab already wins

| Strength | Why it matters |
| --- | --- |
| **Practice system with measurable drills** (54 drills, tiered schedules, 12-week program) | Most tracking apps tell you *what* is wrong and stop there. Only Clippd and V1 come close on turning stats into a practice plan. |
| **Stroke-loss analysis mapped to drills** | This is the practical version of the Arccos and Shot Scope "strokes gained" idea, and it needs no sensors. |
| **Skills Test with tier benchmarks** | A structured combine that most apps do not offer. |
| **Playbook** (strategy, mental game, warm-up, fitness) | The DECADE-style course-management knowledge that lowers scores without swing changes. |
| **Free, private, works offline** | No account, no subscription, and the data stays on the device. Arccos and 18Birdies Premium cost $100–200 a year. |

## What this release added

| Feature | Inspired by | Notes |
| --- | --- | --- |
| **Live hole-by-hole scorecard** | 18Birdies, Golfshot, TheGrint | Large touch targets, score shortcuts (Birdie / Par / Bogey), putts, tee-shot direction, penalties and greenside bunker. Live net score and Stableford points. The round is saved as you go, so it can be resumed. |
| **WHS net-double-bogey cap** | TheGrint, the official handicap apps | The adjusted gross score is worked out per hole from course handicap and stroke index, so the index matches the official method. |
| **Course library** | Every scoring app | Rating, slope, par and stroke index are saved once and reused in both the scorecard and the quick-log form. |
| **GPS shot distance** | Golfshot, Hole19, Arccos | Mark your ball, walk to it, get yards. Uses the phone's GPS with no course maps needed. |
| **Scoring breakdown** | Arccos, Shot Scope | Birdie/par/bogey mix, par-3/4/5 scoring, front vs back nine, and tee-shot miss pattern with advice on where to aim. |
| **Achievements** (15 badges) | 18Birdies, Hole19 | Computed from your data, e.g. Broke 90, Ice Cold (no three-putts) and Habit Formed. They announce themselves as you unlock them. |
| **"Today" card** | Clippd, V1 | Today's scheduled session with a one-tap start that loads the drills into the practice log. |
| **Installable app, works offline** | Native apps | Home-screen icon, full-screen mode, works with no signal on the course, and keeps the screen on during a round. |
| **Visual redesign** | — | Serif display type, a clubhouse colour palette, SVG icons, a bottom tab bar on phones with a raised Play button, bottom-sheet dialogs, motion that respects reduced-motion settings, and automatic dark mode. |

It also fixes bugs from the first version. Every tap re-rendered the page and jumped back to the top. On phones, wide tables overflowed the layout. Charts now redraw once the web font has loaded.

## Recommended next features (by impact)

1. **Accounts and cloud sync** (Supabase). Rounds survive a lost phone and sync between phone and laptop. This is the biggest gap against every competitor.
2. **Course search** from a public course database, auto-filling rating, slope, par and stroke index (GolfCourseAPI or similar) so nobody types a scorecard.
3. **Green front/centre/back yardages** on a satellite map (Hole19, 18Birdies). This needs course geometry: use OpenStreetMap golf features where they exist, or let players drop pins once per course.
4. **Shot-level tracking**: club and distance per shot, turning the GPS measure into a real shot map and true strokes-gained (Arccos, Shot Scope).
5. **9-hole rounds for the handicap** using the 2024 WHS expected-score rule.
6. **AI caddie / coach summary** after each round: a plain-English "what cost you strokes today and what to practise this week" (18Birdies AI caddie, Clippd insights).
7. **Friends and leaderboards**: share a round card image, weekly practice-minutes leaderboard (18Birdies, Garmin).
8. **Apple Watch / Wear OS companion** for the scorecard (Hole19, Garmin).
9. **Swing video capture** with a side-by-side and a drawing tool (V1 Golf). This is heavier and best linked out to at first.
10. **Reminders**: push notifications for scheduled practice sessions (these need the installable app plus a push service).
