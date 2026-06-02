var CACHE = 'rapidkl-v7';

self.addEventListener('install', function() { self.skipWaiting(); });

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
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
