import React from 'react';
import { Box, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { visuallyHidden } from '@mui/utils';
import { Badge, Card, SplitBar } from '../../../shared/ui';
import TeamAvatar from '../../../components/common/TeamAvatar';
import { scoreboardView } from '../model/scoreboardView';

/**
 * The scoreboard strip (widget `scoreboard-strip`, ADR 0031, #898): the
 * scoreboard card from the Game Center / Matchup design canvas
 * (docs/design/game-center-matchups/build.mjs, `stickyScoreboard` and
 * `scoreboardSide`), the one sticky element on Matchup Detail. Each side shows
 * its avatar in a team-color ring, the Team name with the "You" pill on the
 * viewer's side, the record when the page passes one down, the score in the
 * 60px display face, and Expected final and Players remaining beneath. The
 * middle column carries the status chip and, once the matchup has started,
 * both win percentages beside a SplitBar under the "Win probability" caption.
 *
 * It reads the entity model and the status view only (through
 * `model/scoreboardView`); the page passes `matchup`, `viewerTeamId` and the
 * optional `records` lookup down, the way ADR 0020's page passes shared values.
 *
 * Composes `shared/ui` (Card, Badge, SplitBar) and paints only `dash-*` tokens.
 * Every ink-on-surface pairing here is already registered in
 * tokens.contrast.test.js: ink / dim / faint on the card surface, the home and
 * away side percentages on a card, and the kit's own chip pairings. The avatar
 * ring is a box-shadow, not text, so it composes no pairing.
 *
 * Accessibility: the SplitBar is the one `role="img"` and its accessible name
 * already says "Win probability: <home> 36%, <away> 64%", so the printed
 * percentages and the caption are aria-hidden (#878, #887: one announcement
 * per surface, never two). The visible "EF" / "PMR" abbreviations are likewise
 * aria-hidden and each side carries a visually-hidden "Projected 110.5" and
 * "Players remaining 4" expansion, the captions the totals block this strip
 * replaces used to print, so a screen reader hears the full words and the
 * page's own assertions on those captions find them here. TeamAvatar is
 * aria-hidden by design (#327); the avatar is decorative here because the Team
 * name is the adjacent text, so it is not wrapped in a second named image.
 *
 * Layout: below the `md` breakpoint (where the dashboard collapses its columns
 * too) the mobile mock applies - names on one row, the scores around the bar on
 * the next, EF and PMR (with the chip between them) on a third. The layout in
 * use is exposed as `data-layout` so a test can assert which one rendered.
 */
export default function ScoreboardStrip({
  matchup,
  viewerTeamId,
  records,
  sticky = true,
  sx,
  ...rest
}) {
  // The query string is built from the theme read here (MUI's default when no
  // provider wraps the strip, as in a widget test) rather than passed as a
  // function, which useMediaQuery would only resolve under a ThemeProvider.
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('md'));
  const view = scoreboardView(matchup, { viewerTeamId, records });

  return (
    <Card
      aria-label="Scoreboard"
      data-testid="scoreboard-strip"
      data-layout={compact ? 'mobile' : 'desktop'}
      data-sticky={sticky || undefined}
      sx={{
        padding: compact ? '12px 14px' : '18px 24px',
        boxShadow: 'var(--shadow-2)',
        // Sticky below the app bar: the app bar is static, so the strip pins to
        // the viewport top once the bar scrolls off, one layer under the app
        // bar's own zIndex so its menus and drawers still cover the strip.
        ...(sticky
          ? { position: 'sticky', top: 0, zIndex: (theme) => theme.zIndex.appBar - 1 }
          : {}),
        ...sx,
      }}
      {...rest}
    >
      {compact ? <MobileLayout view={view} /> : <DesktopLayout view={view} />}
    </Card>
  );
}

// --- Desktop (stickyScoreboard / scoreboardSide in the mock) ----------------

function DesktopLayout({ view }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 200px minmax(0, 1fr)',
        gap: '20px',
        alignItems: 'center',
      }}
    >
      <DesktopSide side={view.home} tone="home" align="left" />
      <Box
        data-testid="scoreboard-center"
        sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', minWidth: 0 }}
      >
        {view.chip && <StatusChip chip={view.chip} />}
        {view.showBar && (
          <>
            <Box
              aria-hidden="true"
              data-testid="scoreboard-percentages"
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '20px',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <Box component="span" sx={{ color: 'var(--dash-home)' }}>{view.home.winPct}%</Box>
              <Box component="span" sx={{ fontSize: '12px', fontWeight: 500, color: 'var(--dash-faint)' }}>
                win
              </Box>
              <Box component="span" sx={{ color: 'var(--dash-away)' }}>{view.away.winPct}%</Box>
            </Box>
            <Box sx={{ width: '100%' }}>
              <WinBar view={view} height={10} />
            </Box>
            <Caption />
          </>
        )}
      </Box>
      <DesktopSide side={view.away} tone="away" align="right" />
    </Box>
  );
}

function DesktopSide({ side, tone, align }) {
  const end = align === 'right';
  return (
    <Box
      data-testid={`scoreboard-side-${tone}`}
      data-viewer-team={side.isViewer || undefined}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: end ? 'flex-end' : 'flex-start',
        gap: '6px',
        minWidth: 0,
        textAlign: align,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          flexDirection: end ? 'row-reverse' : 'row',
          minWidth: 0,
          maxWidth: '100%',
        }}
      >
        <RingedAvatar side={side} tone={tone} size={52} />
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            alignItems: end ? 'flex-end' : 'flex-start',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, maxWidth: '100%' }}>
            <TeamName name={side.name} size={22} />
            {side.isViewer && <YouPill />}
          </Box>
          {side.record && <Record value={side.record} />}
        </Box>
      </Box>
      <Score value={side.score} size={60} />
      <Figures side={side} />
    </Box>
  );
}

// --- Mobile (stickyScoreboardMobile in the mock) ----------------------------

function MobileLayout({ view }) {
  return (
    <>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: '10px',
          alignItems: 'center',
        }}
      >
        <MobileIdentity side={view.home} tone="home" align="left" />
        <MobileIdentity side={view.away} tone="away" align="right" />
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'auto minmax(0, 1fr) auto',
          gap: '14px',
          alignItems: 'center',
          mt: '10px',
        }}
      >
        <Score value={view.home.score} size={44} />
        <Box
          data-testid="scoreboard-center"
          sx={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}
        >
          {view.showBar && (
            <>
              <Box
                aria-hidden="true"
                data-testid="scoreboard-percentages"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '13px',
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                <Box component="span" sx={{ color: 'var(--dash-home)' }}>{view.home.winPct}%</Box>
                <Box component="span" sx={LABEL_SX}>Win</Box>
                <Box component="span" sx={{ color: 'var(--dash-away)' }}>{view.away.winPct}%</Box>
              </Box>
              <WinBar view={view} height={6} />
            </>
          )}
        </Box>
        <Score value={view.away.score} size={44} />
      </Box>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          mt: '8px',
        }}
      >
        <Figures side={view.home} joined />
        {view.chip && <StatusChip chip={view.chip} />}
        <Figures side={view.away} joined />
      </Box>
    </>
  );
}

function MobileIdentity({ side, tone, align }) {
  const end = align === 'right';
  return (
    <Box
      data-testid={`scoreboard-side-${tone}`}
      data-viewer-team={side.isViewer || undefined}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minWidth: 0,
        flexDirection: end ? 'row-reverse' : 'row',
        textAlign: align,
      }}
    >
      <RingedAvatar side={side} tone={tone} size={36} />
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          alignItems: end ? 'flex-end' : 'flex-start',
        }}
      >
        <TeamName name={side.name} size={16} />
        {(side.record || side.isViewer) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {side.record && <Record value={side.record} />}
            {side.isViewer && <YouPill />}
          </Box>
        )}
      </Box>
    </Box>
  );
}

// --- Pieces -----------------------------------------------------------------

// The mock's `.label`: the small uppercase faint caption.
const LABEL_SX = {
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--dash-faint)',
};

// Team-color ring per side: the home hue on the left, the away hue on the right
// (the mock's `avatar(..., ring)`), with a 2px offset in the card's own surface
// so the ring reads as a ring and not a border.
const RING = {
  home: 'var(--dash-home)',
  away: 'var(--dash-away)',
};

function RingedAvatar({ side, tone, size }) {
  return (
    <Box
      data-testid="scoreboard-avatar"
      sx={{
        flex: 'none',
        display: 'flex',
        borderRadius: 'var(--radius-pill)',
        boxShadow: `0 0 0 2px var(--dash-surface), 0 0 0 4px ${RING[tone]}`,
      }}
    >
      <TeamAvatar
        name={side.name}
        avatarUrl={side.avatarUrl}
        avatarStaticUrl={side.avatarStaticUrl}
        size={size}
      />
    </Box>
  );
}

function TeamName({ name, size }) {
  return (
    <Typography
      component="span"
      sx={{
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontFamily: 'var(--dash-font-display)',
        fontSize: `${size}px`,
        fontWeight: 700,
        lineHeight: 1.1,
        color: 'var(--dash-ink)',
      }}
    >
      {name}
    </Typography>
  );
}

function YouPill() {
  return (
    <Badge variant="you" data-testid="scoreboard-you">
      You
    </Badge>
  );
}

function Record({ value }) {
  return (
    <Typography
      component="span"
      sx={{ fontSize: '12px', color: 'var(--dash-faint)', fontVariantNumeric: 'tabular-nums' }}
    >
      {value}
    </Typography>
  );
}

function Score({ value, size }) {
  return (
    <Typography
      component="div"
      data-testid="scoreboard-score"
      sx={{
        fontFamily: 'var(--dash-font-display)',
        fontSize: `${size}px`,
        fontWeight: 700,
        lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--dash-ink)',
      }}
    >
      {value}
    </Typography>
  );
}

// The canvas's statusChip(): the variant per status from the view model (LIVE
// on the danger tint with the dot, Final success, Awaiting final warning,
// Scheduled neutral), the same chip the page header wears (#903 review).
function StatusChip({ chip }) {
  return (
    <Badge variant={chip.variant} dot={chip.dot} data-testid="scoreboard-status">
      {chip.label}
    </Badge>
  );
}

function WinBar({ view, height }) {
  return (
    <SplitBar
      data-testid="scoreboard-split-bar"
      homeName={view.home.name}
      awayName={view.away.name}
      homeShare={view.homeShare}
      height={height}
    />
  );
}

// The caption carries no time claim (#872: "Win probability" in every started
// state) and is aria-hidden (#878: the bar's own label is the sole name).
function Caption() {
  return (
    <Typography
      component="span"
      aria-hidden="true"
      sx={{ fontSize: '12px', color: 'var(--dash-faint)' }}
    >
      Win probability
    </Typography>
  );
}

/**
 * Expected final and Players remaining under a side. The visible line is the
 * mock's abbreviated copy ("EF 110.5 · PMR 4", two spans on desktop, one joined
 * span on mobile) with the figures in ink on the dim label; a missing figure is
 * a dash. It is aria-hidden, and the two visually-hidden expansions carry the
 * full captions ("Projected 110.5", "Players remaining 4") in their place.
 */
function Figures({ side, joined = false }) {
  const ef = side.expectedFinal;
  const pmr = side.playersRemaining;
  return (
    <Box
      data-testid="scoreboard-figures"
      sx={{ fontSize: '12px', color: 'var(--dash-dim)', fontVariantNumeric: 'tabular-nums', minWidth: 0 }}
    >
      {joined ? (
        <Box component="span" aria-hidden="true" sx={{ whiteSpace: 'nowrap' }}>
          EF <Figure value={ef} /> · PMR <Figure value={pmr} />
        </Box>
      ) : (
        <Box
          component="span"
          aria-hidden="true"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: '10px', whiteSpace: 'nowrap' }}
        >
          <span>
            EF <Figure value={ef} />
          </span>
          <span>
            PMR <Figure value={pmr} />
          </span>
        </Box>
      )}
      <Box component="span" sx={visuallyHidden}>
        Projected {ef ?? 'not available'}
      </Box>
      <Box component="span" sx={visuallyHidden}>
        Players remaining {pmr ?? 'not available'}
      </Box>
    </Box>
  );
}

function Figure({ value }) {
  return (
    <Box component="strong" sx={{ fontWeight: 700, color: 'var(--dash-ink)' }}>
      {value ?? '-'}
    </Box>
  );
}
