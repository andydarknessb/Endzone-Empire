import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { Box, Chip, Typography } from '@mui/material';

/** Milliseconds remaining until `date`, or null if `date` is unset/invalid. */
function getRemainingMs(date) {
  if (!date) return null;
  const target = new Date(date).getTime();
  if (Number.isNaN(target)) return null;
  return target - Date.now();
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function toParts(remainingMs) {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

// Full precision, dropping leading zero units: "2d 03h 14m 09s", "3h 05m 12s", "0m 08s".
function formatFull({ days, hours, minutes, seconds }) {
  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  return `${minutes}m ${pad(seconds)}s`;
}

// Compact (no seconds), for the chip variant: "2d 03h 14m", "3h 05m", "14m".
function formatCompact({ days, hours, minutes }) {
  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  return `${minutes}m`;
}

/**
 * Live countdown to a future ISO timestamp. Renders nothing once the date is
 * unset or has passed — callers gate on `draft_status === 'pending'` before
 * rendering this at all, but the null-render is a safety net for the exact
 * moment the clock runs out.
 */
function Countdown({ date, prefix, variant }) {
  const [remainingMs, setRemainingMs] = useState(() => getRemainingMs(date));

  useEffect(() => {
    setRemainingMs(getRemainingMs(date));
    if (!date) return undefined;

    const interval = setInterval(() => {
      setRemainingMs(getRemainingMs(date));
    }, 1000);

    return () => clearInterval(interval);
  }, [date]);

  if (remainingMs === null || remainingMs <= 0) {
    return null;
  }

  const parts = toParts(remainingMs);

  if (variant === 'chip') {
    return <Chip size="small" label={`⏱ ${formatCompact(parts)}`} />;
  }

  return (
    <Box>
      <Typography variant="h6" component="div">
        {prefix} {formatFull(parts)}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {`· ${new Date(date).toLocaleString()}`}
      </Typography>
    </Box>
  );
}

Countdown.propTypes = {
  date: PropTypes.string,
  prefix: PropTypes.string,
  variant: PropTypes.oneOf(['chip', 'full']),
};

Countdown.defaultProps = {
  date: null,
  prefix: 'Draft in',
  variant: 'full',
};

export default Countdown;
