import { headshotSrc } from '../../../shared/lib/headshot';
import React, { useState } from 'react';
import { Box, useMediaQuery, useTheme } from '@mui/material';
import {
  formatPoints,
  hasNoHistory,
  initialsFor,
  projectionLabel,
  BACKUP_LABEL,
  startVerdictReason,
} from '../../../shared/lib';
import { PlayerNameLink } from '../../../entities/player';
import { locked, spent, unavailable as isUnavailable, unavailableLabel } from '../../../entities/roster';
import { SR_ONLY_SX } from '../../../shared/ui/playselect';
import { InjuryTag, Tag } from '../../../shared/ui/playselect';
import { Glyph, SrOnly } from '../../../shared/ui/playselect/LineupParts';
import EdgeLineIcon from '../lib/EdgeLineIcon';
import { edgeLineColor, displayEdgeKind } from '../lib/edgeLine';
import { gameCellView } from '../lib/gameCell';

// The viewport width below which the row stacks its Game cell under the name.
const STACKED_BELOW = 1100;

const LOCKED_TEXT = "Locked: this player's game has kicked off";

// A closed padlock: "locked rows show a lock, not a chip" (AC3): a small pictogram beside the name.
function LockMark() {
  return (
    <Box
      component="span"
      role="img"
      aria-label={LOCKED_TEXT}
      data-testid="ledger-lock-icon"
      sx={{ display: 'inline-flex', alignItems: 'center', flex: 'none' }}
    >
      <Glyph kind="lock" />
    </Box>
  );
}

// The Situation line (CONTEXT.md's Situation; ADR 0037 ticket 9, #1241 AC1; last play added #1292):
// possession, down/distance and the last play under the live state, in that order, with an RZ mark when the
// red zone flag is set. A null field is omitted; the line renders nothing when there is nothing to say.
function SituationLine({ possession, downDistance, lastPlay, redZone }) {
  const parts = [];
  if (possession) parts.push(`${possession} ball`);
  if (downDistance) parts.push(downDistance);
  if (lastPlay) parts.push(lastPlay);
  if (parts.length === 0 && !redZone) return null;
  return (
    <Box data-testid="ledger-situation-line" sx={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
      {parts.length > 0 && <span>{parts.join(' · ')}</span>}
      {redZone && (
        <Box component="span" data-testid="ledger-red-zone-marker" sx={{ fontWeight: 700, letterSpacing: '.04em' }}>
          RZ
        </Box>
      )}
    </Box>
  );
}

const upperFirst = (text) => (text ? `${text[0].toUpperCase()}${text.slice(1)}` : text);

// The Game cell (see ../lib/gameCell.js) as two lines: the state, then (pre-kickoff) the line and weather
// or (live) the situation. `view` is computed once by the caller so the same read also drives the Edge
// line's kind transition (AC2/AC3).
function GameCell({ view, dim }) {
  if (!view) return null;
  const stateSx = { fontSize: '14px', fontWeight: 600, whiteSpace: 'nowrap', minWidth: 0 };
  const lineSx = { fontSize: '13px', color: dim, minWidth: 0 };
  if (view.kind === 'unavailable') {
    return (
      <Box
        data-testid="ledger-game-cell"
        data-game-state={view.reason === 'bye' ? 'bye' : 'unavailable'}
        sx={{
          display: 'flex', width: 'fit-content', maxWidth: '100%', alignItems: 'center', boxSizing: 'border-box', minHeight: '28px', padding: '0 8px', border: '2px solid var(--ps-rule)', ...stateSx, whiteSpace: 'normal',
        }}
      >
        {upperFirst(view.reasonLabel || 'unavailable')}
      </Box>
    );
  }
  if (view.kind === 'pre') {
    const label = view.opponent ? `vs ${view.opponent}${view.kickoff ? ` · ${view.kickoff}` : ''}` : (view.kickoff || 'Bye');
    // The Line and weather second line (#1329, ADR 0037): text only.
    const detail = [view.lineText, view.weatherText].filter(Boolean).join(' · ');
    return (
      <Box sx={{ minWidth: 0 }}>
        <Box data-testid="ledger-game-cell" data-game-state="pre" sx={stateSx}>{label}</Box>
        {detail && <Box data-testid="ledger-game-detail" sx={lineSx}>{detail}</Box>}
      </Box>
    );
  }
  if (view.kind === 'live') {
    const score = view.teamScore != null && view.opponentScore != null ? `${view.teamScore}-${view.opponentScore} · ` : '';
    return (
      <Box sx={{ minWidth: 0 }}>
        <Box data-testid="ledger-game-cell" data-game-state="live" sx={{ ...stateSx, display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <Box component="span" aria-hidden="true" sx={{ width: '8px', height: '8px', flex: 'none', backgroundColor: 'var(--ps-accent)' }} />
          <SrOnly>Live, </SrOnly>
          {`${score}${view.trailing}`}
        </Box>
        <Box sx={lineSx}>
          <SituationLine possession={view.possession} downDistance={view.downDistance} lastPlay={view.lastPlay} redZone={view.redZone} />
        </Box>
      </Box>
    );
  }
  // "Final" always carries the word, so a final state is never told by absence alone.
  const score = view.teamScore != null && view.opponentScore != null ? `Final ${view.teamScore}-${view.opponentScore}` : 'Final';
  return <Box data-testid="ledger-game-cell" data-game-state="final" sx={stateSx}>{score}</Box>;
}

// The Edge line (CONTEXT.md's Edge line): one pictogram and one line of text, in Ink or Dim. Renders
// nothing for `none` or a missing edge, per `computeEdgeLine`'s own contract.
//
// `gameCellKind` (#1241 AC3, ADR 0037 ticket 9) is the same `view.kind` computed once for the Game cell:
// `displayEdgeKind` transitions the server's `pace`/`result` kind instantly with the live game's state.
function EdgeLine({ edge, gameCellKind, noHistory }) {
  if (!edge || edge.kind === 'none' || !edge.text) return null;
  // No "Outprojects" comparison with a Position-baseline projection (#1776).
  if (noHistory && edge.kind === 'bench-above-starter') return null;
  const kind = displayEdgeKind(edge.kind, gameCellKind);
  return (
    <Box
      data-testid="ledger-edge-line"
      data-edge-kind={kind}
      sx={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: '13px', fontWeight: 600, color: edgeLineColor(kind) }}
    >
      <EdgeLineIcon kind={kind} />
      <Box component="span" sx={{ textWrap: 'pretty', lineHeight: 1.3 }}>{edge.text}</Box>
    </Box>
  );
}

// The player's avatar on every occupied row: the headshot (`photoUrl`) when there is one and it loads, else
// his initials in a neutral square (Play-select: not the jersey colour). 36px, 28px on a phone.
function PlayerAvatar({ name, photoUrl, size, color }) {
  const [broken, setBroken] = useState(false);
  return (
    <Box
      component="span"
      aria-hidden="true"
      data-testid="ledger-avatar"
      sx={{
        display: 'inline-grid',
        placeItems: 'center',
        flex: 'none',
        width: `${size}px`,
        height: `${size}px`,
        boxSizing: 'border-box',
        border: `2px solid ${color}`,
        overflow: 'hidden',
        fontSize: '13px',
        fontWeight: 700,
        lineHeight: 1,
        color,
      }}
    >
      {photoUrl && !broken ? (
        <Box
          component="img"
          src={headshotSrc(photoUrl, size)}
          alt=""
          loading="lazy"
          data-testid="ledger-headshot"
          onError={() => setBroken(true)}
          sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : initialsFor(name)}
    </Box>
  );
}

/**
 * One Ledger row (CONTEXT.md's Ledger row; ADR 0037; #1237; Play-select, ADR 0067 wave 3): slot, avatar,
 * name with injury code and lock, position and Team code, the Game cell, the Edge line, points and
 * projection. An empty slot renders a plain "Empty" placeholder; the row-level swap/quick-pick interaction
 * and the drop control are both driven by props supplied by the page (the swap-players and drop-player
 * features), so this widget stays a presenter.
 *
 * `cursor` puts the page's one cursor frame on this row (`'urgent'` turns it Danger, under one hour from
 * the lock); `note` is the lineup note the cursor row carries. `last` drops the rule under the row.
 *
 * Structure (formal review findings ac1-widgets-reach-below-the-island's sibling fixes and
 * legacy-controls-dropped-without-a-criterion): the row's own swap-select action is an invisible `<button>`
 * absolutely covering the row, UNDER the visible content, which is `pointer-events: none` except two
 * reclaimed islands, the player's name (a real `PlayerNameLink`, opening the Decision card the page owns,
 * #1240) and the Drop control, each independently focusable and clickable without being a DOM descendant of
 * the covering button. That is what keeps nested-interactive controls out of a widget role, and is why
 * neither control's own keydown can ever bubble into the row's handler.
 *
 * `data-testid` (the caller's `testId`) names the OUTER wrapper, not the covering button:
 * `tests/e2e/auth-offline.spec.ts` asserts `getByTestId('slot-row-...')` CONTAINS the row's own text (the
 * player's name), and the covering button carries no text of its own by design. The covering button gets
 * its own derived id (`${testId}-select`) for anything that specifically needs the interactive element.
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
  reserveDropTrack,
  onOpenDecisionCard = () => {},
  cursor = false,
  note = null,
  last = false,
  'data-testid': testId,
}) {
  const isEmpty = !entry;
  // The Drop track is reserved on every occupied row once any row in the Ledger can drop
  // (`reserveDropTrack`), so a row without the control (a spent one) keeps its numbers on the same edge.
  const dropTrack = !isEmpty && (canDrop || reserveDropTrack);
  const unavailable = !isEmpty && isUnavailable(entry);
  const view = isEmpty ? null : gameCellView(entry, liveRow);
  // A row that shows eligibility and is no legal target is the dimmed one while a move is under way; a legal
  // target, and both rows of a Bench what-if, take the Play-blue fill.
  const eligibleRow = Boolean(swapHighlighted || (showEligibility && eligible));
  const dimRow = Boolean(showEligibility && !eligible && !selected);
  const dm = eligibleRow ? 'var(--ps-play-dim)' : 'var(--ps-dim)';
  const nameInk = dimRow ? 'var(--ps-dim)' : 'inherit';

  // The headline number is `entry.projectedPoints`, CONTEXT.md's Point estimate under The projection engine,
  // never `entry.projection` (#1482). A real number reads "proj 14.2" under the points figure; a label
  // ("no history", an Unavailable reason) or the dash for a missing projection stands alone.
  const projectionText = isEmpty ? null : unavailable ? unavailableLabel(entry) : projectionLabel(entry);
  const projectionShown = !isEmpty && !unavailable && !hasNoHistory(entry) && Number.isFinite(entry.projectedPoints);
  // The points cell: the entry's actual/live points once his game is live or final; a dash for an
  // Unavailable row and for a pre-kickoff row alike (`formatPoints` renders the dash for a null).
  const pointsText = isEmpty ? null : unavailable ? '-' : formatPoints(entry.points);
  const finalPoints = !isEmpty && !unavailable && view?.kind === 'final' && pointsText !== '-';

  // The row's own accessible name (an explicit aria-label wins over the button's content): one concise
  // phrase per row. The injury designation and the projection close it; an Unavailable row names its
  // reason instead; a dimmed row says why it cannot be pressed.
  const unavailableText = unavailable ? unavailableLabel(entry) : null;
  const designation = isEmpty || unavailable ? null : injuryWord(entry.injuryStatus);
  const dropInert = Boolean(showEligibility && !eligible);
  const rowLabel = isEmpty
    ? `Empty ${slotLabel} slot`
    : [
        entry.name,
        slotLabel,
        locked(entry) && 'locked',
        unavailableText,
        designation,
        projectionShown && `projected ${projectionText}`,
      ].filter(Boolean).join(', ');

  // Below `STACKED_BELOW`px the Game cell sits on its own line under the name (L2); from there up it takes its own
  // grid column before the numbers. The six-column row needs about 1050px of viewport to leave the info
  // column its 128px (the Ledger column is two thirds of the page from `md`), so a tablet reads the stacked
  // row too. One DOM copy either way, so `ledger-game-cell` stays unique per row.
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down(STACKED_BELOW), { noSsr: true });

  const label = (
    <Box
      component="span"
      data-testid="ledger-slot-chip"
      sx={{
        flex: 'none', width: phone ? '46px' : '52px', fontSize: '13px', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: nameInk,
      }}
    >
      {slotLabel}
    </Box>
  );

  let body;
  if (isEmpty) {
    body = (
      <Box sx={{
        position: 'relative', pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: phone ? '8px' : '12px', minHeight: '52px',
      }}
      >
        {label}
        <Box component="span" sx={{ fontSize: '15px', color: dm }}>Empty</Box>
      </Box>
    );
  } else {
    const nameLink = (
      <PlayerNameLink
        name={entry.name}
        playerId={entry.playerId}
        onOpen={onOpenDecisionCard}
        sx={{
          pointerEvents: 'auto',
          // A 44px target that does not grow the row: negative margins give back what the hit area adds.
          minHeight: '44px',
          minWidth: 0,
          m: '-13px 0',
          p: 0,
          boxSizing: 'border-box',
          color: nameInk,
          fontSize: '15px',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          // The name gives way first (an ellipsis) and the tags beside it never do.
          display: 'block',
          flex: '0 1 auto',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          lineHeight: '44px',
          '&:hover': { textDecoration: 'underline' },
          '&:focus-visible, &.MuiLink-focusVisible': {
            outline: '3px solid var(--ps-focus)', outlineOffset: 0, boxShadow: '0 0 0 7px var(--ps-halo)', borderRadius: 0,
          },
        }}
      />
    );
    const tags = (
      <>
        <InjuryTag codes status={entry.injuryStatus} data-testid="injury-tag" />
        {startVerdictReason(entry) === 'backup' && <Tag data-testid="ledger-backup">{BACKUP_LABEL}</Tag>}
        {entry.slot === 'IR' && entry.irAttested && (
          <Tag data-testid="ledger-attested-chip" title="Attested by the commissioner: this stash stays valid even though the injury feed disagrees.">
            Attested
          </Tag>
        )}
        {spent(entry) && <Tag data-testid="ledger-spent-chip">Spent</Tag>}
      </>
    );
    const lock = locked(entry) ? <LockMark /> : null;
    const who = (
      <Box data-testid="ledger-info" sx={{ minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: phone ? 'nowrap' : 'wrap', gap: '4px 8px', minWidth: 0 }}>
          {nameLink}
          {!phone && tags}
          {lock}
        </Box>
        <Box sx={{
          fontSize: '13px', color: dm, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 6px', mt: phone ? 0 : '1px',
        }}
        >
          {phone && tags}
          {/* #1392: a player with no NFL team reads "FA" in place of the Team code. */}
          <span>{`${entry.position ?? ''} · ${entry.nflTeam || 'FA'}`}</span>
        </Box>
      </Box>
    );
    const figures = (
      <Box sx={{ textAlign: 'right', flex: 'none', minWidth: 0 }}>
        <Box
          data-testid="ledger-points"
          sx={{
            fontSize: '16px', fontWeight: 700, color: nameInk, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
          }}
        >
          {pointsText === '-' ? (
            <>
              <span aria-hidden="true">-</span>
              <Box component="span" sx={SR_ONLY_SX}>Points not available yet</Box>
            </>
          ) : pointsText}
          {finalPoints && <Box component="span" sx={{ fontSize: '13px', fontWeight: 400, color: dm }}>{' pts · final'}</Box>}
        </Box>
        <Box data-testid="ledger-projection" sx={{ fontSize: '13px', color: dm, whiteSpace: 'nowrap', lineHeight: 1.3 }}>
          {projectionShown ? `proj ${projectionText}` : projectionText}
        </Box>
      </Box>
    );
    // Drop is a SIBLING of the row's covering button, not a descendant of any widget-role element: nesting a
    // real <button> inside a role like the row's own is an axe-core `nested-interactive` violation and let
    // this control's Enter/Space keydown bubble into the row's handler, silently starting a swap instead of
    // dropping the player. It is the grid's last column, 44px at every width, locked rows included.
    const drop = canDrop ? (
      <Box
        component="button"
        type="button"
        title={dropInert ? undefined : 'Drop player'}
        disabled={dropInert}
        aria-label={`Drop ${entry.name}`}
        onClick={() => onRequestDrop?.(entry)}
        sx={{
          pointerEvents: 'auto',
          width: '44px',
          height: '44px',
          minWidth: '44px',
          minHeight: '44px',
          p: 0,
          display: 'grid',
          placeItems: 'center',
          boxSizing: 'border-box',
          borderRadius: 0,
          background: 'transparent',
          border: '2px solid transparent',
          color: dm,
          cursor: 'pointer',
          '&:disabled': { cursor: 'not-allowed' },
          '&:hover:not(:disabled), &:focus-visible': { color: 'var(--ps-ink)' },
        }}
      >
        <Glyph kind="trash" />
      </Box>
    ) : (dropTrack ? <Box aria-hidden="true" data-testid="ledger-drop-spacer" /> : null);
    const edge = <EdgeLine edge={entry.edge} gameCellKind={view?.kind} noHistory={hasNoHistory(entry)} />;
    const hasEdge = Boolean(entry.edge && entry.edge.kind !== 'none' && entry.edge.text && !(hasNoHistory(entry) && entry.edge.kind === 'bench-above-starter'));

    body = phone ? (
      <Box sx={{
        position: 'relative', pointerEvents: 'none', display: 'grid', gridTemplateColumns: `46px 28px minmax(0, 1fr) auto${dropTrack ? ' 44px' : ''}`, alignItems: 'center', columnGap: '4px', minHeight: '52px',
      }}
      >
        {label}
        <PlayerAvatar name={entry.name} photoUrl={entry.photoUrl} size={28} color={eligibleRow ? 'currentColor' : 'var(--ps-dim)'} />
        <Box sx={{ minWidth: 0, pl: '4px' }}>{who}</Box>
        {figures}
        {drop}
        <Box sx={{
          gridColumn: '2 / -1', display: 'flex', flexDirection: 'column', gap: '1px', pb: '8px', fontSize: '13px', color: dm,
        }}
        >
          <GameCell view={view} dim={dm} />
          {hasEdge && <Box sx={{ mt: '3px' }}>{edge}</Box>}
        </Box>
      </Box>
    ) : (
      <Box sx={{
        position: 'relative',
        pointerEvents: 'none',
        display: 'grid',
        gridTemplateColumns: `52px 36px minmax(0, 1fr) minmax(0, 1.15fr) 96px${dropTrack ? ' 44px' : ''}`,
        alignItems: 'center',
        columnGap: '12px',
        minHeight: '52px',
        py: '2px',
      }}
      >
        {label}
        <PlayerAvatar name={entry.name} photoUrl={entry.photoUrl} size={36} color={eligibleRow ? 'currentColor' : 'var(--ps-dim)'} />
        {who}
        <Box sx={{ minWidth: 0 }}><GameCell view={view} dim={dm} /></Box>
        {figures}
        {drop}
        {hasEdge && <Box sx={{ gridColumn: '3 / 5', mt: '-2px', pb: '6px' }}>{edge}</Box>}
      </Box>
    );
  }

  return (
    <Box
      component="li"
      data-testid={testId}
      data-spent={spent(entry) ? 'true' : undefined}
      sx={{ listStyle: 'none', borderBottom: last ? 0 : `2px ${dimRow ? 'dashed' : 'solid'} var(--ps-rule)` }}
    >
      <Box
        className={`${cursor ? 'cursor ' : ''}slot`}
        data-row-mode={eligibleRow ? 'eligible' : dimRow ? 'dim' : undefined}
        data-urgent={cursor === 'urgent' ? 'true' : undefined}
        sx={{
          position: 'relative',
          '--cur': cursor === 'urgent' ? 'var(--ps-danger)' : 'var(--ps-cursor)',
          border: `4px solid ${cursor ? 'var(--cur)' : 'transparent'}`,
          boxSizing: 'border-box',
          ...(eligibleRow ? { backgroundColor: 'var(--ps-play)', color: 'var(--ps-play-ink)' } : null),
        }}
      >
        <Box sx={{ position: 'relative', px: { xs: '4px', sm: '8px' } }}>
          <Box
            component="button"
            type="button"
            disabled={disabled}
            aria-pressed={Boolean(selected)}
            aria-label={`${rowLabel}${dimRow ? ', not eligible' : ''}`}
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
              border: 0,
              borderRadius: 0,
              backgroundColor: 'transparent',
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          />
          {/* A fixed grid, never a wrapping flex (L2): slot, avatar, info (`minmax(0, 1fr)`), the Game column
              (from `sm`), the numbers column, then Drop, so every row's numbers share one right edge
              whatever the name length. */}
          {body}
        </Box>
        {note && <Box sx={{ px: { xs: '4px', sm: '8px' }, pb: '8px' }}>{note}</Box>}
      </Box>
    </Box>
  );
}

const INJURY_WORDS = {
  Q: 'questionable', D: 'doubtful', O: 'out', IR: 'injured reserve',
};
function injuryWord(status) {
  const code = String(status || '').trim().toUpperCase();
  return code ? (INJURY_WORDS[code] || code.toLowerCase()) : null;
}
