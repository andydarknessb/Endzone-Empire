import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Box, Tab, Tabs } from '@mui/material';
import { PixelArrow, PixelHeading, psRootSx } from '../../shared/ui/playselect';
import LeagueBreadcrumb from '../LeagueBreadcrumb/LeagueBreadcrumb';
import { Dim, ErrorPanel, Frame, Note, PsButton, Skel, TARGET_SX } from './kit';
import apiClient from '../../api/apiClient';
import { useLeague } from '../../hooks/useLeague';
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
import { isLeagueCreator } from '../../shared/lib/teamIdentity';
import { readHttpFailure } from '../../lib/httpFailure';

const TAB_ITEMS = [
  ['type', 'Draft type'], ['schedule', 'Schedule'], ['timer', 'Timer'], ['order', 'Draft order'],
  ['auction', 'Auction'], ['limits', 'Position limits'], ['keepers', 'Keepers'], ['readiness', 'Readiness'],
];

const tabId = (value) => `draft-settings-tab-${value}`;
const panelId = (value) => `draft-settings-tabpanel-${value}`;

const failure = (notify, error) =>
  notify(readHttpFailure(error).message || error?.message || 'Request failed', { severity: 'error' });

function PageRoot({ children }) {
  return <Box className="ps-root" sx={{ ...psRootSx, minHeight: '100%', width: '100%', minWidth: 0, boxSizing: 'border-box', padding: { xs: '16px', sm: '24px' }, maxWidth: '1200px', mx: 'auto' }}>{children}</Box>;
}

// The alert carries no button: Retry is a ghost beside it, outside the alert's role element.
function LoadError({ title, retry, onRetry }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'flex-start' }}>
      <Box sx={{ alignSelf: 'stretch' }}><ErrorPanel title={title} body="Check your connection and try again." /></Box>
      <PsButton onClick={onRetry}>{retry}</PsButton>
    </Box>
  );
}

export default function DraftSettings() {
  const { leagueId } = useParams();
  const user = useSelector((store) => store.user);
  const notify = useSnackbar();
  // teams is the other half of the /api/league/:id payload, so it arrives with
  // the league row rather than from a second request of the same endpoint.
  const { league, teams, viewerTeamId, loading, error, refetch, updateLeague } = useLeague(leagueId);
  const [keepers, setKeepers] = useState([]);
  const [keeperCandidates, setKeeperCandidates] = useState([]);
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
      setKeeperDataError(readHttpFailure(requestError).message || requestError?.message || 'Request failed');
    } finally {
      setKeeperDataLoading(false);
    }
  }, [leagueId]);
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
    // refetch() invalidates the shared league entry itself, so every mount on
    // this league reloads from the one request it starts. Its promise settles
    // once the league (and so the teams, which ride on the same payload) is
    // back on screen, which is what saveLeague awaits before it stops showing
    // itself as saving, and what saveKeeperSettings awaits before clearing the
    // keeper dirty flags. The tab's own dirty flag is cleared off the PUT
    // response, ahead of this reload.
    const requests = [refetch()];
    if (includeKeeperData) requests.push(loadKeeperData());
    await Promise.all(requests);
  }, [loadKeeperData, refetch, tab]);
  const saveLeague = async (payload, message, { reloadKeeperData = tab === 'keepers', clearDirty = true } = {}) => {
    setSaving(true);
    try {
      let response;
      try {
        response = await apiClient.put(`/api/league/${leagueId}`, payload);
      } catch (requestError) {
        failure(notify, requestError);
        return { success: false, error: readHttpFailure(requestError).message || requestError?.message || 'Request failed' };
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
      return { success: false, error: readHttpFailure(requestError).message || requestError?.message || 'Request failed' };
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
      return { success: false, error: readHttpFailure(requestError).message || requestError?.message || 'Request failed' };
    } finally { setSaving(false); }
  };

  if (loading && !league) return <PageRoot><Skel width="100%" height={50} /><Box sx={{ mt: 2 }}><Skel width="100%" height={420} /></Box></PageRoot>;
  if (error && !league) return <PageRoot><LoadError title="We could not load league settings." retry="Retry league settings" onRetry={refetch} /></PageRoot>;
  if (!league) return null;
  // The same route guard as before, asked through the viewer-relative contract
  // (#113): the league names its creator's Team and the response root names
  // the reader's own, so no account id passes through the client.
  if (user?.id && !league.is_commissioner && !isLeagueCreator(league, viewerTeamId)) return <Navigate to={`/league/${leagueId}`} replace />;
  const frozen = league.draft_status !== 'pending';
  const common = { league, frozen, onSave: saveLeague, saving, onDirtyChange: setPanelDirty };
  // No teams guard below: teams ride on the league payload, so wherever league
  // is truthy the membership is already there, and a league that failed to
  // load is handled page-level above by 'Retry league settings'.
  let content;
  if (tab === 'type') content = <DraftTypePanel {...common} />;
  else if (tab === 'schedule') content = <SchedulePanel {...common} teamCount={teams.length} onStart={startNow} />;
  else if (tab === 'timer') content = <TimerPanel {...common} onSetClock={setClock} />;
  else if (tab === 'order') content = <DraftOrderPanel {...common} teams={teams} onSetOrder={setOrder} onRandomize={randomize} />;
  else if (tab === 'auction') content = league.draft_type === 'auction' ? <AuctionPanel {...common} teams={teams} /> : <Note>Select Salary-cap auction under Draft type to edit auction settings.</Note>;
  else if (tab === 'limits') content = <PositionLimitsPanel {...common} />;
  else if (tab === 'keepers') content = !keeperDataRequested || keeperDataLoading ? <Skel width="100%" height={260} /> : keeperDataError ? <LoadError title="We could not load keeper data." retry="Retry keeper data" onRetry={loadKeeperData} /> :<KeeperPanel league={league} teams={teams} keepers={keepers} keeperCandidates={keeperCandidates} frozen={frozen} saving={saving} onSaveLeague={saveKeeperSettings} onSaveKeepers={saveKeepers} onSettingsDirtyChange={setKeeperSettingsDirty} onAssignmentsDirtyChange={setKeeperAssignmentsDirty} />;
  else content = <ReadinessPanel teams={teams} draftType={league.draft_type} />;
  const refreshError = error && (
    <Box sx={{ mb: 2 }}><LoadError title="We could not refresh league settings." retry="Retry league settings" onRetry={refetch} /></Box>
  );
  return (
    <PageRoot>
      <LeagueBreadcrumb />
      <PixelHeading id="draft-settings-h1" level={1}>Draft Settings</PixelHeading>
      <Dim sx={{ mb: 3 }}>{league.name}</Dim>
      {refreshError}
      {frozen && <Box sx={{ mb: 2 }}><Note>Draft setup is locked after the draft starts. The Timer tab remains available while a draft is active.</Note></Box>}
      <Frame component="div" tier="rule" sx={{ minWidth: 0, padding: { xs: '12px', sm: '20px' } }}>
        <Tabs aria-label="Draft settings sections" value={tab} onChange={(event, value) => changeTab(value)} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile TabIndicatorProps={{ sx: { display: 'none' } }} sx={{ mb: 2, minHeight: '44px', '& .MuiTab-root': { ...TARGET_SX, borderRadius: 0, border: '2px solid var(--ps-dim)', marginRight: '-2px', color: 'var(--ps-ink)', fontFamily: 'inherit', fontWeight: 600, textTransform: 'none' }, '& .MuiTab-root.Mui-selected': { backgroundColor: 'var(--ps-play)', color: 'var(--ps-play-ink)', borderColor: 'var(--ps-play)', position: 'relative', zIndex: 1 } }}>
          {TAB_ITEMS.map(([value, label]) => <Tab key={value} value={value} label={<Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>{value === tab ? <PixelArrow /> : null}{label}</Box>} id={tabId(value)} aria-controls={panelId(value)} />)}
        </Tabs>
        {activeTabDirty && <Box role="status" data-testid="draft-settings-unsaved" sx={{ mb: 2, fontSize: '14px', fontWeight: 600, color: 'var(--ps-ink)' }}>Unsaved changes</Box>}
        <Box role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)}>{content}</Box>
      </Frame>
    </PageRoot>
  );
}
