'use strict';
/**
 * Backup and transfer.
 *
 * Exports the entire database as one JSON file the instructor can copy to a
 * flash drive, and imports it back on another machine. JSON rather than a copy
 * of the SQLite file because it survives a schema change and can be inspected
 * or repaired by hand if it ever has to be — this is the last line of defence
 * against losing a semester of grades.
 */

const fs = require('fs');
const path = require('path');
const { splitName } = require('../engine/roster');

const BACKUP_FORMAT = 'gradedesk-backup';
const BACKUP_VERSION = 1;

/** Tables exported, in dependency order so import can restore them directly. */
const TABLES = [
  'semesters',
  'courses',
  'students',
  'terms',
  'assessments',
  'scores',
  'sessions',
  'marks',
  // Presets last: preset_items points at presets, and nothing points at
  // either, so forward-insert and reverse-delete both stay valid.
  'presets',
  'preset_items',
];

/**
 * Serialise the whole database to a plain object.
 * @param {Store} store
 */
function exportData(store) {
  const data = {};
  for (const table of TABLES) {
    data[table] = store.db.prepare(`SELECT * FROM ${table}`).all();
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    // Row counts are informational: they let the UI show "restored 46 students"
    // and make a truncated file obvious on inspection.
    counts: Object.fromEntries(TABLES.map((t) => [t, data[t].length])),
    data,
  };
}

/** Write a backup to disk. */
function exportToFile(store, filePath) {
  const payload = exportData(store);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

/**
 * Restore a backup, REPLACING everything currently in the store.
 *
 * Destructive by nature, so the caller must confirm with the instructor first.
 * Runs in a single transaction: a malformed backup leaves the existing data
 * untouched rather than half-overwritten.
 *
 * @param {Store} store
 * @param {object} payload  a parsed backup file
 */
function importData(store, payload) {
  if (!payload || payload.format !== BACKUP_FORMAT) {
    throw new Error('This file is not a GradeDesk backup.');
  }
  if (payload.version > BACKUP_VERSION) {
    throw new Error(
      `This backup was made by a newer version of GradeDesk (format ${payload.version}). Update GradeDesk and try again.`
    );
  }
  const data = payload.data || {};
  for (const table of TABLES) {
    if (data[table] !== undefined && !Array.isArray(data[table])) {
      throw new Error(`Backup is malformed: "${table}" is not a list.`);
    }
  }

  return store.transaction(() => {
    // Foreign keys are deferred during the swap so delete order cannot fail.
    store.db.pragma('foreign_keys = OFF');
    try {
      for (const table of [...TABLES].reverse()) {
        store.db.prepare(`DELETE FROM ${table}`).run();
      }
      let restored = 0;
      for (const table of TABLES) {
        const rows = data[table] || [];
        if (!rows.length) continue;
        const columns = Object.keys(rows[0]);
        const placeholders = columns.map(() => '?').join(', ');
        const stmt = store.db.prepare(
          `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`
        );
        for (const row of rows) {
          stmt.run(...columns.map((c) => row[c]));
          restored += 1;
        }
      }
      // A backup written before names were split into columns restores with
      // empty name parts, which would leave those students unsortable by
      // surname. Filling them in here means a flash drive from the old version
      // comes back complete, exactly as an in-place upgrade would.
      backfillNameParts(store);
      return { restored };
    } finally {
      store.db.pragma('foreign_keys = ON');
    }
  });
}

/**
 * Split any restored student who has a written name but no name parts.
 *
 * The same rule as the upgrade in Store._migrate, and idempotent for the same
 * reason: only rows whose parts are all empty are touched, so a backup from the
 * current version — including one where the instructor corrected a name by
 * hand — is restored exactly as it was saved.
 */
function backfillNameParts(store) {
  const pending = store.db
    .prepare(
      `SELECT id, full_name FROM students
        WHERE TRIM(COALESCE(full_name, '')) != ''
          AND TRIM(COALESCE(last_name, '')) = ''
          AND TRIM(COALESCE(first_name, '')) = ''
          AND TRIM(COALESCE(middle_name, '')) = ''`
    )
    .all();
  if (!pending.length) return;
  const update = store.db.prepare(
    'UPDATE students SET last_name = ?, first_name = ?, middle_name = ? WHERE id = ?'
  );
  for (const row of pending) {
    const parts = splitName(row.full_name);
    update.run(parts.lastName, parts.firstName, parts.middleName, row.id);
  }
}

/** Read and restore a backup from disk. */
function importFromFile(store, filePath) {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Could not read that backup file: ${err.message}`);
  }
  return importData(store, payload);
}

module.exports = {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  TABLES,
  exportData,
  exportToFile,
  importData,
  importFromFile,
};
