import React from 'react';
import { Box, Container, Stack, Typography, Button } from '@mui/material';

export const CTA_COPY = {
  rankings: {
    title: 'Turn rankings into a championship roster',
    subtitle: 'Create a league, draft from the same player pool, and track every matchup through the playoffs.',
  },
  player: {
    title: 'Put player research to work',
    subtitle: 'Draft your roster, manage weekly decisions, and follow every fantasy point in one league home.',
  },
  recaps: {
    title: 'Make every final score matter',
    subtitle: 'Run a league with live scoring, weekly matchups, trades, waivers, and a complete playoff race.',
  },
  waiver: {
    title: 'Build a league where every waiver move counts',
    subtitle: 'Choose priority or FAAB, manage claims, and give every manager a fair shot at the next breakout.',
  },
  strategy: {
    title: 'Bring your strategy to a real league',
    subtitle: 'Create a league in minutes, invite your managers, and turn draft-day ideas into a full season.',
  },
  default: {
    title: 'Ready to run your own league?',
    subtitle: 'Endzone Empire includes drafts, live scoring, waivers, trades, and playoffs in one fantasy platform.',
  },
};

/**
 * The recurring "Ready to run your own league?" conversion band that closes
 * public pages. Links cross the router boundary to the authed registration
 * route with a plain <a href> (the authed app lives in the hash fragment).
 */
function CTABanner({
  context = 'default',
  title,
  subtitle,
  ctaLabel = 'Get started free',
  href = '/#/registration',
}) {
  const copy = CTA_COPY[context] || CTA_COPY.default;
  return (
    <Box
      component="section"
      sx={{
        bgcolor: 'background.paper',
        borderTop: '1px solid var(--border-subtle)',
        py: { xs: 6, md: 8 },
      }}
    >
      <Container maxWidth="sm">
        <Stack spacing={2.5} alignItems="center" textAlign="center">
          <Typography variant="h4" component="h2" sx={{ fontWeight: 800 }}>
            {title || copy.title}
          </Typography>
          <Typography variant="body1" sx={{ color: 'text.secondary' }}>
            {subtitle || copy.subtitle}
          </Typography>
          <Button component="a" href={href} variant="contained" size="large" sx={{ px: 5, py: 1.5, fontWeight: 700 }}>
            {ctaLabel}
          </Button>
        </Stack>
      </Container>
    </Box>
  );
}

export default CTABanner;
