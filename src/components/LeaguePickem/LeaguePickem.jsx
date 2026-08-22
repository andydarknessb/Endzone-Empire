import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import apiClient from '../../api/apiClient';
import { useLeague } from '../../hooks/useLeague';
import { isPickemOnly } from '../../lib/leagueType';
import { clearPickemStandingsCache } from '../../hooks/usePickemStandings';
import { setPickemSettings, usePickemSettings } from '../../hooks/usePickemSettings';
import LeagueBreadcrumb from '../LeagueBreadcrumb/LeagueBreadcrumb';
import usePickemWeek from './usePickemWeek';
import PickemWeekBoard from './PickemWeekBoard';
import PickemStandings from './PickemStandings';
import PickemSettingsPanel from './PickemSettingsPanel';

const REG_SEASON_WEEKS = 18;
const WEEKS = Array.from({ length: REG_SEASON_WEEKS }, (unused, index) => index + 1);

const TAB_ITEMS = [
  ['picks', 'Picks'],
  ['standings', 'Standings'],
];
const TAB_VALUES = TAB_ITEMS.map(([value]) => value);

const tabId = (value) => `league-pickem-tab-${value}`;
const panelId = (value) => `league-pickem-tabpanel-${value}`;

const errorMessage = (error) =>
  error?.response?.data?.error || error?.message || 'Request failed';

const clampWeek = (value) =>
  Math.min(Math.max(Number(value) || 1, 1), REG_SEASON_WEEKS);

/**
 * League Pick'em — pick every NFL game, every week, against your league.
 *
 * The tab lives in the URL (same convention as LeagueRules) so a manager can
 * link straight to the standings. Week selection defaults to the league's own
 * current week, clamped into the regular season.
 */
export default function LeaguePickem() {
  const { leagueId } = useParams();
  const { league, loading: leagueLoading, error: leagueError, refetch } = useLeague(leagueId);

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const tab = TAB_VALUES.includes(requestedTab) ? requestedTab : 'picks';
  const setTab = (value) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', value);
    setSearchParams(next, { replace: true });
  };

  // Unsaved-picks guard: the board's local pick map is the only copy of an
  // unsaved change, and switching week or tab replaces the board. When dirty,
  // the navigation is parked here until the user confirms the discard.
  const [boardDirty, setBoardDirty] = useState(false);
  const [pendingNav, setPendingNav] = useState(null); // { type: 'week'|'tab', value }
  const onDirtyChange = useCallback((value) => setBoardDirty(value), []);

  const requestTab = (value) => {
    if (boardDirty && value !== tab) {
      setPendingNav({ type: 'tab', value });
      return;
    }
    setTab(value);
  };

  // The settings row is shared with the rules view of a pick'em-only league,
  // and a save here writes the server's answer through to both, so neither
  // screen fetches it twice in one visit.
  const { settings, error: settingsError, refetch: reloadSettings } = usePickemSettings(leagueId);
  const [settingsSaveError, setSettingsSaveError] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const [week, setWeek] = useState(null);
  useEffect(() => {
    if (week != null || !league) return;
    setWeek(clampWeek(league.current_week));
  }, [league, week]);

  const requestWeek = (value) => {
    if (boardDirty && value !== week) {
      setPendingNav({ type: 'week', value });
      return;
    }
    setWeek(value);
  };

  const confirmDiscard = () => {
    if (!pendingNav) return;
    if (pendingNav.type === 'week') setWeek(pendingNav.value);
    else setTab(pendingNav.value);
    setBoardDirty(false);
    setPendingNav(null);
  };

  const enabled = Boolean(settings && settings.enabled);
  const { data, loading, error, reload, saving, saveError, savePicks } = usePickemWeek(
    leagueId,
    week,
    { enabled: enabled && week != null }
  );

  const handleSaveSettings = async (patch) => {
    setSavingSettings(true);
    setSettingsSaveError(null);
    try {
      const res = await apiClient.put(`/api/pickem/league/${leagueId}/settings`, patch);
      // Write-through: the saved row reaches this page and the rules view with
      // no follow-up request.
      setPickemSettings(leagueId, res.data);
      // The standings body names the mode in force: a mode change must not
      // leave a cached table captioned with the old one.
      clearPickemStandingsCache(leagueId);
    } catch (requestError) {
      setSettingsSaveError(errorMessage(requestError));
    } finally {
      setSavingSettings(false);
    }
  };

  if (leagueLoading && !league) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Skeleton height={50} />
        <Skeleton variant="rounded" height={420} />
      </Container>
    );
  }
  if (leagueError && !league) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert
          severity="error"
          action={<Button color="inherit" size="small" onClick={refetch}>Retry league</Button>}
        >
          Unable to load this league: {leagueError}
        </Alert>
      </Container>
    );
  }

  const header = (
    <>
      <LeagueBreadcrumb name={league && league.name} />
      <Typography variant="h4" sx={{ mb: 0.5 }}>Pick&apos;em</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Pick the winner of every NFL game. Picks lock at kickoff, and everyone&apos;s
        picks are revealed game by game as they do.
      </Typography>
    </>
  );

  if (settingsError) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        {header}
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={reloadSettings}>
              Retry
            </Button>
          }
        >
          Unable to load Pick&apos;em: {settingsError}
        </Alert>
      </Container>
    );
  }

  // Settings unknown: the skeleton stands in for the whole page. Once a row is
  // in hand a background reload keeps it on screen rather than flashing this
  // skeleton again, which is why loading is not part of the condition.
  if (!settings) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        {header}
        <Skeleton variant="rounded" height={360} />
      </Container>
    );
  }

  if (!enabled) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        {header}
        {settings.isCommissioner ? (
          <PickemSettingsPanel
            settings={settings}
            saving={savingSettings}
            error={settingsSaveError}
            onSave={handleSaveSettings}
            lockedOn={isPickemOnly(league)}
          />
        ) : (
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>Pick&apos;em is turned off</Typography>
            <Typography variant="body2" color="text.secondary">
              Your commissioner hasn&apos;t enabled Pick&apos;em for this league yet. Ask them
              to switch it on and the whole league can start picking games.
            </Typography>
          </Paper>
        )}
      </Container>
    );
  }

  let content;
  if (tab === 'standings') {
    // The league row already names the season, so the standings never need a
    // season-less first request while the week view is still loading.
    content = (
      <PickemStandings
        leagueId={leagueId}
        season={(league && league.current_season) || (data && data.season)}
        week={week}
      />
    );
  } else if (error) {
    content = (
      <Alert
        severity="error"
        action={<Button color="inherit" size="small" onClick={reload}>Retry week</Button>}
      >
        Unable to load this week: {error}
      </Alert>
    );
  } else if (loading || !data) {
    content = <Skeleton variant="rounded" height={360} />;
  } else {
    content = (
      <PickemWeekBoard
        view={data}
        saving={saving}
        saveError={saveError}
        onSave={savePicks}
        onDirtyChange={onDirtyChange}
      />
    );
  }

  const weekIndex = WEEKS.indexOf(week);

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {header}

      {settings.isCommissioner && (
        <Accordion disableGutters sx={{ mb: 3 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-controls="pickem-settings-content">
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Commissioner settings</Typography>
          </AccordionSummary>
          <AccordionDetails id="pickem-settings-content" sx={{ pt: 0 }}>
            <PickemSettingsPanel
              settings={settings}
              saving={savingSettings}
              error={settingsSaveError}
              onSave={handleSaveSettings}
              embedded
              lockedOn={isPickemOnly(league)}
            />
          </AccordionDetails>
        </Accordion>
      )}

      <Paper sx={{ p: { xs: 1.5, sm: 2.5 } }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'stretch', sm: 'center' }}
          spacing={2}
          sx={{ mb: 2 }}
        >
          <Tabs
            aria-label="Pick'em sections"
            value={tab}
            onChange={(event, value) => requestTab(value)}
            selectionFollowsFocus
          >
            {TAB_ITEMS.map(([value, label]) => (
              <Tab key={value} value={value} label={label} id={tabId(value)} aria-controls={panelId(value)} />
            ))}
          </Tabs>

          {tab === 'picks' && week != null && (
            <Stack direction="row" spacing={0.5} alignItems="center">
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel id="pickem-week-label">Week</InputLabel>
                <Select
                  labelId="pickem-week-label"
                  label="Week"
                  value={week}
                  onChange={(event) => requestWeek(Number(event.target.value))}
                >
                  {WEEKS.map((value) => (
                    <MenuItem key={value} value={value}>
                      {league && clampWeek(league.current_week) === value
                        ? `Week ${value} · current`
                        : `Week ${value}`}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <IconButton
                aria-label="Previous week"
                onClick={() => requestWeek(WEEKS[weekIndex - 1])}
                disabled={weekIndex <= 0}
              >
                <ChevronLeftIcon />
              </IconButton>
              <IconButton
                aria-label="Next week"
                onClick={() => requestWeek(WEEKS[weekIndex + 1])}
                disabled={weekIndex < 0 || weekIndex >= WEEKS.length - 1}
              >
                <ChevronRightIcon />
              </IconButton>
            </Stack>
          )}
        </Stack>

        <Box role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)}>
          {content}
        </Box>
      </Paper>

      <Dialog open={pendingNav != null} onClose={() => setPendingNav(null)}>
        <DialogTitle>Discard unsaved picks?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            You have picks on this week that haven&apos;t been saved. Leaving now throws them away.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingNav(null)}>Keep editing</Button>
          <Button color="error" onClick={confirmDiscard}>Discard picks</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
