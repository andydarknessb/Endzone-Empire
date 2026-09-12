import React from 'react';
import { Avatar, Box, IconButton, Tooltip, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { GameStateChip, InjuryTag, PosChip } from '../../../shared/ui';
import { formatPoints, initialsFor, unavailableLabel } from '../../../shared/lib';
import { NFL_TEAM_COLORS, FALLBACK_KIT } from '../../../lib/nflTeamColors';
import PlayerNameLink from '../../../components/PlayerQuickView/PlayerNameLink';
import EdgeLineIcon from '../lib/EdgeLineIcon';
import { edgeLineColor } from '../lib/edgeLine';
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

// The Game cell (see ../lib/gameCell.js), rendered as one GameStateChip.
function GameCell({ entry, liveRow }) {
  const view = gameCellView(entry, liveRow);
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
    return <GameStateChip state="live" data-testid="ledger-game-cell">{`${score}${view.trailing}`}</GameStateChip>;
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
function EdgeLine({ edge }) {
  if (!edge || edge.kind === 'none' || !edge.text) return null;
  return (
    <Box
      data-testid="ledger-edge-line"
      data-edge-kind={edge.kind}
      sx={{ display: 'flex', alignItems: 'center', gap: '5px', mt: '2px', color: edgeLineColor(edge.kind) }}
    >
      <EdgeLineIcon kind={edge.kind} />
      <Typography component="span" sx={{ fontSize: '11.5px', fontWeight: 600, lineHeight: 1.3 }}>
        {edge.text}
      </Typography>
    </Box>
  );
}

// The player's avatar: initials on the NFL team's jersey colour (CONTEXT.md's
// Ledger row, "avatar with the NFL team colour"). No photo plumbing on this
// endpoint yet, matching the entity's own scope. The label ink is the design
// system's `text-inverse` token (src/theme/tokens.js) - the same token
// PosChip already paints its own label on a solid fill with - not a literal:
// `src/lib/nflTeamColors.js` is the one file the color-literals guard
// allowlists for real NFL hex values (external data), and this file is not
// it, so the background alone stays a raw hex value from that lookup while
// the text on top of it goes through a token.
function PlayerAvatar({ name, nflTeam }) {
  const kit = NFL_TEAM_COLORS[nflTeam] || FALLBACK_KIT;
  return (
    <Avatar
      aria-hidden="true"
      sx={{ width: 36, height: 36, fontSize: 13, bgcolor: kit.jersey, color: 'var(--text-inverse)' }}
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
  // separate branch.
  const pointsText = isEmpty ? null : unavailable ? '-' : formatPoints(entry.points);

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
              <EdgeLine edge={entry.edge} />
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <GameCell entry={entry} liveRow={liveRow} />

              <Box sx={{ display: 'grid', textAlign: 'right' }}>
                <Typography
                  component="span"
                  data-testid="ledger-projection"
                  sx={{ fontSize: '11px', color: unavailable ? 'var(--dash-faint)' : 'var(--dash-ink)', fontWeight: 600 }}
                >
                  {projectionText}
                </Typography>
                <Typography component="span" data-testid="ledger-points" sx={{ fontSize: '10.5px', color: 'var(--dash-faint)' }}>
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
