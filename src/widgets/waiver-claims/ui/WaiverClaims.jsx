import React, { useEffect, useRef } from 'react';
import { Box } from '@mui/material';
import { PixelWarn, SR_ONLY_SX } from '../../../shared/ui/playselect';

const dollars = (n) => `$${n}`;

/**
 * What a resolved claim reads as: `head` is the outcome word the chip holds ("Won · $12", "Lost",
 * "Didn't go through"), `detail` the line beneath it (who won, at what bid, the server's reason).
 * Null-safe on the Winning bid. `showBid` is a FAAB league.
 */
export function resultView(result, showBid) {
  if (result.result === 'won') return { head: showBid ? `Won · ${dollars(result.bid)}` : 'Won', detail: null };
  if (result.result === 'lost') {
    const team = result.winningTeam;
    const bid = result.winningBid;
    const parts = [];
    if (team && bid != null) parts.push(`to ${team} · won at ${dollars(bid)}`);
    else if (team) parts.push(`to ${team}`);
    if (showBid) parts.push(`your bid ${dollars(result.bid)}`);
    return { head: 'Lost', detail: parts.length ? parts.join(' · ') : null };
  }
  return { head: "Didn't go through", detail: result.reason || null };
}

const headingSx = {
  m: 0, fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
};
const DIM = 'var(--ps-dim)';

// 16px glyphs on the 2px grid, the kit's: move arrows, edit and remove.
const ICONS = {
  up: 'M7 2h2v2H7zM5 4h6v2H5zM3 6h10v2H3zM7 8h2v6H7z',
  down: 'M7 2h2v6H7zM3 8h10v2H3zM5 10h6v2H5zM7 12h2v2H7z',
  edit: 'M11 1h2v2h2v2h-2v-2h-2zM9 3h2v2h2v2h-2V5H9zM7 5h2v2h2v2H9V7H7zM5 7h2v2h2v2H7V9H5zM3 9h2v2h2v2H4v1H2v-1zM1 13h2v2H1z',
  cancel: 'M3 3h2v2H3zM5 5h2v2H5zM7 7h2v2H7zM9 9h2v2H9zM11 11h2v2h-2zM11 3h2v2h-2zM9 5h2v2H9zM5 9h2v2H5zM3 11h2v2H3z',
};

function IconButton({
  kind, label, disabled, onClick, ...rest
}) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      {...rest}
      sx={{
        width: '44px',
        height: '44px',
        minWidth: '44px',
        minHeight: '44px',
        padding: 0,
        display: 'grid',
        placeItems: 'center',
        flex: 'none',
        boxSizing: 'border-box',
        borderRadius: 0,
        background: 'transparent',
        border: '2px solid var(--ps-ink)',
        color: 'var(--ps-ink)',
        '&[disabled]': { borderColor: 'var(--ps-rule)', color: DIM, cursor: 'not-allowed' },
        '&[disabled]:hover': { filter: 'none' },
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" shapeRendering="crispEdges">
        <path d={ICONS[kind]} fill="currentColor" />
      </svg>
    </Box>
  );
}

/** "#1 and #3", "#1, #2 and #3": the ranks of a shared-drop set, in Claim order. */
function rankList(ranks) {
  const labels = ranks.map((r) => `#${r}`);
  if (labels.length < 2) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** Neutral: it reports the clash and how claims resolve, never which one goes through. Drawn once per group. */
function SharedDropNote({ ranks, dropName }) {
  return (
    <Box
      role="note"
      sx={{
        display: 'flex', gap: '10px', alignItems: 'flex-start', border: '2px solid var(--ps-rule)', padding: '10px 12px', minWidth: 0, mt: '4px',
      }}
    >
      <PixelWarn color="var(--ps-ink)" />
      <Box sx={{
        display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0,
      }}
      >
        <Box component="span" sx={{
          fontSize: '14px', fontWeight: 600, overflowWrap: 'anywhere', textWrap: 'pretty',
        }}
        >
          {`Only one of these can go through: ${rankList(ranks)} ${ranks.length > 2 ? 'all' : 'both'} drop ${dropName || 'the same player'}.`}
        </Box>
        <Box component="span" sx={{ fontSize: '14px', color: DIM, textWrap: 'pretty' }}>
          Higher bid first, then Waiver priority, then your Claim order, each at its player&apos;s Clear time.
        </Box>
      </Box>
    </Box>
  );
}

function PendingClaim({
  claim, rank, isFirst, isLast, onMove, onEdit, onCancel, busy, showBid, note,
}) {
  return (
    <Box
      component="li"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '10px 0',
        listStyle: 'none',
        minWidth: 0,
        borderTop: isFirst ? 'none' : '2px solid var(--ps-rule)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
        <Box component="span" sx={{ fontSize: '16px', fontWeight: 700, minWidth: '28px' }}>{`#${rank}`}</Box>
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Box component="span" sx={{
            fontSize: '15px', fontWeight: 600, display: 'block', overflowWrap: 'anywhere',
          }}
          >
            {claim.playerName}
          </Box>
          <Box component="span" sx={{ fontSize: '14px', color: DIM, display: 'block' }}>
            {`Drop: ${claim.dropPlayerName || 'None'}${showBid ? ` · Bid ${dollars(claim.bid)}` : ''}`}
          </Box>
        </Box>
      </Box>
      <Box id={`waiver-claim-${claim.id}-controls`} sx={{
        display: 'flex', flexWrap: 'wrap', gap: '6px', ml: '38px',
      }}
      >
        <IconButton kind="up" label={`Move ${claim.playerName} up`} data-claim-move={`${claim.id}-up`} disabled={isFirst} onClick={() => onMove(claim.id, -1)} />
        <IconButton kind="down" label={`Move ${claim.playerName} down`} data-claim-move={`${claim.id}-down`} disabled={isLast} onClick={() => onMove(claim.id, 1)} />
        <IconButton kind="edit" label={`Edit claim on ${claim.playerName}`} onClick={() => onEdit(claim)} />
        <IconButton kind="cancel" label={`Cancel claim on ${claim.playerName}`} data-claim-cancel={rank} disabled={busy} onClick={() => onCancel(claim, rank - 1)} />
      </Box>
      {note}
    </Box>
  );
}

function Chip({ children }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        boxSizing: 'border-box',
        minHeight: '32px',
        padding: '4px 10px',
        border: '2px solid var(--ps-ink)',
        fontSize: '14px',
        fontWeight: 700,
        lineHeight: 1.25,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  );
}

/**
 * The body of the My claims frame: pending claims in Claim order, then Results by week. `claims` is
 * the `waiver-claim` read model; `onMove(claimId, -1 | +1)` is its `moveClaim`; `onEdit(claim)` and
 * `onCancel(claim, position)` are the page's `manage-claim` wiring (#1616). Claims that name the same
 * drop share one neutral note per group. The page draws the frame and its heading (Play-select, ADR
 * 0067 wave 3).
 */
export default function WaiverClaims({
  claims, onMove, onEdit, onCancel, busy = false, orderError, orderAnnouncement, orderSettled, showBid,
}) {
  const { pending, resultsByWeek, sharedDrops = [] } = claims;
  const rootRef = useRef(null);
  const focusRef = useRef(null);

  // #1579: after a move, focus returns to the moved claim's control (a keyed
  // swap or a button turning disabled would otherwise drop focus to <body>).
  const handleMove = (id, delta) => {
    focusRef.current = { id, dir: delta < 0 ? 'up' : 'down' };
    onMove(id, delta);
  };
  // The target is kept until the hook reports the PUT settled (`orderSettled`),
  // so both the optimistic render and a refusal's revert render restore focus.
  const settledRef = useRef(orderSettled);
  useEffect(() => {
    const target = focusRef.current;
    if (!target || !rootRef.current) return;
    const other = target.dir === 'up' ? 'down' : 'up';
    const el = rootRef.current.querySelector(`[data-claim-move="${target.id}-${target.dir}"]:not(:disabled)`)
      || rootRef.current.querySelector(`[data-claim-move="${target.id}-${other}"]:not(:disabled)`);
    if (el && document.activeElement !== el) el.focus();
    if (settledRef.current !== orderSettled) {
      settledRef.current = orderSettled;
      focusRef.current = null;
    }
  });

  // After a Cancel the row is gone: focus lands on the Cancel control now in
  // its place (or the last one), else on the card, never on <body>.
  const cancelledRef = useRef(null);
  const handleCancel = (claim, position) => {
    cancelledRef.current = { id: claim.id, position };
    return onCancel(claim, position);
  };
  useEffect(() => {
    const target = cancelledRef.current;
    if (!target || !rootRef.current || pending.some((c) => c.id === target.id)) return;
    cancelledRef.current = null;
    const rank = Math.min(target.position, pending.length - 1) + 1;
    const el = pending.length ? rootRef.current.querySelector(`[data-claim-cancel="${rank}"]`) : rootRef.current;
    el?.focus();
  }, [pending]);

  const rankById = new Map(pending.map((claim, index) => [claim.id, index + 1]));
  // The note for a shared-drop group sits under its last claim in Claim order.
  const noteAfter = new Map();
  sharedDrops.forEach((group) => {
    const ranks = group.claimIds.map((id) => rankById.get(id)).filter((r) => r != null).sort((a, b) => a - b);
    if (ranks.length < 2) return;
    const lastClaim = pending[ranks[ranks.length - 1] - 1];
    noteAfter.set(lastClaim.id, <SharedDropNote ranks={ranks} dropName={lastClaim.dropPlayerName} />);
  });
  const results = resultsByWeek.filter((group) => group.results.length > 0);

  if (pending.length === 0 && results.length === 0) {
    return (
      <Box
        ref={rootRef}
        component="p"
        tabIndex={-1}
        sx={{
          m: 0, padding: '16px 20px', fontSize: '15px', color: DIM, outline: 'none',
        }}
      >
        No claims yet
      </Box>
    );
  }

  return (
    <Box
      ref={rootRef}
      tabIndex={-1}
      sx={{
        padding: { xs: '14px', md: '16px 20px 20px' }, minWidth: 0, outline: 'none', display: 'flex', flexDirection: 'column', gap: '20px',
      }}
    >
      {orderError && (
        <Box sx={{ border: '2px solid var(--ps-danger)', padding: '10px 12px' }}>
          <Box role="alert" sx={{
            display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '14px',
          }}
          >
            <PixelWarn color="var(--ps-danger)" />
            <span>{orderError}</span>
          </Box>
        </Box>
      )}
      <Box role="status" aria-live="polite" sx={SR_ONLY_SX}>{orderAnnouncement}</Box>

      {pending.length > 0 && (
        <Box component="section" aria-label="Pending claims" sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <Box component="h3" sx={headingSx}>Pending</Box>
          <Box component="p" sx={{
            m: 0, fontSize: '14px', color: DIM, textWrap: 'pretty',
          }}
          >
            Claim order ranks your own claims. A higher bid still processes first.
          </Box>
          <Box component="ol" sx={{ m: 0, p: 0 }}>
            {pending.map((claim, index) => (
              <PendingClaim
                key={claim.id}
                claim={claim}
                rank={index + 1}
                onEdit={onEdit}
                onCancel={handleCancel}
                busy={busy}
                isFirst={index === 0}
                isLast={index === pending.length - 1}
                onMove={handleMove}
                showBid={showBid}
                note={noteAfter.get(claim.id)}
              />
            ))}
          </Box>
        </Box>
      )}

      {results.length > 0 && (
        <Box component="section" aria-label="Results" sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Box component="h3" sx={headingSx}>Results</Box>
          {results.map((group) => (
            <Box key={group.week ?? 'earlier'} sx={{ display: 'flex', flexDirection: 'column' }}>
              <Box component="h4" sx={{
                m: 0, mb: '2px', fontSize: '14px', fontWeight: 600, color: DIM,
              }}
              >
                {group.week != null ? `Week ${group.week}` : 'Earlier'}
              </Box>
              <Box component="ul" sx={{ m: 0, p: 0 }}>
                {group.results.map((r) => {
                  const { head, detail } = resultView(r, showBid);
                  return (
                    <Box
                      key={r.id}
                      component="li"
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: '6px',
                        padding: '10px 0',
                        borderTop: '2px solid var(--ps-rule)',
                        listStyle: 'none',
                        minWidth: 0,
                      }}
                    >
                      <Box component="span" sx={{ fontSize: '15px', fontWeight: 600, overflowWrap: 'anywhere' }}>{r.playerName}</Box>
                      <Box
                        component="span"
                        data-testid="claim-result-line"
                        sx={{
                          display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px', minWidth: 0,
                        }}
                      >
                        <Chip>{head}</Chip>
                        {detail && (
                          <>
                            {' '}
                            <Box component="span" sx={{
                              fontSize: '14px', color: DIM, overflowWrap: 'anywhere', textWrap: 'pretty',
                            }}
                            >
                              {detail}
                            </Box>
                          </>
                        )}
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
