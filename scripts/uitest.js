/**
 * Drives the real UI end to end against a throwaway database: creates a course,
 * adds assessments and a roster, types scores into the grade-entry column, and
 * checks the cells on screen match the verified engine result.
 *
 * Run with: npm run uitest
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const electron = require('electron');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gradedesk-uitest-'));
const env = {
  ...process.env,
  GRADEDESK_UITEST: '1',
  GRADEDESK_DB: path.join(dir, 'uitest.db'),
};
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [path.join(__dirname, '..')], { env, stdio: 'inherit' });
child.on('exit', (code) => {
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(code ?? 1);
});
