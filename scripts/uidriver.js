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
        { studentId: '44305', fullName: 'Allison, Elizabeth Y.' },
        { studentId: '38901', fullName: 'Allison, Emmanuel M.' },
        { studentId: '36095', fullName: 'Dogbeh, Princess' }
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
      tabs: [...document.querySelectorAll('.atab')].map(t => t.textContent)
    })`);
    check('course appears in the left rail', rail.courses >= 2, JSON.stringify(rail.courses));
    check('grade entry screen is showing', rail.title === 'Grade entry', rail.title);
    check(
      'assessment tabs list both terms including the fixed exams',
      rail.tabs.some((t) => t.includes('Quiz 1')) &&
        rail.tabs.some((t) => t.includes('Midterm Exam/40')) &&
        rail.tabs.some((t) => t.includes('Final Exam/40')),
      JSON.stringify(rail.tabs)
    );

    // A null child rendered as the literal word "null" once; guard against it.
    const stray = await run(win, `(() => {
      const text = document.getElementById('content').textContent;
      return { hasNull: /\\bnull\\b/.test(text), hasUndefined: /\\bundefined\\b/.test(text) };
    })()`);
    check('no stray "null" or "undefined" rendered on screen', !stray.hasNull && !stray.hasUndefined, JSON.stringify(stray));

    // ---- type a score into the column, exactly as an instructor would ----
    const typed = await run(win, `(async () => {
      // Select Quiz 1.
      const tab = [...document.querySelectorAll('.atab')].find(t => t.textContent.includes('Quiz 1'));
      tab.click();
      await new Promise(r => setTimeout(r, 400));
      const input = document.querySelector('#content input[data-index="0"]');
      input.focus();
      input.value = '11';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 500));
      const cells = document.querySelectorAll('#content tbody tr')[0].querySelectorAll('td');
      return {
        raw: input.value,
        transmuted: cells[4].textContent,
        classStanding: cells[5].textContent,
        midtermTotal: cells[6].textContent,
        finalGrade: cells[7].textContent,
        letter: cells[8].textContent
      };
    })()`);

    // Quiz 1 = 11/15 transmutes to 70 in the 70% table.
    check('typed raw score is kept', typed.raw === '11', typed.raw);
    check('transmuted column shows the snap-down lookup value', typed.transmuted === '70', typed.transmuted);
    check('class standing recomputes live', typed.classStanding !== '—', typed.classStanding);
    check('midterm total recomputes live', typed.midtermTotal !== '—', typed.midtermTotal);

    // ---- Enter advances down the column, like Excel ----
    const advanced = await run(win, `(async () => {
      const first = document.querySelector('#content input[data-index="0"]');
      first.focus();
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
      const active = document.activeElement;
      return { index: active ? active.dataset.index : null };
    })()`);
    check('Enter advances to the next student down the column', advanced.index === '1', JSON.stringify(advanced));

    // ---- the computed values must equal the engine's own answer ----
    const cross = await run(win, `(async () => {
      const api = window.gradedesk;
      const result = await api.gradebook.compute(${setup.courseId});
      const row = result.students[0];
      const cells = document.querySelectorAll('#content tbody tr')[0].querySelectorAll('td');
      return {
        screenGrade: cells[7].textContent,
        engineGrade: row.finalGradeDisplay,
        screenLetter: cells[8].textContent.trim(),
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
      const nameInput = document.querySelector('#content input[data-row="0"][data-col="1"]');
      return { rows, firstName: nameInput ? nameInput.value : null };
    })()`);
    check('roster shows every student as an editable row', roster.rows === 3, JSON.stringify(roster));
    check('roster cells hold the typed names', roster.firstName === 'Allison, Elizabeth Y.', JSON.stringify(roster));

    // ---- config screen offers only supported maxima ----
    const config = await run(win, `(async () => {
      state.screen = 'config';
      renderRail();
      await renderScreen();
      await new Promise(r => setTimeout(r, 300));
      const options = [...document.querySelectorAll('#content .arow select option')]
        .map(o => o.value).filter((v, i, arr) => arr.indexOf(v) === i);
      const policies = [...document.querySelectorAll('#content .field select option')].map(o => o.value);
      const examBadge = !!document.querySelector('#content .badge.exam');
      return { options, policies, examBadge };
    })()`);
    check(
      'only the maxima the 70% table supports are offered (no 20)',
      !config.options.includes('20') && config.options.includes('15') && config.options.includes('25'),
      JSON.stringify(config.options)
    );
    check('all three policies are offered', ['50', '60', '70'].every((p) => config.policies.includes(p)), JSON.stringify(config.policies));
    check('the exam is shown as fixed at 40', config.examBadge);

    // ---- issue review surfaces the blank exams ----
    const issues = await run(win, `(async () => {
      const list = await window.gradedesk.gradebook.issues(${setup.courseId});
      return { count: list.length, kinds: [...new Set(list.map(i => i.kind))] };
    })()`);
    check('issue review reports blank exams', issues.kinds.includes('blank_exam'), JSON.stringify(issues));
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
