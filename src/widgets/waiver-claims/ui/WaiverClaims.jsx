import React, { useEffect, useRef } from 'react';
import { Alert, Box, IconButton, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import EditIcon from '@mui/icons-material/Edit';
import CloseIcon from '@mui/icons-material/Close';
import { MIN_TOUCH_TARGET_SX } from '../../../shared/lib';

const dollars = (n) => `$${n}`;

/** The one line a resolved claim reads as. Null-safe on the Winning bid. */
export function resultLine(result, showBid) {
  if (result.result === 'won') return showBid ? `Won · ${dollars(result.bid)}` : 'Won';
  if (result.result === 'lost') {
    const team = result.winningTeam;
    const bid = result.winningBid;
    let line = 'Lost';
    if (team && bid != null) line = `Lost to ${team} · won at ${dollars(bid)}`;
    else if (team) line = `Lost to ${team}`;
    return showBid ? `${line} · your bid ${dollars(result.bid)}` : line;
  }
  return "Didn't go through";
}

const headingSx = { fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' };

/** "#1 and #3", "#1, #2 and #3": the ranks of a shared-drop set, in Claim order. */
function rankList(ranks) {
  const labels = ranks.map((r) => `#${r}`);
  if (labels.length < 2) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** Neutral: it reports the clash and how claims resolve, never which one goes through. */
function SharedDropWarning({ claim, rankById }) {
  const ranks = [claim.id, ...claim.sharesDropWith]
    .map((id) => rankById.get(id))
    .filter((r) => r != null)
    .sort((a, b) => a - b);
  return (
    <Box
      role="note"
      sx={{ mt: 0.5, p: 1, border: '1px solid var(--dash-line)', borderRadius: 1, fontSize: 12, minWidth: 0 }}
    >
      <Typography component="span" sx={{ display: 'block', fontSize: 12, fontWeight: 600, overflowWrap: 'anywhere' }}>
        {`Only one of these can go through: ${rankList(ranks)} both drop ${claim.dropPlayerName || 'the same player'}`}
      </Typography>
      <Typography component="span" sx={{ display: 'block', fontSize: 12, color: 'var(--dash-dim)' }}>
        Higher bid first, then Waiver priority, then your Claim order, each at its player&apos;s Clear time.
      </Typography>
    </Box>
  );
}

function PendingClaim({ claim, rank, rankById, isFirst, isLast, onMove, onEdit, onCancel }) {
  return (
    <Box
      component="li"
      sx={{ display: 'flex', flexDirection: 'column', py: 1, borderTop: '1px solid var(--dash-line)', listStyle: 'none', minWidth: 0 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Typography component="span" sx={{ fontWeight: 700, minWidth: 32 }}>{`#${rank}`}</Typography>
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography component="span" sx={{ fontWeight: 600, display: 'block', overflowWrap: 'anywhere' }}>
          {claim.playerName}
        </Typography>
        <Typography component="span" sx={{ fontSize: 12, color: 'var(--dash-dim)', display: 'block' }}>
          {`Drop: ${claim.dropPlayerName || 'None'}`}
        </Typography>
      </Box>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', ml: 5 }}>
        <IconButton
          aria-label={`Move ${claim.playerName} up`}
          data-claim-move={`${claim.id}-up`}
          disabled={isFirst}
          onClick={() => onMove(claim.id, -1)}
          sx={MIN_TOUCH_TARGET_SX}
        >
          <KeyboardArrowUpIcon />
        </IconButton>
        <IconButton
          aria-label={`Move ${claim.playerName} down`}
          data-claim-move={`${claim.id}-down`}
          disabled={isLast}
          onClick={() => onMove(claim.id, 1)}
          sx={MIN_TOUCH_TARGET_SX}
        >
          <KeyboardArrowDownIcon />
        </IconButton>
        <IconButton aria-label={`Edit claim on ${claim.playerName}`} onClick={() => onEdit(claim)} sx={MIN_TOUCH_TARGET_SX}>
          <EditIcon />
        </IconButton>
        <IconButton
          aria-label={`Cancel claim on ${claim.playerName}`}
          onClick={() => onCancel(claim, rank - 1)}
          sx={MIN_TOUCH_TARGET_SX}
        >
          <CloseIcon />
        </IconButton>
      </Box>
      {claim.sharesDropWith.length > 0 && (
        <Box sx={{ ml: 5 }}>
          <SharedDropWarning claim={claim} rankById={rankById} />
        </Box>
      )}
    </Box>
  );
}

/**
 * Pending claims in Claim order, then Results grouped by week. `claims` is the
 * `waiver-claim` read model; `onMove(claimId, -1 | +1)` is its `moveClaim`;
 * `onEdit(claim)` and `onCancel(claim, position)` are the page's `manage-claim`
 * wiring (#1616). Claims that name the same drop each carry a neutral warning.
 */
export default function WaiverClaims({ claims, onMove, onEdit, onCancel, orderError, orderAnnouncement, orderSettled, showBid }) {
  const { pending, resultsByWeek } = claims;
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
    const el =
      rootRef.current.querySelector(`[data-claim-move="${target.id}-${target.dir}"]:not(:disabled)`) ||
      rootRef.current.querySelector(`[data-claim-move="${target.id}-${other}"]:not(:disabled)`);
    if (el && document.activeElement !== el) el.focus();
    if (settledRef.current !== orderSettled) {
      settledRef.current = orderSettled;
      focusRef.current = null;
    }
  });

  const rankById = new Map(pending.map((claim, index) => [claim.id, index + 1]));
  const results = resultsByWeek.filter((group) => group.results.length > 0);

  if (pending.length === 0 && results.length === 0) {
    return <Typography sx={{ p: 2, fontSize: 14, color: 'var(--dash-dim)' }}>No claims yet</Typography>;
  }

  return (
    <Box ref={rootRef} sx={{ p: 2, minWidth: 0 }}>
      {orderError && (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {orderError}
        </Alert>
      )}
      <Typography role="status" aria-live="polite" sx={visuallyHidden}>
        {orderAnnouncement}
      </Typography>

      {pending.length > 0 && (
        <Box component="section" aria-label="Pending claims">
          <Typography component="h3" sx={headingSx}>
            Pending
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'var(--dash-dim)', mb: 0.5 }}>
            Claim order ranks your own claims. A higher bid still processes first.
          </Typography>
          <Box component="ol" sx={{ m: 0, p: 0 }}>
            {pending.map((claim, index) => (
              <PendingClaim
                key={claim.id}
                claim={claim}
                rank={index + 1}
                rankById={rankById}
                onEdit={onEdit}
                onCancel={onCancel}
                isFirst={index === 0}
                isLast={index === pending.length - 1}
                onMove={handleMove}
              />
            ))}
          </Box>
        </Box>
      )}

      {results.length > 0 && (
        <Box component="section" aria-label="Results" sx={{ mt: pending.length > 0 ? 2.5 : 0 }}>
          <Typography component="h3" sx={headingSx}>
            Results
          </Typography>
          {results.map((group) => (
            <Box key={group.week ?? 'earlier'} sx={{ mt: 1 }}>
              <Typography component="h4" sx={{ fontSize: 12, fontWeight: 600, color: 'var(--dash-dim)' }}>
                {group.week != null ? `Week ${group.week}` : 'Earlier'}
              </Typography>
              <Box component="ul" sx={{ m: 0, p: 0 }}>
                {group.results.map((r) => (
                  <Box
                    key={r.id}
                    component="li"
                    sx={{ py: 1, borderTop: '1px solid var(--dash-line)', listStyle: 'none', minWidth: 0 }}
                  >
                    <Typography component="span" sx={{ fontWeight: 600, display: 'block', overflowWrap: 'anywhere' }}>
                      {r.playerName}
                    </Typography>
                    <Typography
                      component="span"
                      data-testid="claim-result-line"
                      sx={{
                        display: 'block',
                        mt: 0.5,
                        fontSize: 13,
                        fontWeight: 600,
                        overflowWrap: 'anywhere',
                        color: r.result === 'won' ? 'success.main' : 'var(--dash-ink)',
                      }}
                    >
                      {resultLine(r, showBid)}
                    </Typography>
                    {r.result === 'didnt-go-through' && r.reason && (
                      <Typography sx={{ fontSize: 12, color: 'var(--dash-dim)', mt: 0.5 }}>{r.reason}</Typography>
                    )}
                  </Box>
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
