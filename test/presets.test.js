'use strict';
/**
 * Assessment presets.
 *
 * A preset that lands on a point value some policy has no column for would
 * fail to transmute the moment someone switched tables, so the point values
 * are checked against the real published tables rather than trusted.
 */

const test = require('node:test');
const assert = require('node:assert');

const { listPresets, getPreset, SAFE_POINTS, TransmutationTables } = require('../src/engine');

const tables = new TransmutationTables(require('../data/transmutation_tables.json'));
const POLICIES = ['50', '60', '70'];

test('every preset point value exists in every published table', () => {
  const bad = [];
  for (const preset of listPresets()) {
    for (const a of preset.assessments) {
      for (const policy of POLICIES) {
        try {
          tables.transmute(a.maxPoints, a.maxPoints, policy);
        } catch (err) {
          bad.push(`${preset.id}/${a.name} (${a.maxPoints} pts) has no ${policy}% column`);
        }
      }
    }
  }
  assert.deepEqual(bad, [], bad.join('; '));
});

test('the declared safe point list really is safe in every table', () => {
  const bad = [];
  for (const points of SAFE_POINTS) {
    for (const policy of POLICIES) {
      try {
        tables.transmute(points, points, policy);
      } catch {
        bad.push(`${points} pts missing from ${policy}%`);
      }
    }
  }
  assert.deepEqual(bad, [], bad.join('; '));
});

test('no preset carries two attendance rows', () => {
  // Two attendance assessments would each auto-compute from the same register
  // and both land in the average, counting attendance twice.
  for (const preset of listPresets()) {
    const n = preset.assessments.filter((a) => a.kind === 'attendance').length;
    assert.ok(n <= 1, `${preset.id} has ${n} attendance rows`);
  }
});

test('no preset includes an exam', () => {
  // Every term is created with its own fixed 40-point exam. A preset adding a
  // second one would break the one-exam index.
  for (const preset of listPresets()) {
    assert.equal(preset.assessments.filter((a) => a.kind === 'exam').length, 0, preset.id);
  }
});

test('presets are copies, so a caller cannot corrupt the shared list', () => {
  const first = getPreset('typical');
  first.assessments[0].name = 'Mutated';
  first.assessments.push({ name: 'Injected', maxPoints: 10 });
  const second = getPreset('typical');
  assert.equal(second.assessments[0].name, 'Attendance');
  assert.equal(second.assessments.length, 5);
});

test('every preset has an id, a label and at least one assessment', () => {
  const ids = new Set();
  for (const p of listPresets()) {
    assert.ok(p.id && typeof p.id === 'string', 'id');
    assert.ok(p.label && typeof p.label === 'string', `${p.id} label`);
    assert.ok(p.summary && typeof p.summary === 'string', `${p.id} summary`);
    assert.ok(p.assessments.length > 0, `${p.id} has rows`);
    assert.ok(!ids.has(p.id), `${p.id} is unique`);
    ids.add(p.id);
  }
});

test('getPreset returns null for an unknown id rather than throwing', () => {
  assert.equal(getPreset('does-not-exist'), null);
});

test('the renderer copy of the presets matches the engine', () => {
  // Same arrangement as the date helpers: the renderer has no module system,
  // so src/renderer/presets.js is generated from the engine module. If someone
  // edits one, the two must not drift.
  const fs = require('fs');
  const path = require('path');
  const engine = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'engine', 'presets.js'), 'utf8');
  const renderer = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'presets.js'), 'utf8');

  // Compare only the body, since the header comment and the export tail differ
  // by design.
  const body = (text) => {
    const start = text.indexOf('const SAFE_POINTS');
    const endExport = text.indexOf('module.exports');
    const endWindow = text.indexOf('window.GradeDeskPresets');
    const end = [endExport, endWindow].filter((i) => i > -1).sort((a, b) => a - b)[0];
    return text.slice(start, end === undefined ? text.length : end).trim();
  };

  assert.equal(
    body(renderer),
    body(engine),
    'run `npm run build:presets` after changing src/engine/presets.js'
  );
});
