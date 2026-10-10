import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { GoalPostSprite } from '../../../shared/ui';
import { OUTCOME_WORD, recordLine } from '../model/plan';
import Marquee from './Marquee';
import Transition, { tallyLine } from './Transition';
import { REF_FLAT, frameRects } from './sprites';
import './TieScene.css';

// Timing ledger for the TIE scene, in ms from the scene's mount. TieScene.css
// mirrors the ones a CSS animation needs (the slam); the test reads them back.
export const REF_MS = 1000; // the black opening ends; the referee frame; "TIE GAME" slams in; the sting
export const MARQUEE_MS = 4000; // the Record line and the marquee arrive
export const DONE_MS = 7000; // the scene is over; the queue moves on
export const REF_FRAME_MS = 260; // the referee's bounce: 2 frames (110 ms reads as buzzing at this scale)

function RefereeFlat({ frame }) {
  const rows = REF_FLAT[frame % REF_FLAT.length];
  return (
    <svg
      className="tie-ref"
      data-testid="tie-referee"
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {frameRects(rows).map(({ x, y, fill }) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={fill} />
      ))}
    </svg>
  );
}

RefereeFlat.propTypes = {
  frame: PropTypes.number.isRequired,
};

/**
 * The TIE scene of the Postgame cutscene: seven seconds of DOM and CSS Tecmo, in
 * three beats (`data-beat`): `sweep` (the shared opening line sweeps and typed
 * text), `ref` (the day sky, crowd and goal post with the referee, arms out
 * flat, bouncing; "TIE GAME" slams in) and `marquee` (the Record and the
 * "MY TEAM TIES OPPONENT" marquee over the same frame) until `onDone`.
 *
 * It plays `slide` and then `tieSting` through the `sfx` it is given, loops
 * nothing, and stops nothing: the queue (PostgameStage) owns `stopAll`. It has
 * no link, so it ignores `onLeave`. Every animated property is transform or
 * opacity, and movement is on `steps()`.
 */
function TieScene({ cutscene, sfx, onDone }) {
  const { me, opponent } = cutscene;
  const [beat, setBeat] = useState('sweep');
  const [tick, setTick] = useState(0);
  const sfxRef = useRef(sfx);
  sfxRef.current = sfx;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    sfxRef.current.play('slide');
    let cycle = null;
    const at = (ms, fn) => setTimeout(fn, ms);
    const timers = [
      at(REF_MS, () => {
        setBeat('ref');
        sfxRef.current.play('tieSting');
        // The bounce starts with the referee, so its first frame lasts a whole beat.
        cycle = setInterval(() => setTick((n) => n + 1), REF_FRAME_MS);
      }),
      at(MARQUEE_MS, () => setBeat('marquee')),
      at(DONE_MS, () => doneRef.current()),
    ];
    return () => {
      timers.forEach(clearTimeout);
      if (cycle) clearInterval(cycle);
    };
  }, []);

  const line = recordLine(cutscene);

  return (
    <div className="tie-scene" data-testid="tie-scene" data-beat={beat} aria-hidden="true">
      {beat === 'sweep' ? (
        <Transition text={tallyLine(cutscene.week)} />
      ) : (
        <>
          <div className="tie-stage">
            <div className="tie-daysky" data-testid="tie-daysky" />
            <div className="tie-crowd" data-testid="tie-crowd" />
            <GoalPostSprite className="tie-goalpost" testId="tie-goalpost" />
            <RefereeFlat frame={tick} />
          </div>
          <div className="tie-band" />
          <div className="tie-title">
            <div className="tie-title-text" data-testid="tie-title">{OUTCOME_WORD.tie}</div>
            <div className="tie-title-score" data-testid="tie-score">{`${me.score} - ${opponent.score}`}</div>
          </div>
          {beat === 'marquee' && (
            <>
              {line && <div className="tie-record" data-testid="tie-record">{line}</div>}
              {cutscene.narrative && <p className="postgame-narrative" data-testid="postgame-narrative">{cutscene.narrative}</p>}
              <Marquee
                text={`${(me.name || 'TEAM').toUpperCase()} TIES ${(opponent.name || 'TEAM').toUpperCase()}`}
                name={me.name || ''}
                avatarUrl={me.avatarStaticUrl || me.avatarUrl || undefined}
                visibleByMs={DONE_MS - MARQUEE_MS}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

TieScene.propTypes = {
  cutscene: PropTypes.shape({
    week: PropTypes.number,
    playoff: PropTypes.bool,
    me: PropTypes.shape({
      teamId: PropTypes.number,
      name: PropTypes.string,
      avatarUrl: PropTypes.string,
      avatarStaticUrl: PropTypes.string,
      score: PropTypes.number,
    }).isRequired,
    opponent: PropTypes.shape({
      teamId: PropTypes.number,
      name: PropTypes.string,
      score: PropTypes.number,
    }).isRequired,
    record: PropTypes.object,
    standing: PropTypes.object,
  }).isRequired,
  sfx: PropTypes.shape({
    play: PropTypes.func.isRequired,
  }).isRequired,
  onDone: PropTypes.func.isRequired,
};

export default TieScene;
