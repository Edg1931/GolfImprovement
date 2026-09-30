# Fairway Lab — Golf Improvement Hub

A complete, self-contained golf app for lowering your handicap. You can install it on your phone's home screen, and it works offline on the course. No build step, no server, no accounts: open `index.html` in a browser or deploy it to Vercel. All data is stored in your browser (with JSON export/import for backups).

## What's inside

| Page | What it does |
| --- | --- |
| **Play a round** | Search any course and its rating, slope, par, stroke index and yardages fill in. Choose 18 holes, front 9 or back 9, then score hole by hole with net and Stableford totals, the WHS net-double-bogey cap and GPS shot distance. Nine-hole rounds count toward your index under the 2024 WHS expected-score rule. |
| **Course Map & Caddie** | Satellite hole maps (Esri imagery) with greens, bunkers, water and fairways from OpenStreetMap, or uploaded as GeoJSON/KML, or drawn by hand. Tap a target and the caddie simulates your real shot pattern for every club to recommend the club and aim with the best expected score, with green/water/bunker odds. Build a shot-by-shot plan per hole. |
| **Hole GPS view** | Full-screen satellite view for the course, turned so the hole runs up the screen. Live yardage to the middle, front and back of the green; drag the target to see the distance to it and on to the green, with the club for each and your shot pattern drawn at the target. Track shots, enter your score and move between holes without leaving the map. |
| **Plan from home** | Open any mapped course from the library (⛳ Plan) without starting a round: tap where you'd hit it, add the shot, and the next one starts from where it lands, until you reach the green. Drag the ball anywhere to check distances from there. Plans show on the map and the hole card when you play. |
| **Map any course yourself** | Courses OpenStreetMap doesn't cover can be set up in the hole view from anywhere: search for the course by name, then on the satellite image tap each hole's tee and the middle of its green (and a dogleg bend if it has one). The view turns into the full hole map right away. |
| **Rangefinder** | Map mode: tap anywhere for the GPS distance from you (or between two points) with plays-like from wind and slope. Camera mode: line up the top and bottom of the flagstick; the flag's known height gives the distance, and it can be calibrated once for your phone's lens. |
| **Yardage book** | One printable page per mapped hole: carries over hazards, layup yardages, green depth, your shot plan and tee tip, with room for notes. Print, save as PDF or share as images. |
| **Plan vs what happened** | After a round, each planned hole is compared with the shots tracked; when you changed club off the tee, the caddie simulation says what that choice cost or saved on average. Course-management summary on the Stats page. |
| **Range mode** | Tap where each range ball finished on a target pad (or type it); shots feed your shot pattern at half weight and the session goes into the practice log. |
| **On-course extras** | Flag position of the day (tap it, or stand at it), live wind and ground slope for plays-like yardages and crosswind aim, a strategy tip on each tee from your own miss pattern, automatic move to the next hole (and a score prompt when you walk off a green), a big-number glance mode, and a one-tap download of a course's imagery for offline play. |
| **Strokes gained** | Tracked shots get their lie from the course map; with the first-putt distance (from GPS or one tap) each round splits into off the tee, approach, around the green and putting against your target handicap. Feeds the weekly practice plan. |
| **Shot map** | Every tracked shot of a saved round on the hole map, coloured by strokes gained, with a shareable image of any hole. |
| **Playing partners** | Up to three more players on the scorecard with their own handicap strokes: gross, net, Stableford and net skins. |
| **Club gapping** | Overlaps and gaps in the bag using real on-course distances. |
| **Dispersion learning** | GPS shots on the live scorecard record each club's distance and left/right miss against what you aimed at; My Clubs shows the learned pattern and the caddie uses it. |
| **Dashboard** | Handicap Index, trend chart, progress to target, this week's sessions, top three stroke-loss areas, 12-week program status |
| **Rounds & Handicap** | Log rounds with stats. Calculates score differentials and your Handicap Index using the World Handicap System (best 8 of last 20, with the official table for fewer rounds) |
| **Stats & Stroke Loss** | Compares your averages (putts, GIR, fairways, scrambling, penalties, doubles) to benchmark data for your target handicap and ranks where you lose strokes, with drills for each |
| **Practice Log** | Log sessions and drill scores. Shows practice balance vs the recommended split for your level, streaks, and history |
| **Skills Test** | Nine 10-ball tests (3 ft / 6 ft / lag putts, chips, pitches, bunker, 80 yd wedge, 7-iron, driver) with tier benchmarks, a radar chart, history and targeted drills |
| **Practice Schedule** | Weekly schedules for four handicap tiers × three time budgets, with tick-off tracking per week, plus a 12-week Foundation → Build → Perform program |
| **Drill Library** | 54 drills across putting, chipping, pitching, bunker, irons, driver, on-course games, mental game and fitness. Every drill has setup, steps, a measurable goal and a pro tip. Search, filter, favourite, start a timer or log it |
| **Playbook** | Course strategy, mental game (with an editable pre-shot routine), a 45-minute tournament warm-up, a fitness program, and a glossary |
| **My Clubs** | Carry distances with gap analysis, a club selector that adjusts for wind, elevation and conditions, and a wedge distance matrix |
| **Goals** | Target index and date, required pace, milestones with what each level typically looks like, and a commitments checklist |
| **Tools** | Practice timer, random drill picker, course handicap calculator, Stableford/net calculator, data export/import, demo data |

## Running it

- **Locally:** serve the `public/` folder (for example `cd tests && npm install && node serve.js`, then open http://localhost:4173). Opening `public/index.html` directly also works, minus offline mode and course search.
- **Vercel:** import this repository with Framework Preset **Other** and no build command. Vercel serves `public/` as the site and `api/` as serverless functions.
- **Try it with data:** go to *Tools → Load demo data* to see every page populated.

## Course search setup

Course search uses [GolfCourseAPI](https://golfcourseapi.com) (free tier) through the serverless function in `api/courses.js`, so the key never reaches the browser.

1. Sign up at golfcourseapi.com and copy your API key.
2. In Vercel, open the project, go to **Settings → Environment Variables**, and add `GOLF_COURSE_API_KEY` for Production and Preview.
3. Redeploy.

Without a key, the app still works: courses can be entered by hand and saved to the library.

## Environment variables (Vercel)

| Variable | What it enables |
| --- | --- |
| `GOLF_COURSE_API_KEY` | Course search and auto-fill ([golfcourseapi.com](https://golfcourseapi.com), free tier) |
| `ANTHROPIC_API_KEY` | Optional. Every round already gets a free built-in coach's debrief; with this key, signed-in users can also ask Claude for a deeper one (10 per person per day) |

Accounts, sync and friends use Supabase; the public URL and publishable key are in `public/js/config.js` and every `golf_` table is protected by row-level security.

## Tests

```
cd tests && npm install && npx playwright install chromium
npm test          # API tests (node:test) + browser tests (Playwright, desktop and phone)
```

GitHub Actions runs the same suite on every push (`.github/workflows/tests.yml`).

## Structure

```
public/
  index.html          app shell and navigation
  css/styles.css      design tokens, light/dark themes, responsive layout
  js/data/drills.js   drill library
  js/data/plans.js    tiers, session templates, weekly layouts, 12-week program
  js/data/content.js  benchmarks, skills tests, strategy, mental, warm-up, fitness, glossary
  js/store.js         localStorage persistence and helpers
  js/handicap.js      WHS index maths, stats aggregation, stroke-loss analysis
  js/charts.js        dependency-free canvas charts (line, bar, radar)
  js/views.js         page renderers
  js/app.js           router, actions, forms, timer, demo data
  js/scorecard.js     live scorecard, course library, GPS measure, achievements
  js/caddie.js        caddie engine: dispersion model, shot simulation, club/aim advice
  js/coursemap.js     course map data: OpenStreetMap and file import
  js/planner.js       hole map, shot planner, on-course caddie, dispersion chart
  js/holeview.js      full-screen hole GPS view, glance mode, offline course download
  js/weather.js       live wind and ground height, plays-like maths
  js/sg.js            strokes gained: baselines, shot lies, round and category totals
  js/group.js         playing partners, Stableford and skins
  js/shotmap.js       post-round shot map and share image
  js/finder.js        rangefinder: GPS map and camera flagstick
  js/yardbook.js      printable yardage book
  js/planreview.js    plan vs what happened, course management
  js/range.js         range mode
  api/courses.js      Vercel serverless course-search proxy
  sw.js               offline cache (service worker)
  manifest.webmanifest, icons/   installable-app metadata
```

Plain scripts (no modules or bundler) so the site works from a `file://` URL as well as a web server.

## Notes on the numbers

- Handicap maths follows the WHS: differential = (113 ÷ slope) × (adjusted gross − course rating); index from the standard table (1 best −2 with 3 rounds … best 8 of 20). Course handicap = index × (slope ÷ 113) + (rating − par).
- Benchmarks by handicap are approximate averages drawn from published shot-tracking data. The stroke-loss figures are estimates meant for ranking your focus areas, not a strokes-gained calculation.

See [ROADMAP.md](ROADMAP.md) for a competitor comparison and the recommended next features.
