'use strict';
/**
 * THE VERIFICATION TEST — the backbone of this project.
 *
 * Reads the instructor's real semester workbook, takes ONLY the raw scores,
 * runs them through the pure grade engine, and asserts that every computed
 * final grade and letter matches what the workbook already stores, for every
 * student in every section.
 *
 * If this test fails, the ENGINE is wrong, not the test. Never relax an
 * assertion here to make it pass.
 *
 * Bar: 167 students across 6 sections, zero mismatches. (The spec quotes 114;
 * the workbook actually contains 167 students, all with stored final grades,
 * so the bar is set at the stricter real count.)
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { TransmutationTables } = require('../src/engine/transmutation');
const { computeStudent, formatGrade } = require('../src/engine/grades');
const { loadWorkbook } = require('./workbook-fixture');

const tablesJson = require('../data/transmutation_tables.json');

/** The workbook uses the 70% policy throughout. */
const POLICY = '70';

/** Expected totals. A drop in either means data or extraction regressed. */
const EXPECTED_SECTIONS = 6;
const EXPECTED_STUDENTS = 167;

/** Grades are compared exactly, to floating-point tolerance only. */
const EPSILON = 1e-9;

let sections;
let tables;

test.before(async () => {
  tables = new TransmutationTables(tablesJson);
  sections = await loadWorkbook();
});

test('workbook fixture loads the expected shape', () => {
  assert.equal(sections.length, EXPECTED_SECTIONS, 'section count');
  const total = sections.reduce((n, s) => n + s.students.length, 0);
  assert.equal(total, EXPECTED_STUDENTS, 'student count');

  for (const section of sections) {
    for (const a of [...section.midtermAssessments, ...section.finalAssessments]) {
      assert.ok(
        Number.isFinite(a.maxPoints),
        `${section.name}: could not determine point maximum for "${a.name}"`
      );
      assert.ok(
        tables.supports(POLICY, a.maxPoints),
        `${section.name}: policy ${POLICY}% has no ${a.maxPoints}-point column (assessment "${a.name}")`
      );
    }
    for (const s of section.students) {
      assert.ok(
        s.storedFinalGrade !== null && Number.isFinite(Number(s.storedFinalGrade)),
        `${section.name} row ${s.row}: ${s.fullName} has no stored final grade to verify against`
      );
    }
  }
});

test('engine reproduces every stored final grade exactly', () => {
  const mismatches = [];
  let checked = 0;

  for (const section of sections) {
    for (const s of section.students) {
      const result = computeStudent(
        {
          midtermAssessments: s.midtermRaw.map((raw, i) => ({
            raw,
            maxPoints: section.midtermAssessments[i].maxPoints,
          })),
          midtermExamRaw: s.midtermExamRaw,
          finalAssessments: s.finalRaw.map((raw, i) => ({
            raw,
            maxPoints: section.finalAssessments[i].maxPoints,
          })),
          finalExamRaw: s.finalExamRaw,
        },
        tables,
        POLICY
      );
      checked += 1;

      const expected = Number(s.storedFinalGrade);
      if (result.finalGrade === null || Math.abs(result.finalGrade - expected) > EPSILON) {
        mismatches.push(
          `${section.name} row ${s.row} ${s.fullName}: ` +
            `computed ${result.finalGrade} expected ${expected}`
        );
      }
    }
  }

  assert.equal(checked, EXPECTED_STUDENTS, 'students checked');
  assert.deepEqual(mismatches, [], `${mismatches.length} final-grade mismatch(es)`);
});

test('engine reproduces every stored letter grade exactly', () => {
  const mismatches = [];

  for (const section of sections) {
    for (const s of section.students) {
      const result = computeStudent(
        {
          midtermAssessments: s.midtermRaw.map((raw, i) => ({
            raw,
            maxPoints: section.midtermAssessments[i].maxPoints,
          })),
          midtermExamRaw: s.midtermExamRaw,
          finalAssessments: s.finalRaw.map((raw, i) => ({
            raw,
            maxPoints: section.finalAssessments[i].maxPoints,
          })),
          finalExamRaw: s.finalExamRaw,
        },
        tables,
        POLICY
      );

      if (s.storedLetter && result.letter !== s.storedLetter) {
        mismatches.push(
          `${section.name} row ${s.row} ${s.fullName}: ` +
            `computed "${result.letter}" expected "${s.storedLetter}"`
        );
      }
    }
  }

  assert.deepEqual(mismatches, [], `${mismatches.length} letter-grade mismatch(es)`);
});

test('engine reproduces intermediate class standings and term totals', () => {
  // Not strictly required by the spec, but if an intermediate drifts while the
  // final still matches, something is compensating and we want to know.
  const mismatches = [];

  for (const section of sections) {
    for (const s of section.students) {
      const result = computeStudent(
        {
          midtermAssessments: s.midtermRaw.map((raw, i) => ({
            raw,
            maxPoints: section.midtermAssessments[i].maxPoints,
          })),
          midtermExamRaw: s.midtermExamRaw,
          finalAssessments: s.finalRaw.map((raw, i) => ({
            raw,
            maxPoints: section.finalAssessments[i].maxPoints,
          })),
          finalExamRaw: s.finalExamRaw,
        },
        tables,
        POLICY
      );

      const pairs = [
        ['midterm class standing', result.midtermClassStanding, s.storedMidtermClassStanding],
        ['midterm total', result.midtermTotal, s.storedMidtermTotal],
        ['final class standing', result.finalClassStanding, s.storedFinalClassStanding],
        ['final total', result.finalTotal, s.storedFinalTotal],
      ];
      for (const [label, got, stored] of pairs) {
        if (stored === null || stored === undefined) continue;
        if (got === null || Math.abs(got - Number(stored)) > EPSILON) {
          mismatches.push(
            `${section.name} row ${s.row} ${s.fullName} ${label}: computed ${got} expected ${stored}`
          );
        }
      }
    }
  }

  assert.deepEqual(mismatches, [], `${mismatches.length} intermediate mismatch(es)`);
});

test('every blank exam produces an I, and only those', () => {
  const isBlankRaw = (v) => v === null || v === undefined || String(v).trim() === '';
  let blankExamStudents = 0;

  for (const section of sections) {
    for (const s of section.students) {
      const blank = isBlankRaw(s.midtermExamRaw) || isBlankRaw(s.finalExamRaw);
      if (blank) blankExamStudents += 1;
      if (!s.storedLetter) continue;
      if (blank) {
        assert.equal(
          s.storedLetter,
          'I',
          `${section.name} row ${s.row} ${s.fullName}: blank exam should store I`
        );
      } else {
        assert.notEqual(
          s.storedLetter,
          'I',
          `${section.name} row ${s.row} ${s.fullName}: I without a blank exam`
        );
      }
    }
  }
  assert.ok(blankExamStudents > 0, 'fixture should exercise the blank-exam path');
});

test('final grade display is two decimals, truncated not rounded', () => {
  for (const section of sections) {
    for (const s of section.students) {
      const expected = Number(s.storedFinalGrade);
      const shown = formatGrade(expected);
      assert.match(shown, /^-?\d+\.\d{2}$/, `${s.fullName}: "${shown}" is not 2dp`);
      // Truncation never exceeds the true value.
      assert.ok(
        Number(shown) <= expected + 1e-9,
        `${s.fullName}: displayed ${shown} exceeds computed ${expected} (rounding up)`
      );
      assert.ok(
        expected - Number(shown) < 0.01 + 1e-9,
        `${s.fullName}: displayed ${shown} is more than one hundredth below ${expected}`
      );
    }
  }
});
