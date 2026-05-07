/**
 * miles-tracker.js (v15)
 * Walking miles tracker — talks to your Apps Script backend.
 * No Google sign-in needed — protected by a shared secret in the URL.
 *
 * v15: adds fetchPeek(dates, cb) so the page can ask "replace or add?"
 *      before submitting. logBatch entries may now include mode: 'add'|'replace'.
 *
 * USAGE:
 *   MilesTracker.init();
 *   MilesTracker.logMiles('2026-04-11', 3.2);
 *   MilesTracker.logBatch([ { date, miles, mode? }, ... ]);
 *   MilesTracker.fetchStats(callback);        // callback(stats) — see backend stats response
 *   MilesTracker.fetchLastTracked(callback);  // callback(lastDateStr, daysBehind)
 *   MilesTracker.fetchWeekly12(callback);     // callback([{ weekStart, miles }, ...])
 *   MilesTracker.fetchPeek(dates, callback);  // callback({ '2026-04-11': 3.2, ... })
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
    onSuccess: function(result) { console.log('Miles logged:', result); },
    onError:   function(err)    { console.error('MilesTracker error:', err); },

    init: function() {
      setTimeout(function() {
        if (MilesTracker.onReady) MilesTracker.onReady();
      }, 0);
    },

    isSignedIn: function() { return true; },
    signIn:     function() {},
    signOut:    function() {},

    logMiles: function(date, miles) {
      MilesTracker.logBatch([{ date: date, miles: miles }]);
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
    },

    fetchDaily: function(callback) {
      _get('daily')
        .then(function(data) { callback(data && data.weeks ? data.weeks : []); })
        .catch(function()    { callback([]); });
    },

    fetchPeek: function(dates, callback) {
      _get('peek&dates=' + encodeURIComponent(dates.join(',')))
        .then(function(data) { callback(data && data.values ? data.values : {}); })
        .catch(function()    { callback({}); });
    }

  };

  global.MilesTracker = MilesTracker;

})(window);
