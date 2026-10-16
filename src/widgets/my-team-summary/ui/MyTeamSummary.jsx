import React, { useId } from 'react';
import { Box } from '@mui/material';
import {
  ErrorPanel, Frame, FrameHead, InjuryTag, PixelCheck, PixelHeading, PosTag, PsLink, Skel, SR_ONLY_SX, YouTag, pixelSx,
} from '../../../shared/ui/playselect';
import useMyTeamSummary from '../model/useMyTeamSummary';

/**
 * League Dashboard My team widget (ADR 0067 wave 1b): the viewer's own Team at a glance, in a
 * primary frame (6px double rule). Header: the Team name (Pixel 24 on desktop, 16 on a phone), a
 * "You" tag and, once games have been played, the standing line ("3rd of 12"). Body: Record in
 * Pixel 24 with points for and against, then the facts the card has always stated when they have a
 * value (draft grade, projected finish with its movement, playoff odds, roster value, and either
 * FAAB left or roster fullness), then the first five starters (position tag, name, injury tag,
 * opponent line, projection under a "Proj" label), an "and N more" note and the lineup status with a
 * "Fix lineup" link while it is incomplete. The frame's foot links Lineup, Waivers and Trades.
 *
 * Before the draft lineups are not open, so no lineup is read: the card keeps the tiles that have a
 * value (FAAB left) and says "Lineups open after the draft".
 *
 * `wide` seats the numbers and status on the left and the starters on the right from md, for the
 * game-day full-width row. `fixLineup` (default true) is the page's say-it-once switch: it passes
 * false when Your move already carries a Set lineup play.
 *
 * Paints only ps-* tokens. The standings read is the card's spine: while it is in flight the frame
 * holds its layout with skeletons, and if it fails the widget is one danger panel with a retry, so a
 * failed read never touches the rest of the page. The grade/value and power-rankings reads degrade on
 * their own (an absent fact for a missing grade or roster value, and for an uncomputed projection)
 * without erroring the card. A fact whose value would be a dash does not render at all (#1979 L13).
 * The starters section has its own read and never mounts for a pick'em-only viewer.
 */
export default function MyTeamSummary({ leagueId, wide = false, fixLineup = true }) {
  const {
    identity, spine, record, points, teamCount, refetch, draftGrade, rosterValue, proj, playoffOdds, capacity, starters,
  } = useMyTeamSummary(leagueId);
  const nameId = useId();

  if (!identity) return null;

  if (spine === 'error') {
    return (
      <Box data-testid="my-team-summary">
        <ErrorPanel
          title="My team"
          body="We could not load your team summary right now."
          onRetry={refetch}
          retryAriaLabel="Try loading your team summary again"
        />
      </Box>
    );
  }

  const busy = spine === 'loading' || draftGrade.loading || rosterValue.loading;
  const showGrade = draftGrade.loading || (!draftGrade.unavailable && !!draftGrade.letter);
  const showValue = rosterValue.loading || (!rosterValue.unavailable && rosterValue.text != null);
  const showTiles = spine === 'loading' || showGrade || !!proj || !!playoffOdds || showValue || !!capacity;
  const lineupHref = `/league/${leagueId}/lineup`;

  const numbers = (
    <>
      {spine === 'loading' && (
        <Box data-testid="my-team-numbers" sx={{ display: 'flex', flexWrap: 'wrap', gap: '12px 28px' }}>
          <Skel width="72px" height={40} />
          <Skel width="64px" height={40} />
          <Skel width="64px" height={40} />
        </Box>
      )}
      {spine === 'ready' && record && (
        <Box
          data-testid="my-team-numbers"
          sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '12px 28px' }}
        >
          <Box>
            <Box sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>Record</Box>
            <Box data-testid="my-team-record" sx={{ ...pixelSx(24), lineHeight: 1.3 }}>{record.text}</Box>
          </Box>
          <Stat label="Points for" testid="my-team-points-for">{points?.pf}</Stat>
          <Stat label="Points against" testid="my-team-points-against">{points?.pa}</Stat>
        </Box>
      )}
    </>
  );

  const tiles = showTiles && (
    <Box data-testid="my-team-tiles" sx={{ display: 'flex', flexWrap: 'wrap', gap: '12px 28px' }}>
      {spine === 'loading' ? (
        <>
          <StatSkeleton />
          <StatSkeleton />
        </>
      ) : (
        <>
          {showGrade && (
            <Stat label="Draft grade" testid="stat-draft-grade">
              {draftGrade.loading ? <StatValueSkeleton /> : draftGrade.letter}
            </Stat>
          )}
          {proj && (
            <Stat label="Proj. finish" testid="stat-proj-finish">
              {proj.ordinal.value}
              <Box component="small" sx={{ fontSize: '13px', fontWeight: 500, color: 'var(--ps-dim)' }}>{proj.ordinal.suffix}</Box>
              {proj.change != null && <RankMovement change={proj.change} />}
            </Stat>
          )}
          {playoffOdds && (
            <Stat label="Playoff odds" testid="stat-playoff-odds">{`${playoffOdds.percent}%`}</Stat>
          )}
          {showValue && (
            <Stat label="Roster value" testid="stat-roster-value">
              {rosterValue.loading ? <StatValueSkeleton /> : rosterValue.text}
            </Stat>
          )}
          {capacity && <Stat label={capacity.label} testid="stat-capacity">{capacity.text}</Stat>}
        </>
      )}
    </Box>
  );

  const startersView = starters && (
    <StartersSection starters={starters} lineupHref={lineupHref} fixLineup={fixLineup} />
  );

  const hasFacts = (spine === 'loading') || !!record || showTiles;

  return (
    <Frame
      labelledBy={nameId}
      data-testid="my-team-summary"
      aria-busy={busy}
      sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      head={(
        <FrameHead>
          <PixelHeading id={nameId}>
            <Box component="span" sx={{ overflowWrap: 'anywhere' }}>{identity.name}</Box>
          </PixelHeading>
          <YouTag />
          {spine === 'ready' && record?.rankText && (
            <Box component="span" data-testid="my-team-rank" sx={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--ps-dim)' }}>
              {teamCount > 0 ? `${record.rankText} of ${teamCount}` : record.rankText}
            </Box>
          )}
        </FrameHead>
      )}
    >
      <Box
        sx={{
          flex: 1,
          display: 'grid',
          gap: { xs: '16px', md: '20px' },
          padding: { xs: '14px', md: '20px' },
          alignContent: 'start',
          ...(wide ? { gridTemplateColumns: { md: 'minmax(0, 1fr) minmax(0, 1.4fr)' }, gap: { md: '32px' } } : null),
        }}
      >
        {wide ? (
          <>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '20px', minWidth: 0 }}>
              {numbers}
              {tiles}
              {startersView && <StartersStatus starters={starters} lineupHref={lineupHref} fixLineup={fixLineup} />}
            </Box>
            {startersView && starters.status !== 'closed' && <StartersList starters={starters} />}
          </>
        ) : (
          <>
            {hasFacts && (
              <Box
                sx={{
                  display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: startersView ? '16px' : 0, borderBottom: startersView ? '2px solid var(--ps-rule)' : 0,
                }}
              >
                {numbers}
                {tiles}
              </Box>
            )}
            {startersView}
          </>
        )}
      </Box>
      <Box
        component="nav"
        aria-label={identity.name}
        sx={{ display: 'flex', flexWrap: 'wrap', padding: '4px 6px', borderTop: '2px solid var(--ps-rule)' }}
      >
        <PsLink to={lineupHref} ariaLabel={`${identity.name} lineup`}>Lineup</PsLink>
        <PsLink to={`/league/${leagueId}/waivers`} ariaLabel={`${identity.name} waivers`}>Waivers</PsLink>
        <PsLink to={`/league/${leagueId}/trades`} ariaLabel={`${identity.name} trades`}>Trades</PsLink>
      </Box>
    </Frame>
  );
}

function Stat({ label, testid, children }) {
  return (
    <Box data-testid={testid} sx={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
      <Box component="span" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>{label}</Box>
      <Box component="span" sx={{ fontSize: '16px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{children}</Box>
    </Box>
  );
}

function StatSkeleton() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <Skel data-testid="my-team-skeleton" width="64px" height={13} />
      <Skel data-testid="my-team-skeleton" width="40px" height={20} />
    </Box>
  );
}

function StatValueSkeleton() {
  return <Skel data-testid="my-team-skeleton" width="40px" height={20} />;
}

/**
 * Movement in the projected finish since the previous stored power-rankings run, rendered beside the
 * ordinal. The visible mark is a signed integer with a plain hyphen for a fall (ADR 0016: hyphens,
 * never a dash character), which on its own is an unlabelled number, so the direction rides in
 * visually hidden words rather than in a glyph or a colour.
 *
 * The caller renders this only when `change` is a real number. A null change (the first stored run
 * of a season) must render NOTHING: 0 is a real value here, so a coerced null would announce that
 * every Team held its place.
 */
function RankMovement({ change }) {
  const places = Math.abs(change) === 1 ? 'place' : 'places';
  const spoken = change === 0 ? 'held its place' : `${change > 0 ? 'up' : 'down'} ${Math.abs(change)} ${places}`;
  return (
    <Box component="span" data-testid="stat-proj-movement" sx={{ marginLeft: '6px', fontSize: '13px', fontWeight: 600, color: 'var(--ps-dim)' }}>
      <Box component="span" aria-hidden="true">{change > 0 ? `+${change}` : String(change)}</Box>
      <Box component="span" sx={SR_ONLY_SX}>{spoken}</Box>
    </Box>
  );
}

function StarterRow({ starter, last }) {
  const secondLine = starter.opponent ? `${starter.nflTeam ?? ''} vs ${starter.opponent}` : starter.nflTeam ?? '';
  const known = Number.isFinite(starter.projectedPoints);
  return (
    <Box
      component="li"
      data-testid="starter-row"
      sx={{
        display: 'flex', alignItems: 'center', gap: '12px', minHeight: '44px', borderBottom: last ? 0 : '2px solid var(--ps-rule)',
      }}
    >
      <PosTag position={starter.slot} data-testid="pos-chip" />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Box component="span" sx={{ minWidth: 0, fontSize: '15px', fontWeight: 600 }}>{starter.name}</Box>
          <InjuryTag status={starter.injuryStatus} data-testid="starter-injury-badge" />
        </Box>
        <Box data-testid="starter-opponent-line" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>{secondLine}</Box>
      </Box>
      <Box
        component="span"
        data-testid="starter-projection"
        sx={{
          flex: 'none', minWidth: '44px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: '15px', fontWeight: 600,
        }}
      >
        {/* The bare number has no column header in the accessibility tree, so a hidden label names it. */}
        <span aria-hidden="true">{known ? starter.projectedPoints.toFixed(1) : '-'}</span>
        <span style={{ ...SR_ONLY_SX }}>{known ? `${starter.projectedPoints.toFixed(1)} projected points` : 'Projection not available'}</span>
      </Box>
    </Box>
  );
}

function StartersList({ starters }) {
  const loading = starters.status === 'loading';
  return (
    <Box data-testid="my-team-starters" sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', marginBottom: '4px' }}>
        <Box sx={{ fontSize: '13px', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ps-dim)' }}>
          {starters.week != null ? `Starters · Week ${starters.week}` : 'Starters'}
        </Box>
        <Box
          component="span"
          aria-hidden="true"
          sx={{ fontSize: '13px', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ps-dim)' }}
        >
          Proj
        </Box>
      </Box>
      {loading ? (
        <Box sx={{ display: 'grid', gap: '4px' }}>
          {Array.from({ length: 5 }, (_, i) => (
            <Box key={i} data-testid="my-team-starters-skeleton"><Skel width="100%" height={40} /></Box>
          ))}
        </Box>
      ) : (
        <>
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {starters.rows.map((starter, i) => (
              <StarterRow key={starter.playerId ?? starter.name} starter={starter} last={i === starters.rows.length - 1} />
            ))}
          </Box>
          {starters.moreCount > 0 && (
            <Box data-testid="my-team-starters-more" sx={{ margin: '8px 0 0', fontSize: '14px', color: 'var(--ps-dim)' }}>
              {`and ${starters.moreCount} more starter${starters.moreCount === 1 ? '' : 's'} · ${starters.questionableCount} questionable`}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}

// The lineup's completeness, and the way to fix it: "Lineup set · 9 of 9" with a check, or "Lineup
// incomplete · 7 of 9" with a Fix lineup link (the check mark is a "done" affirmation, so it renders
// only once the lineup actually is set). Before the draft there is nothing to set yet.
function StartersStatus({ starters, lineupHref, fixLineup }) {
  if (starters.status === 'loading') return null;
  if (starters.status === 'closed') {
    return (
      <Box data-testid="my-team-lineup-status" sx={{ fontSize: '15px', fontWeight: 600 }}>Lineups open after the draft</Box>
    );
  }
  const isLineupSet = starters.filled >= starters.totalSlots;
  return (
    <Box data-testid="my-team-lineup-footer" sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0 8px', marginTop: 'auto', fontSize: '15px', fontWeight: 600 }}>
      {isLineupSet && <Box component="span" data-testid="my-team-lineup-check" aria-hidden="true" sx={{ display: 'inline-flex' }}><PixelCheck /></Box>}
      <Box component="span" data-testid="my-team-lineup-status">
        {`${isLineupSet ? 'Lineup set' : 'Lineup incomplete'} · ${starters.filled} of ${starters.totalSlots}`}
      </Box>
      {!isLineupSet && fixLineup && lineupHref && (
        <PsLink to={lineupHref} ariaLabel="Fix lineup">Fix lineup</PsLink>
      )}
    </Box>
  );
}

function StartersSection({ starters, lineupHref, fixLineup }) {
  if (starters.status === 'closed') return <StartersStatus starters={starters} lineupHref={lineupHref} fixLineup={fixLineup} />;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>
      <StartersList starters={starters} />
      <StartersStatus starters={starters} lineupHref={lineupHref} fixLineup={fixLineup} />
    </Box>
  );
}
