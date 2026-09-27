'use strict';
/**
 * Automatic updates.
 *
 * This is the only part of GradeDesk that touches the network, in a product
 * whose whole promise is that grades stay on the instructor's machine. These
 * check the properties that make that acceptable: it sends nothing, it fails
 * quietly, and it never replaces the app while someone is typing into it.
 *
 * Source-level checks. The behaviour itself was driven in the real app.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'updates.js'), 'utf8');
const MAIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const PRELOAD = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
const PKG = require('../package.json');

test('the network code lives in one file, not spread through the app', () => {
  // Anyone auditing what leaves this machine should have one place to read.
  assert.match(SRC, /electron-updater/);
  assert.ok(!/electron-updater/.test(PRELOAD), 'the preload bridge must not pull it in');
  // main.js may require the module, but must not drive the updater itself.
  assert.ok(!/autoUpdater\./.test(MAIN), 'main.js should go through src/updates.js');
});

test('a failed check is not an error', () => {
  // No internet is the ordinary case for these users. A dialog on every launch
  // would train them to dismiss dialogs.
  assert.match(SRC, /autoUpdater\.on\('error'/, 'errors are handled');
  assert.match(SRC, /carrying on/, 'and swallowed rather than surfaced as a failure');
  assert.ok(!/dialog\.showErrorBox|dialog\.showMessageBox/.test(SRC),
    'an update problem must never interrupt with a dialog');
});

test('nothing is installed while the app is open', () => {
  // Replacing the app mid-entry is a way to lose work.
  assert.match(SRC, /autoInstallOnAppQuit = true/);
  assert.ok(!/quitAndInstall\(\)/.test(SRC), 'never installs unprompted');
  // The one call that does install is behind a function the UI calls from a
  // button, and it checks something is actually pending first.
  assert.match(SRC, /function installNow\(\)[\s\S]*?if \(!pendingVersion\) return false;/);
});

test('the check is delayed so it cannot slow the window down', () => {
  assert.match(SRC, /setTimeout\(\(\) => \{[\s\S]*?checkForUpdates/);
  assert.ok(SRC.includes('CHECK_DELAY_MS'), 'the delay is named, not a magic number');
});

test('it does nothing when running from source', () => {
  // An unpackaged app has no installer to replace.
  assert.match(SRC, /if \(!app\.isPackaged\)[\s\S]{0,120}return;/);
});

test('the renderer can see the version and act on an update', () => {
  assert.match(PRELOAD, /version: \(\) => call\('app:version'\)/);
  assert.match(PRELOAD, /pending: \(\) => call\('updates:pending'\)/);
  assert.match(PRELOAD, /install: \(\) => call\('updates:install'\)/);
  assert.match(MAIN, /handle\('app:version'/);
  assert.match(MAIN, /handle\('updates:install'/);
});

test('the build is configured to publish the metadata an update needs', () => {
  // electron-updater reads latest.yml from the release. Without a publish
  // block electron-builder never writes one and updates silently never happen.
  assert.ok(PKG.build.publish, 'package.json build.publish is required');
  assert.equal(PKG.build.publish.provider, 'github');
  assert.equal(PKG.build.publish.owner, 'KwiteeGaylah');
  assert.equal(PKG.build.publish.repo, 'GradeDesk');
});

test('the README no longer claims the app never uses the internet', () => {
  // It does now, once, on launch. Saying otherwise would be a lie to someone
  // deciding whether to trust it with student data.
  const README = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  assert.ok(!/Completely offline\.\*\* No accounts, no internet/.test(README),
    'the blanket offline claim should be gone');
  assert.match(README, /only\*\* part of GradeDesk that uses the internet/i,
    'and what the update check does should be stated plainly');
});
