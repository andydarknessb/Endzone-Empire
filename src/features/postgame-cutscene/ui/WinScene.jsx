import React, {
  useEffect, useMemo, useRef, useState,
} from 'react';
import PropTypes from 'prop-types';
import { Sprite, GoalPostSprite } from '../../../shared/ui';
import { OUTCOME_WORD, recordLine } from '../model/plan';
import { kitForTeam } from '../model/teamKit';
import Marquee from './Marquee';
import Transition from './Transition';
import {
  BALL, BALL_COLORS, DANCE, DIVE, SPIKE, frameRects,
} from './sprites';
import './WinScene.css';

// Timing ledger for the WIN scene, in ms from the scene's mount. WinScene.css
// mirrors the ones a CSS animation needs (the flash, the end zone's slide, the
// slam, the dive); the test reads them back from the stylesheet.
export const SCROLL_MS = 1000; // black opening, sweeps and typing end; the side-scroll starts
export const ENDZONE_MS = 3200; // the end zone slides in; the runner dives
export const SPIKE_MS = 3600; // the dive lands as the spike: white flash and crunch
export const SLAM_MS = 4000; // "YOU WIN!" slams in; fanfare
export const DANCE_MS = 4600; // the dance; whistle, march and crowd
export const DONE_MS = 10000; // the scene is over; the queue moves on
export const FRAME_MS = 110; // every sprite cycle
export const FLASH_MS = 2 * FRAME_MS; // the white flash: two frames

function FrameSprite({
  rows, kit, palette, className, testId,
}) {
  return (
    <svg
      className={className}
      data-testid={testId}
      viewBox={`0 0 ${rows[0].length} ${rows.length}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {frameRects(rows, kit, palette).map(({ x, y, fill }) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={fill} />
      ))}
    </svg>
  );
}

FrameSprite.propTypes = {
  rows: PropTypes.arrayOf(PropTypes.string).isRequired,
  kit: PropTypes.object,
  palette: PropTypes.object,
  className: PropTypes.string,
  testId: PropTypes.string,
};

/**
 * The WIN scene of the Postgame cutscene: ten seconds of DOM and CSS Tecmo,
 * in five beats (`data-beat`): `sweep` (the opening line sweeps and typed
 * text), `scroll` (the field scrolls under a high-stepping runner with the
 * defender trailing), `endzone` (the end zone slides in; the runner dives, then
 * spikes the ball under a two-frame white flash), `slam` ("YOU WIN!") and
 * `dance` (the dance, the Record and the marquee) until `onDone`.
 *
 * It plays the sounds through the `sfx` it is given and stops none of them: the
 * queue (PostgameStage) owns `stopAll` for a tap, SKIP, Escape and the end. Every
 * animated property is transform or opacity, and movement is on `steps()`.
 */
function WinScene({ cutscene, sfx, onDone }) {
  const { me, opponent } = cutscene;
  const [beat, setBeat] = useState('sweep');
  const [spiked, setSpiked] = useState(false);
  const [tick, setTick] = useState(0);
  const sfxRef = useRef(sfx);
  sfxRef.current = sfx;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const oppKit = useMemo(() => kitForTeam(opponent.teamId), [opponent.teamId]);
  const myKit = useMemo(() => kitForTeam(me.teamId, oppKit), [me.teamId, oppKit]);

  useEffect(() => {
    const audio = () => sfxRef.current;
    audio().play('slide');
    const at = (ms, fn) => setTimeout(fn, ms);
    const timers = [
      at(SCROLL_MS, () => setBeat('scroll')),
      at(ENDZONE_MS, () => setBeat('endzone')),
      at(SPIKE_MS, () => {
        setSpiked(true);
        audio().play('crunch');
      }),
      at(SLAM_MS, () => {
        setBeat('slam');
        audio().play('fanfare');
      }),
      at(DANCE_MS, () => {
        setBeat('dance');
        audio().play('whistle');
        audio().startLoop('march');
        audio().startLoop('crowd');
      }),
      at(DONE_MS, () => doneRef.current()),
    ];
    const cycle = setInterval(() => setTick((n) => n + 1), FRAME_MS);
    return () => {
      timers.forEach(clearTimeout);
      clearInterval(cycle);
    };
  }, []);

  const line = recordLine(cutscene);
  const inEndZone = beat === 'endzone' || beat === 'slam' || beat === 'dance';
  const running = beat === 'scroll';
  const legs = tick % 2;

  let player;
  if (beat === 'dance') {
    player = <FrameSprite rows={DANCE[tick % DANCE.length]} kit={myKit} className="win-sprite" testId="win-dance" />;
  } else if (inEndZone) {
    player = spiked
      ? <FrameSprite rows={SPIKE} kit={myKit} className="win-sprite" testId="win-spike" />
      : <FrameSprite rows={DIVE} kit={myKit} className="win-sprite win-sprite--dive" testId="win-dive" />;
  } else {
    player = <Sprite kit={myKit} frame={legs} className="win-sprite win-sprite--bob" />;
  }

  return (
    <div className="win-scene" data-testid="win-scene" data-beat={beat} aria-hidden="true">
      {beat === 'sweep' ? (
        <Transition text={`WEEK ${cutscene.week} FINAL... TALLYING SCORES...`} />
      ) : (
        <>
          <div className="win-sky"><div className="win-layer win-layer--sky" data-testid="win-layer-sky" /></div>
          <div className="win-crowd"><div className="win-layer win-layer--crowd" data-testid="win-layer-crowd" /></div>
          <div className="win-field" data-scrolling={running}>
            <div className="win-layer win-layer--field" data-testid="win-layer-field" />
          </div>
          {inEndZone && (
            <div className="win-endzone" data-testid="win-endzone">
              <GoalPostSprite className="win-goalpost" testId="win-goalpost" />
            </div>
          )}
          {beat !== 'dance' && (
            <div className="win-defender">
              <Sprite kit={oppKit} frame={running ? legs : 0} className="win-sprite" />
            </div>
          )}
          <div className="win-runner-group">
            <div className="win-runner" data-testid="win-runner">
              {player}
              {spiked && beat !== 'dance' && (
                <FrameSprite rows={BALL} palette={BALL_COLORS} className="win-ball" testId="win-ball" />
              )}
            </div>
          </div>
          {spiked && <div className="win-flash" data-testid="win-flash" />}
          {(beat === 'slam' || beat === 'dance') && (
            <div className="win-title">
              <div className="win-title-text" data-testid="win-title">{OUTCOME_WORD.win}</div>
              <div className="win-title-score" data-testid="win-score">{`${me.score} - ${opponent.score}`}</div>
            </div>
          )}
          {beat === 'dance' && (
            <>
              {line && <div className="win-record" data-testid="win-record">{line}</div>}
              <Marquee
                text={`${(me.name || 'TEAM').toUpperCase()} DEFEATS ${(opponent.name || 'TEAM').toUpperCase()}`}
                name={me.name || ''}
                avatarUrl={me.avatarStaticUrl || me.avatarUrl || undefined}
                visibleByMs={DONE_MS - DANCE_MS}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

WinScene.propTypes = {
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
    startLoop: PropTypes.func.isRequired,
  }).isRequired,
  onDone: PropTypes.func.isRequired,
};

export default WinScene;
