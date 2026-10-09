'use strict';
/**
 * Reading the text out of a PDF, with its position on the page.
 *
 * This is the only file that touches the PDF library. It hands back plain text
 * items and nothing else; working out which text is a student is the engine's
 * job (src/engine/roster-pdf.js), so that part is tested without any PDF.
 *
 * pdf.js is Mozilla's PDF reader, written entirely in JavaScript: it runs
 * offline, needs no native build, and reading a file sends nothing anywhere.
 * It does not render anything here, and is given no network access to fetch
 * fonts or anything else — text positions are all that is wanted.
 */

const fs = require('fs');
const { pathToFileURL } = require('url');

/** Larger than any class list, small enough to refuse the wrong file fast. */
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_PAGES = 40;

let pdfjsPromise = null;

/**
 * pdf.js ships only as an ES module, so it is loaded with import() rather than
 * require(). On Windows the path has to be a file:// URL — a bare "C:\..." is
 * read as a URL with the scheme "c:" and refused.
 */
function loadPdfjs() {
  if (!pdfjsPromise) {
    const entry = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjsPromise = import(pathToFileURL(entry).href);
  }
  return pdfjsPromise;
}

/** An error worded for the instructor, not for a developer. */
function friendly(message) {
  const err = new Error(message);
  err.friendly = true;
  return err;
}

/**
 * Read every page's text items.
 *
 * @param {string} filePath
 * @returns {Promise<Array<Array<{str, x, y, width, height}>>>} y measured down from the top
 */
async function readPdfText(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_BYTES) {
    throw friendly('That file is too large to be a class list. Choose the roster PDF.');
  }
  const data = new Uint8Array(fs.readFileSync(filePath));

  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data,
    // Never run code from inside a document, and never reach out for fonts.
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    await task.destroy();
    if (err && err.name === 'PasswordException') {
      throw friendly('That PDF is password-protected. Save it again without a password and try once more.');
    }
    throw friendly('That file could not be opened as a PDF.');
  }

  try {
    if (doc.numPages > MAX_PAGES) {
      throw friendly(`That PDF has ${doc.numPages} pages, which is too many for a class list.`);
    }
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const { height } = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      pages.push(
        content.items
          .filter((item) => typeof item.str === 'string')
          .map((item) => ({
            str: item.str,
            // transform[4], transform[5] is where the text starts, measured up
            // from the bottom of the page. Flipped, so larger y is further down.
            x: item.transform[4],
            y: height - item.transform[5],
            width: item.width,
            height: item.height || Math.abs(item.transform[3]) || 10,
          }))
      );
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

module.exports = { readPdfText };
