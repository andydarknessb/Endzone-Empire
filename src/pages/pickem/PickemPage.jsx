import React, { useRef, useState } from 'react';
import { Link as RouterLink, useParams, useSearchParams } from 'react-router-dom';
import {
  Box,
  Button,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Link,
  Typography,
} from '@mui/material';
import { Card, SegmentedControl, Skeleton } from '../../shared/ui';
import { useLeague } from '../../hooks/useLeague';
import { isPickemOnly } from '../../lib/leagueType';
import { readHttpFailure } from '../../lib/httpFailure';
import apiClient from '../../api/apiClient';
import { setPickemSettings, usePickemSettings } from '../../entities/pickem-game';
import { clearPickemStandingsCache } from '../../entities/pickem-standings';
import PickemBoard from '../../widgets/pickem-board';
import PickemStandings from '../../widgets/pickem-standings';
import CommissionerPanel from '../../widgets/pickem-settings';

const TAB_ITEMS = [
  ['picks', 'Picks'],
  ['standings', 'Standings'],
];
const TAB_VALUES = TAB_ITEMS.map(([value]) => value);

/**
 * The Pick'em page slice (#1267, ADR 0038), on the existing
 * `/league/:leagueId/pickem` route in place of the legacy page component
 * under `src/components` (deleted with this ticket, no shim, the ruling on
 * #1246). Composes `widgets/pickem-board`, `widgets/pickem-standings` and
 * `widgets/pickem-settings`, each reading only `entities` and `shared` (ADR
 * 0020/0029); the page itself reaches `entities/pickem-game`'s
 * `usePickemSettings` directly for the one thing both the layout (enabled?
 * commissioner?) and the settings widget need, the same "page owns the value
 * two slices both need" rule `pages/lineup` already follows.
 *
 * Section lives in the URL (`?tab=`, the deleted legacy page's own
 * precedent) so a manager can link straight to Standings.
 *
 * The unsaved-picks guard: `pickem-board` still owns its own week state (ADR
 * 0038, `useBoardPresenter`'s own docblock), so this page never lifts it -
 * it only listens. `onDirtyChange` mirrors the board's draft dirty flag out
 * to `boardDirty`, and `onRequestWeekChange` lets the board ask before
 * switching weeks; both a week change and a Standings tab switch while dirty
 * are parked behind the same confirmation dialog the deleted legacy page
 * used.
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

  const [boardDirty, setBoardDirty] = useState(false);
  const [pendingNav, setPendingNav] = useState(null); // { apply, cancel }

  // The section switch is `shared/ui/SegmentedControl`'s own roving-focus
  // radiogroup: an arrow key moves DOM focus onto the neighbour segment
  // BEFORE reporting it (SegmentedControl.jsx's own composer contract - "a
  // controlled group must let the arrow keys move the selection, as APG
  // requires"). Denying the value here (as this guard does while dirty)
  // still lets focus land on the now-unchecked segment; `cancel` below is
  // what restores it to the segment that is actually still checked, once
  // "Keep editing" (or Escape/backdrop) closes the dialog with nothing
  // applied. `sectionsRef` is the SegmentedControl's own forwarded ref (the
  // `role="radiogroup"` node).
  const sectionsRef = useRef(null);
  const focusCheckedSection = () => {
    sectionsRef.current?.querySelector('[role="radio"][aria-checked="true"]')?.focus();
  };

  const requestTab = (value) => {
    if (boardDirty && value !== tab) {
      setPendingNav({ apply: () => setTab(value), cancel: focusCheckedSection });
      return;
    }
    setTab(value);
  };

  // `pickem-board`'s own week stepper is the same SegmentedControl shape
  // (`features/pick-week`), so the board hands back a matching `cancel`
  // alongside `apply` - it owns the ref into its own week control, this
  // page only decides whether to gate the change.
  const handleRequestWeekChange = (nextWeek, { apply, cancel }) => {
    if (boardDirty) {
      setPendingNav({ apply, cancel });
      return;
    }
    apply();
  };

  // usePickemWeek (entities/pickem-game) cannot clear the standings cache
  // itself (entities/pickem-standings): sibling entities do not import each
  // other (ADR 0029). This page composes both, so it does the invalidation
  // here, only on an actual save (a PICKEM_LOCKED rejection saved nothing).
  const handleBoardSaved = (result) => {
    if (result?.ok) clearPickemStandingsCache(leagueId);
  };

  const confirmDiscard = () => {
    if (!pendingNav) return;
    pendingNav.apply();
    setBoardDirty(false);
    setPendingNav(null);
  };

  // "Keep editing" (or Escape/backdrop): nothing applied, so the segment
  // that is still checked needs DOM focus back - MUI's own restore-focus
  // already ran by the time the Dialog is done closing, so this call (one
  // frame later) is the one that wins.
  const cancelNav = () => {
    const cancel = pendingNav?.cancel;
    setPendingNav(null);
    if (cancel) requestAnimationFrame(cancel);
  };

  const { settings, error: settingsError, refetch: reloadSettings } = usePickemSettings(leagueId);
  const [settingsSaveError, setSettingsSaveError] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const handleSaveSettings = async (patch) => {
    setSavingSettings(true);
    setSettingsSaveError(null);
    try {
      const res = await apiClient.put(`/api/pickem/league/${leagueId}/settings`, patch);
      // Write-through: the saved row reaches this page (and the League Rules
      // read-only view) with no follow-up request.
      setPickemSettings(leagueId, res.data);
      // The standings body names the mode in force (formal review f3, the
      // deleted legacy page's own rule): a mode change must not leave a
      // cached table captioned with the old one.
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
  if (leagueError && !league) {
    body = (
      <ErrorNotice message={`Unable to load this league: ${leagueError}`} onRetry={refetch} retryLabel="Retry league" />
    );
  } else if (settingsError) {
    body = (
      <ErrorNotice message={`Unable to load Pick'em: ${settingsError}`} onRetry={reloadSettings} retryLabel="Retry" />
    );
  } else if ((leagueLoading && !league) || !settings) {
    body = (
      <Box sx={{ display: 'grid', gap: 2 }} aria-busy="true" data-testid="pickem-page-loading">
        <Skeleton height={360} />
      </Box>
    );
  } else {
    // The commissioner panel renders at this same tree position whether
    // Pick'em is on or off, so flipping the switch (which flips `enabled`)
    // never unmounts it: React reconciles the same element type in place
    // and only its props change. An earlier version branched the whole body
    // on `enabled`, which put the panel on two different branches of a
    // ternary - a real unmount/remount that dropped the just-toggled
    // Switch's own focus to `<body>` with no warning (accessibility risk
    // review, #1267).
    body = (
      <>
        {settings.isCommissioner && (
          <Box sx={{ mb: 2 }}>
            <CommissionerPanel
              settings={settings}
              saving={savingSettings}
              error={settingsSaveError}
              onSave={handleSaveSettings}
              lockedOn={isPickemOnly(league)}
            />
          </Box>
        )}

        {!enabled ? (
          !settings.isCommissioner && (
            <Card title="Pick&apos;em is off" data-testid="pickem-disabled">
              <Box sx={{ p: 2.25 }}>
                <Typography sx={{ fontSize: '13px', color: 'var(--dash-dim)' }}>
                  Your commissioner hasn&apos;t enabled Pick&apos;em for this league yet. Ask them to
                  switch it on and the whole league can start picking games.
                </Typography>
              </Box>
            </Card>
          )
        ) : (
          <>
            <Box sx={{ mb: 2 }}>
              <SegmentedControl
                ref={sectionsRef}
                aria-label="Pick'em sections"
                data-testid="pickem-sections"
                value={tab}
                onChange={requestTab}
                options={TAB_ITEMS.map(([value, label]) => ({ value, label }))}
              />
            </Box>

            {tab === 'picks' ? (
              <Box>
                {/* pickem-board's own kickoff-window sections are h3 (ADR
                    0038, a page composes it): this h2 is the heading
                    between them and the page's own h1, so the order never
                    skips a level (AC4). */}
                <Typography
                  component="h2"
                  sx={{
                    m: 0,
                    mb: 1.5,
                    fontFamily: 'var(--dash-font-display)',
                    fontSize: '17px',
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--dash-ink)',
                  }}
                >
                  Picks
                </Typography>
                <PickemBoard
                  leagueId={leagueId}
                  onDirtyChange={setBoardDirty}
                  onRequestWeekChange={handleRequestWeekChange}
                  onSaved={handleBoardSaved}
                />
              </Box>
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
      <Breadcrumb leagueId={leagueId} leagueName={league && league.name} />

      <Box sx={{ mb: 2 }}>
        <Typography
          component="h1"
          sx={{
            m: 0,
            fontFamily: 'var(--dash-font-display)',
            fontSize: { xs: '30px', sm: '36px' },
            fontWeight: 700,
            letterSpacing: '0.02em',
            lineHeight: 1.05,
            textTransform: 'uppercase',
            color: 'var(--dash-ink)',
          }}
        >
          Pick&apos;em
        </Typography>
        <Typography sx={{ fontSize: '13px', color: 'var(--dash-faint)', mt: '4px' }}>
          Pick the winner of every NFL game. Picks lock at kickoff, and everyone&apos;s picks are
          revealed game by game as they do.
        </Typography>
      </Box>

      {body}

      <Dialog
        open={pendingNav != null}
        onClose={cancelNav}
        aria-labelledby="pickem-discard-title"
        aria-describedby="pickem-discard-description"
      >
        <DialogTitle id="pickem-discard-title">Discard unsaved picks?</DialogTitle>
        <DialogContent>
          <DialogContentText id="pickem-discard-description">
            You have picks on this week that haven&apos;t been saved. Leaving now throws them away.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={cancelNav}>Keep editing</Button>
          <Button color="error" onClick={confirmDiscard}>Discard picks</Button>
        </DialogActions>
      </Dialog>
    </Shell>
  );
}

function ErrorNotice({ message, onRetry, retryLabel }) {
  return (
    <Box
      role="alert"
      data-testid="pickem-page-error"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        p: 2,
        border: '1px solid var(--dash-line)',
        borderRadius: 'var(--dash-radius)',
        backgroundColor: 'var(--dash-surface)',
        color: 'var(--dash-ink)',
        fontSize: '13px',
      }}
    >
      <Box sx={{ flexGrow: 1 }}>{message}</Box>
      <Button size="small" variant="outlined" onClick={onRetry}>{retryLabel}</Button>
    </Box>
  );
}

/** The island's page frame: the `dash-*` token context plus the shared column. */
function Shell({ children }) {
  return (
    <Box
      sx={{
        backgroundColor: 'var(--dash-bg)',
        color: 'var(--dash-ink)',
        fontFamily: 'var(--dash-font-body)',
        minHeight: '100%',
      }}
    >
      <Container
        maxWidth="lg"
        data-testid="pickem-column"
        sx={{
          px: { xs: '14px', sm: '24px' },
          pt: { xs: '14px', sm: '24px' },
          pb: { xs: '32px', sm: '40px' },
        }}
      >
        {children}
      </Container>
    </Box>
  );
}

const CRUMB_LINK_SX = {
  color: 'var(--dash-faint)',
  textDecoration: 'none',
  '&:hover': { color: 'var(--dash-ink)', textDecoration: 'underline' },
  '&:focus-visible': { outline: '2px solid var(--focus-ring)', outlineOffset: 2 },
};

/** Leagues / <league name> / Pick'em, the same shape `pages/game-center` uses. */
function Breadcrumb({ leagueId, leagueName }) {
  return (
    <Box component="nav" aria-label="Breadcrumb" data-testid="pickem-breadcrumb" sx={{ mb: '18px' }}>
      <Box
        component="ol"
        role="list"
        sx={{
          listStyle: 'none',
          m: 0,
          p: 0,
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
          fontSize: '13px',
          color: 'var(--dash-faint)',
        }}
      >
        <Box component="li" sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Link component={RouterLink} to="/league" sx={CRUMB_LINK_SX}>
            Leagues
          </Link>
          <Box component="span" aria-hidden="true">/</Box>
        </Box>
        {leagueName && (
          <Box component="li" sx={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <Link
              component={RouterLink}
              to={`/league/${leagueId}`}
              sx={{ ...CRUMB_LINK_SX, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {leagueName}
            </Link>
            <Box component="span" aria-hidden="true">/</Box>
          </Box>
        )}
        <Box component="li" aria-current="page" sx={{ color: 'var(--dash-dim)' }}>
          Pick&apos;em
        </Box>
      </Box>
    </Box>
  );
}
