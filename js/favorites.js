(function() {
  'use strict';

  var STORAGE_KEY = 'rapidkl-favorites';
  var LAST_KEY = 'rapidkl-last';
  var MAX = 8;

  function getAll() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch (e) { return []; }
  }

  function saveAll(list) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch (e) {}
  }

  function add(routeId, stopId, routeLabel, stopLabel) {
    var list = getAll();
    // Remove if already exists
    list = list.filter(function(f) { return !(f.rid === routeId && f.sid === stopId); });
    list.unshift({ rid: routeId, sid: stopId, rl: routeLabel, sl: stopLabel || routeId });
    if (list.length > MAX) list = list.slice(0, MAX);
    saveAll(list);
    return list;
  }

  function remove(routeId, stopId) {
    var list = getAll().filter(function(f) { return !(f.rid === routeId && f.sid === stopId); });
    saveAll(list);
    return list;
  }

  function getLast() {
    try { return JSON.parse(localStorage.getItem(LAST_KEY)); } catch (e) { return null; }
  }

  function setLast(routeId, stopId) {
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ rid: routeId, sid: stopId })); } catch (e) {}
  }

  window.RapidKL = window.RapidKL || {};
  window.RapidKL.Favorites = { getAll: getAll, add: add, remove: remove, getLast: getLast, setLast: setLast };
})();
