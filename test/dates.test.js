'use strict';
/**
 * Date formatting.
 *
 * Dates are stored as YYYY-MM-DD because that sorts and never means two things.
 * They are never shown that way: an instructor reads "Sept. 9, 2026".
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  formatDate,
  formatDateShort,
  formatDateForFilename,
  todayStored,
} = require('../src/engine');

test('a stored date reads the way a person writes it', () => {
  assert.equal(formatDate('2026-09-09'), 'Sept. 9, 2026');
  assert.equal(formatDate('2026-09-02'), 'Sept. 2, 2026');
  assert.equal(formatDate('2026-12-25'), 'Dec. 25, 2026');
  assert.equal(formatDate('2027-01-05'), 'Jan. 5, 2027');
  assert.equal(formatDate('2026-05-01'), 'May 1, 2026');
});

test('a column header drops the year when every date shares one', () => {
  const sameYear = ['2026-09-02', '2026-09-09', '2026-10-01'];
  assert.equal(formatDateShort('2026-09-09', sameYear), 'Sept. 9');
  // A term that straddles the new year keeps the year, or the dates read wrong.
  const twoYears = ['2026-12-10', '2027-01-14'];
  assert.equal(formatDateShort('2027-01-14', twoYears), 'Jan. 14, 2027');
});

test('a file name carries the date without punctuation that reads badly', () => {
  const name = formatDateForFilename('2026-09-10');
  assert.equal(name, 'Sept 10 2026');
  assert.ok(!name.includes('.'), 'a dot would look like a second file extension');
  assert.ok(!name.includes(','), 'commas read badly in a file name');
  assert.ok(!/[\/:*?"<>|]/.test(name), 'no characters Windows refuses');
});

test('something that is not a stored date is left alone', () => {
  // A half-typed value should still show what was typed, not vanish.
  assert.equal(formatDate(''), '');
  assert.equal(formatDate('sometime next week'), 'sometime next week');
  assert.equal(formatDate('2026-13-45'), '2026-13-45');
});

test('today comes back in the stored shape', () => {
  assert.match(todayStored(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(todayStored(new Date(2026, 8, 9)), '2026-09-09');
  // Single digits are padded, or the string sorts wrongly.
  assert.equal(todayStored(new Date(2026, 0, 5)), '2026-01-05');
});

test('the renderer copy of the date helpers matches the engine', () => {
  // The renderer has no module system, so src/renderer/dates.js is generated
  // from the engine module. If someone edits one, the two must not drift.
  const engine = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'engine', 'dates.js'), 'utf8');
  const renderer = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'dates.js'), 'utf8');

  // Compare only the functions, since the header comment and the export tail
  // differ by design.
  const body = (text) => {
    const start = text.indexOf('const MONTHS_SHORT');
    const endExport = text.indexOf('module.exports');
    const endWindow = text.indexOf('window.GradeDeskDates');
    const end = [endExport, endWindow].filter((i) => i > -1).sort((a, b) => a - b)[0];
    return text.slice(start, end === undefined ? text.length : end).trim();
  };

  assert.equal(
    body(renderer),
    body(engine),
    'run `npm run build:dates` after changing src/engine/dates.js'
  );
});
