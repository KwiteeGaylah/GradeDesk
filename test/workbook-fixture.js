'use strict';
/**
 * Reads the instructor's real grade workbook and extracts, per student:
 *   - the RAW scores only (never the workbook's computed values as inputs)
 *   - each assessment's point maximum, discovered from the live VLOOKUP formula
 *   - the workbook's STORED final grade and letter, used purely as expectations
 *
 * This is fixture plumbing for the verification test. It deliberately reads the
 * point maximum from each transmuted cell's `VLOOKUP(..., <colIndex>, TRUE)`
 * rather than hard-coding a layout, so the test reflects the real sheet.
 *
 * Sheet layout (identical across all six course sheets):
 *   row 9  headers, row 10+ students
 *   A No.  B ID  C FullName
 *   Midterm: raw D F H J L (transmuted in the next column), exam O, transmuted P
 *   Class Standing N, Total Mid-term Q
 *   Final:   raw S U W Y (transmuted in the next column), exam AB, transmuted AC
 *   Class Standing2 AA, Total Final-term AD
 *   Final Grade AF, Letter Grade AG
 */

const path = require('path');
const ExcelJS = require('exceljs');

const WORKBOOK_PATH = path.join(__dirname, '..', 'data', '2026-2027 Sem 1-Grade Record.xlsx');

/** The reference sheet is not a course. */
const NON_COURSE_SHEETS = new Set(['Transmutation']);

/** 1-based column numbers. */
const COL = {
  number: 1,
  id: 2,
  name: 3,
  midtermRaw: [4, 6, 8, 10, 12], // D F H J L
  midtermExam: 15, // O
  midtermClassStanding: 14, // N
  midtermTotal: 17, // Q
  finalRaw: [19, 21, 23, 25], // S U W Y
  finalExam: 28, // AB
  finalClassStanding: 27, // AA
  finalTotal: 30, // AD
  finalGrade: 32, // AF
  letterGrade: 33, // AG
};

const FIRST_STUDENT_ROW = 10;
const HEADER_ROW = 9;

/**
 * The workbook's Transmutation sheet columns, in VLOOKUP index order.
 * Index 1 is the Score column, so the point maximum starts at index 2.
 */
const VLOOKUP_INDEX_TO_MAX_POINTS = {
  2: 5,
  3: 10,
  4: 15,
  5: 25,
  6: 30,
  7: 35,
  8: 40,
};

/** Unwrap a cell value, resolving formula cells to their cached result. */
function cellValue(cell) {
  const v = cell ? cell.value : null;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if ('result' in v) return v.result === undefined ? null : v.result;
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;
  }
  return v;
}

/** A raw score cell: null when empty, otherwise the value as stored. */
function rawValue(cell) {
  const v = cellValue(cell);
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  return v;
}

/**
 * Discover an assessment's point maximum from the VLOOKUP in its transmuted
 * cell (the column immediately right of the raw column).
 * @returns {number|null}
 */
function maxPointsFor(sheet, rawCol, sampleRow) {
  const cell = sheet.getRow(sampleRow).getCell(rawCol + 1);
  const v = cell ? cell.value : null;
  const formula = v && typeof v === 'object' ? v.formula || v.sharedFormula : null;
  if (!formula) return null;
  const m = /,\s*(\d+)\s*,\s*TRUE\s*\)/i.exec(formula);
  if (!m) return null;
  const idx = Number(m[1]);
  return VLOOKUP_INDEX_TO_MAX_POINTS[idx] || null;
}

/** Assessment display name from the header row. */
function headerName(sheet, col) {
  const v = cellValue(sheet.getRow(HEADER_ROW).getCell(col));
  return v === null ? `col${col}` : String(v).trim();
}

/**
 * Load every course sheet as a fixture.
 * @returns {Promise<Array>} sections, each with students and assessment metadata
 */
async function loadWorkbook(filePath = WORKBOOK_PATH) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const sections = [];
  for (const sheet of wb.worksheets) {
    if (NON_COURSE_SHEETS.has(sheet.name)) continue;

    // Find a row with formulas to read the point maximums from. Row 10 normally.
    let sampleRow = FIRST_STUDENT_ROW;
    while (sampleRow <= sheet.rowCount && maxPointsFor(sheet, COL.midtermRaw[0], sampleRow) === null) {
      sampleRow += 1;
    }

    const midtermAssessments = COL.midtermRaw.map((c) => ({
      column: c,
      name: headerName(sheet, c),
      maxPoints: maxPointsFor(sheet, c, sampleRow),
    }));
    const finalAssessments = COL.finalRaw.map((c) => ({
      column: c,
      name: headerName(sheet, c),
      maxPoints: maxPointsFor(sheet, c, sampleRow),
    }));

    const students = [];
    for (let r = FIRST_STUDENT_ROW; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const name = cellValue(row.getCell(COL.name));
      if (typeof name !== 'string' || name.trim() === '') continue;

      const storedFinalGrade = cellValue(row.getCell(COL.finalGrade));
      const storedLetter = cellValue(row.getCell(COL.letterGrade));

      students.push({
        sheet: sheet.name,
        row: r,
        number: cellValue(row.getCell(COL.number)),
        studentId: cellValue(row.getCell(COL.id)),
        fullName: name.trim(),
        midtermRaw: midtermAssessments.map((a) => rawValue(row.getCell(a.column))),
        midtermExamRaw: rawValue(row.getCell(COL.midtermExam)),
        finalRaw: finalAssessments.map((a) => rawValue(row.getCell(a.column))),
        finalExamRaw: rawValue(row.getCell(COL.finalExam)),
        storedMidtermClassStanding: cellValue(row.getCell(COL.midtermClassStanding)),
        storedMidtermTotal: cellValue(row.getCell(COL.midtermTotal)),
        storedFinalClassStanding: cellValue(row.getCell(COL.finalClassStanding)),
        storedFinalTotal: cellValue(row.getCell(COL.finalTotal)),
        storedFinalGrade,
        storedLetter: storedLetter === null ? null : String(storedLetter).trim(),
      });
    }

    sections.push({
      name: sheet.name,
      courseCode: cellValue(sheet.getRow(3).getCell(3)),
      courseName: cellValue(sheet.getRow(4).getCell(3)),
      midtermAssessments,
      finalAssessments,
      students,
    });
  }
  return sections;
}

module.exports = { loadWorkbook, WORKBOOK_PATH, COL, VLOOKUP_INDEX_TO_MAX_POINTS };
