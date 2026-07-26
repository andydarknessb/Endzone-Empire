import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Container, Stack, Link, Typography, Button, Divider } from '@mui/material';
import { PUBLIC_NAV_LINKS, REGISTER_HREF } from './kit/navLinks';

/** Public footer: same nav, a small CTA, and a copyright line. */
function PublicFooter() {
  return (
    <Box component="footer" sx={{ bgcolor: 'background.paper', borderTop: '1px solid var(--border-subtle)', mt: 'auto' }}>
      <Container maxWidth="lg" sx={{ py: 5 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} spacing={3}>
          <Box>
            <Typography sx={{ fontWeight: 800, backgroundImage: 'var(--gradient-brand)', backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent', display: 'inline-block' }}>
              Endzone Empire
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, maxWidth: 360 }}>
              Free NFL rankings, player profiles, recaps, and fantasy strategy. No account needed.
            </Typography>
          </Box>
          <Stack component="nav" aria-label="Footer" direction="row" flexWrap="wrap" spacing={2.5} rowGap={1}>
            {PUBLIC_NAV_LINKS.map((link) => (
              <Link key={link.to + link.label} component={RouterLink} to={link.to} underline="hover" sx={{ color: 'text.secondary' }}>
                {link.label}
              </Link>
            ))}
          </Stack>
          <Button component="a" href={REGISTER_HREF} variant="outlined" size="small">Create a league</Button>
        </Stack>
        <Divider sx={{ my: 3 }} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          © {new Date().getFullYear()} Endzone Empire. Player and game data for informational use.
        </Typography>
      </Container>
    </Box>
  );
}

export default PublicFooter;
