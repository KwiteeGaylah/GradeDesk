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
    assert.match(policyStatus(p).note, /not cross-checked against a real/i);
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
  assert.equal(validateMaxPoints(20, '70', tables).ok, false, '70% has no 20-point column');
  assert.equal(validateMaxPoints(20, '50', tables).ok, true, '50% does have one');
  assert.equal(validateMaxPoints(100, '70', tables).ok, false);
  assert.equal(validateMaxPoints(0, '70', tables).ok, false);
  assert.equal(validateMaxPoints('abc', '70', tables).ok, false);
});

test('an invalid maximum names the values that would work', () => {
  const r = validateMaxPoints(20, '70', tables);
  assert.match(r.message, /no 20-point column/);
  assert.deepEqual(r.supported, [5, 10, 15, 25, 30, 35, 40, 45, 50]);
});

test('switching policy reports which assessments would be stranded', () => {
  const assessments = [
    { name: 'Quiz 1', maxPoints: 15 },
    { name: 'Midterm Project', maxPoints: 20 },
    { name: 'Attendance', maxPoints: 10 },
  ];
  const stranded = strandedByPolicy(assessments, '70', tables);
  assert.deepEqual(stranded, [{ name: 'Midterm Project', maxPoints: 20 }]);
  assert.deepEqual(strandedByPolicy(assessments, '50', tables), []);
});
