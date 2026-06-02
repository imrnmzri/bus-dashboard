(function() {
  'use strict';

  var map = null;
  var routeLayer = null;
  var busLayer = null;
  var currentShapeBounds = null;

  function initMap() {
    if (map) return;

    map = L.map('map', {
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true
    }).setView([3.139, 101.6869], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);

    routeLayer = L.layerGroup().addTo(map);
    busLayer = L.layerGroup().addTo(map);

    console.log('[map] Ready');
  }

  function drawRoute(shapePoints) {
    routeLayer.clearLayers();
    currentShapeBounds = null;
    if (!shapePoints || shapePoints.length < 2) return;

    var latlngs = [];
    for (var i = 0; i < shapePoints.length; i++) {
      latlngs.push([shapePoints[i].lat, shapePoints[i].lng]);
    }

    var line = L.polyline(latlngs, {
      color: '#2563eb',
      weight: 3.5,
      opacity: 0.85,
      smoothFactor: 1,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(routeLayer);

    L.circleMarker(latlngs[0], { radius: 5, color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.9, weight: 0 }).addTo(routeLayer);
    L.circleMarker(latlngs[latlngs.length - 1], { radius: 5, color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.9, weight: 0 }).addTo(routeLayer);

    currentShapeBounds = line.getBounds();
    map.fitBounds(currentShapeBounds, { padding: [50, 50], maxZoom: 15 });
  }

  function clearRoute() {
    routeLayer.clearLayers();
    currentShapeBounds = null;
    map.setView([3.139, 101.6869], 13);
  }

  function updateBuses(vehicles, selectedRouteId) {
    busLayer.clearLayers();

    var filtered = vehicles;
    if (selectedRouteId) {
      filtered = [];
      for (var i = 0; i < vehicles.length; i++) {
        if (vehicles[i].route_id === selectedRouteId) {
          filtered.push(vehicles[i]);
        }
      }
    }

    for (var j = 0; j < filtered.length; j++) {
      var v = filtered[j];
      var latlng = [v.lat, v.lng];
      if (latlng[0] === 0 && latlng[1] === 0) continue;

      var rotation = v.bearing || 0;
      var html = '<div class="bus-marker-inner" style="transform:rotate(' + rotation + 'deg)">' +
        '<svg width="32" height="32" viewBox="0 0 32 32">' +
        '<circle cx="16" cy="16" r="11" fill="white" stroke="#2563eb" stroke-width="2.5"/>' +
        '<polygon points="16,8 20,16 16,14 12,16" fill="#2563eb"/>' +
        '</svg></div>';

      var popupContent = '<div class="bus-popup">' +
        '<strong>' + (v.bus_no || v.vehicle_label || '') + '</strong>' +
        '<br>GPS: ' + (v.gps_time || '--') +
        '<br>Speed: ' + (v.speed || 0) + ' km/h' +
        '</div>';

      L.marker(latlng, {
        icon: L.divIcon({ className: 'bus-marker-icon', html: html, iconSize: [32, 32], iconAnchor: [16, 16] }),
        zIndexOffset: 1000
      }).bindPopup(popupContent, { className: 'bus-popup-wrapper', closeButton: false, offset: [0, -16] })
        .addTo(busLayer);
    }
  }

  window.RapidKL = window.RapidKL || {};
  window.RapidKL.initMap = initMap;
  window.RapidKL.drawRoute = drawRoute;
  window.RapidKL.clearRoute = clearRoute;
  window.RapidKL.updateBuses = updateBuses;
})();
