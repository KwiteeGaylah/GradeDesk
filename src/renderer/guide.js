'use strict';
/**
 * Guide content.
 *
 * Written for an instructor who already grades in Excel and has never seen this
 * app. It follows the order they will actually work in, and says plainly what
 * the app does to their numbers, because the whole promise is that the grades
 * come out the same as the ones they would have worked out by hand.
 *
 * Plain content, no rendering. app.js turns these into the guide screen and the
 * first-run wizard. Loaded as a classic script before app.js, so it publishes
 * itself on `window` rather than exporting a module.
 *
 * Each section has a title, an optional lead paragraph, and blocks. A block is
 * one of: text, steps (a labelled list), keys (a shortcut table), formula, tip,
 * warn, or example.
 */

const GUIDE_SECTIONS = [
  {
    id: 'start',
    title: 'Getting started',
    lead:
      'GradeDesk does the grade sheet you already do in Excel, without the formulas. ' +
      'You type the marks. It works out the rest.',
    blocks: [
      { type: 'text', text:
        'You enter raw scores across your class list, one assessment at a time, the same ' +
        'way you would type down a column in a spreadsheet. GradeDesk looks up each score ' +
        'in the university table, averages them, applies the weights, and gives you the ' +
        'final grade and letter. At the end you export the sheet you submit.' },
      { type: 'text', text:
        'Everything is kept on this computer and saved as you type. There is no save ' +
        'button and no internet connection needed.' },
      { type: 'steps', title: 'The whole job, in four parts', items: [
        ['Set up the course once', 'Course code, section, and the assessments you use.'],
        ['Type your class list', 'Names and student IDs, in one grid.'],
        ['Enter scores as you mark', 'One assessment down the whole class.'],
        ['Export when you are done', 'The grade record, ready to hand in.'],
      ] },
      { type: 'tip', text:
        'If this is your first time, the setup wizard walks you through all four. ' +
        'You can open it again from the bottom of this page.' },
    ],
  },
  {
    id: 'setup',
    title: 'Setting up a course',
    lead: 'Describe how you grade once, at the start of term. After that you only type marks.',
    blocks: [
      { type: 'text', text:
        'A course belongs to the semester you are teaching. Create one from "New course" ' +
        'in the left panel, then open Assessments and policy to fill in the details.' },
      { type: 'steps', title: 'What you set', items: [
        ['Course code and section', 'These appear at the top of the exported sheet.'],
        ['Transmutation policy', 'Almost always 70%. It applies to the whole course.'],
        ['Assessments per term', 'Quizzes, assignments, class work, a project, attendance.'],
      ] },
      { type: 'text', text:
        'Each term already has its main exam, fixed at 40 points. You add everything ' +
        'else and name them whatever you call them on your own sheet.' },
      { type: 'warn', text:
        'A point value has to be one the university table has a column for, so the app ' +
        'only offers those. Under the 70% policy there is no 20-point column, which is ' +
        'why 20 is missing from the list.' },
      { type: 'tip', text:
        'Adding or removing an assessment never means redoing weights. Class standing is ' +
        'a straight average, so the app just averages whatever is there.' },
    ],
  },
  {
    id: 'roster',
    title: 'Your class list',
    lead: 'Type it once, or paste it if you already have it somewhere.',
    blocks: [
      { type: 'text', text:
        'Open Roster and start typing. Enter or Tab moves to the next box, and a new row ' +
        'appears when you fill the last one, so you can keep going without reaching for ' +
        'the mouse.' },
      { type: 'text', text:
        'If the list already exists, use "Paste list". Put one student on each line, with ' +
        'the ID and the name separated by a tab. Names keep their commas, so ' +
        '"Allison, Elizabeth Y." stays exactly as you wrote it.' },
      { type: 'example', title: 'A pasted list looks like this',
        lines: ['44305\tAllison, Elizabeth Y.', '38901\tAllison, Emmanuel M.', 'TU-03265\tButler, Frances E.'] },
      { type: 'steps', title: 'The boxes at the top tell you', items: [
        ['How many students', 'The total in this course.'],
        ['How many are complete', 'They have both an ID and a name.'],
        ['What is missing', 'Rows with no ID, and rows still empty.'],
      ] },
    ],
  },
  {
    id: 'offroster',
    title: 'Students not on the official roster',
    lead:
      'Sometimes you let a student sit your class before they are on the official ' +
      'roster. Flag them so you do not forget to put them on your addendum list.',
    blocks: [
      { type: 'text', text:
        'A timetable clash or a late registration can leave a student sitting your class ' +
        'without being on the official roster. You allow them in, mark them like anyone ' +
        'else, and send their name on the addendum list with your grades at the end.' },
      { type: 'text', text:
        'On the Roster screen, every student has an "On roster?" button. Click it to ' +
        'switch a student to "Not yet", and add a short note about why if you want.' },
      { type: 'steps', title: 'Once a student is flagged', items: [
        ['You see it everywhere', 'A tag next to their name on every screen.'],
        ['It is in the reminder list', 'Review issues names them every time you open it.'],
        ['It goes into the export', 'Their row is highlighted, with your note attached.'],
        ['Their grades are normal', 'The flag changes nothing about the marking.'],
      ] },
      { type: 'text', text:
        'Once you have sent the addendum and the student is on the roster properly, click ' +
        'the same button again. The flag and the highlight disappear everywhere at once.' },
      { type: 'tip', text:
        'This replaces colouring the row and adding a comment in Excel, and it will not ' +
        'get lost when you re-sort or re-export.' },
    ],
  },
  {
    id: 'entry',
    title: 'Entering scores',
    lead: 'The screen you will spend your time in. It works like a spreadsheet column.',
    blocks: [
      { type: 'text', text:
        'Pick one assessment from the dropdown at the top, then type each student’s raw ' +
        'score straight down the column. Press Enter and you drop to the next student.' },
      { type: 'text', text:
        'The white boxes are the ones you type in. Everything shaded is worked out for ' +
        'you and cannot be typed in. Those columns update the moment you leave a box, so ' +
        'you can watch a grade settle as you mark.' },
      { type: 'keys', title: 'Keys worth knowing', items: [
        ['Enter', 'Save and drop to the next student'],
        ['Tab', 'Same, and Shift+Tab goes back up'],
        ['Up and Down arrows', 'Move without changing anything'],
        ['Escape', 'Leave the box you are in'],
      ] },
      { type: 'steps', title: 'The toolbar above the list', items: [
        ['The dropdown', 'Choose which assessment you are entering.'],
        ['The arrows', 'Jump to the assessment before or after it.'],
        ['Search', 'Show one student while you fix a score.'],
        ['Sort', 'Order by name, ID, score, grade, or blanks first.'],
      ] },
      { type: 'warn', text:
        'A score above the maximum is still accepted, in case you meant it, but the box ' +
        'turns red and the student is listed under Review issues.' },
    ],
  },
  {
    id: 'attendance',
    title: 'Attendance',
    lead: 'Mark the register and the score works itself out.',
    blocks: [
      { type: 'text', text:
        'Add a session for each class meeting, then click a cell to change it. Clicking ' +
        'cycles through the marks, so you can go along a row quickly.' },
      { type: 'steps', title: 'What the marks mean', items: [
        ['P', 'Present. Full credit.'],
        ['E', 'Excused. Half credit.'],
        ['A', 'Absent. No credit.'],
        ['Blank', 'Not counted at all for that student.'],
      ] },
      { type: 'formula', title: 'How the score is worked out', rows: [
        ['Score', 'points × (P + half the E’s) ÷ sessions marked'],
      ] },
      { type: 'text', text:
        'Dividing by the sessions actually marked, rather than the whole term, keeps ' +
        'attendance fair before the term has finished. The result is rounded to a whole ' +
        'point, then treated like any other assessment.' },
      { type: 'tip', text:
        'You can add a session for a day that has already passed, which is what you do ' +
        'when entering a paper register later. The same date cannot be added twice.' },
    ],
  },
  {
    id: 'math',
    title: 'How the grade is worked out',
    lead: 'The same steps you would do by hand, in the same order.',
    blocks: [
      { type: 'text', text:
        'Every raw score is looked up in the university table for your policy and the ' +
        'assessment’s point value. The lookup snaps down: a score that falls between two ' +
        'listed values takes the lower one, exactly as VLOOKUP does in your spreadsheet.' },
      { type: 'formula', title: 'The four steps', rows: [
        ['Class standing', 'average of the transmuted scores × 0.6'],
        ['Term total', 'class standing + transmuted exam × 0.4'],
        ['Final grade', 'midterm total × 0.4 + final total × 0.6'],
        ['Letter', 'A from 90, B from 80, C from 70, D from 60, otherwise F'],
      ] },
      { type: 'tip', text:
        'Point values do not have to add up to anything. Each score is turned into a ' +
        'value between 50 and 100 first, and those are what get averaged. Three ' +
        'assessments at full marks give exactly 60, and so do five. The percentages on ' +
        'the exported sheet show each assessment’s share of that 60.' },
      { type: 'steps', title: 'Two rules that look similar but are not', items: [
        ['A blank assessment', 'Counts as 50 and stays in the average.'],
        ['A blank exam', 'Makes the letter I, whatever the numbers say.'],
      ] },
      { type: 'warn', text:
        'The final grade is shown to two decimals and never rounded up. An 89.99 stays a ' +
        'B. This is deliberate, and matches how the sheet is done by hand.' },
      { type: 'text', text:
        'NG means the grade could not be worked out at all, usually because a term has no ' +
        'assessments in it yet.' },
    ],
  },
  {
    id: 'export',
    title: 'Checking and exporting',
    lead: 'Look at the reminders first, then produce the sheet.',
    blocks: [
      { type: 'text', text:
        'Open Review issues before you export. It catches the things a spreadsheet will ' +
        'not tell you about on its own.' },
      { type: 'steps', title: 'What it looks for', items: [
        ['Scores above the maximum', 'Usually a typo that would inflate a grade.'],
        ['Missing exams', 'These force an I, listed by student.'],
        ['Blank scores', 'A reminder that they are counting as 50.'],
        ['Students not on the roster', 'Names to put on your addendum list.'],
        ['Grades that cannot be worked out', 'Shown as NG.'],
      ] },
      { type: 'steps', title: 'Two files you can produce', items: [
        ['Export grade sheet', 'The full record, every assessment and transmuted value.'],
        ['Summary sheet', 'Just ID, name, final grade and letter.'],
      ] },
      { type: 'text', text:
        'Both open in Excel and are ready to submit as they are. You do not need to ' +
        'reformat anything.' },
    ],
  },
  {
    id: 'safety',
    title: 'Keeping your work safe',
    lead: 'Nothing to remember to save, and one file to carry.',
    blocks: [
      { type: 'text', text:
        'Every score is written to disk the moment you leave the box. If the power goes ' +
        'out while you are typing, everything you had already entered is still there when ' +
        'you open the app again.' },
      { type: 'steps', title: 'Backing up', items: [
        ['Manage, then Back up', 'Writes all your data to a single file.'],
        ['Copy it somewhere', 'A flash drive is enough.'],
        ['Manage, then Restore', 'Puts it back, on this machine or another one.'],
      ] },
      { type: 'warn', text:
        'Restoring replaces everything currently in GradeDesk. You will be asked to ' +
        'confirm before it happens.' },
      { type: 'text', text:
        'Starting a new semester archives the old one rather than deleting it. You can ' +
        'open an archived semester and export from it at any time.' },
    ],
  },
];

window.GradeDeskGuide = { GUIDE_SECTIONS };
