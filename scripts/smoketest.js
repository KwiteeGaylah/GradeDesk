/**
 * Launches the real GradeDesk app, inspects the live window, and exits non-zero
 * on any renderer error. Run with: npm run smoke
 *
 * This is a genuine end-to-end check that the Electron main process boots, the
 * database opens, IPC answers, and the renderer paints.
 *
 * ELECTRON_RUN_AS_NODE is stripped deliberately: when it is set in the ambient
 * environment (some sandboxes and editors set it), the Electron binary starts
 * as plain Node, `require('electron')` returns the binary path instead of the
 * API, and the app dies with a confusing "cannot read whenReady of undefined".
 */
const path = require('path');
const { spawn } = require('child_process');
const electron = require('electron');

const env = { ...process.env, GRADEDESK_SMOKE: '1' };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [path.join(__dirname, '..')], { env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
