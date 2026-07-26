import React from 'react';
import { Box, Typography } from '@mui/material';
import PublicLayout from '../PublicLayout';
import PublicSeo from '../PublicSeo';
import DraftSimulator from '../../DraftSim/DraftSimulator';

/**
 * The no-login mock draft. The simulator itself is entirely client-side (its
 * only network call is the unauthenticated player pool), so this page needs no
 * session, no league, and no account — which is exactly what makes it a
 * top-of-funnel page worth indexing.
 *
 * PublicLayout's closing CTA is suppressed here because the simulator is an
 * interactive tool, not a reading page: the conversion moment is the finished
 * report, where SimReport renders the same CTABanner itself.
 */
function DraftSimPage() {
  return (
    <PublicLayout ctaContext="strategy" showCta={false}>
      <PublicSeo
        title="Fantasy Football Mock Draft Simulator"
        description="Run a free fantasy football mock draft against CPU managers. Pick your league size, draft slot, format, and clock, then get a graded report on every pick."
        path="/draft-simulator"
      />
      <Box sx={{ mb: 3 }}>
        <Typography variant="h3" component="h1" sx={{ fontWeight: 800 }}>
          Mock Draft Simulator
        </Typography>
        <Typography variant="body1" sx={{ color: 'text.secondary', mt: 1, maxWidth: 720 }}>
          Draft a full roster against CPU managers who actually chase roster needs and positional
          scarcity. Choose your league size, draft slot, format, and pick clock, then get an
          A&ndash;F grade, a per-pick market read, and concrete notes on what to do differently.
        </Typography>
      </Box>
      <DraftSimulator showCta />
    </PublicLayout>
  );
}

export default DraftSimPage;
