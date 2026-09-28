import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Paper, TextField, Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import apiClient from '../../api/apiClient';
import { readHttpFailure } from '../../lib/httpFailure';
import { SCORING_PRESET_LABELS } from '../../lib/leagueRulesFormat';
import { JOIN_REFUSAL_REASON } from '../../shared/lib/leaguePhase';
import { isPickemOnly, shortLeagueTypeLabel } from '../../shared/lib/leagueType';
import { MIN_TOUCH_TARGET_SX } from '../../shared/lib/a11y';
import { useSnackbar } from '../Snackbar/SnackbarProvider';

// The preview's closed-joining note, keyed on the server's joinability reason.
// Same words as LeagueManagement's invite preview (JOIN_CLOSED_COPY there): a
// league with a fantasy side closes when its draft starts, a pick'em-only pool
// when its season is complete.
const JOIN_CLOSED_COPY = {
  [JOIN_REFUSAL_REASON.DRAFT_STARTED]: 'The draft has already started · joining is closed.',
  [JOIN_REFUSAL_REASON.SEASON_COMPLETE]: 'The season is complete · joining is closed.',
};
const ALREADY_MEMBER_COPY = "You're already a member of this league.";

// LeagueManagement's threshold: shorter than this is still being typed, so it
// is never looked up (the preview route is rate limited per caller).
const MIN_PREVIEW_LENGTH = 6;
const PREVIEW_DEBOUNCE_MS = 300;

/**
 * The invite code in whatever the manager typed or pasted: a bare code, or a
 * shared invite link (/#/league/join?code=...), whose `code` parameter is the
 * code. Case is kept: invite codes are matched exactly by the server.
 */
export function inviteCodeFrom(raw) {
  const text = (raw || '').trim();
  const match = text.match(/[?&]code=([^&#\s]*)/i);
  if (!match) return text;
  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    return match[1].trim();
  }
}

function formatLine(preview) {
  if (isPickemOnly(preview)) return shortLeagueTypeLabel(preview);
  const parts = [shortLeagueTypeLabel(preview)];
  if (SCORING_PRESET_LABELS[preview.scoringPreset]) parts.push(SCORING_PRESET_LABELS[preview.scoringPreset]);
  if (preview.bestBall) parts.push('Best ball');
  if (preview.pickemEnabled) parts.push("Pick'em on");
  return parts.join(' · ');
}

function draftDayLabel(draftDate) {
  const date = draftDate ? new Date(draftDate) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Why this manager cannot join the previewed league, or null when they can. */
function refusalFor(preview) {
  if (!preview) return null;
  if (preview.alreadyMember) return ALREADY_MEMBER_COPY;
  if (preview.joinable === false) return JOIN_CLOSED_COPY[preview.joinReason] || 'This league is not taking new teams.';
  return null;
}

/**
 * Join a league by invite code, with a read-only preview of the league the
 * code points at (GET /api/league/preview?code=, the same debounced lookup
 * LeagueManagement runs) shown before the Team name is asked for.
 *
 * Owns its answers, its error and its in-flight flag. The answers survive a
 * close (and a failed join); a successful join clears them, announces itself
 * once through the snackbar and calls `onJoined` so the page can refetch.
 */
export default function JoinLeagueDialog({ open, onClose, onJoined }) {
  const notify = useSnackbar();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  // The raw input is stored as typed; it is shown upper-cased by CSS only.
  const [rawCode, setRawCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [joinError, setJoinError] = useState(null);
  const [joining, setJoining] = useState(false);
  // { code, status: 'found' | 'not-found', league } for the last answered
  // lookup, or null. A lookup that failed for any reason but a 404 leaves
  // nothing: a failed preview never blocks the Join button.
  const [lookup, setLookup] = useState(null);

  const inviteCode = inviteCodeFrom(rawCode);
  const trimmedTeamName = teamName.trim();

  useEffect(() => {
    if (inviteCode.length < MIN_PREVIEW_LENGTH) {
      setLookup(null);
      return undefined;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const response = await apiClient.get(`/api/league/preview?code=${encodeURIComponent(inviteCode)}`);
        const league = response.data && response.data.id ? response.data : null;
        if (!cancelled) setLookup(league ? { code: inviteCode, status: 'found', league } : null);
      } catch (err) {
        if (cancelled) return;
        setLookup(readHttpFailure(err).status === 404 ? { code: inviteCode, status: 'not-found' } : null);
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [inviteCode]);

  // Only an answer for the code currently in the field counts.
  const current = lookup && lookup.code === inviteCode ? lookup : null;
  const preview = current && current.status === 'found' ? current.league : null;
  const notFound = Boolean(current && current.status === 'not-found');
  const keepTyping = inviteCode.length > 0 && inviteCode.length < MIN_PREVIEW_LENGTH;
  const refusal = refusalFor(preview);

  // A disabled button alone doesn't say why (WCAG 3.3.2), so the reason is
  // spelled out and tied to it with aria-describedby.
  // A refusal is already worded on the preview card, so the button points at
  // that note instead of repeating it.
  const missingAnswers = !inviteCode || !trimmedTeamName;
  let joinBlockerId;
  if (refusal) joinBlockerId = 'join-league-refusal';
  else if (missingAnswers) joinBlockerId = 'join-league-blocker';

  const handleClose = () => {
    setJoinError(null);
    onClose();
  };

  const handleJoin = async () => {
    if (joining || joinBlockerId) return;
    setJoinError(null);
    setJoining(true);
    try {
      await apiClient.post('/api/league/join', { inviteCode, teamName: trimmedTeamName });
      // The snackbar is the one success announcement; the page adds none.
      notify('Joined league!');
      setRawCode('');
      setTeamName('');
      setLookup(null);
      handleClose();
      if (onJoined) onJoined();
    } catch (err) {
      setJoinError(readHttpFailure(err).message || err.message);
    } finally {
      setJoining(false);
    }
  };

  let joinLabel = 'Join league';
  if (joining) joinLabel = 'Joining…';
  else if (preview) joinLabel = `Join ${preview.name}`;

  const draftDay = preview ? draftDayLabel(preview.draftDate) : null;

  return (
    <Dialog open={open} onClose={handleClose} fullScreen={fullScreen} className="dialogContainer" aria-labelledby="join-league-title">
      <DialogTitle id="join-league-title" className="dialogTitle">Join a league</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Your commissioner sends an invite code or link. Leagues are private, so you need one to join.
        </Typography>
        {joinError && <Alert severity="error" sx={{ mb: 1 }}>{joinError}</Alert>}
        <TextField
          className="dialogTextField"
          autoFocus
          margin="dense"
          label="Invite code"
          required
          fullWidth
          value={rawCode}
          onChange={(event) => setRawCode(event.target.value)}
          error={notFound}
          // Codes are matched exactly, so the keyboard must not re-case them.
          inputProps={{
            autoComplete: 'off',
            autoCapitalize: 'none',
            spellCheck: false,
            'aria-describedby': 'join-code-status',
            style: { textTransform: 'uppercase' },
          }}
        />
        {/* One polite live region for what the code resolves to. */}
        <Box id="join-code-status" aria-live="polite" sx={{ my: 1 }}>
          {keepTyping && (
            <Typography variant="body2" color="text.secondary">
              Keep typing. Invite codes are 8 letters and numbers.
            </Typography>
          )}
          {notFound && (
            <Paper variant="outlined" sx={{ px: 2, py: 1.5, borderColor: 'error.main' }}>
              <Typography variant="body2" component="p" color="error" sx={{ fontWeight: 600 }}>No league uses that code</Typography>
              <Typography variant="body2" component="p">
                Check for a mix-up like 0 and O, or ask your commissioner for a fresh link.
              </Typography>
            </Paper>
          )}
          {preview && (
            <Paper
              variant="outlined"
              data-testid="join-preview"
              sx={{ p: 2, borderColor: refusal ? 'warning.main' : 'primary.main', borderWidth: 2 }}
            >
              <Typography variant="subtitle1" component="p" sx={{ fontWeight: 700 }}>{preview.name}</Typography>
              {/* One fact per element (#209), so a screen reader announces
                  each on its own. The commissioner is named by Team, never
                  by account (CONTEXT.md Team identity). */}
              <Typography variant="body2" color="text.secondary">{formatLine(preview)}</Typography>
              <Typography variant="body2" color="text.secondary">
                {`${preview.teamCount} of ${preview.maxTeams} seats taken`}
              </Typography>
              {draftDay && (
                <Typography variant="body2" color="text.secondary">{`Draft ${draftDay}`}</Typography>
              )}
              {preview.ownerTeamName && (
                <Typography variant="body2" color="text.secondary">{`Run by ${preview.ownerTeamName}`}</Typography>
              )}
              {refusal && (
                <Typography id="join-league-refusal" variant="body2" color="warning.main" sx={{ mt: 0.5, fontWeight: 600 }}>
                  {refusal}
                </Typography>
              )}
            </Paper>
          )}
        </Box>
        <TextField
          className="dialogTextField"
          margin="dense"
          label="Team name"
          fullWidth
          required
          inputProps={{ maxLength: 120 }}
          helperText="Your Team's identity in this league. Other managers never see your account email or username."
          value={teamName}
          onChange={(event) => setTeamName(event.target.value)}
        />
      </DialogContent>
      <DialogActions>
        {!refusal && missingAnswers && (
          <Typography id="join-league-blocker" variant="body2" color="text.secondary" sx={{ mr: 'auto', pl: 1 }}>
            Add the invite code and your Team name to continue.
          </Typography>
        )}
        <Button onClick={handleClose} color="primary" sx={MIN_TOUCH_TARGET_SX}>
          Cancel
        </Button>
        <Button
          onClick={handleJoin}
          color="primary"
          variant="contained"
          sx={MIN_TOUCH_TARGET_SX}
          aria-describedby={joinBlockerId}
          disabled={joining || Boolean(joinBlockerId)}
        >
          {joinLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
