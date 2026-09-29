import React, {
  useEffect, useMemo, useRef, useState,
} from 'react';
import PropTypes from 'prop-types';
import { OUTCOME_WORD, recordLine } from '../model/plan';
import { kitForTeam } from '../model/teamKit';
import {
  HELMET, SLOUCH, frameRects,
} from './sprites';
import './LossScene.css';

// Timing ledger for the LOSS scene, in ms from the scene's mount. LossScene.css
// mirrors the ones a CSS animation needs (the fade, the blink, the flash, the
// walk, the pan); the test reads them back from the stylesheet.
export const STADIUM_MS = 1000; // the fade to storm navy ends; the dark stadium, the walk and the scoreboard
export const LIGHTNING_MS = 2500; // the one lightning flash; thunder
export const PAN_MS = 5000; // the stepped pan up to the black panel begins
export const PANEL_MS = 5500; // the panel holds: the Record, the waiver link and the dirge
export const DONE_MS = 10000; // the scene is over; the queue moves on
export const WALK_FRAME_MS = 250; // the slow walk: 4 fps, two frames
export const BLINK_MS = 500; // "GAME OVER." blinks at 2 Hz: a 500 ms period...
export const BLINK_COUNT = 2; // ...twice, so for 1 s, and then holds
export const FLASH_FRAME_MS = 110; // one frame of the lightning
export const FLASH_MS = 2 * FLASH_FRAME_MS; // the flash: two frames of white
export const PAN_STEPS = 4; // the pan is 4 steps, over PAN_MS..PANEL_MS
export const COUNT_STEPS = 6; // the scores count up in 6 steps...
export const COUNT_START_MS = STADIUM_MS; // ...from the scoreboard's appearance...
export const COUNT_STEP_MS = 350; // ...one tick each, none on the flash

function FrameSprite({
  rows, kit, className, testId, frame,
}) {
  return (
    <svg
      className={className}
      data-testid={testId}
      data-frame={frame}
      viewBox={`0 0 ${rows[0].length} ${rows.length}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {frameRects(rows, kit).map(({ x, y, fill }) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={fill} />
      ))}
    </svg>
  );
}

FrameSprite.propTypes = {
  rows: PropTypes.arrayOf(PropTypes.string).isRequired,
  kit: PropTypes.object,
  className: PropTypes.string,
  testId: PropTypes.string,
  frame: PropTypes.number,
};

/** The score shown after `step` of COUNT_STEPS: a share of it, and exactly it at the end. */
function counted(score, step) {
  if (step >= COUNT_STEPS) return score;
  return Math.floor((score * step) / COUNT_STEPS);
}

function ScoreRow({ side, shown, testId }) {
  return (
    <div className="loss-row" data-testid={testId}>
      <span className="loss-name" data-testid={`${testId}-name`}>{side.name || 'TEAM'}</span>
      <span className="loss-points" data-testid={`${testId}-score`}>{shown}</span>
    </div>
  );
}

ScoreRow.propTypes = {
  side: PropTypes.shape({ name: PropTypes.string }).isRequired,
  shown: PropTypes.number.isRequired,
  testId: PropTypes.string.isRequired,
};

/**
 * The LOSS scene of the Postgame cutscene: ten seconds of DOM and CSS storm, in
 * four beats (`data-beat`): `storm` (the fade to navy, the rain, "GAME OVER."),
 * `stadium` (the dark stadium, the viewer's lone player walking home with the
 * helmet dragging, the scoreboard counting up, one lightning flash), `pan` (a
 * stepped pan up) and `panel` (the Record and the waiver link) until `onDone`.
 *
 * It plays the sounds through the `sfx` it is given and stops none of them: the
 * queue (PostgameStage) owns `stopAll`. The waiver link ends the queue through
 * `onLeave`, not `onDone` (which would only advance to the next scene). Every
 * animated property is transform or opacity, and movement is on `steps()`.
 *
 * Only the stage is `aria-hidden`: the panel's link is focusable and must stay
 * in the accessibility tree.
 */
function LossScene({
  cutscene, sfx, onDone, onLeave,
}) {
  const { me, opponent } = cutscene;
  const [beat, setBeat] = useState('storm');
  const [count, setCount] = useState(0);
  const [flashed, setFlashed] = useState(false);
  const [tick, setTick] = useState(0);
  const sfxRef = useRef(sfx);
  sfxRef.current = sfx;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const oppKit = useMemo(() => kitForTeam(opponent.teamId), [opponent.teamId]);
  const myKit = useMemo(() => kitForTeam(me.teamId, oppKit), [me.teamId, oppKit]);

  useEffect(() => {
    const audio = () => sfxRef.current;
    audio().play('lossChord');
    audio().startLoop('rain');
    const at = (ms, fn) => setTimeout(fn, ms);
    const timers = [
      at(STADIUM_MS, () => setBeat('stadium')),
      at(LIGHTNING_MS, () => {
        setFlashed(true);
        audio().play('thunder');
      }),
      at(PAN_MS, () => setBeat('pan')),
      at(PANEL_MS, () => {
        setBeat('panel');
        audio().startLoop('dirge');
      }),
      at(DONE_MS, () => doneRef.current()),
    ];
    for (let step = 1; step <= COUNT_STEPS; step += 1) {
      timers.push(at(COUNT_START_MS + step * COUNT_STEP_MS, () => {
        setCount(step);
        audio().play('blip');
      }));
    }
    const walk = setInterval(() => setTick((n) => n + 1), WALK_FRAME_MS);
    return () => {
      timers.forEach(clearTimeout);
      clearInterval(walk);
    };
  }, []);

  const line = recordLine(cutscene);
  const inStadium = beat !== 'storm';

  return (
    <div className="loss-scene" data-testid="loss-scene" data-beat={beat}>
      <div className="loss-slide" data-testid="loss-slide">
        <div className="loss-stage" aria-hidden="true">
          <div className="loss-fade" data-testid="loss-fade" />
          {inStadium && (
            <>
              <div className="loss-sky" data-testid="loss-sky">
                <div className="loss-cloud loss-cloud--high" data-testid="loss-cloud" />
                <div className="loss-cloud loss-cloud--low" data-testid="loss-cloud" />
              </div>
              <div className="loss-crowd" data-testid="loss-crowd" />
              <div className="loss-field" />
              <div className="loss-walker-track">
                <div className="loss-walker" data-testid="loss-walker">
                  <FrameSprite
                    rows={SLOUCH[tick % SLOUCH.length]}
                    frame={tick % SLOUCH.length}
                    kit={myKit}
                    className="loss-sprite loss-sprite--player"
                    testId="loss-player"
                  />
                  <FrameSprite
                    rows={HELMET}
                    kit={myKit}
                    className="loss-helmet"
                    testId="loss-helmet"
                  />
                </div>
              </div>
              <div className="loss-board" data-testid="loss-scoreboard">
                <ScoreRow side={opponent} shown={counted(opponent.score, count)} testId="loss-row-opponent" />
                <ScoreRow side={me} shown={counted(me.score, count)} testId="loss-row-me" />
              </div>
            </>
          )}
          {flashed && <div className="loss-flash" data-testid="loss-flash" />}
          <div className="loss-gameover" data-testid="loss-gameover">{OUTCOME_WORD.loss}</div>
        </div>
        <div className="loss-panel" data-testid="loss-panel">
          {beat === 'panel' && (
            <>
              {line && <div className="loss-record" data-testid="loss-record">{line}</div>}
              <a
                className="loss-link"
                data-testid="loss-link"
                href={`#/league/${cutscene.leagueId}/waivers`}
                onClick={onLeave}
              >
                RETREAT TO THE WAIVER WIRE
              </a>
            </>
          )}
        </div>
      </div>
      <div className="loss-rain" data-testid="loss-rain" aria-hidden="true" />
    </div>
  );
}

LossScene.propTypes = {
  cutscene: PropTypes.shape({
    leagueId: PropTypes.number,
    week: PropTypes.number,
    playoff: PropTypes.bool,
    me: PropTypes.shape({
      teamId: PropTypes.number,
      name: PropTypes.string,
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
  onLeave: PropTypes.func.isRequired,
};

export default LossScene;
