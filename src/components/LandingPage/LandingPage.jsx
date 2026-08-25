import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Button,
  Card,
  CardContent,
  Link as MuiLink,
  Stack,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import TimerIcon from '@mui/icons-material/Timer';
import ViewListIcon from '@mui/icons-material/ViewList';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import ScoreboardIcon from '@mui/icons-material/Scoreboard';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import ChatIcon from '@mui/icons-material/Chat';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import LandingPublicBand from './LandingPublicBand';
import './LandingPage.css';

const FEATURES = [
  {
    title: 'Live Snake Drafts',
    description: 'Run draft day with a real pick clock and auto-pick so no one holds up the room.',
    Icon: TimerIcon,
  },
  {
    title: 'Weekly Lineups',
    description: 'Set starters by slot with lock times and bye-week warnings built in.',
    Icon: ViewListIcon,
  },
  {
    title: 'Waiver Wire',
    description: 'Claim free agents with priority order or a FAAB budget. Your league, your rules.',
    Icon: PersonAddIcon,
  },
  {
    title: 'Trades',
    description: 'Propose, review, and let the league veto trades before they go through.',
    Icon: SwapHorizIcon,
  },
  {
    title: 'Live Scoring',
    description: 'Watch matchups update in real time as the games play out on Sunday.',
    Icon: ScoreboardIcon,
  },
  {
    title: 'Playoffs & Standings',
    description: 'Seeded brackets and clear tiebreakers decide the champion, no arguments.',
    Icon: EmojiEventsIcon,
  },
  {
    title: 'League Chat',
    description: 'Talk trash, trade offers, and trade regrets, all in one place.',
    Icon: ChatIcon,
  },
  {
    title: 'Commissioner Tools',
    description: 'Manage rosters, settings, and disputes without leaving the app.',
    Icon: AdminPanelSettingsIcon,
  },
  {
    title: "League Pick'em",
    description: 'Pick NFL winners against your league every week, straight up or with confidence points.',
    Icon: FactCheckIcon,
  },
  {
    title: 'Mock Draft Simulator',
    description: 'Practice against CPU managers and get an instant A–F grade with pick-by-pick analysis.',
    Icon: SmartToyIcon,
  },
];

function LandingPage() {
  return (
    <Box className="landing-page">
      <Box className="landing-hero" sx={{ py: { xs: 8, md: 12 } }}>
        <Container maxWidth="md">
          <Stack spacing={3} alignItems="center" textAlign="center">
            <Typography
              variant="h1"
              component="h1"
              sx={{
                fontWeight: 800,
                fontSize: { xs: '2.5rem', sm: '3.25rem', md: '4rem' },
                lineHeight: 1.15,
              }}
            >
              Welcome to{' '}
              <Box
                component="span"
                sx={{
                  backgroundImage: 'linear-gradient(90deg, var(--accent), var(--secondary))',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  color: 'transparent',
                  WebkitTextFillColor: 'transparent',
                  whiteSpace: 'nowrap',
                }}
              >
                Endzone Empire
              </Box>
            </Typography>
            <Typography variant="h5" component="p" sx={{ color: 'text.secondary', maxWidth: 640, fontWeight: 400 }}>
              The app that turns armchair quarterbacks into legendary league managers, all season
              long. Draft, manage, and battle your way to a championship.
            </Typography>
            <Typography variant="body1" component="p" sx={{ color: 'text.secondary', maxWidth: 640 }}>
              Prefer just picking winners? Run an NFL pick&apos;em league instead · no draft, no
              rosters.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ pt: 2 }}>
              <Button
                component={RouterLink}
                to="/registration"
                variant="contained"
                size="large"
                sx={{ px: 4 }}
              >
                Get Started
              </Button>
              <Button
                component={RouterLink}
                to="/login"
                variant="outlined"
                size="large"
                sx={{ px: 4 }}
              >
                Log In
              </Button>
            </Stack>
            {/* Plain <a href>: /draft-simulator lives in the public BrowserRouter tree. */}
            <MuiLink href="/draft-simulator" underline="hover" sx={{ fontWeight: 600 }}>
              Or try a free mock draft, no account needed →
            </MuiLink>
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
          {FEATURES.map((feature, index) => (
            <Grid xs={12} sm={6} md={3} key={feature.title}>
              <Card
                variant="outlined"
                sx={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  textAlign: 'center',
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: 'var(--shadow-2)',
                  },
                }}
              >
                <CardContent>
                  <feature.Icon
                    sx={{
                      fontSize: 40,
                      mb: 1.5,
                      color: index % 2 === 0 ? 'var(--accent)' : 'var(--secondary)',
                    }}
                  />
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

      <LandingPublicBand />

      <Box
        sx={{
          bgcolor: 'background.paper',
          borderTop: '1px solid var(--border-subtle)',
          py: 10,
        }}
      >
        <Container maxWidth="sm">
          <Stack spacing={3} alignItems="center" textAlign="center">
            <Typography variant="h3" component="h2" sx={{ fontWeight: 800 }}>
              Ready to build your dynasty?
            </Typography>
            <Typography variant="body1" sx={{ color: 'text.secondary' }}>
              Create a league in minutes and have your friends drafting by tonight.
            </Typography>
            <Button
              component={RouterLink}
              to="/registration"
              variant="contained"
              size="large"
              sx={{
                px: 6,
                py: 1.75,
                fontSize: 18,
                fontWeight: 700,
                animation: 'landing-cta-pulse 2.4s ease-in-out infinite',
                '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
              }}
            >
              Create Your League Now
            </Button>
          </Stack>
        </Container>
      </Box>
    </Box>
  );
}

export default LandingPage;
