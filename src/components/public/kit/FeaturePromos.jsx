import React from 'react';
import { Box, Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import FactCheckIcon from '@mui/icons-material/FactCheck';

/**
 * Compact promo row for the two newest features, shown on the public index
 * (Rankings). Deliberately one slim band, not another full-width CTA — the
 * page already closes with CTABanner and two conversion bands read as spam.
 *
 * Cross-router links are plain <a href>: /draft-simulator stays in the public
 * BrowserRouter tree, /#/registration is a real navigation into the hash app.
 */
export const PROMOS = [
  {
    id: 'mock-draft',
    Icon: SmartToyIcon,
    title: 'Mock Draft Simulator',
    body: 'Draft a full roster against CPU managers that chase real roster needs. Instant A–F grade with pick-by-pick steals and reaches. Free, no account needed.',
    ctaLabel: 'Start a mock draft',
    href: '/draft-simulator',
  },
  {
    id: 'pickem',
    Icon: FactCheckIcon,
    title: "League Pick'em",
    body: 'Pick NFL winners against your league every week, straight up or with confidence points. Picks lock at kickoff and reveal game by game.',
    ctaLabel: 'Create a league',
    href: '/#/registration',
  },
];

function FeaturePromos() {
  return (
    <Stack
      component="section"
      aria-label="New features"
      direction={{ xs: 'column', md: 'row' }}
      spacing={2}
      sx={{ mb: 3 }}
    >
      {PROMOS.map(({ id, Icon, title, body, ctaLabel, href }) => (
        <Card key={id} variant="outlined" sx={{ flex: 1 }}>
          <CardContent sx={{ height: '100%' }}>
            <Stack direction="row" spacing={1.5} alignItems="flex-start">
              <Icon sx={{ color: 'var(--accent)', mt: 0.25 }} />
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                  <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
                    {title}
                  </Typography>
                  <Chip size="small" color="primary" label="New" />
                </Stack>
                <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
                  {body}
                </Typography>
                <Button component="a" href={href} variant="outlined" size="small" sx={{ fontWeight: 700 }}>
                  {ctaLabel}
                </Button>
              </Box>
            </Stack>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}

export default FeaturePromos;
