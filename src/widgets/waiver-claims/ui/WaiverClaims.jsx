import React, { useEffect, useRef } from 'react';
import { Alert, Box, Chip, IconButton, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { MIN_TOUCH_TARGET_SX } from '../../../shared/lib/a11y';

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

function PendingClaim({ claim, rank, isFirst, isLast, onMove }) {
  return (
    <Box
      component="li"
      sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1, borderTop: '1px solid var(--dash-line)', listStyle: 'none' }}
    >
      <Typography component="span" sx={{ fontWeight: 700, minWidth: 32 }}>{`#${rank}`}</Typography>
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography component="span" sx={{ fontWeight: 600, display: 'block', overflowWrap: 'anywhere' }}>
          {claim.playerName}
        </Typography>
        <Typography component="span" sx={{ fontSize: 12, color: 'var(--dash-dim)', display: 'block' }}>
          {`Drop: ${claim.dropPlayerName || 'None'}`}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', flexShrink: 0 }}>
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
      </Box>
    </Box>
  );
}

/**
 * Pending claims in Claim order, then Results grouped by week. `claims` is the
 * `waiver-claim` read model; `onMove(claimId, -1 | +1)` is its `moveClaim`.
 */
export default function WaiverClaims({ claims, onMove, orderError, orderAnnouncement, showBid }) {
  const { pending, resultsByWeek } = claims;
  const rootRef = useRef(null);
  const focusRef = useRef(null);

  // #1579: after a move, focus returns to the moved claim's control (a keyed
  // swap or a button turning disabled would otherwise drop focus to <body>).
  const handleMove = (id, delta) => {
    focusRef.current = { id, dir: delta < 0 ? 'up' : 'down' };
    onMove(id, delta);
  };
  // The target is kept until the PUT settles (a success announcement or a
  // refusal), so the revert render after a refusal restores focus too.
  const settledRef = useRef({ orderError, orderAnnouncement });
  useEffect(() => {
    const target = focusRef.current;
    if (!target || !rootRef.current) return;
    const other = target.dir === 'up' ? 'down' : 'up';
    const el =
      rootRef.current.querySelector(`[data-claim-move="${target.id}-${target.dir}"]:not(:disabled)`) ||
      rootRef.current.querySelector(`[data-claim-move="${target.id}-${other}"]:not(:disabled)`);
    if (el && document.activeElement !== el) el.focus();
    const settled = settledRef.current;
    if (settled.orderError !== orderError || settled.orderAnnouncement !== orderAnnouncement) {
      settledRef.current = { orderError, orderAnnouncement };
      focusRef.current = null;
    }
  });

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
                    <Chip
                      size="small"
                      label={resultLine(r, showBid)}
                      color={r.result === 'won' ? 'success' : 'default'}
                      variant="outlined"
                      sx={{ mt: 0.5, maxWidth: '100%' }}
                    />
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
