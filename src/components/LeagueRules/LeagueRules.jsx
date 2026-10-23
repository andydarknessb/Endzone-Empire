import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Box } from '@mui/material';
import apiClient from '../../api/apiClient';
import { useLeague } from '../../hooks/useLeague';
import { isPickemOnly } from '../../shared/lib/leagueType';
import { readHttpFailure } from '../../lib/httpFailure';
import LeagueBreadcrumb from '../LeagueBreadcrumb/LeagueBreadcrumb';
import { ErrorPanel, Skel } from '../../shared/ui/playselect/Controls';
import { Frame, PixelHeading } from '../../shared/ui/playselect/Frame';
import { PixelArrow } from '../../shared/ui/playselect/Icons';
import { psRootSx } from '../../shared/ui/playselect/root';
import '../../shared/ui/playselect/playselect.css';
import { Dim } from './rulesParts';
import LeagueOfficials from './LeagueOfficials';
import ScoringRulesView from './ScoringRulesView';
import RosterRulesView from './RosterRulesView';
import WaiverTradeRulesView from './WaiverTradeRulesView';
import PlayoffRulesView from './PlayoffRulesView';
import PickemRulesView from './PickemRulesView';

const TAB_ITEMS = [
  ['scoring', 'Scoring'],
  ['roster', 'Roster'],
  ['waivers', 'Waivers & Trades'],
  ['playoffs', 'Playoffs & Season'],
];
const TAB_VALUES = TAB_ITEMS.map(([value]) => value);

const tabId = (value) => `league-rules-tab-${value}`;
const panelId = (value) => `league-rules-tabpanel-${value}`;

function Shell({ children }) {
  return (
    <Box className="ps-root" sx={{ ...psRootSx, minHeight: '100%' }}>
      <Box
        data-testid="league-rules"
        sx={{
          maxWidth: '1280px',
          marginX: 'auto',
          boxSizing: 'border-box',
          padding: { xs: '14px 16px 48px', sm: '24px 32px 64px' },
          display: 'flex',
          flexDirection: 'column',
          gap: { xs: '16px', sm: '24px' },
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

// The rule book's sections as a real tablist in the Trade Center's segmented look: the selected tab is Play blue,
// carries the one tab stop, and the arrow keys move and activate it.
function RulesTabs({ value, onChange }) {
  const move = (event, index) => {
    const last = TAB_ITEMS.length - 1;
    let next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = last;
    if (next === null) return;
    event.preventDefault();
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next].focus();
    onChange(TAB_ITEMS[next][0]);
  };
  return (
    <Box
      role="tablist"
      aria-label="League rules sections"
      sx={{ display: 'flex', flexWrap: 'wrap', p: '2px', mb: '24px' }}
    >
      {TAB_ITEMS.map(([tabValue, label], index) => {
        const on = tabValue === value;
        return (
          <Box
            key={tabValue}
            component="button"
            type="button"
            role="tab"
            id={tabId(tabValue)}
            aria-selected={on}
            aria-controls={panelId(tabValue)}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(tabValue)}
            onKeyDown={(event) => move(event, index)}
            sx={{
              flex: { xs: '1 1 45%', sm: 'none' },
              minHeight: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              px: '16px',
              mb: '-2px',
              ml: { sm: index ? '-2px' : 0 },
              boxSizing: 'border-box',
              border: `2px solid ${on ? 'var(--ps-play)' : 'var(--ps-ink)'}`,
              borderRadius: 0,
              font: 'inherit',
              fontSize: '15px',
              fontWeight: 600,
              cursor: 'pointer',
              color: on ? 'var(--ps-play-ink)' : 'var(--ps-ink)',
              backgroundColor: on ? 'var(--ps-play)' : 'transparent',
              ...(on ? { position: 'relative', zIndex: 1 } : null),
            }}
          >
            {on ? <PixelArrow /> : null}
            {label}
          </Box>
        );
      })}
    </Box>
  );
}

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

  // The scoring defaults wait for the league row: a pick'em-only league has no
  // scoring rules, so the request is skipped rather than made and ignored.
  // (The dashboard reads the same useLeague entry, so the row is normally
  // already in hand when this page mounts and nothing is serialized.)
  const pickemOnly = isPickemOnly(league);
  const leagueKnown = !!league;
  useEffect(() => {
    if (!leagueKnown || pickemOnly) return undefined;
    let active = true;
    setDefaultsError(null);
    apiClient
      .get('/api/scoring/rules')
      .then((res) => { if (active) setDefaults(res.data.defaults); })
      .catch((requestError) => {
        if (active) setDefaultsError(readHttpFailure(requestError).message || requestError.message || 'Request failed');
      });
    return () => { active = false; };
  }, [defaultsReload, leagueKnown, pickemOnly]);

  if (loading && !league) {
    return (
      <Shell>
        <Box aria-busy="true" sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Skel width="200px" height={48} />
          <Skel width="100%" height={420} />
        </Box>
      </Shell>
    );
  }
  if (error && !league) {
    return (
      <Shell>
        <ErrorPanel
          title="League rules"
          body={'We could not load the league rules.'}
          onRetry={refetch}
          retryAriaLabel="Try again to load league rules"
        />
      </Shell>
    );
  }
  if (!league) return null;

  // A pick'em-only league has no scoring rules, roster, waivers or playoffs:
  // its whole rulebook is one page. The route stays (the nav tile and any
  // bookmark still resolve) but never shows an empty fantasy rulebook.
  let content;
  if (pickemOnly) {
    content = <PickemRulesView league={league} />;
  } else if (tab === 'scoring') {
    if (defaultsError) {
      content = (
        <ErrorPanel
          title="Scoring rules"
          body={'We could not load the scoring rules.'}
          onRetry={() => setDefaultsReload((n) => n + 1)}
          retryAriaLabel="Try again to load scoring rules"
        />
      );
    } else if (!defaults) {
      content = <Skel width="100%" height={360} />;
    } else {
      content = <ScoringRulesView league={league} defaults={defaults} />;
    }
  } else if (tab === 'roster') content = <RosterRulesView league={league} />;
  else if (tab === 'waivers') content = <WaiverTradeRulesView league={league} />;
  else content = <PlayoffRulesView league={league} />;

  return (
    <Shell>
      <Box>
        <LeagueBreadcrumb name={league.name} />
        <PixelHeading level={1}>League Rules</PixelHeading>
        <Dim sx={{ mt: '8px' }}>
          {league.name} · view only. Only the commissioner can change these settings.
        </Dim>
      </Box>
      <LeagueOfficials league={league} />
      {error && (
        <ErrorPanel
          title="League rules"
          body={'We could not refresh the league rules.'}
          onRetry={refetch}
          retryAriaLabel="Try again to load league rules"
        />
      )}
      <Frame tier="rule" sx={{ p: { xs: '12px', sm: '20px' } }}>
        {pickemOnly ? (
          content
        ) : (
          <>
            <RulesTabs value={tab} onChange={setTab} />
            <Box role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)}>{content}</Box>
          </>
        )}
      </Frame>
    </Shell>
  );
}
