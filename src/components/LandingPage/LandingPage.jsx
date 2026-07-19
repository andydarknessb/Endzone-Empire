import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Button,
  Link as MuiLink,
  Card,
  CardContent,
  Stack,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import './LandingPage.css';

const FEATURES = [
  {
    title: 'Live Snake Drafts',
    description: 'Run draft day with a real pick clock and auto-pick so no one holds up the room.',
  },
  {
    title: 'Weekly Lineups',
    description: 'Set starters by slot with lock times and bye-week warnings built in.',
  },
  {
    title: 'Waiver Wire',
    description: 'Claim free agents with priority order or a FAAB budget — your league, your rules.',
  },
  {
    title: 'Trades',
    description: 'Propose, review, and let the league veto trades before they go through.',
  },
  {
    title: 'Live Scoring',
    description: 'Watch matchups update in real time as the games play out on Sunday.',
  },
  {
    title: 'Playoffs & Standings',
    description: 'Seeded brackets and clear tiebreakers decide the champion, no arguments.',
  },
  {
    title: 'League Chat',
    description: 'Talk trash, trade offers, and trade regrets, all in one place.',
  },
  {
    title: 'Commissioner Tools',
    description: 'Manage rosters, settings, and disputes without leaving the app.',
  },
];

function LandingPage() {
  return (
    <Box className="landing-page">
      <Box className="landing-hero" sx={{ py: { xs: 6, md: 10 } }}>
        <Container maxWidth="md">
          <Stack spacing={2} alignItems="center" textAlign="center">
            <Typography variant="h2" component="h1" sx={{ fontWeight: 800 }}>
              Welcome
            </Typography>
            <Typography variant="h5" component="p" sx={{ color: 'text.secondary', maxWidth: 640 }}>
              to Endzone Empire — the app that turns armchair quarterbacks into legendary league
              managers, all season long. Draft, manage, and battle your way to a championship.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ pt: 2 }}>
              <Button
                component={RouterLink}
                to="/registration"
                variant="contained"
                size="large"
              >
                Get Started
              </Button>
              <MuiLink
                component={RouterLink}
                to="/login"
                underline="hover"
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  px: 2,
                  fontWeight: 600,
                }}
              >
                Log In
              </MuiLink>
            </Stack>
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
        <Typography variant="h4" component="h2" sx={{ mb: 1, textAlign: 'center' }}>
          Everything your league needs
        </Typography>
        <Typography
          variant="body1"
          sx={{ mb: 4, color: 'text.secondary', textAlign: 'center' }}
        >
          One platform for the whole fantasy football season, from draft night to the trophy.
        </Typography>

        <Grid container spacing={3}>
          {FEATURES.map((feature) => (
            <Grid xs={12} sm={6} md={3} key={feature.title}>
              <Card
                variant="outlined"
                sx={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <CardContent>
                  <Typography variant="h6" component="h3" sx={{ mb: 1 }}>
                    {feature.title}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {feature.description}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Container>
    </Box>
  );
}

export default LandingPage;
