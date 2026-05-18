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
    else if (k === 'lat')                          map.lat = idx;
    else if (k === 'lon')                          map.lon = idx;
    else if (k === 'temp' || k === 'temp_f')       map.temp_f = idx;
    else if (k === 'weather')                      map.weather = idx;
    else if (k === 'shoe')                         map.shoe = idx;
    else if (k === 'notes')                        map.notes = idx;
  });
  return map;
}

function _readEntries() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENTRIES_SHEET);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var map = _entryColMap(data[0]);
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
      lat:        lat !== '' ? lat : null,
      lon:        lon !== '' ? lon : null,
      temp_f:     tf !== '' ? tf : null,
      weather:    _cell(r, map, 'weather') || '',
      shoe:       _cell(r, map, 'shoe') || '',
      notes:      _cell(r, map, 'notes') || ''
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

// One source of truth for a pair's identity, display, and the set of label
// strings a walk may use to credit it. `pair` is the copy number ('' = lone).
function _shoeIdentity(brand, modelRaw, pairRaw) {
  brand = String(brand || '').trim();
  var base = _stripCopyNum(modelRaw);
  var pair = String(pairRaw == null ? '' : pairRaw).trim();
  if (pair === '0') pair = '';
  if (!pair) {                                   // back-compat: # still in Model
    var mm = String(modelRaw || '').match(/#\s*(\d+)\s*$/);
    if (mm) pair = mm[1];
  }
  var bm = (brand + ' ' + base).trim();
  var keys = [];
  function add(s) { s = String(s || '').trim().toLowerCase(); if (s && keys.indexOf(s) < 0) keys.push(s); }
  if (pair) {
    add(bm + ' #' + pair); add(bm + ' (' + pair + ')'); add(bm + ' ' + pair);
    add(base + ' #' + pair); add(base + ' (' + pair + ')'); add(base + ' ' + pair);
  } else {
    add(bm); add(base);
  }
  return {
    base:    base,
    pair:    pair,
    name:    bm + (pair ? ' #' + pair : ''),       // canonical identity
    display: bm + (pair ? ' (' + pair + ')' : ''), // shown in the app
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
    var id    = _shoeIdentity(brand, model, _cell(r, map, 'pair'));
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
    // Returns every entry across all years for client-side aggregation
    // (Stats page slices by zoom level).
    var allRows = _readEntries();
    return _json({
      rows: allRows.map(function(r) {
        return { date: r.date, miles: r.miles, type: r.type, shoe: r.shoe };
      })
    });
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
  var brand     = (shoe.brand || '').trim();
  var baseModel = _stripCopyNum(shoe.model);   // ignore any number the user typed
  if (!brand && !baseModel) return _json({ error: 'Brand or model required' });

  var sheet = _shoesSheet();
  if (!sheet) return _json({ error: 'Sheet "' + SHOES_SHEET + '" not found' });

  var data = sheet.getDataRange().getValues();
  var map  = _shoeColMap(data[0] || []);

  // Write a pair's copy number. Prefers the Pair column; if there's no Pair
  // column, falls back to "#n" in Model (so it still works pre-column).
  function writePair(rowIdx, base, n) {
    if (map.pair != null) {
      sheet.getRange(rowIdx, map.pair + 1).setValue(n);
      if (map.model != null) sheet.getRange(rowIdx, map.model + 1).setValue(base);
    } else if (map.model != null) {
      sheet.getRange(rowIdx, map.model + 1).setValue(base + ' #' + n);
    }
  }

  // Existing copies of the same brand + base model. First pair stays
  // unnumbered; on the 2nd add, the original becomes #1 and the new one #2.
  var existing = [];
  for (var i = 1; i < data.length; i++) {
    var b = String(_cell(data[i], map, 'brand') || '').trim().toLowerCase();
    var mRaw = _cell(data[i], map, 'model');
    if (b !== brand.toLowerCase() ||
        _stripCopyNum(mRaw).toLowerCase() !== baseModel.toLowerCase()) continue;
    var idr = _shoeIdentity(brand, mRaw, _cell(data[i], map, 'pair'));
    existing.push({ row: i + 1, num: idr.pair ? parseInt(idr.pair, 10) : null });
  }

  var pair;
  if (existing.length === 0) {
    pair = '';                                 // lone pair — no number
  } else {
    var maxN = 0;
    existing.forEach(function(x) {
      if (x.num == null) { writePair(x.row, baseModel, 1); x.num = 1; }   // promote original → #1
      if (x.num > maxN) maxN = x.num;
    });
    pair = maxN + 1;
  }

  var id = _shoeIdentity(brand, baseModel, pair);
  var ph = shoe.photo ? _pushPhoto(_slug(id.name), shoe.photo) : { path: '', err: '' };

  // Build the row in this sheet's actual column order (by header).
  var width = Math.max((data[0] || []).length, 8);
  var row = [];
  for (var c = 0; c < width; c++) row.push('');
  function put(key, val) { if (map[key] != null) row[map[key]] = val; }
  put('brand', brand);
  put('model', (map.pair != null || !pair) ? baseModel : (baseModel + ' #' + pair));
  put('pair', pair);
  put('color', shoe.color || '');
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

  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    var rowName = ((_cell(r, map, 'brand') || '') + ' ' + (_cell(r, map, 'model') || '')).trim();
    if (rowName !== name) continue;
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
    var thisYear = new Date().getFullYear();
    cache.remove('dashboard_' + thisYear);
  } catch (err) {}

  return _json({ written: rowsToAppend.length, results: results });
}
