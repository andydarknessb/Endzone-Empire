import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import PropTypes from 'prop-types';
import apiClient from '../../../api/apiClient';
import { Sprite } from '../../../shared/ui';
import ResultCard from './ResultCard';
import useOverlayFocus from './useOverlayFocus';
import { planQueue, resultSentence } from '../model/plan';
import { kitForTeam } from '../model/teamKit';
import { sfx } from '../model/sfx';
import { readPostgameSoundOn, writePostgameSoundOn } from '../model/soundPreference';
import { readPostgameIntroSeen, writePostgameIntroSeen } from '../model/introFlag';
import { recordStartedIds } from '../model/sessionGuard';
import './PostgameCutscenes.css';

// Timing ledger. A scene under reduced motion is a still card: 2 s each.
const SCENE_MS = 3500;
const REDUCED_SCENE_MS = 2000;
const IDLE_FRAME_MS = 500;

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function titleFor(cutscenes) {
  const leagues = new Set(cutscenes.map((c) => c.leagueId));
  return leagues.size === 1
    ? `WEEK ${cutscenes[0].week} IS FINAL`
    : `RESULTS ARE IN · ${leagues.size} LEAGUES`;
}

function TitleCard({
  cutscenes, muted, onToggleSound, onStart, onSkip, showIntro,
}) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f === 0 ? 1 : 0)), IDLE_FRAME_MS);
    return () => clearInterval(id);
  }, []);
  const first = cutscenes[0];
  const kit = kitForTeam(first.me.teamId);
  return (
    <div className="postgame-title" data-testid="postgame-title-card">
      <button
        type="button"
        className="postgame-chrome postgame-chrome--sound"
        aria-label="Sound"
        aria-pressed={!muted}
        onClick={(event) => { event.stopPropagation(); onToggleSound(); }}
      >
        <span aria-hidden="true">{muted ? '×' : '♪'}</span>
      </button>
      <div className="postgame-title-text">{titleFor(cutscenes)}</div>
      <Sprite kit={kit} frame={frame} className="postgame-title-sprite" />
      {/* A real button so a keyboard user who has Tabbed into the card can start
          the scenes: Enter and Space on the SKIP and sound buttons do their own
          thing, and the card itself is no longer a Tab stop. */}
      <button
        type="button"
        className="postgame-start"
        onClick={(event) => { event.stopPropagation(); onStart(); }}
      >
        PRESS START
      </button>
      {showIntro && <div className="postgame-intro">NEW · TURN OFF IN SETTINGS</div>}
      <button
        type="button"
        className="postgame-chrome postgame-chrome--skip"
        aria-label="Skip"
        onClick={(event) => { event.stopPropagation(); onSkip(); }}
      >
        [B] SKIP
      </button>
    </div>
  );
}

TitleCard.propTypes = {
  cutscenes: PropTypes.array.isRequired,
  muted: PropTypes.bool.isRequired,
  onToggleSound: PropTypes.func.isRequired,
  onStart: PropTypes.func.isRequired,
  onSkip: PropTypes.func.isRequired,
  showIntro: PropTypes.bool.isRequired,
};

/**
 * The Postgame cutscene overlay: title card, then up to three result cards, in
 * one full-screen `alertdialog` that behaves as the touchdown cutscene does (it
 * takes focus, holds it, gives it back, Escape ends it). It lives in its own
 * lazy chunk and is mounted only when the due list is non-empty.
 *
 * The seen POSTs and the session record happen once, when the sequence starts:
 * on either exit from the title card, or on mount when reduced motion skips the
 * title card. They cover EVERY due Matchup, including those beyond the cap.
 *
 * `onFinish({ overflowText })` is called once when the queue ends; the overflow
 * text is set only when the last scene was reached, not on Escape or SKIP.
 */
function PostgameStage({ cutscenes, onFinish }) {
  const reduced = useMemo(prefersReducedMotion, []);
  const plan = useMemo(() => planQueue(cutscenes), [cutscenes]);
  const [phase, setPhase] = useState(reduced ? 'scenes' : 'title');
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(() => !readPostgameSoundOn());
  const [showIntro] = useState(() => !readPostgameIntroSeen());
  const startedRef = useRef(false);
  const finishedRef = useRef(false);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  const { overlayRef, trapTab } = useOverlayFocus();

  const markStarted = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const ids = cutscenes.map((c) => c.matchupId);
    recordStartedIds(ids);
    ids.forEach((id) => {
      // Fire and forget: a failed POST only means the cutscene may show once more.
      try {
        Promise.resolve(apiClient.post(`/api/user/postgame-cutscenes/${id}/seen`)).catch(() => {});
      } catch {
        // A client that throws before returning a promise is the same failure.
      }
    });
  }, [cutscenes]);

  const finish = useCallback((reachedEnd) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    sfx.stopAll({ fadeMs: 200 });
    finishRef.current({ overflowText: reachedEnd ? plan.overflowText : null });
  }, [plan]);

  useEffect(() => {
    sfx.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    if (reduced) markStarted();
  }, [reduced, markStarted]);

  useEffect(() => {
    if (phase !== 'title') return;
    writePostgameIntroSeen();
    sfx.startLoop('title');
  }, [phase]);

  const nextScene = useCallback(() => {
    if (index + 1 < plan.scenes.length) setIndex(index + 1);
    else finish(true);
  }, [index, plan, finish]);

  useEffect(() => {
    if (phase !== 'scenes') return undefined;
    const id = setTimeout(nextScene, reduced ? REDUCED_SCENE_MS : SCENE_MS);
    return () => clearTimeout(id);
  }, [phase, index, reduced, nextScene]);

  // A card that held focus (the loss link, the title card's buttons) is removed
  // when the scene changes, which fires no focusin and would strand focus on
  // <body>, where the overlay's key handler never hears it. Take it back.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (overlay && !overlay.contains(document.activeElement)) overlay.focus();
  }, [phase, index, overlayRef]);

  const skip = () => {
    markStarted();
    finish(false);
  };

  const advance = () => {
    if (phase === 'title') {
      markStarted();
      sfx.stopAll({ fadeMs: 200 });
      setPhase('scenes');
    } else {
      nextScene();
    }
  };

  const toggleSound = () => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    writePostgameSoundOn(!nextMuted);
  };

  const onInteractive = (target) => Boolean(target && target.closest && target.closest('button, a'));

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      skip();
      return;
    }
    if (event.key === 'Tab') {
      trapTab(event);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && !onInteractive(event.target)) {
      event.preventDefault();
      advance();
    }
  };

  const handleClick = (event) => {
    if (onInteractive(event.target)) return;
    advance();
  };

  const item = plan.scenes[index];
  const label = phase === 'title' ? titleFor(cutscenes) : resultSentence(item);

  return (
    <div
      ref={overlayRef}
      className="postgame-overlay"
      role="alertdialog"
      aria-label={label}
      tabIndex={-1}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <div className="postgame-stage">
        {phase === 'title' ? (
          <TitleCard
            cutscenes={cutscenes}
            muted={muted}
            onToggleSound={toggleSound}
            onStart={advance}
            onSkip={skip}
            showIntro={showIntro}
          />
        ) : (
          <ResultCard key={item.matchupId} item={item} onLeave={() => { finish(false); }} />
        )}
        {/* Announces each scene: the overlay keeps focus across scenes, so its
            aria-label changing in place is not reliably read out. */}
        <div className="postgame-sr" aria-live="polite" data-testid="postgame-live">{phase === 'scenes' ? label : ''}</div>
        <div className="postgame-scanlines" aria-hidden="true" />
        <div className="postgame-vignette" aria-hidden="true" />
      </div>
    </div>
  );
}

PostgameStage.propTypes = {
  cutscenes: PropTypes.arrayOf(PropTypes.shape({
    matchupId: PropTypes.number.isRequired,
    leagueId: PropTypes.number,
    week: PropTypes.number,
    outcome: PropTypes.string,
    me: PropTypes.object.isRequired,
    opponent: PropTypes.object.isRequired,
  })).isRequired,
  onFinish: PropTypes.func.isRequired,
};

export default PostgameStage;
