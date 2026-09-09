/**
 * Seeds a realistic course, opens grade entry, and writes a PNG of the window.
 * Run with: npm run screenshot -- <output.png>
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const electron = require('electron');

const out = process.argv[2] || path.join(process.cwd(), 'gradedesk.png');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gradedesk-shot-'));
const env = {
  ...process.env,
  GRADEDESK_SHOT: out,
  GRADEDESK_DB: path.join(dir, 'shot.db'),
};
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [path.join(__dirname, '..')], { env, stdio: 'inherit' });
child.on('exit', (code) => {
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(code ?? 1);
});
