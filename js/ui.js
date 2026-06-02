(function() {
  'use strict';

  var updateInterval = null;

  function el(id) { return document.getElementById(id); }

  function setStatus(id, state) {
    var dot = el(id);
    if (!dot) return;
    dot.className = 'status-dot ' + state;
  }

  function showEmptyState(show) {
    var empty = el('empty-state');
    var clock = el('clock-panel');
    var info = el('stop-info');
    if (empty) empty.style.display = show ? '' : 'none';
    if (clock) clock.style.display = show ? 'none' : '';
    if (info) info.style.display = show ? 'none' : '';
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

  function updateClock(nextStop) {
    var state = RapidKL.state;

    if (!state.static) {
      setStatus('stat-static', 'fail');
      setStatus('stat-live', 'fail');
      setStatus('stat-match', 'fail');
      showEmptyState(true);
      el('empty-state').querySelector('.label').textContent = 'Loading schedule...';
      return;
    }
    setStatus('stat-static', 'ok');
    setStatus('stat-live', state.vehicles && state.vehicles.length > 0 ? 'ok' : 'warn');

    if (!state.selectedRouteId) {
      showEmptyState(true);
      el('empty-state').querySelector('.label').textContent = 'Select a route to begin';
      return;
    }

    if (!nextStop) {
      showEmptyState(true);
      el('empty-state').querySelector('.label').textContent = 'No schedule available';
      return;
    }

    showEmptyState(false);

    var timeEl = el('clock-time');
    var ampmEl = el('clock-ampm');
    var badgeEl = el('clock-badge');
    var badgeText = badgeEl ? badgeEl.querySelector('.badge-text') : null;

    var mins = RapidKL.getTimeUntil(nextStop);
    if (timeEl && mins >= 0) {
      if (mins === 0) {
        timeEl.textContent = 'NOW';
        timeEl.style.fontSize = '52px';
      } else {
        timeEl.textContent = mins;
        timeEl.style.fontSize = '';
      }
    }
    if (ampmEl) ampmEl.textContent = mins === 0 ? '' : 'min';

    if (badgeEl) badgeEl.className = nextStop.isProjected ? 'clock-badge' : 'clock-badge live';
    if (badgeText) badgeText.textContent = nextStop.isProjected ? 'Scheduled' : '\u25CF Live';

    setStatus('stat-match', nextStop.arrivalSeconds > 0 ? 'ok' : 'warn');

    var stopNameEl = el('stop-name');
    if (stopNameEl) stopNameEl.textContent = nextStop.stopName || '';

    var distanceEl = el('stop-distance');
    if (distanceEl) {
      if (!nextStop.isProjected && nextStop.vehicleLabel) {
        distanceEl.textContent = 'Bus ' + nextStop.vehicleLabel + ' approaching';
      } else if (nextStop.isProjected && nextStop.arrivalSeconds > 0) {
        if (mins >= 60) {
          distanceEl.textContent = 'in ~' + Math.floor(mins/60) + 'h ' + (mins%60) + 'm';
        } else {
          distanceEl.textContent = 'in ~' + mins + ' min';
        }
      } else {
        distanceEl.textContent = '';
      }
    }

    var busCountEl = el('bus-count');
    if (busCountEl && nextStop.busCount > 0) {
      busCountEl.textContent = nextStop.busCount + ' bus' + (nextStop.busCount !== 1 ? 'es' : '') + ' active';
    } else if (busCountEl) {
      busCountEl.textContent = '';
    }
  }

  function updateUI() {
    var state = RapidKL.state;
    if (!state.static) {
      updateClock(null);
      return;
    }

    var routeId = state.selectedRouteId;
    var stopId = state.selectedStopId || null;

    if (!routeId) {
      updateClock(null);
      return;
    }

    var nextStop = RapidKL.getNextStop(routeId, stopId, state.vehicles, state.static);
    updateClock(nextStop);
  }

  function startUI() {
    updateUI();
    if (updateInterval) clearInterval(updateInterval);
    updateInterval = setInterval(updateUI, 5000);
    el('loading-overlay').className = 'loading-overlay';
  }

  function showLoading(show, text) {
    var overlay = el('loading-overlay');
    var label = el('loading-text');
    if (overlay) overlay.className = 'loading-overlay' + (show ? ' visible' : '');
    if (label && text) label.textContent = text;
  }

  window.RapidKL = window.RapidKL || {};
  window.RapidKL.updateUI = updateUI;
  window.RapidKL.startUI = startUI;
  window.RapidKL.populateStopDropdown = populateStopDropdown;
  window.RapidKL.showEmptyState = showEmptyState;
  window.RapidKL.showLoading = showLoading;
  window.RapidKL.setStatus = setStatus;
})();
