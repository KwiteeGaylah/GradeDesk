'use strict';
/**
 * Reading a class roster out of a PDF, and deciding where its students go.
 *
 * The official class list comes from Smart School Online as a web page the
 * instructor prints to PDF. Its text is real text, not a scan, so every name
 * can be read exactly — but only by WHERE it sits on the page, not by the order
 * the text happens to be stored in.
 *
 * WHY POSITION, NOT TEXT ORDER
 * ----------------------------
 * Pulling the plain text out of a real roster put the header row of page 2
 * between two students and shifted a middle name onto the student above it.
 * Nothing looked wrong: the name was real, the row was real, they were just
 * paired up wrongly, which is the kind of error nobody catches until grades
 * are submitted. Reading by position avoids it entirely: the heading row gives
 * every column's left edge, each line of text at the same height is one row,
 * and a word belongs to the column whose edge it starts at.
 *
 * This file is pure. It takes text items that have already been read out of
 * the PDF (see src/import/pdf.js, which owns the PDF library) and does no I/O,
 * so it is tested directly with invented names, never real students.
 *
 * An item is { str, x, y, width, height } with y measured DOWN from the top of
 * the page, so a larger y is further down. Pages are passed in order.
 */

const { joinName } = require('./roster');

/** Collapse runs of whitespace and trim. */
function tidy(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/\s+/g, ' ')
    .trim();
}

/** A heading as it is compared: lower case, no trailing dot or colon. */
function headingKey(text) {
  return tidy(text).toLowerCase().replace(/[.:]+$/, '');
}

/**
 * The column headings recognised on a roster, by what they hold.
 *
 * Only the four the roster stores, plus the row number, are ever read. Every
 * other heading (Email, Phone Number, Comments) still matters, because it marks
 * where the column before it ends — but what is under it is never kept, so a
 * student's email and phone number go no further than the PDF they came in.
 */
const HEADINGS = {
  number: ['no', '#', 'number', 's/n', 'sn', 'sr', 'sr no'],
  studentId: ['student id', 'id', 'id number', 'id no', 'student no', 'student number'],
  lastName: ['last name', 'lastname', 'surname', 'family name'],
  firstName: ['first name', 'firstname', 'given name'],
  middleName: ['middle name', 'middlename', 'middle', 'middle initial', 'mi'],
};

function headingField(text) {
  const key = headingKey(text);
  for (const [field, names] of Object.entries(HEADINGS)) {
    if (names.includes(key)) return field;
  }
  return null;
}

/** Usable text items, sorted top to bottom and then left to right. */
function cleanItems(items) {
  return (items || [])
    .filter((it) => it && tidy(it.str) !== '')
    .map((it) => ({
      str: tidy(it.str),
      x: Number(it.x) || 0,
      y: Number(it.y) || 0,
      width: Number(it.width) || 0,
      height: Number(it.height) || 10,
    }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * Group items into lines: everything at (nearly) the same height is one line.
 * The tolerance scales with the text size, because a "same line" on a large
 * font is further apart in points than on a small one.
 */
function groupLines(items) {
  const lines = [];
  for (const item of items) {
    const line = lines[lines.length - 1];
    const tolerance = Math.max(2, item.height * 0.4);
    if (line && Math.abs(item.y - line.y) <= tolerance) {
      line.items.push(item);
    } else {
      lines.push({ y: item.y, height: item.height, items: [item] });
    }
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x);
  return lines;
}

/**
 * Merge the items on a heading line into whole headings.
 *
 * "Last Name" is normally one piece of text, but a PDF is free to store it as
 * "Last" and "Name" side by side. Pieces separated by less than a wide space
 * are one heading; the gap between two columns is much larger than that.
 */
function headingCells(line) {
  const cells = [];
  for (const item of line.items) {
    const last = cells[cells.length - 1];
    const gap = last ? item.x - (last.x + last.width) : Infinity;
    if (last && gap < item.height * 0.6) {
      last.str = `${last.str} ${item.str}`;
      last.width = item.x + item.width - last.x;
    } else {
      cells.push({ ...item });
    }
  }
  return cells;
}

/**
 * Columns from a heading line, or null if the line is not one.
 *
 * A heading line has to name the student ID, last name and first name: those
 * three are what make it a class list rather than, say, the course details
 * printed above it.
 */
function readHeading(line) {
  const cells = headingCells(line);
  const columns = cells.map((c) => ({ field: headingField(c.str), x: c.x, label: c.str }));
  const fields = new Set(columns.map((c) => c.field).filter(Boolean));
  if (!fields.has('studentId') || !fields.has('lastName') || !fields.has('firstName')) return null;
  return columns;
}

/**
 * Which column an item falls in: the last one whose left edge it starts at or
 * after. A few points of slack allow for text set fractionally left of its
 * heading. Anything left of the first column is outside the table.
 */
function columnFor(columns, item) {
  const slack = 4;
  let found = -1;
  for (let i = 0; i < columns.length; i++) {
    if (item.x >= columns[i].x - slack) found = i;
  }
  return found;
}

/** The text in each named column of a line, joined left to right. */
function readCells(columns, line) {
  const cells = { number: '', studentId: '', lastName: '', firstName: '', middleName: '' };
  for (const item of line.items) {
    const index = columnFor(columns, item);
    if (index === -1) continue;
    const field = columns[index].field;
    if (!field) continue; // Email, phone, comments: never kept.
    cells[field] = cells[field] ? `${cells[field]} ${item.str}` : item.str;
  }
  return cells;
}

/**
 * Tidy a given or middle name, and say what was changed.
 *
 * A comma can be part of a SURNAME ("Doe, Jr.") and is kept there exactly as
 * printed. It can never end a given or middle name, so one there is a typing
 * slip on the official list. A single initial followed by a comma ("E,") was
 * meant as an initial ("E."), which is how every other initial on the list is
 * written; anything else just loses the stray comma.
 */
function tidyGivenName(value) {
  const text = tidy(value);
  if (/^[A-Za-z],$/.test(text)) return `${text[0]}.`;
  return text.replace(/^[,;]+|[,;]+$/g, '').trim();
}

/** The course details printed above the table: "Course Code  CSE" and so on. */
const META_LABELS = {
  courseCode: ['course code'],
  courseNumber: ['course no', 'course number'],
  section: ['section'],
  semester: ['acad. sem', 'acad sem', 'academic semester', 'semester'],
  description: ['description', 'course title', 'title'],
};

function readMeta(lines) {
  const meta = {};
  for (const line of lines) {
    for (let i = 0; i < line.items.length; i++) {
      const key = headingKey(line.items[i].str);
      const field = Object.keys(META_LABELS).find((f) => META_LABELS[f].includes(key));
      if (!field || meta[field]) continue;
      // The value is the next piece of text to the right on the same line.
      const value = line.items[i + 1];
      if (value) meta[field] = value.str;
    }
  }
  return meta;
}

/**
 * Read a class roster from the text of a PDF.
 *
 * @param {Array<Array<{str, x, y, width, height}>>} pages  text items, page by page
 * @returns {{
 *   meta: {courseCode?, courseNumber?, section?, semester?, description?},
 *   rows: Array<{number, studentId, lastName, firstName, middleName, fullName, notes: string[]}>,
 *   problems: string[],
 *   hasText: boolean,
 *   foundTable: boolean,
 * }}
 */
function parseRosterPdf(pages) {
  const rows = [];
  const problems = [];
  let meta = {};
  let columns = null;
  let hasText = false;

  (pages || []).forEach((pageItems, pageIndex) => {
    const items = cleanItems(pageItems);
    if (items.length) hasText = true;
    const lines = groupLines(items);

    // A page normally repeats the heading row. One that does not carries on
    // with the columns of the page before.
    const headingAt = lines.findIndex((line) => readHeading(line));
    if (headingAt !== -1) {
      if (!columns) meta = readMeta(lines.slice(0, headingAt));
      columns = readHeading(lines[headingAt]);
    }
    if (!columns) return;

    const hasNumber = columns.some((c) => c.field === 'number');
    let previous = null;

    for (const line of lines.slice(headingAt + 1)) {
      const cells = readCells(columns, line);
      const isRow = hasNumber
        ? /^\d+$/.test(cells.number)
        : cells.studentId !== '' && cells.lastName !== '';

      if (isRow) {
        const notes = [];
        const firstName = tidyGivenName(cells.firstName);
        const middleName = tidyGivenName(cells.middleName);
        if (firstName !== tidy(cells.firstName)) {
          notes.push(`First name "${cells.firstName}" read as "${firstName}"`);
        }
        if (middleName !== tidy(cells.middleName)) {
          notes.push(`Middle name "${cells.middleName}" read as "${middleName}"`);
        }
        const parts = {
          studentId: tidy(cells.studentId),
          lastName: tidy(cells.lastName),
          firstName,
          middleName,
        };
        if (!parts.studentId) notes.push('No student ID on the list');
        if (!parts.lastName) notes.push('No last name on the list');
        const row = {
          number: hasNumber ? Number(cells.number) : null,
          ...parts,
          fullName: joinName(parts),
          notes,
          _y: line.y,
          _height: line.height,
        };
        rows.push(row);
        previous = row;
        continue;
      }

      // A name too long for its column wraps onto a second line just below,
      // with no number or ID of its own. It belongs to the row above.
      const nameText = [cells.lastName, cells.firstName, cells.middleName].some(Boolean);
      const wrapped =
        previous && !cells.number && !cells.studentId && nameText &&
        line.y - previous._y <= previous._height * 1.6;
      if (wrapped) {
        for (const field of ['lastName', 'firstName', 'middleName']) {
          if (!cells[field]) continue;
          const joined = tidy(`${previous[field]} ${cells[field]}`);
          previous[field] = field === 'lastName' ? joined : tidyGivenName(joined);
        }
        previous.fullName = joinName(previous);
        previous._y = line.y;
        continue;
      }

      // Anything else under the table is a footer ("Printed By ...") unless it
      // has text in two or more of the student columns, which means a student
      // row that could not be read. Say so rather than drop a student quietly.
      const filled = ['studentId', 'lastName', 'firstName'].filter((f) => cells[f]).length;
      if (filled >= 2) {
        problems.push(
          `Page ${pageIndex + 1}: a line could not be read as a student: ` +
          `"${line.items.map((i) => i.str).join(' ')}"`
        );
      }
      previous = null;
    }
  });

  for (const row of rows) {
    delete row._y;
    delete row._height;
  }

  return { meta, rows, problems, hasText, foundTable: columns !== null };
}

/** Compare course codes and sections the way a person would read them. */
function normaliseCode(text) {
  return tidy(text).replace(/\s+/g, '').toUpperCase();
}
function normaliseSection(text) {
  const t = tidy(text).replace(/^(section|sec\.?)\s*/i, '');
  return /^\d+$/.test(t) ? String(Number(t)) : t.toUpperCase();
}

/**
 * Does the roster belong to this course?
 *
 * Returns null when the PDF does not say which course it is for, since there
 * is then nothing to compare. Otherwise both labels are returned so the warning
 * can show the instructor exactly what disagrees.
 */
function rosterCourseCheck(meta, course) {
  const pdfCode = [meta && meta.courseCode, meta && meta.courseNumber].filter(Boolean).join(' ');
  const pdfSection = (meta && meta.section) || '';
  if (!pdfCode && !pdfSection) return null;

  const codeMatches = !pdfCode || normaliseCode(pdfCode) === normaliseCode(course.code);
  const sectionMatches =
    !pdfSection || !tidy(course.section) ||
    normaliseSection(pdfSection) === normaliseSection(course.section);

  const label = (code, section) =>
    [tidy(code), tidy(section) ? `Section ${tidy(section)}` : ''].filter(Boolean).join(' · ');

  return {
    matches: codeMatches && sectionMatches,
    codeMatches,
    sectionMatches,
    pdfLabel: label(pdfCode, pdfSection),
    courseLabel: label(course.code, course.section),
  };
}

/** A student ID compared without case or spaces: "tu-90001" is "TU-90001". */
function idKey(id) {
  // Letters and digits only: "TU-90001", "tu 90001" and "TU90002" are the same
  // ID typed three ways, and the PDF and a hand-typed roster rarely agree on
  // the punctuation.
  return tidy(id).replace(/[^0-9a-z]/gi, '').toUpperCase();
}
/** A name compared without case, for rows with no ID to go on. */
function nameKey(row) {
  const last = tidy(row.lastName ?? row.last_name).toLowerCase();
  const first = tidy(row.firstName ?? row.first_name).toLowerCase();
  return last ? `${last}|${first}` : '';
}

/** A roster row with nothing typed in it at all. */
function isEmptyStudent(student) {
  return ![student.student_id, student.last_name, student.first_name, student.middle_name, student.full_name]
    .some((v) => tidy(v) !== '');
}

/**
 * Decide where each imported student goes, without changing anything.
 *
 * The instructor usually has a page of empty rows already, from "Add rows" or
 * the setup wizard. Those are filled first, in roster order, and the rest are
 * added after them, so the class does not end up as ten blank rows followed by
 * the real list.
 *
 * An empty row that already has a score or an attendance mark against it is
 * NOT filled: whoever that work belongs to, it is not the first name on the
 * PDF. `hasWork` on the existing student marks those.
 *
 * A student already in the course is skipped, matched by student ID — or, for
 * a row with no ID, by last and first name. The same ID twice in one PDF is
 * added once.
 *
 * @param {Array} existing  students as stored, in roster order, each with `hasWork`
 * @param {Array} rows      rows from parseRosterPdf
 * @returns {{ fill: Array<{student, row}>, add: Array, skip: Array<{row, reason}> }}
 */
function planRosterImport(existing, rows) {
  const ids = new Map();
  // Every named student, with or without an ID, so a name can be looked up
  // either way. Whether a name match counts is decided at lookup, below.
  const names = new Map();
  const empties = [];
  for (const student of existing || []) {
    if (isEmptyStudent(student)) {
      if (!student.hasWork) empties.push(student);
      continue;
    }
    if (idKey(student.student_id)) ids.set(idKey(student.student_id), student);
    if (nameKey(student) && !names.has(nameKey(student))) names.set(nameKey(student), student);
  }

  /**
   * The student already on the list that this PDF row is, if any.
   *
   * By ID first. Failing that, by name -- but a name only stands in for an ID
   * when the student on the list has no ID of their own. Two students can share
   * a name; two different IDs are two different people.
   *
   * The name fallback is what catches the usual order of events: the class is
   * typed in by name to get started, scores go in, and the official PDF is
   * imported later. Matching ID to ID alone, every student on it looked new and
   * the whole class was added a second time beside the rows holding its grades.
   */
  const findExisting = (row) => {
    const id = idKey(row.studentId);
    if (id && ids.has(id)) return ids.get(id);
    const byName = names.get(nameKey(row));
    if (!byName) return null;
    if (id && idKey(byName.student_id)) return null;
    return byName;
  };

  const plan = { fill: [], add: [], skip: [] };
  const seen = new Set();
  for (const row of rows || []) {
    const id = idKey(row.studentId);
    const key = id ? `id:${id}` : `name:${nameKey(row)}`;
    if (seen.has(key)) {
      plan.skip.push({ row, reason: 'Listed twice on this PDF' });
      continue;
    }
    seen.add(key);

    const already = findExisting(row);
    if (already) {
      plan.skip.push({
        row,
        reason: `Already on your list${already.full_name ? ` as ${already.full_name}` : ''}`,
      });
      continue;
    }

    if (empties.length) plan.fill.push({ student: empties.shift(), row });
    else plan.add.push(row);
  }
  return plan;
}

module.exports = {
  parseRosterPdf,
  rosterCourseCheck,
  planRosterImport,
};
