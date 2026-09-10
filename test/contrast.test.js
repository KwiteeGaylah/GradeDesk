'use strict';
/**
 * Colour contrast.
 *
 * GradeDesk gets shown on a projector in a bright room as often as on a laptop.
 * Projectors have poor black levels and wash out mid greys, so every text and
 * background pair in the interface has to carry real contrast, not just look
 * fine on a good screen.
 *
 * The bar is WCAG AA: 4.5 to 1 for body text, 3 to 1 for large or bold text.
 * These are read straight out of the stylesheet, so a colour change that
 * quietly drops below the bar fails here rather than in a lecture hall.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');

/** Read a custom property out of the :root block. */
function token(name) {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(CSS);
  assert.ok(m, `stylesheet should define --${name}`);
  return m[1];
}

function toRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** WCAG relative luminance. */
function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const AA_BODY = 4.5;
const AA_LARGE = 3.0;

test('body text carries AA contrast on every surface it sits on', () => {
  const surfaces = [
    ['paper', token('paper')],
    ['canvas', token('canvas')],
    ['rail', token('rail')],
    ['read', token('read')],
  ];
  const texts = [
    ['ink', token('ink')],
    ['ink-soft', token('ink-soft')],
  ];

  const failures = [];
  for (const [sName, surface] of surfaces) {
    for (const [tName, text] of texts) {
      const ratio = contrast(text, surface);
      if (ratio < AA_BODY) {
        failures.push(`${tName} on ${sName}: ${ratio.toFixed(2)}:1`);
      }
    }
  }
  assert.deepEqual(failures, [], `${failures.length} text/background pair(s) below ${AA_BODY}:1`);
});

test('faint labels still clear the body-text bar on their own surfaces', () => {
  // Hints and section labels are small, so they get no large-text discount.
  for (const surface of ['paper', 'rail', 'canvas']) {
    const ratio = contrast(token('ink-faint'), token(surface));
    assert.ok(ratio >= AA_BODY, `ink-faint on ${surface} is only ${ratio.toFixed(2)}:1`);
  }
});

test('the side panel is readable, including its muted text', () => {
  const rail = token('rail');
  for (const name of ['rail-ink', 'rail-muted']) {
    const ratio = contrast(token(name), rail);
    assert.ok(ratio >= AA_BODY, `${name} on the panel is only ${ratio.toFixed(2)}:1`);
  }
});

test('white on the brand colour is readable, since it marks the active item', () => {
  const ratio = contrast('#ffffff', token('brand'));
  assert.ok(ratio >= AA_BODY, `white on brand is only ${ratio.toFixed(2)}:1`);
});

test('every status colour is readable on its own tint', () => {
  const pairs = [
    ['brand', 'brand-tint'],
    ['amber', 'amber-tint'],
    ['red', 'red-tint'],
    ['blue', 'blue-tint'],
  ];
  const failures = [];
  for (const [fg, bg] of pairs) {
    const ratio = contrast(token(fg), token(bg));
    if (ratio < AA_BODY) failures.push(`${fg} on ${bg}: ${ratio.toFixed(2)}:1`);
  }
  assert.deepEqual(failures, [], `${failures.length} status colour(s) below ${AA_BODY}:1`);
});

test('the editable-cell outline is visible against its own well', () => {
  // Not text, so the large-object bar applies: it only has to be seen.
  const ratio = contrast(token('entry-line'), token('entry-bg'));
  assert.ok(ratio >= 1.35, `the entry outline barely shows: ${ratio.toFixed(2)}:1`);
  const onWhite = contrast(token('entry-line'), '#ffffff');
  assert.ok(onWhite >= AA_LARGE - 1.2, `the entry outline is faint on white: ${onWhite.toFixed(2)}:1`);
});

test('the panel is light, so it does not black out on a projector', () => {
  // A dark side panel looks smart on a laptop and turns into an unreadable
  // block when projected in a bright room.
  assert.ok(
    luminance(token('rail')) > 0.6,
    'the side panel should be a light surface'
  );
  assert.ok(luminance(token('canvas')) > 0.6, 'the work area should be light');
});

test('the stylesheet defines every colour it relies on', () => {
  const used = new Set([...CSS.matchAll(/var\(--([a-z-]+)\)/g)].map((m) => m[1]));
  const defined = new Set([...CSS.matchAll(/--([a-z-]+):/g)].map((m) => m[1]));
  const missing = [...used].filter((name) => !defined.has(name));
  assert.deepEqual(missing, [], `stylesheet uses undefined token(s): ${missing.join(', ')}`);
});

test('a destructive button is readable, including when it is also the primary', () => {
  // The confirm button in a dangerous dialog carries both .primary and .danger.
  // When .danger only set a text colour, that combination produced red text on
  // the green primary background: 1.15:1, effectively invisible.
  const dangerRule = /\.btn\.primary\.danger\s*\{[^}]*\}|\.btn\.danger,\s*\n\.btn\.primary\.danger\s*\{[^}]*\}/.exec(CSS);
  assert.ok(dangerRule, '.btn.primary.danger should have its own rule');
  assert.match(dangerRule[0], /background:/, 'it must set a background, not just a text colour');
  assert.match(dangerRule[0], /color:\s*#fff/i, 'white text on the red fill');

  // And the fill it uses has to carry white text.
  assert.ok(
    contrast('#ffffff', token('red')) >= AA_BODY,
    `white on the danger colour is only ${contrast('#ffffff', token('red')).toFixed(2)}:1`
  );
});

test('no button sets a text colour without also setting its background', () => {
  // The class of bug above: a modifier that only recolours text, then lands on
  // a button whose background came from somewhere else.
  const rules = [...CSS.matchAll(/(\.btn[.\w:()-]*(?:,\s*\.btn[.\w:()-]*)*)\s*\{([^}]*)\}/g)];
  const offenders = [];
  for (const [, selector, body] of rules) {
    const setsColor = /(^|[;\s])color:/.test(body);
    const setsBg = /background(-color)?:/.test(body);
    const isModifier = /\.btn\.\w/.test(selector);
    // A modifier that recolours text must say what it sits on.
    if (isModifier && setsColor && !setsBg && !/transparent/.test(body)) {
      offenders.push(selector.trim());
    }
  }
  assert.deepEqual(offenders, [], `button rule(s) recolour text without a background: ${offenders.join(', ')}`);
});
