'use strict';
/**
 * Tests for policy availability and point-maximum validation.
 *
 * These encode a correctness decision: the 60% policy must not be offered
 * while two of its columns are known to be mis-transcribed.
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

test('70% is the default and the only fully verified policy', () => {
  assert.equal(DEFAULT_POLICY, '70');
  assert.equal(policyStatus('70').confidence, CONFIDENCE.VERIFIED);
  assert.equal(policyStatus('70').isDefault, true);
  const verified = allPolicies(tables).filter((p) => p.confidence === CONFIDENCE.VERIFIED);
  assert.deepEqual(verified.map((p) => p.policy), ['70']);
});

test('60% is not selectable while its columns are unverified', () => {
  assert.equal(isSelectable('60'), false);
  assert.equal(policyStatus('60').confidence, CONFIDENCE.UNVERIFIED);
  const offered = selectablePolicies(tables).map((p) => p.policy);
  assert.ok(!offered.includes('60'), '60% must not be offered in the UI');
});

test('50% is selectable but flagged as sanity-checked only', () => {
  assert.equal(isSelectable('50'), true);
  assert.equal(policyStatus('50').confidence, CONFIDENCE.SANITY_ONLY);
  assert.match(policyStatus('50').note, /not been verified against real grades/i);
});

test('the unavailable policy explains itself rather than vanishing silently', () => {
  const sixty = allPolicies(tables).find((p) => p.policy === '60');
  assert.ok(sixty, '60% should still be listed, just not selectable');
  assert.match(sixty.note, /mis-transcribed|re-transcribed/i);
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
