import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { Link as RouterLink } from 'react-router-dom';
import { Badge, Card, Skeleton, SplitBar, StatTile } from '../../../shared/ui';
import TeamAvatar from '../../../components/common/TeamAvatar';
import useMatchupPreview from '../model/useMatchupPreview';

/**
 * League Dashboard hero-right widget (ticket #640): the viewer's own Team and
 * this week's opponent side by side, each with an avatar, Team name, a figure
 * in the display slot and a label, split by a "VS" divider, and two footer
 * actions ("Compare rosters" to the matchup detail, "Set Lineup" to the lineup
 * page) rendered as MUI Buttons that are router links.
 *
 * The card has two faces, and which one it wears is the server's `status`, read
 * through the entity predicate in the model (ADR 0030), never inferred here:
 *
 *   - BEFORE kickoff (and on an unknown status, which asserts neither state):
 *     the display slot holds each side's projected total under a "Projected"
 *     label, plus one caption naming which way the projections lean.
 *   - ONCE STARTED: the display slot holds the live score, the projection is
 *     demoted to an "Expected final" stat tile beside a Players remaining tile,
 *     the header carries the status Badge, and a SplitBar under the pairing
 *     shows the win probability. That bar is fed by `matchupWinProbability`,
 *     the same helper Game Center's hero reads, so the two surfaces cannot
 *     disagree; it is never given a points ratio, whose accessible name
 *     ("Win probability", #872) would then be a false claim.
 *
 * Composes `shared/ui` (ADR 0020) and paints only `dash-*` tokens. Every
 * ink-on-surface pairing it renders is already registered in
 * tokens.contrast.test.js: ink / dim / faint on the card surface, the three
 * status Badge tints over a card (danger / warning / success), the stat tile's
 * faint-and-ink pair, and the primary button's `dash-on-accent` label on the
 * `dash-accent` fill (the "dashboard primary button label on accent" pairing).
 * No new pairing is composed here.
 *
 * The matchups-list read is the card's spine: while it is in flight the card
 * holds its layout with skeletons, and if it fails the card shows one compact,
 * self-contained error and nothing else, so a failed read never touches the
 * rest of the page. Each side's projected total prefers the list row's own
 * value and falls back to a chained detail read only when the list could not
 * answer both sides (#670; see useMatchupPreview.js for the condition). While
 * that fallback is in flight each number is skeletoned and the card stays
 * aria-busy; when the list already answered, nothing is in flight and the card
 * is never busy on the totals' account. Either way, a miss or a failed detail
 * read degrades just that number to a placeholder without erroring the card.
 */
export default function MatchupPreview({ leagueId }) {
  const { week, status, busy, matchupId, viewer, opponent, game } = useMatchupPreview(leagueId);
  const title = week != null ? `Week ${week} Matchup` : 'Matchup';
  const started = game.hasStarted === true;

  // The card is the region that owns these fetches (Skeleton.jsx: the loading
  // state is announced by the owning card, not by each aria-hidden shape), so
  // it carries aria-busy while the reads that hold its layout with skeletons are
  // still loading.
  return (
    <Card
      data-testid="matchup-preview"
      title={title}
      // Once the week has started the status is the header's news; the
      // projection note is not (the projections have stopped being the
      // headline figure). The Badge renders as a span so it nests legally
      // inside the header's own inline tail slot.
      tail={
        started && game.chipLabel != null ? (
          <Badge
            component="span"
            data-testid="matchup-preview-status"
            variant={game.chipVariant}
            dot={game.chipDot}
          >
            {game.chipLabel}
          </Badge>
        ) : (
          'Projections update daily'
        )
      }
      aria-busy={busy}
    >
      {status === 'loading' && <VersusSkeleton />}

      {status === 'error' && (
        <Box sx={{ p: 2.25 }}>
          <Typography
            role="alert"
            data-testid="matchup-preview-error"
            sx={{ fontSize: '13px', color: 'var(--dash-ink)' }}
          >
            We could not load this week&apos;s matchup right now.
          </Typography>
        </Box>
      )}

      {status === 'empty' && (
        <Box sx={{ p: 2.25 }}>
          <Typography sx={{ fontSize: '14px', color: 'var(--dash-dim)' }}>
            No matchup this week
          </Typography>
        </Box>
      )}

      {status === 'ready' && (
        <>
          <Box sx={{ p: 2.25, display: 'grid', gap: 1.75 }}>
            <Box data-testid="matchup-versus" sx={VERSUS_SX}>
              <Side testid="matchup-side-viewer" side={viewer} started={started} />
              <Box sx={VS_PILL_SX}>VS</Box>
              <Side testid="matchup-side-opponent" side={opponent} started={started} />
            </Box>

            {game.winProbability && (
              <WinProbability
                winProbability={game.winProbability}
                viewerName={viewer.name}
                opponentName={opponent.name}
              />
            )}

            {game.projectedMargin != null && (
              <Typography
                component="p"
                data-testid="matchup-projected-margin"
                sx={{ m: 0, fontSize: '12px', textAlign: 'center', color: 'var(--dash-faint)' }}
              >
                {game.projectedMargin}
              </Typography>
            )}
          </Box>

          <Box
            sx={{
              display: 'flex',
              gap: '10px',
              justifyContent: 'flex-end',
              alignItems: 'center',
              p: '14px 18px',
              borderTop: '1px solid var(--dash-line)',
            }}
          >
            <Button
              component={RouterLink}
              to={`/league/${leagueId}/matchups/${matchupId}`}
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
              Set Lineup
            </Button>
          </Box>
        </>
      )}
    </Card>
  );
}

// The versus block. One column on a phone, where two 125px columns ellipsised
// both Team names; the mockup's three columns from `sm` up. The pill has to
// claim its own centre in the one-column case or it stretches into a
// full-width bar.
const VERSUS_SX = {
  display: 'grid',
  gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: '1fr auto 1fr' },
  alignItems: 'center',
  gap: 1.5,
};

const VS_PILL_SX = {
  justifySelf: 'center',
  fontFamily: 'var(--dash-font-display)',
  fontSize: '16px',
  fontWeight: 600,
  color: 'var(--dash-faint)',
  border: '1px solid var(--dash-line)',
  borderRadius: 'var(--radius-pill)',
  px: 1.5,
  py: 0.75,
};

// The canvas's `.btn`, matching the evolved twin on the Matchup page's hero
// (MatchupHero.jsx): 38px tall on desktop, stretched to the row with a 44px
// hit target below `md`, which also splits the two buttons across the row
// instead of leaving them 10px apart under the same thumb.
const BUTTON_BASE = {
  textTransform: 'none',
  fontSize: '13px',
  fontWeight: 600,
  lineHeight: 1.2,
  borderRadius: '9px',
  padding: '9px 16px',
  minWidth: 0,
  minHeight: { xs: 44, md: 38 },
  flex: { xs: '1 1 0', md: 'none' },
  border: '1px solid var(--dash-line-strong)',
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
// The hover is a `filter`, which the app theme's MuiButton transition does not
// cover, so the primary snapped while the ghost beside it eased.
const PRIMARY_SX = {
  ...BUTTON_BASE,
  color: 'var(--dash-on-accent)',
  backgroundColor: 'var(--dash-accent)',
  borderColor: 'var(--dash-accent)',
  transition: 'filter var(--transition-fast)',
  '&:hover': { backgroundColor: 'var(--dash-accent)', filter: 'brightness(1.08)' },
};

// One side of the versus block: avatar, Team name, the display figure and its
// label, and once the game is on, the two stat tiles the score displaced.
function Side({ testid, side, started }) {
  return (
    <Box
      data-testid={testid}
      sx={{ display: 'grid', gap: 0.75, justifyItems: 'center', textAlign: 'center', minWidth: 0 }}
    >
      {/* The avatar carries the Team name as its accessible name. TeamAvatar is
          deliberately aria-hidden (#327), so the name rides on this wrapper's
          role="img"; the visible name text sits below it. */}
      <Box role="img" aria-label={side.name} sx={{ flex: 'none', display: 'flex' }}>
        <TeamAvatar
          name={side.name}
          avatarUrl={side.avatarUrl}
          avatarStaticUrl={side.avatarStaticUrl}
          size={44}
        />
      </Box>
      <Typography
        component="div"
        sx={{
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: '14px',
          fontWeight: 600,
          color: 'var(--dash-ink)',
        }}
      >
        {side.name}
      </Typography>
      {started ? (
        <Figure data-testid="matchup-side-score">
          {side.score != null ? side.score : <Placeholder />}
        </Figure>
      ) : (
        <ProjectedValue projected={side.projected} />
      )}
      <Box sx={LABEL_SX}>{started ? 'Score' : 'Projected'}</Box>
      {started && <SideTiles side={side} />}
    </Box>
  );
}

// The two tiles a started side carries under its score. Each is dropped when
// its figure is absent rather than printing a dash: a final Matchup has no
// projection and nobody left to play BY DESIGN (its score is the result), so a
// tile there would mark a gap that is not one.
//
// They stack rather than sitting side by side: this card is about 310px wide at
// the md breakpoint, where two tiles in one row would each be under 50px.
// `overflow: hidden` is the clip that pairs with StatTile's own zero minimum,
// and the wrapping label span overrides the tile label's nowrap so a narrow
// tile breaks the words instead of pushing them onto the neighbouring side
// (#916/#917/#919/#921).
function SideTiles({ side }) {
  return (
    <Box sx={{ display: 'grid', gap: '6px', width: '100%', mt: 0.25 }}>
      {side.projected.value != null && (
        <StatTile
          data-testid="matchup-expected-final"
          align="center"
          sx={{ overflow: 'hidden' }}
          label={
            <Box component="span" sx={{ whiteSpace: 'normal' }}>
              Expected final
            </Box>
          }
          value={side.projected.value}
        />
      )}
      {side.playersRemaining != null && (
        <StatTile
          data-testid="matchup-players-remaining"
          align="center"
          sx={{ overflow: 'hidden' }}
          // "PMR" is the canvas's abbreviation and the Matchup page's (#897);
          // the expansion carries the meaning to assistive tech, so a screen
          // reader hears "Players remaining 4" and never the initialism.
          label={
            <>
              <Box component="span" sx={visuallyHidden}>
                Players remaining
              </Box>
              <Box component="span" aria-hidden="true">
                PMR
              </Box>
            </>
          }
          value={side.playersRemaining}
        />
      )}
    </Box>
  );
}

// The two percentages, the caption and the bar. The bar's own accessible name
// already carries both Team names and both percentages, so the caption and the
// figures beside it are aria-hidden (#878: a screen reader hears the split
// once, from the bar). The viewer is passed as SplitBar's HOME side because
// this card lays the viewer out on the left, where the bar paints `homeShare`.
function WinProbability({ winProbability, viewerName, opponentName }) {
  const { viewerShare, viewerPct, opponentPct } = winProbability;
  return (
    <Box
      data-testid="matchup-win-probability"
      sx={{
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        gridTemplateAreas: '"viewer label opponent" "bar bar bar"',
        alignItems: 'baseline',
        columnGap: '10px',
        rowGap: '6px',
      }}
    >
      <Box component="span" aria-hidden="true" sx={{ ...PCT_SX, gridArea: 'viewer' }}>
        {`${viewerPct}%`}
      </Box>
      <Box
        component="span"
        aria-hidden="true"
        sx={{ ...LABEL_SX, gridArea: 'label', justifySelf: 'center' }}
      >
        Win probability
      </Box>
      <Box component="span" aria-hidden="true" sx={{ ...PCT_SX, gridArea: 'opponent' }}>
        {`${opponentPct}%`}
      </Box>
      <Box sx={{ gridArea: 'bar' }}>
        <SplitBar homeName={viewerName} awayName={opponentName} homeShare={viewerShare} height={8} />
      </Box>
    </Box>
  );
}

// The small uppercase caption under a figure, and beside the win probability.
const LABEL_SX = {
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--dash-faint)',
};

// The two win percentages. Ink rather than the bar's own home/away hues: those
// two tokens are the Matchup page's palette, and position (the viewer sits
// left, as on the bar) is what ties each figure to its segment here.
const PCT_SX = {
  fontSize: '13px',
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--dash-ink)',
};

// The card's 30px display slot: the live score once the Matchup has started,
// the projected total before it.
function Figure({ children, ...rest }) {
  return (
    <Typography
      component="div"
      sx={{
        fontFamily: 'var(--dash-font-display)',
        fontSize: '30px',
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.1,
        color: 'var(--dash-ink)',
      }}
      {...rest}
    >
      {children}
    </Typography>
  );
}

function ProjectedValue({ projected }) {
  if (projected.loading) {
    return <Skeleton data-testid="matchup-skeleton" variant="text" width={64} height={30} />;
  }
  return <Figure>{projected.value != null ? projected.value : <Placeholder />}</Figure>;
}

// The placeholder mark for a figure that is not available yet: a dash, no
// digits. The dash is a visual mark only, so it is aria-hidden and a
// visually-hidden "Not available" carries the same meaning to a screen reader,
// which would otherwise hear the figure's label pointing at nothing.
function Placeholder() {
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

// The loading shape carries the SAME track and centring rules as the real
// versus block (and the same testid, since only one of the two is ever
// mounted), or the card reflows from one column to three the moment the read
// lands.
function VersusSkeleton() {
  return (
    <Box data-testid="matchup-versus" sx={{ ...VERSUS_SX, p: 2.25 }}>
      <SideSkeleton />
      <Skeleton
        data-testid="matchup-skeleton"
        variant="rounded"
        width={44}
        height={28}
        sx={{ justifySelf: 'center' }}
      />
      <SideSkeleton />
    </Box>
  );
}

function SideSkeleton() {
  return (
    <Box sx={{ display: 'grid', gap: 0.75, justifyItems: 'center' }}>
      <Skeleton data-testid="matchup-skeleton" variant="circular" width={44} height={44} />
      <Skeleton data-testid="matchup-skeleton" variant="text" width={90} height={16} />
      <Skeleton data-testid="matchup-skeleton" variant="text" width={64} height={30} />
    </Box>
  );
}
