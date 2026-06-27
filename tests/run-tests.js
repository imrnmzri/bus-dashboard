#!/usr/bin/env node
/**
 * Test runner for RapidKL Bus Dashboard
 *
 * Usage: node tests/run-tests.js
 */

var fs = require('fs');
var path = require('path');

// ─── Polyfill browser globals ───

global.window = global;
global.document = {
  readyState: 'complete',
  addEventListener: function() {},
  removeEventListener: function() {},
  getElementById: function() { return null; },
  createElement: function() { return {}; },
  hidden: false
};
global.navigator = { serviceWorker: undefined };
global.localStorage = {
  _data: {},
  getItem: function(k) { return this._data[k] || null; },
  setItem: function(k, v) { this._data[k] = v; },
  removeItem: function(k) { delete this._data[k]; }
};
global.atob = function(s) { return Buffer.from(s, 'base64').toString('binary'); };
global.btoa = function(s) { return Buffer.from(s, 'binary').toString('base64'); };
global.setTimeout = setTimeout;
global.clearTimeout = clearTimeout;
global.setInterval = function() { return 0; };
global.clearInterval = function() {};
global.console = console;
global.pako = null;
global.io = { connect: function() { return { on: function(){}, emit: function(){}, disconnect: function(){} }; } };

// ─── Load source files ───

var jsDir = path.join(__dirname, '..', 'js');
var files = ['gtfs-static.js', 'favorites.js', 'live-socket.js', 'scheduler.js', 'map.js', 'ui.js', 'app.js'];

files.forEach(function(f) {
  var code = fs.readFileSync(path.join(jsDir, f), 'utf8');
  try { eval(code); } catch (e) {
    console.warn('Warning: ' + f + ' failed: ' + e.message);
  }
});

// ─── Test framework ───

var passed = 0, failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; }
  else { failed++; console.error('  FAIL: ' + msg); }
}

function assertEqual(actual, expected, msg) {
  if (actual === expected) { passed++; }
  else { failed++; console.error('  FAIL: ' + msg + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual)); }
}

// ─── Haversine distance (inline for direct testing) ───

function haversine(lat1, lon1, lat2, lon2) {
  var R = 6371;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLon = (lon2 - lon1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

console.log('=== Haversine distance ===\n');

// Same point = 0
var d0 = haversine(3.139, 101.6869, 3.139, 101.6869);
assert(d0 === 0, 'same point → 0 km');

// ~111 km per degree lat at equator
var dLat = haversine(3.0, 101.0, 4.0, 101.0);
assert(dLat > 110 && dLat < 112, '1° lat ≈ 111 km');

// KLCC to KL Sentral ≈ 3.8 km
var dKL = haversine(3.1579, 101.7119, 3.1340, 101.6860);
assert(dKL > 3.5 && dKL < 4.2, 'KLCC → KL Sentral ≈ 3.8 km');

console.log('  (' + passed + ' passed)\n');

// ─── Shape / stop distance caching ───

console.log('=== getAllStopDistances caching ===\n');

var R = global.RapidKL;

var staticData = {
  trips: {
    't1': {
      route_id: 'R1',
      shape_id: 'shape1',
      stop_times: [
        { stop_id: 'S1', arrival_seconds: 0, sequence: 1 },
        { stop_id: 'S2', arrival_seconds: 300, sequence: 2 },
        { stop_id: 'S3', arrival_seconds: 600, sequence: 3 }
      ]
    }
  },
  shapes: {
    'shape1': [
      { lat: 3.1390, lng: 101.6869 },
      { lat: 3.1400, lng: 101.6870 },
      { lat: 3.1410, lng: 101.6871 }
    ]
  },
  stops: {
    'S1': { name: 'Stop 1', lat: 3.1390, lon: 101.6869 },
    'S2': { name: 'Stop 2', lat: 3.1405, lon: 101.6870 },
    'S3': { name: 'Stop 3', lat: 3.1410, lon: 101.6871 }
  },
  routes: { 'R1': { route_id: 'R1', short_name: 'R1' } }
};

// Clear caches from any previous load
delete staticData._shapeCache;
delete staticData._stopDistCache;
delete staticData._allStopDistCache;

var d1 = R.getAllStopDistances('R1', staticData, 'S3');
assert(typeof d1 === 'object' && !Array.isArray(d1), 'returns object');
assert(Object.keys(d1).length > 0, 'has entries');

var d2 = R.getAllStopDistances('R1', staticData, 'S3');
assert(d1 === d2, 'second call returns cached (same ref)');

// Different stopId = different cache key
var d3 = R.getAllStopDistances('R1', staticData, 'S2');
assert(d1 !== d3, 'different stopId → different cached result');

// Unknown route
var d4 = R.getAllStopDistances('ZZZ', staticData, 'S1');
assertEqual(Object.keys(d4).length, 0, 'unknown route → empty');

console.log('  (' + passed + ' passed)\n');

// ─── getStopsForRoute ───

console.log('=== getStopsForRoute ===\n');

var sd2 = {
  trips: {
    't1': { route_id: 'R1', stop_times: [
      { stop_id: 'A', arrival_seconds: 0, sequence: 1 },
      { stop_id: 'B', arrival_seconds: 100, sequence: 2 }
    ]},
    't2': { route_id: 'R1', stop_times: [
      { stop_id: 'A', arrival_seconds: 0, sequence: 1 },
      { stop_id: 'C', arrival_seconds: 200, sequence: 2 },
      { stop_id: 'D', arrival_seconds: 300, sequence: 3 }
    ]}
  },
  stops: {
    'A': { name: 'A', lat: 3.0, lon: 101.0 },
    'B': { name: 'B', lat: 3.1, lon: 101.1 },
    'C': { name: 'C', lat: 3.2, lon: 101.2 },
    'D': { name: 'D', lat: 3.3, lon: 101.3 }
  }
};

var stops = R.getStopsForRoute('R1', sd2);
assertEqual(stops.length, 2, 'first trip has 2 stops');

// If we pass a stopId, it picks the trip containing that stop
var stopsC = R.getStopsForRoute('R1', sd2, 'C');
assertEqual(stopsC.length, 3, 'trip with C has 3 stops');

var stopsEmpty = R.getStopsForRoute('UNKNOWN', sd2);
assertEqual(stopsEmpty.length, 0, 'unknown route → empty');

console.log('  (' + passed + ' passed)\n');

// ─── getNextStop (schedule fallback) ───

console.log('=== getNextStop (schedule) ===\n');

var sd3 = {
  trips: {
    't1': {
      route_id: 'R1',
      stop_times: [
        { stop_id: 'S1', arrival_seconds: 28800 },
        { stop_id: 'S2', arrival_seconds: 32400 }
      ]
    }
  },
  stops: {
    'S1': { name: 'Station', lat: 3.139, lon: 101.6869 },
    'S2': { name: 'Mall', lat: 3.140, lon: 101.6870 }
  },
  routes: { 'R1': { route_id: 'R1', short_name: 'R1' } },
  shapes: {}
};

var r1 = R.getNextStop('R1', 'S1', [], sd3);
assert(r1 !== null, 'returns result');
assert(r1.isProjected === true, 'schedule ETA is marked projected');

var rNone = R.getNextStop(null, 'S1', [], sd3);
assert(rNone === null, 'null for no route selected');

console.log('  (' + passed + ' passed)\n');

// ─── Live ETA: idle bus detection ───

console.log('=== Live ETA: idle bus at terminal ===\n');

// Build a simple straight-line shape with 3 stops
// Shape goes: A(0,0) → B(0.01,0) → C(0.02,0) — roughly northward
var sd4 = {
  trips: {
    't1': {
      route_id: 'R1',
      shape_id: 'shape1',
      stop_times: [
        { stop_id: 'A', arrival_seconds: 0, sequence: 1 },
        { stop_id: 'B', arrival_seconds: 300, sequence: 2 },
        { stop_id: 'C', arrival_seconds: 600, sequence: 3 }
      ]
    }
  },
  shapes: {
    'shape1': [
      { lat: 3.0000, lng: 101.0000 },
      { lat: 3.0050, lng: 101.0000 },
      { lat: 3.0100, lng: 101.0000 },
      { lat: 3.0150, lng: 101.0000 },
      { lat: 3.0200, lng: 101.0000 }
    ]
  },
  stops: {
    'A': { name: 'Terminal', lat: 3.0000, lon: 101.0000 },
    'B': { name: 'Midpoint', lat: 3.0100, lon: 101.0000 },
    'C': { name: 'End', lat: 3.0200, lon: 101.0000 }
  },
  routes: { 'R1': { route_id: 'R1', short_name: 'R1' } },
  _nameIndex: { 'R1': 'R1' }
};

// Scenario 1: moving bus + idle bus at terminal → idle bus should be ignored
var vehicles1 = [
  { route_id: 'R1', lat: 3.0090, lng: 101.0000, speed: 30, vehicle_label: 'MOVING' },
  { route_id: 'R1', lat: 3.0001, lng: 101.0000, speed: 0, vehicle_label: 'IDLE' }
];
var result1 = R.getNextStop('R1', 'C', vehicles1, sd4);
assert(result1 !== null, 'returns result when moving bus exists');
if (result1) {
  assert(result1.vehicleLabel === 'MOVING', 'prefers moving bus over idle terminal bus');
  assert(!result1.isProjected, 'live ETA is not projected');
}

// Scenario 2: only idle bus at terminal → should NOT return live ETA, falls to schedule
var vehicles2 = [
  { route_id: 'R1', lat: 3.0001, lng: 101.0000, speed: 0, vehicle_label: 'IDLE_ONLY' }
];
var result2 = R.getNextStop('R1', 'C', vehicles2, sd4);
assert(result2 !== null, 'returns result when only idle bus exists');
if (result2) {
  assert(result2.isProjected === true, 'idle bus → falls to schedule, not live');
}

// Scenario 3: no buses at all → schedule fallback
var result3 = R.getNextStop('R1', 'C', [], sd4);
assert(result3 !== null, 'returns schedule when no buses');
if (result3) {
  assert(result3.isProjected === true, 'schedule fallback is marked projected');
}

console.log('  (' + passed + ' passed)\n');

// ─── Results ───

console.log('=== Summary ===');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);

if (failed > 0) process.exit(1);
