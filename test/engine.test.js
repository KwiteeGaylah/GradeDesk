'use strict';
/**
 * Unit tests for the pure grade engine, with particular attention to the
 * documented failure points: snap-down lookup, blank handling, no rounding,
 * fixed exam max, flat equal weighting, and unsupported point maximums.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  TransmutationTables,
  BLANK_TRANSMUTED,
  isBlank,
} = require('../src/engine/transmutation');
const {
  EXAM_MAX_POINTS,
  attendanceRaw,
  classStanding,
  termTotal,
  finalGrade,
  letterGrade,
  formatGrade,
  computeStudent,
} = require('../src/engine/grades');

const tablesJson = require('../data/transmutation_tables.json');
const tables = new TransmutationTables(tablesJson);

// --------------------------------------------------------------- transmutation

test('PRD worked example: 70% policy, 10-point column', () => {
  assert.equal(tables.transmute(0, 10, '70'), 50);
  assert.equal(tables.transmute(3, 10, '70'), 59);
  assert.equal(tables.transmute(5, 10, '70'), 64);
  assert.equal(tables.transmute(8, 10, '70'), 80);
  assert.equal(tables.transmute(10, 10, '70'), 100);
});

test('lookup is snap-down, never exact-match', () => {
  // 7 -> 70 and 8 -> 80 in the 70%/10 column, so anything in [7,8) is 70.
  assert.equal(tables.transmute(7, 10, '70'), 70);
  assert.equal(tables.transmute(7.1, 10, '70'), 70);
  assert.equal(tables.transmute(7.5, 10, '70'), 70);
  assert.equal(tables.transmute(7.99, 10, '70'), 70);
  assert.equal(tables.transmute(8, 10, '70'), 80);
  // A fractional attendance score is the real-world case for this.
  assert.equal(tables.transmute(9.166666666666666, 10, '70'), 90);
});

test('blank transmutes to 50 and a real zero also transmutes to 50', () => {
  assert.equal(tables.transmute(null, 15, '70'), BLANK_TRANSMUTED);
  assert.equal(tables.transmute(undefined, 15, '70'), BLANK_TRANSMUTED);
  assert.equal(tables.transmute('', 15, '70'), BLANK_TRANSMUTED);
  assert.equal(tables.transmute('   ', 15, '70'), BLANK_TRANSMUTED);
  assert.equal(tables.transmute(0, 15, '70'), 50);
});

test('a score above the column maximum snaps to the top value', () => {
  assert.equal(tables.transmute(11, 10, '70'), 100);
  assert.equal(tables.transmute(999, 10, '70'), 100);
});

test('a negative score floors at the table minimum', () => {
  assert.equal(tables.transmute(-1, 10, '70'), 50);
});

test('string raw scores are accepted like numbers', () => {
  assert.equal(tables.transmute('8', 10, '70'), 80);
  assert.equal(tables.transmute(' 8 ', 10, '70'), 80);
});

test('supported maximums differ by policy: 70% has no 20-point column', () => {
  assert.deepEqual(tables.supportedMaximums('50'), [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
  assert.deepEqual(tables.supportedMaximums('60'), [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
  assert.deepEqual(tables.supportedMaximums('70'), [5, 10, 15, 25, 30, 35, 40, 45, 50]);
  assert.equal(tables.supports('70', 20), false);
  assert.equal(tables.supports('50', 20), true);
});

test('an unsupported point maximum throws rather than guessing a column', () => {
  assert.throws(() => tables.transmute(10, 20, '70'), /no 20-point column/);
  assert.throws(() => tables.transmute(10, 100, '70'), /no 100-point column/);
});

test('every column is monotonic and anchored at 50 and 100', () => {
  // The structural bar for all three policies, with no exemptions. These are
  // exactly the checks that caught the original mis-transcription, so they stay
  // as a standing guard against a future bad edit of the lookup data.
  for (const policy of tables.policies()) {
    for (const max of tables.supportedMaximums(policy)) {
      const col = tables.column(policy, max);
      assert.equal(col[0][0], 0, `${policy}%/${max} should start at raw 0`);
      assert.equal(col[0][1], 50, `${policy}%/${max} raw 0 should transmute to 50`);
      assert.equal(
        col.length,
        max + 1,
        `${policy}%/${max} should list every raw score from 0 to ${max}`
      );
      assert.equal(
        col[col.length - 1][0],
        max,
        `${policy}%/${max} should end at raw ${max}`
      );
      for (let i = 1; i < col.length; i++) {
        assert.ok(
          col[i][1] >= col[i - 1][1],
          `${policy}%/${max} is non-monotonic at raw ${col[i][0]}`
        );
      }
      assert.equal(
        col[col.length - 1][1],
        100,
        `${policy}%/${max}: a perfect raw score should transmute to 100`
      );
    }
  }
});

test('a stricter policy never transmutes higher than a looser one', () => {
  // 50% is the most generous curve and 70% the most demanding, so at any raw
  // score 50% >= 60% >= 70%. One documented exception: the 70% 35-point column
  // reads 99 at raw 34 where 50% and 60% read 98. That value comes from the
  // instructor's own workbook and is part of the grade-verified data, so it is
  // pinned here rather than "corrected".
  const EXCEPTIONS = new Set(['35/34']);
  const violations = [];
  for (const max of tables.supportedMaximums('70')) {
    if (!tables.supports('50', max) || !tables.supports('60', max)) continue;
    for (const [raw] of tables.column('70', max)) {
      const a = tables.transmute(raw, max, '50');
      const b = tables.transmute(raw, max, '60');
      const c = tables.transmute(raw, max, '70');
      if (EXCEPTIONS.has(`${max}/${raw}`)) continue;
      if (!(a >= b && b >= c)) {
        violations.push(`${max}pt raw ${raw}: 50%=${a} 60%=${b} 70%=${c}`);
      }
    }
  }
  assert.deepEqual(violations, [], `${violations.length} ordering violation(s)`);
});

// ------------------------------------------------------------------ attendance

test('attendance: P full, E half, other zero, blank excluded', () => {
  assert.equal(attendanceRaw(['P', 'P', 'P', 'P'], 10), 10);
  assert.equal(attendanceRaw(['A', 'A'], 10), 0);
  assert.equal(attendanceRaw(['P', 'A'], 10), 5);
  assert.equal(attendanceRaw(['E', 'E'], 10), 5);
  // 5 P + 1 E over 6 marked sessions
  assert.equal(attendanceRaw(['P', 'P', 'P', 'E', 'P', 'P'], 10), (10 * 5.5) / 6);
});

test('attendance denominator counts marked sessions, not planned ones', () => {
  // Two blanks are excluded entirely: 2 of 2 marked, not 2 of 4.
  assert.equal(attendanceRaw(['P', 'P', '', null], 10), 10);
  assert.equal(attendanceRaw(['P', 'A', '', null], 10), 5);
});

test('attendance with nothing marked yet is blank, not zero', () => {
  assert.equal(attendanceRaw([], 10), null);
  assert.equal(attendanceRaw(['', null, '  '], 10), null);
});

test('attendance marks are case-insensitive', () => {
  assert.equal(attendanceRaw(['p', 'e'], 10), (10 * 1.5) / 2);
});

test('attendance points are configurable', () => {
  assert.equal(attendanceRaw(['P', 'P'], 15), 15);
  assert.equal(attendanceRaw(['P', 'A'], 5), 2.5);
});

// -------------------------------------------------------------- class standing

test('class standing is a flat equal-weight average times 0.6', () => {
  // Two 10-point assessments: raw 10 -> 100 and raw 0 -> 50. Average 75 * 0.6.
  const cs = classStanding(
    [
      { raw: 10, maxPoints: 10 },
      { raw: 0, maxPoints: 10 },
    ],
    tables,
    '70'
  );
  assert.equal(cs, 75 * 0.6);
});

test('assessments of different maxima still count equally', () => {
  // A 10-point and a 25-point assessment both at full marks -> both 100.
  const cs = classStanding(
    [
      { raw: 10, maxPoints: 10 },
      { raw: 25, maxPoints: 25 },
    ],
    tables,
    '70'
  );
  assert.equal(cs, 100 * 0.6);
});

test('a blank assessment counts as 50 in the average, it is not skipped', () => {
  const withBlank = classStanding(
    [
      { raw: 10, maxPoints: 10 },
      { raw: null, maxPoints: 10 },
    ],
    tables,
    '70'
  );
  const skipped = classStanding([{ raw: 10, maxPoints: 10 }], tables, '70');
  assert.equal(withBlank, 75 * 0.6);
  assert.equal(skipped, 100 * 0.6);
  assert.notEqual(withBlank, skipped);
});

test('a term with no class-standing assessments has no class standing', () => {
  assert.equal(classStanding([], tables, '70'), null);
});

// ------------------------------------------------------------------ term total

test('term total is class standing plus transmuted exam times 0.4', () => {
  const assessments = [{ raw: 10, maxPoints: 10 }]; // -> 100, cs = 60
  const total = termTotal(assessments, 40, tables, '70'); // exam 40/40 -> 100
  assert.equal(total, 60 + 100 * 0.4);
});

test('the exam max is fixed at 40', () => {
  assert.equal(EXAM_MAX_POINTS, 40);
  // A blank exam still contributes 50 to the term total.
  const total = termTotal([{ raw: 10, maxPoints: 10 }], null, tables, '70');
  assert.equal(total, 60 + 50 * 0.4);
});

// ----------------------------------------------------------------- final grade

test('final grade weights midterm 40% and final term 60%', () => {
  assert.equal(finalGrade(100, 100), 100);
  assert.equal(finalGrade(0, 100), 60);
  assert.equal(finalGrade(100, 0), 40);
  assert.ok(Math.abs(finalGrade(85.2, 93.85) - 90.39) < 1e-9);
});

test('final grade is null when a term cannot be computed', () => {
  assert.equal(finalGrade(null, 90), null);
  assert.equal(finalGrade(90, null), null);
  assert.equal(finalGrade(NaN, 90), null);
});

// --------------------------------------------------------------------- letters

test('letter grade boundaries are inclusive at the lower bound', () => {
  const L = (g) => letterGrade(g, 30, 30);
  assert.equal(L(100), 'A');
  assert.equal(L(90), 'A');
  assert.equal(L(89.99), 'B');
  assert.equal(L(80), 'B');
  assert.equal(L(79.99), 'C');
  assert.equal(L(70), 'C');
  assert.equal(L(69.99), 'D');
  assert.equal(L(60), 'D');
  assert.equal(L(59.99), 'F');
  assert.equal(L(0), 'F');
});

test('a blank exam forces I regardless of the computed grade', () => {
  assert.equal(letterGrade(99, null, 30), 'I');
  assert.equal(letterGrade(99, 30, null), 'I');
  assert.equal(letterGrade(99, '', ''), 'I');
  assert.equal(letterGrade(20, null, null), 'I');
  // A real zero on the exam is NOT blank.
  assert.equal(letterGrade(65, 0, 0), 'D');
});

test('an uncomputable grade is NG when both exams were sat', () => {
  assert.equal(letterGrade(null, 30, 30), 'NG');
  assert.equal(letterGrade(undefined, 30, 30), 'NG');
  // I wins over NG.
  assert.equal(letterGrade(null, null, 30), 'I');
});

// ------------------------------------------------------------------ formatting

test('the final grade is truncated to two decimals, never rounded', () => {
  assert.equal(formatGrade(82.18), '82.18');
  assert.equal(formatGrade(89.999), '89.99');
  assert.equal(formatGrade(89.995), '89.99');
  assert.equal(formatGrade(59.999), '59.99');
  assert.equal(formatGrade(100), '100.00');
  assert.equal(formatGrade(0), '0.00');
});

test('float artefacts still display as the intended hundredth', () => {
  // Binary floating point cannot represent most decimals exactly, so a value
  // whose true result is 81.48 can arrive as 81.47999999999999 (one ulp low).
  // Seven real students in the fixture workbook land on such values. Truncating
  // those blindly would show a hundredth less than the instructor's own sheet,
  // so formatGrade absorbs an ulp-scale error before truncating.
  assert.equal(formatGrade(83.022), '83.02');
  assert.equal(formatGrade(82.24600000000001), '82.24');
  assert.equal(formatGrade(86.53999999999999), '86.54');
  assert.equal(formatGrade(81.47999999999999), '81.48');
  assert.equal(formatGrade(90.66999999999999), '90.67');
});

test('the epsilon absorbs only float noise, never a real hundredth', () => {
  // The guard above must not become a rounding step in disguise: a genuine
  // value below a boundary still truncates down, including at a letter edge.
  assert.equal(formatGrade(81.479), '81.47');
  assert.equal(formatGrade(81.4799999), '81.47');
  assert.equal(formatGrade(89.999), '89.99');
  assert.equal(formatGrade(89.9999999), '89.99');
  assert.equal(formatGrade(59.9999999), '59.99');
});

test('a missing grade formats as empty', () => {
  assert.equal(formatGrade(null), '');
  assert.equal(formatGrade(undefined), '');
  assert.equal(formatGrade(NaN), '');
});

// -------------------------------------------------------------- whole student

test('computeStudent ties the whole model together', () => {
  const r = computeStudent(
    {
      midtermAssessments: [
        { raw: 10, maxPoints: 10 },
        { raw: 10, maxPoints: 10 },
        { raw: 11, maxPoints: 15 },
        { raw: 15, maxPoints: 15 },
        { raw: 8, maxPoints: 10 },
      ],
      midtermExamRaw: 31,
      finalAssessments: [
        { raw: 10, maxPoints: 10 },
        { raw: 10, maxPoints: 10 },
        { raw: 15, maxPoints: 15 },
        { raw: 23, maxPoints: 25 },
      ],
      finalExamRaw: 35,
    },
    tables,
    '70'
  );
  assert.equal(r.midtermClassStanding, 54);
  assert.equal(r.midtermTotal, 85.2);
  assert.equal(r.finalTotal, 93.85);
  assert.equal(r.finalGradeDisplay, '90.39');
  assert.equal(r.letter, 'A');
});

test('computeStudent marks a blank exam as I while still totalling the term', () => {
  const r = computeStudent(
    {
      midtermAssessments: [{ raw: 10, maxPoints: 10 }],
      midtermExamRaw: null,
      finalAssessments: [{ raw: 10, maxPoints: 10 }],
      finalExamRaw: 30,
    },
    tables,
    '70'
  );
  assert.equal(r.letter, 'I');
  assert.ok(Number.isFinite(r.finalGrade), 'the number is still computed and shown');
  assert.equal(r.midtermExamTransmuted, 50);
});

// ------------------------------------------------------------------- purity

test('the engine has no UI or filesystem dependencies', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', 'src', 'engine');
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    const requires = [...src.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
    for (const r of requires) {
      assert.ok(
        r.startsWith('.'),
        `src/engine/${file} requires "${r}"; the engine must stay pure and dependency-free`
      );
    }
    assert.ok(!/\bdocument\b|\bwindow\b|require\(['"]electron/.test(src), `${file} touches UI globals`);
  }
});

test('isBlank distinguishes blank from zero', () => {
  assert.equal(isBlank(null), true);
  assert.equal(isBlank(undefined), true);
  assert.equal(isBlank(''), true);
  assert.equal(isBlank('  '), true);
  assert.equal(isBlank(0), false);
  assert.equal(isBlank('0'), false);
});
