(function() {
  'use strict';

  var updateInterval = null;

  function el(id) { return document.getElementById(id); }

  function setStatus(id, state) {
    var dot = el(id);
    if (!dot) return;
    dot.className = 'status-dot ' + state;
  }

  function showLoading(show, text) {
    var overlay = el('loading-overlay');
    var label = el('loading-text');
    if (overlay) overlay.className = 'loading-overlay' + (show ? ' visible' : '');
    if (label && text) label.textContent = text;
  }

  function populateStopDropdown(routeId) {
    var select = el('stop-select');
    if (!select) return;

    var state = RapidKL.state;
    if (!state.static || !routeId) {
      select.innerHTML = '<option value="">First select a route</option>';
      select.disabled = true;
      return;
    }

    var stops = RapidKL.getStopsForRoute(routeId, state.static);
    select.disabled = false;
    select.innerHTML = '<option value="">All stops (' + stops.length + ')</option>';

    for (var i = 0; i < stops.length; i++) {
      var opt = document.createElement('option');
      opt.value = stops[i].stop_id;
      opt.textContent = stops[i].name;
      select.appendChild(opt);
    }
  }

  function renderStopProgress(stops, selectedStopId, bestBusDistance, stopDistances) {
    var html = '';
    if (!stops || stops.length === 0) return '';

    for (var i = 0; i < stops.length; i++) {
      var sid = stops[i].stop_id;
      var sd = stopDistances[sid];

      var cls = 'progress-dot';
      if (sid === selectedStopId) cls += ' selected';
      if (bestBusDistance !== null && sd !== undefined && sd <= bestBusDistance) {
        cls += ' passed';
      }

      html += '<span class="' + cls + '" title="' + (stops[i].name || sid) + '"></span>';
    }

    return html;
  }

  function updateBottomBar(nextStop, staticData) {
    var state = RapidKL.state;

    if (!state.static) {
      setStatus('stat-static', 'fail');
      setStatus('stat-live', 'fail');
      setStatus('stat-match', 'fail');
      el('stop-name').textContent = 'Loading schedule...';
      el('eta-text').textContent = '-- min';
      el('eta-text').className = 'live';
      el('bus-count').textContent = '';
      el('stop-progress').innerHTML = '';
      return;
    }

    setStatus('stat-static', 'ok');
    setStatus('stat-live', state.vehicles && state.vehicles.length > 0 ? 'ok' : 'warn');

    var routeId = state.selectedRouteId;
    var stopId = state.selectedStopId || null;

    if (!routeId) {
      el('stop-name').textContent = 'Select a route to begin';
      el('eta-text').textContent = '-- min';
      el('eta-text').className = 'live';
      el('bus-count').textContent = '';
      el('stop-progress').innerHTML = '';
      return;
    }

    var stops = RapidKL.getStopsForRoute(routeId, staticData, stopId || undefined);
    var stopDistances = RapidKL.getAllStopDistances(routeId, staticData, stopId || undefined);
    var bestBusDistance = null;

    if (nextStop && !nextStop.isProjected) {
      bestBusDistance = nextStop.bestBusDistance !== undefined ? nextStop.bestBusDistance : null;
    }

    el('stop-progress').innerHTML = renderStopProgress(stops, stopId, bestBusDistance, stopDistances);

    if (!nextStop || !nextStop.arrivalSeconds) {
      el('stop-name').textContent = stopId ? (nextStop && nextStop.stopName ? nextStop.stopName : 'No schedule') : 'Select a stop';
      el('eta-text').textContent = '-- min';
      el('eta-text').className = nextStop && nextStop.isProjected ? '' : 'live';
      el('bus-count').textContent = '';
      setStatus('stat-match', 'warn');
      return;
    }

    var mins = RapidKL.getTimeUntil(nextStop);
    el('stop-name').textContent = nextStop.stopName || '';

    if (mins === 0) {
      el('eta-text').textContent = 'NOW';
    } else if (mins < 60) {
      el('eta-text').textContent = '~' + mins + ' min';
    } else {
      el('eta-text').textContent = '~' + Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
    }

    el('eta-text').className = nextStop.isProjected ? '' : 'live';

    setStatus('stat-match', nextStop.arrivalSeconds > 0 ? 'ok' : 'warn');

    if (nextStop.busCount > 0) {
      el('bus-count').textContent = nextStop.busCount + ' bus' + (nextStop.busCount !== 1 ? 'es' : '');
    } else {
      el('bus-count').textContent = '';
    }
  }

  function updateUI() {
    var state = RapidKL.state;
    if (!state.static) {
      updateBottomBar(null, null);
      return;
    }

    var routeId = state.selectedRouteId;
    var stopId = state.selectedStopId || null;

    if (!routeId) {
      updateBottomBar(null, state.static);
      return;
    }

    var nextStop = RapidKL.getNextStop(routeId, stopId, state.vehicles, state.static);
    updateBottomBar(nextStop, state.static);
  }

  function startUI() {
    updateUI();
    if (updateInterval) clearInterval(updateInterval);
    updateInterval = setInterval(updateUI, 5000);
    el('loading-overlay').className = 'loading-overlay';
  }

  window.RapidKL = window.RapidKL || {};
  window.RapidKL.updateUI = updateUI;
  window.RapidKL.startUI = startUI;
  window.RapidKL.populateStopDropdown = populateStopDropdown;
  window.RapidKL.showLoading = showLoading;
  window.RapidKL.setStatus = setStatus;
})();
