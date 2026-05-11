/**
 * One-off migration: read old 2026 cell-grid → flat `entries` table.
 *
 * Creates new tabs `entries` and `shoes` with headers, then walks every
 * date in 2026 (using the existing dateToColRow helper in code.gs) and
 * appends one row per non-empty cell to `entries`. The +0.001 day-count
 * nudge is stripped via round-to-nearest-0.1.
 *
 * Run once from the Apps Script editor:
 *   1. Make sure code.gs is also in this project (we use its ANCHORS / dateToColRow).
 *   2. Select function `migrateToFlatSchema` in the toolbar.
 *   3. Click Run. Approve permissions when prompted.
 *   4. Check the Execution log for the summary line.
 *
 * Safe to re-run: the entries tab is cleared at the top of each run.
 * Shoes tab is preserved across reruns (only created if missing).
 */
function migrateToFlatSchema() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Create / reset `entries` tab with headers
  var entries = ss.getSheetByName('entries');
  if (!entries) entries = ss.insertSheet('entries');
  entries.clear();
  entries.getRange(1, 1, 1, 9).setValues([[
    'date', 'miles', 'start_time', 'lat', 'lon', 'temp_f', 'weather', 'shoe', 'notes'
  ]]).setFontWeight('bold');
  entries.setFrozenRows(1);
  entries.getRange('A:A').setNumberFormat('yyyy-mm-dd');

  // 2. Create `shoes` tab if missing, with headers
  var shoes = ss.getSheetByName('shoes');
  if (!shoes) {
    shoes = ss.insertSheet('shoes');
    shoes.getRange(1, 1, 1, 4).setValues([[
      'name', 'purchased', 'retired', 'notes'
    ]]).setFontWeight('bold');
    shoes.setFrozenRows(1);
    shoes.getRange('B:C').setNumberFormat('yyyy-mm-dd');
  }

  // 3. Read every 2026 mileage cell from the old tab
  var oldSheet = ss.getSheetByName(SHEET_NAME);
  if (!oldSheet) {
    throw new Error('Old sheet "' + SHEET_NAME + '" not found.');
  }
  var values = oldSheet.getDataRange().getValues();
  var rows = [];
  for (var m = 1; m <= 12; m++) {
    var daysInMonth = new Date(2026, m, 0).getDate();
    for (var d = 1; d <= daysInMonth; d++) {
      var dateStr = '2026-' +
        ('0' + m).slice(-2) + '-' +
        ('0' + d).slice(-2);
      var pos = dateToColRow(dateStr);
      if (!pos) continue;
      var v = values[pos.row - 1][pos.col - 1];
      if (typeof v !== 'number' || v <= 0) continue;

      // Strip the +0.001 day-count nudge by rounding to nearest 0.1
      var miles = Math.round(v * 10) / 10;
      rows.push([dateStr, miles, '', '', '', '', '', '', '']);
    }
  }

  // 4. Write rows
  if (rows.length > 0) {
    entries.getRange(2, 1, rows.length, 9).setValues(rows);
  }

  // 5. Log summary
  var total = rows.reduce(function(s, r) { return s + r[1]; }, 0);
  var oldTotal = oldSheet.getRange('I4').getValue();
  Logger.log('Migrated ' + rows.length + ' entries.');
  Logger.log('  New entries total: ' + total.toFixed(2) + ' mi');
  Logger.log('  Old I4 cell total: ' + (typeof oldTotal === 'number' ? oldTotal.toFixed(2) : oldTotal) + ' mi');
  Logger.log('  Match: ' + (Math.abs(total - oldTotal) < 0.5 ? 'YES (within rounding)' : 'NO — investigate'));
}
