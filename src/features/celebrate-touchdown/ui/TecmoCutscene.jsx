import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { getSpriteColors, getNameColors } from '../../../lib/nflTeamColors';
import { playLabel } from '../../../lib/scoringEvents';
import { Sprite, RefereeSprite, GoalPostSprite } from '../../../shared/ui';
import './TecmoCutscene.css';

// Timing ledger - these move together (see also tecmo-run in TecmoCutscene.css,
// which must finish before BEAT1_MS, and the test advance values):
const BEAT1_MS = 2200; // runner beat, then hard cut to the referee frame
const FULL_DURATION_MS = 6000;
const STATIC_DURATION_MS = 1800;
const LEG_FRAME_MS = 110;
const REF_FRAME_MS = 260; // ref bounce cadence; 110ms reads as buzzing at ref scale

// Everything inside the overlay a Tab could land on. The scene ships with no
// focusable content of its own, so this list is empty today and the trap below
// simply refuses the Tab; it is a selector rather than a hard-coded "nothing"
// so a control added to the scene later stays reachable instead of being
// silently trapped out of reach.
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Exactly ONE cutscene traps focus at a time: the most recently mounted. The
// queue plays one at a time, so two live overlays is a corner (a surface that
// mounts two, or a test that renders a second), but it is one with teeth: two
// pull-backs both refusing to let focus sit outside themselves bounce it
// between them until the stack blows. Each overlay registers here on mount and
// only the top of the stack acts.
const openOverlays = [];

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The referee "BOOM!" frame - beat 2 of the cutscene and the reduced-motion card. */
function BoomFrame({ play, refFrame, ptsLabel, isStatic }) {
  const nameColors = getNameColors(play.nflTeam);
  return (
    <div
      className={`tecmo-refscene${isStatic ? ' tecmo-refscene--static' : ''}`}
      data-testid="tecmo-boom-frame"
    >
      <div className="tecmo-refstage" aria-hidden="true">
        <div className="tecmo-daysky" />
        <div className="tecmo-crowd" />
        <GoalPostSprite className="tecmo-goalpost" testId="tecmo-goalpost" />
        <RefereeSprite frame={refFrame} className="tecmo-ref" testId="tecmo-referee" />
      </div>
      <div className="tecmo-boomband" style={{ borderTopColor: nameColors.stripe }}>
        <div className="tecmo-boom">BOOM!</div>
        <div className="tecmo-boom-caption">
          <span
            className="tecmo-name"
            style={{ color: nameColors.text, textShadow: `2px 2px 0 ${nameColors.shadow}` }}
          >
            {play.name}
          </span>
          <span className="tecmo-play">{playLabel(play)}</span>
          <span className="tecmo-points">{ptsLabel}</span>
        </div>
      </div>
    </div>
  );
}

BoomFrame.propTypes = {
  play: PropTypes.object.isRequired,
  refFrame: PropTypes.number.isRequired,
  ptsLabel: PropTypes.string.isRequired,
  isStatic: PropTypes.bool,
};

/**
 * Full-screen Tecmo-Bowl scoring cutscene for a single touchdown, in two beats:
 * the runner sprints to the end zone, then a hard cut to the referee BOOM!
 * frame with the scorer's name in team colors. Auto-dismisses (~6s, or a 1.8s
 * static BOOM frame under reduced-motion); tapping anywhere dismisses early.
 * All motion is CSS transform/opacity - no layout thrash, no canvas.
 *
 * It is an `alertdialog`, and it behaves like one for a keyboard (#911). The
 * cutscene covers the whole viewport, so a manager who is not using a pointer
 * would otherwise be left tabbing around a page he cannot see, with no way to
 * get rid of the thing before its timer runs out. So: the overlay takes focus
 * when it appears, holds focus while it is shown, hands focus back to whatever
 * held it when it closes, and Escape dismisses it the same way the tap and the
 * timer do. None of that touches the reduced-motion path's choice of frames or
 * durations - it is the same behaviour on both paths.
 */
function TecmoCutscene({ play, onDone }) {
  const reduced = prefersReducedMotion();
  const [beat, setBeat] = useState(1);
  const [frame, setFrame] = useState(0);
  const [refFrame, setRefFrame] = useState(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const overlayRef = useRef(null);
  const restoreRef = useRef(null);

  const { runner, defender } = getSpriteColors(play.nflTeam, play.opponent);
  const pts = Number(play.pointsDelta) || 0;
  const ptsLabel = `+${Math.round(pts * 10) / 10}`;

  // Hard cut from the runner beat to the referee frame.
  useEffect(() => {
    if (reduced) return undefined;
    const id = setTimeout(() => setBeat(2), BEAT1_MS);
    return () => clearTimeout(id);
  }, [reduced]);

  // Leg-cycle animation during beat 1 (skipped entirely under reduced motion).
  useEffect(() => {
    if (reduced || beat !== 1) return undefined;
    const id = setInterval(() => setFrame((f) => (f === 0 ? 1 : 0)), LEG_FRAME_MS);
    return () => clearInterval(id);
  }, [reduced, beat]);

  // Referee bounce during beat 2.
  useEffect(() => {
    if (reduced || beat !== 2) return undefined;
    const id = setInterval(() => setRefFrame((f) => (f === 0 ? 1 : 0)), REF_FRAME_MS);
    return () => clearInterval(id);
  }, [reduced, beat]);

  // Auto-dismiss timer.
  useEffect(() => {
    const ms = reduced ? STATIC_DURATION_MS : FULL_DURATION_MS;
    const id = setTimeout(() => doneRef.current && doneRef.current(), ms);
    return () => clearTimeout(id);
  }, [reduced]);

  // Focus cannot wander out from behind the cutscene while it is shown (#911):
  // anything that takes focus outside the overlay is pulled straight back to
  // it. This effect is declared BEFORE the mount effect below so that on
  // unmount its cleanup runs FIRST (React tears effects down in declaration
  // order) and the focus the restore hands back is not immediately clawed back
  // by an overlay that is on its way out.
  useEffect(() => {
    const self = overlayRef;
    openOverlays.push(self);
    const pullBack = (event) => {
      if (openOverlays[openOverlays.length - 1] !== self) return;
      const overlay = overlayRef.current;
      if (!overlay || !overlay.isConnected || overlay.contains(event.target)) return;
      overlay.focus();
    };
    document.addEventListener('focusin', pullBack);
    return () => {
      document.removeEventListener('focusin', pullBack);
      const at = openOverlays.indexOf(self);
      if (at !== -1) openOverlays.splice(at, 1);
    };
  }, []);

  // Focus in on mount, and back out to whatever held it when the cutscene
  // closes. A cutscene arrives unannounced from the score feed, so the element
  // it interrupted is remembered here rather than handed in by the caller.
  useEffect(() => {
    const previous = document.activeElement;
    restoreRef.current = previous && previous !== document.body ? previous : null;
    if (overlayRef.current) overlayRef.current.focus();
    return () => {
      const back = restoreRef.current;
      restoreRef.current = null;
      // A restore into a node the page has since dropped would land focus on
      // nothing, which is the failure this exists to prevent.
      if (back && back.isConnected) back.focus();
    };
  }, []);

  const dismiss = () => doneRef.current && doneRef.current();

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      // Escape ends this cutscene exactly as the tap and the timer do: it
      // drops the head of the queue and lets the next one play.
      event.stopPropagation();
      dismiss();
      return;
    }
    if (event.key !== 'Tab') return;
    const overlay = overlayRef.current;
    const stops = overlay ? Array.from(overlay.querySelectorAll(FOCUSABLE)) : [];
    if (!stops.length) {
      // Nothing here to move to, so an unrefused Tab would hand focus to the
      // page behind, or to the browser chrome, which no focus listener can
      // pull back from. Refuse it and keep focus on the overlay.
      event.preventDefault();
      if (overlay) overlay.focus();
      return;
    }
    const first = stops[0];
    const last = stops[stops.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === overlay)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (reduced) {
    return (
      <div
        ref={overlayRef}
        className="tecmo-overlay tecmo-overlay--static"
        role="alertdialog"
        aria-label={`Touchdown, ${play.name}, ${ptsLabel} points`}
        tabIndex={-1}
        onClick={dismiss}
        onKeyDown={handleKeyDown}
      >
        <div className="tecmo-scene">
          <BoomFrame play={play} refFrame={0} ptsLabel={ptsLabel} isStatic />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={overlayRef}
      className="tecmo-overlay"
      role="alertdialog"
      aria-label={`Touchdown, ${play.name}, ${ptsLabel} points`}
      tabIndex={-1}
      onClick={dismiss}
      onKeyDown={handleKeyDown}
    >
      <div className="tecmo-scene">
        {beat === 1 ? (
          <>
            <div className="tecmo-sky" aria-hidden="true" />
            <div className="tecmo-field" aria-hidden="true">
              <div className="tecmo-endzone" />
              <div className="tecmo-runner" data-testid="tecmo-runner">
                <Sprite kit={defender} frame={frame === 0 ? 1 : 0} className="tecmo-sprite tecmo-sprite--defender" />
                <Sprite kit={runner} frame={frame} className="tecmo-sprite tecmo-sprite--runner" />
              </div>
            </div>
          </>
        ) : (
          <BoomFrame play={play} refFrame={refFrame} ptsLabel={ptsLabel} />
        )}
        <div className="tecmo-scanlines" aria-hidden="true" />
        <div className="tecmo-vignette" aria-hidden="true" />
      </div>
    </div>
  );
}

TecmoCutscene.propTypes = {
  play: PropTypes.shape({
    name: PropTypes.string,
    nflTeam: PropTypes.string,
    opponent: PropTypes.string,
    type: PropTypes.string,
    pointsDelta: PropTypes.number,
  }).isRequired,
  onDone: PropTypes.func.isRequired,
};

export default TecmoCutscene;
