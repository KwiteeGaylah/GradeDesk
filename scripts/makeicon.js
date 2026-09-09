/**
 * Renders build/icon.svg to the PNG sizes electron-builder needs.
 * Uses Electron's own Chromium, so there is no image dependency to install.
 * Run with: npm run icon
 */
const path = require('path');
const { spawn } = require('child_process');
const electron = require('electron');

const env = { ...process.env, GRADEDESK_MAKEICON: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.join(__dirname, '..')], { env, stdio: 'inherit' });
child.on('exit', (c) => process.exit(c ?? 1));
