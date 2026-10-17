import React from 'react';
import { Box } from '@mui/material';
import { PixelWarn } from '../../shared/ui/playselect/Icons';
import { PsButton } from '../../shared/ui/playselect/Controls';

/**
 * A refusal or a failed read: a 2px Danger edge, the warning pictogram and the sentence. The live region
 * (`role="alert"`) holds the pictogram and text only; Retry, when there is one, sits beside it, never inside.
 * `detail` is a second Dim sentence (the server's own words on a failed read).
 */
export default function TradeAlert({ children, detail, onRetry, testId }) {
  return (
    <Box
      data-testid={testId}
      sx={{
        boxSizing: 'border-box',
        border: '2px solid var(--ps-danger)',
        backgroundColor: 'var(--ps-panel)',
        color: 'var(--ps-ink)',
        padding: '12px 16px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '8px 10px',
        fontSize: '16px',
      }}
    >
      <Box role="alert" sx={{ flex: '1 1 240px', minWidth: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
        <PixelWarn color="var(--ps-danger)" />
        <Box>
          <Box sx={{ textWrap: 'pretty' }}>{children}</Box>
          {detail ? <Box sx={{ fontSize: '15px', color: 'var(--ps-dim)', textWrap: 'pretty' }}>{detail}</Box> : null}
        </Box>
      </Box>
      {onRetry ? <PsButton variant="ghost" onClick={onRetry}>Retry</PsButton> : null}
    </Box>
  );
}
