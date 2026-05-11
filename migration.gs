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

  // 0. Rename any pre-existing lowercase tabs from earlier runs
  var oldLowerEntries = ss.getSheetByName('entries');
  if (oldLowerEntries && !ss.getSheetByName('Entries')) oldLowerEntries.setName('Entries');
  var oldLowerShoes = ss.getSheetByName('shoes');
  if (oldLowerShoes && !ss.getSheetByName('Shoes')) oldLowerShoes.setName('Shoes');

  // 1. Create / reset `Entries` tab with headers
  var entries = ss.getSheetByName('Entries');
  if (!entries) entries = ss.insertSheet('Entries');
  entries.clear();
  entries.getRange(1, 1, 1, 10).setValues([[
    'Date', 'Miles', 'Walk/Run', 'Start Time', 'Lat', 'Lon', 'Temp', 'Weather', 'Shoe', 'Notes'
  ]]).setFontWeight('bold');
  entries.setFrozenRows(1);
  entries.getRange('A:A').setNumberFormat('yyyy-mm-dd');

  // 2. Create / reset `Shoes` tab with headers (Brand + Model split)
  var shoes = ss.getSheetByName('Shoes');
  if (!shoes) shoes = ss.insertSheet('Shoes');
  shoes.clear();
  shoes.getRange(1, 1, 1, 5).setValues([[
    'Brand', 'Model', 'Purchased', 'Retired', 'Notes'
  ]]).setFontWeight('bold');
  shoes.setFrozenRows(1);
  shoes.getRange('C:D').setNumberFormat('yyyy-mm-dd');

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
      // Cols: Date, Miles, Walk/Run, Start Time, Lat, Lon, Temp, Weather, Shoe, Notes
      rows.push([dateStr, miles, 'Walk', '', '', '', '', '', '', '']);
    }
  }

  // 4. Write rows
  if (rows.length > 0) {
    entries.getRange(2, 1, rows.length, 10).setValues(rows);
  }

  // 5. Log summary
  var total = rows.reduce(function(s, r) { return s + r[1]; }, 0);
  var oldTotal = oldSheet.getRange('I4').getValue();
  Logger.log('Migrated ' + rows.length + ' entries.');
  Logger.log('  New entries total: ' + total.toFixed(2) + ' mi');
  Logger.log('  Old I4 cell total: ' + (typeof oldTotal === 'number' ? oldTotal.toFixed(2) : oldTotal) + ' mi');
  Logger.log('  Match: ' + (Math.abs(total - oldTotal) < 0.5 ? 'YES (within rounding)' : 'NO — investigate'));
}

/**
 * Diagnostic: compare per-month totals between
 *   (a) raw sum of cells (what the migration reads), and
 *   (b) the MONTH_TOTAL_CELL values in the old sheet (what I4 sums).
 *
 * Run from the Apps Script editor to find which month(s) account for the
 * discrepancy between the migrated entries total and I4.
 */
function diagnoseDiscrepancy() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var oldSheet = ss.getSheetByName(SHEET_NAME);
  var values = oldSheet.getDataRange().getValues();

  var monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  Logger.log('Per-month breakdown:');
  Logger.log('Month | Cells sum | MONTH_TOTAL_CELL | Diff | Cell ref');

  var grandCells = 0;
  var grandTotalCells = 0;
  for (var m = 1; m <= 12; m++) {
    var cellsSum = 0;
    var daysInMonth = new Date(2026, m, 0).getDate();
    for (var d = 1; d <= daysInMonth; d++) {
      var dateStr = '2026-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
      var pos = dateToColRow(dateStr);
      if (!pos) continue;
      var v = values[pos.row - 1][pos.col - 1];
      if (typeof v === 'number' && v > 0) cellsSum += v;
    }
    var totalCellRef = MONTH_TOTAL_CELL[m];
    var totalCellVal = oldSheet.getRange(totalCellRef).getValue();
    if (typeof totalCellVal !== 'number') totalCellVal = 0;
    grandCells += cellsSum;
    grandTotalCells += totalCellVal;
    var diff = cellsSum - totalCellVal;
    Logger.log(
      monthNames[m] +
      ' | cells=' + cellsSum.toFixed(3) +
      ' | ' + totalCellRef + '=' + totalCellVal.toFixed(3) +
      ' | diff=' + (diff >= 0 ? '+' : '') + diff.toFixed(3)
    );
  }
  Logger.log('-----');
  Logger.log('Sum of cells (all months):         ' + grandCells.toFixed(3));
  Logger.log('Sum of MONTH_TOTAL_CELL values:    ' + grandTotalCells.toFixed(3));
  Logger.log('I4 value:                          ' + oldSheet.getRange('I4').getValue());
}

