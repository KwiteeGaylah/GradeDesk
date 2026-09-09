'use strict';
/**
 * GradeDesk renderer.
 *
 * Structure follows docs/GradeDesk_Mockup.html: a left rail (semester, courses,
 * per-course screens) and one screen at a time in the main area.
 *
 * The central interaction is grade entry: one assessment, the whole class list,
 * one editable column typed straight down like Excel. Everything else exists to
 * serve that. Computed columns are read-only and refresh from the engine.
 */

const api = window.gradedesk;

const state = {
  semesters: [],
  activeSemester: null,
  courses: [],
  courseId: null,
  screen: 'grades',
  terms: null,
  assessments: { midterm: [], final: [] },
  selectedAssessmentId: null,
  selectedTermKind: 'midterm',
  computed: null,
  policies: [],
  /** Search and sort applied to the grade entry list. Not persisted. */
  gradeFilter: { query: '', sort: 'roster' },
  /** Search and sort applied to the roster grid. Not persisted. */
  rosterFilter: { query: '', sort: 'roster' },
};

const $ = (id) => document.getElementById(id);

// --------------------------------------------------------------- utilities

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/**
 * Replace a container's children, dropping absent ones.
 *
 * Native replaceChildren turns a null into the literal text "null", so an
 * optional element written as `condition ? el(...) : null` would print the word
 * on screen. Always use this instead.
 */
function setChildren(container, ...children) {
  container.replaceChildren(
    ...children.flat().filter((c) => c !== null && c !== undefined && c !== false)
  );
}

let toastTimer = null;
function toast(message, kind = '') {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const node = el('div', { class: `toast ${kind}`.trim(), text: message });
  document.body.append(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), kind === 'error' ? 6000 : 2600);
}

function saved(message = 'Saved') {
  $('saveStatus').textContent = `${message} · ${new Date().toLocaleTimeString()}`;
}

async function guard(fn, context) {
  try {
    return await fn();
  } catch (err) {
    toast(context ? `${context}: ${err.message}` : err.message, 'error');
    return undefined;
  }
}

/** A number for display, or an em dash when there is nothing to show. */
function show(value, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return Number(value).toFixed(decimals);
}

/** Truncate to two decimals without rounding, mirroring the engine exactly. */
function showGrade(row) {
  return row.finalGradeDisplay || '—';
}

/**
 * A raw score as it should appear in an entry cell.
 *
 * Typed scores are whole numbers and must show exactly as typed. Auto-computed
 * attendance is a division and can be 9.166666666666666, which is unreadable in
 * a narrow cell, so a fractional value is shown to two decimals. The stored
 * value is untouched: the engine always transmutes the full precision.
 */
function showRaw(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// ------------------------------------------------------------------- modal

/**
 * A modal dialog.
 *
 * The title and the action buttons are fixed; only the body scrolls. A long
 * list (the issue review can run to dozens of rows) must never carry its own
 * heading off the top of the screen or push its buttons out of reach.
 *
 * `cancelLabel: null` drops the cancel button, for dialogs that only dismiss.
 */
function modal({
  title,
  subtitle,
  body,
  confirmLabel = 'Save',
  cancelLabel = 'Cancel',
  onConfirm,
  danger = false,
  wide = false,
}) {
  return new Promise((resolve) => {
    const root = $('modalRoot');
    const close = (value) => {
      setChildren(root);
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
    };
    document.addEventListener('keydown', onKey);

    const form = el('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const value = onConfirm ? await onConfirm() : true;
        if (value !== false) close(value ?? true);
      },
    },
      el('div', { class: 'modalhead' },
        el('h3', { text: title }),
        subtitle ? el('div', { class: 'sub', text: subtitle }) : null),
      el('div', { class: 'modalbody' }, body),
      el('div', { class: 'actions' },
        cancelLabel ? el('button', { type: 'button', class: 'btn', onclick: () => close(null) }, cancelLabel) : null,
        el('button', { type: 'submit', class: `btn primary${danger ? ' danger' : ''}` }, confirmLabel)
      )
    );

    const bg = el('div', {
      class: 'modalbg',
      onclick: (e) => { if (e.target === bg) close(null); },
    }, el('div', { class: `modal${wide ? ' wide' : ''}` }, form));

    setChildren(root, bg);
    const first = form.querySelector('input, select, textarea, button');
    if (first) first.focus();
  });
}

function confirmDialog({ title, subtitle, body, confirmLabel = 'Continue', danger = true }) {
  return modal({ title, subtitle, body: body || el('div'), confirmLabel, danger, onConfirm: () => true });
}

// ------------------------------------------------------------------ loading

async function loadAll() {
  state.policies = (await guard(() => api.policies.list(), 'Loading policies')) || [];
  state.semesters = (await guard(() => api.semesters.list(), 'Loading semesters')) || [];
  state.activeSemester = state.semesters.find((s) => s.is_active) || state.semesters[0] || null;
  await loadCourses();
  renderRail();
  await renderScreen();
}

async function loadCourses() {
  if (!state.activeSemester) {
    state.courses = [];
    state.courseId = null;
    return;
  }
  state.courses = (await guard(() => api.courses.list(state.activeSemester.id))) || [];
  if (!state.courses.some((c) => c.id === state.courseId)) {
    state.courseId = state.courses.length ? state.courses[0].id : null;
  }
  await loadCourseDetail();
}

async function loadCourseDetail() {
  if (!state.courseId) {
    state.terms = null;
    state.assessments = { midterm: [], final: [] };
    state.computed = null;
    return;
  }
  const terms = await guard(() => api.courses.terms(state.courseId));
  state.terms = terms ? terms.byKind : null;
  if (state.terms) {
    state.assessments = {
      midterm: (await api.assessments.list(state.terms.midterm.id)) || [],
      final: (await api.assessments.list(state.terms.final.id)) || [],
    };
  }
  await refreshComputed();
  ensureSelectedAssessment();
}

async function refreshComputed() {
  if (!state.courseId) {
    state.computed = null;
    return;
  }
  state.computed = await guard(() => api.gradebook.compute(state.courseId), 'Computing grades');
}

function ensureSelectedAssessment() {
  const all = [...state.assessments.midterm, ...state.assessments.final];
  if (!all.some((a) => a.id === state.selectedAssessmentId)) {
    const first = state.assessments.midterm[0] || state.assessments.final[0] || null;
    state.selectedAssessmentId = first ? first.id : null;
    state.selectedTermKind = state.assessments.midterm.some((a) => a.id === state.selectedAssessmentId)
      ? 'midterm'
      : 'final';
  }
}

function currentCourse() {
  return state.courses.find((c) => c.id === state.courseId) || null;
}

// --------------------------------------------------------------- left rail

function renderRail() {
  const select = $('semesterSelect');
  setChildren(select,
    ...state.semesters.map((s) =>
      el('option', { value: s.id, selected: state.activeSemester && s.id === state.activeSemester.id },
        `${s.name}${s.is_active ? '  (active)' : '  (archived)'}`)
    )
  );

  const courseNav = $('courseNav');
  setChildren(courseNav,
    ...state.courses.map((c) =>
      el('a', {
        class: c.id === state.courseId ? 'active' : '',
        onclick: async () => {
          state.courseId = c.id;
          await loadCourseDetail();
          renderRail();
          await renderScreen();
        },
      },
        el('span', { class: 'ico', text: '▤' }),
        el('span', {}, `${c.code}${c.section ? ` · ${c.section}` : ''}`),
        el('span', { class: 'sub', text: `${c.policy}%` })
      )
    ),
    el('a', { onclick: newCourse }, el('span', { class: 'ico', text: '＋' }), 'New course…')
  );

  const screens = [
    ['grades', '✎', 'Grade entry'],
    ['attendance', '◷', 'Attendance'],
    ['roster', '☰', 'Roster'],
    ['config', '⚙', 'Assessments & policy'],
  ];
  setChildren($('screenNav'),
    ...screens.map(([key, icon, label]) =>
      el('a', {
        class: state.screen === key ? 'active' : '',
        onclick: async () => {
          state.screen = key;
          renderRail();
          await renderScreen();
        },
      }, el('span', { class: 'ico', text: icon }), label)
    )
  );
}

$('semesterSelect').addEventListener('change', async (e) => {
  // switchSemester confirms and re-renders; the rail is redrawn either way so
  // the picker never shows a semester that was not actually activated.
  await switchSemester(Number(e.target.value));
  renderRail();
});

/**
 * Create and activate a new semester. Kept as a named function because it is
 * reached from the Manage dialog, the empty state and the setup wizard.
 */
async function newSemester() {
  const input = el('input', { type: 'text', required: true, placeholder: 'e.g. 2027–2028 Semester 1' });
  const result = await modal({
    title: 'New semester',
    subtitle: 'The current semester is archived, not deleted. You can switch back to it at any time.',
    body: el('div', { class: 'field' }, el('label', { text: 'Semester name' }), input),
    confirmLabel: 'Create and activate',
    onConfirm: () => input.value.trim() || false,
  });
  if (!result) return false;
  await guard(() => api.semesters.create(result), 'Creating semester');
  state.semesters = await api.semesters.list();
  state.activeSemester = state.semesters.find((s) => s.is_active) || null;
  await loadCourses();
  renderRail();
  await renderScreen();
  toast('Semester created');
  return true;
}

async function backupNow() {
  const file = await guard(() => api.backup.save(), 'Backup');
  if (file) toast('Backup saved');
}

async function restoreNow() {
  const result = await guard(() => api.backup.restore(), 'Restore');
  if (!result) return;
  toast(`Restored ${result.restored} records`);
  // Just reload. A restore is not a first run, so the setup wizard stays away
  // even if the restored file happens to contain no courses.
  await loadAll();
}

/**
 * The Manage dialog: semester lifecycle and data safety.
 *
 * These actions were previously three small links directly under the semester
 * picker, where "Restore" (which replaces everything) sat one slip away from
 * daily navigation. They now live behind a deliberate click.
 */
async function openManage() {
  const list = el('div', { class: 'managelist' },
    ...state.semesters.map((sem) =>
      el('div', { class: `manrow${sem.is_active ? ' current' : ''}` },
        el('div', { class: 'manname' },
          el('div', {}, sem.name),
          el('div', { class: 'mansub', text: sem.is_active ? 'Active' : 'Archived, still readable and exportable' })),
        sem.is_active
          ? el('span', { class: 'badge', text: 'current' })
          : el('button', {
              class: 'btn small',
              onclick: async () => {
                setChildren($('modalRoot'));
                await switchSemester(sem.id);
              },
            }, 'Make active'))
    )
  );

  await modal({
    title: 'Manage',
    subtitle: 'Semesters, and keeping your data safe.',
    wide: true,
    confirmLabel: 'Done',
    cancelLabel: null,
    onConfirm: () => true,
    body: el('div', {},
      el('h4', { class: 'mansec', text: 'Semesters' }),
      list,
      el('div', { class: 'manactions' },
        el('button', {
          class: 'btn',
          onclick: async () => { setChildren($('modalRoot')); await newSemester(); },
        }, '＋ New semester')),

      el('h4', { class: 'mansec', text: 'Your data' }),
      el('div', { class: 'note' },
        'Everything is saved on this computer as you type. A backup is a single ',
        'file you can copy to a flash drive and carry to another machine.'),
      el('div', { class: 'manactions' },
        el('button', { class: 'btn', onclick: backupNow }, 'Back up to a file'),
        el('button', {
          class: 'btn danger',
          onclick: async () => { setChildren($('modalRoot')); await restoreNow(); },
        }, 'Restore from a backup…')),
      el('div', { class: 'hint' },
        'Restoring replaces everything currently in GradeDesk. You will be asked to confirm.')),
  });
}

/** Switch the active semester, warning that the current one gets archived. */
async function switchSemester(id) {
  const target = state.semesters.find((s) => s.id === id);
  if (!target || target.is_active) return;
  const ok = await confirmDialog({
    title: `Switch to ${target.name}?`,
    subtitle: 'This makes it the active semester and archives the current one.',
    body: el('div', { class: 'note' },
      'Archived semesters stay fully readable and exportable. You can switch back at any time.'),
    confirmLabel: 'Switch semester',
    danger: false,
  });
  if (!ok) {
    renderRail();
    return;
  }
  await guard(() => api.semesters.activate(id), 'Switching semester');
  state.semesters = await api.semesters.list();
  state.activeSemester = state.semesters.find((s) => s.id === id) || null;
  await loadCourses();
  renderRail();
  await renderScreen();
}

$('settingsBtn').addEventListener('click', openManage);
$('helpBtn').addEventListener('click', () => openGuide());

// ----------------------------------------------------------------- courses

async function newCourse() {
  if (!state.activeSemester) {
    toast('Create a semester first', 'error');
    return;
  }
  const code = el('input', { type: 'text', required: true, placeholder: 'CSE 102' });
  const name = el('input', { type: 'text', placeholder: 'Computer Literacy' });
  const section = el('input', { type: 'text', placeholder: '2' });
  const instructor = el('input', { type: 'text', placeholder: 'Your name' });
  const selectable = state.policies.filter((p) => p.selectable);
  const policy = el('select', {},
    ...selectable.map((p) =>
      el('option', { value: p.policy, selected: p.isDefault }, `${p.label} transmutation`)
    )
  );
  const policyNote = el('div', { class: 'hint' });
  const updateNote = () => {
    const chosen = selectable.find((p) => p.policy === policy.value);
    policyNote.textContent = chosen ? chosen.note : '';
  };
  policy.addEventListener('change', updateNote);
  updateNote();

  const result = await modal({
    title: 'New course',
    subtitle: `Added to ${state.activeSemester.name}.`,
    body: el('div', {},
      el('div', { class: 'fieldrow' },
        el('div', { class: 'field' }, el('label', { text: 'Course code' }), code),
        el('div', { class: 'field' }, el('label', { text: 'Section' }), section)),
      el('div', { class: 'field' }, el('label', { text: 'Course name' }), name),
      el('div', { class: 'field' }, el('label', { text: 'Instructor' }), instructor),
      el('div', { class: 'field' }, el('label', { text: 'Transmutation policy' }), policy, policyNote)
    ),
    confirmLabel: 'Create course',
    onConfirm: () => {
      if (!code.value.trim()) return false;
      return {
        code: code.value.trim(),
        name: name.value.trim(),
        section: section.value.trim(),
        instructor: instructor.value.trim(),
        policy: policy.value,
      };
    },
  });
  if (!result) return;

  const course = await guard(
    () => api.courses.create({ semesterId: state.activeSemester.id, ...result }),
    'Creating course'
  );
  if (!course) return;
  await loadCourses();
  state.courseId = course.id;
  state.screen = 'config';
  await loadCourseDetail();
  renderRail();
  await renderScreen();
  toast('Course created. Add your assessments next.');
}

// ------------------------------------------------------------- screen shell

async function renderScreen() {
  const course = currentCourse();
  const content = $('content');
  const actions = $('topActions');
  setChildren(actions);

  if (!state.activeSemester) {
    $('crumbs').textContent = '';
    $('screenTitle').textContent = 'Welcome';
    setChildren(content, emptyState({
      icon: '◷',
      title: 'No semester yet',
      text: 'Create a semester to begin. Everything you enter is saved on this computer.',
      actionLabel: 'New semester',
      onAction: newSemester,
    }));
    return;
  }

  if (!course) {
    $('crumbs').textContent = state.activeSemester.name;
    $('screenTitle').textContent = 'No course selected';
    setChildren(content, emptyState({
      icon: '▤',
      title: 'No courses in this semester',
      text: 'Create your first course, then add its assessments and type in the class list.',
      actionLabel: 'New course',
      onAction: newCourse,
    }));
    return;
  }

  const policyInfo = state.policies.find((p) => p.policy === String(course.policy));
  setChildren($('crumbs'),
    document.createTextNode(`${state.activeSemester.name} · ${course.code}`),
    course.section ? document.createTextNode(` · Section ${course.section}`) : document.createTextNode(''),
    document.createTextNode(' · '),
    el('b', { text: `${course.policy}% policy` }),
    !state.activeSemester.is_active ? document.createTextNode('  (archived)') : document.createTextNode('')
  );

  const titles = {
    grades: 'Grade entry',
    attendance: 'Attendance',
    roster: 'Roster',
    config: 'Assessments & policy',
  };
  $('screenTitle').textContent = titles[state.screen];

  // Export and issue review belong to the screens that show grades. On the
  // roster and the configuration screen they are noise, and on a narrow window
  // they crowd out that screen's own actions.
  if (state.screen === 'grades' || state.screen === 'attendance') {
    const issues = (state.computed && (await api.gradebook.issues(state.courseId))) || [];
    const errorCount = issues.filter((i) => i.severity !== 'info').length;
    const reviewBtn = el('button', {
      class: 'btn',
      title: 'Review issues before exporting',
      // Fetch fresh on click rather than reusing the list captured at render
      // time: scores change constantly between renders, and a stale review that
      // omits a real problem is worse than no review at all.
      onclick: async () => {
        const current = await guard(() => api.gradebook.issues(state.courseId), 'Reviewing');
        showIssues(current || []);
        updateIssueCount(reviewBtn, current || []);
      },
    },
      'Review',
      el('span', { class: 'long', text: ' issues' }),
      errorCount ? ` (${errorCount})` : ''
    );

    actions.append(
      reviewBtn,
      el('button', { class: 'btn', title: 'Export the summary sheet', onclick: exportSummaryFile },
        'Summary', el('span', { class: 'long', text: ' sheet' })),
      el('button', { class: 'btn primary', title: 'Export the full grade record', onclick: exportRecordFile },
        'Export', el('span', { class: 'long', text: ' grade sheet' }))
    );
  }

  const renderers = {
    grades: renderGradeEntry,
    attendance: renderAttendance,
    roster: renderRoster,
    config: renderConfig,
  };
  await renderers[state.screen](content, course, policyInfo);
}

function emptyState({ icon, title, text, actionLabel, onAction }) {
  return el('div', { class: 'empty' },
    el('div', { class: 'big', text: icon }),
    el('h3', { text: title }),
    el('p', { text }),
    actionLabel ? el('button', { class: 'btn primary', onclick: onAction }, actionLabel) : null
  );
}

// ------------------------------------------------------------ grade entry

async function renderGradeEntry(content, course, policyInfo) {
  const all = [
    ...state.assessments.midterm.map((a) => ({ ...a, termKind: 'midterm' })),
    ...state.assessments.final.map((a) => ({ ...a, termKind: 'final' })),
  ];

  if (!all.length) {
    setChildren(content, emptyState({
      icon: '⚙',
      title: 'No assessments yet',
      text: 'Add the quizzes, assignments and attendance this course uses. Each term also has a fixed 40-point exam.',
      actionLabel: 'Set up assessments',
      onAction: async () => { state.screen = 'config'; renderRail(); await renderScreen(); },
    }));
    return;
  }

  const students = (state.computed && state.computed.students) || [];
  if (!students.length) {
    setChildren(content, emptyState({
      icon: '☰',
      title: 'No students yet',
      text: 'Type the class list into the roster, then come back here to enter scores down the column.',
      actionLabel: 'Go to roster',
      onAction: async () => { state.screen = 'roster'; renderRail(); await renderScreen(); },
    }));
    return;
  }

  const selected = all.find((a) => a.id === state.selectedAssessmentId) || all[0];
  state.selectedAssessmentId = selected.id;
  state.selectedTermKind = selected.termKind;

  // ---- assessment picker ----
  // A dropdown grouped by term, not a long strip of tabs: a course can carry a
  // dozen assessments and the strip pushed the grid down or scrolled sideways.
  // Prev/next buttons keep single-key movement between assessments.
  const picker = el('select', {
    class: 'apicker',
    'aria-label': 'Assessment being entered',
    onchange: async (e) => {
      const pick = all.find((a) => String(a.id) === e.target.value);
      if (!pick) return;
      state.selectedAssessmentId = pick.id;
      state.selectedTermKind = pick.termKind;
      await renderScreen();
      focusFirstEntry();
    },
  });
  for (const kind of ['midterm', 'final']) {
    const list = all.filter((a) => a.termKind === kind);
    if (!list.length) continue;
    const group = el('optgroup', { label: kind === 'midterm' ? 'Midterm term' : 'Final term' });
    for (const a of list) {
      group.append(el('option', {
        value: String(a.id),
        selected: a.id === selected.id,
      }, `${a.name}  (out of ${a.max_points})${a.kind === 'exam' ? ' · exam' : ''}`));
    }
    picker.append(group);
  }

  const step = async (delta) => {
    const i = all.findIndex((a) => a.id === selected.id);
    const next = all[i + delta];
    if (!next) return;
    state.selectedAssessmentId = next.id;
    state.selectedTermKind = next.termKind;
    await renderScreen();
    focusFirstEntry();
  };
  const index = all.findIndex((a) => a.id === selected.id);

  const search = el('input', {
    type: 'search',
    class: 'searchbox',
    placeholder: 'Search name or ID',
    value: state.gradeFilter.query,
    'aria-label': 'Filter the class list',
    oninput: (e) => {
      state.gradeFilter.query = e.target.value;
      // Re-render only the rows, so the caret stays in the search box.
      renderGradeRows();
    },
  });

  const sort = el('select', {
    class: 'sortbox',
    'aria-label': 'Sort the class list',
    onchange: (e) => {
      state.gradeFilter.sort = e.target.value;
      renderGradeRows();
    },
  },
    ...[
      ['roster', 'Roster order'],
      ['name', 'Name (A–Z)'],
      ['id', 'Student ID'],
      ['raw-desc', 'This score, high to low'],
      ['raw-asc', 'This score, low to high'],
      ['grade-desc', 'Final grade, high to low'],
      ['grade-asc', 'Final grade, low to high'],
      ['letter', 'Letter grade'],
      ['blank', 'Blanks first'],
    ].map(([v, label]) => el('option', { value: v, selected: state.gradeFilter.sort === v }, label))
  );

  const countLabel = el('span', { class: 'rowcount' });

  const bar = el('div', { class: 'entrybar' },
    el('div', { class: 'pickgroup' },
      el('span', { class: 'term-pill', text: selected.termKind === 'midterm' ? 'MIDTERM' : 'FINAL' }),
      picker,
      el('button', {
        class: 'btn small step', title: 'Previous assessment',
        disabled: index <= 0, onclick: () => step(-1),
      }, '‹'),
      el('button', {
        class: 'btn small step', title: 'Next assessment',
        disabled: index >= all.length - 1, onclick: () => step(1),
      }, '›')),
    el('div', { class: 'spacer' }),
    el('div', { class: 'filtergroup' }, search, sort, countLabel)
  );

  const isAttendance = selected.kind === 'attendance';
  const note = isAttendance
    ? el('div', { class: 'note' },
        el('b', {}, selected.name), ' is scored automatically from session marks. ',
        'Open the Attendance screen to mark sessions; the raw score here is read-only.')
    : el('div', { class: 'note' },
        'Entering ', el('b', {}, selected.name), ` (out of ${selected.max_points}). `,
        'Type a score on each row and press Enter to drop down, exactly like an Excel column. ',
        'Leave a cell blank to count it as 50. The grey columns are computed automatically.');

  const policyWarn = policyInfo && policyInfo.confidence !== 'grade-verified'
    ? el('div', { class: 'note warn' },
        el('b', {}, `${policyInfo.label} policy: `),
        'transcribed from the university source and structurally checked, but not cross-checked ',
        'against a completed grade sheet. Spot-check a few results before submitting.')
    : null;

  // ---- table ----
  const termLabel = selected.termKind === 'midterm' ? 'Midterm' : 'Final';
  const thead = el('thead', {},
    el('tr', {},
      el('th', { text: '#', class: 'ta-right' }),
      el('th', { text: 'ID' }),
      el('th', { text: 'Full name' }),
      el('th', { class: 'th-entry', text: `${selected.name} (raw)` }),
      el('th', { class: 'ta-center', text: 'Transmuted' }),
      el('th', { class: 'ta-center col-secondary', text: 'Class standing' }),
      el('th', { class: 'ta-center col-secondary', text: `${termLabel} total` }),
      el('th', { class: 'ta-center final', text: 'Final grade' }),
      el('th', { class: 'ta-center letter', text: 'Letter' })
    )
  );

  const tbody = el('tbody');

  /**
   * Build the visible rows from the current search and sort.
   *
   * Kept as a closure so typing in the search box re-renders only the rows and
   * never disturbs the caret, and so the entry column's keyboard order always
   * matches what is actually on screen.
   */
  function renderGradeRows() {
    const q = state.gradeFilter.query.trim().toLowerCase();
    const cellOf = (row) => {
      const term = row[selected.termKind];
      if (selected.kind === 'exam') return { raw: term.examRaw, transmuted: term.examTransmuted };
      return term.assessments.find((a) => a.assessment.id === selected.id) || { raw: null, transmuted: 50 };
    };

    let visible = students.filter((row) => {
      if (!q) return true;
      const name = String(row.student.full_name || '').toLowerCase();
      const id = String(row.student.student_id || '').toLowerCase();
      return name.includes(q) || id.includes(q);
    });

    const rawOf = (r) => { const v = cellOf(r).raw; return v === null || v === undefined ? null : Number(v); };
    const byNumber = (a, b) => (a.student.number ?? 0) - (b.student.number ?? 0);
    const nullsLast = (a, b, dir) => {
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return dir * (a - b);
    };
    const LETTERS = ['A', 'B', 'C', 'D', 'F', 'I', 'NG'];

    const sorters = {
      roster: byNumber,
      name: (a, b) => String(a.student.full_name || '').localeCompare(String(b.student.full_name || '')),
      id: (a, b) => String(a.student.student_id || '').localeCompare(
        String(b.student.student_id || ''), undefined, { numeric: true }),
      'raw-desc': (a, b) => nullsLast(rawOf(a), rawOf(b), -1),
      'raw-asc': (a, b) => nullsLast(rawOf(a), rawOf(b), 1),
      'grade-desc': (a, b) => nullsLast(a.finalGrade, b.finalGrade, -1),
      'grade-asc': (a, b) => nullsLast(a.finalGrade, b.finalGrade, 1),
      letter: (a, b) => LETTERS.indexOf(a.letter) - LETTERS.indexOf(b.letter) || byNumber(a, b),
      blank: (a, b) => (rawOf(a) === null ? 0 : 1) - (rawOf(b) === null ? 0 : 1) || byNumber(a, b),
    };
    visible = [...visible].sort(sorters[state.gradeFilter.sort] || byNumber);

    const isAtt = selected.kind === 'attendance';
    const rows = visible.map((row, index) => {
      const term = row[selected.termKind];
      const cell = cellOf(row);

      const input = el('input', {
        type: 'text',
        inputmode: 'decimal',
        value: showRaw(cell.raw),
        // `committed` is the baseline an edit is compared against. Seeding it
        // with the displayed value means simply tabbing through a cell is not
        // mistaken for a change.
        dataset: {
          index: String(index),
          studentId: String(row.student.id),
          committed: showRaw(cell.raw),
        },
        readonly: isAtt,
        title: isAtt ? 'Computed from attendance sessions' : '',
        'aria-label': `${selected.name} for ${row.student.full_name}`,
      });
      if (cell.raw !== null && Number(cell.raw) > selected.max_points) input.classList.add('over');

      if (!isAtt) {
        input.addEventListener('keydown', (e) => onEntryKey(e, index, visible.length));
        input.addEventListener('focus', () => input.select());
        input.addEventListener('change', () => commitScore(input, row.student.id, selected));
        input.addEventListener('blur', () => commitScore(input, row.student.id, selected));
      }

      return el('tr', {},
        el('td', { class: 'idx', text: row.student.number ?? index + 1 }),
        el('td', { class: 'sid cellpad', text: row.student.student_id || '' }),
        el('td', { class: 'name cellpad', title: row.student.full_name || '', text: row.student.full_name || '' }),
        el('td', { class: 'entry' }, input),
        el('td', { class: 'read', text: show(cell.transmuted, 0) }),
        el('td', { class: 'read col-secondary', text: show(term.classStanding) }),
        el('td', { class: 'total col-secondary', text: show(term.total) }),
        el('td', { class: 'final', text: showGrade(row) }),
        el('td', { class: 'letter' }, el('span', { class: `lg ${row.letter}`, text: row.letter }))
      );
    });

    if (!rows.length) {
      setChildren(tbody, el('tr', {}, el('td', {
        class: 'cellpad emptyrow', colspan: '9',
        text: `No student matches “${state.gradeFilter.query}”.`,
      })));
    } else {
      setChildren(tbody, ...rows);
    }

    countLabel.textContent =
      visible.length === students.length
        ? `${students.length} student${students.length === 1 ? '' : 's'}`
        : `${visible.length} of ${students.length}`;
  }

  renderGradeRows();
  state.rerenderGradeRows = renderGradeRows;

  setChildren(content,
    bar,
    policyWarn,
    note,
    el('div', { class: 'gridcard' }, el('table', {}, thead, tbody)),
    el('div', { class: 'legend' },
      el('span', {}, el('span', { class: 'k k-entry' }), 'Editable raw score'),
      el('span', {}, el('span', { class: 'k k-read' }), `Transmuted (${course.policy}% table)`),
      el('span', {}, el('span', { class: 'k k-total' }), 'Running totals'),
      el('span', {}, 'Blank exam → letter ', el('b', {}, 'I'), ' · Final grade shown to 2 decimals, no rounding'),
      // Shown only when the running-total columns have been dropped, so the
      // instructor knows they are hidden rather than missing.
      el('span', { class: 'narrow-only' }, 'Widen the window to see class standing and term totals')
    )
  );
}

/** Enter/Tab move down the column, arrows navigate, like a spreadsheet. */
function onEntryKey(event, index, total) {
  const move = (delta) => {
    const next = document.querySelector(`#content input[data-index="${index + delta}"]`);
    if (next) {
      next.focus();
      next.select();
    }
    event.preventDefault();
  };
  if (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey)) {
    if (index < total - 1) move(1);
    else if (event.key === 'Enter') event.preventDefault();
    return;
  }
  if (event.key === 'Tab' && event.shiftKey) {
    if (index > 0) move(-1);
    return;
  }
  if (event.key === 'ArrowDown') move(1);
  if (event.key === 'ArrowUp') move(-1);
  if (event.key === 'Escape') event.target.blur();
}

function focusFirstEntry() {
  const first = document.querySelector('#content input[data-index="0"]:not([readonly])');
  if (first) {
    first.focus();
    first.select();
  }
}

/**
 * Persist one typed score, then refresh the computed columns in place.
 * The whole class is recomputed because one score moves that student's class
 * standing, term total, final grade and letter together.
 */
async function commitScore(input, studentId, assessment) {
  const text = input.value.trim();
  const previous = input.dataset.committed ?? '';
  if (text === previous) return;

  let value = null;
  if (text !== '') {
    const n = Number(text);
    if (!Number.isFinite(n)) {
      toast(`"${text}" is not a number`, 'error');
      input.value = previous;
      return;
    }
    if (n < 0) {
      toast('A score cannot be negative', 'error');
      input.value = previous;
      return;
    }
    value = n;
  }

  input.dataset.committed = text;
  input.classList.toggle('over', value !== null && value > assessment.max_points);
  if (value !== null && value > assessment.max_points) {
    toast(`${value} is above the maximum of ${assessment.max_points} for ${assessment.name}`, 'error');
  }

  await guard(() => api.scores.set(studentId, assessment.id, value), 'Saving score');
  saved();
  await refreshComputed();
  updateComputedColumns(assessment);
  refreshIssueBadge();
}

/** Refresh only the read-only cells, so the focused input is never disturbed. */
function updateComputedColumns(assessment) {
  if (!state.computed) return;
  const rows = document.querySelectorAll('#content tbody tr');
  state.computed.students.forEach((row, i) => {
    const tr = rows[i];
    if (!tr) return;
    const term = row[state.selectedTermKind];
    const isExam = assessment.kind === 'exam';
    const cell = isExam
      ? { transmuted: term.examTransmuted }
      : term.assessments.find((a) => a.assessment.id === assessment.id) || { transmuted: 50 };

    const cells = tr.querySelectorAll('td');
    cells[4].textContent = show(cell.transmuted, 0);
    cells[5].textContent = show(term.classStanding);
    cells[6].textContent = show(term.total);
    cells[7].textContent = showGrade(row);
    setChildren(cells[8], el('span', { class: `lg ${row.letter}`, text: row.letter }));
  });
}

// -------------------------------------------------------------- attendance

async function renderAttendance(content, course) {
  const termKind = state.selectedTermKind === 'final' ? 'final' : 'midterm';
  const term = state.terms ? state.terms[termKind] : null;
  if (!term) {
    setChildren(content, emptyState({ icon: '◷', title: 'No terms', text: 'This course has no terms.' }));
    return;
  }

  const attendanceAssessment = state.assessments[termKind].find((a) => a.kind === 'attendance');
  const { sessions, marks } = await api.attendance.forTerm(term.id);
  const marksByStudent = new Map(marks);
  const students = (state.computed && state.computed.students) || [];

  const termSwitch = el('div', { class: 'assessbar' },
    el('span', { class: 'term-pill', text: 'TERM' }),
    ...['midterm', 'final'].map((kind) =>
      el('button', {
        class: `atab${kind === termKind ? ' active' : ''}`,
        onclick: async () => {
          state.selectedTermKind = kind;
          await renderScreen();
        },
      }, kind === 'midterm' ? 'Midterm term' : 'Final term')
    )
  );

  $('topActions').prepend(
    el('button', { class: 'btn', onclick: () => addSession(course, term) }, '＋ Add session')
  );

  if (!attendanceAssessment) {
    setChildren(content, termSwitch, emptyState({
      icon: '◷',
      title: 'No attendance assessment in this term',
      text: 'Add an assessment of kind "attendance" so session marks have somewhere to land.',
      actionLabel: 'Set up assessments',
      onAction: async () => { state.screen = 'config'; renderRail(); await renderScreen(); },
    }));
    return;
  }

  if (!students.length) {
    setChildren(content, termSwitch, emptyState({
      icon: '☰',
      title: 'No students yet',
      text: 'Type the class list into the roster first.',
      actionLabel: 'Go to roster',
      onAction: async () => { state.screen = 'roster'; renderRail(); await renderScreen(); },
    }));
    return;
  }

  if (!sessions.length) {
    setChildren(content, termSwitch, emptyState({
      icon: '◷',
      title: 'No sessions yet',
      text: 'Add a session for each class meeting, then mark the whole class across it.',
      actionLabel: '＋ Add session',
      onAction: () => addSession(course, term),
    }));
    return;
  }

  const note = el('div', { class: 'note' },
    'Click a cell to cycle ', el('b', {}, 'P'), ' (present, full) → ', el('b', {}, 'E'),
    ' (excused, half) → ', el('b', {}, 'A'), ' (absent, zero) → blank. ',
    `The score is points × (P + 0.5·E) ÷ sessions marked, out of ${attendanceAssessment.max_points}, `,
    'then transmuted like any other assessment.'
  );

  const thead = el('thead', {}, el('tr', {},
    el('th', { text: '#', class: 'ta-right' }),
    el('th', { text: 'Full name' }),
    ...sessions.map((s) =>
      el('th', { class: 'session' },
        s.date,
        el('span', {
          class: 'del',
          title: 'Remove this session',
          onclick: () => removeSession(s),
        }, '✕')
      )
    ),
    el('th', { class: 'th-computed att-raw', text: `Raw /${attendanceAssessment.max_points}` }),
    el('th', { class: 'ta-center att-trans', text: 'Transmuted' })
  ));

  const tbody = el('tbody');
  students.forEach((row, i) => {
    const studentMarks = marksByStudent.get(row.student.id) || sessions.map(() => null);
    const computedCell = row[termKind].assessments.find(
      (a) => a.assessment.id === attendanceAssessment.id
    ) || { raw: null, transmuted: 50 };

    const rawCell = el('td', { class: 'total att-raw', text: show(computedCell.raw) });
    const transCell = el('td', { class: 'read att-trans', text: show(computedCell.transmuted, 0) });

    const cells = sessions.map((session, si) => {
      const code = studentMarks[si];
      const td = el('td', {
        class: `att ${code || 'blank'}`,
        text: code || '·',
        tabindex: '0',
        role: 'button',
        'aria-label': `${row.student.full_name}, ${session.date}`,
        onclick: () => cycleMark(td, row.student.id, session.id, rawCell, transCell, attendanceAssessment, termKind),
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            td.click();
          }
        },
      });
      return td;
    });

    tbody.append(el('tr', {},
      el('td', { class: 'idx', text: row.student.number ?? i + 1 }),
      el('td', { class: 'name cellpad', text: row.student.full_name }),
      ...cells,
      rawCell,
      transCell
    ));
  });

  setChildren(content,
    termSwitch,
    note,
    el('div', { class: 'gridcard' }, el('table', {}, thead, tbody)),
    el('div', { class: 'hint' },
      'The denominator counts sessions actually marked, not the whole semester, so attendance is fair at any point in the term.')
  );
}

const MARK_CYCLE = ['P', 'E', 'A', null];

async function cycleMark(td, studentId, sessionId, rawCell, transCell, assessment, termKind) {
  const current = td.textContent.trim() === '·' ? null : td.textContent.trim();
  const next = MARK_CYCLE[(MARK_CYCLE.indexOf(current) + 1) % MARK_CYCLE.length];

  td.className = `att ${next || 'blank'}`;
  td.textContent = next || '·';

  await guard(() => api.attendance.setMark(studentId, sessionId, next), 'Saving mark');
  saved();
  await refreshComputed();

  const row = state.computed.students.find((r) => r.student.id === studentId);
  if (row) {
    const cell = row[termKind].assessments.find((a) => a.assessment.id === assessment.id);
    if (cell) {
      rawCell.textContent = show(cell.raw);
      transCell.textContent = show(cell.transmuted, 0);
    }
  }
}

async function addSession(course, term) {
  const date = el('input', { type: 'date', required: true, value: new Date().toISOString().slice(0, 10) });
  const result = await modal({
    title: 'Add attendance session',
    subtitle: 'One session per class meeting.',
    body: el('div', { class: 'field' }, el('label', { text: 'Date' }), date),
    confirmLabel: 'Add session',
    onConfirm: () => date.value || false,
  });
  if (!result) return;
  await guard(() => api.attendance.addSession(course.id, term.id, result), 'Adding session');
  await refreshComputed();
  await renderScreen();
  saved();
}

async function removeSession(session) {
  const count = await api.attendance.countMarks(session.id);
  const ok = await confirmDialog({
    title: `Remove the session on ${session.date}?`,
    subtitle: count
      ? `${count} mark${count === 1 ? '' : 's'} will be deleted, which changes attendance scores.`
      : 'This session has no marks yet.',
    body: el('div', { class: 'note warn' },
      'Attendance is divided by the number of sessions marked, so removing a session changes every student’s attendance score.'),
    confirmLabel: 'Remove session',
  });
  if (!ok) return;
  await guard(() => api.attendance.removeSession(session.id), 'Removing session');
  await refreshComputed();
  await renderScreen();
  saved('Session removed');
}

// ------------------------------------------------------------------ roster

async function renderRoster(content, course) {
  const students = await api.students.list(course.id);

  $('topActions').prepend(
    el('button', { class: 'btn', onclick: () => pasteRoster(course) }, 'Paste list'),
    el('button', { class: 'btn primary', onclick: () => addRosterRows(course, 5) }, '＋ Add rows')
  );

  if (!students.length) {
    setChildren(content, emptyState({
      icon: '☰',
      title: 'The class list is empty',
      text: 'Add rows and type each student’s ID and full name, or paste a list you already have.',
      actionLabel: '＋ Add rows',
      onAction: () => addRosterRows(course, 10),
    }));
    return;
  }

  // ---- summary ----
  const blanks = students.filter(
    (s) => !String(s.full_name || '').trim() && !String(s.student_id || '').trim()
  ).length;
  const missingId = students.filter(
    (s) => String(s.full_name || '').trim() && !String(s.student_id || '').trim()
  ).length;
  const complete = students.length - blanks - missingId;

  const summary = el('div', { class: 'kpis' },
    el('div', { class: 'kpi' },
      el('div', { class: 'v', text: String(students.length) }),
      el('div', { class: 'l', text: students.length === 1 ? 'Student' : 'Students' })),
    el('div', { class: 'kpi' },
      el('div', { class: 'v', text: String(complete) }),
      el('div', { class: 'l', text: 'With ID and name' })),
    missingId
      ? el('div', { class: 'kpi warn' },
          el('div', { class: 'v', text: String(missingId) }),
          el('div', { class: 'l', text: 'Missing an ID' }))
      : null,
    blanks
      ? el('div', { class: 'kpi warn' },
          el('div', { class: 'v', text: String(blanks) }),
          el('div', { class: 'l', text: blanks === 1 ? 'Empty row' : 'Empty rows' }))
      : null
  );

  // ---- toolbar ----
  const search = el('input', {
    type: 'search',
    class: 'searchbox',
    placeholder: 'Search name or ID',
    value: state.rosterFilter.query,
    'aria-label': 'Filter the class list',
    oninput: (e) => {
      state.rosterFilter.query = e.target.value;
      renderRosterRows();
    },
  });

  const sort = el('select', {
    class: 'sortbox',
    'aria-label': 'Sort the class list',
    onchange: (e) => {
      state.rosterFilter.sort = e.target.value;
      renderRosterRows();
    },
  },
    ...[
      ['roster', 'Roster order'],
      ['name', 'Name (A–Z)'],
      ['name-desc', 'Name (Z–A)'],
      ['id', 'Student ID'],
      ['incomplete', 'Incomplete rows first'],
    ].map(([v, label]) => el('option', { value: v, selected: state.rosterFilter.sort === v }, label))
  );

  const countLabel = el('span', { class: 'rowcount' });

  const bar = el('div', { class: 'entrybar' },
    el('div', { class: 'pickgroup' },
      el('button', {
        class: 'btn small',
        title: 'Renumber students 1..n in the order shown',
        onclick: () => renumberRoster(course),
      }, 'Renumber')),
    el('div', { class: 'spacer' }),
    el('div', { class: 'filtergroup' }, search, sort, countLabel)
  );

  const note = el('div', { class: 'note' },
    'Type the class list like a spreadsheet. Enter or Tab moves to the next cell, and a new ',
    'row appears when you fill the last one. Changes save as you type.'
  );

  const thead = el('thead', {}, el('tr', {},
    el('th', { text: '#', class: 'ta-right' }),
    el('th', { text: 'Student ID', class: 'w-id' }),
    el('th', { text: 'Full name', class: 'namecol' }),
    el('th', { text: '', class: 'w-action' })
  ));

  const tbody = el('tbody');

  /** Rebuild only the rows, so the search caret is never disturbed. */
  function renderRosterRows() {
    const q = state.rosterFilter.query.trim().toLowerCase();
    const matches = (s) =>
      !q ||
      String(s.full_name || '').toLowerCase().includes(q) ||
      String(s.student_id || '').toLowerCase().includes(q);

    const incomplete = (s) =>
      !String(s.full_name || '').trim() || !String(s.student_id || '').trim();
    const byOrder = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0);
    const sorters = {
      roster: byOrder,
      name: (a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')),
      'name-desc': (a, b) => String(b.full_name || '').localeCompare(String(a.full_name || '')),
      id: (a, b) => String(a.student_id || '').localeCompare(
        String(b.student_id || ''), undefined, { numeric: true }),
      incomplete: (a, b) => (incomplete(a) ? 0 : 1) - (incomplete(b) ? 0 : 1) || byOrder(a, b),
    };

    const visible = students.filter(matches)
      .sort(sorters[state.rosterFilter.sort] || byOrder);

    const rows = visible.map((student, index) => makeRow(student, index, visible.length));
    if (!rows.length) {
      setChildren(tbody, el('tr', {}, el('td', {
        class: 'cellpad emptyrow', colspan: '4',
        text: `No student matches “${state.rosterFilter.query}”.`,
      })));
    } else {
      setChildren(tbody, ...rows);
    }

    countLabel.textContent =
      visible.length === students.length
        ? `${students.length} student${students.length === 1 ? '' : 's'}`
        : `${visible.length} of ${students.length}`;
  }

  const makeRow = (student, index, total) => {
    const idInput = el('input', {
      type: 'text',
      value: student.student_id || '',
      class: 'id-input',
      placeholder: 'ID',
      dataset: { row: String(index), col: '0' },
      'aria-label': `Student ID, row ${index + 1}`,
    });
    const nameInput = el('input', {
      type: 'text',
      value: student.full_name || '',
      class: 'name-input',
      placeholder: 'Surname, Given name',
      dataset: { row: String(index), col: '1' },
      'aria-label': `Full name, row ${index + 1}`,
    });

    const save = async (field, input) => {
      const value = input.value.trim();
      const key = field === 'studentId' ? 'student_id' : 'full_name';
      if ((student[key] || '') === value) return;
      await guard(() => api.students.update(student.id, { [field]: value }), 'Saving');
      student[key] = value;
      saved();
      await refreshComputed();
      markRowState(tr, student);
    };
    idInput.addEventListener('change', () => save('studentId', idInput));
    idInput.addEventListener('blur', () => save('studentId', idInput));
    nameInput.addEventListener('change', () => save('fullName', nameInput));
    nameInput.addEventListener('blur', () => save('fullName', nameInput));

    for (const input of [idInput, nameInput]) {
      input.addEventListener('keydown', (e) => onRosterKey(e, course, total));
    }

    const tr = el('tr', {},
      el('td', { class: 'idx', text: student.number ?? index + 1 }),
      el('td', { class: 'entry w-id' }, idInput),
      el('td', { class: 'entry w-auto' }, nameInput),
      el('td', { class: 'ta-center' },
        el('button', {
          class: 'btn rowdel',
          title: `Remove ${student.full_name || 'this row'}`,
          'aria-label': `Remove ${student.full_name || 'this row'}`,
          onclick: () => removeStudent(student),
        }, '✕'))
    );
    markRowState(tr, student);
    return tr;
  };

  /** Tint a row that is not yet filled in, so gaps are visible at a glance. */
  function markRowState(tr, student) {
    const hasName = !!String(student.full_name || '').trim();
    const hasId = !!String(student.student_id || '').trim();
    tr.classList.toggle('rowblank', !hasName && !hasId);
    tr.classList.toggle('rowpartial', hasName !== hasId);
  }

  renderRosterRows();

  setChildren(content, summary, bar, note,
    el('div', { class: 'gridcard rostercard' }, el('table', { class: 'rostertable' }, thead, tbody)));
}

/** Renumber students 1..n in their current stored order. */
async function renumberRoster(course) {
  const students = await api.students.list(course.id);
  const ok = await confirmDialog({
    title: 'Renumber the class list?',
    subtitle: `Students will be numbered 1 to ${students.length} in roster order.`,
    body: el('div', { class: 'hint' },
      'The number is only a label on the grade sheet. Scores and grades are unaffected.'),
    confirmLabel: 'Renumber',
    danger: false,
  });
  if (!ok) return;
  for (let i = 0; i < students.length; i++) {
    if (students[i].number !== i + 1) {
      await guard(() => api.students.update(students[i].id, { number: i + 1 }), 'Renumbering');
    }
  }
  await refreshComputed();
  await renderScreen();
  saved('Renumbered');
}

function onRosterKey(event, course, rowCount) {
  const row = Number(event.target.dataset.row);
  const col = Number(event.target.dataset.col);
  const focus = (r, c) => {
    const next = document.querySelector(`#content input[data-row="${r}"][data-col="${c}"]`);
    if (next) {
      next.focus();
      next.select();
      event.preventDefault();
      return true;
    }
    return false;
  };
  if (event.key === 'Enter') {
    event.preventDefault();
    if (!focus(row + 1, col) && row === rowCount - 1) addRosterRows(course, 1);
    return;
  }
  if (event.key === 'ArrowDown') focus(row + 1, col);
  if (event.key === 'ArrowUp') focus(row - 1, col);
}

async function addRosterRows(course, count) {
  const rows = Array.from({ length: count }, () => ({ studentId: '', fullName: '' }));
  await guard(() => api.students.addMany(course.id, rows), 'Adding rows');
  await refreshComputed();
  await renderScreen();
  const inputs = document.querySelectorAll('#content input[data-col="0"]');
  const target = inputs[inputs.length - count];
  if (target) target.focus();
}

async function pasteRoster(course) {
  const textarea = el('textarea', {
    rows: '10',
    class: 'paste-area',
    placeholder: '44305\tAllison, Elizabeth Y.\n38901\tAllison, Emmanuel M.',
  });
  const result = await modal({
    title: 'Paste a class list',
    subtitle: 'One student per line. ID and name separated by a tab or comma, or just names.',
    body: el('div', {}, textarea),
    confirmLabel: 'Add students',
    wide: true,
    onConfirm: () => textarea.value.trim() || false,
  });
  if (!result) return;

  // Parsing lives in the engine so it can be unit-tested directly, rather than
  // being duplicated here where only the running app could exercise it.
  const rows = await guard(() => api.students.parsePaste(result), 'Reading list');
  if (!rows || !rows.length) return;

  await guard(() => api.students.addMany(course.id, rows), 'Adding students');
  await refreshComputed();
  await renderScreen();
  toast(`Added ${rows.length} student${rows.length === 1 ? '' : 's'}`);
}

async function removeStudent(student) {
  const ok = await confirmDialog({
    title: `Remove ${student.full_name || 'this student'}?`,
    subtitle: 'Their scores and attendance marks are deleted with them.',
    confirmLabel: 'Remove student',
  });
  if (!ok) return;
  await guard(() => api.students.remove(student.id), 'Removing student');
  await refreshComputed();
  await renderScreen();
  saved('Student removed');
}

// ------------------------------------------------------ assessments & policy

async function renderConfig(content, course) {
  const maximums = await api.policies.maximums(course.policy);
  const selectable = state.policies.filter((p) => p.selectable);
  const policyInfo = state.policies.find((p) => p.policy === String(course.policy));

  const policySelect = el('select', {},
    ...selectable.map((p) => el('option', { value: p.policy, selected: p.policy === String(course.policy) }, p.label))
  );
  policySelect.addEventListener('change', () => changePolicy(course, policySelect.value, policySelect));

  const kpis = el('div', { class: 'kpis' },
    el('div', { class: 'kpi' }, el('div', { class: 'v', text: `${course.policy}%` }), el('div', { class: 'l', text: 'Transmutation policy' })),
    el('div', { class: 'kpi' },
      el('div', { class: 'v', text: String(state.assessments.midterm.filter((a) => a.kind !== 'exam').length) }),
      el('div', { class: 'l', text: 'Midterm assessments' })),
    el('div', { class: 'kpi' },
      el('div', { class: 'v', text: String(state.assessments.final.filter((a) => a.kind !== 'exam').length) }),
      el('div', { class: 'l', text: 'Final assessments' })),
    el('div', { class: 'kpi' }, el('div', { class: 'v', text: '40' }), el('div', { class: 'l', text: 'Exam max (fixed)' }))
  );

  const courseFields = el('div', { class: 'panel mb-16' },
    el('h3', { text: 'Course' }),
    el('div', { class: 'sub', text: 'These details appear on the exported grade sheet.' }),
    el('div', { class: 'fieldrow' },
      field('Course code', course.code, (v) => updateCourseField(course, 'code', v)),
      field('Section', course.section, (v) => updateCourseField(course, 'section', v))),
    el('div', { class: 'fieldrow' },
      field('Course name', course.name, (v) => updateCourseField(course, 'name', v)),
      field('Instructor', course.instructor, (v) => updateCourseField(course, 'instructor', v))),
    el('div', { class: 'field' },
      el('label', { text: 'Transmutation policy' }),
      policySelect,
      policyInfo ? el('div', { class: 'hint', text: policyInfo.note }) : null)
  );

  const note = el('div', { class: 'note' },
    'Class standing is the ', el('b', {}, 'equal-weight average'), ' of the assessments below × 0.6. ',
    'Add or remove freely, no reweighting is ever needed. ',
    `Each point value must match a real column in the ${course.policy}% table (${maximums.join(', ')}).`
  );

  const panels = el('div', { class: 'panelgrid' },
    termPanel('midterm', 'Midterm term', course, maximums),
    termPanel('final', 'Final term', course, maximums)
  );

  setChildren(content, kpis, courseFields, note, panels);
}

function field(label, value, onSave) {
  const input = el('input', { type: 'text', value: value || '' });
  const commit = () => onSave(input.value.trim());
  input.addEventListener('change', commit);
  input.addEventListener('blur', commit);
  return el('div', { class: 'field' }, el('label', { text: label }), input);
}

async function updateCourseField(course, key, value) {
  if ((course[key] || '') === value) return;
  await guard(() => api.courses.update(course.id, { [key]: value }), 'Saving course');
  course[key] = value;
  await loadCourses();
  renderRail();
  saved();
}

function termPanel(kind, title, course, maximums) {
  const list = state.assessments[kind];
  const term = state.terms[kind];
  const exam = list.find((a) => a.kind === 'exam');
  const classStanding = list.filter((a) => a.kind !== 'exam');

  const rows = classStanding.map((a) => {
    const nameInput = el('input', { type: 'text', value: a.name, 'aria-label': 'Assessment name' });
    const commitName = async () => {
      const v = nameInput.value.trim();
      if (!v || v === a.name) {
        nameInput.value = a.name;
        return;
      }
      await guard(() => api.assessments.update(a.id, { name: v }), 'Renaming');
      a.name = v;
      saved();
    };
    nameInput.addEventListener('change', commitName);
    nameInput.addEventListener('blur', commitName);

    const maxSelect = el('select', { 'aria-label': 'Point value' },
      ...maximums.map((m) => el('option', { value: m, selected: m === a.max_points }, `${m} pts`)),
      // Keep an existing out-of-table value visible rather than silently changing it.
      maximums.includes(a.max_points) ? null : el('option', { value: a.max_points, selected: true }, `${a.max_points} pts (unsupported)`)
    );
    maxSelect.addEventListener('change', async () => {
      const value = Number(maxSelect.value);
      const check = await api.policies.validateMax(value, course.policy);
      if (check && !check.ok) {
        toast(check.message, 'error');
        maxSelect.value = String(a.max_points);
        return;
      }
      await guard(() => api.assessments.update(a.id, { maxPoints: value }), 'Changing points');
      a.max_points = value;
      await refreshComputed();
      saved();
    });

    return el('div', { class: 'arow' },
      el('span', { class: 'aname' }, nameInput),
      a.kind === 'attendance' ? el('span', { class: 'badge', text: 'auto' }) : null,
      maxSelect,
      el('button', { type: 'button', class: 'x', title: 'Remove', onclick: () => removeAssessment(a) }, '✕')
    );
  });

  return el('div', { class: 'panel' },
    el('h3', { text: title }),
    el('div', { class: 'sub', text: 'Class standing (averaged equally) + one exam at 40%' }),
    ...rows,
    exam
      ? el('div', { class: 'arow' },
          el('span', { class: 'aname' }, exam.name),
          el('span', { class: 'badge exam', text: 'exam · 40 · fixed' }))
      : null,
    el('div', { class: 'addrow' },
      el('button', { class: 'btn ghost', onclick: () => addAssessment(term, kind, course) }, '＋ Add assessment'),
      classStanding.some((a) => a.kind === 'attendance')
        ? null
        : el('button', { class: 'btn ghost', onclick: () => addAssessment(term, kind, course, true) }, '＋ Add attendance'))
  );
}

async function addAssessment(term, kind, course, isAttendance = false) {
  const maximums = await api.policies.maximums(course.policy);
  const name = el('input', {
    type: 'text',
    required: true,
    value: isAttendance ? 'Attendance' : '',
    placeholder: 'Quiz 1',
  });
  const points = el('select', {},
    ...maximums.map((m) => el('option', { value: m, selected: m === 10 }, `${m} pts`))
  );

  const result = await modal({
    title: isAttendance ? 'Add attendance' : 'Add assessment',
    subtitle: isAttendance
      ? 'Its raw score is computed from session marks, then transmuted like any other assessment.'
      : `Added to the ${kind === 'midterm' ? 'midterm' : 'final'} term and averaged equally with the others.`,
    body: el('div', {},
      el('div', { class: 'field' }, el('label', { text: 'Name' }), name),
      el('div', { class: 'field' }, el('label', { text: 'Point value' }), points)),
    confirmLabel: 'Add',
    onConfirm: () => (name.value.trim() ? { name: name.value.trim(), maxPoints: Number(points.value) } : false),
  });
  if (!result) return;

  await guard(
    () => api.assessments.add(term.id, {
      name: result.name,
      maxPoints: result.maxPoints,
      kind: isAttendance ? 'attendance' : 'class_standing',
    }),
    'Adding assessment'
  );
  await loadCourseDetail();
  await renderScreen();
  saved();
}

async function removeAssessment(assessment) {
  const count = await api.assessments.countScores(assessment.id);
  const ok = await confirmDialog({
    title: `Remove ${assessment.name}?`,
    subtitle: count
      ? `${count} entered score${count === 1 ? '' : 's'} will be deleted.`
      : 'This assessment has no scores yet.',
    body: el('div', { class: 'note warn' },
      'Class standing is an average, so removing an assessment changes every student’s grade in this term.'),
    confirmLabel: 'Remove assessment',
  });
  if (!ok) return;
  await guard(() => api.assessments.remove(assessment.id), 'Removing assessment');
  await loadCourseDetail();
  await renderScreen();
  saved('Assessment removed');
}

async function changePolicy(course, newPolicy, selectEl) {
  if (String(newPolicy) === String(course.policy)) return;
  const all = [...state.assessments.midterm, ...state.assessments.final]
    .filter((a) => a.kind !== 'exam')
    .map((a) => ({ name: a.name, maxPoints: a.max_points }));
  const stranded = await api.policies.stranded(all, newPolicy);

  const info = state.policies.find((p) => p.policy === String(newPolicy));
  const ok = await confirmDialog({
    title: `Switch this course to the ${newPolicy}% table?`,
    subtitle: 'Every grade in the course is recomputed with the new lookup values.',
    body: el('div', {},
      stranded.length
        ? el('div', { class: 'note warn' },
            el('b', {}, `The ${newPolicy}% table has no column for `),
            stranded.map((s) => `${s.name} (${s.maxPoints} pts)`).join(', '),
            '. Those assessments will not transmute until you change their point values.')
        : null,
      info && info.confidence !== 'grade-verified'
        ? el('div', { class: 'note warn' }, info.note)
        : null,
      el('div', { class: 'hint' }, 'You can switch back at any time; no scores are lost.')),
    confirmLabel: 'Switch policy',
    danger: stranded.length > 0,
  });
  if (!ok) {
    if (selectEl) selectEl.value = String(course.policy);
    return;
  }

  await guard(() => api.courses.update(course.id, { policy: String(newPolicy) }), 'Changing policy');
  await loadCourses();
  await loadCourseDetail();
  renderRail();
  await renderScreen();
  saved('Policy changed');
}

// ------------------------------------------------------------------ issues

/**
 * Keep the "Review issues (n)" badge honest as scores change.
 * Rebuilt rather than assigned as text so the responsive `.long` span, which
 * collapses the label on narrow windows, survives the update.
 */
function updateIssueCount(button, issues) {
  if (!button || !button.isConnected) return;
  const count = issues.filter((i) => i.severity !== 'info').length;
  setChildren(
    button,
    document.createTextNode('Review'),
    el('span', { class: 'long', text: ' issues' }),
    count ? document.createTextNode(` (${count})`) : null
  );
}

/**
 * Refresh the issue badge in the top bar after an edit. Runs in the background;
 * a slow count must never hold up the next keystroke.
 */
async function refreshIssueBadge() {
  const button = [...document.querySelectorAll('#topActions .btn')].find((b) =>
    b.textContent.startsWith('Review issues')
  );
  if (!button || !state.courseId) return;
  try {
    updateIssueCount(button, await api.gradebook.issues(state.courseId));
  } catch {
    // A failed count is not worth interrupting entry over; the review dialog
    // fetches fresh anyway.
  }
}

function showIssues(issues) {
  const body = issues.length
    ? el('div', { class: 'gridcard' },
        ...issues.map((i) =>
          el('div', { class: 'issue' },
            el('span', { class: `sev ${i.severity}`, text: i.severity }),
            el('span', {}, i.message))))
    : el('div', { class: 'note' }, 'No issues found. Every student has a computable grade.');

  modal({
    title: 'Review issues',
    subtitle: issues.length
      ? `${issues.length} thing${issues.length === 1 ? '' : 's'} to check before exporting.`
      : 'Checked every student in this course.',
    body,
    confirmLabel: 'Close',
    // A review only dismisses, so a second dismissing button would be noise.
    cancelLabel: null,
    wide: true,
    onConfirm: () => true,
  });
}

async function exportRecordFile() {
  const file = await guard(() => api.exports.gradeRecord(state.courseId), 'Export');
  if (file) toast('Grade record exported');
}

async function exportSummaryFile() {
  const file = await guard(() => api.exports.summary(state.courseId), 'Export');
  if (file) toast('Summary exported');
}


// ---------------------------------------------------------------- guide

/**
 * The guide: a contents list on the left, the chosen section on the right.
 * Content lives in guide.js so it can be edited without touching rendering.
 */
function openGuide(startId = 'start') {
  const sections = window.GradeDeskGuide.GUIDE_SECTIONS;
  let currentId = startId;

  const nav = el('div', { class: 'guidenav' });
  const pane = el('div', { class: 'guidepane' });

  const renderSection = () => {
    const s = sections.find((x) => x.id === currentId) || sections[0];
    setChildren(nav,
      ...sections.map((x) =>
        el('button', {
          type: 'button',
          class: `guidelink${x.id === s.id ? ' active' : ''}`,
          onclick: () => { currentId = x.id; renderSection(); },
        }, x.title))
    );
    setChildren(pane,
      el('h4', { class: 'guidetitle', text: s.title }),
      ...s.body.map((p) => el('p', { class: 'guidep', text: p })),
      s.steps
        ? el('div', { class: 'guidesteps' },
            ...s.steps.map(([k, v]) =>
              el('div', { class: 'guidestep' }, el('b', { text: k }), el('span', { text: v }))))
        : null,
      s.formula
        ? el('div', { class: 'guideformula' },
            ...s.formula.map(([k, v]) =>
              el('div', { class: 'formularow' },
                el('span', { class: 'fname', text: k }),
                el('span', { class: 'fbody', text: v }))))
        : null,
      s.note ? el('div', { class: 'note', text: s.note }) : null
    );
    pane.scrollTop = 0;
  };
  renderSection();

  return modal({
    title: 'GradeDesk guide',
    subtitle: 'How to run a course, from setup to submitted grade sheet.',
    body: el('div', { class: 'guidewrap' }, nav, pane),
    confirmLabel: 'Close',
    cancelLabel: null,
    wide: true,
    onConfirm: () => true,
  });
}

// ------------------------------------------------------- first-run wizard

/** Remember that setup has been offered, so it is not shown on every launch. */
function markSetupSeen() {
  try {
    localStorage.setItem('gradedesk.setupSeen', '1');
  } catch {
    // Blocked storage is not worth interrupting anything over; at worst the
    // wizard is offered once more.
  }
}

function setupAlreadySeen() {
  try {
    return localStorage.getItem('gradedesk.setupSeen') === '1';
  } catch {
    return false;
  }
}

/**
 * First-run setup.
 *
 * Shown once, when the app opens with no course at all. It walks the four
 * things that must exist before grade entry makes sense, doing each one for
 * real rather than describing it. Skippable at any point, and always reachable
 * again from the Guide button.
 */
async function runSetupWizard() {
  const intro = await modal({
    title: 'Welcome to GradeDesk',
    subtitle: 'Four short steps and you can start entering scores.',
    body: el('div', {},
      el('div', { class: 'wizhero' },
        el('div', { class: 'wizmark', text: '✓' }),
        el('div', {},
          el('p', { class: 'guidep' },
            'GradeDesk turns raw scores into your WVSTU grade record. You type marks ' +
            'across the class list; it handles the transmutation, the averaging and the ' +
            'letter grades, then exports the sheet you submit.'),
          el('p', { class: 'guidep' },
            'Everything stays on this computer and is saved as you type. No internet ' +
            'connection is needed at any point.'))),
      el('div', { class: 'guidesteps' },
        el('div', { class: 'guidestep' }, el('b', { text: '1. Semester' }),
          el('span', { text: 'Name the term you are teaching.' })),
        el('div', { class: 'guidestep' }, el('b', { text: '2. Course' }),
          el('span', { text: 'Code, section and grading policy.' })),
        el('div', { class: 'guidestep' }, el('b', { text: '3. Assessments' }),
          el('span', { text: 'Quizzes, assignments, attendance.' })),
        el('div', { class: 'guidestep' }, el('b', { text: '4. Class list' }),
          el('span', { text: 'Type or paste your students.' })))),
    confirmLabel: 'Get started',
    cancelLabel: 'Skip for now',
    onConfirm: () => true,
  });
  if (!intro) {
    markSetupSeen();
    return;
  }

  // ---- step 1: semester ----
  let semester = state.activeSemester;
  if (!semester) {
    const created = await newSemester();
    if (!created) { markSetupSeen(); return; }
    semester = state.activeSemester;
  } else {
    const rename = el('input', { type: 'text', value: semester.name });
    const ok = await modal({
      title: 'Step 1 of 4 · Semester',
      subtitle: 'Which term are you teaching? You can rename it later.',
      body: el('div', { class: 'field' }, el('label', { text: 'Semester name' }), rename),
      confirmLabel: 'Next',
      cancelLabel: 'Skip setup',
      onConfirm: () => rename.value.trim() || false,
    });
    if (!ok) { markSetupSeen(); return; }
    if (ok !== semester.name) {
      await guard(() => api.semesters.rename(semester.id, ok), 'Renaming semester');
      state.semesters = await api.semesters.list();
      state.activeSemester = state.semesters.find((s) => s.id === semester.id) || semester;
      semester = state.activeSemester;
    }
  }

  // ---- step 2: course ----
  const code = el('input', { type: 'text', required: true, placeholder: 'CSE 102' });
  const cname = el('input', { type: 'text', placeholder: 'Computer Literacy' });
  const section = el('input', { type: 'text', placeholder: '2' });
  const instructor = el('input', { type: 'text', placeholder: 'Your name' });
  const selectable = state.policies.filter((p) => p.selectable);
  const policy = el('select', {},
    ...selectable.map((p) =>
      el('option', { value: p.policy, selected: p.isDefault }, `${p.label} transmutation`)));

  const courseFields = await modal({
    title: 'Step 2 of 4 · Course',
    subtitle: `Added to ${semester.name}.`,
    body: el('div', {},
      el('div', { class: 'fieldrow' },
        el('div', { class: 'field' }, el('label', { text: 'Course code' }), code),
        el('div', { class: 'field' }, el('label', { text: 'Section' }), section)),
      el('div', { class: 'field' }, el('label', { text: 'Course name' }), cname),
      el('div', { class: 'field' }, el('label', { text: 'Instructor' }), instructor),
      el('div', { class: 'field' }, el('label', { text: 'Transmutation policy' }), policy),
      el('div', { class: 'hint' },
        'Most WVSTU courses use the 70% table. The policy applies to the whole course.')),
    confirmLabel: 'Next',
    cancelLabel: 'Skip setup',
    onConfirm: () => (code.value.trim()
      ? {
          code: code.value.trim(),
          name: cname.value.trim(),
          section: section.value.trim(),
          instructor: instructor.value.trim(),
          policy: policy.value,
        }
      : false),
  });
  if (!courseFields) { markSetupSeen(); return; }

  const course = await guard(
    () => api.courses.create({ semesterId: semester.id, ...courseFields }), 'Creating course');
  if (!course) { markSetupSeen(); return; }
  await loadCourses();
  state.courseId = course.id;
  await loadCourseDetail();

  // ---- step 3: assessments ----
  const preset = el('select', {},
    el('option', { value: 'typical', selected: true },
      'Typical: attendance, assignment, two quizzes, class work'),
    el('option', { value: 'minimal' }, 'Minimal: attendance and one assignment'),
    el('option', { value: 'none' }, 'None, I will add my own'));

  const chosen = await modal({
    title: 'Step 3 of 4 · Assessments',
    subtitle: 'A starting set for both terms. Add, rename or remove any of them afterwards.',
    body: el('div', {},
      el('div', { class: 'field' }, el('label', { text: 'Start with' }), preset),
      el('div', { class: 'note' },
        'Each term already has its exam, fixed at 40 points. Everything else is averaged ',
        'together with equal weight, so adding or removing one never needs reweighting.')),
    confirmLabel: 'Next',
    cancelLabel: 'Skip setup',
    onConfirm: () => preset.value,
  });
  if (!chosen) { markSetupSeen(); return; }

  if (chosen !== 'none') {
    const terms = await api.courses.terms(course.id);
    const sets = {
      typical: [
        { name: 'Attendance', maxPoints: 10, kind: 'attendance' },
        { name: 'Assign 1', maxPoints: 10 },
        { name: 'Quiz 1', maxPoints: 15 },
        { name: 'Quiz 2', maxPoints: 15 },
        { name: 'ClassWork', maxPoints: 10 },
      ],
      minimal: [
        { name: 'Attendance', maxPoints: 10, kind: 'attendance' },
        { name: 'Assign 1', maxPoints: 10 },
      ],
    };
    for (const kind of ['midterm', 'final']) {
      for (const a of sets[chosen]) {
        await guard(() => api.assessments.add(terms.byKind[kind].id, a), 'Adding assessment');
      }
    }
    await loadCourseDetail();
  }

  // ---- step 4: roster ----
  const paste = el('textarea', {
    rows: '8',
    class: 'paste-area',
    placeholder: '44305\tAllison, Elizabeth Y.\n38901\tAllison, Emmanuel M.',
  });
  const rosterText = await modal({
    title: 'Step 4 of 4 · Class list',
    subtitle: 'Paste your students now, or leave this empty and type them in the Roster screen.',
    body: el('div', {},
      paste,
      el('div', { class: 'hint' },
        'One student per line, with the ID and the name separated by a tab. ' +
        'Names keep their commas.')),
    confirmLabel: 'Finish',
    cancelLabel: 'Skip this step',
    wide: true,
    onConfirm: () => paste.value,
  });

  if (rosterText && rosterText.trim()) {
    const rows = await guard(() => api.students.parsePaste(rosterText), 'Reading list');
    if (rows && rows.length) {
      await guard(() => api.students.addMany(course.id, rows), 'Adding students');
    }
  }

  markSetupSeen();
  await loadCourses();
  state.courseId = course.id;
  state.screen = 'grades';
  await loadCourseDetail();
  renderRail();
  await renderScreen();

  await modal({
    title: 'You are set up',
    subtitle: `${course.code} is ready.`,
    body: el('div', {},
      el('p', { class: 'guidep' },
        'Pick an assessment from the dropdown and type scores straight down the column. ' +
        'Press Enter to drop to the next student.'),
      el('p', { class: 'guidep' },
        'The full guide is always available from the Guide button at the bottom of the ' +
        'left rail.')),
    confirmLabel: 'Start entering scores',
    cancelLabel: null,
    onConfirm: () => true,
  });
}

// -------------------------------------------------------------------- start

loadAll().then(async () => {
  // Offer setup only on a genuinely empty install, and only once.
  if (!setupAlreadySeen() && state.courses.length === 0) {
    await runSetupWizard();
  }
});
