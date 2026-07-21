import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Alert, Container, Paper, Skeleton, Tab, Tabs, Typography } from '@mui/material';
import apiClient from '../../api/apiClient';
import { clearLeagueCache, useLeague } from '../../hooks/useLeague';
import { useSnackbar } from '../Snackbar/SnackbarProvider';
import DraftTypePanel from './DraftTypePanel';
import SchedulePanel from './SchedulePanel';
import TimerPanel from './TimerPanel';
import DraftOrderPanel from './DraftOrderPanel';
import AuctionPanel from './AuctionPanel';
import PositionLimitsPanel from './PositionLimitsPanel';
import KeeperPanel from './KeeperPanel';
import ReadinessPanel from './ReadinessPanel';

const TAB_ITEMS = [
  ['type', 'Draft type'], ['schedule', 'Schedule'], ['timer', 'Timer'], ['order', 'Draft order'],
  ['auction', 'Auction'], ['limits', 'Position limits'], ['keepers', 'Keepers'], ['readiness', 'Readiness'],
];

const failure = (notify, error) => notify(error.response?.data?.error || error.message, { severity: 'error' });

export default function DraftSettings() {
  const { leagueId } = useParams();
  const user = useSelector((store) => store.user);
  const notify = useSnackbar();
  const { league, loading, error, refetch } = useLeague(leagueId);
  const [teams, setTeams] = useState([]);
  const [keepers, setKeepers] = useState([]);
  const [keeperCandidates, setKeeperCandidates] = useState([]);
  const [tab, setTab] = useState('type');
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const loadSupplemental = useCallback(async () => {
    try {
      setLoadError(null);
      const [leagueResponse, keeperResponse, candidateResponse] = await Promise.all([
        apiClient.get(`/api/league/${leagueId}`),
        apiClient.get(`/api/draft/league/${leagueId}/keepers`),
        apiClient.get(`/api/draft/league/${leagueId}/keeper-candidates`),
      ]);
      setTeams(leagueResponse.data.teams || []);
      setKeepers(keeperResponse.data || []);
      setKeeperCandidates(candidateResponse.data || []);
    } catch (requestError) {
      setLoadError(requestError.response?.data?.error || requestError.message);
    }
  }, [leagueId]);
  useEffect(() => { loadSupplemental(); }, [loadSupplemental]);
  const refresh = useCallback(async () => {
    clearLeagueCache(leagueId);
    await Promise.all([refetch(), loadSupplemental()]);
  }, [leagueId, loadSupplemental, refetch]);
  const saveLeague = async (payload, message) => {
    try {
      setSaving(true);
      await apiClient.put(`/api/league/${leagueId}`, payload);
      notify(message);
      await refresh();
    } catch (requestError) { failure(notify, requestError); } finally { setSaving(false); }
  };
  const setClock = async (pickTimeSeconds) => {
    try {
      setSaving(true);
      await apiClient.post(`/api/draft/league/${leagueId}/clock`, { pickTimeSeconds });
      notify('Clock updated for the next pick');
      await refresh();
    } catch (requestError) { failure(notify, requestError); } finally { setSaving(false); }
  };
  const setOrder = async (order) => {
    try {
      setSaving(true);
      await apiClient.post(`/api/draft/league/${leagueId}/order`, { order });
      notify('Draft order saved');
      await refresh();
    } catch (requestError) { failure(notify, requestError); } finally { setSaving(false); }
  };
  const randomize = async () => {
    try {
      setSaving(true);
      await apiClient.post(`/api/draft/league/${leagueId}/order`, { randomize: true });
      notify('Draft order randomized');
      await refresh();
    } catch (requestError) { failure(notify, requestError); } finally { setSaving(false); }
  };
  const startNow = async () => {
    try {
      setSaving(true);
      await apiClient.post(`/api/league/${leagueId}/start-draft`);
      notify('Draft started');
      await refresh();
    } catch (requestError) { failure(notify, requestError); } finally { setSaving(false); }
  };
  const saveKeepers = async (nextKeepers) => {
    try {
      setSaving(true);
      await apiClient.put(`/api/draft/league/${leagueId}/keepers`, { keepers: nextKeepers });
      notify('Keeper assignments saved');
      await refresh();
    } catch (requestError) { failure(notify, requestError); } finally { setSaving(false); }
  };

  if (loading && !league) return <Container maxWidth="lg" sx={{ py: 4 }}><Skeleton height={50} /><Skeleton variant="rounded" height={420} /></Container>;
  if (error || loadError) return <Container maxWidth="lg" sx={{ py: 4 }}><Alert severity="error">{error || loadError}</Alert></Container>;
  if (!league) return null;
  if (user?.id && user.id !== league.owner_id) return <Navigate to={`/league/${leagueId}`} replace />;
  const frozen = league.draft_status !== 'pending';
  const common = { league, frozen, onSave: saveLeague, saving };
  let content;
  if (tab === 'type') content = <DraftTypePanel {...common} />;
  else if (tab === 'schedule') content = <SchedulePanel {...common} teamCount={teams.length} onStart={startNow} />;
  else if (tab === 'timer') content = <TimerPanel {...common} onSetClock={setClock} />;
  else if (tab === 'order') content = <DraftOrderPanel {...common} teams={teams} onSetOrder={setOrder} onRandomize={randomize} />;
  else if (tab === 'auction') content = league.draft_type === 'auction' ? <AuctionPanel {...common} teams={teams} /> : <Alert severity="info">Select Salary-cap auction under Draft type to edit auction settings.</Alert>;
  else if (tab === 'limits') content = <PositionLimitsPanel {...common} />;
  else if (tab === 'keepers') content = <KeeperPanel {...common} teams={teams} keepers={keepers} keeperCandidates={keeperCandidates} onSaveLeague={saveLeague} onSaveKeepers={saveKeepers} />;
  else content = <ReadinessPanel teams={teams} draftType={league.draft_type} />;
  return <Container maxWidth="lg" sx={{ py: 4 }}><Typography variant="h4" sx={{ mb: 0.5 }}>Draft Settings</Typography><Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>{league.name}</Typography>{frozen && <Alert severity="info" sx={{ mb: 2 }}>Draft setup is locked after the draft starts. The Timer tab remains available while a draft is active.</Alert>}<Paper sx={{ p: { xs: 1.5, sm: 2.5 } }}><Tabs value={tab} onChange={(event, value) => setTab(value)} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile sx={{ borderBottom: '1px solid', borderColor: 'divider', mb: 3 }}>{TAB_ITEMS.map(([value, label]) => <Tab key={value} value={value} label={label} />)}</Tabs>{content}</Paper></Container>;
}
