'use strict';
/**
 * Transmutation lookup — the single place snap-down matching lives.
 *
 * A raw score becomes a 50–100 transmuted value via a university lookup table,
 * selected by the course policy (50/60/70) and the assessment's point maximum.
 *
 * Matching is APPROXIMATE / SNAP-DOWN, identical to Excel VLOOKUP(..., TRUE):
 * a raw score not listed takes the value of the nearest LOWER listed score.
 * Never exact-match. Getting this wrong drifts grades by a point silently.
 *
 * A blank raw score transmutes to 50 (the value at raw 0) and still counts.
 *
 * This module is pure: no UI, no filesystem, no globals. Tables are injected.
 */

const POLICIES = ['50', '60', '70'];

/** Value a blank score transmutes to. Also the table value at raw 0. */
const BLANK_TRANSMUTED = 50;

/**
 * A raw score is "blank" when it is null, undefined, or an empty/whitespace
 * string. Zero is NOT blank — a real 0 is a scored zero, and both happen to
 * transmute to 50, but they differ for the exam (a blank exam forces "I").
 */
function isBlank(raw) {
  if (raw === null || raw === undefined) return true;
  if (typeof raw === 'string' && raw.trim() === '') return true;
  return false;
}

/** Coerce a raw score to a finite number, or null if it isn't one. */
function toNumber(raw) {
  if (isBlank(raw)) return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  return Number.isFinite(n) ? n : null;
}

class TransmutationTables {
  /**
   * @param {object} json Parsed transmutation_tables.json
   */
  constructor(json) {
    if (!json || typeof json !== 'object' || !json.policies) {
      throw new Error('TransmutationTables: expected parsed transmutation_tables.json with a "policies" key');
    }
    this._verification = json._verification || null;
    // Normalise to: policy -> maxPoints -> sorted array of [score, value]
    this._tables = new Map();
    for (const [policy, columns] of Object.entries(json.policies)) {
      const byMax = new Map();
      for (const [maxPoints, column] of Object.entries(columns)) {
        const pairs = Object.entries(column)
          .map(([score, value]) => [Number(score), Number(value)])
          .filter(([s, v]) => Number.isFinite(s) && Number.isFinite(v))
          .sort((a, b) => a[0] - b[0]);
        if (pairs.length) byMax.set(Number(maxPoints), pairs);
      }
      this._tables.set(String(policy), byMax);
    }
  }

  /** Policies present in the data, e.g. ['50','60','70']. */
  policies() {
    return [...this._tables.keys()].sort((a, b) => Number(a) - Number(b));
  }

  /** Point maximums the given policy actually has a column for, ascending. */
  supportedMaximums(policy) {
    const byMax = this._tables.get(String(policy));
    if (!byMax) return [];
    return [...byMax.keys()].sort((a, b) => a - b);
  }

  /** True if this policy has a column for this point maximum. */
  supports(policy, maxPoints) {
    const byMax = this._tables.get(String(policy));
    return !!(byMax && byMax.has(Number(maxPoints)));
  }

  /** The raw [score, value] pairs for one column, ascending. For tests/export. */
  column(policy, maxPoints) {
    const byMax = this._tables.get(String(policy));
    if (!byMax) throw new Error(`Unknown transmutation policy: ${policy}`);
    const col = byMax.get(Number(maxPoints));
    if (!col) {
      throw new Error(
        `Policy ${policy}% has no ${maxPoints}-point column. Supported: ${this.supportedMaximums(policy).join(', ')}`
      );
    }
    return col.map(([s, v]) => [s, v]);
  }

  /**
   * Transmute one raw score. THE core operation.
   *
   * - blank            -> 50
   * - below the lowest listed score (negative) -> 50, the floor
   * - not listed exactly -> value of the nearest LOWER listed score (snap-down)
   * - above the highest listed score -> value of the highest listed score
   *
   * @param {number|string|null|undefined} raw
   * @param {number} maxPoints  the assessment's point maximum (selects the column)
   * @param {string|number} policy  '50' | '60' | '70'
   * @returns {number} transmuted value
   */
  transmute(raw, maxPoints, policy) {
    if (isBlank(raw)) return BLANK_TRANSMUTED;
    const n = toNumber(raw);
    if (n === null) return BLANK_TRANSMUTED; // unparseable behaves as blank
    const col = this.column(policy, maxPoints);

    // Snap-down: last entry whose score is <= n. Binary search over ascending scores.
    let lo = 0;
    let hi = col.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (col[mid][0] <= n) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    // Below the first listed score (only possible for a negative raw): floor at the
    // table's lowest value, which is the raw-0 entry.
    if (best === -1) return col[0][1];
    return col[best][1];
  }
}

module.exports = {
  TransmutationTables,
  POLICIES,
  BLANK_TRANSMUTED,
  isBlank,
  toNumber,
};
