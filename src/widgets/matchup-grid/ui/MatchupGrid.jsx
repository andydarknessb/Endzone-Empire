import React from 'react';
import { Box, Typography, useMediaQuery, useTheme } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { Badge, Card, SplitBar } from '../../../shared/ui';
import TeamAvatar from '../../../components/common/TeamAvatar';
import { matchupCardView } from '../model/matchupCardView';

/**
 * Game Center's League matchups region (ADR 0031, ticket #894): one card per
 * Matchup on desktop, the same data as a compact list row below the `sm`
 * breakpoint. Transcribed from the design source (docs/design/
 * game-center-matchups/build.mjs, matchupCard and matchupRowMobile).
 *
 * Each card: the week (or the kickoff time before it) and the status chip on
 * top; two team rows with a 32px avatar, the Team name, a note line (record,
 * Expected final, Players remaining) and the big number on the right, the
 * live score at 26px tabular in ink once started or the projected total in
 * the faint tier before kickoff; a 5px SplitBar between the rows once started
 * or a hairline before; a footer line with the two win probability
 * percentages, "Waiting on the score of record" once played or "Projected
 * totals shown until kickoff" before, and a Details cue. The whole card is one
 * react-router link to the matchup. The compact row keeps the header, the two
 * team lines (28px avatar, 24px score) and a 4px bar.
 *
 * It reads the entity model only (entities/matchup, through the pure
 * matchupCardView) and takes the matchups, the league id and an optional
 * record lookup as props; it fetches nothing. An empty list renders nothing,
 * so the page decides what an empty week says.
 *
 * Composes `shared/ui` (ADR 0020) and paints only `dash-*` tokens. Every
 * ink-on-surface pairing here is registered in tokens.contrast.test.js: ink,
 * dim and faint on the card surface, home and away on the card (the SplitBar's
 * own pairing), the status chip's danger / success / warning text on its tint
 * over a card (the design source's statusChip(); each tinted Badge is guarded
 * over `dash-surface` only, which is what the kit Card paints) and the focus
 * ring on a dashboard card. The leader's check mark is painted in `dash-ink`, not
 * the design's success green: the dash group has no success token, and
 * `dash-accent` on `dash-surface` is not a registered pairing, so the check
 * stays inside the certified set rather than inventing a pairing (ADR 0010).
 * It also carries an accessible "Leading" name, so the leader is announced,
 * not only drawn.
 */
export default function MatchupGrid({
  matchups,
  leagueId,
  records,
  'data-testid': testId = 'matchup-grid',
}) {
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const list = Array.isArray(matchups) ? matchups : [];
  if (list.length === 0) return null;

  return (
    <Box
      component="ul"
      role="list"
      data-testid={testId}
      data-layout={compact ? 'rows' : 'cards'}
      sx={{
        listStyle: 'none',
        m: 0,
        p: 0,
        display: 'grid',
        gridTemplateColumns: compact ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))',
        gap: '14px',
      }}
    >
      {list.map((matchup, index) => {
        const view = matchupCardView(matchup, { records });
        const key = view.id != null ? view.id : `index-${index}`;
        return (
          <Box component="li" key={key} sx={{ minWidth: 0 }}>
            {compact ? (
              <MatchupRow view={view} leagueId={leagueId} />
            ) : (
              <MatchupCard view={view} leagueId={leagueId} />
            )}
          </Box>
        );
      })}
    </Box>
  );
}

const CHECK_PATH = 'M4 10.5 8 14.5 16 6';
const CHEVRON_RIGHT_PATH = 'M7.5 4.5 13 10l-5.5 5.5';

// Inline stroke SVG on the design's 20px grid, one style, decorative.
function Icon({ path, size }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}
    >
      <path d={path} />
    </svg>
  );
}

// The card is the link. The kit Card renders as the router Link so the whole
// surface is one hit target; the focus ring on a dashboard card is registered.
const LINK_SX = {
  display: 'block',
  textDecoration: 'none',
  color: 'var(--dash-ink)',
  transition: 'border-color var(--transition-fast) ease',
  '&:hover': { borderColor: 'var(--dash-line-strong)', textDecoration: 'none' },
  '&:focus-visible': { outline: '2px solid var(--focus-ring)', outlineOffset: 2 },
};

const NOTE_SX = {
  fontSize: '12px',
  color: 'var(--dash-faint)',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

function matchupPath(leagueId, id) {
  return `/league/${leagueId}/matchups/${id}`;
}

function StatusChip({ view }) {
  if (!view.chipLabel) return null;
  return (
    <Badge variant={view.chipVariant} data-testid="matchup-status">
      {view.chipDot && (
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
            verticalAlign: 'middle',
          }}
        />
      )}
      {view.chipLabel}
    </Badge>
  );
}

function Header({ view, mb }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb }}>
      <Typography component="span" data-testid="matchup-card-note" sx={NOTE_SX}>
        {view.headerNote}
      </Typography>
      <StatusChip view={view} />
    </Box>
  );
}

// The check mark on the leader once the Matchup is settled. It is the one
// visual cue that says who won, so it carries a name a screen reader hears.
function LeaderCheck() {
  return (
    <Box
      role="img"
      aria-label="Leading"
      data-testid="leader-check"
      sx={{ display: 'flex', color: 'var(--dash-ink)' }}
    >
      <Icon path={CHECK_PATH} size={16} />
    </Box>
  );
}

function Figure({ value, tier, size }) {
  return (
    <Typography
      component="span"
      data-testid="matchup-figure"
      sx={{
        fontFamily: 'var(--dash-font-display)',
        fontSize: size,
        fontWeight: 700,
        lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
        color: tier === 'faint' ? 'var(--dash-faint)' : 'var(--dash-ink)',
      }}
    >
      {value}
    </Typography>
  );
}

function TeamRow({ side, testId, avatarSize, figureSize, figure, note, py }) {
  return (
    <Box data-testid={testId} sx={{ display: 'flex', alignItems: 'center', gap: '10px', py }}>
      <TeamAvatar
        name={side.name}
        avatarUrl={side.avatarUrl}
        avatarStaticUrl={side.avatarStaticUrl}
        size={avatarSize}
      />
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: '1 1 0', minWidth: 0 }}>
        <Typography
          component="span"
          sx={{
            fontSize: '14px',
            fontWeight: side.leads ? 700 : 500,
            color: 'var(--dash-ink)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {side.name}
        </Typography>
        {note !== '' && (
          <Typography component="span" data-testid="matchup-side-note" sx={NOTE_SX}>
            {note}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 'none' }}>
        {side.check && <LeaderCheck />}
        {figure !== '' && <Figure value={figure} tier={side.figureTier} size={figureSize} />}
      </Box>
    </Box>
  );
}

// Between the two team rows: the win probability bar once started, a hairline
// before kickoff (and on an unknown status, which asserts no probability).
function Divider({ view, height, sx }) {
  if (view.started) {
    return (
      <Box sx={sx}>
        <SplitBar
          homeName={view.home.name}
          awayName={view.away.name}
          homeShare={view.homeShare}
          height={height}
        />
      </Box>
    );
  }
  return (
    <Box
      data-testid="matchup-hairline"
      sx={{ height: '1px', backgroundColor: 'var(--dash-line)', ...sx }}
    />
  );
}

/** Desktop card: matchupCard() in the design source. */
function MatchupCard({ view, leagueId }) {
  return (
    <Card
      component={RouterLink}
      to={matchupPath(leagueId, view.id)}
      data-testid="matchup-card"
      data-matchup-id={view.id}
      data-layout="card"
      sx={{ ...LINK_SX, p: '12px 16px 12px' }}
    >
      <Header view={view} mb="4px" />
      <TeamRow
        side={view.home}
        testId="matchup-side-home"
        avatarSize={32}
        figureSize="26px"
        figure={view.home.figure}
        note={view.home.note}
        py="6px"
      />
      <Divider view={view} height={5} sx={view.started ? { p: '2px 0 6px' } : { m: '2px 0 6px' }} />
      <TeamRow
        side={view.away}
        testId="matchup-side-away"
        avatarSize={32}
        figureSize="26px"
        figure={view.away.figure}
        note={view.away.note}
        py="6px"
      />
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          mt: '8px',
          fontSize: '12px',
          color: 'var(--dash-faint)',
        }}
      >
        {/* While live the footer repeats the two percentages the SplitBar
            already announces inside this link's name, so it is hidden from
            assistive tech (still visible): the link names the split once.
            The other footers say something the bar does not and stay. */}
        <Typography
          component="span"
          data-testid="matchup-card-footer"
          aria-hidden={view.status === 'live' ? 'true' : undefined}
          sx={{ fontSize: '12px', color: 'var(--dash-faint)', fontVariantNumeric: 'tabular-nums' }}
        >
          {view.footer}
        </Typography>
        <Box
          component="span"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', flex: 'none' }}
        >
          Details
          <Icon path={CHEVRON_RIGHT_PATH} size={14} />
        </Box>
      </Box>
    </Card>
  );
}

/** Compact list row below `sm`: matchupRowMobile() in the design source. */
function MatchupRow({ view, leagueId }) {
  return (
    <Card
      component={RouterLink}
      to={matchupPath(leagueId, view.id)}
      data-testid="matchup-card"
      data-matchup-id={view.id}
      data-layout="row"
      sx={{ ...LINK_SX, p: '10px 14px', minHeight: 44 }}
    >
      <Header view={view} mb="2px" />
      <TeamRow
        side={view.home}
        testId="matchup-side-home"
        avatarSize={28}
        figureSize="24px"
        figure={view.home.rowFigure}
        note={view.home.rowNote}
        py="5px"
      />
      <Divider view={view} height={4} />
      <TeamRow
        side={view.away}
        testId="matchup-side-away"
        avatarSize={28}
        figureSize="24px"
        figure={view.away.rowFigure}
        note={view.away.rowNote}
        py="5px"
      />
    </Card>
  );
}
