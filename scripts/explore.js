'use strict';
/**
 * Interactive exploration harness.
 *
 * Keeps the real app open and watches a command file. Each line written to that
 * file is executed in the live renderer and the result appended to a log, so a
 * person (or an agent) can drive the running application step by step instead of
 * replaying a fixed script.
 *
 * Commands are JSON lines:
 *   {"id":1,"js":"document.title"}                  evaluate in the renderer
 *   {"id":2,"shot":"C:/path/out.png"}               capture the window
 *   {"id":3,"key":"Enter"}                          send a real key press
 *   {"id":4,"type":"12"}                            type real characters
 *   {"id":5,"click":".atab"}                        click the first match
 *   {"id":6,"quit":true}                            close the app
 *
 * Real key and type commands go through Electron's input pipeline, so they
 * exercise the same path a human keyboard does, not a synthetic DOM event.
 */

const fs = require('fs');
const path = require('path');

const POLL_MS = 120;

async function explore(win, app, cmdFile, logFile) {
  const write = (obj) => fs.appendFileSync(logFile, JSON.stringify(obj) + '\n', 'utf8');

  const consoleErrors = [];
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 3) consoleErrors.push(event.message);
  });

  let handled = 0;
  write({ ready: true, note: 'explore harness attached' });

  const sendKey = (key, modifiers = []) => {
    win.webContents.focus();
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers });
    if (key.length === 1) win.webContents.sendInputEvent({ type: 'char', keyCode: key, modifiers });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers });
  };

  const tick = async () => {
    let lines = [];
    try {
      lines = fs.readFileSync(cmdFile, 'utf8').split('\n').filter((l) => l.trim());
    } catch {
      return; // command file not created yet
    }
    while (handled < lines.length) {
      const raw = lines[handled];
      handled += 1;
      let cmd;
      try {
        cmd = JSON.parse(raw);
      } catch (err) {
        write({ error: `bad command: ${raw}` });
        continue;
      }
      try {
        if (cmd.quit) {
          write({ id: cmd.id, ok: true, quit: true });
          setTimeout(() => app.exit(0), 150);
          return;
        }
        if (cmd.resize) {
          // Unmaximise first: a maximised window silently ignores a resize, so
          // without this the requested size is quietly not applied.
          if (win.isMaximized()) win.unmaximize();
          if (win.isFullScreen()) win.setFullScreen(false);
          win.setResizable(true);
          win.setContentSize(cmd.resize[0], cmd.resize[1]);
          await new Promise((r) => setTimeout(r, cmd.wait ?? 700));
          const [w, h] = win.getContentSize();
          const applied = w === cmd.resize[0] && h === cmd.resize[1];
          write({ id: cmd.id, ok: true, requested: cmd.resize, contentSize: { w, h }, applied });
          continue;
        }
        if (cmd.move) {
          // Move the pointer without clicking, so hover states are exercised and
          // the drawn cursor in a screenshot shows where a user is pointing.
          const at = await win.webContents.executeJavaScript(
            `(() => { const n = document.querySelector(${JSON.stringify(cmd.move)});
                      if (!n) return null; const r = n.getBoundingClientRect();
                      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`
          );
          if (!at) { write({ id: cmd.id, ok: false, error: 'no such element' }); continue; }
          win.webContents.sendInputEvent({ type: 'mouseMove', x: at.x, y: at.y });
          await win.webContents.executeJavaScript(
            `(() => { let c = document.getElementById('__cursor');
               if (!c) { c = document.createElement('div'); c.id = '__cursor';
                 c.style.cssText = 'position:fixed;z-index:9999;width:18px;height:18px;pointer-events:none;' +
                   'border-left:2px solid #111;border-top:2px solid #111;' +
                   'transform:rotate(-30deg);filter:drop-shadow(0 0 2px #fff)';
                 document.body.appendChild(c); }
               c.style.left = ${at.x} + 'px'; c.style.top = ${at.y} + 'px'; })()`
          );
          await new Promise((r) => setTimeout(r, cmd.wait ?? 250));
          write({ id: cmd.id, ok: true, at });
          continue;
        }
        if (cmd.shot) {
          const image = await win.webContents.capturePage();
          fs.writeFileSync(cmd.shot, image.toPNG());
          write({ id: cmd.id, ok: true, shot: cmd.shot });
          continue;
        }
        if (cmd.key) {
          sendKey(cmd.key, cmd.modifiers || []);
          await new Promise((r) => setTimeout(r, cmd.wait ?? 250));
          write({ id: cmd.id, ok: true, sentKey: cmd.key });
          continue;
        }
        if (cmd.type !== undefined) {
          for (const ch of String(cmd.type)) sendKey(ch);
          await new Promise((r) => setTimeout(r, cmd.wait ?? 250));
          write({ id: cmd.id, ok: true, typed: cmd.type });
          continue;
        }
        if (cmd.mouse) {
          // A real mouse click at the element's centre, through Electron's input
          // pipeline, so focus behaves exactly as it does for a person.
          const box = await win.webContents.executeJavaScript(
            `(() => { const n = document.querySelector(${JSON.stringify(cmd.mouse)});
                      if (!n) return null; const r = n.getBoundingClientRect();
                      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`
          );
          if (!box) { write({ id: cmd.id, ok: false, error: 'no such element' }); continue; }
          win.webContents.sendInputEvent({ type: 'mouseDown', x: box.x, y: box.y, button: 'left', clickCount: 1 });
          win.webContents.sendInputEvent({ type: 'mouseUp', x: box.x, y: box.y, button: 'left', clickCount: 1 });
          await new Promise((r) => setTimeout(r, cmd.wait ?? 300));
          write({ id: cmd.id, ok: true, mouse: cmd.mouse, at: box });
          continue;
        }
        if (cmd.click) {
          const found = await win.webContents.executeJavaScript(
            `(() => { const n = document.querySelector(${JSON.stringify(cmd.click)});
                      if (!n) return false; n.click(); return true; })()`
          );
          await new Promise((r) => setTimeout(r, cmd.wait ?? 400));
          write({ id: cmd.id, ok: found, clicked: cmd.click });
          continue;
        }
        if (cmd.js) {
          const value = await win.webContents.executeJavaScript(`(async () => { ${cmd.js} })()`);
          write({ id: cmd.id, ok: true, value });
          continue;
        }
        write({ id: cmd.id, error: 'unrecognised command' });
      } catch (err) {
        write({ id: cmd.id, error: err.message });
      }
    }
    if (consoleErrors.length) {
      write({ consoleErrors: consoleErrors.splice(0) });
    }
  };

  setInterval(tick, POLL_MS);
}

module.exports = { explore };
