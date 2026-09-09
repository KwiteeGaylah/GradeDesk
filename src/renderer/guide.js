'use strict';
/* eslint-disable no-unused-vars */
/**
 * Guide content.
 *
 * Written for an instructor who already grades in Excel and has never seen this
 * app. It explains the workflow in the order they will actually do it, and says
 * plainly what the app does to their numbers, because the whole promise is that
 * the grades come out the same as the ones they would have computed by hand.
 *
 * Plain content, no rendering. app.js turns these into the guide dialog and the
 * first-run wizard. Loaded as a classic script before app.js, so it publishes
 * itself on `window` rather than exporting a module.
 */

/** The tutorial, as sections. Kept as data so the same content can be searched. */
const GUIDE_SECTIONS = [
  {
    id: 'start',
    title: 'What GradeDesk does',
    body: [
      'You type raw scores across your class list, one assessment at a time, exactly ' +
        'as you would down a column in Excel. GradeDesk does the transmutation, the ' +
        'averaging and the weighting, and produces the grade sheet you submit.',
      'Everything is saved on this computer as you type. It works with no internet ' +
        'connection, and nothing is ever sent anywhere.',
    ],
    steps: [
      ['Set up a course once', 'Course code, section, and the assessments you use.'],
      ['Type your class list', 'Names and IDs, in one grid.'],
      ['Enter scores as you mark', 'One assessment down the whole class.'],
      ['Export at the end', 'The familiar grade record, ready to submit.'],
    ],
  },
  {
    id: 'setup',
    title: 'Setting up a course',
    body: [
      'A course belongs to the active semester. Create it from “New course…” in the ' +
        'left rail, then open Assessments & policy to describe how you grade.',
      'Each term already has its major exam, fixed at 40 points. You add the rest: ' +
        'quizzes, assignments, class work, a project, attendance. Name them whatever ' +
        'you call them on your own sheet.',
      'A point value must be one the transmutation table has a column for, so the app ' +
        'only offers those. Under the 70% policy there is no 20-point column, which is ' +
        'why 20 is not in the list.',
    ],
    steps: [
      ['Transmutation policy', 'Usually 70%. It applies to the whole course.'],
      ['Add assessments per term', 'Midterm and final are configured separately.'],
      ['Attendance is optional', 'Add it if you want it scored automatically.'],
    ],
  },
  {
    id: 'roster',
    title: 'Your class list',
    body: [
      'Open Roster and type. Enter or Tab moves to the next cell, and a new row appears ' +
        'when you fill the last one, so you can keep typing without reaching for the mouse.',
      'If you already have the list somewhere, use “Paste list”. Put one student per line, ' +
        'with the ID and the name separated by a tab. Names keep their commas, so ' +
        '“Allison, Elizabeth Y.” stays exactly as written.',
    ],
  },
  {
    id: 'entry',
    title: 'Entering scores',
    body: [
      'This is the screen you will spend your time in. Pick one assessment from the ' +
        'dropdown, then type each student’s raw score straight down the column. Enter ' +
        'drops to the next student.',
      'The grey columns are computed and cannot be typed in. They update the moment you ' +
        'leave a cell, so you can watch a grade settle as you mark.',
      'A score above the assessment maximum is accepted but flagged in red, in case it ' +
        'was deliberate. It is also listed under Review issues.',
    ],
    steps: [
      ['Enter or ↓', 'Move to the next student.'],
      ['Tab / Shift+Tab', 'Move down or back up the column.'],
      ['‹ ›', 'Move to the previous or next assessment.'],
      ['Search box', 'Narrow the list to one student while you fix a score.'],
    ],
  },
  {
    id: 'attendance',
    title: 'Attendance',
    body: [
      'Add a session for each class meeting, then click a cell to cycle it: P for present, ' +
        'E for excused at half credit, A for absent, or blank if the student was not ' +
        'considered that day.',
      'The score is points × (P + half the E’s) ÷ the sessions actually marked. Dividing ' +
        'by the sessions marked rather than the whole term means attendance is fair ' +
        'before the term has finished.',
      'The result is rounded to a whole point and then behaves like any other assessment: ' +
        'transmuted through the table and averaged in equally.',
      'You can add a session for a past date, which is what you will do when entering a ' +
        'paper register later. The same date cannot be added twice.',
    ],
  },
  {
    id: 'math',
    title: 'How the grade is worked out',
    body: [
      'Every raw score is looked up in the university transmutation table for your policy ' +
        'and the assessment’s point value. The lookup snaps down: a score between two ' +
        'listed values takes the lower one, exactly as VLOOKUP does in your spreadsheet.',
      'A blank assessment counts as 50, it is not skipped. A blank exam is different: it ' +
        'makes the letter grade I, whatever the numbers say.',
    ],
    formula: [
      ['Class standing', 'average of the transmuted assessment scores × 0.6'],
      ['Term total', 'class standing + transmuted exam × 0.4'],
      ['Final grade', 'midterm total × 0.4 + final total × 0.6'],
      ['Letter', 'A from 90, B from 80, C from 70, D from 60, otherwise F'],
    ],
    note:
      'The final grade is shown to two decimals and is never rounded up, so a 89.99 ' +
      'stays a B. This matches how the grade sheet is done by hand.',
  },
  {
    id: 'export',
    title: 'Checking and exporting',
    body: [
      'Before you export, open Review issues. It lists the things a spreadsheet will not ' +
        'catch on its own: a score above its maximum, a missing exam that forces an I, ' +
        'students with blank scores, and any grade that cannot be computed.',
      '“Export grade sheet” writes the full record with every assessment and its ' +
        'transmuted value. “Summary sheet” writes just ID, name, final grade and letter. ' +
        'Both open in Excel and are ready to submit without further formatting.',
    ],
  },
  {
    id: 'safety',
    title: 'Keeping your work safe',
    body: [
      'Every score is written to disk the moment you leave the cell. There is no save ' +
        'button because there is nothing to forget: if the power goes out mid-typing, ' +
        'everything already entered is still there when you reopen the app.',
      'Use Manage → Back up to write all your data to a single file. Copy it to a flash ' +
        'drive and it will restore onto another computer. Do this at the end of a ' +
        'marking session and at the end of term.',
      'Starting a new semester archives the old one. Nothing is deleted, and an archived ' +
        'semester can still be opened and re-exported at any time.',
    ],
  },
];

/** Steps of the first-run wizard, in order. */
const WIZARD_STEPS = ['welcome', 'semester', 'course', 'assessments', 'roster', 'done'];

window.GradeDeskGuide = { GUIDE_SECTIONS, WIZARD_STEPS };
