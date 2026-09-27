'use strict';
/**
 * The in-app half of `npm run uitest`.
 *
 * Runs inside the main process, drives the real renderer through a full
 * instructor workflow, and asserts what appears on screen. It uses the same IPC
 * the UI uses and then reads the rendered DOM, so it catches wiring mistakes a
 * unit test cannot: a handler that is never registered, a column that renders
 * the wrong field, a keystroke that does not advance.
 *
 * Every check is reported; the process exits non-zero if any fails.
 */

const checks = [];
function check(name, condition, detail) {
  checks.push({ name, ok: !!condition, detail });
}

/** Evaluate an expression in the renderer and return its value. */
const run = (win, expr) => win.webContents.executeJavaScript(expr);

async function drive(win, app) {
  const errors = [];
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 3) errors.push(event.message);
  });

  try {
    await new Promise((r) => setTimeout(r, 1200));

    // ---- create a course through the real API the UI calls ----
    const setup = await run(win, `(async () => {
      const api = window.gradedesk;
      const semester = await api.semesters.active();
      const course = await api.courses.create({
        semesterId: semester.id, code: 'CSE 102', name: 'Computer Literacy',
        section: '2', instructor: 'K. Gaylah', policy: '70'
      });
      const terms = await api.courses.terms(course.id);
      const mid = terms.byKind.midterm, fin = terms.byKind.final;
      const a = {};
      a.assign = await api.assessments.add(mid.id, { name: 'Assign 1', maxPoints: 10 });
      a.quiz1  = await api.assessments.add(mid.id, { name: 'Quiz 1', maxPoints: 15 });
      a.quiz3  = await api.assessments.add(fin.id, { name: 'Quiz 3', maxPoints: 15 });
      a.project= await api.assessments.add(fin.id, { name: 'Project', maxPoints: 25 });
      const students = await api.students.addMany(course.id, [
        { studentId: '10001', fullName: 'Bestman, Comfort K.' },
        { studentId: '10002', fullName: 'Bestman, Daniel T.' },
        { studentId: '10007', fullName: 'Karnga, Esther' }
      ]);
      return { courseId: course.id, assessments: a, studentIds: students.map(s => s.id) };
    })()`);

    check('course, assessments and roster created via IPC', setup && setup.courseId > 0);

    // ---- reload the UI onto that course, open grade entry ----
    await run(win, `(async () => {
      await loadAll();
      state.courseId = ${setup.courseId};
      state.screen = 'grades';
      await loadCourseDetail();
      renderRail();
      await renderScreen();
    })()`);

    const rail = await run(win, `({
      courses: document.querySelectorAll('#courseNav a').length,
      title: document.getElementById('screenTitle').textContent,
      // Every assessment in the term is a column now, rather than one being
      // chosen from a picker.
      entryHeads: [...document.querySelectorAll('#content thead th.th-entry')]
        .map(t => t.textContent.replace(/\s+/g, ' ').trim()),
      termTabs: [...document.querySelectorAll('#content .assessbar .atab')].map(b => b.textContent)
    })`);
    check('course appears in the left rail', rail.courses >= 2, JSON.stringify(rail.courses));
    check('grade entry screen is showing', rail.title === 'Grade entry', rail.title);
    check(
      'every assessment in the term is its own entry column',
      rail.entryHeads.length >= 3 &&
        rail.entryHeads.some((h) => h.includes('Quiz 1') && h.includes('/15')) &&
        rail.entryHeads.some((h) => h.includes('/10')) &&
        rail.entryHeads.some((h) => h.includes('/40')),
      JSON.stringify(rail.entryHeads)
    );
    check(
      'both terms are reachable from the term switch',
      rail.termTabs.length === 2 && rail.termTabs.join(' ').includes('Final'),
      JSON.stringify(rail.termTabs)
    );

    // A null child rendered as the literal word "null" once; guard against it.
    const stray = await run(win, `(() => {
      const text = document.getElementById('content').textContent;
      return { hasNull: /\\bnull\\b/.test(text), hasUndefined: /\\bundefined\\b/.test(text) };
    })()`);
    check('no stray "null" or "undefined" rendered on screen', !stray.hasNull && !stray.hasUndefined, JSON.stringify(stray));

    // ---- type a score into a column, exactly as an instructor would ----
    // Cells are found by their role rather than by position: the grid holds one
    // column per assessment and optionally a transmuted column beside each, so a
    // fixed index would point at the wrong thing.
    const typed = await run(win, `(async () => {
      const heads = [...document.querySelectorAll('#content thead th.th-entry')];
      const quizCol = heads.findIndex(h => h.innerText.includes('Quiz 1'));
      // Show the transmuted columns so the lookup value can be read off screen.
      state.showTransmuted = true;
      await renderScreen();
      await new Promise(r => setTimeout(r, 500));
      const input = document.querySelector('#content input[data-row="0"][data-col="' + quizCol + '"]');
      const assessmentId = input.dataset.assessmentId;
      input.focus();
      input.value = '11';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 600));
      const tr = document.querySelectorAll('#content tbody tr')[0];
      const role = (r) => { const td = tr.querySelector('td[data-role="' + r + '"]'); return td ? td.textContent : null; };
      return {
        raw: input.value,
        transmuted: tr.querySelector('td[data-trans-for="' + assessmentId + '"]').textContent,
        classStanding: role('cs'),
        midtermTotal: role('total'),
        finalGrade: role('grade'),
        letter: role('letter')
      };
    })()`);

    // Quiz 1 = 11/15 transmutes to 70 in the 70% table.
    check('typed raw score is kept', typed.raw === '11', typed.raw);
    check('transmuted column shows the snap-down lookup value', typed.transmuted === '70', typed.transmuted);
    check('class standing recomputes live', typed.classStanding !== '—', typed.classStanding);
    check('midterm total recomputes live', typed.midtermTotal !== '—', typed.midtermTotal);

    // ---- Enter goes down a column, Tab goes across a row, like Excel ----
    const advanced = await run(win, `(async () => {
      const at = (r, c) => document.querySelector('#content input[data-row="' + r + '"][data-col="' + c + '"]');
      const where = () => {
        const a = document.activeElement;
        return a && a.dataset && a.dataset.row !== undefined ? a.dataset.row + ',' + a.dataset.col : null;
      };
      const press = (el, key, shift) => el.dispatchEvent(
        new KeyboardEvent('keydown', { key, shiftKey: !!shift, bubbles: true }));
      const res = {};
      // Start from a column that is definitely typeable, not attendance.
      const heads = [...document.querySelectorAll('#content thead th.th-entry')];
      const col = heads.findIndex(h => h.innerText.includes('Quiz 1'));
      res.col = col;
      at(0, col).focus(); press(at(0, col), 'Enter');      res.down = where();
      at(0, col).focus(); press(at(0, col), 'Tab');        res.across = where();
      at(0, col).focus(); press(at(0, col), 'ArrowDown');  res.arrowDown = where();
      return res;
    })()`);
    check('Enter advances to the next student down the column',
      advanced.down === '1,' + advanced.col, JSON.stringify(advanced));
    check('Tab advances to the next assessment across the row',
      advanced.across === '0,' + (advanced.col + 1), JSON.stringify(advanced));
    check('the arrow keys move down the column too',
      advanced.arrowDown === '1,' + advanced.col, JSON.stringify(advanced));

    // ---- the computed values must equal the engine's own answer ----
    const cross = await run(win, `(async () => {
      const api = window.gradedesk;
      const result = await api.gradebook.compute(${setup.courseId});
      const row = result.students[0];
      const tr = document.querySelectorAll('#content tbody tr')[0];
      return {
        screenGrade: tr.querySelector('td[data-role="grade"]').textContent,
        engineGrade: row.finalGradeDisplay,
        screenLetter: tr.querySelector('td[data-role="letter"]').textContent.trim(),
        engineLetter: row.letter
      };
    })()`);
    check(
      'the grade on screen equals the engine result exactly',
      cross.screenGrade === cross.engineGrade,
      JSON.stringify(cross)
    );
    check('the letter on screen equals the engine result', cross.screenLetter === cross.engineLetter, JSON.stringify(cross));

    // ---- a blank exam must read as I ----
    const incomplete = await run(win, `(async () => {
      const api = window.gradedesk;
      const result = await api.gradebook.compute(${setup.courseId});
      return result.students.map(r => r.letter);
    })()`);
    check('students with no exam scores read as I', incomplete.every((l) => l === 'I'), JSON.stringify(incomplete));

    // ---- attendance cycles and feeds the engine ----
    const attendance = await run(win, `(async () => {
      const api = window.gradedesk;
      const terms = await api.courses.terms(${setup.courseId});
      const mid = terms.byKind.midterm;
      await api.assessments.add(mid.id, { name: 'Attendance', maxPoints: 10, kind: 'attendance' });
      await api.attendance.addSession(${setup.courseId}, mid.id, '2026-09-02');
      state.screen = 'attendance';
      state.selectedTermKind = 'midterm';
      await loadCourseDetail();
      renderRail();
      await renderScreen();
      await new Promise(r => setTimeout(r, 400));
      const cell = document.querySelector('#content td.att');
      const before = cell.textContent.trim();
      cell.click();
      await new Promise(r => setTimeout(r, 500));
      const row = document.querySelectorAll('#content tbody tr')[0].querySelectorAll('td');
      return { before, after: cell.textContent.trim(), raw: row[row.length - 2].textContent };
    })()`);
    check('an attendance cell cycles from blank to P', attendance.before === '·' && attendance.after === 'P', JSON.stringify(attendance));
    check('attendance raw score computes from the marks', attendance.raw === '10.00', JSON.stringify(attendance));

    // ---- roster screen edits persist ----
    const roster = await run(win, `(async () => {
      state.screen = 'roster';
      renderRail();
      await renderScreen();
      await new Promise(r => setTimeout(r, 300));
      const rows = document.querySelectorAll('#content tbody tr').length;
      const lastInput = document.querySelector('#content input[data-row="0"][data-col="1"]');
      const firstInput = document.querySelector('#content input[data-row="0"][data-col="2"]');
      return {
        rows,
        lastName: lastInput ? lastInput.value : null,
        firstName: firstInput ? firstInput.value : null,
      };
    })()`);
    check('roster shows every student as an editable row', roster.rows === 3, JSON.stringify(roster));
    // The roster grid is now the administration's four columns, so col 1 is the
    // surname and col 2 the first name, rather than one combined name box.
    check('roster cells hold the typed name parts',
      roster.lastName === 'Bestman' && roster.firstName === 'Comfort',
      JSON.stringify(roster));

    // ---- config screen offers only supported maxima ----
    const config = await run(win, `(async () => {
      state.screen = 'config';
      renderRail();
      await renderScreen();
      await new Promise(r => setTimeout(r, 300));
      const options = [...document.querySelectorAll('#content .arow select option')]
        .map(o => o.value).filter((v, i, arr) => arr.indexOf(v) === i);
      const optionLabels = [...document.querySelectorAll('#content .arow select option')]
        .map(o => o.textContent.trim()).filter((v, i, arr) => arr.indexOf(v) === i);
      const policies = [...document.querySelectorAll('#content .field select option')].map(o => o.value);
      const examBadge = !!document.querySelector('#content .badge.exam');
      return { options, optionLabels, policies, examBadge };
    })()`);
    // 20 points is offered now: the 70% table had no such column because the
    // workbook it was transcribed from has only seven, and instructors do set
    // 20-point work. It is reconstructed and labelled as worked out.
    check(
      'every supported maximum is offered, including 20',
      ['5', '10', '15', '20', '25', '30', '35', '40', '45', '50']
        .every((m) => config.options.includes(m)),
      JSON.stringify(config.options)
    );
    check(
      'a maximum no table has is still not offered',
      !config.options.includes('17') && !config.options.includes('100'),
      JSON.stringify(config.options)
    );
    check(
      'the reconstructed 20-point column is labelled, not passed off as copied',
      /20 pts \(worked out\)/.test(config.optionLabels.join(' | ')),
      JSON.stringify(config.optionLabels.filter((l) => /^(15|20|25) pts/.test(l)))
    );
    check('all three policies are offered', ['50', '60', '70'].every((p) => config.policies.includes(p)), JSON.stringify(config.policies));
    check('the exam is shown as fixed at 40', config.examBadge);

    // ---- search and sort actually reorder the class list ----
    const sorting = await run(win, `(async () => {
      const api = window.gradedesk;
      const studs = await api.students.list(state.courseId);
      const ids = ['10001', '10014', 'TU-90001'];
      for (let i = 0; i < studs.length && i < ids.length; i++) {
        await api.students.update(studs[i].id, { studentId: ids[i] });
      }
      state.screen = 'grades';
      const all = [...state.assessments.midterm, ...state.assessments.final];
      const q1 = all.find(a => a.name === 'Quiz 1') || all[0];
      state.selectedAssessmentId = q1.id;
      state.selectedTermKind = 'midterm';
      await loadCourseDetail(); renderRail(); await renderScreen();
      await new Promise(r => setTimeout(r, 400));

      const names = () => [...document.querySelectorAll('#content tbody tr td.name')]
        .map(t => t.textContent.replace('not on roster', '').trim());
      const sids = () => [...document.querySelectorAll('#content tbody tr td.sid')]
        .map(t => t.textContent.trim());
      const pick = (v) => { const s = document.querySelector('.sortbox');
        s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); };

      const out = {};
      pick('roster'); await new Promise(r => setTimeout(r, 250));
      out.roster = names();
      pick('last'); await new Promise(r => setTimeout(r, 250));
      out.byName = names();
      pick('first'); await new Promise(r => setTimeout(r, 250));
      out.byFirst = names();
      pick('id'); await new Promise(r => setTimeout(r, 250));
      out.byId = sids();
      // Search narrows to one student.
      const box = document.querySelector('.searchbox');
      box.value = names()[0].split(',')[0];
      box.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 250));
      out.searchCount = document.querySelectorAll('#content tbody tr').length;
      out.countLabel = document.querySelector('.rowcount').textContent;
      box.value = ''; box.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 250));
      pick('roster');
      return out;
    })()`);

    const sortedCopy = [...sorting.byName].sort((a, b) => a.localeCompare(b));
    check('sorting by name really reorders the list',
      JSON.stringify(sorting.byName) === JSON.stringify(sortedCopy), JSON.stringify(sorting.byName));
    check('sorting by student ID puts numbers in numeric order',
      sorting.byId.indexOf('10001') < sorting.byId.indexOf('10014'), JSON.stringify(sorting.byId));
    // Splitting names is what makes this second ordering possible at all.
    check('sorting by first name is offered and differs from last name',
      Array.isArray(sorting.byFirst) && sorting.byFirst.length === sorting.byName.length,
      JSON.stringify(sorting.byFirst));
    check('searching narrows the list to the match', sorting.searchCount >= 1 &&
      sorting.searchCount < sorting.roster.length, JSON.stringify(sorting));
    check('the row count says how many are showing',
      /of/.test(sorting.countLabel), sorting.countLabel);

    // ---- responsive layout: the essentials survive a narrow window ----
    /**
     * Resize the window and wait for the RENDERER to actually be that wide.
     *
     * win.getContentSize() reports what was asked for, not what the window got.
     * On a display whose work area is narrower than the request the OS clamps
     * the window, the viewport never changes, and every responsive check then
     * silently tests the previous width. So the renderer's own innerWidth is
     * what is waited on and returned.
     */
    const setSize = async (w, h) => {
      if (win.isMaximized()) win.unmaximize();
      win.setResizable(true);
      win.setContentSize(w, h);
      let inner = 0;
      for (let i = 0; i < 20; i += 1) {
        await new Promise((r) => setTimeout(r, 100));
        inner = await run(win, 'window.innerWidth');
        if (inner === w) break;
      }
      return { requested: w, inner, content: win.getContentSize() };
    };

    /**
     * The widest viewport this display can actually show.
     *
     * The wide-window checks need to be above the 1180px breakpoint where the
     * running-total columns are hidden. Asking for a fixed 1440 fails on a
     * 1366-wide screen, which is an ordinary laptop size, so the target is
     * taken from the work area instead and the checks are skipped outright if
     * even that cannot clear the breakpoint.
     */
    const WIDE_BREAKPOINT = 1180;
    const workArea = require('electron').screen.getPrimaryDisplay().workAreaSize;
    // Leave room for the window frame, which counts against the work area.
    const wideTarget = Math.max(960, workArea.width - 16);

    await setSize(960, 600);
    // Land on a real class-standing assessment: earlier steps may have left the
    // selection somewhere that renders an empty state rather than the grid.
    await run(win, `(async () => {
      state.screen = 'grades';
      const all = [...state.assessments.midterm, ...state.assessments.final];
      const pick = all.find(a => a.name === 'Quiz 1') || all[0];
      if (pick) {
        state.selectedAssessmentId = pick.id;
        state.selectedTermKind = state.assessments.midterm.some(a => a.id === pick.id) ? 'midterm' : 'final';
      }
      renderRail();
      await renderScreen();
    })()`);
    await new Promise((r) => setTimeout(r, 600));

    const narrow = await run(win, `(() => {
      const card = document.querySelector('#content .gridcard');
      if (!card) return { missing: true, content: document.getElementById('content').innerText.slice(0, 120) };
      const cr = card.getBoundingClientRect();
      const inside = (sel) => { const n = document.querySelector(sel); if (!n) return false;
        const b = n.getBoundingClientRect();
        return b.width > 0 && b.right <= cr.right + 1 && b.left >= cr.left - 1; };
      return {
        width: window.innerWidth,
        finalVisible: inside('#content tbody tr:first-child td.final'),
        letterVisible: inside('#content tbody tr:first-child td.letter'),
        topbarHeight: Math.round(document.querySelector('.topbar').getBoundingClientRect().height),
        tabHeight: Math.round(document.querySelector('.entrybar').getBoundingClientRect().height),
        bodyOverflows: document.body.scrollWidth > document.body.clientWidth + 1,
        clippedCells: [...document.querySelectorAll('#content td, #content th')]
          .filter(c => c.scrollWidth > c.clientWidth + 1 && getComputedStyle(c).display !== 'none').length
      };
    })()`);

    check('narrow window: the final grade stays visible', narrow.finalVisible, JSON.stringify(narrow));
    check('narrow window: the letter stays visible', narrow.letterVisible, JSON.stringify(narrow));
    check('narrow window: the top bar stays one row', narrow.topbarHeight <= 70, `${narrow.topbarHeight}px`);
    check('narrow window: the entry toolbar stays one row', narrow.tabHeight <= 90, `${narrow.tabHeight}px`);
    check('narrow window: the page itself never scrolls sideways', !narrow.bodyOverflows, JSON.stringify(narrow));
    check('narrow window: no cell has clipped content', narrow.clippedCells === 0, `${narrow.clippedCells} clipped`);

    // Attendance is the widest grid: one column per session.
    await run(win, `(async () => { state.screen = 'attendance'; state.selectedTermKind = 'midterm';
      renderRail(); await renderScreen(); })()`);
    await new Promise((r) => setTimeout(r, 600));
    const att = await run(win, `(() => {
      const card = document.querySelector('#content .gridcard');
      if (!card) return { skipped: true };
      const cr = card.getBoundingClientRect();
      const inside = (sel) => { const n = document.querySelector(sel); if (!n) return false;
        const b = n.getBoundingClientRect(); return b.width > 0 && b.right <= cr.right + 1; };
      return { rawVisible: inside('#content tbody tr:first-child td.att-raw'),
               transVisible: inside('#content tbody tr:first-child td.att-trans') };
    })()`);
    if (!att.skipped) {
      check('narrow window: the attendance score stays visible', att.rawVisible, JSON.stringify(att));
      check('narrow window: its transmuted value stays visible', att.transVisible, JSON.stringify(att));
    }

    // Wide again: everything comes back.
    const wideSize = await setSize(wideTarget, Math.min(900, workArea.height - 16));
    await run(win, `(async () => { state.screen = 'grades'; renderRail(); await renderScreen(); })()`);
    await new Promise((r) => setTimeout(r, 600));
    const wide = await run(win, `(() => ({
      innerWidth: window.innerWidth,
      headers: [...document.querySelectorAll('#content thead th')]
        .filter(th => getComputedStyle(th).display !== 'none').map(th => th.innerText.trim()),
      labels: [...document.querySelectorAll('#topActions .btn')].map(b => b.innerText.trim())
    }))()`);

    if (wide.innerWidth <= WIDE_BREAKPOINT) {
      // Said out loud rather than passed quietly: on a screen this narrow the
      // wide layout genuinely cannot be shown, so it has not been tested.
      console.log(`SKIP  wide-window checks: this display gives at most ` +
        `${wide.innerWidth}px, and the wide layout starts above ${WIDE_BREAKPOINT}px ` +
        `(work area ${workArea.width}x${workArea.height}).`);
    } else {
      check('wide window: the running-total columns return',
        wide.headers.includes('Class standing') && wide.headers.some(h => h.endsWith('total')),
        JSON.stringify({ innerWidth: wide.innerWidth, headers: wide.headers }));
      check('wide window: full button labels return',
        wide.labels.some(l => l.includes('Export grade sheet')),
        JSON.stringify({ innerWidth: wide.innerWidth, labels: wide.labels }));
    }

    // The roster carries only its own actions.
    await run(win, `(async () => { state.screen = 'roster'; renderRail(); await renderScreen(); })()`);
    await new Promise((r) => setTimeout(r, 500));
    const rosterLayout = await run(win, `(() => ({
      buttons: [...document.querySelectorAll('#topActions .btn')].map(b => b.innerText.trim()),
      nameAlign: (() => { const i = document.querySelector('#content input[data-col=\"1\"]');
        return i ? getComputedStyle(i).textAlign : null; })()
    }))()`);
    check('the roster shows only roster actions',
      !rosterLayout.buttons.some(b => /Export|Review/.test(b)), JSON.stringify(rosterLayout.buttons));
    check('roster names read left, not centred', rosterLayout.nameAlign === 'left', String(rosterLayout.nameAlign));

    await setSize(1280, 800);
    await run(win, `(async () => { state.screen = 'grades'; renderRail(); await renderScreen(); })()`);
    await new Promise((r) => setTimeout(r, 400));

    // ---- issue review surfaces the blank exams ----
    const issues = await run(win, `(async () => {
      const list = await window.gradedesk.gradebook.issues(${setup.courseId});
      return { count: list.length, kinds: [...new Set(list.map(i => i.kind))] };
    })()`);
    check('issue review reports blank exams', issues.kinds.includes('blank_exam'), JSON.stringify(issues));
    // ---- a long dialog keeps its heading and buttons reachable ----
    const dlg = await run(win, `(async () => {
      const list = await window.gradedesk.gradebook.issues(state.courseId);
      showIssues(list);
      await new Promise(r => setTimeout(r, 500));
      const m = document.querySelector('.modal');
      const head = m.querySelector('.modalhead');
      const bodyEl = m.querySelector('.modalbody');
      const actions = m.querySelector('.actions');
      const headTop = head.getBoundingClientRect().top;
      bodyEl.scrollTop = bodyEl.scrollHeight;
      await new Promise(r => setTimeout(r, 250));
      const mb = m.getBoundingClientRect();
      const out = {
        titleVisible: !!head.querySelector('h3') && head.getBoundingClientRect().bottom > 0,
        headStaysPut: Math.abs(head.getBoundingClientRect().top - headTop) < 2,
        actionsReachable: actions.getBoundingClientRect().bottom <= window.innerHeight + 1,
        fitsOnScreen: mb.top >= -1 && mb.bottom <= window.innerHeight + 1,
        buttons: [...actions.querySelectorAll('.btn')].map(b => b.textContent.trim())
      };
      document.querySelector('.modalbg').remove();
      return out;
    })()`);
    check('a long dialog keeps its title in view while the body scrolls',
      dlg.titleVisible && dlg.headStaysPut, JSON.stringify(dlg));
    check('a long dialog keeps its buttons reachable', dlg.actionsReachable, JSON.stringify(dlg));
    check('a long dialog fits on screen', dlg.fitsOnScreen, JSON.stringify(dlg));
    check('the review dialog offers one dismiss button, not two',
      dlg.buttons.length === 1 && dlg.buttons[0] === 'Close', JSON.stringify(dlg.buttons));
  } catch (err) {
    check('driver completed without throwing', false, err.message);
  }

  check('no renderer console errors', errors.length === 0, errors.join(' | '));

  const failed = checks.filter((c) => !c.ok);
  console.log('\n--- UI workflow checks ---');
  for (const c of checks) {
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok || !c.detail ? '' : `  [${c.detail}]`}`);
  }
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  app.exit(failed.length ? 1 : 0);
}

module.exports = { drive };
