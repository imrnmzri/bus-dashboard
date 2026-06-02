(function() {
  'use strict';

  var _c = [111,50,56,51,99,100,117,114,109,109,111,102,48,115,100,104,105,104,49,48,115,57,104,101,110,102,102,51,106,108,52,103];
  var SID = '';
  for (var _i = 0; _i < _c.length; _i++) SID += String.fromCharCode(_c[_i]);

  var SOCKET_URL = 'https://rapidbus-socketio-avl.prasarana.com.my';
  var PROVIDER = 'RKL';
  var RELOAD_MS = 5000;

  var socket = null;
  var vehicles = [];
  var reloadTimer = null;
  var emptyCount = 0;
  var connected = false;

  function decompress(base64) {
    var raw = atob(base64);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    var inflated = pako.inflate(bytes);
    var text = '';
    for (var j = 0; j < inflated.length; j++) text += String.fromCharCode(inflated[j]);
    return text;
  }

  function parseVehicles(json) {
    var result = [];
    for (var key in json) {
      var b = json[key];
      if (!b) continue;
      var lat = parseFloat(b.latitude);
      var lng = parseFloat(b.longitude);
      if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) continue;
      result.push({
        id: b.bus_no || key,
        bus_no: b.bus_no || '',
        captain_id: b.captain_id || '',
        route_id: b.route || null,
        route_name: b.route || '',
        direction_id: b.dir === '02' ? 0 : 1,
        dir: b.dir || '',
        lat: lat, lng: lng,
        bearing: parseInt(b.angle) || 0,
        speed: parseInt(b.speed) || 0,
        gps_time: b.dt_gps || '',
        vehicle_label: b.bus_no || '',
        trip_status: b.trip_rev_kind || ''
      });
    }
    return result;
  }

  function onData(raw) {
    try {
      var json = decompress(raw);
      var data = JSON.parse(json);
      var newVehicles = parseVehicles(data);

      if (newVehicles.length === 0 && vehicles.length > 0) {
        emptyCount++;
        if (emptyCount < 3) return;
      } else {
        emptyCount = 0;
      }

      vehicles = newVehicles;

      if (window.RapidKL && window.RapidKL.state) {
        window.RapidKL.state.vehicles = vehicles;
        window.RapidKL.state.lastRefresh = Date.now();
      }
      if (window.RapidKL && window.RapidKL.emit) {
        window.RapidKL.emit('vehicles-updated', vehicles);
      }
    } catch (e) {}
  }

  function emitReload() {
    if (socket) {
      socket.emit('onFts-reload', { sid: SID, uid: '', provider: PROVIDER, route: '' });
    }
  }

  function connect() {
    if (socket && socket.connected) return;

    if (!socket) {
      console.log('[socket] Connecting...');
      socket = io.connect(SOCKET_URL, { transports: ['websocket'] });
    } else if (!socket.connected) {
      console.log('[socket] Reconnecting...');
      socket.connect();
    } else {
      return;
    }

    socket.on('connect', function() {
      console.log('[socket] Connected');
      connected = true;
      emitReload();
      if (reloadTimer) clearInterval(reloadTimer);
      reloadTimer = setInterval(emitReload, RELOAD_MS);
      if (window.RapidKL && window.RapidKL.setStatus) {
        window.RapidKL.setStatus('stat-live', 'ok');
      }
    });

    socket.on('onFts-client', onData);

    socket.on('disconnect', function(reason) {
      console.log('[socket] Disconnected: ' + reason);
      connected = false;
      if (reloadTimer) { clearInterval(reloadTimer); reloadTimer = null; }
      if (window.RapidKL && window.RapidKL.setStatus) {
        window.RapidKL.setStatus('stat-live', 'warn');
      }
    });

    socket.on('reconnect', function(attempt) {
      console.log('[socket] Reconnected #' + attempt);
      connected = true;
      emitReload();
      if (reloadTimer) clearInterval(reloadTimer);
      reloadTimer = setInterval(emitReload, RELOAD_MS);
      if (window.RapidKL && window.RapidKL.setStatus) {
        window.RapidKL.setStatus('stat-live', 'ok');
      }
    });
  }

  function disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    if (reloadTimer) { clearInterval(reloadTimer); reloadTimer = null; }
  }

  function handleVisibility() {
    if (document.hidden) {
      console.log('[socket] Page hidden — disconnecting');
      disconnect();
    } else {
      console.log('[socket] Page visible — connecting');
      connect();
    }
  }

  function fetchVehiclePositions() {
    return new Promise(function(resolve) {
      connect();
      var start = Date.now();
      var wait = setInterval(function() {
        if (vehicles.length > 0 || Date.now() - start > 20000) {
          clearInterval(wait);
          resolve(vehicles);
        }
      }, 300);
    });
  }

  document.addEventListener('visibilitychange', handleVisibility);

  window.RapidKL = window.RapidKL || {};
  window.RapidKL.fetchVehiclePositions = fetchVehiclePositions;
})();
