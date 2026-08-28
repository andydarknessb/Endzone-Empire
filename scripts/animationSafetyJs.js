'use strict';

/**
 * #542 JS/Emotion scanner. The exemption question here - "is this animation the
 * alternate branch of a prefers-reduced-motion conditional?" - is STRUCTURAL,
 * not lexical: it is about the shape of the program, not about tokens. A regex
 * answering it guesses right today and wrong after a reformat, a variable
 * extraction, or a swap from a ternary to an `if`. So this side uses
 * @babel/parser (already transitive, declared direct for #542) and reasons over
 * the AST. This is not a break from the repo's regex guards (emDashGuard,
 * check-color-literals): those solve a LEXICAL problem (is this token inside a
 * comment/string/regex), which a scanner is exactly right for. The convention
 * does not extend to a structural question.
 *
 * RESOLUTION BOUNDARY (declared, pinned by tests):
 *   - A keyframes identifier is resolved to a `const NAME = keyframes`...``
 *     tagged-template definition in the SAME file. An IMPORTED keyframes object,
 *     or a keyframes template with an interpolated body, is UNRESOLVED and not
 *     flagged (a declared false negative, counted in unresolvedCount so it is
 *     visible, never silent). Same for an `animation` value that names keyframes
 *     as a plain string (e.g. a name defined in a .css file): unresolved.
 *   - The `animation` SHORTHAND carries the fill mode. A fill mode split into a
 *     separate `animationFillMode` longhand property is not correlated in v1
 *     (declared limit); the real defect and every mutation use the shorthand.
 *
 * EXEMPTION (what counts as a meaningful reduced-motion alternative for THIS
 * declaration, per Cory's ruling - never a mere unrelated media query elsewhere
 * in the file):
 *   (a) TERNARY OFF-RAMP: some ancestor `x ? A : B` has a reduced-motion test
 *       and the animation sits on the branch that runs when reduced motion is
 *       OFF (alternate of a positive test, or consequent of a negated test). So
 *       the animation never applies under reduced motion. This is RetroField's
 *       `prefersReducedMotion ? {static} : {animation ...forwards}`.
 *   (b) IN-OBJECT REDUCE OVERRIDE: the same style object that declares the
 *       animation also carries a `'@media (prefers-reduced-motion: reduce)'`
 *       key that neutralizes the animation. This is the DraftBoardMatrix /
 *       MatchupExtras / LandingPage shape.
 * Anything else is treated as unguarded and flagged (fail loud, the safe
 * direction under #542's asymmetry; the guard's ALLOWLIST is the escape hatch).
 */

const babelParser = require('@babel/parser');
const {
  finalKeyframeHiddenReason,
  FORWARDS_FILL,
  isNeutralizingDeclaration,
} = require('./animationSafetyGuard');

const REDUCED_MOTION_IDENT = /reduced?motion/i;
const REDUCE_MEDIA_KEY = /@media[^{}]*prefers-reduced-motion\s*:\s*reduce/i;

// Keys to skip when generically walking a Babel AST node's children.
const SKIP_KEYS = new Set([
  'loc',
  'start',
  'end',
  'range',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'comments',
  'extra',
  'errors',
  'tokens',
]);

function isNode(value) {
  return value && typeof value === 'object' && typeof value.type === 'string';
}

// Depth-first walk that gives the visitor each node together with its ancestor
// chain (outermost first, the node's parent last). No @babel/traverse needed -
// which keeps the dependency surface to @babel/parser alone.
function walk(node, visitor, ancestors) {
  visitor(node, ancestors);
  const nextAncestors = ancestors.concat(node);
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) walk(item, visitor, nextAncestors);
    } else if (isNode(value)) {
      walk(value, visitor, nextAncestors);
    }
  }
}

function parse(source) {
  return babelParser.parse(source, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
  });
}

// The tag of `keyframes`...`` (Identifier) or `styled.keyframes`... (MemberExpression).
function isKeyframesTag(tag) {
  if (!tag) return false;
  if (tag.type === 'Identifier') return tag.name === 'keyframes';
  if (tag.type === 'MemberExpression' && tag.property && tag.property.type === 'Identifier') {
    return tag.property.name === 'keyframes';
  }
  return false;
}

// Static body of a keyframes tagged template, or null if it interpolates
// (an interpolated body is unresolved by declared boundary).
function staticTemplateBody(quasi) {
  if (!quasi || quasi.type !== 'TemplateLiteral') return null;
  if (quasi.expressions.length > 0) return null;
  return quasi.quasis.map((q) => (q.value.cooked !== undefined ? q.value.cooked : q.value.raw)).join('');
}

function propKeyName(prop) {
  if (!prop || (prop.type !== 'ObjectProperty' && prop.type !== 'Property')) return null;
  const key = prop.key;
  if (!key) return null;
  if (key.type === 'Identifier') return prop.computed ? null : key.name;
  if (key.type === 'StringLiteral') return key.value;
  return null;
}

// Does an expression used as a ternary test reference reduced motion, and with
// what polarity? { isReducedMotion, negated }. Only the two clean shapes are
// recognized: a bare reduced-motion identifier, and its `!` negation.
function reducedMotionTest(test) {
  if (!test) return { isReducedMotion: false, negated: false };
  if (test.type === 'Identifier' && REDUCED_MOTION_IDENT.test(test.name)) {
    return { isReducedMotion: true, negated: false };
  }
  if (
    test.type === 'UnaryExpression' &&
    test.operator === '!' &&
    test.argument &&
    test.argument.type === 'Identifier' &&
    REDUCED_MOTION_IDENT.test(test.argument.name)
  ) {
    return { isReducedMotion: true, negated: true };
  }
  return { isReducedMotion: false, negated: false };
}

// (a) Is the animation property (with its ancestor chain) on the reduced-motion
// OFF branch of some ancestor ternary? chain is [root, ..., parentOfProp]; prop
// is the animation ObjectProperty itself.
function hasTernaryOffRamp(chain, prop) {
  const full = chain.concat(prop);
  for (let i = 0; i < full.length - 1; i += 1) {
    const node = full[i];
    if (node.type !== 'ConditionalExpression') continue;
    const child = full[i + 1];
    const onConsequent = child === node.consequent;
    const onAlternate = child === node.alternate;
    if (!onConsequent && !onAlternate) continue; // came through the test
    const { isReducedMotion, negated } = reducedMotionTest(node.test);
    if (!isReducedMotion) continue;
    // Positive test: alternate runs when reduced motion is OFF.
    // Negated test: consequent runs when reduced motion is OFF.
    if ((!negated && onAlternate) || (negated && onConsequent)) return true;
  }
  return false;
}

// A literal (string/number) value of an sx property, lower-cased, or null when
// the value is a variable or expression this static check cannot resolve. An
// unresolvable value is treated by callers as NON-neutralizing (fail loud).
function literalValue(node) {
  if (!node) return null;
  if (node.type === 'StringLiteral') return node.value.toLowerCase();
  if (node.type === 'NumericLiteral') return String(node.value);
  return null;
}

// camelCase sx property (animationFillMode) -> kebab CSS property
// (animation-fill-mode), so the shared neutralization predicate sees the same
// property names on both sides.
function camelToKebab(name) {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

// (b) Does the style object immediately containing the animation property also
// carry a reduce-media key that MEANINGFULLY neutralizes the animation? It is
// not enough for the reduce override to merely mention `animation` - its value
// must actually neutralize (animation: none, a non-forwards fill mode, or a
// restored opacity/visibility/display), matching the CSS side and Cory's
// "meaningful alternative" ruling. A reduce override that re-asserts
// `animationFillMode: 'forwards'` does not exempt.
function hasInObjectReduceOverride(parentObject) {
  if (!parentObject || parentObject.type !== 'ObjectExpression') return false;
  for (const p of parentObject.properties) {
    const keyName = propKeyName(p);
    if (!keyName || !REDUCE_MEDIA_KEY.test(keyName)) continue;
    if (!p.value || p.value.type !== 'ObjectExpression') continue;
    for (const inner of p.value.properties) {
      const innerKey = propKeyName(inner);
      if (!innerKey) continue;
      const value = literalValue(inner.value);
      if (value === null) continue; // unresolvable: cannot prove it neutralizes
      if (isNeutralizingDeclaration(camelToKebab(innerKey), value)) return true;
    }
  }
  return false;
}

/**
 * Scan one JS/JSX/TS/TSX source. Returns
 *   { violations, keyframesCount, forwardsUsageCount, unresolvedCount, parseError }
 * each violation: { animationName, reason, line }.
 */
function scanJs(source) {
  let ast;
  try {
    ast = parse(source);
  } catch (err) {
    return {
      violations: [],
      keyframesCount: 0,
      forwardsUsageCount: 0,
      unresolvedCount: 0,
      parseError: err.message,
    };
  }

  // Pass 1: same-file keyframes definitions, and every animation usage with its
  // ancestor chain (so resolution can run after the full keyframes map exists).
  const hiddenKeyframes = new Map(); // name -> reason
  const knownKeyframes = new Set();
  const usages = []; // { prop, chain }

  walk(
    ast,
    (node, ancestors) => {
      if (
        node.type === 'VariableDeclarator' &&
        node.id &&
        node.id.type === 'Identifier' &&
        node.init &&
        node.init.type === 'TaggedTemplateExpression' &&
        isKeyframesTag(node.init.tag)
      ) {
        const body = staticTemplateBody(node.init.quasi);
        if (body === null) return; // interpolated body: unresolved
        knownKeyframes.add(node.id.name);
        const { hidden, reason } = finalKeyframeHiddenReason(body);
        if (hidden) hiddenKeyframes.set(node.id.name, reason);
      }
      if (
        (node.type === 'ObjectProperty' || node.type === 'Property') &&
        propKeyName(node) === 'animation'
      ) {
        usages.push({ prop: node, chain: ancestors.slice() });
      }
    },
    []
  );

  const violations = [];
  let forwardsUsageCount = 0;
  let unresolvedCount = 0;

  for (const { prop, chain } of usages) {
    const value = prop.value;
    let rawText = '';
    let idents = [];
    if (value && value.type === 'TemplateLiteral') {
      rawText = value.quasis.map((q) => q.value.cooked || q.value.raw || '').join(' ');
      idents = value.expressions
        .filter((e) => e && e.type === 'Identifier')
        .map((e) => e.name);
    } else if (value && value.type === 'StringLiteral') {
      rawText = value.value;
    } else {
      continue; // a non-literal animation value (a variable) is unresolved-shaped
    }

    if (!FORWARDS_FILL.test(rawText)) continue;

    const resolvedIdents = idents.filter((name) => knownKeyframes.has(name));
    const unresolvedIdents = idents.filter((name) => !knownKeyframes.has(name));
    // A string-named animation, or an interpolated ident we could not resolve,
    // counts as one unresolved forwards usage.
    if (resolvedIdents.length === 0) {
      if (unresolvedIdents.length > 0 || (value.type === 'StringLiteral' && rawText.trim())) {
        unresolvedCount += 1;
      }
      continue;
    }

    const parentObject = chain[chain.length - 1];
    const exempt = hasTernaryOffRamp(chain, prop) || hasInObjectReduceOverride(parentObject);

    for (const name of resolvedIdents) {
      forwardsUsageCount += 1;
      if (!hiddenKeyframes.has(name)) continue;
      if (exempt) continue;
      violations.push({
        animationName: name,
        reason: hiddenKeyframes.get(name),
        line: prop.loc && prop.loc.start ? prop.loc.start.line : null,
      });
    }
  }

  return {
    violations,
    keyframesCount: knownKeyframes.size,
    forwardsUsageCount,
    unresolvedCount,
    parseError: null,
  };
}

module.exports = { scanJs };
