var CACHE = 'rapidkl-v9';

// Assets to pre-cache on install
var PRECACHE = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js?v=9',
  '/js/gtfs-static.js?v=9',
  '/js/favorites.js?v=9',
  '/js/live-socket.js?v=9',
  '/js/scheduler.js?v=9',
  '/js/map.js?v=9',
  '/js/ui.js?v=9',
  '/assets/icon-180.png',
  '/assets/icon-512.png',
  '/data/static.json.gz'
];

// Patterns that should NEVER be cached (live data, sockets, etc.)
var NO_CACHE = [
  'rapidbus-socketio-avl',
  'socket.io'
];

function shouldSkipCache(url) {
  for (var i = 0; i < NO_CACHE.length; i++) {
    if (url.indexOf(NO_CACHE[i]) !== -1) return true;
  }
  return false;
}

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return Promise.allSettled(PRECACHE.map(function(url) {
        return fetch(url, { mode: 'no-cors' }).then(function(resp) {
          if (resp.ok) cache.put(url, resp);
        }).catch(function() {});
      }));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
          .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;

  var url = e.request.url;

  // Never cache live socket or data-stream requests
  if (shouldSkipCache(url)) {
    return; // let browser handle normally
  }

  e.respondWith(
    fetch(e.request).then(function(net) {
      if (net.ok) {
        var clone = net.clone();
        caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
      }
      return net;
    }).catch(function() {
      return caches.match(e.request);
    })
  );
});
