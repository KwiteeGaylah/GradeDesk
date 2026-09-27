'use strict';
/**
 * Automatic updates.
 *
 * GradeDesk checks GitHub for a newer release when it starts, downloads one in
 * the background, and installs it the next time the app is closed. This is the
 * ONLY part of the app that touches the network, which is why it lives in its
 * own file rather than being threaded through main.js: anyone auditing what
 * leaves this machine has one place to read.
 *
 * What is sent: a request for the release metadata file on github.com. No
 * student data, no grades, no identifying information — the request carries
 * nothing but the version currently installed, in the download URL.
 *
 * WHY IT IS QUIET
 * ---------------
 * These are instructors on unreliable power and, often, metered connections,
 * holding a semester of real grades. So:
 *
 *  * A failed check is not an error. No internet is the normal case in this
 *    setting, and a dialog saying so on every launch would be noise. It is
 *    logged and forgotten.
 *  * Nothing is ever installed while the app is open. An update that replaced
 *    the running app mid-entry would be a way to lose work; it waits for a
 *    close the instructor chose.
 *  * The check is delayed a few seconds after launch, so a slow or hanging
 *    network request can never make the window take longer to appear.
 */

const { autoUpdater } = require('electron-updater');

/** How long after launch to look, so the window is up and usable first. */
const CHECK_DELAY_MS = 4000;

/** Set while an update has been downloaded and is waiting for a close. */
let pendingVersion = null;

/** The renderer, so the app can say what it found. Set by start(). */
let notify = () => {};

/**
 * Begin checking. Safe to call in development, where it does nothing: an
 * unpackaged app has no installer to replace and electron-updater would throw.
 */
function start(app, send) {
  notify = typeof send === 'function' ? send : () => {};

  if (!app.isPackaged) {
    // Running from source. There is nothing to update.
    return;
  }

  // The instructor decides when to close the app; we never do it for them.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    notify({ state: 'downloading', version: info && info.version });
  });

  autoUpdater.on('download-progress', (p) => {
    notify({ state: 'downloading', percent: Math.round((p && p.percent) || 0) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    pendingVersion = (info && info.version) || null;
    notify({ state: 'ready', version: pendingVersion });
  });

  autoUpdater.on('update-not-available', () => {
    notify({ state: 'current' });
  });

  // No internet, GitHub unreachable, a proxy in the way: all ordinary here.
  autoUpdater.on('error', (err) => {
    console.log('[updates] check failed, carrying on:', err && err.message);
    notify({ state: 'offline' });
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.log('[updates] check failed, carrying on:', err && err.message);
      notify({ state: 'offline' });
    });
  }, CHECK_DELAY_MS);
}

/** The version waiting to be installed on close, or null. */
function pending() {
  return pendingVersion;
}

/**
 * Install now, which quits the app.
 *
 * Only called from a button the instructor pressed. Everything is already on
 * disk — every score commits the moment it leaves its box — so there is nothing
 * to save first, but it is still their choice when the window closes.
 */
function installNow() {
  if (!pendingVersion) return false;
  autoUpdater.quitAndInstall(false, true);
  return true;
}

module.exports = { start, pending, installNow, CHECK_DELAY_MS };
