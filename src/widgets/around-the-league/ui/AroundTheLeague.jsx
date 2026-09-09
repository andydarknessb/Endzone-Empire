import React from 'react';
import { Box, Link as MuiLink, Typography, useMediaQuery, useTheme } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { Link as RouterLink } from 'react-router-dom';
import { Badge, Card, Skeleton, SplitBar } from '../../../shared/ui';
import TeamAvatar from '../../../components/common/TeamAvatar';
import useAroundTheLeague from '../model/useAroundTheLeague';

/**
 * League Dashboard widget (#1103, the canvas's "Around the league" card): six
 * compact matchup tiles for the league's current week, below the hero. Each
 * tile is two team rows (a 28px avatar, the Team name, and the projected
 * total before kickoff or the live score after, right-aligned tabular) over a
 * 5px SplitBar of the win probability; the viewer's own tile carries the
 * accent ring the recommended Quick Action tile uses (a `dash-accent-line`
 * border plus its matching 1px box-shadow ring, QuickActions.jsx) AND the
 * viewer's own row within that tile carries the visible `Badge variant="you"`
 * pill, the League Dashboard island's shared viewer-row marker (#671,
 * Badge.jsx): the ring is a border/box-shadow, colour and shape alone, so the
 * pill is what makes the viewer's row identifiable in the accessibility tree
 * rather than by colour only (WCAG 1.4.1), matching DraftGrades' and
 * StandingsTable's viewer rows. It sits on whichever SIDE (home or away) is
 * the viewer's own Team, never on both and never guessed from seating.
 *
 * Desktop lays the tiles in a fixed six-column grid (a league with more
 * matchups wraps to a second row); below `md` they become a horizontal
 * scroller of 200px tiles, both straight from the design source
 * (docs/design/league-dashboard-v2/build.mjs, aroundLeague()). Widgets never
 * import widgets (CONTEXT.md carry-over from ADR 0020): this tile is this
 * slice's own, not matchup-grid's. Unlike matchup-grid's cards, a tile here is
 * not itself a link, so the scroller carries its own `tabIndex={0}`, an
 * accessible name and a focus ring (the same shape nfl-game-strip's scroller
 * uses, NflGameStrip.jsx) - without it a keyboard-only user at a narrow
 * viewport could never bring tiles 3-6 into view.
 *
 * Each figure also carries a visually hidden label naming what it is
 * ("Score" once the Matchup has started, "Projected" before it), because two
 * different numbers share the same slot and the tile's own status is the
 * only thing that says which one is on screen; a missing figure (the "-"
 * placeholder) carries its own visually hidden "Not available" rather than
 * announcing silence. Both follow DraftGrades' and matchup-preview's own
 * NotAvailable/label convention.
 *
 * The widget owns its own reads (useAroundTheLeague): while they are in
 * flight it holds its layout with six skeleton tiles, and if either fails it
 * renders one compact, self-contained alert sentence, so a failed read never
 * touches the rest of the page. A pick'em-only league never mounts a body at
 * all (CONTEXT.md: League type - no fantasy Matchups exist to show), and an
 * empty current week (every Matchup filtered away, or none generated yet)
 * renders nothing, the same "the page decides what an empty week says"
 * convention matchup-grid uses.
 *
 * Composes `shared/ui` (ADR 0020) and paints only `dash-*` tokens already
 * registered in tokens.contrast.test.js: ink/dim/faint on the card surface
 * and on a `dash-surface2` tile (both pairs matchup-grid and the stat tiles
 * already certify), the "You" pill's accent-on-accent-soft over a card (the
 * same pairing DraftGrades' and StandingsTable's pill already composes), and
 * SplitBar's own home/away segments on its `dash-surface3` track. The accent
 * ring is a border and a box-shadow, never text, so it composes no new
 * ink-on-surface pairing (the same reasoning QuickActions.jsx's ActionTile
 * ring records); the "Game Center" link inherits the tail's own
 * `dash-faint`-on-`dash-surface` color (Card.jsx) rather than painting a new
 * accent-on-surface pairing.
 */

const SKELETON_COUNT = 6;

function pluralMatchups(count) {
  return `${count} matchup${count === 1 ? '' : 's'}`;
}

export default function AroundTheLeague({ leagueId }) {
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });
  const { status, tiles, count, tailLabel } = useAroundTheLeague(leagueId);

  if (status === 'hidden') return null;
  if (status === 'ready' && tiles.length === 0) return null;

  // The scroller is only a real scroller once it holds the real tiles: while
  // loading or on a failed read there is nothing below `md` to pan to, so it
  // stays a plain (non-focusable) container rather than adding an empty tab
  // stop.
  const scrollable = compact && status === 'ready';

  const tail = (
    <>
      {status === 'ready' ? `${tailLabel} · ` : null}
      <MuiLink
        component={RouterLink}
        to={`/league/${leagueId}/game-center`}
        sx={{ color: 'inherit', textDecoration: 'underline' }}
      >
        Game Center
      </MuiLink>
    </>
  );

  return (
    <Card
      data-testid="around-the-league"
      title="Around the league"
      count={status === 'ready' ? pluralMatchups(count) : null}
      tail={tail}
      aria-busy={status === 'loading'}
    >
      <Box
        component={status === 'ready' ? 'ul' : 'div'}
        role={status === 'ready' ? 'list' : undefined}
        tabIndex={scrollable ? 0 : undefined}
        aria-label={scrollable ? "This week's matchups" : undefined}
        data-testid="around-the-league-body"
        data-layout={compact ? 'scroll' : 'grid'}
        sx={{
          listStyle: 'none',
          m: 0,
          p: '14px 18px',
          display: compact ? 'flex' : 'grid',
          gridTemplateColumns: compact ? undefined : 'repeat(6, minmax(0, 1fr))',
          gap: '10px',
          overflowX: compact ? 'auto' : 'visible',
          '&:focus-visible': scrollable
            ? { outline: '2px solid var(--focus-ring)', outlineOffset: 2 }
            : undefined,
        }}
      >
        {status === 'loading' &&
          Array.from({ length: SKELETON_COUNT }, (_, i) => (
            <SkeletonTile key={`skeleton-${i}`} compact={compact} />
          ))}

        {status === 'error' && (
          <Typography
            role="alert"
            data-testid="around-the-league-error"
            sx={{ fontSize: '13px', color: 'var(--dash-ink)' }}
          >
            We could not load this week&apos;s matchups right now.
          </Typography>
        )}

        {status === 'ready' &&
          tiles.map((tile, index) => (
            <Box
              component="li"
              key={tile.id != null ? tile.id : `index-${index}`}
              sx={{ minWidth: 0, flex: compact ? '0 0 200px' : undefined }}
            >
              <Tile tile={tile} />
            </Box>
          ))}
      </Box>
    </Card>
  );
}

function Tile({ tile }) {
  // Keyed off `scheduled` (ADR 0030's `hasStarted === false`), the same
  // predicate the figure's own VALUE is keyed off (tileView.js), never off
  // `!tile.started`: an unknown status is neither started nor scheduled, and
  // the figure there is already the score (a stored fact), so the label
  // must read "Score" too, not "Projected" - a false accessible name is the
  // same class of defect #872 forbade for SplitBar.
  const figureLabel = tile.scheduled ? 'Projected' : 'Score';
  return (
    <Box
      data-testid="around-the-league-tile"
      data-matchup-id={tile.id}
      data-viewer-tile={tile.isViewer || undefined}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        minWidth: 0,
        padding: '10px 12px',
        borderRadius: 'var(--dash-radius-sm)',
        backgroundColor: 'var(--dash-surface2)',
        border: `1px solid ${tile.isViewer ? 'var(--dash-accent-line)' : 'var(--dash-line)'}`,
        boxShadow: tile.isViewer ? '0 0 0 1px var(--dash-accent-line)' : 'none',
      }}
    >
      <TileRow side={tile.home} testId="around-the-league-tile-home" figureLabel={figureLabel} />
      <TileRow side={tile.away} testId="around-the-league-tile-away" figureLabel={figureLabel} />
      <SplitBar
        homeName={tile.home.name}
        awayName={tile.away.name}
        homeShare={tile.homeShare}
        height={5}
      />
    </Box>
  );
}

function TileRow({ side, testId, figureLabel }) {
  return (
    <Box data-testid={testId} sx={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
      <TeamAvatar
        name={side.name}
        avatarUrl={side.avatarUrl}
        avatarStaticUrl={side.avatarStaticUrl}
        size={28}
      />
      <Typography
        component="span"
        sx={{
          flex: '1 1 0',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: '12.5px',
          fontWeight: 600,
          color: 'var(--dash-ink)',
        }}
      >
        {side.name}
      </Typography>
      {side.isViewer && (
        <Badge variant="you" sx={{ flex: 'none' }}>
          You
        </Badge>
      )}
      <Figure label={figureLabel} value={side.figure} />
    </Box>
  );
}

// The right-aligned figure: a visually hidden label naming what it is (the
// two states share one slot, so the label is the only thing that
// disambiguates them for assistive tech), and a visually hidden "Not
// available" standing in for the "-" placeholder, which is otherwise
// announced as silence.
function Figure({ label, value }) {
  return (
    <Typography
      component="span"
      data-testid="around-the-league-figure"
      sx={{
        flex: 'none',
        fontSize: '13px',
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--dash-ink)',
      }}
    >
      <Box component="span" sx={visuallyHidden}>
        {label}{' '}
      </Box>
      {value === '-' ? (
        <>
          <Box component="span" aria-hidden="true">
            -
          </Box>
          <Box component="span" sx={visuallyHidden}>
            Not available
          </Box>
        </>
      ) : (
        value
      )}
    </Typography>
  );
}

// One skeleton tile holds the real tile's shape (two rows, a bar) so the
// layout does not jump when the reads land.
function SkeletonTile({ compact }) {
  return (
    <Box
      sx={{
        flex: compact ? '0 0 200px' : undefined,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '10px 12px',
        borderRadius: 'var(--dash-radius-sm)',
        backgroundColor: 'var(--dash-surface2)',
        border: '1px solid var(--dash-line)',
      }}
    >
      <Skeleton variant="text" width="70%" height={16} />
      <Skeleton variant="text" width="70%" height={16} />
      <Skeleton variant="rounded" width="100%" height={5} />
    </Box>
  );
}
