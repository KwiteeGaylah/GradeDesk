'use strict';
/**
 * Policy availability and assessment-maximum validation.
 *
 * Which transmutation policies the UI may offer, and at what confidence.
 * All three policies are usable. They differ in how strongly their lookup data
 * has been proven, which the UI surfaces rather than hides.
 *
 * Current state of the shipped tables (see `_verification` in the JSON):
 *   70%  GRADE_VERIFIED — extracted from the instructor's live workbook and
 *                         proven to reproduce all 167 real student grades with
 *                         zero mismatches. This is the standing release gate.
 *   50%  STRUCTURAL     — transcribed from the source PDF; every column starts
 *   60%  STRUCTURAL       at 50, reaches 100 at its maximum, and rises
 *                         monotonically. Not grade-verified, because the real
 *                         dataset uses only the 70% policy.
 *
 * "Structurally verified" is a real bar, not a shrug: the checks that caught the
 * original mis-transcription (a perfect score not reaching 100, a non-monotonic
 * dip) run over every column in the test suite.
 */

const CONFIDENCE = {
  /** Proven against real student grades. */
  GRADE_VERIFIED: 'grade-verified',
  /** Transcribed from the source and structurally sound; no real-grade fixture. */
  STRUCTURAL: 'structurally-verified',
};

const STRUCTURAL_NOTE =
  'Copied from the university tables and checked over: every column climbs steadily from ' +
  '50 to 100. It has not been tried against a finished grade sheet yet, because the one ' +
  'we checked against used the 70% table throughout.';

/**
 * Per-policy status. `selectable` drives whether the UI offers it at all.
 */
const POLICY_STATUS = {
  70: {
    policy: '70',
    label: '70%',
    confidence: CONFIDENCE.GRADE_VERIFIED,
    selectable: true,
    isDefault: true,
    // User-facing wording stays general: the person reading it is the
    // instructor, so "the instructor's workbook" reads as someone else's.
    note: 'Checked against 167 real student grades across 6 sections. Every one matched.',
  },
  60: {
    policy: '60',
    label: '60%',
    confidence: CONFIDENCE.STRUCTURAL,
    selectable: true,
    isDefault: false,
    note: STRUCTURAL_NOTE,
  },
  50: {
    policy: '50',
    label: '50%',
    confidence: CONFIDENCE.STRUCTURAL,
    selectable: true,
    isDefault: false,
    note: STRUCTURAL_NOTE,
  },
};

/** Policy offered when a course does not specify one. */
const DEFAULT_POLICY = '70';

/** Every policy present in the data, with its status. */
function allPolicies(tables) {
  return tables.policies().map((p) => ({
    ...(POLICY_STATUS[p] || {
      // An unknown policy appearing in the data has no provenance, so it is
      // listed but never offered until someone vouches for it here.
      policy: String(p),
      label: `${p}%`,
      confidence: null,
      selectable: false,
      isDefault: false,
      note: 'Unrecognised policy; not offered.',
    }),
    supportedMaximums: tables.supportedMaximums(p),
  }));
}

/** Only the policies the UI may offer. */
function selectablePolicies(tables) {
  return allPolicies(tables).filter((p) => p.selectable);
}

/** Status for one policy. */
function policyStatus(policy) {
  return POLICY_STATUS[String(policy)] || null;
}

/** True when a course may use this policy. */
function isSelectable(policy) {
  const s = policyStatus(policy);
  return !!(s && s.selectable);
}

/**
 * Validate an assessment's point maximum against the active policy.
 *
 * Returns a result rather than throwing: the spec wants the app to warn on an
 * obvious mismatch while still letting an instructor proceed deliberately.
 *
 * @returns {{ok:boolean, level:'ok'|'error', message:string|null, supported:number[]}}
 */
function validateMaxPoints(maxPoints, policy, tables) {
  const supported = tables.supportedMaximums(policy);
  const n = Number(maxPoints);
  if (!Number.isFinite(n) || n <= 0) {
    return {
      ok: false,
      level: 'error',
      message: 'The point value has to be a number above zero.',
      supported,
    };
  }
  if (!tables.supports(policy, n)) {
    return {
      ok: false,
      level: 'error',
      message:
        `The ${policy}% table has no column for ${n} points, so a score out of ${n} ` +
        `cannot be looked up. You can use: ${supported.join(', ')}.`,
      supported,
    };
  }
  return { ok: true, level: 'ok', message: null, supported };
}

/**
 * Which of a course's assessments would be stranded by a policy change.
 * Used to warn before switching, e.g. a 20-point task moving to the 70% table.
 *
 * @param {Array<{id?:*, name:string, maxPoints:number}>} assessments
 * @returns {Array<{name:string, maxPoints:number}>} the stranded ones
 */
function strandedByPolicy(assessments, newPolicy, tables) {
  return (assessments || [])
    .filter((a) => !tables.supports(newPolicy, a.maxPoints))
    .map((a) => ({ name: a.name, maxPoints: a.maxPoints }));
}

module.exports = {
  CONFIDENCE,
  DEFAULT_POLICY,
  POLICY_STATUS,
  allPolicies,
  selectablePolicies,
  policyStatus,
  isSelectable,
  validateMaxPoints,
  strandedByPolicy,
};
