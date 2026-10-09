'use strict';
/**
 * An invented class roster laid out the way Smart School Online prints one, and
 * a writer that turns it into a real PDF file.
 *
 * Shared by the unit tests (test/roster-pdf.test.js) and the live UI check
 * (scripts/uidriver.js), so both read the same roster. It is generated rather
 * than checked in, because a roster PDF in the repository is exactly the thing
 * that must never hold real students: every name and ID here is made up.
 */

const fs = require('fs');

/** Left edge of each column, as on the Smart School Online roster. */
const X = { no: 44, id: 75, last: 151, first: 236, middle: 313, email: 407, phone: 625, comments: 730 };
const ROW = 23.6;
const PAGE_HEIGHT = 1191;

const item = (str, x, y) => ({ str, x, y, width: str.length * 5.5, height: 11 });

function headingLine(y) {
  return [
    item('No.', X.no, y), item('Student ID', X.id, y), item('Last Name', X.last, y),
    item('First Name', X.first, y), item('Middle Name', X.middle, y), item('Email', X.email, y),
    item('Phone Number', X.phone, y), item('Comments', X.comments, y),
  ];
}

/** One student line: [no, id, last, first, middle]. Email and phone are added. */
function studentLine(y, [no, id, last, first, middle]) {
  return [
    item(String(no), X.no, y), item(id, X.id, y), item(last, X.last, y), item(first, X.first, y),
    middle ? item(middle, X.middle, y) : null,
    item(`${first}.${last}@example.edu`.toLowerCase().replace(/[^a-z@.]/g, ''), X.email, y),
    item('0770000000', X.phone, y),
  ].filter(Boolean);
}

/** Page 1: the course details, the heading row, then students. */
function firstPage(students, { code = 'CSE', number = '101', section = '7' } = {}) {
  const items = [
    item('9/29/26, 10:38 PM', 24, 22),
    item('Example University', 255, 72),
    item('Class Roster', 390, 125),
    item('Date', 44, 171), item('Sep 29, 2026 22:38:49', 165, 171),
    item('Section', 448, 171), item(section, 541, 171),
    item('Acad. Sem.', 44, 194), item('2026/2027 Sem. 1', 165, 194),
    item('Course Code', 44, 218), item(code, 165, 218),
    item('Instructor', 448, 218), item('STAFF', 541, 218),
    item('Course No.', 44, 241), item(number, 165, 241),
    item('Description', 44, 264), item('Introduction to Computers', 165, 264),
    ...headingLine(300),
  ];
  students.forEach((s, i) => items.push(...studentLine(323 + i * ROW, s)));
  items.push(item('example.edu/roster', 24, 1173), item('1/2', 807, 1173));
  return items;
}

/** A following page: heading row repeated, students, then the footer. */
function laterPage(students, { heading = true } = {}) {
  const items = heading ? headingLine(45) : [];
  students.forEach((s, i) => items.push(...studentLine(68 + i * ROW, s)));
  const end = 68 + students.length * ROW;
  items.push(
    item('Printed By: Someone', 362, end + 10),
    item('This roster was automatically generated from Smart School Online.', 235, end + 40),
    item('2/2', 807, 1173)
  );
  return items;
}

/** Includes the awkward cases the real list has: a suffix, a stray comma, a two-part middle name. */
const PAGE_ONE = [
  [1, 'TU-90001', 'Bestman', 'Comfort', 'K.'],
  [2, 'TU-90002', 'Doe, Jr.', 'Marcus', 'E,'],
  [3, '80003', 'Dolo', 'Patience', ''],
  [4, 'TU-90004', 'Flomo', 'Esther', 'Otis D.W.'],
];
/** A student with no middle name directly above one with a middle name. */
const PAGE_TWO = [
  [5, 'TU-90005', 'Kollie', 'James', 'T.'],
  [6, '80006', 'Kollie', 'Martha', ''],
  [7, 'TU-90007', 'Wleh', 'Sarah', 'Deodor'],
];

/** Write text items to a PDF, page by page, in a built-in font. */
function writePdf(file, pages) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const objects = [];
  const add = (body) => objects.push(body) && objects.length;

  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(null); // pages, filled in once the page objects exist
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  for (const items of pages) {
    const stream = items
      .map((it) => `BT /F1 10 Tf 1 0 0 1 ${it.x} ${(PAGE_HEIGHT - it.y).toFixed(1)} Tm (${esc(it.str)}) Tj ET`)
      .join('\n');
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`
    ));
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.writeFileSync(file, out, 'latin1');
}

/** The whole invented two-page roster, written to `file`. */
function writeRosterPdf(file, options) {
  writePdf(file, [firstPage(PAGE_ONE, options), laterPage(PAGE_TWO)]);
}

module.exports = {
  X, ROW, item, firstPage, laterPage, PAGE_ONE, PAGE_TWO, writePdf, writeRosterPdf,
};
