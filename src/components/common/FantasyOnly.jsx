import React from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Box, Button, CircularProgress, Container, Paper, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useLeague } from '../../hooks/useLeague';
import { isPickemOnly } from '../../lib/leagueType';

/**
 * Route guard for the fantasy-only surfaces (draft, lineup, matchups, waivers,
 * trades, power rankings, draft settings). A pick'em-only league has none of
 * them, so a bookmarked or hand-typed URL gets a short explanation and a way
 * back instead of an empty fantasy page firing roster-shaped requests.
 *
 * Reads the league through useLeague. The dashboard reads the same entry, so
 * the usual hop (dashboard -> fantasy page) costs no request and mounts the
 * page synchronously; the wrapped pages that call useLeague themselves share
 * that entry too. Only a cold entry (deep link, expired cache) costs a
 * request. The verdict waits for the row rather than rendering the page
 * optimistically; if the row cannot be loaded at all the page renders and
 * reports the failure itself, the same way it would without this wrapper.
 *
 * `mainContentId` is optional and opt-in: pass it only from a route whose
 * skip link targets that id (today, just the Draft route - see App.jsx),
 * so the skip link still has something real to focus on the loading and
 * pick'em-blocked renders below, not only once `children` (e.g. DraftBoard)
 * actually mounts. Every other FantasyOnly caller omits it and is unaffected.
 */
export default function FantasyOnly({ children, mainContentId }) {
  const { leagueId } = useParams();
  const { league, loading } = useLeague(leagueId);
  const mainContentProps = mainContentId
    ? { id: mainContentId, tabIndex: -1, component: 'main' }
    : {};
  // An explicit role="status" would win over the implicit role a native
  // <main> carries, so on the Draft route (which needs this to expose as
  // the main landmark for the skip link) announce loading via aria-live
  // instead - every other caller keeps the plain role="status" it always had.
  const loadingRegionProps = mainContentId ? { 'aria-live': 'polite' } : { role: 'status' };

  if (!league && loading) {
    return (
      <Box
        aria-label="Loading league"
        sx={{ py: 8, textAlign: 'center' }}
        {...loadingRegionProps}
        {...mainContentProps}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (!isPickemOnly(league)) return children;

  return (
    <Container maxWidth="sm" sx={{ py: 6 }} {...mainContentProps}>
      <Paper sx={{ p: { xs: 3, sm: 4 }, textAlign: 'center' }}>
        <Typography variant="h5" sx={{ mb: 1 }}>Not part of this league</Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          This is a pick&apos;em league. Drafts, rosters, and matchups are not part of it.
        </Typography>
        <Button
          component={RouterLink}
          to={`/league/${leagueId}`}
          variant="contained"
          startIcon={<ArrowBackIcon />}
        >
          Back to {league.name || 'the league'}
        </Button>
      </Paper>
    </Container>
  );
}
