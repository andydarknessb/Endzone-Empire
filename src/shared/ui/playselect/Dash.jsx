import React from 'react';
import { Box } from '@mui/material';
import { SR_ONLY_SX } from './type';

// A bare dash reads as nothing to a screen reader; the hidden words say what it stands for.
export function Dash() {
  return (
    <>
      <Box component="span" aria-hidden="true">-</Box>
      <Box component="span" sx={SR_ONLY_SX}>Not available</Box>
    </>
  );
}
