import React from 'react';
import { Box, Typography } from '@mui/material';

/**
 * The Decision card's Bio tile (age, height, weight, college, experience,
 * draft). No producer fills `bio` yet (ADR 0040's Plan: the ESPN athlete
 * client is a later slice), so `getPlayerCard` always ships `bio: null`
 * today and this renders nothing - the null-hides-the-tile rule, proven
 * ahead of its own data source the same way `ownership`/`depth` are in
 * `DecisionStrip`.
 */
export default function Bio({ bio }) {
  const fields = [
    ['Age', bio?.age],
    ['Height', bio?.height],
    ['Weight', bio?.weight],
    ['College', bio?.college],
    ['Experience', bio?.experience],
    ['Draft', bio?.draft],
  ].filter(([, value]) => value != null);
  if (fields.length === 0) return null;
  return (
    <Box data-testid="decision-card-bio" sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
      {fields.map(([label, value]) => (
        <Typography key={label} sx={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {label}: {value}
        </Typography>
      ))}
    </Box>
  );
}
