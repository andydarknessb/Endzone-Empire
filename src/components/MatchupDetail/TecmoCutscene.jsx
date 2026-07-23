import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { getSpriteColors } from '../../lib/nflTeamColors';
import { playLabel } from '../../lib/scoringEvents';
import { Sprite } from './TecmoSprite';
import './TecmoCutscene.css';

const FULL_DURATION_MS = 4200;
const STATIC_DURATION_MS = 1800;
const LEG_FRAME_MS = 110;

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Full-screen Tecmo-Bowl scoring cutscene for a single touchdown. Auto-dismisses
 * (~4.2s, or a 1.8s static card under reduced-motion); tapping anywhere dismisses
 * early. All motion is CSS transform/opacity — no layout thrash, no canvas.
 */
function TecmoCutscene({ play, onDone }) {
  const reduced = prefersReducedMotion();
  const [frame, setFrame] = useState(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const { runner, defender } = getSpriteColors(play.nflTeam, play.opponent);
  const pts = Number(play.pointsDelta) || 0;
  const ptsLabel = `+${Math.round(pts * 10) / 10}`;

  // Leg-cycle animation (skipped entirely under reduced motion).
  useEffect(() => {
    if (reduced) return undefined;
    const id = setInterval(() => setFrame((f) => (f === 0 ? 1 : 0)), LEG_FRAME_MS);
    return () => clearInterval(id);
  }, [reduced]);

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
        <div className="tecmo-static-card">
          <div className="tecmo-title tecmo-title--static">TOUCHDOWN</div>
          <div className="tecmo-name">{play.name}</div>
          <div className="tecmo-points">{ptsLabel}</div>
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
        <div className="tecmo-sky" aria-hidden="true" />
        <div className="tecmo-field" aria-hidden="true">
          <div className="tecmo-endzone" />
          <div className="tecmo-runner">
            <Sprite kit={defender} frame={frame === 0 ? 1 : 0} className="tecmo-sprite tecmo-sprite--defender" />
            <Sprite kit={runner} frame={frame} className="tecmo-sprite tecmo-sprite--runner" />
          </div>
        </div>
        <div className="tecmo-title">TOUCHDOWN</div>
        <div className="tecmo-caption">
          <span className="tecmo-name">{play.name}</span>
          <span className="tecmo-play">{playLabel(play)}</span>
          <span className="tecmo-points">{ptsLabel}</span>
        </div>
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
