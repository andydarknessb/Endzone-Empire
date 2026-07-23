import React, { useCallback, useEffect, useState } from 'react';
import { Container } from '@mui/material';
import { useParams, useSearchParams } from 'react-router-dom';
import apiClient from '../../api/apiClient';
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
  const [state, setState] = useState({ loading: true, error: false, player: null, format: DEFAULT_FORMAT });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, error: false }));

    const profileRequest = apiClient.get(`/api/public/players/${playerId}`, {
      params: season == null ? {} : { season },
    });
    const leagueRequest = leagueId == null
      ? Promise.resolve(null)
      : apiClient.get(`/api/league/${leagueId}`).catch(() => null);

    Promise.all([profileRequest, leagueRequest])
      .then(([profileResponse, leagueResponse]) => {
        if (!active) return;
        setState({
          loading: false,
          error: false,
          player: profileResponse.data,
          format: formatForLeague(leagueResponse?.data?.league),
        });
      })
      .catch(() => {
        if (active) setState({ loading: false, error: true, player: null, format: DEFAULT_FORMAT });
      });

    return () => {
      active = false;
    };
  }, [leagueId, playerId, retryKey, season]);

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
      {state.loading && <LoadingRows rows={6} height={60} />}
      {!state.loading && state.error && (
        <ErrorState message="We couldn't load this player." onRetry={() => setRetryKey((key) => key + 1)} />
      )}
      {!state.loading && !state.error && !state.player && (
        <ErrorState message="Player not found." />
      )}
      {!state.loading && !state.error && state.player && (
        <ProfileBody
          player={state.player}
          onSeasonChange={changeSeason}
          initialFormat={state.format}
          breadcrumbLabel="Players"
          breadcrumbTo="/player"
        />
      )}
    </Container>
  );
}

export default AuthenticatedPlayerProfilePage;
