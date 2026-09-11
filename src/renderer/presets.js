'use strict';
/*
 * GENERATED FROM src/engine/presets.js - do not edit here.
 * Regenerate with: npm run build:presets
 *
 * The renderer has no module system and needs the preset list synchronously
 * while it paints, so the engine module is mirrored here rather than fetched
 * over IPC. A test asserts the two stay in step.
 */

/**
 * Assessment presets: the starting sets a course can be built from.
 *
 * These used to live inline in the setup wizard, which meant you saw them once
 * when the course was created and never again. Adding the same five rows to a
 * second course meant typing them out. They are here so the wizard and the
 * assessments screen offer the same thing, and so changing one changes both.
 *
 * Point values are all columns the 70% table actually has. A preset is a
 * starting point, not a rule: every row can be renamed, repointed or removed
 * afterwards, and nothing downstream depends on which preset was used.
 *
 * Pure data with no UI or IO, so the renderer and the tests read the same list.
 */

/**
 * The point maxima that exist in every published table, so a preset never
 * lands on a column some policy is missing. Checked by a test.
 */
const SAFE_POINTS = [5, 10, 15, 25, 30, 35, 40, 45, 50];

const PRESETS = [
  {
    id: 'typical',
    label: 'Typical',
    summary: 'Attendance, one assignment, two quizzes, class work',
    assessments: [
      { name: 'Attendance', maxPoints: 10, kind: 'attendance' },
      { name: 'Assign 1', maxPoints: 10 },
      { name: 'Quiz 1', maxPoints: 15 },
      { name: 'Quiz 2', maxPoints: 15 },
      { name: 'ClassWork', maxPoints: 10 },
    ],
  },
  {
    id: 'minimal',
    label: 'Minimal',
    summary: 'Attendance and one assignment',
    assessments: [
      { name: 'Attendance', maxPoints: 10, kind: 'attendance' },
      { name: 'Assign 1', maxPoints: 10 },
    ],
  },
  {
    id: 'quiz-heavy',
    label: 'Quiz heavy',
    summary: 'Attendance and four quizzes',
    assessments: [
      { name: 'Attendance', maxPoints: 10, kind: 'attendance' },
      { name: 'Quiz 1', maxPoints: 15 },
      { name: 'Quiz 2', maxPoints: 15 },
      { name: 'Quiz 3', maxPoints: 15 },
      { name: 'Quiz 4', maxPoints: 15 },
    ],
  },
  {
    id: 'project',
    label: 'Project based',
    summary: 'Attendance, class work and a project',
    assessments: [
      { name: 'Attendance', maxPoints: 10, kind: 'attendance' },
      { name: 'ClassWork', maxPoints: 10 },
      { name: 'Project', maxPoints: 25 },
    ],
  },
];

/** Every preset, newest callers should treat this as read-only. */
function listPresets() {
  return PRESETS.map((p) => ({ ...p, assessments: p.assessments.map((a) => ({ ...a })) }));
}

/** One preset by id, or null. Returns copies so a caller cannot mutate the source. */
function getPreset(id) {
  const found = PRESETS.find((p) => p.id === id);
  return found ? { ...found, assessments: found.assessments.map((a) => ({ ...a })) } : null;
}

window.GradeDeskPresets = {
  listPresets,
  getPreset,
  SAFE_POINTS,
};
