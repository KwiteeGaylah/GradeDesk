'use strict';
/**
 * Seeds a realistic course with real-looking data, opens the grade entry
 * screen, and writes a PNG of the window. Used to eyeball the UI without
 * needing an interactive session.
 */

const fs = require('fs');

async function capture(win, app, outPath) {
  try {
    await new Promise((r) => setTimeout(r, 1200));

    await win.webContents.executeJavaScript(`(async () => {
      const api = window.gradedesk;
      const semester = await api.semesters.active();
      const course = await api.courses.create({
        semesterId: semester.id, code: 'CSE 102', name: 'Computer Literacy',
        section: '2', instructor: 'K. D. Gaylah', policy: '70'
      });
      const terms = await api.courses.terms(course.id);
      const mid = terms.byKind.midterm, fin = terms.byKind.final;

      const att   = await api.assessments.add(mid.id, { name: 'Attendance', maxPoints: 10, kind: 'attendance' });
      const asg   = await api.assessments.add(mid.id, { name: 'Assign 1', maxPoints: 10 });
      const quiz1 = await api.assessments.add(mid.id, { name: 'Quiz 1', maxPoints: 15 });
      const quiz2 = await api.assessments.add(mid.id, { name: 'Quiz 2', maxPoints: 15 });
      const cw    = await api.assessments.add(mid.id, { name: 'ClassWork', maxPoints: 10 });
      const midExam = (await api.assessments.list(mid.id)).find(a => a.kind === 'exam');

      await api.assessments.add(fin.id, { name: 'Attendance', maxPoints: 10, kind: 'attendance' });
      const asg2  = await api.assessments.add(fin.id, { name: 'Assign 2', maxPoints: 10 });
      const quiz3 = await api.assessments.add(fin.id, { name: 'Quiz 3', maxPoints: 15 });
      const proj  = await api.assessments.add(fin.id, { name: 'Project', maxPoints: 25 });
      const finExam = (await api.assessments.list(fin.id)).find(a => a.kind === 'exam');

      const roster = [
        ['10001','Bestman, Comfort K.', 10,11,15, 8,31, 10,15,23,35],
        ['10002','Bestman, Daniel T.',  10,10,15, 4,30, 10,15,20,25],
        ['10003','Cooper, Grace A.',        10,10,15, 3,16, 10,15,23,28],
        ['TU-90001','Dolo, Patience M.', 10, 9,14, 8,28, 10,14,22,30],
        ['10004','Freeman, Mercy',      10,10,15,10,36, 10,15,25,38],
        ['34785','Freeman, Joseph G.',   9, 8,13, 7,26,  9,13,20,27],
        ['TU-03187','Gbala, Michael',  10,10,15, 9,33, 10,15,24,32],
        ['TU-90003','Howard, Ruth',  10,10,15,10,38, 10,15,25,39],
        ['38711','Johnson, Deborah',     10,10,15, 9,35, 10,15,24,36],
        ['10007','Karnga, Esther',     10, 8,12, 6,null, 9,12,18,null],
        ['TU-03213','Kollie, Abraham M.',  10,10,15,10,37, 10,15,25,37],
        ['TU-90005','Lomax, Peter M.',10,10,15,10,39, 10,15,25,40]
      ];
      const students = await api.students.addMany(course.id,
        roster.map(r => ({ studentId: r[0], fullName: r[1] })));

      // A few attendance sessions so the auto-computed column is realistic.
      const sessions = [];
      for (const d of ['2026-09-02','2026-09-04','2026-09-09','2026-09-11']) {
        sessions.push(await api.attendance.addSession(course.id, mid.id, d));
      }
      for (let i = 0; i < students.length; i++) {
        for (let j = 0; j < sessions.length; j++) {
          const code = (i + j) % 7 === 0 ? 'E' : ((i + j) % 11 === 0 ? 'A' : 'P');
          await api.attendance.setMark(students[i].id, sessions[j].id, code);
        }
      }

      const cols = [asg, quiz1, quiz2, cw, midExam, asg2, quiz3, proj, finExam];
      for (let i = 0; i < students.length; i++) {
        const vals = roster[i].slice(2);
        for (let c = 0; c < cols.length; c++) {
          await api.scores.set(students[i].id, cols[c].id, vals[c]);
        }
      }

      await loadAll();
      state.courseId = course.id;
      state.screen = 'grades';
      await loadCourseDetail();
      // Show Quiz 1, the assessment the mockup highlights.
      const all = [...state.assessments.midterm, ...state.assessments.final];
      const q1 = all.find(a => a.name === 'Quiz 1');
      state.selectedAssessmentId = q1.id;
      state.selectedTermKind = 'midterm';
      state.screen = window.__shotScreen || 'grades';
      renderRail();
      await renderScreen();
      return true;
    })()`);

    // The first-run wizard opens over an empty database, which is exactly the
    // state this driver seeds from. Close it so it does not sit on top of the
    // screen being photographed.
    await win.webContents.executeJavaScript(`(async () => {
      const skip = [...document.querySelectorAll('button')]
        .find((b) => b.textContent.trim() === 'Skip for now');
      if (skip) skip.click();
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 500));

    await new Promise((r) => setTimeout(r, 900));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(outPath, image.toPNG());
    console.log('SHOT: wrote', outPath);

    // Additional screens, written alongside the first.
    for (const screen of (process.env.GRADEDESK_SHOT_SCREENS || '').split(',').filter(Boolean)) {
      await win.webContents.executeJavaScript(
        `(async () => { state.screen = '${screen}'; renderRail(); await renderScreen(); return true; })()`
      );
      await new Promise((r) => setTimeout(r, 700));
      const extra = await win.webContents.capturePage();
      const target = outPath.replace(/\.png$/, `-${screen}.png`);
      fs.writeFileSync(target, extra.toPNG());
      console.log('SHOT: wrote', target);
    }
    app.exit(0);
  } catch (err) {
    console.error('SHOT FAILED:', err.message);
    app.exit(1);
  }
}

module.exports = { capture };
