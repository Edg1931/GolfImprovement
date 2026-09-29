/* Course search proxy for GolfCourseAPI (https://golfcourseapi.com).
   Runs as a Vercel serverless function so the API key stays on the server.
     GET /api/courses?q=pebble   -> { courses: [Course] }
     GET /api/courses?id=12345   -> { course: Course }
   Set the GOLF_COURSE_API_KEY environment variable in the Vercel project. */

const UPSTREAM = 'https://api.golfcourseapi.com/v1';

const numOrNull = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };

function normalizeTee(t, gender) {
  const holes = Array.isArray(t.holes) ? t.holes : [];
  return {
    name: t.tee_name || 'Tees',
    gender,
    rating: numOrNull(t.course_rating),
    slope: numOrNull(t.slope_rating),
    frontRating: numOrNull(t.front_course_rating),
    frontSlope: numOrNull(t.front_slope_rating),
    backRating: numOrNull(t.back_course_rating),
    backSlope: numOrNull(t.back_slope_rating),
    yards: numOrNull(t.total_yards),
    par: numOrNull(t.par_total),
    holesCount: numOrNull(t.number_of_holes) || holes.length || null,
    holes: holes.map(h => ({ par: numOrNull(h.par), yards: numOrNull(h.yardage), si: numOrNull(h.handicap) })),
  };
}

function normalizeCourse(c) {
  const club = (c.club_name || '').trim(), course = (c.course_name || '').trim();
  const name = !course || course === club ? club || course : (club ? `${club} – ${course}` : course);
  const loc = c.location || {};
  const tees = [];
  const t = c.tees || {};
  (t.male || []).forEach(x => tees.push(normalizeTee(x, 'M')));
  (t.female || []).forEach(x => tees.push(normalizeTee(x, 'F')));
  return { id: c.id, name, city: loc.city || '', state: loc.state || '', country: loc.country || '', tees: tees.filter(x => x.holes.length) };
}

async function upstream(path, key) {
  const r = await fetch(UPSTREAM + path, { headers: { Authorization: 'Key ' + key, Accept: 'application/json' } });
  const text = await r.text();
  if (!r.ok) {
    // logged for Vercel runtime logs; never includes the key
    console.error('GolfCourseAPI error', r.status, path.split('?')[0], text.slice(0, 300));
    const e = new Error('upstream ' + r.status); e.status = r.status; throw e;
  }
  try { return JSON.parse(text); } catch (err) { console.error('GolfCourseAPI returned non-JSON', r.status, text.slice(0, 300)); throw err; }
}

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  // tolerate a key pasted with spaces, line breaks or surrounding quotes
  const key = (process.env.GOLF_COURSE_API_KEY || '').trim().replace(/^["']|["']$/g, '');
  if (!key) { res.statusCode = 501; res.end(JSON.stringify({ error: 'not_configured' })); return; }
  const url = new URL(req.url, 'http://x');
  const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
  const id = (url.searchParams.get('id') || '').replace(/\D/g, '');
  try {
    let body;
    if (id) {
      const data = await upstream('/courses/' + id, key);
      body = { course: normalizeCourse(data.course || data) };
    } else if (q.length >= 3) {
      const data = await upstream('/search?search_query=' + encodeURIComponent(q), key);
      body = { courses: (data.courses || []).slice(0, 20).map(normalizeCourse) };
    } else {
      res.statusCode = 400; res.end(JSON.stringify({ error: 'query_too_short' })); return;
    }
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');   // course data rarely changes
    res.statusCode = 200; res.end(JSON.stringify(body));
  } catch (e) {
    if (!e.status) console.error('Course search failed', e.name, e.message);
    res.statusCode = e.status === 401 || e.status === 403 ? 502 : e.status === 429 ? 429 : 502;
    res.end(JSON.stringify({ error: e.status === 429 ? 'rate_limited' : e.status === 401 || e.status === 403 ? 'bad_key' : 'upstream_error' }));
  }
}

module.exports = handler;
module.exports.normalizeCourse = normalizeCourse;
