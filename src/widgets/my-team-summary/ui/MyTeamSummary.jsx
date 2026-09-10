import React, { useId } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { Link as RouterLink } from 'react-router-dom';
import { Card, Badge, PosChip, Skeleton, TeamAvatar } from '../../../shared/ui';
import useMyTeamSummary from '../model/useMyTeamSummary';

/**
 * League Dashboard hero-left widget (ticket #639): the viewer's own Team at a
 * glance. Avatar + Team name + a "You" pill, a secondary record/rank line once
 * games have been played, and a row of stat tiles (draft grade, projected
 * finish with its movement, playoff odds, roster value, and either FAAB left or
 * roster fullness).
 *
 * Composes `shared/ui` (ADR 0020) and paints only `dash-*` tokens. Every
 * ink-on-surface pairing it renders is already registered in
 * tokens.contrast.test.js: ink/faint/dim on the card and on the `dash-surface2`
 * stat tiles, the accent "You" pill on the accent tint over a card, and the
 * draft grade as `dash-grade-*-text` on a stat tile (NOT the raised tile, and
 * NOT a chip fill: the mockup paints the grade as colored text, and the text
 * tokens are the legible-as-text set). No new pairing is composed here.
 *
 * The tile row is `grid-auto-flow: column` over `minmax(0, 1fr)` auto columns,
 * NOT a fixed track count: how many tiles render depends on which reads have
 * landed and on the league's waiver type, and a fixed count leaves a dead track
 * for every tile that is absent (a league with no power-rankings run yet showed
 * 89px of nothing in a 286px card). A conditional count would be worse than
 * either: the power-rankings read is still in flight while its tiles are absent,
 * so the row would render narrow and then re-flow when it lands.
 *
 * The standings read is the card's spine: while it is in flight the card holds
 * its layout with skeletons, and if it fails the card shows one compact,
 * self-contained error and nothing else in the data region, so a failed read
 * never touches the rest of the page. The grade/value and power-rankings reads
 * degrade on their own (a placeholder for missing grades, an absent tile for an
 * uncomputed projection) without erroring the card.
 *
 * Below the tiles, a "Starters · Week N" section (#1101): the entities/roster
 * lineup's first five starters, a "N more starters · M questionable" note and
 * a lineup-completeness footer beside a Set Lineup button. It is independent
 * of the tiles' spine - its own read loads/fails on its own - and never mounts
 * at all for a pick'em-only viewer (`useMyTeamSummary` never fetches the
 * lineup for one). It stretches to fill any extra height the page's grid gives
 * the card (`flex: 1 1 auto` on the card's now-flex root).
 */
export default function MyTeamSummary({ leagueId }) {
  const { identity, spine, record, draftGrade, rosterValue, proj, playoffOdds, capacity, starters } =
    useMyTeamSummary(leagueId);
  // The Team name is the card's accessible name (see the Card below); the id
  // has to be minted before the early return so the hook order is stable.
  const nameId = useId();

  // No Team for this viewer (e.g. a commissioner who owns no team): the hero
  // slot stays empty rather than inventing an identity.
  if (!identity) return null;

  // The card is the region that owns these fetches (Skeleton.jsx: the loading
  // state is announced by the owning card, not by each aria-hidden shape), so
  // it carries aria-busy while the reads that hold the card's layout with
  // skeletons are still loading: the standings spine and the draft-grades tiles
  // (draftGrade and rosterValue are the one draft-grades read). The
  // power-rankings read is deliberately NOT folded in - its projected-finish
  // tile is absent until ready rather than skeletoned (AC ties skeletons to the
  // standings spine), so it holds no layout for aria-busy to report over.
  const busy = spine === 'loading' || draftGrade.loading || rosterValue.loading;

  return (
    // Named by the Team name rather than by a Card `title`: Card spreads
    // ...rest after its own conditional aria-labelledby, so this value wins and
    // no header box renders, which is why the card gains a name and a heading at
    // zero visual cost. The name is therefore announced three times (the region,
    // the role="img" avatar label kept from #327, and the heading). That is the
    // accepted cost of the card being both navigable by heading and named as a
    // region; the fix is not to drop one of them.
    <Card
      data-testid="my-team-summary"
      aria-busy={busy}
      aria-labelledby={nameId}
      sx={{ p: 2.5, height: '100%' }}
    >
      {/* flex column, not grid: the starters section below needs `flex: 1 1
          auto` to grow into whatever height the page's grid stretches this
          card to (the page sets align-items: stretch in its own ticket, #1101). */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
        {/* Identity: avatar, Team name + You pill, and the secondary line. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75 }}>
          {/* The avatar carries the Team name as its accessible name. TeamAvatar
              is deliberately aria-hidden (#327), so the name rides on this
              wrapper's role="img"; the visible name text sits beside it. */}
          <Box
            role="img"
            aria-label={identity.name}
            sx={{ flex: 'none', display: 'flex' }}
          >
            <TeamAvatar
              name={identity.name}
              avatarUrl={identity.avatarUrl}
              avatarStaticUrl={identity.avatarStaticUrl}
              size={48}
            />
          </Box>

          <Box sx={{ minWidth: 0, display: 'grid', gap: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography
                component="h2"
                id={nameId}
                sx={{
                  m: 0,
                  fontFamily: 'var(--dash-font-display)',
                  fontSize: '24px',
                  fontWeight: 700,
                  letterSpacing: '0.02em',
                  lineHeight: 1.1,
                  color: 'var(--dash-ink)',
                  // Paired with the zero minimum on the parent: a box of words
                  // given min-width:0 does not clip, it overflows onto its
                  // neighbour (#916/#917/#919/#921). A long unbroken Team name
                  // breaks inside itself instead.
                  overflowWrap: 'anywhere',
                }}
              >
                {identity.name}
              </Typography>
              <Badge variant="you">You</Badge>
            </Box>

            {spine === 'loading' && (
              <Skeleton data-testid="my-team-skeleton" variant="text" width={150} height={15} />
            )}
            {spine === 'ready' && record && (
              <Typography
                component="div"
                data-testid="my-team-record"
                sx={{ fontSize: '12.5px', color: 'var(--dash-faint)' }}
              >
                {record.rankText ? `${record.text} · ${record.rankText}` : record.text}
              </Typography>
            )}
          </Box>
        </Box>

        {/* Data region: one compact error, skeleton tiles, or the real tiles. */}
        {spine === 'error' && (
          <Typography
            role="alert"
            data-testid="my-team-error"
            sx={{ fontSize: '13px', color: 'var(--dash-ink)' }}
          >
            We could not load your team summary right now.
          </Typography>
        )}

        {spine !== 'error' && (
          <Box
            data-testid="my-team-tiles"
            sx={{
              display: 'grid',
              gridAutoFlow: 'column',
              gridAutoColumns: 'minmax(0, 1fr)',
              gap: '10px',
            }}
          >
            {spine === 'loading' ? (
              <>
                <StatTileSkeleton />
                <StatTileSkeleton />
                <StatTileSkeleton />
              </>
            ) : (
              <>
                <StatTile label="Draft grade" testid="stat-draft-grade">
                  {draftGrade.loading ? (
                    <StatValueSkeleton />
                  ) : draftGrade.unavailable || !draftGrade.letter ? (
                    <Placeholder />
                  ) : (
                    <Box
                      component="span"
                      sx={{ color: gradeTextColor(draftGrade.gradeKey) }}
                    >
                      {draftGrade.letter}
                    </Box>
                  )}
                </StatTile>

                {proj && (
                  <StatTile label="Proj. finish" testid="stat-proj-finish">
                    {proj.ordinal.value}
                    <Box
                      component="small"
                      sx={{
                        fontSize: '13px',
                        fontWeight: 500,
                        fontFamily: 'var(--dash-font-body)',
                        color: 'var(--dash-dim)',
                      }}
                    >
                      {proj.ordinal.suffix}
                    </Box>
                    {proj.change != null && <RankMovement change={proj.change} />}
                  </StatTile>
                )}

                {playoffOdds && (
                  <StatTile label="Playoff odds" testid="stat-playoff-odds">
                    {`${playoffOdds.percent}%`}
                  </StatTile>
                )}

                <StatTile label="Roster value" testid="stat-roster-value">
                  {rosterValue.loading ? (
                    <StatValueSkeleton />
                  ) : rosterValue.unavailable || rosterValue.text == null ? (
                    <Placeholder />
                  ) : (
                    rosterValue.text
                  )}
                </StatTile>

                {capacity && (
                  <StatTile label={capacity.label} testid="stat-capacity">
                    {capacity.text}
                  </StatTile>
                )}
              </>
            )}
          </Box>
        )}

        {starters && <StartersSection starters={starters} />}
      </Box>
    </Card>
  );
}

/**
 * Movement in the projected finish since the previous stored power-rankings
 * run, rendered beside the ordinal. The visible mark is a signed integer with a
 * plain hyphen for a fall (ADR 0016: hyphens, never a dash character), which on
 * its own is an unlabelled number, so the direction rides in visually hidden
 * words rather than in a glyph or a colour.
 *
 * `dash-dim` on the `dash-surface2` tile is a registered pairing; a green/red
 * pair would be a new one and would also be the only colour-coded direction on
 * the card, so the words carry the meaning instead.
 *
 * The caller renders this only when `change` is a real number. A null change
 * (the first stored run of a season) must render NOTHING: 0 is a real value
 * here, so a coerced null would announce that every Team held its place.
 */
function RankMovement({ change }) {
  const places = Math.abs(change) === 1 ? 'place' : 'places';
  const spoken =
    change === 0
      ? 'held its place'
      : `${change > 0 ? 'up' : 'down'} ${Math.abs(change)} ${places}`;
  return (
    <Box
      component="span"
      data-testid="stat-proj-movement"
      sx={{
        ml: 0.75,
        fontSize: '13px',
        fontWeight: 600,
        fontFamily: 'var(--dash-font-body)',
        color: 'var(--dash-dim)',
      }}
    >
      <Box component="span" aria-hidden="true">
        {change > 0 ? `+${change}` : String(change)}
      </Box>
      <Box component="span" sx={visuallyHidden}>
        {spoken}
      </Box>
    </Box>
  );
}

// A-F -> the legible grade-as-text token (registered on the stat-tile surface);
// anything else falls back to ink so a surprise value is never invisible.
function gradeTextColor(gradeKey) {
  return gradeKey ? `var(--dash-grade-${gradeKey.toLowerCase()}-text)` : 'var(--dash-ink)';
}

// The placeholder mark for a tile whose read has no value yet: a dash, no
// digits (draft-grades 404 renders this in both the grade and value tiles).
// The dash is a visual mark only, so it is aria-hidden and a visually-hidden
// "Not available" carries the same meaning to a screen reader; without it the
// tile would announce its label ("Draft grade") with nothing after it, which a
// non-sighted user cannot tell apart from a loading or broken tile.
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

function StatTile({ label, testid, children }) {
  return (
    <Box
      data-testid={testid}
      sx={{
        backgroundColor: 'var(--dash-surface2)',
        border: '1px solid var(--dash-line)',
        borderRadius: 'var(--dash-radius-sm)',
        padding: '10px 12px',
      }}
    >
      <Box
        sx={{
          fontSize: '11px',
          fontWeight: 600,
          // 0.04em, not the island's usual 0.07em: at 360px a tile is narrow
          // enough that the wider tracking wraps "ROSTER VALUE" onto a second
          // line and shoves the value down out of alignment with its neighbours.
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--dash-faint)',
        }}
      >
        {label}
      </Box>
      <Box
        sx={{
          fontFamily: 'var(--dash-font-display)',
          fontSize: '24px',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.2,
          color: 'var(--dash-ink)',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

function StatTileSkeleton() {
  return (
    <Box
      sx={{
        backgroundColor: 'var(--dash-surface2)',
        border: '1px solid var(--dash-line)',
        borderRadius: 'var(--dash-radius-sm)',
        padding: '10px 12px',
        display: 'grid',
        gap: 0.75,
      }}
    >
      <Skeleton data-testid="my-team-skeleton" variant="text" width={64} height={11} />
      <Skeleton data-testid="my-team-skeleton" variant="text" width={40} height={22} />
    </Box>
  );
}

function StatValueSkeleton() {
  return <Skeleton data-testid="my-team-skeleton" variant="text" width={40} height={22} />;
}

// --- Starters section (#1101) ----------------------------------------------

// Primary button look, copied from matchup-preview's own PRIMARY_SX (that
// widget's Set Lineup button): the registered "dashboard primary button label
// on accent" pairing (tokens.contrast.test.js), so composing it here is not a
// new pairing. Each Set-Lineup button on this page keeps its own small sx
// object rather than sharing one across widgets, matching that precedent.
const BUTTON_BASE = {
  textTransform: 'none',
  fontSize: '13px',
  fontWeight: 600,
  lineHeight: 1.2,
  borderRadius: '9px',
  padding: '8px 14px',
  minWidth: 0,
  minHeight: 36,
};
const PRIMARY_SX = {
  ...BUTTON_BASE,
  color: 'var(--dash-on-accent)',
  backgroundColor: 'var(--dash-accent)',
  border: '1px solid var(--dash-accent)',
  transition: 'filter var(--transition-fast)',
  '&:hover': { backgroundColor: 'var(--dash-accent)', filter: 'brightness(1.08)' },
};

// The footer's check mark, the same path MatchupGrid's LeaderCheck draws.
// Decorative and aria-hidden: the visible copy ("Lineup set"/"Lineup
// incomplete") already carries the meaning to a screen reader. The caller
// renders this ONLY for a set lineup - showing it beside "Lineup incomplete"
// would tell a sighted manager the opposite of what the text says.
function CheckIcon() {
  return (
    <Box
      component="span"
      aria-hidden="true"
      data-testid="my-team-lineup-check"
      sx={{ display: 'flex', color: 'var(--dash-ink)' }}
    >
      <svg
        width={16}
        height={16}
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
      >
        <path d="M4 10.5 8 14.5 16 6" />
      </svg>
    </Box>
  );
}

// The wire's four injury-designation codes (irPolicy.service.js), expanded
// ONLY for the accessible description below - the visible label stays the
// abbreviation ("the injury Badge is specified to read the injury status
// abbreviation", #1101 review). Mirrors shared/ui/InjuryTag's own DESIGNATIONS
// map, duplicated rather than imported: this row never switches Badge variant
// by code (always `warning`, per the design canvas), so it does not compose
// InjuryTag itself, only borrows its code-to-name mapping.
const INJURY_DESIGNATION_NAME = {
  Q: 'Questionable',
  D: 'Doubtful',
  O: 'Out',
  IR: 'Injured reserve',
};

// A starter's injury designation beside his name: the wire's own abbreviation
// (Q/D/O/IR, players.injury_status) on a Badge, always the `warning` variant
// - this row never switches to `danger` the way InjuryTag does elsewhere, per
// the design canvas: "No new contrast pairing: the injury Badge is the
// registered `warning` variant over `dash-surface`" (#1101). Renders nothing
// for a healthy starter (a null/empty status). The accessible description
// expands the code to its full designation ("Injury status: Questionable"),
// the same InjuryTag convention (its docblock: "so a screen reader hears the
// word and not a letter") - a bare "Injury status: O" would leave a listener
// unable to tell "Out" from "Questionable" by ear.
function StarterInjuryBadge({ status }) {
  const code = status ? String(status).trim() : '';
  if (!code) return null;
  const name = INJURY_DESIGNATION_NAME[code.toUpperCase()] || code;
  return (
    <Badge
      variant="warning"
      data-testid="starter-injury-badge"
      sx={{
        fontSize: '10px',
        lineHeight: 1.2,
        flex: 'none',
        '& .MuiChip-label': { px: 0.75, py: 0.25 },
      }}
    >
      <span aria-hidden="true">{code}</span>
      <span style={visuallyHidden}>{`Injury status: ${name}`}</span>
    </Badge>
  );
}

// One starter row: PosChip, name (+ injury Badge when flagged), the
// "NFLTEAM vs OPP" line, and the projection right-aligned in tabular numerals.
// `opponent` is a Team code or null (lineupModel's docblock: null means
// absence - a bye or an unsynced slate - never "unknown"), so a null renders
// the team code ALONE with no "vs" clause and no invented label ("BYE",
// "TBD", "-"): that data cannot support one (#1101 ruling, 2026-09-10).
function StarterRow({ starter }) {
  const secondLine = starter.opponent
    ? `${starter.nflTeam ?? ''} vs ${starter.opponent}`
    : starter.nflTeam ?? '';
  return (
    <Box data-testid="starter-row" sx={{ display: 'flex', alignItems: 'center', gap: '8px', py: '4px' }}>
      <PosChip position={starter.slot} sx={{ flex: 'none' }} />
      <Box sx={{ minWidth: 0, flex: '1 1 auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Box
            component="span"
            sx={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: '13px',
              fontWeight: 600,
              color: 'var(--dash-ink)',
            }}
          >
            {starter.name}
          </Box>
          <StarterInjuryBadge status={starter.injuryStatus} />
        </Box>
        <Box
          component="div"
          data-testid="starter-opponent-line"
          sx={{ fontSize: '11.5px', color: 'var(--dash-faint)' }}
        >
          {secondLine}
        </Box>
      </Box>
      <Box
        component="span"
        data-testid="starter-projection"
        sx={{
          flex: 'none',
          minWidth: '34px',
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
          fontSize: '13px',
          fontWeight: 600,
          color: 'var(--dash-ink)',
        }}
      >
        {/* The bare number has no column header to give it meaning in the
            accessibility tree, so a hidden label names it; the visible glyph
            stays a plain number (the mockup's tabular column). */}
        <span aria-hidden="true">
          {Number.isFinite(starter.projectedPoints) ? starter.projectedPoints.toFixed(1) : '-'}
        </span>
        <span style={visuallyHidden}>
          {Number.isFinite(starter.projectedPoints)
            ? `${starter.projectedPoints.toFixed(1)} projected points`
            : 'Projection not available'}
        </span>
      </Box>
    </Box>
  );
}

function StarterRowSkeleton() {
  return <Skeleton data-testid="my-team-starters-skeleton" variant="text" height={32} />;
}

/**
 * "Starters · Week N": the first five starters, a "and N more starters · M
 * questionable" note, and a footer stating lineup completeness beside the Set
 * Lineup button. `flex: 1 1 auto` on the root lets this section (not the
 * identity row or the tile row) absorb whatever extra height the page's grid
 * stretches the card to.
 *
 * The heading below is deliberately NOT a heading element: the card names
 * itself with exactly one <h2> (its Team name, see the region docs above), and
 * a second heading here would break that count.
 */
function StartersSection({ starters }) {
  const loading = starters.status === 'loading';
  const isLineupSet = !loading && starters.filled >= starters.totalSlots;
  return (
    <Box
      data-testid="my-team-starters"
      sx={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', gap: '10px' }}
    >
      <Typography
        component="div"
        sx={{
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--dash-faint)',
        }}
      >
        {starters.week != null ? `Starters · Week ${starters.week}` : 'Starters'}
      </Typography>

      {loading ? (
        <Box sx={{ display: 'grid', gap: '4px' }}>
          {Array.from({ length: 5 }, (_, i) => (
            <StarterRowSkeleton key={i} />
          ))}
        </Box>
      ) : (
        <>
          <Box sx={{ display: 'grid' }}>
            {starters.rows.map((starter) => (
              <StarterRow key={starter.playerId ?? starter.name} starter={starter} />
            ))}
          </Box>

          {starters.moreCount > 0 && (
            <Typography
              component="div"
              data-testid="my-team-starters-more"
              sx={{ fontSize: '12px', color: 'var(--dash-faint)' }}
            >
              {`and ${starters.moreCount} more starter${starters.moreCount === 1 ? '' : 's'} · ${starters.questionableCount} questionable`}
            </Typography>
          )}

          <Box
            data-testid="my-team-lineup-footer"
            sx={{
              mt: 'auto',
              pt: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {/* The check mark is a "done" affirmation, not a neutral bullet:
                  showing it next to "Lineup incomplete" would tell a sighted
                  manager the opposite of what the text says, so it renders
                  only once the lineup actually is set. */}
              {isLineupSet && <CheckIcon />}
              <Typography
                component="span"
                data-testid="my-team-lineup-status"
                sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--dash-ink)' }}
              >
                {isLineupSet ? 'Lineup set' : 'Lineup incomplete'}
                {` · ${starters.filled} of ${starters.totalSlots}`}
              </Typography>
            </Box>
            <Button component={RouterLink} to={starters.lineupHref} disableElevation sx={PRIMARY_SX}>
              Set Lineup
            </Button>
          </Box>
        </>
      )}
    </Box>
  );
}
