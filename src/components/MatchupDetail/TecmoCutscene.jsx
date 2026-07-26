import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { getSpriteColors, getNameColors } from '../../lib/nflTeamColors';
import { playLabel } from '../../lib/scoringEvents';
import { Sprite, RefereeSprite, GoalPostSprite } from './TecmoSprite';
import './TecmoCutscene.css';

// Timing ledger — these move together (see also tecmo-run in TecmoCutscene.css,
// which must finish before BEAT1_MS, and the test advance values):
const BEAT1_MS = 2200; // runner beat, then hard cut to the referee frame
const FULL_DURATION_MS = 6000;
const STATIC_DURATION_MS = 1800;
const LEG_FRAME_MS = 110;
const REF_FRAME_MS = 260; // ref bounce cadence; 110ms reads as buzzing at ref scale

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The referee "BOOM!" frame — beat 2 of the cutscene and the reduced-motion card. */
function BoomFrame({ play, refFrame, ptsLabel, isStatic }) {
  const nameColors = getNameColors(play.nflTeam);
  return (
    <div className={`tecmo-refscene${isStatic ? ' tecmo-refscene--static' : ''}`}>
      <div className="tecmo-refstage" aria-hidden="true">
        <div className="tecmo-daysky" />
        <div className="tecmo-crowd" />
        <GoalPostSprite className="tecmo-goalpost" />
        <RefereeSprite frame={refFrame} className="tecmo-ref" />
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
 * All motion is CSS transform/opacity — no layout thrash, no canvas.
 */
function TecmoCutscene({ play, onDone }) {
  const reduced = prefersReducedMotion();
  const [beat, setBeat] = useState(1);
  const [frame, setFrame] = useState(0);
  const [refFrame, setRefFrame] = useState(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

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

  const dismiss = () => doneRef.current && doneRef.current();

  if (reduced) {
    return (
      <div
        className="tecmo-overlay tecmo-overlay--static"
        role="alertdialog"
        aria-label={`Touchdown, ${play.name}, ${ptsLabel} points`}
        onClick={dismiss}
      >
        <div className="tecmo-scene">
          <BoomFrame play={play} refFrame={0} ptsLabel={ptsLabel} isStatic />
        </div>
      </div>
    );
  }

  return (
    <div
      className="tecmo-overlay"
      role="alertdialog"
      aria-label={`Touchdown, ${play.name}, ${ptsLabel} points`}
      onClick={dismiss}
    >
      <div className="tecmo-scene">
        {beat === 1 ? (
          <>
            <div className="tecmo-sky" aria-hidden="true" />
            <div className="tecmo-field" aria-hidden="true">
              <div className="tecmo-endzone" />
              <div className="tecmo-runner">
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
