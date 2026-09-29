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
| **Course search and auto-fill** | 18Birdies, Golfshot, TheGrint | Search GolfCourseAPI, pick a tee, and rating, slope, par, stroke index, yardages and front/back-nine ratings fill in automatically. |
| **9 or 18 holes** | TheGrint, the official handicap apps | Front or back nine, or 9-hole courses. Nine-hole scores become 18-hole differentials using the 2024 WHS expected-score rule. |
| **Visual redesign** | — | Serif display type, a clubhouse colour palette, SVG icons, a bottom tab bar on phones with a raised Play button, bottom-sheet dialogs, motion that respects reduced-motion settings, and automatic dark mode. |

It also fixes bugs from the first version. Every tap re-rendered the page and jumped back to the top. On phones, wide tables overflowed the layout. Charts now redraw once the web font has loaded.

## Added since: the full improvement list

| Feature | Notes |
| --- | --- |
| **Accounts and cloud sync** | Supabase email sign-in. The whole app state syncs per user and merges between devices, with deletions tracked. Works offline and syncs when back online. |
| **Edit saved rounds** | Hole-by-hole rounds reopen in the scorecard; quick-logged rounds get an edit form; notes on the live card. |
| **Day-one onboarding** | Enter your current handicap, target and practice time on first launch. The starting index is used until 3 scores exist. |
| **Drill progress** | Drills are scored as numbers (for example "14/20", "21 strokes"), with trend charts, personal-best alerts and a progress list. |
| **Adaptive weekly plan** | The plan swaps drills toward your two biggest stroke-loss areas (or your weakest Skills Test areas). It can be switched off. |
| **AI round debrief** | Claude writes a short coaching summary for signed-in users, capped at 10 a day per person. |
| **WHS caps** | Soft and hard caps against the Low Handicap Index once 20 scores exist. |
| **Green yardages** | Save the front, middle and back of each green once per course with GPS; live distances as you walk. |
| **Club per shot** | GPS shots are tagged with a club, and My Clubs shows your real on-course distances. |
| **Share cards** | Round and achievement images for the phone's share sheet. |
| **Practice reminders** | Add the weekly plan to any calendar app with 30-minute alerts. |
| **Friends and leaderboards** | Two-way friend codes; weekly practice, handicap, best score and rounds played. |
| **Course map and caddie** | Satellite hole maps from OpenStreetMap, GeoJSON/KML upload or hand drawing; a shot planner that simulates your real dispersion to pick club and aim by expected strokes; caddie tips on the live scorecard. |
| **Dispersion learning** | GPS shots record distance and left/right miss per club; My Clubs charts the pattern. |
| **Automated tests** | API and browser tests on desktop and phone sizes, run by GitHub Actions on every push. |

## Recommended next features (by impact)

1. **Full shot tracking and strokes gained** (Arccos, Shot Scope): record every shot's start, end and lie to compute true strokes gained rather than estimates.
2. **Real push notifications**: needs a push service (VAPID keys and a scheduled function). On iPhone they only work for the installed Home Screen app.
3. **Apple Watch / Wear OS companion** for the scorecard (Hole19, Garmin).
4. **Swing video capture** with a side-by-side and a drawing tool (V1 Golf). This is heavier and best linked out to at first.
5. **Groups and events**: a shared scorecard for a four-ball and simple season-long competitions on top of the friends system.
