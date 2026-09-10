/**
 * Catches an identifier that is used but never imported or defined.
 *
 * The export handlers open a save dialog, so no automated test drives them to
 * completion. A missing import there stayed invisible until an instructor
 * clicked Export and got "todayStored is not defined". This loads each module
 * for real and then calls the functions that a test cannot reach, so a missing
 * name fails here instead of in front of the user.
 *
 * Run with: npm run check:refs
 */
const path = require('path');

const problems = [];
const ok = [];

/** Load a module and report a failure rather than throwing. */
function load(rel) {
  try {
    return require(path.join(__dirname, '..', rel));
  } catch (err) {
    problems.push(`${rel} does not load: ${err.message}`);
    return null;
  }
}

// Every module the main process pulls in has to load cleanly on its own.
for (const rel of [
  'src/engine/index.js',
  'src/data/store.js',
  'src/data/gradebook.js',
  'src/data/backup.js',
  'src/export/excel.js',
]) {
  if (load(rel)) ok.push(rel);
}

// The names main.js destructures from the engine must all exist. A typo or a
// forgotten addition here is exactly the bug this script was written for.
const fs = require('fs');
const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const engine = load('src/engine/index.js');
if (engine) {
  const block = /const \{([^}]*)\} = require\('\.\/engine'\);/.exec(mainSrc);
  if (!block) {
    problems.push('src/main.js no longer destructures from ./engine; update this check');
  } else {
    for (const raw of block[1].split(',')) {
      const name = raw.trim();
      if (!name) continue;
      if (!(name in engine)) {
        problems.push(`src/main.js imports "${name}" from ./engine, which does not export it`);
      }
    }
    ok.push(`src/main.js engine imports (${block[1].split(',').filter((s) => s.trim()).length})`);
  }
}

// The same for the export module, which main.js also destructures.
const excel = load('src/export/excel.js');
if (excel) {
  const block = /const \{([^}]*)\} = require\('\.\/export\/excel'\);/.exec(mainSrc);
  if (block) {
    for (const raw of block[1].split(',')) {
      const name = raw.trim();
      if (name && !(name in excel)) {
        problems.push(`src/main.js imports "${name}" from ./export/excel, which does not export it`);
      }
    }
    ok.push('src/main.js export imports');
  }
}

// The other direction, which is where the real bug was: a name main.js USES
// but never imported. Removing an import is invisible to the check above,
// because there is then nothing to look up.
if (engine && excel) {
  const localNames = new Set();
  for (const m of mainSrc.matchAll(/(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g)) {
    localNames.add(m[1]);
  }
  for (const m of mainSrc.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().trim();
      if (name) localNames.add(name);
    }
  }

  // Anything exported by a module main.js pulls from is fair game to use, so
  // check each such name: if main.js calls it, it must also import it.
  const available = { ...engine, ...excel };
  const missing = [];
  for (const name of Object.keys(available)) {
    if (typeof available[name] !== 'function') continue;
    const used = new RegExp(String.raw`(?<![.\w$])${name}\s*\(`).test(mainSrc);
    if (used && !localNames.has(name)) {
      missing.push(name);
    }
  }
  if (missing.length) {
    for (const name of missing) {
      problems.push(`src/main.js calls ${name}() without importing it`);
    }
  } else {
    ok.push('src/main.js imports everything it calls');
  }
}

// And the file-name builder, which only runs behind a save dialog.
if (engine) {
  try {
    const name = engine.formatDateForFilename(engine.todayStored());
    if (!name || /undefined/.test(name)) {
      problems.push(`the export file name comes out as "${name}"`);
    } else {
      ok.push(`export file name: "${name}"`);
    }
  } catch (err) {
    problems.push(`building an export file name throws: ${err.message}`);
  }
}

for (const line of ok) console.log('ok    ' + line);
if (problems.length) {
  console.log('');
  for (const p of problems) console.log('FAIL  ' + p);
  console.log(`\n${problems.length} problem(s)`);
  process.exit(1);
}
console.log('\nall module references resolve');
