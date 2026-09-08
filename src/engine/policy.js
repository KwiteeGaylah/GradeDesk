'use strict';
/**
 * Policy availability and assessment-maximum validation.
 *
 * Which transmutation policies the UI may offer, and at what confidence.
 * This is a correctness gate, not cosmetics: a policy whose lookup data has
 * not been verified must not silently produce grades an instructor submits.
 *
 * Current state of the shipped tables (see `_verification` in the JSON):
 *   70%  VERIFIED    — reproduces all 167 real student grades, zero mismatches
 *   50%  SANITY_ONLY — every column monotonic and anchored 50..100, but never
 *                      checked against real grades
 *   60%  UNVERIFIED  — the 30- and 40-point columns do not reach 100 at a
 *                      perfect raw score, so they are mis-transcribed. Must be
 *                      re-transcribed from the source PDF before being offered.
 *
 * When 60% is corrected, move it to SANITY_ONLY (or VERIFIED, with a fixture)
 * and it becomes selectable with no other code change.
 */

const CONFIDENCE = {
  VERIFIED: 'verified',
  SANITY_ONLY: 'sanity-checked',
  UNVERIFIED: 'unverified',
};

/**
 * Per-policy status. `selectable` drives whether the UI offers it at all.
 */
const POLICY_STATUS = {
  70: {
    policy: '70',
    label: '70%',
    confidence: CONFIDENCE.VERIFIED,
    selectable: true,
    isDefault: true,
    note: 'Verified against the instructor’s real workbook: 167 students, zero mismatches.',
  },
  50: {
    policy: '50',
    label: '50%',
    confidence: CONFIDENCE.SANITY_ONLY,
    selectable: true,
    isDefault: false,
    note:
      'Lookup data passes structural checks (every column rises from 50 to 100) but has ' +
      'not been verified against real grades. Spot-check a few results before submitting.',
  },
  60: {
    policy: '60',
    label: '60%',
    confidence: CONFIDENCE.UNVERIFIED,
    selectable: false,
    isDefault: false,
    note:
      'Unavailable. The 30- and 40-point columns in the shipped table are mis-transcribed ' +
      '(a perfect score does not reach 100), so this policy would produce wrong grades. ' +
      'It will be enabled once the table is re-transcribed from the university source.',
  },
};

/** Policy offered when a course does not specify one. */
const DEFAULT_POLICY = '70';

/** Every policy present in the data, with its status. */
function allPolicies(tables) {
  return tables.policies().map((p) => ({
    ...(POLICY_STATUS[p] || {
      policy: String(p),
      label: `${p}%`,
      confidence: CONFIDENCE.UNVERIFIED,
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
      message: 'Point value must be a positive number.',
      supported,
    };
  }
  if (!tables.supports(policy, n)) {
    return {
      ok: false,
      level: 'error',
      message:
        `The ${policy}% table has no ${n}-point column, so a ${n}-point score cannot be ` +
        `transmuted. Supported values: ${supported.join(', ')}.`,
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
