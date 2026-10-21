import React, { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Box, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { SegmentedControl } from '../../shared/ui';
import {
  Frame, FrameHead, PixelArrow, PixelHeading, PixelWarn, PsButton, PsLink, Skel, psRootSx,
} from '../../shared/ui/playselect';
import { useLeague } from '../../hooks/useLeague';
import { isPickemOnly } from '../../shared/lib';
import { readHttpFailure } from '../../lib/httpFailure';
import apiClient from '../../api/apiClient';
import { setPickemSettings, usePickemSettings } from '../../entities/pickem-game';
import { clearPickemStandingsCache, usePickemStandings } from '../../entities/pickem-standings';
import PickemBoard from '../../widgets/pickem-board';
import PickemStandings from '../../widgets/pickem-standings';
import CommissionerPanel from '../../widgets/pickem-settings';

const TAB_ITEMS = [
  ['picks', 'Picks'],
  ['standings', 'Standings'],
];
const TAB_VALUES = TAB_ITEMS.map(([value]) => value);

/**
 * The Pick'em page slice (#1267, ADR 0038), on the Play-select look since ADR 0067 wave 2 (spec
 * #2334; boards docs/design/league/Pickem*.dc.html), on the existing `/league/:leagueId/pickem`
 * route. Composes `widgets/pickem-board`, `widgets/pickem-standings` and `widgets/pickem-settings`,
 * each reading only `entities` and `shared` (ADR 0020/0029); the page itself reaches
 * `entities/pickem-game`'s `usePickemSettings` directly for the one thing both the layout (enabled?
 * commissioner?) and the settings widget need, the same "page owns the value two slices both need"
 * rule `pages/lineup` already follows.
 *
 * The head is the breadcrumb (the current page dropped below `sm`, the h1 says it), the Pixel h1 and
 * the page's own blurb. For a commissioner the settings row sits above the sections control. Section
 * (Picks / Standings) lives in the URL (`?tab=`) so a manager can link straight to Standings.
 *
 * Picks save the moment they are made (ADR 0067 wave 2), so there is no unsaved-picks guard: no
 * discard dialog gates a week change or a tab switch. The board's `onSaved` is how this page, the
 * composer of both `entities/pickem-game` and `entities/pickem-standings`, clears the standings cache
 * a save made stale (sibling entities do not import each other, ADR 0029).
 *
 * A commissioner's scoring mode is locked once anyone has picked this season (the server answers 409
 * PICKEM_MODE_LOCKED); the page reads that off the standings (`made` is each team's season pick
 * count) and hands it to the settings panel as `modeLocked`.
 */
export default function PickemPage() {
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

  // usePickemWeek (entities/pickem-game) cannot clear the standings cache itself
  // (entities/pickem-standings): sibling entities do not import each other (ADR 0029). This page
  // composes both, so it does the invalidation here, on every save that landed.
  const handleBoardSaved = () => clearPickemStandingsCache(leagueId);

  const { settings, error: settingsError, refetch: reloadSettings } = usePickemSettings(leagueId);
  const [settingsSaveError, setSettingsSaveError] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const isCommissioner = Boolean(settings && settings.isCommissioner);
  const { data: standingsData } = usePickemStandings(isCommissioner ? leagueId : null);
  const modeLocked = (standingsData?.standings || []).some((row) => (row.made || 0) > 0);

  const handleSaveSettings = async (patch) => {
    setSavingSettings(true);
    setSettingsSaveError(null);
    try {
      const res = await apiClient.put(`/api/pickem/league/${leagueId}/settings`, patch);
      // Write-through: the saved row reaches this page (and the League Rules read-only view) with no
      // follow-up request.
      setPickemSettings(leagueId, res.data);
      // The standings body names the mode in force (formal review f3, the deleted legacy page's own
      // rule): a mode change must not leave a cached table captioned with the old one.
      clearPickemStandingsCache(leagueId);
      return { ok: true };
    } catch (requestError) {
      setSettingsSaveError(readHttpFailure(requestError).message || requestError.message || 'Request failed');
      return { ok: false };
    } finally {
      setSavingSettings(false);
    }
  };

  const enabled = Boolean(settings && settings.enabled);

  let body;
  if ((leagueError && !league) || settingsError) {
    body = (
      <ErrorNotice
        message="We could not load this league. Check your connection and try again."
        onRetry={() => { refetch(); reloadSettings(); }}
      />
    );
  } else if ((leagueLoading && !league) || !settings) {
    body = <PageLoading />;
  } else {
    // The commissioner panel renders at this same tree position whether Pick'em is on or off, so
    // flipping the switch (which flips `enabled`) never unmounts it: React reconciles the same
    // element type in place and only its props change. An earlier version branched the whole body on
    // `enabled`, which put the panel on two different branches of a ternary - a real unmount/remount
    // that dropped the just-toggled switch's own focus to `<body>` with no warning (accessibility
    // risk review, #1267).
    body = (
      <>
        {settings.isCommissioner && (
          <CommissionerPanel
            settings={settings}
            saving={savingSettings}
            error={settingsSaveError}
            onSave={handleSaveSettings}
            lockedOn={isPickemOnly(league)}
            modeLocked={modeLocked}
          />
        )}

        {!enabled ? (
          !settings.isCommissioner && (
            <Frame tier="rule" labelledBy="pickem-off-heading" data-testid="pickem-disabled">
              <FrameHead>
                <PixelHeading id="pickem-off-heading">Pick&apos;em is off</PixelHeading>
              </FrameHead>
              <Box component="p" sx={{ m: 0, padding: '20px', fontSize: '15px', color: 'var(--ps-dim)', maxWidth: '640px', textWrap: 'pretty' }}>
                Your commissioner hasn&apos;t enabled Pick&apos;em for this league yet. Ask them to
                switch it on and the whole league can start picking games.
              </Box>
            </Frame>
          )
        ) : (
          <>
            <Box>
              <SegmentedControl
                aria-label="Pick'em sections"
                data-testid="pickem-sections"
                value={tab}
                onChange={setTab}
                options={TAB_ITEMS.map(([value, label]) => ({ value, label }))}
              />
            </Box>

            {tab === 'picks' ? (
              <PickemBoard leagueId={leagueId} onSaved={handleBoardSaved} />
            ) : (
              <PickemStandings leagueId={leagueId} />
            )}
          </>
        )}
      </>
    );
  }

  return (
    <Shell>
      <Box component="section" aria-labelledby="pickem-h1" sx={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
        <Breadcrumb leagueId={leagueId} leagueName={league && league.name} />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
          <PixelHeading id="pickem-h1" level={1}>Pick&apos;em</PixelHeading>
          <Box component="p" sx={{ m: 0, fontSize: { xs: '16px', sm: '17px' }, color: 'var(--ps-dim)', maxWidth: '760px', textWrap: 'pretty' }}>
            Pick the winner of every NFL game. Picks lock at kickoff, and everyone&apos;s picks are
            revealed game by game as they do.
          </Box>
        </Box>
      </Box>
      {body}
    </Shell>
  );
}

function PageLoading() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }} aria-busy="true" data-testid="pickem-page-loading">
      {[0, 1].map((index) => (
        <Frame key={index} tier="rule" component="div" head={<FrameHead><Skel width="180px" height={20} /></FrameHead>}>
          <Box sx={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <Skel width="100%" height={76} />
            <Skel width="100%" height={12} />
          </Box>
        </Frame>
      ))}
    </Box>
  );
}

function ErrorNotice({ message, onRetry }) {
  return (
    <Frame
      component="div"
      tone="danger"
      role="alert"
      data-testid="pickem-page-error"
      sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px 20px', padding: '16px 20px' }}
    >
      <Box sx={{ display: 'flex', gap: '12px', alignItems: 'center', minWidth: 0 }}>
        <PixelWarn color="var(--ps-danger)" />
        <Box component="span" sx={{ fontSize: '16px' }}>{message}</Box>
      </Box>
      <PsButton variant="ghost" onClick={onRetry}>Retry</PsButton>
    </Frame>
  );
}

/**
 * The page frame: the Play-select token context (Field ground, Ink text, the Archivo body face) on a
 * `.ps-root` element, which also scopes the focus ring, the cursor blink and the hover rules. A
 * column flex container, so a wide table inside a narrow viewport never pushes a frame sideways.
 */
function Shell({ children }) {
  return (
    <Box className="ps-root" sx={{ ...psRootSx, minHeight: '100%' }}>
      <Box
        data-testid="pickem-column"
        sx={{
          maxWidth: '1280px',
          marginX: 'auto',
          boxSizing: 'border-box',
          padding: { xs: '24px 16px 48px', sm: '24px 32px 64px' },
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

/**
 * Leagues / <league name> / Pick'em, the same shape `pages/game-center` uses, restyled: 44px links
 * with a pixel-arrow separator. Below `sm` the h1 says the page, so the trail ends at the league and
 * no trailing separator is left to wrap.
 */
function Breadcrumb({ leagueId, leagueName }) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const separator = (
    <Box component="span" aria-hidden="true" sx={{ color: 'var(--ps-dim)', display: 'inline-flex' }}>
      <PixelArrow />
    </Box>
  );
  const item = { display: 'flex', alignItems: 'center', minWidth: 0 };
  return (
    <Box component="nav" aria-label="Breadcrumb" data-testid="pickem-breadcrumb">
      <Box
        component="ol"
        sx={{ listStyle: 'none', margin: '0 0 0 -10px', padding: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}
      >
        <Box component="li" sx={item}>
          <PsLink to="/league">Leagues</PsLink>
          {(leagueName || !phone) && separator}
        </Box>
        {leagueName && (
          <Box component="li" sx={item}>
            <PsLink to={`/league/${leagueId}`}>{leagueName}</PsLink>
            {!phone && separator}
          </Box>
        )}
        {!phone && (
          <Box
            component="li"
            aria-current="page"
            sx={{ minHeight: '44px', display: 'inline-flex', alignItems: 'center', padding: '0 10px', fontSize: '15px', fontWeight: 600, color: 'var(--ps-dim)' }}
          >
            Pick&apos;em
          </Box>
        )}
      </Box>
    </Box>
  );
}
