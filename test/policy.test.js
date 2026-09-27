'use strict';
/**
 * Tests for policy availability and point-maximum validation.
 *
 * All three policies are usable. 70% remains the hard gate: it is the only one
 * proven against real student grades, and it stays the default.
 */

const test = require('node:test');
const assert = require('node:assert');

const { TransmutationTables } = require('../src/engine/transmutation');
const {
  CONFIDENCE,
  DEFAULT_POLICY,
  allPolicies,
  selectablePolicies,
  policyStatus,
  isSelectable,
  validateMaxPoints,
  strandedByPolicy,
  isDerivedMaximum,
} = require('../src/engine/policy');

const tables = new TransmutationTables(require('../data/transmutation_tables.json'));

test('70% is the default and the only grade-verified policy', () => {
  assert.equal(DEFAULT_POLICY, '70');
  assert.equal(policyStatus('70').confidence, CONFIDENCE.GRADE_VERIFIED);
  assert.equal(policyStatus('70').isDefault, true);
  const verified = allPolicies(tables).filter(
    (p) => p.confidence === CONFIDENCE.GRADE_VERIFIED
  );
  assert.deepEqual(
    verified.map((p) => p.policy),
    ['70'],
    'only 70% has a real-grade fixture behind it'
  );
});

test('all three policies are selectable', () => {
  const offered = selectablePolicies(tables).map((p) => p.policy).sort();
  assert.deepEqual(offered, ['50', '60', '70']);
  assert.equal(isSelectable('50'), true);
  assert.equal(isSelectable('60'), true);
  assert.equal(isSelectable('70'), true);
});

test('50% and 60% are offered as structurally verified, not grade-verified', () => {
  for (const p of ['50', '60']) {
    assert.equal(policyStatus(p).confidence, CONFIDENCE.STRUCTURAL, `${p}% confidence`);
    assert.equal(policyStatus(p).isDefault, false);
    // Wording is humanised over time; assert the meaning, not the phrasing.
    assert.match(policyStatus(p).note, /not been tried against a finished grade sheet/i);
  }
});

test('every policy carries a note explaining its provenance', () => {
  for (const p of allPolicies(tables)) {
    assert.ok(p.note && p.note.length > 20, `${p.policy}% should explain its confidence`);
    assert.ok(p.label, `${p.policy}% should have a label`);
    assert.ok(Array.isArray(p.supportedMaximums) && p.supportedMaximums.length);
  }
});

test('point maximums are validated against real table columns', () => {
  assert.equal(validateMaxPoints(15, '70', tables).ok, true);
  assert.equal(validateMaxPoints(20, '70', tables).ok, true, '20 points is now available');
  assert.equal(validateMaxPoints(20, '50', tables).ok, true);
  assert.equal(validateMaxPoints(100, '70', tables).ok, false);
  assert.equal(validateMaxPoints(0, '70', tables).ok, false);
  assert.equal(validateMaxPoints('abc', '70', tables).ok, false);
});

test('an invalid maximum names the values that would work', () => {
  const r = validateMaxPoints(100, '70', tables);
  assert.equal(r.ok, false);
  assert.match(r.message, /no column for 100 points/);
  assert.deepEqual(r.supported, [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
});

test('a reconstructed column is allowed but says so', () => {
  // 20 points under 70% is usable, and the instructor is told it was worked out
  // rather than copied from the university table, so they can spot-check it.
  const r = validateMaxPoints(20, '70', tables);
  assert.equal(r.ok, true, 'it must not block the assessment');
  assert.equal(r.level, 'warning', 'but it is not silently ordinary either');
  assert.equal(r.derived, true);
  assert.match(r.message, /worked out/i);
  assert.match(r.message, /check one result/i, 'it asks them to verify');
});

test('only the reconstructed column is flagged, not its neighbours', () => {
  assert.equal(isDerivedMaximum(20, '70'), true);
  assert.equal(isDerivedMaximum(15, '70'), false, 'transcribed from the workbook');
  assert.equal(isDerivedMaximum(25, '70'), false, 'transcribed from the workbook');
  // The 50% and 60% tables list 20 points themselves, so theirs is not derived.
  assert.equal(isDerivedMaximum(20, '50'), false);
  assert.equal(isDerivedMaximum(20, '60'), false);
  // An ordinary column reports itself as not derived rather than omitting the flag.
  assert.equal(validateMaxPoints(15, '70', tables).derived, false);
});

test('switching policy reports which assessments would be stranded', () => {
  // A 20-point assessment is no longer stranded by any policy, which was the
  // whole point of adding the column. A maximum no table has still is.
  const assessments = [
    { name: 'Quiz 1', maxPoints: 15 },
    { name: 'Midterm Project', maxPoints: 20 },
    { name: 'Attendance', maxPoints: 10 },
  ];
  assert.deepEqual(strandedByPolicy(assessments, '70', tables), []);
  assert.deepEqual(strandedByPolicy(assessments, '50', tables), []);

  const odd = [{ name: 'Portfolio', maxPoints: 17 }];
  assert.deepEqual(strandedByPolicy(odd, '70', tables), [{ name: 'Portfolio', maxPoints: 17 }]);
});
