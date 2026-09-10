'use strict';
/**
 * Excel export, in the WVSTU layout the instructor already submits.
 *
 * Two outputs:
 *   1. Full grade record — every assessment with its transmuted column, class
 *      standing, term totals, final grade and letter, laid out like the real
 *      workbook (title block, term banner, weight row, header row, students).
 *   2. Summary sheet — ID, name, final grade, letter.
 *
 * Both are written as values, not formulas. The engine has already computed
 * everything and is the verified authority; re-deriving in Excel would create a
 * second implementation that could disagree with the one under test.
 *
 * The final grade is written as TEXT, deliberately. It must read exactly to two
 * decimals with no rounding, and a numeric cell with a "0.00" format would round
 * 89.999 up to 90.00 on display, showing a B as if it were an A.
 */

const ExcelJS = require('exceljs');
const { formatGrade } = require('../engine');

const UNIVERSITY = 'William V.S. Tubman University';

const THIN = { style: 'thin', color: { argb: 'FFB7BFCC' } };
const HAIR = { style: 'hair', color: { argb: 'FFD8DEE7' } };
const MEDIUM = { style: 'medium', color: { argb: 'FF8C97A7' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const BORDER_LIGHT = { top: HAIR, left: HAIR, bottom: HAIR, right: HAIR };

const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

/*
 * The palette follows the instructor's own workbook, so the exported sheet
 * looks like the one they already submit:
 *   blue banner across each term, a percentage weight row under it,
 *   orange for every transmuted column, green for class standing and totals,
 *   pink for the exam column.
 */
const FILL_HEADER = fill('FFFFFFFF');       // header cells are white with a rule
const FILL_TERMBAND = fill('FF2F75B5');     // the blue "Mid-Term" / "Final-Term" bar
const FILL_TRANSMUTED = fill('FFFFC000');   // orange, as in the workbook
const FILL_STANDING = fill('FFC6EFCE');     // green: class standing and totals
const FILL_EXAM = fill('FFFFC7CE');         // pink: the exam column
const FILL_WEIGHT = fill('FFFFFFFF');
const FILL_BAND = fill('FFF2F2F2');         // every other student row
const FILL_FLAGGED = fill('FFFFF2CC');      // a student not on the official roster
const FILL_TITLE = fill('FF2F6D4F');        // brand green title bar

/** Letter grades are tinted the same way they are on screen. */
const LETTER_FILL = {
  A: fill('FFE2F0E8'),
  B: fill('FFE6EEF7'),
  C: fill('FFFCF3E0'),
  D: fill('FFF8EBE2'),
  F: fill('FFF7E3E0'),
  I: fill('FFECEFF3'),
  NG: fill('FFECEFF3'),
};
const LETTER_COLOR = {
  A: 'FF1F6B45', B: 'FF2B5B93', C: 'FF8A5A10',
  D: 'FF9A5322', F: 'FF993229', I: 'FF5B6472', NG: 'FF5B6472',
};

/** A number written for display: blank stays blank rather than becoming 0. */
function num(v) {
  return v === null || v === undefined || Number.isNaN(v) ? null : v;
}

/**
 * "CSE 102" plus section 2 becomes "CSE 102 Sec. 2", but a code the instructor
 * already wrote as "CSE 102 Sec. 2" is left alone rather than becoming
 * "CSE 102 Sec. 2 Sec. 2".
 */
function courseLabel(course, separator = ' Sec. ') {
  const code = (course.code || '').trim();
  const section = (course.section || '').trim();
  if (!section) return code;
  if (new RegExp(`\\bsec\\.?\\s*${section}\\b`, 'i').test(code)) return code;
  return `${code}${separator}${section}`;
}

function styleHeaderCell(cell) {
  cell.font = { bold: true, size: 10, color: { argb: 'FF1B2230' } };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.fill = FILL_HEADER;
  cell.border = { top: THIN, left: THIN, bottom: MEDIUM, right: THIN };
}

/** Style a letter-grade cell to match the on-screen badge. */
function styleLetterCell(cell, letter) {
  cell.fill = LETTER_FILL[letter] || LETTER_FILL.NG;
  cell.font = { size: 10, bold: true, color: { argb: LETTER_COLOR[letter] || 'FF5B6472' } };
  cell.alignment = { horizontal: 'center' };
}

/**
 * Build the full grade record sheet.
 * @param {object} result  output of gradebook.computeCourse
 */
function buildGradeRecord(workbook, result) {
  const { course, terms, students } = result;
  const sheetName = (courseLabel(course, ' Sec ') || 'Course')
    .replace(/[\\/*?:[\]]/g, '-')
    .slice(0, 31);
  const ws = workbook.addWorksheet(sheetName, {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 5 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const midAssessments = terms.midterm.classStanding;
  const finAssessments = terms.final.classStanding;

  // Column plan: No, ID, Name | (raw, transmuted) per midterm assessment |
  // class standing, exam raw, exam transmuted, midterm total | same for final |
  // final grade, letter.
  const columns = [];
  columns.push({ key: 'no', header: 'No.', width: 5 });
  columns.push({ key: 'id', header: 'ID', width: 12 });
  columns.push({ key: 'name', header: 'FullName', width: 28 });

  const midStart = columns.length + 1;
  for (const a of midAssessments) {
    columns.push({ key: `m_raw_${a.id}`, header: a.name, width: 11 });
    columns.push({ key: `m_t_${a.id}`, header: 'Transmuted', width: 11 });
  }
  columns.push({ key: 'm_cs', header: 'Class Standing', width: 12 });
  columns.push({ key: 'm_exam', header: terms.midterm.exam ? terms.midterm.exam.name : 'Midterm Exam', width: 11 });
  columns.push({ key: 'm_exam_t', header: 'Transmuted', width: 11 });
  columns.push({ key: 'm_total', header: 'Total Mid-term Marks', width: 13 });
  const midEnd = columns.length;

  const finStart = columns.length + 1;
  for (const a of finAssessments) {
    columns.push({ key: `f_raw_${a.id}`, header: a.name, width: 11 });
    columns.push({ key: `f_t_${a.id}`, header: 'Transmuted', width: 11 });
  }
  columns.push({ key: 'f_cs', header: 'Class Standing', width: 12 });
  columns.push({ key: 'f_exam', header: terms.final.exam ? terms.final.exam.name : 'Final Exam', width: 11 });
  columns.push({ key: 'f_exam_t', header: 'Transmuted', width: 11 });
  columns.push({ key: 'f_total', header: 'Total Final-term', width: 13 });
  const finEnd = columns.length;

  columns.push({ key: 'final_grade', header: 'Final Grade', width: 12 });
  columns.push({ key: 'letter', header: 'Letter Grade', width: 11 });
  const lastCol = columns.length;

  ws.columns = columns.map((c) => ({ key: c.key, width: c.width }));

  // --- title block ---
  // A green banner across the sheet, then two rows of course detail as
  // label/value pairs, so the printed page identifies itself at a glance.
  ws.mergeCells(1, 1, 1, lastCol);
  const title = ws.getCell(1, 1);
  title.value = `${UNIVERSITY}  ·  Students Grade Record`;
  title.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  title.fill = FILL_TITLE;
  ws.getRow(1).height = 30;

  const detail = (row, col, label, value) => {
    const l = ws.getCell(row, col);
    l.value = label;
    l.font = { bold: true, size: 10, color: { argb: 'FF5B6472' } };
    l.alignment = { horizontal: 'right' };
    const v = ws.getCell(row, col + 1);
    v.value = value;
    v.font = { size: 11, bold: true };
    return v;
  };
  detail(2, 1, 'Course Code:', courseLabel(course));
  detail(3, 1, 'Course:', course.name || '');
  detail(2, 5, 'Instructor:', course.instructor || '');
  detail(3, 5, 'Policy:', `${result.policy}% transmutation`);
  detail(2, 9, 'Students:', students.length);
  detail(3, 9, 'Generated:', new Date().toISOString().slice(0, 10));
  ws.getRow(2).height = 18;
  ws.getRow(3).height = 18;

  // --- term banner: a blue bar across each term, as in the workbook ---
  const bannerRow = 4;
  const banner = (from, to, label) => {
    if (to < from) return;
    ws.mergeCells(bannerRow, from, bannerRow, to);
    const c = ws.getCell(bannerRow, from);
    c.value = label;
    c.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.fill = FILL_TERMBAND;
    c.border = BORDER;
  };
  banner(midStart, midEnd, 'Mid-Term');
  banner(finStart, finEnd, 'Final-Term');
  banner(lastCol - 1, lastCol, 'Final Grade');
  ws.getRow(bannerRow).height = 20;

  // --- weight row: the share each column carries, as percentages ---
  // The instructor's sheet shows these under the banner, so the reader can see
  // at a glance that class standing is 60% and the exam 40%.
  const weightRow = 5;
  const weight = (col, text, tint) => {
    const c = ws.getCell(weightRow, col);
    c.value = text;
    c.font = { bold: true, size: 10 };
    c.alignment = { horizontal: 'center' };
    if (tint) c.fill = tint;
    c.border = BORDER;
  };
  const csShare = (n) => (n ? `${Math.round((60 / n) * 100) / 100}%` : '');
  midAssessments.forEach((a, i) => {
    weight(midStart + i * 2, csShare(midAssessments.length));
  });
  finAssessments.forEach((a, i) => {
    weight(finStart + i * 2, csShare(finAssessments.length));
  });
  if (midEnd >= midStart) {
    weight(midEnd - 3, '60%', FILL_STANDING);   // class standing
    weight(midEnd - 2, '40%', FILL_EXAM);       // exam
    weight(midEnd, '100%', FILL_STANDING);      // term total
  }
  if (finEnd >= finStart) {
    weight(finEnd - 3, '60%', FILL_STANDING);
    weight(finEnd - 2, '40%', FILL_EXAM);
    weight(finEnd, '100%', FILL_STANDING);
  }
  weight(lastCol - 1, '100%', FILL_STANDING);
  ws.getRow(weightRow).height = 18;

  // --- header row ---
  const headerRow = 6;
  columns.forEach((c, i) => {
    const cell = ws.getCell(headerRow, i + 1);
    cell.value = c.header;
    styleHeaderCell(cell);
    // Tint the header to match the column beneath it.
    if (/_t_|_exam_t$/.test(c.key)) cell.fill = FILL_TRANSMUTED;
    else if (/^(m|f)_(cs|total)$/.test(c.key)) cell.fill = FILL_STANDING;
    else if (/^(m|f)_exam$/.test(c.key)) cell.fill = FILL_EXAM;
    else if (c.key === 'final_grade' || c.key === 'letter') cell.fill = FILL_STANDING;
  });
  ws.getRow(headerRow).height = 34;

  // --- students ---
  let r = headerRow + 1;
  for (const row of students) {
    const values = {
      no: row.student.number ?? r - headerRow,
      id: row.student.student_id || '',
      name: row.student.full_name || '',
    };
    row.midterm.assessments.forEach((a) => {
      values[`m_raw_${a.assessment.id}`] = num(a.raw);
      values[`m_t_${a.assessment.id}`] = a.transmuted;
    });
    values.m_cs = num(row.midterm.classStanding);
    values.m_exam = num(row.midterm.examRaw);
    values.m_exam_t = row.midterm.examTransmuted;
    values.m_total = num(row.midterm.total);

    row.final.assessments.forEach((a) => {
      values[`f_raw_${a.assessment.id}`] = num(a.raw);
      values[`f_t_${a.assessment.id}`] = a.transmuted;
    });
    values.f_cs = num(row.final.classStanding);
    values.f_exam = num(row.final.examRaw);
    values.f_exam_t = row.final.examTransmuted;
    values.f_total = num(row.final.total);

    // Text, not a number: two decimals exactly, never rounded up by a format.
    values.final_grade = row.finalGradeDisplay || '';
    values.letter = row.letter;

    const excelRow = ws.addRow(values);
    const banded = (r - headerRow) % 2 === 0;
    const flagged = !!row.student.unofficial;
    excelRow.height = 17;
    excelRow.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = BORDER_LIGHT;
      if (col > 3) cell.alignment = { horizontal: 'center' };
      cell.font = { size: 10 };
      if (banded) cell.fill = FILL_BAND;
    });
    // The name reads left, like a list, and the ID keeps its digits aligned.
    ws.getCell(excelRow.number, 2).alignment = { horizontal: 'left' };
    ws.getCell(excelRow.number, 3).alignment = { horizontal: 'left' };

    // A student sitting in without being on the official roster is highlighted
    // across their identifying cells, the way it would be done by hand.
    if (flagged) {
      for (const col of [1, 2, 3]) {
        const cell = ws.getCell(excelRow.number, col);
        cell.fill = FILL_FLAGGED;
        cell.font = { size: 10, bold: true, color: { argb: 'FF8A5A10' } };
      }
      const nameCell = ws.getCell(excelRow.number, 3);
      nameCell.note = row.student.note
        ? `Not on the official roster yet. ${row.student.note}`
        : 'Not on the official roster yet.';
    }

    // Colour the computed columns the way the workbook does.
    columns.forEach((c, i) => {
      const cell = ws.getCell(excelRow.number, i + 1);
      if (/_t_|_exam_t$/.test(c.key)) cell.fill = FILL_TRANSMUTED;
      if (/^(m|f)_(cs|total)$/.test(c.key)) {
        cell.fill = FILL_STANDING;
        cell.font = { size: 10, bold: true };
      }
      if (/^(m|f)_exam$/.test(c.key)) cell.fill = FILL_EXAM;
      if (c.key === 'final_grade') {
        cell.fill = FILL_STANDING;
        cell.font = { size: 11, bold: true };
        cell.border = { ...BORDER_LIGHT, left: THIN };
      }
      if (c.key === 'letter') styleLetterCell(cell, row.letter);
      if (/^(m_cs|m_total|f_cs|f_total)$/.test(c.key) && typeof cell.value === 'number') {
        cell.numFmt = '0.00';
      }
    });
    r += 1;
  }

  ws.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: headerRow, column: 3 },
  };

  // --- footer: what the columns mean, and how the class did ---
  const footRow = headerRow + students.length + 2;
  ws.mergeCells(footRow, 1, footRow, Math.min(6, lastCol));
  const legend = ws.getCell(footRow, 1);
  legend.value =
    `Transmuted values come from the ${result.policy}% university table. ` +
    'A blank assessment counts as 50; a blank exam gives the letter I.';
  legend.font = { size: 9, italic: true, color: { argb: 'FF5B6472' } };
  legend.alignment = { horizontal: 'left' };

  const counts = students.reduce((acc, s) => {
    acc[s.letter] = (acc[s.letter] || 0) + 1;
    return acc;
  }, {});
  const order = ['A', 'B', 'C', 'D', 'F', 'I', 'NG'].filter((l) => counts[l]);
  if (order.length) {
    const distRow = footRow + 1;
    const label = ws.getCell(distRow, 1);
    label.value = 'Grade distribution:';
    label.font = { size: 9, bold: true, color: { argb: 'FF5B6472' } };
    order.forEach((letter, i) => {
      const c = ws.getCell(distRow, 3 + i);
      c.value = `${letter}: ${counts[letter]}`;
      styleLetterCell(c, letter);
      c.font = { ...c.font, size: 9 };
      c.border = BORDER_LIGHT;
    });
  }

  return ws;
}

/** Build the summary sheet: ID, name, final grade, letter. */
function buildSummary(workbook, result) {
  const { course, students } = result;
  const ws = workbook.addWorksheet('Summary', {
    views: [{ state: 'frozen', ySplit: 5 }],
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [
    { key: 'no', width: 6 },
    { key: 'id', width: 14 },
    { key: 'name', width: 34 },
    { key: 'grade', width: 14 },
    { key: 'letter', width: 12 },
  ];

  ws.mergeCells(1, 1, 1, 5);
  const title = ws.getCell(1, 1);
  title.value = `${UNIVERSITY}  ·  Grade Summary`;
  title.font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  title.fill = FILL_TITLE;
  ws.getRow(1).height = 30;

  const sdetail = (row, col, label, value) => {
    const l = ws.getCell(row, col);
    l.value = label;
    l.font = { bold: true, size: 10, color: { argb: 'FF5B6472' } };
    l.alignment = { horizontal: 'right' };
    const v = ws.getCell(row, col + 1);
    v.value = value;
    v.font = { size: 11, bold: true };
  };
  sdetail(2, 1, 'Course Code:', courseLabel(course));
  sdetail(3, 1, 'Course:', course.name || '');
  sdetail(2, 4, 'Students:', students.length);
  sdetail(3, 4, 'Generated:', new Date().toISOString().slice(0, 10));

  const headerRow = 5;
  ['No.', 'ID', 'FullName', 'Final Grade', 'Letter Grade'].forEach((h, i) => {
    const cell = ws.getCell(headerRow, i + 1);
    cell.value = h;
    styleHeaderCell(cell);
  });

  students.forEach((row, i) => {
    const excelRow = ws.addRow({
      no: row.student.number ?? i + 1,
      id: row.student.student_id || '',
      name: row.student.full_name || '',
      grade: row.finalGradeDisplay || '',
      letter: row.letter,
    });
    const banded = i % 2 === 1;
    excelRow.height = 17;
    excelRow.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = BORDER_LIGHT;
      cell.font = { size: 10 };
      if (banded) cell.fill = FILL_BAND;
      if (col === 4) {
        cell.alignment = { horizontal: 'center' };
        cell.font = { size: 11, bold: true };
        cell.fill = FILL_STANDING;
      }
    });
    styleLetterCell(ws.getCell(excelRow.number, 5), row.letter);
    // Flag a student who is not on the official roster, as on the full record.
    if (row.student.unofficial) {
      for (const col of [1, 2, 3]) {
        const cell = ws.getCell(excelRow.number, col);
        cell.fill = FILL_FLAGGED;
        cell.font = { size: 10, bold: true, color: { argb: 'FF8A5A10' } };
      }
      ws.getCell(excelRow.number, 3).note = row.student.note
        ? `Not on the official roster yet. ${row.student.note}`
        : 'Not on the official roster yet.';
    }
  });

  // A short tally under the list, which is what a department asks for first.
  const counts = students.reduce((acc, s) => {
    acc[s.letter] = (acc[s.letter] || 0) + 1;
    return acc;
  }, {});
  const order = ['A', 'B', 'C', 'D', 'F', 'I', 'NG'].filter((l) => counts[l]);
  if (order.length) {
    const distRow = headerRow + students.length + 2;
    const label = ws.getCell(distRow, 1);
    label.value = 'Distribution';
    label.font = { size: 10, bold: true, color: { argb: 'FF5B6472' } };
    order.forEach((letter, i) => {
      const c = ws.getCell(distRow + 1 + i, 1);
      c.value = letter;
      styleLetterCell(c, letter);
      c.border = BORDER_LIGHT;
      const n = ws.getCell(distRow + 1 + i, 2);
      n.value = counts[letter];
      n.font = { size: 10 };
      n.alignment = { horizontal: 'center' };
      n.border = BORDER_LIGHT;
    });
  }

  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: 5 } };
  return ws;
}

/** Write the full grade record workbook. */
async function exportGradeRecord(result, filePath) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GradeDesk';
  wb.created = new Date();
  buildGradeRecord(wb, result);
  buildSummary(wb, result);
  await wb.xlsx.writeFile(filePath);
  return filePath;
}

/** Write the summary-only workbook. */
async function exportSummary(result, filePath) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GradeDesk';
  wb.created = new Date();
  buildSummary(wb, result);
  await wb.xlsx.writeFile(filePath);
  return filePath;
}

module.exports = { exportGradeRecord, exportSummary, buildGradeRecord, buildSummary, formatGrade };
