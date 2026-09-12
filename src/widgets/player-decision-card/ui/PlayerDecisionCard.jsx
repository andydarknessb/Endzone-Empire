import React, { useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Button,
  Drawer,
  IconButton,
  Menu,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import { InjuryTag, PosChip, RangeBar } from '../../../shared/ui';
import { formatKickoff, formatPoints, initialsFor, monogramInk } from '../../../shared/lib';
import { MIN_TOUCH_TARGET_SX } from '../../../lib/a11y';
import { NFL_TEAM_COLORS, FALLBACK_KIT } from '../../../lib/nflTeamColors';
import { locked } from '../../../entities/roster';
import { useDecisionCardLine } from '../../../entities/line';
import { useDecisionCardUsage } from '../../../entities/player-usage';
import { isEligibleMove } from '../../../features/swap-players';
import { injuryTileView } from '../lib/injuryTile';
import { benchOptionsForSlot, movesToStart, startTargetSlots } from '../model/slotActions';

/**
 * The Decision card (#1240, ADR 0037, CONTEXT.md's Decision card): the
 * player detail a manager opens from a Ledger row on Lineup - a right-hand
 * drawer on desktop, a bottom sheet on a phone (AC6). Fetches its own Line/
 * Weather/Usage context on open through the `line` and `player-usage`
 * entities' `useDecisionCard*` hooks (ADR 0037: "the Decision card fetches
 * on open"); the row's own fields (name, position, slot, projection, Floor,
 * Ceiling, edge) it already holds from the page's lineup read, so those
 * paint immediately while the extras load in behind them (AC1).
 *
 * A pure presenter over the page's own interaction state, exactly like
 * `lineup-ledger` beside it: `onSwap` performs a slot move (the page's
 * `useSwapPlayers().performMove`), `onRequestDrop`/`canDropEntry` mirror the
 * props `LineupLedger` already forwards to `LedgerRow` for the SAME
 * `useDropPlayer` feature instance, so Drop's confirmation dialog and its
 * Undo toast (AC5) are the one the page already owns, never a second copy.
 * Trade is a real link to the existing trade flow (AC5); this widget builds
 * no trade UI of its own.
 *
 * Replaces `components/PlayerQuickView` on Lineup ONLY (pre-launch ruling 3
 * on the issue thread): the page swaps which dialog `LedgerRow`'s name link
 * opens, and `PlayerQuickView` itself is untouched - other surfaces still
 * render it.
 */
export default function PlayerDecisionCard({
  open,
  onClose,
  entry,
  entries,
  leagueId,
  week,
  bestBall,
  leagueUnsettled,
  onSwap,
  onRequestDrop,
  canDropEntry,
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const [startMenuAnchor, setStartMenuAnchor] = useState(null);
  const [compareMenuAnchor, setCompareMenuAnchor] = useState(null);
  const [compareId, setCompareId] = useState(null);
  const compareButtonRef = useRef(null);

  const list = Array.isArray(entries) ? entries : [];
  const isOpen = Boolean(open && entry);

  const { line, weather } = useDecisionCardLine({ leagueId, playerId: entry?.playerId ?? null, week });
  const { usage } = useDecisionCardUsage({ leagueId, playerId: entry?.playerId ?? null, week });

  const compareEntry = compareId != null ? list.find((e) => e.playerId === compareId) || null : null;
  const { line: compareLine, weather: compareWeather } = useDecisionCardLine({
    leagueId,
    playerId: compareEntry?.playerId ?? null,
    week,
  });
  const { usage: compareUsage } = useDecisionCardUsage({
    leagueId,
    playerId: compareEntry?.playerId ?? null,
    week,
  });

  const handleClose = (event, reason) => {
    setStartMenuAnchor(null);
    setCompareMenuAnchor(null);
    setCompareId(null);
    onClose?.(event, reason);
  };

  // Clearing Compare unmounts the control that had focus; move focus back to
  // the Compare button rather than leaving it to Modal's own focus-trap
  // recovery (which lands on the drawer root, not a control - review finding).
  const clearCompare = () => {
    setCompareId(null);
    compareButtonRef.current?.focus();
  };

  const isStarting = entry ? entry.slot !== 'BENCH' && entry.slot !== 'IR' : false;
  const isLocked = entry ? locked(entry) : false;
  const isSpent = Boolean(entry?.spent);
  // f1/r1/r2/r3 (formal review, round 2): Bench and Start now ask the SAME
  // eligibility rule the row path uses (`isEligibleMove`, exported from
  // `swap-players`) rather than a hand-enumerated set of conditions - the
  // enumeration had already missed a spent starter's Bench button, a spent
  // Start target, and the whole rule while the league is unsettled, three
  // of `onRowClick`'s own refusals a second, independent copy could not
  // help drifting out of sync with. `startTargetSlots` checks every current
  // occupant of a slot type, not just the first one found (r5), so a slot
  // type with more than one instance is no longer disabled outright by a
  // single locked or spent occupant.
  const benchAllowed = entry
    ? isEligibleMove({ selectedEntry: entry, targetEntry: null, targetSlot: 'BENCH', bestBall, leagueUnsettled })
    : false;
  const startTargets = entry && !isStarting
    ? startTargetSlots(entry, list, { bestBall, leagueUnsettled })
    : [];
  // Formal review round 3 finding s2: `movesToStart` returns `[]` as its own
  // refusal for the rare case `startTargets` goes stale (the menu stayed
  // open across a refetch or another move), but `onSwap` is `performMove`,
  // which PUTs an empty `moves` array and reports "Lineup saved" just as
  // readily as a real move - an empty array is a refusal only if the CALLER
  // treats it as one. This is that treatment, used by both call sites below
  // instead of each re-deriving the same guard.
  const startInto = (slot) => {
    const moves = movesToStart(entry, slot, list, { bestBall, leagueUnsettled });
    if (moves.length > 0) onSwap?.(moves);
  };
  const dropAllowed = entry ? Boolean(!isSpent && canDropEntry?.(entry)) : false;
  const compareCandidates = entry ? list.filter((e) => e && e.playerId !== entry.playerId) : [];
  // Best ball still hides bench options entirely (a best-ball lineup isn't
  // manually managed at all, matching how the page hides the Start/sit
  // panel rather than disabling it - LineupPage.test.jsx, "best ball hides
  // the Start/sit panel entirely"). A locked or spent OPENED player no
  // longer hides the section (round 2): it renders with every Swap's own
  // eligibility computed per candidate via `isEligibleMove`, and "the lock
  // shown" for THIS player is the header's Locked/Spent indicator just
  // below, not a duplicate per-row note (that note stays reserved for a
  // locked CANDIDATE, an independent fact `BenchOptionsSection` still
  // carries on its own).
  const benchOptionsHidden = isStarting && bestBall;

  return (
    <Drawer
      anchor={isMobile ? 'bottom' : 'right'}
      open={isOpen}
      onClose={handleClose}
      // Formal review finding f8: PlayerQuickView, the dialog this card
      // replaces on Lineup, deliberately sets `{ appear: 0, enter: 0, exit:
      // 120 }` (instant open, a brief exit) rather than flattening both to
      // zero; an earlier revision here shipped the flattened, test-only-
      // looking value to production with no stated reason. Matching that
      // precedent rather than re-arguing it.
      transitionDuration={{ appear: 0, enter: 0, exit: 120 }}
      PaperProps={{
        role: 'dialog',
        'aria-modal': true,
        'aria-labelledby': entry ? 'decision-card-title' : undefined,
        'data-testid': 'decision-card',
        'data-variant': isMobile ? 'sheet' : 'drawer',
        sx: {
          width: { xs: '100%', sm: compareEntry ? 760 : 420 },
          maxWidth: '100%',
          height: isMobile ? '88vh' : '100%',
          borderTopLeftRadius: isMobile ? 16 : 0,
          borderTopRightRadius: isMobile ? 16 : 0,
          overflowY: 'auto',
        },
      }}
    >
      {entry && (
        <>
          {isMobile && <DragHandle />}

          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
              <HeaderAvatar name={entry.name} nflTeam={entry.nflTeam} />
              <Box sx={{ minWidth: 0 }}>
                <Typography id="decision-card-title" component="h2" sx={{ fontSize: 18, fontWeight: 700 }} noWrap>
                  {entry.name}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.25, flexWrap: 'wrap' }}>
                  <PosChip position={entry.slot} />
                  <InjuryTag status={entry.injuryStatus} />
                  <Typography sx={{ fontSize: 12, color: 'var(--dash-faint)' }}>{entry.nflTeam}</Typography>
                  {isLocked && (
                    <Typography
                      component="span"
                      data-testid="decision-card-locked"
                      sx={{ fontSize: 11, fontWeight: 700, color: 'var(--dash-faint)' }}
                    >
                      Locked
                    </Typography>
                  )}
                  {entry.spent && (
                    <Typography
                      component="span"
                      data-testid="decision-card-spent"
                      sx={{ fontSize: 11, fontWeight: 700, color: 'var(--dash-warning)' }}
                    >
                      Spent
                    </Typography>
                  )}
                </Box>
              </Box>
            </Box>
            <IconButton aria-label="Close" onClick={handleClose} sx={MIN_TOUCH_TARGET_SX} data-testid="decision-card-close">
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>

          <Box data-testid="decision-card-actions" sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', px: 2, pb: 1.5 }}>
            {isStarting ? (
              <Button
                size="small"
                variant="outlined"
                disabled={!benchAllowed}
                onClick={() => onSwap?.([{ playerId: entry.playerId, slot: 'BENCH' }])}
                sx={MIN_TOUCH_TARGET_SX}
                data-testid="decision-card-bench-action"
              >
                Bench
              </Button>
            ) : (
              <Button
                size="small"
                variant="outlined"
                disabled={startTargets.length === 0}
                aria-haspopup={startTargets.length > 1 ? 'menu' : undefined}
                aria-expanded={startTargets.length > 1 ? Boolean(startMenuAnchor) : undefined}
                onClick={(event) =>
                  startTargets.length === 1
                    ? startInto(startTargets[0])
                    : setStartMenuAnchor(event.currentTarget)
                }
                sx={MIN_TOUCH_TARGET_SX}
                data-testid="decision-card-start-action"
              >
                Start
              </Button>
            )}
            <Menu
              anchorEl={startMenuAnchor}
              open={Boolean(startMenuAnchor)}
              onClose={() => setStartMenuAnchor(null)}
              MenuListProps={{ 'aria-label': 'Eligible starting slots' }}
            >
              {startTargets.map((slot) => (
                <MenuItem
                  key={slot}
                  onClick={() => {
                    setStartMenuAnchor(null);
                    startInto(slot);
                  }}
                >
                  {slot}
                </MenuItem>
              ))}
            </Menu>

            <Button
              ref={compareButtonRef}
              size="small"
              variant="outlined"
              aria-haspopup="menu"
              aria-expanded={Boolean(compareMenuAnchor)}
              onClick={(event) => setCompareMenuAnchor(event.currentTarget)}
              sx={MIN_TOUCH_TARGET_SX}
              data-testid="decision-card-compare-action"
            >
              {compareEntry ? 'Change compare' : 'Compare'}
            </Button>
            <Menu
              anchorEl={compareMenuAnchor}
              open={Boolean(compareMenuAnchor)}
              onClose={() => setCompareMenuAnchor(null)}
              MenuListProps={{ 'aria-label': 'Players to compare' }}
            >
              {compareCandidates.length === 0 ? (
                <MenuItem disabled>No other players to compare</MenuItem>
              ) : (
                compareCandidates.map((candidate) => (
                  <MenuItem
                    key={candidate.playerId}
                    onClick={() => {
                      setCompareMenuAnchor(null);
                      setCompareId(candidate.playerId);
                    }}
                  >
                    {candidate.name}
                  </MenuItem>
                ))
              )}
            </Menu>

            <Button
              size="small"
              variant="outlined"
              component={RouterLink}
              to={`/league/${leagueId}/trades`}
              onClick={handleClose}
              sx={MIN_TOUCH_TARGET_SX}
              data-testid="decision-card-trade"
            >
              Trade
            </Button>

            <Button
              size="small"
              variant="outlined"
              color="error"
              disabled={!dropAllowed}
              onClick={() => onRequestDrop?.(entry)}
              sx={MIN_TOUCH_TARGET_SX}
              data-testid="decision-card-drop"
            >
              Drop
            </Button>
          </Box>

          {compareEntry ? (
            // AC7: two cards side by side (stacked on a phone). The primary
            // player's own sections render ONCE, inside this grid's left
            // column - review finding: an earlier revision also rendered
            // them again above the grid via a second `ComparePlayerPanel`,
            // duplicating every heading, table and RangeBar. Each panel's
            // own name is a heading (`h3`) so a screen reader's heading
            // navigation can tell the two players' Game/Usage/Weekly
            // projection headings apart; the sections nested under it step
            // down to `h4` to keep that outline properly nested.
            //
            // Both panels render AC2's own section order (Injury, Game,
            // Projection, Usage) - formal review finding f4: an earlier
            // revision put the compared player's Projection before Game and
            // dropped Injury entirely, an asymmetry the de-duplication fix
            // introduced rather than the original design. Injury is
            // deliberately restored on BOTH sides: hiding one player's
            // injury designation makes a side-by-side start-sit comparison
            // read thinner than the single-card view it stands next to.
            // Bench options stay primary-only: they manage the PRIMARY
            // player's own slot (AC4), and offering them a second time for
            // the compared player would mean managing two different slots
            // from one Compare view, which is new surface no criterion asks
            // for here.
            <Box
              data-testid="decision-card-compare"
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                borderTop: '2px solid var(--dash-line)',
              }}
            >
              <Box data-testid={`decision-card-compare-panel-${entry.playerId}`}>
                <Typography component="h3" sx={{ fontWeight: 700, px: 2, pt: 1.5 }}>{entry.name}</Typography>
                <InjurySection entry={entry} level="h4" />
                <GameSection entry={entry} line={line} weather={weather} level="h4" />
                <ProjectionSection entry={entry} level="h4" />
                <UsageSection usage={usage} level="h4" />
                <BenchOptionsSection
                  entry={entry}
                  entries={list}
                  onSwap={onSwap}
                  level="h4"
                  hidden={benchOptionsHidden}
                  bestBall={bestBall}
                  leagueUnsettled={leagueUnsettled}
                />
              </Box>
              <Box
                data-testid={`decision-card-compare-panel-${compareEntry.playerId}`}
                sx={{ borderTop: { xs: '1px solid var(--dash-line)', md: 0 }, borderLeft: { md: '1px solid var(--dash-line)' } }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2, pt: 1.5 }}>
                  <Typography component="h3" sx={{ fontWeight: 700 }}>{compareEntry.name}</Typography>
                  <IconButton size="small" aria-label="Clear compare" onClick={clearCompare} sx={MIN_TOUCH_TARGET_SX}>
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Box>
                <InjurySection entry={compareEntry} level="h4" />
                <GameSection entry={compareEntry} line={compareLine} weather={compareWeather} level="h4" />
                <ProjectionSection entry={compareEntry} level="h4" />
                <UsageSection usage={compareUsage} level="h4" />
              </Box>
            </Box>
          ) : (
            <>
              <InjurySection entry={entry} />
              <GameSection entry={entry} line={line} weather={weather} />
              <ProjectionSection entry={entry} />
              <UsageSection usage={usage} />
              <BenchOptionsSection
                entry={entry}
                entries={list}
                onSwap={onSwap}
                hidden={benchOptionsHidden}
                bestBall={bestBall}
                leagueUnsettled={leagueUnsettled}
              />
            </>
          )}
        </>
      )}
    </Drawer>
  );
}

// The phone sheet's drag handle (AC6): decorative only - the sheet closes on
// Escape and the close control, never by an actual drag gesture this ticket
// implements.
function DragHandle() {
  return (
    <Box
      aria-hidden="true"
      data-testid="decision-card-drag-handle"
      sx={{
        width: 36,
        height: 4,
        borderRadius: 'var(--radius-pill)',
        backgroundColor: 'var(--dash-line)',
        mx: 'auto',
        mt: 1,
        mb: 0.5,
      }}
    />
  );
}

// The header's avatar: initials on the NFL team's jersey colour, restated
// from `lineup-ledger/ui/LedgerRow.jsx`'s own private `PlayerAvatar` (not
// exported from there for this widget to share) at the header's larger size.
// The ink is `monogramInk(kit.jersey)` (`shared/lib`, #1301/#1317), the same
// fixed white-or-black rule `PlayerAvatar` uses and for the same reason: a
// themed token is the wrong ink for `kit.jersey`, an external NFL brand color
// that stays fixed across light and dark mode. One 4.5:1 rule covers this
// 20px bold header too - the stricter normal-text threshold costs nothing
// here and keeps a single helper for all three monogram sites.
function HeaderAvatar({ name, nflTeam }) {
  const kit = NFL_TEAM_COLORS[nflTeam] || FALLBACK_KIT;
  return (
    <Box
      aria-hidden="true"
      sx={{
        width: 56,
        height: 56,
        borderRadius: '50%',
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 20,
        fontWeight: 700,
        bgcolor: kit.jersey,
        color: monogramInk(kit.jersey),
      }}
    >
      {initialsFor(name)}
    </Box>
  );
}

function Section({ title, testId, level = 'h3', children }) {
  return (
    <Box data-testid={testId} sx={{ px: 2, py: 1.5, borderTop: '1px solid var(--dash-line)' }}>
      {title && (
        <Typography
          component={level}
          sx={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--dash-faint)',
            mb: 1,
          }}
        >
          {title}
        </Typography>
      )}
      {children}
    </Box>
  );
}

// AC2/AC3: the injury designation and the feed's detail, hidden entirely for
// a healthy player (null source).
function InjurySection({ entry, level }) {
  const view = injuryTileView(entry);
  if (!view) return null;
  return (
    <Section title="Injury" testId="decision-card-injury" level={level}>
      <Typography sx={{ fontSize: 14 }}>{view.name}</Typography>
      {view.detail && (
        <Typography sx={{ fontSize: 13, color: 'var(--dash-faint)', mt: 0.5 }}>{view.detail}</Typography>
      )}
    </Section>
  );
}

// AC2/AC3: opponent, kickoff, Line, Implied team total (both hidden together
// on a null Line) and weather with indoor (hidden on a null weather).
function GameSection({ entry, line, weather, level }) {
  const hasOpponent = entry.opponent != null;
  const kickoff = formatKickoff(entry.kickoff);
  const showLine = line != null;
  const showWeather = weather != null;
  if (!hasOpponent && !showLine && !showWeather) return null;
  return (
    <Section title="Game" testId="decision-card-game" level={level}>
      {hasOpponent && (
        <Typography sx={{ fontSize: 14 }} data-testid="decision-card-opponent">
          {`vs ${entry.opponent}${kickoff ? ` · ${kickoff}` : ''}`}
        </Typography>
      )}
      {showLine && (
        <Box data-testid="decision-card-line" sx={{ mt: 0.5, display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: 13, color: 'var(--dash-faint)' }}>
            {`Line: ${line.spread != null ? line.spread : '-'} / ${line.total != null ? line.total : '-'}`}
          </Typography>
          {line.impliedTeamTotal != null && (
            <Typography data-testid="decision-card-implied-total" sx={{ fontSize: 13, color: 'var(--dash-faint)' }}>
              {`Implied team total: ${formatPoints(line.impliedTeamTotal)}`}
            </Typography>
          )}
        </Box>
      )}
      {showWeather && (
        <Typography data-testid="decision-card-weather" sx={{ mt: 0.5, fontSize: 13, color: 'var(--dash-faint)' }}>
          {weather.indoor
            ? 'Indoor'
            : [
                weather.temperatureF != null ? `${weather.temperatureF}°F` : null,
                weather.windSpeedMph != null ? `${weather.windSpeedMph} mph wind` : null,
                weather.shortForecast || null,
              ]
                .filter(Boolean)
                .join(' · ') || 'Weather unavailable'}
        </Typography>
      )}
    </Section>
  );
}

// AC2: mean, Floor, Ceiling on the shared RangeBar, and the largest Factor's
// explanation. `entry.factorExplanation` (#1281) rides the lineup entry as
// its own field, independent of the Edge line: `lineup.service.js` sets it
// from the SAME `factorEdgeText(factors)` call that can win the Edge line's
// `factor` kind, but unconditionally, so it renders here even when a
// higher-priority kind (injury, bench-above-starter) won the Edge line
// instead - an injured player can show both his injury tile and his
// largest Factor's explanation at once. Null when no factor applies.
function ProjectionSection({ entry, level }) {
  const factorText = entry.factorExplanation || null;
  return (
    <Section title="Weekly projection" testId="decision-card-projection" level={level}>
      <RangeBar
        floor={entry.floor}
        ceiling={entry.ceiling}
        projection={entry.projection}
        label={entry.name}
        data-testid="decision-card-range-bar"
      />
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5, fontSize: 12, color: 'var(--dash-faint)' }}>
        <span>{`Floor ${formatPoints(entry.floor)}`}</span>
        <span>{`Proj ${formatPoints(entry.projection)}`}</span>
        <span>{`Ceiling ${formatPoints(entry.ceiling)}`}</span>
      </Box>
      {factorText && (
        <Typography data-testid="decision-card-factor" sx={{ mt: 1, fontSize: 13 }}>
          {factorText}
        </Typography>
      )}
    </Section>
  );
}

// AC2/AC3: the last three weeks beside the season average, hidden entirely
// on empty usage (his team had no played week yet).
function UsageSection({ usage, level }) {
  if (!usage || !Array.isArray(usage.weeks) || usage.weeks.length === 0) return null;
  const rows = [
    ...usage.weeks.map((w) => ({ ...w, isAverage: false })),
    { ...usage.seasonAverage, isAverage: true },
  ];
  return (
    <Section title="Usage" testId="decision-card-usage" level={level}>
      <Table size="small" aria-label="Usage" data-testid="decision-card-usage-table">
        <TableHead>
          <TableRow>
            <TableCell>Week</TableCell>
            <TableCell align="right">Tgt</TableCell>
            <TableCell align="right">Car</TableCell>
            <TableCell align="right">Air yds</TableCell>
            <TableCell align="right">Tgt share</TableCell>
            <TableCell align="right">FPTS</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.isAverage ? 'season-average' : `${row.season}-${row.week}`}>
              <TableCell>{row.isAverage ? 'Season avg' : `Wk ${row.week}`}</TableCell>
              <TableCell align="right">{row.targets ?? '-'}</TableCell>
              <TableCell align="right">{row.carries ?? '-'}</TableCell>
              <TableCell align="right">{row.airYards ?? '-'}</TableCell>
              <TableCell align="right">{row.targetShare != null ? `${Math.round(row.targetShare * 100)}%` : '-'}</TableCell>
              <TableCell align="right">{formatPoints(row.fantasyPoints)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}

// AC4: the bench players eligible for the opened player's slot, ordered by
// projection, each with its own swap (through the SAME move `onSwap`
// performs for every other action here) and a locked candidate disabled
// with the lock shown as text, matching LedgerRow's own lock treatment in
// spirit without duplicating its SVG glyph.
//
// `hidden` (formal review round 2): a best-ball lineup isn't manually
// managed at all, matching how the page hides the Start/sit panel entirely
// rather than disabling it (LineupPage.test.jsx, "best ball hides the
// Start/sit panel entirely"), so this section still hides outright in that
// case. Locked or spent no longer hides the section (round 2, r1/r3): each
// candidate's own `swapEligible` (from `benchOptionsForSlot`, itself built
// on `isEligibleMove` - the same rule `onRowClick` uses) already accounts
// for the OPENED player being locked, spent, or league-unsettled, alongside
// the candidate's own state, so passing `bestBall`/`leagueUnsettled` through
// here is what makes that true rather than a second, separate gate. AC4's
// "the lock shown" for the opened player himself is the header's Locked/
// Spent indicator, not a duplicate per-row note - that note stays reserved
// below for a locked CANDIDATE specifically, an independent fact.
function BenchOptionsSection({ entry, entries, onSwap, level, hidden, bestBall, leagueUnsettled }) {
  if (hidden) return null;
  const options = benchOptionsForSlot(entries, entry.slot, { entry, bestBall, leagueUnsettled });
  if (options.length === 0) return null;
  return (
    <Section title="Bench options" testId="decision-card-bench-options" level={level}>
      <Box component="ul" role="list" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1 }}>
        {options.map(({ entry: candidate, locked: candidateLocked, swapEligible }) => (
          <Box
            component="li"
            key={candidate.playerId}
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <PosChip position={candidate.position} />
              <Typography sx={{ fontSize: 13 }} noWrap>{candidate.name}</Typography>
              <Typography sx={{ fontSize: 12, color: 'var(--dash-faint)' }}>{formatPoints(candidate.projection)}</Typography>
              {candidateLocked && (
                <Typography
                  component="span"
                  data-testid="decision-card-bench-option-lock"
                  sx={{ fontSize: 11, fontWeight: 700, color: 'var(--dash-faint)' }}
                >
                  Locked
                </Typography>
              )}
            </Box>
            <Button
              size="small"
              variant="outlined"
              disabled={!swapEligible}
              aria-label={`Swap in ${candidate.name}`}
              onClick={() =>
                onSwap?.([
                  { playerId: candidate.playerId, slot: entry.slot },
                  { playerId: entry.playerId, slot: candidate.slot },
                ])
              }
              sx={MIN_TOUCH_TARGET_SX}
              data-testid={`decision-card-bench-swap-${candidate.playerId}`}
            >
              Swap
            </Button>
          </Box>
        ))}
      </Box>
    </Section>
  );
}
