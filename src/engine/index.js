'use strict';
/**
 * The GradeDesk grade engine.
 *
 * Pure calculation over raw scores. No UI, no filesystem, no globals — the
 * caller loads `transmutation_tables.json` and injects it. This keeps the math
 * auditable and lets the verification test run the exact code the app runs.
 *
 * Typical use:
 *   const { TransmutationTables, computeStudent } = require('./engine');
 *   const tables = new TransmutationTables(json);
 *   const result = computeStudent(studentInput, tables, '70');
 */

const transmutation = require('./transmutation');
const grades = require('./grades');
const policy = require('./policy');
const roster = require('./roster');

module.exports = {
  ...transmutation,
  ...grades,
  ...policy,
  ...roster,
};
