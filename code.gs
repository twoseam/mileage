/**
 * Miles Tracker — Apps Script backend (v16, flat-schema)
 *
 * Reads/writes the new `entries` and `shoes` tabs.
 * One row per walk. No more per-cell coordinate mapping.
 * Multi-year aware: stats filter by current year by default; pass &year=YYYY to override.
 *
 * Endpoints:
 *   GET  ?secret=...&action=dashboard[&year=YYYY] — stats + lastTracked + weekly12 in one response (60s cache)
 *   GET  ?secret=...&action=shoes                  — list of shoes with lifetime mileage
 *   GET  ?secret=...&action=stats[&year=YYYY]      — stats only (back-compat)
 *   GET  ?secret=...&action=lastTracked[&year=YYYY]— last tracked date (back-compat)
 *   GET  ?secret=...&action=weekly12               — last 12 weeks Sun-Sat (back-compat)
 *   GET  ?secret=...&action=peek&dates=...         — returns 0 for all (back-compat shim; one-row-per-walk model never needs replace)
 *   POST { secret, entries: [{ date, miles, start_time?, lat?, lon?, temp_f?, weather?, shoe?, notes? }, ...] }
 *          mode field on entries is ignored — every POST appends a new row.
 */

var SECRET        = '101685910168591016859';
var ENTRIES_SHEET = 'Entries';
var SHOES_SHEET   = 'Shoes';

// Shoe photos are committed into the GitHub Pages repo so they're served
// from the site itself. Token lives in Script Properties (key GITHUB_TOKEN),
// never in source. File path: shoe-photos/<slug>.<ext>
var GH_OWNER  = 'twoseam';
var GH_REPO   = 'mileage';
var GH_BRANCH = 'main';

// Run this ONCE from the Apps Script editor (select it in the toolbar →
// Run → Allow) to grant the external-request permission GitHub photos need.
function authorizeExternal() {
  var r = UrlFetchApp.fetch('https://api.github.com', { muteHttpExceptions: true });
  Logger.log('External requests authorized. GitHub responded ' + r.getResponseCode());
}

// Keep-warm: add a time-driven trigger (Apps Script editor → Triggers →
// Add Trigger → warmUp → Time-driven → Minutes → every 5 minutes).
// Runs the real handlers so the instance stays hot AND the dashboard +
// allEntries caches are pre-populated — users rarely hit a cold start.
function warmUp() {
  try { doGet({ parameter: { secret: SECRET, action: 'dashboard'  } }); } catch (e) {}
  try { doGet({ parameter: { secret: SECRET, action: 'allEntries' } }); } catch (e) {}
}

// ---------- low-level helpers ----------

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _authed(e) {
  return e && e.parameter && e.parameter.secret === SECRET;
}

function _fmtDate(d) {
  if (!d) return '';
  if (typeof d === 'string') return d;
  if (Object.prototype.toString.call(d) !== '[object Date]') return String(d);
  return d.getFullYear() + '-' +
    ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
    ('0' + d.getDate()).slice(-2);
}

function _fmtTime(t) {
  if (!t) return '';
  if (typeof t === 'string') return t;
  if (Object.prototype.toString.call(t) !== '[object Date]') return String(t);
  return ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2);
}

// Pace is minutes:seconds per mile. If the Pace column is formatted as a
// time/duration cell, Sheets hands back a Date (epoch 1899-12-30) or a
// fraction-of-a-day number instead of text — either would otherwise leak
// out as "1899-12-30T..." or "0.0066". Normalize all three to "m:ss".
function _fmtPace(v, tz) {
  if (v === '' || v == null) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    tz = tz || SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    var hh = parseInt(Utilities.formatDate(v, tz, 'H'), 10) || 0;
    var mm = parseInt(Utilities.formatDate(v, tz, 'm'), 10) || 0;
    var ss = parseInt(Utilities.formatDate(v, tz, 's'), 10) || 0;
    return (hh * 60 + mm) + ':' + ('0' + ss).slice(-2);
  }
  if (typeof v === 'number') {                 // fraction of a day
    var secs = Math.round(v * 86400);
    return Math.floor(secs / 60) + ':' + ('0' + (secs % 60)).slice(-2);
  }
  return String(v).trim();                      // already clean text like "9:30"
}

// Map logical entry fields → 0-based column index, by header name (row 1).
// Same idea as shoes: the Entries tab can be reordered freely.
function _entryColMap(headerRow) {
  var map = {};
  (headerRow || []).forEach(function(h, idx) {
    var k = String(h || '').trim().toLowerCase();
    if (k === 'date')                              map.date = idx;
    else if (k === 'miles')                        map.miles = idx;
    else if (k === 'walk/run' || k === 'type')     map.type = idx;
    else if (k === 'start time' || k === 'start_time') map.start_time = idx;
    else if (k === 'end time' || k === 'end_time') map.end_time = idx;
    else if (k === 'pace')                         map.pace = idx;
    else if (k === 'lat')                          map.lat = idx;
    else if (k === 'lon')                          map.lon = idx;
    else if (k === 'temp' || k === 'temp_f')       map.temp_f = idx;
    else if (k === 'weather')                      map.weather = idx;
    else if (k === 'shoe')                         map.shoe = idx;
    else if (k === 'notes')                        map.notes = idx;
    else if (k === 'activity id' || k === 'activity_id') map.activity_id = idx;
  });
  return map;
}

function _readEntries() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENTRIES_SHEET);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var map = _entryColMap(data[0]);
  var tz  = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var dateRaw = _cell(r, map, 'date');
    if (!dateRaw) continue;
    var miles = parseFloat(_cell(r, map, 'miles'));
    if (isNaN(miles) || miles <= 0) continue;
    var lat = _cell(r, map, 'lat'), lon = _cell(r, map, 'lon'), tf = _cell(r, map, 'temp_f');
    rows.push({
      date:       _fmtDate(dateRaw),
      miles:      miles,
      type:       _cell(r, map, 'type') || 'Walk',
      start_time: _fmtTime(_cell(r, map, 'start_time')),
      end_time:   _fmtTime(_cell(r, map, 'end_time')),
      pace:       _fmtPace(_cell(r, map, 'pace'), tz),
      lat:        lat !== '' ? lat : null,
      lon:        lon !== '' ? lon : null,
      temp_f:     tf !== '' ? tf : null,
      weather:    _cell(r, map, 'weather') || '',
      shoe:       _cell(r, map, 'shoe') || '',
      notes:      _cell(r, map, 'notes') || '',
      activity_id: _cell(r, map, 'activity_id') || ''
    });
  }
  return rows;
}

// Map logical shoe fields → 0-based column index, by header name (row 1).
// Lets the Shoes tab be in ANY column order without code changes.
function _shoeColMap(headerRow) {
  var map = {};
  (headerRow || []).forEach(function(h, idx) {
    var k = String(h || '').trim().toLowerCase();
    if (k === 'brand')                     map.brand = idx;
    else if (k === 'model')                map.model = idx;
    else if (k === 'color')                map.color = idx;
    else if (k === 'goal')                 map.goal = idx;
    else if (k === 'purchased')            map.purchased = idx;
    else if (k === 'retired')              map.retired = idx;
    else if (k === 'photo' || k === 'photos') map.photo = idx;
    else if (k === 'notes')                map.notes = idx;
    else if (k === 'pair' || k === '#' || k === 'copy' || k === 'no.' || k === 'no')
                                           map.pair = idx;
  });
  return map;
}
function _cell(row, map, key) {
  return (map[key] != null) ? row[map[key]] : '';
}

function _reEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// One source of truth for a pair's identity, display, and the label strings a
// walk may use to credit it. Identity = brand + model + COLOR + copy number.
// A Volt Pegasus and an Olive Pegasus are different shoes, numbered separately.
function _shoeIdentity(brand, modelRaw, colorRaw, pairRaw) {
  brand = String(brand || '').trim();
  var color = String(colorRaw || '').trim();
  var base = _stripCopyNum(modelRaw);
  if (color) {                                   // don't double the color word
    base = base.replace(new RegExp('\\s*' + _reEsc(color) + '\\s*$', 'i'), '').trim();
  }
  var pair = String(pairRaw == null ? '' : pairRaw).trim();
  if (pair === '0') pair = '';
  if (!pair) {                                   // back-compat: # still in Model
    var mm = String(modelRaw || '').match(/#\s*(\d+)\s*$/);
    if (mm) pair = mm[1];
  }
  var bm = (brand + ' ' + base).trim();          // "Nike Pegasus"
  var bc = (base + (color ? ' ' + color : '')).trim();      // "Pegasus Volt"
  var full = (bm + (color ? ' ' + color : '')).trim();      // "Nike Pegasus Volt"
  var keys = [];
  function add(s) { s = String(s || '').trim().toLowerCase(); if (s && keys.indexOf(s) < 0) keys.push(s); }
  [full, bc].forEach(function(stem) {
    if (pair) { add(stem + ' #' + pair); add(stem + ' (' + pair + ')'); add(stem + ' ' + pair); }
    else      { add(stem); }
  });
  return {
    base:    base,
    color:   color,
    pair:    pair,
    name:    full + (pair ? ' #' + pair : ''),       // canonical identity
    display: full + (pair ? ' (' + pair + ')' : ''), // full label
    keys:    keys
  };
}

function _readShoes() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHOES_SHEET);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var map = _shoeColMap(data[0]);
  var shoes = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var brand = _cell(r, map, 'brand') || '';
    var model = _cell(r, map, 'model') || '';
    if (!brand && !model) continue;
    var id    = _shoeIdentity(brand, model, _cell(r, map, 'color'), _cell(r, map, 'pair'));
    var goalV = _cell(r, map, 'goal');
    shoes.push({
      brand:     brand,
      model:     id.base,
      pair:      id.pair,
      name:      id.name,
      display:   id.display,
      matchKeys: id.keys,
      purchased: _fmtDate(_cell(r, map, 'purchased')),
      retired:   _fmtDate(_cell(r, map, 'retired')),
      notes:     _cell(r, map, 'notes') || '',
      photo:     _cell(r, map, 'photo') || '',
      goal:      (typeof goalV === 'number' && goalV > 0) ? goalV : (parseFloat(goalV) || 0),
      color:     _cell(r, map, 'color') || ''
    });
  }
  return shoes;
}

function _groupByDate(rows) {
  var out = {};
  rows.forEach(function(r) {
    out[r.date] = (out[r.date] || 0) + r.miles;
  });
  return out;
}

function _filterByYear(rows, year) {
  var prefix = year + '-';
  return rows.filter(function(r) { return r.date.indexOf(prefix) === 0; });
}

function _yearParam(e) {
  var y = parseInt(e.parameter.year, 10);
  if (isNaN(y)) y = new Date().getFullYear();
  return y;
}

// ---------- stats ----------

function _stats(rows, year) {
  var byDate = _groupByDate(rows);
  var dates = Object.keys(byDate).sort();

  var totalMiles = 0;
  dates.forEach(function(d) { totalMiles += byDate[d]; });

  // Longest Walk = longest single row (not summed day total — two walks on
  // the same date are two separate walks, not one 9.2-mile walk).
  var longestWalk = 0;
  rows.forEach(function(r) {
    if (r.miles > longestWalk) longestWalk = r.miles;
  });

  var daysWalked = dates.length;

  // Days elapsed in `year` as of today (capped at year-end)
  var today = new Date();
  today.setHours(12, 0, 0, 0);
  var yearStart = new Date(year, 0, 1, 12, 0, 0);
  var yearEnd   = new Date(year, 11, 31, 12, 0, 0);
  var ref = today < yearStart ? yearStart : (today > yearEnd ? yearEnd : today);
  var daysElapsed = Math.round((ref - yearStart) / 86400000) + 1;
  var percent = daysElapsed > 0 ? (daysWalked / daysElapsed) : 0;

  // Month miles (current month, within `year`)
  var monthMiles = 0;
  if (today.getFullYear() === year) {
    var monthPrefix = year + '-' + ('0' + (today.getMonth() + 1)).slice(-2) + '-';
    dates.forEach(function(d) {
      if (d.indexOf(monthPrefix) === 0) monthMiles += byDate[d];
    });
  }

  // Week miles (Sun-Sat of current calendar week, intersected with `year`)
  var weekMiles = 0;
  var weekSun = new Date(today);
  weekSun.setDate(today.getDate() - today.getDay());
  weekSun.setHours(12, 0, 0, 0);
  for (var i = 0; i < 7; i++) {
    var d = new Date(weekSun);
    d.setDate(weekSun.getDate() + i);
    if (d.getFullYear() !== year) continue;
    var k = _fmtDate(d);
    if (byDate[k]) weekMiles += byDate[k];
  }

  // Current streak — today is grace; count backwards from today (or yesterday if today blank).
  var streak = 0;
  var cursor = new Date(today);
  if (!byDate[_fmtDate(cursor)]) cursor.setDate(cursor.getDate() - 1);
  while (byDate[_fmtDate(cursor)] && cursor.getFullYear() === year) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  // Longest streak in `year`
  var longestStreak = 0;
  var current = 0;
  var prev = null;
  dates.forEach(function(ds) {
    var dd = new Date(ds + 'T12:00:00');
    if (prev === null) {
      current = 1;
    } else {
      var diff = Math.round((dd - prev) / 86400000);
      current = (diff === 1) ? current + 1 : 1;
    }
    if (current > longestStreak) longestStreak = current;
    prev = dd;
  });

  return {
    miles:         totalMiles,
    days:          daysWalked,
    percent:       percent,
    monthMiles:    monthMiles,
    weekMiles:     weekMiles,
    streak:        streak,
    longestWalk:   longestWalk,
    longestStreak: longestStreak
  };
}

function _lastTracked(rows) {
  if (rows.length === 0) return { lastDate: null, daysBehind: 0 };
  var dates = rows.map(function(r) { return r.date; }).sort();
  var lastDate = dates[dates.length - 1];
  var last = new Date(lastDate + 'T12:00:00');
  var today = new Date();
  today.setHours(12, 0, 0, 0);
  var daysBehind = Math.round((today - last) / 86400000);
  if (daysBehind < 0) daysBehind = 0;
  return { lastDate: lastDate, daysBehind: daysBehind };
}

function _weekly12(rows) {
  var byDate = _groupByDate(rows);
  var today = new Date();
  today.setHours(12, 0, 0, 0);
  var currentSun = new Date(today);
  currentSun.setDate(today.getDate() - today.getDay());
  currentSun.setHours(12, 0, 0, 0);
  var weeks = [];
  for (var w = 11; w >= 0; w--) {
    var sun = new Date(currentSun);
    sun.setDate(currentSun.getDate() - w * 7);
    var miles = 0;
    for (var i = 0; i < 7; i++) {
      var d = new Date(sun);
      d.setDate(sun.getDate() + i);
      var k = _fmtDate(d);
      if (byDate[k]) miles += byDate[k];
    }
    weeks.push({ weekStart: _fmtDate(sun), miles: miles });
  }
  return weeks;
}

function _shoesWithLifetime(allRows) {
  var shoes = _readShoes();

  // Miles keyed by the (normalized) shoe label written on each walk.
  var milesByLabel = {};
  allRows.forEach(function(r) {
    if (!r.shoe) return;
    var k = String(r.shoe).trim().toLowerCase();
    milesByLabel[k] = (milesByLabel[k] || 0) + r.miles;
  });

  // A pair owns a walk if the walk's label matches any of the pair's
  // identity strings (brand+model+#n, model+#n, with (n)/space/# forms).
  return shoes.map(function(s) {
    var total = 0;
    (s.matchKeys || []).forEach(function(key) { total += milesByLabel[key] || 0; });
    return {
      name:          s.name,
      display:       s.display,
      matchKeys:     s.matchKeys,
      brand:         s.brand,
      model:         s.model,
      pair:          s.pair,
      purchased:     s.purchased,
      retired:       s.retired,
      notes:         s.notes,
      photo:         s.photo,
      goal:          s.goal,
      color:         s.color,
      lifetimeMiles: total
    };
  });
}

// ---------- doGet ----------

function doGet(e) {
  if (!_authed(e)) return _json({ error: 'Unauthorized' });
  var action = e.parameter.action;

  if (action === 'dashboard') {
    var cacheKey = 'dashboard_' + (e.parameter.year || 'current');
    var cache = CacheService.getScriptCache();
    var cached = cache.get(cacheKey);
    if (cached) return _json(JSON.parse(cached));

    var year = _yearParam(e);
    var allRows = _readEntries();
    var yearRows = _filterByYear(allRows, year);

    var response = {
      stats:       _stats(yearRows, year),
      lastTracked: _lastTracked(yearRows),
      weekly12:    { weeks: _weekly12(allRows) }
    };
    try { cache.put(cacheKey, JSON.stringify(response), 60); } catch (err) {}
    return _json(response);
  }

  if (action === 'shoes') {
    var allRows2 = _readEntries();
    return _json({ shoes: _shoesWithLifetime(allRows2) });
  }

  if (action === 'stats') {
    var year2 = _yearParam(e);
    var rows2 = _filterByYear(_readEntries(), year2);
    return _json(_stats(rows2, year2));
  }

  if (action === 'lastTracked') {
    var year3 = _yearParam(e);
    var rows3 = _filterByYear(_readEntries(), year3);
    return _json(_lastTracked(rows3));
  }

  if (action === 'weekly12') {
    return _json({ weeks: _weekly12(_readEntries()) });
  }

  if (action === 'peek') {
    // One-row-per-walk model: replace doesn't apply. Return 0 for every date
    // so the old "replace or add" modal never triggers.
    var dateList = (e.parameter.dates || '').split(',').filter(function(s) { return s; });
    var out = {};
    dateList.forEach(function(d) { out[d] = 0; });
    return _json({ values: out });
  }

  if (action === 'allEntries') {
    // Every entry across all years (Stats page slices client-side). The
    // payload is ~120KB — over CacheService's 100KB/item cap — so cache it
    // GZIPPED (compresses ~5x). Invalidated on POST. Big repeat-load win.
    var aeCache = CacheService.getScriptCache();
    var aeHit = aeCache.get('allEntries_gz');
    if (aeHit) {
      try {
        var blob = Utilities.newBlob(Utilities.base64Decode(aeHit), 'application/x-gzip');
        return ContentService.createTextOutput(Utilities.ungzip(blob).getDataAsString())
                 .setMimeType(ContentService.MimeType.JSON);
      } catch (err) {}
    }
    var allRows = _readEntries();
    var payload = JSON.stringify({
      rows: allRows.map(function(r) {
        return {
          date: r.date, miles: r.miles, type: r.type, shoe: r.shoe,
          pace: r.pace, start_time: r.start_time, end_time: r.end_time,
          temp_f: r.temp_f, weather: r.weather, notes: r.notes,
          lat: r.lat, lon: r.lon, activity_id: r.activity_id
        };
      })
    });
    try {
      var gz = Utilities.base64Encode(
                 Utilities.gzip(Utilities.newBlob(payload)).getBytes());
      if (gz.length < 100000) aeCache.put('allEntries_gz', gz, 60);
    } catch (err) {}
    return ContentService.createTextOutput(payload)
             .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'lastIngest') {
    // debug peek: what the last Health Auto Export POST mapped to
    var li = CacheService.getScriptCache().get('haLastIngest');
    return _json(li ? JSON.parse(li) : { note: 'no ingest yet' });
  }

  return _json({ error: 'Unknown action' });
}

// ---------- shoes: add / update / photo ----------

function _slug(s) {
  return String(s || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'shoe';
}

function _todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' +
    ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
    ('0' + d.getDate()).slice(-2);
}

// Commit a data: URL image into the repo at shoe-photos/<slug>.<ext>.
// Returns { path: '<repo path>' | '', err: '' | '<reason>' }.
function _pushPhoto(slug, dataUrl) {
  if (!dataUrl || dataUrl.indexOf('data:') !== 0) return { path: '', err: 'no-photo' };
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) return { path: '', err: 'GITHUB_TOKEN script property is missing' };
  var m = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return { path: '', err: 'photo not a valid data URL' };
  var ext = m[1] === 'image/png' ? 'png' : 'jpg';
  var path = 'shoe-photos/' + slug + '.' + ext;
  var api = 'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + path;
  var headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
  try {
    // overwrite needs the existing file's sha
    var sha = null;
    var getRes = UrlFetchApp.fetch(api + '?ref=' + GH_BRANCH,
      { method: 'get', headers: headers, muteHttpExceptions: true });
    if (getRes.getResponseCode() === 200) sha = JSON.parse(getRes.getContentText()).sha;
    var payload = { message: 'shoe photo: ' + path, content: m[2], branch: GH_BRANCH };
    if (sha) payload.sha = sha;
    var putRes = UrlFetchApp.fetch(api, {
      method: 'put', headers: headers, contentType: 'application/json',
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    var code = putRes.getResponseCode();
    if (code >= 200 && code < 300) return { path: path, err: '' };
    return { path: '', err: 'GitHub ' + code + ': ' + putRes.getContentText().slice(0, 160) };
  } catch (e) {
    return { path: '', err: 'request blocked: ' + (e && e.message ? e.message : String(e)) };
  }
}

// ---------- Health Auto Export ingest (forward auto-capture) ----------
//
// Health Auto Export (iOS app) posts new workouts here automatically.
// We map its JSON -> an Entries row + commit the GPS route to the repo
// (routes/<id>.json), so future walks/runs appear with their map, no
// manual export. Auth: ?secret=... on the endpoint URL (Apps Script can't
// read POST headers; HAE can't inject our secret into its body).

// Commit arbitrary UTF-8 text to the repo (generalized _pushPhoto).
function _pushText(path, text, message) {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) return 'GITHUB_TOKEN missing';
  var api = 'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO +
            '/contents/' + path;
  var headers = { Authorization: 'Bearer ' + token,
                  Accept: 'application/vnd.github+json' };
  try {
    var sha = null;
    var g = UrlFetchApp.fetch(api + '?ref=' + GH_BRANCH,
      { method: 'get', headers: headers, muteHttpExceptions: true });
    if (g.getResponseCode() === 200) sha = JSON.parse(g.getContentText()).sha;
    var payload = {
      message: message || ('update ' + path),
      content: Utilities.base64Encode(text, Utilities.Charset.UTF_8),
      branch: GH_BRANCH
    };
    if (sha) payload.sha = sha;
    var p = UrlFetchApp.fetch(api, {
      method: 'put', headers: headers, contentType: 'application/json',
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    var c = p.getResponseCode();
    return (c >= 200 && c < 300) ? '' : ('GitHub ' + c + ': ' +
           p.getContentText().slice(0, 140));
  } catch (e) {
    return 'request blocked: ' + (e && e.message ? e.message : String(e));
  }
}

// Ramer-Douglas-Peucker (same simplification as the historical importer).
function _rdp(pts, tol) {
  if (pts.length < 3) return pts;
  var keep = [], i;
  for (i = 0; i < pts.length; i++) keep.push(false);
  keep[0] = keep[pts.length - 1] = true;
  var stack = [[0, pts.length - 1]];
  while (stack.length) {
    var seg = stack.pop(), s = seg[0], e = seg[1];
    var ax = pts[s][0], ay = pts[s][1], bx = pts[e][0], by = pts[e][1];
    var dx = bx - ax, dy = by - ay;
    var den = Math.sqrt(dx * dx + dy * dy) || 1e-12;
    var dmax = 0, idx = -1;
    for (i = s + 1; i < e; i++) {
      var d = Math.abs(dx * (ay - pts[i][1]) - (ax - pts[i][0]) * dy) / den;
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > tol && idx !== -1) {
      keep[idx] = true; stack.push([s, idx]); stack.push([idx, e]);
    }
  }
  var out = [];
  for (i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

function _haNum(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object') {
    if (v.qty != null) return Number(v.qty);
    if (v.value != null) return Number(v.value);
  }
  var n = parseFloat(v);
  return isNaN(n) ? null : n;
}
function _haPick(o, keys) {
  for (var i = 0; i < keys.length; i++) {
    if (o && o[keys[i]] != null && o[keys[i]] !== '') return o[keys[i]];
  }
  return null;
}
function _haDateParts(s) {           // -> { date:'YYYY-MM-DD', time:'HH:MM' }
  var m = String(s || '').match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  return m ? { date: m[1], time: m[2] } : { date: '', time: '' };
}
function _hms(sec) {
  sec = Math.round(sec);
  return ('0' + Math.floor(sec / 3600)).slice(-2) + ':' +
         ('0' + Math.floor((sec % 3600) / 60)).slice(-2) + ':' +
         ('0' + (sec % 60)).slice(-2);
}

function _ingestWorkouts(body) {
  var ws = (body.data && body.data.workouts) || body.workouts || [];
  if (!ws.length) return _json({ error: 'no workouts in payload' });

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENTRIES_SHEET);
  if (!sheet) return _json({ error: 'Entries sheet not found' });
  var data = sheet.getDataRange().getValues();
  var hdr = data[0] || [];
  var hlow = hdr.map(function(h) { return String(h || '').trim().toLowerCase(); });
  var amap = _entryColMap(hdr);

  // Dedupe two ways: by Activity Id (Health Auto Export resends) AND by
  // date+distance (Health Auto Export assigns DIFFERENT UUIDs than the
  // one-time Apple Health file export, so the same workout already in the
  // Sheet from the historical import would otherwise double up).
  var seen = {}, seenDM = {};
  function dmKey(d, mi) { return d + '|' + (Math.round(Number(mi) * 10) / 10); }
  for (var r = 1; r < data.length; r++) {
    if (amap.activity_id != null) {
      var a = String(data[r][amap.activity_id] || '').trim();
      if (a) seen[a.toLowerCase()] = true;
    }
    if (amap.date != null && amap.miles != null) {
      var dd = String(data[r][amap.date] || '').slice(0, 10);
      var mm = parseFloat(data[r][amap.miles]);
      if (dd && !isNaN(mm)) seenDM[dmKey(dd, mm)] = true;
    }
  }

  function setByHeader(row, label, val) {
    var j = hlow.indexOf(label);
    if (j >= 0) row[j] = val;
  }

  var rows = [], summary = [];
  ws.forEach(function(w) {
    var id = String(_haPick(w, ['id', 'uuid', 'workoutID', 'identifier']) || '').trim();
    if (id && seen[id.toLowerCase()]) { summary.push({ id: id, skipped: 'dupe' }); return; }

    var nm = String(_haPick(w, ['name', 'workoutActivityType', 'activityName']) || '');
    var type = /run/i.test(nm) ? 'Run' : 'Walk';
    var sp = _haDateParts(_haPick(w, ['start', 'startDate']));
    var ep = _haDateParts(_haPick(w, ['end', 'endDate']));

    var dist = _haNum(_haPick(w, ['distance', 'totalDistance']));
    var du = (w.distance && w.distance.units) || w.distanceUnits || 'mi';
    if (dist != null && /km/i.test(du)) dist *= 0.621371;
    if (dist == null || dist <= 0) { summary.push({ id: id, skipped: 'no distance' }); return; }
    var miles = Math.round(dist * 100) / 100;

    // already in the Sheet by date+distance (e.g. from the historical
    // import, which used different IDs)? skip — no double-count.
    var dmk = dmKey(sp.date, miles);
    if (sp.date && seenDM[dmk]) { summary.push({ id: id, skipped: 'dupe (date+miles)' }); return; }

    var durS = _haNum(_haPick(w, ['duration', 'activeDuration']));
    if (durS != null && durS < 600 && /min/i.test(String(w.durationUnits || ''))) durS *= 60;
    var pace = (durS && miles) ? (function() {
      var p = (durS / 60) / miles, mm = Math.floor(p), ss = Math.round((p - mm) * 60);
      if (ss === 60) { mm++; ss = 0; }
      return mm + ':' + ('0' + ss).slice(-2);
    })() : '';

    var cal = _haNum(_haPick(w, ['activeEnergyBurned', 'activeEnergy', 'totalEnergyBurned', 'calories']));
    var hr  = _haNum(_haPick(w, ['averageHeartRate', 'heartRateAverage', 'avgHeartRate', 'heartRate']));
    var steps = _haNum(_haPick(w, ['stepCount', 'steps']));
    var temp = _haNum(_haPick(w, ['temperature', 'weatherTemperature']));
    var asc = _haNum(_haPick(w, ['elevationAscended', 'elevationUp', 'totalAscent']));
    var dsc = _haNum(_haPick(w, ['elevationDescended', 'elevationDown', 'totalDescent']));

    // route -> simplified [[lat,lon],...] committed to the repo
    var routeRaw = _haPick(w, ['route', 'workoutRoute', 'routePoints', 'locations', 'gpx']);
    var routeErr = '', haveRoute = false;
    if (routeRaw && routeRaw.length && id) {
      var pts = [];
      routeRaw.forEach(function(p) {
        var la = _haNum(_haPick(p, ['lat', 'latitude']));
        var lo = _haNum(_haPick(p, ['lon', 'lng', 'longitude']));
        if (la != null && lo != null) pts.push([la, lo]);
      });
      if (pts.length >= 2) {
        var simp = _rdp(pts, 0.00003), last = null, clean = [];
        simp.forEach(function(p) {
          var c = [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];
          if (!last || c[0] !== last[0] || c[1] !== last[1]) { clean.push(c); last = c; }
        });
        routeErr = _pushText('routes/' + id + '.json', JSON.stringify(clean),
                             'route: ' + id);
        haveRoute = !routeErr;
      }
    }

    var width = Math.max(hdr.length, 21);
    var row = [];
    for (var c = 0; c < width; c++) row.push('');
    function put(k, v) { if (amap[k] != null) row[amap[k]] = v; }
    put('date', sp.date); put('miles', miles); put('type', type);
    put('start_time', sp.time); put('end_time', ep.time);
    put('pace', pace); put('activity_id', id);
    if (temp != null) put('temp_f', Math.round(temp));
    setByHeader(row, 'duration', durS != null ? _hms(durS) : '');
    setByHeader(row, 'avg speed mph', (durS && miles) ? Math.round(miles / (durS / 3600) * 100) / 100 : '');
    setByHeader(row, 'avg heart rate', hr != null ? Math.round(hr) : '');
    setByHeader(row, 'calories', cal != null ? Math.round(cal) : '');
    setByHeader(row, 'steps', steps != null ? Math.round(steps) : '');
    setByHeader(row, 'ascent ft', asc != null ? Math.round(asc * 100) / 100 : '');
    setByHeader(row, 'descent ft', dsc != null ? Math.round(dsc * 100) / 100 : '');
    setByHeader(row, 'recording source', 'watch');
    rows.push(row);
    seen[id.toLowerCase()] = true;
    seenDM[dmk] = true;
    summary.push({ id: id, date: sp.date, miles: miles, type: type, route: haveRoute, routeErr: routeErr });
  });

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length)
         .setValues(rows);
    try {
      var ch = CacheService.getScriptCache();
      ch.remove('dashboard_current');
      ch.remove('allEntries_gz');
      ch.remove('dashboard_' + new Date().getFullYear());
    } catch (e) {}
  }
  // stash for the ?action=lastIngest debug peek
  try {
    CacheService.getScriptCache().put('haLastIngest',
      JSON.stringify({ at: new Date().toISOString(), added: rows.length, summary: summary }),
      21600);
  } catch (e) {}
  return _json({ added: rows.length, total: ws.length, summary: summary });
}

function _shoesSheet() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHOES_SHEET);
  // Only seed headers on a brand-new/empty sheet. An existing sheet keeps
  // whatever header order you've arranged — code reads/writes by header name.
  if (sheet && sheet.getLastRow() === 0) {
    var hdr = ['Brand', 'Model', 'Color', 'Goal', 'Purchased', 'Retired', 'Photos', 'Notes'];
    sheet.getRange(1, 1, 1, 8).setValues([hdr]).setFontWeight('bold');
  }
  return sheet;
}

function _stripCopyNum(s) {
  return String(s || '').trim().replace(/\s*#\d+\s*$/, '');
}

function _addShoe(shoe) {
  shoe = shoe || {};
  var brand = (shoe.brand || '').trim();
  var color = (shoe.color || '').trim();
  var norm  = _shoeIdentity(brand, shoe.model, color, '');  // strips color/# → base
  var base  = norm.base;
  if (!brand && !base) return _json({ error: 'Brand or model required' });

  var sheet = _shoesSheet();
  if (!sheet) return _json({ error: 'Sheet "' + SHOES_SHEET + '" not found' });

  var data = sheet.getDataRange().getValues();
  var map  = _shoeColMap(data[0] || []);

  // Write a pair's copy number. Prefers the Pair column; if there's no Pair
  // column, falls back to "#n" in Model (so it still works pre-column).
  function writePair(rowIdx, n) {
    if (map.pair != null) {
      sheet.getRange(rowIdx, map.pair + 1).setValue(n);
      if (map.model != null) sheet.getRange(rowIdx, map.model + 1).setValue(base);
    } else if (map.model != null) {
      sheet.getRange(rowIdx, map.model + 1).setValue(base + ' #' + n);
    }
  }

  // Existing copies of the same brand + base model + COLOR. First of a given
  // color stays unnumbered; on the 2nd, the original becomes #1, new one #2.
  var existing = [];
  for (var i = 1; i < data.length; i++) {
    var rid = _shoeIdentity(_cell(data[i], map, 'brand'), _cell(data[i], map, 'model'),
                            _cell(data[i], map, 'color'), _cell(data[i], map, 'pair'));
    var rBrand = String(_cell(data[i], map, 'brand') || '').trim().toLowerCase();
    if (rBrand !== brand.toLowerCase() ||
        rid.base.toLowerCase()  !== base.toLowerCase() ||
        rid.color.toLowerCase() !== color.toLowerCase()) continue;
    existing.push({ row: i + 1, num: rid.pair ? parseInt(rid.pair, 10) : null });
  }

  var pair;
  if (existing.length === 0) {
    pair = '';                                 // first of this color — no number
  } else {
    var maxN = 0;
    existing.forEach(function(x) {
      if (x.num == null) { writePair(x.row, 1); x.num = 1; }   // promote original → #1
      if (x.num > maxN) maxN = x.num;
    });
    pair = maxN + 1;
  }

  var id = _shoeIdentity(brand, base, color, pair);
  var ph = shoe.photo ? _pushPhoto(_slug(id.name), shoe.photo) : { path: '', err: '' };

  // Build the row in this sheet's actual column order (by header).
  var width = Math.max((data[0] || []).length, 8);
  var row = [];
  for (var c = 0; c < width; c++) row.push('');
  function put(key, val) { if (map[key] != null) row[map[key]] = val; }
  put('brand', brand);
  put('model', (map.pair != null || !pair) ? base : (base + ' #' + pair));
  put('pair', pair);
  put('color', color);
  put('goal',  (shoe.goal != null ? shoe.goal : ''));
  put('purchased', shoe.purchased || '');
  put('retired', '');
  put('photo', ph.path);
  put('notes', '');
  sheet.appendRow(row);
  return _json({ addedShoe: true, name: id.name, display: id.display, photo: ph.path, photoError: ph.err });
}

// Update an existing pair by name: retire today, change photo, or edit fields.
function _updateShoe(req) {
  req = req || {};
  var name = (req.name || '').trim();
  if (!name) return _json({ error: 'name required' });

  var sheet = _shoesSheet();
  if (!sheet) return _json({ error: 'Sheet "' + SHOES_SHEET + '" not found' });
  var data = sheet.getDataRange().getValues();
  var map  = _shoeColMap(data[0] || []);

  var want = name.toLowerCase();
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var idr = _shoeIdentity(_cell(r, map, 'brand'), _cell(r, map, 'model'), _cell(r, map, 'color'), _cell(r, map, 'pair'));
    if (idr.name.toLowerCase() !== want &&
        idr.display.toLowerCase() !== want &&
        idr.keys.indexOf(want) < 0) continue;
    var rowIdx = i + 1;
    function col(key) { return (map[key] != null) ? map[key] + 1 : 0; } // 1-based, 0 = absent

    if (req.retire && col('retired') && !_cell(r, map, 'retired')) {
      sheet.getRange(rowIdx, col('retired')).setValue(_todayStr());
    }
    var photoErr = '';
    if (req.photo) {
      var ph = _pushPhoto(_slug(name), req.photo);
      if (ph.path && col('photo')) sheet.getRange(rowIdx, col('photo')).setValue(ph.path);
      photoErr = ph.err;
    }
    if (req.goal  != null && col('goal'))  sheet.getRange(rowIdx, col('goal')).setValue(req.goal);
    if (req.color != null && col('color')) sheet.getRange(rowIdx, col('color')).setValue(req.color);

    return _json({ updatedShoe: true, name: name, photoError: photoErr });
  }
  return _json({ error: 'Shoe "' + name + '" not found' });
}

// ---------- doPost ----------

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return _json({ error: 'Invalid JSON' });
  }

  // Health Auto Export ingest — auth via ?secret= on the URL (it can't put
  // our secret in its own body; Apps Script can't read POST headers).
  if (body.workouts || (body.data && body.data.workouts)) {
    if (!_authed(e) && body.secret !== SECRET) return _json({ error: 'Unauthorized' });
    return _ingestWorkouts(body);
  }

  if (body.secret !== SECRET) return _json({ error: 'Unauthorized' });

  // Add a pair:    { secret, shoe: { brand, model, purchased, goal?, color?, photo? } }
  if (body.shoe) return _addShoe(body.shoe);
  // Update a pair: { secret, updateShoe: { name, retire?, photo?, goal?, color? } }
  if (body.updateShoe) return _updateShoe(body.updateShoe);

  var entries = body.entries || [];
  if (!entries.length) return _json({ error: 'No entries' });

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENTRIES_SHEET);
  if (!sheet) return _json({ error: 'Sheet "' + ENTRIES_SHEET + '" not found' });

  var hdr   = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  var emap  = _entryColMap(hdr);
  var width = Math.max(hdr.length, 10);

  var rowsToAppend = [];
  var results = [];
  entries.forEach(function(entry) {
    var miles = parseFloat(entry.miles);
    if (isNaN(miles) || miles <= 0) return;
    var row = [];
    for (var c = 0; c < width; c++) row.push('');
    function put(key, val) { if (emap[key] != null) row[emap[key]] = val; }
    put('date',       entry.date || '');
    put('miles',      miles);
    put('type',       entry.type || 'Walk');
    put('start_time', entry.start_time || '');
    put('end_time',   entry.end_time || '');
    put('pace',       entry.pace || '');
    put('lat',        entry.lat    != null ? entry.lat    : '');
    put('lon',        entry.lon    != null ? entry.lon    : '');
    put('temp_f',     entry.temp_f != null ? entry.temp_f : '');
    put('weather',    entry.weather || '');
    put('shoe',       entry.shoe || '');
    put('notes',      entry.notes || '');
    rowsToAppend.push(row);
    results.push({ date: entry.date, miles: miles });
  });

  if (rowsToAppend.length > 0) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
  }

  // Invalidate dashboard cache (all years, since we don't know which year was written)
  try {
    var cache = CacheService.getScriptCache();
    cache.remove('dashboard_current');
    cache.remove('allEntries_gz');
    var thisYear = new Date().getFullYear();
    cache.remove('dashboard_' + thisYear);
  } catch (err) {}

  return _json({ written: rowsToAppend.length, results: results });
}
