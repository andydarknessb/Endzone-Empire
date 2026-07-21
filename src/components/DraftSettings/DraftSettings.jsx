import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Alert, Box, Button, Container, Paper, Skeleton, Tab, Tabs, Typography } from '@mui/material';
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
import { useUnsavedChangesGuard } from '../NavigationGuard/NavigationGuard';

const TAB_ITEMS = [
  ['type', 'Draft type'], ['schedule', 'Schedule'], ['timer', 'Timer'], ['order', 'Draft order'],
  ['auction', 'Auction'], ['limits', 'Position limits'], ['keepers', 'Keepers'], ['readiness', 'Readiness'],
];

const tabId = (value) => `draft-settings-tab-${value}`;
const panelId = (value) => `draft-settings-tabpanel-${value}`;

const errorMessage = (error) => error?.response?.data?.error || error?.message || 'Request failed';
const failure = (notify, error) => notify(errorMessage(error), { severity: 'error' });

export default function DraftSettings() {
  const { leagueId } = useParams();
  const user = useSelector((store) => store.user);
  const notify = useSnackbar();
  const { league, loading, error, refetch, updateLeague } = useLeague(leagueId);
  const [teams, setTeams] = useState([]);
  const [keepers, setKeepers] = useState([]);
  const [keeperCandidates, setKeeperCandidates] = useState([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [teamsError, setTeamsError] = useState(null);
  const [keeperDataRequested, setKeeperDataRequested] = useState(false);
  const [keeperDataLoading, setKeeperDataLoading] = useState(false);
  const [keeperDataError, setKeeperDataError] = useState(null);
  const [tab, setTab] = useState('type');
  const [dirtyTabs, setDirtyTabs] = useState({});
  const [keeperDirty, setKeeperDirty] = useState({ settings: false, assignments: false });
  const [saving, setSaving] = useState(false);
  const activeTabDirty = tab === 'keepers'
    ? keeperDirty.settings || keeperDirty.assignments
    : Boolean(dirtyTabs[tab]);
  const requestTransition = useUnsavedChangesGuard(activeTabDirty);
  const setPanelDirty = useCallback((dirty) => {
    setDirtyTabs((current) => current[tab] === dirty ? current : { ...current, [tab]: dirty });
  }, [tab]);
  const setKeeperSettingsDirty = useCallback((dirty) => {
    setKeeperDirty((current) => current.settings === dirty ? current : { ...current, settings: dirty });
  }, []);
  const setKeeperAssignmentsDirty = useCallback((dirty) => {
    setKeeperDirty((current) => current.assignments === dirty ? current : { ...current, assignments: dirty });
  }, []);
  const changeTab = (nextTab) => {
    if (nextTab === tab) return;
    requestTransition(() => {
      if (tab === 'keepers') setKeeperDirty({ settings: false, assignments: false });
      else setDirtyTabs((current) => ({ ...current, [tab]: false }));
      setTab(nextTab);
    });
  };
  const loadTeams = useCallback(async () => {
    try {
      setTeamsLoading(true);
      setTeamsError(null);
      const leagueResponse = await apiClient.get(`/api/league/${leagueId}`);
      setTeams(leagueResponse.data.teams || []);
    } catch (requestError) {
      setTeamsError(errorMessage(requestError));
    } finally {
      setTeamsLoading(false);
    }
  }, [leagueId]);
  const loadKeeperData = useCallback(async () => {
    try {
      setKeeperDataRequested(true);
      setKeeperDataLoading(true);
      setKeeperDataError(null);
      const [keeperResponse, candidateResponse] = await Promise.all([
        apiClient.get(`/api/draft/league/${leagueId}/keepers`),
        apiClient.get(`/api/draft/league/${leagueId}/keeper-candidates`),
      ]);
      setKeepers(keeperResponse.data || []);
      setKeeperCandidates(candidateResponse.data || []);
    } catch (requestError) {
      setKeeperDataError(errorMessage(requestError));
    } finally {
      setKeeperDataLoading(false);
    }
  }, [leagueId]);
  useEffect(() => {
    setTeams([]);
    loadTeams();
  }, [loadTeams]);
  useEffect(() => {
    setKeepers([]);
    setKeeperCandidates([]);
    setKeeperDataRequested(false);
    setKeeperDataError(null);
    setKeeperDirty({ settings: false, assignments: false });
  }, [leagueId]);
  useEffect(() => {
    if (tab === 'keepers' && !keeperDataRequested) loadKeeperData();
  }, [keeperDataRequested, loadKeeperData, tab]);
  const refresh = useCallback(async ({ includeKeeperData = tab === 'keepers' } = {}) => {
    clearLeagueCache(leagueId);
    const requests = [refetch(), loadTeams()];
    if (includeKeeperData) requests.push(loadKeeperData());
    await Promise.all(requests);
  }, [leagueId, loadKeeperData, loadTeams, refetch, tab]);
  const saveLeague = async (payload, message, { reloadKeeperData = tab === 'keepers', clearDirty = true } = {}) => {
    setSaving(true);
    try {
      let response;
      try {
        response = await apiClient.put(`/api/league/${leagueId}`, payload);
      } catch (requestError) {
        failure(notify, requestError);
        return { success: false, error: errorMessage(requestError) };
      }
      updateLeague(response.data);
      if (clearDirty) setDirtyTabs((current) => ({ ...current, [tab]: false }));
      notify(message);
      try {
        await refresh({ includeKeeperData: reloadKeeperData });
      } catch {
        notify('Settings were saved, but the latest data could not be reloaded.', { severity: 'warning' });
      }
      return { success: true, data: response.data };
    } finally {
      setSaving(false);
    }
  };
  const saveKeeperSettings = async (payload, message) => {
    const result = await saveLeague(payload, message, { reloadKeeperData: false, clearDirty: false });
    if (result.success) setKeeperDirty((current) => ({ ...current, settings: false }));
    return result;
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
    } catch (requestError) {
      failure(notify, requestError);
      setSaving(false);
      return { success: false, error: errorMessage(requestError) };
    }
    try {
      await refresh();
    } catch (requestError) {
      failure(notify, requestError);
    } finally {
      setSaving(false);
    }
    return { success: true };
  };
  const saveKeepers = async (nextKeepers) => {
    try {
      setSaving(true);
      await apiClient.put(`/api/draft/league/${leagueId}/keepers`, { keepers: nextKeepers });
      setKeeperDirty((current) => ({ ...current, assignments: false }));
      notify('Keeper assignments saved');
      await refresh({ includeKeeperData: true });
      return { success: true };
    } catch (requestError) {
      failure(notify, requestError);
      return { success: false, error: errorMessage(requestError) };
    } finally { setSaving(false); }
  };

  if (loading && !league) return <Container maxWidth="lg" sx={{ py: 4 }}><Skeleton height={50} /><Skeleton variant="rounded" height={420} /></Container>;
  if (error && !league) return <Container maxWidth="lg" sx={{ py: 4 }}><Alert severity="error" action={<Button color="inherit" size="small" onClick={refetch}>Retry league settings</Button>}>Unable to load league settings: {error}</Alert></Container>;
  if (!league) return null;
  if (user?.id && user.id !== league.owner_id) return <Navigate to={`/league/${leagueId}`} replace />;
  const frozen = league.draft_status !== 'pending';
  const common = { league, frozen, onSave: saveLeague, saving, onDirtyChange: setPanelDirty };
  const teamData = (panel) => {
    if (teamsLoading) return <Skeleton variant="rounded" height={180} />;
    if (teamsError) return <Alert severity="error" action={<Button color="inherit" size="small" onClick={loadTeams}>Retry team data</Button>}>Unable to load team data: {teamsError}</Alert>;
    return panel;
  };
  let content;
  if (tab === 'type') content = <DraftTypePanel {...common} />;
  else if (tab === 'schedule') content = teamData(<SchedulePanel {...common} teamCount={teams.length} onStart={startNow} />);
  else if (tab === 'timer') content = <TimerPanel {...common} onSetClock={setClock} />;
  else if (tab === 'order') content = teamData(<DraftOrderPanel {...common} teams={teams} onSetOrder={setOrder} onRandomize={randomize} />);
  else if (tab === 'auction') content = league.draft_type === 'auction' ? teamData(<AuctionPanel {...common} teams={teams} />) : <Alert severity="info">Select Salary-cap auction under Draft type to edit auction settings.</Alert>;
  else if (tab === 'limits') content = <PositionLimitsPanel {...common} />;
  else if (tab === 'keepers') content = teamData(!keeperDataRequested || keeperDataLoading ? <Skeleton variant="rounded" height={260} /> : keeperDataError ? <Alert severity="error" action={<Button color="inherit" size="small" onClick={loadKeeperData}>Retry keeper data</Button>}>Unable to load keeper data: {keeperDataError}</Alert> : <KeeperPanel league={league} teams={teams} keepers={keepers} keeperCandidates={keeperCandidates} frozen={frozen} saving={saving} onSaveLeague={saveKeeperSettings} onSaveKeepers={saveKeepers} onSettingsDirtyChange={setKeeperSettingsDirty} onAssignmentsDirtyChange={setKeeperAssignmentsDirty} />);
  else content = teamData(<ReadinessPanel teams={teams} draftType={league.draft_type} />);
  return <Container maxWidth="lg" sx={{ py: 4 }}><Typography variant="h4" sx={{ mb: 0.5 }}>Draft Settings</Typography><Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>{league.name}</Typography>{error && <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={refetch}>Retry league settings</Button>}>Unable to refresh league settings: {error}</Alert>}{frozen && <Alert severity="info" sx={{ mb: 2 }}>Draft setup is locked after the draft starts. The Timer tab remains available while a draft is active.</Alert>}<Paper sx={{ p: { xs: 1.5, sm: 2.5 } }}><Tabs aria-label="Draft settings sections" value={tab} onChange={(event, value) => changeTab(value)} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile sx={{ borderBottom: '1px solid', borderColor: 'divider', mb: 3 }}>{TAB_ITEMS.map(([value, label]) => <Tab key={value} value={value} label={label} id={tabId(value)} aria-controls={panelId(value)} />)}</Tabs><Box role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)}>{content}</Box></Paper></Container>;
}
