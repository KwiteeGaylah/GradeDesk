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
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

const FILL_HEADER = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F3F8' } };
const FILL_TRANSMUTED = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F9FC' } };
const FILL_TOTAL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF1F7' } };
const FILL_MIDTERM = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7F1EB' } };
const FILL_FINALTERM = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBF1E2' } };

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
  cell.font = { bold: true, size: 10 };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.fill = FILL_HEADER;
  cell.border = BORDER;
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
  ws.mergeCells(1, 1, 1, lastCol);
  const title = ws.getCell(1, 1);
  title.value = UNIVERSITY;
  title.font = { bold: true, size: 14 };
  title.alignment = { horizontal: 'center' };

  ws.getCell(2, 1).value = 'Course Code:';
  ws.getCell(2, 1).font = { bold: true };
  ws.getCell(2, 3).value = courseLabel(course);
  ws.getCell(3, 1).value = 'Course:';
  ws.getCell(3, 1).font = { bold: true };
  ws.getCell(3, 3).value = course.name || '';
  if (course.instructor) {
    ws.getCell(2, 6).value = 'Instructor:';
    ws.getCell(2, 6).font = { bold: true };
    ws.getCell(2, 8).value = course.instructor;
  }
  ws.getCell(3, 6).value = 'Policy:';
  ws.getCell(3, 6).font = { bold: true };
  ws.getCell(3, 8).value = `${result.policy}% transmutation`;

  // --- term banner ---
  const bannerRow = 4;
  if (midEnd >= midStart) {
    ws.mergeCells(bannerRow, midStart, bannerRow, midEnd);
    const c = ws.getCell(bannerRow, midStart);
    c.value = 'Mid-Term';
    c.font = { bold: true, size: 11 };
    c.alignment = { horizontal: 'center' };
    c.fill = FILL_MIDTERM;
    c.border = BORDER;
  }
  if (finEnd >= finStart) {
    ws.mergeCells(bannerRow, finStart, bannerRow, finEnd);
    const c = ws.getCell(bannerRow, finStart);
    c.value = 'Final-Term';
    c.font = { bold: true, size: 11 };
    c.alignment = { horizontal: 'center' };
    c.fill = FILL_FINALTERM;
    c.border = BORDER;
  }
  ws.mergeCells(bannerRow, lastCol - 1, bannerRow, lastCol);
  const fgBanner = ws.getCell(bannerRow, lastCol - 1);
  fgBanner.value = 'Final Grade';
  fgBanner.font = { bold: true, size: 11 };
  fgBanner.alignment = { horizontal: 'center' };
  fgBanner.border = BORDER;

  // --- header row ---
  const headerRow = 5;
  columns.forEach((c, i) => {
    const cell = ws.getCell(headerRow, i + 1);
    cell.value = c.header;
    styleHeaderCell(cell);
  });
  ws.getRow(headerRow).height = 30;

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
    excelRow.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = BORDER;
      if (col > 3) cell.alignment = { horizontal: 'center' };
      cell.font = { size: 10 };
    });

    // Shade the computed columns so the typed ones stand out, as in the original.
    columns.forEach((c, i) => {
      const cell = ws.getCell(excelRow.number, i + 1);
      if (/_t_|_exam_t$/.test(c.key)) cell.fill = FILL_TRANSMUTED;
      if (/^(m|f)_(cs|total)$/.test(c.key)) cell.fill = FILL_TOTAL;
      if (c.key === 'final_grade' || c.key === 'letter') {
        cell.fill = FILL_TOTAL;
        cell.font = { size: 10, bold: true };
      }
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
  title.value = UNIVERSITY;
  title.font = { bold: true, size: 14 };
  title.alignment = { horizontal: 'center' };

  ws.getCell(2, 1).value = 'Course Code:';
  ws.getCell(2, 1).font = { bold: true };
  ws.getCell(2, 2).value = courseLabel(course);
  ws.getCell(3, 1).value = 'Course:';
  ws.getCell(3, 1).font = { bold: true };
  ws.getCell(3, 2).value = course.name || '';

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
    excelRow.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = BORDER;
      cell.font = { size: 10 };
      if (col >= 4) {
        cell.alignment = { horizontal: 'center' };
        cell.font = { size: 10, bold: true };
      }
    });
  });

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
