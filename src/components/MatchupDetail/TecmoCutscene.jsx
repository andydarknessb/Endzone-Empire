import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { getSpriteColors } from '../../lib/nflTeamColors';
import { playLabel } from '../../lib/scoringEvents';
import './TecmoCutscene.css';

// 16x16 pixel-art runner. Body rows are shared; only the legs differ between
// the two animation frames, giving a 2-frame run cycle. Role letters map to
// team-kit colors (H/J/P/A) or fixed sprite colors (S skin, F facemask, B boot).
const BODY = [
  '................',
  '.....HHHHHH.....',
  '....HHHHHHHH....',
  '....HFFFFFFH....',
  '.....SSSSSS.....',
  '...JJJJJJJJJJ...',
  '..JJJJJAAJJJJJ..',
  '.SJJJJJAAJJJJJS.',
  '.SJJJJJJJJJJJJS.',
  '..JJJJJJJJJJJJ..',
  '...PPPPPPPPPP...',
];
// Rows 11-15 are legs; two frames.
const LEGS_A = [
  '...PPPP..PPPP...',
  '..PPP......PPP..',
  '..SSS......SSS..',
  '..SS........SS..',
  '.BBB........BBB.',
];
const LEGS_B = [
  '....PPPPPPPP....',
  '....PPPPPPPP....',
  '.....SSSSSS.....',
  '....SS....SS....',
  '...BBB....BBB...',
];

const FIXED = { S: '#e8b58b', F: '#c8ccd0', B: '#1b1d22', '.': null };

function rowsToRects(rows, kit) {
  const color = (ch) => {
    if (ch === 'H') return kit.helmet;
    if (ch === 'J') return kit.jersey;
    if (ch === 'P') return kit.pants;
    if (ch === 'A') return kit.accent;
    return FIXED[ch] !== undefined ? FIXED[ch] : null;
  };
  const rects = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const c = color(row[x]);
      if (c) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={c} />);
    }
  });
  return rects;
}

/** One 16x16 sprite as an SVG; `frame` (0|1) picks the leg cycle. */
function Sprite({ kit, frame, className }) {
  const legs = frame === 0 ? LEGS_A : LEGS_B;
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {rowsToRects([...BODY, ...legs], kit)}
    </svg>
  );
}

Sprite.propTypes = {
  kit: PropTypes.object.isRequired,
  frame: PropTypes.number.isRequired,
  className: PropTypes.string,
};

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
