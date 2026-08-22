import React, { useCallback, useEffect, useState } from 'react';
import { Container } from '@mui/material';
import { useParams, useSearchParams } from 'react-router-dom';
import apiClient from '../../api/apiClient';
import { useLeague } from '../../hooks/useLeague';
import { DEFAULT_FORMAT } from '../public/kit/scoringFormat';
import { ErrorState, LoadingRows } from '../public/kit/DataState';
import { ProfileBody } from '../public/pages/PlayerProfilePage';

const FORMAT_BY_PRESET = {
  standard: 'standard',
  half_ppr: 'halfPpr',
  ppr: 'ppr',
};

export function formatForLeague(league) {
  const presetFormat = FORMAT_BY_PRESET[league?.scoring_preset];
  if (presetFormat) return presetFormat;

  const reception = Number(league?.scoring_rules?.receiving?.reception);
  if (reception === 0) return 'standard';
  if (reception === 0.5) return 'halfPpr';
  if (reception === 1) return 'ppr';
  return DEFAULT_FORMAT;
}

function AuthenticatedPlayerProfilePage() {
  const { playerId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const seasonParam = searchParams.get('season');
  const leagueParam = searchParams.get('leagueId');
  const season = seasonParam != null && /^\d+$/.test(seasonParam) ? Number(seasonParam) : null;
  const leagueId = leagueParam != null && /^\d+$/.test(leagueParam) ? Number(leagueParam) : null;
  const [state, setState] = useState({ loading: true, error: false, player: null });
  const [retryKey, setRetryKey] = useState(0);
  // The shared league entry every other league page reads, so arriving here
  // from one costs no request. A null id never fetches, and a league that
  // fails to load is not an error for this page: the profile still renders,
  // in the default format, which is why leagueError is not read.
  const { league, loading: leagueLoading, refetch: refetchLeague } = useLeague(leagueId);
  const format = formatForLeague(league);

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, error: false }));

    apiClient.get(`/api/public/players/${playerId}`, { params: season == null ? {} : { season } })
      .then((profileResponse) => {
        if (active) setState({ loading: false, error: false, player: profileResponse.data });
      })
      .catch(() => {
        if (active) setState({ loading: false, error: true, player: null });
      });

    return () => {
      active = false;
    };
  }, [playerId, retryKey, season]);

  // ProfileBody takes the format as an initial value, so it has to be settled
  // before the body mounts: a format arriving later would reset a switch the
  // reader had already flipped. Waiting on the league only while it has no row
  // to show keeps a failed league request from holding the profile back.
  //
  // Only the body waits on it. A profile that rejected, or that came back with
  // nothing, is already final, and its message (with the Retry button under the
  // error) has to be reachable even when the league request is slow or never
  // answers at all. That is what `state.player` gates on here: it is null in
  // both of those branches, and neither renders a format.
  const formatPending = leagueId != null && leagueLoading && !league;
  const loading = state.loading || (state.player != null && formatPending);

  const retry = useCallback(() => {
    setRetryKey((key) => key + 1);
    // A failed league response is never cached, so a retry of the profile
    // retries the league too, as it did when both rode on one request.
    refetchLeague();
  }, [refetchLeague]);

  const changeSeason = useCallback((next) => {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (next == null) params.delete('season');
      else params.set('season', String(next));
      return params;
    }, { replace: true });
  }, [setSearchParams]);

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {loading && <LoadingRows rows={6} height={60} />}
      {!loading && state.error && (
        <ErrorState message="We couldn't load this player." onRetry={retry} />
      )}
      {!loading && !state.error && !state.player && (
        <ErrorState message="Player not found." />
      )}
      {!loading && !state.error && state.player && (
        <ProfileBody
          player={state.player}
          onSeasonChange={changeSeason}
          initialFormat={format}
          breadcrumbLabel="Players"
          breadcrumbTo="/player"
        />
      )}
    </Container>
  );
}

export default AuthenticatedPlayerProfilePage;
