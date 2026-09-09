'use strict';
/**
 * Electron main process.
 *
 * Owns the database and the grade engine. The renderer never touches SQLite or
 * the filesystem directly — it asks over IPC. That keeps the window sandboxed
 * (no node integration, context isolation on) and keeps every write funnelled
 * through one auditable place.
 */

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');

const { Store } = require('./data/store');
const { computeCourse, reviewIssues } = require('./data/gradebook');
const { exportToFile, importFromFile } = require('./data/backup');
const { TransmutationTables, allPolicies, validateMaxPoints, strandedByPolicy, DEFAULT_POLICY } =
  require('./engine');
const { exportGradeRecord, exportSummary } = require('./export/excel');

const TABLES_JSON = path.join(__dirname, '..', 'data', 'transmutation_tables.json');

let store = null;
let tables = null;
let mainWindow = null;

/**
 * Where the instructor's data lives. One file, easy to find and to copy.
 * The UI test points this at a throwaway file so it can never touch real data.
 */
function databasePath() {
  if (process.env.GRADEDESK_DB) return process.env.GRADEDESK_DB;
  return path.join(app.getPath('userData'), 'gradedesk.db');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#eef1f6',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Nothing in this app should ever open a browser; it is offline by design.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Development harnesses only. The scripts directory is not shipped in the
  // packaged app, so these requires are guarded: a packaged build ignores them
  // even if one of the variables happens to be set in the environment.
  if (process.env.GRADEDESK_SMOKE) runSmokeCheck(mainWindow);
  if (process.env.GRADEDESK_UITEST) loadHarness('uidriver', (m) => m.drive(mainWindow, app));
  if (process.env.GRADEDESK_SHOT) {
    loadHarness('shotdriver', (m) => m.capture(mainWindow, app, process.env.GRADEDESK_SHOT));
  }
}

function loadHarness(name, run) {
  try {
    run(require(`../scripts/${name}`));
  } catch (err) {
    console.error(`Test harness "${name}" is unavailable in this build:`, err.message);
  }
}

/**
 * Self-check used by `npm run smoke`: waits for the renderer to paint, reports
 * what it found, and exits non-zero on any renderer error. This is how the app
 * is verified to actually boot, rather than merely to parse.
 */
function runSmokeCheck(win) {
  const errors = [];
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 3) errors.push(event.message);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('SMOKE: renderer crashed:', details.reason);
    app.exit(1);
  });

  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const info = await win.webContents.executeJavaScript(
          `(() => ({
             rail: !!document.querySelector('.rail'),
             semesters: document.querySelectorAll('#semesterSelect option').length,
             courseLinks: document.querySelectorAll('#courseNav a').length,
             screenLinks: document.querySelectorAll('#screenNav a').length,
             title: document.getElementById('screenTitle').textContent,
             content: document.getElementById('content').textContent.trim().slice(0, 100)
           }))()`
        );
        console.log('SMOKE RESULT:', JSON.stringify(info, null, 2));
        console.log('SMOKE ERRORS:', errors.length ? errors : 'none');
        const ok = info.rail && info.screenLinks === 4 && errors.length === 0;
        console.log(ok ? 'SMOKE: PASS' : 'SMOKE: FAIL');
        app.exit(ok ? 0 : 1);
      } catch (err) {
        console.error('SMOKE: evaluation failed:', err.message);
        app.exit(1);
      }
    }, 1500);
  });
}

app.whenReady().then(() => {
  tables = new TransmutationTables(JSON.parse(fs.readFileSync(TABLES_JSON, 'utf8')));
  store = new Store(databasePath());
  seedIfEmpty();
  registerHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/**
 * Close the database on every exit path, not just the tidy one.
 *
 * Each write already commits with synchronous=FULL, so nothing typed is at risk
 * even if the process is killed outright. Closing cleanly additionally
 * checkpoints the write-ahead log, so the next launch starts from a single
 * consistent file rather than replaying a journal.
 */
function closeStore() {
  if (!store) return;
  try {
    store.close();
  } catch {
    // Already closed, or the process is going down mid-write. The data on disk
    // is committed either way; there is nothing useful to do here.
  }
  store = null;
}

app.on('before-quit', closeStore);
process.on('exit', closeStore);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    closeStore();
    app.exit(0);
  });
}
process.on('uncaughtException', (err) => {
  console.error('Unexpected error:', err);
  closeStore();
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showErrorBox(
      'GradeDesk hit an unexpected problem',
      `${err.message}\n\nYour data is saved. Please restart GradeDesk.`
    );
  }
  app.exit(1);
});

/** A brand-new install gets an active semester so the app is never dead on arrival. */
function seedIfEmpty() {
  if (store.listSemesters().length === 0) {
    const year = new Date().getFullYear();
    store.createSemester(`${year}–${year + 1} Semester 1`);
  }
}

/** Wrap a handler so an error reaches the renderer as a message, not a crash. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
}

function registerHandlers() {
  // ---- reference data ----
  handle('policies:list', () => allPolicies(tables));
  handle('policies:maximums', (policy) => tables.supportedMaximums(policy));
  handle('policies:validateMax', (maxPoints, policy) => validateMaxPoints(maxPoints, policy, tables));
  handle('policies:stranded', (assessments, newPolicy) =>
    strandedByPolicy(assessments, newPolicy, tables)
  );

  // ---- semesters ----
  handle('semesters:list', () => store.listSemesters());
  handle('semesters:active', () => store.getActiveSemester());
  handle('semesters:create', (name) => store.createSemester(name));
  handle('semesters:activate', (id) => store.activateSemester(id));
  handle('semesters:rename', (id, name) => store.renameSemester(id, name));

  // ---- courses ----
  handle('courses:list', (semesterId) => store.listCourses(semesterId));
  handle('courses:get', (id) => store.getCourse(id));
  handle('courses:create', (payload) => store.createCourse(payload));
  handle('courses:update', (id, fields) => store.updateCourse(id, fields));
  handle('courses:delete', (id) => store.deleteCourse(id));
  handle('courses:terms', (courseId) => store.getTerms(courseId));

  // ---- roster ----
  handle('students:list', (courseId) => store.listStudents(courseId));
  handle('students:add', (courseId, row) => store.addStudent(courseId, row));
  handle('students:addMany', (courseId, rows) => store.addStudents(courseId, rows));
  handle('students:update', (id, fields) => store.updateStudent(id, fields));
  handle('students:delete', (id) => store.deleteStudent(id));

  // ---- assessments ----
  handle('assessments:list', (termId) => store.listAssessments(termId));
  handle('assessments:add', (termId, payload) => store.addAssessment(termId, payload));
  handle('assessments:update', (id, fields) => store.updateAssessment(id, fields));
  handle('assessments:delete', (id) => store.deleteAssessment(id));
  handle('assessments:countScores', (id) => store.countScores(id));

  // ---- scores ----
  handle('scores:set', (studentId, assessmentId, rawValue) => {
    store.setScore(studentId, assessmentId, rawValue);
    return true;
  });
  handle('scores:setMany', (entries) => {
    store.setScores(entries);
    return true;
  });

  // ---- attendance ----
  handle('sessions:list', (termId) => store.listSessions(termId));
  handle('sessions:add', (courseId, termId, date) => store.addSession(courseId, termId, date));
  handle('sessions:delete', (id) => store.deleteSession(id));
  handle('sessions:countMarks', (id) => store.countMarks(id));
  handle('marks:set', (studentId, sessionId, code) => {
    store.setMark(studentId, sessionId, code);
    return true;
  });
  handle('marks:forTerm', (termId) => {
    const { sessions, byStudent } = store.getMarksForTerm(termId);
    return { sessions, marks: [...byStudent.entries()] };
  });

  // ---- computation ----
  handle('gradebook:compute', (courseId) => computeCourse(store, courseId, tables));
  handle('gradebook:issues', (courseId) => reviewIssues(store, courseId, tables));

  // ---- export and backup ----
  handle('export:gradeRecord', async (courseId) => {
    const result = computeCourse(store, courseId, tables);
    const suggested = `${(result.course.code || 'Course').replace(/[\\/:*?"<>|]/g, '-')} Grade Record.xlsx`;
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export grade record',
      defaultPath: path.join(app.getPath('documents'), suggested),
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });
    if (canceled || !filePath) return null;
    await exportGradeRecord(result, filePath);
    return filePath;
  });

  handle('export:summary', async (courseId) => {
    const result = computeCourse(store, courseId, tables);
    const suggested = `${(result.course.code || 'Course').replace(/[\\/:*?"<>|]/g, '-')} Summary.xlsx`;
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export summary sheet',
      defaultPath: path.join(app.getPath('documents'), suggested),
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });
    if (canceled || !filePath) return null;
    await exportSummary(result, filePath);
    return filePath;
  });

  handle('backup:export', async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Back up all GradeDesk data',
      defaultPath: path.join(app.getPath('documents'), `GradeDesk Backup ${stamp}.json`),
      filters: [{ name: 'GradeDesk Backup', extensions: ['json'] }],
    });
    if (canceled || !filePath) return null;
    exportToFile(store, filePath);
    return filePath;
  });

  handle('backup:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Restore GradeDesk data',
      properties: ['openFile'],
      filters: [{ name: 'GradeDesk Backup', extensions: ['json'] }],
    });
    if (canceled || !filePaths.length) return null;

    const confirm = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Cancel', 'Replace all data'],
      defaultId: 0,
      cancelId: 0,
      title: 'Replace all data?',
      message: 'Restoring a backup replaces everything currently in GradeDesk.',
      detail:
        'All semesters, courses, rosters and scores on this machine will be replaced by the ' +
        'contents of the backup file. This cannot be undone.',
    });
    if (confirm.response !== 1) return null;

    const result = importFromFile(store, filePaths[0]);
    return { file: filePaths[0], ...result };
  });

  handle('app:revealData', () => {
    shell.showItemInFolder(databasePath());
    return databasePath();
  });
  handle('app:dataPath', () => databasePath());
  handle('app:defaultPolicy', () => DEFAULT_POLICY);
}
