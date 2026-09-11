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
  $('saveStatus').textContent = `${message} at ${new Date().toLocaleTimeString()}`;
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

/**
 * A right-click menu.
 *
 * The course rail only has room for a code and a section, so the things you
 * might want to do with a course had to be reachable some other way. Items are
 * {label, icon, onClick, danger} objects; a null entry draws a separator.
 *
 * Closes on the next click, scroll, resize or Escape, whichever comes first.
 * Positioned against the viewport and nudged back inside it, so a menu opened
 * on the last course in a long list does not hang off the bottom.
 */
/** Tears down the open menu's dismissal listeners. Null when none is open. */
let menuTeardown = null;

function contextMenu(event, { title, subtitle, items }) {
  event.preventDefault();
  event.stopPropagation();
  closeContextMenu();

  const menu = el('div', { class: 'ctxmenu' });
  if (title) {
    menu.append(el('div', { class: 'ctxhead' },
      el('div', { class: 'ctxtitle', text: title }),
      subtitle ? el('div', { class: 'ctxsub', text: subtitle }) : null));
  }
  for (const item of items) {
    if (!item) {
      menu.append(el('div', { class: 'ctxsep' }));
      continue;
    }
    menu.append(el('button', {
      type: 'button',
      class: item.danger ? 'danger' : '',
      onclick: async () => {
        closeContextMenu();
        await item.onClick();
      },
    }, el('span', { class: 'ico', text: item.icon || '' }), item.label));
  }

  document.body.append(menu);

  // Measure after mounting, then keep it on screen.
  const pad = 8;
  const box = menu.getBoundingClientRect();
  const x = Math.min(event.clientX, window.innerWidth - box.width - pad);
  const y = Math.min(event.clientY, window.innerHeight - box.height - pad);
  menu.style.left = `${Math.max(pad, x)}px`;
  menu.style.top = `${Math.max(pad, y)}px`;

  // Dismissal listeners are torn down together, by whichever path closes the
  // menu first.
  //
  // They used to be registered with {once: true} and never removed, which left
  // spent-but-live listeners behind whenever the menu closed some other way
  // (Escape, or picking an item). The next right-click then hit a stale
  // contextmenu listener that consumed itself closing nothing, so the menu
  // opened on some clicks and not others. That is the "works unexpectedly"
  // behaviour.
  const dismiss = (e) => {
    // Anything that happens INSIDE the menu is the menu being used, not a
    // reason to close it.
    //
    // This guard used to apply only to contextmenu, which broke every item:
    // mousedown fires before click, so pressing a button ran closeContextMenu,
    // the node was removed mid-gesture, and the click never reached its
    // handler. The menu appeared to work and did nothing. Items close the menu
    // themselves in their own onclick.
    if (e && e.target && menu.contains(e.target)) return;
    closeContextMenu();
  };
  menuTeardown = () => {
    document.removeEventListener('mousedown', dismiss, true);
    document.removeEventListener('contextmenu', dismiss, true);
    window.removeEventListener('scroll', dismiss, true);
    window.removeEventListener('resize', dismiss);
    menuTeardown = null;
  };

  // Capture phase, and on the NEXT frame so the click that opened this menu
  // cannot immediately close it.
  setTimeout(() => {
    if (!document.body.contains(menu)) return; // already closed
    document.addEventListener('mousedown', dismiss, true);
    document.addEventListener('contextmenu', dismiss, true);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
  }, 0);
}

function closeContextMenu() {
  if (menuTeardown) menuTeardown();
  document.querySelectorAll('.ctxmenu').forEach((m) => m.remove());
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeContextMenu();
});

/** Everything the right-click menu on a course offers. */
function courseMenu(event, course) {
  const go = async (screen) => {
    state.courseId = course.id;
    state.screen = screen;
    await loadCourseDetail();
    renderRail();
    await renderScreen();
  };
  const full = [course.name, course.section ? `Section ${course.section}` : '']
    .filter(Boolean).join(' · ');
  contextMenu(event, {
    title: course.code,
    subtitle: full || `${course.policy}% table`,
    items: [
      { label: 'Grade entry', icon: '✎', onClick: () => go('grades') },
      { label: 'Attendance', icon: '◷', onClick: () => go('attendance') },
      { label: 'Roster', icon: '☰', onClick: () => go('roster') },
      { label: 'Assessments & policy', icon: '⚙', onClick: () => go('config') },
      null,
      { label: 'Duplicate course…', icon: '⧉', onClick: () => duplicateCourse(course) },
      { label: 'Course details…', icon: 'ⓘ', onClick: () => go('config') },
      null,
      { label: 'Delete course…', icon: '✕', danger: true, onClick: () => deleteCourse(course) },
    ],
  });
}

/**
 * Copy a course's shape into a new one.
 *
 * Carries the assessments and nothing else. A second section of the same
 * course wants the same quizzes, not the same people or the same marks, and
 * copying grades across would invent results nobody entered.
 */
async function duplicateCourse(course) {
  const code = el('input', { type: 'text', required: true, value: course.code });
  const section = el('input', { type: 'text', value: '', placeholder: 'e.g. 2' });
  const name = el('input', { type: 'text', value: course.name || '' });

  const counts = [
    ...state.assessments.midterm.filter((a) => a.kind !== 'exam'),
    ...state.assessments.final.filter((a) => a.kind !== 'exam'),
  ].length;

  const result = await modal({
    title: `Duplicate ${course.code}`,
    subtitle: 'Makes a new course with the same assessments. Useful for another section.',
    body: el('div', {},
      el('div', { class: 'fieldrow' },
        el('div', { class: 'field' }, el('label', { text: 'Course code' }), code),
        el('div', { class: 'field' }, el('label', { text: 'Section' }), section)),
      el('div', { class: 'field' }, el('label', { text: 'Course name' }), name),
      el('div', { class: 'note' },
        // state.assessments holds the loaded course only, so the count is
        // shown when it is about this course and left out otherwise.
        course.id === state.courseId
          ? ['Copies all ', el('b', {}, String(counts)), ' assessments and the ']
          : ['Copies its assessments and the '],
        el('b', {}, `${course.policy}%`), ' table. ',
        'Your class list, scores and attendance are ', el('b', {}, 'not'), ' copied.')),
    confirmLabel: 'Create duplicate',
    onConfirm: () => (code.value.trim()
      ? { code: code.value.trim(), section: section.value.trim(), name: name.value.trim() }
      : false),
  });
  if (!result) return;

  const created = await guard(() => api.courses.duplicate(course.id, result), 'Duplicating course');
  if (!created) return;
  await loadCourses();
  state.courseId = created.id;
  state.screen = 'config';
  await loadCourseDetail();
  renderRail();
  await renderScreen();
  saved('Course duplicated');
}

/**
 * Delete a course and everything in it.
 *
 * The confirmation counts the students first, because "delete this course" and
 * "delete these 43 students' marks" are different sentences and only the
 * second one is true.
 */
async function deleteCourse(course) {
  const students = (await guard(() => api.students.list(course.id))) || [];
  const label = [course.code, course.section].filter(Boolean).join(' · ');

  const ok = await confirmDialog({
    title: `Delete ${label}?`,
    subtitle: course.name || undefined,
    body: el('div', {},
      el('div', { class: 'note warn' },
        students.length
          ? [
              'This removes ', el('b', {}, `${students.length} student${students.length === 1 ? '' : 's'}`),
              ' along with every mark and attendance record in this course.',
            ]
          : ['This course has no students yet. Its assessments will be removed.']),
      el('div', { class: 'hint' },
        'This cannot be undone. If you might want it back, use Manage, then Back up, first.')),
    confirmLabel: 'Delete course',
  });
  if (!ok) return;

  await guard(() => api.courses.remove(course.id), 'Deleting course');
  if (state.courseId === course.id) state.courseId = null;
  await loadCourses();
  state.courseId = state.courses[0] ? state.courses[0].id : null;
  await loadCourseDetail();
  renderRail();
  await renderScreen();
  saved('Course deleted');
}

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
        // The rail shows the code; the full name is what people actually
        // remember a course by, so it is the hover text.
        title: [c.name, c.section ? `Section ${c.section}` : '', `${c.policy}% table`]
          .filter(Boolean).join(' · ') || c.code,
        oncontextmenu: (e) => courseMenu(e, c),
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
  const help = $('helpBtn');
  if (help) help.classList.toggle('active', state.screen === 'guide');
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
    subtitle: 'Your current semester gets archived, not deleted. You can switch back any time.',
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
          el('div', { class: 'mansub', text: sem.is_active ? 'Active' : 'Archived. You can still open and export it' })),
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
    subtitle: 'Your semesters and your backups.',
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
        'Your work is saved on this computer as you type. A backup is one ',
        'file you can copy onto a flash drive and take to another computer.'),
      el('div', { class: 'manactions' },
        el('button', { class: 'btn', onclick: backupNow }, 'Save a backup'),
        el('button', {
          class: 'btn danger',
          onclick: async () => { setChildren($('modalRoot')); await restoreNow(); },
        }, 'Load a backup')),
      el('div', { class: 'hint' },
        'Restoring wipes what is here now and puts the backup in its place. We will ask you first.'),

      el('h4', { class: 'mansec', text: 'Assessment presets' }),
      el('div', { class: 'note' },
        'A preset is a set of assessments you can drop into any course, so setting ',
        'up the next one does not mean typing the same rows again.'),
      el('div', { class: 'manactions' },
        el('button', {
          class: 'btn',
          onclick: async () => { setChildren($('modalRoot')); await managePresets(); },
        }, 'Manage presets'))),
  });
}

/** Switch the active semester, warning that the current one gets archived. */
async function switchSemester(id) {
  const target = state.semesters.find((s) => s.id === id);
  if (!target || target.is_active) return;
  const ok = await confirmDialog({
    title: `Switch to ${target.name}?`,
    subtitle: 'This one becomes current, and the one you are in now gets archived.',
    body: el('div', { class: 'note' },
      'You can still open and export an archived semester, and switch back whenever you like.'),
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

  // The guide is a page in its own right, not tied to a course or a semester,
  // so it is handled before any of the "nothing selected" states.
  if (state.screen === 'guide') {
    $('crumbs').textContent = 'Help';
    $('screenTitle').textContent = 'How to use GradeDesk';
    actions.append(
      el('button', {
        class: 'btn',
        onclick: async () => {
          state.screen = 'grades';
          renderRail();
          await renderScreen();
        },
      }, 'Back to my course')
    );
    renderGuideScreen(content);
    return;
  }

  if (!state.activeSemester) {
    $('crumbs').textContent = '';
    $('screenTitle').textContent = 'Welcome';
    setChildren(content, emptyState({
      icon: '◷',
      title: 'No semester yet',
      text: 'Start by creating a semester. Everything you type is saved on this computer.',
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
      text: 'Make your first course, then add its assessments and type in your class list.',
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
      title: 'Things to check before you export',
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
      // Attendance is asked for separately from the grade sheet, usually to
      // back up a low attendance mark, so it exports on its own.
      state.screen === 'attendance'
        ? el('button', {
            class: 'btn', title: 'Export the attendance sheet', onclick: exportAttendanceFile,
          }, 'Export', el('span', { class: 'long', text: ' attendance' }))
        : el('button', { class: 'btn', title: 'Export the summary sheet', onclick: exportSummaryFile },
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
      text: 'Add the quizzes, assignments and attendance you use. Each term already has its exam, fixed at 40 points.',
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
      text: 'Type your class list in the Roster screen, then come back here to enter scores.',
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
      }, `${a.name}  ·  ${a.max_points} marks${a.kind === 'exam' ? '  (exam)' : ''}`));
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
        el('b', {}, selected.name), ' works itself out from the attendance you have marked. ',
        'Mark the sessions on the Attendance screen. You cannot type in this column.')
    : el('div', { class: 'note' },
        'Entering ', el('b', {}, selected.name), '. ',
        `The highest mark you can give here is ${selected.max_points}. `,
        'Type a score on each row and press Enter to drop to the next student, just like in Excel. ',
        'A blank counts as 50. The shaded columns work themselves out.');

  const policyWarn = policyInfo && policyInfo.confidence !== 'grade-verified'
    ? el('div', { class: 'note warn' },
        el('b', {}, `${policyInfo.label} policy: `),
        'copied from the university tables and checked over, but not yet tried ',
        'against a finished grade sheet. Check a few results yourself before you submit.')
    : null;

  // ---- table ----
  const termLabel = selected.termKind === 'midterm' ? 'Midterm' : 'Final';
  const thead = el('thead', {},
    el('tr', {},
      el('th', { text: '#', class: 'ta-right' }),
      el('th', { text: 'ID' }),
      el('th', { text: 'Full name' }),
      el('th', { class: 'th-entry', text: `${selected.name} (of ${selected.max_points})` }),
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
        title: isAtt ? 'Worked out from the attendance you have marked' : '',
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
        el('td', {
          class: `name cellpad${row.student.unofficial ? ' unofficial' : ''}`,
          title: row.student.unofficial
            ? `Not on the official roster${row.student.note ? `: ${row.student.note}` : ''}`
            : row.student.full_name || '',
        },
          row.student.full_name || '',
          row.student.unofficial
            ? el('span', { class: 'offroster', title: 'Not on the official roster yet' }, 'not on roster')
            : null),
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
      el('span', {}, 'Blank exam → letter ', el('b', {}, 'I'), ' · Final grade shown to 2 decimals, never rounded up'),
      // Shown only when the running-total columns have been dropped, so the
      // instructor knows they are hidden rather than missing.
      el('span', { class: 'narrow-only' }, 'Make the window wider to see class standing and term totals')
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

  if (!attendanceAssessment) {
    setChildren(content, termSwitch, emptyState({
      icon: '◷',
      title: 'No attendance set up for this term',
      text: 'Add an attendance assessment so the marks you take have somewhere to go.',
      actionLabel: 'Set up assessments',
      onAction: async () => { state.screen = 'config'; renderRail(); await renderScreen(); },
    }));
    return;
  }

  if (!students.length) {
    setChildren(content, termSwitch, emptyState({
      icon: '☰',
      title: 'No students yet',
      text: 'Type your class list in the Roster screen first.',
      actionLabel: 'Go to roster',
      onAction: async () => { state.screen = 'roster'; renderRail(); await renderScreen(); },
    }));
    return;
  }

  if (!sessions.length) {
    setChildren(content, termSwitch, emptyState({
      icon: '◷',
      title: 'No sessions yet',
      text: 'Add a session for each class you hold, then mark the whole class down the column.',
      actionLabel: '＋ Record attendance',
      onAction: () => addSession(course, term),
    }));
    return;
  }

  const note = el('div', { class: 'note' },
    'Click a cell to cycle ', el('b', {}, 'P'), ' (present, full) → ', el('b', {}, 'E'),
    ' (excused, half) → ', el('b', {}, 'A'), ' (absent, zero) → blank. ',
    `Attendance is graded on ${attendanceAssessment.max_points} points. `,
    'Everyone starts from the full ', el('b', {}, String(attendanceAssessment.max_points)),
    '; each P counts in full, each E counts half, each A counts nothing, and the points are shared out over the classes you marked. ',
    'The result is then treated like any other assessment.'
  );

  const thead = el('thead', {}, el('tr', {},
    el('th', { text: '#', class: 'ta-right' }),
    el('th', { text: 'Full name' }),
    ...sessions.map((s) =>
      el('th', { class: 'session', title: GradeDeskDates.formatDate(s.date) },
        GradeDeskDates.formatDateShort(s.date, sessions.map((x) => x.date)),
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
      // The mark sits in a chip rather than being loose text in the cell, so it
      // reads as something you click, the same way a score box does.
      const chip = el('span', { class: 'attchip', text: code || '·' });
      const td = el('td', {
        class: `att ${code || 'blank'}`,
        tabindex: '0',
        role: 'button',
        title: 'Click to change: present, excused, absent, or blank',
        'aria-label': `${row.student.full_name}, ${GradeDeskDates.formatDate(session.date)}`,
        onclick: () => cycleMark(td, row.student.id, session.id, rawCell, transCell, attendanceAssessment, termKind),
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            td.click();
          }
        },
      }, chip);
      return td;
    });

    tbody.append(el('tr', {},
      el('td', { class: 'idx', text: row.student.number ?? i + 1 }),
      el('td', {
        class: `name cellpad${row.student.unofficial ? ' unofficial' : ''}`,
        title: row.student.unofficial
          ? `Not on the official roster${row.student.note ? `: ${row.student.note}` : ''}`
          : row.student.full_name,
      },
        row.student.full_name,
        row.student.unofficial
          ? el('span', { class: 'offroster', title: 'Not on the official roster yet' }, 'not on roster')
          : null),
      ...cells,
      rawCell,
      transCell
    ));
  });

  setChildren(content,
    termSwitch,
    note,
    // The button sits directly above the table rather than in the top action
    // bar: recording attendance is a thing you do to this table, so it belongs
    // next to it where the eye already is.
    el('div', { class: 'tabletools' },
      el('span', { class: 'toolcount' },
        `${sessions.length} ${sessions.length === 1 ? 'class' : 'classes'} marked`),
      el('button', { class: 'btn primary', onclick: () => addSession(course, term) },
        '＋ Record attendance')
    ),
    el('div', { class: 'gridcard' }, el('table', {}, thead, tbody)),
    el('div', { class: 'hint' },
      'It divides by the sessions you have actually marked, not the whole term, so the score is fair even halfway through.')
  );
}

const MARK_CYCLE = ['P', 'E', 'A', null];

async function cycleMark(td, studentId, sessionId, rawCell, transCell, assessment, termKind) {
  const chip = td.querySelector('.attchip') || td;
  const shown = chip.textContent.trim();
  const current = shown === '·' ? null : shown;
  const next = MARK_CYCLE[(MARK_CYCLE.indexOf(current) + 1) % MARK_CYCLE.length];

  td.className = `att ${next || 'blank'}`;
  chip.textContent = next || '·';

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
  const date = el('input', { type: 'date', required: true, value: GradeDeskDates.todayStored() });
  const result = await modal({
    title: 'Add attendance session',
    subtitle: 'One session for each class you hold.',
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
    title: `Remove the session on ${GradeDeskDates.formatDate(session.date)}?`,
    subtitle: count
      ? `${count} mark${count === 1 ? '' : 's'} will be deleted, which changes attendance scores.`
      : 'You have not marked anyone for this session.',
    body: el('div', { class: 'note warn' },
      'Attendance is divided by the sessions you have marked, so taking one away changes everyone’s score.'),
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
      text: 'Add some rows and type each student’s ID and name, or paste a list you already have.',
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
  const offRoster = students.filter((s) => s.unofficial).length;

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
      : null,
    offRoster
      ? el('div', {
          class: 'kpi flagged',
          title: 'Sitting in your class but not on the official roster yet',
        },
          el('div', { class: 'v', text: String(offRoster) }),
          el('div', { class: 'l', text: 'Not on roster' }))
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
        title: 'Number the students 1, 2, 3 in the order shown',
        onclick: () => renumberRoster(course),
      }, 'Renumber')),
    el('div', { class: 'spacer' }),
    el('div', { class: 'filtergroup' }, search, sort, countLabel)
  );

  const note = el('div', { class: 'note' },
    'Type your class list like a spreadsheet. Enter or Tab moves along, and a new ',
    'row appears once you fill the last one. Everything saves as you type.'
  );

  const thead = el('thead', {}, el('tr', {},
    el('th', { text: '#', class: 'ta-right' }),
    el('th', { text: 'Student ID', class: 'w-id' }),
    el('th', { text: 'Full name', class: 'namecol' }),
    el('th', { text: 'On roster?', class: 'w-status ta-center' }),
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
      el('td', { class: 'w-status ta-center' },
        el('button', {
          class: `statustoggle${student.unofficial ? ' off' : ''}`,
          title: student.unofficial
            ? 'Sitting in but not on the official roster. Click once they are added.'
            : 'On the official roster. Click if they are not on it yet.',
          onclick: () => toggleUnofficial(student, tr),
        }, student.unofficial ? 'Not yet' : 'Yes')),
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
    tr.classList.toggle('rowunofficial', !!student.unofficial);
  }

  /**
   * Flip a student between "on the official roster" and "sitting in, not added
   * yet". This is the addendum case: the instructor lets a student sit the
   * class after a timetable clash or a late registration, and submits their
   * name on the addendum list with the grades at the end. Until that is sent,
   * they want reminding every time they look at the class.
   */
  async function toggleUnofficial(student, tr) {
    const now = student.unofficial ? 0 : 1;
    if (now) {
      const why = el('input', {
        type: 'text',
        value: student.note || '',
        placeholder: 'for example: timetable clash, or registered late',
      });
      const result = await modal({
        title: `Mark ${student.full_name || 'this student'} as not on the roster`,
        subtitle: 'You will see a tag beside their name until you turn this off.',
        body: el('div', {},
          el('div', { class: 'note' },
            'Use this for a student you have allowed to sit the class who is not on the ',
            'official roster yet, after a timetable clash or a late registration. You mark ',
            'them like everyone else, and the tag reminds you to put their name on the ',
            'addendum list you send with your grades.'),
          el('div', { class: 'field' }, el('label', { text: 'Note (optional)' }), why)),
        confirmLabel: 'Mark as not on roster',
        onConfirm: () => ({ note: why.value.trim() }),
      });
      if (!result) return;
      await guard(() => api.students.update(student.id, { unofficial: 1, note: result.note }), 'Saving');
      student.unofficial = 1;
      student.note = result.note;
      toast(`${student.full_name || 'Student'} flagged as not on the roster`);
    } else {
      await guard(() => api.students.update(student.id, { unofficial: 0 }), 'Saving');
      student.unofficial = 0;
      toast(`${student.full_name || 'Student'} is now on the official roster`);
    }
    saved();
    await refreshComputed();
    await renderScreen();
  }

  renderRosterRows();

  setChildren(content, summary, bar, note,
    el('div', { class: 'gridcard' }, el('table', { class: 'rostertable' }, thead, tbody)));
}

/** Renumber students 1..n in their current stored order. */
async function renumberRoster(course) {
  const students = await api.students.list(course.id);
  const ok = await confirmDialog({
    title: 'Renumber the class list?',
    subtitle: `Students will be numbered 1 to ${students.length} in roster order.`,
    body: el('div', { class: 'hint' },
      'The number is only a label on the grade sheet. No scores or grades change.'),
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
    placeholder: '10001\tBestman, Comfort K.\n10002\tBestman, Daniel T.',
  });
  // Tab normally moves focus to the next button, so the old instruction to put
  // a tab between the ID and the name was impossible to follow by typing.
  // Inside this box Tab types a real tab. Pressing Escape first, then Tab,
  // still moves focus out for anyone navigating by keyboard.
  let tabLeaves = false;
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      tabLeaves = true;
      return;
    }
    if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) {
      tabLeaves = false;
      return;
    }
    if (tabLeaves || e.shiftKey) {
      tabLeaves = false;
      return; // let focus move on
    }
    e.preventDefault();
    const from = textarea.selectionStart;
    const to = textarea.selectionEnd;
    const value = textarea.value;
    textarea.value = value.slice(0, from) + '\t' + value.slice(to);
    textarea.selectionStart = from + 1;
    textarea.selectionEnd = from + 1;
  });

  const result = await modal({
    title: 'Paste a class list',
    subtitle: 'One student per line, with the ID first and then the name.',
    body: el('div', {},
      textarea,
      el('div', { class: 'hint' },
        'Separate the ID from the name with a Tab or a couple of spaces. ',
        'Pressing Tab in this box types a tab instead of jumping to a button. ',
        'A line with no ID is taken as a name on its own.')),
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
    subtitle: 'Their scores and attendance go with them.',
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
    el('div', { class: 'sub', text: 'These show at the top of your exported grade sheet.' }),
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
    'Add or remove as you like. You never have to redo the weights. ',
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

  const rows = classStanding.map((a, i) => {
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

    const moves = el('span', { class: 'moves' },
      el('button', {
        type: 'button', title: 'Move up', disabled: i === 0,
        onclick: () => moveAssessment(kind, a.id, -1),
      }, '▲'),
      el('button', {
        type: 'button', title: 'Move down', disabled: i === classStanding.length - 1,
        onclick: () => moveAssessment(kind, a.id, 1),
      }, '▼'));

    return el('div', { class: 'arow' },
      moves,
      el('span', { class: 'aname' }, nameInput),
      a.kind === 'attendance'
        ? el('span', { class: 'badge', title: 'Scores itself from the attendance register', text: 'auto' })
        : null,
      maxSelect,
      // Attendance is excluded: a term can only hold one, because two would
      // both read the same register and count it twice in the average.
      a.kind === 'attendance'
        ? null
        : el('button', {
            type: 'button',
            class: 'dup',
            title: 'Add another like this one',
            onclick: () => duplicateAssessment(kind, a),
          }, '⧉'),
      el('button', { type: 'button', class: 'x', title: 'Remove', onclick: () => removeAssessment(a) }, '✕')
    );
  });

  const points = classStanding.reduce((sum, a) => sum + a.max_points, 0);
  const other = kind === 'midterm' ? 'final' : 'midterm';
  const otherLabel = other === 'midterm' ? 'midterm' : 'final';

  return el('div', { class: 'panel' },
    el('h3', {}, title, helpDot(
      'Each score is looked up in the transmutation table first, which turns it into a '
      + 'value between 50 and 100. Those are averaged, and the average is 60% of the term. '
      + 'The exam is the other 40%.')),
    el('div', { class: 'sub', text: 'Everything averaged equally, plus one exam worth 40%' }),
    ...rows,
    exam
      ? el('div', { class: 'arow' },
          el('span', { class: 'aname' }, exam.name),
          el('span', {
            class: 'badge exam',
            title: 'Every term has exactly one exam, always worth 40 points',
            text: 'exam · 40 · fixed',
          }))
      : null,
    // A plain count, deliberately not measured against a target. Point values
    // do not have to add up to anything: each raw score becomes a 50-100 value
    // before averaging, so three assessments at full marks give exactly the
    // same class standing as five.
    classStanding.length
      ? el('div', { class: 'atotal' },
          el('span', {},
            el('b', {}, String(classStanding.length)),
            ' assessment' + (classStanding.length === 1 ? '' : 's') + ' · ',
            el('b', {}, String(points)), ' points'),
          el('span', {}, 'averaged equally', helpDot(
            'The points do not have to add up to any particular number. Every score is '
            + 'converted to a 50-100 value before being averaged, so three assessments at '
            + 'full marks give exactly the same class standing as five.')))
      : null,
    el('div', { class: 'addrow' },
      el('button', { class: 'btn ghost', onclick: () => addAssessment(term, kind, course) }, '＋ Add assessment'),
      classStanding.some((a) => a.kind === 'attendance')
        ? null
        : el('button', { class: 'btn ghost', onclick: () => addAssessment(term, kind, course, true) }, '＋ Add attendance'),
      el('button', {
        class: 'btn ghost',
        title: 'Add a ready-made set of assessments',
        onclick: () => applyPreset(term, kind, course),
      }, '☰ Use a preset'),
      state.assessments[other].filter((a) => a.kind !== 'exam').length
        ? el('button', {
            class: 'btn ghost',
            title: 'Copy the assessments from the ' + otherLabel + ' term into this one',
            onclick: () => copyFromTerm(other, kind),
          }, '⧉ Copy from ' + otherLabel)
        : null,
      classStanding.length
        ? el('button', {
            class: 'btn ghost',
            title: 'Keep this set of assessments to reuse in another course',
            onclick: () => saveAsPreset(kind),
          }, '★ Save as preset')
        : null)
  );
}

/**
 * Keep a term's assessments as a reusable preset.
 *
 * The whole point of presets is not retyping the same rows for a second
 * course, so the useful ones are the instructor's own, not the four built in.
 */
async function saveAsPreset(kind) {
  const items = state.assessments[kind].filter((a) => a.kind !== 'exam');
  if (!items.length) {
    toast('There are no assessments to save yet');
    return;
  }

  const course = state.courses.find((c) => c.id === state.courseId);
  const suggested = course ? course.code + ' set' : 'My set';
  const nameInput = el('input', { type: 'text', required: true, value: suggested });
  const existing = (await guard(() => api.savedPresets.list())) || [];

  const result = await modal({
    title: 'Save as preset',
    subtitle: 'Reuse this set of assessments when you set up another course.',
    body: el('div', {},
      el('div', { class: 'field' }, el('label', { text: 'Preset name' }), nameInput),
      el('div', { class: 'note' },
        'Saving ', el('b', {}, String(items.length)), ' assessment' + (items.length === 1 ? '' : 's') + ': ',
        items.map((a) => a.name + ' (' + a.max_points + ')').join(', '), '. ',
        'Names and point values only, never any scores.'),
      existing.length
        ? el('div', { class: 'hint' },
            'You already have: ' + existing.map((p) => p.name).join(', ')
            + '. Using one of those names replaces it.')
        : null),
    confirmLabel: 'Save preset',
    onConfirm: () => (nameInput.value.trim() ? nameInput.value.trim() : false),
  });
  if (!result) return;

  const saved_ = await guard(
    () => api.savedPresets.save(result, items.map((a) => ({
      name: a.name, maxPoints: a.max_points, kind: a.kind,
    }))),
    'Saving preset'
  );
  if (saved_) saved('Preset saved');
}

/**
 * Rename and delete saved presets.
 *
 * Reached from the Manage dialog, because a preset is not tied to any one
 * course and managing it from inside one would be the wrong place.
 */
async function managePresets() {
  const presets = (await guard(() => api.savedPresets.list())) || [];

  const render = (list) => el('div', { class: 'managelist' },
    ...(list.length
      ? list.map((preset) =>
          el('div', { class: 'manrow' },
            el('div', { class: 'manname' },
              el('div', { text: preset.name }),
              el('div', { class: 'mansub',
                text: preset.items.map((i) => i.name + ' (' + i.max_points + ')').join(', ') })),
            el('button', {
              class: 'btn small',
              onclick: async () => {
                const input = el('input', { type: 'text', value: preset.name, required: true });
                const next = await modal({
                  title: 'Rename preset',
                  body: el('div', { class: 'field' }, el('label', { text: 'Name' }), input),
                  confirmLabel: 'Rename',
                  onConfirm: () => (input.value.trim() ? input.value.trim() : false),
                });
                if (!next) return;
                const ok = await guard(() => api.savedPresets.rename(preset.id, next), 'Renaming preset');
                if (ok) { saved('Preset renamed'); await managePresets(); }
              },
            }, 'Rename'),
            el('button', {
              class: 'btn small danger',
              onclick: async () => {
                const ok = await confirmDialog({
                  title: 'Delete "' + preset.name + '"?',
                  subtitle: 'The preset only. No course or grade is touched.',
                  confirmLabel: 'Delete preset',
                });
                if (!ok) return;
                await guard(() => api.savedPresets.remove(preset.id), 'Deleting preset');
                saved('Preset deleted');
                await managePresets();
              },
            }, 'Delete'))
        )
      : [el('div', { class: 'manrow' },
          el('div', { class: 'manname' },
            el('div', { text: 'No saved presets yet' }),
            el('div', { class: 'mansub',
              text: 'Set up a term, then use "Save as preset" on the assessments screen.' })))]),
  );

  await modal({
    title: 'Assessment presets',
    subtitle: 'Sets you saved, to reuse when setting up a course.',
    wide: true,
    confirmLabel: 'Done',
    cancelLabel: null,
    onConfirm: () => true,
    body: el('div', {},
      render(presets),
      el('div', { class: 'hint' },
        'GradeDesk also has a few built-in sets. Both appear together under '
        + '"Use a preset" on the assessments screen.')),
  });
}

/**
 * A small question mark that explains something in place.
 *
 * Native title text rather than a custom tooltip: it works with the keyboard,
 * it is read by screen readers, and it cannot end up positioned off screen.
 * Clicking shows the same text as a toast, for touch screens and for anyone
 * who does not hover long enough for the native tooltip to appear.
 */
function helpDot(text) {
  return el('button', {
    type: 'button',
    class: 'helpdot',
    title: text,
    'aria-label': text,
    onclick: (e) => {
      e.preventDefault();
      toast(text);
    },
  }, '?');
}

/**
 * Add another assessment just like this one, directly beneath it.
 *
 * Quicker than the Add dialog for the common case of a second quiz, and it
 * keeps the new row next to its sibling rather than at the bottom of the list.
 *
 * The name is reused as-is. Two assessments called "Quiz" are perfectly legal:
 * nothing keys off the name, and the export numbers the columns anyway.
 */
async function duplicateAssessment(kind, assessment) {
  const term = state.terms[kind];
  const created = await guard(
    () => api.assessments.add(term.id, {
      name: assessment.name,
      maxPoints: assessment.max_points,
      kind: assessment.kind,
    }),
    'Duplicating assessment'
  );
  if (!created) return;

  // addAssessment puts it last. Move it to sit right under the row it copies.
  const list = state.assessments[kind].filter((a) => a.kind !== 'exam');
  const at = list.findIndex((a) => a.id === assessment.id);
  if (at > -1) {
    const order = list.map((a) => a.id);
    order.splice(at + 1, 0, created.id);
    await guard(() => api.assessments.reorder(term.id, order), 'Reordering');
  }

  await loadCourseDetail();
  await renderScreen();
  saved('Assessment added');
}

/** Move one assessment up or down, then persist the whole new order. */
async function moveAssessment(kind, assessmentId, delta) {
  const list = state.assessments[kind].filter((a) => a.kind !== 'exam');
  const from = list.findIndex((a) => a.id === assessmentId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= list.length) return;

  const reordered = [...list];
  const [moved] = reordered.splice(from, 1);
  reordered.splice(to, 0, moved);

  const term = state.terms[kind];
  await guard(() => api.assessments.reorder(term.id, reordered.map((a) => a.id)), 'Reordering');
  await loadCourseDetail();
  await renderScreen();
  saved();
}

/**
 * Copy the other term's assessments into this one.
 *
 * Names and point values only. Copying scores across terms would invent
 * results nobody entered.
 */
async function copyFromTerm(fromKind, toKind) {
  const from = state.terms[fromKind];
  const to = state.terms[toKind];
  const incoming = state.assessments[fromKind].filter((a) => a.kind !== 'exam');
  const existing = state.assessments[toKind].filter((a) => a.kind !== 'exam');
  const taken = new Set(existing.map((a) => a.name.trim().toLowerCase()));
  const willAdd = incoming.filter((a) => !taken.has(a.name.trim().toLowerCase()));

  if (!willAdd.length) {
    toast('The ' + toKind + ' term already has all of those');
    return;
  }

  const ok = await confirmDialog({
    title: 'Copy ' + willAdd.length + ' assessment' + (willAdd.length === 1 ? '' : 's')
      + ' from the ' + fromKind + ' term?',
    subtitle: willAdd.map((a) => a.name + ' (' + a.max_points + ')').join(', '),
    body: el('div', {},
      el('div', { class: 'note' },
        'Only the names and point values are copied. ',
        el('b', {}, 'No scores'), ' come across, and anything already here is left alone.'),
      existing.length
        ? el('div', { class: 'hint' },
            'The ' + toKind + ' term keeps its ' + existing.length + ' existing assessment'
            + (existing.length === 1 ? '' : 's') + '.')
        : null),
    confirmLabel: 'Copy assessments',
    danger: false,
  });
  if (!ok) return;

  const result = await guard(() => api.assessments.copyToTerm(from.id, to.id), 'Copying assessments');
  if (!result) return;
  await loadCourseDetail();
  await renderScreen();
  saved('Copied ' + result.copied + ' assessment' + (result.copied === 1 ? '' : 's'));
}

/**
 * Add a ready-made set of assessments to a term.
 *
 * Rows whose point value has no column in this course's table are skipped
 * rather than added broken, and the dialog says so before anything happens.
 */
async function applyPreset(term, kind, course) {
  const builtIn = GradeDeskPresets.listPresets();
  const maximums = await api.policies.maximums(course.policy);

  // Saved sets are the instructor's own and are far likelier to be wanted, so
  // they come first. Their values carry a "saved:" prefix, because a saved
  // preset's numeric id could otherwise collide with a built-in string id.
  const savedSets = ((await guard(() => api.savedPresets.list())) || []).map((p) => ({
    id: 'saved:' + p.id,
    label: p.name,
    summary: p.items.map((i) => i.name).join(', '),
    assessments: p.items.map((i) => ({ name: i.name, maxPoints: i.max_points, kind: i.kind })),
  }));
  const presets = [...savedSets, ...builtIn];

  const option = (p) => el('option', { value: p.id }, p.label + ': ' + p.summary);
  const picker = el('select', {},
    ...(savedSets.length
      ? [el('optgroup', { label: 'Your saved presets' }, ...savedSets.map(option)),
         el('optgroup', { label: 'Built in' }, ...builtIn.map(option))]
      : builtIn.map(option)));

  const detail = el('div', { class: 'hint' });
  const describe = () => {
    const chosen = presets.find((p) => p.id === picker.value);
    if (!chosen) return;
    const usable = chosen.assessments.filter((a) => maximums.includes(a.maxPoints));
    const skipped = chosen.assessments.length - usable.length;
    detail.textContent = usable.map((a) => a.name + ' (' + a.maxPoints + ')').join(', ')
      + (skipped ? ' — ' + skipped + ' skipped, no column in the ' + course.policy + '% table' : '');
  };
  picker.addEventListener('change', describe);
  describe();

  const chosenId = await modal({
    title: 'Add a preset to the ' + kind + ' term',
    subtitle: 'A starting set. Rename, repoint or remove any of them afterwards.',
    body: el('div', {},
      el('div', { class: 'field' }, el('label', { text: 'Preset' }), picker, detail),
      el('div', { class: 'note' },
        'Anything already in this term stays. A name that is already here is skipped, ',
        'so you will not end up with two rows called Quiz 1.')),
    confirmLabel: 'Add these',
    onConfirm: () => picker.value,
  });
  if (!chosenId) return;

  const preset = presets.find((p) => p.id === chosenId);
  if (!preset) return;

  const existing = state.assessments[kind].filter((a) => a.kind !== 'exam');
  // Only what is ALREADY in the term is a collision. Names are not added to
  // this set as the preset is applied: a preset holding two rows called "Quiz"
  // means two quizzes, and collapsing them silently dropped one.
  const taken = new Set(existing.map((a) => a.name.trim().toLowerCase()));
  let hasAttendance = existing.some((a) => a.kind === 'attendance');

  let added = 0;
  for (const a of preset.assessments) {
    if (taken.has(a.name.trim().toLowerCase())) continue;
    if (!maximums.includes(a.maxPoints)) continue;
    // Attendance is the one thing a term can hold only once: two rows would
    // both read the same register and count it twice in the average.
    if (a.kind === 'attendance') {
      if (hasAttendance) continue;
      hasAttendance = true;
    }
    const ok = await guard(() => api.assessments.add(term.id, a), 'Adding assessment');
    if (ok) added += 1;
  }

  await loadCourseDetail();
  await renderScreen();
  saved(added ? 'Added ' + added + ' assessment' + (added === 1 ? '' : 's') : 'Nothing to add');
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
      ? 'Its score works itself out from the attendance you mark, then counts like any other assessment.'
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
      : 'You have not entered any scores for this yet.',
    body: el('div', { class: 'note warn' },
      'Class standing is an average, so taking one away changes everyone’s grade for this term.'),
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
    subtitle: 'Every grade in the course is worked out again with the new tables.',
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
      el('div', { class: 'hint' }, 'You can switch back whenever you like. Nothing is lost.')),
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
    : el('div', { class: 'note' }, 'Nothing to fix. Every student has a grade.');

  modal({
    title: 'Review issues',
    subtitle: issues.length
      ? `${issues.length} thing${issues.length === 1 ? '' : 's'} to check before exporting.`
      : 'We looked at every student in this course.',
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

async function exportAttendanceFile() {
  const file = await guard(() => api.exports.attendance(state.courseId), 'Export');
  if (file) toast('Attendance exported');
}


// ---------------------------------------------------------------- guide

/**
 * The guide, rendered as a full screen rather than a dialog.
 *
 * It reads like a page: a contents list that sticks to the side, headings you
 * can scroll through, and enough width for the text to breathe. A cramped
 * modal was the wrong shape for something you read rather than answer.
 */
function renderGuideScreen(content) {
  const sections = window.GradeDeskGuide.GUIDE_SECTIONS;

  const article = el('article', { class: 'guidedoc' });
  const toc = el('nav', { class: 'guidetoc', 'aria-label': 'Guide contents' },
    el('div', { class: 'tochead', text: 'On this page' }),
    ...sections.map((s) =>
      el('button', {
        type: 'button',
        class: 'tocitem',
        dataset: { target: s.id },
        onclick: () => {
          const target = document.getElementById(`guide-${s.id}`);
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
      }, s.title))
  );

  const block = (b) => {
    if (b.type === 'text') return el('p', { class: 'gp', text: b.text });
    if (b.type === 'tip') {
      return el('div', { class: 'gcallout tip' },
        el('span', { class: 'gclabel', text: 'Worth knowing' }),
        el('span', { text: b.text }));
    }
    if (b.type === 'warn') {
      return el('div', { class: 'gcallout warn' },
        el('span', { class: 'gclabel', text: 'Careful' }),
        el('span', { text: b.text }));
    }
    if (b.type === 'steps') {
      return el('div', { class: 'gblock' },
        b.title ? el('h4', { class: 'gsub', text: b.title }) : null,
        el('div', { class: 'glist' },
          ...b.items.map(([k, v]) =>
            el('div', { class: 'glistrow' },
              el('span', { class: 'gk', text: k }),
              el('span', { class: 'gv', text: v })))));
    }
    if (b.type === 'keys') {
      return el('div', { class: 'gblock' },
        b.title ? el('h4', { class: 'gsub', text: b.title }) : null,
        el('div', { class: 'gkeys' },
          ...b.items.map(([k, v]) =>
            el('div', { class: 'gkeyrow' },
              el('kbd', { class: 'gkbd', text: k }),
              el('span', { class: 'gv', text: v })))));
    }
    if (b.type === 'formula') {
      return el('div', { class: 'gblock' },
        b.title ? el('h4', { class: 'gsub', text: b.title }) : null,
        el('div', { class: 'gformula' },
          ...b.rows.map(([k, v]) =>
            el('div', { class: 'gformularow' },
              el('span', { class: 'gfname', text: k }),
              el('span', { class: 'gfbody', text: v })))));
    }
    if (b.type === 'example') {
      return el('div', { class: 'gblock' },
        b.title ? el('h4', { class: 'gsub', text: b.title }) : null,
        el('pre', { class: 'gexample', text: b.lines.join('\n') }));
    }
    return null;
  };

  for (const s of sections) {
    article.append(
      el('section', { class: 'gsection', id: `guide-${s.id}` },
        el('h3', { class: 'gtitle', text: s.title }),
        s.lead ? el('p', { class: 'glead', text: s.lead }) : null,
        ...s.blocks.map(block).filter(Boolean))
    );
  }

  article.append(
    el('section', { class: 'gsection' },
      el('h3', { class: 'gtitle', text: 'Run the setup wizard again' }),
      el('p', { class: 'glead', text:
        'It sets up a semester, a course, its assessments and a class list with you.' }),
      el('button', { class: 'btn primary', onclick: () => runSetupWizard() }, 'Start setup'))
  );

  const scroller = el('div', { class: 'guidescroll' }, article);

  // Highlight the section you are reading as you scroll.
  const markCurrent = () => {
    const top = scroller.getBoundingClientRect().top;
    let current = sections[0] && sections[0].id;
    for (const s of sections) {
      const node = document.getElementById(`guide-${s.id}`);
      if (node && node.getBoundingClientRect().top - top <= 90) current = s.id;
    }
    toc.querySelectorAll('.tocitem').forEach((b) => {
      b.classList.toggle('active', b.dataset.target === current);
    });
  };
  scroller.addEventListener('scroll', markCurrent);

  setChildren(content, el('div', { class: 'guidepage' }, toc, scroller));
  markCurrent();
}

/** Open the guide as a screen. */
function openGuide() {
  state.screen = 'guide';
  renderRail();
  return renderScreen();
}

// ------------------------------------------------------- first-run wizard

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
    subtitle: 'Four quick steps and you can start marking.',
    body: el('div', {},
      el('div', { class: 'wizhero' },
        el('div', { class: 'wizmark', text: '✓' }),
        el('div', {},
          el('p', { class: 'guidep' },
            'GradeDesk turns your marks into the WVSTU grade record. You type the scores ' +
            'across your class list, and it does the lookups, the averages and the ' +
            'letter grades, then gives you the sheet to hand in.'),
          el('p', { class: 'guidep' },
            'It all stays on this computer and saves as you type. You do not need ' +
            'an internet connection at any point.'))),
      el('div', { class: 'guidesteps' },
        el('div', { class: 'guidestep' }, el('b', { text: '1. Semester' }),
          el('span', { text: 'Name the term you are teaching.' })),
        el('div', { class: 'guidestep' }, el('b', { text: '2. Course' }),
          el('span', { text: 'Code, section and which table you use.' })),
        el('div', { class: 'guidestep' }, el('b', { text: '3. Assessments' }),
          el('span', { text: 'Quizzes, assignments, attendance.' })),
        el('div', { class: 'guidestep' }, el('b', { text: '4. Class list' }),
          el('span', { text: 'Type or paste your students.' })))),
    confirmLabel: 'Get started',
    cancelLabel: 'Skip for now',
    onConfirm: () => true,
  });
  if (!intro) {
    return;
  }

  // ---- step 1: semester ----
  let semester = state.activeSemester;
  if (!semester) {
    const created = await newSemester();
    if (!created) return;
    semester = state.activeSemester;
  } else {
    const rename = el('input', { type: 'text', value: semester.name });
    const ok = await modal({
      title: 'Step 1 of 4 · Semester',
      subtitle: 'Which term are you teaching? You can change this later.',
      body: el('div', { class: 'field' }, el('label', { text: 'Semester name' }), rename),
      confirmLabel: 'Next',
      cancelLabel: 'Skip setup',
      onConfirm: () => rename.value.trim() || false,
    });
    if (!ok) return;
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
        'Most WVSTU courses use the 70% table. It applies to the whole course.')),
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
  if (!courseFields) return;

  const course = await guard(
    () => api.courses.create({ semesterId: semester.id, ...courseFields }), 'Creating course');
  if (!course) return;
  await loadCourses();
  state.courseId = course.id;
  await loadCourseDetail();

  // ---- step 3: assessments ----
  // The same list the assessments screen offers, so the two cannot drift.
  const preset = el('select', {},
    ...GradeDeskPresets.listPresets().map((p, i) =>
      el('option', { value: p.id, selected: i === 0 }, p.label + ': ' + p.summary)),
    el('option', { value: 'none' }, 'None, I will add my own'));

  const chosen = await modal({
    title: 'Step 3 of 4 · Assessments',
    subtitle: 'A set to start you off, in both terms. Change any of them afterwards.',
    body: el('div', {},
      el('div', { class: 'field' }, el('label', { text: 'Start with' }), preset),
      el('div', { class: 'note' },
        'Each term already has its exam, fixed at 40 points. The rest are averaged ',
        'together equally, so adding or removing one never means redoing weights.')),
    confirmLabel: 'Next',
    cancelLabel: 'Skip setup',
    onConfirm: () => preset.value,
  });
  if (!chosen) return;

  if (chosen !== 'none') {
    const terms = await api.courses.terms(course.id);
    const picked = GradeDeskPresets.getPreset(chosen);
    if (picked) {
      for (const kind of ['midterm', 'final']) {
        for (const a of picked.assessments) {
          await guard(() => api.assessments.add(terms.byKind[kind].id, a), 'Adding assessment');
        }
      }
    }
    await loadCourseDetail();
  }

  // ---- step 4: roster ----
  const paste = el('textarea', {
    rows: '8',
    class: 'paste-area',
    placeholder: '10001\tBestman, Comfort K.\n10002\tBestman, Daniel T.',
  });
  const rosterText = await modal({
    title: 'Step 4 of 4 · Class list',
    subtitle: 'Paste your students now, or skip this and type them in later.',
    body: el('div', {},
      paste,
      el('div', { class: 'hint' },
        'One student per line, with a tab between the ID and the name. ' +
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
        'Pick an assessment from the list at the top and type scores down the column. ' +
        'Press Enter to move to the next student.'),
      el('p', { class: 'guidep' },
        'The guide is always there under the Guide button at the bottom of the ' +
        'left panel.')),
    confirmLabel: 'Start entering scores',
    cancelLabel: null,
    onConfirm: () => true,
  });
}

// -------------------------------------------------------------------- start

loadAll().then(async () => {
  // Offer setup whenever there is no course to work on.
  //
  // This used to also require a localStorage flag that was set the first time
  // the wizard appeared and never cleared. That flag drifts from the database:
  // clear the data, restore a backup made before any course existed, or move
  // the database to another machine, and you land on an empty app with no way
  // back to setup. Whether a course exists is the real question, and the
  // database already answers it, so ask that instead.
  if (state.courses.length === 0) {
    await runSetupWizard();
  }
});
