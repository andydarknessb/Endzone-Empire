import React from 'react';
import { Avatar, Box, IconButton, Tooltip, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { GameStateChip, InjuryTag, PosChip } from '../../../shared/ui';
import { formatPoints, initialsFor, monogramInk, unavailableLabel } from '../../../shared/lib';
import { NFL_TEAM_COLORS, FALLBACK_KIT } from '../../../lib/nflTeamColors';
import PlayerNameLink from '../../../components/PlayerQuickView/PlayerNameLink';
import EdgeLineIcon from '../lib/EdgeLineIcon';
import { edgeLineColor, displayEdgeKind } from '../lib/edgeLine';
import { gameCellView } from '../lib/gameCell';

// A closed padlock: AC3, "locked rows show a lock, not a chip" - a small
// inline glyph beside the name rather than the legacy page's "LOCKED" chip.
function LockIcon() {
  return (
    <svg
      width={13}
      height={13}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flex: 'none' }}
    >
      <rect x="5" y="9" width="10" height="7" rx="1.5" />
      <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
    </svg>
  );
}

// The Situation line (CONTEXT.md's Situation; ADR 0037 ticket 9, #1241 AC1;
// last play added #1292): possession, down/distance and the last play under
// the live state chip, in that order, with a red zone marker when the flag
// is set. Fields that are null are omitted entirely (never rendered as the
// literal word "null"); the line itself renders nothing when none of
// possession, down/distance or last play is known yet and the red zone flag
// is false - a live game with no Situation data yet degrades to the
// clock/score chip alone rather than an empty line. Pushing `lastPlay` into
// `parts` (rather than appending after this guard) means a row carrying only
// a last play - no possession, no down/distance, red zone false - still
// renders the line, and the existing `parts.join(' · ')` below gives it the
// same middot separator with no separator at all for a single part.
function SituationLine({ possession, downDistance, lastPlay, redZone }) {
  const parts = [];
  if (possession) parts.push(`${possession} ball`);
  if (downDistance) parts.push(downDistance);
  if (lastPlay) parts.push(lastPlay);
  if (parts.length === 0 && !redZone) return null;
  return (
    <Box
      data-testid="ledger-situation-line"
      sx={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10.5px', color: 'var(--dash-faint)' }}
    >
      {parts.length > 0 && <span>{parts.join(' · ')}</span>}
      {redZone && (
        <Box
          component="span"
          data-testid="ledger-red-zone-marker"
          sx={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.03em', color: 'var(--dash-danger)' }}
        >
          RZ
        </Box>
      )}
    </Box>
  );
}

// The Game cell (see ../lib/gameCell.js), rendered as one GameStateChip plus
// (while live) the Situation line beneath it. `view` is computed once by the
// caller (LedgerRow, below) so the same read also drives the points cell's
// live colour and the Edge line's kind transition (AC2/AC3) without a second
// call to gameCellView.
function GameCell({ view }) {
  if (!view) return null;
  if (view.kind === 'unavailable') {
    // The chip's own state names the reason (bye/out/ir), never a blanket
    // "bye" for every Unavailable cause (formal review finding
    // game-state-chip-bye-for-every-unavailable-reason).
    const state = view.reason === 'bye' ? 'bye' : 'unavailable';
    return <GameStateChip state={state} data-testid="ledger-game-cell">{view.reasonLabel || 'unavailable'}</GameStateChip>;
  }
  if (view.kind === 'pre') {
    const label = view.opponent ? `vs ${view.opponent}${view.kickoff ? ` · ${view.kickoff}` : ''}` : (view.kickoff || 'Bye');
    return <GameStateChip state="pre" data-testid="ledger-game-cell">{label}</GameStateChip>;
  }
  if (view.kind === 'live') {
    const score = view.teamScore != null && view.opponentScore != null ? `${view.teamScore}-${view.opponentScore} · ` : '';
    return (
      <Box sx={{ display: 'grid', justifyItems: 'flex-end', gap: '2px' }}>
        <GameStateChip state="live" data-testid="ledger-game-cell">{`${score}${view.trailing}`}</GameStateChip>
        <SituationLine possession={view.possession} downDistance={view.downDistance} lastPlay={view.lastPlay} redZone={view.redZone} />
      </Box>
    );
  }
  // "Final" always carries the word, not just the chip's colour (a final
  // state must not be distinguishable by colour/absence alone, matching the
  // "pre" and "live" states, which both carry a word of their own).
  const score = view.teamScore != null && view.opponentScore != null ? `Final ${view.teamScore}-${view.opponentScore}` : 'Final';
  return <GameStateChip state="final" data-testid="ledger-game-cell">{score}</GameStateChip>;
}

// The Edge line (CONTEXT.md's Edge line): one icon, one line of text, in the
// kind's own colour. Renders nothing for `none` or a missing edge, per
// `computeEdgeLine`'s own contract (server/services/lineup.service.js).
//
// `gameCellKind` (#1241 AC3, ADR 0037 ticket 9) is the same `view.kind`
// computed once for the Game cell: `displayEdgeKind` (../lib/edgeLine.js)
// transitions the server's own `pace`/`result` kind instantly with the
// live game's own state, so the icon/colour and `data-edge-kind` never lag
// a live-to-final transition the Realtime channel already knows about,
// even though the server's own `edge.text` only refreshes on the next
// lineup fetch.
function EdgeLine({ edge, gameCellKind }) {
  if (!edge || edge.kind === 'none' || !edge.text) return null;
  const kind = displayEdgeKind(edge.kind, gameCellKind);
  return (
    <Box
      data-testid="ledger-edge-line"
      data-edge-kind={kind}
      sx={{ display: 'flex', alignItems: 'center', gap: '5px', mt: '2px', color: edgeLineColor(kind) }}
    >
      <EdgeLineIcon kind={kind} />
      <Typography component="span" sx={{ fontSize: '11.5px', fontWeight: 600, lineHeight: 1.3 }}>
        {edge.text}
      </Typography>
    </Box>
  );
}

// The player's avatar: initials on the NFL team's jersey colour (CONTEXT.md's
// Ledger row, "avatar with the NFL team colour"). No photo plumbing on this
// endpoint yet, matching the entity's own scope. The label ink is
// `monogramInk(kit.jersey)` (`shared/lib`, #1301/#1317), not a themed token: a
// themed token is the wrong ink for a background the theme does not change -
// `kit.jersey` is a real external NFL brand color
// (`src/lib/nflTeamColors.js`, the one file the color-literals guard
// allowlists for real NFL hex values) that stays the same fixed hex across
// light and dark mode, so the ink drawn on it has to stay fixed alongside it
// too. The themed text-inverse token this replaces failed 29 of 32 jerseys
// below 4.5:1 in dark mode before this fix.
function PlayerAvatar({ name, nflTeam }) {
  const kit = NFL_TEAM_COLORS[nflTeam] || FALLBACK_KIT;
  return (
    <Avatar
      aria-hidden="true"
      sx={{ width: 36, height: 36, fontSize: 13, bgcolor: kit.jersey, color: monogramInk(kit.jersey) }}
    >
      {initialsFor(name)}
    </Avatar>
  );
}

/**
 * One Ledger row (CONTEXT.md's Ledger row; ADR 0037; #1237): slot, avatar,
 * name with injury designation and lock, position and Team code, the Game
 * cell, the Edge line, projection and points. An empty slot renders a plain
 * "Empty" placeholder; the row-level swap/quick-pick interaction and the
 * drop control are both driven by props supplied by the page (the
 * swap-players and drop-player features), so this widget stays a
 * presenter.
 *
 * Structure (formal review findings ac1-widgets-reach-below-the-island's
 * sibling fixes and legacy-controls-dropped-without-a-criterion): the row's
 * own swap-select action is an invisible `<button>` absolutely covering the
 * row, UNDER the visible content, which is `pointer-events: none` except two
 * reclaimed islands - the player's name (a real `PlayerNameLink`, opening
 * the Decision card the page owns, #1240) and the Drop control - each independently
 * focusable and clickable without being a DOM descendant of the covering
 * button. That is what keeps `role`less nested-interactive controls out of
 * a widget role, restores the name as a real link (dropped without a
 * criterion authorising it), and is why neither control's own keydown can
 * ever bubble into the row's handler.
 *
 * `data-testid` (the caller's `testId`) names the OUTER wrapper, not the
 * covering button: `tests/e2e/auth-offline.spec.ts` asserts
 * `getByTestId('slot-row-...')` CONTAINS the row's own text (the player's
 * name, per its own `toContainText` check), and the covering button carries
 * no text of its own by design - the contract is "the testid'd element
 * contains the row's text", not "the testid'd element is the interactive
 * one". The covering button gets its own derived id (`${testId}-select`)
 * for anything that specifically needs the interactive element (a click, its
 * `aria-pressed`/`aria-label`/`disabled`), which is every unit test in
 * LedgerRow.test.jsx.
 */
export default function LedgerRow({
  slotLabel,
  entry,
  liveRow,
  selected,
  showEligibility,
  eligible,
  disabled,
  swapHighlighted,
  onClick,
  onRequestDrop,
  canDrop,
  onOpenDecisionCard = () => {},
  'data-testid': testId,
}) {
  const isEmpty = !entry;
  const unavailable = !isEmpty && entry.availability && entry.availability.available === false;
  // Computed once here (rather than inside GameCell) so the same read also
  // drives the points cell's live colour and the Edge line's kind
  // transition (#1241 AC2/AC3) without a second call to gameCellView.
  const view = isEmpty ? null : gameCellView(entry, liveRow);
  const projectionText = isEmpty
    ? null
    : unavailable
      ? unavailableLabel(entry.availability.reason) || 'unavailable'
      : formatPoints(entry.projection);
  // The points cell (AC2/AC3): the entry's actual/live fantasy points once
  // his game is live or final, a dash reserved for an Unavailable row (never
  // plays) and for a pre-kickoff row (nothing scored yet) alike -
  // `formatPoints` already renders a dash for a null value, so an
  // unavailable entry's points (always null on the wire) and a not-yet-
  // started entry's points (also null) both fall through to it without a
  // separate branch. #1241 AC2: while the game is live (never once final),
  // the points cell paints in the live colour (`dash-danger`, the same
  // token the live Game-state chip and the Edge line's own `pace` kind
  // already use on this card surface) so a live score reads at a glance.
  const pointsText = isEmpty ? null : unavailable ? '-' : formatPoints(entry.points);
  const pointsColor = !isEmpty && !unavailable && view?.kind === 'live' ? 'var(--dash-danger)' : 'var(--dash-faint)';

  // The row's own accessible name (WAI-ARIA accname: an explicit aria-label
  // wins outright over the button's accumulated content), so a screen
  // reader hears one concise phrase per row rather than every chip, the
  // Edge line and the visually-hidden points caption concatenated together.
  const rowLabel = isEmpty
    ? `Empty ${slotLabel} slot`
    : [
        entry.name,
        slotLabel,
        entry.locked && 'locked',
        unavailable && (unavailableLabel(entry.availability.reason) || 'unavailable'),
      ].filter(Boolean).join(', ');

  return (
    <Box
      data-testid={testId}
      data-spent={entry?.spent ? 'true' : undefined}
      sx={{ position: 'relative', display: 'flex', alignItems: { xs: 'flex-start', sm: 'center' }, gap: '8px', mb: '8px' }}
    >
      <Box
        component="button"
        type="button"
        disabled={disabled}
        aria-pressed={Boolean(selected)}
        aria-label={rowLabel}
        data-testid={testId ? `${testId}-select` : undefined}
        onClick={onClick}
        sx={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          zIndex: 0,
          m: 0,
          p: 0,
          border: 'none',
          borderRadius: 'var(--dash-radius-sm)',
          backgroundColor: 'transparent',
          cursor: disabled ? 'default' : 'pointer',
          '&:focus-visible': { outline: '2px solid var(--focus-ring)', outlineOffset: 2 },
          '&:disabled': { cursor: 'default' },
        }}
      />

      <Box
        sx={{
          position: 'relative',
          zIndex: 1,
          pointerEvents: 'none',
          flexGrow: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          flexWrap: 'wrap',
          gap: '10px',
          p: '10px 12px',
          borderRadius: 'var(--dash-radius-sm)',
          border: '1px solid',
          borderStyle: isEmpty ? 'dashed' : 'solid',
          borderColor: selected || swapHighlighted
            ? 'var(--dash-accent-line)'
            : showEligibility && eligible
              ? 'var(--dash-accent-line)'
              : entry?.spent
                ? 'var(--dash-warning)'
                : 'var(--dash-line)',
          backgroundColor: (selected || swapHighlighted || (showEligibility && eligible))
            ? 'var(--dash-accent-soft)'
            : 'var(--dash-surface)',
          opacity: showEligibility && !eligible && !selected ? 0.45 : 1,
        }}
      >
        <PosChip position={slotLabel} data-testid="ledger-slot-chip" />

        {isEmpty ? (
          <Typography sx={{ flexGrow: 1, fontSize: '13px', color: 'var(--dash-faint)' }}>Empty</Typography>
        ) : (
          <>
            <PlayerAvatar name={entry.name} nflTeam={entry.nflTeam} />

            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <PlayerNameLink
                  name={entry.name}
                  playerId={entry.playerId}
                  onOpen={onOpenDecisionCard}
                  sx={{
                    pointerEvents: 'auto',
                    fontSize: '14px',
                    fontWeight: 600,
                    color: 'var(--dash-ink)',
                  }}
                />
                <InjuryTag status={entry.injuryStatus} />
                {entry.locked && (
                  <Tooltip title="Locked: this player's game has kicked off">
                    {/* role="img" legitimizes the aria-label on this otherwise
                        generic span (WAI-ARIA: aria-label is only valid on an
                        element with an appropriate role) - the same pattern
                        TeamAvatar's wrapper and my-team-summary's avatar
                        wrapper already use, rather than relying on MUI
                        Tooltip's own child-labelling, which would land the
                        same aria-label on a bare, non-focusable span. */}
                    <Box
                      component="span"
                      role="img"
                      aria-label="Locked: this player's game has kicked off"
                      data-testid="ledger-lock-icon"
                      sx={{ display: 'flex', color: 'var(--dash-faint)' }}
                    >
                      <LockIcon />
                    </Box>
                  </Tooltip>
                )}
                {entry.slot === 'IR' && entry.irAttested && (
                  <Tooltip title="Attested by the commissioner: this stash stays valid even though the injury feed disagrees.">
                    <Box
                      component="span"
                      data-testid="ledger-attested-chip"
                      sx={{
                        fontSize: '10px',
                        fontWeight: 700,
                        letterSpacing: '0.05em',
                        color: 'var(--dash-accent)',
                        border: '1px solid var(--dash-accent-line)',
                        borderRadius: 'var(--radius-pill)',
                        px: '6px',
                      }}
                    >
                      ATTESTED
                    </Box>
                  </Tooltip>
                )}
                {entry.spent && (
                  <Box
                    component="span"
                    data-testid="ledger-spent-chip"
                    sx={{ fontSize: '10px', fontWeight: 700, color: 'var(--dash-warning)' }}
                  >
                    SPENT
                  </Box>
                )}
              </Box>
              <Typography
                component="div"
                sx={{ fontSize: '12px', color: 'var(--dash-faint)' }}
              >
                {`${entry.position ?? ''} · ${entry.nflTeam ?? ''}`}
              </Typography>
              <EdgeLine edge={entry.edge} gameCellKind={view?.kind} />
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <GameCell view={view} />

              <Box sx={{ display: 'grid', textAlign: 'right' }}>
                <Typography
                  component="span"
                  data-testid="ledger-projection"
                  sx={{ fontSize: '11px', color: unavailable ? 'var(--dash-faint)' : 'var(--dash-ink)', fontWeight: 600 }}
                >
                  {projectionText}
                </Typography>
                <Typography component="span" data-testid="ledger-points" sx={{ fontSize: '10.5px', color: pointsColor }}>
                  {pointsText === '-' ? (
                    <>
                      <span aria-hidden="true">-</span>
                      <span style={visuallyHidden}>Points not available yet</span>
                    </>
                  ) : (
                    pointsText
                  )}
                </Typography>
              </Box>
            </Box>
          </>
        )}
      </Box>

      {/* Drop is a SIBLING of the row's covering button, not a descendant of
          any widget-role element: nesting a real <button> inside a role like
          the row's own is an axe-core `nested-interactive` violation, is not
          reliably exposed to a screen reader, and (found in review) let this
          control's own Enter/Space keydown bubble into the row's handler,
          silently starting a swap instead of dropping the player - a
          keyboard user could never reach Drop at all. As a sibling, painted
          above the covering button (`position: relative`, an implicit
          stacking context on top of the button's `zIndex: 0`), it is
          independently focusable and its own native button semantics handle
          Enter/Space without the row's handler ever seeing the event. */}
      {canDrop && (
        <Tooltip title="Drop player">
          <IconButton
            size="small"
            aria-label={`Drop ${entry.name}`}
            onClick={() => onRequestDrop?.(entry)}
            sx={{ position: 'relative', zIndex: 1, color: 'var(--dash-danger)', flex: 'none' }}
          >
            <DropIcon />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}

function DropIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}
    >
      <path d="M5 5l10 10M15 5 5 15" />
    </svg>
  );
}
