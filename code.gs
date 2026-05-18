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

function _readEntries() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENTRIES_SHEET);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[0]) continue;
    var miles = parseFloat(r[1]);
    if (isNaN(miles) || miles <= 0) continue;
    // Cols: Date, Miles, Walk/Run, Start Time, Lat, Lon, Temp, Weather, Shoe, Notes
    rows.push({
      date:       _fmtDate(r[0]),
      miles:      miles,
      type:       r[2] || 'Walk',
      start_time: _fmtTime(r[3]),
      lat:        r[4] !== '' ? r[4] : null,
      lon:        r[5] !== '' ? r[5] : null,
      temp_f:     r[6] !== '' ? r[6] : null,
      weather:    r[7] || '',
      shoe:       r[8] || '',
      notes:      r[9] || ''
    });
  }
  return rows;
}

function _readShoes() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHOES_SHEET);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var shoes = [];
  for (var i = 1; i < data.length; i++) {
    var r = data[i];
    if (!r[0] && !r[1]) continue;
    var name = ((r[0] || '') + ' ' + (r[1] || '')).trim();
    shoes.push({
      brand:     r[0] || '',
      model:     r[1] || '',
      name:      name,
      purchased: _fmtDate(r[2]),
      retired:   _fmtDate(r[3]),
      notes:     r[4] || '',
      photo:     r[5] || ''
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
  var milesByShoe = {};
  allRows.forEach(function(r) {
    if (r.shoe) milesByShoe[r.shoe] = (milesByShoe[r.shoe] || 0) + r.miles;
  });
  return shoes.map(function(s) {
    return {
      name:          s.name,
      purchased:     s.purchased,
      retired:       s.retired,
      notes:         s.notes,
      photo:         s.photo,
      lifetimeMiles: milesByShoe[s.name] || 0
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

// ---------- add a shoe ----------

function _addShoe(shoe) {
  var name = ((shoe && shoe.name) || '').trim();
  if (!name) return _json({ error: 'Shoe name required' });

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHOES_SHEET);
  if (!sheet) return _json({ error: 'Sheet "' + SHOES_SHEET + '" not found' });

  // Make sure a Photo header exists in column 6
  if (sheet.getLastColumn() < 6) {
    sheet.getRange(1, 6).setValue('Photo').setFontWeight('bold');
  }

  var photoUrl = '';
  if (shoe.photo && shoe.photo.indexOf('data:') === 0) {
    try {
      var m = shoe.photo.match(/^data:([^;]+);base64,(.*)$/);
      if (m) {
        var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name + '.jpg');
        var folders = DriveApp.getFoldersByName('Mileage Shoe Photos');
        var folder = folders.hasNext() ? folders.next()
                                       : DriveApp.createFolder('Mileage Shoe Photos');
        var file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        photoUrl = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w640';
      }
    } catch (err) {
      photoUrl = ''; // photo is optional — don't fail the whole add
    }
  }

  // Cols: Brand, Model, Purchased, Retired, Notes, Photo
  sheet.appendRow(['', name, shoe.purchased || '', '', '', photoUrl]);
  return _json({ addedShoe: true, name: name, photo: photoUrl });
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

  // Add-a-pair: { secret, shoe: { name, purchased, photo? } }
  if (body.shoe) return _addShoe(body.shoe);

  var entries = body.entries || [];
  if (!entries.length) return _json({ error: 'No entries' });

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ENTRIES_SHEET);
  if (!sheet) return _json({ error: 'Sheet "' + ENTRIES_SHEET + '" not found' });

  var rowsToAppend = [];
  var results = [];
  entries.forEach(function(entry) {
    var miles = parseFloat(entry.miles);
    if (isNaN(miles) || miles <= 0) return;
    // Cols: Date, Miles, Walk/Run, Start Time, Lat, Lon, Temp, Weather, Shoe, Notes
    var row = [
      entry.date       || '',
      miles,
      entry.type       || 'Walk',
      entry.start_time || '',
      entry.lat        != null ? entry.lat    : '',
      entry.lon        != null ? entry.lon    : '',
      entry.temp_f     != null ? entry.temp_f : '',
      entry.weather    || '',
      entry.shoe       || '',
      entry.notes      || ''
    ];
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
