'use strict';
/**
 * Preload bridge.
 *
 * Exposes a fixed, named API to the renderer. No general "invoke any channel"
 * escape hatch, so the window can only do the things listed here.
 *
 * Every call returns the value directly and throws on failure, so the renderer
 * can use ordinary try/catch instead of checking a result envelope.
 */

const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

contextBridge.exposeInMainWorld('gradedesk', {
  policies: {
    list: () => call('policies:list'),
    maximums: (policy) => call('policies:maximums', policy),
    validateMax: (maxPoints, policy) => call('policies:validateMax', maxPoints, policy),
    stranded: (assessments, newPolicy) => call('policies:stranded', assessments, newPolicy),
  },
  semesters: {
    list: () => call('semesters:list'),
    active: () => call('semesters:active'),
    create: (name) => call('semesters:create', name),
    activate: (id) => call('semesters:activate', id),
    rename: (id, name) => call('semesters:rename', id, name),
  },
  courses: {
    list: (semesterId) => call('courses:list', semesterId),
    get: (id) => call('courses:get', id),
    create: (payload) => call('courses:create', payload),
    update: (id, fields) => call('courses:update', id, fields),
    remove: (id) => call('courses:delete', id),
    terms: (courseId) => call('courses:terms', courseId),
    duplicate: (id, overrides) => call('courses:duplicate', id, overrides),
  },
  students: {
    list: (courseId) => call('students:list', courseId),
    add: (courseId, row) => call('students:add', courseId, row),
    addMany: (courseId, rows) => call('students:addMany', courseId, rows),
    parsePaste: (text) => call('students:parsePaste', text),
    update: (id, fields) => call('students:update', id, fields),
    remove: (id) => call('students:delete', id),
  },
  assessments: {
    list: (termId) => call('assessments:list', termId),
    add: (termId, payload) => call('assessments:add', termId, payload),
    update: (id, fields) => call('assessments:update', id, fields),
    remove: (id) => call('assessments:delete', id),
    countScores: (id) => call('assessments:countScores', id),
    reorder: (termId, orderedIds) => call('assessments:reorder', termId, orderedIds),
    copyToTerm: (fromTermId, toTermId) => call('assessments:copyToTerm', fromTermId, toTermId),
  },
  // The instructor's own saved sets. The built-in ones are a separate list,
  // reached in the renderer as GradeDeskPresets, so these are named apart.
  savedPresets: {
    list: () => call('savedPresets:list'),
    save: (name, items) => call('savedPresets:save', name, items),
    rename: (id, name) => call('savedPresets:rename', id, name),
    remove: (id) => call('savedPresets:delete', id),
  },
  scores: {
    set: (studentId, assessmentId, rawValue) => call('scores:set', studentId, assessmentId, rawValue),
    setMany: (entries) => call('scores:setMany', entries),
  },
  attendance: {
    sessions: (termId) => call('sessions:list', termId),
    addSession: (courseId, termId, date) => call('sessions:add', courseId, termId, date),
    removeSession: (id) => call('sessions:delete', id),
    countMarks: (id) => call('sessions:countMarks', id),
    setMark: (studentId, sessionId, code) => call('marks:set', studentId, sessionId, code),
    forTerm: (termId) => call('marks:forTerm', termId),
  },
  gradebook: {
    compute: (courseId) => call('gradebook:compute', courseId),
    issues: (courseId) => call('gradebook:issues', courseId),
  },
  exports: {
    gradeRecord: (courseId) => call('export:gradeRecord', courseId),
    summary: (courseId) => call('export:summary', courseId),
    attendance: (courseId) => call('export:attendance', courseId),
  },
  backup: {
    save: () => call('backup:export'),
    restore: () => call('backup:import'),
  },
  app: {
    revealData: () => call('app:revealData'),
    dataPath: () => call('app:dataPath'),
    defaultPolicy: () => call('app:defaultPolicy'),
  },
});
