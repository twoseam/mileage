/**
 * miles-tracker.js (v16, flat-schema)
 *
 * Talks to the Apps Script backend that reads/writes the new `Entries` and
 * `Shoes` tabs. One row per walk. POSTs may include any of:
 *   { date, miles, type, start_time, lat, lon, temp_f, weather, shoe, notes }
 * `type` is 'Walk' or 'Run' (default Walk).
 *
 * USAGE:
 *   MilesTracker.init();
 *   MilesTracker.logWalk({ date, miles, type, start_time, lat, lon, temp_f, weather, shoe, notes });
 *   MilesTracker.fetchDashboard(callback);   // primary entry — stats + lastTracked + weekly12
 *   MilesTracker.fetchShoes(callback);       // [{ brand, model, name, purchased, retired, notes, lifetimeMiles }, ...]
 */

(function(global) {
  'use strict';

  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbwi4FGaT6zMOfWulcZWZrD8O7BvlVaDgK2SUYUeqap5qPzxFpZCjvi-TMHkeRRh1gyP/exec';
  var SECRET   = '101685910168591016859';

  function _get(action) {
    return fetch(ENDPOINT + '?secret=' + encodeURIComponent(SECRET) + '&action=' + action)
      .then(function(r) { return r.json(); });
  }

  var MilesTracker = {

    onReady:   function() {},
    onSuccess: function(result) { console.log('Walk logged:', result); },
    onError:   function(err)    { console.error('MilesTracker error:', err); },

    init: function() {
      setTimeout(function() {
        if (MilesTracker.onReady) MilesTracker.onReady();
      }, 0);
    },

    isSignedIn: function() { return true; },
    signIn:     function() {},
    signOut:    function() {},

    logWalk: function(entry) {
      MilesTracker.logBatch([entry]);
    },

    logBatch: function(entries) {
      fetch(ENDPOINT, {
        method: 'POST',
        // text/plain avoids a CORS preflight that Apps Script can't handle
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ secret: SECRET, entries: entries })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) MilesTracker.onError(data.error);
        else            MilesTracker.onSuccess(data);
      })
      .catch(function(err) { MilesTracker.onError(String(err)); });
    },

    fetchDashboard: function(callback) {
      _get('dashboard')
        .then(function(data) { callback(data && !data.error ? data : {}); })
        .catch(function()    { callback({}); });
    },

    fetchShoes: function(callback) {
      _get('shoes')
        .then(function(data) { callback(data && data.shoes ? data.shoes : []); })
        .catch(function()    { callback([]); });
    },

    fetchStats: function(callback) {
      _get('stats')
        .then(function(data) { callback(data && !data.error ? data : {}); })
        .catch(function()    { callback({}); });
    },

    fetchLastTracked: function(callback) {
      _get('lastTracked')
        .then(function(data) {
          if (!data || data.error) { callback(null, 0); return; }
          callback(data.lastDate || null, data.daysBehind || 0);
        })
        .catch(function() { callback(null, 0); });
    },

    fetchWeekly12: function(callback) {
      _get('weekly12')
        .then(function(data) { callback(data && data.weeks ? data.weeks : []); })
        .catch(function()    { callback([]); });
    }

  };

  global.MilesTracker = MilesTracker;

})(window);
