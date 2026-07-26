import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, Container, Paper, Skeleton, Tab, Tabs, Typography } from '@mui/material';
import apiClient from '../../api/apiClient';
import { useLeague } from '../../hooks/useLeague';
import LeagueBreadcrumb from '../LeagueBreadcrumb/LeagueBreadcrumb';
import LeagueOfficials from './LeagueOfficials';
import ScoringRulesView from './ScoringRulesView';
import RosterRulesView from './RosterRulesView';
import WaiverTradeRulesView from './WaiverTradeRulesView';
import PlayoffRulesView from './PlayoffRulesView';

const TAB_ITEMS = [
  ['scoring', 'Scoring'],
  ['roster', 'Roster'],
  ['waivers', 'Waivers & Trades'],
  ['playoffs', 'Playoffs & Season'],
];
const TAB_VALUES = TAB_ITEMS.map(([value]) => value);

const tabId = (value) => `league-rules-tab-${value}`;
const panelId = (value) => `league-rules-tabpanel-${value}`;

const errorMessage = (error) => error?.response?.data?.error || error?.message || 'Request failed';

// Read-only view of the league's rule book. Every member can see this; only
// the commissioner can change any of it (CommissionerTools on the dashboard).
export default function LeagueRules() {
  const { leagueId } = useParams();
  const { league, loading, error, refetch } = useLeague(leagueId);
  // The tab lives in the URL so a manager can link a teammate straight to the
  // rule under discussion (".../rules?tab=waivers").
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const tab = TAB_VALUES.includes(requestedTab) ? requestedTab : 'scoring';
  const setTab = (value) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', value);
    setSearchParams(next, { replace: true });
  };
  const [defaults, setDefaults] = useState(null);
  const [defaultsError, setDefaultsError] = useState(null);
  const [defaultsReload, setDefaultsReload] = useState(0);

  useEffect(() => {
    let active = true;
    setDefaultsError(null);
    apiClient
      .get('/api/scoring/rules')
      .then((res) => { if (active) setDefaults(res.data.defaults); })
      .catch((requestError) => { if (active) setDefaultsError(errorMessage(requestError)); });
    return () => { active = false; };
  }, [defaultsReload]);

  if (loading && !league) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Skeleton height={50} />
        <Skeleton variant="rounded" height={420} />
      </Container>
    );
  }
  if (error && !league) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert
          severity="error"
          action={<Button color="inherit" size="small" onClick={refetch}>Retry league rules</Button>}
        >
          Unable to load league rules: {error}
        </Alert>
      </Container>
    );
  }
  if (!league) return null;

  let content;
  if (tab === 'scoring') {
    if (defaultsError) {
      content = (
        <Alert
          severity="error"
          action={<Button color="inherit" size="small" onClick={() => setDefaultsReload((n) => n + 1)}>Retry scoring rules</Button>}
        >
          Unable to load scoring rules: {defaultsError}
        </Alert>
      );
    } else if (!defaults) {
      content = <Skeleton variant="rounded" height={360} />;
    } else {
      content = <ScoringRulesView league={league} defaults={defaults} />;
    }
  } else if (tab === 'roster') content = <RosterRulesView league={league} />;
  else if (tab === 'waivers') content = <WaiverTradeRulesView league={league} />;
  else content = <PlayoffRulesView league={league} />;

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <LeagueBreadcrumb name={league.name} />
      <Typography variant="h4" sx={{ mb: 0.5 }}>League Rules</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {league.name} · view only. Only the commissioner can change these settings.
      </Typography>
      <LeagueOfficials league={league} />
      {error && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={<Button color="inherit" size="small" onClick={refetch}>Retry league rules</Button>}
        >
          Unable to refresh league rules: {error}
        </Alert>
      )}
      <Paper sx={{ p: { xs: 1.5, sm: 2.5 } }}>
        <Tabs
          aria-label="League rules sections"
          value={tab}
          onChange={(event, value) => setTab(value)}
          selectionFollowsFocus
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          sx={{ borderBottom: '1px solid', borderColor: 'divider', mb: 3 }}
        >
          {TAB_ITEMS.map(([value, label]) => (
            <Tab key={value} value={value} label={label} id={tabId(value)} aria-controls={panelId(value)} />
          ))}
        </Tabs>
        <Box role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)}>{content}</Box>
      </Paper>
    </Container>
  );
}
