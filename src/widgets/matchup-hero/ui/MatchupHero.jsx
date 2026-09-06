import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { Link as RouterLink } from 'react-router-dom';
import { Card, Badge, StatTile, SplitBar } from '../../../shared/ui';
import TeamAvatar from '../../../components/common/TeamAvatar';
import { teamNameLabel } from '../../../lib/teamIdentity';
import { matchupHeroView, formatKickoff, ordinal } from '../model/matchupHeroView';

/**
 * The "Your matchup" card (ticket #893, ADR 0031): the viewer's Matchup on
 * Game Center, transcribed from the canvas's heroCard() / heroCardMobile()
 * (docs/design/game-center-matchups/build.mjs). Home on the left, away on the
 * right, the way SplitBar encodes the two sides; the You pill sits on the side
 * whose Team id is the viewer's, never on a fixed side (#112).
 *
 * Each side: a 64px avatar (44px on a phone) in a team-color ring over a
 * page-background halo, the Team name in the display face with the record and
 * rank beneath (from the `records` / `ranks` lookups the page passes down,
 * since a Team's record does not join the wire - ADR 0031's ruling), the score
 * at 56px tabular (34px on a phone), then Expected final and PMR as StatTiles.
 * On desktop the away side hugs the right edge with its avatar outboard, as
 * the canvas draws it, but reads left to right like the home side (name, then
 * the pill; Expected final, then PMR): only the avatar row mirrors. The
 * middle, once the Matchup has started, is the win probability: a per-side
 * percentage beside a SplitBar and one plain sentence from the viewer's side
 * (on a phone the label sits between the two percentages, as the mobile
 * artboard draws it; the tiles and the full sentence stay). Before kickoff
 * (`hasStarted === false`) the middle reads the kickoff time from
 * `firstKickoffAt` (#892) and there is no bar; on an unknown status the
 * middle asserts neither. The footer carries the games-in-progress and
 * next-kickoff lines the page supplies, and the two actions: Compare rosters
 * to the Matchup, Set lineup to the Lineup page (ADR 0019: Lineup is the sole
 * team management surface).
 *
 * Props:
 *   - `matchup`: the entity model (`entities/matchup`), read only.
 *   - `viewerTeamId`: the viewer's Team id (per-viewer channel, never a
 *     broadcast field).
 *   - `records`: `{ [teamId]: '2-0' }` or null; `ranks`: `{ [teamId]: 3 }`
 *     or null. A side with neither renders no secondary line.
 *   - `leagueId`: for the two action routes.
 *   - `gamesInProgress`: a count or null; `nextKickoffAt`: ISO or null. Each
 *     footer line renders only when its value is supplied.
 *   - `headingLevel`: the Card title's heading level (default 2).
 *
 * Composes `shared/ui` (ADR 0020) and paints only `dash-*` tokens. Pairings
 * registered in tokens.contrast.test.js: ink / dim / faint on the card, the
 * home and away hues on the card (the percentages), faint and ink on the stat
 * tile (StatTile), the You pill on the accent tint over the card, the status
 * chip's danger / success / warning text on its tint over the card (the
 * canvas's statusChip(); each tinted Badge is guarded over `dash-surface`
 * only, which is what a Card paints), and the primary button's
 * `dash-on-accent` on `dash-accent`. One DOM serves both
 * sizes: the sides restack through grid areas at the `md` breakpoint and the
 * actions stretch to full width with a 44px hit target below it, so no
 * media-query JS runs and the tree a test sees is the tree a phone gets.
 */
export default function MatchupHero({
  matchup,
  viewerTeamId,
  records = null,
  ranks = null,
  leagueId,
  gamesInProgress = null,
  nextKickoffAt = null,
  headingLevel = 2,
  sx,
  ...rest
}) {
  const view = matchupHeroView(matchup, viewerTeamId);
  const home = matchup?.home || {};
  const away = matchup?.away || {};
  const homeName = teamNameLabel(home.name);
  const awayName = teamNameLabel(away.name);
  const week = matchup?.week;

  const gamesLine = gamesInProgressLabel(gamesInProgress);
  const nextKickoff = formatKickoff(nextKickoffAt);

  return (
    <Card
      data-testid="matchup-hero"
      title="Your matchup"
      count={week != null ? `Week ${week}` : undefined}
      tail={
        view.chipLabel ? (
          <Badge variant={view.chipVariant} data-testid="matchup-hero-status">
            {view.chipDot && <Dot />}
            {view.chipLabel}
          </Badge>
        ) : undefined
      }
      headingLevel={headingLevel}
      sx={sx}
      {...rest}
    >
      <Box sx={{ px: { xs: '14px', md: '24px' }, pt: { xs: '12px', md: '16px' }, pb: { xs: '12px', md: '16px' } }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) 220px minmax(0, 1fr)' },
            gap: { xs: '12px', md: '24px' },
            alignItems: 'center',
          }}
        >
          <HeroSide
            sideKey="home"
            side={home}
            name={homeName}
            isViewer={view.viewerSide === 'home'}
            records={records}
            ranks={ranks}
          />

          {/* On a phone the middle drops beneath both sides (visual order
              only; nothing in the sides or the middle takes focus, so the
              reading order is unchanged). */}
          <Box sx={{ order: { xs: 2, md: 0 }, minWidth: 0 }}>
            {view.hasStarted === true && (
              <WinProbability view={view} homeName={homeName} awayName={awayName} />
            )}
            {view.hasStarted === false && <Kickoff kickoff={view.kickoff} />}
            {view.hasStarted == null && (
              <Typography
                component="div"
                aria-hidden="true"
                sx={{
                  textAlign: 'center',
                  fontFamily: 'var(--dash-font-display)',
                  fontSize: '16px',
                  fontWeight: 600,
                  color: 'var(--dash-faint)',
                }}
              >
                vs
              </Typography>
            )}
          </Box>

          <HeroSide
            sideKey="away"
            side={away}
            name={awayName}
            isViewer={view.viewerSide === 'away'}
            records={records}
            ranks={ranks}
          />
        </Box>

        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
            mt: { xs: '12px', md: '16px' },
            pt: '12px',
            borderTop: '1px solid var(--dash-line)',
          }}
        >
          {(gamesLine || nextKickoff) && (
            <Box
              data-testid="matchup-hero-footer-facts"
              sx={{ display: 'flex', flexWrap: 'wrap', gap: '14px', fontSize: '13px', color: 'var(--dash-dim)' }}
            >
              {gamesLine && (
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--dash-dim)' }}>
                  <Box component="span" sx={{ display: 'inline-flex', color: 'var(--dash-accent)' }}>
                    <Dot />
                  </Box>
                  {gamesLine}
                </Box>
              )}
              {nextKickoff && (
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <ClockIcon />
                  {`Next kickoff ${nextKickoff}`}
                </Box>
              )}
            </Box>
          )}
          <Box
            sx={{
              display: 'flex',
              gap: { xs: '8px', md: '10px' },
              flex: { xs: '1 1 100%', md: '0 0 auto' },
              marginLeft: { md: 'auto' },
            }}
          >
            <Button
              component={RouterLink}
              to={`/league/${leagueId}/matchups/${matchup?.id}`}
              disableElevation
              sx={GHOST_SX}
            >
              Compare rosters
            </Button>
            <Button
              component={RouterLink}
              to={`/league/${leagueId}/lineup`}
              disableElevation
              sx={PRIMARY_SX}
            >
              Set lineup
            </Button>
          </Box>
        </Box>
      </Box>
    </Card>
  );
}

// The same component under its name, for `import { MatchupHero }`.
export { MatchupHero };

/**
 * One side of the card. A CSS grid with two templates: on `md` and up the
 * canvas's desktop column (identity row, score, tiles), below it the mobile
 * row (avatar, name and note, score at the end) with the tiles beneath. On
 * desktop the away side aligns to the right and only its avatar row reverses
 * (avatar outboard); the name row and the tiles keep the home side's reading
 * order, as the canvas's heroSide() draws them.
 */
function HeroSide({ sideKey, side, name, isViewer, records, ranks }) {
  const right = sideKey === 'away';
  const record = records ? records[side.teamId] : null;
  const rankText = ranks ? rankLabel(ranks[side.teamId]) : null;
  const secondary = [record, rankText].filter(Boolean).join(' · ') || null;
  const ring = right ? 'var(--dash-away)' : 'var(--dash-home)';
  const desktopAlign = right ? 'end' : 'start';

  return (
    <Box
      data-testid={`matchup-hero-side-${sideKey}`}
      data-viewer-team={isViewer || undefined}
      sx={{
        display: 'grid',
        gridTemplateAreas: { xs: '"identity score" "tiles tiles"', md: '"identity" "score" "tiles"' },
        gridTemplateColumns: { xs: 'minmax(0, 1fr) auto', md: 'minmax(0, 1fr)' },
        alignItems: 'center',
        columnGap: '12px',
        rowGap: { xs: '6px', md: '8px' },
        minWidth: 0,
        justifyItems: { xs: 'start', md: desktopAlign },
        textAlign: { xs: 'left', md: right ? 'right' : 'left' },
      }}
    >
      <Box
        sx={{
          gridArea: 'identity',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          minWidth: 0,
          maxWidth: '100%',
          flexDirection: { xs: 'row', md: right ? 'row-reverse' : 'row' },
        }}
      >
        {/* The avatar carries the Team name as its accessible name. TeamAvatar
            is deliberately aria-hidden (#327), so the name rides on this
            wrapper's role="img"; the ring is the side's hue over the card. */}
        <Box
          role="img"
          aria-label={name}
          sx={{
            flex: 'none',
            display: 'flex',
            borderRadius: 'var(--radius-pill)',
            boxShadow: `0 0 0 2px var(--dash-bg), 0 0 0 4px ${ring}`,
            '& .MuiAvatar-root': {
              width: { xs: 44, md: 64 },
              height: { xs: 44, md: 64 },
              fontSize: { xs: '17.6px', md: '25.6px' },
            },
          }}
        >
          <TeamAvatar
            name={name}
            avatarUrl={side.avatarUrl}
            avatarStaticUrl={side.avatarStaticUrl}
            size={64}
          />
        </Box>
        <Box
          sx={{
            minWidth: 0,
            display: 'grid',
            gap: '2px',
            justifyItems: { xs: 'start', md: desktopAlign },
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: { xs: '6px', md: '8px' },
              minWidth: 0,
              maxWidth: '100%',
            }}
          >
            <Typography
              component="div"
              data-testid="matchup-hero-name"
              sx={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontFamily: 'var(--dash-font-display)',
                fontSize: { xs: '18px', md: '22px' },
                fontWeight: 700,
                letterSpacing: '0.02em',
                lineHeight: 1.1,
                color: 'var(--dash-ink)',
              }}
            >
              {name}
            </Typography>
            {isViewer && <Badge variant="you">You</Badge>}
          </Box>
          {secondary && (
            <Typography
              component="div"
              data-testid="matchup-hero-record"
              sx={{ fontSize: '12px', fontVariantNumeric: 'tabular-nums', color: 'var(--dash-faint)' }}
            >
              {secondary}
            </Typography>
          )}
        </Box>
      </Box>

      <Typography
        component="div"
        data-testid="matchup-hero-score"
        sx={{
          gridArea: 'score',
          fontFamily: 'var(--dash-font-display)',
          fontSize: { xs: '34px', md: '56px' },
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
          letterSpacing: '0.01em',
          color: 'var(--dash-ink)',
        }}
      >
        {scoreLabel(side.score)}
      </Typography>

      <Box
        sx={{
          gridArea: 'tiles',
          display: 'flex',
          gap: '8px',
        }}
      >
        <StatTile
          label="Expected final"
          value={figureOrPlaceholder(side.expectedFinal, 1)}
          align={right ? 'end' : 'start'}
          sx={{ minWidth: 88 }}
          data-testid="matchup-hero-expected-final"
        />
        {/* The eye reads the canvas's "PMR"; assistive tech reads the
            expansion, so the tile is heard as "Players remaining 4". */}
        <StatTile
          label={
            <>
              <Box component="span" aria-hidden="true">PMR</Box>
              <Box component="span" sx={visuallyHidden}>Players remaining</Box>
            </>
          }
          value={figureOrPlaceholder(side.playersRemaining, 0)}
          align={right ? 'end' : 'start'}
          sx={{ minWidth: 64 }}
          data-testid="matchup-hero-pmr"
        />
      </Box>
    </Box>
  );
}

/**
 * The started middle: the label, the two percentages, the SplitBar and the
 * sentence, on one grid with two area templates. Desktop (heroCard) stacks
 * the label above a centred percentage row with a "vs" between the figures at
 * 22px; a phone (heroCardMobile) puts the label between the two percentages on
 * one row at 13px, ends out, with no "vs". The bar's own accessible name
 * already carries both names and both percentages, so the label, the
 * percentages and the "vs" are aria-hidden (#878: a screen reader hears the
 * numbers once, from the bar); the sentence stays in the tree because it says
 * something the bar does not.
 */
function WinProbability({ view, homeName, awayName }) {
  const { homeShare, homePct, awayPct } = view.winProbability;
  return (
    <Box
      data-testid="matchup-hero-win-probability"
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: 'auto minmax(0, 1fr) auto',
          md: 'minmax(0, 1fr) auto minmax(0, 1fr)',
        },
        gridTemplateAreas: {
          xs: '"home label away" "bar bar bar" "sentence sentence sentence"',
          md: '"label label label" "home vs away" "bar bar bar" "sentence sentence sentence"',
        },
        columnGap: '12px',
        rowGap: { xs: '6px', md: '10px' },
      }}
    >
      <Typography
        component="span"
        aria-hidden="true"
        sx={{ ...LABEL_SX, gridArea: 'label', justifySelf: 'center', alignSelf: 'baseline' }}
      >
        Win probability
      </Typography>
      <Box
        component="span"
        aria-hidden="true"
        data-testid="matchup-hero-home-pct"
        sx={{
          ...PCT_SX,
          gridArea: 'home',
          justifySelf: { xs: 'start', md: 'end' },
          color: 'var(--dash-home)',
        }}
      >
        {`${homePct}%`}
      </Box>
      <Box
        component="span"
        aria-hidden="true"
        sx={{
          gridArea: 'vs',
          display: { xs: 'none', md: 'inline' },
          justifySelf: 'center',
          alignSelf: 'baseline',
          fontSize: '14px',
          fontWeight: 500,
          color: 'var(--dash-faint)',
        }}
      >
        vs
      </Box>
      <Box
        component="span"
        aria-hidden="true"
        data-testid="matchup-hero-away-pct"
        sx={{
          ...PCT_SX,
          gridArea: 'away',
          justifySelf: { xs: 'end', md: 'start' },
          color: 'var(--dash-away)',
        }}
      >
        {`${awayPct}%`}
      </Box>
      <Box sx={{ gridArea: 'bar', width: '100%' }}>
        <SplitBar
          homeName={homeName}
          awayName={awayName}
          homeShare={homeShare}
          height={10}
          sx={{ height: { xs: 8, md: 10 } }}
        />
      </Box>
      <Typography
        component="p"
        data-testid="matchup-hero-sentence"
        sx={{ gridArea: 'sentence', m: 0, fontSize: '12px', textAlign: 'center', color: 'var(--dash-faint)' }}
      >
        {view.sentence}
      </Typography>
    </Box>
  );
}

/** The pre-kickoff middle: the kickoff time in the display face, no bar. */
function Kickoff({ kickoff }) {
  return (
    <Box
      data-testid="matchup-hero-kickoff"
      sx={{ display: 'grid', gap: '4px', justifyItems: 'center', textAlign: 'center' }}
    >
      <Typography component="span" sx={LABEL_SX}>
        Kickoff
      </Typography>
      <Typography
        component="span"
        sx={{
          fontFamily: 'var(--dash-font-display)',
          fontSize: '22px',
          fontWeight: 700,
          lineHeight: 1.1,
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--dash-ink)',
        }}
      >
        {kickoff ?? 'TBD'}
      </Typography>
    </Box>
  );
}

/** A score to a tenth; a missing score reads 0.0, as the old hero read it. */
function scoreLabel(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(1) : '0.0';
}

/**
 * A tile figure to `digits` decimals, or the placeholder: a dash for the eye
 * (aria-hidden) and a visually hidden "Not available" for a screen reader,
 * which would otherwise hear the label pointing at nothing.
 */
function figureOrPlaceholder(value, digits) {
  const known = value != null && value !== '' && Number.isFinite(Number(value));
  if (known) return Number(value).toFixed(digits);
  return (
    <>
      <Box component="span" aria-hidden="true" sx={{ color: 'var(--dash-dim)' }}>
        -
      </Box>
      <Box component="span" sx={visuallyHidden}>
        Not available
      </Box>
    </>
  );
}

function rankLabel(rank) {
  const ord = ordinal(rank);
  return ord ? `${ord} in league` : null;
}

function gamesInProgressLabel(count) {
  if (count == null || !Number.isFinite(Number(count))) return null;
  const n = Math.max(0, Math.trunc(Number(count)));
  if (n === 0) return 'No games in progress';
  return n === 1 ? '1 game in progress' : `${n} games in progress`;
}

/** The 8px status dot, in the current text colour (decorative). */
function Dot() {
  return (
    <Box
      component="span"
      aria-hidden="true"
      sx={{
        display: 'inline-block',
        width: 8,
        height: 8,
        mr: '6px',
        borderRadius: 'var(--radius-pill)',
        backgroundColor: 'currentColor',
        flex: 'none',
        verticalAlign: 'middle',
      }}
    />
  );
}

/** The canvas's clock glyph: inline stroke SVG on the 20px grid, decorative. */
function ClockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l3 2" />
    </svg>
  );
}

const LABEL_SX = {
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--dash-faint)',
};

// The win probability percentages: 22px in the desktop row (heroCard), 13px
// on the phone row that carries the label between them (heroCardMobile).
const PCT_SX = {
  fontVariantNumeric: 'tabular-nums',
  fontSize: { xs: '13px', md: '22px' },
  fontWeight: 700,
  lineHeight: 1.2,
  alignSelf: 'baseline',
};

// The canvas's `.btn`: 38px tall on desktop, stretched to the row with a 44px
// hit target below `md`.
const BUTTON_BASE = {
  textTransform: 'none',
  fontSize: '13px',
  fontWeight: 600,
  lineHeight: 1.2,
  borderRadius: '9px',
  padding: '0 16px',
  minWidth: 0,
  minHeight: { xs: 44, md: 38 },
  flex: { xs: '1 1 0', md: 'none' },
  border: '1px solid var(--dash-line-strong)',
  whiteSpace: 'nowrap',
};

// Ghost look: dim label on the card surface (a registered pairing), a hairline
// border, no fill.
const GHOST_SX = {
  ...BUTTON_BASE,
  color: 'var(--dash-dim)',
  backgroundColor: 'transparent',
  '&:hover': {
    color: 'var(--dash-ink)',
    borderColor: 'var(--dash-accent-line)',
    backgroundColor: 'transparent',
  },
};

// Primary look: the `dash-on-accent` label on the `dash-accent` fill (the
// registered "dashboard primary button label on accent" pairing).
const PRIMARY_SX = {
  ...BUTTON_BASE,
  color: 'var(--dash-on-accent)',
  backgroundColor: 'var(--dash-accent)',
  borderColor: 'var(--dash-accent)',
  '&:hover': { backgroundColor: 'var(--dash-accent)', filter: 'brightness(1.08)' },
};
