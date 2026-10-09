import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import {
  Alert, Button, Card, CardContent, Stack, Typography,
} from '@mui/material';
import { readHttpFailure } from '../../lib/httpFailure';
import { MIN_TOUCH_TARGET_SX } from '../../shared/lib/a11y';
import { deriveLeaguePhase, LEAGUE_PHASE } from '../../shared/lib/leaguePhase';
import {
  fetchPushPublicKey, getCurrentSubscription, isPushSupported, needsHomeScreenInstall, subscribeToPush,
} from '../../utils/push';
import {
  alertSx, dimSx, ghostButtonSx, panelSx, panelTitleSx, primaryButtonSx,
} from '../common/homeIslandSx';
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
    title: 'Get alerts on this phone',
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
    <Card
      component="section"
      variant="outlined"
      aria-labelledby={title ? 'alert-prompt-heading' : undefined}
      data-testid="alert-prompt"
      sx={{ ...panelSx, flexShrink: 0 }}
    >
      <CardContent>
        <Stack spacing={1.5}>
          {title && (
            <Typography id="alert-prompt-heading" variant="h6" component="h2" sx={panelTitleSx}>
              {title}
            </Typography>
          )}
          <Typography variant="body2" sx={{ ...dimSx, fontSize: '14px' }}>{body}</Typography>
          {state !== 'blocked' && (
            <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap">
              {state === 'default' && (
                <Button
                  variant="contained"
                  onClick={enable}
                  disabled={busy}
                  sx={{ ...primaryButtonSx, ...MIN_TOUCH_TARGET_SX }}
                >
                  Enable alerts
                </Button>
              )}
              <Button
                variant="outlined"
                onClick={notNow}
                disabled={busy}
                sx={{ ...ghostButtonSx, ...MIN_TOUCH_TARGET_SX }}
              >
                Not now
              </Button>
            </Stack>
          )}
          {error && state !== 'blocked' && <Alert severity="error" sx={alertSx('danger')}>{error}</Alert>}
        </Stack>
      </CardContent>
    </Card>
  );
}

AlertPrompt.propTypes = {
  leagues: PropTypes.arrayOf(PropTypes.shape({
    my_team_id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    status: PropTypes.shape({ phase: PropTypes.string }),
  })),
};

export default AlertPrompt;
