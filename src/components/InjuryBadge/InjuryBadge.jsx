import React from 'react';
import { Chip, Tooltip } from '@mui/material';

const STATUS_STYLES = {
  Q: { color: 'warning', label: 'Q', title: 'Questionable' },
  D: { color: 'warning', label: 'D', title: 'Doubtful' },
  O: { color: 'error', label: 'O', title: 'Out' },
  IR: { color: 'error', label: 'IR', title: 'Injured Reserve' },
};

/** Small Q/D/O/IR chip; renders nothing for healthy players. */
function InjuryBadge({ status, detail }) {
  const style = STATUS_STYLES[status];
  if (!style) return null;
  return (
    <Tooltip title={detail ? `${style.title}: ${detail}` : style.title}>
      <Chip
        label={style.label}
        size="small"
        color={style.color}
        aria-label={`Injury status: ${style.title.toLowerCase()}`}
      />
    </Tooltip>
  );
}

export default InjuryBadge;
