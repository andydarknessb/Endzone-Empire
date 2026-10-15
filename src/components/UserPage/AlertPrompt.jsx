import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { Box } from '@mui/material';
import { readHttpFailure } from '../../lib/httpFailure';
import { deriveLeaguePhase, LEAGUE_PHASE } from '../../shared/lib/leaguePhase';
import {
  fetchPushPublicKey, getCurrentSubscription, isPushSupported, needsHomeScreenInstall, subscribeToPush,
} from '../../utils/push';
import { Frame, HomeButton, PixelHeading } from './home';
import { readAlertPromptDismissal, writeAlertPromptDismissal } from './alertPromptDismissal';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Does the Manager have a team in a league whose season is still running?
 * The finished phase is 'complete' (LEAGUE_PHASE.COMPLETE, the value the
 * server's homeStatus puts in `status.phase`); a row without a status yet is
 * judged from its raw columns.
 */
export function hasLiveTeam(leagues) {
  return (leagues || []).some((league) => league.my_team_id
    && (league.status ? league.status.phase : deriveLeaguePhase(league)) !== LEAGUE_PHASE.COMPLETE);
}

/**
 * Does the stored dismissal hide the card right now? The first dismissal hides
 * it for seven days, the second for good.
 */
export function dismissalHides(dismissal, now) {
  const { count = 0, at = 0 } = dismissal || {};
  return count >= 2 || (count === 1 && now - at < WEEK_MS);
}

/**
 * Which Alert prompt state to show: 'hidden', 'default', 'install' or
 * 'blocked'. Pure: every browser and storage read is passed in.
 * `dismissal` is `{ count, at }` (at in ms); the first dismissal hides the card
 * for seven days, the second for good.
 */
export function alertPromptState({
  leagues, supported, publicKey, subscribed, permission, installHint, dismissal, now,
}) {
  if (!hasLiveTeam(leagues) || !publicKey) return 'hidden';
  if (dismissalHides(dismissal, now)) return 'hidden';
  if (installHint) return 'install';
  if (!supported || subscribed) return 'hidden';
  return permission === 'denied' ? 'blocked' : 'default';
}

const COPY = {
  default: {
    title: 'Get alerts on this device',
    body: 'Score changes, big plays and lineup problems, delivered to this device even when the app is closed.',
  },
  install: {
    title: 'Add to your Home Screen for alerts',
    body: 'Tap Share, then Add to Home Screen. Open Endzone Empire from there and this card will offer the switch.',
  },
  blocked: {
    title: null,
    body: 'Notifications are blocked for this site. Allow them in your browser settings to get alerts.',
  },
};

// A missing Notification (jsdom, old browsers) is not blocked.
const readPermission = () => (typeof Notification !== 'undefined' ? Notification.permission : undefined);

/**
 * Home "Alert prompt" (CONTEXT.md, Push alerts): asks a Manager with a live
 * team to allow Push alerts on this device. `leagues` are the /api/league rows
 * Home already holds.
 */
function AlertPrompt({ leagues }) {
  const supported = isPushSupported();
  const installHint = needsHomeScreenInstall();
  const live = hasLiveTeam(leagues);
  const [publicKey, setPublicKey] = useState(null);
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState(readPermission);
  const [dismissal, setDismissal] = useState(readAlertPromptDismissal);
  const dismissed = dismissalHides(dismissal, Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!live || dismissed || !(supported || installHint)) return undefined;
    let cancelled = false;
    (async () => {
      try {
        // The local subscription check costs no request, so it goes first: only
        // an eligible, unsubscribed, undismissed device asks for the key.
        const subscription = supported ? await getCurrentSubscription() : null;
        if (subscription) {
          if (!cancelled) setSubscribed(true);
          return;
        }
        const key = await fetchPushPublicKey();
        if (!cancelled) {
          setSubscribed(false);
          setPublicKey(key);
        }
      } catch {
        // No key means no card: the prompt stays hidden.
      }
    })();
    return () => { cancelled = true; };
  }, [live, dismissed, supported, installHint]);

  const state = alertPromptState({
    leagues, supported, publicKey, subscribed, permission, installHint, dismissal, now: Date.now(),
  });
  if (state === 'hidden') return null;

  const enable = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await subscribeToPush(publicKey);
      setSubscribed(true);
    } catch (err) {
      setPermission(readPermission());
      setError(readHttpFailure(err).message || err.message || 'Failed to enable push notifications');
    } finally {
      setBusy(false);
    }
  };

  const notNow = () => {
    const next = { count: dismissal.count + 1, at: Date.now() };
    writeAlertPromptDismissal(next);
    setDismissal(next);
  };

  const { title, body } = COPY[state];
  return (
    <Frame
      labelledBy={title ? 'alert-prompt-heading' : undefined}
      // The blocked variant has no visible heading to point at.
      aria-label={title ? undefined : 'Alerts on this device'}
      data-testid="alert-prompt"
      sx={{
        flexShrink: 0,
        display: 'flex',
        flexDirection: { xs: 'column', md: 'row' },
        flexWrap: 'wrap',
        alignItems: { xs: 'stretch', md: 'center' },
        justifyContent: 'space-between',
        gap: { xs: '12px', md: '16px' },
        padding: { xs: '14px', md: '16px 20px' },
      }}
    >
      <Box sx={{ maxWidth: '640px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {title && <PixelHeading id="alert-prompt-heading" size={16}>{title}</PixelHeading>}
        <Box component="p" sx={{ m: 0, fontSize: '15px', color: 'var(--home-dim)' }}>{body}</Box>
        {error && state !== 'blocked' && (
          <Box role="alert" sx={{ border: '2px solid var(--home-danger)', padding: '8px 12px', fontSize: '15px' }}>{error}</Box>
        )}
      </Box>
      {state !== 'blocked' && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {state === 'default' && (
            <HomeButton variant="ghost" onClick={enable} disabled={busy}>Turn on alerts</HomeButton>
          )}
          <HomeButton variant="quiet" onClick={notNow} ariaLabel="Not now, hide the alerts offer">Not now</HomeButton>
        </Box>
      )}
    </Frame>
  );
}

AlertPrompt.propTypes = {
  leagues: PropTypes.arrayOf(PropTypes.shape({
    my_team_id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    status: PropTypes.shape({ phase: PropTypes.string }),
  })),
};

export default AlertPrompt;
