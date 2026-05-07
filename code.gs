/**
 * Miles Tracker — Apps Script backend (v14)
 *
 * Deploy as Web App:
 *   Execute as: Me
 *   Who has access: Anyone (protected by SECRET below)
 *
 * v14 changes:
 *   - doPost: nudges integer mileage by +0.001 so the day-count formula counts it.
 *   - stats: now returns monthMiles + weekMiles in addition to miles/days/percent.
 *   - new action: weekly12 — last 12 completed Sun–Sat weeks of mileage.
 *
 * v15 changes:
 *   - new action: peek — returns existing mileage for a list of dates so the
 *     client can ask "replace or add?" before submitting.
 *   - doPost honors `entry.mode === 'replace'` (default behavior is still add).
 *
 * CHANGE THE SECRET before deploying!
 */

var SECRET     = '101685910168591016859';
var SHEET_NAME = '2026';

// Month anchors: col (A=1), row, dow (0=Sun). row points to the MILEAGE row (date row + 1).
var ANCHORS = {
  1:  { col: 7,  row: 11, dow: 3 },
  2:  { col: 12, row: 11, dow: 0 },
  3:  { col: 21, row: 11, dow: 0 },
  4:  { col: 6,  row: 27, dow: 3 },
  5:  { col: 17, row: 27, dow: 5 },
  6:  { col: 22, row: 27, dow: 1 },
  7:  { col: 6,  row: 43, dow: 3 },
  8:  { col: 18, row: 43, dow: 6 },
  9:  { col: 23, row: 43, dow: 2 },
  10: { col: 7,  row: 59, dow: 4 },
  11: { col: 12, row: 59, dow: 0 },
  12: { col: 23, row: 59, dow: 2 }
};

// Hardcoded overrides for dates bodged into adjacent month blocks
var DATE_OVERRIDES = {
  '2026-05-31': { col: 21, row: 27 }, // U27
  '2026-08-30': { col: 21, row: 43 }, // U43
  '2026-08-31': { col: 22, row: 43 }  // V43
};

// Per-month total cells (mirror of the SUM formulas in the sheet header rows)
var MONTH_TOTAL_CELL = {
  1:'B7',  2:'K7',  3:'T7',
  4:'B23', 5:'K23', 6:'T23',
  7:'B39', 8:'K39', 9:'T39',
  10:'B55', 11:'K55', 12:'T55'
};

function dateToColRow(dateStr) {
  if (DATE_OVERRIDES[dateStr]) return DATE_OVERRIDES[dateStr];
  var parts = dateStr.split('-').map(Number);
  var month = parts[1];
  var day   = parts[2];
  var a = ANCHORS[month];
  if (!a) return null;
  var dayOffset = day - 1;
  var colOffset = (a.dow + dayOffset) % 7;
  var weekOffset = Math.floor((a.dow + dayOffset) / 7);
  return {
    col: a.col - a.dow + colOffset,
    row: a.row + weekOffset * 2
  };
}

function _fmtDate(d) {
  return d.getFullYear() + '-' +
    ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
    ('0' + d.getDate()).slice(-2);
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _authed(e) {
  return e && e.parameter && e.parameter.secret === SECRET;
}

// Sums miles for [startDate, startDate + days) using a pre-loaded values grid.
function _sumRange(values, startDate, days) {
  var total = 0;
  for (var i = 0; i < days; i++) {
    var d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    if (d.getFullYear() !== 2026) continue;
    var pos = dateToColRow(_fmtDate(d));
    if (!pos) continue;
    var v = values[pos.row - 1][pos.col - 1];
    if (typeof v === 'number') total += v;
  }
  return total;
}

// Max single-day mileage anywhere in 2026.
function _getLongestWalk(values) {
  var max = 0;
  for (var m = 1; m <= 12; m++) {
    var daysInMonth = new Date(2026, m, 0).getDate();
    for (var d = 1; d <= daysInMonth; d++) {
      var dateStr = '2026-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
      var pos = dateToColRow(dateStr);
      if (!pos) continue;
      var v = values[pos.row - 1][pos.col - 1];
      if (typeof v === 'number' && v > max) max = v;
    }
  }
  return max;
}

// Longest run of consecutive walked days at any point in 2026.
function _getLongestStreak(values) {
  var max = 0;
  var current = 0;
  for (var m = 1; m <= 12; m++) {
    var daysInMonth = new Date(2026, m, 0).getDate();
    for (var d = 1; d <= daysInMonth; d++) {
      var dateStr = '2026-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
      var pos = dateToColRow(dateStr);
      var v = pos ? values[pos.row - 1][pos.col - 1] : null;
      if (typeof v === 'number' && v > 0) {
        current++;
        if (current > max) max = current;
      } else {
        current = 0;
      }
    }
  }
  return max;
}

// Current consecutive-days streak. Today is grace — if not logged yet, count
// starts from yesterday. Streak ends at the first day with no miles.
function _getStreak(values) {
  var d = new Date();
  var todayPos = dateToColRow(_fmtDate(d));
  var todayHas = todayPos &&
    typeof values[todayPos.row - 1][todayPos.col - 1] === 'number' &&
    values[todayPos.row - 1][todayPos.col - 1] > 0;
  if (!todayHas) d.setDate(d.getDate() - 1);
  var streak = 0;
  while (d.getFullYear() === 2026) {
    var pos = dateToColRow(_fmtDate(d));
    if (!pos) break;
    var v = values[pos.row - 1][pos.col - 1];
    if (typeof v === 'number' && v > 0) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

// GET — used for fetching stats, last tracked date, and the 12-week chart
// Usage: ?secret=XXX&action=stats
//        ?secret=XXX&action=lastTracked
//        ?secret=XXX&action=weekly12
function doGet(e) {
  if (!_authed(e)) return _json({ error: 'Unauthorized' });

  var action = e.parameter.action;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);

  if (action === 'stats') {
    var miles   = sheet.getRange('I4').getValue();
    var days    = sheet.getRange('M4').getValue();
    var percent = sheet.getRange('Q4').getValue();
    var today   = new Date();
    var monthCellAddr = MONTH_TOTAL_CELL[today.getMonth() + 1];
    var monthMilesRaw = sheet.getRange(monthCellAddr).getValue();
    var monthMiles = (typeof monthMilesRaw === 'number') ? monthMilesRaw : 0;

    // Week miles: walk Sun..Sat of current week, sum mileage cells.
    var weekSun = new Date(today);
    weekSun.setDate(today.getDate() - today.getDay());
    var values = sheet.getDataRange().getValues();
    var weekMiles = _sumRange(values, weekSun, 7);
    var streak = _getStreak(values);
    var longestWalk = _getLongestWalk(values);
    var longestStreak = _getLongestStreak(values);

    return _json({
      miles: miles, days: days, percent: percent,
      monthMiles: monthMiles, weekMiles: weekMiles,
      streak: streak,
      longestWalk: longestWalk,
      longestStreak: longestStreak
    });
  }

  if (action === 'lastTracked') {
    var lastDate = null;
    var values = sheet.getDataRange().getValues();
    for (var m = 1; m <= 12; m++) {
      var daysInMonth = new Date(2026, m, 0).getDate();
      for (var d = 1; d <= daysInMonth; d++) {
        var dateStr = '2026-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
        var pos = dateToColRow(dateStr);
        if (!pos) continue;
        var val = values[pos.row - 1][pos.col - 1];
        if (val !== '' && val !== null && val !== undefined) lastDate = dateStr;
      }
    }
    var daysBehind = 0;
    if (lastDate) {
      var last = new Date(lastDate + 'T12:00:00');
      var today2 = new Date();
      today2.setHours(12, 0, 0, 0);
      daysBehind = Math.floor((today2 - last) / (1000 * 60 * 60 * 24));
    }
    return _json({ lastDate: lastDate, daysBehind: daysBehind });
  }

  if (action === 'dashboard') {
    var values = sheet.getDataRange().getValues();

    var miles   = sheet.getRange('I4').getValue();
    var days    = sheet.getRange('M4').getValue();
    var percent = sheet.getRange('Q4').getValue();
    var today   = new Date();
    var monthMilesRaw = sheet.getRange(MONTH_TOTAL_CELL[today.getMonth() + 1]).getValue();
    var monthMiles = (typeof monthMilesRaw === 'number') ? monthMilesRaw : 0;
    var weekSun = new Date(today);
    weekSun.setDate(today.getDate() - today.getDay());
    var weekMiles = _sumRange(values, weekSun, 7);

    var lastDate = null;
    for (var m = 1; m <= 12; m++) {
      var dim = new Date(2026, m, 0).getDate();
      for (var d = 1; d <= dim; d++) {
        var dateStr = '2026-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
        var pos = dateToColRow(dateStr);
        if (!pos) continue;
        var val = values[pos.row - 1][pos.col - 1];
        if (val !== '' && val !== null && val !== undefined) lastDate = dateStr;
      }
    }
    var daysBehind = 0;
    if (lastDate) {
      var last = new Date(lastDate + 'T12:00:00');
      var t2 = new Date();
      t2.setHours(12, 0, 0, 0);
      daysBehind = Math.floor((t2 - last) / (1000 * 60 * 60 * 24));
    }

    var weeks = [];
    for (var w = 11; w >= 0; w--) {
      var sun = new Date(weekSun);
      sun.setDate(weekSun.getDate() - w * 7);
      weeks.push({ weekStart: _fmtDate(sun), miles: _sumRange(values, sun, 7) });
    }

    return _json({
      stats: {
        miles: miles, days: days, percent: percent,
        monthMiles: monthMiles, weekMiles: weekMiles,
        streak: _getStreak(values),
        longestWalk: _getLongestWalk(values),
        longestStreak: _getLongestStreak(values)
      },
      lastTracked: { lastDate: lastDate, daysBehind: daysBehind },
      weekly12: { weeks: weeks }
    });
  }

  if (action === 'peek') {
    // Returns existing mileage for a list of dates, so the client can ask
    // "replace or add?" before posting. Usage: ?action=peek&dates=YYYY-MM-DD,YYYY-MM-DD
    var dateList = (e.parameter.dates || '').split(',').filter(function(s) { return s; });
    var valuesPeek = sheet.getDataRange().getValues();
    var out = {};
    dateList.forEach(function(dateStr) {
      var pos = dateToColRow(dateStr);
      if (!pos) { out[dateStr] = null; return; }
      var v = valuesPeek[pos.row - 1][pos.col - 1];
      out[dateStr] = (typeof v === 'number') ? v : 0;
    });
    return _json({ values: out });
  }

  if (action === 'daily') {
    // Full-year heatmap data: array of weeks (Sun..Sat), each day is miles or null (out-of-year).
    var values3 = sheet.getDataRange().getValues();
    var jan1d = new Date(2026, 0, 1);
    var sunday = new Date(2026, 0, 1 - jan1d.getDay());
    var weeks2 = [];
    while (sunday.getFullYear() <= 2026) {
      var days = [];
      for (var i = 0; i < 7; i++) {
        var dd = new Date(sunday);
        dd.setDate(sunday.getDate() + i);
        if (dd.getFullYear() !== 2026) {
          days.push(null);
        } else {
          var pos = dateToColRow(_fmtDate(dd));
          var v = pos ? values3[pos.row - 1][pos.col - 1] : 0;
          days.push(typeof v === 'number' ? v : 0);
        }
      }
      weeks2.push({ weekStart: _fmtDate(sunday), days: days });
      sunday.setDate(sunday.getDate() + 7);
    }
    return _json({ weeks: weeks2 });
  }

  if (action === 'weekly12') {
    // 12 weeks ending with the current (in-progress) Sun–Sat week.
    var today3 = new Date();
    var currentWeekSun = new Date(today3);
    currentWeekSun.setDate(today3.getDate() - today3.getDay());
    var values2 = sheet.getDataRange().getValues();
    var weeks = [];
    for (var w = 11; w >= 0; w--) {
      var sun = new Date(currentWeekSun);
      sun.setDate(currentWeekSun.getDate() - w * 7);
      weeks.push({
        weekStart: _fmtDate(sun),
        miles: _sumRange(values2, sun, 7)
      });
    }
    return _json({ weeks: weeks });
  }

  return _json({ error: 'Unknown action' });
}

// POST — used for writing miles
// Body: { secret: "...", entries: [{ date: "2026-04-11", miles: 3.2, mode?: "add"|"replace" }, ...] }
// Default mode is "add": new value is added to the existing cell value.
// Mode "replace": existing value is overwritten with the new value.
// Whole-number totals are nudged by +0.001 so the day-count formula
// (SUMPRODUCT of MOD(...,1)<>0) counts the entry as a walked day.
function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return _json({ error: 'Invalid JSON' });
  }

  if (body.secret !== SECRET) return _json({ error: 'Unauthorized' });

  var entries = body.entries || [];
  if (!entries.length) return _json({ error: 'No entries' });

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var written = 0;
  var skipped = [];
  var results = [];

  entries.forEach(function(entry) {
    var pos = dateToColRow(entry.date);
    if (!pos) {
      skipped.push(entry.date);
      return;
    }
    var cell = sheet.getRange(pos.row, pos.col);
    var existing = cell.getValue();
    var existingNum = (typeof existing === 'number') ? existing : parseFloat(existing);
    if (isNaN(existingNum)) existingNum = 0;
    var newMiles = parseFloat(entry.miles);
    var newTotal = (entry.mode === 'replace') ? newMiles : existingNum + newMiles;
    if (newTotal === Math.floor(newTotal)) newTotal += 0.001;
    cell.setValue(newTotal);
    written++;
    results.push({
      date: entry.date,
      added: newMiles,
      previous: existingNum,
      newTotal: newTotal,
      mode: entry.mode || 'add'
    });
  });

  return _json({ written: written, skipped: skipped, results: results });
}
