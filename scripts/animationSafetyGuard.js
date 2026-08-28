'use strict';

/**
 * Guard for issue #542: forwards-filled animations that end in a hidden state
 * become PERMANENTLY hidden under reduced motion.
 *
 * WHY THIS EXISTS. src/theme/base.css (issue #533) collapses every non-essential
 * animation to `animation-duration: 0s` under `prefers-reduced-motion: reduce`,
 * but it does NOT touch `animation-fill-mode`. A forwards-filled animation
 * therefore jumps straight to its final keyframe and HOLDS it. When that final
 * keyframe hides the element (opacity 0, visibility hidden, display none) the
 * content is not made instantaneous, it is DELETED - and because the node stays
 * in the accessibility tree, the loss falls only on SIGHTED reduced-motion
 * users, the very group the reduced-motion policy exists to serve. The live
 * instance was RetroField's scoring-play callout (`flashIn`, ending
 * `100% { opacity: 0 }`); it is fixed, and this guard is what stops a
 * reintroduction.
 *
 * WHAT IT FLAGS. An animation declaration is unsafe when ALL of:
 *   1. it uses forwards fill (shorthand `forwards`/`both`, or an explicit
 *      `animation-fill-mode: forwards|both`), AND
 *   2. the keyframes it names end in a hidden final state (the `to` / `100%`
 *      keyframe explicitly sets opacity 0, visibility hidden, or display none),
 *      AND
 *   3. it has NO meaningful reduced-motion alternative for that same
 *      declaration or surface (see the two scanners for what counts).
 *
 * TWO SCANNERS, TWO PROBLEM SHAPES (ADR-style rationale, and the design fork
 * ruled on for #542):
 *   - The CSS side (scanCss, scripts/animationSafetyCss.js) is LEXICAL for
 *     detecting keyframes and hidden end states, but STRUCTURAL for correlating
 *     an animated selector to a reduce block inside a media query, so it uses
 *     postcss (already a transitive dependency, now declared direct).
 *   - The JS/Emotion side (scanJs, scripts/animationSafetyJs.js) asks a
 *     STRUCTURAL question - "is this animation the alternate branch of a
 *     prefers-reduced-motion conditional?" - which a regex can only guess at
 *     (it would guess right today and wrong after a reformat or a variable
 *     extraction). It uses @babel/parser, for the same reason.
 *
 * This file holds the SHARED LEXICAL CORE used by both scanners: parsing a
 * keyframes body and deciding whether its final keyframe is hidden. It is pure
 * (text in, verdict out, no filesystem), so both directions of the proof - an
 * unsafe end state is flagged, a visible end state is not - are testable against
 * fixture strings. scripts/animationSafetyGuard.test.js reads the real tree and
 * the deliberately-unsafe fixtures; only `npm run guards` makes it bite on a PR.
 */

// A hidden final state, per the #542 triage brief: opacity zero, visibility
// hidden, or display none. Nothing else counts (a `background: transparent`
// end, as in pickLandedFlash/scoreFlash, is NOT hidden - the element is still
// laid out and its text still renders), so those must NOT be swept in.
const HIDDEN_OPACITY = /^0(\.0+)?$/;

// Strip CSS block comments before parsing a keyframes body, so a `{`/`}` or a
// stray `opacity: 0` inside a comment cannot be mistaken for a real
// declaration. Keyframes bodies do not contain strings, so there is no
// string-vs-comment ambiguity to handle here.
function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Parse a declaration block ("opacity: 0; transform: none") into a lower-cased
// property -> value map. A later declaration of the same property wins, which
// matches the CSS cascade within a single keyframe.
function parseDeclarations(declText) {
  const decls = {};
  for (const part of declText.split(';')) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    const prop = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim().toLowerCase();
    if (!prop) continue;
    decls[prop] = value;
  }
  return decls;
}

// Given a property -> value map for a keyframe, return a human-readable reason
// string if it hides the element, else null. `visibility` and `display` are
// matched exactly (`hidden` / `none`); `opacity` matches 0 or 0.0... but never
// 0.5 or a non-zero value.
function hiddenReasonFromDecls(decls) {
  if (decls.opacity !== undefined && HIDDEN_OPACITY.test(decls.opacity)) {
    return `opacity: ${decls.opacity}`;
  }
  if (decls.visibility === 'hidden') return 'visibility: hidden';
  if (decls.display === 'none') return 'display: none';
  return null;
}

// A single keyframe selector token -> its numeric offset (0..100), or null if
// it is not an offset we understand. `from` is 0%, `to` is 100%, `N%` is N.
function offsetForToken(token) {
  const t = token.trim().toLowerCase();
  if (t === 'from') return 0;
  if (t === 'to') return 100;
  const m = /^(\d+(?:\.\d+)?)%$/.exec(t);
  return m ? Number(m[1]) : null;
}

// Parse a keyframes body ("0% { ... } 100% { ... }") into an array of blocks,
// each { offsets: number[], declText: string }. Blocks whose selector has no
// recognizable offset are dropped.
function parseKeyframeBlocks(body) {
  const clean = stripCssComments(body);
  const blocks = [];
  // Keyframe blocks do not nest, so a non-brace-greedy match over
  // `<selector> { <decls> }` is exact here.
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(clean)) !== null) {
    const selector = match[1];
    const declText = match[2];
    const offsets = selector
      .split(',')
      .map(offsetForToken)
      .filter((o) => o !== null);
    if (offsets.length === 0) continue;
    blocks.push({ offsets, declText });
  }
  return blocks;
}

/**
 * The heart of the shared core: does a keyframes body end in a hidden state?
 *
 * Under forwards fill the persisted state is the FINAL keyframe (the highest
 * offset, i.e. `to` / `100%`). Only properties EXPLICITLY declared in that final
 * keyframe persist; anything it omits falls back to the element's underlying
 * value and is not something the animation pins. So we look only at the final
 * keyframe's own declarations - a deliberately conservative boundary that
 * matches the real defect (flashIn sets `opacity: 0` at 100% explicitly) and
 * avoids inferring a hidden state the animation does not actually hold.
 *
 * If several blocks share the max offset (e.g. a `50%, 100%` and a separate
 * `100%`), their declarations are merged in source order, last winning, again
 * matching the cascade.
 *
 * Returns { hidden, reason, finalOffset }. `hidden` is false with a null reason
 * when there is no recognizable final keyframe or it declares nothing hiding.
 */
function finalKeyframeHiddenReason(body) {
  const blocks = parseKeyframeBlocks(body);
  if (blocks.length === 0) return { hidden: false, reason: null, finalOffset: null };
  const maxOffset = Math.max(...blocks.map((b) => Math.max(...b.offsets)));
  const finalDecls = {};
  for (const block of blocks) {
    if (!block.offsets.includes(maxOffset)) continue;
    Object.assign(finalDecls, parseDeclarations(block.declText));
  }
  const reason = hiddenReasonFromDecls(finalDecls);
  return { hidden: reason !== null, reason, finalOffset: maxOffset };
}

module.exports = {
  HIDDEN_OPACITY,
  stripCssComments,
  parseDeclarations,
  hiddenReasonFromDecls,
  offsetForToken,
  parseKeyframeBlocks,
  finalKeyframeHiddenReason,
};
