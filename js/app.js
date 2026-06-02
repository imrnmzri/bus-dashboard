(function() {
  'use strict';

  var state = {
    static: null,
    vehicles: [],
    selectedRouteId: null,
    selectedStopId: null,
    lastRefresh: null,
    errorCount: 0
  };

  var listeners = {};

  function emit(event, data) {
    var cbs = listeners[event] || [];
    for (var i = 0; i < cbs.length; i++) cbs[i](data);
  }

  function on(event, cb) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(cb);
  }

  var TOAST_TIMER = null;
  function showError(msg) {
    var toast = document.getElementById('error-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('visible');
    if (TOAST_TIMER) clearTimeout(TOAST_TIMER);
    TOAST_TIMER = setTimeout(function() { toast.classList.remove('visible'); }, 3000);
  }

  function updateRefreshBadge() {
    var badge = document.getElementById('refresh-badge');
    if (!badge) return;
    if (!state.lastRefresh) { badge.textContent = '\u27F3 --'; return; }
    var elapsed = Math.round((Date.now() - state.lastRefresh) / 1000);
    if (elapsed < 60) { badge.textContent = '\u27F3 ' + elapsed + 's'; }
    else { badge.textContent = '\u27F3 ' + Math.round(elapsed / 60) + 'm'; }
  }

  // ─── Dropdowns ───

  function populateRouteDropdown() {
    var select = document.getElementById('route-select');
    if (!select || !state.static) return;

    var routes = state.static.routes;
    var routeIds = Object.keys(routes).sort(function(a, b) {
      var sa = routes[a].short_name || routes[a].long_name || a;
      var sb = routes[b].short_name || routes[b].long_name || b;
      return sa.localeCompare(sb, undefined, { numeric: true });
    });

    select.innerHTML = '<option value="">Select a bus route</option>';
    for (var i = 0; i < routeIds.length; i++) {
      var r = routes[routeIds[i]];
      var parts = [r.short_name, r.long_name].filter(Boolean);
      var label = parts.length > 0 ? parts.join(' \u00B7 ') : routeIds[i];
      var opt = document.createElement('option');
      opt.value = r.route_id;
      opt.textContent = label;
      select.appendChild(opt);
    }
  }

  function setupRouteDropdown() {
    var select = document.getElementById('route-select');
    if (!select) return;
    select.addEventListener('change', function() {
      var val = select.value || null;
      if (val !== state.selectedRouteId) {
        state.selectedRouteId = val;
        state.selectedStopId = null;
        resetStopDropdown();
        if (val) RapidKL.populateStopDropdown(val);
        emit('route-changed', val);
        RapidKL.Favorites.setLast(val, null);
        renderFavorites();
        RapidKL.updateUI();
      }
    });
  }

  function resetStopDropdown() {
    var select = document.getElementById('stop-select');
    if (!select) return;
    select.innerHTML = '<option value="">First select a route</option>';
    select.disabled = true;
  }

  function setupStopDropdown() {
    var select = document.getElementById('stop-select');
    if (!select) return;
    select.addEventListener('change', function() {
      state.selectedStopId = select.value || null;
      if (state.selectedRouteId) RapidKL.Favorites.setLast(state.selectedRouteId, state.selectedStopId);
      renderFavorites();
      RapidKL.updateUI();
    });
  }

  function selectRouteAndStop(routeId, stopId) {
    var rs = document.getElementById('route-select');
    var ss = document.getElementById('stop-select');
    if (rs) {
      for (var i = 0; i < rs.options.length; i++) {
        if (rs.options[i].value === routeId) { rs.selectedIndex = i; break; }
      }
      state.selectedRouteId = routeId;
      RapidKL.populateStopDropdown(routeId);
      if (ss && stopId) {
        setTimeout(function() {
          for (var j = 0; j < ss.options.length; j++) {
            if (ss.options[j].value === stopId) { ss.selectedIndex = j; break; }
          }
          state.selectedStopId = stopId;
          RapidKL.Favorites.setLast(routeId, stopId);
          renderFavorites();
          RapidKL.updateUI();
          emit('route-changed', routeId);
        }, 100);
      } else {
        state.selectedStopId = null;
        RapidKL.Favorites.setLast(routeId, null);
        renderFavorites();
        RapidKL.updateUI();
        emit('route-changed', routeId);
      }
    }
  }

  // ─── Favorites ───

  function getRouteLabel(routeId) {
    var r = state.static && state.static.routes ? state.static.routes[routeId] : null;
    return r ? (r.short_name || r.long_name || routeId) : routeId;
  }

  function getStopLabel(stopId) {
    var s = state.static && state.static.stops ? state.static.stops[stopId] : null;
    return s ? s.name : stopId;
  }

  function renderFavorites() {
    var container = document.getElementById('favorites-pills');
    if (!container) return;

    var favs = RapidKL.Favorites.getAll();
    container.innerHTML = '';

    for (var i = 0; i < favs.length; i++) {
      var f = favs[i];
      var isActive = state.selectedRouteId === f.rid && (!f.sid || state.selectedStopId === f.sid);

      var pill = document.createElement('span');
      pill.className = 'fav-pill' + (isActive ? ' active' : '');
      pill.innerHTML =
        '<span class="fav-route">' + (f.rl || getRouteLabel(f.rid)) + '</span>' +
        (f.sid ? '<span class="fav-stop">' + (f.sl || getStopLabel(f.sid) || 'All') + '</span>' : '') +
        '<span class="fav-remove" data-rid="' + f.rid + '" data-sid="' + (f.sid || '') + '">\u00D7</span>';

      (function(rid, sid) {
        pill.addEventListener('click', function(e) {
          if (e.target.className.indexOf('fav-remove') !== -1) return;
          selectRouteAndStop(rid, sid || null);
        });
      })(f.rid, f.sid);

      container.appendChild(pill);
    }

    // Remove button handlers
    var removes = container.querySelectorAll('.fav-remove');
    for (var j = 0; j < removes.length; j++) {
      removes[j].addEventListener('click', function(e) {
        e.stopPropagation();
        var rid = this.getAttribute('data-rid');
        var sid = this.getAttribute('data-sid') || null;
        RapidKL.Favorites.remove(rid, sid);
        renderFavorites();
      });
    }
  }

  function setupFavorites() {
    var btn = document.getElementById('fav-add-btn');
    if (btn) {
      btn.addEventListener('click', function() {
        if (!state.selectedRouteId) {
          showError('Select a route first');
          return;
        }
        var rLabel = getRouteLabel(state.selectedRouteId);
        var sLabel = state.selectedStopId ? getStopLabel(state.selectedStopId) : '';
        RapidKL.Favorites.add(state.selectedRouteId, state.selectedStopId, rLabel, sLabel);
        renderFavorites();
      });
    }
  }

  function restoreLastUsed() {
    var last = RapidKL.Favorites.getLast();
    if (last && last.rid && state.static && state.static.routes[last.rid]) {
      selectRouteAndStop(last.rid, last.sid || null);
    }
  }

  // ─── Map helpers ───

  function findRouteShape(routeId) {
    if (!routeId || !state.static || !state.static.trips) return null;
    for (var tid in state.static.trips) {
      if (state.static.trips[tid].route_id === routeId && state.static.trips[tid].shape_id) {
        var shape = state.static.shapes[state.static.trips[tid].shape_id];
        if (shape && shape.length >= 2) return shape;
      }
    }
    return null;
  }

  function updateRouteOnMap(routeId) {
    if (!routeId) { RapidKL.clearRoute(); return; }
    var shape = findRouteShape(routeId);
    if (shape) { RapidKL.drawRoute(shape); } else { RapidKL.clearRoute(); }
  }

  function resolveVehicleRoutes() {
    var vehicles = state.vehicles;
    var st = state.static;
    if (!vehicles || !st || !st.routes) return;

    var nameIdx = st._nameIndex;
    if (!nameIdx) {
      nameIdx = {};
      for (var rid in st.routes) {
        var r = st.routes[rid];
        nameIdx[rid] = rid;
        if (r.short_name) { nameIdx[r.short_name] = rid; nameIdx[r.short_name.toUpperCase()] = rid; }
        if (r.long_name) { nameIdx[r.long_name] = rid; nameIdx[r.long_name.toUpperCase()] = rid; }
      }
      st._nameIndex = nameIdx;
    }

    for (var i = 0; i < vehicles.length; i++) {
      var v = vehicles[i];
      if (v._resolved) continue;
      var rid = v.route_id;
      if (!rid) { v._resolved = true; continue; }
      if (st.routes[rid]) { v._resolved = true; continue; }
      var via = nameIdx[rid] || nameIdx[rid.toUpperCase()];
      if (via && st.routes[via]) { v.route_id = via; v._resolved = true; continue; }
      if (rid.length > 1 && /[0-9]$/.test(rid)) {
        var stripped = rid.slice(0, -1);
        if (st.routes[stripped]) { v.route_id = stripped; v._resolved = true; continue; }
        var via2 = nameIdx[stripped] || nameIdx[stripped.toUpperCase()];
        if (via2 && st.routes[via2]) { v.route_id = via2; v._resolved = true; continue; }
      }
      v._resolved = true;
    }
  }

  function refreshAll() {
    resolveVehicleRoutes();
    RapidKL.updateBuses(state.vehicles, state.selectedRouteId);
    RapidKL.updateUI();
  }

  // ─── Init ───

  function init() {
    try {
      console.log('[app] v7');
      RapidKL.showLoading(true, 'Loading data...');
      updateRefreshBadge();
      setInterval(updateRefreshBadge, 1000);

      var loadTimeout = setTimeout(function() {
        RapidKL.showLoading(false);
        showError('Load timed out — check connection');
      }, 30000);

      on('route-changed', function(routeId) {
        updateRouteOnMap(routeId);
      });

      on('vehicles-updated', function() {
        refreshAll();
      });

      setupRouteDropdown();
      setupStopDropdown();
      setupFavorites();

      RapidKL.loadStaticData().then(function(data) {
        clearTimeout(loadTimeout);
        state.static = data;
        console.log('[app] ' + Object.keys(data.routes).length + ' routes');

        RapidKL.initMap();
        populateRouteDropdown();
        renderFavorites();
        restoreLastUsed();

        RapidKL.startUI();

        RapidKL.fetchVehiclePositions().then(function(vehicles) {
          state.vehicles = vehicles;
          state.lastRefresh = Date.now();
          RapidKL.showLoading(false);
          refreshAll();
          emit('ready', state);
        });
      }).catch(function(err) {
        clearTimeout(loadTimeout);
        RapidKL.showLoading(false);
        showError('Load failed: ' + (err.message || 'Unknown'));
      });
    } catch (e) {
      RapidKL.showLoading(false);
      showError('Startup error: ' + e.message);
    }
  }

  window.RapidKL = window.RapidKL || {};
  window.RapidKL.state = state;
  window.RapidKL.on = on;
  window.RapidKL.emit = emit;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
