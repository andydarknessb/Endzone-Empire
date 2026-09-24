import React from 'react';
import { Card, Box, Typography, Chip, IconButton, Tooltip } from '@mui/material';
import CancelIcon from '@mui/icons-material/Cancel';
import EditIcon from '@mui/icons-material/Edit';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';

function statusColor(status) {
  if (status === 'won') return 'success';
  if (status === 'lost' || status === 'invalid') return 'error';
  return 'default'; // pending, cancelled
}

// A single pending/resolved waiver claim, split into its Add/Drop halves.
// Card defaults to theme.palette.background.paper, matching the rest of the app.
// A pending claim leads with its Claim order rank (`rank`, 1 first) and carries
// up/down buttons (`onMove(claim, -1 | +1)`); `isFirst`/`isLast` disable the ends.
function WaiverClaimItem({ claim, isFaab, onCancel, rank, isFirst, isLast, onMove }) {
  const isPending = claim.status === 'pending';
  const showOrder = isPending && rank != null;

  return (
    <Card variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap' }}>
        {showOrder && (
          <Typography variant="h6" component="span" sx={{ fontWeight: 700, minWidth: 40 }}>
            {`#${rank}`}
          </Typography>
        )}
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography variant="body2" sx={{ color: 'success.main', fontWeight: 600 }}>
            Add: <Box component="span">{claim.player_name}</Box>
          </Typography>
          <Typography
            variant="body2"
            sx={{
              color: claim.drop_player_name ? 'error.main' : 'text.secondary',
              fontWeight: claim.drop_player_name ? 600 : 400,
            }}
          >
            Drop: <Box component="span">{claim.drop_player_name || 'None'}</Box>
          </Typography>
          {claim.note && (
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
              {claim.note}
            </Typography>
          )}
          <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
            <Chip label={claim.status} size="small" color={statusColor(claim.status)} />
            {isFaab && <Chip label={`Bid: $${claim.bid}`} size="small" variant="outlined" />}
          </Box>
        </Box>

        <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
          {showOrder && (
            <>
              <IconButton
                aria-label="Move claim up"
                disabled={isFirst}
                onClick={() => onMove(claim, -1)}
                sx={{ width: 44, height: 44 }}
              >
                <KeyboardArrowUpIcon />
              </IconButton>
              <IconButton
                aria-label="Move claim down"
                disabled={isLast}
                onClick={() => onMove(claim, 1)}
                sx={{ width: 44, height: 44 }}
              >
                <KeyboardArrowDownIcon />
              </IconButton>
            </>
          )}
          {isFaab && isPending && (
            // Reserved for a future edit-bid flow; no backend support yet.
            <Tooltip title="Edit bid (coming soon)">
              <span>
                <IconButton size="small" aria-label="Edit Bid" disabled>
                  <EditIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
          {isPending && (
            <Tooltip title="Cancel claim">
              <IconButton size="small" aria-label="Cancel" onClick={() => onCancel(claim)}>
                <CancelIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>
    </Card>
  );
}

export default WaiverClaimItem;
