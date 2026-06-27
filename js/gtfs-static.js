(function() {
  'use strict';

  var DATA_URL = 'data/static.json.gz';
  var CACHE_KEY = 'rapidkl-static-v7';
  var CACHE_MS = 7 * 24 * 60 * 60 * 1000;

  function loadStaticData() {
    // Try localStorage first
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        var cached = JSON.parse(raw);
        if (cached.t && (Date.now() - cached.t) < CACHE_MS) {
          console.log('[static] LocalStorage cache hit (' + Math.round((Date.now() - cached.t) / 3600000) + 'h old)');
          return Promise.resolve(cached.d);
        }
      }
    } catch (e) {}

    console.log('[static] Fetching data/static.json.gz...');
    return fetch(DATA_URL).then(function(resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return resp.arrayBuffer();
    }).then(function(buf) {
      var decompressed = pako.ungzip(new Uint8Array(buf));
      var text = '';
      for (var i = 0; i < decompressed.length; i++) text += String.fromCharCode(decompressed[i]);
      var data = JSON.parse(text);
      console.log('[static] Loaded: ' + Object.keys(data.R).length + ' routes');

      // Transform short keys back to full names for compatibility
      var routes = {}, stops = {}, trips = {}, shapes = {};
      for (var rid in data.R) {
        routes[rid] = {
          route_id: rid,
          short_name: data.R[rid].sn,
          long_name: data.R[rid].ln
        };
      }
      for (var sid in data.S) {
        stops[sid] = {
          stop_id: sid,
          name: data.S[sid].n,
          lat: data.S[sid].lat,
          lon: data.S[sid].lng
        };
      }
      for (var tid in data.T) {
        var t = data.T[tid];
        trips[tid] = {
          trip_id: tid,
          route_id: t.r,
          shape_id: t.sh,
          direction_id: t.d,
          stop_times: (t.st || []).map(function(st) {
            return { stop_id: st.s, arrival_seconds: st.a, departure_seconds: st.d, sequence: st.seq };
          })
        };
      }
      for (var hid in data.H) {
        shapes[hid] = data.H[hid];
      }

      var frequencies = {};
      if (data.F) {
        for (var rid in data.F) {
          frequencies[rid] = data.F[rid].map(function(f) {
            return {
              start_seconds: f.s,
              end_seconds: f.e,
              headway_secs: f.h,
              exact_times: f.x
            };
          });
        }
      }

      var expanded = { routes: routes, stops: stops, trips: trips, shapes: shapes, frequencies: frequencies, _nameIndex: data.I };

      // Cache in localStorage
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), d: expanded }));
      } catch (e) {
        console.warn('[static] localStorage full, skipping cache');
      }

      return expanded;
    });
  }

  window.RapidKL = window.RapidKL || {};
  window.RapidKL.loadStaticData = loadStaticData;
})();
