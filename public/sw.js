/* Offline support: app shell is cached on install; everything else is served
   network-first and cached as it is fetched, so the app works on the course with no signal. */
const CACHE = 'fairwaylab-v12';
const TILES = 'fairwaylab-tiles';   // satellite imagery: kept across app updates
const SHELL = [
  './', 'index.html', 'css/styles.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'js/data/drills.js', 'js/data/plans.js', 'js/data/content.js', 'js/store.js', 'js/handicap.js',
  'js/charts.js', 'js/views.js', 'js/app.js', 'js/scorecard.js', 'js/config.js', 'js/cloud.js', 'js/social.js', 'js/share.js', 'js/coach.js', 'js/caddie.js', 'js/coursemap.js', 'js/planner.js', 'js/holeview.js', 'js/weather.js', 'js/sg.js', 'js/group.js', 'js/shotmap.js', 'js/range.js', 'js/planreview.js', 'js/yardbook.js', 'js/finder.js', 'js/vendor/leaflet/leaflet.js', 'js/vendor/leaflet/leaflet.css', 'js/vendor/supabase.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== TILES).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) return;   // live data only
  // satellite tiles you've viewed are kept, so a course map you looked at works without signal
  const cacheable = url.origin === location.origin || url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com') || url.hostname === 'server.arcgisonline.com';
  if (!cacheable) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(url.hostname === 'server.arcgisonline.com' ? TILES : CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('index.html')))
  );
});
