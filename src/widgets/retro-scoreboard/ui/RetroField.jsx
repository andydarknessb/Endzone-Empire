import React, { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { Sprite, FIXED } from '../../../components/MatchupDetail/TecmoSprite';
import { FIELD_GREEN, getSpriteColors } from '../../../lib/nflTeamColors';
import { playLabel } from '../../../lib/scoringEvents';
import { initialsFor } from '../../../lib/initials';
import { homeProbability, spritePositions } from '../model/scoreboardModel';
import { LED_FONT } from './LedBoard';

/**
 * The retro field from the Scoreboard view (design canvas retroField()): one
 * inline SVG with team-color end zones (`dash-home` left, `dash-away` right),
 * yard lines and numbers, and the two Tecmo sprites placed by the home win
 * probability. There is no real field position in a fantasy matchup, so
 * "further toward the away end zone" stands in for "more likely to win": both
 * sprites slide right as the home side's chances rise, the home runner eight
 * yards ahead of the away defender (scoreboardModel.js).
 *
 * On a touchdown the scoring side's sprite dashes to its end zone in its real
 * NFL kit (getSpriteColors, the sanctioned reach into src/lib) before the
 * page's cutscene takes over; the cutscene queue itself is the page's and is
 * untouched here. A non-touchdown moment play (a sack, an interception, a
 * field goal) has no field position to dramatize, so it flashes a short LED
 * callout over the field instead, as a `role="status"` so it is announced.
 *
 * The image's accessible name states the home side's win probability only
 * when the page handed one; an unknown probability parks the sprites at
 * midfield (scoreboardModel.js) and the name says it is not yet available
 * rather than announcing a guessed 50%, the same rule the board's WIN row
 * follows when it prints a hyphen.
 *
 * Below the image, on desktop, the canvas's caption row: the sentence on the
 * left and, on the right, whatever the page slots in as `tail` (the canvas
 * draws the celebrate-touchdown feature's "Celebrations on" affordance there;
 * a widget imports no feature, so it is a slot). The mobile artboard has no
 * caption row, so on mobile the row renders only when there is a tail, and
 * then carries the tail alone.
 *
 * The callout reveals AND dismisses itself through `flashIn`, which ends at
 * opacity 0 held by `forwards`. Under reduced motion the global policy
 * (src/theme/base.css) collapses that animation to 0s, which with `forwards`
 * would pin it hidden and it would never be seen, and this callout is the only
 * channel for a moment play. So under reduced motion it renders still and a
 * timer dismisses it over the same window: the JS-timeout fallback the global
 * policy's own comment prescribes (the ternary below is the shape
 * scripts/animationSafetyJs.js recognises as the reduced-motion off-ramp).
 * The sprites' run cycle is JavaScript-driven and so outside the CSS policy's
 * reach; it holds a still frame under reduced motion for the same reason.
 *
 * Colors. The end zones, the sprites' jerseys, the callout and the labels ride
 * `dash-*` tokens (the end-zone label is `text-inverse` on the side color,
 * the pairing the position chips already use). The sprite kit is the
 * sanctioned TecmoSprite palette: the jersey is `currentColor`, inherited from
 * a `<g>` painted with the side's token, because a `var()` inside an SVG
 * presentation attribute is not honoured everywhere while `currentColor` is;
 * the gold helmet and pants and the white number stripe are the kit's own
 * FIXED colors, as the canvas draws them. The green is `FIELD_GREEN` from
 * src/lib/nflTeamColors: the one constant the NFL kits are contrast-checked
 * against, so the field a touchdown kit reads against and the field that is
 * painted are the same value (there is no field token; this is the sanctioned
 * helper's constant, not a literal). The lines and yard numbers are the
 * theme-independent `on-overlay` ink, decorative inside a labelled image.
 */
const YARD_LABELS = ['10', '20', '30', '40', '50', '40', '30', '20', '10'];
const LEG_FRAME_MS = 140;
const MOMENT_FLASH_MS = 1800;
const DASH_MS = 700;

// The canvas's two geometries (user units; the SVG scales to its container).
const DESKTOP = { w: 1072, h: 200, ez: 56, sprite: 30, homeY: 34, awayY: 86, yardY: 22, yardSize: 10, labelSize: 14 };
const MOBILE = { w: 362, h: 140, ez: 30, sprite: 18, homeY: 28, awayY: 62, yardY: 16, yardSize: 7, labelSize: 10 };

const dash = keyframes`
  from { transform: translateX(0); }
  to { transform: translateX(var(--dash-distance)); }
`;

const flashIn = keyframes`
  0% { opacity: 0; transform: translate(-50%, 0) scale(0.9); }
  15% { opacity: 1; transform: translate(-50%, 0) scale(1); }
  80% { opacity: 1; }
  100% { opacity: 0; }
`;

// The resting kit, shared by both sides: the jersey takes the side's color
// through `currentColor` (see the docblock), the helmet and pants the kit's
// gold, the number stripe its white.
const RESTING_KIT = { helmet: FIXED.Y, jersey: 'currentColor', pants: FIXED.Y, accent: FIXED.W };

// A sprite's placement is a CSS transform (not the SVG attribute) so the slide
// between two probabilities transitions; the global reduced-motion policy
// makes it instantaneous. It is inline so a test can read the placement, and
// `data-kit` says whether the sprite wears its resting kit or the real NFL
// kit of a touchdown dash.
function FieldSprite({ side, x, y, size, kit, frame, label, dashDistance, labelSize }) {
  const flip = side === 'away';
  return (
    <g
      data-testid={`sprite-${side}`}
      data-side={side}
      data-kit={dashDistance != null ? 'nfl' : 'rest'}
      style={{
        transform: `translate(${x.toFixed(1)}px, ${y}px)`,
        transition: 'transform 1.2s ease',
        color: side === 'home' ? 'var(--dash-home)' : 'var(--dash-away)',
      }}
    >
      <Box
        component="g"
        sx={dashDistance != null ? { '--dash-distance': `${dashDistance.toFixed(1)}px`, animation: `${dash} ${DASH_MS}ms ease-out forwards` } : undefined}
      >
        <g transform={flip ? 'scale(-1 1)' : undefined}>
          <svg x={-size / 2} y={0} width={size} height={size} viewBox="0 0 16 16" overflow="visible">
            <Sprite kit={kit} frame={frame} className="retro-field-sprite" />
          </svg>
        </g>
        <text
          x="0"
          y={size + labelSize + 2}
          textAnchor="middle"
          fontSize={labelSize}
          style={{ fontFamily: LED_FONT, fill: 'var(--on-overlay)' }}
        >
          {label}
        </text>
      </Box>
    </g>
  );
}

export default function RetroField({ homeName, awayName, homeProb, activePlay, mobile, tail }) {
  const g = mobile ? MOBILE : DESKTOP;
  const inner = g.w - g.ez * 2;
  const yard = (i) => g.ez + (inner / 10) * i;

  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion) return undefined;
    const id = setInterval(() => setFrame((f) => (f === 0 ? 1 : 0)), LEG_FRAME_MS);
    return () => clearInterval(id);
  }, [prefersReducedMotion]);

  const { value: prob, known: probKnown } = homeProbability(homeProb);
  const pos = spritePositions(prob);
  const homeX = g.ez + inner * pos.home;
  const awayX = g.ez + inner * pos.away;

  const isTouchdownPlay = !!activePlay && activePlay.isTouchdown !== false;
  const momentPlay = !!activePlay && activePlay.isTouchdown === false ? activePlay : null;

  const momentKey = momentPlay ? `${momentPlay.side}-${momentPlay.type}-${momentPlay.nflTeam}` : null;
  const [reducedMomentDismissed, setReducedMomentDismissed] = useState(false);
  useEffect(() => {
    if (!prefersReducedMotion || !momentKey) return undefined;
    // A fresh moment (new key) reveals the callout again, then times out.
    setReducedMomentDismissed(false);
    const timer = setTimeout(() => setReducedMomentDismissed(true), MOMENT_FLASH_MS);
    return () => clearTimeout(timer);
  }, [prefersReducedMotion, momentKey]);
  const showMomentCallout = !!momentPlay && (!prefersReducedMotion || !reducedMomentDismissed);

  const dashSide = isTouchdownPlay ? activePlay.side : null;
  const dashKit = isTouchdownPlay ? getSpriteColors(activePlay.nflTeam, activePlay.opponent).runner : null;
  // Where each side's dash ends: just inside its end zone, in user units from
  // the sprite's resting spot (negative for the away side, which runs left).
  const homeDash = dashSide === 'home' ? (g.w - g.ez - g.sprite / 2 - 4) - homeX : null;
  const awayDash = dashSide === 'away' ? (g.ez + g.sprite / 2 + 4) - awayX : null;

  const endzoneLabel = (name) => (mobile ? initialsFor(name) : (name || '').toUpperCase());
  const spriteLabel = (name) => initialsFor(name);

  return (
    <Box
      data-testid="retro-field"
      sx={{
        backgroundColor: 'var(--dash-surface)',
        border: '1px solid var(--dash-line)',
        borderRadius: 'var(--dash-radius)',
        p: mobile ? '10px' : '14px',
        overflow: 'hidden',
        color: 'var(--dash-ink)',
      }}
    >
      <Box sx={{ position: 'relative' }}>
        <svg
          role="img"
          aria-label={
            probKnown
              ? `Field position: ${homeName} ${Math.round(prob * 100)}% likely to win`
              : 'Field position: win probability not yet available'
          }
          viewBox={`0 0 ${g.w} ${g.h}`}
          width="100%"
          style={{ display: 'block', height: 'auto' }}
        >
          <rect x="0" y="0" width={g.w} height={g.h} rx="10" fill={FIELD_GREEN} />
          <rect x="0" y="0" width={g.ez} height={g.h} style={{ fill: 'var(--dash-home)' }} />
          <rect x={g.w - g.ez} y="0" width={g.ez} height={g.h} style={{ fill: 'var(--dash-away)' }} />
          {Array.from({ length: 11 }, (_, i) => (
            <line
              key={i}
              x1={yard(i).toFixed(1)}
              y1="0"
              x2={yard(i).toFixed(1)}
              y2={g.h}
              strokeWidth={i === 5 ? 2 : 1}
              style={{ stroke: 'var(--on-overlay)', opacity: 0.55 }}
            />
          ))}
          {YARD_LABELS.map((t, i) => (
            <text
              key={`${t}-${i}`}
              x={yard(i + 1).toFixed(1)}
              y={g.yardY}
              textAnchor="middle"
              fontSize={g.yardSize}
              style={{ fontFamily: LED_FONT, fill: 'var(--on-overlay)', opacity: 0.8 }}
            >
              {t}
            </text>
          ))}
          <text
            x={g.ez / 2}
            y={g.h / 2 + 4}
            textAnchor="middle"
            transform={`rotate(-90 ${g.ez / 2} ${g.h / 2})`}
            fontSize={g.labelSize}
            fontWeight="700"
            letterSpacing="0.08em"
            style={{ fontFamily: 'var(--dash-font-display)', fill: 'var(--text-inverse)' }}
          >
            {endzoneLabel(homeName)}
          </text>
          <text
            x={g.w - g.ez / 2}
            y={g.h / 2 + 4}
            textAnchor="middle"
            transform={`rotate(90 ${g.w - g.ez / 2} ${g.h / 2})`}
            fontSize={g.labelSize}
            fontWeight="700"
            letterSpacing="0.08em"
            style={{ fontFamily: 'var(--dash-font-display)', fill: 'var(--text-inverse)' }}
          >
            {endzoneLabel(awayName)}
          </text>
          <FieldSprite
            side="home"
            x={homeX}
            y={g.homeY}
            size={g.sprite}
            kit={dashSide === 'home' ? dashKit : RESTING_KIT}
            frame={frame}
            label={spriteLabel(homeName)}
            labelSize={mobile ? 6 : 7}
            dashDistance={homeDash}
          />
          <FieldSprite
            side="away"
            x={awayX}
            y={g.awayY}
            size={g.sprite}
            kit={dashSide === 'away' ? dashKit : RESTING_KIT}
            frame={frame}
            label={spriteLabel(awayName)}
            labelSize={mobile ? 6 : 7}
            dashDistance={awayDash}
          />
        </svg>

        {showMomentCallout && (
          <Box
            key={momentKey}
            role="status"
            sx={{
              position: 'absolute',
              left: '50%',
              bottom: mobile ? '8%' : '12%',
              display: 'inline-flex',
              alignItems: 'center',
              height: 22,
              px: '12px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--dash-board)',
              whiteSpace: 'nowrap',
              fontFamily: LED_FONT,
              fontSize: mobile ? '6px' : '8px',
              lineHeight: 1,
              color: 'var(--dash-led)',
              // Under reduced motion, the global policy would collapse this to
              // 0s and `forwards` would leave it hidden; skip the animation and
              // stay visible (the timer above dismisses it) so the callout is
              // seen at all. transform keeps it centred without the scale-in.
              ...(prefersReducedMotion
                ? { transform: 'translate(-50%, 0)' }
                : { animation: `${flashIn} ${MOMENT_FLASH_MS}ms ease-in-out forwards` }),
            }}
          >
            {(momentPlay.nflTeam ? `${momentPlay.nflTeam} · ` : '') + playLabel(momentPlay)}
          </Box>
        )}
      </Box>

      {(!mobile || tail) && (
        <Box
          data-testid="field-caption"
          sx={{
            mt: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            fontSize: '12px',
            color: 'var(--dash-faint)',
          }}
        >
          {!mobile && <span>Sprites move with win probability. Plays flash on the field as they land.</span>}
          {tail ? <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>{tail}</Box> : null}
        </Box>
      )}
    </Box>
  );
}
