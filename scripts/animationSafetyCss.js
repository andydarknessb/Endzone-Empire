'use strict';

/**
 * #542 CSS scanner. Detecting keyframes and hidden end states is lexical (the
 * shared core in animationSafetyGuard.js does it). But the EXEMPTION question -
 * "does a reduced-motion alternative cover THIS animated surface?" - is
 * structural: it asks whether a rule inside a `@media (prefers-reduced-motion:
 * reduce)` block neutralizes the SAME selector the animation is declared on.
 * Cory's ruling on #542 is explicit that a file-level "does this file contain
 * any reduce block anywhere" test is too loose (it passes almost every file);
 * the alternative must cover the affected declaration or surface. Correlating a
 * selector to a reduce block is a question about the shape of the stylesheet, so
 * this uses postcss (already a transitive dependency, declared direct for #542)
 * rather than guessing with a regex.
 *
 * RESOLUTION BOUNDARY (declared, and pinned by tests): an animation is
 * correlated to keyframes defined by `@keyframes` in the SAME stylesheet. An
 * animation whose name is defined in another file (e.g. a name defined in a
 * .css file and used from an sx object in a .jsx file) is UNRESOLVED and is not
 * flagged - a declared false-negative boundary, counted in `unresolvedCount` so
 * it is visible rather than silent.
 *
 * SELECTOR CORRELATION BOUNDARY (declared): the reduce-block exemption requires
 * the neutralizing rule to carry the SAME normalized selector string as the
 * animated rule (whitespace-normalized; comma lists split and intersected). A
 * reduce block that neutralizes an equivalent-but-differently-written selector
 * (`.a.b` vs `.b.a`) would NOT be recognized and the animation would be flagged
 * - a false positive, which is the safe direction under #542's asymmetry
 * (fail loud, with the allowlist as the maintainer's escape hatch) rather than
 * a silent pass.
 */

const postcss = require('postcss');
const { finalKeyframeHiddenReason } = require('./animationSafetyGuard');

const REDUCE_MEDIA = /prefers-reduced-motion\s*:\s*reduce/i;
const FORWARDS_FILL = /\b(forwards|both)\b/i;
const { HIDDEN_OPACITY } = require('./animationSafetyGuard');

function normalizeSelector(sel) {
  return sel.replace(/\s+/g, ' ').trim();
}

// The individual comma-separated selectors of a rule, each normalized.
function selectorList(rule) {
  return rule.selector.split(',').map(normalizeSelector).filter(Boolean);
}

function stripImportant(value) {
  return value.replace(/!important\s*$/i, '').trim();
}

// Reconstruct a keyframes body ("0% { ... } 100% { ... }") from a postcss
// @keyframes at-rule so the shared lexical core makes the hidden-end decision -
// one source of truth for "hidden", shared with the JS side.
function keyframesBody(atRule) {
  const parts = [];
  atRule.each((node) => {
    if (node.type !== 'rule') return;
    const decls = [];
    node.each((d) => {
      if (d.type === 'decl') decls.push(`${d.prop}: ${d.value}`);
    });
    parts.push(`${node.selector} { ${decls.join('; ')} }`);
  });
  return parts.join('\n');
}

// Does this rule declare a forwards (or both) fill, and which keyframes names
// does it reference? Reads both the `animation` shorthand and the longhand
// `animation-name` / `animation-fill-mode`.
function animationInfo(rule) {
  let forwards = false;
  const nameValues = [];
  rule.each((node) => {
    if (node.type !== 'decl') return;
    const prop = node.prop.toLowerCase();
    const value = stripImportant(node.value);
    if (prop === 'animation') {
      if (FORWARDS_FILL.test(value)) forwards = true;
      nameValues.push(value);
    } else if (prop === 'animation-name') {
      nameValues.push(value);
    } else if (prop === 'animation-fill-mode') {
      if (FORWARDS_FILL.test(value)) forwards = true;
    }
  });
  return { forwards, nameValues };
}

// Does this rule (inside a reduce media block) neutralize the animation or
// restore the hidden property? Any of: animation / animation-name reset to
// none, a non-forwards fill mode, or the hidden property restored to a visible
// value. This is what makes a reduce block a MEANINGFUL alternative for the
// surface rather than incidental.
function neutralizesAnimation(rule) {
  let neutralizes = false;
  rule.each((node) => {
    if (node.type !== 'decl') return;
    const prop = node.prop.toLowerCase();
    const value = stripImportant(node.value).toLowerCase();
    if ((prop === 'animation' || prop === 'animation-name') && value === 'none') neutralizes = true;
    if (prop === 'animation-fill-mode' && !FORWARDS_FILL.test(value)) neutralizes = true;
    if (prop === 'opacity' && !HIDDEN_OPACITY.test(value)) neutralizes = true;
    if (prop === 'visibility' && value === 'visible') neutralizes = true;
    if (prop === 'display' && value !== 'none') neutralizes = true;
  });
  return neutralizes;
}

function isInsideKeyframes(rule) {
  const parent = rule.parent;
  return parent && parent.type === 'atrule' && /^(-\w+-)?keyframes$/i.test(parent.name);
}

function isInsideReduceMedia(rule) {
  let node = rule.parent;
  while (node) {
    if (node.type === 'atrule' && node.name.toLowerCase() === 'media' && REDUCE_MEDIA.test(node.params)) {
      return true;
    }
    node = node.parent;
  }
  return false;
}

/**
 * Scan one stylesheet's source text. Returns:
 *   { violations, keyframesCount, forwardsUsageCount, unresolvedCount }
 * where each violation is { selector, animationName, reason, line }.
 */
function scanCss(source) {
  const root = postcss.parse(source);

  // 1. Hidden-ending keyframes defined in THIS file, by name.
  const hiddenKeyframes = new Map(); // name -> reason
  const allKeyframeNames = new Set();
  root.walkAtRules((atRule) => {
    if (!/^(-\w+-)?keyframes$/i.test(atRule.name)) return;
    const name = normalizeSelector(atRule.params);
    allKeyframeNames.add(name);
    const { hidden, reason } = finalKeyframeHiddenReason(keyframesBody(atRule));
    if (hidden) hiddenKeyframes.set(name, reason);
  });

  // 2. Selectors neutralized under a reduce media block.
  const neutralizedSelectors = new Set();
  root.walkRules((rule) => {
    if (isInsideKeyframes(rule)) return;
    if (!isInsideReduceMedia(rule)) return;
    if (neutralizesAnimation(rule)) {
      for (const sel of selectorList(rule)) neutralizedSelectors.add(sel);
    }
  });

  // 3. Forwards-filled animation usages outside keyframes and outside reduce
  //    blocks (a usage inside a reduce block is the alternative itself).
  const violations = [];
  let forwardsUsageCount = 0;
  let unresolvedCount = 0;
  root.walkRules((rule) => {
    if (isInsideKeyframes(rule)) return;
    if (isInsideReduceMedia(rule)) return;
    const { forwards, nameValues } = animationInfo(rule);
    if (!forwards) return;

    for (const name of allKeyframeNames) {
      const referenced = nameValues.some((v) => new RegExp(`\\b${escapeRegExp(name)}\\b`).test(v));
      if (!referenced) continue;
      forwardsUsageCount += 1;
      if (!hiddenKeyframes.has(name)) continue;
      const exempt = selectorList(rule).some((sel) => neutralizedSelectors.has(sel));
      if (exempt) continue;
      violations.push({
        selector: normalizeSelector(rule.selector),
        animationName: name,
        reason: hiddenKeyframes.get(name),
        line: rule.source && rule.source.start ? rule.source.start.line : null,
      });
    }

    // A forwards animation naming something NOT defined in this file is
    // unresolved (declared boundary), counted but not flagged.
    const referencesKnown = [...allKeyframeNames].some((name) =>
      nameValues.some((v) => new RegExp(`\\b${escapeRegExp(name)}\\b`).test(v))
    );
    if (!referencesKnown && nameValues.some((v) => v && v.toLowerCase() !== 'none')) {
      unresolvedCount += 1;
    }
  });

  return {
    violations,
    keyframesCount: allKeyframeNames.size,
    forwardsUsageCount,
    unresolvedCount,
  };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { scanCss };
